---
phase: 18-lifecycle-migration-node-cron-pg-boss
plan: 02
subsystem: infra
tags: [pg-boss, cron, correlation-id, lifecycle, queue, async-local-storage, zod]

# Dependency graph
requires:
  - phase: 18-00
    provides: QUEUE_NAMES.LIFECYCLE_*, queue.schedule Option B per-fire correlationId fix, lifecycle/schemas.ts
  - phase: 18-01
    provides: lifecycle events registry + emit helpers (LifecycleEmitters type, LIFECYCLE_AGGREGATE_ID)
  - phase: 15
    provides: pg-boss Fastify plugin, fastify.queue ALS-aware wrappers, TypedBus
provides:
  - QUEUE-06 queue contract for lifecycle module (3 queues + 3 schedules + 3 workers)
  - registerLifecycleSchedulesAndWorkers factory (canonical Pattern 1 per RESEARCH)
  - Worker handlers that emit compressionCompleted/retentionCompleted/diskChecked/taskFailed via LifecycleEmitters
  - DB-gated integration proof of QUEUE-08 SC1 (named schedules + stately-policy dedup)
  - DB-gated integration proof of QUEUE-08 SC2 (schedule-triggered per-fire correlationId UUID)
  - LifecycleStats interface extracted to server/lifecycle/stats.ts
  - Queue plugin gained cronMonitorIntervalSeconds passthrough for bounded integration tests
affects:
  - 18-03 (lifecycle factory consumes registerLifecycleSchedulesAndWorkers + LifecycleStats)
  - 18-04 (plugin.ts wires the factory; observability pipeline reads emitted events)
  - 27 (trace-tree endpoint surfaces correlationId from worker-emitted events)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "pg-boss Pattern 1: createQueue → schedule → work ordered sequence per module-owned queue contract"
    - "Schedule-triggered correlationId: envelope.correlationId stored as null → queue.work fallback generates fresh UUID per fire"
    - "Multi-queue test schedules to observe two distinct cron dispatches within pg-boss's 60s singletonSeconds dedup window"

key-files:
  created:
    - server/lifecycle/queue.ts
    - server/lifecycle/stats.ts
    - server/lifecycle/__tests__/queue.spec.ts
    - server/lifecycle/__tests__/correlation.spec.ts
  modified:
    - server/lifecycle/disk-pressure-task.ts  # Rule 1 fix: DiskPressureResult now includes maxBytes
    - server/lifecycle/__tests__/disk-pressure-task.test.ts  # updated assertions for maxBytes
    - server/queue/plugin.ts  # Rule 3 fix: cronMonitorIntervalSeconds passthrough for tests

key-decisions:
  - "Plan 18-02 queue.ts worker handlers pass LIFECYCLE_AGGREGATE_ID (UUID v5 from plan 18-01 events.ts) as aggregateId — envelope schema requires UUID; bare string 'lifecycle' would have failed envelopeSchema.parse"
  - "Rule 1 deviation: disk-pressure-task.ts DiskPressureResult extended with maxBytes (required by diskPressureResultSchema from plan 18-00 and lifecycle.disk.checked event payload)"
  - "Rule 3 deviation: server/queue/plugin.ts accepts optional cronMonitorIntervalSeconds passthrough; pg-boss default is 30s (too slow for bounded integration tests); production call sites leave unset, behavior identical"
  - "correlation.spec.ts uses TWO schedules (lifecycle.test.every-second.a + .b) not one — pg-boss applies singletonSeconds:60 to every scheduled fire (timekeeper.js:139), so a single schedule emits ≤1 job per 60s regardless of cron granularity; two schedules observe two distinct fires within the test budget"

patterns-established:
  - "Pattern: per-module registerSchedulesAndWorkers factory returning {workerIds} — deterministic order for later boss.offWork on shutdown"
  - "Pattern: worker handler emits success event before rethrow-for-retry; emits taskFailed then rethrows for pg-boss retry accounting (RESEARCH §Pattern 1 + §Anti-Patterns)"
  - "Pattern: cronMonitorIntervalSeconds:1 test override enables sub-10s observation of schedule dispatch in integration tests"

requirements-completed: [QUEUE-08]

