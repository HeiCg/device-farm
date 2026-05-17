---
phase: 21-artifacts-module
plan: 05
subsystem: testing
tags: [vitest, pg-boss, drizzle, typed-bus, async-local-storage, correlation-id, causation-id, db-gated, idempotency, events-table]

# Dependency graph
requires:
  - phase: 21-artifacts-module
    provides: Plan 21-04 createArtifactsModule factory + 3 inline bus subscribers (job.started, job.completed, maestro.log.written) + stub-recording-service.ts fixture + job-service.ts imperative-call deletion (9 direct calls removed + 3 emit calls added)
  - phase: 21-artifacts-module
    provides: Plan 21-03 recording.upload queue + registerArtifactsWorker factory + two-layer idempotency (policy:'stately' singletonKey + createArtifactIdempotent onConflictDoNothing)
  - phase: 21-artifacts-module
    provides: Plan 21-02 jobs events bridgehead (JOB_STARTED + MAESTRO_LOG_WRITTEN added to jobsRegistry) + artifacts events (ARTIFACT_CREATED persisted, RECORDING_STARTED/STOPPED transient)
  - phase: 19-reporting-migration-webhooks-dlq
    provides: retryBackoff override pattern + isolated pgboss_<module>_<suffix> schemas + console.warn skipIf pattern + canonical plain-object ALS store shape
  - phase: 20-pool-module-devices
    provides: pool plugin (drivers disabled in tests) + subscriber.spec + correlation.spec + lifecycle-ownership.spec test-as-spec templates
  - phase: 15-fix-operational-dependencies
    provides: TypedBus per-module + persistEnvelope side-channel + onPersisted currentEventId-in-ALS wrapper (TRACE-09 causation substrate)
provides:
  - DB-gated empirical proof of SC1 end-to-end (3 bus events drive all artifact-service side-effects, zero direct calls)
  - DB-gated empirical proof of SC4 + TRACE-04 end-to-end (single correlationId threads bus → queue → worker → events table)
  - DB-gated empirical proof of TRACE-09 causation chain (artifact.created.causation_id = job.completed.id)
  - Non-DB structural regression guard (readFileSync grep-guard over server/jobs/job-service.ts — 10 assertions)
affects: [phase-22-streaming, phase-23-jobs-keystone, phase-27-trace-tree, phase-28-cli, phase-29-web]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - DB-gated end-to-end test suite per module (subscriber.spec + correlation.spec + lifecycle-ownership.spec trilogy)
    - Stub-jobs-plugin inline fp() factory for module-independence test harness (decorates fastify.jobsModule with bus + 3-key emitters, persists via side-channel)
    - Boss.findJobs over Boss.fetch for peek-without-dequeue verification (API preferred per pg-boss v12 deprecation of getJobById)
    - Plain-object ALS store shape per Phase 20 canonical (legacy Map forbidden in new pool/artifacts specs; grep-guard = 0 `new Map([[` matches)

key-files:
  created:
    - server/artifacts/__tests__/subscriber.spec.ts
    - server/artifacts/__tests__/correlation.spec.ts
    - server/artifacts/__tests__/lifecycle-ownership.spec.ts
  modified: []

key-decisions:
  - "Stub-jobs-plugin uses plugin NAME 'job-plugin' (matches real name) with dependencies ['db', 'event-bus'] — lets artifact-plugin's dependency chain satisfy transitively when registered before artifacts plugin"
  - "Captured array pattern over `let x: T | null = null` to avoid TS narrow-to-never after callback assignment (ts2339 during first typecheck was fixed by switching to `const captured: T[] = [];` + `.push(...)`)"
  - "boss.findJobs is the preferred API over boss.fetch — fetch signature changed in pg-boss v12 (takes FetchOptions object, not bare number), and findJobs returns rows across ALL states (created/active/completed) so verification works regardless of whether worker has already picked up the job"
  - "singletonKey verification via jobs[i].singletonKey on JobWithMetadata rows (pg-boss v12 projects singleton_key column onto the camelCased field)"
  - "lifecycle-ownership.spec uses count() indexOf loop (not split/length or regex match) — explicit 0-or-more semantics, readable when needle includes special chars like `(`"

