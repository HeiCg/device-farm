# Phase 21: Artifacts Module - Research

**Researched:** 2026-04-22
**Domain:** In-tree module refactor — invert `server/artifacts/` from imperative callee to pure bus subscriber; apply canonical Phase 16/18/19/20 MOD-01..MOD-09 template; add `recording.upload` pg-boss queue with `singletonKey: recordingId` + DB-unique idempotency.
**Confidence:** HIGH (4 canonical precedents in-tree — hooks / lifecycle / reporting / pool — all read verbatim; no external library questions)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

All implementation choices are at Claude's discretion — pure infrastructure phase. Planner follows the Phase 16/18/19/20 module template verbatim. (Effectively: no user-locked choice beyond "follow the canonical template".)

### Claude's Discretion

- **Module contract**: Copy the 9-section MODULE.md shape from `server/pool/MODULE.md` (the most recently canonicalized reference).
- **Events surface**: `artifact.created`, `recording.started`, `recording.stopped` per ROADMAP success criterion 2. Persistence flags follow the Phase 20 pattern (terminal/notable events persisted; transient lifecycle events not persisted) — specific choice deferred to planner.
- **Queue**: `recording.upload` with `singletonKey: recordingId` per success criterion 2; pg-boss wrapper from Phase 18.
- **Idempotency**: DB unique constraint + pre-check on `recordingId` (success criterion 3); exact constraint surface (composite vs. simple unique) deferred to planner based on current `artifacts` schema.
- **Subscriber wiring**: artifacts module subscribes to `job.started` (→ start recording/screenshot/memory capture) and `job.completed` (→ stop capture, create artifact rows). Zero direct calls from `jobs/*` into artifact services.
- **Tests**: tests-as-spec style matching Phase 16/20 — per-service `.spec.ts` with behaviour rows, DB-gated integration specs for subscriber + queue idempotency.

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

Phase 21 carries **no direct requirement IDs** — roadmapper maps `MOD-01..MOD-09` module conventions to every module-refactor phase (Phases 16 / 18 / 19 / 20 / 21 / 22 / 24 / 25 / 26). The phase is bound entirely by its 4 ROADMAP Success Criteria, which this research enables as follows:

