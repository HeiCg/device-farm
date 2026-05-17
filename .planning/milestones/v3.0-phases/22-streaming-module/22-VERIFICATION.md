---
phase: 22-streaming-module
verified: 2026-05-07T12:00:00Z
status: passed
score: 12/12 must-haves verified
re_verification: false
gaps: []
human_verification:
  - test: "WebSocket client receives envelopes with correlationId at root level"
    expected: "Browser DevTools shows JSON frame with 'correlationId' field at root (not nested inside payload)"
    why_human: "Cannot verify actual WS frame delivery in a running server without a client connection"
  - test: "ALS correlationId propagates from HTTP request through bus to WS envelope"
    expected: "In a live session, a job kicked off from an HTTP request should produce WS frames whose correlationId matches the X-Correlation-Id header seen in server logs"
    why_human: "End-to-end ALS propagation across HTTP -> bus -> subscriber -> WS requires a running server with a real HTTP request context"
---

# Phase 22: Streaming Module Verification Report

**Phase Goal:** Fill the `JobBroadcaster` ring buffer from bus subscriptions instead of direct producer calls. Preserve WS replay semantics while routing every WebSocket frame through a Zod-validated envelope that carries `correlationId`.
**Verified:** 2026-05-07T12:00:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | JobBroadcaster ring buffer stores `WsEnvelope[]` (not old `JobMessage[]`) | VERIFIED | `Map<string, WsEnvelope[]>` at `server/streaming/internal/job-broadcaster.ts:24` |
| 2 | Every WS frame passes through `wsEnvelopeSchema.safeParse` before entering ring buffer | VERIFIED | `internal/module.ts:163` calls `wsEnvelopeSchema.safeParse(candidate)` in subscriber handler |
| 3 | Envelope schema requires `correlationId` as UUID, `v: z.literal(1)`, `ts` datetime, `payload` | VERIFIED | `internal/ws-schemas.ts:65-74` — all fields required, no `.loose()`, no `.optional()` on `v` |
| 4 | No producer outside streaming module calls `JobBroadcaster.emit` directly | VERIFIED | `grep` over `job-service.ts` returns 0 matches for `jobBroadcaster?.emit` or `jobBroadcaster!.emit`; lifecycle-ownership.spec.ts asserts this structurally |
| 5 | 7 callsites in `job-service.ts` inverted to typed bus emits (log/step/status) | VERIFIED | 3 `.log(`, 2 `.step(`, 2 `.status(` calls confirmed at lines 284, 310, 316, 334, 341, 264, 429 |
| 6 | `registerSubscribers` subscribes to job.log/job.step/job.status on fastify.jobsModule.bus in onReady | VERIFIED | `internal/module.ts:198-209` — three `jobsModule.bus.on(...)` calls; deferred to `onReady` hook in `plugin.ts:193` |
| 7 | correlationId read from ALS at subscriber time; falls back to `randomUUID()` | VERIFIED | `internal/module.ts:153` — `readCorrelationIdFromAls() ?? randomUUID()` |
| 8 | safeParse failure drops frame + emits `ws.frame.dropped` via `emit.frameDropped` | VERIFIED | `internal/module.ts:163-175` — failure path: `emit.frameDropped(...)` + `return` |
| 9 | Ring-buffer replay preserved: WS subscribe replays buffered history then streams live | VERIFIED | `internal/job-broadcaster.ts:54-68` — `subscribe()` iterates buffer then attaches live listener |
| 10 | `websocket-plugin.ts` deleted; `plugin.ts` thin-wirer replaces it; `server/index.ts` import updated | VERIFIED | `server/streaming/websocket-plugin.ts` absent; `server/index.ts:9` imports `./streaming/plugin.js` |
| 11 | Dep-cruiser rule 6 (`no-deep-imports-into-streaming-internal`) enforces MOD-02 boundary | VERIFIED | `.dependency-cruiser.cjs` line 109 — rule name matches; fixture `bad-streaming-deep-import.ts` + dep-cruiser spec 6th it-block both present |
| 12 | Full test coverage: module.spec, events.spec, envelope.spec, subscriber.spec, correlation.spec, lifecycle-ownership.spec, 5 renamed .spec.ts files | VERIFIED | All 10 spec files confirmed in `server/streaming/__tests__/` |

