# Phase 33: Android gRPC EmulatorController - Research

**Researched:** 2026-05-15
**Domain:** Android emulator gRPC + MMAP frame transport + native Go helper (replaces scrcpy for emulators)
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**External Dependencies Policy (LOCKED):** Reference repos are STUDY-ONLY. kittyfarm, simvyn, revyl-cli, app-explorer, mobile-devtools at `/Users/heicg/Desktop/projects/_reference/` are read-only references — copy ideas/algorithms/pseudocode into `device-stream/`/`device-farm/`, never link as deps. Normal libs (zod, fastify, grpc-go, protoc plugins) remain fine.

**Authoritative Sources (LOCKED):**
- `33-BRIEF.md` is the spec — task list, IPC contract, acceptance criteria are locked
- `/Users/heicg/Desktop/projects/_reference/kittyfarm/KittyFarm/Capture/GRPCFrameService.swift` (482 LOC) — frame-streaming reference
- `/Users/heicg/Desktop/projects/_reference/kittyfarm/KittyFarm/Capture/AndroidEmulatorAuth.swift` (103 LOC) — auth token discovery
- `/Users/heicg/Desktop/projects/_reference/kittyfarm/KittyFarm/Generated/emulator_controller_kittyfarm.proto` — proto subset
- `/Users/heicg/Desktop/projects/_reference/kittyfarm/KittyFarm/Input/GRPCTouchInjector.swift` — touch over gRPC
- Existing `device-stream/packages/android/` — keep API contract identical for consumers

**Architecture (LOCKED):**
- Translate kittyfarm Swift reference into Go (for native server) since device-farm CLI is Go and existing Android transport pieces lean toward shell-out from Node.
- Auth token discovery: `~/Library/Caches/TemporaryItems/avd/running/pid_<pid>.ini` keyed by `grpc.port`; fallback to `~/.emulator_console_auth_token`.
- MMAP transport: read raw frames from shared-memory ring; gRPC for control plane (touch, key, lifecycle).
- IPC contract from helper to Node: same length-prefixed framed protocol as sim-capture-private (Phase 32) for consistency.
- Fallback: env `DEVICE_STREAM_ANDROID_GRPC=0` or auth-token discovery failure → scrcpy path.

**Tasks (LOCKED from brief):**
- T-33.1 Proto + Go gRPC stubs (~3h)
- T-33.2 Auth token discovery (.ini parser + fallback) (~3h)
- T-33.3 gRPC client + MMAP frame reader (~6h)
- T-33.4 H.264 encoder + Unix socket IPC bridge (~5h)
- T-33.5 Spawn emulator with `-grpc` + Pool integration (~4h)
- T-33.6 TypeScript service swap with fallback (~3h)
- T-33.7 Touch + key control parity (sendTouch, sendKey) (~4h)
- T-33.8 Postinstall + scrcpy fetch made conditional (~2h)

### Claude's Discretion

- Go module layout within `device-stream/native-servers/android-grpc/`
- Choice of gRPC code-gen tool (`protoc-gen-go-grpc` standard)
- Whether to ship MMAP reader in pure Go via cgo or shell-out — prefer pure Go via `golang.org/x/exp/mmap` if possible
- Test fixtures (recorded MMAP frames vs live emulator)

### Deferred Ideas (OUT OF SCOPE)