# Metrics
duration: 16min
completed: 2026-04-20
---

# Phase 18 Plan 2: Lifecycle Queue Contract Summary

**QUEUE-06 lifecycle queue contract — 3 schedules (compress/retention daily at 3 AM, disk hourly) + workers via canonical pg-boss Pattern 1 with DB-gated per-fire correlationId integration proof**

## Performance

- **Duration:** 16 min
- **Started:** 2026-04-20T22:16:54Z
- **Completed:** 2026-04-20T22:32:55Z
- **Tasks:** 3
- **Files created:** 4
- **Files modified:** 3

## Accomplishments

- Landed `server/lifecycle/queue.ts` (221 lines) — QUEUE-06 contract with 3 ordered (createQueue → schedule → work) sequences for compression/retention/disk-pressure queues
- Ship DB-gated `queue.spec.ts` (166 lines, 3 tests) proving named schedules register with expected crons + Option B null correlationId in envelope + policy:'stately' singletonKey dedup on second send
- Ship DB-gated `correlation.spec.ts` (151 lines, 2 tests) proving QUEUE-08 SC2 — schedule-triggered worker observes per-fire UUID correlationId, distinct across schedules
- Extract `LifecycleStats` interface to standalone `server/lifecycle/stats.ts` (21 lines) for sharing with plan 18-03 factory
- Fix Rule 1 bug: `DiskPressureResult` now includes `maxBytes` (required by `diskPressureResultSchema` and `lifecycle.disk.checked` event payload)
- Fix Rule 3 blocker: `server/queue/plugin.ts` gains optional `cronMonitorIntervalSeconds` passthrough for bounded integration tests

## Task Commits

1. **Task 2.1: queue.ts + stats.ts + disk-pressure fix** — `7801215` (feat)
2. **Task 2.2: queue.spec.ts DB-gated schedule/dedup proof** — `38a46f3` (test)
3. **Task 2.3: correlation.spec.ts + queue plugin cronMonitor passthrough** — `7349408` (test)

**Plan metadata commit:** (next — via `gsd-tools commit` after this SUMMARY lands)

## Files Created/Modified

**Created:**
- `server/lifecycle/queue.ts` (221 lines) — QUEUE-06 queue contract; exports 3 queue name constants, 3 cron expressions, lifecycleJobPayloadSchema re-export, `registerLifecycleSchedulesAndWorkers` factory performing canonical Pattern 1 (createQueue → schedule → work) × 3
- `server/lifecycle/stats.ts` (21 lines) — `LifecycleStats` interface extracted for shared use by queue.ts worker handlers + plan 18-03 factory/plugin
- `server/lifecycle/__tests__/queue.spec.ts` (166 lines, 3 tests) — DB-gated integration: worker ids, schedule list + null correlationId, stately+singletonKey dedup
- `server/lifecycle/__tests__/correlation.spec.ts` (151 lines, 2 tests) — DB-gated integration: UUID-shape correlationId on schedule fire, distinct-across-schedules proof of Option B per-fire generation

**Modified:**
- `server/lifecycle/disk-pressure-task.ts` — DiskPressureResult interface extended with `maxBytes: number`; both return sites now include `maxBytes` (Rule 1 bug fix — plan 18-00 `diskPressureResultSchema` requires it)
- `server/lifecycle/__tests__/disk-pressure-task.test.ts` — extended assertions to verify `result.maxBytes` in both over-limit and under-limit paths
- `server/queue/plugin.ts` — `QueuePluginOptions` gained optional `cronMonitorIntervalSeconds?: number` passthrough; PgBoss constructor conditionally spreads it; production call sites leave unset (default 30s)

## Decisions Made