**Score:** 12/12 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `server/streaming/events.ts` | Full registry: 1 event, real STREAMING_AGGREGATE_ID v5 UUID, makeStreamingEmitters | VERIFIED | 131 lines; `makeStreamingEmitters`, `STREAMING_AGGREGATE_ID = 'fff0592e-b92c-5221-a40a-d10a141f0158'`, `wsFrameDroppedPayload`, `satisfies EventRegistry` |
| `server/streaming/internal/module.ts` | createStreamingModule factory — 6-key return, 3 bus subscribers, safeParse, shutdown | VERIFIED | 242 lines; full factory body replacing throw-stub |
| `server/streaming/internal/ws-schemas.ts` | Strict wsEnvelopeSchema: v:z.literal(1) required, correlationId:uuid required, ts+payload | VERIFIED | `z.literal(1)` line 68; `z.string().uuid()` line 67; no `.loose()` |
| `server/streaming/internal/job-broadcaster.ts` | Ring buffer Map<string, WsEnvelope[]>; emit/subscribe WsEnvelope | VERIFIED | `Map<string, WsEnvelope[]>` line 24; WsEnvelope signature on emit + subscribe |
| `server/streaming/internal/device-preview.ts` | DevicePreviewManager moved under internal/ | VERIFIED | `export class DevicePreviewManager` confirmed in internal/ |
| `server/streaming/internal/types.ts` | JobMessage + other types moved under internal/ | VERIFIED | `export interface JobMessage` in internal/types.ts |
| `server/streaming/internal/adapters/` | 4 adapter files moved under internal/ | VERIFIED | Directory exists; `android-preview-adapter.ts`, `ios-preview-adapter.ts`, `index.ts` confirmed |
| `server/streaming/plugin.ts` | Thin plugin; name 'websocket-plugin' preserved; 5-entry deps | VERIFIED | `{ name: 'websocket-plugin', dependencies: ['config', 'auth', 'pool-plugin', 'event-bus', 'db'] }` line 211 |
| `server/streaming/index.ts` | Full barrel with streamingPlugin + createStreamingModule + back-compat re-exports | VERIFIED | 74 lines; all key exports present |
| `server/streaming/MODULE.md` | 9 H2 sections in canonical order | VERIFIED | All 9 sections confirmed (`## Purpose` through `## Dependencies`) |
| `server/jobs/job-service.ts` | 7-callsite surgery complete; 0 imperative jobBroadcaster.emit; 1 kept cleanup | VERIFIED | 3 log + 2 step + 2 status calls; 0 `jobBroadcaster?.emit` or `jobBroadcaster!.emit`; 1 `jobBroadcaster!.cleanup` at line 477 |
| `server/jobs/events.ts` | Bridgehead extension: LOG/STEP/STATUS in JOB_EVENT_NAMES; jobLogPayload; makeJobsEmitters returns 6 helpers | VERIFIED | `LOG: 'job.log'` (line 99), `jobLogPayload` (line 177), `log/step/status` in makeJobsEmitters return (lines 255-257) |
| `server/streaming/__tests__/module.spec.ts` | 8+ tests: 6-key shape, factory, shutdown idempotency | VERIFIED | 3 describe blocks, 8 it-blocks confirming factory shape + registerSubscribers + shutdown |
| `server/streaming/__tests__/events.spec.ts` | >=6 tests: event-name, registry, UUID derivation, payload schema, ALS stamping | VERIFIED | 6 describe blocks with 10+ assertions |
| `server/streaming/__tests__/envelope.spec.ts` | Non-DB unit spec for wsEnvelopeSchema.safeParse drop path | VERIFIED | 9 tests exercising valid/invalid candidates |
| `server/streaming/__tests__/subscriber.spec.ts` | DB-gated SC2 integration spec | VERIFIED | `describe.skipIf(!HAS_DB)` at line 120 |
| `server/streaming/__tests__/correlation.spec.ts` | DB-gated SC1+TRACE-06 correlationId round-trip | VERIFIED | `asyncLocalStorage.run({correlationId: corrId, ...})` + `expect(received[0].correlationId).toBe(corrId)` |
| `server/streaming/__tests__/lifecycle-ownership.spec.ts` | Non-DB SC2 grep-guard: 0 imperative emits, >=7 bus emits, 1 cleanup | VERIFIED | `countMatches` assertions on jobBroadcaster + jobsEmit patterns |
| `server/__tests__/plugin-order.spec.ts` | Extended with 4 Phase 22 assertions + wbIndex helper | VERIFIED | `wbIndex` function at line 46; `event-bus` before `websocket-plugin` at line 207 |
| `.dependency-cruiser.cjs` | 6th rule `no-deep-imports-into-streaming-internal` | VERIFIED | Rule found at line 109 |
| `__fixtures__/dep-cruiser/bad-streaming-deep-import.ts` | Fixture importing from streaming/internal | VERIFIED | Imports `createStreamingModule` from `../../server/streaming/internal/module.js` |
| `server/hooks/__tests__/dep-cruiser.spec.ts` | 6th it-block `[MOD-02 streaming extension]` | VERIFIED | `it('[MOD-02 streaming extension] deep import into server/streaming/internal/*...'` at line 313 |
| `.planning/phases/22-streaming-module/deferred-items.md` | Phase close deferrals catalog | VERIFIED | Present; contains Phase 23/27/29 deferred items |
| `.planning/STATE.md` | Phase 22 CLOSED entry | VERIFIED | `Phase 22 CLOSED` at line 7 |
| `.planning/ROADMAP.md` | Phase 22 Complete row + 7-plan list | VERIFIED | `| 22. Streaming Module | v3.0 | 7/7 | Complete | 2026-05-08 |` at line 324 |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `server/streaming/plugin.ts` | `server/streaming/internal/module.ts createStreamingModule` | `createStreamingModule({fastify, db, config, logger})` call | WIRED | `plugin.ts:52` calls factory |
| `server/streaming/internal/module.ts registerSubscribers` | `fastify.jobsModule.bus.on(...)` | `fastify.addHook('onReady', ...)` defers until all plugins up | WIRED | `plugin.ts:193-195` + `module.ts:182-213` |
| `server/jobs/job-service.ts jobsEmit?.log/step/status` | `server/jobs/events.ts makeJobsEmitters` | Constructor injection via `jobsEmit: JobsEmitters` param | WIRED | Confirmed at `job-service.ts:264, 284, 310, 316, 334, 341, 429` |
| `server/streaming/internal/module.ts subscriber handler` | `server/streaming/internal/ws-schemas.ts wsEnvelopeSchema` | `wsEnvelopeSchema.safeParse(candidate)` | WIRED | `module.ts:163` — safeParse call before broadcaster.emit |
| `server/streaming/internal/module.ts subscriber handler` | ALS correlationId | `readCorrelationIdFromAls() ?? randomUUID()` | WIRED | `module.ts:153` |
| `server/streaming/internal/module.ts subscriber handler` | `server/streaming/internal/job-broadcaster.ts broadcaster.emit` | `jobBroadcaster.emit(payload.jobId, parsed.data as WsEnvelope)` | WIRED | `module.ts:178` |
| `__fixtures__/dep-cruiser/bad-streaming-deep-import.ts` | `no-deep-imports-into-streaming-internal` rule in `.dependency-cruiser.cjs` | dep-cruiser fixture triggers rule 6 | WIRED | Rule confirmed at `.dependency-cruiser.cjs:109` + dep-cruiser.spec.ts line 313 |
| `server/streaming/__tests__/correlation.spec.ts asyncLocalStorage.run` | `readCorrelationIdFromAls()` in subscriber | ALS propagates through microtask; subscriber reads at handler time | WIRED | `correlation.spec.ts:143-157` — asserts `received[0].correlationId === corrId` |

