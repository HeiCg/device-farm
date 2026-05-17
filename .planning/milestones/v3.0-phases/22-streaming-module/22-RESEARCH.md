# Phase 22: Streaming Module - Research

**Researched:** 2026-04-22
**Domain:** WebSocket envelope wrapping + bus-subscribed ring-buffer fan-out
**Confidence:** HIGH (Context7/official docs lookups not required — this is an internal-refactor phase; all tooling is already installed + proven across Phases 16/18/19/20/21)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

All implementation choices are at **Claude's discretion** — pure infrastructure phase. The planner follows the Phase 16/18/19/20/21 module template verbatim with the following SPECIFIC guidance copied verbatim from CONTEXT §decisions:

- **Module contract**: Copy the 9-section MODULE.md shape from `server/artifacts/MODULE.md` (the most recently canonicalized reference, Phase 21 close).
- **Events consumed**: `job.log`, `job.step`, `job.status` per ROADMAP success criterion 2. These events are emitted by the jobs module (Phase 23 keystone will formalize them); for Phase 22 the subscribers MUST be resilient to those events not yet existing — safe no-op registration OK until Phase 23 lands, but the bus → broadcaster wire MUST be the code path (no imperative fallback).
- **Events emitted**: `ws.frame.dropped` (persisted per TRACE-08 notable rule — malformed Zod frames dropped → logged structured → optional bus event for ops observability). Planner decides whether this single event is warranted or if structured logging alone suffices (checker-visible via telemetry). Default recommendation: emit the event, mirrors Phase 19's DLQ notable-event pattern.
- **Queue**: **NONE**. WebSocket fan-out is in-process only; there is no queue surface for this module. `queue.ts` stub may be omitted or replaced with a comment explaining why (deviation from Phase 16-21 template is acceptable per MOD-03 "only if the module owns queues").
- **Envelope**: Promote existing `wsEnvelopeSchema` in `server/streaming/ws-schemas.ts` (today has `.loose()` + `v` optional — TODO comment already flags Phase 22 upgrade) to strict form: `{type: z.string(), correlationId: z.string().uuid(), v: z.literal(1), ts: z.string().datetime(), payload: unknown}`. Every existing `JobMessage` type wraps into this envelope. Validation on the server side uses `safeParse`; failures emit `ws.frame.dropped` + structured log + skip send (never crash the client connection).
- **Subscriber wiring**: streaming module subscribes to `job.log` + `job.step` + `job.status` via `fastify.onPersisted(...)` (or `bus.on(...)` — planner picks based on whether these events are persisted terminal vs. transient). Inside the subscriber: read correlationId from ALS → build envelope → `safeParse` → `broadcaster.emit(jobId, envelope)` → EventEmitter fans out to live WS listeners.
- **Tests**: tests-as-spec style matching Phase 16/21 — per-service `.spec.ts` with behavior rows, DB-gated integration specs for envelope correlation (subscribe to a fake `job.log` → assert WS socket receives envelope with correlationId matching ALS context).
- **Renames**: existing `.test.ts` files under `server/streaming/__tests__/` rename to `.spec.ts` via `git mv` 100%-similarity per MOD-04 (5 files: `adapter-factory`, `android-preview-adapter`, `device-preview`, `ios-preview-adapter`, `job-broadcaster`).
- **Barrel discipline**: `server/streaming/index.ts` re-exports strictly from `internal/` per MOD-02. Existing top-level files (`job-broadcaster.ts`, `device-preview.ts`, `websocket-plugin.ts`, `types.ts`, `ws-schemas.ts`, `adapters/`) move under `internal/`; plugin decorators (`jobBroadcaster`, `devicePreview`) remain as Fastify decorator surface but routed through factory-returned module primitives per MOD-06.
- **Idempotency**: Not applicable — WebSocket fan-out is lossy-by-design (stale connections drop messages). No idempotency proof needed (success criterion 3 is about dev tooling, not exactly-once delivery).

### Claude's Discretion

Everything not locked above. Open decisions remain:
- Where to emit `job.log`/`job.step`/`job.status` bridgehead events (Option A recommended: extend `server/jobs/events.ts` in same phase).
- Whether `ws.frame.dropped` is persisted (recommendation: `persisted: false` — high-frequency, structured log is sufficient; events-table bloat not justified).
- Subscriber wiring mechanism (recommendation: `fastify.jobsModule.bus.on(...)` for transient events, mirrors Phase 21 `maestro.log.written` + `job.started` pattern).
- Whether to touch DevicePreviewManager (recommendation: NO — out of scope per CONTEXT §Deferred Ideas; binary frames stay as-is).

### Deferred Ideas (OUT OF SCOPE)

- **DevicePreviewManager envelope wrapping** — binary base64 frames don't fit the Zod envelope shape. Deferred to Phase 29 (Web Refactor) if/when web client wants structured metadata alongside binary frames.
- **Sharing `wsEnvelopeSchema` types with the web client via generated artifact** — lands in Phase 29 (WEB-03 "Schemas Zod de WS messages compartilhados server↔web") and Phase 17 contract pipeline export.
- **WS replay semantics beyond 200-message ring buffer** (e.g., server-side persistent replay) — out of scope; ring buffer is sufficient for reconnect.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| **TRACE-06** | Toda mensagem WebSocket carrega `correlationId` no envelope; web UI linka message a log entry | §Technical Design §Envelope Shape + §Subscriber Wiring (ALS → envelope stamping; TRACE-04 reuse); §Validation Architecture maps SC1/SC3 to envelope round-trip test + grep-guard on raw `socket.send(JSON.stringify(msg))` calls |
</phase_requirements>

## Summary

Phase 22 inverts the streaming trigger surface: today `server/jobs/job-service.ts` imperatively calls `this.jobBroadcaster?.emit(jobId, msg)` 7 times inside `executeJob` (status/log/step callbacks). After Phase 22 those callsites become `this.jobsEmit?.log(...) / step(...) / status(...)` bus emits, and a new `server/streaming/internal/` subscriber factory listens on the jobs module bus, wraps each payload in a strict Zod-validated envelope `{type, correlationId, v:1, ts, payload}`, and pushes it into the existing `JobBroadcaster` ring buffer which fans out to live WS clients via the same `EventEmitter` path. The ring-buffer replay semantics (≤200 messages on reconnect) are preserved — envelopes are stored instead of raw `JobMessage`s, so reconnecting clients replay enveloped frames identical to live frames.

