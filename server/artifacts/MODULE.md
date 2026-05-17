# Artifacts Module

## Purpose

Persist recording/screenshot/memory/log artifacts produced by job executions. After Phase 21 the module is a **PURE SUBSCRIBER**: recording starts/stops + artifact-row creation are triggered by `job.started` / `job.completed` / `maestro.log.written` bus events emitted from `server/jobs/job-service.ts`, NOT by imperative `fastify.artifactService.createArtifact(...)` or `fastify.recordingService.start/stop(...)` calls. Emits `artifact.created` (persisted per TRACE-08) + `recording.started` / `recording.stopped` (transient). Owns the `recording.upload` pg-boss queue with `policy: 'stately'` + `singletonKey: recordingId` for SC3 idempotency (duplicate enqueue → queue dedup; duplicate worker run after completion → DB unique constraint via `artifacts.recording_id UNIQUE` + `.onConflictDoNothing`).

The module keeps 6 back-compat class instances (ArtifactService / RecordingService / ScreenshotService / MemoryService / ScrcpyService / CaptureService) as Fastify decorators (`fastify.artifactService` etc.) for legacy consumers (mid-flow screenshot capture in `job-service.ts:358-366` + potential future HTTP routes). These are consumed ONLY through the barrel `server/artifacts/index.ts` or via the decorators; direct imports from `server/artifacts/internal/**` are forbidden by `dependency-cruiser` rule `no-deep-imports-into-artifacts-internal` (Phase 21 Plan 21-00 addition).

## Public API

Exports from `server/artifacts/index.ts` (the ONLY legitimate import surface outside this module — enforced by the dep-cruiser rule above):

- `artifactsPlugin` — Fastify plugin (thin wrapper around `createArtifactsModule`). Plugin name: `'artifact-plugin'` (unchanged from v2.0 for back-compat dep-string resolution across 12 plugins).
- `createArtifactsModule(deps): ArtifactsModule` — factory (MOD-06) returning `{artifactService, recordingService, screenshotService, memoryService, scrcpyService, captureService, emit, bus, registerWorkersAndSubscribers, shutdown}`.
- `ArtifactService` / `RecordingService` / `ScreenshotService` / `MemoryService` classes — back-compat. `fastify.<X>Service` decorators read by `server/jobs/job-service.ts` (mid-flow screenshot capture only — all other imperative calls were removed in Plan 21-04).
- Events surface: `artifactsRegistry`, `ARTIFACTS_EVENT_NAMES`, `ARTIFACTS_AGGREGATE_ID`, `makeArtifactsEmitters`, 3 payload schemas (`artifactCreatedPayload` / `recordingStartedPayload` / `recordingStoppedPayload`).
- Queue surface: `RECORDING_UPLOAD_QUEUE_NAME`, `recordingUploadPayloadSchema`, `registerArtifactsWorker`.
- Schemas (Phase 17): `artifactTypeSchema`, `artifactSummarySchema`, `artifactListSchema`, type `ArtifactSummary`.
- WS (Phase 17): `artifactCreatedMessage`, `artifactMessageUnion`, type `ArtifactMessage`.
- Types: `ArtifactsModule`, `CreateArtifactsModuleDeps`, `ArtifactsRegistry`, `ArtifactsEmitters`, `ArtifactsEventName`, `RecordingUploadPayload`, `RegisterArtifactsWorkerDeps`, `ArtifactsWorkerRegistration`.

Fastify decorators exposed by the plugin:
- `fastify.artifactService: ArtifactService`
- `fastify.recordingService: RecordingService`
- `fastify.screenshotService: ScreenshotService`
- `fastify.memoryService: MemoryService`
- `fastify.scrcpyService: ScrcpyService` (from `@device-stream/android`)
- `fastify.captureService: CaptureService` (from `@device-stream/ios-simulator`)
- `fastify.artifactsModule: ArtifactsModule`

## Events Emitted

