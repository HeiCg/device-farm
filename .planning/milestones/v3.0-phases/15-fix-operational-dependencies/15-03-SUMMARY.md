---
phase: 15-fix-operational-dependencies
plan: 03
subsystem: infra
tags: [fastify, als, correlation-id, pino, request-context, telemetry, tracing]

requires:
  - phase: 15-00
    provides: "@fastify/request-context v6.2.1 installed (Wave 0 dependency bootstrap)"

provides:
  - "Correlation plugin: registers @fastify/request-context + onRequest hook to read/generate/echo X-Correlation-Id with header validation (length <128 + printable ASCII only)"
  - "Module augmentation extending @fastify/request-context RequestContextData with correlationId/currentEventId/actor (typed string|null across the codebase)"
  - "Telemetry plugin: ALS-aware pino mixin (alsMixin) that reads correlationId/causationId/actor from either object-shaped (request-context) OR Map-shaped (future queue wrapper) stores"
  - "Barrel exports: server/correlation/index.ts re-exports plugin + requestContext + asyncLocalStorage; server/telemetry/index.ts re-exports plugin + alsMixin"
  - "12 passing spec tests (6 correlation, 6 telemetry) covering header round-trip, ALS deep-service propagation, and pino mixin integration"

affects: [15-04 event-bus, 15-05 queue-wrapper, 15-06 plugin-reorder, 16-hooks-pilot, all subsequent phases emitting events or enqueuing work]

tech-stack:
  added: []  # nothing new — consumes @fastify/request-context v6.2.1 installed in 15-00
  patterns:
    - "ALS via @fastify/request-context (Fastify-idiomatic wrapper over AsyncLocalStorage)"
    - "Pino mixin reading ALS on every log invocation (no caller threading)"
    - "Store shape agnostic mixin (handles both Map and object via runtime instanceof check)"
    - "Header sanitation: length cap + printable-ASCII regex before accepting caller-supplied correlationId"

key-files:
  created:
    - "server/correlation/plugin.ts"
    - "server/correlation/index.ts"
    - "server/correlation/__tests__/plugin.spec.ts"
    - "server/correlation/__tests__/als.spec.ts"
    - "server/telemetry/plugin.ts"
    - "server/telemetry/index.ts"
    - "server/telemetry/__tests__/pino-mixin.spec.ts"
  modified: []

key-decisions:
  - "Pino mixin handles BOTH object and Map stores — request-context v6 writes objects, but plan 15-05 queue wrapper will restore with Map (per research §3). Single mixin for both paths."
  - "Header sanitation rejects overlong (>=128) AND non-printable-ASCII values, replacing with crypto.randomUUID() to prevent log-line pollution / header injection."
  - "telemetry plugin dependencies array is ['correlation'] — telemetry must register AFTER correlation so the ALS fiber is open before any code paths emit logs."
  - "server/index.ts is NOT edited in this plan. Wiring alsMixin onto the Fastify logger literal (Fastify({ logger: { mixin: alsMixin } })) is deferred to plan 15-06 (plugin reorder) per the 15-03-PLAN directive."

patterns-established:
  - "Plugin pattern: fp(async (fastify) => {...}, { name, dependencies: [...] }) with explicit dependencies array — matches existing config/pool/db plugin style."
  - "Module barrel (index.ts) re-exports plugin AND any raw primitives (asyncLocalStorage, alsMixin) consumers need to import from a single path."
  - "Deep-service ALS lookup uses top-level `import { requestContext } from '@fastify/request-context'` — zero argument threading."

requirements-completed: [TRACE-01, TRACE-02, TRACE-03, MOD-07]

duration: 6min
completed: 2026-04-17
---

# Phase 15 Plan 03: Correlation + Telemetry Plugins Summary

**ALS-backed X-Correlation-Id plugin (@fastify/request-context v6) with header sanitation, plus an ALS-aware pino mixin (alsMixin) that stamps correlationId on every log line — 12 specs green, server/index.ts wiring deferred to plan 15-06.**

