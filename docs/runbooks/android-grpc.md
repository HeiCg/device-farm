# Runbook: android-grpc-stream (Android Emulator gRPC + MMAP Bridge)

Phase 33 — operational guide for the `android-grpc-stream` daemon, the Go-based replacement for `scrcpy-server.jar` in `@device-stream/android` when the target is an **Android emulator**. Physical Android devices remain on the legacy scrcpy path.

## Purpose

The `android-grpc-stream` daemon dials the Android emulator's built-in `EmulatorController` gRPC service (port `8554+`), pulls frames from the simulator's shared MMAP ring, H.264-encodes them with VideoToolbox (darwin) and emits them over a Unix domain socket. It replaces the scrcpy `screenrecord`-based pipeline for emulators with three operational wins:

1. **No on-device APK push.** `scrcpy-server.jar` does not need to be copied to `/data/local/tmp/`. The emulator already exposes the surface internally.
2. **Lower latency.** MMAP ring + direct touch RPC avoids scrcpy's framebuffer-grab-then-encode latency.
3. **No `screenrecord` lifetime cap.** `adb shell screenrecord` truncates at 3 minutes; the gRPC stream is unbounded.

**Trade-off:** the path is emulator-only — physical Android devices have no `EmulatorController` service. The TypeScript adapter (`AndroidStreamingService`) detects this and falls back to scrcpy automatically.

## Prerequisites

- macOS 13+ on **Apple Silicon (arm64)** (linux support deferred per `deferred-items.md` DEFERRED-33-A / DEFERRED-33-G).
- **Go 1.26.1+** on PATH (`go version`).
- **protoc + Go plugins** on PATH:
  ```bash
  brew install protobuf
  go install google.golang.org/protobuf/cmd/protoc-gen-go@latest
  go install google.golang.org/grpc/cmd/protoc-gen-go-grpc@latest
  export PATH="$(go env GOPATH)/bin:$PATH"
  ```
- **Android SDK** with `emulator`, `adb`, `avdmanager` on PATH (Android Studio installs these into `$ANDROID_HOME/emulator/`, `$ANDROID_HOME/platform-tools/`, `$ANDROID_HOME/cmdline-tools/latest/bin/`).
- An **AVD with `google_apis_playstore` system image at API 35** (or API 34):
  ```bash
  sdkmanager "system-images;android-35;google_apis_playstore;arm64-v8a"
  avdmanager create avd -n grpc-test -k "system-images;android-35;google_apis_playstore;arm64-v8a" -d pixel_6
  ```
- API 36+ is NOT supported (macOS Tahoe `mprotect`/HVF incompat — see CLAUDE.md).

## Install

```bash
cd device-farm
npm install            # postinstall hook builds android-grpc-stream on darwin/arm64
# OR build manually:
bash device-stream/scripts/build-android-grpc.sh
ls -l device-stream/bin/android-grpc-stream   # should exist + executable
```

The postinstall hook is non-blocking: if the build fails (e.g. missing `protoc`), `npm install` still exits 0. The TypeScript adapter (`GrpcEmuClient.spawn`) detects the missing binary at runtime and `AndroidStreamingService` falls back to scrcpy.

## Configuration

| Env var | Effect |
|---------|--------|
| `DEVICE_STREAM_ANDROID_GRPC=0` | Disable the gRPC bridge; force fallback to scrcpy-server.jar for all sessions (including emulators) |
| `DEVICE_STREAM_ANDROID_GRPC=1` (or unset) | Use the gRPC bridge first for **emulator** sessions; physical Android stays on scrcpy unconditionally; fall back automatically on spawn failure |
| `DEVICE_STREAM_SKIP_BUILD=1` | Skip the native build during `npm install` postinstall (no-op) |
| `GRPC_PORT` (smoke/soak/touch/visual scripts) | Override the gRPC port (default: pick first free in band `8554-8650`) |
| `CONSOLE_PORT` (smoke/soak/touch/visual scripts) | Override the emulator console port (default `5554` → serial `emulator-5554`) |

The emulator's gRPC auth token is discovered automatically from `~/Library/Caches/TemporaryItems/avd/running/pid_<pid>.ini` (per-instance) with fallback to `~/.emulator_console_auth_token` (global). See `device-stream/native-servers/android-grpc/auth/token.go`.

