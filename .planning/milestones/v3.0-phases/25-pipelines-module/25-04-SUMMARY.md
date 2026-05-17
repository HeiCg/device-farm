---
phase: 25
plan: 04
subsystem: pipelines-module
tags: [test-only, db-gated-spec, grep-guards, sc1-proof, sc2-proof, trace-04, trace-09]
dependency-graph:
  requires:
    - "25-00 (substrate, queue + events stubs)"
    - "25-01 (events body + queue helpers)"
    - "25-02 (scheduler boss.schedule rewrite)"
    - "25-03 (factory + subscriber + service rewrite + node-cron drop)"
  provides:
    - "DB-gated SC2 runtime proof — 3-stage sequential + matrix N-of-N gate (subscriber.spec)"
    - "DB-gated TRACE-04 + TRACE-09 proof — single correlationId threads pipeline run (correlation.spec)"
    - "Filesystem grep-guards SC1 + SC2 — zero node-cron + zero polling (lifecycle-ownership.spec)"
  affects:
    - "Plan 25-05 (phase close: MODULE.md body + .test→.spec renames + plugin-order extension + Nyquist gate) — UNBLOCKED"
tech-stack:
  added: []
  patterns:
    - "DB-gated spec gating via describe.skipIf + TEST_DATABASE_URL/DATABASE_URL"
    - "Stub jobs-plugin (real TypedBus + makeJobsEmitters + jobService.createJob shim) for cross-module bus subscriber proofs"
    - "Stub websocket-plugin (registers @fastify/websocket) to satisfy pipelines plugin dep"
    - "fastify-zod-openapi root-scope install (validatorCompiler+serializerCompiler+plugin) before pipelinesPlugin registration (Phase 19-05 pattern)"
    - "Persistence side-channel envelope capture via bus.ee.on('${type}.envelope', ...) (Phase 22 streaming pattern)"
    - "Filesystem grep-guards (readFileSync + walkServer recursion) with stripComments helper to avoid JSDoc false positives"
    - "Direct DB seeding (pipeline_runs + pipeline_stage_runs + pipeline_stage_jobs + jobs) to sidestep pipeline-schema.ts:17 pre-existing Zod v4 incompat in matrix path"
    - "Maestro stage flows path: relative-to-cwd (fanoutMaestroStage joins workDir + flows; absolute paths yield malformed concat)"
key-files:
  created:
    - "server/pipelines/__tests__/subscriber.spec.ts (533 lines, 2 DB-gated tests, ~1.5s with DB / skip without)"
    - "server/pipelines/__tests__/correlation.spec.ts (368 lines, 1 DB-gated test, ~0.4s with DB / skip without)"
    - "server/pipelines/__tests__/lifecycle-ownership.spec.ts (109 lines, 4 filesystem tests, <100ms)"
  modified: []
decisions:
  - "Test 4.1(b) matrix N-of-N gate sidesteps service.triggerRun by seeding pipeline_runs + stageRun + 3 stageJobs + 3 jobs directly. Reason: pipeline-schema.ts:17 declares matrix as `z.array(z.record(z.unknown()))`, the v3 single-arg form, which throws under installed Zod v4 (TypeError: Cannot read properties of undefined reading '_zod'). The bug is pre-existing (documented as 'pre-existing zod error' in 25-03-SUMMARY Verification Gates) and out of scope for this plan (production code edits forbidden — 'NO production code edits in this plan'). Direct seeding exercises the same subscriber code path verbatim — DB-join routing + matrix gate aggregation + advanceRunOrComplete fallthrough to finalizeRunFromDb."
  - "Stub jobs-plugin reuses real makeJobsEmitters (not a mock) so emit.completed fires real bus events with correct envelopes (correlationId, aggregateType, persisted-flag short-circuit). Persists job.completed events to events table (mirrors real bus/plugin.ts onPersisted pipeline)."
  - "Maestro stage flowsDir is RELATIVE to process.cwd() not the system tmpdir. Reason: fanoutMaestroStage builds `${ctx.workDir}/${stage.flows}` (service.ts:626). When ctx.workDir is process.cwd() and stage.flows is absolute /var/folders/..., the concat yields `${cwd}/${absolutePath}` which fails readdir. Relative paths work cleanly."
  - "lifecycle-ownership.spec self-excludes itself from the node-cron grep (it contains the regex literal `from 'node-cron'` in source). Same pattern Phase 23 jobs/lifecycle-ownership.spec uses for its anti-pattern strings."
  - "Test cleanup deletes only the rows OUR tests created (jobs by id from pipeline_stage_jobs link rows; pipeline-* tables truncated; events.aggregateType='pipeline-run' only). Naive DELETE FROM jobs failed under FK constraints from job_steps/artifacts/test_executions (historical pollution in shared device_farm dev DB)."
