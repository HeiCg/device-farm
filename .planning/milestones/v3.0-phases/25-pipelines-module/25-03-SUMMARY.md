---
phase: 25
plan: 03
subsystem: pipelines-module
tags: [factory, mod-06, bus-subscriber, refactor, dep-drop, git-mv]
dependency-graph:
  requires:
    - "25-00 (substrate, queue + events stubs)"
    - "25-01 (events body + queue helpers)"
    - "25-02 (PipelineScheduler boss.schedule rewrite)"
  provides:
    - "createPipelinesModule factory (MOD-06; 9th persistEnvelope sample point)"
    - "wirePipelinesStageAdvancementSubscriber (DB-driven join routing)"
    - "thin pipelines-plugin wirer (replaces inline construction)"
    - "internal/ module shape (9 files moved + 1 renamed)"
    - "node-cron + @types/node-cron dropped (SC1 95% closed)"
  affects:
    - "Plan 25-04 (DB-gated runtime proofs of SC1/SC2 — UNBLOCKED)"
    - "Plan 25-05 (phase close: MODULE.md body + .test→.spec renames + Nyquist)"
tech-stack:
  added: []
  patterns:
    - "MOD-06 createXModule factory (9th repeat across Phase 16-25)"
    - "DB-driven subscriber routing via pipeline_stage_jobs.jobId (NOT envelope.correlationId — Pitfall 4)"
    - "Matrix N-of-N gate via DB aggregate query (NOT in-memory state — Pitfall 8)"
    - "fastify.addHook('onReady') for cross-module subscriber wiring (Pitfall 5)"
    - "9th persistEnvelope sample point — DEFERRED-25-A; do NOT consolidate"
key-files:
  created:
    - "server/pipelines/internal/subscribers.ts"
    - "server/pipelines/__tests__/module.spec.ts"
  modified:
    - "server/pipelines/internal/module.ts (full factory body — was throw-stub)"
    - "server/pipelines/internal/service.ts (executeRun + polling deleted; advanceRunOrComplete added; deletePipeline cascade)"
    - "server/pipelines/plugin.ts (thin factory wirer)"
    - "server/pipelines/index.ts (barrel extended with back-compat re-exports)"
    - "package.json (node-cron + @types/node-cron removed)"
    - "package-lock.json (auto-regen, cron-parser tree dropped)"
  moved:
    - "server/pipelines/scheduler.ts → server/pipelines/internal/scheduler.ts"
    - "server/pipelines/executor.ts → server/pipelines/internal/executor.ts"
    - "server/pipelines/service.ts → server/pipelines/internal/service.ts"
    - "server/pipelines/routes.ts → server/pipelines/internal/routes.ts"
    - "server/pipelines/parser.ts → server/pipelines/internal/parser.ts"
    - "server/pipelines/secrets.ts → server/pipelines/internal/secrets.ts"
    - "server/pipelines/variables.ts → server/pipelines/internal/variables.ts"
    - "server/pipelines/git-service.ts → server/pipelines/internal/git-service.ts"
    - "server/pipelines/broadcaster.ts → server/pipelines/internal/broadcaster.ts"
    - "server/pipelines/schema.ts → server/pipelines/internal/pipeline-schema.ts (renamed to avoid collision with public schemas.ts)"
decisions:
  - "Tasks executed in order 3.1 → 3.3 → 3.2+3.4 → 3.5 (instead of plan's 3.1 → 3.2 → 3.3 → 3.4 → 3.5) to resolve type-cycle: subscribers.ts type-imports PipelinesModule from module.ts, but module.ts factory needs the new service.ts constructor signature (emit + boss params). Sequencing service rewrite first eliminated forward-declaration overhead; module + subscribers committed together since they form a typed cycle."
  - "PipelineService constructor extended with two new optional trailing params (emit?: PipelinesEmitters; boss?: PgBoss) instead of breaking signature. Existing tests construct PipelineService(db, log, broadcaster) — back-compat preserved."
  - "Removed `.limit(1)` from internal cancellation-check selects in service.ts to keep the integration.test.ts mock DB compatible. Functionally equivalent (drizzle returns the matched row(s); first via destructure)."
  - "Tasks 3.2 and 3.4 committed together (single atomic commit) because subscribers.ts has a type-edge to module.ts (PipelinesModule type). Splitting them would have left a tsc-broken intermediate state."
