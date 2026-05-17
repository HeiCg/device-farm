# @device-stream/ios-device

iOS physical device streaming via WebDriverAgent MJPEG + quicktime_video_hack (qvh) H.264 fallback.

## System Requirements

| Requirement | Details |
|-------------|---------|
| **OS** | macOS only |
| **go-ios** | Required - `brew install go-ios` or `npm install -g go-ios` |
| **WebDriverAgent** | Required - must be signed and installed on device |
| **qvh** (optional) | For H.264 fallback - `go install github.com/danielpaulus/quicktime_video_hack@latest` |

## How It Works

### MJPEG Streaming (Primary)

WebDriverAgent exposes an MJPEG stream at port 9100 that provides 30fps video.

```
┌─────────────────────────────────────────────────────────────┐
│  iPhone (USB)                                               │
│  └─ WebDriverAgent.app running                              │
│     └─ MJPEG stream at :9100/stream                         │
└─────────────────────────────────────────────────────────────┘
                           │ USB (port forwarded)
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  Node.js (MjpegStreamClient)                                │
│  └─ Connects to localhost:9100/stream                       │
│  └─ Parses MJPEG boundary, extracts JPEG frames             │
│  └─ Emits 'frame' events                                    │
└─────────────────────────────────────────────────────────────┘
```

### QuickTime Fallback

If MJPEG is not available, the service uses `qvh` (quicktime_video_hack) to capture H.264 video via the QuickTime protocol.

## Setup

### 1. Install go-ios

```bash
# Using Homebrew
brew install go-ios

# Or using npm
npm install -g go-ios
```

Verify installation:
```bash
ios list
```

### 2. Set up WebDriverAgent

WebDriverAgent must be signed with your Apple Developer certificate and installed on the device.

#### Option A: Using Appium

```bash
# Install Appium
npm install -g appium

# Install XCUITest driver
appium driver install xcuitest

# The WDA source is at:
# ~/.appium/node_modules/appium-xcuitest-driver/node_modules/appium-webdriveragent
```

#### Option B: Manual Setup

1. Clone WebDriverAgent:
   ```bash
   git clone https://github.com/appium/WebDriverAgent.git
   ```

2. Open in Xcode:
   ```bash
   open WebDriverAgent/WebDriverAgent.xcodeproj
   ```

3. Sign the project:
   - Select the `WebDriverAgentRunner` target
   - In Signing & Capabilities, select your team
   - Change bundle ID to a unique value (e.g., `com.yourname.wda`)

4. Build and run on device:
   ```bash
   xcodebuild -project WebDriverAgent.xcodeproj \
     -scheme WebDriverAgentRunner \
     -destination 'platform=iOS,id=<your-device-udid>' \
     test
   ```

### 3. iOS 17+ Tunnel (if needed)

For iOS 17+, you may need to start the tunnel:
```bash
sudo ios tunnel start
```

### 4. (Optional) Install qvh for H.264 fallback

```bash
# Install Go
brew install go

# Install qvh
go install github.com/danielpaulus/quicktime_video_hack@latest

# Add to PATH
sudo ln -s ~/go/bin/quicktime_video_hack /usr/local/bin/qvh

# Verify
qvh --help
```

## Usage

### Basic Example

```typescript
import {
  iosDeviceService,
  mjpegStreamClient,
} from '@device-stream/ios-device';

// List connected devices
const devices = await iosDeviceService.listDevices();
console.log(devices);
// [{ serial: '00008110-...', platform: 'ios', model: 'iPhone 15 Pro', ... }]

// Connect to first device
await iosDeviceService.connect(devices[0].serial);

// Start MJPEG streaming
const metadata = await iosDeviceService.startMirroring(devices[0].serial);
console.log(metadata);
// { codec: 'mjpeg', width: 1179, height: 2556, frameRate: 30 }

// Listen for frames
mjpegStreamClient.on('frame', ({ udid, data }) => {
  // data is a Buffer containing JPEG
  console.log(`Frame from ${udid}: ${data.length} bytes`);
});

// Automation
await iosDeviceService.tap(devices[0].serial, 100, 200);
await iosDeviceService.typeText(devices[0].serial, 'Hello World');
await iosDeviceService.screenshot(devices[0].serial);
```

### With QuickTime Fallback

```typescript
import {
  iosDeviceService,
  quickTimeCapture,
} from '@device-stream/ios-device';

// QuickTime capture is used automatically if MJPEG is not available
const metadata = await iosDeviceService.startMirroring(serial);

if (metadata.codec === 'h264') {
  // Using QuickTime capture
  quickTimeCapture.on('videoData', ({ udid, data }) => {
    // data is a Buffer containing H.264 NAL units
    console.log(`H.264 data from ${udid}: ${data.length} bytes`);
  });
}
```