## Performance

- **Duration:** 6 min
- **Started:** 2026-04-17T14:59:35Z
- **Completed:** 2026-04-17T15:05:06Z
- **Tasks:** 2 (both TDD)
- **Files created:** 7 (2 plugin + 2 barrel + 3 spec)
- **Files modified:** 0 (server/index.ts deliberately untouched)

## Accomplishments

- `X-Correlation-Id` HTTP round-trip proven: missing → UUID generated; incoming → reused verbatim; overlong/non-printable → replaced with UUID
- Deep-service ALS propagation proven: `requestContext.get('correlationId')` returns the request's id from a module-scope helper with NO parameter threading
- Pino `alsMixin` stamps `correlationId` on every log line inside a request — route log AND child-logger (`req.log.child({ module: 'jobs' })`) both carry the id
- Module augmentation of `RequestContextData` ensures `correlationId` / `currentEventId` / `actor` are typed across every downstream consumer
- Plugin dependency arrays audited (`correlation: []`, `telemetry: ['correlation']`) — downstream plan 15-06 can slot them into `server/index.ts` without reordering work

## Task Commits

Each task followed TDD (RED → GREEN, no REFACTOR needed — code was already minimal):

1. **Task 3.1 RED: Correlation plugin tests** - `7a5a309` (test)
2. **Task 3.1 GREEN: Correlation plugin impl** - `c922dba` (feat)
3. **Task 3.2 RED: Telemetry mixin tests** - `1be6649` (test)
4. **Task 3.2 GREEN: Telemetry plugin + alsMixin impl** - `cc3ba39` (feat)

**Plan metadata commit:** (appended after state updates below)

## Files Created/Modified

### Correlation module
- `server/correlation/plugin.ts` (57 lines) — fastify-plugin wrapper: registers `@fastify/request-context` at `onRequest`, own `onRequest` hook reads/sanitises `X-Correlation-Id` or generates UUID, stores in ALS via `req.requestContext.set`, echoes via `reply.header`
- `server/correlation/index.ts` (9 lines) — barrel re-exporting `correlationPlugin` + `requestContext` + `asyncLocalStorage`
- `server/correlation/__tests__/plugin.spec.ts` (72 lines) — 4 tests: UUID gen, header passthrough, overlong rejection, non-printable rejection
- `server/correlation/__tests__/als.spec.ts` (55 lines) — 2 tests: `req.requestContext.get` + top-level `requestContext.get` in deep helper

### Telemetry module
- `server/telemetry/plugin.ts` (62 lines) — exports `alsMixin` (shape-agnostic ALS reader) + default plugin decorating `fastify.telemetry` with `noop` seam for future metrics
- `server/telemetry/index.ts` (8 lines) — barrel re-exporting plugin + `alsMixin`
- `server/telemetry/__tests__/pino-mixin.spec.ts` (103 lines) — 6 tests: no-store empty, Map store, object store, partial store, pino+Fastify integration with child logger, outside-request log has no correlationId

### Ancillary
- `.planning/phases/15-fix-operational-dependencies/deferred-items.md` — logs 2 pre-existing `tsc --noEmit` errors (recording-service `errors` field, pipelines/schema argument count) out of scope for 15-03

## Decisions Made