patterns-established:
  - "Phase 21 test-as-spec trilogy matches Phase 20 pool module shape exactly: subscriber.spec (runtime SC1) + correlation.spec (SC4 + TRACE-04 + TRACE-09) + lifecycle-ownership.spec (structural SC1 grep-guard)"
  - "Stub-jobs-plugin inline fp() factory — copy-paste template for any test that needs fastify.jobsModule without the full jobs plugin dependency chain (Phase 23 Jobs Keystone will rewrite this with real jobs/internal/module.ts, at which point the stub becomes a fixture import)"
  - "Persisted event verification via findEvents polling utility (15s deadline + 200ms interval) — tolerates fire-and-forget DB writes in persistEnvelope middleware"

requirements-completed: [SC1, SC2, SC4, MOD-08, TRACE-04, TRACE-08, TRACE-09]

# Metrics
duration: 19min
completed: 2026-04-22
---

# Phase 21 Plan 21-05: DB-gated SC1 + SC4 + TRACE-04 + TRACE-09 Proofs Summary

**Three empirical specs (subscriber + correlation + lifecycle-ownership) prove Phase 21's Artifacts Module SC1 runtime behavior, SC4 end-to-end correlation threading, TRACE-09 causation chain, and regression-guard against reintroduced imperative artifact-service calls in job-service.ts.**

## Performance

- **Duration:** 19 min
- **Started:** 2026-04-22T18:21:04Z
- **Completed:** 2026-04-22T18:40:31Z
- **Tasks:** 3 (all TDD spec-authoring)
- **Files created:** 3

## Accomplishments

- **subscriber.spec.ts (SC1 runtime)** — boots full plugin stack (config → correlation → db → event-bus → queue → pool → stub-jobs-plugin → artifacts) + isolates pg-boss schema per-run + swaps in stub-recording-service AFTER onReady so the 3 subscribers pick up the stub's method; then emits each of the 3 trigger events and asserts expected side-effects (recording.started envelope fires, recording.upload job enqueued with singletonKey:recordingId, artifact.created DB row + envelope for maestro.log). 3 tests.
- **correlation.spec.ts (SC4 + TRACE-04 + TRACE-09)** — wraps `asyncLocalStorage.run({correlationId})` around ALS-scoped emit, threads correlationId through job.started → job.completed → recording.upload worker → artifact.created persistence, then queries `events WHERE correlation_id = <uuid> AND event_type = 'artifact.created'` for ≥1 row and asserts its causation_id equals the original job.completed envelope's id. 1 test proving all 3 traceability requirements end-to-end.
- **lifecycle-ownership.spec.ts (SC1 structural)** — readFileSync grep-guard over `server/jobs/job-service.ts`: asserts 0 imperative calls (`this.artifactService.createArtifact(`, `this.recordingService.startRecording/stopRecording`, `this.memoryService.startSampling/stopSampling/writeSamples` all = 0), allowlists 1 mid-flow `this.screenshotService.capture` (on-failure path KEPT per MODULE.md Non-Goals), and verifies 3 emit calls present (`this.jobsEmit?.started`, `this.jobsEmit?.maestroLogWritten`, `this.jobsEmit?.completed` — Phase 19 preserved). 10 tests pass in <500ms on every invocation.
- **Phase 21 success criteria empirically closed:** SC1 (runtime via subscriber.spec + structural via lifecycle-ownership.spec), SC3 (from Plan 21-03 queue.spec), SC4 + TRACE-04 + TRACE-09 (via correlation.spec). Only Plan 21-06 close-out (MODULE.md body + barrel + renames + Nyquist gate) remains for Phase 21.

