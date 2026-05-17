---
phase: 23-jobs-module-keystone
plan: 00
subsystem: jobs
tags: [jobs, pg-boss, drizzle, dep-cruiser, events, MOD-02, EVENTS-10]

requires:
  - phase: 22-streaming-module
    provides: JOB_EVENT_NAMES bridgehead (6 keys); streaming module factory pattern
  - phase: 21-artifacts-module
    provides: RECORDING_UPLOAD queue-name; artifacts subscriber pattern; dep-cruiser 5th rule precedent
  - phase: 18-lifecycle-migration-node-cron-pg-boss
    provides: boss.updateQueue API surface (drain procedure consumer in Plan 23-05)
provides:
  - systemState pgTable + drizzle migration 0003_wise_aqueduct.sql (drain + future flag substrate)
  - QUEUE_NAMES.JOB_EXECUTE = 'job.execute' (alphabetized between HOOK_RUN and LIFECYCLE_*)
  - JOB_EVENT_NAMES extended 6 → 11 keys (5 keystone saga placeholder names)
  - server/jobs/queue.ts + internal/module.ts + MODULE.md + index.ts substrate
  - server/jobs/__tests__/events.spec.ts EVENTS-03 shape stub (4 passing tests)
  - .dependency-cruiser.cjs 7th forbidden rule no-deep-imports-into-jobs-internal
  - __fixtures__/dep-cruiser/bad-jobs-deep-import.ts firing rule 7
  - server/hooks/__tests__/dep-cruiser.spec.ts 7th it-block (two-pass err+json)
affects: [23-01-events-body, 23-02-queue-body, 23-04-saga-subscribers, 23-05-drain-route, 23-06-db-gated-proofs, 23-07-phase-close]

tech-stack:
  added: []
  patterns:
    - "Wave-0 substrate-first plan (sixth repeat of Phase 18/19/20/21/22 pattern)"
    - "Throw-stub + dep-cruiser N-th rule pattern (jobs is rule 7 of forbidden module rules)"
    - "Queue-name alphabetized constant + JSDoc Phase-N annotation"

key-files:
  created:
    - server/db/migrations/0003_wise_aqueduct.sql
    - server/jobs/queue.ts
    - server/jobs/internal/module.ts
    - server/jobs/MODULE.md
    - server/jobs/index.ts
    - server/jobs/__tests__/events.spec.ts
    - __fixtures__/dep-cruiser/bad-jobs-deep-import.ts
  modified:
    - server/db/schema.ts (appended systemState table)
    - server/queue/names.ts (+1 entry JOB_EXECUTE; +JSDoc)
    - server/jobs/events.ts (JOB_EVENT_NAMES 6 → 11 keys; 5 placeholder additions)
    - .dependency-cruiser.cjs (7th forbidden rule + comment header update)
    - server/hooks/__tests__/dep-cruiser.spec.ts (+7th it-block)

key-decisions:
  - "Drizzle migration filename emitted by drizzle-kit: 0003_wise_aqueduct.sql (NOT 0000_phase23_system_state.sql as plan literal suggested — drizzle owns auto-naming)."
  - "dep-cruiser rule 7 uses pathNot only (no path:'^server/' filter) to match the existing 6 rules' shape — plan literal had from.path:'^server/' which would exclude __fixtures__/ from rule scope and break the spec assertion."
  - "jobsRegistry literal stays at 6 entries through Plan 23-00 (placeholder pattern); payload schemas + emitters extension lands in Plan 23-01."
  - "JOB_EVENT_NAMES extension preserves Phase 22 ordering — appended 5 new keys after STATUS without re-sorting; downstream consumers unaffected."

patterns-established:
  - "Phase 23 substrate parallels Phases 18/19/20/21/22 task-by-task (4 → 6 tasks); each phase adds one dep-cruiser module rule + one fixture + one spec it-block (7th here)."

requirements-completed: [EVENTS-10]

duration: 10min
completed: 2026-05-08
---

# Phase 23 Plan 23-00: Jobs Module Wave-0 Substrate Summary

**Substrate scaffolding for jobs keystone module — systemState DB table + 7 file substrate + 7th dep-cruiser rule unblocks Plans 23-01..23-07 without touching runtime job-service.ts/job-executor.ts/plugin.ts/job-queue.ts.**

## Performance

- **Duration:** 10 min
- **Started:** 2026-05-08T05:19:51Z
- **Completed:** 2026-05-08T05:30:32Z
- **Tasks:** 6
- **Files modified:** 12 (7 created + 5 modified)

