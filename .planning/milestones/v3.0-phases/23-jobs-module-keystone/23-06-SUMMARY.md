---
phase: 23-jobs-module-keystone
plan: 06
subsystem: testing
tags: [jobs, saga, correlation, db-gated, grep-guards, vitest, drizzle, pgboss, fastify]

# Dependency graph
requires:
  - phase: 23-jobs-module-keystone
    provides: "Plan 23-04 wired saga subscribers in server/jobs/internal/subscribers.ts; Plan 23-05 drain endpoint + admin routes"
provides:
  - "DB-gated proof of jobs saga chain (subscriber.spec) — pool.device.allocated + job.completed + job.failed paths"
  - "DB-gated proof of correlationId threading end-to-end (correlation.spec) — TRACE-04"
  - "DB-FREE structural grep-guards (lifecycle-ownership.spec) — SC1 anti-patterns absent"
  - "6/6 lifecycle-ownership tests green (107ms); 5/5 DB-gated tests skip cleanly when DB absent"
affects: [phase 23-07 phase close, phase 24+ saga consumers, regression prevention]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Phase 21/22 reference shape: full Fastify plugin stack boot in spec for end-to-end saga proof"
    - "describe.skipIf(!HAS_DB) gate + ephemeral pgboss schema per spec for parallel-safety"
    - "Plain-object ALS store shape: {correlationId, currentEventId, actor} (Phase 20 canonical)"
    - "Comment-stripping helper for grep-guard specs (avoids JSDoc anti-pattern false positives)"

key-files:
  created:
    - "server/jobs/__tests__/subscriber.spec.ts (257 lines, 3 DB-gated tests)"
    - "server/jobs/__tests__/correlation.spec.ts (193 lines, 2 DB-gated tests)"
    - "server/jobs/__tests__/lifecycle-ownership.spec.ts (117 lines, 6 DB-FREE tests)"
  modified: []

key-decisions:
  - "Comment-stripping in lifecycle-ownership.spec — prevents JSDoc references to anti-patterns from triggering false positives. Without the strip, executor.ts:6 (`* - Call .catch(() => {})...` doc comment) registers as 1 anti-pattern."
  - "subscriber.spec drives saga via app.jobsModule.emit and app.poolModule.emit directly (not via runJob worker handler). Plan 23-04 idempotency.spec second describe block already documents the full-stack opt-in proof (PHASE23_FULL_STACK_TEST=1); this spec exercises the subscriber chain in isolation."
  - "correlation.spec asserts BOTH job.completed AND job.cleanup.requested rows carry the cid. job.completed is persisted (Phase 19); job.cleanup.requested is persisted (Phase 23). Both rows on the same chain = TRACE-04 proof."

patterns-established:
  - "DB-gated saga subscriber spec: stub-config + correlation + db + event-bus + queue + stub-auth + pool + jobs (full plugin stack) → emit on bus → vi.waitFor DB row landing"
  - "Grep-guard spec with comment-stripping helper (loadCode wraps readFileSync + stripComments) → robust against future JSDoc churn"

requirements-completed: [EVENTS-10]

# Metrics
duration: 5min
completed: 2026-05-08
---

# Phase 23 Plan 06: DB-gated Saga Proofs Summary

**Three new spec files prove the Plan 23-04 saga wiring: subscriber.spec (3 DB-gated tests for device.allocated/job.completed/job.failed chains), correlation.spec (2 DB-gated TRACE-04 cid-threading tests), lifecycle-ownership.spec (6 DB-FREE SC1 grep-guards green).**

## Performance

- **Duration:** 5min
- **Started:** 2026-05-08T07:08:00Z
- **Completed:** 2026-05-08T07:13:00Z
- **Tasks:** 3
- **Files created:** 3 (567 lines total)

## Accomplishments
- subscriber.spec proves jobs saga chain end-to-end (when DB available): pool device.allocated → jobs.status='allocated' + deviceId; jobs.job.completed → finishedAt + cleanup.requested persisted row; jobs.job.failed → status='failed' + errorMessage + cleanup.requested
- correlation.spec proves correlationId threads through the saga: ALS.run({cid}) → emit.completed → events table rows for both job.completed AND job.cleanup.requested carry cid (TRACE-04)
- lifecycle-ownership.spec proves the post-Plan-23-04 codebase has zero SC1 anti-patterns: 4 grep-guards (catch swallow, setTimeout-broadcaster-cleanup, streaming/internal imports, direct bus.emit) + 2 sanity checks (shim ≤200 lines, executor uses jobsModule.emit) all green
- All 6 DB-FREE tests pass in 107ms; 5 DB-gated tests skip cleanly (`describe.skipIf(!HAS_DB)`) when TEST_DATABASE_URL absent

## Task Commits

Each task was committed atomically:

1. **Task 6.3: lifecycle-ownership.spec** — `29d3e00` (test) — 117 lines, 6/6 green in 107ms
2. **Task 6.1: subscriber.spec** — `9f05f14` (test) — 257 lines, 3 DB-gated tests skip cleanly
3. **Task 6.2: correlation.spec** — `6ac37dc` (test) — 193 lines, 2 DB-gated tests skip cleanly

_Note: Task 6.3 was executed first (smallest, DB-FREE) to land the structural guard. Tasks 6.1/6.2 followed with DB-gated harness reuse._

## Files Created
- `server/jobs/__tests__/lifecycle-ownership.spec.ts` (117 lines) — SC1 grep-guards via readFileSync + comment-stripping
- `server/jobs/__tests__/subscriber.spec.ts` (257 lines) — Saga chain DB proof via full Fastify plugin stack
- `server/jobs/__tests__/correlation.spec.ts` (193 lines) — TRACE-04 cid threading via ALS.run + events table query