## Task Commits

1. **Task 5.1: Write subscriber.spec.ts — SC1 end-to-end DB-gated proof** — `b00d63a` (test)
2. **Task 5.2: Write correlation.spec.ts — SC4 + TRACE-04 + TRACE-09 end-to-end correlation proof** — `6033d21` (test)
3. **Task 5.3: Write lifecycle-ownership.spec.ts — SC1 structural regression guard** — `26a3231` (test)

## Files Created/Modified

- `server/artifacts/__tests__/subscriber.spec.ts` (NEW, 267 lines) — 3 tests proving SC1 runtime. Stub-jobs-plugin + stub-recording-service. Collapses retry backoff via updateQueue override.
- `server/artifacts/__tests__/correlation.spec.ts` (NEW, 175 lines) — 1 test proving SC4 + TRACE-04 + TRACE-09 end-to-end. findEvents polling utility tolerates fire-and-forget persistence.
- `server/artifacts/__tests__/lifecycle-ownership.spec.ts` (NEW, 75 lines) — 10 non-DB structural assertions. Count() indexOf loop pattern.

## Decisions Made

- **Stub-jobs-plugin NAME = 'job-plugin'** (matches real plugin name). Both subscriber.spec + correlation.spec inline the same stub via `makeStubJobsPlugin()` (~25 LOC each). Phase 23 Jobs Keystone will replace this with real `server/jobs/internal/module.ts` — at that point the stub can be promoted to a shared fixture.
- **findJobs over fetch** for boss verification. pg-boss v12 `fetch(name, options)` expects `options: FetchOptions` (not a bare number); `findJobs(name)` returns all-states rows — both simpler and more robust for verification.
- **Array-based capture pattern** (`const captured: T[] = []; callback pushes` over `let captured: T | null = null; callback assigns`). The latter narrows to `never` after read because TS doesn't track callback side-effects; former is idiomatic and lint-friendly.
- **Count via indexOf loop** in lifecycle-ownership.spec (not String.prototype.match/split). Needles contain regex-special chars (`?`, `(`); explicit substring-count is the right semantic and most readable.

## Deviations from Plan

Rule 1 auto-fixes (3 inline fixes during initial typecheck run — all inside scope of new spec files, not cross-module):

### Auto-fixed Issues

**1. [Rule 1 - Bug] TS2339 narrow-to-never on mutated callback captures**
- **Found during:** Task 5.1 (subscriber.spec.ts initial typecheck run)
- **Issue:** `let captured: T | null = null;` + callback assignment + subsequent `captured?.field` access produced TS2339 "Property 'field' does not exist on type 'never'" — TS narrowed `captured` to `never` because control-flow analysis didn't recognize that the callback re-assigned before the read.
- **Fix:** Switched to `const captured: T[] = [];` + callback `.push(value)` + read `captured[0].field`. Same coverage, idiomatic pattern, no narrow-to-never.
- **Files modified:** server/artifacts/__tests__/subscriber.spec.ts (3 test blocks affected — `captured`, `recordingId`, `artifactCreated`)
- **Verification:** `npx tsc --noEmit` — 0 new errors on subscriber.spec.ts (pre-existing 8 errors in 6 unrelated files remain unchanged).
- **Committed in:** `b00d63a` (Task 5.1 commit)

