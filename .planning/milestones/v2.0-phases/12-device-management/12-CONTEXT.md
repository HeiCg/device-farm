# Phase 12: Device Management - Context

**Gathered:** 2026-04-15
**Status:** Ready for planning

<domain>
## Phase Boundary

Replace the existing pool manager device drivers (AndroidEmulatorDriver, IosSimulatorDriver) with @device-stream/* packages for full device lifecycle management — boot, shutdown, health checks, and cleanup. The PoolManager allocation layer (mutex, state machine, device map) stays but drivers are replaced.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — pure infrastructure phase.

Key integration points discovered during codebase scout:
- `@device-stream/android` (AndroidDeviceService) handles ADB communication via TangoADB but does NOT manage emulator processes directly. Android emulator spawning (AVD creation, `emulator` process) must be retained or adapted.
- `@device-stream/ios-simulator` (IOSSimulatorManager) handles full simulator lifecycle (create, boot, shutdown, delete) via appium-ios-simulator. Can fully replace IosSimulatorDriver.
- The DeviceDriver interface (create, boot, shutdown, isHealthy, cleanup) needs new implementations that wrap device-stream APIs.
- device-stream packages are published to GitHub Packages under `@device-stream` scope. Source lives at `/Users/heicg/Desktop/projects/device-stream/`.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `server/pool/pool-manager.ts` — PoolManager with mutex allocation, device state machine, FIFO ordering. Keep this layer.
- `server/pool/types.ts` — DeviceDriver interface (create, boot, shutdown, isHealthy, cleanup). New drivers implement this.
- `server/pool/device.ts` — Device class with state transitions. Keep as-is.
- `server/pool/health-checker.ts` — HealthChecker with backoff, zombie detection, device replacement. Adapt to use new drivers.
- `server/pool/process-tracker.ts` — ProcessTracker for PID tracking and orphan reaping. May simplify for Android if emulator process management changes.
- `server/pool/zombie-detector.ts` — Zombie process detection. Keep for Android emulators.
- `server/streaming/device-preview.ts` — DevicePreviewManager with DeviceStreamAdapter interface. Already prepared for @device-stream integration.

### Established Patterns
- Fastify plugin system with decorator pattern (`fastify.pool`, `fastify.healthChecker`)
- DeviceDriver interface as abstraction layer between PoolManager and platform specifics
- Platform config via Zod-validated YAML (`config.pool.android`, `config.pool.ios`)
- `withTimeout()` wrapper for all boot/health operations
- Event-driven health checks on 30s interval

### Integration Points
- `server/pool/plugin.ts` — Registers drivers and creates PoolManager. Entry point for new driver registration.
- `server/config/schema.ts` — Pool config schema (android/ios sections). May need updates for device-stream config.
- `server/index.ts` — Plugin registration order (pool is #3 after config and dependency-checker).
- `server/jobs/` — Job execution calls `pool.allocate()`, `pool.markRunning()`, `pool.release()`. These stay unchanged.

### Device-Stream API Surface
- `@device-stream/core`: DeviceService interface, Device type, FarmDevice type, DeviceStatus, DeviceMutexManager
- `@device-stream/android`: AndroidDeviceService (listDevices, connect, disconnect, screenshot, startMirroring via TangoADB). No emulator lifecycle.
- `@device-stream/ios-simulator`: IOSSimulatorManager (createDevice, startDevice, stopDevice, deleteDevice, installApp, full lifecycle). CaptureService for streaming.

</code_context>

<specifics>
## Specific Ideas

No specific requirements — infrastructure phase.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>
