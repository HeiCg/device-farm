# Streaming Module

## Purpose

Bus-subscribed WebSocket fan-out with strict Zod envelope validation carrying `correlationId` (TRACE-06).

After Phase 22 the streaming module is a **PURE SUBSCRIBER**: the `JobBroadcaster` ring buffer is filled from subscriptions to `job.log` / `job.step` / `job.status` emitted by `server/jobs/job-service.ts`, NOT by imperative `fastify.jobBroadcaster.emit(...)` calls inside `executeJob`. Every frame sent on `/ws/jobs/:id` is wrapped in a Zod-validated envelope `{type, correlationId, v:1, ts, payload}`. `safeParse` failures emit `ws.frame.dropped` + structured log + skip send (never crashes the client connection). Ring-buffer replay semantics (<=200 envelopes on reconnect) are preserved.

`DevicePreviewManager` (binary base64 frames on `/ws/devices/:id/preview`) is unchanged by Phase 22 per CONTEXT §Deferred Ideas — envelope-wrapping for device preview is Phase 29 WEB-03 scope. The module still decorates `fastify.devicePreview` for back-compat.

The module keeps `JobBroadcaster` and `DevicePreviewManager` class instances exposed as Fastify decorators (`fastify.jobBroadcaster`, `fastify.devicePreview`) for legacy consumers (mid-flow device-preview start/stop in `server/jobs/job-service.ts`; future HTTP routes). Access is via barrel or decorator only; direct imports from `server/streaming/internal/**` are forbidden by `dependency-cruiser` rule `no-deep-imports-into-streaming-internal` (Plan 22-00 addition).

## Public API

Exports from `server/streaming/index.ts` (the ONLY legitimate import surface outside this module — enforced by the dep-cruiser rule above):

- `streamingPlugin` — Fastify plugin (thin wrapper around `createStreamingModule`). Plugin name: `'websocket-plugin'` (unchanged from v2.0 for back-compat dep-string resolution across jobs-plugin + pipelines-plugin + plugin-order.spec).
- `createStreamingModule(deps): StreamingModule` — factory (MOD-06) returning `{jobBroadcaster, devicePreview, emit, bus, registerSubscribers, shutdown}` (6-key shape).
- `JobBroadcaster` / `DevicePreviewManager` classes — back-compat. `fastify.jobBroadcaster` + `fastify.devicePreview` decorators read by `server/jobs/job-service.ts` (cleanup call + device preview start/stop — all other imperative emit calls were removed in Plan 22-02).
- `wsEnvelopeSchema` / `WsEnvelope` type — strict envelope contract (Plan 22-01 tightened from Phase 17 placeholder). Phase 29 WEB-03 will share with web client.
- Events surface: `streamingRegistry`, `STREAMING_EVENT_NAMES`, `STREAMING_AGGREGATE_ID`, `makeStreamingEmitters`, `wsFrameDroppedPayload`.
- Back-compat types: `JobMessage`, `DevicePreviewMessage`, `LogData`, `StepData`, `MetricsData`, `StatusData`, `WsMessageType`, `ArtifactType` (legacy — new code should use `WsEnvelope`).
- Types: `StreamingModule`, `CreateStreamingModuleDeps`, `StreamingRegistry`, `StreamingEmitters`, `StreamingEventName`.

Fastify decorators exposed by the plugin:

- `fastify.jobBroadcaster: JobBroadcaster`
- `fastify.devicePreview: DevicePreviewManager`
- `fastify.streamingModule: StreamingModule`

WebSocket routes:

- `GET /ws/jobs/:id` — job event channel. Subscribes to `fastify.jobBroadcaster`; receives enveloped frames; token-gated auth when `config.auth.enabled`; 30-second ping/pong heartbeat.
- `GET /ws/devices/:id/preview` — device preview channel. Subscribes to `fastify.devicePreview`; receives binary base64 frames (unchanged shape); same auth gate + heartbeat; 100ms frame throttle (10fps max).

## Events Emitted

- `ws.frame.dropped` — **NOT persisted** (programmer-error signal; structured log is sufficient; events-table bloat unjustified — Phase 27 trace-tree can derive from pino log lines if needed). Fires from inside the streaming subscriber when `wsEnvelopeSchema.safeParse(candidate)` returns `success: false`. Payload: `{jobId, eventType: 'log'|'step'|'status', reason: 'safeParse-failed'|'unknown', zodError?}`. `aggregateType: 'streaming'`, `aggregateId: jobId`.

`STREAMING_AGGREGATE_ID = fff0592e-b92c-5221-a40a-d10a141f0158` is the v5 UUID derived from `'streaming'` under the URL namespace (RFC 4122 §4.3) — reserved for future streaming-wide telemetry (e.g. `streaming.buffer.overflow`). NOT used by `ws.frame.dropped`; that event carries `jobId` as aggregateId.