| Success Criterion (ROADMAP §Phase 21) | Research Support |
|---|---|
| SC1 — `RecordingService`/`ScreenshotService`/`MemoryService` triggered only by `job.started` + `job.completed`; `jobs/job-service.ts` has ZERO direct calls into artifact services | §Cross-Module Wiring Decision (sub-option C — artifacts subscribes via `fastify.onPersisted` + bus.on; jobs emits via existing `jobsModule.emit`). §Imperative Call-Site Inventory (all 9 call sites in `job-service.ts` identified). §Pattern 4 (bridgehead event extension — adding `job.started` to jobs/events.ts, exactly mirroring Plan 19-01's `job.completed` precedent). |
| SC2 — Artifact module fully migrated (MODULE.md / barrel / events.ts / queue.ts / tests-as-spec); emits `artifact.created`, `recording.started`, `recording.stopped` | §Standard Stack + §Architecture Patterns (full module-shape template). §Event Surface (3 events with persistence policy derived from Phase 19/20 precedent). §Queue Surface (`recording.upload` registration shape). §Pattern 1 (MODULE.md 9 fixed H2 sections + Runnable Example). |
| SC3 — Retry of `recording.upload` is safe: replaying the same `recordingId` does NOT create a duplicate artifact row (idempotent by DB unique constraint + pre-check) | §Idempotency Layering (two-layer: queue singletonKey + DB unique constraint). §Schema Change (add `recording_id UUID UNIQUE` column to `artifacts`, nullable). §Pattern 3 (copy Phase 16 hook_runs PK + onConflictDoNothing idiom). §Pitfall 5 (singletonKey dedups enqueue but not execution; DB layer is non-negotiable). |
| SC4 — Nyquist passes; coverage delta ≤ −2pp; no hybrid state | §Nyquist / Validation Architecture + §Don't Hand-Roll. Running baseline = 47.99% lines / 48.29% Phase 15 reference. Phase 20's -0.30pp net tells us a large module with many new spec files + comparable source adds barely moves the needle; Phase 21 should land similarly. |
</phase_requirements>

## Summary

Phase 21 is the **first module-migration phase with an upstream producer still in imperative form**. Phase 16 (hooks) was a self-contained pilot; Phases 18/19/20 (lifecycle / reporting / pool) all migrated modules whose producers were either the module itself (lifecycle, pool state machine) or already bus-driven after a thin bridgehead (reporting consumes `job.completed` via Plan 19-01's minimal `jobs/events.ts`). Phase 21 has to do what Phase 19 did — **extend the bridgehead** — while keeping `server/jobs/job-service.ts` readable until Phase 23 Jobs Keystone rewrites it.

The established template is proven: copy pool's `index.ts` barrel (1-line internal/module.js re-export per MOD-02), reporting's factory shape (`createXModule → {emit, bus, registerWorkersAndSubscribers, shutdown}`), pool's `events.ts` (4 entries, TRACE-08 persistence flags, `<MODULE>_AGGREGATE_ID` v5 UUID), pool's `queue.ts` sequencing (createQueue → work; NO schedule for artifacts since `recording.upload` is on-demand not cron), and reporting's `onPersisted('job.completed')` subscriber pattern. Dep-cruiser rule 5 (copy/paste pool rule with `pool`→`artifacts`) lands in Wave 0.

**The load-bearing novelty in this phase** is twofold: (1) inverting 9 imperative call sites in `job-service.ts` into 2 bus events, and (2) designing the `recording.upload` idempotency contract so the `policy:'stately' + singletonKey:recordingId` queue layer (drops duplicate enqueue) composes with a DB-level `artifacts.recording_id UNIQUE` constraint (drops duplicate row insert). Either layer alone is insufficient — Phase 16 Plan 16-01 proved exactly this pattern for `hook_runs` PK. `recording.upload` is on-demand (NOT scheduled), so its registration shape matches Phase 19's webhook pattern (createQueue + work) not Phase 18/20's (createQueue + schedule + work).

**Primary recommendation:** Follow the Phase 20 pool template for structure; follow the Phase 19 reporting template for bus-consumer wiring (`fastify.onPersisted`) + imperative enqueue facade (for recording.upload); extend `server/jobs/events.ts` with ONE new event (`job.started`) using the Plan 19-01 bridgehead approach; emit from `job-service.ts` AT the same 2 call sites that will survive Phase 23 (just before Maestro start, and just after DB completion save). Keep the existing services as pure mechanics (no bus access inside them — that's the subscribers.ts file's job).

## Standard Stack

### Core (already installed — no new deps)

| Library | Version | Purpose | Why Standard |
|---|---|---|---|
| `pg-boss` | v12 (pinned in Phase 15-00) | `recording.upload` queue | Project-mandated single queue (QUEUE-01). |
| `fastify-plugin` | ^5 | Thin `plugin.ts` wrapper | Canonical across all 12 plugins. |
| `zod` | ^4.3.6 | `events.ts` payload schemas + WS schemas | SPEC-01..SPEC-10 at all boundaries. |
| `@fastify/request-context` | v6 | ALS correlationId reader | Phase 15 substrate. |
| `drizzle-orm` | 0.45.1 | `artifacts` table DDL + idempotency check | Existing. |
| `drizzle-kit` | — | Migration for `recording_id UNIQUE` column | Existing. |
| `uuid` | — | v5 derivation for `ARTIFACTS_AGGREGATE_ID` | Used by pool/lifecycle/reporting. |
| `vitest` | v3 + v8 coverage | Tests-as-spec | Phase 15 baseline. |
| `pino` | — | Per-module child logger | MOD-07. |

### Supporting (already present)

| Library | Version | Purpose | When to Use |
|---|---|---|---|
| `@device-stream/core` + `/android` + `/ios-simulator` | file:vendor/device-stream (Phase 17) | `RecordingSession`, `H264FrameSource`, `MJPEGFrameSource`, `CaptureService` | Preserved verbatim inside `recording-service.ts` — NO code change. |
| `async-mutex` | — | NOT required here (artifacts has no shared-resource allocation). |
| `node:child_process` (`spawn`, `execFile`) | — | `adb shell screencap`, `adb shell dumpsys meminfo`, `xcrun simctl`, adb-screenrecord fallback | Already used inside the 3 services; no change. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|---|---|---|
| `policy: 'stately' + singletonKey: recordingId` | `policy: 'standard'` (like webhooks in Phase 19) | Rejected. Webhooks are NOT idempotent by enqueue (same URL posted twice = 2 downstream events). Recording uploads MUST be idempotent by recordingId — the file is the same; a re-enqueue must be dropped. Pattern matches Phase 16 hook_runs (`stately`). |
| `DB unique on recording_id` | `DB unique on (job_id, type='video')` composite | Rejected. Composite conflates two independent invariants (one video per job vs. one row per recordingId) and breaks when Phase 22+ adds e.g. failure-retry clips per job. Simple unique on the new `recording_id` column is the direct implementation of SC3. |
| ON CONFLICT DO NOTHING (same pattern Phase 16 used) | `SELECT ... WHERE recording_id = $1` then `INSERT` | Prefer `ON CONFLICT DO NOTHING`. Single round-trip, atomic with respect to concurrent callers, avoids TOCTOU. The "pre-check" phrasing in SC3 is satisfied by the Drizzle `.onConflictDoNothing()` call — the DB unique constraint IS the pre-check. |
| Copy pool's `makePersistEnvelope` fourth time | Extract shared helper now | Rejected. Phase 27+ consolidation trigger is at 5 sample points; 4 is still "copy it" per all 4 predecessor SUMMARY.md decisions. Plan should include the same "5th sample point noted — Phase 27+ trigger" comment above the duplicate block. |
| Register `job.started` via minimal `server/jobs/events.ts` extension | Move the full saga (EVENTS-10) into Phase 21 | Rejected. EVENTS-10 is Phase 23 scope (mapped in REQUIREMENTS.md traceability). Phase 21 extends the bridgehead by ONE event exactly as Phase 19 Plan 19-01 precedent. |

**Installation:**
No new npm deps. One Drizzle migration:
```bash
npx drizzle-kit generate   # → adds recording_id column + UNIQUE constraint
npx drizzle-kit push       # against dev DB in Wave 0 substrate
```

## Architecture Patterns

### Recommended Project Structure

```
server/artifacts/
├── MODULE.md                 # 9 fixed H2 sections + Runnable Example (MOD-01)
├── index.ts                  # Public barrel (MOD-02) — 1-line internal/module.js re-export
├── plugin.ts                 # Thin Fastify wrapper (replaces artifact-plugin.ts)
├── events.ts                 # artifactsRegistry + 3 payload schemas + makeArtifactsEmitters (MOD-03)
├── queue.ts                  # recording.upload contract + registerArtifactsWorker (QUEUE-06)
├── schemas.ts                # EXISTING — artifactSummarySchema + artifactListSchema (Phase 17)
├── ws-schemas.ts             # EXISTING — artifactCreatedMessage (Phase 17)
├── artifact-service.ts       # EXISTING — persists rows (lives at root; consumed via back-compat decorator)
├── recording-service.ts      # EXISTING — scrcpy + adb-screenrecord fallback (moved to internal/ OR stays root? — see §Decision below)
├── screenshot-service.ts     # EXISTING
├── memory-service.ts         # EXISTING
├── internal/
│   ├── module.ts             # createArtifactsModule factory (MOD-06) — this is the only file the barrel re-exports
│   └── subscribers.ts        # OPTIONAL: JobSubscriber wiring (see §Decision 2); or inline inside module.ts
└── __tests__/
    ├── events.spec.ts            # MOD-03 proof (3 events, persistence flags, ALS envelope)
    ├── artifact-service.spec.ts  # rename from artifact-service.test.ts (MOD-04)
    ├── recording-service.spec.ts # rename from recording-service.test.ts
    ├── screenshot-service.spec.ts
    ├── memory-service.spec.ts
    ├── module.spec.ts            # MOD-06 factory shape + shutdown idempotency
    ├── queue.spec.ts             # DB-gated: SC3 idempotency (replay same recordingId → 1 row)
    ├── subscriber.spec.ts        # DB-gated: job.started → recording started; job.completed → stopped + row inserted
    └── fixtures/ (if needed)
```

#### Decision 1 — Should existing services move under `internal/`?

**Recommendation: KEEP services at module root (NOT under `internal/`).**

Pool's precedent (Phase 20) keeps `pool-manager.ts`, `health-checker.ts`, `process-tracker.ts`, `device.ts`, `device-info-collector.ts`, `android/*.ts`, `ios/*.ts` at the root — ONLY the factory `module.ts` lives under `internal/`. This was a deliberate MOD-02 reading: the barrel re-exports named classes/surfaces from root, the dep-cruiser rule forbids `server/artifacts/internal/**` deep imports from outside, and the `internal/module.ts` re-export through `index.ts` is the single exception.

The `recording-service.ts`, `screenshot-service.ts`, `memory-service.ts`, `artifact-service.ts` classes are part of the PUBLIC back-compat surface (Fastify decorators `fastify.recordingService`, etc. are still read by code outside the module until Phase 23 Jobs Keystone removes them). Moving them under `internal/` would either force those decorator reads to become deep imports (rule violation) or force barrel re-exports of 4 classes (unnecessary API surface sprawl).

**Confidence: HIGH** — Exact pattern established by Phases 19 + 20.

#### Decision 2 — Where does the bus subscriber live?

**Recommendation: INLINE inside `internal/module.ts` (like reporting's `onPersisted('job.completed')` handler).**

Reporting's `internal/module.ts` lines 168-211 declare the `onPersisted('job.completed')` subscriber directly inside `registerWorkersAndSubscribers` — no separate `subscribers.ts` file. Hooks' pilot DID create a separate `internal/subscribers.ts` (Phase 16), but that was because hooks have multiple bus→queue bridge subscribers. Artifacts has only two (`job.started`, `job.completed`); inline is more direct.

**Confidence: MEDIUM** (planner may choose differently; either is accepted). Reporting is the nearest precedent structurally.

### Pattern 1: Canonical `events.ts` (copy-paste from pool/reporting)

```typescript
// Source: server/pool/events.ts (Phase 20) + server/reporting/events.ts (Phase 19)
import { z } from 'zod';
import { v5 as uuidv5 } from 'uuid';  // if deriving ARTIFACTS_AGGREGATE_ID at build-time
import { createEventHelpers } from '../bus/helpers.js';
import type { TypedBus } from '../bus/bus.js';
import type { EventRegistry } from '../bus/types.js';
import type { Envelope } from '../events/envelope.js';

export const ARTIFACTS_EVENT_NAMES = {
  ARTIFACT_CREATED:    'artifact.created',
  RECORDING_STARTED:   'recording.started',
  RECORDING_STOPPED:   'recording.stopped',
} as const;

export type ArtifactsEventName = typeof ARTIFACTS_EVENT_NAMES[keyof typeof ARTIFACTS_EVENT_NAMES];

// v5 UUID from 'artifacts' under URL namespace — matches pool/reporting/lifecycle pattern.
// Plan must re-derive at test time: uuidv5('artifacts', URL_NAMESPACE) and assert match.
// URL namespace is RFC 4122 §4.3 constant '6ba7b811-9dad-11d1-80b4-00c04fd430c8'.
export const ARTIFACTS_AGGREGATE_ID = '<compute via uuidv5("artifacts", URL_NS)>';

export const artifactCreatedPayload = z.object({
  artifactId: z.string().uuid(),
  jobId: z.string().uuid(),
  type: z.enum(['video', 'screenshot', 'memory', 'log']),
  filePath: z.string(),
  fileName: z.string(),
  mimeType: z.string(),
  fileSizeBytes: z.number().int().nonnegative().nullable(),
});

export const recordingStartedPayload = z.object({
  jobId: z.string().uuid(),
  recordingId: z.string().uuid(),
  deviceId: z.string().uuid(),
  platform: z.enum(['android', 'ios']),
  method: z.enum(['scrcpy', 'adb-screenrecord', 'capture-service']),
});

export const recordingStoppedPayload = z.object({
  jobId: z.string().uuid(),
  recordingId: z.string().uuid(),
  outputPath: z.string(),
  durationSec: z.number().nonnegative(),
  frameCount: z.number().int().nonnegative(),
  codec: z.string(),
});

// TRACE-08 persistence: match pool's published policy — terminal/notable persisted,
// transient lifecycle (start/stop) NOT persisted.
//   - artifact.created: PERSISTED (end-state fact; Phase 27 trace-tree consumer)
//   - recording.started/stopped: NOT persisted (derivable from artifact.created + timestamps)
export const artifactsRegistry = {
  [ARTIFACTS_EVENT_NAMES.ARTIFACT_CREATED]:   { schema: artifactCreatedPayload,   persisted: true,  aggregateType: 'artifacts' },
  [ARTIFACTS_EVENT_NAMES.RECORDING_STARTED]:  { schema: recordingStartedPayload,  persisted: false, aggregateType: 'artifacts' },
  [ARTIFACTS_EVENT_NAMES.RECORDING_STOPPED]:  { schema: recordingStoppedPayload,  persisted: false, aggregateType: 'artifacts' },
} as const satisfies EventRegistry;

export type ArtifactsRegistry = typeof artifactsRegistry;

export function makeArtifactsEmitters(bus: TypedBus<ArtifactsRegistry>, onEmit?: (envelope: Envelope) => void) {
  const emit = createEventHelpers(bus, onEmit);
  return {
    artifactCreated:   emit(ARTIFACTS_EVENT_NAMES.ARTIFACT_CREATED),
    recordingStarted:  emit(ARTIFACTS_EVENT_NAMES.RECORDING_STARTED),
    recordingStopped:  emit(ARTIFACTS_EVENT_NAMES.RECORDING_STOPPED),
  };
}
export type ArtifactsEmitters = ReturnType<typeof makeArtifactsEmitters>;
```

**NOTE on aggregateId:** planner must decide per-event. Pool uses per-device `aggregateId: deviceId` (not POOL_AGGREGATE_ID) for all 4 events. For artifacts the most consistent mapping is:
- `artifact.created` → `aggregateId: artifactId` (each artifact is its own aggregate; matches `aggregateType: 'artifacts'`).
- `recording.started` / `recording.stopped` → `aggregateId: recordingId` (a recording IS an aggregate across start/stop lifecycle). Matches EVENTS-02 envelope invariants.

**Source:** `server/pool/events.ts` lines 47-175; `server/reporting/events.ts` lines 38-132.

### Pattern 2: Canonical `queue.ts` for `recording.upload` (copy-paste from pool reap, NOT reporting webhook)

```typescript
// Source adapted from: server/pool/queue.ts (on-demand + scheduled) + server/reporting/queue.ts (retry shape)
// recording.upload is ON-DEMAND only — no boss.schedule() call. Matches Phase 16 hook.run shape.
import type pino from 'pino';
import type { FastifyInstance } from 'fastify';
import { QUEUE_NAMES } from '../queue/names.js';
// …

export const RECORDING_UPLOAD_QUEUE_NAME = QUEUE_NAMES.RECORDING_UPLOAD;  // Wave 0 extends names.ts

export const recordingUploadPayloadSchema = z.object({
  jobId: z.string().uuid(),
  recordingId: z.string().uuid(),
  outputPath: z.string(),
  durationSec: z.number().nonnegative(),
  frameCount: z.number().int().nonnegative(),
  codec: z.string(),
  fileName: z.string(),      // e.g. 'recording.mp4'
  mimeType: z.string(),      // e.g. 'video/mp4'
});
export type RecordingUploadPayload = z.infer<typeof recordingUploadPayloadSchema>;

export interface RegisterArtifactsWorkerDeps {
  fastify: FastifyInstance;
  artifactService: ArtifactService;
  emit: ArtifactsEmitters;
  logger: pino.Logger;
}

export async function registerArtifactsWorker(deps: RegisterArtifactsWorkerDeps): Promise<{workerIds: string[]}> {
  const { fastify, artifactService, emit, logger } = deps;

  // Create queue — SC3 layer 1 (queue-side idempotency).
  // policy:'stately' + singletonKey:recordingId → duplicate enqueue with same recordingId
  // returns null on the duplicate (matches Phase 16 hook_runs pattern).
  await fastify.boss.createQueue(RECORDING_UPLOAD_QUEUE_NAME, {
    policy: 'stately',
    retryLimit: 3,          // recording artifact is forgiving — 3 attempts plenty
    retryBackoff: true,
    retryDelay: 5,          // seconds
  } as never);

  const workerId = await fastify.queue.work<RecordingUploadPayload>(
    RECORDING_UPLOAD_QUEUE_NAME,
    async (data, jobId) => {
      const parsed = recordingUploadPayloadSchema.parse(data);
      const log = logger.child({ queue: RECORDING_UPLOAD_QUEUE_NAME, jobId, recordingId: parsed.recordingId });

      // SC3 layer 2 (DB-side idempotency). `.onConflictDoNothing({target: artifacts.recordingId})`
      // means replaying the same recordingId → 0 rows inserted, NO error thrown.
      // artifactService.createArtifactIdempotent() wraps this (new method — see §Schema Change).
      const created = await artifactService.createArtifactIdempotent({
        jobId: parsed.jobId,
        recordingId: parsed.recordingId,     // NEW FIELD — see §Schema Change
        type: 'video',
        filePath: parsed.outputPath,
        fileName: parsed.fileName,
        mimeType: parsed.mimeType,
        // durationSec / frameCount / codec stored as-is OR stashed in metadata column
        // (artifacts table has no duration column today — see §Open Question 2)
      });

      if (created) {
        emit.artifactCreated(created.id, {
          artifactId: created.id,
          jobId: parsed.jobId,
          type: 'video',
          filePath: parsed.outputPath,
          fileName: parsed.fileName,
          mimeType: parsed.mimeType,
          fileSizeBytes: null,  // or fetched via stat
        });
        log.info({ artifactId: created.id }, 'Recording artifact created');
      } else {
        log.warn('Recording upload replayed — existing artifact row preserved (SC3 idempotency)');
      }
    },
  );

  return { workerIds: [workerId] };
}
```

**Source:** `server/pool/queue.ts` (pool reap shape); `server/reporting/queue.ts` (validating worker payload with Zod); `server/hooks/queue.ts` (policy:'stately' + singletonKey pattern).

**No schedule call.** Unlike `device.reap` (cron) or `lifecycle.*` (cron), `recording.upload` is on-demand — enqueued by the `job.completed` subscriber when a recording file exists. This matches `hook.run` + `webhook.deliver` (both on-demand).

### Pattern 3: Subscriber wiring inside `internal/module.ts` (sub-option C, copy from reporting)

```typescript
// Source: server/reporting/internal/module.ts lines 147-211
// Adapted for artifacts: two subscriptions (job.started + job.completed) instead of one.

registerWorkersAndSubscribers: async () => {
  // 1. Register the recording.upload worker.
  const registration = await registerArtifactsWorker({
    fastify: deps.fastify, artifactService, emit, logger,
  });
  workerIds = registration.workerIds;

  // 2. Subscribe to job.started (bus-only — NOT persisted per Phase 21 event policy;
  //    see §Cross-Module Wiring Decision below for why `fastify.onPersisted` is still usable
  //    via the cast that reporting established — but ALSO see §Pitfall 7 about subscribing to
  //    non-persisted events).
  //
  //    ALTERNATIVE: subscribe via `fastify.jobsModule.bus.on('job.started', ...)` directly —
  //    cleaner for non-persisted events, matches the cross-module subscription pattern
  //    documented in pool/MODULE.md §Events Emitted.

  unsubscribeJobStarted = deps.fastify.jobsModule.bus.on('job.started', async (payload) => {
    // Start recording + screenshot stub + memory sampling.
    // Resolve adbSerial from deviceId via fastify.pool.getDevice(...) — same resolution
    // job-service.ts does today at lines 229-231.
    const deviceInfo = deps.fastify.pool.getDevice(payload.deviceId);
    const adbSerial = deviceInfo?.port != null ? `emulator-${deviceInfo.port}` : payload.deviceId;

    // Ensure artifact dir exists.
    await artifactService.ensureJobDir(payload.jobId);

    // Start recording (scrcpy → adb fallback path unchanged from recording-service.ts:47-116).
    const outputPath = artifactService.getArtifactPath(payload.jobId, 'recording.mp4');
    const recordingId = randomUUID();  // NEW: generated here, threaded through to stopRecording → upload
    try {
      await recordingService.startRecording(payload.jobId, outputPath, payload.platform, adbSerial, {
        scrcpyService: deps.fastify.scrcpyService,
        captureService: deps.fastify.captureService,
      });
      emit.recordingStarted(recordingId, {
        jobId: payload.jobId, recordingId, deviceId: payload.deviceId,
        platform: payload.platform, method: /* scrcpy | adb-screenrecord | capture-service */,
      });
      // Stash recordingId in an in-memory Map<jobId, recordingId> owned by the module.
      activeRecordings.set(payload.jobId, recordingId);
    } catch (err) {
      logger.error({ err, jobId: payload.jobId }, 'Failed to start recording from bus subscriber');
    }

    // Start memory sampling (android only) — same shape as job-service.ts:283-296.
    if (payload.platform === 'android') { /* memoryService.startSampling(...) */ }
  });

  // 3. Subscribe to job.completed — stop capture + enqueue upload.
  unsubscribeJobCompleted = deps.fastify.onPersisted('job.completed' as never, async (envelope) => {
    const payload = envelope.payload as { jobId: string; status: string; platform: 'android' | 'ios' };
    const recordingId = activeRecordings.get(payload.jobId);
    if (recordingId) {
      const result = await recordingService.stopRecording(payload.jobId);
      if (result) {
        emit.recordingStopped(recordingId, {
          jobId: payload.jobId, recordingId,
          outputPath: result.outputPath, durationSec: result.duration,
          frameCount: result.frameCount, codec: result.codec,
        });
        // Enqueue recording.upload — SC3 layer 1 triggers HERE.
        await deps.fastify.queue.send(RECORDING_UPLOAD_QUEUE_NAME, {
          jobId: payload.jobId, recordingId,
          outputPath: result.outputPath, durationSec: result.duration,
          frameCount: result.frameCount, codec: result.codec,
          fileName: 'recording.mp4', mimeType: 'video/mp4',
        }, { singletonKey: recordingId });  // SC2 singletonKey per CONTEXT.md verbatim
      }
      activeRecordings.delete(payload.jobId);
    }

    // Stop memory sampling + write file + enqueue memory-artifact creation (similar shape).
    // Handle screenshots that were captured mid-execution (directory scan same as job-service:547-574).
    // Save maestro.log (same as job-service:445-462).
  });
},
```

**Source:** `server/reporting/internal/module.ts` lines 168-211 (onPersisted subscriber pattern). `server/pool/__tests__/subscriber.spec.ts` lines 100-226 (bus.on subscriber testing pattern).

### Pattern 4: Extend `server/jobs/events.ts` with `job.started` (mirror Plan 19-01)

Plan 19-01 precedent: minimal bridgehead — added `job.completed` ONLY; left Phase 23 to extend.

Phase 21 must add `job.started` using the SAME approach (RESEARCH Pitfall 4 below: "consumer migrated, producer not yet migrated" gap):

```typescript
// Source: server/jobs/events.ts lines 42-85 — extend with ONE new entry
export const JOB_EVENT_NAMES = {
  STARTED:   'job.started',     // NEW — Phase 21 bridgehead extension
  COMPLETED: 'job.completed',   // UNCHANGED — Phase 19 Plan 19-01
} as const;

export const jobStartedPayload = z.object({
  jobId: z.string().uuid(),
  deviceId: z.string().uuid(),
  platform: z.enum(['android', 'ios']),
});

export const jobsRegistry = {
  [JOB_EVENT_NAMES.STARTED]:   { schema: jobStartedPayload,   persisted: false, aggregateType: 'job' },  // transient; NOT persisted
  [JOB_EVENT_NAMES.COMPLETED]: { schema: jobCompletedPayload, persisted: true,  aggregateType: 'job' },  // UNCHANGED
} as const satisfies EventRegistry;
```

And extend `makeJobsEmitters`:
```typescript
export function makeJobsEmitters(bus: TypedBus<JobsRegistry>, onEmit?: (envelope: Envelope) => void) {
  const emit = createEventHelpers(bus, onEmit);
  return {
    started:    emit(JOB_EVENT_NAMES.STARTED),    // NEW
    completed:  emit(JOB_EVENT_NAMES.COMPLETED),  // UNCHANGED
  };
}
```

**In `server/jobs/job-service.ts`:** add ONE emit call at line 238-239 (after device is allocated + state updated to running, before Phase-3 services are currently invoked imperatively). Use `this.jobsEmit?.started(job.id, {...})`. When Phase 23 lands the saga, this ONE call becomes `emit.running(job.id, ...)` or similar — easy surgical replacement.

Imperative calls inside `executeJob` lines 243-295 (ensureJobDir, startPreview, startRecording, startSampling) **DELETED**. They move into the artifacts subscriber.

Imperative calls inside the `finally` block lines 490-574 (stopRecording + createArtifact for video + stopSampling + createArtifact for memory + screenshot dir scan + createArtifact for log) **DELETED**. All 5 move into the artifacts `job.completed` subscriber + queue worker.

**NOTE on `maestro.log`:** this is a separate code path (save rawOutput as log artifact, lines 445-462). It is ALSO called from `job-service.ts` but is NOT a recording — it's a write+createArtifact for the Maestro stdout. Planner must decide: (a) also inverted into subscriber (requires passing rawOutput in the `job.completed` envelope), or (b) deferred to Phase 23 Jobs Keystone which rewrites `job-service.ts` entirely. Recommendation: **(b)** — keep maestro.log imperative in `job-service.ts` for now; add a Non-Goal line in MODULE.md documenting it; Phase 23 finishes the inversion. This is consistent with the CONTEXT.md phrasing "zero direct calls into artifact services" — if we strictly enforce that, we need (a). **Plan should pick (a) or (b) explicitly with rationale.**

### Pattern 5: Barrel `index.ts` (1-line internal re-export, MOD-02 strict form)

```typescript
// Source: server/pool/index.ts (Phase 20) — verbatim pattern

export { default as artifactsPlugin } from './plugin.js';

// ONE internal/ re-export line (MOD-02 structural invariant) — factory + type + deps-type.
export { createArtifactsModule, type ArtifactsModule, type CreateArtifactsModuleDeps } from './internal/module.js';

// Back-compat class surfaces (decorator reads stay identical to pre-Phase-21 until Phase 23 cleans them).
export { ArtifactService } from './artifact-service.js';
export { RecordingService } from './recording-service.js';
export { ScreenshotService } from './screenshot-service.js';
export { MemoryService } from './memory-service.js';

// Schemas (Phase 17 unchanged)
export { artifactTypeSchema, artifactSummarySchema, artifactListSchema } from './schemas.js';
export type { ArtifactSummary } from './schemas.js';
export { artifactCreatedMessage, artifactMessageUnion } from './ws-schemas.js';
export type { ArtifactMessage } from './ws-schemas.js';

// Events (Plan-21-xx)
export {
  artifactsRegistry, ARTIFACTS_EVENT_NAMES, ARTIFACTS_AGGREGATE_ID,
  makeArtifactsEmitters,
  artifactCreatedPayload, recordingStartedPayload, recordingStoppedPayload,
} from './events.js';
export type { ArtifactsRegistry, ArtifactsEmitters, ArtifactsEventName } from './events.js';

// Queue (Plan-21-xx)
export {
  RECORDING_UPLOAD_QUEUE_NAME, recordingUploadPayloadSchema,
  registerArtifactsWorker,
} from './queue.js';
export type { RecordingUploadPayload, RegisterArtifactsWorkerDeps, ArtifactsWorkerRegistration } from './queue.js';
```

### Anti-Patterns to Avoid

- **`export *` barrels** — PROJECT-level Out of Scope in REQUIREMENTS.md (line 126). Use named exports.
- **Deep imports into `server/artifacts/internal/**`** — dep-cruiser rule 5 fails CI. Outside consumers use the barrel.
- **Calling `bus.emit()` directly from anywhere other than `events.ts`** — ESLint rule no-direct-bus-emit-outside-events-ts + dep-cruiser rule 6 both forbid it. Emit via `emit.artifactCreated(...)` helpers.
- **Using `policy: 'standard'` for `recording.upload`** — must be `'stately'` for singletonKey dedup to activate (RESEARCH §Pitfall 5 confirms Phase 16 Plan 16-01 empirical finding: `standard` policy's singleton_on regex covers time-slot dedup only, NOT singleton_key).
- **Fire-and-forget bus.emit inside a pre-tx-commit code path** — REQUIREMENTS.md line 123 explicitly forbids "Emit eventos antes de commit de transacao". The existing job-service `saveJobResult` → `this.jobsEmit.completed(...)` chain commits DB first then emits (line 388 → line 436-443); preserve that order for `job.started` too (emit AFTER the DB update to 'running' at line 196-200).
- **Placing the subscribers registration BEFORE pool plugin** — artifacts plugin deps must include `pool-plugin` (for `fastify.pool.getDevice`), `queue`, `event-bus`, `job-plugin` (for `fastify.jobsModule.bus`), `db`, `config`. See §Plugin Dependencies below.
- **Losing the scrcpy/adb fallback path** — `recording-service.ts` lines 57-116 must not be touched in Phase 21. The subscriber passes through method selection via the existing `startRecording` contract; wrap its return to learn `method` for the `recording.started` payload.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---|---|---|---|
| Queue-side idempotent enqueue | In-memory `Set<recordingId>` guard | pg-boss `policy:'stately' + singletonKey` | Crashes lose the set; policy:'stately' is DB-resident and persists across restarts. Phase 16 Plan 16-01 EMPIRICALLY confirmed: `job_i3` state<=active index makes back-to-back sends with same singletonKey return null on the duplicate (pg-boss v12 source `node_modules/pg-boss/dist/plans.js:467-485`). |
| DB-side idempotent insert | `SELECT ... ; if (!row) INSERT ...` | `INSERT ... ON CONFLICT (recording_id) DO NOTHING` + unique constraint | TOCTOU race: two workers hit the same recordingId in parallel, both SELECT miss, both INSERT → duplicate. Atomic upsert is the only correct implementation. Drizzle ships `.onConflictDoNothing({target: ...})`. Phase 16 Plan 16-01 established the pattern for hook_runs PK. |
| Thread correlationId manually through the subscribe path | `subscriber(payload, correlationId)` | Let `fastify.queue.send` + `fastify.bus.on` do it | Phase 15 substrate already: (a) `fastify.queue.send` reads ALS and injects correlationId into the job envelope; (b) `fastify.queue.work` restores ALS from the envelope before invoking the handler; (c) `onPersisted` wrapper sets `currentEventId` into ALS so downstream emits auto-populate causationId. **Subscribers NEVER thread correlationId.** |
| Reimplement scrcpy → adb-screenrecord fallback | Touching `RecordingService.startRecording` | Call the existing method and record which branch fired | The fallback logic is stable (shipped post-Phase-16); `method: 'scrcpy' | 'adb-screenrecord' | 'capture-service'` can be surfaced by inspecting which internal Map (`this.recordings` vs `this.adbRecordings`) got populated. Add a read-only getter `getRecordingMethod(jobId): method \| null`. |
| Maintain a parallel in-memory `activeRecordings: Map<jobId, recordingId>` in the subscriber | Derive recordingId from DB | Acceptable. Bus subscribers are in-process; pool's `HealthChecker` also maintains a Map of device failures. The Map is ephemeral — on restart, any in-flight recordings orphan and get reaped. Document this in MODULE.md Non-Goals. |
| Roll own `job.started` event schema | Reuse Plan 19-01 bridgehead idiom | `server/jobs/events.ts` extension | One-line registry addition + one-call-site emit in job-service.ts. Phase 23 revises the full saga. Phase 19 precedent exact. |
| Copy+paste `persistEnvelope` into a shared helper now | Inline the 10-line duplicate a 5th time | 4th sample point is "inline it" per all 4 predecessor decisions | Phase 27+ consolidation trigger. Mark the duplicate with a comment ("5th sample point — Phase 27+ consolidation trigger reached") to force the issue in Phase 27. |

**Key insight:** Every hand-rolled version of these has a known failure mode (TOCTOU races, lost-on-restart Sets, duplicate-event chains), AND a canonical pattern already proven by 4 prior phases exists in-tree. Planner should spot-check `server/pool/*`, `server/reporting/*` before writing new code.

## Common Pitfalls

### Pitfall 1: "Consumer migrated, producer not yet migrated" bridgehead gap
**What goes wrong:** Plan naively subscribes to `job.started` / `job.completed` assuming they already exist; but `job.started` does NOT exist yet (Plan 19-01 only added `job.completed`).
**Why it happens:** Cross-phase coupling isn't obvious until you read Plan 19-01's NOTE section.
**How to avoid:** Wave 0 substrate plan adds `job.started` to `server/jobs/events.ts` BEFORE any subscriber code. Use the exact bridgehead shape from Plan 19-01: new event entry + payload schema + makeJobsEmitters extension. Phase 23 reshapes when the full saga lands.
**Warning signs:** A subscriber test passes locally (mocks the event) but `fastify.onPersisted('job.started', ...)` with the real bus throws "Unknown event type: job.started" because it's not in `jobsRegistry`.
**Source:** `server/jobs/events.ts` file-level NOTE + STATE.md 2026-04-21 Plan 19-01 entry.

### Pitfall 2: `singletonKey` only activates on `policy: 'stately'` (NOT `'standard'`)
**What goes wrong:** Plan specifies `policy: 'standard'` (the default) thinking singletonKey "just works"; pg-boss v12 silently accepts the second enqueue. SC3 fails.
**Why it happens:** Historical pg-boss docs conflate `singleton_on` (time-slot dedup via `short` policy) with `singleton_key` (state-bound dedup via `stately`).
**How to avoid:** Plan the queue as `policy: 'stately'` in Wave 0 AND verify empirically in a DB-gated spec: send 2× with same recordingId, assert `findJobs(RECORDING_UPLOAD)` returns 1 row, then release the singleton (worker completes) and confirm a third send CAN succeed.
**Warning signs:** You "fix" the bug by also checking the DB, but the DB-layer fix is incomplete on its own because two concurrent workers can both emit `artifact.created` even if the DB atomically absorbs one.
**Source:** `server/hooks/queue.ts` (Phase 16 Plan 16-01 STATE.md entry cites `node_modules/pg-boss/dist/plans.js:467-485` inspection).

### Pitfall 3: pg-boss createQueue ordering (no schedule here, but still matters for DLQ FK)
**What goes wrong:** Plan creates main queue before DLQ queue and gets a pg-boss "queue not found" FK violation.
**Why it happens:** pg-boss v12 enforces FK on `queue.dead_letter_queue_name → queue.name`.
**How to avoid:** Phase 21 does NOT need a DLQ for `recording.upload` (it's not external-facing like webhook delivery — a failed upload is just a missing artifact row, not a downstream consumer miss). Don't add DLQ to avoid the ordering constraint. If SC3 reveals operational need later, Phase 27+ can add it.
**Source:** `server/reporting/queue.ts` lines 80-104 — explicit DLQ-first ordering with cross-reference to RESEARCH §Pitfall 2.

### Pitfall 4: `fastify.onPersisted(type, ...)` only works for persisted events
**What goes wrong:** Plan subscribes to `job.started` via `app.onPersisted('job.started', ...)` but the event is non-persisted (no `persisted: true` flag). The bus plugin's side-channel `<type>.envelope` still fires for non-persisted events in this codebase (see `server/bus/plugin.ts:84` — fires UNCONDITIONALLY; persistence is gated on line 87). So `onPersisted` actually works for both! But the decorator type signature is keyed on `demoRegistry` (Phase 15 substrate), not on `jobsRegistry`, requiring a cast.
**Why it happens:** Bus plugin's `fastify.onPersisted` decorator signature (`server/bus/plugin.ts` lines 60-64) pre-dates per-module registries. Reporting works around this with a load-bearing cast (`internal/module.ts` lines 163-166).
**How to avoid:** Either (a) subscribe via `deps.fastify.jobsModule.bus.on('job.started', handler)` for non-persisted events — cleaner typing, same semantics since they share the same EventEmitter side-channel; or (b) use the reporting cast pattern. Recommendation: **(a) for `job.started`, (b) for `job.completed` to preserve the reporting precedent and because persisted events need the ALS `currentEventId` injection for causation chaining (TRACE-09).**
**Source:** `server/bus/plugin.ts` lines 60-64 and lines 82-89; `server/reporting/internal/module.ts` lines 163-166.

### Pitfall 5: Per-module persistEnvelope duplicate (5th sample point)
**What goes wrong:** Planner extracts the 10-line `persistEnvelope` into a shared helper during Phase 21, causing a cross-module refactor that expands scope.
**Why it happens:** DRY instinct.
**How to avoid:** REPLICATE the 10-line duplicate unchanged. Add a comment "5th sample point — Phase 27+ consolidation trigger reached; do NOT consolidate yet — triggers cross-module change". 4 predecessors (hooks / lifecycle / reporting / pool) all explicitly deferred this exact refactor.
**Source:** `server/pool/internal/module.ts` lines 73-113 + STATE.md entries marking each predecessor's decision.

### Pitfall 6: Emit ordering relative to DB commit
**What goes wrong:** Emit `artifact.created` from inside an async worker BEFORE the DB INSERT resolves → subscriber sees the envelope, queries the DB by `artifactId`, misses (not committed yet), logs spurious "artifact not found".
**Why it happens:** Tx-and-emit are not atomic; pgboss v12 doesn't have an `afterCommit` hook inside worker handlers.
**How to avoid:** Always `await artifactService.createArtifactIdempotent(...)` FIRST, then `emit.artifactCreated(...)`. Since createArtifactIdempotent uses `.onConflictDoNothing()`, its `await` resolves after the INSERT commits (Drizzle default is autocommit per statement). Reporting's pattern at `queue.ts` lines 111-151 is the exact shape.
**Source:** REQUIREMENTS.md line 123 "Out of Scope: Emit eventos antes de commit de transacao — Dual-write classico"; `server/reporting/queue.ts` lines 111-151.

### Pitfall 7: Subscribing to `fastify.jobsModule.bus` before `job-plugin` has registered
**What goes wrong:** `artifact-plugin` registers BEFORE `job-plugin` in `server/index.ts:123-130`. If artifacts' `registerWorkersAndSubscribers` runs during the plugin body (before `onReady`), `fastify.jobsModule` is not yet decorated — error.
**Why it happens:** Fastify decorator order follows plugin registration order (reverse is onClose). Artifacts (step 11) < jobs (step 13).
**How to avoid:** Two options: (a) defer `registerWorkersAndSubscribers` to an `onReady` hook inside artifacts plugin; (b) reorder plugins so `job-plugin` registers BEFORE `artifact-plugin`. Option (b) is intrusive (12 plugins with a locked dependency chain — plan-order.spec asserts order). Option (a) matches the Phase 16 hooks precedent (hook subscribers initialize in onReady). **Recommendation: (a) defer to onReady.**
**Warning signs:** Spec passes locally because mock Fastify has all decorators; full-app boot throws `fastify.jobsModule is undefined` or `TypeError: Cannot read property 'bus' of undefined`.
**Source:** `server/index.ts` lines 124-130 (plugin order); `server/hooks/plugin.ts` (onReady subscriber registration pattern).

### Pitfall 8: Recording method detection
**What goes wrong:** `recording.started` payload includes `method: 'scrcpy' | 'adb-screenrecord' | 'capture-service'`, but `RecordingService.startRecording` returns `void` — there's no way to know which branch fired without a getter.
**Why it happens:** Current `recording-service.ts` design is a black box: try scrcpy, fall back to adb-screenrecord on Android, use CaptureService for iOS. Caller never learns which path succeeded.
**How to avoid:** Add ONE new read-only method `RecordingService.getRecordingMethod(jobId): 'scrcpy' | 'adb-screenrecord' | 'capture-service' | null`. Consult `this.recordings` vs `this.adbRecordings` — returns first hit. Zero behavioural change. (Alternative: `startRecording` returns the method string — but that's a bigger contract change.)
**Source:** `server/artifacts/recording-service.ts` lines 36-116 — look at the 3 success branches.

### Pitfall 9: Screenshot artifact counts are unbounded (directory scan)
**What goes wrong:** Current `job-service.ts` lines 547-574 scans `<jobDir>/screenshots/` at `finally` time and creates artifact rows for every PNG. If a test generates 100 screenshots, 100 `artifact.created` events fire. Without an idempotency key, a replay creates 100 duplicates.
**Why it happens:** Screenshots are captured imperatively during test execution (no advance knowledge of file names).
**How to avoid:** For Phase 21, screenshots can fall back to a `filePath UNIQUE` constraint (path is deterministic: `step-0.png`, `step-1.png`, …). OR: emit a `recordingId`-equivalent keyed to `(jobId, stepIndex)` and use composite unique. **Recommendation: keep screenshots scoped out of `recording.upload` queue entirely — they are in-process-created by screenshot-service, NOT uploaded. The `job.completed` subscriber's directory scan creates rows synchronously via `createArtifactIdempotent({target: artifacts.filePath})` — no queue needed.** SC3 is specifically about `recording.upload`; the screenshot path is a different code flow.
**Source:** `server/jobs/job-service.ts` lines 547-574.

### Pitfall 10: Test files are `.test.ts` not `.spec.ts`
**What goes wrong:** Plan misses MOD-04 renames (4 existing test files).
**Why it happens:** Existing artifacts `__tests__/` has 4 `.test.ts` files (artifact-service / memory-service / recording-service / screenshot-service).
**How to avoid:** Wave 5 close-out plan (template: Plan 20-05) renames via `git mv` with 100% similarity so blame history is preserved. Pattern: `git mv server/artifacts/__tests__/recording-service.test.ts server/artifacts/__tests__/recording-service.spec.ts`.
**Warning signs:** MOD-04 spec-renames forgotten. Phase 30 Test Migration Cleanup catches this but ideally we close cleanly here.
**Source:** Phase 20 Plan 20-05 STATE.md entry.

### Pitfall 11: Dev-mode ts-watch behaviour on DB-gated specs
**What goes wrong:** DB-gated specs (queue.spec.ts + subscriber.spec.ts) run in CI only when `TEST_DATABASE_URL` is set, but Vitest picks them up in watch mode locally and just prints "SKIPPED" noise.
**Why it happens:** Phase 19/20 precedent: `describe.skipIf(!HAS_DB)` + `console.warn('[…] SKIPPED: set TEST_DATABASE_URL…')`.
**How to avoid:** Copy the exact skip guard pattern from `server/pool/__tests__/subscriber.spec.ts` lines 37-45. Uses isolated `pgboss_artifacts_<suffix>` schema for parallel-test safety.
**Source:** `server/pool/__tests__/subscriber.spec.ts` and `server/pool/__tests__/correlation.spec.ts` opening blocks.

### Pitfall 12: `RecordingService.startRecording` can throw asynchronously AFTER `this.recordings.set` but before `session.start` resolves
Looking at `recording-service.ts` lines 57-75: `new H264FrameSource(...)` and `session.start(config, frameSource)` can both throw. The current code catches those and falls back to `adb screenrecord`, so the caller observes a clean start OR a full error.
**What goes wrong:** If a plan's subscriber emits `recording.started` BEFORE awaiting `startRecording`, it observes a phantom "started" for a recording that errored.
**How to avoid:** Subscriber awaits `startRecording` first, THEN emits. Same discipline as Pitfall 6.

## Code Examples

Verified patterns from in-tree canonical sources. All referenced lines read during research.

### Example 1: Module barrel (1-line internal re-export — MOD-02 strict)

```typescript
// Source: server/pool/index.ts — full file lines 21-25 (the MOD-02 critical line)
export { default as poolPlugin } from './plugin.js';
export { createPoolModule, type PoolModule, type CreatePoolModuleDeps } from './internal/module.js';
// … other named back-compat exports
```

### Example 2: `onPersisted('job.completed')` subscriber with TRACE-09 causation chaining

```typescript
// Source: server/reporting/internal/module.ts lines 163-211
const onPersisted = deps.fastify.onPersisted as unknown as (
  type: 'job.completed',
  handler: (envelope: Envelope) => void | Promise<void>,
) => () => void;

unsubscribeJobCompleted = onPersisted('job.completed', async (envelope) => {
  const url = deps.config.webhooks?.url;
  if (!url) return;
  // build body, enqueue via fastify.queue.send — correlationId auto-injected from ALS
  const sentJobId = await deps.fastify.queue.send(WEBHOOK_DELIVER_QUEUE_NAME, { url, payload: body }, {});
  emit.scheduled(REPORTING_AGGREGATE_ID, { url, event: 'job.completed', jobId: envelope.aggregateId });
});
```

### Example 3: Idempotent DB insert (pattern for `createArtifactIdempotent`)

```typescript
// Source: server/hooks/internal/hook-run-handler.ts (Phase 16 Plan 16-01 pattern)
// Extended for artifacts table with new recording_id column:
async createArtifactIdempotent(opts: CreateArtifactOpts & { recordingId?: string }): Promise<{id: string} | null> {
  const rows = await this.db.insert(schema.artifacts).values({
    jobId: opts.jobId,
    recordingId: opts.recordingId,
    type: opts.type,
    filePath: opts.filePath,
    fileName: opts.fileName,
    mimeType: opts.mimeType,
    fileSizeBytes: opts.fileSizeBytes,
  })
    .onConflictDoNothing({ target: schema.artifacts.recordingId })
    .returning({ id: schema.artifacts.id });

  return rows[0] ?? null;  // null when conflict skipped the insert
}
```

### Example 4: Queue-side singletonKey (proving SC2 wire-level)

```typescript
// Source: server/hooks/queue.ts + adapted for Phase 21
await fastify.boss.createQueue(RECORDING_UPLOAD_QUEUE_NAME, {
  policy: 'stately',         // CRITICAL: 'stately' not 'standard' (Pitfall 2)
  retryLimit: 3, retryBackoff: true, retryDelay: 5,
} as never);

// At enqueue site (inside job.completed subscriber):
await fastify.queue.send(RECORDING_UPLOAD_QUEUE_NAME, payload, { singletonKey: recordingId });
```

### Example 5: DB-gated subscriber spec skeleton

```typescript
// Source: server/pool/__tests__/subscriber.spec.ts — exact pattern
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { asyncLocalStorage } from '@fastify/request-context';

import correlationPlugin from '../../correlation/plugin.js';
import eventBusPlugin from '../../bus/plugin.js';
import queuePlugin from '../../queue/plugin.js';
import poolPlugin from '../../pool/plugin.js';
import artifactsPlugin from '../plugin.js';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const HAS_DB = typeof TEST_DATABASE_URL === 'string' && TEST_DATABASE_URL.length > 0;
const SCHEMA = `pgboss_artifacts_${Math.random().toString(36).slice(2, 8)}`;

describe.skipIf(!HAS_DB)('[Phase 21-0x] artifacts subscriber proof (SC1 + SC3)', () => {
  // … beforeAll/afterAll identical to pool precedent
  // it('[SC3 idempotency] replaying recording.upload with same recordingId → 1 row, not 2', async () => { /* … */ });
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|---|---|---|---|
| Phase 16 hooks — module barrel used 2-line internal re-export (createHooksModule + HookExecutor shim) | Pool/reporting/lifecycle — STRICT 1-line internal re-export (factory only) | Phase 18 Plan 18-04 / Phase 19 Plan 19-06 / Phase 20 Plan 20-05 | Stricter MOD-02. Phase 21 follows 1-line form. |
| Phase 15/18 ALS restore used `new Map([['correlationId', cid]])` shape | Phase 20 canonicalized plain-object `{correlationId, currentEventId, actor} as never` | Plan 20-01 + CONTEXT.md §Specifics explicitly forbid Map shape in new pool specs | Phase 21 specs MUST use plain-object form. Grep guard in verification: `grep -c "new Map(\[\[" __tests__/ → 0`. |
| Phase 16 hooks — bridgeheadless (hooks was self-contained) | Phase 19/21 — bridgehead extension of another module's events.ts | Phase 19 Plan 19-01 established precedent for extending `server/jobs/events.ts` | Phase 21 extends same file with `job.started`; Phase 23 reshapes fully. |
| Per-module persistEnvelope inlined 1× (Phase 16 hooks) | Now 4× across hooks/lifecycle/reporting/pool | Each predecessor's SUMMARY explicitly deferred consolidation | Phase 21 adds 5th copy; Phase 27+ consolidates. |
| Phase 17 WS schemas emitted from `server/artifacts/ws-schemas.ts` | Still canonical post-Phase 21 | Phase 17 Plan 17-02 | No change needed; MODULE.md must reference these schemas under Public API. |

**Deprecated/outdated:**
- `artifact-plugin.ts` filename — Phase 21 replaces with `plugin.ts` (MOD-05 kebab-case + reserved-file-name). Follow Phase 18/19/20 precedent: `git rm artifact-plugin.ts` + `git add plugin.ts`, update `server/index.ts:10` import path.
- `.test.ts` extension — all 4 existing test files rename to `.spec.ts` (MOD-04).

## Open Questions

### Q1: `artifacts` table schema — does `recording_id` belong on the existing row, or a separate `recordings` table?
**What we know:** Current `artifacts` table has `id`, `jobId`, `type`, `filePath`, `fileName`, `mimeType`, `fileSizeBytes`, `compressed`, `compressedAt`, `createdAt`. One row per artifact (video / screenshot / memory / log). SC3 requires idempotency keyed on `recordingId` — which is a concept only for `type='video'`. Adding `recording_id` nullable UUID UNIQUE to `artifacts` is the least invasive: unique constraint uses partial-index semantics (PostgreSQL allows multiple NULLs per unique by default, so non-video rows can stay null).
**What's unclear:** Does the planner want to keep `recordingId` on the `artifacts` row (join implicit via `id`)? Or introduce a `recordings` table with its own lifecycle (started_at, stopped_at, uploaded_at) and FK to artifacts? The former is simpler, the latter is forward-looking for Phase 22 Streaming Module.
**Recommendation:** Simpler. Add `recording_id UUID UNIQUE` to `artifacts` (nullable; partial-uniqueness fine). Phase 22+ can normalize if needed. Migration is a single-column add.

### Q2: Where do `durationSec` / `frameCount` / `codec` go in the artifacts table?
**What we know:** `artifacts.metadata` column does NOT exist (confirmed via `db/schema.ts` lines 111-126 read). Current video artifact is a row with no metadata beyond `fileSizeBytes`.
**What's unclear:** Plan options: (a) add a `metadata JSONB` column to `artifacts`; (b) stash duration/frames/codec in the `recording.started/stopped` event payloads only (events table becomes the source of truth); (c) skip persisting them — they're only useful for debug.
**Recommendation:** **(b)** — persist in events only. `recording.stopped` is non-persisted (transient) per Pattern 1, so change to `persisted: true` if we want operator visibility via Phase 27 trace-tree. Planner decides; it's a one-line flag flip.

### Q3: Should artifacts module emit a `job.log` -like event for maestro.log artifacts?
**What we know:** `maestro.log` is currently written from job-service.ts:445-462 post-execution. If Phase 21 fully inverts (Pattern 4 decision "a"), the `job.completed` envelope must carry `rawOutput`, which is potentially large (logs can be MB). That violates EVENTS-04 (thin payloads).
**What's unclear:** If we defer maestro.log to Phase 23 (Pattern 4 decision "b"), we leave ONE imperative artifact call site in job-service.ts. That technically violates SC1's "zero direct calls" literal wording.
**Recommendation:** Plan ONE of these, with explicit rationale:
- **b1**: Leave `maestro.log` imperative; MODULE.md Non-Goals documents it; revisit Phase 23. SC1 compromise: "zero direct calls into artifact services for RECORDING/SCREENSHOT/MEMORY paths".
- **b2**: Write `maestro.log` to disk from job-service.ts (unchanged), but emit `maestro.log.written(jobId, filePath)` event; artifacts subscribes and creates the artifact row. Still 1 direct write-to-disk, 0 direct calls into `artifactService.createArtifact`.
Recommendation is **b2** (writes-to-disk + event-triggered row creation) — strict SC1 compliance. Plan should make the decision explicit in Wave 0 design doc.

### Q4: Plugin dependency order — is `job-plugin` a dep of `artifact-plugin`, or vice versa?
**What we know:** Currently artifact (step 11) → jobs (step 13). Jobs has `artifact-plugin` as a dep because `JobService` constructor reads `fastify.artifactService / recordingService / screenshotService / memoryService` decorators. Inverting: artifacts needs `fastify.jobsModule.bus` for the subscriber.
**What's unclear:** After Phase 21 the dependencies should flip: `artifact-plugin` depends on `job-plugin` (for `jobsModule`). But jobs-plugin currently depends on `artifact-plugin` (for the service decorators job-service still uses).
**Recommendation:** Keep the current direction in Phase 21 (artifact before jobs, jobs-plugin depends on artifact-plugin for back-compat decorators). In artifacts `registerWorkersAndSubscribers`, DEFER the bus subscription to an `onReady` hook (Pitfall 7). At onReady time, all plugins are registered, `fastify.jobsModule` is available, and the subscription wires cleanly without plugin-order churn. Phase 23 Jobs Keystone can reverse the dep direction when it removes the artifact service decorator reads from JobService.

### Q5: Test `fixtures/` — what fixtures are needed?
**What we know:** Existing `server/artifacts/__tests__/fixtures/` directory exists but is mostly empty (just what Phase 17 added). Reporting Phase 19 created a shared `failing-server.ts` fixture.
**What's unclear:** For Phase 21, do we need fixture(s)? Possibly:
- A fake `jobsModule` mock for `subscriber.spec.ts` to emit `job.started` without a full jobs plugin boot. Template available at `server/reporting/__tests__/module.spec.ts` lines 21-52 (`makeMockFastify` pattern).
- A stub `RecordingService` that resolves `startRecording` without actually calling `adb` or `scrcpy` (avoid real device dep in CI).
**Recommendation:** One fixture: `__tests__/fixtures/stub-recording-service.ts` with a minimal RecordingService-shaped stub. The other side (mock Fastify for module.spec.ts) is typically inline per Phase 20 Plan 20-03 pattern.

## Validation Architecture

### Test Framework

| Property | Value |
|---|---|
| Framework | Vitest ^3 + @vitest/coverage-v8 (Phase 15 Plan 15-00) |
| Config file | `vitest.config.ts` at project root |
| Quick run command | `npx vitest run server/artifacts/__tests__/` |
| Full suite command | `npm test` |
| Parallel DB isolation | per-file `pgboss_artifacts_<rand>` schemas |

### Phase Requirements → Test Map

Phase 21 has 4 ROADMAP success criteria rather than REQ IDs. Each SC maps to at least one test (MOD-08):

| SC | Behavior | Test Type | Automated Command | File Exists? |
|---|---|---|---|---|
| SC1-a | `job.started` bus event triggers `RecordingService.startRecording` | integration | `npx vitest run server/artifacts/__tests__/subscriber.spec.ts -t "SC1.*recording.*started"` | ❌ Wave 0 (new) |
| SC1-b | `job.completed` bus event triggers `recordingService.stopRecording` + enqueues `recording.upload` | integration | `npx vitest run server/artifacts/__tests__/subscriber.spec.ts -t "SC1.*stopped.*enqueue"` | ❌ Wave 0 |
| SC1-c | `server/jobs/job-service.ts` has ZERO `this.recordingService/screenshotService/memoryService` direct calls | readFileSync grep-guard | `npx vitest run server/artifacts/__tests__/subscriber.spec.ts -t "SC1.*grep-guard"` | ❌ Wave 0 (add readFileSync guards matching pool's `lifecycle-ownership.spec.ts`) |
| SC2 | MODULE.md has 9 H2 sections in fixed order; barrel exports created; `artifact.created` / `recording.started` / `recording.stopped` declared | structural | `npx vitest run server/artifacts/__tests__/events.spec.ts` + grep gate on MODULE.md | ❌ Wave 0 |
| SC2 (queue) | `recording.upload` queue registered with `singletonKey: recordingId` | integration | `npx vitest run server/artifacts/__tests__/queue.spec.ts -t "singletonKey"` | ❌ Wave 0 |
| SC3 | Replaying same recordingId → 1 artifact row, not 2 | integration (DB-gated) | `TEST_DATABASE_URL=… npx vitest run server/artifacts/__tests__/queue.spec.ts -t "SC3.*idempotency"` | ❌ Wave 0 |
| SC4 | Nyquist delta ≥ -2pp on lines | CI script | `npm run nyquist:check` | ✅ (Phase 15 Plan 15-09 substrate) |
| MOD-03 ALS envelope | `emit.artifactCreated` stamps envelope with ALS correlationId | unit | `npx vitest run server/artifacts/__tests__/events.spec.ts` | ❌ Wave 0 |
| MOD-06 factory | createArtifactsModule returns correct surface + shutdown idempotent | unit | `npx vitest run server/artifacts/__tests__/module.spec.ts` | ❌ Wave 0 |
| MOD-04 renames | All `.test.ts` renamed to `.spec.ts` via `git mv` | ls gate | `ls server/artifacts/__tests__/ | grep -c '\.test\.ts$'` → 0 | ❌ (Wave 5 plan) |

### Sampling Rate

- **Per task commit:** `npx vitest run server/artifacts/__tests__/` (<5s; ~30 tests once ramped)
- **Per wave merge:** `npx vitest run server/{artifacts,pool,reporting,jobs}/__tests__/` (<15s; catches cross-module regressions)
- **Phase gate:** Full `npm test` green (all 598+ tests) + `npm run lint` + `npm run dep-check` + `npx tsc --noEmit` (0 new errors) + `npm run nyquist:check` (delta ≥ -2pp)

### Wave 0 Gaps

- [ ] `server/artifacts/MODULE.md` — 9-section contract
- [ ] `server/artifacts/index.ts` — barrel
- [ ] `server/artifacts/plugin.ts` — replaces `artifact-plugin.ts`
- [ ] `server/artifacts/events.ts` — 3-event registry + emitters
- [ ] `server/artifacts/queue.ts` — `recording.upload` registration
- [ ] `server/artifacts/internal/module.ts` — `createArtifactsModule` factory + subscribers
- [ ] `server/jobs/events.ts` — extend with `job.started` entry (bridgehead — Pattern 4)
- [ ] `server/jobs/job-service.ts` — emit `job.started` at line 209-213 zone; DELETE all imperative artifact calls (9 sites)
- [ ] `server/queue/names.ts` — extend `QUEUE_NAMES` with `RECORDING_UPLOAD: 'recording.upload'`
- [ ] Drizzle migration: add `recording_id UUID` column + `UNIQUE` partial index to `artifacts` table
- [ ] `server/db/schema.ts` — add `recordingId` field to `artifacts` pgTable
- [ ] `server/artifacts/artifact-service.ts` — add `createArtifactIdempotent(opts)` method
- [ ] `server/artifacts/recording-service.ts` — add `getRecordingMethod(jobId)` getter (Pitfall 8)
- [ ] `.dependency-cruiser.cjs` — rule 5 (no-deep-imports-into-artifacts-internal); copy-paste rule 4 (pool) with `pool`→`artifacts`
- [ ] `server/artifacts/__tests__/events.spec.ts` — MOD-03 unit proof
- [ ] `server/artifacts/__tests__/module.spec.ts` — MOD-06 factory proof
- [ ] `server/artifacts/__tests__/queue.spec.ts` — DB-gated SC3 idempotency proof
- [ ] `server/artifacts/__tests__/subscriber.spec.ts` — DB-gated SC1 subscriber proof
- [ ] `server/artifacts/__tests__/{artifact,recording,screenshot,memory}-service.spec.ts` — rename from `.test.ts` (Wave 5)
- [ ] `server/__tests__/plugin-order.spec.ts` — extend with artifact→jobs back-compat + artifacts deps assertion (additive inside existing `it` block per Phase 20 Plan 20-06 pattern)

## Sources

### Primary (HIGH confidence)
- **Phase 20 precedents (closest in time + structure):**
  - `server/pool/MODULE.md` — canonical 9-section shape + Runnable Example + explicit Phase 21 forward-reference at lines 44-49.
  - `server/pool/index.ts` — MOD-02 barrel strict form.
  - `server/pool/events.ts` — MOD-03 registry + TRACE-08 persistence policy + v5-UUID aggregateId derivation.
  - `server/pool/queue.ts` — createQueue→work sequence (no-schedule case); policy:'stately' + singletonKey reasoning.
  - `server/pool/internal/module.ts` — createPoolModule factory + persistEnvelope 4th-sample-point duplicate pattern + shutdown idempotency.
  - `server/pool/plugin.ts` — thin Fastify wrapper with 4 decorators (back-compat + new module surface).
  - `server/pool/__tests__/subscriber.spec.ts` — DB-gated bus subscriber test shape.
  - `server/pool/__tests__/correlation.spec.ts` — ALS → emit → envelope → events-table row proof.
  - `server/pool/__tests__/module.spec.ts` — MOD-06 factory spec shape.
  - `server/pool/__tests__/lifecycle-ownership.spec.ts` — readFileSync grep-guard pattern for SC1.
- **Phase 19 precedents (cross-module subscriber + queue with retry):**
  - `server/reporting/internal/module.ts` lines 163-211 — `onPersisted('job.completed')` subscriber + envelope-cast pattern.
  - `server/reporting/queue.ts` — payload Zod parse inside worker + emit + throw-on-failure.
  - `server/reporting/events.ts` — 4-event registry with mixed persistence flags.
  - `server/reporting/MODULE.md` — 9-section contract + Runnable Example.
- **Phase 19 bridgehead (exact precedent for Phase 21 `job.started` addition):**
  - `server/jobs/events.ts` — MINIMAL bridgehead shape.
  - `server/jobs/plugin.ts` — `jobsModule` minimal decorator (Phase 19/21 bridge).
  - Plan 19-01 STATE.md entries (2026-04-21).
- **Phase 16 idempotency precedent (SC3 pattern):**
  - `server/hooks/queue.ts` — policy:'stately' + singletonKey reasoning (exact empirical finding re: pg-boss v12 plans.js).
  - Plan 16-01 STATE.md entry explaining two-layer idempotency (queue + DB).
- **Phase 15 substrate (bus + queue + correlation foundations):**
  - `server/bus/plugin.ts` — `onPersisted` signature + side-channel <type>.envelope mechanism.
  - `server/bus/bus.ts` — TypedBus class + internal ee access.
  - `server/bus/helpers.ts` — createEventHelpers + dual-shape ALS reader.
  - `server/events/envelope.ts` — envelope schema.
  - `server/queue/names.ts` — QUEUE_NAMES extension pattern.
- **Database schema:**
  - `server/db/schema.ts` lines 111-126 — current `artifacts` table shape (pre-Phase-21).
- **Project discipline:**
  - `.planning/REQUIREMENTS.md` — Out of Scope list (anti-patterns); traceability (MOD-09, EVENTS-10 deferred to later phases).
  - `.dependency-cruiser.cjs` — 4-rule pattern; extend with rule 5.

### Secondary (MEDIUM confidence)
- `CLAUDE.md` project root — TypeScript conventions (ES modules with `.js` extensions, Zod boundaries, async-mutex, vi.mock, pluginTimeout).
- `server/jobs/job-service.ts` lines 208-614 — all 9 imperative artifact call sites inventoried.

### Tertiary (LOW confidence — verified by cross-reference)
- **pg-boss v12 `policy: 'stately'` behavior** — claim that `singleton_key` dedup requires `stately` or stricter policy. MEDIUM via Phase 16 Plan 16-01 STATE.md entry which cites `node_modules/pg-boss/dist/plans.js:467-485` empirical inspection. Plan should re-verify by pasting the same grep at Wave 0 spike time to protect against pg-boss minor-version drift.

### Verification Protocol for Planner
- No Context7 / WebSearch lookups performed — all claims are grounded in in-tree canonical files read verbatim during research. This is the 5th module-migration phase; the pattern is mature and well-documented. Any doubt the planner has should be resolved by re-reading the specific pool/reporting/hooks source file cited.

## Metadata

**Confidence breakdown:**
- Standard stack: **HIGH** — all deps installed; no new libraries; 4 predecessor patterns verbatim-referenced.
- Architecture: **HIGH** — MOD-01..09 template fully crystallized across hooks/lifecycle/reporting/pool.
- Pitfalls: **HIGH** — most pitfalls are cross-references to concrete STATE.md entries with empirical grounding.
- Idempotency design: **HIGH** — two-layer (queue + DB) proven in Phase 16, replicable verbatim.
- Cross-module wiring: **HIGH** — Phase 19 established the `job.completed` bridgehead; Phase 21 extends with `job.started`.
- Schema change (recording_id unique): **MEDIUM** — final choice depends on Q1 (single column vs separate recordings table). Recommend simpler.
- `maestro.log` handling: **MEDIUM** — Q3 is a planner decision point (b1 vs b2).

**Research date:** 2026-04-22
**Valid until:** 2026-05-22 (30 days — pattern is stable; pg-boss and Zod are unlikely to have breaking changes inside that window)
