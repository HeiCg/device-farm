# Phase 13: Recording - Context

**Gathered:** 2026-04-15
**Status:** Ready for planning

<domain>
## Phase Boundary

Wire device-stream's RecordingSession + platform FrameSources into the job execution pipeline so every test produces an MP4 recording stored as a job artifact. Replace the existing basic RecordingService with device-stream's codec-aware recording pipeline.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — infrastructure phase with prescribed technical approach.

Key integration points discovered during codebase scout:
- `@device-stream/core` has `RecordingSession` (ffmpeg lifecycle), `FrameSource` interface, `RecordingConfig`/`RecordingResult` types — already implements codec-aware ffmpeg args (H.264 passthrough for Android, MJPEG re-encode for iOS)
- `@device-stream/android` has `H264FrameSource` — extracts NAL units from scrcpy stream
- `@device-stream/ios-simulator` has `MJPEGFrameSource` — decodes JPEG frames from CaptureService
- Existing `server/artifacts/recording-service.ts` is a basic ffmpeg image2pipe wrapper — to be replaced by device-stream's `RecordingSession`
- Existing `server/artifacts/artifact-service.ts` + `artifact-plugin.ts` handle storage and DB association
- `server/jobs/job-executor.ts` runs Maestro — recording should start before execution and stop after
- `server/jobs/job-service.ts` orchestrates the full job lifecycle (allocate, execute, cleanup) — integration point for recording lifecycle

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `@device-stream/core` RecordingSession — codec-aware ffmpeg pipeline with events sidecar
- `@device-stream/android` H264FrameSource — Android scrcpy H.264 frame extraction
- `@device-stream/ios-simulator` MJPEGFrameSource + CaptureService — iOS ScreenCaptureKit MJPEG
- `server/artifacts/artifact-service.ts` — DB artifact association and storage paths
- `server/artifacts/recording-service.ts` — existing service to replace/refactor
- `server/streaming/device-preview.ts` — DevicePreviewManager with DeviceStreamAdapter (frame fan-out to subscribers)

### Established Patterns
- Fastify plugin pattern with decorator (recordingService is already decorated)
- ProcessTracker for ffmpeg PID registration
- Artifact association: job_id → artifact record in DB with type, path, size
- Job lifecycle: allocate → execute → cleanup in job-service.ts

### Integration Points
- `server/jobs/job-service.ts` — Start recording before Maestro, stop after, associate MP4 as artifact
- `server/artifacts/artifact-plugin.ts` — RecordingService registration
- `server/artifacts/artifact-service.ts` — createArtifact(jobId, type, path) for DB association
- `server/config/schema.ts` — recording config (enabled, quality, storage path)

</code_context>

<specifics>
## Specific Ideas

No specific requirements — infrastructure phase.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>
