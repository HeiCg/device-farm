---
phase: 03-real-time-and-storage
verified: 2026-03-10T20:30:00Z
status: human_needed
score: 13/13 must-haves verified
re_verification:
  previous_status: gaps_found
  previous_score: 11/13
  gaps_closed:
    - "Videos older than compress_after_days are re-encoded at lower quality automatically"
    - "TypeScript project compiles cleanly (full tsc --noEmit for Phase 3 files)"
  gaps_remaining: []
  regressions: []
human_verification:
  - test: "WebSocket late-join replay over the wire"
    expected: "A client connecting to /ws/jobs/:id after messages were emitted receives buffered history immediately before live stream begins"
    why_human: "The JobBroadcaster unit tests verify buffer replay logic. End-to-end WS connection behavior (actual socket handshake + replay over the wire) requires a running server."
  - test: "Device preview live streaming"
    expected: "A client connecting to /ws/devices/:id/preview receives base64-encoded JPEG/PNG frames at up to 10fps while a device preview is active"
    why_human: "DevicePreviewManager.defaultAdapterFactory intentionally throws at runtime if no @device-stream adapter is provided. Requires real device or complete adapter implementation for end-to-end test."
  - test: "ffmpeg video recording produces valid MP4"
    expected: "After job completes, recording.mp4 in storage/artifacts/{jobId}/ plays back and shows the test session"
    why_human: "RecordingService unit tests verify process spawn/stop. Actual ffmpeg output validity requires running hardware with device-stream frames flowing."
---

# Phase 3: Real-Time and Storage Verification Report

**Phase Goal:** Users can observe test execution live (logs, video, device screen) and artifacts are stored with automatic lifecycle management
**Verified:** 2026-03-10T20:30:00Z
**Status:** human_needed
**Re-verification:** Yes — after gap closure (previous status: gaps_found, score: 11/13)

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | WS message types defined and exported for all event kinds | VERIFIED | `server/streaming/types.ts` exports `WsMessageType`, `JobMessage`, `DevicePreviewMessage`, `LogData`, `StepData`, `MetricsData`, `StatusData`, `LogcatData`, `ArtifactType` (43 lines) |
| 2 | Artifacts table exists in DB schema replacing recordings | VERIFIED | `server/db/schema.ts` exports `artifacts` pgTable with `artifactTypeEnum`, 3 indexes; no `recordings` table present |
| 3 | Config schema includes `storage.artifacts.path` | VERIFIED | `server/config/schema.ts` defines `artifactsSchema` with `path: z.string().default('./storage/artifacts')`, all retention/compress fields present |
| 4 | WS clients receive log/step/metrics/status events; late-joiners get buffered replay | VERIFIED | `JobBroadcaster` (68 lines) implements ring buffer (MAX=200), `subscribe()` replays buffer then attaches live listener, `cleanup()` removes buffer. `websocket-plugin.ts` subscribes synchronously on socket open |
| 5 | Video recording starts when job begins and produces MP4 when stopped | VERIFIED* | `RecordingService.startRecording()` spawns ffmpeg with `image2pipe` input, `detached:true`. `stopRecording()` closes stdin and awaits exit. Integrated in `job-service.ts` line 232. *Runtime validity needs human verification |
| 6 | Screenshots captured via platform-native tools when step fails | VERIFIED | `ScreenshotService.capture()` uses `execFile('adb', ...)` for Android and `execFile('xcrun', ...)` for iOS. `job-service.ts` hooks `onFlowResult` — fires screenshot capture when `status === 'Failed'` (line 315) |
| 7 | ADB logcat streams to file and callback during job execution | VERIFIED | `LogcatService.start()` spawns `adb logcat` with readline interface, writes each line to file and calls `onLine`. Integrated in `job-service.ts` line 253 for `platform === 'android'` |
| 8 | Memory metrics sampled via adb dumpsys meminfo | VERIFIED | `MemoryService.startSampling()` uses `execFile('adb', [..., 'dumpsys', 'meminfo', ...])` on interval. Parses TOTAL/Native Heap/Dalvik Heap lines. Integrated in `job-service.ts` line 271 |
| 9 | Device preview manager starts/stops device-stream and relays frames | VERIFIED | `DevicePreviewManager` uses adapter pattern with `startPreview()/subscribe()/stopPreview()`. Frame fan-out to multiple subscribers. `websocket-plugin.ts` subscribes (line 93) and relays as base64 JSON with 10fps throttle |
| 10 | Artifacts stored on filesystem with paths in DB | VERIFIED | `ArtifactService.createArtifact()` inserts into `artifacts` table. `job-service.ts` creates records for video, logcat, memory, log, and screenshots in `finally` block |
| 11 | Artifacts downloadable via API | VERIFIED | `routes.ts` implements `GET /jobs/:id/artifacts` (listByJob) and `GET /jobs/:id/artifacts/:artifactId` (getById + ownership check + file access check + streaming with Content-Type/Content-Disposition) |
| 12 | Videos older than compress_after_days are re-encoded automatically | VERIFIED | `compression-task.ts` queries old uncompressed videos and re-encodes with ffmpeg. `lifecycle-plugin.ts` schedules daily at 3AM. **Gap closed: `dependencies: ['config', 'db']` is now correct** (line 98) |
| 13 | TypeScript Phase 3 files compile cleanly | VERIFIED | All four previously-failing Phase 3 test files (`artifact-routes.test.ts`, `routes.test.ts`, `recording-service.test.ts`, `screenshot-service.test.ts`) now produce zero `tsc --noEmit` errors. 20 remaining errors are in Phase 1 scope files (`server/pool/__tests__/*`, `server/jobs/__tests__/job-executor.test.ts`) and are outside this phase's scope |

