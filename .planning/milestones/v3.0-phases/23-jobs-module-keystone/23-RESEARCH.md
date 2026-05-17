# Phase 23: Jobs Module (Keystone) - Research

**Researched:** 2026-05-08
**Domain:** Saga-orchestrated job module + pg-boss singleton idempotency + drain procedure + DB-join contract enforcement
**Confidence:** HIGH (most areas) / MEDIUM (drain semantics — pg-boss has no native pause API; resolved with concrete alternative)

## Summary

Phase 23 is the keystone of the v3.0 module migration. The pre-existing patterns from Phases 16-22 (Hooks, Lifecycle, Reporting, Pool, Artifacts, Streaming) are now strongly templated and directly applicable. The substantive open questions are NOT the module mechanics (those are templated) but instead five specific systems concerns:

1. **Saga ownership** — chained subscribers in producing modules (already templated by Phase 21 artifacts and Phase 22 streaming consuming jobs events).
2. **pg-boss singletonKey semantics** — verified empirically in Phase 16-01 (`policy:'stately'` REQUIRED for singletonKey dedup; default `'standard'` ignores it). Duplicate enqueue with `policy:'stately'+singletonKey` returns `null` from `boss.send()`.
3. **Drain procedure** — **critical pivot**: pg-boss v12 has NO native pause/paused API on `updateQueue`. Drain must use `boss.offWork(name)` (stops THIS server's worker) + a `system_state` flag that emit-time check skips enqueue + wait for in-flight workers. CONTEXT.md's `boss.updateQueue({paused:true})` API does not exist.
4. **deviceName Zod refinement** — `.refine()` cross-field with regenerate-OpenAPI verification.
5. **Migration sequencing** — events.ts → idempotency → deviceName → subscribers → executor rewrite → JobQueue deletion → drain endpoint, mirrors Phase 21 plan order.

**Primary recommendation:** Adopt CONTEXT.md's plan structure verbatim BUT replace the drain mechanism with `boss.offWork(JOB_EXECUTE) + boss.offWork(RECORDING_UPLOAD)` plus a `system_state.drain_requested_at` row that `JobsModule.executeAdmission` checks before `boss.send('job.execute', ...)`. Plan 23-05 owns this correction.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Saga Orchestration Shape:**
- **Sequencing:** chained subscribers — each saga step subscribes to the previous step's bus event; modules stay independent. NO central FSM / orchestrator class.
- **State writes:** producer module that owns the transition writes the row (pool writes `jobs.status='allocated'` via subscriber on its own `device.allocated` emission acknowledgement; jobs writes `running/completed/failed`; artifacts writes recording rows; reporting handles webhook). The bus is the single source of truth; status updates flow from event handlers, never from imperative calls in `executeJob`.
- **Error path:** any saga step exception → catching subscriber emits `job.failed` (persisted, EVENTS-10) with `{jobId, step, reason}`; cleanup subscriber on `job.failed` releases device + emits `job.cleanup.requested`. Idempotent via `singletonKey: jobId` so duplicate fail emissions collapse.
- **Invariant assertion:** `server/jobs/__tests__/lifecycle-ownership.spec.ts` readFileSync grep-guards on `job-service.ts`:
  - zero `\.catch\(\(\) => \{\}\)` patterns (success criterion 1).
  - zero `setTimeout\(.*broadcaster.*cleanup` (resolves DEFERRED-22-D).
  - zero `import .* from '\.\./streaming/internal/` (resolves DEFERRED-22-F).
  - zero direct `bus.emit\(` outside the module factory (forces emit through `makeJobsEmitters`).

**Drain Procedure (`/admin/drain`):**
- **Operational semantics:** `boss.updateQueue({paused:true})` on `job.execute` (and chained `recording.upload`) → in-flight jobs finish naturally → endpoint returns when in-flight count reaches 0.
  - **⚠️ RESEARCH NOTE — see Pitfall 1 below:** pg-boss v12 has NO `paused` flag. CONTEXT's stated API does not exist. Resolution mechanism documented in §Drain Procedure Reality Check below.
- **State persistence:** new `system_state` table (`key TEXT PRIMARY KEY, value JSONB, updated_at TIMESTAMPTZ`). Drain stores `drain_requested_at` row. Lookup is read-on-startup so a restart preserves drain state and the queue stays paused.
- **Auth:** existing `authService.validateKey` gated on the route; for the v3.0 timeline we accept any valid key (admin claim formalized in Phase 26 Auth Module).
- **Completion semantics:** long-poll `POST /admin/drain?timeout=300` (default 300s, max 1800s). Returns `{drained: true, in_flight: 0, drained_at: <iso>}` or `{drained: false, in_flight: N, timeout: true}`. Emits `system.drain.completed` event (persisted) on success. Idempotent.
- **Resume:** `POST /admin/drain/resume` clears `drain_requested_at` + un-pauses both queues + emits `system.drain.resumed`.

**deviceName Contract (DEBT-02 / CLI-05):**
- **Zod output schema:** `JobResponseSchema` (or its successor in jobs module) gains `deviceName: z.string().min(1).nullable()` — nullable only when `deviceId` is null. Refinement enforces cross-field invariant (`refine((j) => j.deviceId == null || (j.deviceName && j.deviceName.length > 0))`).
- **Population:** repo-level join (`SELECT … LEFT JOIN devices d ON d.id = jobs.device_id` projecting `d.name AS device_name`). Single source of truth at the repo, NOT each route handler.
- **CI enforcement:** spec file `server/jobs/__tests__/contract-devicename.spec.ts` asserts (a) `JobResponseSchema.shape.deviceName` exists, (b) parsing fails when deviceId is set + deviceName is missing/empty, (c) the OpenAPI artifact (`server/openapi.json`) has `deviceName` listed under the `Job` schema's `required`/`properties`.
- **CLI integration:** Phase 28 consumes via Go codegen. Phase 23 close: cross-tier proof (Go test if reachable; otherwise server-side integration spec; if Go test surface unreachable → DEFERRED-23-C carries to Phase 28).

**Module Mechanics (Claude's Discretion — copy from Phase 16-22):**
- MODULE.md 9-section template with Runnable Example covering full saga.
- index.ts barrel: MOD-02 strict 1-line internal/ re-export.
- internal/ holds: `module.ts` (factory), `executor.ts`, `repo.ts`, `subscribers.ts`, `routes.ts`.
- events.ts: 5 NEW events (`job.allocated`, `job.running`, `job.recording.requested`, `job.cleanup.requested`, `job.failed`) on top of Phase 22 bridgehead 6 events. Total: 11 events in JobsRegistry post-Phase-23.
- queue.ts: `JOB_EXECUTE_QUEUE_NAME` registered with `policy:'stately'`, `singletonKey: jobId` per-send, `retryLimit: 0` on device-touching handler.
- plugin.ts: thin Fastify plugin with `dependencies: ['config','db','queue','event-bus','pool-plugin','auth']`. Decorates `fastify.jobsModule`.
- `__tests__/`: `*.test.ts` → `*.spec.ts` via `git mv` 100% similarity (MOD-04). Add: `events.spec.ts`, `module.spec.ts`, `subscriber.spec.ts`, `correlation.spec.ts`, `idempotency.spec.ts`, `lifecycle-ownership.spec.ts`, `contract-devicename.spec.ts`, `drain-route.spec.ts`.
- `.dependency-cruiser.cjs`: 7th module rule `no-deep-imports-into-jobs-internal`.
- `plugin-order.spec.ts`: additive block — 3 positional + 1 structural readFileSync regex-extract verifying canonical 6-entry shape.
- Nyquist gate: -2pp budget; baseline file unchanged since Phase 15 commit 55ff8ac.

### Claude's Discretion

- saga subscriber wiring (where each subscriber lives — same module or each owner?)
- atomic execution path of the saga (single plan vs staged delete of imperative `executeJob` body)
- `singletonKey` collision semantics in pg-boss (drops vs fails)
- `boss.updateQueue({paused})` actual API + state propagation across server restarts ⚠️ **RESEARCH RESOLVED IN PITFALL 1 — DOES NOT EXIST**
- `system_state` table schema + migration sequencing alongside DB-gated specs
- Zod refinement strategy for cross-field invariant
- OpenAPI emit path for the `Job` schema + how to detect deviceName drop in CI
- 5-event payload schemas + TRACE-08 persistence policy per event
- Migration sequence ordering
- Validation Architecture (Nyquist) — must include
- Pitfalls

### Deferred Ideas (OUT OF SCOPE)

- **DEFERRED-23-A: Admin-claim gate on `/admin/drain`** — Phase 23 lands with any-valid-key auth; Phase 26 Auth Module formalizes admin claim + `requireAdmin` middleware.
- **DEFERRED-23-B: `system.drain.*` event surface owner** — Phase 23 emits these from the jobs module for proximity to the drain endpoint; Phase 27+ may extract to a dedicated `system` module if more system-wide events emerge.
- **DEFERRED-23-C: Cross-tier deviceName proof in Go** — if Plan 23-03 cannot reach the Go test surface in autonomous mode, the assertion lands in Phase 28.
- **DEFERRED-23-D: `pgboss_jobs_*` schema isolation per drain test** — drain specs may flake if multiple drain integration tests run in the same pgboss schema. Phase 23 uses ephemeral schemas per Phase 19 precedent.

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| EVENTS-10 | Saga orquestrada do job lifecycle (queued → allocated → running → completed → recording → webhook → cleanup) substitui calls imperativos no job-service; cada transicao emite evento | §Saga Architecture (chained-subscriber pattern, EVENTS-10 5 new events extending Phase 22 bridgehead) + §Code Examples §1-3 + §Reference Implementations §Phase 21 / Phase 19 |
| QUEUE-03 | `job.execute` e `recording.upload` usam `singletonKey` (jobId / recordingId) impedindo double-spawn de emulator | §Standard Stack pg-boss + §Don't Hand-Roll #1 + §Pitfalls Pitfall 2 (policy:'stately' required) + §Code Example #2 + §Validation Architecture idempotency.spec |
| CLI-05 | `Job.DeviceName` populado corretamente pelo server response; CLI status exibe nome legivel, nao UUID | §deviceName Contract Architecture + §Code Example #4 + §Validation Architecture contract-devicename.spec |
| DEBT-02 | `Job.DeviceName` existe no schema Zod, populado pelo server em todos os endpoints que retornam job; CLI mostra device name ao inves de UUID | Co-validated with CLI-05; same research support |
</phase_requirements>

## Standard Stack

### Core (already in repo — DO NOT add new dependencies)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| pg-boss | ^12 | Job queue (job.execute + recording.upload + system queues) | Project standard since Phase 15. Single-node Postgres. |
| Zod | ^4.3.6 | Boundary schemas + cross-field refinement | SPEC-01..03 mandated everywhere |
| Drizzle | 0.45.1 | DB queries — repo-level join for deviceName | Repo-wide ORM standard |
| Fastify | 5.x | HTTP plugin + decorator surface | Existing transport |
| fastify-zod-openapi | ^5 | Auto-emit `components.schemas.Job` to openapi.json | Phase 17 contract pipeline standard |
| `async-mutex` | (existing) | NOT NEEDED in new design — replaced by pg-boss singletonKey | Was used by `JobQueue` dispatchMutex |

### Module Convention Stack (replicated from Phase 16-22)

| File | Owner | Purpose |
|------|-------|---------|
| `server/jobs/events.ts` | jobs | EVENTS-10: 5 new + 6 existing = 11 event registry entries; emit helpers |
| `server/jobs/queue.ts` | jobs | `JOB_EXECUTE_QUEUE_NAME` constant + worker registration with singletonKey |
| `server/jobs/internal/module.ts` | jobs | `createJobsModule(deps)` factory (MOD-06) |
| `server/jobs/internal/executor.ts` | jobs | Pure execution loop extracted from job-service.ts (no emits) |
| `server/jobs/internal/repo.ts` | jobs | Drizzle queries — `findJobById` with deviceName join |
| `server/jobs/internal/subscribers.ts` | jobs | Saga chain subscribers (job.allocated → run job, job.completed → cleanup, etc.) |
| `server/jobs/internal/routes.ts` | jobs | `/admin/drain` + `/admin/drain/resume` routes |
| `server/jobs/plugin.ts` | jobs | Thin Fastify plugin (replaces existing 122-line plugin) |
| `server/jobs/MODULE.md` | jobs | 9-section contract |
| `server/jobs/index.ts` | jobs | Barrel (MOD-02 strict 1-line internal/ re-export) |
| `server/jobs/schemas.ts` | jobs | EXISTING — extend with `JobResponseSchema` + deviceName refinement (DEBT-02) |

### Alternatives Considered

| Instead of | Could Use | Tradeoff (rejected because) |
|------------|-----------|------------------------------|
| Chained subscribers | XState / state machine library | CONTEXT § locks "NO central FSM"; chained subs match Phase 19/21 precedent. Choreographed not orchestrated. |
| pg-boss singletonKey | Application-level dedup via Redis | No Redis in stack; pg-boss's singletonKey + policy:'stately' is sufficient (empirical Phase 16-01 verification). |
| `boss.updateQueue({paused})` | `boss.offWork(name)` + system_state flag | **CRITICAL — see Pitfall 1.** Pg-boss has NO native pause API. CONTEXT's stated API does not exist; alternative documented below. |
| In-process `JobQueue` (FIFO) | pg-boss alone | Phase 23 success criterion 4: REMOVE in-memory JobQueue. pg-boss is sole queue; `boss.send('job.execute', payload, {singletonKey: jobId})` replaces `queue.enqueue()`. |
| `policy: 'standard'` for job.execute | `policy: 'stately'` | **REQUIRED** — singletonKey is IGNORED on `policy:'standard'`. Phase 16-01 empirical verification (node_modules/pg-boss/dist/plans.js:467-485). |

**Installation:** No new packages needed. Optional dev-time:
```bash
# Verify no new deps required:
npm ls pg-boss zod drizzle-orm fastify fastify-zod-openapi
```

## Architecture Patterns

### Recommended Project Structure

```
server/jobs/
├── MODULE.md                          # 9-section contract (Phase 23 close)
├── index.ts                           # Barrel — 1-line re-export from internal/
├── plugin.ts                          # Thin Fastify plugin
├── events.ts                          # 11-event registry (existing 6 + 5 new)
├── queue.ts                           # JOB_EXECUTE queue registration
├── schemas.ts                         # JobResponseSchema (existing + deviceName refinement)
├── types.ts                           # QueuedJob etc. — keep existing
├── auto-link-service.ts               # Existing — leave as-is
├── maestro-parser.ts                  # Existing — leave as-is
├── ws-schemas.ts                      # Existing — leave as-is
├── internal/
│   ├── module.ts                      # createJobsModule factory (MOD-06)
│   ├── executor.ts                    # Pure execution loop (extracted from job-service)
│   ├── repo.ts                        # Drizzle queries with deviceName join
│   ├── subscribers.ts                 # Saga subscribers
│   └── routes.ts                      # /admin/drain + /admin/drain/resume
└── __tests__/
    ├── events.spec.ts                 # 11-event registry shape + EVENTS-03 + TRACE-08
    ├── module.spec.ts                 # Factory shape + shutdown idempotency
    ├── subscriber.spec.ts             # Saga chain proof (DB-gated)
    ├── correlation.spec.ts            # correlationId end-to-end (DB-gated)
    ├── idempotency.spec.ts            # SC2 — forced double-enqueue → 1 boot
    ├── lifecycle-ownership.spec.ts    # readFileSync grep-guards (4 patterns)
    ├── contract-devicename.spec.ts    # DEBT-02 / CLI-05 cross-field refinement
    ├── drain-route.spec.ts            # /admin/drain semantics (DB-gated)
    ├── job-executor.spec.ts           # MOD-04 rename from .test.ts
    ├── job-service.spec.ts            # MOD-04 rename
    ├── job-queue.spec.ts              # MOD-04 rename — DELETE after Plan 23-04
    └── maestro-parser.spec.ts         # MOD-04 rename
```

**Files to DELETE in Plan 23-04:**
- `server/jobs/job-queue.ts` (in-memory FIFO)
- `server/jobs/__tests__/job-queue.spec.ts` (after rename)

**Files to MOVE under `internal/` in Plan 23-04 (`git mv` 100% similarity):**
- `server/jobs/job-service.ts` → `server/jobs/internal/job-service.ts` (during rewrite)
- `server/jobs/job-executor.ts` → `server/jobs/internal/executor.ts`

### Pattern 1: Chained-Subscriber Saga (EVENTS-10)

**What:** Each saga step is a bus subscription in the module that owns the resource. NO orchestrator.

**Wiring:**
```
Producer (HTTP route handler)
  → boss.send('job.execute', {jobId}, {singletonKey: jobId})

job.execute worker (in jobs module)
  → executor.run(jobId) [imperative within worker — single concern]
    → emit job.allocated   (jobs module emits)
    → emit job.running     (jobs module emits)
    → emit job.completed | job.failed (jobs module emits — terminal)

artifacts module subscribes to job.completed → recording.upload queue.send + emit recording.stopped
reporting module subscribes to job.completed → webhook.deliver queue.send

streaming module subscribes to job.cleanup.requested → broadcaster.cleanup
pool module subscribes to job.failed | job.completed → release device (already in current jobs/job-service.ts finally block — MOVES to pool subscriber)
```

**Source:** `server/artifacts/internal/module.ts:182-377` (Phase 21 reference — exact shape).

### Pattern 2: Saga Subscriber Lives In OWNER Module

**Decision:** Each subscriber lives in the module that owns the side effect. NOT in jobs module.

| Subscribed Event | Subscriber Module | Side Effect |
|------------------|-------------------|-------------|
| `job.completed` | artifacts (existing — Phase 21) | enqueue recording.upload |
| `job.completed` | reporting (existing — Phase 19) | enqueue webhook.deliver |
| `job.completed` | jobs (new — internally) | finalize DB row |
| `job.failed` | jobs (new) | mark DB failed; emit `job.cleanup.requested` |
| `job.failed` | pool (new) | release device |
| `job.cleanup.requested` | streaming (new — resolves DEFERRED-22-D) | jobBroadcaster.cleanup(jobId) |
| `job.cleanup.requested` | jobs (new) | rm temp dirs, APK file |
| `device.allocated` | jobs (new) | UPDATE jobs SET status='allocated', deviceId, startedAt |
| `device.released` | jobs (new) | NO-OP (post-completion accounting only — pool already releases) |

**Why:** Phase 21 precedent — artifacts module owns `recording.upload`, subscribes to `job.completed`. Phase 19 precedent — reporting subscribes to `job.completed`, owns `webhook.deliver`. Phase 23 ADDS subscribers to existing modules; does NOT centralize them.

**Source:** Phase 21 `server/artifacts/internal/module.ts:182-377`; Phase 19 `server/reporting/internal/module.ts`.

### Pattern 3: Atomic Execution Path

**Decision:** Plan 23-04 executes the rewrite as a SINGLE atomic substitution. NOT staged.

**Reason:** Staged delete creates intermediate states where some events fire and some imperative calls remain. Phase 21 Plan 21-04 used the same pattern (single-plan rewrite of `executeJob` to remove 9 imperative artifact callsites and replace with 2 emits). The 4 grep-guards in `lifecycle-ownership.spec.ts` (zero `.catch(() => {})`, zero `setTimeout(...broadcaster...cleanup)`, zero streaming/internal imports, zero direct `bus.emit()` outside factory) are designed to mechanically enforce the post-state.

### Pattern 4: deviceName Repo-Level Join

**What:** Single-source-of-truth at `internal/repo.ts`. All routes read through repo.

**Code:**
```typescript
// server/jobs/internal/repo.ts
import { eq } from 'drizzle-orm';
import * as schema from '../../db/schema.js';
import type { Database } from '../../db/index.js';

export async function findJobById(db: Database, jobId: string) {
  const rows = await db
    .select({
      // jobs columns
      id: schema.jobs.id,
      status: schema.jobs.status,
      platform: schema.jobs.platform,
      deviceId: schema.jobs.deviceId,
      // ...
      // joined column — single source of truth
      deviceName: schema.devices.name,
    })
    .from(schema.jobs)
    .leftJoin(schema.devices, eq(schema.devices.id, schema.jobs.deviceId))
    .where(eq(schema.jobs.id, jobId))
    .limit(1);
  return rows[0] ?? null;
}

export async function listJobs(db: Database, filters: ListFilters) {
  // Same join applied
}
```

**Source:** Drizzle leftJoin docs + existing pattern (e.g., none yet — but matches `server/api/routes.ts` which currently does NOT join).

### Pattern 5: Zod Refinement for Cross-Field Invariant (DEBT-02)

**Code:**
```typescript
// server/jobs/schemas.ts (extension)
import { z } from 'zod';

export const jobResponseSchema = z.object({
  id: z.string().uuid(),
  status: jobStatusSchema,
  platform: platformSchema,
  deviceId: z.string().uuid().nullable(),
  deviceName: z.string().min(1).nullable(),
  // ... other fields
}).refine(
  (j) => j.deviceId == null || (j.deviceName !== null && j.deviceName.length > 0),
  { message: 'deviceName must be non-empty when deviceId is present' }
).meta({
  id: 'Job',
  description: 'Full job record including allocated device name (joined from devices table)',
});

export type JobResponse = z.infer<typeof jobResponseSchema>;
```

**Note on `.meta({id: 'Job'})`:** This emits as `components.schemas.Job` in `server/openapi.json` via fastify-zod-openapi. The `contract-devicename.spec.ts` reads `openapi.json` and asserts `Job` schema has `deviceName` in `properties` and (if branding requires) in `required`.

**Source:** Phase 17 Plan 17-01 pattern in `server/jobs/schemas.ts` (existing `jobSummarySchema` uses `.meta({id: 'JobSummary'})`); Zod docs `.refine()` API.

### Pattern 6: Drain Procedure Reality Check ⚠️

**CONTEXT.md states:** `boss.updateQueue({paused:true})` halts the queue.

**RESEARCH FINDING:** This API does NOT exist in pg-boss v12.

**Evidence:**
- `node_modules/pg-boss/dist/types.d.ts:421` — `UpdateQueueOptions = Omit<Queue, 'name' | 'partition' | 'policy'>` — and `Queue` interface (lines 191-224) has NO `paused` field.
- `node_modules/pg-boss/dist/manager.d.ts:81` — `updateQueue(name, options): Promise<void>` only mutates retention/retry/expire/heartbeat options.
- `grep -rn "paused\|pauseQueue" node_modules/pg-boss/` returns ZERO matches.
- GitHub issue [#330](https://github.com/timgit/pg-boss/issues/330) and [#421](https://github.com/timgit/pg-boss/issues/421) confirm: pg-boss has no native pause/drain API; community workarounds use `offWork(name)`.

**Working alternative — Plan 23-05 mechanism:**

```typescript
// server/jobs/internal/routes.ts
fastify.post('/admin/drain', async (req, reply) => {
  // 1. Persist intent (so restarts honor drain state)
  await db.insert(schema.systemState).values({
    key: 'drain_requested_at',
    value: { iso: new Date().toISOString() },
  }).onConflictDoUpdate({ target: schema.systemState.key, set: {...} });

  // 2. Stop THIS server's worker(s) — workers stop fetching new jobs
  await fastify.boss.offWork(JOB_EXECUTE_QUEUE_NAME, { wait: false });
  await fastify.boss.offWork(RECORDING_UPLOAD_QUEUE_NAME, { wait: false });

  // 3. Wait for in-flight runningJobs map size = 0 (long-poll up to timeout)
  const start = Date.now();
  const timeoutMs = (parseInt(req.query.timeout) ?? 300) * 1000;
  while (Date.now() - start < timeoutMs) {
    const inFlight = jobsModule.getInFlightCount();
    if (inFlight === 0) {
      await emit.drainCompleted({ drainedAt: new Date().toISOString() });
      return reply.send({ drained: true, in_flight: 0, drained_at: ... });
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  return reply.send({ drained: false, in_flight: jobsModule.getInFlightCount(), timeout: true });
});

fastify.post('/admin/drain/resume', async (req, reply) => {
  // 1. Clear DB flag
  await db.delete(schema.systemState).where(eq(schema.systemState.key, 'drain_requested_at'));

  // 2. Re-register workers (singletonKey for restart safety)
  await jobsModule.registerWorker();              // or boss.work() with same handler
  await fastify.artifactsModule.registerUploadWorker();

  // 3. Emit + ack
  await emit.drainResumed({ resumedAt: ... });
  return reply.send({ resumed: true });
});
```

**Critical addition — admission check on enqueue path:**

The `offWork` call only stops THIS server from fetching jobs from queues; it does not block producers from `boss.send`. To prevent backlog accumulation during drain:

```typescript
// server/jobs/internal/module.ts — JobsModule.enqueueJob
async function enqueueJob(jobId, payload) {
  const drain = await db.select().from(schema.systemState)
    .where(eq(schema.systemState.key, 'drain_requested_at')).limit(1);
  if (drain.length > 0) {
    throw new HttpError(503, 'Server draining — accepting no new jobs', 'DRAINING');
  }
  return fastify.queue.send(JOB_EXECUTE_QUEUE_NAME, payload, { singletonKey: jobId });
}
```

**Restart safety:** On boot, plugin.ts onReady reads system_state; if `drain_requested_at` exists, calls `boss.offWork(...)` immediately so post-restart workers stay parked.

**Why offWork is sufficient (single-node project):**
- Project is intentionally single-node (REQUIREMENTS.md "Out of Scope: Multi-node pg-boss"). Only one server's workers can pick up jobs.
- `boss.offWork(name)` removes the worker from this server's PgBoss instance; with `{wait:false}` returns immediately; in-flight workers complete their current handler.
- Combined with admission check, backlog is bounded to "in-flight at moment of drain" + "jobs already in pgboss queue waiting".
- The pre-drain backlog will be picked up only on resume — ACCEPTABLE (CONTEXT semantics: "queue stays paused, jobs accumulate, resume drains them").

### Anti-Patterns to Avoid

- **Centralized FSM** — CONTEXT locks chained subscribers. A `JobSagaOrchestrator` class would couple modules and re-introduce the cross-module imperative coupling Phase 23 is removing.
- **Emit-from-everywhere** — `bus.emit()` calls outside the module factory are forbidden by `eslint-local-rules/no-direct-bus-emit.js` and `.dependency-cruiser.cjs` rule. ALL emits route through `makeJobsEmitters` (or another module's emitters).
- **Stateful in-memory `runningJobs` Map for drain accounting** — currently `JobService.runningJobs: Map<jobId, RunningJob>` is canonical. Phase 23 keeps this as a process-local source of truth for `getInFlightCount()` (tied to AbortController lifecycle), but `system_state` table is the cross-restart truth.
- **Persist EVERY new event** — TRACE-08 says "terminal & notable" only. New events:
  - `job.allocated` — NOT persisted (transient; derivable from device.allocated)
  - `job.running` — NOT persisted (transient; status in DB)
  - `job.recording.requested` — PERSISTED (notable terminal hand-off)
  - `job.cleanup.requested` — PERSISTED (notable terminal hand-off)
  - `job.failed` — PERSISTED (terminal)
  - `system.drain.completed` / `system.drain.resumed` — PERSISTED (operational telemetry)
- **Forget to update `JobsRegistry` total count** — Phase 22 closed at 6 events. After Phase 23 = 11. `events.spec.ts` asserts the count to catch silent drops.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Idempotent enqueue | hand-rolled "have we seen this jobId?" Map | pg-boss `policy:'stately'+singletonKey:jobId` | Verified at queue-layer; survives crashes; race-free. Phase 16-01 empirical verification. |
| Drain procedure | custom worker pause flag + custom polling | `boss.offWork(name) + system_state` flag | offWork is the canonical pg-boss "stop this worker" primitive; system_state survives restart. |
| Cross-restart "is draining" state | in-memory variable | `system_state` DB row | Restart-safe; CONTEXT mandate. |
| deviceName cross-field invariant | manual if-checks in route handlers | `z.refine()` at the schema | One assertion; OpenAPI carries forward; CI-blockable. |
| Saga step ordering | central state machine | bus subscriptions | Choreographed-orchestrated hybrid: orchestrated transitions, choreographed wiring. CONTEXT lock. |
| Job execution loop | Re-implement Maestro callbacks | EXISTING `JobExecutor` (server/jobs/job-executor.ts) | Phase 24 owns Maestro extraction; Phase 23 keeps executor as-is, just moves under internal/. |
| Plugin scope detection of jobs decoration | hand-rolled Promise/condition variable | `fastify.addHook('onReady', ...)` | Phase 21 onReady deferral pattern proven in artifacts. Same plugin-order workaround applies (jobs registers AFTER consumer modules — actually wait, jobs is at step 13, AFTER pool/streaming/artifacts/reporting — which means consumer modules use onReady to read `fastify.jobsModule.bus`). |

**Key insight:** Phase 23 introduces ZERO new abstractions. Every mechanism (singletonKey, persistEnvelope, onReady deferral, repo-level join, refine, MODULE.md template, dep-cruiser N-th rule, plugin-order additive) is already proven across Phases 16-22. The work is mechanical application + careful execution of the saga rewrite.

## Common Pitfalls

### Pitfall 1: pg-boss has NO `paused` flag on `updateQueue`

**What goes wrong:** Implementing CONTEXT.md verbatim — `await boss.updateQueue('job.execute', { paused: true })` — silently no-ops. The queue keeps pulling jobs, in-flight count never converges to zero, drain endpoint times out.

**Why it happens:** pg-boss v12's `UpdateQueueOptions = Omit<Queue, 'name' | 'partition' | 'policy'>` and the `Queue` interface (types.d.ts:191-224) only has `expireInSeconds`, `retentionSeconds`, `deleteAfterSeconds`, `retryLimit`, `retryDelay`, `retryBackoff`, `retryDelayMax`, `heartbeatSeconds`, `deadLetter`, `warningQueueSize`. No `paused`. No `active`. The community has been requesting this for 4+ years (issues #330, #421, #545); no native API has shipped.

**How to avoid:** Use `boss.offWork(JOB_EXECUTE_QUEUE_NAME, {wait: false})` to stop THIS server's worker + add an admission check that reads `system_state.drain_requested_at` before producers call `boss.send`. Document the divergence from CONTEXT in Plan 23-05 + DEFERRED-23-A note.

**Warning signs:** Drain spec hangs; `pgboss.job` table shows growing `created` count during drain test; `boss.findJobs(JOB_EXECUTE_QUEUE_NAME, {state: 'active'})` returns non-zero after offWork wait.

**Confidence:** HIGH — verified by reading node_modules/pg-boss source directly + GitHub issues.

### Pitfall 2: `policy:'standard'` silently ignores singletonKey

**What goes wrong:** `boss.createQueue('job.execute', {})` defaults to `policy:'standard'`. Calling `boss.send('job.execute', payload, {singletonKey: jobId})` does NOTHING — duplicate enqueue with same singletonKey is allowed; SC2 fails (>1 emulator boot per jobId).

**Why it happens:** pg-boss v12 implements singleton-dedup as DB unique indexes scoped by queue policy. Plain `'standard'` policy does NOT include the `state` predicate that makes `job_i3 (name, state, COALESCE(singleton_key, ''))` unique-block duplicates. ONLY `policy:'short'`, `'singleton'`, `'stately'`, `'exclusive'`, or `'key_strict_fifo'` activate singletonKey behavior. Phase 16-01 verified empirically against `node_modules/pg-boss/dist/plans.js:467-485`.

**How to avoid:** ALWAYS use `policy:'stately'` for `job.execute` queue (matches Phase 21 artifacts `recording.upload`, Phase 18 lifecycle queues, Phase 16 hooks `hook.run`). Test the dedup by invoking `boss.send` twice with the same `singletonKey` and asserting the second call returns `null` (duplicate dropped).

**Warning signs:** SC2 idempotency test counts 2 device boots; test "double-enqueue same jobId → 1 emulator boot" fails despite singletonKey being set.

**Confidence:** HIGH — empirically verified in Phase 16-01 + 21-03; STATE.md log captures the verification.

### Pitfall 3: `singletonKey` collision returns `null`, NOT throws

**What goes wrong:** Idempotency.spec.ts asserts duplicate enqueue throws. It doesn't — it returns `null`.

**Why it happens:** pg-boss v12 `boss.send(name, data, {singletonKey})` returns `Promise<string | null>`. On first call returns the new job-id (string). On duplicate (with `policy:'stately'` blocking the second insert), returns `null` to caller.

**How to avoid:** SC2 test asserts:
```typescript
const id1 = await boss.send(JOB_EXECUTE, payload, {singletonKey: jobId});
const id2 = await boss.send(JOB_EXECUTE, payload, {singletonKey: jobId});
expect(id1).toMatch(uuidRegex);
expect(id2).toBeNull();           // dropped, NOT thrown
const bootEvents = await db.select().from(schema.events).where(eq(schema.events.eventType, 'device.state.changed'));
const bootedToIdle = bootEvents.filter(e => e.payload.from === 'booting' && e.payload.to === 'idle');
expect(bootedToIdle).toHaveLength(1); // exactly 1 boot
```

**Warning signs:** Test rejects with `AssertionError` because `expect(...).toThrow()` doesn't fire.

**Confidence:** HIGH — pg-boss types declare `Promise<string | null>` at types.d.ts:53.

### Pitfall 4: `device.booted` event does NOT exist as standalone

**What goes wrong:** SC2 reads "verified by integration test counting `device.booted` events for that jobId". But `pool/events.ts` has 4 events: `device.state.changed`, `device.allocated`, `device.released`, `device.health.failed`. NO `device.booted`.

**Why it happens:** Phase 20 pool module deferred `device.booted` to Phase 24 (Maestro). Pool MODULE.md §Non-Goals: "**`device.booted` as first-class event** — CONTEXT §Specifics + RESEARCH §Pitfall 4 defer to Phase 24 Maestro. Consumers filter `state.changed {booting→idle}` today."

**How to avoid:** SC2 test counts `device.state.changed` events filtered on `payload.from === 'booting' && payload.to === 'idle'` for the relevant deviceId tied to jobId. Accept the filter; this is documented pool-module precedent.

**Alternative:** Phase 23 could add `device.booted` to `poolRegistry` as part of scope-creep — DO NOT. Phase 24 owns it.

**Warning signs:** Test fails with "no events.event_type matches 'device.booted'"; missing event in pool emit-helpers.

**Confidence:** HIGH — read `server/pool/MODULE.md:75` + `server/pool/events.ts`.

### Pitfall 5: Plugin order — jobs at step 13, consumers at steps 11/12 read `fastify.jobsModule.bus`

**What goes wrong:** Pool plugin at step 8 cannot subscribe to job events at registration time because jobs decorates `fastify.jobsModule` at step 13. Same for streaming (step 10), artifacts (step 11), reporting (step 12). Subscribing inside plugin body throws "Decorator jobsModule has not been declared".

**Why it happens:** Fastify plugin registration is sequential. Reading another plugin's decorator inside body must be deferred.

**How to avoid:** ALL cross-module subscribers wire inside `fastify.addHook('onReady', async () => {...})`. Same pattern as Phase 21 artifacts (`server/artifacts/internal/module.ts:182-377`) and Phase 22 streaming (`server/streaming/internal/module.ts:181-214`).

**For Phase 23's NEW reverse-direction subscribers** — jobs subscribes to `device.allocated` (pool), so jobs subscribers wire after step 8 has decorated `fastify.poolModule`. Since jobs is at step 13 and pool at step 8, pool decorator is already present at jobs body time — NO onReady deferral needed for jobs→pool subscriptions. But for streaming module's NEW `job.cleanup.requested` subscriber (resolves DEFERRED-22-D), streaming at step 10 < jobs at step 13 → MUST use onReady.

**Warning signs:** Decorator-not-declared exceptions on plugin registration; plugin-order.spec failures.

**Confidence:** HIGH — empirically validated across Phases 19-22.

### Pitfall 6: `system_state` table migration must precede DB-gated specs

**What goes wrong:** Plan 23-00 substrate skips DB migration. Plan 23-05 drain-route.spec fails because `system_state` table doesn't exist; Plans 23-06 DB-gated proofs fail similarly.

**Why it happens:** Drizzle migration order matters; specs that gate on `TEST_DATABASE_URL` need the schema present.

**How to avoid:** Plan 23-00 INCLUDES `system_state` Drizzle table definition + `drizzle-kit push` migration generation. Schema:
```typescript
// server/db/schema.ts (append)
export const systemState = pgTable('system_state', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
```
Migration runs in Plan 23-00 substrate alongside events.ts placeholder + queue.ts placeholder. Specs in Plans 23-05/06 gate on `TEST_DATABASE_URL` and ephemeral schemas (Phase 19 precedent).

**Warning signs:** "relation system_state does not exist" in spec failures.

**Confidence:** HIGH — Phase 21 Plan 21-01 used the same approach for the `recording_id` column add.

### Pitfall 7: `readFileSync` grep-guard regex false positives

**What goes wrong:** SC1 grep-guard `\.catch\(\(\) => \{\}\)` accidentally matches `obj.catch(() => {})` calls in legitimate utility code. Or misses `.catch(_ => {})` (with named param) and `.catch((err) => { logger.warn(...) })` (with explicit ignore).

**Why it happens:** Regex is naive; production code has many shapes.

**How to avoid:**
1. **Scope narrowly** — `lifecycle-ownership.spec.ts` reads ONLY `server/jobs/job-service.ts` (or its successor `server/jobs/internal/module.ts` post-rewrite). NOT a tree-wide grep.
2. **Anchored patterns** — count occurrences of EXACT shapes:
   ```typescript
   const src = readFileSync(JOB_SERVICE_PATH, 'utf-8');
   expect(src.match(/\.catch\(\(\) => \{\}\)/g)?.length ?? 0).toBe(0);
   expect(src.match(/setTimeout\([^)]*broadcaster[^)]*cleanup/gs)?.length ?? 0).toBe(0);
   expect(src.match(/from ['"]\.\.\/streaming\/internal\//g)?.length ?? 0).toBe(0);
   expect(src.match(/\bbus\.emit\(/g)?.length ?? 0).toBe(0);
   ```
3. **Allowlist documented exceptions** — if a SINGLE legitimate `.catch()` survives (e.g., `pool.release(deviceId).catch(...)`), the test asserts `<=1` not `===0` and the README/MODULE.md documents it (Phase 22 SC2 uses this `cleanup` allowlist).

**Warning signs:** Grep-guard test fails with confusing diff; passes locally fails CI; matches in test fixtures.

**Confidence:** HIGH — Phase 21 + 22 used this exact pattern; refine matchers carefully in Plan 23-04.

### Pitfall 8: Test isolation of `system_state` across parallel specs

**What goes wrong:** Two integration specs both write to `system_state.drain_requested_at` row; they race; one observes the other's state.

**Why it happens:** Vitest parallel-by-default runs spec files concurrently. Shared schema → shared rows.

**How to avoid:** Use ephemeral pgboss schemas + ephemeral app schemas per-spec — Phase 19 precedent. Each spec creates a fresh DB schema, applies migrations, then tears down. Drain spec's "DB-gated" guard already constrains.

**Alternative:** Use unique `key` per spec (e.g., `drain_requested_at_${cryptoRandomUUID()}`) — but this drifts from production code path. Schema isolation preferred.

**Warning signs:** Flaky drain-route.spec; "row already exists" errors in parallel runs.

**Confidence:** MEDIUM — Phase 19 used schema isolation; verify pattern works for app tables (not just pgboss tables) — DEFERRED-23-D notes this.

### Pitfall 9: persistEnvelope is the 7th sample point

**What goes wrong:** The 6 modules (hooks/lifecycle/reporting/pool/artifacts/streaming) duplicate ~30-line `persistEnvelope` middleware verbatim. Phase 23 will add the 7th copy in `server/jobs/internal/module.ts`. CONTEXT mentions consolidation is Phase 27+ scope, NOT Phase 23.

**Why it happens:** Discipline: refactor once N samples are collected.

**How to avoid:** Plan 23-04 ships the 7TH SAMPLE POINT verbatim. MODULE.md §Non-Goals notes "Consolidation of the 7× duplicated `persistEnvelope` middleware — Phase 27+ owns; do NOT consolidate here." DEFERRED-22-E carries forward.

**Confidence:** HIGH — established discipline since Phase 16.

### Pitfall 10: deviceName join on null deviceId returns NULL string in some Postgres drivers

**What goes wrong:** `LEFT JOIN devices ON d.id = jobs.device_id` returns row where `device_id IS NULL → d.name IS NULL`. Drizzle returns `deviceName: null`. Zod refinement `j.deviceId == null || (j.deviceName !== null && j.deviceName.length > 0)` correctly accepts. But if a route handler MAPS the row (not the Zod parse), the type drift surfaces only at the schema boundary.

**How to avoid:** Repo always returns the joined shape; route handlers `.parse()` at the boundary; Zod is the gatekeeper. The test `contract-devicename.spec.ts` exercises:
1. Job with `deviceId=null` → `deviceName=null` → `parse` SUCCEEDS.
2. Job with `deviceId=<uuid>` + `deviceName='Pixel 7'` → `parse` SUCCEEDS.
3. Job with `deviceId=<uuid>` + `deviceName=null` → `parse` FAILS (refinement caught it).
4. Job with `deviceId=<uuid>` + `deviceName=''` → `parse` FAILS.

**Warning signs:** Refinement passes when it shouldn't because deviceName is "0-length string but not null"; tests miss case 4.

**Confidence:** HIGH — Zod `.refine()` is well-understood; Drizzle leftJoin is standard.

## Code Examples

Verified patterns from official sources / repo precedent.

### 1. Saga subscriber inside createJobsModule factory

```typescript
// server/jobs/internal/module.ts (NEW — Plan 23-04)
// Source: derived from server/artifacts/internal/module.ts:131-422 (Phase 21 reference)

export function createJobsModule(deps: CreateJobsModuleDeps): JobsModule {
  const { fastify, db, config, logger } = deps;
  const log = logger.child({ module: 'jobs' });

  const bus = new TypedBus(jobsRegistry);
  const persistEnvelope = makePersistEnvelope({ db, bus, logger });   // 7TH SAMPLE POINT
  const emit = makeJobsEmitters(bus, persistEnvelope);

  // In-flight tracking — process-local source of truth for getInFlightCount()
  const runningJobs = new Map<string, { abortController: AbortController; deviceId: string }>();

  // Saga state writes (jobs owns these transitions)
  let unsubDeviceAllocated: (() => void) | null = null;

  return {
    emit,
    bus,
    runningJobs,
    getInFlightCount: () => runningJobs.size,

    registerWorkerAndSubscribers: async () => {
      // 1. Register job.execute worker
      await fastify.boss.createQueue(JOB_EXECUTE_QUEUE_NAME, {
        policy: 'stately',
        retryLimit: 0,                  // device-touching → no retry per QUEUE-04 + SC2
      } as never);

      const workerId = await fastify.queue.work<JobExecutePayload>(
        JOB_EXECUTE_QUEUE_NAME,
        async (data, bossJobId) => {
          // ALS already restored by queue.work wrapper.
          await runJobSaga(data.jobId, runningJobs, fastify, emit, log);
        },
      );
      workerIds.push(workerId);

      // 2. Wire saga subscribers
      // Pool→Jobs: device.allocated → UPDATE jobs.status='allocated'
      unsubDeviceAllocated = fastify.poolModule.bus.on(
        'device.allocated' as never,
        async (payload: { deviceId: string; jobId: string; platform: 'android'|'ios' }) => {
          await db.update(schema.jobs).set({
            status: 'allocated',          // NEW status — schema add in Plan 23-00
            deviceId: payload.deviceId,
            startedAt: new Date(),
          }).where(eq(schema.jobs.id, payload.jobId));
          emit.allocated(payload.jobId, { jobId: payload.jobId, deviceId: payload.deviceId, platform: payload.platform });
        },
      );

      // (Other subscribers similarly — job.failed→cleanup, etc.)
    },

    enqueueJob: async (jobId, payload) => {
      // Drain admission check
      const drain = await db.select().from(schema.systemState)
        .where(eq(schema.systemState.key, 'drain_requested_at')).limit(1);
      if (drain.length > 0) {
        throw createHttpError(503, 'Server draining — accepting no new jobs', 'DRAINING');
      }
      return fastify.queue.send(JOB_EXECUTE_QUEUE_NAME, payload, {
        singletonKey: jobId,             // QUEUE-03 + SC2 — duplicate enqueue → null
      });
    },

    shutdown: async () => { /* stopped flag, offWork all workerIds, unsub bus */ },
  };
}
```

**Source:** `server/artifacts/internal/module.ts:131-422` (Phase 21 reference); `server/queue/plugin.ts:177-209` (queue.work ALS restore).

### 2. Idempotency proof — forced double-enqueue → 1 boot

```typescript
// server/jobs/__tests__/idempotency.spec.ts (NEW — Plan 23-02 + 23-04)
// Proves SC2 + QUEUE-03

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupTestApp } from './fixtures/app.js';
import * as schema from '../../db/schema.js';
import { eq, and } from 'drizzle-orm';

describe('jobs.execute singletonKey idempotency [QUEUE-03 / SC2]', () => {
  let app: Awaited<ReturnType<typeof setupTestApp>>;
  beforeEach(async () => { app = await setupTestApp({ ephemeralPgBossSchema: true }); });
  afterEach(async () => { await app.close(); });

  it('forced double-enqueue with same jobId produces exactly 1 device.state.changed{booting→idle}', async () => {
    const jobId = '00000000-0000-4000-8000-000000000023';
    const payload = { jobId, platform: 'android' as const };

    // Direct boss.send to bypass admission helper
    const id1 = await app.boss.send(JOB_EXECUTE_QUEUE_NAME, { ...payload }, { singletonKey: jobId });
    const id2 = await app.boss.send(JOB_EXECUTE_QUEUE_NAME, { ...payload }, { singletonKey: jobId });

    expect(id1).toMatch(/^[0-9a-f-]{36}$/);
    expect(id2).toBeNull();             // pg-boss policy:'stately' drops duplicate

    // Wait for worker to process (with vi.waitFor)
    await vi.waitFor(async () => {
      const events = await app.db.select().from(schema.events).where(
        and(
          eq(schema.events.eventType, 'device.state.changed'),
          eq(schema.events.aggregateType, 'pool'),
        ),
      );
      // Exactly 1 booting→idle for this jobId's allocated device
      const boots = events.filter(e =>
        (e.payload as any).from === 'booting' && (e.payload as any).to === 'idle'
      );
      expect(boots).toHaveLength(1);
    }, { timeout: 5000 });
  });
});
```

**Source:** Phase 16 hooks idempotency.spec pattern + Phase 21 artifacts queue.spec dedup proof.

### 3. Drain endpoint with offWork + system_state

```typescript
// server/jobs/internal/routes.ts (NEW — Plan 23-05)
// Resolves Pitfall 1 — uses offWork instead of non-existent paused flag

import { eq } from 'drizzle-orm';
import { z } from 'zod';
import * as schema from '../../db/schema.js';

export async function registerJobsAdminRoutes(deps: {
  fastify: FastifyInstance;
  jobsModule: JobsModule;
  emit: JobsEmitters;
  logger: pino.Logger;
}) {
  const { fastify, jobsModule, emit, logger } = deps;

  fastify.post('/admin/drain', {
    preHandler: fastify.authService?.validateKey,    // any-valid-key gate; DEFERRED-23-A admin claim → Phase 26
    schema: {
      querystring: z.object({ timeout: z.coerce.number().int().min(1).max(1800).default(300) }),
      response: { 200: z.discriminatedUnion('drained', [...]) },
    },
  }, async (req, reply) => {
    // 1. Persist drain intent (idempotent upsert)
    await fastify.db.insert(schema.systemState).values({
      key: 'drain_requested_at',
      value: { iso: new Date().toISOString() },
    }).onConflictDoUpdate({
      target: schema.systemState.key,
      set: { value: { iso: new Date().toISOString() }, updatedAt: new Date() },
    });

    // 2. Stop fetchers — workers complete current handler, refuse new
    await fastify.boss.offWork(JOB_EXECUTE_QUEUE_NAME, { wait: false });
    await fastify.boss.offWork(RECORDING_UPLOAD_QUEUE_NAME, { wait: false });

    // 3. Long-poll until in-flight = 0 OR timeout
    const start = Date.now();
    const timeoutMs = req.query.timeout * 1000;
    while (Date.now() - start < timeoutMs) {
      if (jobsModule.getInFlightCount() === 0) {
        const drainedAt = new Date().toISOString();
        emit.drainCompleted({ drainedAt, durationMs: Date.now() - start });
        return reply.send({ drained: true, in_flight: 0, drained_at: drainedAt });
      }
      await new Promise(r => setTimeout(r, 1000));
    }
    return reply.send({ drained: false, in_flight: jobsModule.getInFlightCount(), timeout: true });
  });

  fastify.post('/admin/drain/resume', { /* similar shape */ }, async (req, reply) => {
    await fastify.db.delete(schema.systemState).where(eq(schema.systemState.key, 'drain_requested_at'));
    // Re-register workers (offWork removes them; need fresh registration)
    await jobsModule.registerWorkerAndSubscribers();
    await fastify.artifactsModule?.registerWorkersAndSubscribers();
    emit.drainResumed({ resumedAt: new Date().toISOString() });
    return reply.send({ resumed: true });
  });
}
```

**Source:** pg-boss `manager.d.ts:47` `offWork(name, options)`; project pattern from `server/api/routes.ts` for HTTP handlers.

### 4. JobResponseSchema with refinement — DEBT-02 / CLI-05

```typescript
// server/jobs/schemas.ts (extension of existing — Plan 23-03)
import { z } from 'zod';

export const jobStatusSchema = z.enum([
  'queued',
  'allocated',                          // NEW — saga state
  'running',
  'passed',
  'failed',
  'cancelled',
  'timeout',
]);

export const platformSchema = z.enum(['android', 'ios']);

export const jobResponseSchema = z.object({
  id: z.string().uuid(),
  status: jobStatusSchema,
  platform: platformSchema,
  deviceId: z.string().uuid().nullable(),
  deviceName: z.string().min(1).nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.string().datetime(),
  startedAt: z.string().datetime().nullable(),
  finishedAt: z.string().datetime().nullable(),
  errorMessage: z.string().nullable(),
}).refine(
  (j) => j.deviceId == null || (j.deviceName !== null && j.deviceName.length > 0),
  { message: 'deviceName must be non-empty when deviceId is present', path: ['deviceName'] },
).meta({
  id: 'Job',
  description: 'Full job record including allocated device name (DB-joined from devices.name)',
});

export type JobResponse = z.infer<typeof jobResponseSchema>;
```

```typescript
// server/jobs/__tests__/contract-devicename.spec.ts (NEW — Plan 23-03)

import { describe, it, expect } from 'vitest';
import { jobResponseSchema } from '../schemas.js';
import { readFileSync } from 'node:fs';

describe('Job schema deviceName contract [DEBT-02 / CLI-05]', () => {
  it('shape exposes deviceName field', () => {
    expect((jobResponseSchema as any)._zod.def.shape.deviceName).toBeDefined();
  });

  it('parse accepts deviceId=null + deviceName=null', () => {
    const r = jobResponseSchema.safeParse({ ...validBase, deviceId: null, deviceName: null });
    expect(r.success).toBe(true);
  });

  it('parse accepts deviceId=<uuid> + deviceName=non-empty', () => {
    const r = jobResponseSchema.safeParse({ ...validBase, deviceId: '...', deviceName: 'Pixel 7 (5554)' });
    expect(r.success).toBe(true);
  });

  it('parse REJECTS deviceId=<uuid> + deviceName=null', () => {
    const r = jobResponseSchema.safeParse({ ...validBase, deviceId: '...', deviceName: null });
    expect(r.success).toBe(false);
  });

  it('parse REJECTS deviceId=<uuid> + deviceName=""', () => {
    const r = jobResponseSchema.safeParse({ ...validBase, deviceId: '...', deviceName: '' });
    expect(r.success).toBe(false);
  });

  it('openapi.json carries deviceName under components.schemas.Job', () => {
    const spec = JSON.parse(readFileSync('server/openapi.json', 'utf-8'));
    expect(spec.components.schemas.Job).toBeDefined();
    expect(spec.components.schemas.Job.properties.deviceName).toBeDefined();
  });
});
```

**Source:** Phase 17 Plan 17-01 jobSummarySchema pattern; Zod 4 docs `.refine()` + `.meta()`.

### 5. system_state Drizzle table

```typescript
// server/db/schema.ts (append — Plan 23-00)
import { pgTable, text, jsonb, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const systemState = pgTable('system_state', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
```

```typescript
// server/db/__tests__/system-state.spec.ts (NEW — Plan 23-00)
// Smoke test: row decoder + idempotent upsert
```

**Source:** Phase 21 Plan 21-01 added `recording_id` column to artifacts via same pattern.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| In-memory `JobQueue` (FIFO + per-platform mutex) | pg-boss `boss.send('job.execute', ..., {singletonKey: jobId})` with `policy:'stately'` | Phase 23 | Cross-restart-safe; queryable; observable; DLQ-able |
| Imperative `executeJob` orchestrator with direct `pool.allocate`/`webhookService.deliver`/`broadcaster.cleanup` calls | Chained-subscriber saga over typed bus | Phase 23 | Modules independent; testable in isolation; composable |
| `.catch(() => {})` swallow patterns | Bus emit to terminal `job.failed` event | Phase 23 | Errors observable in `events` table + DLQ pipeline |
| `setTimeout(... broadcaster.cleanup, 5000)` | `job.cleanup.requested` event subscribed by streaming | Phase 23 (resolves DEFERRED-22-D) | Saga step explicit; testable; correlationId-traceable |
| Cross-module type imports `import type { JobBroadcaster } from '../streaming/internal/...'` | `fastify.streamingModule.*` decorator surface only | Phase 23 (resolves DEFERRED-22-F) | True module isolation; dep-cruiser enforces |
| `jobs/plugin.ts → bus/bus.ts` direct dep-cruiser violation | Module factory routes through `event-bus` plugin dep | Phase 23 (resolves DEFERRED-21) | Clean dep-cruiser run |
| `boss.updateQueue({paused})` (DOES NOT EXIST) | `boss.offWork(name)` + system_state admission flag | Phase 23 (RESEARCH correction to CONTEXT) | Drain works; restart-safe; admission gates new requests |
| `Job` shape in `jobSummarySchema` (3 fields) | `JobResponseSchema` (10+ fields incl. deviceName, refined) | Phase 23 | DEBT-02 / CLI-05 closed; CLI prints names not UUIDs |

**Deprecated/outdated as of Phase 23 close:**
- `server/jobs/job-queue.ts` — DELETED.
- `server/jobs/job-service.ts` — REPLACED with `internal/module.ts` + `internal/executor.ts`.
- `import type { JobBroadcaster }` cross-module references in `jobs/*.ts` — DELETED.
- Phase 22 transient `jobBroadcaster!.cleanup(jobId)` SC2 allowlist — count goes to 0 after Phase 23 (replaced by `job.cleanup.requested` event).

## Open Questions

### Q1: Plan structure exact count — 7 or 8 plans?

**What we know:** CONTEXT proposes 7-8 plans (23-00..23-06 or 23-07).
**What's unclear:** Whether saga rewrite + JobQueue deletion fit in one plan (23-04) or split.
**Recommendation:** 8 plans. Plan 23-04 = saga subscribers + JobQueue deletion (LARGEST plan). Plan 23-07 = phase close. Mirrors Phase 22's 7-plan shape but +1 because Phase 23 has more new events + a new HTTP route + a DB migration. Adopt CONTEXT's 23-00..23-07 numbering.

### Q2: `device.allocated` payload already has `jobId`?

**What we know:** `pool/events.ts:88-92` — `deviceAllocatedPayload = z.object({ deviceId, jobId, platform })`. ✅ jobId already in payload.
**What's unclear:** None. Subscribers can directly read `payload.jobId`.
**Recommendation:** No changes to pool module needed.

### Q3: Where does `system.drain.completed` event live?

**What we know:** CONTEXT DEFERRED-23-B says jobs module emits these for proximity to drain endpoint; Phase 27+ may extract to dedicated `system` module.
**What's unclear:** Whether they land in `jobsRegistry` or a separate `systemRegistry` in Phase 23.
**Recommendation:** Land in `jobsRegistry` for Phase 23. `aggregateType: 'system'` even though they're emitted from jobs module (the aggregateType discriminates events for trace-tree consumption). Phase 27+ extraction is a name-only refactor at that point. Document in MODULE.md §Non-Goals.

### Q4: Cross-tier deviceName proof — Go test or server-side only?

**What we know:** CONTEXT gives planner discretion; DEFERRED-23-C carries to Phase 28 if Go is unreachable.
**What's unclear:** Autonomous-mode tooling capability (can the agent run `make test` in `cli/`?).
**Recommendation:** Plan 23-03 attempts a minimal Go test (`cli/cmd/status_test.go` reading a fake JSON response) IF `cli/` has a test infrastructure. If `make test` is non-trivial in autonomous mode, fall back to server-side spec asserting JSON response + flag DEFERRED-23-C for Phase 28 to land the Go assertion.

### Q5: Can we count "device boots per jobId" via existing events?

**What we know:** Pool emits `device.state.changed{from:'booting',to:'idle'}` per boot. Each `jobId` gets one allocated `device.allocated` event.
**What's unclear:** Whether device.state.changed `aggregateId` is the deviceId (correct) and we need to JOIN through `device.allocated` events to find the deviceId for a jobId. → YES.
**Recommendation:** SC2 idempotency.spec uses 2-step query:
  1. SELECT deviceId FROM events WHERE eventType='device.allocated' AND payload->>'jobId'=jobId.
  2. COUNT events WHERE eventType='device.state.changed' AND aggregateId=deviceId AND payload->>'from'='booting' AND payload->>'to'='idle'.
Expect count = 1.

### Q6: What about pgboss schema isolation across drain specs?

**What we know:** Phase 19 Plan 19-04 used per-spec ephemeral schemas via `opts.schema` on the queue plugin. DEFERRED-23-D notes this carries forward.
**What's unclear:** Whether the same approach trivially works for system_state (an app table, not pgboss).
**Recommendation:** Use the same `TEST_DATABASE_URL` ephemeral approach Phase 19 used. If flakes appear in CI, explicit schema isolation per drain spec; track in DEFERRED-23-D.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 3.x with `@vitest/coverage-v8` |
| Config file | `vitest.config.ts` (root); existing |
| Quick run command | `npx vitest run server/jobs/__tests__/` |
| Full suite command | `npm test` |
| DB-gated guard | Each integration spec checks `TEST_DATABASE_URL ?? DATABASE_URL`; skips if absent |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| EVENTS-10 | 11-event registry shape (existing 6 + 5 new); EVENTS-03 dotted past-tense; TRACE-08 persistence flags correct | unit | `npx vitest run server/jobs/__tests__/events.spec.ts` | ❌ Plan 23-00 substrate / Plan 23-01 body |
| EVENTS-10 | Saga chain — emit `job.allocated` → DB row updated; emit `job.completed` → reporting webhook + artifacts recording.upload subscribers fire | integration (DB) | `npx vitest run server/jobs/__tests__/subscriber.spec.ts` | ❌ Plan 23-06 |
| EVENTS-10 | correlationId threads through entire saga end-to-end | integration (DB) | `npx vitest run server/jobs/__tests__/correlation.spec.ts` | ❌ Plan 23-06 |
| EVENTS-10 | SC1 grep-guards: zero `.catch(() => {})`, zero `setTimeout(...broadcaster...cleanup)`, zero streaming/internal imports, zero direct `bus.emit()` outside factory | unit (readFileSync) | `npx vitest run server/jobs/__tests__/lifecycle-ownership.spec.ts` | ❌ Plan 23-06 |
| QUEUE-03 | `policy:'stately'` + `singletonKey:jobId` blocks duplicate enqueue; second send returns null | integration (DB) | `npx vitest run server/jobs/__tests__/idempotency.spec.ts` | ❌ Plan 23-02 / 23-04 |
| QUEUE-03 / SC2 | Forced double-enqueue → exactly 1 `device.state.changed{booting→idle}` event for that jobId's allocated device | integration (DB) | Same spec as above | ❌ Plan 23-04 (extends idempotency.spec) |
| CLI-05 / DEBT-02 | Zod refinement passes/fails on cross-field invariant; OpenAPI Job schema has deviceName | unit | `npx vitest run server/jobs/__tests__/contract-devicename.spec.ts` | ❌ Plan 23-03 |
| CLI-05 / DEBT-02 | DB join populates deviceName end-to-end (server response includes name) | integration (DB) | Add to `subscriber.spec.ts` or dedicated route spec | ❌ Plan 23-03 |
| DEBT-02 (cross-tier) | Go CLI status command displays device name | manual or Go test | `cd cli && go test -run TestStatusDeviceName ./...` IF reachable | ❌ Plan 23-03 (or DEFERRED-23-C) |
| (drain) | `/admin/drain` long-poll returns `drained: true` when in-flight=0 | integration (DB) | `npx vitest run server/jobs/__tests__/drain-route.spec.ts` | ❌ Plan 23-05 |
| (drain) | `system_state.drain_requested_at` row set; `boss.offWork` invoked; restart honors flag | integration (DB) | Same spec as above | ❌ Plan 23-05 |
| (drain admission) | `enqueueJob` rejects with 503 when drain row present | integration (DB) | Same spec as above | ❌ Plan 23-05 |
| MOD-06 | `createJobsModule` shape — emit/bus/registerWorkerAndSubscribers/shutdown/getInFlightCount/enqueueJob | unit | `npx vitest run server/jobs/__tests__/module.spec.ts` | ❌ Plan 23-04 |
| MOD-04 | `*.test.ts` → `*.spec.ts` rename via `git mv` 100% similarity | manual git verification | `git log --follow server/jobs/__tests__/job-service.spec.ts` | ❌ Plan 23-07 |
| MOD-02 | dep-cruiser 7th rule fires on `__fixtures__/dep-cruiser/bad-jobs-deep-import.ts` | unit | `npx vitest run server/hooks/__tests__/dep-cruiser.spec.ts` | ✅ extension to existing |
| (additive plugin-order) | jobs plugin position + dependencies array structural check | unit | `npx vitest run server/__tests__/plugin-order.spec.ts` | ✅ extension to existing |
| Nyquist | coverage delta ≤ −2pp from baseline (commit 55ff8ac) | gate | `npm run nyquist:check` | ✅ existing |

### Sampling Rate

- **Per task commit:** `npx vitest run server/jobs/__tests__/<just-changed>.spec.ts` (typically <30s).
- **Per wave merge:** `npx vitest run server/jobs/ server/__tests__/plugin-order.spec.ts server/hooks/__tests__/dep-cruiser.spec.ts` (~30-60s).
- **Phase gate:** Full `npm test` green (excluding inherited DEFERRED-17-A failures); `npm run dep-check` clean (zero violations); `npm run lint` clean; `npx tsc --noEmit` 0 NEW errors; `npm run nyquist:check` exit 0.

### Wave 0 Gaps

- [ ] `server/db/schema.ts` — append `systemState` table
- [ ] `server/db/migrations/<NNNN>_system_state.sql` — drizzle-kit generate
- [ ] `server/jobs/internal/module.ts` — throw-stub (10 lines for dep-cruiser resolvable target)
- [ ] `server/jobs/events.ts` — extend JOB_EVENT_NAMES with 5 new keys (placeholder; bodies in Plan 23-01)
- [ ] `server/jobs/queue.ts` — placeholder `JOB_EXECUTE_QUEUE_NAME` alias only
- [ ] `server/jobs/MODULE.md` — placeholder Purpose section
- [ ] `server/jobs/index.ts` — barrel placeholder (1-line internal/ re-export)
- [ ] `server/jobs/__tests__/events.spec.ts` — registry shape spec (count=11)
- [ ] `.dependency-cruiser.cjs` — 7th rule `no-deep-imports-into-jobs-internal`
- [ ] `__fixtures__/dep-cruiser/bad-jobs-deep-import.ts` — fixture (`@ts-expect-error` import)
- [ ] `server/hooks/__tests__/dep-cruiser.spec.ts` — extend with 7th rule check (third describe block)
- [ ] `server/queue/names.ts` — add `JOB_EXECUTE: 'job.execute'` if not already present (verify in Plan 23-00 — currently `DEVICE_BOOT` is forward-compat, `JOB_EXECUTE` may need adding)

## Sources

### Primary (HIGH confidence)
- `node_modules/pg-boss/dist/types.d.ts:1-466` — verified Queue + UpdateQueueOptions interfaces; confirmed NO `paused` field
- `node_modules/pg-boss/dist/manager.d.ts:1-92` — verified `offWork(name, options)` API; `OffWorkOptions = {id?, wait?}`
- `node_modules/pg-boss/dist/plans.js` — empirical singleton dedup behavior (Phase 16-01 + 21-03 verification)
- `server/artifacts/internal/module.ts:131-422` — Phase 21 reference factory + subscriber pattern
- `server/streaming/internal/module.ts:95-241` — Phase 22 reference factory + onReady deferral
- `server/lifecycle/internal/module.ts:92-141` — Phase 18 reference shutdown idempotency
- `server/reporting/internal/module.ts` (referenced via STATE.md) — Phase 19 DLQ + retry pattern
- `server/pool/events.ts:1-176` — Phase 20 reference 4-event registry, NO `device.booted`
- `server/jobs/events.ts:1-262` — Phase 22 bridgehead 6-event jobsRegistry (extension target)
- `server/jobs/job-service.ts:1-669` — current state of imperative orchestrator (rewrite target)
- `server/jobs/job-queue.ts:1-35` — current in-memory FIFO (deletion target)
- `server/queue/plugin.ts:1-244` — ALS-aware queue.send / queue.work substrate
- `server/queue/names.ts:49-60` — QUEUE_NAMES registry
- `server/db/schema.ts` — current schema (jobs, devices, events tables)
- `server/index.ts:114-145` — current plugin order (jobs at step 13)
- `.planning/STATE.md` — Phase 15-22 architectural decisions
- `.planning/phases/22-streaming-module/22-CONTEXT.md` — most recent precedent
- `.planning/phases/21-artifacts-module/21-CONTEXT.md` — closest analog
- `.planning/phases/22-streaming-module/deferred-items.md` — DEFERRED-22-D / 22-F resolution targets
- `.planning/REQUIREMENTS.md` — EVENTS-10 / QUEUE-03 / CLI-05 / DEBT-02 specs

### Secondary (MEDIUM confidence)
- pg-boss GitHub README + npm docs — confirms no native pause API
- pg-boss issue [#330](https://github.com/timgit/pg-boss/issues/330), [#421](https://github.com/timgit/pg-boss/issues/421), [#545](https://github.com/timgit/pg-boss/issues/545) — community confirmation of pause API absence

### Tertiary (LOW confidence)
- WebSearch on "pg-boss pause queue drain" — directional only; concrete answers came from source inspection

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — All libraries already in repo at known-working versions; NO new deps needed
- Architecture (saga + chained subscribers): HIGH — Phase 19/21/22 precedent strongly templated; this phase mechanically applies it
- Idempotency (singletonKey): HIGH — Phase 16-01 + 21-03 empirical verification documented in STATE.md
- Drain procedure: MEDIUM — CONTEXT-stated `boss.updateQueue({paused})` API does NOT exist; resolved via `offWork + system_state`. Mechanism is sound but is a CONTEXT correction rather than a documented Phase 22 inheritance
- deviceName Zod refinement: HIGH — Zod `.refine()` is core API; Drizzle leftJoin is standard; Phase 17 `.meta()` for OpenAPI emit is documented
- Migration sequence: HIGH — mirrors Phase 21 precedent task-by-task
- Pitfalls: HIGH — 10 documented; pitfalls 1, 2, 3, 5, 7 are RESEARCH-critical (others are precedent-derived)

**Research date:** 2026-05-08
**Valid until:** 2026-06-07 (30-day window for stable inputs; only pg-boss could shift but no v13 in flight)
