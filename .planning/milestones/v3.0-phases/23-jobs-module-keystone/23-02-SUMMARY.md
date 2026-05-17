---
phase: 23-jobs-module-keystone
plan: 02
subsystem: jobs
tags: [pg-boss, queue, idempotency, singletonKey, stately, vitest]

# Dependency graph
requires:
  - phase: 23-jobs-module-keystone
    provides: "Plan 23-00 substrate — JOB_EXECUTE_QUEUE_NAME alias, jobs internal/module.ts stub, dep-cruiser 7th rule"
  - phase: 21-artifacts-module
    provides: "Phase 21-03 reference shape — registerArtifactsWorker (stately+singletonKey:recordingId), DB-gated queue.spec harness"
provides:
  - "registerJobsExecuteQueue(boss) — boss.createQueue('job.execute', {policy:'stately', retryLimit:0})"
  - "registerJobsExecuteWorker(boss, handler) — boss.work delegate with batch unpack; returns workerId"
  - "JobExecutePayload interface (jobId + platform); thin payload — worker re-fetches full row"
  - "queue.spec.ts mock-based unit test (5 it-blocks) proving stately + retryLimit:0 contract at source level"
  - "idempotency.spec.ts DB-gated proof (3 it-blocks) — id1=UUID + id2=null on duplicate singletonKey send (Pitfall 3)"
affects:
  - "23-04 (createJobsModule.registerWorkerAndSubscribers calls registerJobsExecuteQueue + registerJobsExecuteWorker with executor.run handler)"
  - "23-04 (idempotency.spec EXTENDS this spec with SC2 strict assertion: exactly 1 device.state.changed{booting→idle} per jobId)"
  - "23-05 (drain route imports JOB_EXECUTE_QUEUE_NAME for boss.updateQueue({paused:true}))"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "QUEUE-03 / Pitfall 2 — policy:'stately' is REQUIRED for singletonKey dedup; default 'standard' silently ignores it"
    - "QUEUE-04 — retryLimit:0 on device-touching queues (job.execute boots emulator + runs Maestro; non-idempotent side effects)"
    - "Pitfall 3 — duplicate boss.send with same singletonKey returns null (does NOT throw); spec asserts toBeNull()"
    - "Worker-registration split from queue-registration — registerJobsExecuteQueue + registerJobsExecuteWorker are independent factories so the createJobsModule factory (Plan 23-04) can wire executor.run as the handler with closure over module-local state"

key-files:
  created:
    - "server/jobs/__tests__/queue.spec.ts (75 lines, 5 it-blocks, mock-based unit test)"
    - "server/jobs/__tests__/idempotency.spec.ts (113 lines, 3 it-blocks, DB-gated)"
  modified:
    - "server/jobs/queue.ts (15 → 80 lines: full Phase 23 contract with stately + retryLimit:0 + worker factory)"

key-decisions:
  - "Used named PgBoss import ({ PgBoss } from 'pg-boss') matching codebase convention (server/queue/plugin.ts pattern), not the default-import shape sketched in the plan — the plan's `import type PgBoss from 'pg-boss'` was a typo since pg-boss has no default export"
  - "Added explicit Job<JobExecutePayload>[] annotation on the batch-handler param to satisfy --noEmit (plan's untyped (jobs) => failed TS7006); zero behavior change"
  - "DB-gated idempotency.spec uses ephemeral pgboss_jobs_idem_<random> schema (Phase 19/21 precedent); fixture-style test-app helper does NOT exist in this repo, so spec inlines the canonical 4-plugin sequence (config + correlation + db + queue) verbatim from server/artifacts/__tests__/queue.spec.ts"
  - "findJobs filter uses `key: jobId` (singletonKey lookup, supported by FindJobsOptions); the plan's `state: 'created'` filter is NOT in pg-boss v12 FindJobsOptions, so swapped to per-key filtering"

patterns-established:
  - "Mock-based queue.spec covers source contract (createQueue options, idempotent re-register, work delegation); DB-gated idempotency.spec covers wire-level dedup (Pitfall 3 null return). Two-layer testing matches Phase 16 / 21 precedent."

requirements-completed: [QUEUE-03]

# Metrics
duration: 14 min
completed: 2026-05-08
---

# Phase 23 Plan 02: Idempotency Layer — `job.execute` Queue Body Summary

