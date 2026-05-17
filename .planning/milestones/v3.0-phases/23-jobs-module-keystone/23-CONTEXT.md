# Phase 23: Jobs Module (Keystone) - Context

**Gathered:** 2026-05-08
**Status:** Ready for planning

<domain>
## Phase Boundary

Rewrite `server/jobs/` as the canonical `MODULE.md + barrel index.ts + events.ts + queue.ts + tests-as-spec + createJobsModule(deps)` shape, replacing imperative cross-module calls in `executeJob` with a chained-subscriber saga over the typed bus. Lifecycle: `queued → allocated → running → completed → recording → webhook → cleanup` — every transition fires a named, persisted event; downstream modules (pool / artifacts / reporting / streaming) act as independent subscribers (Phase 19/21 precedent).

In scope:
- New `server/jobs/internal/` shape — module factory, plugin (thin), saga subscribers, executor, repo.
- New events surface (`job.allocated`, `job.running`, `job.recording.requested`, `job.cleanup.requested`, `job.failed` — extends Phase 22 bridgehead `job.queued/log/step/status/started/completed`).
- Idempotency via `singletonKey: jobId` on `job.execute` and `singletonKey: recordingId` on `recording.upload`; `retryLimit: 0` on device-touching handlers.
- DB-join populating `Job.deviceName` (DEBT-02 / CLI-05); Zod output schema asserts non-null deviceName when `deviceId` is non-null.
- In-memory `JobQueue` removed; pg-boss is sole queue surface.
- `/admin/drain` endpoint + `system_state` table (key/value) + drain runbook.
- Resolution of Phase 22 deferred items: DEFERRED-22-D (cleanup via `job.cleanup.requested` event), DEFERRED-22-F (cross-module type imports in job-service.ts), and the long-standing `jobs/plugin.ts → bus/bus.ts` dep-cruiser violation (since Plan 19-01).

Out of scope (carried forward to later phases):
- node-cron pipelines migration → Phase 25.
- maestro service extraction → Phase 24.
- auth.key.* events + ALS actor → Phase 26.
- persistEnvelope helper consolidation → Phase 27+.
- CLI Go codegen consumption → Phase 28.
- Web openapi-fetch + shared WS schemas → Phase 29.

</domain>

<decisions>
## Implementation Decisions

### Saga Orchestration Shape
- **Sequencing:** chained subscribers — each saga step subscribes to the previous step's bus event; modules stay independent. NO central FSM / orchestrator class.
- **State writes:** producer module that owns the transition writes the row (pool writes `jobs.status='allocated'` via subscriber on its own `device.allocated` emission acknowledgement; jobs writes `running/completed/failed`; artifacts writes recording rows; reporting handles webhook). The bus is the single source of truth; status updates flow from event handlers, never from imperative calls in `executeJob`.
- **Error path:** any saga step exception → catching subscriber emits `job.failed` (persisted, EVENTS-10) with `{jobId, step, reason}`; cleanup subscriber on `job.failed` releases device + emits `job.cleanup.requested`. Idempotent via `singletonKey: jobId` so duplicate fail emissions collapse.
- **Invariant assertion:** `server/jobs/__tests__/lifecycle-ownership.spec.ts` readFileSync grep-guards on `job-service.ts`:
  - zero `\.catch\(\(\) => \{\}\)` patterns (success criterion 1).
  - zero `setTimeout\(.*broadcaster.*cleanup` (resolves DEFERRED-22-D).
  - zero `import .* from '\.\./streaming/internal/` (resolves DEFERRED-22-F).
  - zero direct `bus.emit\(` outside the module factory (forces emit through `makeJobsEmitters`).

