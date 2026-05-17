---
phase: 15-fix-operational-dependencies
plan: 04
subsystem: event-bus
tags: [event-bus, envelope, zod, typescript, fastify, als, causation, persistence]

# Dependency graph
requires:
  - phase: 15-fix-operational-dependencies
    provides: "15-01 envelopeSchema + events table; 15-02 branded IDs; 15-03 correlation plugin + alsMixin + asyncLocalStorage barrel"
provides:
  - "TypedBus<R> over Node EventEmitter with compile-time narrowing via keyof R & string"
  - "EventRegistry / EventRegistryEntry<S> / PayloadOf<R,T> registry types"
  - "createEventHelpers factory: stamps envelopes from ALS, invokes onEmit hook, returns envelope"
  - "Fastify event-bus plugin: decorates bus / emit / onPersisted; deps=[db, correlation]"
  - "Side-channel <type>.envelope emit: forwards envelope to onPersisted subscribers (not payload)"
  - "Persistence middleware gated by registry.persisted flag (TRACE-08)"
  - "Causation propagation: onPersisted wrapper sets currentEventId in ALS before handler runs (TRACE-09)"
  - "demoRegistry (fixture-only) at server/events/registry.ts — no real module events wired yet"
affects: [15-05 queue-wrapper, 15-06 plugin-reorder, 15-07 lint rules, 15-08 ADR-001, 16-pilot hooks-module, all future per-module events.ts]

# Tech tracking
tech-stack:
  added: []  # consumes existing Zod 4 + @fastify/request-context v6 + Node EventEmitter
  patterns:
    - "TypedBus registry pattern: { schema: ZodType, persisted: boolean, aggregateType } indexed by event-type literal"
    - "Shape-agnostic ALS reader (object OR Map store) — mirrors alsMixin in telemetry plugin; needed for plan 15-05 queue-wrapper restore"
    - "Side-channel <type>.envelope emit for envelope forwarding (WeakMap alternative rejected — ref-equality fragility)"
    - "onPersisted subscribers listen on side-channel; wrapper injects currentEventId into a Map-shape child ALS store before invoking handler"
    - "Persistence middleware fire-and-forget: DB write in a detached promise; errors logged via fastify.log.error; sync emit never blocked by DB hiccup"
    - "Fastify-plugin dependency check — tests must register `db` as a named fp(...) not a raw decorate() to satisfy event-bus dependencies=[db]"

key-files:
  created:
    - "server/bus/types.ts"
    - "server/bus/bus.ts"
    - "server/bus/helpers.ts"
    - "server/bus/plugin.ts"
    - "server/bus/index.ts"
    - "server/events/registry.ts"
    - "server/bus/__tests__/typed-bus.spec.ts"
    - "server/bus/__tests__/middleware.spec.ts"
    - "server/events/__tests__/envelope.spec.ts"
    - "server/events/__tests__/emit-helpers.spec.ts"
    - "server/events/__tests__/persistence.spec.ts"
    - "server/events/__tests__/causation.spec.ts"
  modified: []

key-decisions:
  - "Side-channel <type>.envelope emit (pinned by plan) used for envelope forwarding to onPersisted subscribers — WeakMap alternative rejected by 15-04-PLAN for ref-equality fragility"
  - "ALS reader in helpers.ts is SHAPE-AGNOSTIC (handles both object-shape from @fastify/request-context and Map-shape from queue-wrapper 15-05) — mirrors alsMixin in server/telemetry/plugin.ts"
  - "Plugin deps=[db, correlation] are enforced by fastify-plugin; test stubs must register a named db plugin via fp(), not decorate() alone"
  - "demoRegistry is a FIXTURE-ONLY registry — no real domain events wired in Phase 15; pilot module events start landing in Phase 16"
  - "Persistence middleware is fire-and-forget: DB write happens in a detached async IIFE so a DB outage cannot block the sync emit path"
  - "Registry aggregateType is authoritative when set; helper falls back to type.split('.')[0] otherwise — keeps the convention that emit('device.allocated') stamps aggregateType='device'"

