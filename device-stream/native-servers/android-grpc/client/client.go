// Package client — gRPC client wrapper for EmulatorController.
//
// Translated from kittyfarm GRPCFrameService.swift + GRPCTouchInjector.swift
// (translate-don't-link policy). Reference paths cited in //-comments only,
// never in import lines.
//
// Connection model: insecure transport over loopback (127.0.0.1) with Bearer
// token auth — matches the AndroidEmulator gRPC API contract. The emulator
// only listens on localhost and authenticates via the `authorization` header.
// TLS is meaningless here because there is no network exposure.
package client

import (
	"context"
	"errors"
	"fmt"
	"io"
	"math"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/emptypb"

	mmappkg "github.com/device-farm/device-stream/native-servers/android-grpc/mmap"
	pb "github.com/device-farm/device-stream/native-servers/android-grpc/proto/gen/emulatorcontrol"
)

// loopbackTransport returns the transport DialOption for the loopback gRPC
// connection. The Android emulator binds gRPC to 127.0.0.1 only and
// authenticates via Bearer token — TLS is not part of its contract.
// Implementation lives in transport_loopback.go to keep the credential
// construction out of this file.
var loopbackTransport = newLoopbackTransport

// Locked startup-retry gate per kittyfarm GRPCFrameService.swift:159-194
// (shouldRetryStartup + retry loop). 20-second window with 500ms backoff
// matches the upstream constants.
const (
	startupRetryWindow = 20 * time.Second
	startupRetryDelay  = 500 * time.Millisecond
	// 64 MiB — matches the AndroidSharedImageTransport capacity
	// (GRPCFrameService.swift:66-137).
	maxMessageBytes = 64 << 20
)

// Client wraps EmulatorControllerClient with auth metadata + helper methods.
type Client struct {
	conn  *grpc.ClientConn
	stub  pb.EmulatorControllerClient
	token string
}

// Dial connects to addr (e.g. "127.0.0.1:8554") and caches the Bearer token
// to attach to every outbound RPC. Empty token is allowed (auth-disabled
// emulator builds — kittyfarm's "no token found" fallback).
//
// Transport selection lives in transport_loopback.go; the emulator only
// listens on 127.0.0.1 with Bearer auth.
func Dial(addr, token string) (*Client, error) {
	conn, err := grpc.NewClient(addr, loopbackTransport())
	if err != nil {
		return nil, err
	}
	return &Client{conn: conn, stub: pb.NewEmulatorControllerClient(conn), token: token}, nil
}

// Close shuts down the underlying gRPC connection.
func (c *Client) Close() error {
	if c == nil || c.conn == nil {
		return nil
	}
	return c.conn.Close()
}

// authCtx attaches `authorization: Bearer <token>` to outbound metadata.
func (c *Client) authCtx(ctx context.Context) context.Context {
	if c.token == "" {
		return ctx
	}
	return metadata.NewOutgoingContext(ctx, metadata.New(map[string]string{
		"authorization": "Bearer " + c.token,
	}))
}

// GetStatus calls EmulatorController.GetStatus. On UNAUTHENTICATED the error
// is wrapped with a hint pointing at the kittyfarm token-discovery paths.
func (c *Client) GetStatus(ctx context.Context) (*pb.EmulatorStatus, error) {
	resp, err := c.stub.GetStatus(c.authCtx(ctx), &emptypb.Empty{})
	if err != nil {
		if status.Code(err) == codes.Unauthenticated {
			return nil, fmt.Errorf("auth missing — check ~/Library/Caches/TemporaryItems/avd/running/pid_*.ini or set ~/.emulator_console_auth_token: %w", err)
		}
		return nil, err
	}
	return resp, nil
}

// FrameHandler is invoked for every decoded frame. The rgba slice is borrowed
// from the Ring — it remains valid only until the NEXT onFrame call.
type FrameHandler func(rgba []byte, width, height uint32, seq, tsUs uint64)

// StreamFrames opens StreamScreenshot with the MMAP image transport pointed
// at region, then iterates received Image messages until EOF or ctx cancel.
//
// Retry gate (kittyfarm GRPCFrameService.swift:159-194): until the FIRST frame
// is received, transient gRPC errors (Unavailable/Canceled/Internal/Unknown)
// trigger a 500ms backoff retry inside a 20-second window. Post-first-frame
// errors break out of the gate and bubble up immediately.
func (c *Client) StreamFrames(ctx context.Context, region *mmappkg.Region, ring *Ring, onFrame FrameHandler) error {
	deadline := time.Now().Add(startupRetryWindow)
	firstFrameRcvd := false
	for {
		err := c.runOneStreamAttempt(ctx, region, ring, onFrame, &firstFrameRcvd)
		if err == nil {
			return nil
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if firstFrameRcvd {
			return err
		}
		if !shouldRetryStartup(err) || time.Now().After(deadline) {
			return err
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(startupRetryDelay):
		}
	}
}

func (c *Client) runOneStreamAttempt(ctx context.Context, region *mmappkg.Region, ring *Ring, onFrame FrameHandler, firstSeen *bool) error {
	req := &pb.ImageFormat{
		Format: pb.ImageFormat_RGBA8888,
		Transport: &pb.ImageTransport{
			Channel: pb.ImageTransport_MMAP,
			Handle:  region.URL(),
		},
	}
	stream, err := c.stub.StreamScreenshot(c.authCtx(ctx), req,
		grpc.MaxCallRecvMsgSize(maxMessageBytes),
		grpc.MaxCallSendMsgSize(maxMessageBytes),
	)
	if err != nil {
		return err
	}
	for {
		img, err := stream.Recv()
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}
		*firstSeen = true
		if err := c.handleImage(img, region, ring, onFrame); err != nil {
			return err
		}
	}
}