metrics:
  duration_minutes: 19
  tasks_completed: 3
  files_changed: 3
  commits: 3
  completed_date: "2026-05-08"
---

# Phase 25 Plan 25-04: DB-Gated Runtime Proofs of SC1/SC2 Summary

Three new spec files prove SC1 + SC2 + TRACE-04 + TRACE-09 at runtime via DB-gated tests (subscriber + correlation) plus filesystem grep-guards (lifecycle-ownership). Zero production code edits. Plan 25-05 phase-close unblocked.

## What Shipped

### Task 4.1 — subscriber.spec.ts (commit 489cc58)

`server/pipelines/__tests__/subscriber.spec.ts` (533 lines, 2 DB-gated tests).

**Test (a) — 3-stage sequential pipeline completes via bus events.**
- Inserts a 3-stage maestro pipeline definition.
- Calls `service.triggerRun(pipelineId, 'manual', {})` → INSERT pipeline_runs row + first stage's stageRun + 1 stageJob link + 1 jobs row (via stub jobService.createJob).
- For each stage in turn (0, 1, 2): UPDATE jobs.status='passed' → `jobsModule.emit.completed(...)` → subscriber DB-joins via `pipeline_stage_jobs.jobId` → marks stageRun 'passed' → calls `service.advanceRunOrComplete(...)` → next stage starts (or finalizes on stage 2).
- Asserts: final `pipelineRuns.status='passed'`, all 3 stageRuns 'passed', persisted `pipeline.run.completed` row in events table.
- Critical: NO local Promise chain involved. The test never awaits an `executeRun(...)` Promise. State convergence is purely event-driven through DB updates + bus fires.

**Test (b) — Matrix N-of-N gate (Pitfall 8).**
- Seeds DB directly (sidesteps `triggerRun` → `parsePipeline` → matrix Zod incompat): pipelines + pipeline_runs + 1 pipeline_stage_runs + 3 jobs + 3 pipeline_stage_jobs link rows.
- Fires `job.completed` for first 2 of 3 jobs → `stageRun.status` STAYS 'running' (gate held).
- Fires 3rd → subscriber sees all 3 jobs.status='passed' → marks stageRun 'passed' → advanceRunOrComplete falls through to finalizeRunFromDb (no in-memory runContext) → run.status='passed'.

**Harness:** config (stub) + correlation + db (live drizzle) + event-bus + queue (isolated `pgboss_pipelines_sub_<suffix>` schema) + auth-stub + pool (drivers disabled) + stub-websocket-plugin (registers @fastify/websocket) + stub-jobs-plugin (decorates `jobsModule` with real TypedBus + makeJobsEmitters + persist-to-events; decorates `jobService` with createJob shim that inserts a real jobs row) + real `pipelinesPlugin`. Mirrors Phase 21 artifacts/subscriber.spec + Phase 24 maestro/subscriber.spec patterns. fastify-zod-openapi validator+serializer+plugin installed at root scope (Phase 19-05 pattern) so pipelines routes register cleanly.

### Task 4.2 — correlation.spec.ts (commit 3b7f20c)

`server/pipelines/__tests__/correlation.spec.ts` (368 lines, 1 DB-gated test).

