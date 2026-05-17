# Phase 13: Recording - Research

**Researched:** 2026-04-15
**Domain:** Video recording pipeline integration (ffmpeg + device-stream FrameSource)
**Confidence:** HIGH

## Summary

Phase 13 replaces the existing basic `RecordingService` (image2pipe ffmpeg wrapper) with device-stream's codec-aware `RecordingSession` and platform-specific `FrameSource` implementations. The `@device-stream/core` package provides `RecordingSession` (ffmpeg lifecycle), `FrameSource` interface, and `RecordingConfig`/`RecordingResult` types. Android uses `H264FrameSource` (scrcpy H.264 NAL unit passthrough -- no re-encode), iOS uses `MJPEGFrameSource` (ScreenCaptureKit JPEG frames re-encoded to H.264).

The key integration challenge is obtaining `ScrcpyService` and `CaptureService` references within the job execution flow. Currently, the `DeviceStreamAndroidDriver` uses `AndroidDeviceService` for health checks but does NOT instantiate `ScrcpyService`. The `DeviceStreamIosDriver` uses `IOSSimulatorManager` which optionally accepts a `CaptureService` but is currently constructed without one. The recording pipeline requires these services to be instantiated, accessible from the job execution context, and their streams to be active for the duration of each test.

**Primary recommendation:** Refactor `RecordingService` to wrap `RecordingSession` + platform-specific `FrameSource` creation, expose `ScrcpyService` and `CaptureService` as shared singletons via the pool plugin or a new recording-aware plugin, and integrate start/stop into `job-service.ts` executeJob flow.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
None -- all implementation choices are at Claude's discretion (infrastructure phase).

### Claude's Discretion
All implementation choices including:
- How to wire ScrcpyService and CaptureService into the recording pipeline
- How to refactor RecordingService to use device-stream's RecordingSession
- How to expose platform services for recording frame sources

### Deferred Ideas (OUT OF SCOPE)
None.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| REC-01 | MP4 recording via scrcpy H.264 stream (Android) from start to finish | H264FrameSource + RecordingSession with codec='h264' provides zero-reencode passthrough. ScrcpyService.setRecordingCallback enables parallel frame tapping. |
| REC-02 | MP4 recording via ScreenCaptureKit MJPEG (iOS) from start to finish | MJPEGFrameSource + RecordingSession with codec='mjpeg' re-encodes JPEG to H.264. CaptureService emits 'frameData' events for parallel consumption. |
| REC-03 | MP4 artifact associated with job and accessible via existing API | Existing ArtifactService.createArtifact() with type='video' and existing artifact API endpoints handle this. Job-service already has artifact association code in the finally block. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @device-stream/core | 1.1.0 | RecordingSession, FrameSource interface, RecordingConfig/Result types | Already installed; codec-aware ffmpeg pipeline with events sidecar |
| @device-stream/android | (installed) | H264FrameSource, ScrcpyService | Extracts raw NAL units from scrcpy stream for passthrough recording |
| @device-stream/ios-simulator | (installed) | MJPEGFrameSource, CaptureService | Decodes base64 JPEG from ScreenCaptureKit for re-encode recording |
| ffmpeg | system binary | Video muxing/encoding | Already a dependency (verified by doctor command DOC-06) |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Existing ArtifactService | n/a | DB artifact records + file storage | Creating video artifact records after recording stops |
| Existing ProcessTracker | n/a | PID registration for ffmpeg processes | Tracking ffmpeg processes for cleanup on server shutdown |

## Architecture Patterns

### Current Recording Flow (to be replaced)
```
DevicePreviewManager.startPreview(deviceId) → adapter.onFrame → frames piped
RecordingService.startRecording(jobId, path) → spawns ffmpeg image2pipe
DevicePreviewManager.subscribe(deviceId, handler) → writes frames to ffmpeg stdin
RecordingService.stopRecording(jobId) → closes stdin, waits for exit
```

### New Recording Flow (device-stream)
```
1. Obtain platform service (ScrcpyService for Android, CaptureService for iOS)
2. Ensure device stream is active (scrcpy session or sim-capture running)
3. Create FrameSource (H264FrameSource or MJPEGFrameSource)
4. Create RecordingSession, call session.start(config, frameSource)
5. Test executes (Maestro)
6. Call session.stop() → returns RecordingResult with metadata
7. Associate MP4 as artifact via ArtifactService
```

### Key Architecture Decision: Service Access Pattern

The critical design question is how `job-service.ts` obtains `ScrcpyService` and `CaptureService` references.

**Recommended approach:** Extend the pool plugin or artifact plugin to instantiate and expose these services as Fastify decorators.

```
pool-plugin.ts (or artifact-plugin.ts)
├── ScrcpyService (singleton, shared across jobs)
├── CaptureService (singleton, shared across jobs)
└── Exposed via fastify.scrcpyService / fastify.captureService
```

