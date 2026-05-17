# @device-stream/android

Android device streaming via TangoADB + scrcpy.

## System Requirements

| Requirement | Details |
|-------------|---------|
| **OS** | macOS, Linux, Windows |
| **ADB** | Required - `adb` in PATH |
| **Node.js** | 18+ |

## How It Works

The package uses:
- **TangoADB** (@yume-chan/adb): Pure TypeScript ADB implementation
- **Scrcpy** (@yume-chan/scrcpy): Screen mirroring with H.264 video

```
┌─────────────────────────────────────────────────────────────┐
│  Android Device (USB)                                       │
│  └─ USB debugging enabled                                   │
└─────────────────────────────────────────────────────────────┘
                           │ USB/WiFi
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  ADB Server (port 5037)                                     │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  TangoADB (AdbServerNodeTcpConnector)                       │
│  ├─ Device discovery                                        │
│  ├─ Shell commands                                          │
│  └─ File operations                                         │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  Scrcpy Service                                             │
│  ├─ Pushes scrcpy-server.jar to device                      │
│  ├─ Starts video encoder on device                          │
│  └─ Streams H.264 via WebSocket                             │
└─────────────────────────────────────────────────────────────┘
```

## Setup

### 1. Install ADB

```bash
# macOS
brew install android-platform-tools

# Ubuntu/Debian
sudo apt install adb

# Windows
# Download from https://developer.android.com/studio/releases/platform-tools
```

### 2. Enable USB Debugging

On your Android device:
1. Go to Settings → About Phone
2. Tap "Build Number" 7 times to enable Developer Options
3. Go to Settings → Developer Options
4. Enable "USB Debugging"

### 3. Start ADB Server

```bash
adb start-server
adb devices  # Should show your device
```

### 4. Install the Package

```bash
npm install @device-stream/android
```

## Usage

### Basic Example

```typescript
import {
  androidDeviceService,
  scrcpyService,
} from '@device-stream/android';
import { WebSocket } from 'ws';

// List connected devices
const devices = await androidDeviceService.listDevices();
console.log(devices);
// [{ serial: 'ZF524RZL5D', platform: 'android', model: 'Pixel 7', ... }]

// Connect to device
await androidDeviceService.connect(devices[0].serial);

// Automation
await androidDeviceService.tap(devices[0].serial, 100, 200);
await androidDeviceService.typeText(devices[0].serial, 'Hello World');
const screenshot = await androidDeviceService.screenshot(devices[0].serial);
```

### Streaming with Scrcpy

```typescript
import {
  androidDeviceService,
  scrcpyService,
} from '@device-stream/android';
import { WebSocketServer } from 'ws';

const wss = new WebSocketServer({ port: 8080 });

wss.on('connection', async (ws, req) => {
  const serial = new URL(req.url!, `ws://${req.headers.host}`).searchParams.get('serial');

  // Connect to device
  await androidDeviceService.connect(serial!);

  // Get ADB instance
  const adb = await androidDeviceService.getDevice(serial!);

  // Start streaming
  await scrcpyService.startStream(adb, serial!, ws);
});
```

### Browser Client Example

```typescript
// Connect to stream
const ws = new WebSocket('ws://localhost:8080?serial=ZF524RZL5D');

ws.onmessage = (event) => {
  const packet = JSON.parse(event.data);

  if (packet.type === 'metadata') {
    console.log(`Video: ${packet.width}x${packet.height}, codec: ${packet.codec}`);
    // Initialize WebCodecs decoder
  }

  if (packet.type === 'data') {
    // H.264 NAL units
    const data = new Uint8Array(packet.data);
    // Feed to decoder
  }
};
```

## API Reference

### AndroidDeviceService

```typescript
class AndroidDeviceService extends BaseDeviceService {
  // Device discovery
  listDevices(): Promise<Device[]>;

  // Connection
  connect(serial: string): Promise<void>;
  disconnect(serial: string): Promise<void>;
  getDevice(serial: string): Promise<Adb>;
  getClient(): AdbServerClient;