## Configuration

Set via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `WDA_PORT` | 8100 | WebDriverAgent control port |
| `MJPEG_PORT` | 9100 | MJPEG stream port |
| `WDA_BUNDLE_ID` | `com.facebook.WebDriverAgentRunner.xctrunner` | WDA bundle ID |
| `IOS_TIMEOUT` | 30000 | Connection timeout (ms) |
| `WDA_SESSION_RETRIES` | 3 | Session creation retries |
| `IOS_HEALTH_CHECK_INTERVAL` | 30000 | Health check interval (ms) |
| `IOS_PREFER_MJPEG` | true | Prefer MJPEG over QuickTime |

## API Reference

### IOSDeviceService

```typescript
class IOSDeviceService extends BaseDeviceService {
  // Device discovery
  checkAvailability(): Promise<{ available: boolean; missing: string[] }>;
  listDevices(): Promise<Device[]>;

  // Connection
  connect(serial: string): Promise<void>;
  disconnect(serial: string): Promise<void>;

  // Automation
  tap(serial: string, x: number, y: number): Promise<void>;
  typeText(serial: string, text: string): Promise<void>;
  pressKey(serial: string, key: string): Promise<void>;
  screenshot(serial: string): Promise<Buffer>;
  swipe(serial: string, startX: number, startY: number, endX: number, endY: number, duration?: number): Promise<void>;
  scroll(serial: string, direction: ScrollDirection, distance?: number): Promise<void>;
  longPress(serial: string, x: number, y: number, duration?: number): Promise<void>;

  // Streaming
  startMirroring(serial: string): Promise<VideoStreamMetadata>;
  stopMirroring(serial: string): Promise<void>;
  getStreamMode(serial: string): 'mjpeg' | 'quicktime' | undefined;

  // App management
  launchApp(serial: string, bundleId: string): Promise<void>;
  terminateApp(serial: string, bundleId: string): Promise<void>;
  activateApp(serial: string, bundleId: string): Promise<void>;

  // UI exploration
  captureUIHierarchy(serial: string): Promise<string>;
  getCurrentApp(serial: string): Promise<string>;
  getCurrentActivity(serial: string): Promise<string>;

  // Health monitoring
  healthCheck(serial: string): Promise<boolean>;
  startHealthChecks(intervalMs?: number): void;
  stopHealthChecks(): void;
}
```

### MjpegStreamClient

```typescript
class MjpegStreamClient extends EventEmitter {
  isAvailable(): Promise<boolean>;
  connect(udid: string, port?: number): void;
  disconnect(udid: string): void;
  disconnectAll(): void;
  isConnected(udid: string): boolean;
  getActiveStreamCount(): number;
}

// Events
mjpegStreamClient.on('frame', ({ udid, data: Buffer }) => {});
mjpegStreamClient.on('connected', ({ udid }) => {});
mjpegStreamClient.on('disconnected', ({ udid }) => {});
mjpegStreamClient.on('error', ({ udid, error }) => {});
```

### QuickTimeCapture

```typescript
class QuickTimeCapture extends EventEmitter {
  isAvailable(): Promise<boolean>;
  startCapture(udid: string): Promise<void>;
  stopCapture(udid: string): Promise<void>;
  stopAll(): Promise<void>;
  isCapturing(udid: string): boolean;
  cleanup(): void;
}

// Events
quickTimeCapture.on('videoData', ({ udid, data: Buffer }) => {});
quickTimeCapture.on('stopped', ({ udid }) => {});
```

## Troubleshooting

### "go-ios not found"

Install go-ios:
```bash
brew install go-ios
# or
npm install -g go-ios
```

### "WebDriverAgent not available"

1. Ensure WDA is signed and installed on the device
2. Check that WDA bundle ID matches your configuration
3. For iOS 17+, run `sudo ios tunnel start`

### Device not detected

1. Trust the computer on the iOS device
2. Check USB connection: `ios list`
3. Try restarting the device

### MJPEG stream not working

1. Check port 9100 is not blocked
2. Verify WDA is running: `curl http://localhost:8100/status`
3. Try starting WDA manually: `ios runwda --udid=<udid> --bundleid=<bundleid>`

## Limitations

- macOS only (USB connection required)
- WebDriverAgent must be signed and installed
- MJPEG requires WDA running
- QuickTime fallback requires `qvh` installed
- iOS 17+ requires tunnel for port forwarding
