# Phase 3: Real-Time and Storage - Context

**Gathered:** 2026-03-10
**Status:** Ready for planning

<domain>
## Phase Boundary

Users can observe test execution live (logs, steps, video, device screen) and artifacts are stored with automatic lifecycle management. WebSocket streaming for logs/steps/metrics, live device preview via device-stream, video recording via ffmpeg, screenshot capture on failure, artifact storage with compression and retention. No CLI consumption, no Web UI, no authentication — those are later phases.

Requirements: REAL-01 through REAL-07, STOR-01 through STOR-05.

</domain>

<decisions>
## Implementation Decisions

### WebSocket Protocol
- Single connection per job at `/ws/jobs/:id` — all event types (log, step, metrics, status) on one socket with a `type` field to distinguish
- Separate endpoint for live device preview at `/ws/devices/:id/preview` — device-scoped, keeps job WS lean
- All messages are JSON: `{ type: 'log'|'step'|'metrics'|'status', data: {...}, timestamp }` — including video frames as base64 on the preview endpoint
- Late join: replay recent history on connect — send burst of recent log lines + all steps so far + current status, then stream live
- @fastify/websocket for WebSocket support (planned since Phase 1)

### Video Recording
- Record entire job duration — one MP4 per job, start when Maestro begins, stop when job finishes
- Capture via device-stream + ffmpeg pipe — reuse the same stream that powers live preview, pipe frames to ffmpeg for MP4 encoding
- Works for both Android (@device-stream/android) and iOS (@device-stream/ios-simulator)

### Screenshot Capture
- Platform-native tools: `adb exec-out screencap -p` (Android) and `xcrun simctl io screenshot` (iOS)
- Triggered when MaestroParser detects a step failure
- Saved as PNG in job's screenshots directory

### Logcat & Memory Metrics
- Separate artifact files — logcat.txt and memory.json alongside video/screenshots
- Streamed live via job WebSocket during execution (type: 'logcat', type: 'metrics')
- Stored as downloadable file artifacts after job completes

### Artifact Storage
- Nested by job ID: `storage/artifacts/<job-uuid>/recording.mp4, screenshots/*.png, logcat.txt, memory.json, maestro.log`
- Replace existing `recordings` table with unified `artifacts` table — type column (video, screenshot, logcat, memory, log), tracks each file individually
- Maestro raw log saved both in DB (maestro_output column for quick access) and as file artifact (maestro.log for download)
- Individual artifact downloads via API: GET /api/jobs/:id/artifacts (list), GET /api/jobs/:id/artifacts/:artifactId (download)
- No zip download in v1

### Lifecycle Automation
- In-process scheduling with node-cron — no external crontab setup needed, single-process deployment
- Compression: ffmpeg re-encode to lower quality/bitrate after compress_after_days (config default: 7). Significant size reduction (50-80%)
- Deletion: remove artifacts after retention_days (config default: 30)
- Disk pressure: delete oldest artifacts first when exceeding max_storage_gb (config default: 50)
- Scheduling: compression + retention deletion run daily (off-peak); disk usage check runs hourly
- Cancelled/failed jobs follow normal retention — no immediate cleanup, user may want to inspect
- Lifecycle actions logged via pino (compressed X files, deleted Y, freed Z GB) + summary accessible via health endpoint

### Claude's Discretion
- Exact ffmpeg encoding parameters (CRF, resolution, codec)
- node-cron schedule expressions and off-peak timing
- WebSocket reconnection/heartbeat implementation details
- Memory metrics collection method (adb shell dumpsys meminfo parsing)
- Artifacts table exact schema (columns, indexes)
- How replay buffer is sized (last N lines)

</decisions>

<specifics>
## Specific Ideas

- device-stream packages (@device-stream/android, @device-stream/ios-simulator) are the capture backbone — same stream feeds both live preview WebSocket and ffmpeg recording pipe
- Preview WebSocket sends base64 JSON frames — simple for both Go CLI and JS Web UI to consume
- Job WebSocket replays history on connect — critical for CLI `--follow` and Web UI that opens mid-execution
- Config already has storage.recordings (path, retention_days, compress_after_days, format, max_storage_gb) and storage.logs (retention_days, path) — reuse these for the lifecycle engine

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `JobExecutor` (server/jobs/job-executor.ts): spawns Maestro process with AbortSignal — needs hooks for recording start/stop and screenshot capture
- `MaestroParser` (server/jobs/maestro-parser.ts): callback interface — can add onStepFailed callback for screenshot trigger
- `ProcessTracker` (server/pool/process-tracker.ts): tracks child processes — can track ffmpeg processes too
- Config schema (server/config/schema.ts): already has storage.recordings and storage.logs sections with all needed config fields
- DB schema (server/db/schema.ts): recordings table exists but will be replaced with unified artifacts table; jobSteps.screenshotPath column ready for use

### Established Patterns
- Fastify plugin architecture — WebSocket, artifact, and lifecycle services each as Fastify plugins
- Pino child loggers per component
- Mutex-based concurrency (async-mutex) for shared resource access
- Event-driven dispatch (JobService) — same pattern for WebSocket event broadcasting

### Integration Points
- `server/index.ts` buildApp() — register WebSocket plugin, artifact plugin, lifecycle plugin after job plugin
- Job execution flow in JobService.executeJob() — wrap with recording start/stop, screenshot hooks
- API routes (server/api/routes.ts) — add artifact listing and download endpoints
- Health endpoint — add lifecycle metrics (last compression run, disk usage, artifacts count)

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 03-real-time-and-storage*
*Context gathered: 2026-03-10*
