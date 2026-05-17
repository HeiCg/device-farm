# Phase 25: Pipelines Module - Context

**Gathered:** 2026-05-08
**Status:** Ready for planning
**Type:** Infrastructure phase (auto-skip discuss per autonomous workflow)

<domain>
## Phase Boundary

Restructure `server/pipelines/` into the canonical `MODULE.md + barrel index.ts + events.ts + queue.ts + internal/ + tests-as-spec + createPipelinesModule(deps)` shape. Two distinct migrations land here:

1. **node-cron → boss.schedule()**: `server/pipelines/scheduler.ts` (3.5KB) currently uses `node-cron` (last consumer of the dep — verified by grep). Migrate to pg-boss `boss.schedule()` with idempotent upsert pattern (Phase 18 lifecycle precedent), keyed `pipeline-schedule-${pipelineId}` per the ROADMAP success criterion. Drop `node-cron` + `@types/node-cron` from package.json (lines 41, 52).
2. **Polling executor → bus subscriber**: `server/pipelines/executor.ts` (3.1KB) and `service.ts` (20.8KB) currently advance pipeline stages by holding a local Promise chain or polling. Replace with a subscriber to `job.completed` (Phase 23 keystone event) scoped by `correlationId` matching the pipeline-run aggregate id. A 3-stage pipeline completes without any in-process Promise hold.

In scope:
- New `server/pipelines/internal/` shape; barrel + factory + thin plugin.
- 3-5 new events in pipelinesRegistry: `pipeline.run.started`, `pipeline.stage.advanced`, `pipeline.run.completed`, `pipeline.run.failed`, `pipeline.schedule.upserted` (TBD by planner; minimum 2).
- New `pipeline.scheduled.execute` queue via `boss.schedule()` — idempotent upsert keyed by pipeline id.
- 9th dep-cruiser rule `no-deep-imports-into-pipelines-internal`.
- plugin-order.spec additive block.
- `.test.ts → .spec.ts` renames (count from `__tests__/`).
- Drop `node-cron` + `@types/node-cron` from package.json + run `npm install` to update lockfile.

Out of scope:
- Pipeline definition language/grammar changes — keep current schema/parser as-is.
- Routes refactor beyond barrel-only re-export — `routes.ts` (9.9KB) stays inside `internal/` and registers via plugin onReady.
- Pipeline DAG support (currently sequential stages only) — Phase v2 territory.
- Pipeline-run cancellation API — defer if not currently present.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices follow the locked Phase 16-24 template:
- MODULE.md: 9 H2 sections + Runnable Example (covering schedule + run flow).
- index.ts barrel: MOD-02 strict 1-line internal/ re-export with inline `type` modifier.
- internal/: holds `module.ts` (factory), `service.ts`, `executor.ts`, `scheduler.ts` (refactored to boss.schedule), `routes.ts`, `subscribers.ts`, `git-service.ts`, `secrets.ts`, `variables.ts`, `parser.ts`, `broadcaster.ts`.
- events.ts: 3-5 events; persistence per TRACE-08 — terminal events (`run.completed`, `run.failed`) persisted; transitional (`stage.advanced`, `run.started`, `schedule.upserted`) transient.
- queue.ts: `PIPELINE_SCHEDULED_EXECUTE` queue name + helper that calls `boss.schedule(name, cron, data, {singletonKey: pipelineId})` with the cron expression from the pipeline definition.
- plugin.ts: thin wirer; dependencies `['config','db','queue','event-bus','jobs-plugin']` (jobs-plugin needed because pipeline subscribes to job.completed; verify exact plugin name in jobs registration).
- 9th dep-cruiser rule: mirrors rules 5-8 verbatim.
- Cross-module subscriber wiring deferred to `fastify.addHook('onReady', ...)` per Phase 23 Pitfall 5.
- Tests-as-spec: existing `*.test.ts` → `.spec.ts` rename; new specs for events, queue, module factory, subscriber chain (DB-gated for the job.completed → stage advance round-trip), correlation, lifecycle-ownership grep-guards (zero `node-cron` imports; zero local Promise chain in executor.ts).
- 9th persistEnvelope sample point — DEFERRED-25-A (Phase 27+ owns consolidation; do NOT extract here).

### Migration Strategy: node-cron → boss.schedule
- `boss.schedule(queueName, cronExpression, data, options)` is the public API (Phase 18 reference).
- Idempotent upsert: `boss.schedule()` overwrites prior schedule when called with same queue name + key. Service layer calls `boss.schedule('pipeline.scheduled.execute', cronExpr, {pipelineId}, {singletonKey: pipelineId})` on pipeline create/update; calls `boss.unschedule('pipeline.scheduled.execute', {key: pipelineId})` (or equivalent — verify exact API in research) on delete.
- Worker registered in module factory: `boss.work('pipeline.scheduled.execute', handler)` enqueues a fresh pipeline run via `executor.startRun(pipelineId)`.
- node-cron's `cron.schedule(expr, fn).start()` pattern is replaced with `boss.schedule()` call. The local cron-job map in scheduler.ts is deleted.

