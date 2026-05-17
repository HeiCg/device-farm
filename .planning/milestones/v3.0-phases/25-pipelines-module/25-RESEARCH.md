# Phase 25: Pipelines Module — Research

**Researched:** 2026-05-08
**Domain:** pg-boss v12 schedule lifecycle (per-pipeline upsert/unschedule), bus-driven pipeline-run state machine via `job.completed` subscriber, full canonical module shape (MOD-01..09), final node-cron removal
**Confidence:** HIGH — Phase 18/22/23/24 are committed precedents; pg-boss v12 schedule API verified in Phase 18 RESEARCH against `node_modules/pg-boss/dist/timekeeper.{d.ts,js}`; current pipelines code read in full; jobs `job.completed` event surface stable since Phase 19.

---

## Summary

Phase 25 closes the pg-boss-as-sole-scheduler loop by migrating `server/pipelines/scheduler.ts` (the LAST node-cron consumer in the tree — verified by repository-wide grep) to `boss.schedule()` AND replaces the in-process Promise-chain executor in `service.ts`/`executor.ts` with a `job.completed` bus subscriber that drives stage advancement off persisted DB state. The phase also fully restructures `server/pipelines/` into the canonical Phase 16 module shape (MODULE.md + barrel + events.ts + queue.ts + internal/ + tests-as-spec + factory).

Two distinct migrations are coupled here intentionally — both touch `service.ts` (20.8KB, the largest file), and splitting them across phases would require an unstable hybrid where the Promise chain still runs while a new schedule path enqueues fresh runs. Locking them in one phase preserves the "no hybrid state in main" rule (Phase 22/23/24 precedent).

**Primary recommendation:** Mirror Phase 18 (lifecycle) for the scheduler half and Phase 23 (jobs) for the bus-subscriber half. Use **per-pipeline-schedule `key` on `boss.schedule()`** (NOT a shared singletonKey) so each schedule row is its own entry in `pgboss.schedule`, idempotently upserted on schedule create/update. Use **DB-driven join `pipeline_stage_jobs.jobId`** as the routing primitive in the `job.completed` subscriber (NOT envelope correlationId match), to avoid false-positives across unrelated runs that legitimately share a correlationId.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Domain (Phase Boundary):**
- Restructure `server/pipelines/` into canonical `MODULE.md + barrel index.ts + events.ts + queue.ts + internal/ + tests-as-spec + createPipelinesModule(deps)` shape.
- Two migrations land in this phase (coupled; not splittable):
  1. **node-cron → boss.schedule()** — `server/pipelines/scheduler.ts` (3.5KB) currently uses `node-cron`. Migrate to pg-boss `boss.schedule()` with idempotent upsert pattern (Phase 18 lifecycle precedent), keyed `pipeline-schedule-${pipelineId}` per ROADMAP success criterion. Drop `node-cron` + `@types/node-cron` from package.json (lines 41, 52).
  2. **Polling executor → bus subscriber** — `server/pipelines/executor.ts` (3.1KB) and `service.ts` (20.8KB) currently advance pipeline stages by holding a local Promise chain or polling. Replace with a subscriber to `job.completed` (Phase 23 keystone event) scoped by `correlationId` matching the pipeline-run aggregate id. A 3-stage pipeline completes without any in-process Promise hold.

**In-scope artefacts:**
- New `server/pipelines/internal/` shape; barrel + factory + thin plugin.
- 3-5 new events in pipelinesRegistry: `pipeline.run.started`, `pipeline.stage.advanced`, `pipeline.run.completed`, `pipeline.run.failed`, `pipeline.schedule.upserted` (TBD by planner; minimum 2).
- New `pipeline.scheduled.execute` queue via `boss.schedule()` — idempotent upsert keyed by pipeline id.
- 9th dep-cruiser rule `no-deep-imports-into-pipelines-internal`.
- plugin-order.spec additive block.
- `.test.ts → .spec.ts` renames (5 files counted from `__tests__/`).
- Drop `node-cron` + `@types/node-cron` from package.json + run `npm install` to update lockfile.

**Out of scope (locked):**
- Pipeline definition language/grammar changes — keep current schema/parser as-is.
- Routes refactor beyond barrel-only re-export — `routes.ts` (9.9KB) stays inside `internal/` and registers via plugin onReady.
- Pipeline DAG support (currently sequential stages only) — Phase v2 territory.
- Pipeline-run cancellation API — defer if not currently present (it IS present today via `service.cancelRun` + `runningRuns` AbortController; planner must decide whether to preserve via a `pipeline.run.cancelled` event or accept reduced functionality — see Open Questions).

### Claude's Discretion

All implementation choices follow the locked Phase 16-24 template:
- MODULE.md: 9 H2 sections + Runnable Example (covering schedule + run flow).
- index.ts barrel: MOD-02 strict 1-line internal/ re-export with inline `type` modifier.
- internal/: holds `module.ts` (factory), `service.ts`, `executor.ts` (refactored — Promise chain deleted), `scheduler.ts` (refactored — boss.schedule), `routes.ts`, `subscribers.ts`, `git-service.ts`, `secrets.ts`, `variables.ts`, `parser.ts`, `broadcaster.ts`.
- events.ts: 3-5 events; persistence per TRACE-08 — terminal events (`run.completed`, `run.failed`) persisted; transitional (`stage.advanced`, `run.started`, `schedule.upserted`) transient.
- queue.ts: `PIPELINE_SCHEDULED_EXECUTE` queue name + helper that calls `boss.schedule(name, cron, data, {key: pipelineId})` with the cron expression from the pipeline schedule row.
- plugin.ts: thin wirer; dependencies `['config','db','queue','event-bus','job-plugin']` (jobs needed because pipeline subscribes to job.completed; verified plugin name is `job-plugin`).
- 9th dep-cruiser rule: mirrors rules 5-8 verbatim.
- Cross-module subscriber wiring deferred to `fastify.addHook('onReady', ...)` per Phase 23 Pitfall 5.
- Tests-as-spec: existing `*.test.ts` → `.spec.ts` rename; new specs for events, queue, module factory, subscriber chain (DB-gated for the job.completed → stage advance round-trip), correlation, lifecycle-ownership grep-guards (zero `node-cron` imports; zero local Promise chain in executor.ts).
- 9th persistEnvelope sample point — DEFERRED-25-A (Phase 27+ owns consolidation; do NOT extract here).

### Migration Strategy: node-cron → boss.schedule
- `boss.schedule(queueName, cronExpression, data, options)` is the public API (Phase 18 reference).
- Idempotent upsert: `boss.schedule()` overwrites prior schedule when called with same `(queueName, key)` tuple. Service layer calls `boss.schedule('pipeline.scheduled.execute', cronExpr, {pipelineId, scheduleId, variables}, {key: scheduleId})` on pipeline-schedule create/update; calls `boss.unschedule('pipeline.scheduled.execute', scheduleId)` on delete.
- Worker registered in module factory: `boss.work('pipeline.scheduled.execute', handler)` enqueues a fresh pipeline run via `pipelinesModule.startRun(pipelineId, 'schedule', variables)`.
- node-cron's `cron.schedule(expr, fn).start()` pattern is replaced with `boss.schedule()` call. The local cron-job map in scheduler.ts is deleted.

### Migration Strategy: Polling/Promise Chain → Bus Subscriber
- Pipeline-run aggregate id pattern: each pipeline run gets a UUID (existing — `pipelineRuns.id` UUID PK in `server/db/schema.ts:359`).
- `correlationId` set at run start: inherited from ALS at `startRun` time (no new column needed). Threaded through every job submitted as part of the run (auto-injected by `fastify.queue.send`).
- Subscriber: `bus.on('job.completed', payload)` filters by **DB-driven join** `pipeline_stage_jobs.jobId → pipeline_stage_runs.runId → pipeline_runs.id`. On match: aggregate matrix completion, advance current stage, enqueue next stage's job (or emit `pipeline.run.completed` if no more stages).
- The `executor.ts` local Promise chain (currently holding a per-run state machine) is deleted. State lives in DB: `pipelineRuns` row + `pipelineStageRuns` rows.

### Wave Structure (locked from CONTEXT)
Mirror Phase 24 (6 plans):
- 25-00: Wave-0 substrate (events placeholder, queue.ts placeholder, internal/module.ts throw-stub, MODULE.md placeholder, index.ts barrel, dep-cruiser 9th rule, fixture, events.spec stub).
- 25-01: events body — payload schemas + emitters; queue.ts body with `PIPELINE_SCHEDULED_EXECUTE`.
- 25-02: scheduler.ts boss.schedule migration — replaces node-cron usage; subscriber.spec stub for schedule upsert.
- 25-03: executor + service rewrite — local Promise chain deleted; bus subscriber wires job.completed → stage advance; routes.ts moved into internal/; plugin.ts thin replacement; node-cron + @types/node-cron dropped from package.json.
- 25-04: DB-gated proofs — subscriber.spec (3-stage pipeline completes via bus), correlation.spec (correlationId threads stage 1 → 2 → 3), lifecycle-ownership.spec (zero node-cron imports, zero local Promise chain in executor.ts).
- 25-05: phase close — MODULE.md body + barrel + .test→.spec renames + plugin-order.spec extension + deferred-items.md + Nyquist gate + STATE/ROADMAP.