**`server/jobs/queue.ts` extended from 15-line alias-only stub to 80-line full contract: `registerJobsExecuteQueue` (boss.createQueue with `policy:'stately'` + `retryLimit:0`) + `registerJobsExecuteWorker` (boss.work delegate). Mock-based queue.spec (5 tests, all green) + DB-gated idempotency.spec (3 tests, all green with DATABASE_URL set, skips cleanly without) prove QUEUE-03 + Pitfall 2 + Pitfall 3 contracts.**

## Performance

- **Duration:** ~14 min
- **Completed:** 2026-05-08T05:49:14Z
- **Tasks:** 3
- **Files modified:** 3 (1 modified + 2 created)

## Accomplishments

- `registerJobsExecuteQueue(boss)` calls `boss.createQueue('job.execute', { policy: 'stately', retryLimit: 0 })` — Pitfall 2 corrected (policy:'standard' would silently ignore singletonKey)
- `registerJobsExecuteWorker(boss, handler)` factories the worker registration so Plan 23-04's `createJobsModule` can pass `executor.run` as the handler with module-local state captured
- Mock-based unit spec (5 it-blocks) asserts createQueue options, idempotent re-register, work delegation, batch unpack — runs in <30s, no DB
- DB-gated idempotency spec (3 it-blocks) proves Pitfall 3 — duplicate `boss.send` with same singletonKey returns `null` (NOT throws); confirms 1 row in `findJobs` after triple-enqueue
- All Phase 23-02 tests pass with `DATABASE_URL=postgresql://heicg@localhost:5432/device_farm`; spec skips cleanly when DB env unset

## Task Commits

1. **Task 2.1: queue.ts full body** — `2ef7574` (feat)
2. **Task 2.2: queue.spec mock-based** — `e36c3cf` (test)
3. **Task 2.3: idempotency.spec DB-gated** — `2997d40` (test)

## Files Created/Modified

- `server/jobs/queue.ts` (modified) — Phase 23 queue contract (stately + retryLimit:0 + worker factory)
- `server/jobs/__tests__/queue.spec.ts` (created) — 5 mock-based unit tests
- `server/jobs/__tests__/idempotency.spec.ts` (created) — 3 DB-gated dedup tests

## Decisions Made

- **PgBoss named import:** Plan sketched `import type PgBoss from 'pg-boss'` (default), but pg-boss has no default export — TS2613. Fixed to `import type { PgBoss }` matching server/queue/plugin.ts convention. Cosmetic only, no behavior change.
- **Job batch-param annotation:** Plan left `(jobs) => …` untyped, which fails `--noEmit` with TS7006 (implicit any). Added `Job<JobExecutePayload>[]` annotation. Zero runtime change.
- **No setupTestApp fixture in repo:** Plan suggested re-using a `setupTestApp` helper, but `server/__tests__/fixtures/` doesn't exist. Followed the artifacts queue.spec pattern verbatim — inline 4-plugin sequence (stub config → correlation → live db → queue with isolated schema).
- **`findJobs` filter:** Plan suggested `{ state: 'created' }`, but pg-boss v12 `FindJobsOptions` does NOT include a `state` field — only `id`, `key`, `data`, `queued`. Used `{ key: jobId }` (singletonKey lookup) which is precisely the assertion intent.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Wrong pg-boss import shape**
- **Found during:** Task 2.1 (queue.ts overwrite)
- **Issue:** Plan specified `import type PgBoss from 'pg-boss'` (default import); pg-boss has no default export — TS2613 error blocks compile
- **Fix:** Changed to named import `import type { PgBoss }` matching server/queue/plugin.ts convention
- **Files modified:** server/jobs/queue.ts
- **Verification:** `npx tsc --noEmit 2>&1 | grep "server/jobs/queue.ts" | wc -l` returns 0
- **Committed in:** 2ef7574 (Task 2.1 commit)

**2. [Rule 1 - Bug] Implicit-any on batch-handler param**
- **Found during:** Task 2.1 (queue.ts overwrite)
- **Issue:** Plan's `async (jobs) => {…}` has `jobs: any` (TS7006 with strict mode); type inference fails because `boss.work<JobExecutePayload>` is generic over data, not the batch shape
- **Fix:** Added explicit `Job<JobExecutePayload>[]` annotation; imported `Job` type alongside `PgBoss`
- **Files modified:** server/jobs/queue.ts
- **Verification:** Same — typecheck passes
- **Committed in:** 2ef7574 (Task 2.1 commit)