The phase follows the Phase 16/18/19/20/21 canonical module shape adapted for the NO-QUEUE deviation: `MODULE.md` (9 H2 sections with "Queue Produced/Consumed = None"), `index.ts` barrel (MOD-02 strict 1-line internal/ re-export), `events.ts` (single `ws.frame.dropped` event — smallest surface in v3.0 to date), `internal/module.ts` createStreamingModule factory (MOD-06, mirrors Phase 20 pool's 4-decorator pattern but with `jobBroadcaster + devicePreview + streamingModule` 3-decorator shape), thin `plugin.ts` replacing `websocket-plugin.ts`, and tests-as-spec under `__tests__/` (5 renames + 3-5 new spec files).

**Primary recommendation:** Execute Option A from CONTEXT §code_context — land bridgehead events (`job.log`, `job.step`, `job.status`) in `server/jobs/events.ts` as part of Phase 22 scope. Phase 21 set the precedent with `job.started` + `maestro.log.written`; Phase 22 continues it. Without bridgehead events the streaming subscriber has no real events to consume and the "bus → broadcaster wire" path cannot be proven end-to-end.

## Technical Design

### Envelope Shape (strict, replaces `.loose()` placeholder)

Location: `server/streaming/internal/ws-schemas.ts` (file moves under `internal/` as part of MOD-02 barrel compliance).

```typescript
// Source: Phase 22 scope — tightens Phase 17 Plan 17-02 placeholder.
export const wsEnvelopeSchema = z.object({
  type:          z.string().min(1),                          // e.g. 'log' | 'step' | 'status' (JobMessage wrapper)
  correlationId: z.string().uuid(),                          // ALS-sourced; TRACE-06 requirement
  v:             z.literal(1),                               // SPEC-10 version pin
  ts:            z.string().datetime(),                      // ISO8601; replaces JobMessage.timestamp
  payload:       z.unknown(),                                // The original JobMessage.data — type-narrowed downstream via discriminated union (Phase 29)
}).meta({
  id: 'WsEnvelope',
  description: 'Strict envelope for every job-channel WS frame (TRACE-06)',
});

export type WsEnvelope = z.infer<typeof wsEnvelopeSchema>;
```

**Decisions locked by research:**

1. **No `.loose()` / `.passthrough()`** — the Phase 17 placeholder used `.loose()` for forward-compat; Phase 22 tightens to strict because the envelope is the contract boundary. Per-event-type payload extensions live in the `payload` field, not at envelope level. (This aligns with SPEC-08 "additive changes only" — additions go inside `payload`, envelope shape is stable.)

2. **`v: z.literal(1)` required (not optional)** — Phase 17 left it optional with a TODO. Phase 22 flips to required. SPEC-10 envelope-of-envelope discriminated-union migration preparation.

3. **`ts` (not `timestamp`)** — the existing `JobMessage.timestamp` field is ISO8601, so naming aligns with `occurredAt` in the bus envelope (Phase 15). Shorter form `ts` saves bytes on the wire — each WS frame can emit 10-100/sec during a running job.

4. **`payload: z.unknown()`** — NOT the full `JobMessage` type (which has `type` + `data` + `timestamp`). The envelope's `type` field supersedes `JobMessage.type`, and `payload` carries only the `data` portion. This avoids double-encoding the type discriminator.

5. **Wire naming matches existing `JobMessage.type` values** — `'log' | 'step' | 'metrics' | 'status'` (see `server/streaming/types.ts:3`). Envelope `type` field uses these same 4 literal strings. No rename.

**Example frame on the wire (after Phase 22):**

```json
{
  "type": "log",
  "correlationId": "7f4c3e90-2c8f-47c1-9c8a-3d3c8f7e4a12",
  "v": 1,
  "ts": "2026-04-22T19:47:12.138Z",
  "payload": { "line": "Running flow: login.yaml", "stream": "stdout" }
}
```

### Bus Event Surface

**Inbound (consumed by streaming module — Phase 22 SCOPE):**

| Event | Persisted | Source | Rationale |
|-------|-----------|--------|-----------|
| `job.log` | `false` | `server/jobs/events.ts` (bridgehead extension — Phase 22 scope) | Log lines fire 10-100/sec during a running job; persisting each to the `events` table bloats storage. Derivable from `events.maestroLogWritten` + the on-disk `maestro.log` file if needed. |
| `job.step` | `false` | `server/jobs/events.ts` (bridgehead) | Step transitions fire per Maestro flow (typical: 10-50/job). Not persisted — derivable from `jobSteps` DB table which `job-service.ts.saveJobResult` already writes. |
| `job.status` | `false` | `server/jobs/events.ts` (bridgehead) | Status transitions fire 2-5 times/job (`running` → terminal). `job.completed` is already persisted in `events` table (Phase 19 bridgehead); `job.status` duplicates that surface for streaming purposes. |

**Outbound (emitted by streaming module — Phase 22 SCOPE):**

| Event | Persisted | Payload | Trigger |
|-------|-----------|---------|---------|
| `ws.frame.dropped` | `false` (recommended) | `{jobId, eventType: string, reason: 'safeParse-failed' \| 'unknown', zodError?: string}` | Inside the subscriber, when `wsEnvelopeSchema.safeParse` returns `success: false`. Structured logging carries the full context; bus event allows future ops dashboards (Phase 27+). |

**Persistence recommendation for `ws.frame.dropped`:** `persisted: false`. Rationale:
- Frame-drop events fire ONLY on programmer error (envelope builder produced a malformed shape). This is a bug, not operational data — structured log + alert is more valuable than an `events` table row.
- Phase 19 persisted `webhook.failed.retryExhausted` because it's a **terminal business outcome** (webhook truly never delivered). Phase 20 persisted `device.health.failed` because it's **operational telemetry** (Phase 27 trace-tree surface). `ws.frame.dropped` is neither — it's a defensive sanity check.
- If Phase 27+ operations team needs dashboards, flip `persisted: true` and backfill. The registry pattern makes this a 1-line change.

### Subscriber Wiring

**Recommendation: `fastify.jobsModule.bus.on(...)` for all 3 events (non-persisted, direct bus subscription).**

Rationale:
1. All 3 events are `persisted: false`. `fastify.onPersisted` is the wrapper that also injects `currentEventId` into ALS for TRACE-09 causation chaining — useful for persisted events where the DB row needs a causation link. For streaming's transient frames, causation threading adds no downstream value.
2. Phase 21 set the precedent: `maestro.log.written` (non-persisted) uses `fastify.jobsModule.bus.on('maestro.log.written', handler)`; `job.completed` (persisted) uses `fastify.onPersisted('job.completed', handler)`. Phase 22 matches Phase 21's pattern — all 3 new events are non-persisted → all 3 use `bus.on(...)`.
3. Deferred-to-onReady plugin-order workaround (Phase 21 §Pitfall 7) applies: streaming plugin registers at step 10 (renamed from `websocket-plugin` at step 10), but `fastify.jobsModule` isn't decorated until step 13. Subscriber registration MUST be deferred to `fastify.addHook('onReady', ...)`.

**Subscriber handler shape:**

```typescript
// Inside createStreamingModule factory, deferred to onReady:
fastify.addHook('onReady', async () => {
  const handler = (eventType: 'log' | 'step' | 'status') =>
    (payload: { jobId: string; data: unknown }) => {
      const correlationId = readAls('correlationId') ?? randomUUID();  // Phase 21 readAls helper
      const candidate = {
        type: eventType,
        correlationId,
        v: 1 as const,
        ts: new Date().toISOString(),
        payload: payload.data,
      };
      const parsed = wsEnvelopeSchema.safeParse(candidate);
      if (!parsed.success) {
        logger.warn({ err: parsed.error, candidate }, 'ws.frame.dropped: safeParse failed');
        emit.frameDropped(payload.jobId, {
          jobId: payload.jobId,
          eventType,
          reason: 'safeParse-failed',
          zodError: parsed.error.message,
        });
        return;                                 // Drop — never send malformed to client
      }
      broadcaster.emit(payload.jobId, parsed.data);
    };

  unsubscribeJobLog    = fastify.jobsModule.bus.on('job.log' as never, handler('log'));
  unsubscribeJobStep   = fastify.jobsModule.bus.on('job.step' as never, handler('step'));
  unsubscribeJobStatus = fastify.jobsModule.bus.on('job.status' as never, handler('status'));
});
```

**Key mechanism (same as Phase 21):**
- Subscriber reads `correlationId` from ALS via the `readAls` helper already at `server/bus/helpers.ts:65-77` (dual-shape Map/plain-object reader).
- When the subscriber runs inside the same request fiber as the producer (job-service during `executeJob`), the correlationId flows naturally.
- When the subscriber runs inside a pg-boss worker fiber (Phase 23+ saga), the `queue.work` wrapper at `server/queue/plugin.ts:196-208` restores ALS before invoking the handler; correlationId flows.

**Ring-buffer preservation:** `JobBroadcaster` moves under `internal/` unchanged. `broadcaster.emit(jobId, envelope)` stores the envelope in the per-job buffer (MAX_BUFFER=200) and fans out to live WS listeners via `EventEmitter`. On reconnect, `broadcaster.subscribe(jobId, handler)` replays the buffered ENVELOPES (not raw JobMessages) — so the ≤200-message replay now delivers enveloped frames, which is exactly what SC2 requires.

**CRITICAL change to `broadcaster.subscribe` signature:** The current `subscribe(jobId, handler: (msg: JobMessage) => void)` becomes `subscribe(jobId, handler: (envelope: WsEnvelope) => void)`. The WS route handler in plugin.ts changes from `socket.send(JSON.stringify(msg))` to `socket.send(JSON.stringify(envelope))` — functionally identical, just a different object shape. Ring buffer type changes from `JobMessage[]` to `WsEnvelope[]`.

### DB Considerations

**None.** Streaming module owns no DB tables. The existing `events` table (Phase 15) remains the persistence surface for bus events that the registry marks `persisted: true` — and Phase 22 recommends `ws.frame.dropped` as `persisted: false`, so no writes there either.

The `events` table will receive entries from Phase 22's bridgehead additions to `jobsRegistry` ONLY if `job.log`/`job.step`/`job.status` are flipped to `persisted: true` — but CONTEXT locks these to `persisted: false`. So the streaming module performs ZERO DB writes.

**DB-gated spec caveat:** The existing Phase 21 DB-gated spec pattern (subscriber.spec, correlation.spec) boots a real Fastify stack including `queuePlugin` + `dbPlugin` because `fastify.queue` and `fastify.db` are in the dependency graph. Phase 22's module has NO queue, but the plugin's `dependencies: ['config', 'auth', 'pool-plugin', 'event-bus', ...]` still needs `event-bus` which needs `db`. DB-gated specs for Phase 22 follow the Phase 21 pattern to get bus + onPersisted wiring but assert purely on in-memory state (WS frame received, ring buffer contents, `fastify.bus` subscriber invocation count).

### Jobs Events Bridgehead Extension (Option A recommended)

**Location:** `server/jobs/events.ts`. Matches Phase 19 Plan 19-01 precedent (added `COMPLETED`), Phase 21 Plan 21-02 precedent (added `STARTED` + `MAESTRO_LOG_WRITTEN`).

Extends `JOB_EVENT_NAMES` from 3 keys → 6 keys:

```typescript
export const JOB_EVENT_NAMES = {
  // Phase 19 / Plan 19-01
  COMPLETED:           'job.completed',
  // Phase 21 / Plan 21-02 bridgehead
  STARTED:             'job.started',
  MAESTRO_LOG_WRITTEN: 'maestro.log.written',
  // Phase 22 / Plan 22-XX bridgehead (this phase)
  LOG:                 'job.log',
  STEP:                'job.step',
  STATUS:              'job.status',
} as const;
```

**Payload schemas (thin, EVENTS-04 discipline):**

```typescript
// Phase 22 — match existing LogData/StepData/StatusData shapes from streaming/types.ts
export const jobLogPayload = z.object({
  jobId: z.string(),
  data: z.object({
    line: z.string(),
    stream: z.enum(['stdout', 'stderr']),
  }),
});

export const jobStepPayload = z.object({
  jobId: z.string(),
  data: z.object({
    flowName: z.string(),
    command: z.string().nullable(),
    status: z.string(),
    durationMs: z.number().int().nonnegative().nullable(),
  }),
});

export const jobStatusPayload = z.object({
  jobId: z.string(),
  data: z.object({
    status: z.enum(['running', 'passed', 'failed', 'cancelled', 'timeout']),
  }),
});
```

**Registry additions:**
```typescript
[JOB_EVENT_NAMES.LOG]:     { schema: jobLogPayload,    persisted: false, aggregateType: 'job' },
[JOB_EVENT_NAMES.STEP]:    { schema: jobStepPayload,   persisted: false, aggregateType: 'job' },
[JOB_EVENT_NAMES.STATUS]:  { schema: jobStatusPayload, persisted: false, aggregateType: 'job' },
```

**`makeJobsEmitters` returns 6 helpers:** existing 3 + new `log`, `step`, `status`.

**`server/jobs/job-service.ts` surgery:**

The 7 existing `this.jobBroadcaster?.emit(job.id, {type, data, timestamp})` callsites (lines 263, 284, 308, 315, 334, 342, 430) become:

```typescript
// Before (current):
this.jobBroadcaster?.emit(job.id, {
  type: 'status',
  data: { status: 'running' },
  timestamp: new Date().toISOString(),
});

// After (Phase 22):
this.jobsEmit?.status(job.id, {
  jobId: job.id,
  data: { status: 'running' },
});
```

**Timestamp elision:** `JobMessage.timestamp` was producer-set; the new envelope's `ts` is subscriber-set at `safeParse` time. This is a minor semantic shift (timestamp now reflects receive-at-streaming, not emit-at-producer) — acceptable because the clocks are sub-ms apart in-process, and the bus envelope already carries `occurredAt` at stamp time for persisted-event trace-tree analysis.

**Cleanup of `fastify.jobBroadcaster?.cleanup(job.id)` line 479:** stays. The 5-second delayed cleanup is subscriber-agnostic (buffer lifecycle). Moved inside streaming module as a helper exposed on the module surface.

**Fallback elision (`this.jobBroadcaster?` optionality):** the `?` in the constructor means `JobService` works with or without the broadcaster. Phase 22 keeps this optionality — if `jobsEmit` is undefined (Phase 23 saga rewrite), the emit is a no-op. The streaming subscriber remains the sole consumer.

### Module Shape (MODULE.md 9 sections)

Following Phase 20 pool's pattern (most similar: multiple decorators, no queue-owning at all in pool's first migration before Phase 20 added `device.reap`). The key deviation from Phase 16/18/19/20/21 canonical shape:

- **"Queue Produced" section: "None"** — documents the deviation explicitly. No queue.ts file needed.
- **"Queue Consumed" section: "None"** — same.
- **3 decorators** (matches Phase 20 pool's 4-decorator shape minus one): `fastify.jobBroadcaster` + `fastify.devicePreview` + `fastify.streamingModule`.

### Renames (MOD-04)

5 test files under `server/streaming/__tests__/` must rename via `git mv` 100% similarity to preserve blame history (matches Phase 21 Plan 21-06 MOD-04 precedent):

- `adapter-factory.test.ts` → `adapter-factory.spec.ts`
- `android-preview-adapter.test.ts` → `android-preview-adapter.spec.ts`
- `device-preview.test.ts` → `device-preview.spec.ts`
- `ios-preview-adapter.test.ts` → `ios-preview-adapter.spec.ts`
- `job-broadcaster.test.ts` → `job-broadcaster.spec.ts`

After renames all 5 still pass unchanged (behavior-only rename). The content of `job-broadcaster.spec.ts` needs ONE edit: `makeMessage` helper returns `WsEnvelope` instead of `JobMessage` (field rename `timestamp` → `ts` + added `correlationId` + `v`). This is a Plan 22-XX implementation task, not a rename-only task.

### File Moves (MOD-02)

Barrel discipline requires `server/streaming/internal/` subdirectory with everything except `index.ts` + `plugin.ts` living there. Moves:

- `server/streaming/job-broadcaster.ts` → `server/streaming/internal/job-broadcaster.ts`
- `server/streaming/device-preview.ts` → `server/streaming/internal/device-preview.ts`
- `server/streaming/types.ts` → `server/streaming/internal/types.ts`
- `server/streaming/ws-schemas.ts` → `server/streaming/internal/ws-schemas.ts`
- `server/streaming/adapters/` → `server/streaming/internal/adapters/` (whole directory)

NEW files:
- `server/streaming/MODULE.md` (9 H2 sections + Runnable Example)
- `server/streaming/index.ts` (barrel, MOD-02 strict 1-line internal/ re-export)
- `server/streaming/events.ts` (single event `ws.frame.dropped`)
- `server/streaming/internal/module.ts` (createStreamingModule factory)
- `server/streaming/plugin.ts` (thin wrapper replacing `websocket-plugin.ts`)

DELETED file:
- `server/streaming/websocket-plugin.ts` (contents split: decorators + WS routes → `plugin.ts`; business logic → `internal/module.ts`)

### Dependency-Cruiser 6th Rule (MOD-02 structural enforcement)

Add to `.dependency-cruiser.cjs` (matches Phase 21 Plan 21-00 pattern exactly):

```javascript
{
  name: 'no-deep-imports-into-streaming-internal',
  comment:
    'Nothing outside server/streaming/** may reach into server/streaming/internal/**. ' +
    'Public API comes from server/streaming/index.ts barrel. Phase 22 MOD-02. ' +
    'Mirrors the Phase 16 hooks + Phase 18 lifecycle + Phase 19 reporting + Phase 20 pool + Phase 21 artifacts rules.',
  severity: 'error',
  from: { pathNot: '^server/streaming/' },
  to:   { path:    '^server/streaming/internal/' },
},
```

Fixture file that fires the rule (matches Phase 21 pattern):
- `__fixtures__/dep-cruiser/bad-streaming-deep-import.ts` — a `.ts` file that imports from `server/streaming/internal/job-broadcaster.js` to prove the rule fires.

Spec extension in `server/hooks/__tests__/dep-cruiser.spec.ts` adds a `[MOD-02 streaming extension]` it-block (mirrors the 5 existing module-rule test blocks).

### Plugin Name Question

**Recommendation: keep plugin name `'websocket-plugin'` for back-compat.**

Rationale:
- `server/jobs/plugin.ts:120` declares `dependencies: ['config', 'db', 'pool-plugin', 'websocket-plugin', ...]`.
- `server/pipelines/plugin.ts:77` declares `dependencies: ['db', 'websocket-plugin', 'job-plugin']`.
- `server/__tests__/plugin-order.spec.ts` has 3 structural assertions naming `'websocket-plugin'` (lines 64-66, 146).
- Renaming requires touching 5+ files across jobs/pipelines/tests — scope creep beyond Phase 22's stated boundary (refactor streaming/ module shape; don't churn cross-module dep graph).
- Phase 21 set the back-compat precedent: artifacts plugin kept name `'artifact-plugin'` (singular, pre-Phase-21) even after module refactor.

The **file** renames (`websocket-plugin.ts` → `plugin.ts`) and the **module directory** consolidation happen. The pg-boss/Fastify plugin NAME string — the decorator identity — stays `'websocket-plugin'`.

**Alternative considered:** rename to `'streaming-plugin'` for consistency with Phase 18/19/20/21 naming (lifecycle-plugin, reporting, pool-plugin, artifact-plugin). Rejected: 5+ file cross-module change, risks Phase 23/25 (jobs/pipelines) rework colliding.

### Plugin Dependencies (extension)

Current: `{ name: 'websocket-plugin', dependencies: ['config', 'auth', 'pool-plugin'] }`

Extended for Phase 22: `{ name: 'websocket-plugin', dependencies: ['config', 'auth', 'pool-plugin', 'event-bus'] }`

