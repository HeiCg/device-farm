# @device-stream/ios-simulator

iOS Simulator streaming, input, observability, and virtual camera — all without WebDriverAgent.

## Capabilities

| Capability | Module | Implementation |
|---|---|---|
| MJPEG streaming | `CaptureService` + `tools/sim-capture` | ScreenCaptureKit JPEG (existing) |
| AVCC H.264 streaming | `CaptureService` + `tools/sim-capture-avcc` | ScreenCaptureKit + VideoToolbox, length-prefixed AVCC frames over stdout (Phase D) |
| HID input (tap, swipe, key, text) | `InputService` + `tools/sim-input` | Direct iOS-26 byte-level HID dispatch via SimulatorKit private API (Phase D) |
| Bezel chrome | `chrome.ts` + `/bezel/:id/...` routes | DeviceKit `.devicechrome` bundles, sips-rasterized PNGs (Phase C) |
| Log stream | `IOSSimulatorLogStream` | `xcrun simctl spawn <udid> log stream --style ndjson` (Phase B) |
| UI hierarchy | `fetchDescribeUi` | WDA `/source` (XML parsed to `AXNode`) (Phase B) |
| Virtual camera | `CameraSession` + `tools/sim-cam` + `VirtualCamera.dylib` | macOS AVCaptureSession → mmap BGRA → sim-injected dylib (Phase E) |
| Control channel | `ControlChannel` | Bitrate/fps/scale/IDR/snapshot runtime tuning (Phase A) |
| Gesture routing | `SimulatorStreamService` + `InputService` | Browser gesture envelopes → sim-input stdin (Phase D) |

## Quickstart

```bash
# 1. Install
cd device-stream && npm install && npm run build:ios-simulator

# 2. Build the native binaries (macOS, Xcode 26+ required)
npm run build:phase-d   # sim-capture-avcc + sim-input
npm run build:phase-e   # VirtualCamera.dylib + sim-cam

# 3. Boot a simulator
/Applications/Xcode.app/Contents/Developer/usr/bin/simctl boot <UDID>

# 4. Run the test app
npx tsx test-app/server.ts   # http://localhost:3456
```

## Toolchain prerequisites

| Tool | Version | Why |
|---|---|---|
| Xcode | 26+ | SimulatorKit private API + iOS-26 HID recipe |
| Swift | 6.0+ | Build all native binaries |
| macOS | 15+ | ScreenCaptureKit, SCContentFilter on simulator windows |
| `xcode-select -p` | `/Applications/Xcode.app/Contents/Developer` | Required for `swift build` to find PrivateFrameworks. If unset, `DEVELOPER_DIR=…` env var is honored by all `build-sim-*.sh` scripts. |

## Native binaries

All four ports are committed under `tools/` and `VirtualCamera/`. They are NOT shipped pre-built — run the build scripts.

- `tools/sim-capture-avcc/` — H.264 AVCC encoder over ScreenCaptureKit. Ported from baguette (Apache-2.0).
- `tools/sim-input/` — HID digitizer + keyboard dispatch via SimulatorKit + IOKit. Ported verbatim from baguette.
- `tools/sim-cam/` — host AVCaptureSession → BGRA ring buffer at `/tmp/SimCam.bgra`. Ported from baguette.
- `VirtualCamera/` — DYLD-injected ObjC dylib that swizzles `AVCapture*` inside the simulator process so iOS apps read the ring buffer instead of real camera hardware. Double-vendored: baguette → asc-pro/SimCam. See `VirtualCamera/VENDORED_FROM.md`.

## See also

- `docs/ios-simulator.md` — protocol details + wire formats
- `device-stream/web-sdk/` — browser SDK (Transport, FrameDecoder, BrowserRecorder, Bezel)
- baguette upstream — <https://github.com/tddworks/baguette>