**3. [Rule 1 - Bug] FindJobsOptions has no `state` field in pg-boss v12**
- **Found during:** Task 2.3 (idempotency.spec)
- **Issue:** Plan asserted `boss.findJobs(NAME, { state: 'created' })`. The pg-boss v12 `FindJobsOptions` interface (node_modules/pg-boss/dist/types.d.ts:158) only supports `id`, `key`, `data`, `queued` — `state` would cause a TS error and runtime no-op (filter ignored).
- **Fix:** Switched to `{ key: jobId }` — singletonKey filter is the canonical pg-boss API for this assertion intent (1 row per singletonKey).
- **Files modified:** server/jobs/__tests__/idempotency.spec.ts
- **Verification:** Test passes against real DB: 3-times enqueue → 1 row.
- **Committed in:** 2997d40 (Task 2.3 commit)

---

**Total deviations:** 3 auto-fixed (1 Rule 3 - Blocking, 2 Rule 1 - Bug)
**Impact on plan:** All deviations are trivial type/API corrections. Zero scope creep. Phase 23-02 contract delivered exactly as specified at the behavior level (stately + retryLimit:0 + singletonKey dedup proven).

## Issues Encountered

None.

## User Setup Required

None — internal queue contract change with no external service configuration.

## DB Harness Reuse Path

No `server/__tests__/fixtures/test-app.ts` helper exists in this repo — `server/artifacts/__tests__/queue.spec.ts` was the canonical reference. The idempotency spec inlines the same 4-plugin registration sequence verbatim: stub config plugin → `correlationPlugin` → live db plugin → `queuePlugin` with isolated `pgboss_jobs_idem_<random>` schema.

## pg-boss Contract Verification

`server/jobs/queue.ts:54` — `policy: 'stately'` (verbatim) — matches RESEARCH §Pitfall 2 mandate.
`server/jobs/queue.ts:55` — `retryLimit: 0` (verbatim) — matches RESEARCH §Standard Stack mandate.

`queue.spec.ts:38` — `expect(call[1]).toMatchObject({ policy: 'stately', retryLimit: 0 })` — proves the contract at the source level.

`idempotency.spec.ts:83` — `expect(id2).toBeNull()` — proves Pitfall 3 (collision returns null, not throws) against a real pg-boss instance.

## Next Phase Readiness

- Plan 23-02 unblocks Plan 23-04 (createJobsModule factory) — queue contract is now stable input.
- Plan 23-04 EXTENDS `idempotency.spec.ts` with SC2 strict assertion (exactly 1 `device.state.changed{booting→idle}` per jobId after the saga + worker + executor are wired); does NOT replace the existing 3 tests.
- Plan 23-04 calls `await registerJobsExecuteQueue(boss); workerId = await registerJobsExecuteWorker(boss, handler)` from `createJobsModule.registerWorkerAndSubscribers`.
- Plan 23-05 drain route imports `JOB_EXECUTE_QUEUE_NAME` for `boss.updateQueue(JOB_EXECUTE_QUEUE_NAME, { paused: true })`.
- Plan 23-03 is parallel-safe with this plan (touches disjoint files); both depend only on Plan 23-00 substrate.

## Self-Check: PASSED

- [x] `server/jobs/queue.ts` exists, 80 lines, contains `policy: 'stately'` + `retryLimit: 0`
- [x] `server/jobs/__tests__/queue.spec.ts` exists, 75 lines, 5/5 it-blocks pass
- [x] `server/jobs/__tests__/idempotency.spec.ts` exists, 113 lines, 3/3 it-blocks pass with DB / skips cleanly without
- [x] Commit 2ef7574 (Task 2.1) found in `git log --oneline`
- [x] Commit e36c3cf (Task 2.2) found in `git log --oneline`
- [x] Commit 2997d40 (Task 2.3) found in `git log --oneline`
- [x] `npx tsc --noEmit` shows 0 new errors in server/jobs/queue.ts and server/jobs/__tests__/(queue|idempotency).spec.ts
- [x] dep-check pre-existing baseline unchanged (7 violations, all pre-23-02; no new errors introduced)

---
*Phase: 23-jobs-module-keystone*
*Completed: 2026-05-08*