**2. [Rule 1 - Bug] TS2769 pg-boss fetch signature change in v12**
- **Found during:** Task 5.1 (subscriber.spec.ts initial typecheck run)
- **Issue:** Plan's `app.boss.fetch(RECORDING_UPLOAD_QUEUE_NAME, 10)` signature matched pg-boss v10; v12 `fetch(name, options)` expects `options: FetchOptions` object (or `{includeMetadata: true}` overload) — `10` doesn't match either overload, producing TS2769.
- **Fix:** Switched to `app.boss.findJobs(RECORDING_UPLOAD_QUEUE_NAME)` which returns `JobWithMetadata<T>[]` across all states (created/active/completed/failed) — suited for verification scenarios where worker may or may not have picked up the job yet. Also added `singletonKey` field assertion (present on JobWithMetadata per pg-boss v12 type def).
- **Files modified:** server/artifacts/__tests__/subscriber.spec.ts ([SC1 job.completed] test)
- **Verification:** `npx tsc --noEmit` — 0 new errors. findJobs is the pg-boss-recommended API per the `@deprecated Use findJobs()` annotation on getJobById in `node_modules/pg-boss/dist/index.d.ts`.
- **Committed in:** `b00d63a` (Task 5.1 commit)

---

**Total deviations:** 2 auto-fixes (both Rule 1 bugs — TS type mismatches caught by pre-commit typecheck). Zero cross-module impact; zero scope creep.

**Impact on plan:** Both fixes necessary for the spec to compile. Plan's literal code snippets captured the intent correctly but mispredicted TypeScript's narrow-after-callback behavior + pg-boss v10 API shape. Once fixed, plan executed exactly as designed — 3 specs, 14 tests total (3 + 1 + 10), 0 pre-existing errors increased, 0 regressions across the 62-test artifacts suite.

## Issues Encountered

None beyond the 2 Rule-1 auto-fixes above. Full artifacts spec suite (`npx vitest run server/artifacts/__tests__/`) reports `PASS (62) FAIL (0)`.

## User Setup Required

None - no external service configuration required. DB-gated specs skip cleanly without `TEST_DATABASE_URL`; lifecycle-ownership.spec runs unconditionally as a non-DB structural guard.

## Next Phase Readiness

- **Phase 21 Plan 21-06 (Wave 5 close-out) unblocked:** MODULE.md body expansion + server/artifacts/index.ts barrel + `*.test.ts` → `*.spec.ts` renames + Nyquist delta capture + phase-close ROADMAP/STATE synchronization. All runtime SC1/SC3/SC4 + TRACE-04/08/09 claims now have passing spec-layer evidence to reference in MODULE.md Invariants section.
- **Phase 22 Streaming Module** can treat artifact.created events as a reliable upstream signal — correlation.spec establishes that artifact.created rows in the events table carry correct correlationId + causationId for trace-tree consumption.
- **Phase 23 Jobs Keystone** inherits lifecycle-ownership.spec as a structural guard: any attempt to reintroduce imperative artifact-service calls into job-service.ts (or its successor jobs/internal/module.ts after the rewrite) fails this spec immediately.
- **Phase 27 Trace-Tree Consumer** can consume the events table via the correlationId index, knowing persisted artifact.created rows are emitted by the artifacts module subscribers (not by scattered imperative calls) and carry the full correlation + causation chain.

## Self-Check

Verified via direct filesystem + git inspection:
- `test -f server/artifacts/__tests__/subscriber.spec.ts` → FOUND
- `test -f server/artifacts/__tests__/correlation.spec.ts` → FOUND
- `test -f server/artifacts/__tests__/lifecycle-ownership.spec.ts` → FOUND
- `git log --oneline | grep b00d63a` → FOUND (Task 5.1 commit)
- `git log --oneline | grep 6033d21` → FOUND (Task 5.2 commit)
- `git log --oneline | grep 26a3231` → FOUND (Task 5.3 commit)
- `grep -rcE "new Map\(\[\[" server/artifacts/__tests__/` → 0 matches across all 11 spec files
- `npx vitest run server/artifacts/__tests__/` → PASS (62) FAIL (0)
- `npx vitest run server/artifacts/__tests__/lifecycle-ownership.spec.ts` → PASS (10) FAIL (0) in <500ms
- `npx tsc --noEmit` → 8 pre-existing errors (unchanged from baseline), 0 new errors from Plan 21-05 files

**Self-Check: PASSED**

---
*Phase: 21-artifacts-module*
*Completed: 2026-04-22*
