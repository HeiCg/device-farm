---
phase: 23
slug: jobs-module-keystone
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-08
---

# Phase 23 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 3.x with `@vitest/coverage-v8` |
| **Config file** | `vitest.config.ts` (root, existing) |
| **Quick run command** | `npx vitest run server/jobs/__tests__/` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~30s quick, ~60s wave-merge, ~3-4min full suite (DB-gated specs run only when `TEST_DATABASE_URL`/`DATABASE_URL` set) |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run server/jobs/__tests__/<just-changed>.spec.ts` (typically <30s).
- **After every plan wave:** Run `npx vitest run server/jobs/ server/__tests__/plugin-order.spec.ts server/hooks/__tests__/dep-cruiser.spec.ts` (~30-60s).
- **Phase gate (Plan 23-07 phase close):** Full `npm test` green excluding inherited DEFERRED-17-A failures (`server/api/__tests__/routes.test.ts` + `server/artifacts/__tests__/artifact-routes.test.ts` + `server/auth/__tests__/auth-plugin.test.ts`); `npm run dep-check` clean (zero violations — resolves long-standing `jobs/plugin.ts → bus/bus.ts` violation); `npm run lint` clean; `npx tsc --noEmit` 0 NEW errors (8 inherited Phase 15 Map-vs-RequestContext + working-tree errors unchanged); `npm run nyquist:check` exit 0 (delta ≥ -2pp).
- **Max feedback latency:** 60s (wave-merge command).

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 23-00-01 | 00 | 0 | (substrate) `systemState` table on schema | unit (drizzle) | `npx tsc --noEmit && npx drizzle-kit push --dry-run` | ❌ W0 | ⬜ pending |
| 23-00-02 | 00 | 0 | EVENTS-10 placeholder — `JOB_EVENT_NAMES` extends to 11 keys | unit | `npx vitest run server/jobs/__tests__/events.spec.ts` | ❌ W0 | ⬜ pending |
| 23-00-03 | 00 | 0 | `internal/module.ts` throw-stub resolvable for dep-cruiser | unit | `npm run dep-check` (substrate target) | ❌ W0 | ⬜ pending |
| 23-00-04 | 00 | 0 | dep-cruiser 7th rule `no-deep-imports-into-jobs-internal` fires | unit | `npx vitest run server/hooks/__tests__/dep-cruiser.spec.ts` | ❌ W0 | ⬜ pending |
| 23-00-05 | 00 | 0 | `server/queue/names.ts` adds `JOB_EXECUTE: 'job.execute'` if missing | unit | `npx vitest run server/queue/__tests__/names.spec.ts` | ✅ extend | ⬜ pending |
| 23-01-01 | 01 | 1 | EVENTS-10 — 5 new event payload schemas (`job.allocated/running/recording.requested/cleanup.requested/failed`) | unit | `npx vitest run server/jobs/__tests__/events.spec.ts` | ❌ W0 from 00 | ⬜ pending |
| 23-01-02 | 01 | 1 | EVENTS-10 — `makeJobsEmitters` returns 11 typed helpers; ALS correlationId stamp + actor; TRACE-08 persistence flags correct | unit | Same spec | ❌ W0 from 00 | ⬜ pending |
| 23-02-01 | 02 | 2 | QUEUE-03 — `JOB_EXECUTE_QUEUE_NAME` registered with `policy:'stately'` + `singletonKey:jobId`; `RECORDING_UPLOAD` already has `singletonKey:recordingId` (Phase 21) | unit | `npx vitest run server/jobs/__tests__/queue.spec.ts` | ❌ Plan 23-02 | ⬜ pending |
| 23-02-02 | 02 | 2 | QUEUE-03 — duplicate `boss.send` returns null (deduped) on stately + singletonKey | integration (DB) | `npx vitest run server/jobs/__tests__/idempotency.spec.ts` | ❌ Plan 23-02 | ⬜ pending |
| 23-03-01 | 03 | 2 | CLI-05 / DEBT-02 — Drizzle `leftJoin(devices)` populates `deviceName` in repo; route response carries it | unit | `npx vitest run server/jobs/__tests__/contract-devicename.spec.ts` | ❌ Plan 23-03 | ⬜ pending |
| 23-03-02 | 03 | 2 | CLI-05 / DEBT-02 — Zod refinement `deviceId == null OR deviceName.length > 0` rejects malformed shape | unit | Same spec | ❌ Plan 23-03 | ⬜ pending |
| 23-03-03 | 03 | 2 | CLI-05 / DEBT-02 — `server/openapi.json` Job schema has `deviceName` in `properties`; CI test fails if dropped | unit | Same spec (file read assertion) | ❌ Plan 23-03 | ⬜ pending |
| 23-03-04 | 03 | 2 | CLI-05 — Go CLI status displays device name (cross-tier proof, FALLBACK to DEFERRED-23-C if Go test surface unreachable) | manual / Go test | `cd cli && go test -run TestStatusDeviceName ./...` | ❌ Plan 23-03 attempt | ⬜ pending |
| 23-04-01 | 04 | 3 | EVENTS-10 — `createJobsModule` factory shape (emit/bus/registerWorkersAndSubscribers/shutdown/getInFlightCount/enqueueJob) | unit | `npx vitest run server/jobs/__tests__/module.spec.ts` | ❌ Plan 23-04 | ⬜ pending |
| 23-04-02 | 04 | 3 | EVENTS-10 — saga subscribers chain: `device.allocated → job.allocated row write`, `job.completed → recording + webhook fire`, `job.failed → cleanup` | integration (DB) | `npx vitest run server/jobs/__tests__/subscriber.spec.ts` | ❌ Plan 23-06 | ⬜ pending |
| 23-04-03 | 04 | 3 | DEBT-02 / SC4 — `server/jobs/job-queue.ts` deleted; in-memory FIFO no longer imported anywhere | unit (grep) | `! grep -r "from .*job-queue" server/` | ❌ Plan 23-04 | ⬜ pending |
| 23-04-04 | 04 | 3 | SC2 stricter — forced double-enqueue produces exactly 1 `device.state.changed{from:booting, to:idle}` for that jobId | integration (DB) | `npx vitest run server/jobs/__tests__/idempotency.spec.ts` (extends Plan 23-02 spec) | ❌ Plan 23-04 | ⬜ pending |
| 23-05-01 | 05 | 3 | (drain) `POST /admin/drain` writes `system_state.drain_requested_at` row + invokes `boss.offWork(JOB_EXECUTE)` | integration (DB) | `npx vitest run server/jobs/__tests__/drain-route.spec.ts` | ❌ Plan 23-05 | ⬜ pending |
| 23-05-02 | 05 | 3 | (drain) Long-poll returns `{drained:true}` once `getInFlightCount()=0`; honors `?timeout=300` cap | integration (DB) | Same spec | ❌ Plan 23-05 | ⬜ pending |
| 23-05-03 | 05 | 3 | (drain admission) `POST /jobs` returns 503 with `{error: 'system_draining'}` when drain row is present | integration (DB) | Same spec | ❌ Plan 23-05 | ⬜ pending |
| 23-05-04 | 05 | 3 | (drain) `POST /admin/drain/resume` clears row + emits `system.drain.resumed`; queue accepts new sends after | integration (DB) | Same spec | ❌ Plan 23-05 | ⬜ pending |
| 23-05-05 | 05 | 3 | (drain) `system.drain.completed` event persisted to events table; correlationId threaded | integration (DB) | Same spec | ❌ Plan 23-05 | ⬜ pending |
| 23-06-01 | 06 | 4 | EVENTS-10 — single correlationId threads `enqueueJob → ALS.run → job.queued → device.allocated → job.allocated → job.running → job.completed → recording + webhook subscribers → job.cleanup.requested` | integration (DB) | `npx vitest run server/jobs/__tests__/correlation.spec.ts` | ❌ Plan 23-06 | ⬜ pending |
| 23-06-02 | 06 | 4 | SC1 — readFileSync grep-guards on `job-service.ts` (or its successor `internal/executor.ts`): zero `.catch(() => {})`, zero `setTimeout(...broadcaster.*cleanup`, zero `from '../streaming/internal/`, zero direct `bus.emit(` outside factory | unit (readFileSync) | `npx vitest run server/jobs/__tests__/lifecycle-ownership.spec.ts` | ❌ Plan 23-06 | ⬜ pending |
| 23-06-03 | 06 | 4 | EVENTS-10 — saga subscribers chain DB proof | integration (DB) | `npx vitest run server/jobs/__tests__/subscriber.spec.ts` | ❌ Plan 23-06 | ⬜ pending |
| 23-07-01 | 07 | 5 | MOD-04 — existing `*.test.ts` renamed via `git mv` 100% similarity (job-service.spec.ts blame preserved) | manual git verification | `git log --follow server/jobs/__tests__/job-service.spec.ts \| head -5` | ❌ Plan 23-07 | ⬜ pending |
| 23-07-02 | 07 | 5 | MOD-01 — `MODULE.md` 9-section canonical body + Runnable Example | unit (file read) | `grep -cE '^## (Purpose\|Public API\|Events Emitted\|Events Consumed\|Queue Produced\|Queue Consumed\|Invariants\|Non-Goals\|Dependencies)$' server/jobs/MODULE.md` returns 9 | ❌ Plan 23-07 | ⬜ pending |
| 23-07-03 | 07 | 5 | MOD-02 — `index.ts` strict 1-line internal/ re-export with inline `type` modifier | unit (file read) | `grep -c "from '\.\/internal\/" server/jobs/index.ts` ≥ 1; no other module deep imports | ❌ Plan 23-07 | ⬜ pending |
| 23-07-04 | 07 | 5 | (additive plugin-order) jobs plugin position + dependencies array literal `['config','db','queue','event-bus','pool-plugin','auth']` | unit | `npx vitest run server/__tests__/plugin-order.spec.ts` | ✅ extend | ⬜ pending |
| 23-07-05 | 07 | 5 | (deferred-items.md) Phase 23 catalog: 4 new + 2 inherited | manual file read | `grep -c "DEFERRED-23-" .planning/phases/23-jobs-module-keystone/deferred-items.md` ≥ 4 | ❌ Plan 23-07 | ⬜ pending |
| 23-07-06 | 07 | 5 | Nyquist gate — `npm run nyquist:check` exit 0; baseline file unchanged | gate | `npm run nyquist:check && diff -s .planning/nyquist-baseline.json <prior commit>` | ✅ existing | ⬜ pending |
| 23-07-07 | 07 | 5 | dep-check — long-standing `jobs/plugin.ts → bus/bus.ts` violation cleared (zero violations) | gate | `npm run dep-check` exit 0 | ✅ existing | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `server/db/schema.ts` — append `systemState` table (`key TEXT PRIMARY KEY, value JSONB, updated_at TIMESTAMPTZ`)
- [ ] `server/db/migrations/<NNNN>_system_state.sql` — generated via `drizzle-kit generate`
- [ ] `server/jobs/internal/module.ts` — 10-line throw-stub for dep-cruiser resolvable target (Phase 18/19/20/21 empirical pattern)
- [ ] `server/jobs/events.ts` — extend `JOB_EVENT_NAMES` + `jobsRegistry` to 11 entries (existing 6 + 5 new placeholders; bodies in Plan 23-01)
- [ ] `server/jobs/queue.ts` — placeholder `JOB_EXECUTE_QUEUE_NAME` alias only (body in Plan 23-02)
- [ ] `server/jobs/MODULE.md` — placeholder Purpose section (full body in Plan 23-07)
- [ ] `server/jobs/index.ts` — barrel placeholder (1-line `internal/` re-export — MOD-02)
- [ ] `server/jobs/__tests__/events.spec.ts` — registry shape spec (count=11, EVENTS-03 dotted past-tense, no duplicates)
- [ ] `.dependency-cruiser.cjs` — 7th rule `no-deep-imports-into-jobs-internal` (forbidden + allowExceptions for `internal/module.ts` itself + `index.ts` re-export)
- [ ] `__fixtures__/dep-cruiser/bad-jobs-deep-import.ts` — fixture file with `@ts-expect-error` import that fires the rule
- [ ] `server/hooks/__tests__/dep-cruiser.spec.ts` — extend with 7th rule check (third describe block; two-pass err+json pattern matching Phase 21 precedent)
- [ ] `server/queue/names.ts` — verify `JOB_EXECUTE: 'job.execute'` present; add if missing (alphabetized between `DEVICE_REAP` and `LIFECYCLE_RETENTION_DAILY`)

*Wave 0 covers all MISSING references for Phase 23 spec files. Spec files in waves 1-4 reference these substrate paths.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Drain runbook dry-run rehearsal | (drain) | Operational rehearsal across server restart not automatable in unit/integration test surface | (1) Start server, enqueue 3 sleeping jobs; (2) `curl -X POST localhost:3000/admin/drain?timeout=300 -H 'X-API-Key: ...'`; (3) Verify response `{drained:true, in_flight:0}` after jobs finish; (4) Restart server; (5) Verify `enqueueJob` rejects 503; (6) `curl -X POST localhost:3000/admin/drain/resume`; (7) Verify enqueue accepts. Dry-run procedure documented in Plan 23-05 deliverable `docs/runbooks/drain.md`. |
| Phase-23 dep-check clean | (mod-cleanup) | dep-cruiser tracks across modules and final clean-up of Phase 19+ violation requires all 4 plans landed | After Plan 23-07: `npm run dep-check` returns exit 0 with zero violations (currently 1 inherited from Plan 19-01) |
| CLI cross-tier deviceName proof (Go) | CLI-05 / DEBT-02 | If Go test infrastructure unreachable in autonomous mode | If Go side reachable: `cd cli && go test -run TestStatusDeviceName ./...`. If unreachable: documented in DEFERRED-23-C and ownership transfers to Phase 28. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s (wave-merge command)
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