**Score:** 13/13 truths verified

### Required Artifacts

| Artifact | Lines | Status | Details |
|----------|-------|--------|---------|
| `server/streaming/types.ts` | 43 | VERIFIED | Exports all required types unchanged |
| `server/streaming/job-broadcaster.ts` | 68 | VERIFIED | Ring buffer, emit, subscribe with replay, cleanup |
| `server/streaming/websocket-plugin.ts` | 151 | VERIFIED | Registers `@fastify/websocket`, decorates `jobBroadcaster` and `devicePreview`, ping/pong, two WS routes |
| `server/streaming/device-preview.ts` | 98 | VERIFIED | DevicePreviewManager with adapter pattern, startPreview/subscribe/stopPreview |
| `server/artifacts/recording-service.ts` | 124 | VERIFIED | startRecording/stopRecording/killRecording with spawn and processTracker |
| `server/artifacts/screenshot-service.ts` | 56 | VERIFIED | capture() for android (execFile adb) and ios (execFile xcrun) |
| `server/artifacts/logcat-service.ts` | 88 | VERIFIED | start/stop with spawn adb logcat, readline, file + callback |
| `server/artifacts/memory-service.ts` | 115 | VERIFIED | startSampling/stopSampling/writeSamples with execFile adb dumpsys meminfo |
| `server/artifacts/artifact-service.ts` | 127 | VERIFIED | createArtifact/listByJob/getById/deleteByJob/ensureJobDir/getArtifactPath/getFileSize |
| `server/lifecycle/compression-task.ts` | 132 | VERIFIED | runCompressionTask with ffmpeg spawn, DB update, error handling per artifact |
| `server/lifecycle/retention-task.ts` | 94 | VERIFIED | runRetentionTask with filesystem rm + DB delete, job dir cleanup |
| `server/lifecycle/disk-pressure-task.ts` | 92 | VERIFIED | runDiskPressureTask with SUM query, oldest-first deletion |
| `server/lifecycle/lifecycle-plugin.ts` | 99 | VERIFIED | cron.schedule present; mutex-protected runs; `dependencies: ['config', 'db']` now correct |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `streaming/websocket-plugin.ts` | `streaming/job-broadcaster.ts` | `fastify.decorate('jobBroadcaster', ...)` | WIRED | Line 26 |
| `streaming/websocket-plugin.ts` | `@fastify/websocket` | `register(websocket)` | WIRED | Line 22 |
| `streaming/job-broadcaster.ts` | `streaming/types.ts` | `import type { JobMessage }` | WIRED | Line 2 |
| `artifacts/recording-service.ts` | ffmpeg | `spawn('ffmpeg', [...])` | WIRED | Line 30 |
| `artifacts/screenshot-service.ts` | adb/xcrun | `execFile('adb'...)` / `execFile('xcrun'...)` | WIRED | Lines 36/48 |
| `artifacts/logcat-service.ts` | adb logcat | `spawn('adb', [..., 'logcat', ...])` | WIRED | Line 48 |
| `artifacts/memory-service.ts` | adb dumpsys | `execFileFn('adb', [..., 'dumpsys', ...])` | WIRED | Lines 41-43 |
| `streaming/device-preview.ts` | `@device-stream/*` | adapter pattern with dynamic import | PARTIAL | `defaultAdapterFactory` throws intentionally; real adapters must be injected. Intentional design. |
| `jobs/job-service.ts` | `artifacts/recording-service.ts` | `recordingService.startRecording/stopRecording` | WIRED | Lines 232, 401 |
| `jobs/job-service.ts` | `streaming/device-preview.ts` | `devicePreviewManager.startPreview/stopPreview` | WIRED | Lines 221, 390, 425 |
| `jobs/job-service.ts` | device frames -> ffmpeg | `devicePreviewManager.subscribe(deviceId, frame => ffmpegWritable.write(frame))` | WIRED | Line 237 |
| `jobs/job-service.ts` | `streaming/job-broadcaster.ts` | `jobBroadcaster.emit(...)` | WIRED | 9 emit calls covering status, step, log, logcat, metrics |
| `api/routes.ts` | `artifacts/artifact-service.ts` | `artifactService.listByJob/getById` | WIRED | Lines 180, 192 |
| `streaming/websocket-plugin.ts` | `streaming/device-preview.ts` | `devicePreview.subscribe(...)` | WIRED | Line 93 |
| `lifecycle/lifecycle-plugin.ts` | `node-cron` | `cron.schedule(...)` | WIRED | Lines 38, 67 |
| `lifecycle/compression-task.ts` | ffmpeg | `spawnFn('ffmpeg', [...])` | WIRED | Line 71 |
| `lifecycle/retention-task.ts` | `db/schema.ts` | `schema.artifacts.createdAt` | WIRED | Lines 40-41 |
| `lifecycle/disk-pressure-task.ts` | `db/schema.ts` | `SUM(fileSizeBytes)` | WIRED | Line 36 |
| `lifecycle/lifecycle-plugin.ts` | config/db | plugin dependencies | WIRED | `dependencies: ['config', 'db']` — matches registered plugin names (gap closed) |

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|-------------|---------------|-------------|--------|---------|
| REAL-01 | 03-02, 03-05 | WebSocket streams logs + steps in real time | SATISFIED | `job-broadcaster.ts` + `websocket-plugin.ts` + `job-service.ts` emit events; 244/244 tests pass |
| REAL-02 | 03-04, 03-05 | Live preview of Android emulator via device-stream | SATISFIED* | `DevicePreviewManager` with adapter pattern; `/ws/devices/:id/preview` route. *Real device-stream adapter is an intentional injection point |
| REAL-03 | 03-04, 03-05 | Live preview of iOS simulator via device-stream | SATISFIED* | Same DevicePreviewManager; iOS adapter via `IosStreamAdapter` pattern. *Real adapter injection point |
| REAL-04 | 03-03, 03-05 | Video recording (ffmpeg -> MP4) saved as artifact | SATISFIED | `RecordingService` + `job-service.ts` integration + `artifacts` DB record created |
| REAL-05 | 03-03, 03-05 | Screenshot on step failure | SATISFIED | `ScreenshotService.capture()` called in `onFlowResult` when `status === 'Failed'` |
| REAL-06 | 03-04, 03-05 | ADB logcat as stream/artifact | SATISFIED | `LogcatService` + logcat.txt artifact created in `finally` block |
| REAL-07 | 03-04, 03-05 | Memory metrics during execution | SATISFIED | `MemoryService` + memory.json artifact created in `finally` block |
| STOR-01 | 03-01, 03-05 | Artifacts stored on filesystem with paths in DB | SATISFIED | `ArtifactService` + `artifacts` table + `job-service.ts` creates DB records for all artifact types |
| STOR-02 | 03-06 | Cron compresses videos after N days | SATISFIED | `compression-task.ts` logic correct; `lifecycle-plugin.ts` dependency names fixed |
| STOR-03 | 03-06 | Cron deletes artifacts after retention_days | SATISFIED | `retention-task.ts` logic correct; lifecycle-plugin dependency names fixed |
| STOR-04 | 03-06 | Cron monitors disk and deletes oldest if over max_storage_gb | SATISFIED | `disk-pressure-task.ts` logic correct; lifecycle-plugin dependency names fixed |
| STOR-05 | 03-05 | Artifacts available for download via API | SATISFIED | `GET /jobs/:id/artifacts` and `GET /jobs/:id/artifacts/:artifactId` with ownership check and file streaming |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `server/streaming/device-preview.ts` | 93-97 | `defaultAdapterFactory` throws at runtime if no adapter injected | Info | Intentional design — production use requires adapter injection. Not a bug. |
| `server/pool/__tests__/*`, `server/jobs/__tests__/job-executor.test.ts` | various | pino Logger `never` vs `string` generic mismatch causing 20 `tsc --noEmit` errors | Warning (pre-existing, Phase 1 scope) | Phase 1 files outside Phase 3 scope. All vitest tests pass. |

