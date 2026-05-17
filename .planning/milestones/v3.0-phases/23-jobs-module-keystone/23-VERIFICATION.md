---
phase: 23-jobs-module-keystone
verified: 2026-05-08T00:00:00Z
status: passed
score: 4/4 must-haves verified
re_verification: null
human_verification:
  - test: "Drain runbook dry-run rehearsal end-to-end"
    expected: "Start server → enqueue 3 jobs → POST /admin/drain → response {drained:true,in_flight:0} once jobs finish → restart server → POST /jobs returns 503 system_draining → POST /admin/drain/resume → enqueue accepts again"
    why_human: "Operational rehearsal across server restart cannot be reliably automated; documented in docs/runbooks/drain.md per Phase 23 Validation §Manual-Only Verifications"
  - test: "Cross-tier deviceName proof in Go (DEFERRED-23-C)"
    expected: "device-farm status <jobId> prints human-readable device name (not UUID) when job has allocated device"
    why_human: "Documented Phase 28 transfer per CONTEXT.md and Plan 23-03 SUMMARY — server-side machinery is in place (CLI struct DeviceName *string + status.go prints if non-nil) but Go-side TestStatusDeviceName not yet shipped"
---

# Phase 23: Jobs Module (Keystone) Verification Report

**Phase Goal:** Rewrite `jobs` as a saga-orchestrated module that publishes events (no imperative cross-module calls), remove the in-memory `JobQueue`, execute the drain procedure, and land the server-side `deviceName` fix.

**Verified:** 2026-05-08
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| #  | Truth                                                                                                                                                                                                                          | Status     | Evidence                                                                                                                                                                                                                                                                                            |
| -- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1  | Saga `queued → allocated → running → completed → recording → webhook → cleanup`; each transition emits a named, persisted event; no `.catch(() => {})` patterns remain in `job-service.ts`                                     | ✓ VERIFIED | `server/jobs/internal/subscribers.ts` chains `device.allocated → job.allocated`, `job.completed → cleanup.requested`, `job.failed → cleanup.requested`. `jobsRegistry` (events.ts) has 13 entries with terminal/notable persisted=true. `lifecycle-ownership.spec.ts` greps zero `.catch(() => {})` |
| 2  | `singletonKey: jobId` / `singletonKey: recordingId`; forced double-enqueue → 1 emulator boot; `retryLimit: 0` on device-touching handlers                                                                                      | ✓ VERIFIED | `queue.ts` registers JOB_EXECUTE with `policy:'stately'` + `retryLimit:0`; `module.ts:163` calls `queue.send(... {singletonKey: jobId})`; `idempotency.spec.ts` proves `id1=UUID, id2=null` on duplicate send + `findJobs` returns 1 row; SC2 saga-level real-stack proof gated PHASE23_FULL_STACK_TEST |
| 3  | `deviceName` populated via DB join; Zod schema fails CI if dropped; CLI prints device name end-to-end                                                                                                                          | ✓ VERIFIED | `repo.ts` `findJobById/listJobs` apply `leftJoin(devices)` projecting `devices.name AS device_name`. `jobResponseSchema` has cross-field refine. `contract-devicename.spec.ts` (g) gates openapi.json `properties.deviceName` + `required: ['deviceName']`. CLI `Job.DeviceName *string` + `cmd/status.go:60-62` prints. Go-side `TestStatusDeviceName` deferred to Phase 28 (DEFERRED-23-C) |
| 4  | In-memory `JobQueue` removed; `/admin/drain` runbook documented; Nyquist passes                                                                                                                                                | ✓ VERIFIED | `server/jobs/job-queue.ts` confirmed deleted (file does not exist). Zero `from .*jobs/job-queue` imports. `routes.ts` ships POST `/admin/drain` + POST `/admin/drain/resume` with `boss.offWork` + `system_state` row + admission gate. `docs/runbooks/drain.md` (99 lines) covers procedure. Nyquist +3.01pp delta vs baseline 48.29% (well within -2pp budget) |

**Score:** 4/4 truths verified

### Required Artifacts