- `artifact.created` — **PERSISTED** (TRACE-08 end-state fact; Phase 27 trace-tree consumer). Fires from (a) the `recording.upload` worker after `createArtifactIdempotent` returns a new row; (b) the `job.completed` subscriber for each synchronous memory/screenshot artifact; (c) the `maestro.log.written` subscriber. Payload: `{artifactId, jobId, type: 'video'|'screenshot'|'memory'|'log', filePath, fileName, mimeType, fileSizeBytes: int|null}`. `aggregateType: 'artifacts'`, `aggregateId: artifactId`.
- `recording.started` — **NOT persisted** (transient; Phase 27 trace-tree can derive from the subsequent `artifact.created` row). Fires from the `job.started` subscriber after `RecordingService.startRecording` resolves. Payload: `{jobId, recordingId, deviceId, platform: 'android'|'ios', method: 'scrcpy'|'adb-screenrecord'|'capture-service'}`. `method` discriminator populated via `RecordingService.getRecordingMethod(jobId)` (Plan 21-01 getter per RESEARCH §Pitfall 8). `aggregateType: 'artifacts'`, `aggregateId: recordingId`.
- `recording.stopped` — **NOT persisted** (transient; derivable). Fires from the `job.completed` subscriber after `RecordingService.stopRecording` returns a `RecordingResult`. Payload: `{jobId, recordingId, outputPath, durationSec, frameCount, codec}`. `aggregateType: 'artifacts'`, `aggregateId: recordingId`.

`ARTIFACTS_AGGREGATE_ID` is the stable v5 UUID derived from `'artifacts'` under the URL namespace (RFC 4122 §4.3) — reserved for future artifacts-wide telemetry (e.g. `artifacts.gc.completed`). NOT used by the 3 events above; they carry artifactId/recordingId as aggregateId.

## Events Consumed

All subscriptions are deferred to an `onReady` Fastify hook inside `registerWorkersAndSubscribers` (per RESEARCH §Pitfall 7 + §Open Question Q4): `artifact-plugin` registers at step 11 < `jobs-plugin` at step 13 in `server/index.ts`, so `fastify.jobsModule` is NOT decorated at plugin-body time. `onReady` fires after all 17 plugins register, safely reading `fastify.jobsModule.bus`.

- `job.started` — consumed via `fastify.jobsModule.bus.on('job.started', handler)` (non-persisted; direct bus subscription per RESEARCH §Pitfall 4 option a). Handler: resolve adbSerial via `fastify.pool.getDevice`, `ensureJobDir`, generate `recordingId`, `startRecording`, emit `recording.started`, stash in `activeRecordings: Map<jobId, recordingId>`, start memory sampling (Android only).
- `job.completed` — consumed via `fastify.onPersisted('job.completed', handler)` (persisted; uses the reporting-precedent cast pattern from Phase 19 Plan 19-03). Handler: lookup recordingId from `activeRecordings`, `stopRecording`, emit `recording.stopped`, `fastify.queue.send(RECORDING_UPLOAD, payload, {singletonKey: recordingId})`; stop memory sampling + create memory artifact; scan screenshot directory + create artifact rows for each PNG.
- `maestro.log.written` — consumed via `fastify.jobsModule.bus.on('maestro.log.written', handler)` (non-persisted; Phase 21 bridgehead extension per RESEARCH §Open Question Q3 option b2). Handler: `artifactService.createArtifact({type: 'log', ...})` + emit `artifact.created`.

Cross-module producer references: `server/jobs/events.ts` (Phase 21 Plan 21-02 extended with `job.started` + `maestro.log.written`); `server/jobs/job-service.ts` (Phase 21 Plan 21-04 inverted 9 imperative artifact callsites into 2 emits; `job.completed` emit from Phase 19 Plan 19-01 unchanged).

## Queue Produced

- `recording.upload` — `policy: 'stately'`, `retryLimit: 3`, `retryBackoff: true`, `retryDelay: 5` (seconds; exponential 5→10→20 for retries 1/2/3). ON-DEMAND ONLY (NO schedule; matches Phase 16 hook.run + Phase 19 webhook.deliver shape, NOT Phase 18/20 schedule+cron shape). Enqueued by the `job.completed` subscriber with `singletonKey: recordingId` — this is SC3 QUEUE-LAYER idempotency (pg-boss v12 policy:'stately' drops duplicate singletonKey enqueues while prior job is in active/created/retry state). Combined with DB-LAYER idempotency (`artifacts.recording_id UNIQUE` + `.onConflictDoNothing`), replaying a recordingId is always safe. Registered by `registerArtifactsWorker` from `server/artifacts/queue.ts`.

