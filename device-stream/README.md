# @device-stream

Modular npm packages for mobile device video streaming and control — iOS simulators, iOS physical devices, and Android devices.

## Packages

| Package | Description | Platform |
|---------|-------------|----------|
| [@device-stream/core](./packages/core) | Shared types, interfaces, and utilities | All |
| [@device-stream/ios-simulator](./packages/ios-simulator) | iOS Simulator streaming via ScreenCaptureKit + polling | macOS |
| [@device-stream/ios-device](./packages/ios-device) | iOS physical device streaming via WDA MJPEG | macOS |
| [@device-stream/android](./packages/android) | Android streaming via TangoADB + scrcpy | All |
| [@device-stream/android-server](./packages/android-server) | On-device HTTP server for fast Android control | All |

## System Dependencies

### All platforms

| Dependency | Version | Install |
|------------|---------|---------|
| Node.js | >= 18.0.0 | [nodejs.org](https://nodejs.org) or `nvm install 18` |
| npm | >= 9 | Included with Node.js |
| TypeScript | >= 5.3 | Installed as devDependency |

### Android

| Dependency | Version | Install | Purpose |
|------------|---------|---------|---------|
| ADB | Latest | Android SDK Platform-Tools | Device communication |
| Android SDK | API 28+ | Android Studio or `sdkmanager` | `ANDROID_HOME` must be set |
| Java / JDK | 17+ | `brew install openjdk@17` or [adoptium.net](https://adoptium.net) | Gradle build for android-server |
| scrcpy server | 3.3.1 | Auto-fetched via `fetch-scrcpy-server` postinstall | H.264 streaming |

### iOS Simulator (macOS only)

| Dependency | Version | Install | Purpose |
|------------|---------|---------|---------|
| Xcode | 15+ | Mac App Store | `xcrun simctl`, `xcodebuild` |
| Xcode CLI Tools | Latest | `xcode-select --install` | Command-line build tools |
| Appium | Latest | `npm install -g appium` | WebDriverAgent host |
| Appium XCUITest | Latest | `appium driver install xcuitest` | WDA for simulator control |
| Swift (optional) | 5.9+ | Included with Xcode | Build `sim-capture` tool |

### iOS Physical Device (macOS only)

| Dependency | Version | Install | Purpose |
|------------|---------|---------|---------|
| go-ios | Latest | `brew install go-ios` | USB communication + port forwarding |
| WebDriverAgent | Latest | Signed & installed on device | Automation + MJPEG stream |
| qvh (optional) | Latest | Build from source | H.264 QuickTime fallback |

## Quick Start

```bash
cd device-stream

# Install dependencies
npm install

# Build all TypeScript packages
npm run build

# Build sim-capture for iOS Simulator (macOS only, optional)
npm run build:sim-capture
```

## Usage Examples

### Android — Stream + Control via device-server

```typescript
import { ScrcpyService } from '@device-stream/android';

// 1. Start the on-device HTTP server (run once per device)
//    cd packages/android-server && npm run build && npm run start

// 2. Use the device-server HTTP API directly
const res = await fetch('http://localhost:9008/screenshot?quality=80&scale=1');
const jpeg = await res.arrayBuffer();

// Tap
await fetch('http://localhost:9008/tap', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ x: 540, y: 960 }),
});

// Type text
await fetch('http://localhost:9008/type', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ text: 'hello world' }),
});

// Get combined device state (screenshot + UI hierarchy + info)
const state = await fetch('http://localhost:9008/state', { method: 'POST' });
const { screenshot, hierarchy, info } = await state.json();
```

### iOS Simulator — Manage + Stream

```typescript
import {
  createIOSSimulatorManager,
  CaptureService,
  createCaptureService,
} from '@device-stream/ios-simulator';

// Create and boot a simulator
const manager = createIOSSimulatorManager();
const device = await manager.createDevice({
  name: 'Test iPhone',
  deviceType: 'iPhone 15',
  runtime: 'iOS-17-2',
});
await manager.bootDevice(device.udid);

// Stream via ScreenCaptureKit (high-performance binary protocol)
const capture = createCaptureService();
capture.on('frame', (udid, jpegBuffer) => {
  // Send to WebSocket, save to disk, etc.
});
await capture.start(device.udid, { fps: 30, quality: 80 });

// Control via WDA (once WebDriverAgent is running on port 8100)
await fetch('http://localhost:8100/session', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ capabilities: {} }),
});
```

### iOS Physical Device — WDA MJPEG

```typescript
import { DeviceService } from '@device-stream/ios-device';

// go-ios handles USB port forwarding
// WDA MJPEG stream on port 9100, control API on port 8100
const mjpegUrl = 'http://localhost:9100';
const wdaUrl = 'http://localhost:8100';
```

### Test App

A standalone test app is included to verify streaming and input control for all platforms:

```bash
cd device-stream
npx tsx test-app/server.ts
# Open http://localhost:3456
```

The test app auto-detects running device servers and provides a browser UI with:
- Live screen streaming
- Tap (click on screen)
- Swipe (click + drag)
- Hardware keys (Home, Back, etc.)
- Text input

## Android device-server API

Build and start the on-device HTTP server:

```bash
cd packages/android-server
npm run build    # Build APKs via Gradle (once)
npm run start    # Install + port-forward + start
# Or specify a device: npm run start -- emulator-5554
```

This installs an instrumentation test APK that runs a NanoHTTPD server directly on the device, forwarded to `localhost:9008`.

| Endpoint | Method | Latency | Description |
|----------|--------|---------|-------------|
| `/ping` | GET | <10ms | Health check |
| `/screenshot` | GET | ~50-100ms | JPEG screenshot (`?quality=80&scale=1`) |
| `/tap` | POST | ~20-50ms | Tap at coordinates (`{"x":540,"y":960}`) |
| `/swipe` | POST | ~50-100ms | Swipe gesture (`{"startX":..,"startY":..,"endX":..,"endY":..,"steps":10}`) |
| `/type` | POST | ~30-100ms | Type text via clipboard paste (`{"text":"hello"}`) |
| `/key` | POST | ~20ms | Key press (`{"key":"back"}` or `{"keyCode":4}`) |
| `/longPress` | POST | ~50ms | Long press (`{"x":540,"y":960,"durationMs":1000}`) |
| `/hierarchy` | GET | ~100-200ms | UI element tree (`?maxElements=50`) |
| `/info` | GET | ~50ms | Device metadata (screen size, package, activity) |
| `/state` | POST | ~200ms | Combined screenshot + hierarchy + info |
| `/waitForIdle` | POST | ~0-2000ms | Wait for UI idle (`{"timeoutMs":2000}`) |

**Why this is fast:** The server uses `UiAutomation` and `UiDevice` APIs directly on the device, bypassing ADB shell overhead. Typical latency is 20-200ms vs 2-4s for `adb shell` commands.

## iOS Simulator — WDA Setup

```bash
# 1. Boot a simulator
xcrun simctl boot <UDID>

# 2. Build WDA for the simulator (once, ~30s)
WDA_DIR="$HOME/.appium/node_modules/appium-xcuitest-driver/node_modules/appium-webdriveragent"

xcodebuild build-for-testing \
  -project "$WDA_DIR/WebDriverAgent.xcodeproj" \
  -scheme WebDriverAgentRunner \
  -destination "platform=iOS Simulator,id=<UDID>" \
  -derivedDataPath /tmp/wda-build \
  COMPILER_INDEX_STORE_ENABLE=NO

# 3. Install WDA on the simulator
xcrun simctl install <UDID> \
  "$WDA_DIR/build/Debug-iphonesimulator/WebDriverAgentRunner-Runner.app"

# 4. Start WDA (runs on port 8100)
xcodebuild test-without-building \
  -project "$WDA_DIR/WebDriverAgent.xcodeproj" \
  -scheme WebDriverAgentRunner \
  -destination "platform=iOS Simulator,id=<UDID>" \
  -derivedDataPath /tmp/wda-build \
  USE_PORT=8100
```

WDA HTTP API at `http://localhost:8100`:

| Endpoint | Method | Latency | Description |
|----------|--------|---------|-------------|
| `/status` | GET | <10ms | Health check |
| `/screenshot` | GET | ~200-300ms | Base64 PNG screenshot |
| `/session` | POST | ~50ms | Create automation session |
| `/session/:id/actions` | POST | ~300-500ms | Tap, swipe, long press (W3C Actions) |
| `/session/:id/element/:id/value` | POST | ~200ms | Type text into element |
| `/session/:id/source` | GET | ~2-3s | Full UI hierarchy (XML) |
| `/wda/homescreen` | POST | ~100ms | Press Home button |

**Coordinate system:** WDA uses **points** (not pixels). For a 3x retina display, the screenshot is 1179x2556px but coordinates are 393x852 points.

## Architecture

```
device-stream/
├── packages/
│   ├── core/                    # @device-stream/core
│   │   └── src/
│   │       ├── types.ts         # Shared types (Device, FarmDevice, DeviceStatus)
│   │       ├── interfaces.ts    # DeviceService interface
│   │       ├── protocol.ts      # WebSocket protocol
│   │       └── mutex.ts         # Thread-safety utilities
│   │
│   ├── ios-simulator/           # @device-stream/ios-simulator
│   │   └── src/
│   │       ├── simulator-manager.ts   # Simulator lifecycle (create, boot, install, etc.)
│   │       ├── stream-service.ts      # WebSocket relay
│   │       └── capture-service.ts     # ScreenCaptureKit binary protocol
│   │
│   ├── ios-device/              # @device-stream/ios-device
│   │   └── src/
│   │       ├── device-service.ts      # Main service
│   │       ├── go-ios-client.ts       # go-ios CLI wrapper
│   │       ├── wda-client.ts          # WebDriverAgent HTTP client
│   │       ├── mjpeg-client.ts        # MJPEG stream parser
│   │       └── quicktime-capture.ts   # H.264 fallback
│   │
│   ├── android/                 # @device-stream/android
│   │   └── src/
│   │       ├── device-service.ts      # ADB device management
│   │       ├── scrcpy-service.ts      # Scrcpy H.264 streaming
│   │       └── scrcpy-setup.ts        # Server deployment
│   │
│   └── android-server/          # @device-stream/android-server
│       ├── package.json
│       ├── scripts/
│       │   ├── build.sh               # Build APKs via Gradle
│       │   ├── setup.sh               # Check/build APKs
│       │   └── start.sh               # Install + port-forward + start
│       └── gradle-project/
│           ├── app/                    # Stub host APK
│           └── server/                 # Instrumentation test (NanoHTTPD + UiAutomator)
│               └── src/androidTest/java/com/fromapptoviral/deviceserver/
│                   ├── DeviceHttpServer.kt          # HTTP router
│                   ├── DeviceServerInstrumentation.kt # Entry point
│                   └── handlers/                    # Tap, Swipe, Type, Screenshot, etc.
│
├── tools/
│   └── sim-capture/             # ScreenCaptureKit Swift binary (MJPEG encoder)
│
├── test-app/                    # Standalone test viewer
│   ├── server.ts                # HTTP + WS server
│   └── index.html               # Browser UI with streaming + controls
│
└── docs/                        # Documentation
```

## Performance Comparison

| Operation | ADB shell | device-server (9008) | simctl | WDA (8100) |
|-----------|-----------|---------------------|--------|------------|
| Screenshot | ~2-4s | ~50-100ms | ~1-2s | ~200-300ms |
| Tap | ~1-2s | ~20-50ms | N/A | ~300-500ms |
| Swipe | ~1-2s | ~50-100ms | N/A | ~300-500ms |
| Type text | ~2-3s | ~30-100ms | N/A | ~200ms |
| UI Hierarchy | ~3-5s | ~100-200ms | N/A | ~2-3s |
| Combined state | ~8-10s | ~200ms | N/A | N/A |

## Scripts

```bash
npm run build                # Build all packages (core first, then the rest)
npm run build:core           # Build core only
npm run build:android        # Build android package only
npm run build:ios-simulator  # Build ios-simulator package only
npm run build:ios-device     # Build ios-device package only
npm run build:android-server # Build on-device server APKs
npm run build:sim-capture      # Build sim-capture Swift binary (macOS, MJPEG)
npm run build:sim-capture-avcc # Build sim-capture-avcc Swift binary (macOS, H.264 AVCC — Phase D)
npm run build:sim-input        # Build sim-input HID dispatcher (macOS, iOS-26 recipe — Phase D)
npm run build:sim-cam          # Build sim-cam host AVCaptureSession bridge (macOS — Phase E)
npm run build:virtual-camera   # Build VirtualCamera.dylib (macOS — Phase E)
npm run build:phase-d          # sim-capture-avcc + sim-input
npm run build:phase-e          # VirtualCamera + sim-cam
npm run clean                # Clean all dist/ folders
npm run lint                 # TypeScript type-check all packages
npm run test                 # Run tests across all packages
```

## License

MIT