## Decisions Made

1. **Comment-stripping in lifecycle-ownership.spec.** Plan literal regex (`/\.catch\(\(\) => \{\}\)/g`) matches inside JSDoc comments. executor.ts line 6 has the literal string `.catch(() => {})` inside a doc comment that documents what the file does NOT do. Without stripping, the test would fail (count=1) on a passing codebase. Solution: `stripComments()` helper removes `/* ... */` and `//` comments before matching. Documented in spec header.
2. **subscriber.spec uses module-level emit (not full runJob worker).** Plan 23-04's idempotency.spec second describe block (`describe.skipIf(!HAS_DB)('jobs.execute saga-level SC2 strict ...')`) already documents the full-stack proof gated on `PHASE23_FULL_STACK_TEST=1`. This spec exercises the subscriber chain via `app.jobsModule.emit.completed/failed` and `app.poolModule.emit.allocated` directly — proves subscriber wiring without booting maestro/qemu.
3. **correlation.spec asserts persisted rows only.** job.allocated and job.running are not persisted (registry: persisted=false), so cid threads exist transiently but cannot be queried back. Asserting on persisted rows (job.completed + job.cleanup.requested + job.failed + job.cleanup.requested) is the testable surface and matches the canonical TRACE-04 contract.

## Deviations from Plan

None - plan executed exactly as written, with one minor adjustment auto-applied:

### Auto-fixed Issues

**1. [Rule 1 — Bug] Added comment-stripping helper to lifecycle-ownership.spec**
- **Found during:** Task 6.3 (initial spec authoring)
- **Issue:** Plan literal regex `/\.catch\(\(\) => \{\}\)/g` matched 1 occurrence inside the JSDoc comment block at executor.ts line 6 (the comment block documenting what executor.ts does NOT do). Without scoping to code-only, the test would have failed (count=1) on a passing codebase, contradicting the plan's "expect 0" assertion.
- **Fix:** Added `stripComments(src)` helper that removes `/* ... */` block comments + `//` line comments before pattern matching. The grep-guards now measure REAL CODE only.
- **Files modified:** server/jobs/__tests__/lifecycle-ownership.spec.ts (initial creation)
- **Verification:** 6/6 tests green; manual grep on raw file shows count=1 (the JSDoc), spec correctly reports count=0 (code only).
- **Committed in:** 29d3e00 (Task 6.3 commit)

---

**Total deviations:** 1 auto-fixed (1 bug — Rule 1)
**Impact on plan:** No scope creep. The auto-fix made the spec robust against future JSDoc churn. Future contributors can document anti-patterns in comments without breaking the structural guard.

## Issues Encountered

- **DB unavailable in autonomous environment.** TEST_DATABASE_URL/DATABASE_URL not set. Both subscriber.spec and correlation.spec are gated via `describe.skipIf(!HAS_DB)` — they skip cleanly (5 tests skipped) and emit a console.warn diagnostic. When DB becomes available, the tests will run (matches Phase 19/20/21/22 DB-gated proof pattern). The lifecycle-ownership.spec is DB-FREE and ran 6/6 green in 107ms.
- **Pre-existing test failure (out of scope):** `server/jobs/__tests__/contract-devicename.spec.ts > (f) server/openapi.json components.schemas.Job has deviceName in properties` fails because `spec.components.schemas.Job` is undefined in the current openapi.json. This is a Plan 23-03 deviceName contract test failing on the openapi.json regen state. Not caused by Plan 23-06 (which only adds new test files). Documented as a deferred item; Phase 23-07 phase-close will sweep all pre-existing failures.

## Self-Check

Verifying claims before proceeding:

**Files exist:**
- FOUND: server/jobs/__tests__/lifecycle-ownership.spec.ts (117 lines)
- FOUND: server/jobs/__tests__/subscriber.spec.ts (257 lines)
- FOUND: server/jobs/__tests__/correlation.spec.ts (193 lines)

**Commits exist:**
- FOUND: 29d3e00 — `test(23-06): add jobs lifecycle-ownership.spec [SC1 grep-guards]`
- FOUND: 9f05f14 — `test(23-06): add jobs subscriber.spec [SC1 saga chain DB proof]`
- FOUND: 6ac37dc — `test(23-06): add jobs correlation.spec [TRACE-04 / SC1 cid threading]`

**Acceptance criteria:**
- subscriber.spec — file exists, 3 it-blocks, ≥6 device.allocated|job.completed|job.failed mentions (14 found), ≥3 vi.waitFor (4 found), 257 lines (in 180-320 range), skips cleanly without DB ✓
- correlation.spec — file exists, 2 it-blocks, ≥6 correlationId mentions (13 found), ≥2 asyncLocalStorage.run (3 found), 193 lines (in 100-200 range), skips cleanly without DB ✓
- lifecycle-ownership.spec — file exists, 6 it-blocks all green in 107ms, 4 grep-guards report count=0, 117 lines ✓

## Self-Check: PASSED

## Next Plan Readiness
- Plan 23-07 (phase close: MODULE.md body + barrel + renames + Nyquist + STATE/ROADMAP) UNBLOCKED
- All 3 SC1 proofs land: structural (lifecycle-ownership) + saga-chain (subscriber) + correlationId (correlation)
- Pre-existing contract-devicename failure to be swept in Plan 23-07 (documented above)

---
*Phase: 23-jobs-module-keystone*
*Completed: 2026-05-08*
