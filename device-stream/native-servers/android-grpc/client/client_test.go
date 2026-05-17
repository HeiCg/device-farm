package client

import (
	"context"
	"errors"
	"net"
	"strings"
	"sync"
	"testing"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/grpc/test/bufconn"
	"google.golang.org/protobuf/types/known/emptypb"

	mmappkg "github.com/device-farm/device-stream/native-servers/android-grpc/mmap"
	pb "github.com/device-farm/device-stream/native-servers/android-grpc/proto/gen/emulatorcontrol"
)

// shouldRetryStartup must retry on Unavailable/Cancelled/Internal/Unknown,
// and NOT retry on PermissionDenied, OK (nil), or unrelated errors.
func TestShouldRetryStartup_Table(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want bool
	}{
		{"nil OK", nil, false},
		{"Unavailable", status.Error(codes.Unavailable, "down"), true},
		{"Canceled", status.Error(codes.Canceled, "ctx"), true},
		{"Internal", status.Error(codes.Internal, "boom"), true},
		{"Unknown", status.Error(codes.Unknown, "?"), true},
		{"PermissionDenied", status.Error(codes.PermissionDenied, "nope"), false},
		{"Unauthenticated", status.Error(codes.Unauthenticated, "no auth"), false},
		{"DeadlineExceeded sentinel", context.DeadlineExceeded, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := shouldRetryStartup(tc.err)
			if got != tc.want {
				t.Fatalf("shouldRetryStartup(%v) = %v, want %v", tc.err, got, tc.want)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// fakeEmulator — minimal EmulatorController for bufconn tests.
// ---------------------------------------------------------------------------

type fakeEmulator struct {
	pb.UnimplementedEmulatorControllerServer

	// Test-configurable behavior.
	statusErr      error
	statusResp     *pb.EmulatorStatus
	images         []*pb.Image
	streamImageErr error

	mu             sync.Mutex
	gotTouches     []*pb.TouchEvent
	gotKeys        []*pb.KeyboardEvent
	gotStreamReq   *pb.ImageFormat
}

func (f *fakeEmulator) GetStatus(_ context.Context, _ *emptypb.Empty) (*pb.EmulatorStatus, error) {
	if f.statusErr != nil {
		return nil, f.statusErr
	}
	if f.statusResp != nil {
		return f.statusResp, nil
	}
	return &pb.EmulatorStatus{}, nil
}

func (f *fakeEmulator) StreamScreenshot(req *pb.ImageFormat, stream grpc.ServerStreamingServer[pb.Image]) error {
	f.mu.Lock()
	f.gotStreamReq = req
	f.mu.Unlock()
	for _, img := range f.images {
		if err := stream.Send(img); err != nil {
			return err
		}
	}
	return f.streamImageErr
}

func (f *fakeEmulator) SendTouch(_ context.Context, t *pb.TouchEvent) (*emptypb.Empty, error) {
	f.mu.Lock()
	f.gotTouches = append(f.gotTouches, t)
	f.mu.Unlock()
	return &emptypb.Empty{}, nil
}

func (f *fakeEmulator) SendKey(_ context.Context, k *pb.KeyboardEvent) (*emptypb.Empty, error) {
	f.mu.Lock()
	f.gotKeys = append(f.gotKeys, k)
	f.mu.Unlock()
	return &emptypb.Empty{}, nil
}

// startBufconnServer spins up an in-memory EmulatorController and returns a
// connected *Client + cleanup.
func startBufconnServer(t *testing.T, fake *fakeEmulator) *Client {
	t.Helper()
	lis := bufconn.Listen(1 << 20)
	srv := grpc.NewServer() // nosemgrep: grpc-server-insecure-connection -- bufconn in-memory pipe, no network
	pb.RegisterEmulatorControllerServer(srv, fake)
	go func() { _ = srv.Serve(lis) }()
	t.Cleanup(srv.Stop)

	conn, err := grpc.NewClient("passthrough:///bufnet",
		grpc.WithContextDialer(func(_ context.Context, _ string) (net.Conn, error) {
			return lis.DialContext(context.Background())
		}),
		// nosemgrep
		grpc.WithTransportCredentials(insecure.NewCredentials()),
	)
	if err != nil {
		t.Fatalf("grpc.NewClient: %v", err)
	}
	t.Cleanup(func() { _ = conn.Close() })

	return &Client{conn: conn, stub: pb.NewEmulatorControllerClient(conn), token: "test-token"}
}

// TestStreamFramesMMAP_BufconnMock: bufconn server emits ONE Image with the
// MMAP transport (empty inline bytes); assert onFrame fires once with the
// correct dimensions and that the data was copied from the mmap region.
func TestStreamFramesMMAP_BufconnMock(t *testing.T) {
	region, err := mmappkg.New(64 << 20)
	if err != nil {
		t.Fatalf("mmap.New: %v", err)
	}
	defer region.Close()

	// Pre-fill mmap with a known 2x1 RGBA frame (8 bytes).
	for i, b := range []byte{0xDE, 0xAD, 0xBE, 0xEF, 0x12, 0x34, 0x56, 0x78} {
		region.Bytes[i] = b
	}

	fake := &fakeEmulator{
		images: []*pb.Image{{
			Format: &pb.ImageFormat{
				Format: pb.ImageFormat_RGBA8888,
				Width:  2,
				Height: 1,
			},
			Width:       2,
			Height:      1,
			Seq:         0,
			TimestampUs: 1000,
		}},
	}
	cli := startBufconnServer(t, fake)

	ring := NewRing(64 << 20)
	var (
		gotW, gotH uint32
		gotBytes   []byte
		gotCalls   int
	)
	onFrame := func(rgba []byte, w, h uint32, seq, tsUs uint64) {
		gotW, gotH = w, h
		gotBytes = append([]byte(nil), rgba...)
		gotCalls++
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := cli.StreamFrames(ctx, region, ring, onFrame); err != nil {
		t.Fatalf("StreamFrames: %v", err)
	}

	if gotCalls != 1 {
		t.Fatalf("onFrame call count = %d, want 1", gotCalls)
	}
	if gotW != 2 || gotH != 1 {
		t.Fatalf("frame dims = %dx%d, want 2x1", gotW, gotH)
	}
	if len(gotBytes) != 8 {
		t.Fatalf("frame bytes len = %d, want 8", len(gotBytes))
	}
	wantBytes := []byte{0xDE, 0xAD, 0xBE, 0xEF, 0x12, 0x34, 0x56, 0x78}
	for i := range wantBytes {
		if gotBytes[i] != wantBytes[i] {
			t.Fatalf("frame byte %d = %#x, want %#x", i, gotBytes[i], wantBytes[i])
		}
	}

	// Auth metadata must have been attached to the stream request.
	// (We can't easily intercept stream-side metadata in the simple stub,
	// but we can verify the stream request payload was received.)
	fake.mu.Lock()
	if fake.gotStreamReq == nil {
		t.Fatalf("server never saw the StreamScreenshot request")
	}
	if got := fake.gotStreamReq.GetTransport().GetChannel(); got != pb.ImageTransport_MMAP {
		t.Fatalf("transport channel = %v, want MMAP", got)
	}
	if got := fake.gotStreamReq.GetTransport().GetHandle(); !strings.HasPrefix(got, "file://") {
		t.Fatalf("transport handle = %q, want file:// prefix", got)
	}
	fake.mu.Unlock()
}

// TestSendTouchPayload: verify the touch event hits the wire with
// Expiration=NEVER_EXPIRE (Pitfall 4) and pressure follows the
// phase 2/3 → 0 rule.
func TestSendTouchPayload(t *testing.T) {
	fake := &fakeEmulator{}
	cli := startBufconnServer(t, fake)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// began: pressure=1
	if err := cli.SendTouch(ctx, TouchSpec{
		XRatio: 0.5, YRatio: 0.25, Phase: 0, Pressure: 1.0, ID: 42,
		DisplayW: 1080, DisplayH: 1920,
	}); err != nil {
		t.Fatalf("SendTouch began: %v", err)
	}
	// ended: pressure must drop to 0
	if err := cli.SendTouch(ctx, TouchSpec{
		XRatio: 0.5, YRatio: 0.25, Phase: 2, Pressure: 1.0, ID: 42,
		DisplayW: 1080, DisplayH: 1920,
	}); err != nil {
		t.Fatalf("SendTouch ended: %v", err)
	}

	fake.mu.Lock()
	defer fake.mu.Unlock()
	if len(fake.gotTouches) != 2 {
		t.Fatalf("got %d touches, want 2", len(fake.gotTouches))
	}
	for i, te := range fake.gotTouches {
		if len(te.GetTouches()) != 1 {
			t.Fatalf("touch[%d]: touches count = %d, want 1", i, len(te.GetTouches()))
		}
		touch := te.GetTouches()[0]
		if touch.GetExpiration() != pb.Touch_NEVER_EXPIRE {
			t.Fatalf("touch[%d] Expiration = %v, want NEVER_EXPIRE (Pitfall 4)", i, touch.GetExpiration())
		}
		if touch.GetIdentifier() != 42 {
			t.Fatalf("touch[%d] Identifier = %d, want 42", i, touch.GetIdentifier())
		}
		if touch.GetTouchMajor() != 1 || touch.GetTouchMinor() != 1 {
			t.Fatalf("touch[%d] major/minor = %d/%d, want 1/1", i, touch.GetTouchMajor(), touch.GetTouchMinor())
		}
	}
	if pressBegan := fake.gotTouches[0].GetTouches()[0].GetPressure(); pressBegan != 1 {
		t.Fatalf("began pressure = %d, want 1 (max(1,...))", pressBegan)
	}
	if pressEnded := fake.gotTouches[1].GetTouches()[0].GetPressure(); pressEnded != 0 {
		t.Fatalf("ended pressure = %d, want 0 (phase=2 forces 0)", pressEnded)
	}
}

// TestProbeAuthMissing: server returns UNAUTHENTICATED; GetStatus must wrap
// the error with the "auth missing" hint pointing at the kittyfarm paths.
func TestProbeAuthMissing(t *testing.T) {
	fake := &fakeEmulator{
		statusErr: status.Error(codes.Unauthenticated, "missing bearer"),
	}
	cli := startBufconnServer(t, fake)

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	_, err := cli.GetStatus(ctx)
	if err == nil {
		t.Fatalf("GetStatus succeeded, want error")
	}
	if !strings.Contains(err.Error(), "auth missing") {
		t.Fatalf("GetStatus error %q must contain 'auth missing'", err.Error())
	}
}

// Compile-time guard: confirm bufconn auth metadata helpers compile so we
// know the test infrastructure imports correctly.
var (
	_ = metadata.New
	_ = errors.New
)