- **Shape-agnostic mixin.** Research §9 shows `store.get?.('correlationId')` which assumes `Map`. But `@fastify/request-context` v6 source (`node_modules/@fastify/request-context/index.js` line 39) writes a plain object (`{ ...defaultStoreValues }`) into ALS. To avoid a two-mixin split, `alsMixin` branches at runtime: `store instanceof Map ? store.get(key) : store[key]`. This single mixin works for BOTH the Fastify HTTP request path (plan 15-03) and the pg-boss worker restore path (plan 15-05, where the research pattern uses `new Map(...)`).
- **Sanitation rejects both overlong AND non-printable.** Plan specified `length < 128`; the 15-03-PLAN action block ALSO specified printable-ASCII regex. Both enforced; non-printable test green proves no NUL/control-char leakage to logs or response headers.
- **No server/index.ts edit.** Per 15-03-PLAN final note: wiring `Fastify({ logger: { mixin: alsMixin } })` and registering the two plugins in `server/index.ts` is plan 15-06's responsibility. This plan intentionally ships the plugins as consumable but unregistered.
- **`telemetry.noop` decorator is a seam.** Not a real metric sink today. Phase 19+ plugs real metrics in. Declaring `FastifyInstance.telemetry: { noop: () => void }` now prevents TypeScript churn when metrics land.

## Deviations from Plan

### Fixed expectation in Task 3.2 RED test

**1. [Rule 1 - Bug] Test assertion mis-specified: `actor: 'anonymous'` must be emitted when store has it**
- **Found during:** Task 3.2 GREEN
- **Issue:** Test "returns correlationId when ALS store is a plain object" asserted `{ correlationId: 'req-cid' }` but the implementation (correctly) also emits `actor: 'anonymous'` because the mixin emits `actor` whenever it is truthy. The plan body says "Mixin adds causationId and actor when ALS has them; omits them when absent." `'anonymous'` is truthy → it is emitted.
- **Fix:** Updated the assertion to `{ correlationId: 'req-cid', actor: 'anonymous' }` and added an inline comment explaining the truthy rule. The production code (`alsMixin` in `plugin.ts`) was NOT changed — it was already correct.
- **Files modified:** `server/telemetry/__tests__/pino-mixin.spec.ts`
- **Verification:** `npx vitest run server/telemetry/__tests__/pino-mixin.spec.ts` — all 6 tests green.
- **Committed in:** `cc3ba39` (GREEN commit includes the test fix)

### Out-of-scope issues logged (not fixed)

Pre-existing `tsc --noEmit` errors unrelated to 15-03 logged in `deferred-items.md`:
- `server/artifacts/recording-service.ts:169,177` — `RecordingResult.errors` missing
- `server/pipelines/schema.ts:17` — function argument count mismatch

These predate 15-03 and the scope boundary rule says to log and move on. My files (`server/correlation/*`, `server/telemetry/*`) typecheck cleanly.

---

**Total deviations:** 1 auto-fixed (test expectation correction, no production code change)
**Impact on plan:** Minimal. Production behavior unchanged from plan; only an incorrect test expectation was corrected. No scope creep.

## Issues Encountered

- Research §9 and §2 imply the ALS store is a `Map` (uses `store.get?.(...)`), but source inspection of `@fastify/request-context` v6.2.1 (`node_modules/@fastify/request-context/index.js:39`) showed it actually writes a plain object. Handled by writing a shape-agnostic `alsMixin` that branches on `store instanceof Map`. Plan 15-05 (pg-boss worker wrapper) uses `new Map(...)` per research §3, so both shapes must be supported in one function.
- Repo-wide `tsc --noEmit` surfaced pre-existing errors in recording-service.ts and pipelines/schema.ts. These are NOT caused by 15-03 and are out of scope — logged to `deferred-items.md` for a future cleanup plan.

## Verification

### Plan-level verification (all green)

- `npx vitest run server/correlation/__tests__/ server/telemetry/__tests__/` → 3 files, 12 tests, 0 failed
- `grep "export default fp" server/correlation/plugin.ts` → match
- `grep "export default fp" server/telemetry/plugin.ts` → match
- `grep "name: 'correlation'" server/correlation/plugin.ts` → match
- `grep "name: 'telemetry'" server/telemetry/plugin.ts` → match
- `grep "declare module '@fastify/request-context'" server/correlation/plugin.ts` → match
- `grep "asyncLocalStorage.getStore" server/telemetry/plugin.ts` → match