Then `RecordingService` is refactored to accept these services and create platform-appropriate `FrameSource` + `RecordingSession` per job.

### Android Recording Architecture
```
ScrcpyService (must be running for device)
  └── .setRecordingCallback(serial, callback) ← parallel to WebSocket relay
       └── H264FrameSource receives packets
            └── Writes raw H.264 NAL bytes to RecordingSession's ffmpeg stdin
                 └── ffmpeg -f h264 -c:v copy → MP4 (passthrough, no re-encode)
```

**Critical:** ScrcpyService requires an active scrcpy session for the device. This means `ScrcpyService.startStream()` must be called before recording can begin. Currently, scrcpy streams are NOT started as part of the job flow -- they need to be.

### iOS Recording Architecture
```
CaptureService (must be capturing for device)
  └── emits 'frameData' event with base64 JPEG
       └── MJPEGFrameSource listens on event
            └── Decodes base64 → raw JPEG Buffer → writes to ffmpeg stdin
                 └── ffmpeg -f image2pipe -c:v mjpeg → -c:v libx264 → MP4 (re-encode)
```

**Critical:** CaptureService requires `startCapture(deviceId)` or `startCaptureFromStream()` to be called first. The sim-capture binary must be built and available.

### Recommended Project Structure Changes
```
server/artifacts/
├── recording-service.ts      # REFACTORED: wraps RecordingSession + FrameSource
├── artifact-service.ts       # UNCHANGED
├── artifact-plugin.ts        # MODIFIED: instantiate ScrcpyService + CaptureService
├── screenshot-service.ts     # UNCHANGED
├── memory-service.ts         # UNCHANGED
└── __tests__/
    └── recording-service.test.ts  # REWRITTEN: test new RecordingSession wrapper
```

### Pattern: RecordingService Refactored Interface
```typescript
// New RecordingService wrapping device-stream's RecordingSession
export class RecordingService {
  constructor(
    logger: pino.Logger,
    processTracker?: ProcessTracker,
  ) {}

  // Start recording for a job using device-stream pipeline
  async startRecording(
    jobId: string,
    outputPath: string,
    platform: Platform,
    deviceSerial: string,
    services: { scrcpyService?: ScrcpyService; captureService?: CaptureService },
  ): Promise<void> {}

  // Stop recording and return result
  async stopRecording(jobId: string): Promise<RecordingResult | null> {}

  // Kill recording (cancel/timeout scenarios)
  killRecording(jobId: string): void {}

  isRecording(jobId: string): boolean {}
}
```

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| ffmpeg argument construction | Custom ffmpeg args per codec | RecordingSession.buildFfmpegArgs() | Already handles h264 passthrough vs mjpeg re-encode correctly |
| H.264 NAL extraction | Custom packet parsing | H264FrameSource + ScrcpyService.setRecordingCallback | Handles both SPS/PPS config and frame data packets |
| MJPEG frame extraction | Custom event listener | MJPEGFrameSource + CaptureService 'frameData' event | Handles base64 decode and Buffer conversion |
| ffmpeg process lifecycle | Custom spawn/wait/kill | RecordingSession (start/stop with timeout/SIGKILL escalation) | Handles spawn errors, stdin close, exit wait with 5s timeout |
| Events sidecar | Custom JSON writing | RecordingSession.addEvent() | Auto-writes events JSON alongside MP4 |

## Common Pitfalls

### Pitfall 1: Scrcpy Session Not Started
**What goes wrong:** H264FrameSource.start() throws "No active scrcpy session" because ScrcpyService.startStream() was never called for the device.
**Why it happens:** Currently, scrcpy streams are only started for WebSocket preview, not as part of the job flow.
**How to avoid:** Ensure ScrcpyService.startStream() is called before creating H264FrameSource. This requires an ADB connection (via TangoADB) and a WebSocket (or dummy sink).
**Warning signs:** "No active scrcpy session for emulator-5554" error in logs.

### Pitfall 2: CaptureService Binary Not Found
**What goes wrong:** CaptureService.startCapture() returns false because sim-capture binary doesn't exist at expected path.
**Why it happens:** sim-capture must be built via `swift build` and the binary path must be correct. Default path is relative to the ios-simulator package's dist/ directory.
**How to avoid:** Either pass custom binaryPath to CaptureService constructor pointing to the built binary, or ensure it's built during `device-farm dependencies` (DEP-09 already handles this).
**Warning signs:** "[SimCapture] Binary not found" in logs.

