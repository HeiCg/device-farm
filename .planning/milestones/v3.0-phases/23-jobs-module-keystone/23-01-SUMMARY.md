---
phase: 23
plan: 01
subsystem: jobs
tags: [events, mod-03, trace-08, trace-04, events-04, events-10]
requires:
  - 23-00-SUMMARY.md  # JOB_EVENT_NAMES extended to 11 keys (substrate)
  - server/bus/helpers.ts  # createEventHelpers factory (Phase 15)
  - server/bus/bus.ts  # TypedBus<R> (Phase 15)
  - server/events/envelope.ts  # envelopeSchema with UUID-validated correlationId/aggregateId
provides:
  - 5 new Zod payload schemas (jobAllocatedPayload, jobRunningPayload, jobRecordingRequestedPayload, jobCleanupRequestedPayload, jobFailedPayload)
  - jobsRegistry extended from 6 to 11 entries with TRACE-08 persistence flags (4 persisted, 7 transient)
  - makeJobsEmitters returns 11 typed emit helpers (added: allocated, running, recordingRequested, cleanupRequested, failed)
  - 10 new tests in events.spec.ts proving EVENTS-03 + EVENTS-04 + TRACE-08 + TRACE-04 contract
affects:
  - server/jobs/events.ts (extended +119 lines; 284 -> 391 total)
  - server/jobs/__tests__/events.spec.ts (extended +118 lines; 43 -> 160 total)
tech-stack:
  added: []
  patterns:
    - "EVENTS-04 thin payload (z.object strict, NOT .passthrough())"
    - "TRACE-08 persistence policy (notable hand-offs + terminal errors persisted; transient saga state derivable)"
    - "TRACE-04 envelope stamping via createEventHelpers factory + ALS correlationId"
    - "Plain-object asyncLocalStorage store shape (Phase 20+ canonical, NOT legacy Map)"
key-files:
  created: []
  modified:
    - server/jobs/events.ts
    - server/jobs/__tests__/events.spec.ts
decisions:
  - "TRACE-08 persistence flags: ALLOCATED+RUNNING transient (derivable from jobs.status); RECORDING_REQUESTED+CLEANUP_REQUESTED persisted (notable cross-module hand-offs); FAILED persisted (terminal saga error / EVENTS-07 analogue)"
  - "jobFailedPayload step enum: ['allocate','run','complete','recording','webhook','cleanup'] matches saga steps; future widening accepted"
  - "jobAllocatedPayload + jobRunningPayload share platform discriminator letting subscribers fork android/ios paths without re-fetching the job row"
  - "Plan 23-01 does NOT add system.drain.* events — Plan 23-05 owns those (DEFERRED-23-B proximity-based ownership)"
metrics:
  duration: "4min"
  completed: "2026-05-08"
  tasks: 2
  files_modified: 2
  files_created: 0
  tests_added: 10
---

# Phase 23 Plan 23-01: Events Body — Summary

**One-liner:** Land 5 new Zod payload schemas + extend jobsRegistry to 11 entries + extend makeJobsEmitters to 11 helpers, proven by 10 new tests covering EVENTS-03/04 + TRACE-04/08 contracts end-to-end.

## What Shipped

### Task 1.1 — events.ts body extension (commit 44c21bc)

`server/jobs/events.ts` grew from 284 to 391 lines (+107 lines):

**5 new payload schemas (Zod strict z.object, EVENTS-04 thin):**
- `jobAllocatedPayload` — `{jobId, deviceId, platform: 'android'|'ios'}` (transient; derivable from device.allocated row)
- `jobRunningPayload` — `{jobId, deviceId, platform}` (transient; derivable from jobs.status='running')
- `jobRecordingRequestedPayload` — `{jobId, recordingId, outputPath}` (PERSISTED — notable hand-off to artifacts module)
- `jobCleanupRequestedPayload` — `{jobId}` (PERSISTED — terminal hand-off resolving DEFERRED-22-D `setTimeout(broadcaster.cleanup, 5000)`)
- `jobFailedPayload` — `{jobId, step: enum[allocate|run|complete|recording|webhook|cleanup], reason: string}` (PERSISTED — saga error EVENTS-07 analogue)

**jobsRegistry extended 6 → 11 entries** with TRACE-08 persistence flags:
- 4 persisted: `job.completed`, `job.recording.requested`, `job.cleanup.requested`, `job.failed`
- 7 transient: `job.started`, `maestro.log.written`, `job.log`, `job.step`, `job.status`, `job.allocated`, `job.running`
- All 11 entries `aggregateType: 'job'`

**makeJobsEmitters return shape extended 6 → 11 helpers:**
- Existing: `started, completed, maestroLogWritten, log, step, status`
- New: `allocated, running, recordingRequested, cleanupRequested, failed`

### Task 1.2 — events.spec.ts extension (commit ef6bb36)

`server/jobs/__tests__/events.spec.ts` grew from 43 to 160 lines (+117 lines):

**Imports added:** `asyncLocalStorage` from `@fastify/request-context`, `randomUUID` from `node:crypto`, 5 new payload schemas + `jobsRegistry` + `makeJobsEmitters`, `TypedBus`, `Envelope` type.