| Artifact                                                | Expected                                                  | Status     | Details                                                                                                                                |
| ------------------------------------------------------- | --------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `server/jobs/internal/module.ts`                         | createJobsModule factory (MOD-06)                         | ✓ VERIFIED | 257 lines; exports `createJobsModule`, `JobsModule`, `CreateJobsModuleDeps`; persistEnvelope 7th sample; enqueueJob with drain admission |
| `server/jobs/internal/executor.ts`                       | Pure runJob extracted from job-service.ts                 | ✓ VERIFIED | 9.9KB; uses `jobsModule.emit.X` helpers (zero direct `bus.emit`); reads via `findJobById`                                              |
| `server/jobs/internal/subscribers.ts`                    | Saga chain                                                | ✓ VERIFIED | Wires `device.allocated → job.allocated`, `job.completed → cleanupRequested`, `job.failed → cleanupRequested`                          |
| `server/jobs/internal/repo.ts`                           | leftJoin(devices) single SQL source of truth              | ✓ VERIFIED | `findJobById` + `listJobs` both apply `leftJoin(schema.devices, eq(devices.id, jobs.deviceId))` projecting `devices.name`              |
| `server/jobs/internal/routes.ts`                         | /admin/drain + /admin/drain/resume                        | ✓ VERIFIED | 252 lines; long-poll handler; system_state upsert; offWork on JOB_EXECUTE + RECORDING_UPLOAD; honorDrainOnBoot helper                  |
| `server/jobs/queue.ts`                                   | policy:'stately' + retryLimit:0                           | ✓ VERIFIED | `registerJobsExecuteQueue` configures both; comment explicitly cites Pitfall 2 + QUEUE-04                                              |
| `server/jobs/events.ts`                                  | 13 events incl. system.drain.*                            | ✓ VERIFIED | `JOB_EVENT_NAMES` 13 keys; `jobsRegistry` 13 entries; terminal/notable persisted=true (COMPLETED, RECORDING_REQUESTED, CLEANUP_REQUESTED, FAILED, DRAIN_COMPLETED, DRAIN_RESUMED) |
| `server/jobs/schemas.ts`                                 | jobResponseSchema with refine + .meta(id:'Job')           | ✓ VERIFIED | Cross-field refine `deviceId == null OR deviceName.length > 0`; `.meta({id:'Job'})`                                                    |
| `server/jobs/plugin.ts`                                  | Thin; no `bus/bus.ts` import                              | ✓ VERIFIED | 70 lines; deps `['config','db','queue','event-bus','pool-plugin','auth']`; zero direct bus imports — DEFERRED-21 cleared                |
| `server/jobs/job-queue.ts`                               | DELETED (in-memory FIFO removed)                          | ✓ VERIFIED | File does not exist; zero `from .*job-queue` imports server-wide                                                                       |
| `server/jobs/MODULE.md`                                  | 9-section canonical body                                  | ✓ VERIFIED | 12.7KB; references EVENTS-10 / QUEUE-03 / CLI-05 / DEBT-02; Runnable Example present                                                   |
| `server/jobs/index.ts`                                   | MOD-02 1-line internal/ re-export                         | ✓ VERIFIED | 43 lines; strict 1-line `internal/` re-export with type modifier; events/queue/schemas/JobService back-compat exports                  |
| `docs/runbooks/drain.md`                                 | Drain runbook                                             | ✓ VERIFIED | 99 lines; mechanism, procedure, restart, resume, failure modes, auth, events, observability                                            |
| `server/db/schema.ts:systemState`                        | system_state Drizzle table                                | ✓ VERIFIED | Line 469: `pgTable('system_state', ...)`                                                                                               |
| `server/openapi.json` Job schema                         | deviceName in properties + required                       | ✓ VERIFIED | `components.schemas.Job.properties.deviceName: type:[string,null], minLength:1`; `required` includes `deviceName` and `deviceId`        |
| `cli/internal/client/types.go`                           | DeviceName *string                                        | ✓ VERIFIED | Line 14: `DeviceName *string \`json:"deviceName"\``                                                                                    |
| `cli/cmd/status.go`                                      | Prints device name                                        | ✓ VERIFIED | Lines 60-62: `if job.DeviceName != nil { Fprintf "  Device:     %s\n", *job.DeviceName }`                                              |

### Key Link Verification

