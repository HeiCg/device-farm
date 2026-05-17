---
phase: 35-app-explorer
plan: 03
subsystem: explorations
tags: [explorations, websocket, broadcaster, ring-buffer, heartbeat, discriminated-union, zod, vitest, trace-06]

# Dependency graph
requires:
  - phase: 35-app-explorer
    provides: 35-00 substrate (events.ts 7-name registry + module throw-stub); 35-01 module factory body + REST routes + repo helpers; 35-02 agent runner emit.* helpers (6 of 7 events fire from inside the runner)
  - phase: 22-streaming
    provides: JobBroadcaster ring-buffer pattern (ported to ExplorationsBroadcaster); wsEnvelopeSchema strict-validation shape; ?token=<bearer> WS auth pattern; bus side-channel `${type}.envelope` subscriber pattern for correlationId access
provides:
  - "GET /api/explorations/:id/events — WS route streaming a JSONL discriminated union of 6 frame variants (screen-discovered / transition / tool-call / stuck / finished / error). Per-run in-memory broadcaster keeps last 200 frames; reconnect replays history; 30s heartbeat keeps idle connections alive."
  - "server/explorations/ws-schemas.ts — wsExplorationFrameSchema z.discriminatedUnion('type', [...6 variants...]) with strict envelope (v:1, ts ISO datetime offset-aware, correlationId nullable per TRACE-06)."
  - "server/explorations/internal/broadcaster.ts — ExplorationsBroadcaster class. publish/subscribe/unsubscribe/cleanup/shutdown + RING_BUFFER_SIZE=200 + HEARTBEAT_INTERVAL_MS=30_000 + Zod safeParse on publish (malformed → warn-log + drop, NEVER throw)."
  - "server/explorations/internal/subscribers.ts — registerExplorationSubscribers wires 6 bus envelope listeners (screen.discovered/transition.recorded/tool.called/stuck/finished/failed) → broadcaster.publish with typed WS frame. Subscribes to side-channel `${type}.envelope` to receive envelope (not payload-only) so correlationId carries through."
  - "server/explorations/internal/events-ws.ts — registerExplorationEventsWs registers a @fastify/websocket route with ?token=<bearer> auth gate + run-existence SELECT + broadcaster subscribe/unsubscribe lifecycle."
  - "createExplorationsModule extended: exposes broadcaster + registerSubscribers; shutdown unsubscribes bus + broadcaster.shutdown() before pg-boss offWork."
  - "explorationsPlugin extended: registers @fastify/websocket (idempotent), registers events WS route after REST routes, calls module.registerSubscribers() at plugin-body time so unit tests see frames before app.ready()."
  - "30 new vitest tests (12 envelope + 9 broadcaster + 9 subscriber). 0 new tsc errors. 0 new dep-cruiser violations (baseline 5 preserved)."
affects: [35-04-cli, 35-05-web, 35-06-phase-close]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Discriminated-union WS frames over Phase 22's opaque-payload envelope — broadcaster consumers can narrow on frame.type and access typed `data` directly without re-parse. Trade-off: schema is per-event-type richer; envelope shape is per-frame-type stricter."
    - "Side-channel `${type}.envelope` subscription pattern (ported from server/streaming/internal/module.ts line 113) — bus.on('type', handler) delivers payload-only; envelope subscribers reach into bus.ee and listen on `${type}.envelope` for correlationId + occurredAt + actor + payload access. Required for TRACE-06 propagation."
    - "Plugin-body-time subscriber registration (NOT deferred to onReady) — explorations module's bus is per-module (constructed inside createExplorationsModule, no external dependency). Registering at plugin-body time means unit tests that emit.* before app.ready() still see frames in the broadcaster. Differs from streaming module which MUST defer because it subscribes to fastify.jobsModule.bus (decorated later in plugin chain)."
    - "Self-registered @fastify/websocket — explorations plugin sits BEFORE websocket-plugin (Phase 22) in server/index.ts, so cannot depend on it transitively. fastify-plugin de-dupes name-based registration, so re-registering @fastify/websocket inside explorations plugin is idempotent."
    - "Broadcaster heartbeat lives inside the broadcaster class (not the WS route) — keeps the WS handler thin; one interval per run regardless of subscriber count; uses .unref() so the heartbeat doesn't keep the process alive."
    - "Terminal-state cleanup heuristic — unsubscribe() only removes the run state when (subscribers === 0 AND terminal). Non-terminal disconnects preserve state so a reconnecting client can replay history. Explicit cleanup(runId) is available for force-cleanup scenarios."