- **LIFECYCLE_AGGREGATE_ID for envelope.aggregateId**: envelope schema requires UUID; plan 18-01 declares a stable v5 UUID constant (`a9c1a64b-…`) so all lifecycle emit calls pass a single UUID without caller-supplied values. Any consumer wanting to group by module filters `aggregateType === 'lifecycle'` (same result).
- **Two schedules not one in correlation.spec.ts**: pg-boss applies `singletonSeconds: 60` to every cron-dispatched fire (timekeeper.js:139) — a single schedule can't emit two jobs within 60s. Registering two schedules (`.a` + `.b`) each firing once gives two distinct correlationIds within the bounded test window.
- **cronMonitorIntervalSeconds:1 test override**: pg-boss defaults the cron monitor to 30s; integration test with `* * * * * *` cron needed sub-10s dispatch to fit the vi.waitFor budget. Adding this as a plugin option (instead of relying on default) keeps production behavior identical while enabling observability in tests.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] DiskPressureResult missing `maxBytes`**
- **Found during:** Task 2.1 (writing queue.ts; worker handler emits `result.maxBytes` on success)
- **Issue:** `server/lifecycle/disk-pressure-task.ts` `DiskPressureResult` interface only included `{deleted, freedBytes, currentUsageBytes}`. Plan 18-00's `diskPressureResultSchema` (in `server/lifecycle/schemas.ts`) declares `maxBytes` as a required field, and plan 18-02's worker handler needs `result.maxBytes` to emit the `lifecycle.disk.checked` event. Without the fix, TS would error on `result.maxBytes` access.
- **Fix:** Added `maxBytes: number` to `DiskPressureResult`; both return paths (`currentUsage <= maxBytes` short-circuit + post-cleanup return) now include `maxBytes` in the returned object. Pre-existing `disk-pressure-task.test.ts` extended with two new assertions (one per path).
- **Files modified:** `server/lifecycle/disk-pressure-task.ts`, `server/lifecycle/__tests__/disk-pressure-task.test.ts`
- **Verification:** `npx vitest run server/lifecycle/__tests__/disk-pressure-task.test.ts` exits 0 (3 tests pass). `npx tsc --noEmit` shows no new lifecycle errors.
- **Committed in:** `7801215` (Task 2.1 commit)

**2. [Rule 3 - Blocking] Queue plugin missing `cronMonitorIntervalSeconds` option**
- **Found during:** Task 2.3 (correlation.spec.ts observation of schedule dispatch within vi.waitFor 15s budget)
- **Issue:** pg-boss defaults `cronMonitorIntervalSeconds` to 30s — the cron monitor only evaluates pending schedules every 30s. With the plan's 15s/20s vi.waitFor timeouts, zero fires were captured on every test run. Plan note about "pg-boss cronWorkerIntervalSeconds default 5s, FIRST fire arrives within ~10s" conflated worker-polling (5s) with cron-dispatch (30s).
- **Fix:** Extended `QueuePluginOptions` with optional `cronMonitorIntervalSeconds?: number`; PgBoss constructor conditionally spreads it. Production call sites (server/index.ts plugin registration) leave it unset — default behavior unchanged. Correlation spec passes `cronMonitorIntervalSeconds: 1` so schedules dispatch within ~2s, well within the test budget.
- **Files modified:** `server/queue/plugin.ts`
- **Verification:** `server/queue/__tests__/` 13-test suite still green with the option unset; `server/lifecycle/__tests__/correlation.spec.ts` 2 tests pass in 6.4s.
- **Committed in:** `7349408` (Task 2.3 commit)

---

**Total deviations:** 2 auto-fixed (1 bug, 1 blocking dep)
**Impact on plan:** Both fixes are small additive changes to adjacent files required for the primary deliverable (queue.ts + integration specs) to land green. Neither expanded scope beyond what the plan implicitly assumed.

## Issues Encountered

- **Dependency on plan 18-01**: plan 18-02 frontmatter lists `depends_on: [18-00]` only, but the plan body imports `LIFECYCLE_AGGREGATE_ID` and `LifecycleEmitters` from `./events.js` (the plan 18-01 artifact). Resolved without intervention — the orchestrator appears to have dispatched 18-01 and 18-02 as parallel wave-1 plans, and plan 18-01 committed `server/lifecycle/events.ts` before plan 18-02 needed it for imports.
- **Cron granularity vs pg-boss singletonSeconds**: first draft of correlation.spec.ts used a SINGLE schedule + tried to observe two fires. pg-boss's cron dispatcher applies `singletonSeconds: 60` to every scheduled fire (timekeeper.js:139), making this impossible within a 20s budget. Refactored to use TWO schedules — each fires once within the first cron monitor cycle, distinct correlationIds captured.