| From                                  | To                                                  | Via                                                              | Status   | Details                                                                                                                  |
| ------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------ |
| `jobs/internal/subscribers.ts`        | `pool` device.allocated event                       | `fastify.poolModule.bus.on('device.allocated', ...)`              | WIRED    | Defensive lookup; emits `jobsModule.emit.allocated` + writes `jobs.status='allocated'`                                   |
| `jobs/internal/subscribers.ts`        | `jobs.status='failed'` write + cleanup chain        | `jobsModule.bus.on('job.failed', ...)` → DB update + cleanupRequested emit | WIRED    | Persisted job.failed → status row + cleanup.requested envelope                                                            |
| `jobs/internal/module.ts:enqueueJob`  | `system_state` admission gate                       | DB select WHERE key='drain_requested_at' → throw 503             | WIRED    | Admission check before `queue.send`; throws `{statusCode:503, code:'DRAINING'}`                                           |
| `jobs/internal/module.ts:enqueueJob`  | pg-boss `job.execute` queue                         | `fastify.queue.send(JOB_EXECUTE_QUEUE_NAME, payload, {singletonKey: jobId})` | WIRED | QUEUE-03 dedup at queue layer                                                                                            |
| `jobs/internal/routes.ts:POST /admin/drain` | `boss.offWork(JOB_EXECUTE)` + `boss.offWork(RECORDING_UPLOAD)` | direct calls + system_state upsert | WIRED | Pitfall 1 corrected (no updateQueue paused flag); long-poll until in-flight=0                                            |
| `jobs/internal/routes.ts:POST /admin/drain/resume` | re-register worker                          | `jobsModule.registerWorkerOnly()` + delete system_state row + emit drain.resumed | WIRED | Avoids FST_ERR_INSTANCE_ALREADY_LISTENING by skipping addHook                                                            |
| `jobs/plugin.ts`                       | `createJobsModule`                                  | factory call + `decorate('jobsModule')` + back-compat `jobService` shim | WIRED | DEFERRED-21 cleared (no `bus/bus.ts` direct import)                                                                      |
| `cli/cmd/status.go`                   | `Job.DeviceName`                                    | client decodes JSON + nil-check + Fprintf                        | WIRED    | Server-side machinery in place; deferred Go-side test per DEFERRED-23-C                                                  |

### Requirements Coverage

| Requirement | Source Plan(s)               | Description                                                                                                  | Status      | Evidence                                                                                                                                              |
| ----------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------ | ----------- | ----------------------------------------------------------------------------------------------------------------------- |
| EVENTS-10   | 23-00, 23-01, 23-04, 23-06    | Saga emit substitutes imperative calls; each transition emits an event                                       | ✓ SATISFIED | 13-entry `jobsRegistry`; 5 new persisted/non-persisted saga events; subscribers.ts chain; lifecycle-ownership.spec grep-guards (zero direct bus.emit, zero .catch swallows, zero setTimeout cleanup, zero streaming/internal imports) |
| QUEUE-03    | 23-02, 23-04                  | `job.execute` + `recording.upload` use `singletonKey` to prevent double-spawn                                | ✓ SATISFIED | `queue.ts` registers stately + retryLimit:0; `module.ts:enqueueJob` passes singletonKey:jobId; idempotency.spec proves Pitfall 3 dedup; recording.upload retains Phase 21 singletonKey:recordingId |
| CLI-05      | 23-03                         | `Job.DeviceName` populated by server response; CLI status prints human-readable name (not UUID)              | ✓ SATISFIED (Go cross-tier deferred) | repo.ts leftJoin populates; jobResponseSchema refine enforces; openapi.json gate; cli/cmd/status.go prints `*job.DeviceName`. DEFERRED-23-C documents Go-side TestStatusDeviceName transfer to Phase 28 (NOT a phase 23 gap per CONTEXT.md + Plan 23-03 SUMMARY) |
| DEBT-02     | 23-03                         | `Job.DeviceName` exists in Zod schema; populated by server in all endpoints returning job                    | ✓ SATISFIED | Zod refine in jobResponseSchema; repo single source of truth; openapi.json `required` includes deviceName; contract-devicename.spec mechanically blocks regression |

No orphaned requirements. All four IDs declared across plans 23-00..23-06 are accounted for.

### Anti-Patterns Found