key-files:
  created:
    - "server/explorations/ws-schemas.ts (~115 lines — discriminatedUnion + 6 variant exports)"
    - "server/explorations/internal/broadcaster.ts (~200 lines — ExplorationsBroadcaster class)"
    - "server/explorations/internal/subscribers.ts (~180 lines — 6-event registerExplorationSubscribers)"
    - "server/explorations/internal/events-ws.ts (~95 lines — WS route + auth + run-existence)"
  modified:
    - "server/explorations/__tests__/ws-broadcaster.spec.ts (replaced stub: 30 tests)"
    - "server/explorations/internal/module.ts (broadcaster property + registerSubscribers + shutdown extended)"
    - "server/explorations/plugin.ts (registers @fastify/websocket + WS route + registerSubscribers at plugin-body)"

key-decisions:
  - "exploration.started is NOT a WS frame variant — fires from REST POST handler before any WS subscriber would have connected. Clients learn the run exists via GET /api/explorations/:id (row INSERTed before 201 returns). Rationale documented in ws-schemas.ts module header."
  - "Subscribers consume envelope side-channel (NOT bus.on) to access correlationId. TypedBus.on delivers payload-only; the side-channel `${type}.envelope` is populated by persistEnvelope hook inside the module factory (mirrors Phase 22 streaming pattern at server/streaming/internal/module.ts:113)."
  - "Subscribers register at plugin-body time (NOT onReady) — explorations bus is per-module with no external dependencies. Onready-deferral would mean tests that emit before app.ready() see no frames."
  - "exploration.failed → 'error' frame (renamed for client clarity). Bus event is 'failed' (audit-domain term); WS frame is 'error' (client/UI-domain term). Frame.data.message format is `[${step}] ${reason}` so the agent runner step (lease/install/launch/agent/unknown) is visible to operators tailing the stream."
  - "Self-registered @fastify/websocket inside explorations plugin — explorations plugin sits BEFORE websocket-plugin (Phase 22) in server/index.ts at server/index.ts:136 vs 139. fastify-plugin de-dupes name-based registration so this is idempotent."
  - "TypedBus import switched to bus/index.js barrel (Rule 3 auto-fix). The no-direct-bus-emit-outside-events-ts dep-cruiser rule blocks bus/bus.ts deep-imports outside events.ts/spec/bus-internals/module.ts. The barrel re-exports TypedBus per Phase 15 Plan 15-04, so type-only consumers should use it."
  - "Authentication via ?token=<bearer> query param (deferred items section): inherited from Phase 22 streaming pattern. WebSocket upgrade cannot carry an Authorization header through browsers, so the bearer rides on the query string. Cookie-based path was considered but not added — Phase 22 also uses ?token, so we keep the surface uniform across both WS endpoints."

patterns-established:
  - "Per-run broadcaster pattern (Phase 22 generalized): publish/subscribe/unsubscribe/cleanup with ring buffer + heartbeat + history replay. Future per-run streaming surfaces (e.g. Phase 36 CommandPalette session updates) should follow this shape."
  - "Discriminated-union envelope shape: each variant declares its `data` payload type explicitly; the union allows clients to narrow and access typed data without per-variant re-parse. Differs from the Phase 22 streaming `payload: z.unknown()` shape (which is correct for the per-event-type-explosion job log channel)."

requirements-completed: [EXP-WS]

# Metrics
duration: 12 min
completed: 2026-05-16
---

# Phase 35 Plan 35-03: WS Event Stream Summary

**WebSocket route `GET /api/explorations/:id/events` streams live BFS progress to web UI + CLI via a 6-variant discriminated union (screen-discovered / transition / tool-call / stuck / finished / error), with per-run ring-buffer history replay (last 200), 30s heartbeat, and correlationId TRACE-06 propagation end-to-end from agent emit through bus envelope to WS frame.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-05-16T20:53:14Z
- **Completed:** 2026-05-16T21:05:37Z
- **Tasks:** 3 (3.1 schemas+broadcaster, 3.2 subscribers+ws+plugin, 3.3 spec)
- **Files created:** 4 (ws-schemas + broadcaster + subscribers + events-ws)
- **Files modified:** 3 (module, plugin, ws-broadcaster.spec)

## Accomplishments

