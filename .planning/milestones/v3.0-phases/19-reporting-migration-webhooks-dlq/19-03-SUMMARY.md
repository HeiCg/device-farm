---
phase: 19-reporting-migration-webhooks-dlq
plan: 03
subsystem: reporting
tags: [pg-boss, dead-letter-queue, event-bus, fastify-plugin, mod-06, typed-bus, factory-pattern]

# Dependency graph
requires:
  - phase: 19-reporting-migration-webhooks-dlq
    provides: 19-00 substrate (queue names, Zod payload/DLQ schemas, dep-cruiser rule, stub internal/module.ts) + 19-01 reporting events.ts registry + REPORTING_AGGREGATE_ID + jobs events.ts (job.completed) + jobsModule bridgehead + 19-02 WebhookService.deliverOnce (single-attempt contract, raw re-throw)
provides:
  - server/reporting/queue.ts — QUEUE-06 registerWebhookDeliveryWorkers factory (DLQ-first ordering, main+DLQ worker handlers, raw re-throw from main, terminal emit from DLQ)
  - server/reporting/internal/module.ts — MOD-06 createReportingModule factory replacing the 4-line stub
  - server/reporting/plugin.ts — thin Fastify wrapper (70 lines) replacing old reporting-plugin.ts
  - Phase 19 SC3 substrate — reporting module subscribes to job.completed via fastify.onPersisted in-factory
affects: [19-04 (DB-gated proofs — queue.spec + correlation.spec + terminal-event.spec), 19-05 (GET /api/queue/dlq route), 23 (Jobs Module Keystone will extend jobs/events.ts saga + gain an internal/module.ts that closes the dep-check allowlist gap), 27 (persistEnvelope consolidation across hooks/lifecycle/reporting — three sample points now)]

# Tech tracking
tech-stack:
  added: []  # no new dependencies — substrate (pg-boss, TypedBus, fastify-plugin, pino) all pre-existing from Phases 15-18
  patterns:
    - "MOD-06 factory-per-module pattern extended to 3rd module (hooks -> lifecycle -> reporting)"
    - "persistEnvelope 10-line duplication count: 3 (consolidation threshold now clear; Phase 27+ refactor target)"
    - "DLQ-before-MAIN createQueue ordering (FK constraint, RESEARCH §Pitfall 2)"
    - "policy:'standard' (NOT stately) for webhook queues — webhooks are not idempotent by enqueue, RESEARCH §Pitfall 9"

key-files:
  created:
    - server/reporting/queue.ts
    - server/reporting/__tests__/module.spec.ts
  modified:
    - server/reporting/internal/module.ts  # overwrote 4-line stub with 264-line real factory
    - server/reporting/plugin.ts  # new file (71 lines); replaces deleted reporting-plugin.ts
    - server/index.ts  # 1-line import path update
  deleted:
    - server/reporting/reporting-plugin.ts  # 35-line imperative v2.0-style plugin, replaced by thin factory-wirer

key-decisions:
  - "MAIN queue policy:'standard' (not stately): webhooks are NOT idempotent by enqueue — two job.completed bus events = two separate POST attempts; RESEARCH §Pitfall 9"
  - "DLQ worker does NOT re-throw on emit failure (explicit swallow + log): DLQ has retryLimit:0 so re-throw would be terminal anyway, but explicit non-throw is safer per RESEARCH §Pattern 2"
  - "enqueueWebhookDelivery imperative facade exists alongside bus-driven subscriber: covers consumers with URL+payload ready (e.g. future /api/webhooks ping endpoint migration) without forcing a bus round-trip"
  - "onPersisted type cast to 'job.completed' is load-bearing: the Phase 15 fastify.onPersisted decorator's type signature narrows to keyof demoRegistry & string; Phase 27+ will consolidate bus surface typing across module registries"
  - "Plugin name preserved as 'reporting' (not renamed to 'reporting-plugin' for ADR-002 alignment) — keeps downstream dependency strings ['reporting'] resolving without cascading 12-plugin dep-string edits"

patterns-established:
  - "DLQ worker pattern: parse payload -> emit failedRetryExhausted (EVENTS-07 terminal) -> log.warn -> DO NOT throw. Mirrors RESEARCH §Pattern 2 and sets the blueprint for any future module with a DLQ (e.g. Phase 23 jobs retry)."
  - "Worker factory return shape {workerIds: string[]} with deterministic order [main, dlq] — shutdown iteration is by-index so order is load-bearing"
  - "Module factory subscribes to cross-module bus events inline (reporting -> jobs/events.ts job.completed) WITHOUT importing the foreign module's factory: loose coupling preserved via onPersisted string-keyed subscription"