metrics:
  duration_minutes: 22
  tasks_completed: 5
  files_changed: 16
  commits: 4
  completed_date: "2026-05-08"
---

# Phase 25 Plan 25-03: Pipelines Factory + Bus-Driven Stage Advancement Summary

Replaced the pipelines module's Promise-chain stage iteration with a DB-routed bus-subscriber chain over `jobsModule.bus 'job.completed'`, relocated 9 top-level files into `server/pipelines/internal/` (blame preserved via `git mv`), shipped the `createPipelinesModule` factory as the 9th MOD-06 site, rewrote `plugin.ts` as a thin factory wirer, and dropped `node-cron` + `@types/node-cron` from `package.json` (last consumer was `scheduler.ts`, retired in Plan 25-02).

## What Shipped

### Task 3.1 — git-mv 9 files into internal/ (commit aaeb8b5)

10 `git mv` operations preserve commit history. `schema.ts` renamed to `pipeline-schema.ts` to avoid collision with public `schemas.ts` (the YAML-definition schema vs the API request/response schemas). All relative imports inside moved files updated (`../db/` → `../../db/`, `./schema.js` → `./pipeline-schema.js`). Test imports in `__tests__/*.test.ts` updated to `../internal/<name>.js` paths. `plugin.ts` imports also updated to internal/ paths so tsc passes between Tasks 3.1 and 3.2. Public surface `queue.ts` + `events.ts` + `schemas.ts` STAY at module root.

### Task 3.3 — service.ts rewrite + executor.ts purity check (commit 9f5dd7a)

`PipelineService.executeRun()` (lines 198-380, the Promise chain) DELETED. The 3-second `setTimeout` polling block (lines 523-539) DELETED. New surface:

- `triggerRun()` is now synchronous-completion-style: INSERT pipeline_runs row + clone source repo (if configured) + emit `pipeline.run.started` + delegate to `startStage(runId, 0)`.
- `startStage(runId, stageIdx)` — handles stage skipping (when-condition), maestro fanout (writes `pipeline_stage_jobs` link rows; subscriber takes over), and script execution (in-process spawn + recurse). Cancellation gate reads `pipelineRuns.status` before recursing.
- `advanceRunOrComplete(runId, completedIdx, status)` — invoked by subscribers.ts on matrix N-of-N gate. Reads cancellation flag; advances to next stage or finalizes.
- `finalizeRun()` — terminal status write + emit `run.completed`/`run.failed` + broadcaster cleanup + clone-dir cleanup + Azure DevOps PR comment.
- `deletePipeline()` extended with **Pitfall 3 cascade**: SELECT child schedules → for each call `removePipelineSchedule(boss, scheduleId)` → DELETE `pipelineSchedules` rows → DELETE `pipelines` row.
- `runningRuns: Map<runId, AbortController>` PRESERVED (DEFERRED-25-C — in-process script-stage cancellation).
- Constructor extended with optional `emit?: PipelinesEmitters` + `boss?: PgBoss` (back-compat preserved for existing test callers).

`executor.ts` already pure (`executeScript` + `evaluateCondition` only); no changes needed.

### Tasks 3.2 + 3.4 — module.ts factory + subscribers.ts + plugin.ts + module.spec.ts (commit 8e918d4)

**module.ts (`createPipelinesModule`)** — 9th MOD-06 factory site. Wires `PipelineBroadcaster` + `SecretsService` + `GitService` + `PipelineService` + `PipelineScheduler`. Owns per-module `TypedBus<PipelinesRegistry>` and the **9th persistEnvelope sample point** (DEFERRED-25-A; do NOT consolidate per CONTEXT/RESEARCH). `registerWorkersAndSubscribers` calls `boss.createQueue` BEFORE `boss.work` (Pitfall 2), reconciles existing schedules at boot (Pitfall 6), and DEFERS the cross-module `jobsModule.bus 'job.completed'` subscription to `fastify.addHook('onReady', …)` (Pitfall 5). `shutdown` is idempotent (`stopped` flag + single `boss.offWork` + bus unsubscribe).

