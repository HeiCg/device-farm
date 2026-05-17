# Phase 33 — Android gRPC EmulatorController (replace scrcpy)

**Track:** device-stream (DS)
**Effort:** ~6 days
**Source idea:** kittyfarm `Capture/GRPCFrameService.swift` + `Protos/emulator_controller_kittyfarm.proto`
**Replaces:** `device-stream/packages/android/` scrcpy + TangoADB transport for emulators

## Goal

Stream Android *emulator* frames and inject input via the emulator's built-in gRPC `EmulatorController` service, eliminating the scrcpy-server dependency. Use the emulator's MMAP transport mode to avoid copying frame bytes through the socket.

## Why

scrcpy is excellent but expensive for our use case:
- Ships a Java agent we have to fetch (`scrcpy-server.jar`), version-pin, and reload across emulator boots.
- H.264 decoding overhead client-side.
- Touch injection via shell `input tap` chain — slow and lossy under load.

The emulator already exposes `streamScreenshot`, `sendTouch`, `sendKey`, `setClipboard` over gRPC. With `ImageTransport=MMAP` the emulator writes frames to a mmap file and gRPC only sends metadata — zero-copy.

This phase **only covers emulators**. Physical Android devices still go through scrcpy (different transport — see Phase 36 for wireless physical Android).

## Scope

### In
- New Go gRPC client in `device-stream/packages/android-server/grpc-emu/` (we have Go toolchain via the CLI).
- Subset proto `proto/emulator_controller.proto` (only methods we use).
- Emulator auth token discovery: read `~/Library/Caches/TemporaryItems/avd/running/pid_<pid>.ini` (key `grpc.token`, port-matched), fallback `~/.emulator_console_auth_token`.
- MMAP transport mode (`ImageTransport.channel = MMAP`, `handle = file://...`).
- Daemon process per emulator exposing the same Unix-socket framing contract as the scrcpy path (`packages/android/src/scrcpy-service.ts` interface).
- Spawn emulator with `-grpc <port>` flag automatically inside `pool/android/emulator.ts`.
- Default `DEVICE_STREAM_ANDROID_GRPC=1` after canary; fallback to scrcpy when disabled or for non-emulator targets.

### Out
- Physical Android devices (kept on scrcpy in this phase)
- WebRTC transport (gRPC streaming is enough)
- VP8/VP9 codec (RGBA via MMAP + server-side H.264 encode is the path)

## Background — kittyfarm pipeline

From kittyfarm `Capture/GRPCFrameService.swift`:

1. Emulator launched with `-grpc 8554 -no-window` (or whatever port we pick).
2. Auth: load token from `~/Library/Caches/TemporaryItems/avd/running/pid_<pid>.ini` matched on `grpc.port`; pass as `authorization: Bearer <token>` metadata.
3. RPC: `EmulatorController.streamScreenshot(ImageFormat{format=RGB888, transport={channel: MMAP, handle: "file:///tmp/emu-<port>.mmap"}, display: 0}) returns (stream Image)`.
4. Client maps the mmap file once; each gRPC message contains only `{width, height, seq, timestampUs}` — frame bytes read from mmap at offset 0.
5. Touch: `EmulatorController.sendTouch(TouchEvent{x, y, pressure, identifier, touchDisplay, expiration: EVENT_EXPIRATION_DEFAULT})`.

## Tasks

### T-33.1 — Proto + Go gRPC stubs (~4h)

**Files**
- `device-stream/packages/android-server/grpc-emu/proto/emulator_controller.proto` (subset)
- `device-stream/packages/android-server/grpc-emu/Makefile` (`protoc` codegen)
- `device-stream/packages/android-server/grpc-emu/gen/...` (generated)

**Subset to keep:**
- `service EmulatorController { rpc streamScreenshot, rpc sendTouch, rpc sendKey, rpc getStatus }`
- messages: `ImageFormat`, `Image`, `ImageTransport`, `TouchEvent`, `KeyboardEvent`, `EmulatorStatus`

Keep proto file under SPDX `Apache-2.0` and link to upstream Google source for traceability.

### T-33.2 — Auth token discovery (~3h)

**Files**
- `device-stream/packages/android-server/grpc-emu/auth/token.go`
- `device-stream/packages/android-server/grpc-emu/auth/token_test.go`

**Logic**

```
findToken(grpcPort):
  for ini in glob "~/Library/Caches/TemporaryItems/avd/running/pid_*.ini":
    cfg = parseIniSimple(ini)
    if cfg["grpc.port"] == grpcPort: return cfg["grpc.token"]
  if file ~/.emulator_console_auth_token: return read
  return ""  // some emulator builds have auth disabled
```

INI parsing trivial (no `=` in values for the tokens we read); ~30 LOC of Go.

### T-33.3 — gRPC client + MMAP frame reader (~6h)

**Files**
- `device-stream/packages/android-server/grpc-emu/client/client.go`
- `device-stream/packages/android-server/grpc-emu/mmap/mmap_darwin.go`
- `device-stream/packages/android-server/grpc-emu/mmap/mmap_linux.go`
- `device-stream/packages/android-server/grpc-emu/client/client_test.go`

**Flow**

```
Client.Stream(format=RGBA_8888, w, h):
  mmapPath = /tmp/emu-grpc-<port>.bin
  req = ImageFormat{format: RGBA_8888, transport: {channel: MMAP, handle: "file://"+mmapPath}, width: w, height: h}
  stream = stub.StreamScreenshot(ctx, req)
  mapping = mmap.Map(mmapPath, w*h*4)   // mmap'd on first frame (file appears when emulator creates it)
  for img := range stream.Recv():
    frame = mapping[0 : img.Width*img.Height*4]
    emit Frame{seq: img.Seq, ts: img.Timestamp, pixels: frame}
```

