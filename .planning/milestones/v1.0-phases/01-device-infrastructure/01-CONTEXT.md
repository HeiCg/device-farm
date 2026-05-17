# Phase 1: Device Infrastructure - Context

**Gathered:** 2026-03-09
**Status:** Ready for planning

<domain>
## Phase Boundary

Config system, pool manager for Android/iOS emulators, health checks, and process lifecycle. Server reads config, boots emulators, manages their state machine, runs health checks, and handles graceful shutdown. No job execution, no API routes, no UI — just reliable device management.

Requirements: INFRA-01 through INFRA-08.

</domain>

<decisions>
## Implementation Decisions

### Server Scaffold & HTTP Framework
- Fastify as HTTP framework — schema-based validation, first-class TypeScript, WebSocket via @fastify/websocket
- Single process: Fastify serves API + WebSocket + SvelteKit frontend (one port, simpler deployment on Mac Mini)
- Flat project structure: server/, client/, cli/ at root level — no npm workspaces
- device-stream integrated as npm dependency (`@device-stream/android`, `@device-stream/ios-simulator`, etc.) — not git submodule

### Emulator Lifecycle
- Auto-create AVDs/simulators at server startup if they don't exist — zero manual setup, just configure and run
- Boot all configured devices at startup — instant allocation when jobs arrive, no boot delay
- Boot detection: `adb wait-for-device` + poll `sys.boot_completed` for Android; `xcrun simctl bootstatus` for iOS
- Cleanup between jobs via snapshot restore — save clean snapshot after initial boot, restore after each job (~2-5s vs cold boot)
- For iOS: `xcrun simctl erase` (no snapshot equivalent)

### Health Check & Recovery
- Multi-signal health check: process alive + ADB responsive (Android) or simctl status (iOS) — both must pass
- Health check interval: every 30 seconds, all devices checked in parallel
- On failure: 3 restart attempts with exponential backoff (5s, 15s, 45s) — third attempt includes full wipe
- After 3 failures: mark device as 'offline', log error, pool continues with remaining devices
- Running job on failed device: fail immediately with infrastructure error message — no auto-retry, CI decides whether to resubmit

### Config Validation & Startup
- Validate dependencies at startup: check emulator, adb, avdmanager, xcrun simctl, ffmpeg, maestro exist in PATH — fail fast with clear error and install instructions
- Env var overrides for key values: DEVICE_FARM_PORT, DEVICE_FARM_CONFIG, DATABASE_URL — priority: env > YAML > defaults (deep nested config like pool details stays YAML-only)
- Graceful shutdown on SIGTERM/SIGINT: stop accepting jobs, wait for running jobs (max 5min timeout), cancel remaining, kill emulator processes cleanly, close DB, exit 0
- Queued jobs stay in DB as 'queued' for next server start

### Claude's Discretion
- Exact Zod schema structure for config validation
- Process group management implementation details (INFRA-08)
- Internal event system for state machine transitions
- Logging framework choice (pino recommended with Fastify)

</decisions>

<specifics>
## Specific Ideas

- device-stream repo (github.com/HeiCg/device-stream) is the streaming dependency — its own deps (go-ios, scrcpy, ADB, Xcode) become our runtime requirements
- device-stream packages: @device-stream/core, @device-stream/android, @device-stream/ios-simulator, @device-stream/ios-device, @device-stream/android-server
- device-stream Android requires: ADB, Android SDK (API 28+), Java 17+, scrcpy server 3.3.1
- device-stream iOS simulator requires: Xcode 15+, ScreenCaptureKit
- device-stream iOS device requires: go-ios for USB, WebDriverAgent
- Startup dependency check should include device-stream's requirements (scrcpy, go-ios if iOS device support enabled)

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- No existing code — greenfield project. Implementation plan doc (docs/plan/implementation-plan.md) has detailed architecture, DB schema, and API design to reference.

### Established Patterns
- None yet — Phase 1 establishes the foundational patterns (Fastify plugin structure, service layer, config loading)

### Integration Points
- device-stream npm packages provide streaming APIs that will be consumed in later phases
- PostgreSQL + Drizzle ORM for device state persistence
- Config system established here will be used by all subsequent phases

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 01-device-infrastructure*
*Context gathered: 2026-03-09*