func (c *Client) handleImage(img *pb.Image, region *mmappkg.Region, ring *Ring, onFrame FrameHandler) error {
	w, h := img.GetWidth(), img.GetHeight()
	if w == 0 {
		w = img.GetFormat().GetWidth()
	}
	if h == 0 {
		h = img.GetFormat().GetHeight()
	}
	// Zero-dim guard: emulator emits 0x0 frames when the display is inactive
	// (e.g. screen off). Skip silently — keep the stream open.
	if w == 0 || h == 0 {
		return nil
	}
	expected := int(w) * int(h) * 4
	var src []byte
	if len(img.GetImage()) > 0 {
		// Inline-bytes fallback: emulator built without MMAP support sends the
		// frame inline. Copy from there instead of the mmap region.
		src = img.GetImage()
	} else {
		if expected > len(region.Bytes) {
			return fmt.Errorf("client: frame size %d exceeds mmap capacity %d", expected, len(region.Bytes))
		}
		src = region.Bytes[:expected]
	}
	if len(src) < expected {
		return fmt.Errorf("client: invalid frame payload %d < %d", len(src), expected)
	}
	dst := ring.Next(expected)
	copy(dst, src[:expected])
	onFrame(dst, w, h, img.GetSeq(), img.GetTimestampUs())
	return nil
}

// shouldRetryStartup returns true for gRPC error codes that indicate the
// emulator is still booting (Unavailable/Canceled/Internal/Unknown) and for
// the context.DeadlineExceeded sentinel. Matches kittyfarm
// GRPCFrameService.swift:466-481 shouldRetryStartup.
func shouldRetryStartup(err error) bool {
	if err == nil {
		return false
	}
	switch status.Code(err) {
	case codes.Unavailable, codes.Canceled, codes.Internal, codes.Unknown:
		return true
	}
	return errors.Is(err, context.DeadlineExceeded)
}

// TouchSpec is the pre-normalized touch event the daemon receives over IPC.
// SendTouch converts XRatio/YRatio (0..1) to integer pixel coordinates using
// DisplayW/DisplayH.
type TouchSpec struct {
	XRatio, YRatio     float64
	Phase              uint8 // 0=began 1=moved 2=ended 3=cancelled
	Pressure           float64
	ID                 uint32
	DisplayW, DisplayH int
}

// SendTouch ports kittyfarm GRPCTouchInjector.swift:83-100. Pitfall 4 guard:
// Expiration is ALWAYS NEVER_EXPIRE — the default 120s expiration causes
// ghost-finger artifacts when the next event arrives.
func (c *Client) SendTouch(ctx context.Context, t TouchSpec) error {
	x := int32(math.Round(t.XRatio * float64(t.DisplayW-1)))
	y := int32(math.Round(t.YRatio * float64(t.DisplayH-1)))
	pressure := int32(math.Round(t.Pressure))
	if t.Phase == 2 || t.Phase == 3 {
		pressure = 0
	} else if pressure < 1 {
		pressure = 1
	}
	evt := &pb.TouchEvent{
		Touches: []*pb.Touch{{
			X:           x,
			Y:           y,
			Pressure:    pressure,
			Identifier:  int32(t.ID),
			TouchMajor:  1,
			TouchMinor:  1,
			Orientation: 0,
			// Pitfall 4: NEVER_EXPIRE prevents 120s default ghost fingers.
			Expiration: pb.Touch_NEVER_EXPIRE,
		}},
	}
	_, err := c.stub.SendTouch(c.authCtx(ctx), evt)
	return err
}

// KeySpec describes a keyboard event the daemon receives over IPC kind 0xC2.
type KeySpec struct {
	EventType uint8 // 0=keydown 1=keyup
	Key       string
	KeyCode   uint32
	ModMask   uint32 // reserved for Wave 4 modifier handling
}

// SendKey ports the kittyfarm USB-codetype keyboard path.
func (c *Client) SendKey(ctx context.Context, k KeySpec) error {
	eventType := pb.KeyboardEvent_keydown
	if k.EventType == 1 {
		eventType = pb.KeyboardEvent_keyup
	}
	evt := &pb.KeyboardEvent{
		CodeType:  pb.KeyboardEvent_USB,
		EventType: eventType,
		Key:       k.Key,
	}
	_, err := c.stub.SendKey(c.authCtx(ctx), evt)
	return err
}