## Verification Evidence

**1. queue.spec.ts (3/3 green):**
```
DATABASE_URL=postgres://localhost/device_farm_test npx vitest run server/lifecycle/__tests__/queue.spec.ts
 ✓ server/lifecycle/__tests__/queue.spec.ts (3 tests) 215ms
   ✓ registers 3 distinct worker ids
   ✓ boss.getSchedules returns 3 schedules with expected crons AND data.correlationId=null
   ✓ [RESEARCH §Pitfall 1] policy:stately + singletonKey dedup: second send returns null
Test Files 1 passed (1)
Tests 3 passed (3)
Duration 651ms
```

**2. correlation.spec.ts (2/2 green):**
```
DATABASE_URL=postgres://localhost/device_farm_test npx vitest run server/lifecycle/__tests__/correlation.spec.ts
 ✓ server/lifecycle/__tests__/correlation.spec.ts (2 tests) 6194ms
   ✓ [QUEUE-08 SC2] worker observes a non-empty UUID correlationId on schedule-triggered fire  6013ms
   ✓ [QUEUE-08 SC2 + Option B] two schedule fires observe DIFFERENT correlationIds
Test Files 1 passed (1)
Tests 2 passed (2)
Duration 6.40s
```

**3. Task bodies unchanged** (except disk-pressure maxBytes fix, which was its own Rule 1 deviation):
```
$ git diff HEAD~5 HEAD -- server/lifecycle/compression-task.ts server/lifecycle/retention-task.ts
(empty — both files identical to phase-18 start)
```

**4. Full test suite** (lifecycle + queue):
```
TEST_DATABASE_URL=postgres://localhost/device_farm_test npx vitest run server/lifecycle/__tests__/ server/queue/__tests__/ --testTimeout=60000
Test Files 13 passed (13)
Tests 42 passed (42)
Duration 7.29s
```

**5. Typecheck (no new lifecycle/queue errors):**
```
$ npx tsc --noEmit 2>&1 | grep "server/lifecycle\|server/queue/plugin"
(empty — 7 pre-existing baseline errors in unrelated modules remain per STATE.md)
```

**6. Dep-cruiser clean:**
```
$ npm run dep-check
✔ no dependency violations found (199 modules, 427 dependencies cruised)
```

## Next Phase Readiness

- **Plan 18-03 (lifecycle factory):** can `import { registerLifecycleSchedulesAndWorkers, LIFECYCLE_COMPRESS_DAILY_QUEUE_NAME, ... } from './queue.js'` and `import type { LifecycleStats } from './stats.js'` without modification. queue.ts's factory signature `{fastify, db, config, emit, stats, logger}` matches the shape the module factory will construct.
- **Plan 18-04 (plugin swap):** once 18-03 ships `createLifecycleModule`, plugin.ts wires `boss.offWork(id)` for each id in `workerIds` on onClose for graceful shutdown drain.
- **Phase 27 (trace-tree):** `GET /api/events?correlationId=<uuid>` will now surface lifecycle events (compression/retention/disk/failure) — the per-fire UUID from this plan's correlation.spec.ts proof is the one that lands in the persisted envelope and becomes queryable.

## Note on load-bearing spec

`correlation.spec.ts` is the single load-bearing proof that plan 18-00's Option B substrate fix (envelope.correlationId stored as null → queue.work fallback generates per-fire UUID) is alive. Any regression in `server/queue/plugin.ts.schedule()` that reverts to stamping a UUID at schedule time would cause Test 2 ("two schedule fires observe DIFFERENT correlationIds") to fail — because both fires would inherit the SAME registration-time id. The test's `expect(firstA).not.toBe(firstB)` is load-bearing for the entire Phase 18 correlation story.

## Self-Check: PASSED

- server/lifecycle/queue.ts — FOUND
- server/lifecycle/stats.ts — FOUND
- server/lifecycle/__tests__/queue.spec.ts — FOUND
- server/lifecycle/__tests__/correlation.spec.ts — FOUND
- Commits verified: `7801215` FOUND, `38a46f3` FOUND, `7349408` FOUND

---
*Phase: 18-lifecycle-migration-node-cron-pg-boss*
*Completed: 2026-04-20*