## Accomplishments
- systemState pgTable + drizzle migration 0003_wise_aqueduct.sql emitted (drain SC4 + Pitfall 6 resolved before drain specs in Plan 23-05)
- QUEUE_NAMES extended 10 → 11 entries (JOB_EXECUTE='job.execute' alphabetized)
- JOB_EVENT_NAMES extended 6 → 11 keys (5 keystone saga placeholders: ALLOCATED, RUNNING, RECORDING_REQUESTED, CLEANUP_REQUESTED, FAILED)
- 4 substrate files created (queue.ts alias, internal/module.ts throw-stub, MODULE.md placeholder, index.ts barrel)
- events.spec.ts EVENTS-03 shape stub (4 tests green: 11 keys, dotted past-tense, uniqueness, 5 verbatim names)
- 7th dep-cruiser rule no-deep-imports-into-jobs-internal active + fixture firing it + 7th it-block proving structurally
- npm run dep-check baseline preserved (7 pre-existing violations unchanged; rule 7 contributes 0 new violations)

## Task Commits

Each task was committed atomically:

1. **Task 0.1: systemState table + drizzle migration** — `f6c904a` (feat)
2. **Task 0.2: JOB_EXECUTE in QUEUE_NAMES** — `1bcb509` (feat)
3. **Task 0.3: JOB_EVENT_NAMES 5 keystone keys** — `8583fff` (feat)
4. **Task 0.4: queue.ts + internal/module.ts + MODULE.md + index.ts** — `6fcc6d1` (feat)
5. **Task 0.5: events.spec.ts EVENTS-03 shape stub** — `a57e940` (test)
6. **Task 0.6: dep-cruiser 7th rule + fixture + spec extension** — `503fef7` (feat)

## Files Created/Modified

**Created:**
- `server/db/migrations/0003_wise_aqueduct.sql` — drizzle migration creating `system_state` (key TEXT PK, value JSONB NOT NULL, updated_at TIMESTAMPTZ DEFAULT now() NOT NULL)
- `server/jobs/queue.ts` — JOB_EXECUTE_QUEUE_NAME constant alias (body in Plan 23-02)
- `server/jobs/internal/module.ts` — 10-line throw-stub for dep-cruiser resolvable target
- `server/jobs/MODULE.md` — Purpose-only placeholder (full 9-section body in Plan 23-07)
- `server/jobs/index.ts` — MOD-02 strict 1-line internal/ re-export barrel
- `server/jobs/__tests__/events.spec.ts` — EVENTS-03 shape spec (4 tests; ~50 lines)
- `__fixtures__/dep-cruiser/bad-jobs-deep-import.ts` — fixture firing rule 7

**Modified:**
- `server/db/schema.ts` — appended `systemState = pgTable('system_state', { key, value, updatedAt })`
- `server/queue/names.ts` — added `JOB_EXECUTE: 'job.execute'` between HOOK_RUN and LIFECYCLE_COMPRESS_DAILY; JSDoc updated
- `server/jobs/events.ts` — JOB_EVENT_NAMES 6 → 11 keys; file-header JSDoc Phase-23 annotation
- `.dependency-cruiser.cjs` — 7th forbidden rule + header comment update (6 → 7 module rules; 7 → 8 forbidden total)
- `server/hooks/__tests__/dep-cruiser.spec.ts` — JOBS_FIXTURE constant + 7th it-block `[MOD-02 jobs extension]`