**New describe block** `'jobs/events.ts jobsRegistry + makeJobsEmitters — Phase 23 Plan 23-01'` with 10 tests:
1. jobsRegistry has exactly 11 entries
2. TRACE-08 flags: 4 persisted / 7 transient with explicit per-name assertions
3. Every entry has aggregateType='job'
4. jobAllocatedPayload accepts valid + rejects missing platform / bad enum
5. jobRunningPayload accepts valid + rejects malformed
6. jobRecordingRequestedPayload accepts valid + rejects malformed
7. jobCleanupRequestedPayload accepts valid
8. jobFailedPayload accepts step='allocate'/'run' + rejects step='unknown'
9. makeJobsEmitters returns 11 sorted typed helpers (each a function)
10. emit.failed stamps envelope with type='job.failed' + correlationId from ALS + aggregateType='job' + aggregateId=jobId + payload (TRACE-04)

**File total:** 14 it-blocks (4 from Plan 23-00 + 10 new), 2 describe blocks, all green in <500ms.

## Verification

```
Task 1.1 acceptance criteria:
  grep -c "export const jobAllocatedPayload"        =  1 ✓
  grep -c "export const jobRunningPayload"          =  1 ✓
  grep -c "export const jobRecordingRequestedPayload" = 1 ✓
  grep -c "export const jobCleanupRequestedPayload" =  1 ✓
  grep -c "export const jobFailedPayload"           =  1 ✓
  grep -c "persisted: true"                         =  4 ✓
  grep -c "persisted: false"                        =  7 ✓
  grep -cE "^[[:space:]]+\\[JOB_EVENT_NAMES\\."     = 11 ✓
  grep -cE "^[[:space:]]+(allocated|running|recordingRequested|cleanupRequested|failed):[[:space:]]+emit" = 5 ✓
  npx tsc --noEmit on server/jobs/events.ts         =  0 new errors ✓

Task 1.2 acceptance criteria:
  grep -c "describe(" events.spec.ts               =  2 ✓
  grep -c "it(" events.spec.ts                     = 14 ✓ (≥12 target)
  npx vitest run server/jobs/__tests__/events.spec.ts → 14/14 PASS ✓
  test file size: 160 lines (between 150-250 target) ✓

Phase-wide gates:
  npm run dep-check                                  → 7 pre-existing violations (unchanged baseline) ✓
  npx tsc --noEmit                                   → 0 new errors on Plan 23-01 files ✓
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Test envelope assertions used non-UUID strings for correlationId + aggregateId**
- **Found during:** Task 1.2 first run
- **Issue:** Plan-literal test code used `cid = '11111111-2222-3333-4444-555555555555'` (NOT a v1-v8 UUID — version digit '3' OK but variant digit '4' is not in `[89abAB]`) and `jobId = 'job-9999'` (plain string). The envelope schema at `server/events/envelope.ts` validates BOTH `correlationId` and `aggregateId` as `z.string().uuid()`, so envelopeSchema.parse() failed inside createEventHelpers with ZodError on both fields.
- **Fix:** Replaced both literals with `randomUUID()` from `node:crypto`. This matches the Phase 22 streaming spec canonical pattern (`server/streaming/__tests__/events.spec.ts:69, 130`) which uses `randomUUID()` for both fields throughout.
- **Files modified:** `server/jobs/__tests__/events.spec.ts`
- **Commit:** Folded into Task 1.2 commit ef6bb36 (single commit).

### Plan-literal Discrepancies (informational, not deviations)

- The plan's verification block specifies `grep -c "export const job.*Payload"` returning 8 (claimed: 3 existing + 5 new). Actual count is 10 (jobCompleted/Started/Log/Step/Status + 5 new = 10; the 3-existing baseline missed the 3 Phase 22 streaming payloads jobLog/Step/Status). All 5 new schemas are present (verified by individual grep counts of 1 each); plan literal was stale, no remediation needed.

## Plan 23-04 Unblocked

`createJobsModule` factory (Plan 23-04 scope) can now:
- Import `makeJobsEmitters` and call it with the per-module bus to get the 11-helper emitter object
- Saga rewrite can call `jobsEmit.allocated(jobId, {jobId, deviceId, platform})` etc. across all 5 new keystone events
- Persistence middleware (or per-module persistEnvelope duplicate — 6th sample point referenced by Plan 22 status) reads `jobsRegistry[type].persisted` to decide INSERT-into-events vs skip

## Final Metrics

- **events.ts:** 391 lines (Plan 23-00 baseline 284 + 107 from Plan 23-01)
- **events.spec.ts:** 160 lines (Plan 23-00 baseline 43 + 117 from Plan 23-01)
- **TRACE-08 persistence ratio:** 4 persisted / 7 transient out of 11 total
- **Tests:** 14/14 green in <500ms
- **Duration:** 4min / 2 tasks / 2min avg

## Self-Check: PASSED

- `server/jobs/events.ts` — FOUND, 391 lines, all 5 new payload schemas exported
- `server/jobs/__tests__/events.spec.ts` — FOUND, 160 lines, 14 tests passing
- Commit `44c21bc` — FOUND in `git log` (Task 1.1: events.ts body)
- Commit `ef6bb36` — FOUND in `git log` (Task 1.2: events.spec.ts extension)