## Events Consumed

All subscriptions are deferred to an `onReady` Fastify hook inside `registerSubscribers` (per Pitfall 2): streaming plugin (name `'websocket-plugin'`) registers at step 10 in `server/index.ts` < jobs-plugin at step 13, so `fastify.jobsModule` is NOT decorated at plugin-body time. `onReady` fires after all plugins register, safely reading `fastify.jobsModule.bus`.

- `job.log` — consumed via `fastify.jobsModule.bus.on('job.log', handler)` (non-persisted; direct bus subscription). Handler: read correlationId from ALS (`readAls('correlationId') ?? randomUUID()`), build envelope `{type:'log', correlationId, v:1, ts: Date.now(), payload: data}`, `wsEnvelopeSchema.safeParse`, on success `jobBroadcaster.emit(jobId, envelope)`, on failure emit `ws.frame.dropped` + structured log + drop.
- `job.step` — consumed via `fastify.jobsModule.bus.on('job.step', handler)`. Same handler shape with `type:'step'`.
- `job.status` — consumed via `fastify.jobsModule.bus.on('job.status', handler)`. Same handler shape with `type:'status'`.

Cross-module producer references: `server/jobs/events.ts` (Plan 22-01 extended `jobsRegistry` with these 3 events + emit helpers); `server/jobs/job-service.ts` (Plan 22-02 inverted 7 imperative `jobBroadcaster.emit` callsites into typed bus emits via `this.jobsEmit?.log|step|status`).

## Queue Produced

**None.** The streaming module owns no pg-boss queue. WebSocket fan-out is in-process only (EventEmitter-backed ring buffer per jobId). This is an explicit deviation from the Phase 16/18/19/20/21 module template per CONTEXT §Decisions — MOD-03 states "queue.ts only if the module owns queues".

## Queue Consumed

**None.** See above.

## Invariants

1. **Envelope carries correlationId at root.** Every frame written to `fastify.jobBroadcaster.emit(jobId, envelope)` has `envelope.correlationId` populated — either from ALS (via `readAls`) or from a fallback `randomUUID()`. Never undefined. Enforced by `wsEnvelopeSchema.safeParse` — malformed envelopes are dropped before reaching the broadcaster. Proven in `correlation.spec.ts [TRACE-06]`.
2. **safeParse failure drops frame + emits ws.frame.dropped + never crashes connection.** The subscriber wraps every candidate in `wsEnvelopeSchema.safeParse`. On failure: `logger.warn({err, candidate}, 'ws.frame.dropped')`, `emit.frameDropped(jobId, {reason:'safeParse-failed', zodError})`, `return` (drop). Live WS listeners see no frame. Ring buffer does not accumulate malformed data. Proven in `envelope.spec.ts` + `subscriber.spec.ts`.
3. **Ring-buffer replay returns last <=200 envelopes on reconnect.** `JobBroadcaster.subscribe(jobId, handler)` replays buffered envelopes in emission order THEN streams live events. `MAX_BUFFER=200`. Proven in `subscriber.spec.ts [SC2 ring-buffer replay]`.
4. **Producer-side bus emit uses `.parse()` fail-loud; consumer-side envelope build uses `.safeParse()` fail-soft.** TypedBus.emit (server/bus/bus.ts) does `.parse(payload)` — schema drift is a bug to catch immediately. The streaming subscriber does `.safeParse(candidate)` on the envelope — allows envelope-builder bugs (e.g. missing ALS correlationId) to degrade gracefully instead of crashing the bus. Documented in Pitfall 5.
5. **No producer outside streaming module may call JobBroadcaster.emit directly.** Bus subscription is the ONLY source of broadcaster frames. Enforced structurally by `lifecycle-ownership.spec.ts [Phase 22 SC2]` which asserts `count('this.jobBroadcaster?.emit(') == 0` in `server/jobs/job-service.ts`. (SC2 non-violation: `this.jobBroadcaster!.cleanup(job.id)` is kept at job-service line ~479 for buffer lifecycle — see §Non-Goals.)

## Non-Goals