  // Automation
  tap(serial: string, x: number, y: number): Promise<void>;
  typeText(serial: string, text: string): Promise<void>;
  pressKey(serial: string, key: string): Promise<void>;
  screenshot(serial: string): Promise<Buffer>;
  swipe(serial: string, startX: number, startY: number, endX: number, endY: number, duration?: number): Promise<void>;
  longPress(serial: string, x: number, y: number, duration?: number): Promise<void>;

  // Streaming
  startMirroring(serial: string): Promise<VideoStreamMetadata>;
  stopMirroring(serial: string): Promise<void>;

  // App management
  launchApp(serial: string, packageId: string): Promise<void>;
  forceStopApp(serial: string, packageId: string): Promise<void>;
  clearAppData(serial: string, packageId: string): Promise<void>;
  listPackages(serial: string): Promise<string[]>;

  // UI exploration
  captureUIHierarchy(serial: string): Promise<string>;
  getCurrentApp(serial: string): Promise<string>;
  getCurrentActivity(serial: string): Promise<string>;
}
```

### ScrcpyService

```typescript
class ScrcpyService {
  startStream(adb: Adb, serial: string, ws: WebSocket): Promise<void>;
  stopStream(serial: string): Promise<void>;
  isStreaming(serial: string): boolean;
  getSession(serial: string): ScrcpySession | undefined;
  stopAll(): Promise<void>;
}
```

### ScrcpySetup

```typescript
class ScrcpySetup {
  getVersion(): string;
  pushServerToDevice(adb: Adb): Promise<void>;
  checkServerOnDevice(adb: Adb): Promise<boolean>;
  removeServerFromDevice(adb: Adb): Promise<void>;
  ensureServerReady(adb: Adb, forceReinstall?: boolean): Promise<void>;
  getDeviceServerPath(): string;
}
```

## WebSocket Protocol

### Metadata

Sent once when connection starts:
```json
{
  "type": "metadata",
  "codec": 0,
  "width": 1080,
  "height": 2340
}
```

### Video Data

H.264 NAL units:
```json
{
  "type": "data",
  "data": [0, 0, 0, 1, 103, ...],
  "keyframe": true,
  "pts": "1234567890"
}
```

## Troubleshooting

### "ADB server not running"

```bash
adb start-server
```

### Device not detected

1. Check USB cable and connection
2. Trust the computer when prompted on device
3. Check USB debugging is enabled
4. Try: `adb kill-server && adb start-server`

### Scrcpy server fails to start

The scrcpy server is automatically deployed to `/data/local/tmp/scrcpy-server.jar`. If it fails:

```typescript
// Force reinstall
await scrcpySetup.ensureServerReady(adb, true);
```

### Poor video quality

The default scrcpy settings prioritize low latency. Adjust in code:
```typescript
const options = new AdbScrcpyOptionsLatest({
  video: true,
  videoBitRate: 8_000_000,  // 8 Mbps
  maxFps: 60,
  // ...
});
```

### WebSocket disconnects

Ensure your WebSocket client handles reconnection:
```typescript
function connect() {
  const ws = new WebSocket(url);
  ws.onclose = () => setTimeout(connect, 1000);
  // ...
}
```

## Browser Playback

To play H.264 video in browser, use WebCodecs API:

```typescript
const decoder = new VideoDecoder({
  output: (frame) => {
    ctx.drawImage(frame, 0, 0);
    frame.close();
  },
  error: (e) => console.error(e),
});

decoder.configure({
  codec: 'avc1.640028',  // H.264 High Profile
  codedWidth: metadata.width,
  codedHeight: metadata.height,
});

// On each data packet
const chunk = new EncodedVideoChunk({
  type: packet.keyframe ? 'key' : 'delta',
  timestamp: BigInt(packet.pts),
  data: new Uint8Array(packet.data),
});
decoder.decode(chunk);
```

## Limitations

- ADB server must be running
- USB debugging must be enabled
- Browser needs WebCodecs for H.264 playback
- WiFi ADB may have higher latency