### Drain Procedure (`/admin/drain`)
- **Operational semantics:** `boss.updateQueue({paused:true})` on `job.execute` (and chained `recording.upload`) → in-flight jobs finish naturally → endpoint returns when in-flight count reaches 0.
- **State persistence:** new `system_state` table (`key TEXT PRIMARY KEY, value JSONB, updated_at TIMESTAMPTZ`). Drain stores `drain_requested_at` row. Lookup is read-on-startup so a restart preserves drain state and the queue stays paused.
- **Auth:** existing `authService.validateKey` gated on the route; for the v3.0 timeline we accept any valid key (admin claim formalized in Phase 26 Auth Module). Plan 23-XX adds a TODO comment + DEFERRED-23-A item carrying the admin-claim gate to Phase 26.
- **Completion semantics:** long-poll `POST /admin/drain?timeout=300` (default 300s, max 1800s). Returns `{drained: true, in_flight: 0, drained_at: <iso>}` once queue is empty, OR `{drained: false, in_flight: N, timeout: true}` on timeout. Emits `system.drain.completed` event (persisted) on success. Idempotent — repeated POSTs while drained return the cached state.
- **Resume:** `POST /admin/drain/resume` clears `drain_requested_at` + `boss.updateQueue({paused:false})` on both queues + emits `system.drain.resumed`.