requirements-completed: [EVENTS-07, QUEUE-05]

# Metrics
duration: 9min
completed: 2026-04-21
---

# Phase 19 Plan 03: Reporting Factory + Queue + Plugin Rewire Summary

**createReportingModule factory (MOD-06) shipped with DLQ-aware pg-boss queue contract, job.completed bus subscriber, and thin plugin rewire — replaces imperative reporting-plugin.ts with three-layer factory pattern mirroring Phase 18 lifecycle.**

## Performance

- **Duration:** ~9 min
- **Started:** 2026-04-21T06:03:30Z
- **Completed:** 2026-04-21T06:12:07Z
- **Tasks:** 4
- **Files modified:** 5 (2 created, 2 modified, 1 deleted)

## Accomplishments

- QUEUE-06 queue contract: `registerWebhookDeliveryWorkers` creates DLQ queue FIRST (FK ordering), then MAIN queue with `retryLimit:5 + retryBackoff:true + deadLetter`, registers MAIN worker (deliverOnce + emit delivered/failed + re-throw) and DLQ worker (emit failedRetryExhausted terminal + log + DO NOT throw). 208 lines.
- MOD-06 `createReportingModule` factory replaces the 4-line stub with 264 lines mirroring Phase 18 lifecycle: WebhookService + FlakyDetector back-compat, per-module `TypedBus<ReportingRegistry>`, `persistEnvelope` 10-line middleware, `makeReportingEmitters` with persistence onEmit hook, `registerWorkersAndSubscribers()` wires workers + `fastify.onPersisted('job.completed')` subscriber, `enqueueWebhookDelivery()` imperative facade, idempotent `shutdown()` (unsubscribe bus + offWork each worker).
- Thin `server/reporting/plugin.ts` (71 lines) replaces `server/reporting/reporting-plugin.ts` (35 imperative lines, deleted). Extended dependencies `['config', 'db']` → `['config', 'db', 'queue', 'event-bus']`. Plugin NAME stays `'reporting'` for 12-plugin dep-string back-compat.
- `server/index.ts:11` import path updated from `./reporting/reporting-plugin.js` to `./reporting/plugin.js`.
- `module.spec.ts` (210 lines) — 10 no-DB tests across 4 describe blocks prove factory shape, DLQ-before-MAIN ordering, retry-policy shape, 2-worker registration, job.completed subscription, enqueue shape, webhook.scheduled side-event emit, and shutdown idempotency. Runtime 8ms.

## Task Commits

Each task was committed atomically:

1. **Task 3.1: Write server/reporting/queue.ts** — `21ec400` (feat)
2. **Task 3.2: Write server/reporting/internal/module.ts (real MOD-06 factory)** — `f2ec272` (feat)
3. **Task 3.3: Write plugin.ts + delete reporting-plugin.ts + update server/index.ts import** — `26d09bd` (refactor)
4. **Task 3.4: Write module.spec.ts (no-DB factory shape + shutdown idempotency)** — `940bf20` (test)

_Plan metadata commit (SUMMARY + STATE + ROADMAP + REQUIREMENTS) follows this section._

## Files Created/Modified

**Created:**
- `server/reporting/queue.ts` (208 lines) — QUEUE-06 queue contract. Exports: `WEBHOOK_DELIVER_QUEUE_NAME`, `WEBHOOK_DELIVER_DLQ_QUEUE_NAME`, `webhookDeliveryPayloadSchema` (re-export), `WebhookDeliveryPayload` (type), `RegisterWebhookDeliveryWorkersDeps`, `WebhookDeliveryRegistration`, `registerWebhookDeliveryWorkers`.
- `server/reporting/__tests__/module.spec.ts` (210 lines) — Mock-based no-DB unit spec. 10 tests in 4 describe blocks.

**Modified:**
- `server/reporting/internal/module.ts` (stub 4 lines → real factory 264 lines, ~260-line insertion). Exports: `CreateReportingModuleDeps`, `ReportingModule`, `createReportingModule`.
- `server/reporting/plugin.ts` (NEW — 71 lines; replaces deleted `reporting-plugin.ts`). Thin factory-wirer: name `'reporting'`, dependencies `['config', 'db', 'queue', 'event-bus']`, decorates `webhookService` + `flakyDetector` + `reportingModule`, calls `registerWorkersAndSubscribers()`, wires `onClose → shutdown()`.
- `server/index.ts` (1-line edit): `import reportingPlugin from './reporting/reporting-plugin.js';` → `import reportingPlugin from './reporting/plugin.js';`