### Migration Strategy: Polling/Promise Chain → Bus Subscriber
- Pipeline-run aggregate id pattern: each pipeline run gets a UUID stored in the run row; emitted events carry `aggregateId: runId`.
- `correlationId` set at run start: `correlationId = uuidv4()` stored on the pipeline-run row + threaded through every job submitted as part of the run.
- Subscriber: `bus.on('job.completed', payload)` filters by matching correlationId (or by querying the pipeline-run row by jobId). On match: advance current stage, enqueue next stage's job (or emit `pipeline.run.completed` if no more stages).
- The `executor.ts` local Promise chain (currently holding a per-run state machine) is deleted. State lives in DB: pipeline-run row + stage-result rows.

### Wave Structure
Mirror Phase 24 (6 plans):
- 25-00: Wave-0 substrate (events placeholder, queue.ts placeholder, internal/module.ts throw-stub, MODULE.md placeholder, index.ts barrel, dep-cruiser 9th rule, fixture, events.spec stub).
- 25-01: events body — payload schemas + emitters; queue.ts body with `PIPELINE_SCHEDULED_EXECUTE`.
- 25-02: scheduler.ts boss.schedule migration — replaces node-cron usage; subscriber.spec stub for schedule upsert.
- 25-03: executor + service rewrite — local Promise chain deleted; bus subscriber wires job.completed → stage advance; routes.ts moved into internal/; plugin.ts thin replacement; node-cron + @types/node-cron dropped from package.json.
- 25-04: DB-gated proofs — subscriber.spec (3-stage pipeline completes via bus), correlation.spec (correlationId threads stage 1 → 2 → 3), lifecycle-ownership.spec (zero node-cron imports, zero local Promise chain in executor.ts).
- 25-05: phase close — MODULE.md body + barrel + .test→.spec renames + plugin-order.spec extension + deferred-items.md + Nyquist gate + STATE/ROADMAP.

</decisions>

<code_context>
## Existing Code Insights

### Current pipelines module state
- `server/pipelines/scheduler.ts` (3.5KB) — uses node-cron; only consumer in server/ (verified by grep).
- `server/pipelines/executor.ts` (3.1KB) — runs pipelines; holds Promise chain for stage advancement.
- `server/pipelines/service.ts` (20.8KB) — large; CRUD + DB queries + run orchestration; refactor scope concentrated here.
- `server/pipelines/routes.ts` (9.9KB), `service.ts`, `parser.ts`, `schema.ts`, `secrets.ts`, `variables.ts`, `broadcaster.ts`, `git-service.ts`, `plugin.ts` — relocate under `internal/`.
- `server/pipelines/__tests__/` exists — `.test.ts` → `.spec.ts` rename via `git mv` in 25-05.
- NO `MODULE.md`, NO `index.ts` barrel, NO `internal/`, NO `events.ts`.

### node-cron call sites
- ONLY in `server/pipelines/scheduler.ts` per grep.
- Package.json lines 41 (`"node-cron": "^4.2.1"`) and 52 (`"@types/node-cron": "^3.0.11"`) — drop both.

### Reference implementations
- Phase 18 lifecycle (most direct precedent for boss.schedule migration — successful node-cron → pg-boss conversion).
- Phase 19 reporting (DLQ + retry + terminal event pattern useful for `pipeline.run.failed`).
- Phase 24 maestro (most recent — no-queue-but-emit module template; subscriber wiring via `fastify.addHook('onReady', ...)`).
- Phase 23 jobs (large multi-service module template; `internal/subscribers.ts` cross-module subscriber pattern).

### Conventions enforced
- MOD-01..09; TRACE-06/-08; EVENTS-03; Nyquist gate; dep-cruiser N-th rule; plugin-order.spec extension.
- Cross-module subscribers defer to `fastify.addHook('onReady', ...)`.
- `.test.ts → .spec.ts` rename via `git mv` 100% similarity.
- 9th persistEnvelope sample is DEFERRED-25-A (Phase 27+ consolidation).

</code_context>

<specifics>
## Specific Ideas

- **node-cron is the LAST holdout** — Phase 18 lifecycle was the first migration; Phase 25 closes the loop. After this phase, pg-boss is the sole scheduler in the project.
- The `pipeline.scheduled.execute` queue is the single new pg-boss queue surface in this phase.
- `pipeline-schedule-${id}` naming pattern from ROADMAP — implement as `singletonKey: pipelineId` on the pg-boss `boss.schedule()` call.
- 3-stage sequential pipeline test (subscriber.spec) is the key proof — must succeed end-to-end purely through bus events.

</specifics>

<deferred>
## Deferred Ideas

- **DEFERRED-25-A: persistEnvelope 9th sample point** — Phase 27+ owns consolidation.
- **DEFERRED-25-B: Pipeline DAG / parallel stages** — current scope is sequential only; v2 territory.
- **DEFERRED-25-C: Pipeline-run cancellation API** — out of scope unless already present in current routes.
- **DEFERRED-25-D: Maestro test rewrite (inherited from DEFERRED-24-A)** — Phase 30 owns.

</deferred>