### Pitfall 3: ScrcpyService Requires WebSocket Parameter
**What goes wrong:** ScrcpyService.startStream() signature requires `(adb: Adb, serial: string, ws: WebSocket)` -- it needs a WebSocket for the relay.
**Why it happens:** ScrcpyService was designed for live streaming to a browser client, not headless recording.
**How to avoid:** Two options: (a) Create a no-op WebSocket mock/stub that satisfies the interface but discards frames, or (b) Modify the approach to use ScrcpyService.setRecordingCallback on an already-active session if DevicePreviewManager has started it.
**Warning signs:** TypeError when passing null/undefined as ws parameter.

### Pitfall 4: Recording Starts Before Frames Flow
**What goes wrong:** ffmpeg receives no data, produces empty/corrupt MP4 because frames haven't started flowing yet.
**Why it happens:** RecordingSession.start() sets up ffmpeg but FrameSource.start() is async -- there may be a delay before first frame arrives.
**How to avoid:** RecordingSession handles this correctly internally (ffmpeg will wait for stdin data). But ensure the underlying stream (scrcpy or sim-capture) is actually producing frames before considering recording "started."
**Warning signs:** RecordingResult with frameCount=0.

### Pitfall 5: Device Preview Manager Overlap
**What goes wrong:** Both the existing DevicePreviewManager frame subscription AND the new FrameSource try to consume frames, causing conflicts or double-processing.
**Why it happens:** The existing job-service.ts already subscribes to DevicePreviewManager for recording.
**How to avoid:** The device-stream FrameSource implementations use separate mechanisms (setRecordingCallback for Android, EventEmitter for iOS) that are designed to work in parallel with the WebSocket relay. Remove the old DevicePreviewManager.subscribe() recording code and replace with FrameSource-based recording.
**Warning signs:** Recording produces corrupted video or garbled frames.

### Pitfall 6: ffmpeg Process Not Tracked
**What goes wrong:** On server crash/restart, orphan ffmpeg processes persist.
**Why it happens:** RecordingSession spawns ffmpeg internally but doesn't integrate with device-farm's ProcessTracker.
**How to avoid:** After RecordingSession.start(), extract the ffmpeg PID and register with ProcessTracker. RecordingSession exposes the process as a private field -- may need to track PID from the ffmpeg stderr output or extend the wrapper.
**Warning signs:** Zombie ffmpeg processes after server restart.

## Code Examples

### RecordingSession Usage (from @device-stream/core source)
```typescript
// Source: node_modules/@device-stream/core/src/recording/session.ts
import { RecordingSession } from '@device-stream/core';
import type { RecordingConfig, FrameSource } from '@device-stream/core';

const session = new RecordingSession();

const config: RecordingConfig = {
  outputPath: '/path/to/recording.mp4',
  codec: 'h264',     // or 'mjpeg' for iOS
  framerate: 30,
};

await session.start(config, frameSource);

// Optional: add timestamped events
session.addEvent({ type: 'tap', timestamp: 1200, x: 100, y: 200 });

const result = await session.stop();
// result.outputPath, result.duration, result.frameCount, result.errors
```

### H264FrameSource Creation (Android)
```typescript
// Source: node_modules/@device-stream/android/src/h264-frame-source.ts
import { H264FrameSource } from '@device-stream/android';
import type { ScrcpyService } from '@device-stream/android';

const frameSource = new H264FrameSource(scrcpyService, 'emulator-5554');
// frameSource implements FrameSource interface
// Requires scrcpyService.getSession(serial) to return an active session
```

### MJPEGFrameSource Creation (iOS)
```typescript
// Source: node_modules/@device-stream/ios-simulator/src/mjpeg-frame-source.ts
import { MJPEGFrameSource } from '@device-stream/ios-simulator';
import type { CaptureService } from '@device-stream/ios-simulator';

const frameSource = new MJPEGFrameSource(captureService, 'DEVICE-UDID');
// frameSource implements FrameSource interface
// Requires captureService to have startCapture(deviceId) already called
```

### ffmpeg Args Built by RecordingSession
```typescript
// Source: node_modules/@device-stream/core/src/recording/session.ts

// H.264 (Android): passthrough, no re-encode
// ffmpeg -y -hide_banner -loglevel warning -f h264 -framerate 30 -i pipe:0 -c:v copy -movflags +faststart output.mp4

// MJPEG (iOS): re-encode JPEG to H.264
// ffmpeg -y -hide_banner -loglevel warning -f image2pipe -c:v mjpeg -framerate 30 -i pipe:0 -c:v libx264 -pix_fmt yuv420p -movflags +faststart output.mp4
```

### ScrcpyService Recording Callback (Android)
```typescript
// Source: node_modules/@device-stream/android/src/scrcpy-service.ts
// The recording callback receives packets in parallel with WebSocket relay
scrcpyService.setRecordingCallback(serial, (packet) => {
  // packet.type: 'configuration' (SPS/PPS) or 'data' (frame NAL units)
  // packet.data: raw H.264 bytes
  const buf = Buffer.from(packet.data);
  sink.write(buf);
});
```