### deviceName Contract (DEBT-02 / CLI-05)
- **Zod output schema:** the existing `JobResponseSchema` (or its successor in jobs module) gains `deviceName: z.string().min(1).nullable()` — nullable only when `deviceId` is null (job not yet allocated). When `deviceId` is non-null, deviceName MUST be a non-empty string. Refinement enforces the cross-field invariant (`refine((j) => j.deviceId == null || (j.deviceName && j.deviceName.length > 0))`).
- **Population:** repo-level join (`SELECT … LEFT JOIN devices d ON d.id = jobs.device_id` projecting `d.name AS device_name`). Single source of truth at the repo, NOT each route handler.
- **CI enforcement:** spec file `server/jobs/__tests__/contract-devicename.spec.ts` asserts (a) `JobResponseSchema.shape.deviceName` exists, (b) parsing fails when deviceId is set + deviceName is missing/empty, (c) the OpenAPI artifact (`server/openapi.json`) has `deviceName` listed under the `Job` schema's `required`/`properties`. Adding `dropping deviceName from the schema` is mechanically blocked by step (a)+(c).
- **CLI integration:** Phase 28 consumes this via Go codegen. For Phase 23 close, a minimal cross-tier proof: `cli/cmd/status_test.go` (or vitest equivalent if Go test gates aren't part of v3 pipeline yet) asserts the JSON response printed by `device-farm status <id>` contains the device name string when deviceId is non-null. If the Go side is unreachable in autonomous mode, fall back to a server-side integration spec that fixtures a job + asserts response payload shape.

### Module Mechanics (Claude's Discretion — copy from Phase 16-22)
- `MODULE.md`: 9-section template. Header references EVENTS-10 / QUEUE-03 / CLI-05 / DEBT-02. Include Runnable Example covering `enqueueJob → device.allocated → job.running → job.completed → recording → webhook → cleanup`.
- `index.ts` barrel: MOD-02 strict 1-line internal/ re-export with inline `type` modifier (Phase 18+ shape).
- `internal/`: holds `module.ts` (factory), `executor.ts` (extracted from current `job-service.ts` minus emit logic), `repo.ts` (Drizzle queries including the deviceName join), `subscribers.ts` (saga subscribers), `routes.ts` (admin drain endpoint).
- `events.ts`: 5 NEW events (`job.allocated`, `job.running`, `job.recording.requested`, `job.cleanup.requested`, `job.failed`) on top of the Phase 22 bridgehead set; aggregateType: `'jobs'`; persistence per TRACE-08 — terminal/notable events persisted (`completed`, `failed`, `recording.requested`, `cleanup.requested`); high-frequency transient events not persisted (`log`, `step`, `status`, `running`).
- `queue.ts`: `JOB_EXECUTE_QUEUE_NAME` registered with `policy:'standard'`, `singletonKey: jobId`, `retryLimit: 0` on device-touching handler. `RECORDING_UPLOAD_QUEUE_NAME` already in QUEUE_NAMES (Phase 21); jobs queue.ts only owns `job.execute` registration.
- `plugin.ts`: thin Fastify plugin with `dependencies: ['config','db','queue','event-bus','pool-plugin','auth']`. Decorates `fastify.jobsModule`. Replaces existing `jobs/plugin.ts`. Resolves the long-standing `jobs/plugin.ts → bus/bus.ts` violation by going through the module factory (event-bus dependency provides the typed bus).
- `__tests__/`: rename existing `*.test.ts` to `*.spec.ts` via `git mv` 100% similarity (MOD-04). Add: `events.spec.ts` (registry shape), `module.spec.ts` (factory shape), `subscriber.spec.ts` (saga chain proof, DB-gated), `correlation.spec.ts` (correlationId threads end-to-end), `idempotency.spec.ts` (forced double-enqueue → 1 boot — SC2), `lifecycle-ownership.spec.ts` (grep-guards), `contract-devicename.spec.ts` (DEBT-02), `drain-route.spec.ts` (drain endpoint).
- `.dependency-cruiser.cjs`: 7th module rule `no-deep-imports-into-jobs-internal` (continues the Phase 21/22 sequence). Fixture file `__fixtures__/dep-cruiser/bad-jobs-deep-import.ts` fires the rule via `@ts-expect-error`.
- `plugin-order.spec.ts`: additive block — 3 positional + 1 structural readFileSync regex-extract of `jobs/plugin.ts` dependencies literal verifying canonical 6-entry shape verbatim.
- Nyquist gate: -2pp budget; baseline file `.planning/nyquist-baseline.json` unchanged since Phase 15 commit 55ff8ac.

### Wave / Plan Shape (Claude's Discretion)
Mirror Phase 19/20/21/22 wave-0 substrate plan + chained module plans + DB-gated proofs + close. Approximate 7-8 plans:
- 23-00: Wave-0 substrate (events.ts placeholder, queue.ts placeholder, internal/module.ts throw-stub, MODULE.md placeholder, index.ts barrel, dep-cruiser 7th rule, fixture, events.spec EVENTS-03 shape, system_state DB migration).
- 23-01: events body (5 new events) + payload schemas + emitters; jobs registry extends Phase 22 bridgehead.
- 23-02: idempotency layer — singletonKey on `job.execute` + `recording.upload`; queue.ts body; idempotency.spec proves SC2 (forced double-enqueue → 1 device.booted).
- 23-03: deviceName repo join + Zod schema refinement + contract-devicename.spec; OpenAPI regen.
- 23-04: saga subscribers — pool/artifacts/reporting/streaming subscribers wire up; `executeJob` rewrite to fire allocated/running/completed/failed; in-memory `JobQueue` deletion; `setTimeout`-based cleanup deletion; `.catch(() => {})` deletion. Largest plan.
- 23-05: `/admin/drain` + `/admin/drain/resume` routes + system_state read/write + drain-route.spec + system.drain.* events.
- 23-06: DB-gated proofs — subscriber.spec, correlation.spec, lifecycle-ownership.spec; cross-module fixture spec exercising the full saga.
- 23-07: phase close — MODULE.md body + barrel expansion + .test→.spec renames + plugin-order.spec extension + deferred-items.md + Nyquist gate + STATE/ROADMAP updates.

</decisions>

<code_context>
## Existing Code Insights

### Current jobs module state (pre-migration)
- `server/jobs/job-service.ts` (largest module file — locus of imperative calls): `executeJob` orchestrates allocate → maestro → recording → webhook → cleanup with direct injections (`pool`, `artifactService`, `webhookService`, `jobBroadcaster`, `devicePreview`). Multiple `.catch(() => {})` patterns swallow errors. `setTimeout(..., 5000)` triggers `jobBroadcaster.cleanup`.
- `server/jobs/plugin.ts` — currently imports `bus/bus.ts` directly (the dep-check violation flagged from Phase 19 onward). Plugin scope: register routes, decorate `jobService`, `jobQueue` (in-memory FIFO + concurrency lock), `executorRegistry`.
- `server/jobs/job-queue.ts` — in-memory `JobQueue` (FIFO + per-platform mutex). To DELETE in 23-04.
- `server/jobs/events.ts` — exists from Phase 22 bridgehead; carries `job.queued/log/step/status/started/completed/recording.completed`. Phase 23 extends with 5 new events without breaking existing consumers.
- `server/jobs/__tests__/` — multiple `.test.ts` files (job-service, job-queue, plugin, etc.). All to be renamed to `.spec.ts` MOD-04.

### Integration points already locked (Phases 15-22)
- `bus/helpers.ts` `createEventHelpers` factory + `makeXxxEmitters` pattern.
- `bus/typed-bus.ts` typed event subscription with strict registry.
- `queue/plugin.ts` decorates `boss` + `queue.send` wrapper carrying `correlationId` from ALS.
- `bus/middlewares/persist-envelope.ts` (or equivalent in each module's factory — 6 sample copies; Phase 22 DEFERRED-22-E).
- ALS shape: plain-object store `{correlationId, actor?}` (NOT Map); `readAls` dual-shape tolerant.
- `events` table schema: `eventType, eventVersion, aggregateType, aggregateId, correlationId, payload, createdAt` — `aggregateType:'jobs'` + `aggregateId: jobId` for all Phase 23 events.

### Reference implementations to copy from
- Phase 21 artifacts (most recent + most analogous — a producer module with subscribers): `server/artifacts/internal/module.ts`, factory shape, `subscribers.ts` wiring `fastify.onPersisted`.
- Phase 22 streaming (most recent): `server/streaming/internal/module.ts`, plugin.ts thin form, MODULE.md final shape.
- Phase 19 reporting: DLQ + retry + terminal event pattern (closest match for `job.failed` + cleanup chain).
- Phase 18 lifecycle: `boss.schedule` + `boss.updateQueue` API surface used by drain procedure.

### Conventions enforced
- MOD-01 .. MOD-09 (MODULE.md sections, barrel re-export, internal/, .spec.ts, factory, etc.).
- TRACE-06 (correlationId threads through every emit + subscribe), TRACE-08 (persistence policy: terminal & notable events persisted; high-freq events transient).
- EVENTS-03 (dotted past-tense names), EVENTS-10 (saga emits).
- QUEUE-03 (singletonKey), QUEUE-06 (queue ownership in module).
- Nyquist baseline gate (-2pp delta).
- dep-cruiser N-th module rule per phase.
- plugin-order.spec additive block per phase.

### Inherited deferred items resolved here
- DEFERRED-21 (jobs/plugin.ts → bus/bus.ts violation) — resolved by routing through createJobsModule + event-bus dependency.
- DEFERRED-22-D (setTimeout-based broadcaster.cleanup in job-service.ts) — resolved by `job.cleanup.requested` event subscribed by streaming module.
- DEFERRED-22-F (cross-module type imports from streaming/internal/ in job-service.ts) — resolved by routing through `fastify.streamingModule.*` decorator surface.

</code_context>

<specifics>
## Specific Ideas

- The 6-event Phase 22 bridgehead remains untouched in shape; Phase 23 adds 5 new events to the same `JobsRegistry`. Total jobs registry size after Phase 23: 11 events.
- `system_state` table is intentionally generic key/value (NOT a `drain_state` table) — Phase 26 may reuse for auth feature flags; Phase 25 may reuse for pipeline pause state. Minimal forward-compat without speculating use cases.
- `/admin/drain` is the ONLY new HTTP route in Phase 23; OpenAPI artifact gains 2 paths (drain + resume). All other server-side surface remains stable.
- The cross-tier deviceName proof (server response → CLI display) ideally exercises both layers; if Go test integration in autonomous mode is impractical, the server-side integration test alone is sufficient + a Phase 28 task captures the Go-side assertion. Plan 23-03 makes the call based on tooling availability.

</specifics>

<deferred>
## Deferred Ideas

- **DEFERRED-23-A: Admin-claim gate on `/admin/drain`** — Phase 23 lands with any-valid-key auth; Phase 26 Auth Module formalizes admin claim + adds `requireAdmin` middleware. TODO comment in route handler.
- **DEFERRED-23-B: `system.drain.*` event surface owner** — Phase 23 emits these from the jobs module for proximity to the drain endpoint, but they're really cross-cutting. Phase 27+ may extract to a dedicated `system` module if more system-wide events emerge.
- **DEFERRED-23-C: Cross-tier deviceName proof in Go** — if Plan 23-03 cannot reach the Go test surface in autonomous mode, the assertion lands in Phase 28 CLI Refactor as part of generated-types adoption.
- **DEFERRED-23-D: `pgboss_jobs_*` schema isolation per drain test** — drain specs may flake if multiple drain integration tests run in the same pgboss schema. Phase 23 uses ephemeral schemas per Phase 19 precedent; revisit only if flakes appear.

</deferred>
