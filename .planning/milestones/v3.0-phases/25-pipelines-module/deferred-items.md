# Phase 25 Pipelines Module — Deferred Items Catalog

**Phase closed:** 2026-05-08
**Inherited from:** Phase 15 (tsc errors), Phase 17 (test failures), Phase 24 (test rewrite); carried forward unchanged.
**New deferrals from Phase 25:** 8 items targeting Phase 27+ / 30 / future.

---

## Inherited (pre-existing, NOT introduced by Phase 25)

### DEFERRED-17-A: fastify-zod-openapi v5 `required`-emission bug (3 test files)

**Files failing:** `server/api/__tests__/routes.test.ts`, `server/artifacts/__tests__/artifact-routes.test.ts`, `server/auth/__tests__/auth-plugin.test.ts`

**Failure:** fastify-zod-openapi v5 emits `required` fields with array representation instead of object; validator-compiler rejects request bodies that previously validated. Root cause documented in Phase 17 VERIFICATION.md.

**Resolution planned:** Phase 27 API Aggregator (fastify-zod-openapi v6 upgrade or swap to `@fastify/zod`) and Phase 30 Test Migration Cleanup. Phase 25-05 sweep continues to exclude these 3 files from the green-suite check.

**Code marker:** Test files retain `.test.ts` suffix (not `.spec.ts`) as a side-marker that they are pre-existing exclusions.

**Impact on Phase 25:** None. Phase 25 adds zero new HTTP routes; does not touch fastify-zod-openapi surface.

### DEFERRED-15-A: Map-vs-RequestContext typecheck errors

**Files:** assorted — `server/bus/helpers.ts`, `server/queue/plugin.ts`, related subscribers + `server/events/__tests__/emit-helpers.spec.ts` + `server/hooks/__tests__/events.spec.ts`.

**Failure:** TypeScript strict-mode errors related to the ALS store shape migration from Map to plain-object (Phase 15/20 pattern). Functional runtime unaffected (`readAls` helper is dual-shape tolerant). 9 of 10 current tsc errors trace to this.

**Resolution planned:** Phase 27+ (when the final ALS shape cleanup lands).

**Impact on Phase 25:** None. All Phase 25 specs use plain-object ALS shape; baseline tsc error count unchanged across Phases 15-25.

---

## New Phase 25 deferrals (8)

### DEFERRED-25-A: persistEnvelope 9TH SAMPLE POINT consolidation

**Status:** The 10-line `persistEnvelope` middleware in `server/pipelines/internal/module.ts` is the 9th verbatim copy across:

- `server/hooks/internal/module.ts` (Phase 16)
- `server/lifecycle/internal/module.ts` (Phase 18)
- `server/reporting/internal/module.ts` (Phase 19)
- `server/pool/internal/module.ts` (Phase 20)
- `server/artifacts/internal/module.ts` (Phase 21)
- `server/streaming/internal/module.ts` (Phase 22)
- `server/jobs/internal/module.ts` (Phase 23)
- `server/maestro/internal/module.ts` (Phase 24)
- `server/pipelines/internal/module.ts` (Phase 25 — THIS sample)

Pattern is locked-in (9 verbatim instances); consolidation requires touching 9 modules atomically + extracting to `server/bus/persist-envelope.ts`.

**Owner:** Phase 27+ API Aggregator. Replace 9 duplicates with imports.

**Why not Phase 25?** Phase 25 is module-migration scope; consolidation is a tree-wide refactor that's safer post-keystone. Each module extraction (16-25) had higher leverage than the consolidation itself. Phase 24 documented this same trigger at the 8TH sample point under DEFERRED-24-B (now superseded by THIS entry).

### DEFERRED-25-B: Pipeline DAG / parallel stages

**Status:** Pipelines remain sequential-only (one stage at a time, advanced via `job.completed` subscriber). DAG support would require schema changes (`pipeline_stages.dependsOn` column array) + scheduler aggregation logic (multi-parent terminal gate) + UI changes.

**Owner:** v2 / future feature phase. Out of scope per CONTEXT and explicitly listed in MODULE.md §Non-Goals.

**Why not Phase 25?** The two SC1+SC2 migrations (node-cron drop + bus-driven advancement) are independent of pipeline-shape evolution. DAG is a feature; Phase 25 is infrastructure.

### DEFERRED-25-C: Pipeline-run cancellation API (RESOLVED IN-PHASE)

**Status:** RESOLVED inside Phase 25 — preserved as `runningRuns: Map<runId, AbortController>` on `PipelineService` for in-process script-stage abort + a DB `pipelineRuns.status='cancelled'` short-circuit in `subscribers.advanceRunOrComplete` (subscriber reads pipelineRuns.status before advancing; cancelled runs short-circuit to `runFailed` emission).

**Rationale:** RESEARCH Open Question 1 resolved by preserving cancellation. The new bus-driven flow does not eliminate the need to abort in-flight script stages — the `AbortController` map is the only safe way to interrupt a `bash` spawn. The DB status check ensures the bus subscriber doesn't continue advancing a cancelled run when `job.completed` fires for an in-flight stage.

**Owner:** N/A (closed in Phase 25 Plan 25-03).

**Why noted here:** Tracking transparency — anyone reading the deferral catalog should see this was actively considered and resolved, not silently dropped.

### DEFERRED-25-D: Maestro test rewrite (inherited DEFERRED-24-A)

