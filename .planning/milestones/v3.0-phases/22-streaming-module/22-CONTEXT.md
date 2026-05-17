# Phase 22: Streaming Module - Context

**Gathered:** 2026-04-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Refactor `server/streaming/` into the canonical module shape (MODULE.md + barrel `index.ts` + `events.ts` + tests-as-spec) and invert its trigger surface: `JobBroadcaster`'s ring buffer is filled from bus subscriptions (`job.log`, `job.step`, `job.status`), not from direct `broadcaster.emit(...)` calls inside `jobs/job-service.ts`. Every WebSocket frame written to `/ws/jobs/:id` (and any future job-channel) is wrapped in a Zod-validated envelope carrying `correlationId` (TRACE-06). Existing capabilities — 200-message ring buffer replay on reconnect, ping/pong heartbeat, token-gated auth, `DevicePreviewManager` frame throttling — all remain. Only the wiring changes: producers emit bus events; the streaming module subscribes, enriches with envelope, validates via `safeParse`, drops/logs malformed frames, pushes to the ring buffer, and forwards to live WS listeners. `DevicePreviewManager` stays as today for this phase (device-preview frames are binary base64, not envelope-shaped; scope is job-channel frames per the ROADMAP success criteria).

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion

All implementation choices are at Claude's discretion — pure infrastructure phase. Planner follows the Phase 16/18/19/20/21 module template verbatim:

- **Module contract**: Copy the 9-section MODULE.md shape from `server/artifacts/MODULE.md` (the most recently canonicalized reference, Phase 21 close).
- **Events consumed**: `job.log`, `job.step`, `job.status` per ROADMAP success criterion 2. These events are emitted by the jobs module (Phase 23 keystone will formalize them); for Phase 22 the subscribers MUST be resilient to those events not yet existing — safe no-op registration OK until Phase 23 lands, but the bus → broadcaster wire MUST be the code path (no imperative fallback).
- **Events emitted**: `ws.frame.dropped` (persisted per TRACE-08 notable rule — malformed Zod frames dropped → logged structured → optional bus event for ops observability). Planner decides whether this single event is warranted or if structured logging alone suffices (checker-visible via telemetry). Default recommendation: emit the event, mirrors Phase 19's DLQ notable-event pattern.
- **Queue**: NONE. WebSocket fan-out is in-process only; there is no queue surface for this module. `queue.ts` stub may be omitted or replaced with a comment explaining why (deviation from Phase 16-21 template is acceptable per MOD-03 "only if the module owns queues").
- **Envelope**: Promote existing `wsEnvelopeSchema` in `server/streaming/ws-schemas.ts` (today has `.loose()` + `v` optional — TODO comment already flags Phase 22 upgrade) to strict form: `{type: z.string(), correlationId: z.string().uuid(), v: z.literal(1), ts: z.string().datetime(), payload: unknown}`. Every existing `JobMessage` type wraps into this envelope. Validation on the server side uses `safeParse`; failures emit `ws.frame.dropped` + structured log + skip send (never crash the client connection).
- **Subscriber wiring**: streaming module subscribes to `job.log` + `job.step` + `job.status` via `fastify.onPersisted(...)` (or `bus.on(...)` — planner picks based on whether these events are persisted terminal vs. transient). Inside the subscriber: read correlationId from ALS → build envelope → `safeParse` → `broadcaster.emit(jobId, envelope)` → EventEmitter fans out to live WS listeners.
- **Tests**: tests-as-spec style matching Phase 16/21 — per-service `.spec.ts` with behavior rows, DB-gated integration specs for envelope correlation (subscribe to a fake `job.log` → assert WS socket receives envelope with correlationId matching ALS context).
- **Renames**: existing `.test.ts` files under `server/streaming/__tests__/` rename to `.spec.ts` via `git mv` 100%-similarity per MOD-04 (5 files: `adapter-factory`, `android-preview-adapter`, `device-preview`, `ios-preview-adapter`, `job-broadcaster`).
- **Barrel discipline**: `server/streaming/index.ts` re-exports strictly from `internal/` per MOD-02. Existing top-level files (`job-broadcaster.ts`, `device-preview.ts`, `websocket-plugin.ts`, `types.ts`, `ws-schemas.ts`, `adapters/`) move under `internal/`; plugin decorators (`jobBroadcaster`, `devicePreview`) remain as Fastify decorator surface but routed through factory-returned module primitives per MOD-06.
- **Idempotency**: Not applicable — WebSocket fan-out is lossy-by-design (stale connections drop messages). No idempotency proof needed (success criterion 3 is about dev tooling, not exactly-once delivery).