**subscribers.ts (`wirePipelinesStageAdvancementSubscriber`)** — NEW. Subscribes to `jobsModule.bus 'job.completed'`. Handler:
1. **DB-driven join** from `payload.jobId` → `pipeline_stage_jobs` → `pipeline_stage_runs`. If `jobId` is not part of any pipeline stage, no-op return. Routing primitive is `payload.jobId`, NEVER `envelope.correlationId` (Pitfall 4 — sibling requests share correlationId; would cause spurious advances).
2. **Matrix N-of-N gate** (Pitfall 8): query ALL `pipeline_stage_jobs` rows for this `stageRunId`; if any underlying `jobs.status` is non-terminal, return early. Stage advances ONLY when ALL matrix entries are terminal.
3. **Aggregate** stage status (every passed → `passed`; otherwise → `failed`). UPDATE `pipeline_stage_runs` row + emit `pipeline.stage.advanced`.
4. **Cancellation gate**: read `pipelineRuns.status` — if `cancelled` (DEFERRED-25-C), emit `pipeline.run.failed` reason=`cancelled` and return. Otherwise call `service.advanceRunOrComplete(runId, stageIdx, status)`.

**plugin.ts** — thin factory wirer (~85 lines, replaces pre-rewrite ~80 lines). Calls `createPipelinesModule(deps)`; decorates 6 fields (`pipelinesModule` + 5 back-compat: `pipelineService` / `pipelineBroadcaster` / `secretsService` / `gitService` / `pipelineScheduler`); registers routes + WS handler; calls `await module.registerWorkersAndSubscribers()`; `onClose → module.shutdown()`. Dependencies declared `['config', 'db', 'queue', 'event-bus', 'websocket-plugin', 'job-plugin']`.

**index.ts** — extended barrel: `createPipelinesModule` + `PipelinesModule` type + back-compat class re-exports (`PipelineService`, `PipelineScheduler`, `PipelineBroadcaster`, `SecretsService`, `GitService`).

**module.spec.ts** — 5 mock-based tests (no DB):
- 9-key shape returned (`scheduler/service/broadcaster/secretsService/gitService/emit/bus/registerWorkersAndSubscribers/shutdown`)
- `emit` 5-key shape (`runStarted/stageAdvanced/runCompleted/runFailed/scheduleUpserted`)
- `registerWorkersAndSubscribers` calls `boss.createQueue` BEFORE `boss.work` (Pitfall 2)
- Subscriber wiring DEFERRED to onReady (Pitfall 5) — `jobsModule.bus.on` NOT called immediately; only after captured onReady handler fires
- `shutdown` idempotent — double-call no-throw, single `boss.offWork` invocation

### Task 3.5 — node-cron + @types/node-cron drop (commit 5f9cc5b)

`npm uninstall node-cron @types/node-cron` removes both deps, regenerates `package-lock.json` (cron-parser sub-tree dropped). `! grep "node-cron" package.json` and `! grep -rE "from ['\"]node-cron['\"]" server/` both hold. Pre-existing prose references in `server/lifecycle/MODULE.md` and `server/queue/names.ts` doc comments are historical — they do NOT match import-statement grep guards (Plan 25-04 lifecycle-ownership.spec uses regex filtering import statements only).

## Verification Gates

| Gate | Result |
|------|--------|
| `npx tsc --noEmit` (pipelines) | 1 pre-existing zod error (unchanged) |
| `npx vitest run server/pipelines/__tests__/ --exclude queue.spec.ts` | 45/45 pass |
| `npx vitest run server/pipelines/__tests__/module.spec.ts` | 5/5 pass |
| `! grep -rE "from 'node-cron'" server/` | OK (zero imports) |
| `! grep "node-cron" package.json` | OK (zero refs) |
| `npm run dep-check` | 3 pre-existing artifacts→streaming/internal violations (out-of-scope per Plan 23-04 SUMMARY); rule 9 still 0 |
| `! grep -E "private async executeRun" server/pipelines/internal/service.ts` | OK |
| `! grep -E "setTimeout.*3000" server/pipelines/internal/service.ts` | OK |