- Physical Android devices over gRPC (stays on scrcpy)
- Audio capture (gRPC EmulatorController doesn't currently expose audio cleanly)
- Anti-frame-loss on backpressure (rely on MMAP ring semantics for now)
</user_constraints>

<phase_requirements>
## Phase Requirements

REQUIREMENTS.md was closed at v3.0 (Phases 15-30). Phase 33 is out-of-band (introduces new pseudo-IDs for traceability, following the precedent set by Phase 32 SIM-PRIV-*). The locked authoritative source is `33-BRIEF.md` §Acceptance criteria.

| Pseudo-ID | Description | Research Support |
|-----------|-------------|------------------|
| AND-GRPC-01 | Booting an emulator reads frames over gRPC + MMAP — `scrcpy-server.jar` not touched on emulator path | §Reference Walkthrough (kittyfarm GRPCFrameService.swift:139-300), §Emulator Spawn (`-grpc <port>` flag injection at `server/pool/android/emulator.ts`), §TS Service Swap (selection rule in `service.start`) |
| AND-GRPC-02 | `DEVICE_STREAM_ANDROID_GRPC=0` falls back to scrcpy with no test failures | §TS Service Swap §Fallback path, kittyfarm precedent `KITTYFARM_ANDROID_MMAP` env at GRPCFrameService.swift:145-146 |
| AND-GRPC-03 | Touch via gRPC reaches the app in < 80ms on Apple Silicon M1+ | §Touch Control (kittyfarm GRPCTouchInjector.swift:83-100 NEVER_EXPIRE pressure=1), §Performance — direct gRPC sendTouch bypasses scrcpy's `input tap` shell chain |
| AND-GRPC-04 | Frame latency from emulator backboard → WS dashboard reduces vs scrcpy baseline (target -30% median) | §MMAP Frame Reader §Zero-copy (image bytes empty when MMAP active per proto comment line 312), §H.264 Encode — encode happens inline in Go helper, eliminating Java agent round-trip |
| AND-GRPC-05 | CPU usage of new daemon < scrcpy baseline at 30fps 1080p | §H.264 Encode (VideoToolbox on darwin via cgo, libx264 on linux behind build tag), §MMAP Reader Pitfall — copy-on-borrow ring buffer minimizes encoder stalls |
| AND-GRPC-06 | 30-min soak: stable RSS, no mmap leak | §Common Pitfalls §MMAP munmap/close discipline (kittyfarm cleanup() pattern at AndroidEmulatorAuth.swift:124-136), §Test Strategy §Soak script |
| AND-GRPC-REF-01 | Faithful kittyfarm port: no kittyfarm linkage, only translated patterns | External Dependencies Policy (LOCKED), grep gate `! grep -r "import.*kittyfarm" device-stream/native-servers/android-grpc/` |
| AND-GRPC-REF-02 | IPC framing wire-compatible with sim-capture-private (Phase 32) | §IPC Framing (mirrors `device-stream/native-servers/sim-capture-private/Sources/IpcServer.h:7-22` length-prefixed [u32 BE][u8 kind][payload]) |
</phase_requirements>

## Summary

Phase 33 replaces scrcpy for Android *emulators* with a Go-native daemon that talks the emulator's built-in `EmulatorController` gRPC service. Frames come back via the emulator's MMAP shared-memory side-channel (zero-copy: gRPC delivers metadata, pixel bytes are read directly from a `file:///` mmap region). The daemon encodes RGBA8888 → H.264 in-process (VideoToolbox/cgo on darwin, libx264 behind a build tag on linux) and serves frames over a Unix socket using the exact same length-prefixed framing as Phase 32's sim-capture-private (`[u32 BE length][u8 kind][payload]`). The Node-side adapter spawns one daemon per emulator serial and shovels frames to the existing WebSocket bridge.

The reference implementation in kittyfarm's `GRPCFrameService.swift` + `AndroidEmulatorAuth.swift` + `GRPCTouchInjector.swift` is comprehensive — it covers gRPC plumbing, MMAP ring semantics, auth-token discovery via `~/Library/Caches/TemporaryItems/avd/running/pid_*.ini` (and the `~/.emulator_console_auth_token` fallback), startup retry with shouldRetryStartup gating, RGBA8888 vs RGB888 vs PNG decode paths, multi-display TouchEvent, and modifier-aware sendKey sequencing. Porting it 1:1 to Go is mechanical; the only judgement calls are (a) MMAP ring borrow semantics in the encoder hot loop, and (b) whether the H.264 encode lives in the Go helper or a sidecar process.

**Primary recommendation:** Adopt a 4-layer Go module under `device-stream/native-servers/android-grpc/` — `proto/` (.proto + Makefile codegen via `protoc-gen-go-grpc`), `auth/` (.ini parser + fallback), `client/` (gRPC + MMAP reader with 2-frame ring), `encode/` (build-tagged VideoToolbox/x264), and `ipc/` (Phase 32-compatible framer). Spawn one daemon per emulator from Node; gate the entire path behind `DEVICE_STREAM_ANDROID_GRPC` (default `1` after canary). Wire `-grpc <port>` flag into `server/pool/android/emulator.ts:94-106` between `-port` and `-gpu` and reserve a port band 8554-8650 in the existing `allocatePort` helper.

## Reference Walkthrough — what kittyfarm patterns to port

These are the patterns to translate to Go. Cite file:line so reviewers can sanity-check the port.

### Pattern 1: gRPC client lifecycle + retry gate

**Source:** `GRPCFrameService.swift:159-194` (`startStreaming`) + `:466-481` (`shouldRetryStartup`)
**What it does:**
- Records a 20-second `startupRetryWindow` deadline.
- Inside the loop, optionally creates an `AndroidSharedImageTransport` (capacity = 64 MiB by default), then awaits the first frame via a `StreamStartupSignal` continuation.
- On `RPCError` with code `unavailable | cancelled | internalError | unknown`, retries after 500ms.
- On `CancellationError`, exits with `streamEndedBeforeFirstFrame`.

**Go translation:**
```go
// device-stream/native-servers/android-grpc/client/client.go
const startupRetryWindow = 20 * time.Second
const startupRetryDelay  = 500 * time.Millisecond

func (c *Client) StreamFrames(ctx context.Context, onFrame FrameHandler) error {
    deadline := time.Now().Add(startupRetryWindow)
    for {
        err := c.runOneStreamAttempt(ctx, onFrame)
        if err == nil { return nil }
        if ctx.Err() != nil { return ctx.Err() }
        if !shouldRetryStartup(err) || time.Now().After(deadline) { return err }
        time.Sleep(startupRetryDelay)
    }
}
func shouldRetryStartup(err error) bool {
    s, ok := status.FromError(err)
    if !ok { return false }
    switch s.Code() {
    case codes.Unavailable, codes.Canceled, codes.Internal, codes.Unknown: return true
    default: return false
    }
}
```

### Pattern 2: MMAP shared-memory transport setup

**Source:** `GRPCFrameService.swift:66-137` (`AndroidSharedImageTransport`)
**What it does:**
- `open(O_RDWR|O_CREAT|O_TRUNC)` a unique file in `temporaryDirectory` (e.g. `/tmp/kittyfarm-android-<UUID>.rgba`).
- `ftruncate` to 64 MiB capacity.
- `mmap(nil, capacity, PROT_READ|PROT_WRITE, MAP_SHARED, fd, 0)`.
- `requestTransport()` builds `ImageTransport{channel: MMAP, handle: "file://<path>"}`.
- `cleanup()` calls `munmap` + `close(fd)` + `removeItem` — `deinit` guarantee.

**Go translation:** Use `os.CreateTemp`, raw `syscall.Mmap` (NOT the read-only `golang.org/x/exp/mmap.ReaderAt` — we need RW because the emulator writes into our region). The emulator OPENS the file by URL and writes via shared mapping; the Go side only reads but the region must be `PROT_READ|PROT_WRITE` + `MAP_SHARED` so the kernel pages are coherent.

```go
// device-stream/native-servers/android-grpc/mmap/mmap_unix.go
//go:build darwin || linux
type Region struct { Path string; Bytes []byte; fd int }
func New(capacity int) (*Region, error) {
    f, _ := os.CreateTemp("", "android-grpc-*.rgba")
    if err := f.Truncate(int64(capacity)); err != nil { return nil, err }
    b, err := syscall.Mmap(int(f.Fd()), 0, capacity, syscall.PROT_READ|syscall.PROT_WRITE, syscall.MAP_SHARED)
    if err != nil { return nil, err }
    return &Region{Path: f.Name(), Bytes: b, fd: int(f.Fd())}, nil
}
func (r *Region) Close() error { _ = syscall.Munmap(r.Bytes); _ = syscall.Close(r.fd); return os.Remove(r.Path) }
func (r *Region) URL() string { return "file://" + r.Path }
```

### Pattern 3: streamScreenshot request shape + RGBA payload selection

**Source:** `GRPCFrameService.swift:269-300` (`streamFrames`) + `:302-311` (`makeRequestFormat`)
**What it does:**
- Builds `ImageFormat{format: RGBA8888, transport: ImageTransport{channel:MMAP, handle:URL}}`.
- Sets `CallOptions.maxRequestMessageBytes = maxResponseMessageBytes = 64 MiB`.
- Attaches `authorization: Bearer <token>` metadata via `AndroidEmulatorAuth.metadata(forGRPCPort:)`.
- Iterates `for try await image in response.messages` — calls `makeFrame(from: image, sharedTransport:)` for each.

**Go translation:** When `image.Image` payload is empty AND we passed an MMAP transport, the bytes are in the mmap region. Otherwise (older emulator builds, or MMAP not supported), the bytes are inline in `image.Image`.

```go
func (c *Client) runOneStreamAttempt(ctx context.Context, onFrame FrameHandler) error {
    md := metadata.New(map[string]string{"authorization": "Bearer " + c.token})
    ctx = metadata.NewOutgoingContext(ctx, md)
    req := &pb.ImageFormat{
        Format:    pb.ImageFormat_RGBA8888,
        Transport: &pb.ImageTransport{Channel: pb.ImageTransport_MMAP, Handle: c.mmap.URL()},
    }
    stream, err := c.stub.StreamScreenshot(ctx, req,
        grpc.MaxCallRecvMsgSize(64<<20), grpc.MaxCallSendMsgSize(64<<20))
    if err != nil { return err }
    for {
        img, err := stream.Recv()
        if err == io.EOF { return nil }
        if err != nil { return err }
        if err := c.handleImage(img, onFrame); err != nil { return err }
    }
}
```

### Pattern 4: Frame decode dispatch (RGBA8888 / RGB888 / PNG)

**Source:** `GRPCFrameService.swift:313-358` (`makeFrame`)
- `image.format.format == .rgba8888` → if `image.Image` is empty, read `width*height*4` from mmap; else use inline bytes.
- `.rgb888` → 3-byte stride; expand to RGBA by writing 0xFF alpha per pixel (loop at `:380-412`).
- `.png` → fall through to CoreGraphics decode. **For Go, we can drop PNG entirely** — we explicitly request RGBA8888 and only fall back to inline bytes when MMAP is unsupported. PNG decode would only matter if we ever needed `getScreenshot` (one-shot) — out of scope for Phase 33.

**Recommendation:** Implement RGBA8888 (mmap path) as primary, RGBA8888 (inline) as fallback, RGB888 expansion as a defensive secondary. Skip PNG. Mirror the `invalidFramePayload` error when `data.count < width*height*4`.

### Pattern 5: Touch event construction

**Source:** `GRPCTouchInjector.swift:83-100` (`makeTouchEvent`)
- Maps a normalized `(x_ratio, y_ratio)` in 0..1 to pixel coords via `int(round(ratio * (size - 1)))`.
- Sets `identifier = touch.id`, `pressure = phase==ended||phase==cancelled ? 0 : max(round(pressure), 1)`, `touchMajor=touchMinor=1`, `expiration = .neverExpire`, `orientation = 0`.
- Builds `TouchEvent{touches: [point]}`.

**Critical:** The expiration must be `NEVER_EXPIRE`. The default (`EVENT_EXPIRATION_UNSPECIFIED`) auto-expires after 120s and the emulator sends an implicit pressure=0 event — this manifests as ghost-finger bugs in long-running flows. From proto comment lines 960-972.

### Pattern 6: Key event sequencing with modifiers

**Source:** `GRPCTouchInjector.swift:21-51` (`sendKey`)
- For each modifier keyCode: send `keydown` (codeType=.mac).
- Send `keydown` for the primary keyCode, then `keyup`.
- For each modifier (reversed order): send `keyup`.

**Note:** The device-farm consumer side (`packages/android/src/device-service.ts:124-141`) currently uses `KEYCODE_BACK`/`KEYCODE_HOME`/etc — those are Android-format keycodes, not Mac. The emulator's `KeyboardEvent.codeType` enum supports `USB | EVDEV | XKB | WIN | MAC` (proto lines 52-58). For parity with the existing `input keyevent KEYCODE_*` ADB path, use `codeType = USB` and look up USB HID codes, OR fall back to `key` (string) field which the emulator interprets like a softkey label (e.g. `"Back"`, `"Home"`). The simplest port: pass through `key: "<KEYCODE_NAME>"` (string) field — the emulator accepts it.

### Pattern 7: Emulator spawn flag

**Source:** `EmulatorManager.swift:72-77`
```swift
process.arguments = ["-avd", avdName, "-no-window", "-grpc", String(grpcPort)]
```
Plain `-grpc <port>` is enough. Kittyfarm does NOT pass `-grpc-use-jwt` — the emulator generates a per-instance token automatically when `-grpc` is given without JWT mode, and writes it to `pid_<pid>.ini`. Important: the readiness probe waits up to 15s for the port to accept TCP connects across `["localhost", "::1", "127.0.0.1"]` (lines 88-105) — the gRPC server starts AFTER the emulator binds the console port. We need our own readiness probe.

### Pattern 8: Auth token discovery — exact .ini parsing

**Source:** `AndroidEmulatorAuth.swift:44-101`
- Lookup order: per-instance token → global token → empty (no auth).
- **Per-instance:** enumerate `~/Library/Caches/TemporaryItems/avd/running/`, filter `.ini` extension, parse each for `grpc.port` matching the target port, return `grpc.token` if non-empty.
- **Global fallback:** read `~/.emulator_console_auth_token`, trim whitespace.
- **INI parser:** trivial — split on newlines, find first `=`, take key/value split + trim spaces. NO `[section]` headers needed.
- Once resolved, cache in `[port: Metadata]` map and reuse — token is stable for the emulator's lifetime.

**Verification from search results:** Issuetracker and forum threads confirm:
- The `pid_<pid>.ini` path is canonical (Library/Caches/TemporaryItems/avd/running/pid_6198.ini in one CI report).
- JWKs are stored at `pid_*/jwks/` subdirectories (out of scope — JWT mode isn't used).
- Requires `Authorization: Bearer <token>` header; failure returns `invalid_token`.

## Proto + gRPC stubs — extract and codegen

### What to extract from kittyfarm Protos

Kittyfarm ships a minimal `emulator_controller_kittyfarm.proto` (93 lines, see `/Users/heicg/Desktop/projects/_reference/kittyfarm/Protos/emulator_controller_kittyfarm.proto`). It already has the right 4-RPC subset:

```protobuf
service EmulatorController {
  rpc sendKey(KeyboardEvent) returns (google.protobuf.Empty);
  rpc setClipboard(ClipData) returns (google.protobuf.Empty);
  rpc sendTouch(TouchEvent) returns (google.protobuf.Empty);
  rpc streamScreenshot(ImageFormat) returns (stream Image);
}
```

Plus messages: `ImageTransport`, `ImageFormat`, `Image`, `ClipData`, `KeyboardEvent`, `Touch`, `TouchEvent`. **Add `getStatus(google.protobuf.Empty) returns (EmulatorStatus)`** — needed for the readiness probe (BRIEF Risk table line 1: "Probe `getStatus` first; surface clear 'auth missing' error"). Copy the `EmulatorStatus` message from the upstream full proto (lines 1462-1491). Skip every other RPC and message (audio, logcat, GPS, multi-display, etc.) — Phase 33 doesn't need them.

**Package note:** kittyfarm uses `package android.emulation.control;`. Match upstream Google package name exactly so the wire format is identical. The Go option line we add:

```protobuf
option go_package = "github.com/device-farm/device-stream/native-servers/android-grpc/proto/gen/emulatorcontrol;emulatorcontrol";
```

### How to regen with `protoc-gen-go-grpc`

Standard Google flow (verified via Go quickstart docs, MEDIUM confidence):

```bash
# Install once
go install google.golang.org/protobuf/cmd/protoc-gen-go@latest
go install google.golang.org/grpc/cmd/protoc-gen-go-grpc@latest

# Regen (Makefile target)
protoc -I proto \
  --go_out=. --go_opt=paths=source_relative \
  --go-grpc_out=. --go-grpc_opt=paths=source_relative \
  proto/emulator_controller.proto
```

**Generated files:**
- `proto/emulator_controller.pb.go` — message types
- `proto/emulator_controller_grpc.pb.go` — `EmulatorControllerClient` interface + `NewEmulatorControllerClient(conn)` constructor

**License + provenance:** Keep an SPDX `Apache-2.0` header at the top of `emulator_controller.proto` and a comment linking to `https://android.googlesource.com/platform/external/qemu/+/refs/heads/emu-master-dev/android/android-grpc/android/emulation/control/emulator_controller.proto`. The full upstream proto (77 KB) lives at `_reference/kittyfarm/Protos/emulator_controller.proto` for cross-reference — don't ship it; ship only the trimmed kittyfarm-style subset.

### Recommended module layout

```
device-stream/native-servers/android-grpc/
├── go.mod                              # module github.com/device-farm/device-stream/native-servers/android-grpc
├── Makefile                            # protoc, build, test targets
├── proto/
│   ├── emulator_controller.proto       # subset, ~120 lines
│   └── gen/
│       └── emulatorcontrol/
│           ├── emulator_controller.pb.go
│           └── emulator_controller_grpc.pb.go
├── auth/
│   ├── token.go                        # findToken(grpcPort) → string
│   ├── ini.go                          # parseSimpleIni([]byte) → map[string]string
│   └── token_test.go
├── mmap/
│   ├── mmap_unix.go                    # syscall.Mmap RW MAP_SHARED
│   └── mmap_test.go
├── client/
│   ├── client.go                       # gRPC dial, StreamFrames, sendTouch, sendKey, getStatus
│   ├── ring.go                         # 2-frame copy-on-borrow ring
│   └── client_test.go
├── encode/
│   ├── encoder.go                      # Encoder interface, factory
│   ├── encoder_darwin.go               # VideoToolbox cgo (//go:build darwin)
│   ├── encoder_linux.go                # libx264 cgo (//go:build linux && x264)
│   └── encoder_fallback.go             # //go:build !darwin && !(linux && x264) — error-only
├── ipc/
│   ├── framer.go                       # length-prefixed [u32 BE][u8 kind][payload]
│   ├── server.go                       # Unix socket accept-one-client
│   └── framer_test.go
└── cmd/
    └── android-grpc-stream/
        └── main.go                     # daemon entrypoint
```

**Go version:** match `cli/go.mod` (`go 1.26.1`).

## Auth token discovery — exact algorithm

### Filesystem layout

| Path | Origin | Format | Key we read |
|------|--------|--------|-------------|
| `~/Library/Caches/TemporaryItems/avd/running/pid_<pid>.ini` | Per-emulator, written by `emulator` binary at boot | INI flat (no `[section]` headers) | `grpc.port`, `grpc.token` |
| `~/.emulator_console_auth_token` | Global fallback for legacy console + sometimes gRPC | Single line, raw token | (whole file, trimmed) |

### Algorithm (Go port of `AndroidEmulatorAuth.swift:44-101`)

```go
// device-stream/native-servers/android-grpc/auth/token.go
package auth

import (
    "os"
    "path/filepath"
    "strings"
)

// FindToken returns the gRPC bearer token for the emulator on grpcPort,
// or "" if no token is found (some emulator builds disable auth).
// Lookup order: per-instance pid_*.ini → global ~/.emulator_console_auth_token.
func FindToken(grpcPort int) (string, error) {
    if tok, err := perInstanceToken(grpcPort); err == nil && tok != "" {
        return tok, nil
    }
    return globalToken()
}

func perInstanceToken(grpcPort int) (string, error) {
    home, err := os.UserHomeDir()
    if err != nil { return "", err }
    runningDir := filepath.Join(home, "Library/Caches/TemporaryItems/avd/running")
    entries, err := os.ReadDir(runningDir)
    if err != nil { return "", err }
    target := strconv.Itoa(grpcPort)
    for _, e := range entries {
        if filepath.Ext(e.Name()) != ".ini" { continue }
        data, err := os.ReadFile(filepath.Join(runningDir, e.Name()))
        if err != nil { continue }
        fields := parseSimpleIni(data)
        if fields["grpc.port"] != target { continue }
        if tok := fields["grpc.token"]; tok != "" { return tok, nil }
    }
    return "", nil
}

func globalToken() (string, error) {
    home, err := os.UserHomeDir()
    if err != nil { return "", err }
    raw, err := os.ReadFile(filepath.Join(home, ".emulator_console_auth_token"))
    if err != nil {
        if os.IsNotExist(err) { return "", nil }
        return "", err
    }
    return strings.TrimSpace(string(raw)), nil
}

func parseSimpleIni(data []byte) map[string]string {
    out := make(map[string]string)
    for _, line := range strings.Split(string(data), "\n") {
        line = strings.TrimSpace(line)
        i := strings.IndexByte(line, '=')
        if i < 0 { continue }
        out[strings.TrimSpace(line[:i])] = strings.TrimSpace(line[i+1:])
    }
    return out
}
```

### Linux note (deferred, not in v1)

Linux emulator writes the equivalent file to `~/.android/avd/running/pid_<pid>.ini`. Phase 33 is darwin-only for the primary path (matches sim-capture-private and existing `config.yaml` constraints). Linux support can be added by a single `runtime.GOOS == "linux"` branch in `perInstanceToken`. Document as `// TODO(phase-37+): linux support` but ship as darwin-only.

### Auth attachment in the gRPC client

Translate `AndroidEmulatorAuth.metadata(forGRPCPort:)` → a `metadata.MD{"authorization": "Bearer " + token}` attached via `metadata.NewOutgoingContext(ctx, md)` before every RPC. Cache per-port in a `sync.Map` keyed by port (mirror kittyfarm's `byPort: [Int: GRPCCore.Metadata]` cache at `:23`).

## MMAP frame reader — pure Go

### Why pure Go works

The emulator (Go-side is reader/owner) creates a regular file and tells the emulator via `ImageTransport{handle: "file://<path>"}` to mmap it for writes. We hold the same file mmap'd RW so the kernel page-cache is coherent without explicit fsync.

`golang.org/x/exp/mmap.ReaderAt` is **NOT suitable** — it opens read-only and doesn't expose the underlying byte slice. We need direct `syscall.Mmap` so we can:
1. Pre-allocate to 64 MiB (`Truncate`) before the emulator tries to write.
2. Hold a `[]byte` view of the mapped region for direct copy into the encoder.
3. `Munmap` deterministically on shutdown.

### Capacity sizing

Kittyfarm uses `64 * 1024 * 1024` bytes (`GRPCFrameService.swift:144` `screenshotMaxResponseBytes`). At RGBA8888:
- 1080×1920 = 8.29 MiB per frame — fits ~7 frames.
- 1440×3120 (Pixel 7 Pro) = 17.97 MiB — fits ~3 frames.

64 MiB is conservative. Keep it as the locked constant.

### The borrow problem (kittyfarm risk #2)

The emulator reuses the SAME mmap offset (0) for every frame. If the encoder is still reading frame N when frame N+1 arrives, we get torn pixels (proto comment line 1311: "Note: the mmap can result in tearing").

**Solution (per BRIEF T-33.3):** 2-frame ring buffer in our process. On each gRPC `Image` callback:
1. Compute byte length = `width * height * 4`.
2. `copy` from `mmap.Bytes[:length]` → `ring.next()` (heap buffer).
3. Hand the heap buffer to the encoder via a channel.
4. Encoder consumes; ring rotates.

```go
type Ring struct {
    bufs [2][]byte // pre-allocated to max capacity (64MB) once
    idx  int
}
func (r *Ring) Next(length int) []byte {
    b := r.bufs[r.idx][:length]
    r.idx = (r.idx + 1) % 2
    return b
}
```

This means we do 1 memcpy per frame (~17 MB at 1440p). At 30fps that's ~510 MB/s of memory throughput — well within DDR5 budget on M1+. If profiling shows it's a bottleneck, the optimization is to have the gRPC dispatcher pause frame N+1 until the encoder finishes frame N (apply backpressure via cancelling the stream and re-issuing — out of scope for v1).

### Reading the dimensions

From `Image` message (proto lines 1382-1406):
- `image.format.width` / `image.format.height` are authoritative (newer field locations).
- `image.width` / `image.height` are deprecated mirrors.
- `image.image` is empty when MMAP is active.
- `image.seq` is a monotonic non-contiguous counter (kittyfarm uses it for drop detection — emit as `pts_seq` over IPC).
- `image.timestamp_us` is unix microseconds when the emulator produced the frame.

**Bytes-per-row:** `width * 4` (no stride padding — emulator packs tight per `BitmapFrame(bytesPerRow: width * 4)` in kittyfarm at `:337`).

**Pixel order:** RGBA byte-order, top-down (proto line 1388 says bottom-up for the default; kittyfarm's `BitmapFrame.pixelFormat = .rgba8888` is consumed as top-down by their `CIImage` constructor — verify empirically; if the encoded H.264 ends up flipped, swap row order or use `vImageVerticalReflect`).

### Edge case: empty/inactive display

Proto lines 299-307: when display is inactive the emulator sends `width=0, height=0` Image messages. Kittyfarm errors on this at `GRPCFrameService.swift:319-322` (`missingFrameDimensions`). For Phase 33: ignore zero-dim frames (don't propagate to encoder), keep stream open. Log once at INFO. When non-zero dims resume, the encoder can lazily rebuild its VTCompressionSession.

## H.264 encode — placement and codec choice

### Why encode in the daemon

The emulator streams RGBA. The web dashboard, the Go CLI, and the WS bridge all expect H.264. The encode MUST happen before crossing the Unix socket — otherwise we're shipping 17 MB/frame to Node at 30fps and saturating any reasonable IPC.

Per BRIEF T-33.4: VideoToolbox via cgo on darwin, libx264 via cgo on linux (behind build tag).

### Darwin: VideoToolbox via cgo

The codebase already has a working VideoToolbox H.264 encoder in Objective-C++ at `device-stream/native-servers/sim-capture-private/Sources/H264Encoder.{h,mm}` (Phase 32). Per the locked External Dependencies Policy, we cannot link kittyfarm — but we CAN reuse the device-farm internal sim-capture-private encoder as a reference for VideoToolbox configuration.

**Locked encoder config (mirroring sim-capture-private H264Encoder.h:18-23):**
- `ProfileLevel = kVTProfileLevel_H264_Baseline_AutoLevel`
- `RealTime = YES`
- `AllowFrameReordering = NO`
- `MaxKeyFrameInterval = 30`
- `AverageBitRate = 4_000_000` (config knob; daemon default)
- `ExpectedFrameRate = 30`

**Output framing — IDENTICAL to Phase 32 wire format:**
- Kind `0x01` = SPS+PPS parameter sets (one-shot on first IDR)
- Kind `0x02` = AVCC access unit (every encoded frame)

This means the existing Node-side decoder/forwarder in `device-stream/packages/ios-simulator/` knows the wire format — we mostly copy the parser. Reusing the kind tags from sim-capture-private is part of REF-02.

**Implementation route:** Write the encoder in Objective-C++ (.mm) as a sibling helper to `H264Encoder.mm`, then call it from Go via `cgo`. Cgo overhead is ~200ns/call which is irrelevant at 30fps. Alternatively, port to pure Go via `github.com/pion/mediadevices/pkg/codec/x264` — but x264 is GPL-licensed (LGPL only via dynamic link, complicates publishing); VideoToolbox is the canonical choice on macOS.

### Linux: libx264 cgo behind build tag

```go
//go:build linux && x264
package encode
// import "C" with libx264
```

Build tag `x264` means `go build -tags x264` is required to enable. Default linux build returns an error from `New()` and the Node-side fallback to scrcpy kicks in. This keeps `npm install` simple on linux CI (no libx264 dev headers needed unless explicitly enabled).

### Encoder API surface

```go
type Encoder interface {
    EncodePixelBuffer(rgba []byte, width, height, pts int64, forceIDR bool) error
    ForceIDR()
    Close() error
}
type Callback func(kind uint8, payload []byte)  // kind ∈ {0x01, 0x02}
func New(width, height, fps, bitrate int, cb Callback) (Encoder, error)
```

The callback is invoked on VT's private queue — Go must take care that `cb` doesn't capture goroutine-local state without sync (use a channel internally).

## IPC framing — matches Phase 32

### Wire format (LOCKED, identical to sim-capture-private)

```
[u32 BE length (covers kind + payload)][u8 kind][payload bytes]
```

Reference: `device-stream/native-servers/sim-capture-private/Sources/IpcServer.h:7-22`.

| Direction | Kind | Meaning | Payload |
|-----------|------|---------|---------|
| daemon → Node | 0x01 | SPS+PPS parameter sets | AVCC parameter set blob |
| daemon → Node | 0x02 | H.264 AU | Length-prefixed AVCC access unit |
| daemon → Node | 0x10 | ack | empty |
| daemon → Node | 0xFF | error | utf-8 message |
| Node → daemon | 0xC1 | touch | 29-byte struct (see below) |
| Node → daemon | 0xC9 | quit | empty |

**New for Phase 33 (additive, doesn't collide with sim-capture-private):**

| Direction | Kind | Meaning | Payload |
|-----------|------|---------|---------|
| daemon → Node | 0x03 | metadata | `{width:u32 BE, height:u32 BE, fps:u32 BE}` (12 bytes; one-shot after first frame) |
| Node → daemon | 0xC2 | key event | `{eventType:u8 (0=down,1=up), keyCode:u32 BE, modMask:u32 BE}` (9 bytes) |

The `0x03` metadata frame replaces the JSON `{type:"metadata", width, height, codec}` message that scrcpy-service.ts emits (line 98-103) — Node parses it and forwards as JSON to the dashboard.

### Touch payload (29 bytes, mirrors Phase 32)

```
[f64 BE x_ratio][f64 BE y_ratio][u8 phase][f64 BE pressure][u32 BE touchId]
```

Phase mapping (matches sim-capture-private NormalizedTouch convention):
- 0 = began
- 1 = moved
- 2 = ended
- 3 = cancelled

The Go daemon translates this to `pb.TouchEvent{touches: []*pb.Touch{{X: int32(x_ratio * (w-1)), Y: int32(y_ratio * (h-1)), Identifier: touchId, Pressure: pressureInt, Expiration: pb.Touch_NEVER_EXPIRE}}}`. Pressure: 0 on ended/cancelled, else `max(int32(pressure), 1)`. **Always use `NEVER_EXPIRE`** to avoid the 120s ghost-finger issue.

### Unix socket path convention

Per BRIEF T-33.4: `/tmp/device-stream-android-emu-<serial>.sock`. Mirrors sim-capture-private's `/tmp/sim-capture-private-<udid>.sock` pattern. The daemon unlinks any stale socket on startup, binds, listens, accepts ONE client (Node's spawning process), then runs until the client closes or 0xC9 quit frame.

### Why reuse Phase 32 framing

1. The Node-side framer in `device-stream/packages/ios-simulator/src/sim-capture-private-client.ts` is generic — adapting it to a different socket path takes ~50 LOC.
2. Operators have one mental model for "device-stream daemon" framing.
3. The XCTest IPC framer round-trip tests from Phase 32 can be ported to Go table-tests verbatim.

## Emulator spawn — `-grpc` flag + port allocation

### What `-grpc` does

The emulator binary accepts `-grpc <port>`. When set:
- Binds a gRPC server on `127.0.0.1:<port>`.
- Generates a per-instance auth token, writes it to `~/Library/Caches/TemporaryItems/avd/running/pid_<pid>.ini` keyed `grpc.token`, with `grpc.port=<port>` as the match key.
- Prints a warning if `-grpc-use-jwt` is not also set (from web search: `WARNING | *** No gRPC protection active, consider launching with the -grpc-use-jwt flag.***`). The Bearer token still works without `-grpc-use-jwt` — JWT mode is for Android Studio's stricter validation.

Kittyfarm's launch (`EmulatorManager.swift:73-77`) explicitly does NOT use `-grpc-use-jwt`. We match.

### Integration with `server/pool/android/emulator.ts`

The current spawn at lines 94-106 builds args in this order:
```
['-avd', effectiveAvd, '-no-window', '-no-boot-anim', '-port', String(port)]
+ optional '-no-snapshot-load' (cold boot)
+ optional '-no-audio'
+ '-gpu', gpu
```

**Insertion point:** between `-port` and the optional flags, add:
```typescript
const grpcPort = allocateGrpcPort(...);
args.push('-grpc', String(grpcPort));
```

Currently `port` is the console port (5554-band). Allocate `grpcPort` from a separate band so they don't collide. **Locked port band: 8554-8650** (per BRIEF T-33.5, 49 ports for plenty of headroom).

### Port allocator changes

Current `allocatePort` (lines 20-26) is a simple linear scan from 5554, step 2. For gRPC, add a sibling helper:

```typescript
// server/pool/android/emulator.ts (or extract to server/pool/ports.ts)
function allocateGrpcPort(usedPorts: Set<number>): number {
  let port = 8554;
  while (usedPorts.has(port)) {
    port += 1;
  }
  if (port > 8650) {
    throw new Error('No gRPC port available in band 8554-8650');
  }
  return port;
}
```

Track `grpcPort` alongside `pid` and `port` in the `processes` Map (line 36-37):
```typescript
private processes = new Map<string, { pid: number; port: number; grpcPort?: number; process?: ChildProcess }>();
```

**Zombie-aware:** zombie detector already scans for emulator PIDs by ADB serial — extending it to also reclaim grpcPorts requires reading the `pid_<pid>.ini` for any leftover .ini files and adding `grpc.port` to the exclusion set. **Defer** to a follow-up plan; for v1 just trust that a fresh emulator boot picks a free port.

### Device entity changes

Per BRIEF T-33.5, the Device entity gains `grpcPort: number | null`. Locations:
- `server/types/index.ts` — add `grpcPort?: number | null` to the Device interface
- `server/db/schema.ts` — add `grpc_port INTEGER` column (drizzle migration)
- `server/pool/...` — populate when AVD boots

The Node-side adapter reads `device.grpcPort` to know which port to point the daemon at.

### Readiness probe

After spawn, before considering the device "Idle", probe `EmulatorController.getStatus(Empty)`:
- Success → device is gRPC-ready.
- `Unavailable` → emulator not done binding; retry up to 20s (kittyfarm window).
- `Unauthenticated` → token missing or wrong; surface clear "auth missing — set `~/.emulator_console_auth_token` or wait for pid_*.ini" error and fall back to scrcpy path for this boot.

This probe is critical for AND-GRPC-02 (graceful fallback). Recommend running it from the Go daemon during `--probe <serial> <grpcPort>` invocation, called from the Node adapter before declaring readiness.

## TS service swap — consumer changes

### Current state

`device-stream/packages/android/src/`:
- `device-service.ts` — top-level `AndroidDeviceService extends BaseDeviceService` (455 lines). Implements `listDevices`, `connect`, `tap`, `typeText`, `pressKey`, `screenshot`, `startMirroring`, etc. via ADB shell-out.
- `scrcpy-service.ts` — `ScrcpyService` (235 lines). Manages per-serial scrcpy sessions, pipes `ScrcpyMediaStreamPacket` frames to WebSocket.
- `scrcpy-setup.ts` — server-jar deployment.
- `log-stream.ts` — logcat tail.
- `index.ts` — barrel.

### New file: `grpc-emu-client.ts` (~180 LOC, NEW)

Mirror `device-stream/packages/ios-simulator/src/sim-capture-private-client.ts` (Phase 32). Responsibilities:
- `spawn(serial: string, grpcPort: number, ws: WebSocket): Promise<GrpcEmuClient>` — spawns `device-stream/bin/android-grpc-stream --serial <s> --port <p>` daemon, hooks up framed-byte parser.
- Parses inbound frames: `0x01` (params) → cache + send to WS; `0x02` (AU) → forward to WS as base64; `0x03` (metadata) → JSON-stringify metadata for dashboard.
- Sends outbound frames: `0xC1` (touch), `0xC2` (key), `0xC9` (quit on stop).
- Spawn failure or daemon-binary-missing → throw `GrpcEmuSpawnError`, caught by service.ts and fallback to scrcpy.

### Modified `service.ts` (selection rule per BRIEF T-33.6)

```typescript
// device-stream/packages/android/src/service.ts (modify)
export class AndroidStreamingService {
  async start(device: AndroidDevice, ws: WebSocket): Promise<void> {
    const useGrpc =
      device.kind === 'emulator' &&
      device.grpcPort != null &&
      process.env.DEVICE_STREAM_ANDROID_GRPC !== '0';
    if (useGrpc) {
      try {
        const client = await GrpcEmuClient.spawn(device.serial, device.grpcPort, ws);
        this.sessions.set(device.serial, { kind: 'grpc', client });
        return;
      } catch (e) {
        log.warn({ err: e, serial: device.serial }, 'gRPC path failed, falling back to scrcpy');
      }
    }
    await scrcpyService.startStream(adb, device.serial, ws);
    this.sessions.set(device.serial, { kind: 'scrcpy' });
  }
}
```

**Note:** Current `scrcpy-service.ts` is a top-level singleton. To match the Phase 22 streaming module pattern (subscribed to job-bus events), the service swap may pull in a small refactor — but per CONTEXT.md "keep API contract identical for consumers" the public interface (`startStream`, `stopStream`, `tap`, etc.) doesn't change.

### Tap/key control routing

`device-service.ts:tap(serial, x, y)` currently shells `input tap`. For emulators with gRPC active, route through the daemon:

```typescript
async tap(serial: string, x: number, y: number): Promise<void> {
  const session = this.sessions.get(serial);
  if (session?.kind === 'grpc') {
    return session.client.sendTouchAtPixel(x, y);  // normalizes + 0xC1 frame
  }
  // Existing ADB path
}
```

Same for `pressKey`. `typeText` stays on ADB (slow-but-fine; no gRPC `sendText` in our proto subset).

## Test strategy

### Unit tests (Go, no emulator)

| Target | What | File |
|--------|------|------|
| `auth.parseSimpleIni` | Trim, ignore empty/comment lines, handle multiple `=` per line | `auth/ini_test.go` |
| `auth.FindToken` — per-instance hit | tmpdir + fake `~/Library/Caches/...pid_X.ini`; assert correct grpc.token returned | `auth/token_test.go` |
| `auth.FindToken` — port mismatch falls through | Two .ini files; only second matches grpcPort; assert second's token | `auth/token_test.go` |
| `auth.FindToken` — global fallback | No .ini files; `~/.emulator_console_auth_token` present; assert trimmed read | `auth/token_test.go` |
| `auth.FindToken` — no auth | No files anywhere; assert "" + no error | `auth/token_test.go` |
| `mmap.New + Close` | Create 64MB region, write 4 bytes, read back, Close → file gone | `mmap/mmap_test.go` |
| `client.shouldRetryStartup` | Table-test for each grpc code | `client/client_test.go` |
| `client.Ring.Next` | Two distinct buffers, rotate on call | `client/ring_test.go` |
| `ipc.framer.encode/decode` | Round-trip every kind; truncated buffer returns false; oversized payload errors | `ipc/framer_test.go` |
| `ipc.framer touch payload` | 29-byte decode round-trip with float-bit-exact x_ratio/y_ratio | `ipc/framer_test.go` |
| `client.StreamFrames` with mock gRPC | bufconn-based fake gRPC server returns 5 Image messages with empty .image + mmap pre-filled; assert callback fires 5 times with correct dims | `client/client_test.go` |

**Mock gRPC pattern:** Use `google.golang.org/grpc/test/bufconn` to spin up an in-process gRPC server that implements `EmulatorControllerServer`. Pre-fill the mmap region with test RGBA bytes, send Image messages, assert the client decodes correctly.

### Integration tests (real emulator)

| Test | Procedure | Acceptance |
|------|-----------|------------|
| `smoke-android-grpc.sh <avd>` | Boot emulator with `-grpc <port>`; run `android-grpc-stream --probe <serial> <port>`; capture 30 frames over Unix socket via `nc -U` + python length-prefix decoder | First IDR within 1s; 30 frames captured in <2s; clean teardown |
| `android-grpc-visual.sh <avd>` | Compare gRPC-path captured frame to scrcpy-path captured frame of identical app state (Maestro nav to known screen) | SSIM ≥ 0.99 |
| `android-grpc-touch.sh <avd>` | Run Maestro flow that taps a button measuring on-screen latency (timestamp-on-tap label) | Median round-trip < 80ms |

Mirror the pattern of `device-stream/scripts/smoke-sim-private.sh` (Phase 32, real implementation at 32-05-SUMMARY).

### 30-min soak

```bash
# device-stream/scripts/android-grpc-soak.sh <avd> [--duration 30m]
# Spawn daemon, capture frames continuously, sample RSS every 30s.
# Fail if RSS grows >50MB total or per-30s delta >1MB sustained 3 samples.
```

Mirror `device-stream/scripts/sim-soak.sh`. The 50MB ceiling is generous — our mmap region is 64MB but allocated once at start; any growth beyond ~10MB indicates a leak (per-frame copy retention, gRPC stream message buildup, etc.).

### CI matrix

Add `.github/workflows/android-grpc-matrix.yml`:
- Matrix: `emulator-image: [API 34, API 35]` (skip API 36.1 per project CLAUDE.md — known macOS Tahoe mprotect/hvf crash).
- Daily 09:00 UTC + manual dispatch.
- Steps: build Go binary → boot emulator (use `reactivecircus/android-emulator-runner@v2` on a self-hosted macOS runner) → run smoke + visual-diff + 5min soak.

### Cross-pin to existing Vitest suite

`device-stream/packages/android/tests/grpc-emu-client.spec.ts` (NEW, ~120 LOC):
- `DEVICE_STREAM_ANDROID_GRPC=0` → service returns scrcpy session immediately (no daemon spawn).
- Daemon spawn rejects (binary missing) → service falls back, no exception bubbles.
- Outbound 0xC1 touch frame produces correct 29-byte payload (Buffer equality).
- Inbound 0x02 AU frame is forwarded to `ws.send` as base64 JSON envelope.

Reuse the framer fixture pattern from `device-stream/packages/ios-simulator/tests/sim-capture-private-client.spec.ts`.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Native helper framework | **Go testing** (`go test ./...`) |
| Go module | `device-stream/native-servers/android-grpc/go.mod` (Go 1.26.1, matching CLI) |
| Quick run (native) | `cd device-stream/native-servers/android-grpc && go test -short ./...` |
| TS framework | **Vitest** (already used by `device-stream/packages/android/tests/`) |
| Quick run (TS) | `npm test --workspace @device-stream/android -- grpc-emu-client` |
| Full suite | `npm run test` (root) — runs all workspaces; native Go runs separately in CI |
| Integration smoke | `scripts/smoke-android-grpc.sh <avd>` (new) — boots emulator with `-grpc`, runs daemon, captures 30 frames, asserts |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| AND-GRPC-01 | Frames via gRPC+MMAP; scrcpy-server.jar not touched | smoke + grep | `scripts/smoke-android-grpc.sh <avd> && ! lsof -p $(pgrep emulator) \| grep scrcpy-server.jar` | ❌ Wave 0 |
| AND-GRPC-01 | gRPC client decodes RGBA8888 from mmap | unit (Go) | `go test ./client/... -run TestStreamFramesMMAP` | ❌ Wave 0 |
| AND-GRPC-02 | `DEVICE_STREAM_ANDROID_GRPC=0` falls back to scrcpy | unit (Vitest) | `vitest run grpc-emu-client.spec.ts -t "fallback when env=0"` | ❌ Wave 0 |
| AND-GRPC-02 | Daemon spawn failure falls back to scrcpy | unit (Vitest) | `vitest run grpc-emu-client.spec.ts -t "fallback when spawn fails"` | ❌ Wave 0 |
| AND-GRPC-02 | Auth failure surfaces clear error + triggers fallback | unit (Go) + integration | `go test ./client/... -run TestProbeAuthMissing` + smoke override | ❌ Wave 0 |
| AND-GRPC-03 | Touch latency < 80ms | integration + perf | `scripts/android-grpc-touch.sh <avd>` (Maestro flow + timestamp diff) | ❌ Wave 0 |
| AND-GRPC-03 | sendTouch payload structurally correct | unit (Go) | `go test ./client/... -run TestSendTouchPayload` | ❌ Wave 0 |
| AND-GRPC-04 | Frame latency reduces -30% vs scrcpy | integration (matrix CI) | `scripts/android-grpc-visual.sh <avd>` records per-frame Δt vs baseline | ❌ Wave 0 |
| AND-GRPC-05 | CPU < scrcpy baseline | manual perf | `top -pid $(pgrep android-grpc-stream)` sampled during 60s flow vs scrcpy | manual (runbook) |
| AND-GRPC-06 | 30-min soak — stable RSS | weekend cron CI | `scripts/android-grpc-soak.sh <avd> --duration 30m` with `ps -o rss=` | ❌ Wave 0 |
| AND-GRPC-REF-01 | No kittyfarm linkage | grep gate | `! grep -r "kittyfarm" device-stream/native-servers/android-grpc/` | covered by build (existing fs) |
| AND-GRPC-REF-02 | IPC framer wire-compat with sim-capture-private | unit (Go + Vitest) | `go test ./ipc/... -run TestFramerRoundTrip` + `vitest run sim-capture-private-client.spec.ts -t "framer"` adapted | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** Go quick run (`go test -short ./...`) + TS workspace run (under 30s combined)
- **Per wave merge:** full Go suite (`go test ./...`) + full Vitest workspace + smoke probe on local emulator
- **Phase gate:** matrix CI green + 30-min soak before `/gsd:verify-work`

### Wave 0 Gaps

All test infrastructure is new for this phase. Add in Wave 0 (before any non-substrate code):

- [ ] `device-stream/native-servers/android-grpc/go.mod` — module declaration
- [ ] `device-stream/native-servers/android-grpc/Makefile` — proto, build, test targets
- [ ] `device-stream/native-servers/android-grpc/auth/token_test.go` — covers auth path (AND-GRPC-02)
- [ ] `device-stream/native-servers/android-grpc/auth/ini_test.go` — INI parser units
- [ ] `device-stream/native-servers/android-grpc/mmap/mmap_test.go` — mmap RW + Close
- [ ] `device-stream/native-servers/android-grpc/client/client_test.go` — bufconn gRPC mock (AND-GRPC-01, -03)
- [ ] `device-stream/native-servers/android-grpc/client/ring_test.go` — 2-frame ring
- [ ] `device-stream/native-servers/android-grpc/ipc/framer_test.go` — wire-format round-trip (AND-GRPC-REF-02)
- [ ] `device-stream/packages/android/tests/grpc-emu-client.spec.ts` — fallback paths (AND-GRPC-02)
- [ ] `device-stream/scripts/smoke-android-grpc.sh` — integration smoke
- [ ] `device-stream/scripts/android-grpc-visual.sh` — visual-diff vs scrcpy baseline
- [ ] `device-stream/scripts/android-grpc-touch.sh` — touch latency harness
- [ ] `device-stream/scripts/android-grpc-soak.sh` — soak wrapper
- [ ] `device-stream/scripts/build-android-grpc.sh` — Go build + stage at `device-stream/bin/android-grpc-stream`
- [ ] `.github/workflows/android-grpc-matrix.yml` — daily matrix (API 34, API 35)
- [ ] Postinstall extension in `device-stream/scripts/postinstall.js` — call `build-android-grpc.sh` on darwin/arm64 (alongside existing sim-capture-private build)

## Common Pitfalls

### Pitfall 1: MMAP region not pre-truncated

**Symptom:** Emulator gRPC stream errors with `FAILED_PRECONDITION` ("shared memory region too small"; proto comment line 291).
**Cause:** Mmap was created at zero size, emulator can't write enough.
**Fix:** `f.Truncate(64 * 1024 * 1024)` BEFORE `syscall.Mmap`. Order matters.

### Pitfall 2: file:// URL handle wrong

**Symptom:** Emulator silently falls back to inline bytes (image.image populated, mmap region untouched).
**Cause:** Handle missing `file://` scheme, or pointing to relative path.
**Fix:** Always `"file://" + absPath`. The handle must be absolute. Verify by checking `image.image` length after first frame — should be 0 when MMAP is honored. If non-zero, log warning and proceed with inline path.

### Pitfall 3: Auth token cached forever

**Symptom:** Emulator restart → new token → daemon keeps sending old Bearer → `UNAUTHENTICATED`.
**Cause:** Per-port cache in `AndroidEmulatorAuth.Cache` (Swift) survives daemon lifetime.
**Fix:** Either re-resolve on every `UNAUTHENTICATED`, or scope the cache to a daemon process (which dies + restarts with the emulator). Recommend: daemon is per-emulator; both die together; no cache invalidation needed. Test by killing emulator + restarting and ensuring daemon re-discovers token.

### Pitfall 4: Touch expiration default ghost-fingers

**Symptom:** After 120s of no touch, app receives a phantom "pressure=0" event for the last-used touch identifier.
**Cause:** `Touch.expiration = EVENT_EXPIRATION_UNSPECIFIED` (the default 0) auto-expires after 120s (proto lines 960-965).
**Fix:** ALWAYS set `expiration = NEVER_EXPIRE` and emit explicit pressure=0 when touch ends.

### Pitfall 5: Display orientation flip

**Symptom:** H.264 output is upside-down.
**Cause:** Proto line 1388-1391 says "left to right and bottom up" by default, but kittyfarm's `BitmapFrame` consumes it as top-down without explicit flip — observed behavior on Pixel/Pixel Pro AVDs may differ from emulator implementation.
**Fix:** First-frame smoke test: capture frame 0, decode, render to test PNG, eyeball orientation. If flipped, apply `vImageVerticalReflect` in the encoder pre-step (cheap on M1 GPU).

### Pitfall 6: Linux gRPC port detection different path

**Symptom:** On linux, FindToken returns "" → token-less gRPC fails on JWT-required emulators.
**Cause:** Linux emulator writes `~/.android/avd/running/pid_*.ini` (NOT `~/Library/Caches/...`).
**Fix:** Phase 33 is darwin-primary; linux v1 returns "" auth path which works on older emulators with auth disabled. Document as `// TODO(phase-37+) linux path` in `auth/token.go`.

### Pitfall 7: `-no-window` + GUI emulator on same AVD

**Symptom:** Boot fails with "AVD is currently running. If you are sure it isn't running, please delete the lock files."
**Cause:** User has Android Studio open running the same AVD.
**Fix:** Existing `emulator.ts:clearAvdLocks` (lines 235-248) handles stale lock files but NOT concurrent users. Pool's zombie-detector handles process collisions. The Pool's blacklist mechanism already covers this — no Phase 33 change needed.

### Pitfall 8: gRPC stream cancellation race

**Symptom:** Daemon shutdown hangs for ~5s after `quit` IPC frame.
**Cause:** Cancelling the gRPC context doesn't always immediately unblock `stream.Recv()` — Go gRPC waits for the next message or transport close.
**Fix:** Explicit `conn.Close()` after `cancel()` (out-of-order shutdown). Use a `context.WithTimeout(ctx, 1*time.Second)` for graceful drain, then force.

### Pitfall 9: SIGPIPE on Unix socket write after Node disconnects

**Symptom:** Daemon dies silently after WS dashboard disconnects.
**Cause:** Writing to a closed Unix socket raises SIGPIPE; Go process default is to terminate.
**Fix:** Same pattern as Phase 32 (`signal(SIGPIPE, SIG_IGN)` in `main.mm` per sim-capture-private/Sources/IpcServer.h:23). In Go: `signal.Ignore(syscall.SIGPIPE)` in `main.go` before any socket op.

### Pitfall 10: API 36.1 known-bad on macOS Tahoe

**Symptom:** Emulator boot crashes with mprotect/hvf error.
**Cause:** Documented in project `CLAUDE.md` — API 36.1 has mprotect/hvf incompatibility on macOS 26.3.
**Fix:** Don't test on API 36.1. CI matrix locked to API 34 + API 35 (Google APIs Play Store). Config.yaml already pins `api_level: "35"`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| gRPC client codegen | Hand-roll JSON-RPC over HTTP/2 | `protoc-gen-go-grpc` | Stream lifecycle, metadata, status codes are non-trivial; codegen is canonical |
| Proto wire format | Hand-marshal messages | `google.golang.org/protobuf/proto` | Field numbering, varint, wire compat |
| H.264 encode on darwin | Custom VTCompressionSession Swift wrapper | Reuse `device-stream/native-servers/sim-capture-private/Sources/H264Encoder.mm` shape (don't copy code, mirror config) | Already battle-tested for Phase 32; same operator mental model |
| Unix socket framer | New framing scheme | `device-stream/native-servers/sim-capture-private/Sources/IpcServer.h` layout (length-prefixed [u32 BE][u8 kind][payload]) | Phase 32 already validated; Node-side parser is reusable |
| Mmap on darwin | Write own mmap wrapper | `syscall.Mmap` directly (golang stdlib) | Stdlib is canonical; third-party `edsrzf/mmap-go` adds zero value here |
| INI parsing | Pull in `gopkg.in/ini.v1` | 20-line hand parser | Kittyfarm's Swift impl is 13 lines; INI format is trivial for this use case |
| Auth token discovery | Skip token, run unauth | Port `AndroidEmulatorAuth.swift` 1:1 | Newer emulators reject unauth gRPC with cryptic errors; correct token handling is the right default |

**Key insight:** Phase 33 is a port of well-validated kittyfarm Swift code. The novelty is the language switch (Swift → Go) and the cgo bridge for VideoToolbox. Everything else has a known-good reference. The disciplined approach is to be a faithful porter, not a creative redesigner.

## Architecture Patterns

### Recommended Project Structure

```
device-stream/native-servers/android-grpc/
├── go.mod
├── Makefile
├── proto/                              # T-33.1
│   ├── emulator_controller.proto       # subset, ~120 lines
│   └── gen/emulatorcontrol/            # generated, in-tree
├── auth/                               # T-33.2
│   ├── token.go
│   ├── ini.go
│   └── *_test.go
├── mmap/                               # T-33.3 (part of MMAP reader)
│   ├── mmap_unix.go                    # //go:build darwin || linux
│   └── mmap_test.go
├── client/                             # T-33.3 + T-33.7
│   ├── client.go                       # Dial, StreamFrames, SendTouch, SendKey, GetStatus
│   ├── ring.go                         # 2-frame copy-on-borrow
│   └── *_test.go
├── encode/                             # T-33.4
│   ├── encoder.go                      # interface + factory
│   ├── encoder_darwin.go               # //go:build darwin
│   ├── encoder_darwin_videotoolbox.mm  # cgo bridge
│   ├── encoder_linux.go                # //go:build linux && x264
│   └── encoder_fallback.go             # other platforms
├── ipc/                                # T-33.4 (IPC server side)
│   ├── framer.go                       # encode/decode wire format
│   ├── server.go                       # Unix socket bind/accept-one
│   └── *_test.go
└── cmd/android-grpc-stream/main.go     # daemon entry; coordinates client + encode + ipc
```

### Pattern 1: Pluggable encoder via build tags

**What:** Encoder concrete impl selected at compile time by `//go:build` tag.
**When to use:** Cross-platform native daemons where one platform has a clearly-better library.
**Example:**
```go
// encode/encoder_darwin.go
//go:build darwin

package encode
// #cgo CFLAGS: -x objective-c++ -fobjc-arc -framework VideoToolbox -framework CoreMedia
// #include "encoder_darwin_videotoolbox.h"
import "C"

type vtEncoder struct { ... }
func newEncoder(w, h, fps, br int, cb Callback) (Encoder, error) { return &vtEncoder{...}, nil }
```
Mirrors how sim-capture-private has darwin-only code without polluting cross-platform builds.

### Pattern 2: Spawn-and-fallback service selection

**What:** Try the preferred path, catch failure, fall back to scrcpy. Critical: fallback failure must be visible (log.warn), not silent.
**When to use:** Feature flag rollouts where a new transport might fail on real-world configs.
**Example:** see "TS Service Swap" section above.

### Anti-Patterns to Avoid

- **Pulling proto from a Go module:** Don't add `google.golang.org/genproto/...` or `go.fuchsia.dev/fuchsia/tools/femu-control/...` as a dependency. Vendor the .proto, codegen in-tree. Their proto versions drift; we want a locked subset.
- **Ad-hoc mmap path conventions:** Always use `os.CreateTemp` for the mmap file — never a hard-coded `/tmp/emu-grpc-<port>.bin` per BRIEF T-33.3 example. Two emulators on the same host with the same port (unlikely but possible with pool reset) would clash.
- **Shelling out for mmap:** Don't `dd if=/dev/zero ...` then mmap externally. The kittyfarm pattern (open + truncate + mmap in one helper) is the right call.
- **Mixing JSON and binary on the same Unix socket:** Phase 32 framing is fully binary. Don't sprinkle JSON frames for "convenience" metadata — use kind `0x03` with a packed binary metadata payload, parse on Node.

## Code Examples

### Verified pattern: bufconn mock gRPC server (for client tests)

```go
// client/client_test.go
package client

import (
    "context"
    "net"
    "testing"
    "google.golang.org/grpc"
    "google.golang.org/grpc/credentials/insecure"
    "google.golang.org/grpc/test/bufconn"
    pb "github.com/device-farm/device-stream/native-servers/android-grpc/proto/gen/emulatorcontrol"
)

type fakeServer struct {
    pb.UnimplementedEmulatorControllerServer
    images []*pb.Image
}
func (f *fakeServer) StreamScreenshot(req *pb.ImageFormat, stream pb.EmulatorController_StreamScreenshotServer) error {
    for _, img := range f.images {
        if err := stream.Send(img); err != nil { return err }
    }
    return nil
}

func TestStreamFramesMMAP(t *testing.T) {
    lis := bufconn.Listen(1024 * 1024)
    srv := grpc.NewServer()
    pb.RegisterEmulatorControllerServer(srv, &fakeServer{images: []*pb.Image{
        {Format: &pb.ImageFormat{Format: pb.ImageFormat_RGBA8888, Width: 2, Height: 1}, Seq: 0, TimestampUs: 1000},
    }})
    go srv.Serve(lis)
    defer srv.Stop()

    conn, _ := grpc.DialContext(context.Background(), "bufnet",
        grpc.WithContextDialer(func(_ context.Context, _ string) (net.Conn, error) { return lis.Dial() }),
        grpc.WithTransportCredentials(insecure.NewCredentials()),
    )
    defer conn.Close()
    // ... wire client to mmap pre-filled with [0xFF,0,0,0xFF, 0,0xFF,0,0xFF] (2 RGBA pixels)
    // ... assert callback fires once with width=2, height=1
}
```

Source: combined from `google.golang.org/grpc/test/bufconn` package idiom + project test conventions.

### Verified pattern: cgo VideoToolbox bridge skeleton

```objc
// encode/encoder_darwin_videotoolbox.mm  (compiled via cgo)
#include "encoder_darwin_videotoolbox.h"
#import <VideoToolbox/VideoToolbox.h>

// Public C entry called from Go
EncoderHandle ds_encoder_new(int width, int height, int fps, int bitrate, GoEncoderCallback cb) {
    VTCompressionSessionRef session;
    VTCompressionSessionCreate(NULL, width, height, kCMVideoCodecType_H264,
        NULL, NULL, NULL, outputCallback, (void*)cb, &session);
    VTSessionSetProperty(session, kVTCompressionPropertyKey_ProfileLevel,
        kVTProfileLevel_H264_Baseline_AutoLevel);
    VTSessionSetProperty(session, kVTCompressionPropertyKey_RealTime, kCFBooleanTrue);
    VTSessionSetProperty(session, kVTCompressionPropertyKey_AllowFrameReordering, kCFBooleanFalse);
    // ... set MaxKeyFrameInterval, AverageBitRate, ExpectedFrameRate
    return (EncoderHandle)session;
}
```

Mirrors `device-stream/native-servers/sim-capture-private/Sources/H264Encoder.mm` config.

### Verified pattern: spawn daemon from Node + parse framer

Adapt from `device-stream/packages/ios-simulator/src/sim-capture-private-client.ts` (Phase 32) which already implements the exact framer. The new file `grpc-emu-client.ts` differs in:
- Socket path: `/tmp/device-stream-android-emu-<serial>.sock` (vs `/tmp/sim-capture-private-<udid>.sock`)
- Binary name: `device-stream/bin/android-grpc-stream`
- Spawn args: `--serial <s> --grpc-port <p>` (no `--udid`)
- Extra kind `0x03` (metadata) and `0xC2` (key)

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| scrcpy-server.jar deployed on emulator + TangoADB H.264 read | Emulator built-in gRPC `EmulatorController.streamScreenshot` + MMAP | This phase | Removes Java agent dep, frees client-side decode CPU, eliminates per-boot .jar push |
| ADB `input tap X Y` shell-out for touch | gRPC `EmulatorController.sendTouch` direct | This phase | <80ms latency vs 200-400ms shell round-trip; supports multitouch via Touch.identifier |
| `~/.emulator_console_auth_token` (legacy global) | Per-instance `pid_<pid>.ini` (per-emulator, since `emulator` ~31.x) | Phase 33 adopts | Multiple emulators on same host get distinct tokens; safer when concurrent users |
| Inline image bytes over gRPC | MMAP file:// side-channel | Available since emulator ~30.x | Zero-copy; reduces gRPC overhead by ~95% for 1080p RGBA |

**Deprecated/outdated:**
- gRPC v1.40 and older `grpc.Dial(...)` synchronous form: prefer `grpc.NewClient(...)` (gRPC-Go 1.64+). Phase 33 should use the new form.
- Image.width / Image.height (deprecated mirrors): read `image.format.width/height` instead.

## Open Questions

1. **Does the emulator's MMAP transport work with RGBA8888 on every supported AVD?**
   - What we know: Kittyfarm gates MMAP behind `KITTYFARM_ANDROID_MMAP=1` env (`GRPCFrameService.swift:145-146`) — it's NOT default-on. Why? The brief implies tearing risk but kittyfarm's fallback code path (lines 220-243) silently falls back to inline mode when MMAP fails to start.
   - What's unclear: Whether MMAP fails for any specific emulator versions / image types in practice.
   - Recommendation: Default MMAP=on for Phase 33 but keep the inline-bytes fallback intact in `client.handleImage()`. Log a warning when MMAP appears unsupported (image.image non-empty when MMAP requested). Wave 0 smoke must verify both paths.

2. **Touch coordinate origin — does the emulator have a separate "rotated" coordinate space?**
   - What we know: Kittyfarm uses raw `(x, y)` in pixel coords with `Touch.orientation = 0`. The emulator handles rotation internally per proto comment line 1346-1348.
   - What's unclear: Whether a tap at `(width-1, 0)` lands top-right in portrait OR top-right of the unrotated buffer.
   - Recommendation: Smoke-test by tapping a known corner UI element in both portrait and landscape AVD configs in Wave 0. If the orientation mapping differs, add a rotation field to the Device entity and pre-rotate.

3. **VideoToolbox vs reusing sim-capture-private's encoder via in-process linking**
   - What we know: sim-capture-private already ships a VT-based encoder (`H264Encoder.mm`). Per External Dependencies Policy, sibling helpers (other native-servers) are OK to study.
   - What's unclear: Whether we should physically link the encoder ObjC++ from sim-capture-private (compile from sibling directory) OR duplicate the ~250 LOC.
   - Recommendation: **Duplicate.** Keep `android-grpc` self-contained. The encoder code is ~250 LOC of mostly mechanical VTSessionSetProperty calls. Slight duplication beats coupling two daemons. Verify both encoders stay byte-on-the-wire identical via shared IPC framer tests.

4. **Should `cli/cmd/doctor.go` learn to check the android-grpc binary?**
   - What we know: `cli/cmd/doctor.go` already checks java/adb/emulator/avdmanager/maestro/server (per project memory).
   - What's unclear: Whether `device-farm doctor` should also verify `device-stream/bin/android-grpc-stream` exists and `--probe`s clean.
   - Recommendation: Defer to a follow-up plan (DEFERRED-33-A); core daemon must ship first. The fallback to scrcpy means doctor isn't a gate.

5. **Bitrate adaptation hooks**
   - What we know: `scrcpy-service.ts:194-218` has Phase A stubs for `setBitrate`, `setFps`, `setScale`, `forceIdr`.
   - What's unclear: Whether gRPC path needs matching stubs to maintain parity with the scrcpy fallback.
   - Recommendation: Yes — add no-op stubs in `grpc-emu-client.ts` returning Promise<void> with a TODO. The web dashboard's tuning UI will call them and shouldn't 404. Real implementation deferred.

## Sources

### Primary (HIGH confidence)

- **kittyfarm reference port (READ-ONLY):**
  - `/Users/heicg/Desktop/projects/_reference/kittyfarm/KittyFarm/Capture/GRPCFrameService.swift:1-482` — full gRPC streaming pipeline, MMAP transport, retry gate, frame decode dispatch
  - `/Users/heicg/Desktop/projects/_reference/kittyfarm/KittyFarm/Capture/AndroidEmulatorAuth.swift:1-103` — auth token discovery, .ini parsing, fallback
  - `/Users/heicg/Desktop/projects/_reference/kittyfarm/KittyFarm/Input/GRPCTouchInjector.swift:1-120` — touch + key injection over gRPC, modifier sequencing
  - `/Users/heicg/Desktop/projects/_reference/kittyfarm/KittyFarm/Lifecycle/EmulatorManager.swift:43-145` — emulator spawn with `-grpc`, multi-host readiness probe
  - `/Users/heicg/Desktop/projects/_reference/kittyfarm/Protos/emulator_controller_kittyfarm.proto:1-93` — subset proto to mirror
  - `/Users/heicg/Desktop/projects/_reference/kittyfarm/Protos/emulator_controller.proto` (77 KB upstream) — full proto for reference; lines 280-323 (streamScreenshot semantics), 915-1005 (Touch/TouchEvent), 1078-1163 (KeyboardEvent), 1295-1313 (ImageTransport), 1328-1406 (ImageFormat + Image), 1462-1491 (EmulatorStatus)

- **Existing local code (READ + EXTEND):**
  - `device-stream/native-servers/sim-capture-private/Sources/IpcServer.h:1-103` — IPC framing reference (Phase 32 wire format)
  - `device-stream/native-servers/sim-capture-private/Sources/H264Encoder.h:1-65` — VideoToolbox config locked constants
  - `device-stream/packages/android/src/scrcpy-service.ts:1-235` — current scrcpy path (kept as fallback)
  - `device-stream/packages/android/src/device-service.ts:98-141` — tap/typeText/pressKey current ADB shell-out path
  - `server/pool/android/emulator.ts:91-130` — emulator spawn site (needs `-grpc` flag injection at line 94-106)
  - `server/pool/android/emulator.ts:20-26` — current `allocatePort` (extend with `allocateGrpcPort` for band 8554-8650)
  - `cli/Makefile:21-40` — Go codegen pattern (mirror for proto codegen)
  - `cli/go.mod` — Go 1.26.1 baseline
  - `.planning/phases/32-simulatorkit-bridge/32-RESEARCH.md` — Phase 32 research, IPC framing precedent

- **Phase brief + context (READ-ONLY, LOCKED):**
  - `.planning/phases/33-android-grpc/33-BRIEF.md:1-191` — phase spec
  - `.planning/phases/33-android-grpc/33-CONTEXT.md:1-96` — locked decisions

### Secondary (MEDIUM confidence)

- [Android Emulator gRPC docs (Fuchsia mirror) — go.fuchsia.dev/fuchsia/tools/femu-control/femu-grpc/proto](https://pkg.go.dev/go.fuchsia.dev/fuchsia/tools/femu-control/femu-grpc/proto) — confirms ImageTransport+MMAP fields, "mmap can result in tearing" warning, file:// handle scheme
- [Android Emulator release notes (Android Studio)](https://developer.android.com/studio/releases/emulator) — confirms `-grpc <port>` flag stability and bearer auth model
- [protoc-gen-go-grpc package docs](https://pkg.go.dev/google.golang.org/grpc/cmd/protoc-gen-go-grpc) — canonical codegen plugin
- [Go gRPC quickstart](https://grpc.io/docs/languages/go/quickstart/) — installation + protoc usage
- [golang.org/x/exp/mmap package](https://pkg.go.dev/golang.org/x/exp/mmap) — confirms read-only nature; rejects this for our RW use case
- [AOSP emulator_controller.proto (canonical)](https://android.googlesource.com/platform/prebuilts/android-emulator/+/master/linux-x86_64/lib/emulator_controller.proto) — upstream source for SPDX traceability

### Tertiary (LOW confidence)

- [Java Samples emulator -grpc-use-jwt warning](https://www.java-samples.com/showtutorial.php?tutorialid=1853) — confirms warning text but doesn't formally document; reads as user forum quote
- [Issuetracker 300157670 — running .ini caches path on CI](https://issuetracker.google.com/issues/300157670) — corroborates `~/Library/Caches/TemporaryItems/avd/running/pid_*.ini` path but in a CI-bug context, not formal docs
- [GitHub gist by mrk-han on experimental gRPC](https://gist.github.com/mrk-han/fa5c6e8951919b7efc1ba99fcd10496e) — community write-up, useful as a sanity check but no upstream guarantee

## Metadata

**Confidence breakdown:**

- **Reference walkthrough:** HIGH — kittyfarm Swift source is complete, comprehensive, recently updated (matches current emulator API). Direct line-by-line port is mechanical.
- **Proto subset:** HIGH — kittyfarm's 93-line subset is already trimmed to the right surface; add only `getStatus` for probe.
- **Auth discovery:** HIGH — algorithm is fully spelled out in `AndroidEmulatorAuth.swift:44-101`; cross-corroborated by community gist + issuetracker confirming filesystem layout.
- **MMAP reader:** HIGH for darwin (kittyfarm pattern + stdlib syscall.Mmap); MEDIUM for tearing risk in practice (proto comment is the only authoritative source).
- **H.264 encode:** HIGH for darwin (sim-capture-private already validated); LOW for linux (libx264 cgo is mechanical but untested in this project).
- **IPC framing:** HIGH — verbatim Phase 32 wire format with two additive kinds.
- **Emulator spawn:** HIGH — `-grpc <port>` is a stable flag; kittyfarm uses it without flags.
- **TS service swap:** HIGH — pattern mirrors Phase 32's sim-capture-private-client adapter exactly.
- **Test strategy:** MEDIUM — depends on availability of a self-hosted macOS CI runner for matrix tests. Local manual smoke is HIGH; CI gating is MEDIUM.
- **Pitfalls:** HIGH for items 1-5, 7-9 (cite specific kittyfarm lines or upstream proto comments); MEDIUM for 6 (linux path) and 10 (already-mitigated project policy).

**Research date:** 2026-05-15
**Valid until:** 2026-08-15 (~3 months — emulator gRPC API is stable; kittyfarm reference is the authoritative spec for this port and won't drift)

## RESEARCH COMPLETE