</decisions>

<code_context>
## Existing Code Insights

### Current streaming module state (pre-migration)

- `server/streaming/job-broadcaster.ts` — 68 lines. In-memory `Map<jobId, JobMessage[]>` ring buffer (MAX_BUFFER=200) + Node `EventEmitter` fan-out. Public API: `emit(jobId, msg)`, `subscribe(jobId, handler) → unsub`, `cleanup(jobId)`, `getBufferSize(jobId)`. No correlationId awareness today.
- `server/streaming/websocket-plugin.ts` — 175 lines. Registers `@fastify/websocket`, decorates `fastify.jobBroadcaster` + `fastify.devicePreview`, wires two WS routes: `/ws/jobs/:id` (subscribes to broadcaster) + `/ws/devices/:id/preview` (subscribes to devicePreview). Auth gate via `fastify.authService.validateKey` when `config.auth.enabled`. Ping/pong heartbeat at 30s, `MIN_FRAME_INTERVAL_MS=100` throttle on device preview.
- `server/streaming/device-preview.ts` — DevicePreviewManager for binary frame fan-out (base64-encoded to WS clients). Out of scope for envelope wrapping (binary frames stay as-is — Phase 22 success criterion 1 scopes to "WebSocket channel" frames, and pragmatically binary preview frames aren't Zod-validatable as structured envelopes). Planner decides whether to touch at all.
- `server/streaming/ws-schemas.ts` — 21 lines. Already has `wsEnvelopeSchema` placeholder with Phase 22 TODO comment: `.loose()` + optional `v`. Phase 22 tightens: `v: z.literal(1)` required, `correlationId: z.string().uuid()` required, add `ts`/`payload` fields.
- `server/streaming/types.ts` — 815 bytes. `JobMessage` type (log/step/status shapes) — these become envelope payloads.
- `server/streaming/__tests__/` — 5 test files already exist (`.test.ts` — need rename to `.spec.ts` per MOD-04). 

### Module files MISSING (to be created)

- `server/streaming/MODULE.md` — 9-section contract.
- `server/streaming/index.ts` — public barrel (createStreamingModule factory).
- `server/streaming/events.ts` — `ws.frame.dropped` event + Zod payload + registry + emit helper (single-event surface vs. Phase 20's 4-event / Phase 21's 3-event).
- `server/streaming/internal/` — subdirectory; existing top-level files move under it, enforced by dep-cruiser rule (6th module rule added in this phase, same pattern as Phase 21 artifacts).
- `server/streaming/plugin.ts` — thin Fastify plugin replacing `websocket-plugin.ts`; dependencies array: `['config', 'auth', 'pool-plugin', 'event-bus', 'queue']` (queue added because bus→subscriber path depends on queue plugin being registered for ALS).

### Integration points to sever

- `server/jobs/job-service.ts:15` — imports `JobBroadcaster` as optional injection (`jobBroadcaster?: JobBroadcaster`). ALL direct `this.jobBroadcaster?.emit(...)` callsites must move to `bus.emit('job.log'|'job.step'|'job.status', ...)` — actual event emission belongs to Phase 23 (Jobs Keystone), so Phase 22 has a choice:
  - **Option A**: Land bridgehead events (`job.log`, `job.step`, `job.status`) in `server/jobs/events.ts` as part of Phase 22 scope, so the streaming subscriber has real events to subscribe to. Same pattern as Phase 21's `job.started` + `maestro.log.written` bridgehead into jobs for artifacts to consume.
  - **Option B**: Streaming subscribes to stub/synthetic events via a shim; Phase 23 replaces shim with real events. Risk: dead code + refactor churn.
  - **Recommendation for planner**: Option A (bridgehead), consistent with Phase 21 precedent.
- `server/pipelines/broadcaster.ts` — separate from `JobBroadcaster`; pipelines module migrates in Phase 25. Do NOT touch in Phase 22.

### Reference implementations to copy from

- `server/artifacts/` — Phase 21 close, most recent canonicalized reference. Uses `internal/` subdirectory + factory + thin plugin + barrel with strict re-export.
- `server/pool/` — Phase 20 close. Reference for 4-decorator thin plugin (`pool + processTracker + healthChecker + poolModule`); streaming will mirror with (`jobBroadcaster + devicePreview + streamingModule`).
- `server/hooks/` — Phase 16 pilot; reference for createXxxModule factory + bus/queue wiring.

### Established conventions (from Phase 16/18/19/20/21)

- `MODULE.md` has exactly 9 H2 sections in fixed order (Purpose / Public API / Events Emitted / Events Consumed / Queue Produced / Queue Consumed / Invariants / Non-Goals / Dependencies). "Queue Produced/Consumed" sections say "None" if module owns no queues (valid per Phase 22's no-queue shape).
- Events registered via `typedBus()` pattern; emit helpers generated by `makeXxxEmitters()`.
- Tests-as-spec: behavior rows in describe blocks with `[Invariant X]` / `[SC-N]` tags referencing MODULE.md invariants and ROADMAP success criteria.
- Nyquist baseline gate (coverage delta ≤ −2pp) per Phase 15-09; baseline file `.planning/nyquist-baseline.json` unchanged since Phase 15 commit 55ff8ac.
- dep-cruiser 6th module rule: `no-deep-imports-into-streaming-internal` + fixture file that fires the rule via `@ts-expect-error` import.
- plugin-order.spec additive assertions: 3 positional + 1 structural readFileSync regex-extract of `streaming/plugin.ts` dependencies literal.

</code_context>

<specifics>
## Specific Ideas

- `wsEnvelopeSchema` in `ws-schemas.ts` already carries a TODO comment flagging Phase 22 as the owner — tighten from `.loose()` + optional `v` to strict shape: `{type: string, correlationId: uuid, v: 1, ts: datetime, payload: unknown}`.
- Success criterion 3 (developer click WS event → see correlationId → grep server log) is satisfied automatically once the envelope carries correlationId: the web dev tools JSON inspector already prints envelope fields; no new UI work needed. Planner may optionally add a small test that round-trips a correlationId through bus → envelope → WS serialization → parse on the receiving end.
- Phase 22 is the single-event-surface phase (Phase 19 reporting had 4 events, Phase 20 pool 4, Phase 21 artifacts 3). `ws.frame.dropped` is the only candidate emit; streaming is primarily a consumer, not a producer.

</specifics>

<deferred>
## Deferred Ideas

- DevicePreviewManager envelope wrapping — binary base64 frames don't fit the Zod envelope shape. Deferred to Phase 29 (Web Refactor) if/when web client wants structured metadata alongside binary frames.
- Sharing `wsEnvelopeSchema` types with the web client via generated artifact — lands in Phase 29 (WEB-03 "Schemas Zod de WS messages compartilhados server↔web") and Phase 17 contract pipeline export.
- WS replay semantics beyond 200-message ring buffer (e.g., server-side persistent replay) — out of scope; ring buffer is sufficient for reconnect.

</deferred>