### Existing Job-Service Recording Integration Point
```typescript
// Source: server/jobs/job-service.ts lines 249-269
// CURRENT: Uses old RecordingService + DevicePreviewManager frame subscription
// TO REPLACE: Use RecordingSession + FrameSource directly
if (this.recordingService && this.artifactService) {
  const recordingPath = this.artifactService.getArtifactPath(job.id, 'recording.mp4');
  // OLD: const ffmpegWritable = this.recordingService.startRecording(jobId, path);
  // NEW: await this.recordingService.startRecording(jobId, path, platform, serial, services);
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| image2pipe ffmpeg (10fps, re-encode all) | Codec-aware: H.264 passthrough for Android, MJPEG re-encode for iOS | @device-stream/core 1.1.0 | Android recordings are zero-CPU-cost (copy codec), smaller files |
| DevicePreviewManager frame subscription | FrameSource interface with platform callbacks | @device-stream/core 1.1.0 | Parallel recording without interfering with WebSocket relay |
| Manual ffmpeg arg construction | RecordingSession builds args from codec config | @device-stream/core 1.1.0 | Correct args guaranteed per platform |

## Open Questions

1. **ScrcpyService startup during job execution**
   - What we know: H264FrameSource requires an active scrcpy session. ScrcpyService.startStream() needs ADB connection + WebSocket.
   - What's unclear: Whether to start scrcpy as part of job recording (needs dummy WS) or rely on DevicePreviewManager starting it first.
   - Recommendation: Start scrcpy as part of DevicePreviewManager.startPreview() and tap into the existing session via setRecordingCallback. This avoids creating a second scrcpy connection.

2. **ProcessTracker integration with RecordingSession**
   - What we know: RecordingSession spawns ffmpeg internally. The process field is private.
   - What's unclear: How to get the ffmpeg PID for ProcessTracker registration.
   - Recommendation: The RecordingService wrapper can listen for the ffmpeg spawn event or access session internals. Alternatively, accept that RecordingSession handles its own cleanup (5s timeout + SIGKILL escalation) and skip ProcessTracker for recording ffmpeg.

3. **CaptureService binary path resolution**
   - What we know: Default path is relative to the ios-simulator package dist/. DEP-09 builds sim-capture.
   - What's unclear: Exact path where the built binary lives on this system.
   - Recommendation: Pass explicit binaryPath when constructing CaptureService, using a config value or well-known path.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (latest, configured in project) |
| Config file | vitest.config.ts (project root) |
| Quick run command | `npx vitest run server/artifacts/__tests__/recording-service.test.ts` |
| Full suite command | `npm test` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| REC-01 | Android H.264 recording produces MP4 | unit | `npx vitest run server/artifacts/__tests__/recording-service.test.ts -x` | Exists but tests old service |
| REC-02 | iOS MJPEG recording produces MP4 | unit | `npx vitest run server/artifacts/__tests__/recording-service.test.ts -x` | Exists but tests old service |
| REC-03 | Recording artifact associated with job | unit | `npx vitest run server/jobs/__tests__/job-service.test.ts -x` | Exists (artifact association tested) |

### Sampling Rate
- **Per task commit:** `npx vitest run server/artifacts/__tests__/recording-service.test.ts -x`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `server/artifacts/__tests__/recording-service.test.ts` -- needs rewrite to test new RecordingSession-based service
- [ ] Mock factories for ScrcpyService and CaptureService needed for unit tests

## Sources

### Primary (HIGH confidence)
- @device-stream/core 1.1.0 source: `node_modules/@device-stream/core/src/recording/` -- RecordingSession, types, FrameSource interface
- @device-stream/android source: `node_modules/@device-stream/android/src/h264-frame-source.ts` -- H264FrameSource implementation
- @device-stream/ios-simulator source: `node_modules/@device-stream/ios-simulator/src/mjpeg-frame-source.ts` -- MJPEGFrameSource implementation
- @device-stream/android source: `node_modules/@device-stream/android/src/scrcpy-service.ts` -- ScrcpyService with setRecordingCallback
- @device-stream/ios-simulator source: `node_modules/@device-stream/ios-simulator/src/capture-service.ts` -- CaptureService with frameData events

### Secondary (MEDIUM confidence)
- Existing server code: `server/artifacts/recording-service.ts`, `server/jobs/job-service.ts` -- current integration patterns
- Existing server code: `server/pool/android/device-stream-driver.ts`, `server/pool/ios/device-stream-driver.ts` -- current driver wiring

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all packages already installed and source code inspected directly
- Architecture: HIGH -- integration points clearly identified from source, existing patterns well-understood
- Pitfalls: HIGH -- identified from source code analysis (ScrcpyService WS requirement, CaptureService binary path, FrameSource prerequisites)

**Research date:** 2026-04-15
**Valid until:** 2026-05-15 (stable -- device-stream packages are locally managed)