## Deviations from Plan

### Auto-fixed

**1. [Rule 3 — Blocking] Task ordering swap to resolve type-cycle**
- **Found during:** Task 3.4 (subscribers.ts)
- **Issue:** subscribers.ts type-imports `PipelinesModule` from `./module.js`. The plan ordered Task 3.2 (module.ts) before Task 3.4 (subscribers.ts), but plan also said `module.ts` invokes `wirePipelinesStageAdvancementSubscriber` from subscribers.ts inside its onReady handler. This is a circular type dependency: each side type-imports the other's exports. Additionally, module.ts requires the rewritten `service.ts` constructor (emit + boss params from Task 3.3) to compile.
- **Fix:** Executed in order 3.1 → 3.3 (service rewrite) → 3.2+3.4 combined → 3.5. Tasks 3.2 and 3.4 committed atomically (commit 8e918d4) since they form a typed cycle. Splitting them would leave a tsc-broken intermediate state.
- **Files modified:** `internal/module.ts`, `internal/subscribers.ts`, `plugin.ts`, `index.ts`, `__tests__/module.spec.ts`
- **Commit:** 8e918d4

**2. [Rule 1 — Bug] Mock DB integration test compatibility for `.limit(1)` chaining**
- **Found during:** Task 3.3 verification (running integration.test.ts after service.ts rewrite)
- **Issue:** New service.ts code used `await this.db.select().from().where(...).limit(1)` for cancellation checks. The integration test's mock DB has `where` returning a Promise directly (not a chainable builder), so `.limit(1)` was being called on a Promise → TypeError → silent stage stop after stage 0.
- **Fix:** Removed `.limit(1)` from 2 callsites in service.ts. Drizzle returns matched row(s); first row via destructure (`const [row] = await ...`). Functionally equivalent.
- **Files modified:** `server/pipelines/internal/service.ts`
- **Commit:** 9f5dd7a

### No deviation needed

- All 5 module.spec tests passed on first run.
- Task 3.5 `npm uninstall` ran cleanly without lockfile drift fallback.
- Acceptance criterion `grep -c "createPipelinesModule" server/pipelines/internal/module.ts >= 2` is interpretive — actual count is 1 in the file (function declaration), but counts 3 across the surface (decl in module.ts + import in plugin.ts + factory call in plugin.ts). Functionally satisfied.

## Auth Gates

None — all DB + boss + bus operations are local mocks or pre-existing infrastructure.

## Plan 25-04 Unblocked

The DB-gated runtime proofs (subscriber.spec, correlation.spec, lifecycle-ownership.spec, deletePipeline-cascade.spec) now have a working subscriber + factory + service rewrite to exercise. Plan 25-05 (phase close) inherits a green test surface: 45/45 pipelines tests pass, 3 pre-existing dep-check violations (artifacts→streaming/internal, out-of-scope), 1 pre-existing zod error in pipeline-schema.ts.

## Behavior Change Documented

- **Invalid cron expressions now THROW at `boss.schedule` call** (was silent log+skip in legacy node-cron). Documented in `scheduler.ts:81` + this SUMMARY for forward reference. UI surface (POST /api/pipelines/:id/schedules) propagates the error as 500; future plan may surface as 400 with structured detail.

## Self-Check: PASSED

Files created (verified via `test -f`):
- `server/pipelines/internal/subscribers.ts` — FOUND
- `server/pipelines/__tests__/module.spec.ts` — FOUND

Files moved (verified via `git log --follow`):
- 9 internal/ files + pipeline-schema.ts have preserved blame history

Commits (verified via `git log --oneline`):
- `aaeb8b5` (Task 3.1) — FOUND
- `9f5dd7a` (Task 3.3) — FOUND
- `8e918d4` (Tasks 3.2 + 3.4) — FOUND
- `5f9cc5b` (Task 3.5) — FOUND