- **DevicePreviewManager envelope wrapping.** Binary base64 frames don't fit the Zod envelope shape. Deferred to Phase 29 WEB-03 if/when the web client wants structured metadata alongside binary frames. Phase 22 leaves DevicePreviewManager internals unchanged; the plugin continues to decorate `fastify.devicePreview` and expose the `/ws/devices/:id/preview` route with binary-frame wire shape.
- **Sharing wsEnvelopeSchema with the web client via generated artifact.** Phase 29 WEB-03 will expose the strict envelope schema to web via the same contract pipeline Phase 17 established. Phase 22 ships the server-side schema only; web consumers that parse WS frames today continue with their existing logic.
- **WS replay semantics beyond 200-message ring buffer.** Server-side persistent replay (events-table query for missed frames on reconnect) is out of scope. Ring buffer is sufficient for reconnect within the 5-second job-finish window.
- **Exactly-once delivery.** WebSocket fan-out is lossy-by-design (stale connections drop messages). Idempotency is NOT tested in Phase 22 — first v3.0 phase without an idempotency spec. Justified because the module owns no queue + WS semantics don't require it.
- **SC2 non-violation — `this.jobBroadcaster!.cleanup(job.id)` call KEPT at `server/jobs/job-service.ts` line ~479.** Buffer lifecycle (5-second delay after `executeJob` resolves/rejects frees the ring buffer) is admissible per SC2's strict reading ("no producer calls broadcaster.EMIT directly" — cleanup is not emit). Phase 23 Jobs Keystone may replace with a `job.cleanup.requested` event when it rewrites `executeJob`. `lifecycle-ownership.spec.ts` asserts `count('this.jobBroadcaster!.cleanup(') == 1` — anything more is a regression.
- **6TH SAMPLE POINT — Phase 27+ CONSOLIDATION TRIGGER STILL OPEN.** The `persistEnvelope` middleware at `server/streaming/internal/module.ts` lines ~80-110 is the 6th verbatim copy of the same pattern (Phase 16 hooks + Phase 18 lifecycle + Phase 19 reporting + Phase 20 pool + Phase 21 artifacts + Phase 22 streaming). Phase 27+ extracts to `server/bus/persist-envelope.ts`. Do NOT consolidate in Phase 22 — scope creep.

## Dependencies

Plugin `{ name: 'websocket-plugin', dependencies: ['config', 'auth', 'pool-plugin', 'event-bus', 'db'] }` (5 entries — matches Phase 21 artifacts canonical shape).

- `config` — for `fastify.config.auth.enabled` gate on WS routes.
- `auth` — for `fastify.authService.validateKey(token)` on WS route auth check.
- `pool-plugin` — for `fastify.pool.getDevice(deviceId)` access in device-preview path (retained from Phase 17 DEBT-01 fix).
- `event-bus` — `createStreamingModule` reads `fastify.jobsModule.bus` in onReady hook for the 3 bus subscriptions.
- `db` — `persistEnvelope` middleware writes to `events` table (short-circuits on `persisted:false` for `ws.frame.dropped` but declared for future-proof per RESEARCH §Plugin Dependencies).

Plugin NAME `'websocket-plugin'` preserved for back-compat — jobs-plugin + pipelines-plugin declare this as a dependency; `plugin-order.spec.ts` has positional assertions against the name. Renaming would be 5+ cross-module file changes; rejected per RESEARCH §Plugin Name Question.

### Runnable Example

```typescript
// Emit — ONLY from inside server/streaming/events.ts (EVENTS-08 rule);
// other code calls fastify.streamingModule.emit.frameDropped(...).
import { createStreamingModule } from 'server/streaming/index.js';

// Typical mounting (see server/streaming/plugin.ts):
const module = createStreamingModule({ fastify, db, config, logger });
fastify.decorate('streamingModule', module);
fastify.addHook('onReady', async () => { await module.registerSubscribers(); });

// Emit ws.frame.dropped (from inside the module; subscribers rarely need this):
module.emit.frameDropped(jobId, {
  jobId,
  eventType: 'log',
  reason: 'safeParse-failed',
  zodError: 'correlationId missing from envelope candidate',
});

// Subscribe to broadcaster (from WS route handler inside plugin.ts):
const unsub = module.jobBroadcaster.subscribe(jobId, (envelope) => {
  // envelope is WsEnvelope = {type, correlationId, v:1, ts, payload}
  socket.send(JSON.stringify(envelope));
});

// Example envelope on the wire (JSON):
// {
//   "type": "log",
//   "correlationId": "7f4c3e90-2c8f-47c1-9c8a-3d3c8f7e4a12",
//   "v": 1,
//   "ts": "2026-04-22T19:47:12.138Z",
//   "payload": { "line": "Running flow: login.yaml", "stream": "stdout" }
// }
```

**TypeScript snippet typecheck:** this runnable example compiles against the current barrel (Plan 22-05 output). If Phase 23+ reshapes the factory signature, this example block MUST be updated — MOD-09 (Phase 27 scope) will enforce snippet typecheck in CI.

References to RESEARCH pitfalls: Pitfall 2 (onReady deferral); Pitfall 5 (parse-vs-safeParse split). See `.planning/phases/22-streaming-module/22-RESEARCH.md`.
