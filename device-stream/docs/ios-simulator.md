# @device-stream/ios-simulator

iOS Simulator streaming via ScreenCaptureKit (sim-capture) + polling fallback.

## System Requirements

| Requirement | Details |
|-------------|---------|
| **OS** | macOS only |
| **Xcode** | Required (for `xcrun simctl`) |
| **Swift** | 5.9+ (included with Xcode, for building sim-capture) |

## How It Works

### sim-capture (Primary)

`sim-capture` is a Swift CLI binary that uses ScreenCaptureKit to capture the simulator window at up to 30fps. It outputs JPEG frames via a binary protocol on stdout, which the `CaptureService` parses and relays to consumers.

```
┌─────────────────────────────────────────────────────────────┐
│  iOS Simulator                                              │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  Simulator Window                                      │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                           │ ScreenCaptureKit
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  sim-capture binary                                         │
│  ├─ ScreenCaptureKit (captures window at 30fps)             │
│  ├─ JPEG encoding (configurable quality + scale)            │
│  └─ Binary protocol → stdout                                │
└─────────────────────────────────────────────────────────────┘
                           │ Binary protocol (stdout)
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  CaptureService (Node.js)                                   │
│  ├─ Spawns sim-capture process                              │
│  ├─ Parses binary header + JPEG frames                      │
│  └─ Emits 'frame' events → WebSocket / consumers            │
└─────────────────────────────────────────────────────────────┘
```

### Polling Fallback

If sim-capture is not available, the service falls back to polling screenshots at ~15fps using `xcrun simctl io screenshot`.

## Setup

### 1. Build sim-capture

```bash
cd device-stream
npm run build:sim-capture
```

This builds the `sim-capture` Swift binary at `tools/sim-capture/.build/release/sim-capture`.

### 2. Install Dependencies

```bash
npm install @device-stream/ios-simulator
```

## Usage

### Basic Example

```typescript
import {
  IOSSimulatorManager,
  SimulatorStreamService,
  CaptureService,
  createCaptureService,
} from '@device-stream/ios-simulator';
import { WebSocketServer } from 'ws';

// Create manager
const manager = new IOSSimulatorManager({
  bootTimeout: 120000,
});

// Create simulator
const device = await manager.createDevice({
  platform: 'ios',
  deviceType: 'com.apple.CoreSimulator.SimDeviceType.iPhone-15-Pro',
});

// Boot simulator
await manager.startDevice(device.id);

// Stream via ScreenCaptureKit
const capture = createCaptureService();
capture.on('frame', (udid, jpegBuffer) => {
  // Forward to WebSocket clients, save to disk, etc.
});
await capture.start(device.id, { fps: 30, quality: 80, scale: 1 });

// Or use WebSocket relay
const streamService = new SimulatorStreamService();

const wss = new WebSocketServer({ port: 5001 });
wss.on('connection', (ws, req) => {
  const url = new URL(req.url!, `http://${req.headers.host}`);
  const deviceId = url.searchParams.get('deviceId');

  if (url.pathname === '/ws/mirror/device') {
    streamService.handleDeviceConnection(ws, deviceId!);
  } else if (url.pathname === '/ws/mirror/browser') {
    streamService.handleBrowserConnection(ws, deviceId!);
  }
});
```

### Using Polling Fallback

```typescript
const streamService = new SimulatorStreamService();

// Start polling mode (15fps screenshots)
await streamService.startPollingFallback(deviceId, browserWebSocket);
```

## API Reference

### IOSSimulatorManager

```typescript
class IOSSimulatorManager extends EventEmitter {
  constructor(options?: IOSSimulatorManagerOptions);

  // Simulator lifecycle
  createDevice(options: CreateDeviceOptions): Promise<FarmDevice>;
  startDevice(deviceId: string): Promise<FarmDevice>;
  stopDevice(deviceId: string): Promise<void>;
  deleteDevice(deviceId: string): Promise<void>;

  // Streaming
  startStreaming(deviceId: string, serverHost?: string, serverPort?: number): Promise<StreamResult>;
  stopStreaming(deviceId: string): Promise<void>;

  // App management
  installApp(deviceId: string, appPath: string): Promise<InstallAppResult>;
  launchApp(deviceId: string, bundleId: string): Promise<boolean>;
  terminateApp(deviceId: string, bundleId: string): Promise<boolean>;