**Status:** Phase 24 Plan 24-05 performed only `.test.ts → .spec.ts` rename via `git mv` for `hierarchy-service.spec.ts` + `appium-service.spec.ts`. Body rewrite to tests-as-spec style is Phase 30 scope.

**Files affected:** `server/maestro/__tests__/hierarchy-service.spec.ts`, `server/maestro/__tests__/appium-service.spec.ts`.

**Owner:** Phase 30 Test Migration Cleanup. Carry-forward from Phase 24.

**Why not Phase 25?** Phase 25 is the pipelines module — touching maestro tests outside the scope boundary is creep. Tests-as-spec rewrite is a tree-wide cleanup performed once across all v3.0 modules in Phase 30.

### DEFERRED-25-E: `pipelineRuns.correlationId` column

**Status:** RESEARCH Open Question 3 resolved as SKIP — ALS-driven correlationId works via envelope persistence; the events-table aggregateId join is sufficient for trace queries from Phase 27's `GET /api/events?correlationId=…` endpoint.

**Owner:** Phase 27 (events-trace API endpoint). Add the column ONLY if Phase 27's design needs the convenience join (vs. recursing through events-table causation chains).

**Why not Phase 25?** Adding a DB column for trace convenience before the trace-query API exists is speculative. Phase 27 owns the consumer; let Phase 27 decide if the column is worth the migration.

### DEFERRED-25-F: Per-schedule timezone column

**Status:** Phase 25 defaults all schedules to UTC (Pitfall 10 — `tz: 'UTC'` is explicit in `upsertPipelineSchedule`). Schedules authored under node-cron's local-tz semantics may have timing drift on the first fire after deploy (e.g. a schedule that fired at "02:00 local" before now fires at "02:00 UTC").

**Owner:** Future feature phase. The `pipelineSchedules` Drizzle table would need a `tz: text('tz').notNull().default('UTC')` column + the route surface would need to accept it + the upsert helper would need to thread it through to `boss.schedule({tz})`.

**Why not Phase 25?** RESEARCH locked Phase 25 scope to the cutover (drop node-cron + use boss.schedule). UTC default is documented in MODULE.md §Non-Goals. Operators with existing local-tz schedules can manually adjust cron expressions on first deploy.

### DEFERRED-25-G: Script-stage durability across server restart

**Status:** RESEARCH Open Question 4 resolved as SKIP — script stages stay in-process (bash spawn via `child_process`). Mid-script crash on restart still hangs the run; the next bus event for the run never fires because the in-flight `child_process` is dead.

**Owner:** Future resilience phase. Two paths: (a) move script stages to their own pg-boss queue (durable retry across restarts) or (b) heartbeat a `pipeline_stages.last_seen_at` column + a janitor that fails stale stages on boot.

**Why not Phase 25?** Out of scope per CONTEXT scope boundary. Script-stage durability is a separate hardening pass; Phase 25 focuses on the scheduler + advancement migrations.

### DEFERRED-25-H: `integration.spec.ts` rewrite cost-balloon fallback (PATH B taken)

**Status:** Plan 25-05 Task 5.2 took PATH B (skip-with-TODO) per the plan's documented alternatives. The body of `server/pipelines/__tests__/integration.spec.ts` was authored against legacy synchronous `executeRun` semantics (Pitfall 7); under the new bus-driven flow, the mock-DB harness cannot exercise the bus subscriber chain. Both `it()` cases are wrapped in `it.skip` with TODOs pointing at this deferral.

**Files affected:** `server/pipelines/__tests__/integration.spec.ts`.

**Owner:** Phase 30 Test Migration Cleanup. The rewrite should mirror `subscriber.spec.ts` shape (DB-gated, real `pg-boss`, `vi.waitFor` against `pipeline.run.completed` bus events) — coverage of Plan 25-04's `subscriber.spec.ts` + `correlation.spec.ts` already proves the bus flow end-to-end, so the integration rewrite is a tests-as-spec hardening rather than a coverage gap.

**Why not Phase 25?** PATH A (rewrite in-line) was estimated at 1-2 hours per CONTEXT; with subscriber.spec already proving the bus flow, the marginal value of an in-line rewrite during phase close is below the budget threshold. PATH B keeps MOD-04 honored (file is `.spec.ts`, not `.test.ts`) without bus harness duplication.

---

Total: 8 Phase 25-specific deferrals + 2 carry-forwards = 10 tracked items at Phase 25 close.

Phase 26 Auth Module unblocked. Phase 27+ owns DEFERRED-25-A persistEnvelope consolidation (9TH SAMPLE POINT) + DEFERRED-25-E correlationId column. Phase 30 Test Migration Cleanup owns DEFERRED-25-D maestro test rewrite (inherited) + DEFERRED-25-H integration.spec rewrite. Future phases own DEFERRED-25-B DAG support + DEFERRED-25-F per-schedule timezone + DEFERRED-25-G script-stage durability.

Note: the pre-existing `server/pipelines/internal/pipeline-schema.ts:17` Zod v4 incompatibility (`expected 2-3 arguments, but got 1`) flagged in 25-04 SUMMARY is included in the inherited DEFERRED-15-A tsc count (10 errors total: 9 Map-vs-RequestContext + 1 pipeline-schema Zod arg). It's a Zod v4 migration artifact, not a Phase 25 regression — pipeline-schema.ts was NOT touched by Phase 25.
