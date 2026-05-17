# Changelog

All notable changes to this project will be documented in this file.

## [1.1.0] - 2026-03-05

### Added
- `@device-stream/android-server` — On-device HTTP server (NanoHTTPD + UiAutomator) for fast Android automation (~20-200ms latency)
- `CaptureService` in `@device-stream/ios-simulator` — ScreenCaptureKit binary protocol via `sim-capture` Swift tool
- `sim-capture` Swift binary in `tools/sim-capture/` — High-performance MJPEG encoder using ScreenCaptureKit
- `FarmDevice`, `DeviceStatus`, `CreateDeviceOptions` types in `@device-stream/core` for device farm support
- `IOSSimulatorManager` methods: `createDevice`, `bootDevice`, `installApp`, `launchApp`, `deleteDevice`
- Standalone test app (`test-app/`) with browser UI for live streaming, tap, swipe, hardware keys, and text input
- Re-export of core types from `@device-stream/ios-simulator` for convenience

### Changed
- Build order: core package now builds first before other packages (`npm run build`)
- `@device-stream/android` scrcpy service updated for TangoADB latest APIs
- Removed OS restrictions from iOS packages for CI compatibility
- Switched from `npm ci` to `npm install` in CI workflows

### Fixed
- Build failures when core package was not built before dependent packages
- JSON syntax errors in package configuration
- CI pipeline compatibility across platforms

## [1.0.0] - 2025-12-01

### Added
- Initial release
- `@device-stream/core` — Shared types, interfaces (`Device`, `DevicePlatform`, `VideoCodec`), WebSocket protocol, mutex utilities
- `@device-stream/android` — Android streaming via TangoADB + scrcpy 3.3.1 (H.264)
- `@device-stream/ios-simulator` — iOS Simulator streaming via `xcrun simctl` polling + WebSocket relay
- `@device-stream/ios-device` — iOS physical device streaming via WDA MJPEG + go-ios port forwarding, QuickTime H.264 fallback