## Decisions Made
- Drizzle migration filename `0003_wise_aqueduct.sql` retained (drizzle-kit auto-emits; renaming would break `_journal.json` metadata).
- dep-cruiser rule 7 shape mirrors existing 6 rules (`pathNot` only); plan literal had additional `path:'^server/'` filter which would exclude `__fixtures__/` from rule scope.
- jobsRegistry literal STAYS at 6 entries — placeholder pattern (Plan 23-01 owns payload schemas + registry + emitters extension).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] dep-cruiser rule 7 from-path filter would break fixture detection**
- **Found during:** Task 0.6 (initial spec run failed with "expected non-zero exit code")
- **Issue:** Plan literal specified `from: { path: '^server/', pathNot: '^server/jobs/' }` for rule 7. The existing 6 rules use only `pathNot`. With `path:'^server/'` filter, the fixture at `__fixtures__/dep-cruiser/bad-jobs-deep-import.ts` does NOT match the from-path constraint, so dep-cruiser does not consider it a candidate for rule 7 — rule never fires on the fixture, spec assertion fails.
- **Fix:** Dropped `path:'^server/'`, kept only `pathNot:'^server/jobs/'`. Matches the canonical shape of the 6 prior rules. Fixture now triggers rule 7 correctly; npm run dep-check still suppresses fixture-path violations via its config-level `includeOnly:'^server/'`.
- **Files modified:** `.dependency-cruiser.cjs` (rule 7 from-clause)
- **Verification:** `npx vitest run server/hooks/__tests__/dep-cruiser.spec.ts` — 7/7 it-blocks pass; `npm run dep-check` — 7 pre-existing violations unchanged, rule 7 contributes 0 new violations.
- **Committed in:** `503fef7` (Task 0.6 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Single rule-shape correction; no scope creep, semantics preserved (rule 7 still enforces MOD-02 boundary equivalent to rules 1-6).

## Issues Encountered

- **npm command interception by RTK proxy:** `npx drizzle-kit generate` and `npx tsc --noEmit` initially failed with "Missing script: drizzle-kit". Resolved by routing through `rtk proxy npx ...` (RTK CLI proxy preserves npx semantics). Documented in `~/.claude/RTK.md`; not a code change.

## Verification

**Wave 0 sweep (all green):**
- `grep -c "systemState = pgTable" server/db/schema.ts` → 1
- `server/db/migrations/0003_wise_aqueduct.sql` contains all required strings (CREATE TABLE "system_state", "key" text PRIMARY KEY, "value" jsonb NOT NULL, "updated_at" timestamp with time zone)
- `grep -c "JOB_EXECUTE: 'job.execute'" server/queue/names.ts` → 1
- `npx vitest run server/queue/__tests__/names.spec.ts` → 6/6 green
- 5 new JOB_EVENT_NAMES keys (ALLOCATED/RUNNING/RECORDING_REQUESTED/CLEANUP_REQUESTED/FAILED) all present
- 4 substrate files (queue.ts, internal/module.ts, MODULE.md, index.ts) all created with correct minimal shape
- `npx vitest run server/jobs/__tests__/events.spec.ts` → 4/4 green
- `grep -c "no-deep-imports-into-jobs-internal" .dependency-cruiser.cjs` → 2 (1 comment + 1 rule name)
- `grep -c "name: 'no-deep-imports-into-" .dependency-cruiser.cjs` → 7 (6 prior + 1 new)
- `npx vitest run server/hooks/__tests__/dep-cruiser.spec.ts` → 7/7 green (6 prior + 1 new it-block)
- Wave-merge: 17/17 tests green across events.spec + names.spec + dep-cruiser.spec in 6.26s
- `npx tsc --noEmit` — 8 pre-existing errors unchanged, ZERO new errors on Plan 23-00 files
- `npm run dep-check` — 7 pre-existing violations unchanged (none from rule 7)

## Next Plan Readiness

- **Plan 23-01 unblocked:** events.ts body — 5 payload schemas + jobsRegistry extension to 11 entries + makeJobsEmitters return-shape extension.
- **Plan 23-02 unblocked:** queue.ts body — registerJobsExecuteWorker factory + policy:'stately' + retryLimit:0 createQueue + worker.work registration.
- **Plan 23-04 unblocked:** internal/module.ts factory body (replaces throw-stub).
- **Plan 23-05 unblocked:** drain route reads systemState table (table exists in schema; migration emitted; ready for setup-test-db harness).
- **Plan 23-07 unblocked:** MODULE.md 9-section body + barrel expansion + .test→.spec renames.

## Self-Check: PASSED

All claimed files exist:
- `server/db/migrations/0003_wise_aqueduct.sql` — FOUND
- `server/jobs/queue.ts` — FOUND
- `server/jobs/internal/module.ts` — FOUND
- `server/jobs/MODULE.md` — FOUND
- `server/jobs/index.ts` — FOUND
- `server/jobs/__tests__/events.spec.ts` — FOUND
- `__fixtures__/dep-cruiser/bad-jobs-deep-import.ts` — FOUND

All claimed commits exist (verified via `git log --oneline -7`):
- `f6c904a` — FOUND
- `1bcb509` — FOUND
- `8583fff` — FOUND
- `6fcc6d1` — FOUND
- `a57e940` — FOUND
- `503fef7` — FOUND

---
*Phase: 23-jobs-module-keystone*
*Completed: 2026-05-08*
