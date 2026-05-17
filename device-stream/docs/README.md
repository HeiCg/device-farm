# @device-stream

Modular npm packages for mobile device video streaming - iOS simulators, iOS physical devices, and Android devices.

## Packages

| Package | Description |
|---------|-------------|
| `@device-stream/core` | Shared types, interfaces, and utilities |
| `@device-stream/ios-simulator` | iOS Simulator streaming via ScreenCaptureKit + polling fallback |
| `@device-stream/ios-device` | iOS physical device streaming via WDA MJPEG + qvh H.264 |
| `@device-stream/android` | Android streaming via TangoADB + scrcpy |

## Quick Start

### Installation

```bash
# Install all packages
npm install @device-stream/core @device-stream/ios-simulator @device-stream/ios-device @device-stream/android

# Or install individually
npm install @device-stream/android
```

### iOS Simulator Streaming

```typescript
import {
  IOSSimulatorManager,
  SimulatorStreamService,
} from '@device-stream/ios-simulator';

// Create manager
const manager = new IOSSimulatorManager({
  bootTimeout: 120000,
  // sim-capture binary is auto-detected from tools/sim-capture/
});

// Create and boot simulator
const device = await manager.createDevice({
  platform: 'ios',
  deviceType: 'com.apple.CoreSimulator.SimDeviceType.iPhone-15-Pro',
});
await manager.startDevice(device.id);

// Start streaming
await manager.startStreaming(device.id, 'localhost', 5001);

// Create stream service for WebSocket handling
const streamService = new SimulatorStreamService();
// Handle WebSocket connections in your server
```

### iOS Physical Device Streaming

```typescript
import { iosDeviceService, mjpegStreamClient } from '@device-stream/ios-device';

// List connected devices
const devices = await iosDeviceService.listDevices();

// Connect to device
await iosDeviceService.connect(devices[0].serial);

// Start MJPEG streaming
const metadata = await iosDeviceService.startMirroring(devices[0].serial);

// Listen for frames
mjpegStreamClient.on('frame', ({ udid, data }) => {
  // data is a Buffer containing JPEG
  console.log(`Frame from ${udid}: ${data.length} bytes`);
});

// Automation
await iosDeviceService.tap(devices[0].serial, 100, 200);
await iosDeviceService.typeText(devices[0].serial, 'Hello');
```

### Android Device Streaming

```typescript
import {
  androidDeviceService,
  scrcpyService,
} from '@device-stream/android';

// List connected devices
const devices = await androidDeviceService.listDevices();

// Connect to device
await androidDeviceService.connect(devices[0].serial);

// Get ADB instance for scrcpy
const adb = await androidDeviceService.getDevice(devices[0].serial);

// Start scrcpy stream (WebSocket required)
await scrcpyService.startStream(adb, devices[0].serial, websocket);

// Automation
await androidDeviceService.tap(devices[0].serial, 100, 200);
await androidDeviceService.typeText(devices[0].serial, 'Hello');
```

## WebSocket Protocol

All packages use a standardized WebSocket message format:

### Metadata (sent once on connection)
```json
{
  "type": "metadata",
  "codec": 1,
  "codecName": "mjpeg",
  "width": 1179,
  "height": 2556,
  "fps": 30
}
```

### Frame (MJPEG)
```json
{
  "type": "frame",
  "data": "<base64-encoded-jpeg>",
  "pts": 1234,
  "codec": "mjpeg"
}
```

### Data (H.264)
```json
{
  "type": "data",
  "data": [0, 0, 0, 1, ...],
  "keyframe": true,
  "pts": "1234567890"
}
```

## System Requirements

See individual package documentation:
- [iOS Simulator](./ios-simulator.md)
- [iOS Device](./ios-device.md)
- [Android](./android.md)

## License

MIT