**Test — single correlationId threads through 3-stage run + every emitted pipelines envelope.**
- Generates `cid = randomUUID()`.
- Wraps `service.triggerRun(pipelineId, 'manual', {})` in `asyncLocalStorage.run({correlationId: cid, currentEventId: null, actor: 'pipelines-correlation-spec'}, ...)` so `pipeline.run.started` envelope inherits cid via `createEventHelpers`/`readAls` (server/bus/helpers.ts).
- For each stage (0, 1, 2): UPDATE jobs.status='passed' + emit `job.completed` INSIDE another ALS frame with the same cid so the subscriber-side re-emit (`pipeline.stage.advanced`) and the chained `service.advanceRunOrComplete` (which may emit `pipeline.run.completed` on the final stage) inherit cid.
- Captures envelopes via `pipelinesModule.bus.ee.on('${type}.envelope', ...)` for run.started, stage.advanced, run.completed, run.failed (persistEnvelope side-channel — Phase 22 envelope.spec pattern).
- Asserts: ≥5 envelopes captured (run.started + 3× stage.advanced + run.completed); ALL share `correlationId === cid`; persisted `pipeline.run.completed` row in events table also carries cid (TRACE-08).

### Task 4.3 — lifecycle-ownership.spec.ts (commit 76142ae)

`server/pipelines/__tests__/lifecycle-ownership.spec.ts` (109 lines, 4 filesystem-only tests, <100ms total).

**Test 1 (SC1):** Walks every `.ts` under `server/`, asserts ZERO files match `from 'node-cron'`. Self-excludes the spec file (which contains the regex literal in its source).

**Test 2 (SC2):** `readFileSync` `server/pipelines/internal/executor.ts`, asserts the file holds NO references to `pipeline.stages` iteration, `pipelineRuns` table, or `triggerRun`. Confirms executor is pure (`executeScript` + `evaluateCondition` only).

**Test 3 (SC2):** `readFileSync` `server/pipelines/internal/service.ts`, asserts ZERO matches for `setInterval`, the exact polling pattern `await new Promise(r => setTimeout(r, 3000))` from pre-rewrite line 524, and the polling-with-deadline regex `/jobs\.status[\s\S]*deadline/`.

**Test 4 (SC1):** Parses `package.json`, asserts `dependencies['node-cron']` AND `devDependencies['@types/node-cron']` are both `undefined`.

Comments are stripped via `stripComments` (block + line) before pattern matching so JSDoc references to anti-patterns (e.g. `// Polling loop (3s setTimeout) DELETED`) do NOT cause false positives. DB-FREE; runs in any environment.

## Verification Gates

| Gate | Result |
|------|--------|
| `npx vitest run server/pipelines/__tests__/lifecycle-ownership.spec.ts` (no DB) | 4/4 pass <100ms |
| `DATABASE_URL=$DB rtk proxy "npx vitest run server/pipelines/__tests__/{subscriber,correlation}.spec.ts"` | 3/3 pass ~1.9s |
| Without DATABASE_URL: subscriber + correlation skip cleanly | 4 lifecycle pass + 3 DB-gated skipped |
| `DATABASE_URL=$DB rtk proxy "npx vitest run server/pipelines/__tests__/"` (full suite) | 11 files / 59 tests pass / 12.43s |
| `npx tsc --noEmit` for new spec files | 0 new errors |
| File-existence + grep-guards | All `test -f` + grep counts as specified in plan acceptance criteria |

## SC1 + SC2 Closure (ROADMAP Phase 25)

**SC1 fully closed at runtime:**
- `lifecycle-ownership.spec` Test 1 + Test 4 prove zero `node-cron` imports in `server/` AND zero `node-cron`/`@types/node-cron` in `package.json`.
- Plan 25-02's `queue.spec` already proved boss.schedule idempotent upsert (SC1 main clause) + Pitfall 3 unschedule cascade.