### Acceptance criteria (all met)

**Task 3.1 (correlation):**
- [x] Registers `fastifyRequestContext` with `hook: 'onRequest'`
- [x] Calls `reply.header('x-correlation-id', correlationId)`
- [x] Wrapped in `fp(...)` with `{ name: 'correlation', dependencies: [] }`
- [x] Header-length + printable-ASCII sanitation
- [x] `index.ts` re-exports `asyncLocalStorage`
- [x] `declare module '@fastify/request-context'` present
- [x] 4 plugin.spec tests green (plan required ≥3)
- [x] 2 als.spec tests green (plan required ≥2)

**Task 3.2 (telemetry):**
- [x] `alsMixin` named export
- [x] `dependencies: ['correlation']`
- [x] Returns `{}` when no ALS store
- [x] `index.ts` re-exports both `telemetryPlugin` and `alsMixin`
- [x] `asyncLocalStorage.getStore` used
- [x] 6 mixin-spec tests green (plan required ≥4)

### Success criteria (all satisfied)

- [x] TRACE-01 — X-Correlation-Id read/generated/echoed (plugin.spec 4 cases)
- [x] TRACE-02 — `requestContext.get('correlationId')` works deep (als.spec deep helper)
- [x] TRACE-03 — Pino mixin injects correlationId into log lines inside a request (pino-mixin.spec integration test inspects JSON log records)
- [x] MOD-07 — `logger.child({ module })` carries correlationId automatically (pino-mixin.spec asserts both `module: 'jobs'` AND `correlationId` on child log record)

## Dependency Output for Downstream Plans

- **`@fastify/request-context` version resolved:** `6.2.1` (installed by plan 15-00)
- **Pino mixin output shape (from spec):**
  ```json
  { "level": 30, "time": ..., "msg": "...", "correlationId": "cid-mixin-test", "module": "jobs", "actor": "anonymous" }
  ```
- **Plugin dependency arrays committed:**
  - `correlation`: `[]`
  - `telemetry`: `['correlation']`
- **server/index.ts status:** NOT yet updated. Wiring happens in plan 15-06.

## Next Plan Readiness

- **Plan 15-04 (event bus + envelope schema):** can import `requestContext` from `@fastify/request-context` (or via `server/correlation/index.ts` barrel) to stamp `correlationId` / `currentEventId` on envelopes.
- **Plan 15-05 (queue wrapper):** can import `asyncLocalStorage` from `server/correlation/index.ts` and follow research §3 pattern — `asyncLocalStorage.run(new Map([...]), handler)`. The `alsMixin` will correctly read the restored Map store in worker fibers.
- **Plan 15-06 (plugin reorder):** adds `server/index.ts` edits — `Fastify({ logger: { mixin: alsMixin } })` and `app.register(correlationPlugin)` + `app.register(telemetryPlugin)` in the right slot.

---

## Self-Check: PASSED

Verified every file and commit claimed above exists:

- `server/correlation/plugin.ts` — FOUND
- `server/correlation/index.ts` — FOUND
- `server/correlation/__tests__/plugin.spec.ts` — FOUND
- `server/correlation/__tests__/als.spec.ts` — FOUND
- `server/telemetry/plugin.ts` — FOUND
- `server/telemetry/index.ts` — FOUND
- `server/telemetry/__tests__/pino-mixin.spec.ts` — FOUND
- `.planning/phases/15-fix-operational-dependencies/deferred-items.md` — FOUND
- commit `7a5a309` (test 15-03 RED correlation) — FOUND
- commit `c922dba` (feat 15-03 GREEN correlation) — FOUND
- commit `1be6649` (test 15-03 RED telemetry) — FOUND
- commit `cc3ba39` (feat 15-03 GREEN telemetry) — FOUND

---
*Phase: 15-fix-operational-dependencies*
*Plan: 03*
*Completed: 2026-04-17*