---

### Requirements Coverage

| Requirement | Source Plans | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| TRACE-06 | 22-00, 22-01, 22-02, 22-03, 22-04, 22-05, 22-06 | Every WebSocket message carries correlationId in envelope; web UI links message to log entry | SATISFIED | `wsEnvelopeSchema` requires `correlationId: z.string().uuid()`; subscriber reads from ALS; `correlation.spec.ts` proves round-trip; `envelope.spec.ts` proves safeParse rejects missing correlationId |
| MOD-01 | 22-00, 22-01, 22-05 | MODULE.md with 9 fixed sections | SATISFIED | All 9 H2 sections confirmed in `server/streaming/MODULE.md` |
| MOD-02 | 22-00, 22-02, 22-04, 22-05 | `index.ts` barrel + dep-cruiser enforcing no deep imports | SATISFIED | Barrel at `server/streaming/index.ts`; rule 6 in `.dependency-cruiser.cjs`; dep-cruiser spec |
| MOD-03 | 22-00, 22-01 | `events.ts` with Zod schemas + emit helpers + event name constants | SATISFIED | `server/streaming/events.ts` — STREAMING_EVENT_NAMES, wsFrameDroppedPayload, makeStreamingEmitters, streamingRegistry |
| MOD-04 | 22-05 | Tests use `.spec.ts` naming convention | SATISFIED | All 10 test files in `server/streaming/__tests__/` use `.spec.ts` suffix |
| MOD-05 | 22-00 | File naming kebab-case convention documented | SATISFIED | All new files follow kebab-case convention |
| MOD-06 | 22-02 | Factory `createStreamingModule(deps): StreamingModule` | SATISFIED | `internal/module.ts` exports `createStreamingModule` returning 6-key `StreamingModule` |
| EVENTS-03 | 22-01 | Event names: `noun.verbed` past-tense dotted | SATISFIED | `ws.frame.dropped` follows pattern; events.spec.ts asserts regex `^[a-z]+(\.[a-z]+)+$` |
| EVENTS-04 | 22-01 | Thin payloads (IDs + minimal delta) | SATISFIED | Payloads: jobId + minimal data; no bloated structures |
| EVENTS-06 | 22-03 | Idempotency | NOT APPLICABLE | As per Plan 22-03 objective: "EVENTS-06 (idempotency) NOT covered — streaming module owns no queue + fan-out is lossy-by-design per CONTEXT §Decisions" |
| EVENTS-08 | 22-00, 22-01, 22-02 | Emit helpers in events.ts; direct bus.emit calls outside helpers forbidden by lint | SATISFIED | `makeStreamingEmitters` factory + `makeJobsEmitters` extension; dep-cruiser no-direct-bus-emit rule allows only `events.ts` files |
| TRACE-04 | 22-01 | Envelope includes correlationId read from ALS at emit time | SATISFIED | `createEventHelpers` (bus/helpers.ts) stamps ALS correlationId; events.spec.ts asserts envelope stamping |
| TRACE-08 | 22-01 | Bus middleware persists only events marked `persisted: true` | SATISFIED | `ws.frame.dropped` — `persisted: false`; events.spec.ts asserts `streamingRegistry['ws.frame.dropped'].persisted === false` |