**SC2 fully closed at runtime:**
- `subscriber.spec` Test (a) proves 3-stage sequential pipeline completes via bus events alone — no local Promise chain.
- `subscriber.spec` Test (b) proves matrix N-of-N gate holds at 1/3 + 2/3 and releases at 3/3 (Pitfall 8).
- `correlation.spec` proves single correlationId threads from `triggerRun` through stage 1 → 2 → 3 → completion across every emitted pipelines envelope AND the persisted events-table row.

## Deviations from Plan

### Auto-fixed

**1. [Rule 3 — Blocking] Pre-existing pipeline-schema.ts:17 Zod v4 incompat blocked matrix-stage `triggerRun` path**
- **Found during:** Task 4.1 Test (b) — running the matrix test through `service.triggerRun` threw `TypeError: Cannot read properties of undefined (reading '_zod')` from `parsePipeline` → `pipelineDefSchema.safeParse`.
- **Issue:** `pipeline-schema.ts:17` declares `matrix: z.array(z.record(z.unknown())).optional()` — the Zod v3 single-arg form. Under installed Zod v4, `z.record()` requires 2 args (key+value schemas) and the single-arg call panics on access. Documented as pre-existing in 25-03-SUMMARY Verification Gates ("`npx tsc --noEmit` (pipelines) | 1 pre-existing zod error (unchanged)").
- **Fix:** Test (b) sidesteps `triggerRun` by seeding pipelines + pipeline_runs + 1 stageRun + 3 jobs + 3 stageJob link rows directly via DB inserts. This exercises the SUBSCRIBER code path (subscribers.ts:36-128 — DB-join routing + matrix gate aggregation + advanceRunOrComplete fallthrough to finalizeRunFromDb) verbatim, which is what the plan's intent requires (proof of SC2 + Pitfall 8). Production code edits forbidden in Plan 25-04 (`NO production code edits in this plan`); the Zod v4 fix is logged as out-of-scope and inherits Plan 25-03's "1 pre-existing zod error" status.
- **Files modified:** `server/pipelines/__tests__/subscriber.spec.ts` (only)
- **Commit:** 489cc58

**2. [Rule 3 — Blocking] Maestro stage flowsDir absolute path causes readdir to fail**
- **Found during:** Task 4.1 Test (a) — first run produced silent `Maestro stage fanout failed: ENOENT: no such file or directory, scandir '/Users/heicg/Desktop/projects/device-farm//var/folders/...'` from `fanoutMaestroStage`.
- **Issue:** `service.ts:626` builds `${ctx.workDir}/${stage.flows}`. With `ctx.workDir = process.cwd()` and `stage.flows` set to a system tmpdir absolute path (`/var/folders/...`), the concat yields a malformed `${cwd}/${absolutePath}` that doesn't exist on disk.
- **Fix:** Place flows directory under `process.cwd()` and use a RELATIVE path (`tmp-df-flows-<uuid>`) in `stage.flows`. The concat resolves to `${cwd}/tmp-df-flows-<uuid>` which is the real directory.
- **Files modified:** `server/pipelines/__tests__/subscriber.spec.ts` (only)
- **Commit:** 489cc58 (combined with fix above)

**3. [Rule 3 — Blocking] Naive `DELETE FROM jobs` failed under FK constraints from historical pollution**
- **Found during:** Task 4.1 — first cleanup attempt threw `update or delete on table "jobs" violates foreign key constraint "job_steps_job_id_jobs_id_fk" on table "job_steps"`.
- **Issue:** The shared `device_farm` dev DB holds historical jobs with FKs from `job_steps` / `artifacts` / `test_executions`. Wiping all `jobs` is unsafe.
- **Fix:** Cleanup deletes only the test-created jobs by joining via `pipeline_stage_jobs.jobId` (capture before truncating link rows), and only the `pipeline-run` aggregate-type events. This isolates the test's footprint without touching unrelated rows.
- **Files modified:** `server/pipelines/__tests__/subscriber.spec.ts` + mirrored in `correlation.spec.ts`
- **Commits:** 489cc58 + 3b7f20c

