// android-grpc-stream — daemon for Android emulator gRPC + MMAP capture
// (Phase 33 Wave 2). Wires:
//
//	auth.FindToken -> client.Dial -> mmap.New -> client.StreamFrames ->
//	encode.New -> ipc.Encode -> Unix socket
//
// Inbound IPC kinds are translated to gRPC calls:
//   - 0xC1 touch -> client.SendTouch
//   - 0xC2 key   -> client.SendKey
//   - 0xC9 quit  -> graceful shutdown
//
// Wave 3 wires the spawn flag; Wave 4 wires the Node consumer.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"net"
	"os"
	"os/signal"
	"path/filepath"
	"sync"
	"syscall"
	"time"

	"github.com/device-farm/device-stream/native-servers/android-grpc/auth"
	"github.com/device-farm/device-stream/native-servers/android-grpc/client"
	"github.com/device-farm/device-stream/native-servers/android-grpc/encode"
	"github.com/device-farm/device-stream/native-servers/android-grpc/ipc"
	"github.com/device-farm/device-stream/native-servers/android-grpc/mmap"
)

const usage = `android-grpc-stream — Android emulator gRPC + MMAP capture daemon.

Usage:
  android-grpc-stream --serial <serial> --grpc-port <port> [--socket <path>]
  android-grpc-stream --probe --serial <serial> --grpc-port <port>

Flags:
  --serial      ADB serial of the emulator (e.g. emulator-5554)
  --grpc-port   gRPC port of the emulator (band 8554-8650)
  --socket      Unix socket path (default /tmp/device-stream-android-emu-<serial>.sock)
  --probe       Probe-only mode: call EmulatorController.getStatus and exit 0/1

Environment:
  DEVICE_STREAM_ANDROID_GRPC=0  Disable gRPC path entirely (Node fallback to scrcpy)
`

func main() {
	// Pitfall 9 (33-RESEARCH.md): the Node consumer may close the socket at
	// any time. Without this, the next write triggers SIGPIPE and kills us.
	signal.Ignore(syscall.SIGPIPE)

	help := flag.Bool("help", false, "show usage")
	serial := flag.String("serial", "", "ADB serial")
	grpcPort := flag.Int("grpc-port", 0, "emulator gRPC port")
	socketPath := flag.String("socket", "", "Unix socket path")
	probe := flag.Bool("probe", false, "probe mode")
	flag.Usage = func() { fmt.Fprint(os.Stderr, usage) }
	flag.Parse()

	if *help || flag.NFlag() == 0 {
		fmt.Fprint(os.Stdout, usage)
		os.Exit(0)
	}
	if *serial == "" || *grpcPort == 0 {
		fmt.Fprint(os.Stderr, usage)
		os.Exit(2)
	}
	if *socketPath == "" {
		*socketPath = filepath.Join(os.TempDir(),
			fmt.Sprintf("device-stream-android-emu-%s.sock", *serial))
	}

	tok, err := auth.FindToken(*grpcPort)
	if err != nil {
		die("auth.FindToken: %v", err)
	}
	cli, err := client.Dial(fmt.Sprintf("127.0.0.1:%d", *grpcPort), tok)
	if err != nil {
		die("client.Dial: %v", err)
	}
	defer cli.Close()

	if *probe {
		runProbe(cli)
		return
	}
	runDaemon(cli, *socketPath)
}

func runProbe(cli *client.Client) {
	// 21s = retry window (20s) + 1s buffer to surface the final error.
	ctx, cancel := context.WithTimeout(context.Background(), 21*time.Second)
	defer cancel()
	resp, err := cli.GetStatus(ctx)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	b, _ := json.Marshal(resp)
	fmt.Println(string(b))
}

func runDaemon(cli *client.Client, socketPath string) {
	srv, err := ipc.NewServer(socketPath)
	if err != nil {
		die("ipc.NewServer: %v", err)
	}
	defer srv.Close()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-sigCh
		cancel()
	}()

	conn, err := srv.AcceptOne(ctx)
	if err != nil {
		die("AcceptOne: %v", err)
	}
	defer conn.Close()

	region, err := mmap.New(64 << 20)
	if err != nil {
		die("mmap.New: %v", err)
	}
	defer region.Close()

	var (
		enc      encode.Encoder
		writeMu  sync.Mutex
		metaSent bool
	)
	writeFrame := func(kind uint8, payload []byte) {
		writeMu.Lock()
		defer writeMu.Unlock()
		_, _ = conn.Write(ipc.Encode(kind, payload))
	}

	// Inbound reader: 0xC1 → SendTouch · 0xC2 → SendKey · 0xC9 → graceful quit
	// DisplayW/H placeholders (1080/1920) — Wave 4 will plumb real dims.
	const placeholderDisplayW, placeholderDisplayH = 1080, 1920
	go func() {
		for {
			kind, payload, err := ipc.Decode(conn)
			if err != nil {
				cancel()
				return
			}
			switch kind {
			case ipc.KindTouch:
				if p, derr := ipc.DecodeTouch(payload); derr == nil {
					_ = cli.SendTouch(ctx, client.TouchSpec{
						XRatio: p.X, YRatio: p.Y, Phase: p.Phase,
						Pressure: p.Pressure, ID: p.ID,
						DisplayW: placeholderDisplayW, DisplayH: placeholderDisplayH,
					})
				}
			case ipc.KindKey:
				if p, derr := ipc.DecodeKey(payload); derr == nil {
					_ = cli.SendKey(ctx, client.KeySpec{
						EventType: p.EventType, KeyCode: p.KeyCode, ModMask: p.ModMask,
					})
				}
			case ipc.KindQuit:
				cancel()
				return
			}
		}
	}()

	ring := client.NewRing(64 << 20)
	onFrame := func(rgba []byte, w, h uint32, seq, ts uint64) {
		if !metaSent {
			var ierr error
			enc, ierr = encode.New(int(w), int(h), 30, 4_000_000, writeFrame)
			if ierr != nil {
				writeFrame(ipc.KindError, []byte(ierr.Error()))
				cancel()
				return
			}
			writeFrame(ipc.KindMetadata, ipc.EncodeMetadata(ipc.MetadataPayload{
				Width: w, Height: h, FPS: 30,
			}))
			metaSent = true
		}
		if enc != nil {
			_ = enc.EncodePixelBuffer(rgba, int(w), int(h), int64(ts), false)
		}
	}

	if err := cli.StreamFrames(ctx, region, ring, onFrame); err != nil {
		writeFrame(ipc.KindError, []byte(err.Error()))
		if enc != nil {
			enc.Close()
		}
		os.Exit(1)
	}
	if enc != nil {
		enc.Close()
	}
}

func die(format string, args ...interface{}) {
	fmt.Fprintf(os.Stderr, format+"\n", args...)
	os.Exit(1)
}

// Keep net import live for cross-platform builds (transitively used by ipc.Server).
var _ = net.Listen