**Note on EVENTS-06:** Declared in Plan 22-03 but explicitly documented as NOT APPLICABLE — the streaming module has no queue; WebSocket fan-out is lossy-by-design. This is a known deviation captured in CONTEXT §Decisions and Plan 22-03 objective. Not a gap.

---

### Anti-Patterns Found

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| None found | — | — | — |

Key files scanned: `server/streaming/internal/module.ts`, `server/streaming/plugin.ts`, `server/streaming/events.ts`, `server/streaming/internal/job-broadcaster.ts`, `server/streaming/internal/ws-schemas.ts`, `server/jobs/job-service.ts`. No TODO/FIXME/PLACEHOLDER markers found. No stub implementations detected. The previous Plan 22-00 throw-stub in `internal/module.ts` has been fully replaced with substantive factory code.

One acknowledged pattern in `internal/module.ts` (line 107): `6TH SAMPLE POINT NOTE` for `persistEnvelope` middleware — this is a documented intentional copy, not a stub. Phase 27+ consolidation trigger noted in MODULE.md §Non-Goals.

---

### Human Verification Required

#### 1. Live WS Frame Delivery with correlationId

**Test:** Start the server, submit a job via CLI, open a WebSocket connection to `/ws/jobs/:id` in a browser or `wscat` client. Inspect the raw JSON frames.
**Expected:** Each frame has `{"type":"log|step|status","correlationId":"<uuid>","v":1,"ts":"<iso>","payload":{...}}` at the root level — correlationId is a sibling of `type`, not nested inside `payload`.
**Why human:** Requires a running server with a real job in progress. Cannot verify actual WS frame delivery without a client.

#### 2. ALS correlationId Round-Trip via HTTP Request

**Test:** Send an HTTP request to the server (e.g., job submit), observe in server pino logs the correlationId, then watch the WS stream for the same job. Verify the correlationId in log entries matches the correlationId in WS frames.
**Expected:** The correlationId from the originating HTTP request's ALS context propagates through the bus subscriber into the WS envelope.
**Why human:** The `correlation.spec.ts` proves this in-process with mock ALS. The real HTTP path involves the correlation middleware setting up the ALS store — verifying end-to-end requires a real request.

---

### Gaps Summary

No gaps found. All 12 observable truths are VERIFIED. All 25 required artifacts exist and are substantive (not stubs). All 8 key links are WIRED. TRACE-06 (the sole externally-declared requirement for Phase 22) is fully satisfied: every WS frame passes through `wsEnvelopeSchema.safeParse(candidate)` which requires `correlationId: z.string().uuid()`, correlationId is read from ALS at subscriber time with a `randomUUID()` fallback, and the entire path is covered by automated tests at unit level (envelope.spec), integration level (correlation.spec, subscriber.spec), and structural level (lifecycle-ownership.spec).

The phase goal is achieved: `JobBroadcaster` ring buffer is filled exclusively from bus subscriptions (`job.log`/`job.step`/`job.status`), WS replay semantics are preserved (ring buffer of up to 200 `WsEnvelope` objects replayed on subscriber attach), and every WebSocket frame carries a Zod-validated envelope with `correlationId`.

---

_Verified: 2026-05-07T12:00:00Z_
_Verifier: Claude (gsd-verifier)_