**4. [Rule 2 — Critical] Pipelines routes need fastify-zod-openapi compilers**
- **Found during:** Task 4.1 first run — `app.ready()` threw `FastifyError: Failed building the validation schema for POST: /api/pipelines, due to error schema is invalid: data/maxLength must be integer`.
- **Issue:** `pipelinesPlugin` registers Zod-typed routes via `fastify-zod-openapi`. Fastify needs `validatorCompiler` + `serializerCompiler` + `fastifyZodOpenApiPlugin` installed at root scope BEFORE plugin registration, otherwise it tries to JSON-Schema-validate the Zod schemas and fails.
- **Fix:** Mirror Phase 19-05 pattern — install compilers before any plugin register call. Same code as `server/reporting/__tests__/correlation.spec.ts:89-91`.
- **Files modified:** `server/pipelines/__tests__/subscriber.spec.ts` + mirrored in `correlation.spec.ts`
- **Commits:** 489cc58 + 3b7f20c

### No deviation needed

- All 4 lifecycle-ownership tests passed first run; the only adjustment was self-exclusion of the spec file from the `node-cron` grep (anticipated, mirrors Phase 23 jobs/lifecycle-ownership.spec).
- correlation.spec passed first run — ALS context propagation worked as designed across `triggerRun` + every stage's `job.completed` re-emit.

## Auth Gates

None — DB + boss + bus operations are local, and queue plugin schema isolation prevents cross-test interference.

## Plan 25-05 Unblocked

The DB-gated runtime proofs are now in place. Plan 25-05 (phase close) can now run:
- MODULE.md body (9 H2 sections + Runnable Example, MOD-01)
- Barrel index.ts extension (MOD-02 strict re-export)
- `.test.ts → .spec.ts` renames via `git mv` 100% similarity (MOD-04)
- plugin-order.spec extension with Phase 25 additive block
- deferred-items.md catalog
- Nyquist gate
- STATE.md / ROADMAP.md updates

## Self-Check: PASSED

Files created (verified via `test -f`):
- `server/pipelines/__tests__/subscriber.spec.ts` — FOUND
- `server/pipelines/__tests__/correlation.spec.ts` — FOUND
- `server/pipelines/__tests__/lifecycle-ownership.spec.ts` — FOUND

Commits (verified via `git log --oneline`):
- `76142ae` (Task 4.3 lifecycle-ownership.spec) — FOUND
- `489cc58` (Task 4.1 subscriber.spec) — FOUND
- `3b7f20c` (Task 4.2 correlation.spec) — FOUND

Acceptance criteria:
- `grep -c "TEST_DATABASE_URL" subscriber.spec.ts` = 1 (≥1 required)
- `grep -c "describe.skipIf" subscriber.spec.ts` = 1 (≥1 required; describe.skipIf is the modern equivalent of describe.skip)
- `grep -c "matrix" subscriber.spec.ts` ≥ 6 (≥2 required for Pitfall 8 N-of-N)
- `grep -c "3-stage" subscriber.spec.ts` ≥ 1 (≥1 required) — present in test name
- `grep -c "requestContext\|asyncLocalStorage" correlation.spec.ts` ≥ 1 (≥1 required)
- `grep -c "correlationId" correlation.spec.ts` ≥ 5 (≥5 required)
- `grep -c "envelope" correlation.spec.ts` ≥ 3 (≥3 required)
- `grep -c "readFileSync" lifecycle-ownership.spec.ts` ≥ 4 (≥4 required, 4 tests use it)
- `grep -c "node-cron" lifecycle-ownership.spec.ts` ≥ 2 (≥2 required, 2 tests reference it)
- All test counts: subscriber 2/2 pass, correlation 1/1 pass, lifecycle 4/4 pass = 7/7 (DB present); 4/4 lifecycle + 3 skipped (DB absent)
- Test runtime: lifecycle <100ms, subscriber <2s, correlation <0.5s