**Deleted:**
- `server/reporting/reporting-plugin.ts` (was 35 lines, imperative v2.0-style plugin). Zero remaining imports in server/*.ts (verified via `grep -rn "reporting-plugin" server/ --include="*.ts"` returning only one docblock comment in the new plugin.ts).

## Decisions Made

See frontmatter `key-decisions`. Summary:
1. `policy:'standard'` (not `stately`) for both MAIN and DLQ queues — webhooks not enqueue-idempotent (RESEARCH §Pitfall 9).
2. DLQ worker swallows emit errors with log — non-throw safer than terminal-throw even though DLQ has `retryLimit:0` (RESEARCH §Pattern 2).
3. `enqueueWebhookDelivery` imperative facade exists alongside bus-driven subscriber for consumers with URL+payload ready without bus round-trip.
4. `fastify.onPersisted` cast to `'job.completed'` subscriber type — Phase 15 bus plugin's permissive type signature (`keyof demoRegistry & string`) pre-dates per-module registries; Phase 27+ consolidation target.
5. Plugin name preserved as `'reporting'` (not renamed for ADR-002 alignment) to avoid cascading 12-plugin dep-string edits.

## Deviations from Plan

None - plan executed exactly as written. The plan's code sketches were copied verbatim with only minor cosmetic TypeScript refinements in the test file to satisfy `tsc --noEmit` on the `vi.fn()` spy tuple types (typed argument placeholders so `.mock.calls[i][j]` preserves positions; documented below as typecheck hygiene).

### TypeScript hygiene (not a deviation; anticipated by plan)

- `server/reporting/__tests__/module.spec.ts`: `vi.fn(async () => {})` spies produce `Mock<() => Promise<void>>` whose `.mock.calls` is `Array<[]>`, so `calls[i][0]` triggers `TS2493: Tuple type '[]' of length '0'`. Fix: type the spy arguments explicitly (`vi.fn(async (_name: string, _opts?: unknown) => {})`) so `.mock.calls[i][j]` preserves positional types. No behavioral change; tests pass identically either way.
- `module.bus.on(SCHEDULED, (p) => captured.push(p))` returns `number` (from `Array.push`) which mismatches the handler's `void | Promise<void>` return type. Fix: wrap in block body `{ captured.push(p); }`. No behavioral change.

## Issues Encountered

**Pre-existing dep-check violation (out-of-scope):** `npm run dep-check` reports one pre-existing violation `server/jobs/plugin.ts → server/bus/bus.ts` that was introduced by plan 19-01's minimal jobs module bridgehead (jobs plugin constructs `new TypedBus(jobsRegistry)` directly, which the `.dependency-cruiser.cjs` allowlist doesn't cover because the allowlist pattern `server/[^/]+/internal/module\.ts$` matches only MOD-06 factory files — jobs has no `internal/module.ts` in Phase 19 scope per EVENTS-10 minimality). Reproduced on HEAD before plan 19-03 work. Documented in `deferred-items.md`. Phase 23 Jobs Module Keystone fixes via MOD-06 jobs factory that moves `new TypedBus(...)` into `server/jobs/internal/module.ts` where the allowlist already covers it.

**No new violations introduced by plan 19-03:** After 19-03 commits, `npm run dep-check` reports the same single pre-existing violation. Reporting dep-graph is clean: real content in `server/reporting/internal/module.ts` now exercises the `no-deep-imports-into-reporting-internal` rule against the fixture without new errors.

## Verification

### Grep-level acceptance (from plan's automated verify)

```
=== queue.ts ===
registerWebhookDeliveryWorkers:  3 (interface + factory + logger info)
retryLimit: 5:                   1  (main queue)
retryLimit: 0:                   1  (DLQ queue)
retryBackoff: true:              1  (main queue)
deadLetter: WEBHOOK_DELIVER_DLQ_QUEUE_NAME: 1
policy: 'standard':              2  (both queues; no 'stately' occurrences)
emit.failedRetryExhausted:       1  (DLQ worker)
throw err:                       1  (main worker only; DLQ worker explicitly swallows)

=== internal/module.ts ===
createReportingModule:           1
registerWebhookDeliveryWorkers:  3
onPersisted:                     10
'job.completed':                 8
enqueueWebhookDelivery:          2
makePersistEnvelope:             2
stopped = true:                  1
unsubscribeJobCompleted:         5

=== plugin.ts ===
name: 'reporting':               1
dependencies: ['config', 'db', 'queue', 'event-bus']: 1
fastify.decorate('reportingModule': 1

=== server/index.ts ===
from './reporting/plugin.js':                1
from './reporting/reporting-plugin.js':      0

=== stale references ===
grep -rn "reporting-plugin" server/ --include="*.ts": 1 match (docblock comment in new plugin.ts only)
```

### Test runtime (no DB required)

```
$ npx vitest run server/reporting/__tests__/module.spec.ts
 ✓ server/reporting/__tests__/module.spec.ts (10 tests) 8ms
 Test Files  1 passed (1)
      Tests  10 passed (10)
```

### Regression — reporting + jobs suites

```
$ npx vitest run server/reporting server/jobs
 Test Files  9 passed (9)
      Tests  108 passed (108)
   Duration  804ms
```

### Typecheck

```
$ npx tsc --noEmit 2>&1 | grep -E "server/reporting|server/index\.ts"
(no output — zero new errors on plan 19-03 files)
```

Pre-existing `tsc` errors in Phase 17/18 out-of-scope files (`bus/plugin.ts`, `events/__tests__/emit-helpers.spec.ts`, `hooks/__tests__/events.spec.ts`, `recording-service.ts`, `pipelines/schema.ts`) documented in STATE.md Blockers/Concerns — unchanged by this plan.

### Dep-check

```
$ npm run dep-check
  error no-direct-bus-emit-outside-events-ts: server/jobs/plugin.ts → server/bus/bus.ts
x 1 dependency violations (1 errors, 0 warnings). 208 modules, 479 dependencies cruised.
```

Single violation is pre-existing (from plan 19-01), documented in `deferred-items.md`, Phase 23 scope to fix. No new violations from plan 19-03.

## Deferred / Split-off Work

- **Plan 19-04** (depends_on: 19-03, DB-gated): ships `queue.spec.ts` (5× 500 → DLQ without crash, SC1), `correlation.spec.ts` (single correlationId across 6 attempts + DLQ re-insert, SC4), `terminal-event.spec.ts` (EVENTS-07 terminal event persisted), plus plugin-order.spec extension.
- **Plan 19-05** (depends_on: 19-03, parallel with 19-04): ships `GET /api/queue/dlq` route, reporting `index.ts` barrel, `MODULE.md`, and openapi regen.
- **Phase 23 (Jobs Module Keystone):** closes the pre-existing dep-check violation via `server/jobs/internal/module.ts` that moves `new TypedBus(jobsRegistry)` into the allowlisted MOD-06 factory path.
- **Phase 27+:** `persistEnvelope` 10-line duplication consolidation across `hooks/internal/module.ts` + `lifecycle/internal/module.ts` + `reporting/internal/module.ts` (three sample points now — consolidation trigger reached per RESEARCH Open Question #1).

## Next Phase Readiness

- Phase 19 Wave 2 bridgehead complete: reporting module runs production-ready with pg-boss DLQ pipeline + bus subscription to job.completed.
- Plans 19-04 + 19-05 unblocked — both declare `depends_on: [19-03]` and can run in parallel.
- ROADMAP Phase 19 SC3 (reporting subscribes to job.completed) now a literal truth: onPersisted subscriber wired at `registerWorkersAndSubscribers` time, executes on every `job.completed` bus event with `config.webhooks.url` gating.
- EVENTS-07 code path ready: `webhook.failed.retryExhausted` event is emitted from DLQ worker handler with full `payloadSnapshot` per EVENTS-04. Plan 19-04's `terminal-event.spec.ts` will prove actual persistence into `events` table.
- Nyquist delta / regression proofs carry forward to plan 19-06 per Phase 19 CONTEXT.

## Self-Check: PASSED

All claims verified:
- FOUND: `server/reporting/queue.ts` (208 lines, created task 3.1, commit 21ec400)
- FOUND: `server/reporting/internal/module.ts` (264 lines, overwritten task 3.2, commit f2ec272)
- FOUND: `server/reporting/plugin.ts` (71 lines, created task 3.3, commit 26d09bd)
- FOUND: `server/reporting/__tests__/module.spec.ts` (210 lines, created task 3.4, commit 940bf20)
- NOT FOUND: `server/reporting/reporting-plugin.ts` (deleted task 3.3, confirmed via `test ! -f`)
- FOUND: commit 21ec400 in git log
- FOUND: commit f2ec272 in git log
- FOUND: commit 26d09bd in git log
- FOUND: commit 940bf20 in git log
- FOUND: `server/index.ts` contains `from './reporting/plugin.js'` (1 match)
- NOT FOUND: `server/index.ts` contains `from './reporting/reporting-plugin.js'` (0 matches)

---
*Phase: 19-reporting-migration-webhooks-dlq*
*Plan: 03*
*Completed: 2026-04-21*
