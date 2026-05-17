# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Device-Stream is a modular npm monorepo for mobile device video streaming and control across iOS simulators, iOS physical devices, and Android devices. Published to GitHub Packages under the `@device-stream` scope.

## Build & Development Commands

```bash
npm install                    # Install all dependencies (also fetches scrcpy server via postinstall)
npm run build                  # Build all packages (core first, then others in parallel)
npm run build:core             # Build only @device-stream/core
npm run build:android          # Build only @device-stream/android
npm run build:ios-simulator    # Build only @device-stream/ios-simulator
npm run build:ios-device       # Build only @device-stream/ios-device
npm run lint                   # TypeScript type-check across all workspaces (tsc --noEmit)
npm run test                   # Run tests across all workspaces
npm run clean                  # Remove all dist/ directories

# Android on-device server (Kotlin/Gradle)
npm run build:android-server   # Build debug + instrumentation APKs
cd packages/android-server && npm run start -- <device-serial>  # Deploy and start server

# iOS sim-capture Swift binary
npm run build:sim-capture      # Build via scripts/build-mirrorkit.sh

# Test app
npx tsx test-app/server.ts     # Starts dev server at http://localhost:3456
```

## Architecture

### Monorepo Packages (`packages/`)

All platform packages implement the `DeviceService` interface from core (listDevices, connect, tap, typeText, screenshot, swipe, startMirroring, etc.).

- **`core`** — Shared types (`Device`, `VideoStreamMetadata`, `FarmDevice`), interfaces (`DeviceService`, `BaseDeviceService`), WebSocket protocol message constructors, and `AsyncMutex`/`DeviceMutexManager` for per-device concurrency control. All other packages depend on this — it must build first.

- **`android`** — Android streaming via TangoADB (`@yume-chan/adb`) + scrcpy H.264. `AndroidDeviceService` extends `BaseDeviceService`. Uses `ScrcpyService` for frame buffering and WebSocket relay.

- **`ios-simulator`** — iOS Simulator management via `appium-ios-simulator`. `IOSSimulatorManager` handles full lifecycle (create/boot/install/launch/delete). `CaptureService` spawns the native `sim-capture` Swift binary for ~30fps MJPEG via ScreenCaptureKit.

- **`ios-device`** — iOS physical device control via go-ios (port forwarding) + WebDriverAgent. `GoIOSClient` wraps the go-ios CLI. `WDAClient` implements W3C Actions API over HTTP. `MJPEGClient` parses MJPEG stream boundaries.

- **`android-server`** — Private package. On-device TCP JSON-RPC server using UiAutomator (Kotlin). Native source lives in `native-servers/android-device-server/`. Requires Android SDK, Java 17, Gradle.

### Native Components

- **`native-servers/android-device-server/`** — Kotlin Android instrumentation test that runs a JSON-RPC server on TCP port 9008
- **`tools/sim-capture/`** — Swift binary using ScreenCaptureKit for iOS simulator MJPEG capture

### Key Patterns

- **WebSocket protocol** (`core/protocol.ts`): Binary message format with types METADATA, FRAME, DATA, PING/PONG, COMMAND. Codec enums: H264=0, MJPEG=1, H265=2.
- **Per-device mutex** (`core/mutex.ts`): `DeviceMutexManager` prevents race conditions on concurrent device operations.
- **Connection tracking**: `BaseDeviceService` maintains a `Map<serial, DeviceConnection>` with `assertConnected()` guards.

## TypeScript Configuration

- Target: ES2022, Module: CommonJS, Strict mode enabled
- Each package has its own `tsconfig.json` extending the root config
- Node 18+ required

## CI/CD

- **ci.yml**: Builds and lints on push/PR to main (Ubuntu, Node 20)
- **publish.yml**: Publishes each public package to GitHub Packages on release (continues on individual package failure)

## Publishing

Packages publish to GitHub Packages registry (`npm.pkg.github.com`). Requires `GITHUB_TOKEN` environment variable. The `android-server` package is private and not published.