- **EXP-WS closed:** WS endpoint operational. Subscribers reach into the per-module bus side-channel and translate 6 bus events into typed WS frames. Broadcaster delivers last-200 ring buffer on reconnect.
- **TRACE-06 correlationId carried end-to-end:** agent runner emits with correlationId from ALS → bus envelope stamps it → side-channel listener picks it up → WS frame `correlationId` field carries it through to the client. Proven by the "correlationId from ALS propagates into WS frame" subscriber test (asyncLocalStorage.run wraps the emit, frame.correlationId matches).
- **Strict envelope validation:** wsExplorationFrameSchema uses z.discriminatedUnion('type', [...6 variants...]). 12 schema tests cover each valid variant + 6 negative cases (unknown discriminator, missing correlationId, non-uuid correlationId, wrong v literal, missing data, finished accepts all 5 reason enum values).
- **Ring buffer cap verified exact:** publish 250 frames → late subscribe receives exactly 200 (first kept = screen-50, last = screen-249). Proves the FIFO shift+push semantics.
- **Heartbeat verified deterministically:** vi.useFakeTimers + vi.advanceTimersByTime(30_001) → ping count goes from 0 → 1 → 2 across two intervals. Heartbeat lives in the broadcaster (one interval per run) with .unref() so it doesn't keep the process alive.
- **Malformed-frame defense:** publish({type:'invalid', ...}) → Zod safeParse fails → drop + warn-log → no throw, no broken subscriber, no buffer corruption. Tested.
- **Multi-subscriber fan-out:** 3 sockets subscribe to the same run; 1 publish → all 3 receive the JSON-stringified frame.
- **Terminal cleanup heuristic:** unsubscribe after a `finished` frame removes the run state from the map (proven). Non-terminal disconnects preserve state for reconnect (also proven).
- **WS route auth + run-existence check:** ?token=<bearer> gate uses fastify.authService.validateKey (mirrors Phase 22). Unknown runId closes the socket with code 1003.
- **104/131 explorations tests green** (27 DB-gated skipped without TEST_DATABASE_URL). 30 NEW Plan 35-03 tests all pass.

## Task Commits

Each task was committed atomically:

1. **Task 3.1: ws-schemas.ts (discriminatedUnion) + broadcaster.ts (ring buffer + heartbeat)** — `5984c31` (feat)
2. **Task 3.2: subscribers.ts + events-ws.ts + module/plugin wiring** — `bc57fb3` (feat)
3. **Task 3.3: ws-broadcaster.spec.ts — 30 tests + Rule 3 dep-cruiser fix** — `fa963d3` (test)

**Plan metadata commit:** pending (added after this SUMMARY)

## Files Created/Modified

**Created (4):**
- `server/explorations/ws-schemas.ts` — discriminatedUnion + 6 variant types
- `server/explorations/internal/broadcaster.ts` — ExplorationsBroadcaster class with ring buffer + heartbeat + Zod safeParse
- `server/explorations/internal/subscribers.ts` — bus envelope-side-channel listeners → broadcaster.publish (6 of 7 events; started excluded)
- `server/explorations/internal/events-ws.ts` — WS route handler + auth + run-existence check

**Modified (3):**
- `server/explorations/__tests__/ws-broadcaster.spec.ts` — 30 tests (replaced 2-line stub from Plan 35-00 substrate)
- `server/explorations/internal/module.ts` — added `broadcaster` property + `registerSubscribers()` method + extended shutdown
- `server/explorations/plugin.ts` — registers @fastify/websocket + WS route + calls registerSubscribers at plugin-body time

## Decisions Made

See `key-decisions` in frontmatter. Highlights:

- **exploration.started excluded from WS frames** (plan's explicit ask in `<output>` block): fires REST-side before any WS subscriber could connect. Clients use GET /api/explorations/:id to learn the run exists. Rationale documented in ws-schemas.ts module header.
- **Side-channel subscription pattern over bus.on**: bus.on delivers payload-only; envelope-side-channel `${type}.envelope` carries correlationId + occurredAt + actor. Required for TRACE-06.
- **Plugin-body-time subscriber registration**: differs from streaming module (which MUST defer to onReady because it subscribes to fastify.jobsModule.bus — decorated later). Explorations bus is per-module, no external dependency.
- **failed→error frame name rename**: bus event audit-domain term ("failed"); WS frame client/UI-domain term ("error"). frame.data.message format `[${step}] ${reason}` surfaces the agent runner step.
- **Self-registered @fastify/websocket** (deferred items section): explorations plugin sits BEFORE websocket-plugin in server/index.ts (lines 136 vs 139). fastify-plugin de-dupes by name, so re-registering is idempotent.
- **?token=<bearer> auth** (deferred items section): WebSocket upgrade cannot carry Authorization header through browsers. Inherited from Phase 22 streaming pattern.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] dep-cruiser MOD-02 violation: no-direct-bus-emit-outside-events-ts on subscribers.ts → bus/bus.ts**
- **Found during:** Task 3.3 (running `npm run dep-check` after spec was green)
- **Issue:** Initial `subscribers.ts` imported `TypedBus` type from `../../bus/bus.js`. The `no-direct-bus-emit-outside-events-ts` rule blocks any non-events.ts/non-spec/non-bus-internals/non-module.ts file from importing `server/bus/bus.ts`. Subscribers.ts is none of those.
- **Fix:** Switched import to `../../bus/index.js` barrel — the barrel re-exports `TypedBus` per Phase 15 Plan 15-04. Type-only consumers should always use the barrel.
- **Files modified:** `server/explorations/internal/subscribers.ts`
- **Verification:** `npm run dep-check` returns to baseline 5 violations (artifacts→streaming/internal + api→pipelines/internal — all pre-existing, none in explorations).
- **Committed in:** `fa963d3` (Task 3.3 commit)