## Manual verification (end-to-end)

1. Build the daemon (see Install above).
2. Boot an emulator via the device-farm pool. The pool driver (`server/pool/android/emulator.ts`) injects `-grpc <port>` automatically (port band 8554-8650, see Plan 33-03).
3. Submit a job:
   ```bash
   ./bin/device-farm run \
     --server http://localhost:3000 \
     --platform android \
     /path/to/flow.yaml
   ```
4. **Verify:** the dashboard receives H.264 frames; the job completes.
5. **Verify:** `scrcpy-server.jar` is NOT loaded into the emulator process:
   ```bash
   adb -s emulator-5554 shell "lsof | grep scrcpy" || echo "(no scrcpy on device — expected)"
   ```
6. **Verify:** the gRPC daemon is running and bound to the socket:
   ```bash
   ls -l /tmp/device-stream-android-emu-emulator-5554.sock
   pgrep -fl android-grpc-stream
   ```

## Automated verification

Four scripts mirror the Phase 32 (SimulatorKit) shape and cover smoke / soak / touch / visual diff:

```bash
# 1. Smoke (60-120s): boot + probe + spawn + 30 frames + clean teardown.
bash device-stream/scripts/smoke-android-grpc.sh <avd-name>
#    Expects: "SMOKE: OK" on stdout, exit code 0.

# 2. Soak (30 min default): boot + spawn + 30s RSS samples; fails if growth > 50 MB.
bash device-stream/scripts/android-grpc-soak.sh <avd-name> --duration 30m

# 3. Touch latency (10 samples): sends 0xC1 touch frames, measures send-to-frame delta.
#    Pass criterion: median <= 80 ms.
bash device-stream/scripts/android-grpc-touch.sh <avd-name>

# 4. Visual diff (60s): captures gRPC path + adb screenrecord baseline, ffmpeg SSIM.
#    Pass criterion: SSIM >= 0.99.
bash device-stream/scripts/android-grpc-visual.sh <avd-name>
```

## CI

The daily matrix workflow [`android-grpc-matrix.yml`](../../.github/workflows/android-grpc-matrix.yml) runs on `macos-14` runners across API levels **34 and 35** (newer levels excluded — macOS Tahoe `mprotect`/HVF incompat per CLAUDE.md). It executes daily at 09:00 UTC and on manual dispatch:

```bash
gh workflow run android-grpc-matrix.yml
```

The matrix uses `reactivecircus/android-emulator-runner@v2` with `target=google_apis_playstore`, `arch=x86_64`. Failing legs are not fail-fast — each API level reports independently so a single drift does not mask the other.

## Troubleshooting

### Probe fails with `auth missing` / `connection refused`

**Symptom:** `android-grpc-stream --probe` exits non-zero with `Unauthenticated` or `connection refused`.

**Causes / fixes:**

1. **No `pid_<pid>.ini`:** the emulator was started without writing the per-instance auth token. Wait a few seconds after boot for the file to materialize, or check `~/Library/Caches/TemporaryItems/avd/running/`.
2. **Emulator booted without `-grpc <port>`:** older driver, manual `emulator` invocation, or wrong port. Re-spawn via the pool (Plan 33-03 injects `-grpc <port>` automatically) or pass `-grpc 8554` explicitly to `emulator`.
3. **Verify-fix:**
   ```bash
   adb -s emulator-5554 shell getprop ro.kernel.qemu.gnss.port  # 0 if no gRPC
   lsof -nP -iTCP:8554 -sTCP:LISTEN                              # emulator should listen
   ```

### Probe fails with `connection refused` (port not bound)

**Symptom:** `dial tcp 127.0.0.1:8554: connect: connection refused`.

**Cause:** the emulator was spawned without `-grpc`, OR a stale process holds the port band.

**Fix:**
```bash
lsof -nP -iTCP:8554 -sTCP:LISTEN                 # who holds the port?
kill <pid>                                       # if it's a zombie emulator
```

### Frames torn / glitched / black

**Symptom:** Dashboard renders garbage or solid-color frames.

**Cause:** The MMAP ring buffer is not being honored — the daemon is reading frame stride/dims from gRPC `getStatus` but the emulator wrote frames in a different layout.