### Human Verification Required

#### 1. WebSocket Late-Join Replay Over the Wire

**Test:** Start a job, let it emit 10+ events, then connect a WebSocket client to `/ws/jobs/:id`. Observe messages received immediately.
**Expected:** Buffered messages (up to 200) arrive synchronously before any new live messages, with correct `type`/`data`/`timestamp` JSON structure.
**Why human:** `JobBroadcaster` unit tests verify the buffer replay logic internally. The actual WS handshake + message delivery over the wire requires a running server.

#### 2. Device Preview Streaming

**Test:** With an Android device active, connect a WebSocket to `/ws/devices/:id/preview` and observe incoming frames.
**Expected:** JSON messages arrive with `{ type: 'frame', data: '<base64>', timestamp: '...' }` at up to 10fps. Frame rate throttle (100ms minimum) prevents flooding.
**Why human:** `DevicePreviewManager.defaultAdapterFactory` throws at runtime without a real `@device-stream` adapter. Requires either a physical/virtual device with the adapter implemented, or the DevicePreviewManager constructor injected with a real adapter.

#### 3. ffmpeg Video Recording Produces Valid MP4

**Test:** Run a complete job on an Android device. After completion, download the `recording.mp4` artifact.
**Expected:** The file plays back and shows the device screen during the test run.
**Why human:** `RecordingService` unit tests verify process lifecycle, but actual ffmpeg output requires frames to be written to stdin. End-to-end validity depends on real device-stream frames flowing into the ffmpeg writable.