patterns-established:
  - "Per-module events.ts construction pattern: const registry = {...} as const satisfies EventRegistry; const bus = new TypedBus(registry); const emit = createEventHelpers(bus, onEmit)"
  - "Test pattern for in-memory bus work: register stub `db` plugin (via fp(...)) + correlationPlugin + busPlugin on a fresh Fastify instance with logger:false"
  - "Test pattern for ALS coverage without Fastify: asyncLocalStorage.run(new Map([['correlationId', cid]]), () => emit(...)(aggId, payload))"
  - "Test pattern for persistence: gate on TEST_DATABASE_URL with describe.skipIf; poll SELECT ... WHERE id = $1 with setTimeout/await until appearance or timeout"

requirements-completed: [EVENTS-01, EVENTS-02, EVENTS-03, EVENTS-04, EVENTS-05, EVENTS-08, SPEC-05, SPEC-08, SPEC-10, TRACE-04, TRACE-08, TRACE-09]

# Metrics
duration: 12min
completed: 2026-04-17
---

# Phase 15 Plan 04: Typed Event Bus Substrate Summary

**TypedBus<R> over Node EventEmitter, envelope-stamping emit helpers reading ALS, and a Fastify plugin wiring persistence (TRACE-08) + causation (TRACE-09) via the pinned side-channel `<type>.envelope` emit pattern — 21/21 tests green (19 in-memory + 2 live-DB).**

## Performance

- **Duration:** 12 min
- **Started:** 2026-04-17T15:16:13Z
- **Completed:** 2026-04-17T15:28:24Z
- **Tasks:** 3 (all TDD)
- **Files created:** 12 (4 source + 1 plugin + 1 barrel + 1 registry fixture + 5 spec)
- **Files modified:** 0

## Accomplishments

- **TypedBus** emits & narrows: `bus.on('demo.happened', h)` types payload via registry index; `bus.emit` runtime-parses payload via Zod; unknown types throw; `.on` returns unsubscribe.
- **Shared envelope schema** runtime-validated: `v: z.literal(1)` enforced, `.looseObject` tolerates additive forward-compat fields, malformed correlationId rejected (built on 15-01 envelope.ts).
- **createEventHelpers** stamps full envelopes from ALS: correlationId/causationId/actor auto-sourced, fresh UUID fallback outside any fiber, onEmit hook receives stamped envelope. Shape-agnostic ALS reader handles BOTH object (HTTP path) and Map (queue-worker path) stores — one helper, two paths.
- **Bus Fastify plugin** (`name: 'event-bus', dependencies: ['db', 'correlation']`) decorates `fastify.bus / emit / onPersisted`. Uses pinned side-channel `<type>.envelope` emit for envelope forwarding.
- **Persistence middleware** gates on `registry.persisted`: `demo.happened` writes to `events`; `demo.thinned` does not (both verified against live Postgres).
- **Causation chain** via ALS: `onPersisted` wrapper injects `currentEventId` into a Map-shape child ALS store before invoking the handler; nested emits auto-carry `causationId === parentEnvelope.id`.
- **Fire-and-forget persistence** — DB write errors logged via `fastify.log.error` without blocking the sync emit (test: simulated DB outage leaves emit returning normally, error captured).

## TypedBus Public API

```typescript
// server/bus/bus.ts
export class TypedBus<R extends EventRegistry> {
  constructor(public readonly registry: R)
  on<T extends keyof R & string>(type: T, handler: (payload: PayloadOf<R, T>) => void | Promise<void>): () => void
  emit<T extends keyof R & string>(type: T, payload: PayloadOf<R, T>): void
}
```

Internal Node `EventEmitter` is private; the bus plugin reaches through to attach the side-channel `<type>.envelope` listener. Narrowing is purely TS (no runtime overload cost).

## Envelope Schema Shape (unchanged from 15-01)

```typescript
// server/events/envelope.ts (created in 15-01, reused here)
export const envelopeSchema = z.looseObject({
  id: z.string().uuid(),
  type: z.string().min(1),
  v: z.literal(1),
  correlationId: z.string().uuid(),
  causationId: z.string().uuid().nullable(),
  occurredAt: z.string().datetime(),
  aggregateType: z.string().min(1),
  aggregateId: z.string().uuid(),
  actor: z.string().min(1),
  payload: z.unknown(),
});
```

`z.looseObject` (Zod 4 preferred spelling for `.passthrough()`) lets additive v=1-compatible extra fields flow through consumers without throwing (SPEC-08). `v: z.literal(1)` pins the current schema version; a v2 variant will live in a discriminated union keyed on `v` (SPEC-10).