### Deferred Ideas (OUT OF SCOPE)

- **DEFERRED-25-A: persistEnvelope 9th sample point** — Phase 27+ owns consolidation.
- **DEFERRED-25-B: Pipeline DAG / parallel stages** — current scope is sequential only; v2 territory.
- **DEFERRED-25-C: Pipeline-run cancellation API** — out of scope unless already present in current routes (it IS — see Open Questions for resolution path).
- **DEFERRED-25-D: Maestro test rewrite (inherited from DEFERRED-24-A)** — Phase 30 owns.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| **MOD-01..09** (carry-forward conventions) | All canonical module conventions (MODULE.md / barrel / events.ts / tests-as-spec / factory / runnable example / invariants / dep-cruiser rule) | This research documents the full template adoption (Standard Stack, Architecture Patterns, dep-cruiser N-th rule). |
| **ROADMAP §Phase 25 SC1** | `node-cron` no longer imported anywhere in server (`package.json` drops the dep); pipeline CRUD operations idempotently upsert `pipeline-schedule-${id}` schedules via `boss.schedule()` | Verified ONLY remaining import is `server/pipelines/scheduler.ts:1`. After Phase 25 the dep is cleanly removable from package.json. See pg-boss schedule API section for upsert semantics + Code Examples §1. |
| **ROADMAP §Phase 25 SC2** | Pipeline stage advancement is driven by a subscriber to `job.completed` scoped by `correlationId` and pipeline-run aggregate id; a pipeline with three sequential stages completes without the executor holding a local Promise chain | Existing `job.completed` event published since Phase 19 (`server/jobs/events.ts:381`). Existing `pipeline_stage_jobs` table (schema.ts:386) provides the join from jobId back to stage_run. See Bus-Driven Stage Advancement design + Code Examples §2. |
| **ROADMAP §Phase 25 SC3** | Pipelines module follows Phase 16 conventions; Nyquist passes; coverage delta ≤ −2pp; no hybrid state | Phase 16-24 templates verbatim. See Architecture Patterns + Coverage Delta. |
</phase_requirements>

---

## Current State Analysis

### File-level inventory of `server/pipelines/`

| File | Size | Role | Phase 25 disposition |
|------|------|------|---------------------|
| `scheduler.ts` | 3.5KB | node-cron-driven scheduler; in-memory `Map<scheduleId, ScheduleEntry>` keyed by `pipelineSchedules.id` (NOT pipelineId — see Schedule Identity below) | **REWRITE** — boss.schedule per pipeline-schedule row; remove Map; remove node-cron import |
| `executor.ts` | 3.1KB | `executeScript` (spawn bash) + `evaluateCondition`. Pure-ish — does NOT hold the run-level Promise chain (the chain lives in `service.executeRun`) | **MOVE** under `internal/`; KEEP shape (script execution still needed for `script` stages) |
| `service.ts` | 20.8KB | Pipeline CRUD + run orchestration. `executeRun()` is the long-running async function holding the per-run state (lines 198-380): mergedVars, hasFailures, abortController, sequential `for` loop over stages, `triggerRun(...).catch(...)` fire-and-forget at line 148. Holds `runningRuns: Map<runId, AbortController>` for cancellation. | **REWRITE / SPLIT** — service.ts retains CRUD; new `subscribers.ts` owns the stage advancement loop; new `run-state.ts` (or stays in service.ts) owns the per-run mergedVars + workDir cache. The 20.8KB collapses to ~12KB CRUD + ~6KB subscriber + ~2KB executor wrapper. |
| `routes.ts` | 9.9KB | 14 HTTP routes (pipelines CRUD, runs CRUD, secrets, schedules CRUD). Schedule CRUD callsites THE notify-scheduler integration points (lines 257, 277, 289). | **MOVE** under `internal/`; modify schedule CRUD handlers to call new `pipelinesModule.upsertSchedule(scheduleId)` / `removeSchedule(scheduleId)` instead of `fastify.pipelineScheduler.addSchedule/removeSchedule` |
| `parser.ts` | 712B | Pipeline YAML parser; pure | MOVE under `internal/`; no behaviour change |
| `schema.ts` | 1.7KB | Pipeline definition Zod schema | KEEP / MOVE under `internal/` — out-of-scope per CONTEXT |
| `schemas.ts` | 1.2KB | API request/response schemas | KEEP at module root (public surface) |
| `secrets.ts` | 2.6KB | SecretsService — encrypted secret store | MOVE under `internal/`; no behaviour change |
| `variables.ts` | 372B | `interpolateVariables` helper | MOVE under `internal/`; no behaviour change |
| `git-service.ts` | 3.9KB | Git clone for source-checkout pipelines | MOVE under `internal/` |
| `broadcaster.ts` | 1.7KB | WebSocket broadcaster (per-run subscribers) | MOVE under `internal/` |
| `plugin.ts` | 2.7KB | Current Fastify plugin: instantiates 5 services + decorates + registers routes + onReady scheduler.start + onClose scheduler.stop | **REWRITE** as thin factory wirer (~80 lines target, mirrors lifecycle plugin) |
| `__tests__/executor.test.ts` | 3.1KB | Tests `evaluateCondition` + `executeScript` | RENAME to `.spec.ts` (MOD-04); keep behaviour |
| `__tests__/git-service.test.ts` | 2.6KB | Tests git clone | RENAME to `.spec.ts` |
| `__tests__/integration.test.ts` | 5.1KB | Integration test of pipeline runs | RENAME to `.spec.ts`; **may need rewrite** if it asserts on the Promise-chain state machine semantics directly |
| `__tests__/parser.test.ts` | 3.5KB | Pipeline YAML parser tests | RENAME to `.spec.ts` |
| `__tests__/secrets.test.ts` | 1015B | Secrets service tests | RENAME to `.spec.ts` |

**No existing:** `MODULE.md`, `index.ts` barrel, `events.ts`, `queue.ts`, `internal/`, `subscribers.ts`. Phase 25 creates all six.

### Existing schedule mechanics (today)

`server/pipelines/scheduler.ts` keeps an in-memory `Map<scheduleId, ScheduleEntry>` where `scheduleId === pipelineSchedules.id` (a UUID per schedule row, NOT per pipeline). A pipeline can have multiple schedules attached (the route surface at `/api/pipelines/:id/schedules` allows it; schema permits it). Each `ScheduleEntry` holds the cron task object + variables.

**CRUD integration points (current):**
- `routes.ts:257` (POST schedule) — calls `fastify.pipelineScheduler.addSchedule(scheduleId)` after DB insert.
- `routes.ts:277` (PUT schedule) — calls `addSchedule(scheduleId)` (which removes-then-re-registers).
- `routes.ts:289` (DELETE schedule) — calls `removeSchedule(scheduleId)` BEFORE DB delete.
- `plugin.ts:46` — calls `await scheduler.start()` in `onReady` to load all enabled schedules from DB and register cron tasks.
- `plugin.ts:50` — calls `scheduler.stop()` in `onClose` to clear the Map and stop cron tasks.

**Schedule fires:** When cron fires, `registerSchedule` (lines 90-104) runs `pipelineService.triggerRun(row.pipelineId, 'schedule', vars)` then UPDATEs `pipelineSchedules.lastRunAt`.

### Existing executor mechanics (today)

`server/pipelines/service.ts:198-380` — `executeRun(runId, pipeline, variables)`:

1. Stores `AbortController` in `runningRuns: Map<runId, AbortController>` for cancellation.
2. Sets `pipelineRuns.status='running'` + `startedAt=now()`.
3. If `pipeline.source` configured, clones the git repo (modifies `workDir` + `mergedVars.source_commit`).
4. **Sequential for-loop over `pipeline.stages`:**
   - For each stage:
     - Check `evaluateCondition(stage.when, hasFailures)` — skip if false.
     - INSERT `pipelineStageRuns` row, status='running'.
     - If stage.type === 'maestro': call `executeMaestroStage` (creates Maestro job(s) via `jobService.createJob`, then **POLLS the jobs table every 3s** at lines 523-539 until completion or 30min timeout). Aggregates pass/fail per matrix.
     - Else: call `executor.executeScript()` (spawn bash; pure).
     - UPDATE stage row with terminal status + logs.
     - If stage failed → set `hasFailures = true` (next stage's `when:'success'` will skip).
5. UPDATE `pipelineRuns` with terminal status.
6. Cleanup: `broadcaster.cleanup(runId)`, optional Azure DevOps PR comment, `gitService.cleanup(cloneDir)`.

**Promise-chain shape:** the `executeRun` function is itself a Promise. It's invoked fire-and-forget at `service.ts:148` via `.catch(...)`. The for-loop awaits each stage sequentially. The `runningRuns` Map holds the AbortController.

**Polling for job completion:** lines 523-539 poll `jobs.status` every 3s. This is the EXACT pattern Phase 25 SC2 forbids.

### Existing event surfaces consumed

The pipelines module currently does NOT subscribe to any bus events. It only EMITS broadcaster messages (in-memory WebSocket fanout) via `service.emitStageEvent()`.

**Job event surface available (Phase 19+ stable):**
- `job.completed` — `{jobId, status: 'passed'|'failed'|'cancelled'|'timeout', platform, summary?}` — persisted, aggregateType:'job', aggregateId=jobId. Source: `server/jobs/events.ts:145-150` + `:381`.
- The envelope (Phase 15 substrate) carries `{id, type, v, correlationId, causationId, occurredAt, aggregateType, aggregateId, payload, actor}`.
- `bus.on('job.completed', handler)` delivers the **parsed payload** (NOT the envelope) per `wireJobsSagaSubscribers` precedent at `server/jobs/internal/subscribers.ts:91`. To get the envelope (with correlationId), subscribe via the `*.envelope` side-channel: `(bus as { ee }).ee.on('job.completed.envelope', handler)`.

### Plugin name verification (CRITICAL for plugin.ts dependencies array)

Verified by reading `server/jobs/plugin.ts:67`: name is `'job-plugin'` (NOT `'jobs-plugin'`). The current pipelines plugin already uses the correct dep at `server/pipelines/plugin.ts:77` — `'job-plugin'`. **Phase 25 plugin.ts must continue to use `'job-plugin'`** in the dependencies array.

### node-cron call sites — sweep result

A repository-wide grep for `node-cron` returns:
- `server/lifecycle/MODULE.md:5` (prose only)
- `server/lifecycle/MODULE.md:58` (prose only)
- `server/pipelines/scheduler.ts:1` — **the SOLE remaining import**
- `package.json:41` — `"node-cron": "^4.2.1"`
- `package.json:52` — `"@types/node-cron": "^3.0.11"`

After Phase 25's `scheduler.ts` rewrite, both package.json lines can be deleted and `npm install` regenerates `package-lock.json`. The grep-guard test (`lifecycle-ownership.spec.ts`) asserts zero `from 'node-cron'` matches across `server/`.

---

## Standard Stack

### Core (already installed — no new deps)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `pg-boss` | `^12.15.0` | Postgres-backed job queue + cron scheduler. Owns `boss.schedule(name, cron, data, opts)`, `boss.unschedule(name, key?)`, `boss.getSchedules(name?, key?)`, `boss.work(name, handler)`. | Phase 15 substrate; Phase 18 lifecycle precedent for schedule lifecycle. |
| `@fastify/request-context` | `^6.2.1` | AsyncLocalStorage wrapper. Per-fire correlationId restored by `fastify.queue.work` (Phase 18 Option B). | Project standard since Phase 15. |
| `fastify` + `fastify-plugin` | 5.x | Plugin host; thin factory-wirer pattern. | Project standard. |
| `drizzle-orm` + `postgres` | 0.45.x + 3.x | DB layer for pipelines tables (already in use). | Project standard. |
| `zod` | `^4.3.6` | Schema validation; events.ts payload schemas + queue.ts payload schema. | SPEC-01/03. |
| `pino` | — | Logger. `logger.child({module: 'pipelines'})` per MOD-07. | Project standard. |
| `node:crypto` `randomUUID` | — | correlationId for pipeline runs. | Standard library. |

### Supporting (REMOVED in Phase 25)

| Library | Version | Reason for removal |
|---------|---------|---------------------|
| `node-cron` | `^4.2.1` | Last consumer (`server/pipelines/scheduler.ts`) migrates to `boss.schedule()`. Drop from `package.json` + run `npm install` to regenerate lockfile. |
| `@types/node-cron` | `^3.0.11` | Same as above. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `boss.schedule()` per-pipeline-schedule with distinct `key` | Single schedule + dispatch table | Loses pg-boss-native upsert semantics; introduces app-level race conditions. **Use per-pipeline-schedule key.** |
| Subscribe to `job.completed` (parsed payload) + DB join | Subscribe to `job.completed.envelope` and match envelope correlationId against pipeline_runs.correlationId | Parsed payload doesn't carry envelope correlationId — but DB-driven join on `pipeline_stage_jobs.jobId` is sufficient AND avoids correlationId false-positives across unrelated runs. **Recommended: DB-driven join, NOT envelope correlationId match.** See Pitfall 4. |
| Delete `runningRuns` cancellation map | Preserve via new `pipeline.run.cancellation.requested` event | DEFERRED-25-C says "out of scope unless already present" — it IS present today. Recommend: preserve cancellation by writing `pipeline_runs.status='cancelled'` synchronously and having the subscriber check before enqueueing next stage. **Confirm with planner — see Open Questions.** |
| Drop matrix support during refactor | Preserve matrix expansion in stage advancement | Matrix creates N parallel `job.execute` enqueues; stage completes only when ALL N `job.completed` events are received. The subscriber needs an N-of-N gate per stage. Doable — see Bus-Driven Stage Advancement. |

**Installation:** No new packages. Only removals:
```bash
npm uninstall node-cron @types/node-cron
```
This regenerates `package-lock.json` and shrinks `node_modules` by the cron-parser tree.

---

## Architecture Patterns

### Recommended Project Structure (post-migration)

```
server/pipelines/
├── MODULE.md                       # 9 H2 sections + Runnable Example (MOD-01)
├── index.ts                        # barrel — MOD-02 strict 1-line internal/ re-export
├── plugin.ts                       # thin Fastify wrapper (~80 lines, mirrors lifecycle/plugin.ts)
├── events.ts                       # pipelinesRegistry + makePipelinesEmitters (MOD-03)
├── queue.ts                        # PIPELINE_SCHEDULED_EXECUTE name + payload schema + register helpers (QUEUE-06)
├── schemas.ts                      # API request/response Zod schemas (KEEP at module root)
├── internal/
│   ├── module.ts                   # createPipelinesModule factory (MOD-06)
│   ├── service.ts                  # CRUD + non-execution business logic (~12KB)
│   ├── scheduler.ts                # boss.schedule wrapper for pipeline-schedule rows (REWRITE)
│   ├── executor.ts                 # Pure script execution (executeScript + evaluateCondition) (MOVED)
│   ├── subscribers.ts              # job.completed → stage advance (NEW; replaces Promise chain)
│   ├── routes.ts                   # 14 HTTP routes (MOVED; minor edits to schedule CRUD)
│   ├── broadcaster.ts              # WebSocket per-run fanout (MOVED)
│   ├── git-service.ts              # Git clone for source-checkout (MOVED)
│   ├── secrets.ts                  # SecretsService (MOVED)
│   ├── variables.ts                # interpolateVariables (MOVED)
│   ├── parser.ts                   # YAML parser (MOVED)
│   └── pipeline-schema.ts          # Pipeline definition Zod schema (MOVED; renamed from `schema.ts` to avoid collision with `schemas.ts`)
└── __tests__/
    ├── executor.spec.ts            # renamed from .test.ts
    ├── git-service.spec.ts         # renamed
    ├── integration.spec.ts         # renamed; MAY need partial rewrite for new bus-driven semantics
    ├── parser.spec.ts              # renamed
    ├── secrets.spec.ts             # renamed
    ├── events.spec.ts              # NEW — registry shape + emit helpers (MOD-03 + EVENTS-03)
    ├── queue.spec.ts               # NEW — DB-gated; idempotent upsert; unschedule
    ├── module.spec.ts              # NEW — factory shape + shutdown idempotency (MOD-06)
    ├── subscriber.spec.ts          # NEW — DB-gated; 3-stage pipeline completes via bus (SC2)
    ├── correlation.spec.ts         # NEW — correlationId threads stage 1→2→3
    └── lifecycle-ownership.spec.ts # NEW — grep-guards: zero node-cron imports server-wide; zero local Promise chain in executor.ts; zero polling in service.ts
```

### Pattern 1: Per-Pipeline-Schedule pg-boss Schedule

Synthesised from `server/lifecycle/queue.ts:99-132` (Phase 18 precedent) plus pg-boss timekeeper internals. Each `pipelineSchedules` row maps to ONE pg-boss schedule keyed by the row's UUID. One pg-boss queue (`pipeline.scheduled.execute`); N schedules disambiguated by the `key` parameter.

```typescript
import { QUEUE_NAMES } from '../queue/names.js';

export const PIPELINE_SCHEDULED_EXECUTE_QUEUE_NAME = QUEUE_NAMES.PIPELINE_SCHEDULED_EXECUTE;

// At factory.registerWorkerAndSubscribers() time — runs ONCE per server boot.
await fastify.boss.createQueue(PIPELINE_SCHEDULED_EXECUTE_QUEUE_NAME, {
  policy: 'standard',           // Pipeline runs are independent — overlap is OK
  retryLimit: 0,                // Schedule-fire failures should not retry; pipeline_runs row is the source of truth
} as never);

// Worker — invoked when ANY schedule fires
const workerId = await fastify.queue.work<{pipelineId: string; scheduleId: string; variables: Record<string, string>}>(
  PIPELINE_SCHEDULED_EXECUTE_QUEUE_NAME,
  async (payload, jobId) => {
    const log = logger.child({ queue: PIPELINE_SCHEDULED_EXECUTE_QUEUE_NAME, jobId, pipelineId: payload.pipelineId });
    try {
      await pipelinesModule.startRun(payload.pipelineId, 'schedule', payload.variables);
      // UPDATE pipelineSchedules.lastRunAt — preserves current behaviour at scheduler.ts:97-100
      await db.update(schema.pipelineSchedules)
        .set({ lastRunAt: new Date() })
        .where(eq(schema.pipelineSchedules.id, payload.scheduleId));
    } catch (err) {
      emit.runFailed(/* ... */);
      throw err; // pg-boss retry accounting (retryLimit:0 → marked failed immediately)
    }
  },
);

// Per-pipeline-schedule CRUD helpers (called from routes.ts schedule-CRUD handlers):
async function upsertSchedule(scheduleId: string): Promise<void> {
  const [row] = await db.select().from(schema.pipelineSchedules).where(eq(schema.pipelineSchedules.id, scheduleId));
  if (!row || !row.enabled) {
    // Disabled or missing — ensure no pg-boss schedule exists
    await fastify.boss.unschedule(PIPELINE_SCHEDULED_EXECUTE_QUEUE_NAME, scheduleId);
    return;
  }
  // Idempotent upsert keyed by scheduleId (NOT pipelineId — pipelines can have multiple schedules)
  await fastify.queue.schedule(
    PIPELINE_SCHEDULED_EXECUTE_QUEUE_NAME,
    row.cronExpression,
    { pipelineId: row.pipelineId, scheduleId: row.id, variables: (row.variables as Record<string,string>) ?? {} },
    { key: scheduleId, tz: 'UTC' },
  );
  emit.scheduleUpserted(scheduleId, { scheduleId, pipelineId: row.pipelineId, cron: row.cronExpression });
}

async function removeSchedule(scheduleId: string): Promise<void> {
  await fastify.boss.unschedule(PIPELINE_SCHEDULED_EXECUTE_QUEUE_NAME, scheduleId);
}
```

**Schedule Identity Decision:** ROADMAP §Phase 25 SC1 says `pipeline-schedule-${id}` naming. The `${id}` is **the pipelineSchedules row id, NOT the pipeline id** — because (a) one pipeline can have multiple schedules, (b) the existing scheduler.ts indexes the in-memory Map by `scheduleId`, (c) pg-boss `key` parameter is purpose-built for this. The CONTEXT.md draft says `singletonKey: pipelineId` which is **subtly wrong** — use `key: scheduleId` on the schedule (the `key` is per-schedule disambiguation; `singletonKey` is per-job dedup at execution time).

### Pattern 2: Bus-Driven Stage Advancement

Synthesised from `server/jobs/internal/subscribers.ts:91-108` (Phase 23) using DB-driven join pattern. The subscriber lives in `server/pipelines/internal/subscribers.ts`, wired by `createPipelinesModule` via onReady.

```typescript
export function wirePipelinesStageAdvancementSubscriber(deps: {
  fastify: FastifyInstance;
  pipelinesModule: PipelinesModule;
  jobsModule: JobsModule;        // for jobsModule.bus.on('job.completed', ...)
  logger: pino.Logger;
}): () => void {
  const { fastify, pipelinesModule, jobsModule, logger } = deps;
  const log = logger.child({ module: 'pipelines.subscribers' });

  return jobsModule.bus.on('job.completed', async (payload) => {
    // payload: {jobId, status, platform, summary?}
    // Step 1: DB-join from jobId → stageRunId → runId. Skip if jobId not part of any pipeline.
    const [match] = await fastify.db
      .select({
        stageRunId: schema.pipelineStageRuns.id,
        runId: schema.pipelineStageRuns.runId,
        stageIndex: schema.pipelineStageRuns.stageIndex,
        stageName: schema.pipelineStageRuns.stageName,
      })
      .from(schema.pipelineStageJobs)
      .innerJoin(schema.pipelineStageRuns, eq(schema.pipelineStageJobs.stageRunId, schema.pipelineStageRuns.id))
      .where(eq(schema.pipelineStageJobs.jobId, payload.jobId))
      .limit(1);

    if (!match) return; // jobId is not a pipeline-stage job — no-op

    // Step 2: Aggregate matrix completion for this stage.
    // If pipeline_stage_jobs has N rows for this stageRunId, count how many
    // have a terminal jobs.status. If < N, this stage is still in progress (other matrix entries pending).
    const matrixState = await fastify.db
      .select({
        jobId: schema.pipelineStageJobs.jobId,
        jobStatus: schema.jobs.status,
      })
      .from(schema.pipelineStageJobs)
      .innerJoin(schema.jobs, eq(schema.pipelineStageJobs.jobId, schema.jobs.id))
      .where(eq(schema.pipelineStageJobs.stageRunId, match.stageRunId));

    const allTerminal = matrixState.every((j) =>
      ['passed', 'failed', 'cancelled', 'timeout'].includes(j.jobStatus),
    );
    if (!allTerminal) return; // wait for remaining matrix entries

    const stageStatus = matrixState.every((j) => j.jobStatus === 'passed') ? 'passed' : 'failed';

    // Step 3: Update the stage row + emit pipeline.stage.advanced
    await fastify.db
      .update(schema.pipelineStageRuns)
      .set({ status: stageStatus, finishedAt: new Date() })
      .where(eq(schema.pipelineStageRuns.id, match.stageRunId));

    pipelinesModule.emit.stageAdvanced(match.runId, {
      runId: match.runId,
      stageIndex: match.stageIndex,
      stageName: match.stageName,
      status: stageStatus,
    });

    // Step 4: Decide next action — advance to next stage, OR mark run terminal.
    await pipelinesModule.advanceRunOrComplete(match.runId);
  });
}
```

**The `advanceRunOrComplete(runId)` helper** (in `internal/service.ts`):
1. Look up run + parsed pipeline definition + current stage state.
2. Find next stage where `evaluateCondition(stage.when, hasFailures)` is true.
3. If found → enqueue that stage's job(s) (using the same correlationId from the run).
4. If no more stages → UPDATE `pipelineRuns` terminal status; emit `pipeline.run.completed` (if all passed) or `pipeline.run.failed` (if any failed); cleanup git work-dir; emit final WS broadcaster message.

**Why DB-driven join (NOT envelope correlationId matching):**
- jobs and pipelines run in the same correlationId in many cases (a CI request triggers a pipeline run, which spawns jobs — all share the request's correlationId). Filtering by correlationId would catch UNRELATED jobs that happen to share the id (e.g. a job-CRUD route call from the same browser session as a pipeline trigger).
- The `pipeline_stage_jobs` table is the authoritative source of truth for "is this jobId part of a pipeline stage?". DB-driven join is O(1) (indexed jobId lookup) and unambiguous.
- The correlationId IS still threaded for log correlation + envelope persistence (TRACE-04). It's NOT the routing primitive.

### Pattern 3: Pipeline Run correlationId Threading

```typescript
// At pipelinesModule.startRun() — generate fresh correlationId per run (matches Phase 23 precedent for jobs).
// Stored on the pipeline_runs row as a new column? OR inherited from ALS at startRun time?

// RECOMMENDED: inherit from ALS (no new column). The HTTP route handler enters
// startRun under a request fiber; ALS already has correlationId. fastify.queue.send
// (used to enqueue jobs) auto-injects this correlationId into job.execute envelopes.
// The subscriber receives the same correlationId on job.completed.

// For schedule-triggered runs: the `fastify.queue.work` wrapper generates a fresh
// per-fire correlationId (Phase 18 Option B at server/queue/plugin.ts:215-227).
// The schedule worker handler runs under that fiber, so startRun() inherits it.

// In short: NO new pipeline_runs.correlationId column needed. ALS handles it.
// Persisted events (pipeline.run.completed/failed) carry it via envelope.
// The subscriber join logic is DB-driven (does NOT depend on correlationId match).
```

**Trade-off:** the planner could optionally add `pipelineRuns.correlationId UUID` for query convenience (find all jobs/events for a given run). This is NOT required for SC2 compliance — the join via `pipeline_stage_jobs` is sufficient. Deferring as DEFERRED-25-E avoids a Drizzle migration.

### Anti-Patterns to Avoid

- **Don't subscribe via envelope `correlationId` to advance stages.** Use DB-driven join. (Pitfall 4.)
- **Don't keep the `service.runningRuns: Map<runId, AbortController>` for stage flow control.** Cancellation can stay (preserves DEFERRED-25-C behaviour) but must NOT drive stage advancement. The subscriber is the sole stage-advancement authority.
- **Don't delete the `pipelineSchedules` table.** Source-of-truth lives there; pg-boss's `pgboss.schedule` is a derived projection. DELETE on the schedule row triggers `boss.unschedule`; CREATE/UPDATE triggers `boss.schedule`.
- **Don't forget `boss.unschedule` on pipeline DELETE.** Currently `service.deletePipeline()` (lines 89-91) only deletes the `pipelines` row. It MUST be extended to (a) DELETE child schedule rows and (b) `boss.unschedule()` each — otherwise orphaned pg-boss schedules continue firing against a non-existent pipeline. (Pitfall 3.)
- **Don't re-implement cron parsing.** pg-boss validates via `CronExpressionParser.parse(cron, {tz, strict: false})` at `boss.schedule()` call-time. Throw at the schedule CRUD route handler, not silently log + drop (current scheduler.ts:86-88 logs error and continues — change behaviour: throw 400).
- **Don't use `singletonKey: pipelineId` on the schedule.** That pattern is for queue-level dedup at execution time. The pg-boss `key` parameter is the right primitive for per-schedule upsert. (See Schedule Identity Decision in Pattern 1.)

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cron parsing + validation | Custom regex; `cron.validate()` from node-cron | `boss.schedule()` delegates to `cron-parser` (pg-boss's internal dep) | Already installed (transitively via pg-boss). Validates timezone-aware. Reject invalid input at schedule-time. |
| Per-pipeline-schedule upsert | "Find existing → delete → create" pattern | `boss.schedule(name, cron, data, {key})` is idempotent-upsert on `(name, key)` | pg-boss `timekeeper.js:164-180` is upsert-natively. One call per CRUD operation. |
| Schedule deletion on pipeline delete | "Find children → for each, call removeSchedule" | Drizzle CASCADE OR explicit boss.unschedule loop | Keep current schema; explicit loop in `service.deletePipeline()` is clearer. |
| Stage advancement state machine | Local Promise chain in executor.ts | DB rows (`pipeline_stage_runs.status`) + bus subscriber | Survives restart. Reportable. Testable in isolation. |
| Job completion polling | `setInterval` over `jobs.status` | `bus.on('job.completed', ...)` | Phase 19+ stable event. Removes 3s latency floor + DB hammer. |
| Matrix N-of-N gate | Per-job state map in service.ts | DB-driven aggregate query at subscriber-time | Survives restart. Idempotent (re-running the query at a future job.completed fire produces the same answer). |
| Per-fire correlationId | Generate UUID in subscriber/handler | `fastify.queue.work` Phase 18 Option B already does it | Already wired at `server/queue/plugin.ts:215-227`. Don't duplicate. |
| Graceful shutdown of schedules | `cron.schedule(...).stop()` array iteration | `boss.stop({graceful: true})` (Phase 15 substrate) + `boss.offWork(workerId)` for local worker | Phase 15 substrate already wires top-level boss.stop. Module only offWorks its own worker. |
| WebSocket broadcaster fanout | Custom subscriber registry | KEEP existing `PipelineBroadcaster` (in-memory; per-run subscribers) | Out of scope per CONTEXT — pipeline broadcaster is pipelines-internal infrastructure, not bus-related. |
| Pipeline-run cancellation | Delete `runningRuns` Map | KEEP `runningRuns` for cancellation; ADD a check in `advanceRunOrComplete` so subscriber respects cancelled status before enqueueing next stage | Preserves DEFERRED-25-C functionality without re-introducing Promise chain. |

**Key insight:** Every state-machine concern that lives in-memory today (Map of cron tasks, Map of AbortControllers, Promise chain over stages, polling loop over jobs) has a Postgres-backed equivalent already in the substrate. Phase 25 is genuinely a "delete the in-memory state" refactor.

---

## Common Pitfalls

### Pitfall 1: `boss.unschedule(name, key)` API signature

**What goes wrong:** Plan calls `boss.unschedule({key: scheduleId})` (object form) — pg-boss v12 takes positional args. Throws or silently no-ops.

**Why it happens:** Older pg-boss versions exposed an object-arg form. v12 standardised on positional.

**Verified signature** (from Phase 18 RESEARCH against `node_modules/pg-boss/dist/index.d.ts:68`):
```typescript
unschedule(name: string, key?: string): Promise<void>;
```

**How to avoid:** call `await fastify.boss.unschedule('pipeline.scheduled.execute', scheduleId)`. Use the bare-string positional form.

**Warning signs:** schedules survive past pipeline deletion; `pgboss.schedule` row count grows monotonically.

### Pitfall 2: `boss.createQueue` BEFORE `boss.schedule`

**What goes wrong:** `boss.schedule('pipeline.scheduled.execute', ...)` throws `Queue pipeline.scheduled.execute not found` (per `timekeeper.js:174-177`).

**Why it happens:** pg-boss v12 decoupled queue creation from job sending; `schedule()` internally does a `boss.send()` via SEND_IT dispatcher, which requires the queue to exist.

**How to avoid:** in `module.registerWorkerAndSubscribers()`:
1. `await fastify.boss.createQueue(PIPELINE_SCHEDULED_EXECUTE_QUEUE_NAME, {...})` — once at boot.
2. `await fastify.queue.work(PIPELINE_SCHEDULED_EXECUTE_QUEUE_NAME, handler)` — once at boot.
3. Per-pipeline-schedule `boss.schedule(...)` calls happen later, on CRUD events or on first-boot reconciliation (see Pitfall 6).

### Pitfall 3: Pipeline DELETE leaves orphan pg-boss schedules

**What goes wrong:** `service.deletePipeline(id)` currently only does `db.delete(pipelines).where(...)`. The FK `pipelineSchedules.pipelineId → pipelines.id` does not cascade in current schema. AND even with cascade, the `pgboss.schedule` rows (in a DIFFERENT schema) won't be touched.

**Why it happens:** node-cron used in-memory map cleared by stop(); pg-boss persists schedules in DB. Cleanup must be explicit.

**How to avoid:** extend `service.deletePipeline(id)` to:
1. SELECT all `pipelineSchedules` rows for the pipeline.
2. For each, `await fastify.boss.unschedule('pipeline.scheduled.execute', schedule.id)`.
3. DELETE child `pipelineSchedules` rows.
4. DELETE `pipelines` row.

Add a test: create pipeline + 2 schedules, call delete, assert `boss.getSchedules('pipeline.scheduled.execute')` returns 0 rows for those keys.

**Warning signs:** scheduled fires hit the worker for non-existent pipelines; worker handler errors with `pipeline ${id} not found`; `boss.getSchedules()` row count grows over time.

### Pitfall 4: `correlationId` as routing primitive across module boundaries

**What goes wrong:** Subscriber filters `bus.on('job.completed', ...)` by matching `envelope.correlationId === run.correlationId`. False-positives: a user clicks "rerun" on a pipeline AND submits an unrelated ad-hoc job from the same browser session — both share the request's correlationId. The pipeline's stage advances on the unrelated job.

**Why it happens:** correlationId is a TRACING primitive (TRACE-01..TRACE-09), not a foreign key. Sibling requests legitimately share it. Phase 23's RESEARCH explicitly flagged this anti-pattern for the jobs saga (subscriber uses `payload.jobId`, not envelope correlationId).

**How to avoid:** route by `payload.jobId` → DB join `pipeline_stage_jobs` (the authoritative pipeline-stage-membership table). correlationId is for log correlation only.

**Warning signs:** flaky integration tests where stage advancement fires on a job that wasn't enqueued by the pipeline; "stage marked passed but job belongs to different pipeline run" log lines.

### Pitfall 5: Worker registration at the wrong lifecycle hook

**What goes wrong:** `boss.work()` registered inside the plugin body (synchronous, plugin-load time) on a code path that depends on `fastify.poolModule` or another decorator from a later-registered plugin. Throws "fastify.poolModule is undefined".

**Why it happens:** Fastify plugin bodies run synchronously; decorators from later-registered plugins are not yet available. Phase 23 Pitfall 5 documented this — cross-module subscribers MUST defer to `fastify.addHook('onReady', ...)`.

**How to avoid:** `boss.createQueue` + `boss.work` for the schedule-execute queue can run at plugin-body time (no cross-module deps). The cross-module subscriber to `job.completed` (which reads `fastify.jobsModule.bus`) MUST defer:
```typescript
fastify.addHook('onReady', async () => {
  const unsub = wirePipelinesStageAdvancementSubscriber({ fastify, ... });
  unsubscribers.push(unsub);
});
```

**Warning signs:** test failures with `Cannot read properties of undefined (reading 'bus')`; production crashes at first subscriber-triggered code path.

### Pitfall 6: Restart safety — schedules in `pgboss.schedule` can drift from `pipelineSchedules`

**What goes wrong:** Server restarts mid-mutation: `pipelineSchedules` row updated but `boss.schedule()` not yet called (or vice versa). After restart, the two diverge.

**Why it happens:** No transactional coupling between the app DB and pg-boss schema (separate schemas; could even be separate DBs in future).

**How to avoid:** add a `reconcileSchedules()` step in `module.registerWorkerAndSubscribers()` that runs ONCE at boot:
1. SELECT all enabled `pipelineSchedules` rows.
2. For each, `boss.schedule(...)` (idempotent upsert — safe to call every boot).
3. SELECT all pg-boss schedules with name `pipeline.scheduled.execute` via `boss.getSchedules(name)`.
4. For each pg-boss schedule whose `key` is NOT in `pipelineSchedules.id`, `boss.unschedule(name, key)` (orphan cleanup).

This is mirror of Phase 18's "register schedules every boot" idempotent pattern. Drift converges to source-of-truth (`pipelineSchedules` table) on every restart.

**Warning signs:** Schedules fire for deleted pipelines; updated cron expressions don't take effect until manual restart.

### Pitfall 7: Polling deletion in service.ts breaks integration test

**What goes wrong:** Removing the polling loop at `service.ts:523-539` (waiting for matrix jobs) without replacing it with the bus subscriber breaks `__tests__/integration.test.ts` which currently asserts pipeline-run completion within a synchronous-looking test flow.

**Why it happens:** The integration test creates a pipeline, triggers a run, and asserts terminal status by awaiting the executeRun Promise. After the rewrite, `executeRun` becomes "enqueue first stage; return". Terminal status arrives via the subscriber chain, asynchronously.

**How to avoid:** rewrite `__tests__/integration.spec.ts` to:
- Trigger the run (returns immediately).
- Stub or run the bus + pg-boss + jobs module inline (DB-gated test).
- Use `vi.waitFor(() => expect(run.status).toBe('passed'), { timeout: 30_000 })` to await async completion.

This is a known plan-25-04 cost. Plan must budget for the rewrite (~1-2 hours).

**Warning signs:** integration spec hangs, times out, or asserts on stale state.

### Pitfall 8: Matrix expansion + retry semantics

**What goes wrong:** A matrix stage enqueues 3 jobs. Job 1 passes. Jobs 2 and 3 fail. Subscriber fires on each `job.completed`. The naive aggregation runs `every(j === 'passed')` → false on the first failed job, marks stage failed, advances. But pipelines's current behaviour is to wait for ALL matrix entries (even after a failure) before deciding. Premature advancement skips the remaining jobs.

**Why it happens:** Bus subscribers are reactive; the natural fire-and-act pattern is "every event = potential decision". Stage-level aggregation needs an N-of-N gate.

**How to avoid:** the subscriber's matrix completion check (Pattern 2 step 2) MUST query ALL `pipeline_stage_jobs` for the stageRunId and check `every(j => terminal status)`. Only when ALL are terminal does it write the stage result. Until then, subsequent `job.completed` fires re-run the same check (idempotent — DB state converges).

**Warning signs:** stage marked failed/passed before all matrix jobs finish; subsequent `job.completed` fires for the same stage produce duplicate updates.

### Pitfall 9: `boss.work` returns a workerId that must be saved for offWork

**What goes wrong:** `module.shutdown()` doesn't `offWork` the schedule worker → second test in the same Vitest file picks up fires from the first test's worker → cross-test pollution.

**Why it happens:** pg-boss workers are global (per-instance); leaks survive Fastify close cycles.

**How to avoid:** save the workerId returned from `boss.work` in module closure; `await fastify.boss.offWork(workerId)` in `module.shutdown()`. Mirror `server/lifecycle/internal/module.ts:127-141`.

**Warning signs:** flaky tests where pipeline runs from a previous test's pipeline trigger spuriously in the next test; teardown timeouts.

### Pitfall 10: Timezone drift — node-cron defaults vs pg-boss defaults

**What goes wrong:** node-cron defaults to local server timezone. pg-boss defaults to UTC (`tz: 'UTC'` in `ScheduleOptions`). After Phase 25, schedules that "fire at 3am" suddenly fire at 11pm or 5am depending on TZ.

**Why it happens:** Implicit defaults differ; existing `pipelineSchedules.cronExpression` rows were authored under node-cron's local-tz semantics.

**How to avoid:** explicitly pass `{tz: 'UTC'}` on every `boss.schedule()` call (matches Phase 18 lifecycle). Document the TZ change in `MODULE.md` § Non-Goals or in deferred-items.md as a behaviour-change-on-migration. If existing schedules need to be tz-preserved, add a `pipelineSchedules.timezone` column (DEFERRED-25-F) and pass it through. Phase 25 default: UTC.

**Warning signs:** customer reports "my nightly pipeline now runs at 5pm"; first scheduled fire after deploy lands at unexpected wall-clock time.

---

## Code Examples

Verified patterns from Phase 18 (lifecycle), Phase 23 (jobs), and the installed pg-boss source.

### Example 1: events.ts — pipelinesRegistry shape

Synthesised from `server/lifecycle/events.ts` + `server/jobs/events.ts` (Phase 18 + 23 precedent).

```typescript
import { z } from 'zod';
import { createEventHelpers } from '../bus/helpers.js';
import type { TypedBus } from '../bus/bus.js';
import type { EventRegistry } from '../bus/types.js';
import type { Envelope } from '../events/envelope.js';

export const PIPELINE_EVENT_NAMES = {
  RUN_STARTED:        'pipeline.run.started',
  STAGE_ADVANCED:     'pipeline.stage.advanced',
  RUN_COMPLETED:      'pipeline.run.completed',
  RUN_FAILED:         'pipeline.run.failed',
  SCHEDULE_UPSERTED:  'pipeline.schedule.upserted',
} as const;

export type PipelineEventName = typeof PIPELINE_EVENT_NAMES[keyof typeof PIPELINE_EVENT_NAMES];

export const pipelineRunStartedPayload = z.object({
  runId: z.string(),
  pipelineId: z.string(),
  triggerType: z.enum(['api', 'schedule', 'manual']),
});

export const pipelineStageAdvancedPayload = z.object({
  runId: z.string(),
  stageIndex: z.number().int().nonnegative(),
  stageName: z.string(),
  status: z.enum(['passed', 'failed', 'skipped']),
});

export const pipelineRunCompletedPayload = z.object({
  runId: z.string(),
  pipelineId: z.string(),
  status: z.enum(['passed', 'failed', 'cancelled']),
  durationMs: z.number().int().nonnegative(),
});

export const pipelineRunFailedPayload = z.object({
  runId: z.string(),
  pipelineId: z.string(),
  reason: z.string(),
  failedStageIndex: z.number().int().nonnegative().nullable(),
});

export const pipelineScheduleUpsertedPayload = z.object({
  scheduleId: z.string(),
  pipelineId: z.string(),
  cron: z.string(),
});

export const pipelinesRegistry = {
  [PIPELINE_EVENT_NAMES.RUN_STARTED]:       { schema: pipelineRunStartedPayload,      persisted: false, aggregateType: 'pipeline-run' },
  [PIPELINE_EVENT_NAMES.STAGE_ADVANCED]:    { schema: pipelineStageAdvancedPayload,   persisted: false, aggregateType: 'pipeline-run' },
  [PIPELINE_EVENT_NAMES.RUN_COMPLETED]:     { schema: pipelineRunCompletedPayload,    persisted: true,  aggregateType: 'pipeline-run' },
  [PIPELINE_EVENT_NAMES.RUN_FAILED]:        { schema: pipelineRunFailedPayload,       persisted: true,  aggregateType: 'pipeline-run' },
  [PIPELINE_EVENT_NAMES.SCHEDULE_UPSERTED]: { schema: pipelineScheduleUpsertedPayload, persisted: false, aggregateType: 'pipeline-schedule' },
} as const satisfies EventRegistry;

export type PipelinesRegistry = typeof pipelinesRegistry;

export function makePipelinesEmitters(
  bus: TypedBus<PipelinesRegistry>,
  onEmit?: (envelope: Envelope) => void,
) {
  const emit = createEventHelpers(bus, onEmit);
  return {
    runStarted:       emit(PIPELINE_EVENT_NAMES.RUN_STARTED),
    stageAdvanced:    emit(PIPELINE_EVENT_NAMES.STAGE_ADVANCED),
    runCompleted:     emit(PIPELINE_EVENT_NAMES.RUN_COMPLETED),
    runFailed:        emit(PIPELINE_EVENT_NAMES.RUN_FAILED),
    scheduleUpserted: emit(PIPELINE_EVENT_NAMES.SCHEDULE_UPSERTED),
  };
}

export type PipelinesEmitters = ReturnType<typeof makePipelinesEmitters>;
```

### Example 2: queue.ts — schedule queue + worker registration

Synthesised from `server/lifecycle/queue.ts` (Phase 18) + `server/jobs/queue.ts` (Phase 23).

```typescript
import { z } from 'zod';
import type { PgBoss } from 'pg-boss';
import { QUEUE_NAMES } from '../queue/names.js';

export const PIPELINE_SCHEDULED_EXECUTE_QUEUE_NAME = QUEUE_NAMES.PIPELINE_SCHEDULED_EXECUTE; // requires names.ts extension

export const pipelineScheduledExecutePayloadSchema = z.object({
  pipelineId: z.string(),
  scheduleId: z.string(),
  variables: z.record(z.string(), z.string()),
});

export type PipelineScheduledExecutePayload = z.infer<typeof pipelineScheduledExecutePayloadSchema>;

export async function registerPipelineScheduledExecuteQueue(boss: PgBoss): Promise<void> {
  await boss.createQueue(PIPELINE_SCHEDULED_EXECUTE_QUEUE_NAME, {
    policy: 'standard', // Pipeline runs are independent — no schedule-time dedup
    retryLimit: 0,      // Schedule fires that fail to enqueue runs do not retry; pipeline_runs row is source of truth
  } as never);
}

export async function registerPipelineScheduledExecuteWorker(
  boss: PgBoss,
  handler: (payload: PipelineScheduledExecutePayload, jobId: string) => Promise<void>,
): Promise<string> {
  return boss.work<PipelineScheduledExecutePayload>(
    PIPELINE_SCHEDULED_EXECUTE_QUEUE_NAME,
    async (jobs) => {
      for (const job of jobs) {
        // Defensive parse — payload Zod-validated at the boundary
        const parsed = pipelineScheduledExecutePayloadSchema.parse(job.data);
        await handler(parsed, job.id);
      }
    },
  );
}
```

### Example 3: subscribers.ts — job.completed → stage advance

(See Pattern 2 above for full code.)

### Example 4: lifecycle-ownership.spec.ts — grep-guards (filesystem-based; no shell exec)

Synthesised from `server/jobs/__tests__/lifecycle-ownership.spec.ts` (Phase 23 precedent). The grep is performed via `readdirSync` + `readFileSync` so the test does not invoke a child shell — matches Phase 21/22/23 patterns.

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function walkServer(root: string, found: string[] = []): string[] {
  for (const entry of readdirSync(root)) {
    const full = join(root, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walkServer(full, found);
    } else if (full.endsWith('.ts')) {
      found.push(full);
    }
  }
  return found;
}

describe('Phase 25 lifecycle ownership grep-guards', () => {
  it('SC1: zero `node-cron` imports anywhere in server/', () => {
    const files = walkServer('server');
    const offenders = files.filter((f) => {
      const src = readFileSync(f, 'utf8');
      return /from\s+['"]node-cron['"]/.test(src);
    });
    expect(offenders).toEqual([]);
  });

  it('SC2: executor.ts holds no Promise chain over stages', () => {
    const src = readFileSync('server/pipelines/internal/executor.ts', 'utf8');
    // executor.ts owns ONLY executeScript + evaluateCondition — should NOT
    // reference stage iteration or pipelineRuns.
    expect(src).not.toMatch(/pipeline.*\.stages\b/);
    expect(src).not.toMatch(/pipelineRuns/);
    expect(src).not.toMatch(/triggerRun/);
  });

  it('SC2: service.ts does not poll jobs.status', () => {
    const src = readFileSync('server/pipelines/internal/service.ts', 'utf8');
    expect(src).not.toMatch(/setInterval/);
    expect(src).not.toMatch(/await new Promise\(r => setTimeout\(r, 3000\)\)/); // exact pattern from line 524 today
    expect(src).not.toMatch(/jobs\.status.*deadline/s);
  });

  it('SC1: package.json no longer declares node-cron', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    expect(pkg.dependencies['node-cron']).toBeUndefined();
    expect(pkg.devDependencies['@types/node-cron']).toBeUndefined();
  });
});
```

---

## State of the Art

| Old Approach (today) | Current Approach (Phase 25) | When Changed | Impact |
|----------------------|----------------------------|--------------|--------|
| `node-cron` in-memory schedule Map | `boss.schedule()` per pipeline-schedule row, durable in `pgboss.schedule` | Phase 25 | Survives restart; survives multi-instance (when applicable); standard with lifecycle module. |
| Promise-chain `executeRun` holding sequential for-loop | DB-state + `bus.on('job.completed')` subscriber | Phase 25 | No in-memory state for run progression; survives restart; testable in isolation. |
| Polling `jobs.status` every 3s for matrix completion | DB aggregate query at each `job.completed` arrival | Phase 25 | Removes 3s latency floor + DB hammer; reactive; idempotent. |
| Service holds `runningRuns: Map<runId, AbortController>` | KEEP for in-process script-stage abort; subscriber checks `pipelineRuns.status='cancelled'` before enqueueing next stage | Phase 25 (preserves DEFERRED-25-C functionality) | Cancellation still works; subscriber respects cancellation flag in DB before enqueueing next stage. |

**Deprecated/outdated:**
- `node-cron` v4 — last consumer in tree. After Phase 25 the package is removable from `package.json`.
- `cron.validate()` — pg-boss validates via `CronExpressionParser` at `boss.schedule()` time.
- In-memory Map of cron tasks — replaced by `pgboss.schedule` table.

---

## Open Questions

1. **Pipeline-run cancellation API preservation (DEFERRED-25-C resolution):**
   - What we know: `service.cancelRun(runId)` exists today; called from `DELETE /api/pipeline-runs/:id`. Aborts the AbortController in `runningRuns`. Updates run status to 'cancelled'.
   - What's unclear: After Promise-chain deletion, AbortController has nothing to abort (no in-process task) for maestro stages. Cancellation must instead (a) write `pipelineRuns.status='cancelled'` synchronously, AND (b) signal the subscriber to NOT advance to the next stage when the current stage's job(s) complete.
   - Recommendation: Plan 25-03 keeps the `runningRuns` Map for in-flight script-stage AbortControllers (bash spawn cancellation still works). For maestro stages, cancellation writes `pipelineRuns.status='cancelled'`; the subscriber's `advanceRunOrComplete` reads the status and emits `pipeline.run.cancelled` instead of enqueueing the next stage. Add a `pipeline.run.cancelled` event to the registry (or reuse `pipeline.run.failed` with `reason: 'cancelled'`).

2. **Reconciliation of `pipelineSchedules` ↔ `pgboss.schedule` on boot:**
   - What we know: First-boot or post-deploy state may have drift (Pitfall 6).
   - What's unclear: Should reconcileSchedules run synchronously in `onReady` (potentially blocks server start by N pipelines × 1 boss.schedule call each) or asynchronously fire-and-forget?
   - Recommendation: Synchronous in `onReady`. With < 100 pipelines (typical scale per CONTEXT), this is sub-second. If scale becomes an issue, defer to a Phase 27+ background reconciler. Document expected scale in MODULE.md.

3. **`pipelineRuns.correlationId` column — add or skip?**
   - What we know: ALS-driven correlationId works without a new column (Pattern 3). Persisted events carry it via envelope. Subscriber routing uses DB-driven join, NOT correlationId.
   - What's unclear: Operators might want `SELECT * FROM events WHERE correlation_id = $1` to find all activity for a given run.
   - Recommendation: SKIP the column for Phase 25 (avoids Drizzle migration). Add as DEFERRED-25-E for Phase 27 (when the events-trace API endpoint lands per TRACE-11). The DB-join from `events.aggregateId = pipelineRuns.id` (when aggregateType='pipeline-run') is already sufficient for Phase 27's API.

4. **Should stage-execute be its own pg-boss queue, OR continue piggybacking `job.execute`?**
   - What we know: For maestro stages, the current model creates `job.execute` jobs via `jobService.createJob` → existing pipeline. For script stages, execution stays in-process (bash spawn).
   - What's unclear: Could/should script stages also become a pg-boss queue (`pipeline.script.execute`) for restart resilience? Currently mid-script crash on restart leaves the run hung.
   - Recommendation: SKIP for Phase 25 — out of scope per CONTEXT (script stage behaviour preserved). Document as DEFERRED-25-G for future resilience phase.

5. **Test rewrite scope for `__tests__/integration.test.ts`:**
   - What we know: Existing test asserts on synchronous Promise-chain flow.
   - What's unclear: How much rewrite vs. discard.
   - Recommendation: Plan 25-04 owns this. Estimate 1-2 hours. If rewrite cost balloons, fall back to renaming + `it.skip` with a TODO + DEFERRED-25-H for Phase 30 (Test Migration Cleanup phase).

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.0.18 (server/, root) |
| Config file | `vitest.config.ts` (server-side; web has its own) |
| Quick run command | `npx vitest run server/pipelines` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

(MOD-01..09 are convention IDs; this phase has no direct REQ keys, so the map is keyed to ROADMAP §Phase 25 success criteria.)

| Req | Behavior | Test Type | Automated Command | File Exists? |
|-----|----------|-----------|-------------------|--------------|
| SC1 | `node-cron` no longer imported anywhere in `server/` | unit (filesystem grep-guard) | `npx vitest run server/pipelines/__tests__/lifecycle-ownership.spec.ts -t "zero node-cron"` | ❌ Wave 0 (NEW) |
| SC1 | `package.json` does not declare node-cron / @types/node-cron | unit (filesystem) | `npx vitest run server/pipelines/__tests__/lifecycle-ownership.spec.ts -t "package.json"` | ❌ Wave 0 (NEW) |
| SC1 | `boss.schedule()` upsert is idempotent on (name, key) | integration | `npx vitest run server/pipelines/__tests__/queue.spec.ts -t "idempotent upsert"` | ❌ Wave 0 (NEW; DB-gated) |
| SC1 | `boss.unschedule()` removes the schedule on pipeline DELETE | integration | `npx vitest run server/pipelines/__tests__/queue.spec.ts -t "unschedule on delete"` | ❌ Wave 0 (NEW; DB-gated) |
| SC2 | 3-stage sequential pipeline completes via bus events (zero polling) | integration | `npx vitest run server/pipelines/__tests__/subscriber.spec.ts -t "3-stage pipeline"` | ❌ Wave 0 (NEW; DB-gated) |
| SC2 | correlationId threads through stage 1 → stage 2 → stage 3 jobs | integration | `npx vitest run server/pipelines/__tests__/correlation.spec.ts` | ❌ Wave 0 (NEW; DB-gated) |
| SC2 | `executor.ts` holds no Promise chain over stages | unit (filesystem grep-guard) | `npx vitest run server/pipelines/__tests__/lifecycle-ownership.spec.ts -t "no Promise chain"` | ❌ Wave 0 (NEW) |
| SC2 | `service.ts` does not poll jobs.status | unit (filesystem grep-guard) | same file as above | ❌ Wave 0 (NEW) |
| SC2 | Matrix N-of-N gate: stage advances only when all matrix jobs complete | integration | `npx vitest run server/pipelines/__tests__/subscriber.spec.ts -t "matrix"` | ❌ Wave 0 (NEW; DB-gated) |
| SC3 | Module follows MOD-01..09 conventions | structural | `npm run dep-check` (depcruise) + `npx vitest run server/pipelines/__tests__/module.spec.ts` | ❌ Wave 0 (NEW for module.spec; depcruise extends 9th rule) |
| SC3 | Nyquist passes (-2pp delta) | gate | `npm run nyquist:check` | ✅ (script exists) |
| SC3 | Plugin-order spec extends with pipelines positional + structural assertions | structural | `npx vitest run server/__tests__/plugin-order.spec.ts` | ✅ (extend existing) |
| EVENTS-03 | Event names follow `noun.verbed` past-tense dotted | unit | `npx vitest run server/pipelines/__tests__/events.spec.ts -t "EVENTS-03"` | ❌ Wave 0 (NEW) |
| TRACE-08 | Persisted events register `persisted: true`; transient register `false` | unit | `npx vitest run server/pipelines/__tests__/events.spec.ts -t "TRACE-08"` | ❌ Wave 0 (NEW) |
| TRACE-04 | correlationId from ALS appears on emitted envelopes | unit | `npx vitest run server/pipelines/__tests__/events.spec.ts -t "TRACE-04"` | ❌ Wave 0 (NEW) |

### Sampling Rate
- **Per task commit:** `npx vitest run server/pipelines` (~30s with DB-gated tests skipped if no TEST_DATABASE_URL).
- **Per wave merge:** `npm test` (full server suite).
- **Phase gate:** `npm test` green + `npm run dep-check` clean + `npm run nyquist:check` passes; full suite green before `/gsd:verify-work`.

### Wave 0 Gaps

- [ ] `server/pipelines/events.ts` (placeholder body, full body in 25-01)
- [ ] `server/pipelines/queue.ts` (placeholder body, full body in 25-01)
- [ ] `server/pipelines/internal/module.ts` (throw-stub, real factory in 25-03)
- [ ] `server/pipelines/MODULE.md` (placeholder, full body in 25-05)
- [ ] `server/pipelines/index.ts` (1-line internal barrel)
- [ ] `server/pipelines/__tests__/events.spec.ts` (registry shape stub; full body in 25-01)
- [ ] `server/pipelines/__tests__/queue.spec.ts` (DB-gated; idempotency test in 25-02)
- [ ] `server/pipelines/__tests__/module.spec.ts` (factory shape; in 25-03)
- [ ] `server/pipelines/__tests__/subscriber.spec.ts` (DB-gated; SC2 proof; in 25-04)
- [ ] `server/pipelines/__tests__/correlation.spec.ts` (DB-gated; in 25-04)
- [ ] `server/pipelines/__tests__/lifecycle-ownership.spec.ts` (filesystem grep-guards; in 25-04)
- [ ] `server/__fixtures__/dep-cruiser/bad-pipelines-deep-import.ts` (fires the 9th rule)
- [ ] `.dependency-cruiser.cjs` 9th rule extension (`no-deep-imports-into-pipelines-internal`)
- [ ] `server/queue/names.ts` extension — `PIPELINE_SCHEDULED_EXECUTE: 'pipeline.scheduled.execute'`
- [ ] `package.json` removals: `node-cron` + `@types/node-cron`; lockfile regen via `npm install`

*(All gaps are NEW files / extensions; no missing framework install.)*

---

## Sources

### Primary (HIGH confidence)
- `/Users/heicg/Desktop/projects/device-farm/.planning/phases/18-lifecycle-migration-node-cron-pg-boss/18-RESEARCH.md` — pg-boss v12 schedule API, `boss.unschedule` signature, per-fire correlationId design (Option B), all 9 pitfalls including timezone defaults
- `/Users/heicg/Desktop/projects/device-farm/server/pipelines/scheduler.ts` — verbatim current shape, the only node-cron import in server/
- `/Users/heicg/Desktop/projects/device-farm/server/pipelines/service.ts` — verbatim current `executeRun()` (lines 198-380), `runningRuns` Map, polling loop (523-539), schedule CRUD (95-121)
- `/Users/heicg/Desktop/projects/device-farm/server/pipelines/routes.ts` — schedule CRUD callsites (257, 277, 289)
- `/Users/heicg/Desktop/projects/device-farm/server/pipelines/plugin.ts` — current plugin shape; `dependencies: ['db', 'websocket-plugin', 'job-plugin']`
- `/Users/heicg/Desktop/projects/device-farm/server/jobs/events.ts` — `job.completed` payload schema (lines 145-150) + registry persistence (line 381)
- `/Users/heicg/Desktop/projects/device-farm/server/jobs/internal/subscribers.ts` — Phase 23 `bus.on('job.completed', ...)` precedent for this phase's pipelines subscriber
- `/Users/heicg/Desktop/projects/device-farm/server/lifecycle/queue.ts` — Phase 18 boss.schedule canonical pattern
- `/Users/heicg/Desktop/projects/device-farm/server/lifecycle/internal/module.ts` — factory + persistEnvelope 10-line block (template for 9th sample point in pipelines)
- `/Users/heicg/Desktop/projects/device-farm/server/queue/plugin.ts` — `fastify.queue.send/work/schedule` ALS-aware wrapper (lines 121-227)
- `/Users/heicg/Desktop/projects/device-farm/server/queue/names.ts` — QUEUE_NAMES extension target (line 53)
- `/Users/heicg/Desktop/projects/device-farm/server/db/schema.ts` — pipelines tables (349-408), system_state (469-473) for cancellation flag pattern
- `/Users/heicg/Desktop/projects/device-farm/.dependency-cruiser.cjs` — 8th rule pattern (Phase 24); 9th rule slot ready
- `/Users/heicg/Desktop/projects/device-farm/server/index.ts` — plugin registration order; pipelines plugin at step 17
- `/Users/heicg/Desktop/projects/device-farm/package.json` — node-cron lines 41 + 52 (sole package.json entries to drop)
- `/Users/heicg/Desktop/projects/device-farm/.planning/REQUIREMENTS.md` — Phase 25 requirement count (0 direct; MOD-01..09 conventions)
- `/Users/heicg/Desktop/projects/device-farm/.planning/phases/24-maestro-module/24-CONTEXT.md` — most recent precedent shape (5-6 plan structure)
- `/Users/heicg/Desktop/projects/device-farm/.planning/phases/23-jobs-module-keystone/23-CONTEXT.md` — saga subscriber + cross-module subscription pattern
- `/Users/heicg/Desktop/projects/device-farm/.planning/phases/25-pipelines-module/25-CONTEXT.md` — phase boundary + locked decisions

### Secondary (MEDIUM confidence)
- `node_modules/pg-boss/dist/index.d.ts:68` — `unschedule(name: string, key?: string): Promise<void>` (verified via Phase 18 RESEARCH transcription; not re-read this phase but covered by Phase 18 audit trail)
- `node_modules/pg-boss/dist/types.d.ts:235-238` — `ScheduleOptions = SendOptions & {tz?, key?}` (same source)

### Tertiary (LOW confidence)
- None — all critical claims trace to Phase 18 RESEARCH or directly read source files.

---

## Metadata

**Confidence breakdown:**
- Standard stack: **HIGH** — Phase 18 verified all pg-boss v12 schedule semantics; only removals (no new deps).
- Architecture: **HIGH** — direct precedents from Phase 18 (scheduler) + Phase 23 (subscriber).
- Schedule identity (key vs singletonKey vs pipelineId): **HIGH** — pg-boss API surfaces `key` for per-schedule disambiguation.
- correlationId routing primitive choice (DB-join vs envelope match): **HIGH** — Phase 23 precedent (`subscribers.ts:91` uses payload.jobId, not envelope correlationId).
- Pitfalls: **HIGH** — all drawn from committed Phase 18/23 RESEARCH or current-code reads.
- Cancellation preservation: **MEDIUM** — design proposal in Open Question 1; planner confirms.
- Reconciliation strategy: **MEDIUM** — design proposal in Open Question 2; planner sizes.
- Integration test rewrite scope: **MEDIUM** — Plan 25-04 sizing.

**Research date:** 2026-05-08
**Valid until:** 2026-06-07 (30 days; pg-boss v12.x stable line, no major churn expected)