### Re-Verification: Gap Closure Summary

Both gaps from the initial verification have been resolved:

**Gap 1 — Lifecycle Plugin Dependency Names (CLOSED)**
`server/lifecycle/lifecycle-plugin.ts` line 98 now reads `dependencies: ['config', 'db']`, correctly matching the registered plugin names used throughout the project. The avvio plugin ordering guarantee for `config` and `db` is now properly enforced.

**Gap 2 — TypeScript Phase 3 Test File Errors (CLOSED)**
All four previously-failing Phase 3 test files (`server/api/__tests__/artifact-routes.test.ts`, `server/api/__tests__/routes.test.ts`, `server/artifacts/__tests__/recording-service.test.ts`, `server/artifacts/__tests__/screenshot-service.test.ts`) now produce zero `tsc --noEmit` errors. The 20 remaining errors are in Phase 1 scope files (`server/pool/__tests__/allocation.test.ts`, `health-checker.test.ts`, `process-tracker.test.ts`, `server/jobs/__tests__/job-executor.test.ts`) which pre-existed before Phase 3 and are outside this phase's scope.

**Regressions:** None. All 13 previously-verified artifacts remain at their original line counts. All 244 vitest tests pass.

The three human verification items carry over unchanged — they require live hardware and a running server and cannot be verified statically.

---

_Verified: 2026-03-10T20:30:00Z_
_Verifier: Claude (gsd-verifier)_