---

**Total deviations:** 1 auto-fixed (1 Rule 3 - Blocking)
**Impact on plan:** Essential to keep dep-cruiser baseline clean. No scope creep — corrections only. The plan's `subscribers.ts` pseudocode imported `TypedBus` from `../../bus/typed.js` (which doesn't exist) so the deep-vs-barrel choice was implicit; the barrel is the correct call per existing project conventions.

## Issues Encountered

- **Pre-existing 24 tsc errors elsewhere in repo** (server/azure, server/bus, server/pool, server/streaming, etc.) — out of Phase 35 scope. ZERO new errors introduced in server/explorations/**. Plan 35-01 + 35-02 SUMMARIES already noted these.
- **Pre-existing 5 dep-cruiser violations** (artifacts→streaming + api→pipelines) — out of Phase 35 scope, baseline preserved.
- **`npm run build` returns non-zero** due to the 24 pre-existing tsc errors. The plan's Task 3.2 verify ran `tsc --noEmit | grep server/explorations | wc -l | grep -q ^0$ && npm run build` — the first half passes (0 explorations errors), the second half fails on inherited baseline. Per Plan 35-01 SUMMARY this is expected (DEFERRED-15-A inherited).

## Authentication Gates

None — broadcaster + subscriber tests are pure (in-memory bus + stub sockets), no Postgres or external service auth required.

## Deferred Items

- **Cookie-based WS auth path** — Phase 22 streaming WS uses ?token query param; we kept the same surface for uniformity. Cookie-based auth (would need CORS-aware cookie semantics + CSRF guard for WebSocket-as-cross-origin) is deferred to a future security-hardening phase. Note added in key-decisions.
- **CLI consumer (Plan 35-04)** — `device-farm explore` CLI command will tail this WS endpoint via `?token=` and pretty-print to stdout. Out of scope for 35-03.
- **Web AtlasGraph consumer (Plan 35-05)** — Svelte component re-runs `layoutGraph` on every screen-discovered/transition frame. Out of scope for 35-03.
- **Backpressure / per-socket flush queue** — Phase 22 streaming uses a `FlushQueue` with 150ms batching for high-frequency log lines. Explorations frames are lower-frequency (one per BFS hop, ~1-5/sec peak), so straight `ws.send` per frame is acceptable. If frame rate grows we can port the FlushQueue pattern.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- **Plan 35-04 (CLI) unblocked:** CLI hits `POST /api/explorations` from 35-01 for the runId, then connects to the WS endpoint (`wss` in production, plaintext only over loopback dev) at `/api/explorations/:id/events?token=<bearer>` and pretty-prints the typed discriminated-union frames.
- **Plan 35-05 (web UI) unblocked:** Svelte client subscribes to the same WS endpoint, accumulates `screen-discovered` + `transition` frames, re-runs dagre layout on each.
- **Plan 35-06 (phase close) unblocked**.
- **EXP-WS requirement fully closed** — discriminated union with 6 variants + last-200 history replay + 30s heartbeat + correlationId TRACE-06 propagation.

## Self-Check: PASSED

Verified files exist on disk:
- `server/explorations/ws-schemas.ts` (4.0KB)
- `server/explorations/internal/broadcaster.ts` (6.5KB)
- `server/explorations/internal/subscribers.ts` (5.8KB)
- `server/explorations/internal/events-ws.ts` (3.3KB)
- `server/explorations/__tests__/ws-broadcaster.spec.ts` (12.7KB, 30 tests)
- `server/explorations/internal/module.ts` (extended — broadcaster + registerSubscribers)
- `server/explorations/plugin.ts` (extended — @fastify/websocket + WS route + registerSubscribers call)

Verified commits exist:
- `5984c31` Task 3.1 (ws-schemas + broadcaster)
- `bc57fb3` Task 3.2 (subscribers + events-ws + module/plugin wiring)
- `fa963d3` Task 3.3 (spec + Rule 3 dep-cruiser fix)

Verified test suites green:
- 104/131 server/explorations tests pass (27 DB-gated skipped — no TEST_DATABASE_URL); 30 NEW Plan 35-03 tests all pass
- 0 new tsc errors in server/explorations/**
- dep-check baseline 5 violations preserved (no new explorations entries after Rule 3 fix)
- `grep -c "discriminatedUnion" server/explorations/ws-schemas.ts` = 1

---
*Phase: 35-app-explorer*
*Completed: 2026-05-16*