  // Device management
  getDevice(deviceId: string): FarmDevice | undefined;
  getAllDevices(): FarmDevice[];
  killAll(): Promise<void>;
  cleanup(): Promise<void>;

  // Runtime info
  listDeviceTypes(): Promise<string[]>;
  listRuntimes(): Promise<SimctlRuntime[]>;
  listExistingSimulators(): Promise<SimctlDevice[]>;
}
```

### CaptureService

```typescript
class CaptureService extends EventEmitter {
  start(udid: string, options?: { fps?: number; quality?: number; scale?: 1 | 2 | 4 }): Promise<void>;
  stop(udid: string): void;
  stopAll(): void;

  // Events
  on('frame', (udid: string, jpeg: Buffer) => void): this;
}
```

### SimulatorStreamService

```typescript
class SimulatorStreamService {
  // WebSocket handlers
  handleDeviceConnection(ws: WebSocket, deviceId: string): void;
  handleBrowserConnection(ws: WebSocket, deviceId: string): void;

  // Polling fallback
  startPollingFallback(deviceId: string, ws: WebSocket): Promise<void>;

  // Status
  isDeviceConnected(deviceId: string): boolean;
  getConnectedDevices(): string[];
  getDeviceStats(deviceId: string): DeviceStats | null;

  // Cleanup
  cleanup(): void;
}
```

## Events

The `IOSSimulatorManager` emits these events:

| Event | Payload | Description |
|-------|---------|-------------|
| `device:creating` | `FarmDevice` | Device creation started |
| `device:created` | `FarmDevice` | Device created successfully |
| `device:booting` | `FarmDevice` | Device boot started |
| `device:ready` | `FarmDevice` | Device fully booted |
| `device:stopping` | `FarmDevice` | Device shutdown started |
| `device:stopped` | `FarmDevice` | Device shut down |
| `device:busy` | `{ device, taskId }` | Device marked as busy |
| `device:released` | `FarmDevice` | Device released from task |
| `device:error` | `{ device, error }` | Error occurred |

## Troubleshooting

### sim-capture not working

1. Check that sim-capture is built: `ls tools/sim-capture/.build/release/sim-capture`
2. Verify the simulator is booted: `xcrun simctl list devices | grep Booted`
3. On first run, macOS may prompt for Screen Recording permission — grant it

### Low FPS with polling

Polling mode is limited to ~15fps due to screenshot capture overhead. For 30fps, build and use sim-capture.

## Limitations

- macOS only (requires Xcode + ScreenCaptureKit)
- sim-capture requires building from source (`swift build`)
- Polling fallback: ~15fps vs sim-capture 30fps

---

## Phase D — Native AVCC streaming + HID input

Phase D replaced WDA-based control with two standalone Swift binaries vendored from [baguette](https://github.com/tddworks/baguette) (Apache-2.0). Both ports preserve attribution headers and (for HID) the exact byte-level recipes that baguette discovered.

### `tools/sim-capture-avcc` — H.264 AVCC encoder

Captures the simulator screen via ScreenCaptureKit, encodes to H.264 with VideoToolbox, and writes length-prefixed AVCC frames to stdout. Replaces the MJPEG-only `sim-capture` for clients that can decode H.264 (i.e. any browser via `WebCodecs.VideoDecoder`).

**Build:**
```bash
npm run build:sim-capture-avcc
# → device-stream/bin/sim-capture-avcc
```

**CLI:**
```bash
sim-capture-avcc --udid <UDID> --fps 30 --bitrate 4000000 --scale 1.0 --format avcc
```

**Wire format** (each stdout frame):
```
[4-byte BE length] [1-byte tag] [payload]
```
Tag values (also in `@device-stream/core/src/protocol-v2.ts`):
- `0x01` — avcC description (sent once before first NAL)
- `0x02` — keyframe (IDR) — H.264 length-prefixed NAL units
- `0x03` — delta frame
- `0x04` — JPEG seed (one sent after avcC for fast first paint)

**Runtime tuning via stdin** (newline-delimited JSON, written by `CaptureService`):
- `{"type":"set_bitrate","bps":N}` — updates `kVTCompressionPropertyKey_AverageBitRate` and forces an IDR
- `{"type":"set_fps","fps":N}` — informational (frame source paces itself)
- `{"type":"force_idr"}` — sets `kVTEncodeFrameOptionKey_ForceKeyFrame` on next encode
- `{"type":"snapshot"}` — emits one 0x04 JPEG seed at current resolution

**TypeScript surface:** `CaptureService.startCapture(udid, { format: 'avcc', fps, bps, scale })`. The service spawns the binary, parses stdout frames, and emits `'frame'` events with `{udid, kind: 'avcc'|'keyframe'|'delta'|'jpeg-seed', payload: Buffer}`. The `SimulatorStreamService` forwards them as binary WebSocket messages using `serializeAvccFrame()`.

### `tools/sim-input` — iOS-26 HID dispatcher

The fastest, most reliable input path for iOS Simulator. Bypasses WDA entirely. Reads JSON lines from stdin, dispatches HID events via SimulatorKit's private digitizer API, writes ack JSON lines to stdout.

**Build:**
```bash
npm run build:sim-input
# → device-stream/bin/sim-input
```

**Why this works on iOS 26 when older tools don't**

iOS 26.x rejects the legacy input methods that `xcrun simctl io`, `IOHIDPostEvent`, and accessibility-based approaches all rely on. The recipe baguette discovered (and which is ported VERBATIM into this binary) is:

1. **Digitizer-finger event** with the right `eventMask` (0x07 for down/move, 0x06 for up).
2. **Wrap in a digitizer-parent envelope** addressed to target 0x32.
3. **Wrap in a trackpad message** with the IndigoHID 7-arg or 9-arg shape (depending on event subtype).
4. **Patch 4 bytes** in the trackpad header (offsets 0xda/0xdb for phase, 0x3a/0x3b for press state).
5. **Dispatch via SimulatorKit** through `SimDeviceHost.shared()` — NOT via the public `IOHIDEvent` APIs.

The exact byte offsets, edge bitmasks (for swipe-from-edge gestures), and phase masks are documented as inline comments in `tools/sim-input/Sources/sim-input/{IOHIDDigitizerDispatch,IndigoHIDInput}.swift`. **Do not modify these comments — they are the contract.**

Credit: this recipe and the empirical step counts / dwell times for edge gestures (swipe-to-home, swipe-to-app-switcher, pull-down-notifications) were reverse-engineered by [baguette](https://github.com/tddworks/baguette). See baguette's README §"Why this works on iOS 26.4 when older tools don't" for the original write-up.

**Stdin schema** (one JSON object per line):
- `{"id":N,"type":"tap","x":F,"y":F}` — point coords
- `{"id":N,"type":"swipe","fromX":F,"fromY":F,"toX":F,"toY":F,"durationMs":N}`
- `{"id":N,"type":"press","key":K}` — `Input.key()` brackets down+up internally
- `{"id":N,"type":"release","key":K}` — acked as no-op (press is atomic)
- `{"id":N,"type":"text","text":"…"}`

**Stdout schema** (one JSON ack per request, FIFO):
- `{"id":N,"ok":true}` or `{"id":N,"ok":false,"error":"…"}`

**TypeScript surface:** `InputService` (in `@device-stream/ios-simulator`). Long-lived child process per UDID, id-stamped envelopes, ack queue with id-match + FIFO fallback. Also wired into `IOSSimulatorManager` (`tap()`, `swipe()`, `pressKey()`, `typeText()`) and into `SimulatorStreamService` (forwards gesture envelopes received over WebSocket).

### Phase D coordinate system

Phase D follows baguette's convention: **coordinates are POINTS, not pixels.** A 3x retina iPhone is 393×852 points / 1179×2556 pixels. The browser sends point coordinates derived from the streaming aspect ratio; the binary dispatches without further scaling.

---

## Phase E — Virtual camera

Phase E ships a host-driven virtual camera for the iOS Simulator. A macOS AVCaptureSession reads the host's webcam (or any AVCaptureDevice), writes BGRA frames into a shared-memory file, and a DYLD-injected ObjC dylib inside the simulator process makes `AVCapture*` and `UIImagePickerController` read those frames instead of (non-existent) simulator camera hardware.

### Components

| Component | Path | Role |
|---|---|---|
| `VirtualCamera.dylib` | `device-stream/VirtualCamera/` | DYLD-inserted into simulator processes. Swizzles AVCapture + UIImagePicker. Reads from `/tmp/SimCam.bgra`. |
| `tools/sim-cam` | Swift binary | Host AVCaptureSession on the chosen camera, writes BGRA frames to the shared-memory file. |
| `CameraFrameSink` | TS class | Fallback writer (host-side, for synthetic frame sources). Same wire layout. |
| `VirtualCameraInstaller` | TS class | Content-addresses the dylib (SHA-256), copies to `$TMPDIR/device-stream/virtualcam/<hash>/VirtualCamera.dylib`. Idempotent. |
| `CameraSession` | TS class | Orchestrator. Lists cameras, spawns sim-cam, emits `state` events, returns the env to set on the next `simctl spawn`. |
| `/cameras/:udid/camera` WS route | `test-app/server.ts` | Wire protocol on top of `parseCameraMessage`. |

### Shared-memory layout

24-byte little-endian header followed by BGRA pixels (canvas cap 1280×1280). Defined in `@device-stream/ios-simulator/src/camera-layout.ts` and matched by the Swift binary's `SharedFrameLayout` and the dylib's reader.

```
[ 0..< 4]  sequence       UInt32  monotonic, dylib picks up new frames
[ 4..< 8]  timestampMs    UInt32  capture wall clock, milliseconds
[ 8..<12]  width          UInt32  pixel width
[12..<16]  height         UInt32  pixel height
[16..<20]  flags          UInt32  bit 0 fillGravity, bit 1 mirror
[20..<24]  reserved       zeros
[24...  ]  BGRA pixels    premultiplied-first
```

### Wire protocol — `/cameras/:udid/camera`

Client → server:
- `{"type":"camera_list"}`
- `{"type":"camera_start","deviceUID":"…","fit":"fit","mirror":false}`
- `{"type":"camera_stop"}`
- `{"type":"camera_set_flags","fit":"fill","mirror":true}`

Server → client:
- `{"type":"camera_devices","devices":[{uid,name,modelID,localizedName}]}`
- `{"type":"camera_state","phase":"idle"|"streaming","fps":…,"device":"…"}`
- `{"type":"camera_error","error":"…"}`

### Wiring the dylib into simulator app launches

`CameraSession.getInjectionEnv(udid)` returns `{ SIMCTL_CHILD_DYLD_INSERT_LIBRARIES: <installer.path> }` when a session is streaming. Pass that env on `simctl spawn` (or `xcrun simctl launch --terminate-running-process`) for the iOS app you want to receive fake camera frames. Already-running apps will NOT pick up the dylib — restart them.

**Codesign warning** (from baguette, preserved): `ld` ad-hoc signs each slice with the `linker-signed` flag. iOS 26+ simulator's dyld accepts `linker-signed` adhoc but REJECTS post-build `codesign --force --sign -` signatures with `code:codesigning(3) invalid-page(2)`. Do NOT re-sign `VirtualCamera.dylib` after `build.sh` produces it.

### Build

```bash
npm run build:phase-e
# Builds VirtualCamera.dylib + tools/sim-cam
```

`VirtualCamera.dylib` is gitignored — checkout-then-build is required.

---

## Attribution

Phase D and Phase E ports preserve Apache-2.0 attribution headers. Specifically:

- `tools/sim-capture-avcc/Sources/**` — adapted from baguette `Infrastructure/Stream/` + `Infrastructure/Screen/`, baguette Domain types inlined.
- `tools/sim-input/Sources/**` — **verbatim** port of baguette `Infrastructure/Input/{IOHIDDigitizerDispatch,IndigoHIDInput}.swift`. Comments are part of the recipe.
- `tools/sim-cam/Sources/**` — adapted from baguette `Infrastructure/Camera/{AVCameraCapture,HostVideoCapture,AVCameras,SharedMemoryFrameSink}.swift`.
- `VirtualCamera/Sources/**` — double-vendored from baguette → asc-pro/SimCam. Symbol prefix `SimCam*` preserved for clean upstream resync.
- `packages/ios-simulator/src/{camera-layout,camera-frame-sink,camera-message,virtual-camera-installer,camera-session}.ts` — TS translations of the corresponding baguette Domain/Infrastructure files.

Upstream: <https://github.com/tddworks/baguette>.