**NO DLQ** per RESEARCH §Pitfall 3 — failed uploads are operator-visible via `boss.findJobs` + the mp4 still on disk. Phase 27+ may add DLQ if operational need emerges; adding now without a consumer traps failed jobs silently.

## Queue Consumed

- `recording.upload` — worker handler (self-loop — producer + consumer both in artifacts module). Handler: parse payload via `recordingUploadPayloadSchema.parse` (EVENTS-06 consumer input validation) → `await artifactService.createArtifactIdempotent({jobId, recordingId, type: 'video', ...})` → on new row emit `artifact.created`; on null return log WARN "Recording upload replayed — existing artifact row preserved (SC3 idempotency)" + NO emit (artifact.created was already emitted on the first successful attempt). Does NOT throw on null return — that IS the happy idempotent path. ALS is restored from envelope.correlationId BEFORE the handler fires (Phase 15 substrate); retries share ONE correlationId end-to-end.

## Invariants

Every invariant has at least one test (MOD-08). Test file citations are under `server/artifacts/__tests__/`:

- **(a) 3-event surface per SC2** — `ARTIFACTS_EVENT_NAMES` has exactly 3 keys (`artifact.created`, `recording.started`, `recording.stopped`), all dot-separated past-tense (EVENTS-03). `artifactsRegistry` has 3 entries with correct persistence flags (artifact.created=true; recording.started/stopped=false) per TRACE-08. Test: `events.spec.ts [Phase 21-02]`.
- **(b) SC3 two-layer idempotency** — replay `recording.upload` with same recordingId → exactly 1 artifact row. Queue-LAYER (policy:'stately' + singletonKey:recordingId) drops duplicate enqueue while prior job is active/retry; DB-LAYER (`artifacts.recording_id UNIQUE` + `.onConflictDoNothing(target)`) catches post-completion duplicates. Tests: `queue.spec.ts [SC3 dedup]` + `[SC3 DB fallback]` + `[SC3 no false positive]`.
- **(c) SC1 zero direct calls in job-service.ts** — `server/jobs/job-service.ts` contains ZERO `this.artifactService.createArtifact(`, `this.recordingService.startRecording`, `this.recordingService.stopRecording`, `this.memoryService.startSampling`, `this.memoryService.stopSampling`, `this.memoryService.writeSamples` occurrences. The ONLY remaining imperative artifact reference is the mid-flow `this.screenshotService.capture` at line 358-366 (documented in Non-Goals). Test: `lifecycle-ownership.spec.ts [Phase 21-05 SC1]`.
- **(d) SC4 single correlationId end-to-end** — ALS.run(correlationId) → job.completed → onPersisted subscriber → queue.send(RECORDING_UPLOAD) → worker → artifact.created → events-table INSERT. All share ONE correlationId. TRACE-09 causation: artifact.created row's causation_id = the job.completed envelope id. Test: `correlation.spec.ts [SC4 + TRACE-04]`.
- **(e) shutdown idempotency (MOD-06)** — `module.shutdown()` called twice → 2nd call is a no-op (stopped flag guard). offWork called exactly once per worker; unsubscribe called exactly once per of the 3 bus handlers; scrcpyService.stopAll called exactly once. Test: `module.spec.ts [shutdown idempotency]`.

## Non-Goals