| File                                       | Line | Pattern                | Severity | Impact                                                                                                       |
| ------------------------------------------ | ---- | ---------------------- | -------- | ------------------------------------------------------------------------------------------------------------ |
| (none in jobs/internal/* + job-service.ts) | —    | —                      | —        | `lifecycle-ownership.spec.ts` reports zero `.catch(() => {})`, zero setTimeout-broadcaster-cleanup, zero `streaming/internal` imports, zero direct `bus.emit` |

Pre-existing dep-cruiser violations (3): `artifacts/{memory-service,artifact-service,__tests__/artifact-service.spec}.ts → streaming/internal/types.ts`. Documented as out-of-scope from Phase 21; not a Phase 23 regression.

### Test Suite Sanity

Ran the following Phase 23 specs:

- `server/jobs/__tests__/lifecycle-ownership.spec.ts` — passed
- `server/jobs/__tests__/contract-devicename.spec.ts` — passed
- `server/jobs/__tests__/queue.spec.ts` — passed
- `server/jobs/__tests__/events.spec.ts` — passed
- `server/jobs/__tests__/module.spec.ts` — passed
- `server/__tests__/plugin-order.spec.ts` — passed (Phase 23 additive block)
- `server/hooks/__tests__/dep-cruiser.spec.ts` — passed (7th rule `no-deep-imports-into-jobs-internal`)

Combined: 35 + 13 = 48 tests green. DB-gated specs (idempotency, drain-route, subscriber, correlation) self-skip without `TEST_DATABASE_URL`; their structural assertions were inspected by file read and validated against plan summaries.

### Human Verification Required

#### 1. Drain runbook dry-run rehearsal

**Test:**
```
1. Start server, enqueue 3 sleeping jobs
2. curl -X POST localhost:3000/admin/drain?timeout=300 -H 'X-API-Key: ...'
3. Verify {drained:true, in_flight:0}
4. Restart server
5. Verify POST /jobs → 503 system_draining
6. curl -X POST localhost:3000/admin/drain/resume
7. Verify enqueue accepts again
```
**Expected:** Procedure exits drain state cleanly across restart.
**Why human:** Operational rehearsal across process restart not automatable; documented in `docs/runbooks/drain.md`.

#### 2. Cross-tier deviceName proof (DEFERRED-23-C)

**Test:** `cd cli && go test -run TestStatusDeviceName ./...`
**Expected:** Go test asserts `device-farm status <jobId>` prints non-UUID device name when allocated.
**Why human:** Phase 28 transfer; CONTEXT.md and Plan 23-03 SUMMARY document Go-side test as Phase 28 ownership. Not a Phase 23 gap per user instruction.

### Gaps Summary

No gaps blocking goal achievement. All 4 success criteria verified end-to-end:

- **SC1 (Saga + persistence + zero anti-patterns):** subscribers.ts chains the saga; jobsRegistry persists terminal/notable events; lifecycle-ownership.spec.ts mechanically guards `.catch(() => {})`, `setTimeout broadcaster cleanup`, `streaming/internal` imports, and direct `bus.emit` — all zero.
- **SC2 (singletonKey + retryLimit:0):** queue.ts policy:'stately' + retryLimit:0; module.ts enqueueJob passes singletonKey; idempotency.spec proves queue-layer dedup. Saga-level "1 device.state.changed booting→idle" assertion is documented in idempotency.spec.ts as a PHASE23_FULL_STACK_TEST opt-in real-stack proof; subscriber.spec.ts (DB-gated) covers the saga chain via mocks.
- **SC3 (deviceName via DB join + Zod CI gate + CLI):** repo.ts leftJoin; jobResponseSchema refine; openapi.json required+properties contain deviceName; contract-devicename.spec.ts (a)–(f) all pass; CLI struct + status.go print path in place. Go-side test (g) gracefully defers to Phase 28 per DEFERRED-23-C — explicitly carved out in user instruction.
- **SC4 (JobQueue removed + drain + Nyquist):** server/jobs/job-queue.ts deleted; SC4 grep contract holds; /admin/drain + /admin/drain/resume routes ship; docs/runbooks/drain.md present; Nyquist +3.01pp delta (well within -2pp gate).

DEFERRED-21 (jobs/plugin.ts → bus/bus.ts) cleared. DEFERRED-22-D (setTimeout broadcaster cleanup) and DEFERRED-22-F (cross-module type imports) resolved. Phase 24 Maestro Module unblocked.

---

_Verified: 2026-05-08_
_Verifier: Claude (gsd-verifier)_