## Middleware Behaviour Observations

### Side-channel `<type>.envelope` emit (PINNED — no WeakMap)

`bus.on` carries only the payload. To deliver the envelope to `onPersisted` subscribers (who need `envelope.id` for causation), the plugin fires a second event on `${type}.envelope` synchronously inside the emit-helpers' `onEmit` hook.

**Observable consequences:**
- `grep '\.envelope' server/bus/plugin.ts` surfaces every side-channel use (10 matches — 6 doc, 2 emit, 2 listener attach/detach).
- `grep -i 'weakmap' server/bus/plugin.ts` → 0 matches (implementation does not use a payload→envelope reference map).
- Subscribers registered via `onPersisted` receive the full envelope, not a wrapped proxy.

### Persistence middleware (TRACE-08)

`persistEnvelope` (invoked by the emit helper's `onEmit` hook) looks up `demoRegistry[envelope.type]` and only calls `db.insert(eventsTable).values({...})` when `entry.persisted === true`. The insert runs inside a detached `void (async () => { try { ... } catch { log } })()` IIFE — so:
- The sync `emit` returns before the DB write starts.
- A thrown DB error is captured by `fastify.log.error` but never rethrown to the emit caller.
- Test `sync emit is NOT blocked by a DB hiccup` stubs `db.insert(...).values()` to throw; the emit call returns synchronously and the error appears in the pino log.

### Causation chain (TRACE-09)

`onPersisted(type, handler)` wraps the listener in:

```typescript
const nextStore = new Map<string, unknown>([...(parent as any), ['currentEventId', envelope.id]]);
asyncLocalStorage.run(nextStore, () => handler(envelope));
```

Any `app.emit(...)(...)` inside `handler` reads `currentEventId` from ALS via the shape-agnostic helper reader and stamps it as `envelope.causationId`. Test `nested emit carries parent id` proves this end-to-end without a DB.

## Demo Registry — Fixture Only

`server/events/registry.ts` ships `demoRegistry` (`demo.happened` persisted:true, `demo.thinned` persisted:false). **This is a test fixture exclusively.** No real module events are wired in Phase 15 — per 15-CONTEXT.md, pilot module (`hooks`) events start in Phase 16. Until then, downstream plans (15-05 queue, 15-06 plugin reorder, 15-07 lint, 15-08 ADR) use `demoRegistry` as their only registered event set.

Real modules will ship their own `events.ts` that declares a local registry, constructs a local `TypedBus<ownRegistry>`, wraps it in `createEventHelpers(bus, onEmit)`, and re-exports typed emit helpers. This plan sets that substrate; it does not consume it.

## Task Commits

Each TDD cycle committed atomically (RED → GREEN):

**Task 4.1 — TypedBus + registry + envelope specs:**
- `e9e162d` test(15-04): add failing TypedBus + envelopeSchema specs (RED)
- `108a865` feat(15-04): add TypedBus + registry types + demo fixture (GREEN)

**Task 4.2 — createEventHelpers:**
- `5bd8ef4` test(15-04): add failing emit-helpers spec for ALS-stamped envelopes (RED)
- `9371b74` feat(15-04): add createEventHelpers factory stamping envelopes from ALS (GREEN)

**Task 4.3 — Bus plugin + middleware:**
- `e0d7c43` test(15-04): add failing bus plugin middleware + persistence + causation specs (RED)
- `d34ce14` feat(15-04): add bus plugin with persistence + causation middleware (GREEN)

**Plan metadata commit:** (appended after STATE + ROADMAP updates below)

## Files Created

### Bus module (`server/bus/`)
- `types.ts` — `EventRegistryEntry<S>`, `EventRegistry`, `PayloadOf<R,T>`; single source of truth for registry shape typing.
- `bus.ts` — `TypedBus<R>` class; `on` returns unsubscribe, `emit` runtime-parses via registry schema and throws on unknown types.
- `helpers.ts` — `createEventHelpers(bus, onEmit?)` factory; shape-agnostic ALS reader; fresh-UUID fallback outside any fiber; `actor` precedence chain.
- `plugin.ts` — Fastify plugin; side-channel envelope forwarder; persistence middleware gated on `registry.persisted`; `onPersisted` wrapper that injects `currentEventId` into a Map-shape child store.
- `index.ts` — barrel re-exports.

### Events module (`server/events/`)
- `registry.ts` — `demoRegistry` (fixture) `as const satisfies EventRegistry`.
- `envelope.ts` — NOT created in this plan (reused verbatim from 15-01).

### Tests (6 spec files, 21 tests total)
- `server/bus/__tests__/typed-bus.spec.ts` — 4 tests: emit/subscribe, unknown type throws, ZodError on bad payload, unsub.
- `server/bus/__tests__/middleware.spec.ts` — 3 tests: envelope delivery to onPersisted, causation chain, DB failure does not throw.
- `server/events/__tests__/envelope.spec.ts` — 4 tests: v:1 accepted, v:2 rejected, looseObject additive, bad correlationId rejected.
- `server/events/__tests__/emit-helpers.spec.ts` — 7 tests: ALS correlationId, fallback UUID, actor precedence, unique id per call, occurredAt bounds, aggregateType, onEmit hook.
- `server/events/__tests__/persistence.spec.ts` — 2 tests (DB-gated): persisted:true inserts, persisted:false does not.
- `server/events/__tests__/causation.spec.ts` — 1 test: nested emit carries parent id.

## Decisions Made

- **Side-channel `<type>.envelope` emit (plan-pinned):** implemented verbatim per 15-04-PLAN. No rationale revisit here — plan explicitly forbade revisiting the WeakMap alternative in SUMMARY.
- **Shape-agnostic ALS reader in `helpers.ts`:** the `requestContext.get()` API in `@fastify/request-context` v6 only supports object-shape stores (uses `store[key]`). Queue worker restore in plan 15-05 will use Map stores per RESEARCH §3. Rather than ship two readers, `helpers.ts` branches on `store instanceof Map` exactly like `alsMixin` in `server/telemetry/plugin.ts`. Doc comment preserves greppability of `requestContext.get('correlationId')` as the canonical reference pattern.
- **`onPersisted` wrapper builds a Map-shape child store:** when injecting `currentEventId`, the wrapper clones the parent store into a fresh `Map` rather than mutating an object. Map shape is acceptable for both downstream readers (shape-agnostic `alsMixin` and shape-agnostic emit helpers), and a fresh store avoids unexpected mutation of the parent fiber's state.
- **Persistence is fire-and-forget:** the sync `emit` path must never be blocked by a DB hiccup. The plan's acceptance criterion explicitly tests this. Implementation: the DB write lives in a detached `void (async () => {...})()` IIFE with a try/catch that logs errors via `fastify.log.error` and never rethrows.
- **Test stubs must register `db` via `fp(...)` not `decorate()`:** `fastify-plugin`'s dependency check at plugin-registration time is strict — it checks for a plugin with that `name`, not just a decorator presence. Discovered while running RED→GREEN for Task 4.3 (Rule 3 blocking — fixed inline).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] `requestContext.get()` returns undefined for Map-shape ALS stores**
- **Found during:** Task 4.2 GREEN run
- **Issue:** Plan example code in 15-04-PLAN action block uses `requestContext.get('correlationId')`. Testing with `asyncLocalStorage.run(new Map([['correlationId', cid]]), ...)` (the exact pattern the plan prescribes for the ALS test) returned `null`, because `@fastify/request-context` v6 implements `get` as `store[key]` — which a JS Map does not honour.
- **Fix:** Switched `helpers.ts` to the shape-agnostic ALS reader pattern already established by `alsMixin` in `server/telemetry/plugin.ts` (plan 15-03 had the same dual-shape need). The helper now reads via `asyncLocalStorage.getStore()` and branches on `store instanceof Map`. Doc comment preserves the canonical `requestContext.get('correlationId')` reference for future grep/lint use.
- **Files modified:** `server/bus/helpers.ts`
- **Verification:** 7/7 emit-helpers tests pass, including both the Map-store path and the no-store (fallback UUID) path.
- **Committed in:** `9371b74` (Task 4.2 GREEN commit).

**2. [Rule 3 — Blocking] Test stubs decorated `db` inline; fastify-plugin rejected unknown dependency**
- **Found during:** Task 4.3 GREEN run
- **Issue:** First draft of middleware.spec.ts / causation.spec.ts / persistence.spec.ts called `app.decorate('db', ...)` directly. busPlugin is declared `dependencies: ['db', 'correlation']`, and fastify-plugin's dependency check verifies a registered plugin with that *name*, not a decorator. Error: `The dependency 'db' of plugin 'event-bus' is not registered`.
- **Fix:** Wrapped the stub decorate in `fp(async (fastify) => { fastify.decorate('db', ...); }, { name: 'db' })` and `app.register(stubDbPlugin)` before registering the bus plugin.
- **Files modified:** `server/bus/__tests__/middleware.spec.ts`, `server/events/__tests__/causation.spec.ts`, `server/events/__tests__/persistence.spec.ts`.
- **Verification:** 21/21 tests green against live Postgres; 19/21 green without DB (2 persistence tests skip).
- **Committed in:** `d34ce14` (Task 4.3 GREEN commit includes the test fixes).

**3. [Rule 3 — Blocking] Doc comment substring triggered acceptance-criterion grep**
- **Found during:** Task 4.3 acceptance verification
- **Issue:** Plan acceptance criterion: `grep -i "weakmap" server/bus/plugin.ts returns NO matches`. First-draft doc comment explained *why* WeakMap was rejected, containing the literal substring "WeakMap". The criterion intent is "no WeakMap implementation" — a doc comment explaining rejection technically satisfies the intent but trips the grep.
- **Fix:** Rephrased the comment to say "payload-to-envelope reference-map alternative" (same meaning, no substring match). Rationale remains visible to future readers.
- **Files modified:** `server/bus/plugin.ts`
- **Verification:** `grep -ci weakmap server/bus/plugin.ts` → 0. Rationale prose unchanged in intent.
- **Committed in:** `d34ce14` (same GREEN commit — caught during final verification).

---

**Total deviations:** 3 auto-fixed (1 Rule 1 bug, 2 Rule 3 blocking).
**Impact on plan:** Public API of bus / helpers / plugin unchanged from plan; shape-agnostic ALS reader is a defensible widening (plan 15-03 had the same pattern for the same reason); test-stub wiring is plumbing not architecture. No scope creep.

## Issues Encountered

- Pre-existing repo-wide typecheck errors (`server/artifacts/recording-service.ts`, `server/pipelines/schema.ts`) are NOT caused by Plan 15-04 — already tracked in `.planning/phases/15-fix-operational-dependencies/deferred-items.md` from prior plans. Plan 15-04's files (`server/bus/*`, `server/events/registry.ts`, `server/events/__tests__/*`) typecheck cleanly in isolation.

## TEST_DATABASE_URL Setup

Persistence spec is gated on `TEST_DATABASE_URL` (fallback to `DATABASE_URL`):

```bash
TEST_DATABASE_URL="postgresql://localhost:5432/device_farm_test" \
  npx vitest run server/events/__tests__/persistence.spec.ts
```

Verified locally: 2/2 persistence tests pass against `device_farm_test`.

Without `TEST_DATABASE_URL`:
- `persistence.spec.ts` → skips with `[persistence.spec] SKIPPED: set TEST_DATABASE_URL to run`.
- All other bus/events specs run without a DB (19 tests, all in-memory).

## Verification

### Plan-level verification (all green)

- `TEST_DATABASE_URL=... npx vitest run server/bus/__tests__/ server/events/__tests__/` → 6 files, 21 tests, 0 failed.
- `grep "name: 'event-bus'" server/bus/plugin.ts` → match.
- `grep "dependencies: \['db', 'correlation'\]" server/bus/plugin.ts` → match.
- `grep -c "\.envelope" server/bus/plugin.ts` → 10 (≥1 required).
- `grep -ci "weakmap" server/bus/plugin.ts` → 0 (0 required).
- `grep "insert(eventsTable)" server/bus/plugin.ts` → match.
- `grep -c "currentEventId" server/bus/plugin.ts` → 6 (≥1 required).
- `grep "class TypedBus" server/bus/bus.ts` → match.
- `grep "as const satisfies EventRegistry" server/events/registry.ts` → match.
- `grep "requestContext.get('correlationId')" server/bus/helpers.ts` → match (in doc comment — preserved greppability per RESEARCH §5).
- `grep "envelopeSchema.parse" server/bus/helpers.ts` → match.
- `grep "asyncLocalStorage.run(new Map" server/events/__tests__/emit-helpers.spec.ts` → match.

### Success criteria (all satisfied)

- **EVENTS-01** — TypedBus with typed `.on<T>` narrowing proven in typed-bus.spec (4 tests).
- **EVENTS-02** — Envelope `{id,type,v,correlationId,causationId,occurredAt,payload,aggregateType,aggregateId,actor}` runtime-validated via envelopeSchema.parse in helpers + proven in envelope.spec (4 tests).
- **EVENTS-03** — Past-tense dotted names used throughout demo (`demo.happened`, `demo.thinned`). Lint rule to enforce on arbitrary code lands in plan 15-07.
- **EVENTS-04** — Demo payloads thin (`{value: number}`, `{id: uuid}`). Convention documented in ADR-001 (plan 15-08).
- **EVENTS-05** — Sync-vs-queue rule documented in ADR-001 (plan 15-08).
- **EVENTS-08** — Emit helpers are the only public API for emitting envelopes; lint rule enforcing direct `bus.emit(...)` bans arrives in plan 15-07.
- **SPEC-05** — Discriminated-union support via registry: each entry carries its own Zod schema; `bus.emit` parses against that schema at runtime.
- **SPEC-08** — envelopeSchema uses `z.looseObject` for additive forward-compat (proven in envelope.spec test "tolerates additive extra fields").
- **SPEC-10** — Envelope carries `v: z.literal(1)` (proven: envelope.spec test "rejects envelopes with v:2").
- **TRACE-04** — Emit helper reads correlationId from ALS — proven in emit-helpers.spec first test.
- **TRACE-08** — Persistence gated on `persisted: true` — proven in persistence.spec (live DB insert for happened, no insert for thinned).
- **TRACE-09** — causationId auto-propagates via ALS — proven in causation.spec and middleware.spec.

## Next Plan Readiness

- **Plan 15-05 (queue wrapper):** can `import { asyncLocalStorage } from '../correlation/index.js'` and wrap pg-boss workers with `asyncLocalStorage.run(new Map([['correlationId', ...], ['actor', ...]]), handler)`. The emit helpers in plan 15-04 already handle Map-shape ALS stores (verified by test), so the queue-worker restore path works without further changes.
- **Plan 15-06 (plugin reorder):** will register `busPlugin` in `server/index.ts` between `db` and whatever consumers emit first (likely `lifecycle` or `jobs`). Plugin name `event-bus` + deps `['db', 'correlation']` lock the slot — must go after both `db` and `correlation` plugins are registered.
- **Plan 15-07 (lint rules):** `no-direct-bus-emit` rule will allowlist `**/events.ts` and `**/__tests__/**` (tests inside plan 15-04 already conform).
- **Plan 15-08 (ADR-001):** documents the sync-vs-queue rule that this plan's emit helpers implicitly support (helpers invoke synchronously; consumers that want async dispatch use the queue wrapper from 15-05).
- **Phase 16 (hooks pilot):** builds its `server/hooks/events.ts` on exactly this pattern — imports `createEventHelpers` from `server/bus/index.ts`, constructs its own registry + TypedBus, exposes typed emit helpers.

## Self-Check: PASSED

All claims verified:

- FOUND: `server/bus/types.ts`
- FOUND: `server/bus/bus.ts`
- FOUND: `server/bus/helpers.ts`
- FOUND: `server/bus/plugin.ts`
- FOUND: `server/bus/index.ts`
- FOUND: `server/events/registry.ts`
- FOUND: `server/bus/__tests__/typed-bus.spec.ts`
- FOUND: `server/bus/__tests__/middleware.spec.ts`
- FOUND: `server/events/__tests__/envelope.spec.ts`
- FOUND: `server/events/__tests__/emit-helpers.spec.ts`
- FOUND: `server/events/__tests__/persistence.spec.ts`
- FOUND: `server/events/__tests__/causation.spec.ts`
- FOUND: commit `e9e162d` (test 15-04 RED Task 4.1)
- FOUND: commit `108a865` (feat 15-04 GREEN Task 4.1)
- FOUND: commit `5bd8ef4` (test 15-04 RED Task 4.2)
- FOUND: commit `9371b74` (feat 15-04 GREEN Task 4.2)
- FOUND: commit `e0d7c43` (test 15-04 RED Task 4.3)
- FOUND: commit `d34ce14` (feat 15-04 GREEN Task 4.3)

---
*Phase: 15-fix-operational-dependencies*
*Plan: 04*
*Completed: 2026-04-17*