- **Mid-flow screenshot capture via event** — the `onFlowResult` callback inside `JobExecutor.execute` at `job-service.ts:358-366` fires the screenshot capture BEFORE `job.completed` is emitted. The subscriber's post-completion directory scan picks up the PNG files + creates artifact rows via `createArtifactIdempotent` keyed on filePath. Strict SC1 "zero direct artifact calls" admits this ONE imperative `this.screenshotService.capture` line as documented exception. Phase 23 Jobs Keystone may refactor if a mid-flow `screenshot.captured` event is added to the saga.
- **Persistent `activeRecordings` state** — the module-local `Map<jobId, recordingId>` threading the recordingId from `job.started` subscriber to `job.completed` subscriber is IN-MEMORY + EPHEMERAL. Server restart orphans in-flight recordings (they leak until reaper + job cancellation flows reconcile). Acceptable trade-off for Phase 21 — Phase 22 Streaming + Phase 23 Jobs Keystone may persist via a `recordings` table if operational need emerges.
- **DLQ on recording.upload** — per RESEARCH §Pitfall 3; failed uploads are debuggable via `boss.findJobs` + file-on-disk. Phase 27+ can add.
- **Consolidation of the 5× duplicated `persistEnvelope` middleware** — 5TH SAMPLE POINT — Phase 27+ CONSOLIDATION TRIGGER REACHED. This plan ships the 5th copy; Phase 27+ extracts to a shared helper (`server/bus/persist-envelope.ts` or similar). Do NOT consolidate in Phase 21 — scope creep.
- **`maestro.log.written` as a saga-native event** — this is a Phase 21 bridgehead extension of `server/jobs/events.ts`. Phase 23 Jobs Keystone may replace with a saga event (e.g. `job.logged`) when it rewrites `job-service.ts`. Phase 21 shape is minimal + reversible.
- **RecordingService.getRecordingMethod() getter** — added per RESEARCH §Pitfall 8 as a minimally-invasive read-only discriminator. Cleaner contract change (`startRecording` returns the method string) is Phase 23+ scope; the getter is a wart acknowledged here.
- **Registering `recording.upload` DLQ for terminal event observability** — EVENTS-07 applies only to queues with external side-effects (webhook delivery). Recording upload failures are local FS + DB work; no downstream consumer to notify.
- **Cross-module back-compat cleanup** — `fastify.artifactService` decorator is still read by `server/jobs/job-service.ts` (via Phase3Services interface — even though most imperative calls were removed, the decorator reference remains). Phase 23 Jobs Keystone removes the back-compat reads when it rewrites JobService as a saga module.
- **Screenshot-artifact composite-key idempotency** — RESEARCH §Pitfall 9 identifies that directory-scan screenshot row creation is NOT idempotent (replaying `job.completed` creates duplicate rows per PNG). Acceptable for Phase 21 because `job.completed` is persisted only once per job (stately invariant at the jobs plugin level). If Phase 23 saga allows job.completed replay, this module needs `createArtifactIdempotent` keyed on `(jobId, filePath)` composite for screenshot paths.

## Dependencies

Declared in `server/artifacts/plugin.ts` `dependencies: ['config', 'db', 'queue', 'event-bus', 'pool-plugin']`:

- `config` — reads `fastify.config.storage.artifacts.path` for `ArtifactService` basePath.
- `db` — persistEnvelope middleware INSERTs to `events` table (persisted: `artifact.created` only); `createArtifactIdempotent` issues `INSERT ... ON CONFLICT DO NOTHING` against `artifacts` table.
- `queue` — `fastify.boss` + `fastify.queue` for `createQueue` + `send` + `work` + `offWork`; registers `recording.upload` queue + worker.
- `event-bus` — `fastify.bus` + `fastify.onPersisted` decorators for `job.completed` subscription; the module also maintains its own per-module `TypedBus<ArtifactsRegistry>` for internal publication.
- `pool-plugin` — `fastify.pool.getDevice(deviceId)` resolves adbSerial (`emulator-${port}`) inside the `job.started` subscriber. Pool plugin registers BEFORE artifacts plugin (step 8 vs step 11); preserved from pre-Phase-21 ordering.

---

### Runnable Example

```typescript
// Inside a Fastify plugin that has already registered config + db + queue + event-bus + pool + jobs + artifacts:
import {
  ARTIFACTS_EVENT_NAMES,
  RECORDING_UPLOAD_QUEUE_NAME,
} from 'server/artifacts/index.js';

// Direct bus subscription (non-persisted events):
app.artifactsModule.bus.on(ARTIFACTS_EVENT_NAMES.RECORDING_STARTED, (payload) => {
  app.log.info(
    { jobId: payload.jobId, recordingId: payload.recordingId, method: payload.method },
    'Recording started',
  );
});

// Persisted side-channel subscription (same envelope surface):
app.onPersisted('artifact.created', (envelope) => {
  app.log.info(
    { artifactId: envelope.aggregateId, type: envelope.payload.type },
    'New artifact row persisted — trace row in events table',
  );
});

// Query the events table by correlation for operational debug:
// SELECT * FROM events
//   WHERE aggregate_type = 'artifacts'
//     AND correlation_id = $1
//   ORDER BY occurred_at;
```

Phase 27 (MOD-09) will add CI-level typechecking of this snippet. For Phase 21, reviewer spot-checks the block.