Rationale:
- `event-bus` is required because `createStreamingModule` reads `fastify.jobsModule.bus` at onReady time (for `job.log`/`job.step`/`job.status` subscription) and the module's own TypedBus construction follows Phase 16 pattern even though there's no queue.
- `queue` NOT added — there is no queue surface (CONTEXT §Decisions).
- `pool-plugin` stays (was added in Phase 17 Plan 17-07 for devicePreview's deviceId→pool linkage).
- `auth` stays (WS routes still gate on `fastify.config.auth.enabled` + `fastify.authService.validateKey`).
- `db` — debated. Phase 21 pool added `db` because its `persistEnvelope` middleware writes to the events table. Phase 22's `ws.frame.dropped` is recommended `persisted: false` → no DB writes → `db` NOT needed. HOWEVER, Phase 22's factory constructs a `TypedBus<StreamingRegistry>` with a `persistEnvelope`-shaped `onEmit` hook (mirrors Phase 21's 5-sample-point pattern). That hook READS `entry.persisted` from the registry, and since the only entry is `persisted: false`, it short-circuits before touching `fastify.db`. **Recommendation: include `db` in dependencies for future-proofing (flipping `ws.frame.dropped` to `persisted: true` should be a 1-line change, not a plugin-deps churn).** This mirrors Phase 20's "structural dependency" reasoning for `event-bus`.

Final dependencies array: `['config', 'auth', 'pool-plugin', 'event-bus', 'db']` — 5 entries (matches Phase 21's 5-entry `['config', 'db', 'queue', 'event-bus', 'pool-plugin']` shape; both 5-entry, both canonical).

## Implementation Sequence

Following the Phase 20/21 wave structure exactly (7 plans across 6 waves, ~110min total based on Phase 21's 124min average adjusted down for no DB migration + no queue):

### Wave 0 — Substrate (Plan 22-00, ~10min)

**Goal:** Lay the module scaffold so downstream waves have resolvable targets (Phase 18/19/20/21 empirical 5th repeat — substrate-first is proven).

Tasks:
1. Extend `JOB_EVENT_NAMES` in `server/jobs/events.ts` with `LOG/STEP/STATUS` placeholders (just the 3 keys + empty schema placeholders — real payloads land in Wave 1).
2. Create `server/streaming/internal/` directory; prepare move via `git mv` (execute in Wave 2 when plugin.ts rewrites — keeps Wave 0 minimal).
3. Create `server/streaming/events.ts` stub (1 event name, placeholder schema, empty registry — landing-strip for Wave 1).
4. Create `server/streaming/internal/module.ts` throw-stub (10 lines matching Phase 18/19/20/21 empirical pattern — dep-cruiser needs a resolvable target for the 6th rule's fixture).
5. Create `server/streaming/MODULE.md` placeholder (Purpose section only — full body lands in Wave 5 close-out).
6. Create `server/streaming/index.ts` stub (1 internal/ re-export — MOD-02 invariant).
7. Add 6th dep-cruiser rule `no-deep-imports-into-streaming-internal` to `.dependency-cruiser.cjs`.
8. Add `__fixtures__/dep-cruiser/bad-streaming-deep-import.ts` fixture.
9. Extend `server/hooks/__tests__/dep-cruiser.spec.ts` with `[MOD-02 streaming extension]` it-block.

**Parallelizability:** Tasks 1-6 are independent (different files); tasks 7-9 serialize (same dep-cruiser file + fixture + spec). Estimated 10min based on Phase 21 Plan 21-00's 21min timing BUT minus DB migration work (Phase 21-01 did a Drizzle migration in Wave 1 which Phase 22 doesn't need).

### Wave 1 — Events + Jobs Bridgehead (Plan 22-01, ~10min)

**Goal:** Full events.ts body + jobs bridgehead extension.

Tasks:
1. `server/streaming/events.ts` full body — `wsFrameDroppedPayload` Zod + `streamingRegistry` (1 entry, `persisted: false`) + `makeStreamingEmitters` wrapping `createEventHelpers`. Matches Phase 19 reporting's single-persisted-event shape in miniature.
2. `server/jobs/events.ts` bridgehead extension — add `LOG/STEP/STATUS` to `JOB_EVENT_NAMES`, add 3 payload schemas, extend `jobsRegistry` (3 new non-persisted entries), extend `makeJobsEmitters` return type with 3 new helpers.
3. `server/streaming/__tests__/events.spec.ts` (NEW) — 6-8 tests mirroring Phase 20 events.spec shape: event-name shape (EVENTS-03 dotted past-tense); registry (1 entry, `persisted: false`, aggregateType='ws' or 'streaming'); STREAMING_AGGREGATE_ID v5 derivation (single UUID for the module); payload schemas accept valid + reject malformed; emit.frameDropped stamps envelope with ALS correlationId + v:1 + aggregateType.

**Choice for aggregateType on `ws.frame.dropped`:** `'streaming'` (matches Phase 18 LIFECYCLE, Phase 19 REPORTING, Phase 20 POOL, Phase 21 ARTIFACTS pattern — module-name-based, not event-prefix-based). Rationale: `ws.` prefix suggests WebSocket as aggregate but the module IS streaming and the events-table rows (if ever persisted) group under the module that produced them.

### Wave 2 — Factory + Plugin Rewire + Subscriber Wiring (Plan 22-02, ~20min)

**Goal:** The meat of the phase — `createStreamingModule` factory + thin plugin.ts + deferred-to-onReady subscriber registration + `server/index.ts` import rewire + 7-callsite surgery in `job-service.ts`.

Tasks:
1. `git mv server/streaming/{job-broadcaster,device-preview,types,ws-schemas}.ts server/streaming/internal/` (preserves blame).
2. `git mv server/streaming/adapters server/streaming/internal/adapters` (preserves blame on 4 adapter files).
3. `server/streaming/internal/module.ts` — replace throw-stub with full `createStreamingModule({fastify, db, config, logger})` factory:
   - Constructs `JobBroadcaster` + `DevicePreviewManager` instances (mirrors Phase 21 artifactService/recordingService pattern).
   - Per-module `TypedBus<StreamingRegistry>` + `persistEnvelope` middleware (6TH SAMPLE POINT — Phase 27+ consolidation trigger remains open; matches Phase 21 Non-Goals pattern).
   - `emit = makeStreamingEmitters(bus, persistEnvelope)`.
   - Defers 3 bus subscriptions (`job.log`/`job.step`/`job.status`) to `fastify.addHook('onReady')` — reads `fastify.jobsModule.bus.on(...)` for each.
   - Returns `{jobBroadcaster, devicePreview, emit, bus, registerSubscribers, shutdown}`. 6 keys (vs Phase 21 artifacts 10 keys — streaming has fewer back-compat surfaces).
4. `server/streaming/plugin.ts` (NEW, replaces `websocket-plugin.ts`) — thin wirer:
   - Calls `createStreamingModule(...)`.
   - Decorates `fastify.jobBroadcaster` + `fastify.devicePreview` + `fastify.streamingModule` (new).
   - Registers `@fastify/websocket` + 2 WS routes (`/ws/jobs/:id` + `/ws/devices/:id/preview`) — MOVED from `websocket-plugin.ts`.
   - WS route handler changes: `socket.send(JSON.stringify(envelope))` — envelope now flows through from `broadcaster.subscribe(jobId, handler)`.
   - `await module.registerSubscribers()` — deferred-to-onReady as above.
   - `fastify.addHook('onClose', () => module.shutdown())` — idempotent shutdown (unsubs 3 bus handlers; clears heartbeat intervals; stops any live preview sessions).
5. DELETE `server/streaming/websocket-plugin.ts`.
6. `server/index.ts:9` import change: `from './streaming/websocket-plugin.js'` → `from './streaming/plugin.js'`.
7. `server/jobs/job-service.ts` surgery — 7 callsites (lines 263, 284, 308, 315, 334, 342, 430) rewrite from `this.jobBroadcaster?.emit(job.id, {type, data, timestamp})` → `this.jobsEmit?.log(job.id, {jobId: job.id, data}) | .step(...) | .status(...)`. Remove `timestamp` (envelope.ts replaces).
8. `server/streaming/__tests__/module.spec.ts` (NEW) — 8-10 tests mirroring Phase 21 module.spec shape: factory returns 6-key shape; registerSubscribers defers to onReady; 3 subscribers attach post-onReady; shutdown is idempotent; unsubscribes 3 bus handlers; clears heartbeat intervals; no DB.

### Wave 3 — DB-Gated Proofs (Plan 22-03, ~15min)

**Goal:** Runtime proofs that SC1, SC2, SC3 all hold.

Tasks:
1. `server/streaming/__tests__/subscriber.spec.ts` (NEW, DB-gated) — mirrors Phase 21 subscriber.spec pattern:
   - Boot minimal Fastify stack: config → correlation → db → event-bus → queue → pool → stub-jobs-plugin (decorates jobsModule with 6-key emit surface including log/step/status) → streaming plugin.
   - After `app.ready()`, assert: `broadcaster.subscribe(jobId, handler)` delivers enveloped frames for each of 3 event types.
   - Fire `jobsModule.emit.log(jobId, {jobId, data: {line: 'x', stream: 'stdout'}})` → assert handler receives `{type: 'log', correlationId, v: 1, ts, payload: {line: 'x', stream: 'stdout'}}`.
   - Same pattern for step + status.
   - SC2 ring-buffer replay: emit 5 messages, subscribe, assert replay order = emission order, assert all 5 envelopes well-formed.
2. `server/streaming/__tests__/correlation.spec.ts` (NEW, DB-gated) — SC1 TRACE-06 proof:
   - `asyncLocalStorage.run({correlationId: corrId, ...}, async () => { emit.log(...) })`.
   - Subscribe to `broadcaster` → assert received envelope's `correlationId === corrId`.
   - SC3 dev-tool grep-ability: assert `JSON.stringify(envelope)` contains `"correlationId":"<corrId>"` — proves the wire shape includes correlationId at root (not nested inside `payload`).
3. `server/streaming/__tests__/envelope.spec.ts` (NEW, no DB) — safeParse drop path:
   - Construct a malformed envelope (missing correlationId); feed through `wsEnvelopeSchema.safeParse`.
   - Assert `success: false` + `.error.issues` includes `'correlationId'`.
   - Mock subscriber: firing a fake bus event with payload that breaks schema → assert `ws.frame.dropped` event fires + `broadcaster.emit` NOT called.

**Spec shape follows Phase 21 Plan 21-05 precedent** — subscriber.spec (3 tests for 3 subscribers) + correlation.spec (1 test for SC1/SC4 analog). Uses plain-object ALS store shape per Phase 20 canonical. `skipIf(!HAS_DB)` gate with `console.warn` skip message.

**Stub jobs plugin pattern:** Mirrors `makeStubJobsPlugin()` at `server/artifacts/__tests__/subscriber.spec.ts:54-87` — constructs a `TypedBus(jobsRegistry)` + 6-key emit helpers + side-channel envelope forward + persisted-event DB insert (short-circuits for the 3 non-persisted new events).

### Wave 4 — Lifecycle Ownership + Plugin Order (Plan 22-04, ~10min)

**Goal:** SC2 structural grep-guard (zero `broadcaster.emit` calls outside streaming module) + plugin-order.spec extension.

Tasks:
1. `server/streaming/__tests__/lifecycle-ownership.spec.ts` (NEW, non-DB) — mirrors Phase 21 Plan 21-05 lifecycle-ownership.spec pattern:
   - readFileSync `server/jobs/job-service.ts`.
   - Assert `count('this.jobBroadcaster?.emit(')` = 0.
   - Assert `count('this.jobBroadcaster!.emit(')` = 0.
   - Assert `count('this.jobsEmit?.log(')` >= 1.
   - Assert `count('this.jobsEmit?.step(')` >= 1.
   - Assert `count('this.jobsEmit?.status(')` >= 1.
   - Assert `count('this.jobBroadcaster?.cleanup(')` <= 1 (buffer cleanup KEPT — documented in MODULE.md §Non-Goals). (Recommendation: move cleanup also into a subscriber of `job.completed` to reach zero — but this requires another Phase 22 Jobs-side patch. Planner decision.)
2. `server/__tests__/plugin-order.spec.ts` additive block (matches Phase 21 Plan 21-06 pattern):
   - `expect(indexOf('event-bus')).toBeLessThan(indexOf('websocket-plugin'))` (new Phase 22 dep).
   - `expect(indexOf('db')).toBeLessThan(indexOf('websocket-plugin'))` (new Phase 22 dep).
   - readFileSync `server/streaming/plugin.ts`, regex-extract `dependencies:` literal, parse via JSON, assert `arrayContaining(['config', 'auth', 'pool-plugin', 'event-bus', 'db'])` + `toHaveLength(5)`.

**Resolves Phase 20 `plugin-order.spec` fastify-websocket substring-match bug?** The bug was: `indexOf('websocket-plugin')` matched the SUBSTRING inside `'fastify-websocket'` (registered first by `@fastify/websocket`). The rename from `websocket-plugin.ts` → `plugin.ts` does NOT fix the substring issue — the plugin NAME string is still `'websocket-plugin'` which remains a substring of `'fastify-websocket'`. **Planner MUST investigate:** either (a) change plugin name to `'streaming-plugin'` to sidestep (scope creep — rejected above), or (b) use exact-match via regex word boundary in the spec (`listing.match(/\bwebsocket-plugin\b/)?.index`), or (c) count-based (`listing.match(/websocket-plugin/g)?.length === 2` — one for fastify's registration, one for ours, and position-comparison uses `lastIndexOf` instead of `indexOf`). **Recommendation: option (b) — exact word-boundary regex.** Most greppable, survives future refactors.

### Wave 5 — Close-out (Plan 22-05, ~15min)

**Goal:** MODULE.md body + barrel expansion + 5 renames + Nyquist gate.

Tasks:
1. `server/streaming/MODULE.md` full body — 9 H2 sections in canonical order (Purpose / Public API / Events Emitted / Events Consumed / Queue Produced / Queue Consumed / Invariants / Non-Goals / Dependencies) + H3 Runnable Example. "Queue Produced" and "Queue Consumed" sections say **"None"** explicitly (matches Phase 22's NO-QUEUE deviation from Phase 16-21 template — per MOD-03 "only if the module owns queues").
2. `server/streaming/index.ts` full barrel — MOD-02 strict 1-line internal/ re-export + all back-compat exports (`JobBroadcaster`, `DevicePreviewManager`, envelope schema, event surface). Matches Phase 21 artifacts/index.ts 79-line shape.
3. 5 `git mv *.test.ts *.spec.ts` 100%-similarity renames (preserves blame; matches Phase 21 Plan 21-06 MOD-04 precedent).
4. Update `job-broadcaster.spec.ts` — replace `JobMessage` helper with `WsEnvelope` helper (field rename + `correlationId` field).
5. Nyquist delta gate: `npm run nyquist:check` must exit 0 (delta ≥ −2pp vs Phase 15 baseline 48.29%). Current estimate: Phase 22 adds ~800 lines (events/module/plugin/spec/MODULE) + subtracts ~180 lines (websocket-plugin.ts deletion + job-service.ts surgery shrinks 7 callsites). Net delta expected ≤ +1pp (similar to Phase 21's −0.30pp).

### Wave 6 — Phase Close (Plan 22-06, ~10min)

**Goal:** STATE.md + ROADMAP.md + deferred-items.md + full-suite green sweep.

Tasks (matches Phase 21 Plan 21-06 10-step sweep exactly):
1. `deferred-items.md` catalog — 5-8 entries carrying forward inherited Phase 17 exclusions (3 files) + Phase 22-specific deferrals (DevicePreviewManager envelope, web-shared schema export, shutdown-of-`jobBroadcaster.cleanup` call-site question).
2. `npm test` full suite — same inherited exclusions (3 pre-existing files: routes.test + artifact-routes.test + auth-plugin.test) fail on Phase 17 fastify-zod-openapi v5 `required`-emission bug. ZERO new Phase 22 regressions required.
3. `npm run lint` clean.
4. `npx tsc --noEmit` — inherits 8 pre-existing errors (6 Phase 15 Map-vs-RequestContext + 2 working-tree artifacts). ZERO new errors from Phase 22.
5. `npm run dep-check` — inherits 1 pre-existing violation (jobs/plugin.ts → bus/bus.ts, Phase 23 scope). Phase 22 MUST add zero new violations; `jobs/events.ts` is allowlisted.
6. `npm run nyquist:check` delta gate (see Wave 5).
7. `.planning/nyquist-baseline.json` MUST NOT be overwritten (diff -s against backup).
8. STATE.md update — Phase 22 CLOSED entry per Phase 15-21 format (`current_plan: 7`, `completed_plans: 57` = 50 + 7, etc.).
9. ROADMAP.md update — Phase 22 row to Complete + 2026-04-22.
10. Commit `docs(phase-22): complete phase execution`.

## Validation Architecture

**Nyquist validation is ENABLED** (`.planning/config.json` `workflow.nyquist_validation: true`). This section is MANDATORY.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 1.x (already installed; see `package.json`) |
| Config file | `vitest.config.ts` + `vitest.coverage.config.ts` (both at repo root) |
| Quick run command | `npx vitest run server/streaming/__tests__/` |
| Full suite command | `npm test` (runs all Vitest specs; exit code respects inherited-failure exclusions) |
| Coverage command | `npm run coverage` (v8 coverage; feeds Nyquist baseline) |
| Nyquist check | `npm run nyquist:check` (compares coverage to `.planning/nyquist-baseline.json`; exits 1 if delta < −2pp) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TRACE-06 (SC1) | Every WS frame envelope carries `correlationId`; malformed frames dropped via `safeParse` + `ws.frame.dropped` emit | integration (DB-gated) | `npx vitest run server/streaming/__tests__/correlation.spec.ts` | ❌ Wave 3 (Plan 22-03 creates) |
| TRACE-06 (SC1) | `safeParse` failure path: malformed frame dropped + logged + ws.frame.dropped emitted (never crashes client) | unit | `npx vitest run server/streaming/__tests__/envelope.spec.ts` | ❌ Wave 3 |
| SC2 | `JobBroadcaster` receives input from bus subscriptions (`job.log`/`job.step`/`job.status`); no producer calls `broadcaster.emit()` directly | integration (DB-gated) | `npx vitest run server/streaming/__tests__/subscriber.spec.ts` | ❌ Wave 3 |
| SC2 | Ring-buffer replay on WS reconnect returns last ≤200 envelopes (not JobMessages) | unit | `npx vitest run server/streaming/__tests__/job-broadcaster.spec.ts` (updated in Wave 5) | ⚠️ Exists as `.test.ts` — renamed + modified in Wave 5 |
| SC2 | Zero `broadcaster.emit` or `this.jobBroadcaster?.emit(` callsites in `server/jobs/job-service.ts` | structural grep-guard | `npx vitest run server/streaming/__tests__/lifecycle-ownership.spec.ts` | ❌ Wave 4 (Plan 22-04 creates) |
| SC3 | Developer can click WS event in web dev console → see correlationId → grep server log | covered transitively by SC1 (envelope.correlationId at root is what dev-tools JSON inspector shows); round-trip test | integration | `npx vitest run server/streaming/__tests__/correlation.spec.ts` (same as SC1) | ❌ Wave 3 |
| SC4 | Phase 16 conventions followed: MODULE.md 9 sections + barrel + events.ts + tests-as-spec | structural | `grep -c '^## ' server/streaming/MODULE.md` == 9 | ❌ Wave 5 |
| SC4 | No new Phase 22-attributable failures in `npm test` | full suite | `npm test` | ✅ (sweep in Wave 6) |
| SC4 | Nyquist delta ≥ −2pp vs Phase 15 baseline 48.29% | coverage | `npm run nyquist:check` | ✅ (installed; gate in Wave 6) |
| MOD-02 | `no-deep-imports-into-streaming-internal` dep-cruiser rule fires on external deep import | dep-cruiser + fixture | `npx vitest run server/hooks/__tests__/dep-cruiser.spec.ts -t 'streaming extension'` | ❌ Wave 0 |
| MOD-04 | All `server/streaming/__tests__/*.test.ts` renamed to `.spec.ts` | filesystem | `find server/streaming/__tests__ -name '*.test.ts' \| wc -l` == 0 | ❌ Wave 5 |

### Sampling Rate

- **Per task commit:** `npx vitest run server/streaming/__tests__/` (fast-feedback — quick spec runs in <5s for this module; no pg-boss start unless DB-gated spec touched).
- **Per wave merge:** Module + adjacent affected suites — `npx vitest run server/streaming/__tests__/ server/jobs/__tests__/ server/__tests__/plugin-order.spec.ts`.
- **Phase gate:** Full suite `npm test` green before `/gsd:verify-work` (inherited-exclusion set respected; ZERO new Phase 22 regressions).

### Wave 0 Gaps

- [ ] `server/streaming/events.ts` — full body lands in Wave 1; Wave 0 ships stub.
- [ ] `server/streaming/__tests__/events.spec.ts` — NEW in Wave 1 (covers EVENTS-03 + TRACE-08 registry + TRACE-04 ALS).
- [ ] `server/streaming/__tests__/module.spec.ts` — NEW in Wave 2 (MOD-06 factory shape + shutdown idempotency).
- [ ] `server/streaming/__tests__/subscriber.spec.ts` — NEW in Wave 3 (DB-gated SC1 + SC2 end-to-end).
- [ ] `server/streaming/__tests__/correlation.spec.ts` — NEW in Wave 3 (DB-gated SC1 TRACE-06 + SC3 dev-tool round-trip).
- [ ] `server/streaming/__tests__/envelope.spec.ts` — NEW in Wave 3 (non-DB safeParse drop path).
- [ ] `server/streaming/__tests__/lifecycle-ownership.spec.ts` — NEW in Wave 4 (SC2 structural grep-guard).
- [ ] `server/streaming/internal/module.ts` — throw-stub in Wave 0; full factory body in Wave 2.
- [ ] `server/streaming/plugin.ts` — NEW in Wave 2 (replaces deleted websocket-plugin.ts).
- [ ] `server/streaming/MODULE.md` — Purpose stub in Wave 0; full 9-section body in Wave 5.
- [ ] `.dependency-cruiser.cjs` 6th rule — added Wave 0.
- [ ] `__fixtures__/dep-cruiser/bad-streaming-deep-import.ts` — NEW in Wave 0.
- [ ] `server/hooks/__tests__/dep-cruiser.spec.ts` extension — added Wave 0.
- [ ] `server/__tests__/plugin-order.spec.ts` extension — added Wave 4.
- [ ] `jobs/events.ts` — 3-key extension in Wave 0 (placeholders) + full Wave 1 (schemas + registry + emitters).
- [ ] `jobs/job-service.ts` — 7-callsite surgery in Wave 2.

### Idempotency Proof — NOT APPLICABLE

Per CONTEXT §decisions: "WebSocket fan-out is lossy-by-design (stale connections drop messages). No idempotency proof needed (success criterion 3 is about dev tooling, not exactly-once delivery)."

Phase 22 is the FIRST phase in v3.0 without an idempotency proof (Phase 16 hooks.run, Phase 18 lifecycle schedules, Phase 19 webhook.deliver+DLQ, Phase 20 device.reap singletonKey, Phase 21 recording.upload two-layer — all had them). This is a valid deviation because streaming owns no queue.

## Pitfalls

### Pitfall 1 — Ring-buffer type migration (JobMessage → WsEnvelope)

**What goes wrong:** `broadcaster.emit(jobId, msg)` + `broadcaster.subscribe(jobId, handler)` are called in 3+ places in the current codebase (WS route handlers, the `.cleanup` pathway, potentially tests). Changing the stored buffer type from `JobMessage` to `WsEnvelope` is a signature change that TS will (usually) catch — but `JobMessage` is structurally compatible with enough of `WsEnvelope` (both have `type`) that a naive refactor could leave fields like `timestamp` vs `ts` inconsistent, producing WS frames that fail client-side `safeParse`.

**Why it happens:** The existing `JobMessage` interface has `{type, data, timestamp}`. The new `WsEnvelope` has `{type, correlationId, v, ts, payload}`. Partial overlap (`type`) + field rename (`timestamp`→`ts`) + field rename (`data`→`payload`) + 2 new required fields (`correlationId`, `v`) = a structural diff that compiles cleanly in SOME places (the envelope is `unknown`-typed at WS send time) but produces malformed frames at runtime.

**How to avoid:**
- Replace `JobMessage` usage across 3 codepaths (broadcaster internal, WS route handler, any test constructing `JobMessage`) atomically in Wave 2 — not piecewise.
- In `job-broadcaster.spec.ts` after rename (Wave 5), update `makeMessage` helper to `makeEnvelope` — return `WsEnvelope` shape. Run spec isolation first (`npx vitest run server/streaming/__tests__/job-broadcaster.spec.ts`) before lifting to full suite.
- Keep `types.ts` internal type `JobMessage` exported from barrel for back-compat, but DELETE usage from `broadcaster.ts` runtime code. Consumers that still reference `JobMessage` (CLI types, web schemas) are out-of-scope Phase 29.

**Warning signs:**
- WS frames received by web dev console missing `correlationId` → envelope builder forgot to stamp (not a safeParse-drop, a silent bypass).
- `broadcaster.getBufferSize(jobId)` returns 200 but replayed-on-reconnect count is less → `.shift()` behavior accidentally breaks when buffer holds differently-shaped objects.

### Pitfall 2 — `fastify.jobsModule` not decorated at plugin-body time (DEFERRED-TO-ONREADY)

**What goes wrong:** Streaming plugin registers at step 10 in `server/index.ts`. `jobs/plugin.ts` (which decorates `fastify.jobsModule`) registers at step 13. During streaming plugin BODY execution, `fastify.jobsModule` is `undefined`, and subscribing via `fastify.jobsModule.bus.on(...)` throws `TypeError: Cannot read property 'bus' of undefined`.

**Why it happens:** This is the exact same plugin-order pitfall Phase 21 hit (Phase 21 RESEARCH §Pitfall 7 documents extensively). Artifact-plugin at step 11 < jobs-plugin at step 13, same ordering problem. Phase 21 resolved with `fastify.addHook('onReady', async () => { ... subscribe here ... })` — `onReady` fires AFTER all plugins register, so `fastify.jobsModule` is guaranteed decorated.

**How to avoid:** Copy Phase 21 artifacts/internal/module.ts lines 182-386 verbatim — defer all 3 subscriptions inside `fastify.addHook('onReady', ...)`. Unit test (module.spec) asserts subscribers NOT registered before `onReady` triggers, THEN registered after.

**Warning signs:**
- `app.ready()` throws `TypeError: fastify.jobsModule is undefined`.
- subscriber.spec passes in isolation but fails when run alongside other specs that await `app.ready()` on a shared fixture.

### Pitfall 3 — `plugin-order.spec` `websocket-plugin` substring match against `fastify-websocket`

**What goes wrong:** `listing.indexOf('websocket-plugin')` in `server/__tests__/plugin-order.spec.ts` finds the substring 'websocket-plugin' inside the `fastify-websocket` package's own plugin name string. Phase 20 STATE.md (Plan 20-04 commentary) documents this as "fastify-websocket substring-match bug — websocket-plugin at position 424 as substring of 'fastify-websocket' vs pool-plugin at 1016". It's been filed as deferred-items since Phase 20.

**Why it happens:** `@fastify/websocket` self-registers under a plugin name containing 'websocket-plugin' as a sub-string. `printPlugins()` output is a formatted tree; substring searches pick up any occurrence.

**How to avoid:**
- RECOMMENDED — Planner Wave 4: switch from `listing.indexOf(name)` to `listing.match(new RegExp(\`\\\\b${name}\\\\b\`))?.index ?? -1` (word-boundary regex). Works for ALL 15+ plugin-name assertions in the spec — no per-plugin special casing.
- Alternative A: rename our plugin to `'streaming-plugin'` (sidesteps the substring — but scope-creep, 5+ cross-module file changes, rejected in §Technical Design §Plugin Name Question).
- Alternative B: count-based (`listing.match(/websocket-plugin/g)?.length === 2` + use `lastIndexOf` for our plugin's position) — works but brittle if `fastify-websocket` upstream changes its own plugin name.

**Warning signs:**
- Phase 22 Wave 4 plugin-order spec extension passes but existing Phase 20 assertion that Phase 20 STATE.md flagged still fails (pre-existing bug not resolved).
- Naive word-boundary fix breaks if plugin name contains hyphens at boundaries — `\\b` in JS regex DOES treat `-` as a word-break, so `'websocket-plugin'` tokenizes as `websocket`, `-`, `plugin`. Fix: use `(?<![\\w-])websocket-plugin(?![\\w-])` for true token-boundary OR use `indexOf` with a guard-prefix (`'websocket-plugin\\n'` — but requires stable print formatting).

### Pitfall 4 — EventEmitter memory semantics with many concurrent WS clients

**What goes wrong:** `JobBroadcaster.emitter.setMaxListeners(0)` (line 11) disables the max-listener warning to support many concurrent WS clients per job (e.g. 5 web tabs + CLI subscriber). But Node EventEmitter has no upper bound — a misbehaving loop that calls `subscribe` without `unsub` leaks listeners forever. Current test suite doesn't catch this.

**Why it happens:** Test scenarios happy-path subscribe+unsubscribe. Real-world bugs in WS socket `close`/`error` handlers sometimes skip `unsub()`. With `setMaxListeners(0)` the silent accumulation is invisible until GC pressure tanks the process.

**How to avoid:**
- Keep `setMaxListeners(0)` — the alternative (max=10) breaks legitimate multi-client scenarios.
- Add to `module.spec.ts` or a new `leak.spec.ts`: after N subscribe+unsub cycles, assert `broadcaster.emitter.listenerCount(jobId) === 0`.
- Document in MODULE.md §Non-Goals: "Unsubscribe-on-close must be paired atomically; `setMaxListeners(0)` hides leak as latency instead of error."
- Factory's `shutdown()` MUST call `broadcaster.cleanup(jobId)` for every active jobId — matches Phase 21 pool's `module.shutdown()` idempotent pattern.

**Warning signs:**
- Memory grows linearly with WS connect/disconnect cycles in `npm run dev`.
- `broadcaster.emitter.listenerCount(jobId)` returns large numbers during leak-spec cycles.

### Pitfall 5 — `job.log` high-frequency bus traffic (~100 events/sec during active job)

**What goes wrong:** Maestro running a long test produces 10-100 stdout lines/sec. Each becomes `bus.emit('job.log', ...)` → `TypedBus.emit` runs `entry.schema.parse(payload)` (Zod parse, not safeParse) → if the payload is malformed, the emitter throws synchronously, potentially crashing `executeJob`.

**Why it happens:** `TypedBus.emit` at `server/bus/bus.ts:54-59` uses `.parse(payload)` not `.safeParse`. Unlike the WS envelope, which we safeParse, bus emit FAILS LOUD.

**How to avoid:**
- Recommended: keep `.parse()` at bus emit — producer errors MUST surface loud. The schema for `job.log` (line, stream) is trivially satisfied by `job-service.ts` code paths. Schema drift would be a bug to catch immediately, not silently drop.
- The subscriber-side `safeParse` on the envelope is a separate concern — that one handles ENVELOPE builder errors (correlationId missing from ALS) without crashing the client.
- Document the distinction in MODULE.md §Invariants: "Producer-side bus emit uses `.parse()` (fail-loud); consumer-side envelope builds use `.safeParse()` (fail-soft → ws.frame.dropped)."

**Warning signs:**
- Spurious ZodErrors in server logs from bus.emit — investigate whether `job-service.ts` producer is emitting drifted payload shape.
- WS clients never receive frames during a job run — possible silent crash in subscriber between bus receive and envelope stamp; verify subscriber wraps its body in try/catch with error logging.

### Pitfall 6 — Correlation cleanup on job finish: `broadcaster.cleanup(jobId)` call-site

**What goes wrong:** Current code at `job-service.ts:477-481`:
```typescript
if (this.jobBroadcaster) {
  setTimeout(() => {
    this.jobBroadcaster!.cleanup(job.id);
  }, 5000);
}
```
After Phase 22, `this.jobBroadcaster` is still optionally injected for this cleanup-only purpose. The cleanup IS correct behavior (free the ring buffer 5s after job ends, giving late reconnects time to replay). But SC2 / SC1 strict reading ("no producer calls broadcaster.emit directly") is about EMIT, not cleanup — so the call-site is admissible. HOWEVER, the `this.jobBroadcaster?` injection is a smell: `JobService` still holds a reference to the streaming module's internal class.

**Why it happens:** Cleanup needs to schedule a timer that outlives the job's execute fiber. Bus events (`job.cleaned`?) would be cleaner but add a 4th jobs-events-extension not currently in scope.

**How to avoid:**
- **Option A (recommended for Phase 22):** Keep the cleanup call-site. Document as `[SC2 non-violation]` in `lifecycle-ownership.spec.ts`:
  ```typescript
  it('this.jobBroadcaster?.cleanup() call KEPT (buffer lifecycle; NOT an emit; documented in MODULE.md Non-Goals)', () => {
    expect(count('this.jobBroadcaster?.cleanup(')).toBeLessThanOrEqual(1);
  });
  ```
- **Option B (stricter SC2):** Add a 4th bridgehead event `job.cleanup.requested` (persisted: false, fires 5s after job.completed). Streaming subscriber listens, calls `broadcaster.cleanup(jobId)`. Removes the last `jobBroadcaster?` reference from JobService. Scope cost: +1 event, +1 subscriber, +1 test. Marginal benefit.
- **Decision:** Planner chooses. Recommendation: Option A (scope discipline). Option B can land Phase 23 when Jobs saga rewrites `executeJob` anyway.

**Warning signs:**
- `lifecycle-ownership.spec.ts` asserts `count('this.jobBroadcaster')` = 0 → spec fails because cleanup remains. Soft assertion (`<= 1`) + MODULE.md Non-Goals documentation is the fix.

### Pitfall 7 — ALS store shape reversal (Map vs plain-object)

**What goes wrong:** Phase 15 Map-vs-RequestContext pre-existing errors (6 tsc errors documented in STATE.md). Phase 22 subscriber.spec + correlation.spec construct ALS stores via `asyncLocalStorage.run(...)`. If the test uses Map shape (legacy Phase 15 examples), `requestContext.get('correlationId')` returns undefined — silently breaking TRACE-04 propagation.

**Why it happens:** Phase 20 established PLAIN-OBJECT as canonical. Phase 21 enforced via grep-guard `grep -c "new Map([" = 0` in CONTEXT §code_context.

**How to avoid:**
- Wave 3 DB-gated specs MUST use `asyncLocalStorage.run({correlationId, currentEventId: null, actor: '...'}, async () => ...)` plain-object shape, NOT `new Map([['correlationId', ...]])`.
- Copy verbatim from `server/artifacts/__tests__/correlation.spec.ts:151-165` pattern.

**Warning signs:**
- correlation.spec asserts `envelope.correlationId === corrId` — fails because subscriber's `readAls('correlationId')` returned `null` fallback to a fresh UUID (not the test-provided one).
- `ReferenceError: store is not iterable` — Map constructor used with wrong array shape.

### Pitfall 8 — `@fastify/websocket` v11 readyState semantics

**What goes wrong:** Current WS route handler at `websocket-plugin.ts:74`:
```typescript
if (socket.readyState === WebSocket.OPEN) { socket.send(JSON.stringify(msg)); }
```
`@fastify/websocket` wraps raw `ws` sockets. The `WebSocket.OPEN` constant (value 1) works for client-side; server-side uses `ws.OPEN`. The current code imports `WebSocket` from `'ws'` so `WebSocket.OPEN` is 1 — correct. After Phase 22 file moves + refactor, this reference chain must not break.

**Why it happens:** After `git mv` + factory refactor, `plugin.ts` WS route handlers still import `{ WebSocket }` from `'ws'`. If the refactor routes through the module's internal layer, the import chain might drop.

**How to avoid:**
- plugin.ts retains `import { WebSocket } from 'ws'` — don't proxy the constant through internal/module.ts.
- After refactor, smoke-test: `curl --include --no-buffer --header "Connection: Upgrade" --header "Upgrade: websocket" ... /ws/jobs/<id>` and watch for frames.

**Warning signs:**
- Server logs `Cannot read property 'OPEN' of undefined` at Wave 2 first boot.
- WS frames never arrive at client despite subscriber firing correctly — readyState check returning false for OPEN sockets.

### Pitfall 9 — Reporting subscriber interaction + side-channel emit ordering

**What goes wrong:** Phase 19 reporting subscribes to `job.completed` via `fastify.onPersisted`. The onPersisted wrapper at `server/bus/plugin.ts:120-141` fires on the `<type>.envelope` side-channel AND does ALS-enrichment. Phase 22 streaming subscribes to `job.log`/`job.step`/`job.status` via direct `bus.on(...)` — no envelope, no ALS enrichment.

If Phase 22 subscriber reads ALS inside its handler to get correlationId, and the producer (job-service) emits without ALS-enrichment context, correlationId could fall back to `randomUUID()` — breaking SC1 TRACE-06.

**Why it happens:** `createEventHelpers` at `server/bus/helpers.ts:92` reads `correlationId` from ALS at EMIT time and stamps it in the envelope. But the bus `TypedBus.emit` fires the payload to `bus.on` subscribers WITHOUT the envelope — subscribers see only payload. So the Phase 22 subscriber must read ALS AGAIN at its own handler time.

In the HTTP request path, ALS is preserved across microtasks (the request context is stable). In the pg-boss worker path (Phase 23+), the queue wrapper restores ALS BEFORE invoking subscribers (Phase 15 Plan 15-05). So in both paths, ALS IS available at subscriber time.

**How to avoid:**
- Subscriber reads ALS at handler time (same mechanism as `createEventHelpers`) — use the `readAls('correlationId')` helper from `server/bus/helpers.ts:65` (it's already dual-shape tolerant).
- correlation.spec explicitly tests: `asyncLocalStorage.run({correlationId: X}, async () => { emit.log(...) })` → subscriber's received envelope has `correlationId: X`. This is a round-trip proof, not an assumption.

**Warning signs:**
- correlation.spec failure: `expected correlationId X, received <random UUID>`.
- In real server runs, envelopes have different correlationIds for logs within the same job — indicates ALS leak between log lines (microtask-boundary bug).

### Pitfall 10 — OpenAPI schema generation for streaming (Phase 17 bug surface)

**What goes wrong:** Phase 17 `fastify-zod-openapi` v5 has a pre-existing `required`-emission bug (3 inherited test-file failures: `routes.test.ts` + `artifact-routes.test.ts` + `auth-plugin.test.ts`). Phase 22 ideally doesn't add OpenAPI routes (the WS route `/ws/jobs/:id` isn't OpenAPI-emittable — it's WebSocket upgrade, not HTTP).

**Why it happens:** WebSocket routes aren't HTTP routes; `app.swagger()` traversal doesn't include them. So Phase 22 should NOT hit the Phase 17 bug.

**How to avoid:**
- Phase 22 adds zero new HTTP routes. Phase 29 (Web Refactor WEB-03) will expose `wsEnvelopeSchema` to the web client via shared schemas — that's when OpenAPI/JSON Schema emission for WS envelope becomes relevant. Phase 22's scope is server-side envelope shape only.
- Planner verification: `grep -rn "fastify.withTypeProvider" server/streaming/` must return 0 after Phase 22 closes.

**Warning signs:**
- New test failures in `routes.test.ts` that weren't there pre-Phase-22 — investigate if streaming/plugin.ts accidentally added an HTTP route.

### Pitfall 11 — `persistEnvelope` middleware 6th sample point

**What goes wrong:** Phase 21 MODULE.md line 74 says "Consolidation of the 5× duplicated `persistEnvelope` middleware — 5TH SAMPLE POINT — Phase 27+ CONSOLIDATION TRIGGER REACHED". Phase 22 makes it 6. The pattern is:

```typescript
function makePersistEnvelope(deps) {
  const ee = (bus as unknown as { ee: EventEmitter }).ee;
  return function persistEnvelope(envelope: Envelope): void {
    ee.emit(`${envelope.type}.envelope`, envelope);
    const entry = registry[envelope.type];
    if (!entry || !entry.persisted) return;
    void (async () => { try { await db.insert(eventsTable).values({...}); } catch (err) { logger.error(...); } })();
  };
}
```

**Why it happens:** 5th sample was Phase 21 artifacts. Each module's factory redeclares this function verbatim. No one has consolidated to `server/bus/persist-envelope.ts` yet — intentionally deferred to Phase 27+ to wait for enough samples that the shared helper signature is informed by real variance.

**How to avoid:**
- Phase 22 MUST NOT consolidate — scope creep. Matches Phase 21 Non-Goals verbatim.
- Phase 22 MODULE.md §Non-Goals documents: "**6TH SAMPLE POINT — Phase 27+ CONSOLIDATION TRIGGER STILL OPEN.** Streaming module adds the 6th copy of `persistEnvelope`; Phase 27+ extracts. Do NOT consolidate in Phase 22 — scope creep."
- Planner reads Phase 21 artifacts/internal/module.ts lines 96-129 and copies the block verbatim into Phase 22's module.ts, substituting `artifactsRegistry` → `streamingRegistry`.

**Warning signs:**
- 10-line diff at a non-Phase-22-scoped location (e.g. `server/bus/persist-envelope.ts`) appears in the phase changeset — consolidation scope creep.

## Open Questions for Planner

**None that block planning.** CONTEXT is detailed enough that all architectural choices are locked or flagged as Claude's discretion with clear recommendations in §Technical Design above. Minor choices the planner makes at plan-authoring time:

1. **`ws.frame.dropped` aggregateType: `'streaming'` or `'ws'`?** Recommendation: `'streaming'` (module-name, matches Phase 18-21 pattern). Committed.

2. **`STREAMING_AGGREGATE_ID` v5 derivation string:** `'streaming'` under URL namespace (mirrors Phase 18 `'lifecycle'`, Phase 19 `'reporting'`, Phase 20 `'pool'`, Phase 21 `'artifacts'`). Pre-computed: `uuidv5('streaming', '6ba7b811-9dad-11d1-80b4-00c04fd430c8')` — Planner should pre-compute offline and assert at test time (per Phase 20 pattern — plan literals can be wrong, test re-derives + must match).

3. **`broadcaster.cleanup(jobId)` at `job-service.ts:479` — keep or replace with bus event?** Recommendation: **keep** for Phase 22 (scope discipline); SC2 grep-guard allows `<= 1` occurrence with MODULE.md Non-Goals documentation. Phase 23 Jobs saga rewrites `executeJob` and can replace with `job.cleanup.requested` event then.

4. **plugin-order.spec substring-bug fix scope:** Recommendation: **fix in Phase 22 Wave 4** (word-boundary regex fix is a 2-line change to the existing spec file — resolves Phase 20 deferred-item + Phase 22's new assertion simultaneously). Low-risk, high-value cleanup.

5. **`job.status` enum widening:** `jobStatusPayload.data.status` uses `['running', 'passed', 'failed', 'cancelled', 'timeout']` (5 values matching `ExecutionResult.status` + `'running'` initial state). Phase 19 `jobCompletedPayload.status` has 4 values (no `'running'` — terminal-only). These are DIFFERENT events with different lifecycle semantics, so the enum widening is intentional. Planner: don't try to unify to share the schema — that's Phase 23 saga scope.

---

## Sources

### Primary (HIGH confidence)

- `server/streaming/` — current module state (6 files + 4 adapter files + 5 test files). Directly read; not dependent on external docs.
- `server/artifacts/` — Phase 21 canonical reference (MODULE.md + index.ts + events.ts + queue.ts + plugin.ts + internal/module.ts + 8 spec files). Copy-template source for Phase 22.
- `server/pool/` — Phase 20 reference for multi-decorator thin-plugin pattern (4 decorators vs Phase 22's 3).
- `server/jobs/events.ts` — Phase 19/21 bridgehead precedent for Phase 22's Option A event extension.
- `server/jobs/job-service.ts` — 7 imperative `this.jobBroadcaster?.emit` callsites to invert (lines 263, 284, 308, 315, 334, 342, 430).
- `server/bus/bus.ts` + `server/bus/helpers.ts` + `server/bus/plugin.ts` — TypedBus + createEventHelpers + onPersisted substrate.
- `server/queue/plugin.ts` — queue wrapper ALS restoration (used by Phase 22 subscriber for correlationId threading in worker-fiber context, even though Phase 22 owns no queue).
- `.dependency-cruiser.cjs` — 5 existing module rules; 6th rule for Phase 22 follows exact pattern.
- `server/__tests__/plugin-order.spec.ts` — structural plugin-order invariant; Phase 22 Wave 4 extends additively.
- `.planning/nyquist-baseline.json` — Phase 15 commit 55ff8ac baseline (48.29% lines); Phase 22 delta gate ≥ −2pp.
- `.planning/STATE.md` — Phase 21 CLOSED confirmation + inherited-exclusion set documentation.
- CONTEXT.md for this phase — locked decisions + code scout + deferred ideas.

### Secondary (MEDIUM confidence)

- None — no WebSearch performed; this is a pure-internal-refactor phase with no external library decisions needed. All tooling (Vitest, Zod, @fastify/websocket, pg-boss) is already pinned and proven across 6 prior phases.

### Tertiary (LOW confidence)

- None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all tooling proven across Phase 15-21
- Architecture: HIGH — direct copy of Phase 21 artifacts pattern with 2 documented deviations (no queue, 3-decorator instead of 4)
- Pitfalls: HIGH — 11 pitfalls documented, 10 carry-forward from Phase 15-21 experience + 1 new (Pitfall 3 plugin-order substring bug)

**Research date:** 2026-04-22

**Valid until:** 30 days (stable — all substrate phases closed; no fast-moving dependencies)