**Fix:**
1. Check daemon logs for `image.image: <bytes>` lines — `0` bytes means the gRPC stream is empty and the MMAP read is firing on stale data.
2. Disable the gRPC path: `DEVICE_STREAM_ANDROID_GRPC=0 npm run dev`. If scrcpy renders correctly, file an issue with the AVD config (system image variant, GPU mode).

**Verify fix:**
```bash
strings /tmp/device-stream-android-emu-*.log | grep "image.image"
```

### Daemon dies silently after first frame

**Symptom:** `pgrep -fl android-grpc-stream` returns nothing; dashboard shows "stream ended".

**Cause:** `SIGPIPE` from a closed Unix socket. The daemon ignores `SIGPIPE` (see `cmd/android-grpc-stream/main.go` line ~54 `signal.Ignore(syscall.SIGPIPE)`). If the daemon still dies, check for an uncaught panic in the encoder.

**Fix:** Inspect the daemon logs:
```bash
tail -100 /tmp/device-stream-android-emu-*.log
grep "panic\|fatal" /tmp/device-stream-android-emu-*.log
```

### Touch lands at wrong pixel

**Symptom:** `device-farm run` taps fire at coordinates offset from the expected target.

**Cause:** The daemon hasn't yet emitted its first `0x03` metadata frame (display width/height). The TS adapter (`GrpcEmuClient`) uses a default fallback of 1080×1920 for the first <100 ms. Touch math derived from ratio-coords picks up the wrong dims.

**Fix:** Wait a few frames before the first tap. Maestro flows that start with an immediate tap can race this — insert a small `wait 200` (ms) before the first tap, or pin the display dimensions in the AVD config (`hw.lcd.width=1080 hw.lcd.height=1920`).

**Verify fix:**
```bash
grep "metadata received" /tmp/device-stream-android-emu-*.log  # should print width x height
```

### CI matrix red on API 34 only (API 35 green)

**Symptom:** Daily matrix workflow fails for `api-level: 34` while `api-level: 35` passes.

**Cause:** The `google_apis_playstore` system image variant is not available for that API level on the macos-14 runner image, OR the system image was recently re-released with a different ABI.

**Fix:**
1. Inspect the workflow logs for `sdkmanager` errors during AVD creation.
2. Try a fallback variant in `.github/workflows/android-grpc-matrix.yml`:
   ```yaml
   target: google_apis    # fallback if google_apis_playstore is unavailable
   ```
3. Open an issue against `reactivecircus/android-emulator-runner` if the image manifest is stale.

### `npm install` reports build failure but does not abort

This is intentional. The postinstall script always exits 0; the runtime fallback in `AndroidStreamingService.start` checks for the binary at `device-stream/bin/android-grpc-stream` and falls through to scrcpy when missing. To re-attempt the build:

```bash
bash device-stream/scripts/build-android-grpc.sh
```

If `protoc` / plugins are missing, the script prints the exact `brew install` / `go install` commands.

### Socket `/tmp/device-stream-android-emu-*.sock` collision

If a previous daemon crashed without cleaning up:

```bash
rm /tmp/device-stream-android-emu-*.sock
```

The smoke/soak/touch/visual scripts unlink stale sockets at startup; production callers do the same in `GrpcEmuClient.spawn` before `child_process.spawn`.

## Related

- Phase brief: [`.planning/phases/33-android-grpc/33-BRIEF.md`](../../.planning/phases/33-android-grpc/33-BRIEF.md)
- Research: [`.planning/phases/33-android-grpc/33-RESEARCH.md`](../../.planning/phases/33-android-grpc/33-RESEARCH.md)
- Validation: [`.planning/phases/33-android-grpc/33-VALIDATION.md`](../../.planning/phases/33-android-grpc/33-VALIDATION.md)
- Deferred items: [`.planning/phases/33-android-grpc/deferred-items.md`](../../.planning/phases/33-android-grpc/deferred-items.md)
- Build script: [`device-stream/scripts/build-android-grpc.sh`](../../device-stream/scripts/build-android-grpc.sh)
- CI workflow: [`.github/workflows/android-grpc-matrix.yml`](../../.github/workflows/android-grpc-matrix.yml)
- Reference impl (study-only): kittyfarm `Capture/GRPCFrameService.swift` + `AndroidEmulatorAuth.swift`