**Crucial:** because the same mmap region is reused per frame, we need to copy bytes into the encoder buffer (or pass a borrow flag and require the consumer to encode before next frame arrives). Pick the borrow-flag path with a per-display 2-frame ring buffer in the encoder.

### T-33.4 — H.264 encoder + Unix-socket bridge (~6h)

**Files**
- `device-stream/packages/android-server/grpc-emu/encode/h264_darwin.go` (VideoToolbox via cgo)
- `device-stream/packages/android-server/grpc-emu/encode/h264_linux.go` (libx264 via cgo)
- `device-stream/packages/android-server/grpc-emu/ipc/server.go` (Unix socket framing — identical contract to Phase 32)
- `device-stream/packages/android-server/grpc-emu/cmd/emu-stream/main.go` (daemon binary)

Daemon entrypoint listens on `/tmp/device-stream-android-emu-<serial>.sock` and emits the same framed envelope used by Phase 32's `IpcServer`. This means the Node-side WS bridge code is shared.

### T-33.5 — Spawn emulator with -grpc + integrate into Pool (~3h)

**Files**
- `server/pool/android/emulator.ts:91-103` (add `-grpc <port>` to argv when `gRpcMode` enabled)
- `server/pool/android/avd.ts` (allocate grpc port alongside console port)
- `server/pool/ports.ts` (extend `allocatePort` for grpc band, e.g. 8554-8650)
- `server/types/index.ts` (Device entity gains `grpcPort`)

The emulator port allocator already handles zombie ranges; just add a new band.

### T-33.6 — TypeScript service swap (~3h)

**Files**
- `device-stream/packages/android/src/grpc-emu-client.ts` (new, ~180 LOC — spawns daemon, parses framed messages)
- `device-stream/packages/android/src/service.ts` (modify — choose path)
- `device-stream/packages/android/__tests__/grpc-emu.test.ts`

Selection rule:

```
service.start(device):
  if device.kind === 'emulator' && env.DEVICE_STREAM_ANDROID_GRPC !== '0':
    try: return await GrpcEmuClient.spawn(device.serial, device.grpcPort)
    catch (e): log.warn('grpc path failed, fallback to scrcpy', e)
  return ScrcpyClient.spawn(device)
```

### T-33.7 — Touch + key control parity (~3h)

**Files**
- `device-stream/packages/android/src/grpc-emu-client.ts` (extend with `sendTouch`, `sendKey`)
- `device-stream/packages/android-server/grpc-emu/ipc/control.go` (forward 0xC1, 0xC2 control messages to gRPC)

Touch payload: `{x, y, pressure: 1.0, identifier, expiration: DEFAULT}` on `sendTouch`. Key payload: `{eventType: keydown/keyup, keyCode}` mapped from Android KEYCODE_*.

### T-33.8 — Postinstall + remove scrcpy fetch for emulators (~2h)

**Files**
- `device-stream/scripts/fetch-scrcpy-server.js` (modify — note "still required for physical devices")
- `device-stream/scripts/build-grpc-emu.js` (new — runs `make` in `grpc-emu/`)
- `device-stream/package.json` (postinstall chain)

Keep scrcpy-server.jar fetched for now since physical devices still need it. Phase 36 may remove it for some cases.

## Acceptance criteria

- [ ] Booting an emulator via `device-farm run` reads frames over gRPC + MMAP, scrcpy-server.jar not touched.
- [ ] `DEVICE_STREAM_ANDROID_GRPC=0` falls back to scrcpy with no test failures.
- [ ] Touch via gRPC reaches the app in < 80ms on Apple Silicon M1+ (measured via a Maestro flow that taps a stopwatch button).
- [ ] Frame latency from emulator backboard to WS dashboard reduces vs scrcpy baseline (target -30% median).
- [ ] CPU usage of the new daemon < scrcpy baseline at 30fps 1080p.
- [ ] No mmap leak: 30-min soak test ends with stable RSS (`ps -o rss=`).

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Some emulator versions disable auth → silent connection | Probe `getStatus` first; surface clear "auth missing — set token" error |
| MMAP file races (frame N+1 written before N encoded) | 2-frame ring buffer with copy-on-borrow |
| Newer emulator changes RGBA stride/alignment | Read stride from `Image.format` if available; otherwise probe with known calibration image |
| User runs emulator manually without `-grpc` | Detect via `getStatus` probe in pool reconciliation; if missing, do not advertise device for gRPC path |
| linux H.264 encode via libx264 cgo bloats binary | Optional; keep darwin VideoToolbox primary, x264 behind build tag |

## References

- kittyfarm: `KittyFarm/Capture/GRPCFrameService.swift` (full client)
- kittyfarm: `KittyFarm/Capture/AndroidEmulatorAuth.swift` (token discovery)
- kittyfarm: `Protos/emulator_controller_kittyfarm.proto` (subset proto)
- kittyfarm: `KittyFarm/Lifecycle/EmulatorManager.swift:73-77` (`-grpc` launch flag)
- Upstream proto: <https://android.googlesource.com/platform/external/qemu/+/refs/heads/emu-master-dev/android/android-grpc/android/emulation/control/emulator_controller.proto>
- Current code: `device-stream/packages/android/`, `server/pool/android/emulator.ts`, `server/pool/ports.ts`

## Done = Nyquist-compliant

Unit tests for ini parsing, auth fallbacks, mmap ring buffer; integration test against a real emulator launched by the harness; soak test; latency benchmark recorded under `docs/benchmarks/v3.0-grpc.md`.
