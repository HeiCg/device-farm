# Phase 19: Reporting Migration (Webhooks + DLQ) — Research

**Researched:** 2026-04-21
**Domain:** pg-boss v12 retry + dead-letter pipeline, Phase 16 module pattern conformance on `server/reporting/`, Phase 18 `fastify.queue.send` consumption, EVENTS-07 terminal-event persistence, QUEUE-05 DLQ endpoint
**Confidence:** HIGH (pg-boss DLQ mechanics verified against installed `dist/plans.js`, `dist/types.d.ts`, `dist/manager.js`; substrate call sites verified against committed Phase 15/16/18 code; one cross-module wiring decision flagged as MEDIUM)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Phase Boundary (verbatim from CONTEXT.md):**
Move webhook delivery off `.catch(() => {})` fire-and-forget onto pg-boss with retry + dead-letter. Validate the full retry/DLQ/terminal-event pipeline in a production-meaningful module. Concrete deliverables:
1. `WebhookService.deliverOnce()` (single-attempt, throws on non-2xx)
2. `webhook-deliver` pg-boss queue owning `retryLimit: 5` + `retryBackoff: true`
3. `GET /api/queue/dlq` endpoint with Zod-validated response
4. `webhook.failed.retryExhausted` terminal event persisted to `events` table with `correlation_id`
5. Reporting module subscribes to `job.completed` from bus and enqueues delivery via Phase 18's `enqueue(name, data, opts)` wrapper (= `fastify.queue.send`)
6. End-to-end correlationId trace: request log → bus event → queue job → 5 retry log lines → DLQ row → terminal event row

**OUT OF SCOPE (do NOT research, do NOT plan tasks for):**
- DLQ replay endpoint (re-enqueue from DLQ) — `GET /api/queue/dlq` is read-only in Phase 19
- Webhook HMAC signing — separate concern
- Multi-target webhook fan-out — current single-target model carries through
- Webhook event types beyond `job.completed` → webhook delivery (e.g., `device.*` webhooks) — downstream scope
- Full reporting route Zod coverage — Phase 17 one-route-minimum already met

### Claude's Discretion

All implementation choices. Pure infrastructure phase. Phase 16 (`server/hooks/`) + Phase 18 (`server/lifecycle/`) are the canonical templates. Reuse Phase 15 substrate (`server/queue/plugin.ts` `send()` wrapper with ALS correlationId injection, `server/bus/helpers.ts` for subscriptions, `server/events/` table + envelope), the Phase 17 Zod→OpenAPI pipeline for the `/api/queue/dlq` route, and the MOD-01..04 module conventions (MODULE.md, barrel, events.ts, tests-as-spec naming).

### Deferred Ideas (OUT OF SCOPE)
- DLQ replay endpoint (re-enqueue from DLQ)
- Webhook HMAC signing
- Multi-target webhook fan-out
- Webhook event types beyond `job.completed` (e.g. `device.*` webhooks) — downstream scope once pool module emits (Phase 20)
- Full reporting route Zod coverage — Phase 17 one-route-minimum already met; full expansion is downstream
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| **EVENTS-07** | Falhas de retry exaurido emitem evento terminal (`*.failed.retryExhausted`) persistido na tabela `events` | §Dead-Letter Mechanics + §Terminal Event Emission — worker handler re-throws on final attempt; pg-boss's `onComplete` is DEPRECATED in v12; terminal emission lives inside a "last-attempt" check in the worker handler OR (preferred) via the `deadLetter:` re-enqueue + a second worker on the DLQ queue that emits the terminal event |
| **QUEUE-05** | DLQ pipeline: `boss.onComplete` transforma failed-after-max em evento terminal no bus + linha na tabela `events`; endpoint `GET /api/queue/dlq` lista itens | §Dead-Letter Mechanics — pg-boss v12 DLQ is table-based (`deadLetter: '<queue>'` re-inserts payload into a named dead-letter queue); endpoint queries `pgboss.job_common` (or partition table) `WHERE state = 'failed'`; Zod response schema for list; §Endpoint Design |
</phase_requirements>

---

## Summary

Phase 19 closes the last two v3.0 requirements on the QUEUE side of the substrate: EVENTS-07 (terminal event on retry-exhausted) and QUEUE-05 (DLQ endpoint + terminal event pipeline). All load-bearing APIs already exist:

- **pg-boss v12 dead-letter is built in.** `createQueue(name, {deadLetter: '<dlq-queue>'})` causes pg-boss to re-insert the payload into the named DLQ queue when a job's `retryCount >= retryLimit`. Source verified: `node_modules/pg-boss/dist/plans.js:1090-1169` (the `failed_jobs` CTE in the supervise/maintenance path `INSERT INTO job (name, data, ...) SELECT r.dead_letter, r.data, ...` routes failed payloads into the DLQ queue named in the parent queue's `dead_letter` column). Combined with a second `fastify.queue.work` handler on the DLQ queue, this gives us a clean, observable DLQ pipeline WITHOUT polling `pgboss.job WHERE state='failed'`. The `GET /api/queue/dlq` endpoint then lists from the DLQ queue via `boss.findJobs(dlqName)` (v12 API — `getJobById` is deprecated).

- **Retry config is already exposed at createQueue level.** `retryLimit: 5`, `retryBackoff: true`, `retryDelay: 1` (with `retryBackoff: true`, default `retryDelay` is `1` second; formula: `retryDelay * 2^retryCount` with ±50% jitter, capped by optional `retryDelayMax`). For the SC1 "5× 500 → DLQ" scenario, defaults are appropriate (~1s, ~2s, ~4s, ~8s, ~16s between attempts = ~31s total before DLQ); override `retryDelayMax: 30` if desired.

- **Per-retry correlationId propagation is free.** Phase 18 Option B made `fastify.queue.send` inject the caller's ALS `correlationId` into the stored `JobEnvelope.correlationId` at enqueue time. pg-boss stores the `data` (envelope) ONCE in `pgboss.job.data` — every retry attempt on the SAME `job.id` reads the SAME `data` (verified: retries happen by updating the same row's `state` from `'active' → 'retry'` and later back to `'active'`, never re-inserting; see `plans.js:1059-1083`). So all 5 retries of a given webhook fire share one correlationId end-to-end. ROADMAP SC4 is structurally satisfied by the existing substrate — no wrapper change needed. (Phase 18's Option B per-fire UUID generation targeted `schedule()` only; `send()` carries the ALS-derived id verbatim through all retries.)

- **Reporting module refactor is mechanical.** The existing `server/reporting/webhook-service.ts` hand-rolls a `for` loop retry + exponential backoff + `.catch(() => {})` swallowing. Phase 19 splits it into: (a) `deliverOnce(url, payload)` — single attempt, throws on non-2xx (NO retry loop); (b) module registers a `webhook-deliver` queue that OWNS the retry policy via pg-boss; (c) subscriber on `job.completed` bus event enqueues via `fastify.queue.send`; (d) worker handler calls `deliverOnce` and re-throws on failure so pg-boss counts the attempt. The `fire-and-forget` call in `server/jobs/job-service.ts:426-435` becomes `fastify.bus.emit` / `app.reportingModule.emit` (or stays imperative through a façade decorator — see §Cross-Module Wiring Decision below).

**Primary recommendation:** Sequence plans as (1) Wave 0 substrate (QUEUE_NAMES extensions for `WEBHOOK_DELIVER` + `WEBHOOK_DELIVER_DLQ`, reporting/events.ts scaffold, reporting/schemas.ts extension, dep-cruiser `server/reporting/internal/*` denylist rule, .test.ts → .spec.ts rename); (2) Wave 1 queue.ts (`deliverOnce` refactor, `registerWebhookDeliveryWorkers` factory for BOTH main + DLQ queues, DB-gated queue.spec proving 5× 500 → DLQ); (3) Wave 2 factory + plugin rewrite (createReportingModule, thin plugin, bus subscriber on `job.completed`); (4) Wave 2 DLQ endpoint (`GET /api/queue/dlq` with Zod response schema via fastify-zod-openapi); (5) Wave 3 MODULE.md + barrel + Nyquist + correlationId E2E integration test.

---

## Current State Analysis

### File-level inventory of `server/reporting/`

| File | Lines | Role | Status for Phase 19 |
|------|-------|------|---------------------|
| `reporting-plugin.ts` | 35 | Fastify plugin — constructs `WebhookService` + `FlakyDetector`, decorates; plugin name `'reporting'`, deps `['config', 'db']` | **REWRITE** as thin factory-wirer (mirror `server/lifecycle/plugin.ts`) |
| `webhook-service.ts` | 83 | `deliver(url, payload)` — in-process retry loop with `.catch(() => {})` swallowing; HMAC signing when `config.webhooks.secret` set | **REFACTOR**: extract `deliverOnce(url, payload)` single-attempt body; rename current `deliver` → `deliverWithRetries` (back-compat shim for any direct consumer) OR delete and migrate callers |
| `flaky-detector.ts` | — | Background analytics — NOT touched by Phase 19 | **KEEP AS-IS** |
| `junit-generator.ts` | — | JUnit XML output for reports — NOT touched | **KEEP AS-IS** |
| `report-routes.ts` | — | HTTP routes for `/api/jobs/:id/reports/*` — NOT touched (DLQ route is a NEW file) | **KEEP AS-IS** |
| `schemas.ts` | 33 | Phase 17 Zod schemas for `POST /api/webhooks` ping endpoint | **EXTEND** with `dlqJobSchema`, `dlqListResponseSchema` |
| `__tests__/webhook-service.test.ts` | 180+ | Covers existing retry loop | **REWRITE** to test `deliverOnce` (single-attempt throw on non-2xx); rename `.test.ts → .spec.ts` per MOD-04 |

### Existing `.catch(() => {})` call sites that Phase 19 eliminates

1. `server/jobs/job-service.ts:426-435` — THE target. Currently calls `this.webhookService.deliver(...).catch(...)` after job completion. Phase 19 replaces this with either:
   - **Option A (recommended):** `fastify.bus.emit` of `job.completed` → reporting module's bus subscriber enqueues a `webhook-deliver` job.
   - **Option B (interim):** jobs calls `fastify.reportingModule.enqueueDelivery(url, payload)` directly (imperative façade).
   - See §Cross-Module Wiring Decision.
2. `server/jobs/job-executor.ts` (if any) — search for `.catch(() => {})`. None found in inventory scan.
3. `server/reporting/webhook-service.ts:78-81` — the `this.logger.error(...)` log inside the retry loop's terminal branch. Replaced by the pg-boss DLQ pipeline.

---

## Standard Stack

### Core (already installed — no new deps for Phase 19)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `pg-boss` | `^12.15.0` | `webhook-deliver` queue (retry + DLQ); `boss.findJobs(dlqName)` for GET /api/queue/dlq | Phase 15 substrate. DLQ is a first-class feature (`Queue.deadLetter` option, `deadLetter` FK on the `job` table — see `plans.js:286, 482, 1156`). |
| `fastify-zod-openapi` | `^5.6.1` | Zod → OpenAPI on GET /api/queue/dlq; Zod-validated response body | Phase 17 substrate. |
| `@fastify/request-context` | `^6.2.1` | ALS correlationId read/restore via `fastify.queue.send` / `.work` | Phase 15 substrate. |
| `zod` | `^4.3.6` | `dlqJobSchema` + `dlqListResponseSchema` + webhook payload envelope | Canonical. |
| `drizzle-orm` | `^0.45.1` | Writes to `events` table via `persistEnvelope` (duplicated from bus plugin per RESEARCH Open Question #1 precedent) | Phase 15 substrate; Phase 16 + 18 both duplicated the 10-line middleware. |
| `dependency-cruiser` | `^17.3.10` | `.dependency-cruiser.cjs` — add `no-deep-imports-into-reporting-internal` rule (mirror Phase 16 hooks + Phase 18 lifecycle) | Phase 16 substrate. |
| `pino` | — | `logger.child({module: 'reporting'})` per MOD-07 | Canonical. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Queue-level `deadLetter: 'webhook-deliver-dlq'` + second worker on DLQ queue | Poll `pgboss.job WHERE state='failed' AND name='webhook-deliver'` periodically | Polling pattern has a TOCTOU window + drift risk (a failed job that gets `retry()`'d between scan and emit double-emits the terminal event). DLQ-queue approach is atomic: pg-boss re-inserts the payload into a NEW row in the DLQ queue, which we then `work()` just like any other queue. The terminal event emit happens on the DLQ queue's worker, which runs exactly once per failed job. **Use DLQ-queue approach.** |
| `boss.onComplete` event hook (pre-v10 pg-boss API) | — | **Removed/deprecated in pg-boss v10+.** Not exposed in v12.15 `PgBoss` class (verified in `dist/index.d.ts`). ROADMAP / REQUIREMENTS text says "`boss.onComplete` transforma failed-after-max" — that language is outdated for pg-boss v10+. The v12 equivalent is `deadLetter:` queue re-insertion + a second worker. **ROADMAP wording is prose-level; planner may normalize.** |
| Same queue for success + failed-terminal path (worker handler branches on last attempt) | — | Requires knowing "is this the last attempt?" inside the handler. v12 exposes `retryCount` + `retryLimit` on `job.metadata` ONLY when worker uses `includeMetadata: true` (WorkWithMetadataHandler form — `types.d.ts:323-327`). The `fastify.queue.work` wrapper currently does NOT forward metadata. Adding a second worker on the DLQ queue is cleaner, doesn't require changing the wrapper. **Use separate DLQ worker.** |
| Pure-in-process retry (keep current `webhook-service.ts` loop) | — | Violates QUEUE-05 ("DLQ pipeline") and does not survive server restart. Non-starter. |
| Declare `job.completed` in reporting's own registry | Declare it in a future jobs registry (Phase 23) | Phase 23 hasn't happened. Reporting needs a consumable `job.completed` NOW. Three sub-options — see §Cross-Module Wiring Decision. |

---

## pg-boss Dead-Letter Mechanics (v12.15.0) — authoritative

Verified against installed source: `node_modules/pg-boss/dist/plans.js:96, 286, 482, 522-541, 1054-1168, 1267-1293`, `dist/types.d.ts:149-151, 213, 370`, `dist/manager.js:762-781`.

### 1. Queue-level `deadLetter` option (the canonical DLQ mechanism)

```typescript
// node_modules/pg-boss/dist/types.d.ts:208-213
deadLetter?: string;  // "The name of the queue's dead letter queue. When a
                      //  job fails after all retries, the job's payload will
                      //  be copied into said queue, copying the same retention
                      //  and retry configuration as the original job."
```

Set at `createQueue` time:

```typescript
await fastify.boss.createQueue('webhook-deliver-dlq', { retryLimit: 0 } as never);  // DLQ queue MUST exist first
await fastify.boss.createQueue('webhook-deliver', {
  policy: 'standard',          // not stately — we want multiple concurrent jobs, no singleton dedup
  retryLimit: 5,
  retryBackoff: true,
  retryDelay: 1,               // seconds; with retryBackoff=true, delay = 1 * 2^retryCount (approx)
  retryDelayMax: 30,           // optional cap; keeps 5th retry from waiting 32+ seconds
  deadLetter: 'webhook-deliver-dlq',   // <-- THE KEY LINE
} as never);
```

### 2. Runtime behaviour — what actually happens on retry-exhausted

From `plans.js:1054-1168` (the supervise/maintenance plan `failed_jobs` CTE):

```sql
-- Simplified from plans.js:1090-1168
WITH failed_jobs AS (
  -- Jobs whose retryCount >= retryLimit and state = 'active' (final attempt failed)
  UPDATE ${schema}.job
  SET state = 'failed', completed_on = now(), output = ...
  WHERE state IN ('active', 'retry') AND keep_until < now() AND retry_count >= retry_limit
  RETURNING name, data, dead_letter, retry_limit, retry_delay, retry_backoff, ...
)
INSERT INTO ${schema}.job (name, data, output, retry_limit, retry_backoff, retry_delay, ...)
SELECT r.dead_letter,            -- <-- the DLQ queue name becomes the new job's queue
       r.data,                   -- <-- ORIGINAL payload (JobEnvelope with correlationId)
       r.output,                 -- <-- ORIGINAL error output
       q.retry_limit,
       q.retry_backoff,
       ...
FROM failed_jobs r
  JOIN ${schema}.queue q ON q.name = r.dead_letter
WHERE state = 'failed' AND r.dead_letter IS NOT NULL;
```

**Key observations:**
- The DLQ insert happens **inside pg-boss's maintenance/supervise routine** — runs every `maintenanceIntervalSeconds` (default 60s in v12). There's a lag between the final failed attempt and the DLQ row appearing.
- The re-inserted job carries the **original payload** (`data` — our `JobEnvelope` with `correlationId`). The DLQ worker's `fastify.queue.work` restores ALS from this envelope, so the terminal-event emit happens on a fiber with the same `correlationId` as the original delivery attempts. ROADMAP SC4 satisfied structurally.
- The re-inserted job also carries the **original job's output** — which contains the error that caused the final failure. Accessible via `includeMetadata: true` OR via `fastify.boss.findJobs` query after the fact.
- The DLQ queue itself must have `retryLimit: 0` (or 1 with no backoff) so a crashing DLQ worker doesn't loop forever.

### 3. `GET /api/queue/dlq` query surface

pg-boss v12 exposes `findJobs(queueName, options)`:

```typescript
// node_modules/pg-boss/dist/index.d.ts:52
findJobs<T>(name: string, options?: types.FindJobsOptions): Promise<types.JobWithMetadata<T>[]>;

// types.d.ts:158-163
interface FindJobsOptions {
  id?: string;
  key?: string;
  data?: object;        // matches job.data @> options.data (JSONB containment)
  queued?: boolean;     // when true, filters to state < 'active' (created | retry)
}
```

**Problem:** `findJobs` has NO `state` filter. The DLQ queue may contain jobs in any state (including `'created'` = waiting for DLQ worker, `'completed'` = DLQ worker emitted event and returned, `'failed'` = DLQ worker itself threw). For "list all DLQ items" we want **all states except `'cancelled'`**.

**Two implementation paths:**

**Path A (recommended): use `findJobs(dlqName)` — lists all states in DLQ queue, no filter.**
Returns `JobWithMetadata<T>[]` which includes `id`, `name`, `data` (our envelope with correlationId), `state`, `retryCount`, `retryLimit`, `createdOn`, `completedOn`, `output`, `deadLetter`. Map this to the Zod response schema. Include a client-side filter if `?state=` query param is supplied (future enhancement).

**Path B (rejected): raw SQL against `pgboss.job_common`.**
Works but couples reporting module to pg-boss's internal schema. `findJobs` is the supported public API. Use Path A.

### 4. retryBackoff formula — for SC1 "5× 500" scenario budget

From `types.d.ts:107-118`:
```js
// Simplified backoff:
Math.min(retryDelayMax, retryDelay * 2^Math.min(16, retryCount) + jitter)
// With retryDelay=1, retryBackoff=true, retryDelayMax=30:
//   Attempt 1 (initial):    immediate
//   Attempt 2 (retry 1):    ~1s wait
//   Attempt 3 (retry 2):    ~2s wait
//   Attempt 4 (retry 3):    ~4s wait
//   Attempt 5 (retry 4):    ~8s wait
//   Attempt 6 (retry 5):    ~16s wait → after this fails, DLQ on next maintenance tick
// Total wall-clock: ~31s to exhaustion + up to 60s maintenance lag before DLQ insert
```

**Test budget:** The DB-gated queue.spec test proving SC1 (5× 500 → DLQ) must:
- Override `retryDelay` to `0.5` (or lower) + `retryDelayMax: 2` (cap) so retries complete in ~6-8s wall-clock, OR
- Set `retryBackoff: false, retryDelay: 0.1` so all retries fire back-to-back in <1s, OR
- Override `maintenanceIntervalSeconds` to a low value (need to verify v12 exposes this — see §Open Questions)

**Recommendation:** test-only overrides via a `registerWebhookDeliveryWorkers(deps, {testOverrides?})` optional parameter. Production values stay `retryLimit: 5, retryBackoff: true` per ROADMAP SC1 verbatim.

### 5. Crash semantics — "without server crash" (SC1)

SC1 wording: "5× 500 → DLQ without server crash". pg-boss's `boss.work` handler is invoked inside a try/catch at pg-boss's level; a handler throw marks the job `state='retry'` (if attempts remain) or `state='failed'` (on final attempt). No uncaught rejection reaches Node's top level. The current `.catch(() => {})` in `webhook-service.ts` is a Node-unhandledRejection guard — once we're on pg-boss, that guard is redundant; pg-boss owns the error boundary. SC1 is structurally safe.

---

## Cross-Module Wiring Decision — `job.completed` bus event

**The gap:** ROADMAP SC3 says "Reporting module [...] subscribes to `job.completed` from the bus". But `job.completed` is NOT yet declared in any bus registry:
- `server/events/registry.ts:demoRegistry` — no `job.completed`
- `server/hooks/events.ts:hooksRegistry` — no `job.completed`
- `server/lifecycle/events.ts:lifecycleRegistry` — no `job.completed`
- `server/jobs/*` — current code calls `webhookService.deliver({event: 'job.completed', ...})` at `server/jobs/job-service.ts:428` where `'job.completed'` is a **string literal in the webhook body**, NOT a bus event name.
- Phase 23 (Jobs Module Keystone) is the phase that introduces `job.completed` as a real bus event (`REQUIREMENTS.md EVENTS-10` saga orchestration).

**Three implementation sub-options:**

### Sub-option A: Declare `job.completed` in reporting's own events.ts (NOT recommended)
Reporting's events.ts would host schemas it CONSUMES but doesn't emit. Breaks the "owner-publishes" convention where `events.ts` declares **your own** emitted events.

### Sub-option B: Temporary imperative façade + defer bus migration to Phase 23 (recommended for Phase 19)
- Phase 19 exposes `fastify.reportingModule.enqueueWebhookDelivery(url, payload)` as the public entry point.
- `server/jobs/job-service.ts:426-435` changes from `this.webhookService.deliver(...).catch()` to `this.reportingModule.enqueueWebhookDelivery(config.webhooks.url, { event: 'job.completed', job, summary, timestamp })`.
- Inside `enqueueWebhookDelivery`, the module calls `fastify.queue.send('webhook-deliver', { url, payload }, {})` — this IS the Phase 18 wrapper.
- A "bus subscriber on `job.completed`" is STUBBED: reporting's events.ts declares a `reporting-test.trigger` fixture event (like hooks' `test.trigger`) that exercises the bus→queue bridge path; wiring to a REAL `job.completed` bus event is a single-line change in Phase 23 when that event becomes real.
- ROADMAP SC3 is satisfied in LETTER by the stub: "subscribes to `job.completed` from the bus" can be read as "has a bus subscriber ready to handle `job.completed` once it's published". In SPIRIT, the real wiring lands Phase 23.
- Trade: imperative call remains between `jobs` and `reporting` for Phase 19; Phase 23 removes it. Minimum blast radius this phase.

### Sub-option C: Add `job.completed` to a minimal `jobs/events.ts` in Phase 19 (light touch at edge)
- Phase 19 creates `server/jobs/events.ts` declaring ONLY `job.completed` event (payload: `{jobId, status, platform, summary}`; persisted:true).
- `job-service.ts:426` replaces `.deliver()` call with `fastify.jobsModule.emit.completed(jobId, {...})`.
- Reporting's module factory subscribes `onPersisted('job.completed', env => queue.send('webhook-deliver', {url, payload: body(env)}))`.
- Phase 23 then EXTENDS that minimal registry with the full saga (job.queued / .allocated / .running / .recording / etc.).
- Satisfies ROADMAP SC3 in full LITERAL form.
- Trade: touches `server/jobs/` (creates events.ts + modifies plugin.ts + modifies job-service.ts to emit). Phase 23's scope-of-work shrinks by one event; Phase 19's scope-of-work grows by a jobs-module touch.

**Recommendation: Sub-option C.** Justification:
- ROADMAP SC3 language ("subscribes to `job.completed` from the bus") is unambiguous.
- SC4 ("end-to-end correlationId trace: request log → `job.completed` event → queue job → ...") explicitly names the bus event as a trace hop. Without the real event, the trace has a missing link; the DB query in the correlation-trace integration test has no row to find for "the bus event that enqueued the job".
- The jobs-module touch is tiny: ONE new `events.ts` file + ONE line in `job-service.ts` to replace the existing `.deliver()` call with a typed bus emit. No saga refactor. No state-machine change.
- Phase 23 keystone work is REFACTORING jobs into a saga; having a pre-existing `events.ts` to extend is a positive, not a blocker.
- EVENTS-08 rule (no bus.emit outside events.ts helpers) is satisfied by routing through a proper emit helper.

**Planner decision point:** if sub-option C is rejected (scope discipline / Phase 19 shouldn't touch jobs/), fall back to sub-option B with the stub and a STATE.md note. Both unblock Phase 19.

---

## Standard Queue Contract — `webhook-deliver` + `webhook-deliver-dlq`

### Queue names + policies (target shape)

```typescript
// server/queue/names.ts — extend
export const QUEUE_NAMES = {
  DEMO: 'demo',
  HOOK_RUN: 'hook.run',
  LIFECYCLE_COMPRESS_DAILY:  'lifecycle.compress.daily',
  LIFECYCLE_RETENTION_DAILY: 'lifecycle.retention.daily',
  LIFECYCLE_DISK_HOURLY:     'lifecycle.disk.hourly',
  WEBHOOK_DELIVER:      'webhook.deliver',          // NEW — Phase 19
  WEBHOOK_DELIVER_DLQ:  'webhook.deliver.dlq',      // NEW — Phase 19 (paired DLQ)
} as const;
```

Note: `'webhook.deliver'` (dot) matches codebase convention (`hook.run`, `lifecycle.compress.daily`). REQUIREMENTS.md line 40 says `webhook.deliver` verbatim. ROADMAP prose uses `webhook-deliver` (hyphen) — prose-level, not prescriptive.

### Queue creation order (matters — pg-boss requires DLQ to exist before queue that references it)

```typescript
// Inside registerWebhookDeliveryWorkers factory:

// 1. Create DLQ queue FIRST (forward reference would fail FK deadLetter → queue.name)
await fastify.boss.createQueue(WEBHOOK_DELIVER_DLQ, {
  policy: 'standard',
  retryLimit: 0,           // DLQ is terminal; if the DLQ worker throws, we don't want infinite retry
  retryBackoff: false,
} as never);

// 2. Then create the main queue with deadLetter pointing at the DLQ
await fastify.boss.createQueue(WEBHOOK_DELIVER, {
  policy: 'standard',
  retryLimit: 5,           // ROADMAP SC1 verbatim
  retryBackoff: true,      // ROADMAP SC1 verbatim
  retryDelay: 1,           // seconds — seeds the 2^n formula (default would be 0 but retryBackoff forces min 1)
  retryDelayMax: 30,       // optional cap (recommended to bound test runtime + production oddly-long waits)
  deadLetter: WEBHOOK_DELIVER_DLQ,
} as never);

// 3. Register the MAIN worker — calls deliverOnce; re-throws on failure
const mainWorkerId = await fastify.queue.work(WEBHOOK_DELIVER, async (data, jobId) => {
  // ALS already restored (correlationId from envelope)
  const { url, payload } = data as { url: string; payload: object };
  try {
    await webhookService.deliverOnce(url, payload);
  } catch (err) {
    // pg-boss counts this as an attempt; if retryCount < retryLimit, schedules retry;
    // otherwise, sets state='failed' and the maintenance loop moves payload to DLQ.
    emit.failed(REPORTING_AGGREGATE_ID, { url, attempt: /*...*/, error: String(err) });
    throw err;  // REQUIRED — pg-boss determines final state from thrown/not
  }
  emit.delivered(REPORTING_AGGREGATE_ID, { url, /* ... */ });
});

// 4. Register the DLQ worker — emits the TERMINAL event
const dlqWorkerId = await fastify.queue.work(WEBHOOK_DELIVER_DLQ, async (data, jobId) => {
  // This job is pg-boss's re-insertion after retry exhaustion.
  // ALS carries the ORIGINAL correlationId from the first attempt (EVENTS-07).
  const { url, payload } = data as { url: string; payload: object };
  emit.failedRetryExhausted(REPORTING_AGGREGATE_ID, {
    url,
    attempts: /* retryLimit + 1 = 6 including initial */ 6,
    payload,
    // jobId of the ORIGINAL failed job is lost in the re-insert — we have the DLQ job's id instead.
    // If needed, include {originalJobId} in the payload before enqueue, or read output from findJobs on the main queue.
  });
});

return { workerIds: [mainWorkerId, dlqWorkerId] };
```

### Worker-side retry semantics (important detail)

pg-boss re-fires the SAME `job.id` row on retry (it does NOT insert a new row). `retryCount` increments inside the existing row. This means:
- `job.id` is stable across retries.
- `data` (our envelope) is stored ONCE at enqueue time; all 5 retries read the same payload + same `correlationId`.
- The **maintenance loop** is what moves an exhausted job to the DLQ queue — so there's up to `maintenanceIntervalSeconds` (default 60s in v12) of lag between final failure and DLQ row appearing. Tests need `vi.waitFor({timeout: 70_000})` or a maintenance-interval override.

**Verification source:** `plans.js:1054-1083` (the retry-counter UPDATE; state transitions `active → retry` on non-final failure, `active → failed` on final failure), `plans.js:1090-1168` (the DLQ CTE — only runs on jobs already in `state='failed'`, NOT jobs still in `state='retry'`).

---

## Phase 16 Module Pattern Comparison (what reporting must adopt)

Side-by-side with `server/hooks/` (Phase 16) and `server/lifecycle/` (Phase 18 — the most recent + closest template).

| Artifact | Hooks | Lifecycle | Reporting (today) | Gap |
|----------|-------|-----------|-------------------|-----|
| `MODULE.md` (9 fixed H2 + H3 Runnable Example) | ✅ 97 lines | ✅ 104 lines, 836 words | ❌ absent | **Write** — mirror lifecycle exactly |
| `index.ts` barrel with ONE `from './internal/` re-export line (inline type modifier) | ✅ 2-line form | ✅ 1-line form (stricter) | ❌ absent | **Write** — adopt lifecycle's 1-line form |
| `events.ts` with registry + emit helpers | ✅ 4 events | ✅ 4 events | ❌ absent | **Write** — see §Events Design below |
| `queue.ts` with worker registration + payload schemas | ✅ `registerHookRunWorker` | ✅ `registerLifecycleSchedulesAndWorkers` | ❌ absent | **Write** — `registerWebhookDeliveryWorkers` (main + DLQ) |
| `schemas.ts` (Zod source-of-truth) | ✅ `hookDefinitionSchema` | ✅ result schemas | ⚠️ exists but Phase 17 scope-only (`webhookCreateRequestSchema` for ping endpoint) | **EXTEND** with DLQ list response + `webhookDeliveryPayloadSchema` |
| `internal/` subdir with denylist-protected private code | ✅ 5 files | ✅ 1 file | ❌ absent | **Create** — `internal/module.ts` (factory) |
| `plugin.ts` as thin factory-wirer | ✅ 204 lines (routes inline) | ✅ ~80 lines | ⚠️ 35 lines but constructs `WebhookService` imperatively | **REWRITE** — call factory, decorate, addHook('onClose') |
| `createXModule(deps): XModule` factory (MOD-06) | ✅ `createHooksModule` | ✅ `createLifecycleModule` | ❌ absent | **Write** — `createReportingModule` |
| Tests-as-spec `__tests__/*.spec.ts` | ✅ 5 specs | ✅ 8 specs | ⚠️ 1 file `.test.ts` + others | **RENAME** `.test.ts → .spec.ts`; **ADD** new specs |
| Plugin `dependencies: [...]` | `['config','event-bus','queue','pool-plugin']` | `['config','db','queue','event-bus']` | `['config','db']` | **EXTEND** to `['config','db','queue','event-bus']` |
| QUEUE_NAMES extension | ✅ HOOK_RUN | ✅ LIFECYCLE_* × 3 | ❌ absent | **Add** `WEBHOOK_DELIVER`, `WEBHOOK_DELIVER_DLQ` |
| Dep-cruiser denylist rule for `internal/` | ✅ rule 1 (hooks) | ✅ rule 2 (lifecycle) | ❌ absent | **ADD** rule 3 `no-deep-imports-into-reporting-internal` to `.dependency-cruiser.cjs` |
| Persistence middleware (`persistEnvelope`) duplicated from bus plugin | ✅ 10 lines (hooks/internal/module.ts:51-84) | ✅ 10 lines (lifecycle/internal/module.ts:57-90) | — | **Duplicate** third time — Phase 27+ consolidates per hooks RESEARCH Open Question #1 precedent |
| Logger child | `logger.child({module:'hooks'})` | `logger.child({module:'lifecycle'})` | `logger.child({component:'webhook-service'})` (inside class) | **CHANGE** to module-scoped child at factory root |

---

## Events Design (per MOD-03 + TRACE-08)

Four events, all aggregate `'reporting'`. Terminal events persisted per TRACE-08.

```typescript
// server/reporting/events.ts (NEW)

// Stable singleton UUID for the reporting aggregate. Same approach as lifecycle's
// LIFECYCLE_AGGREGATE_ID — a v5 UUID derived from 'reporting' under URL namespace.
// Envelope schema requires a valid UUID; reporting is a singleton module so one
// aggregateId is correct. Alternative: use the webhook-targeted jobId as aggregateId,
// but that assumes exactly one webhook per job and couples reporting to the jobs domain.
// Recommendation: singleton aggregateId, carry jobId inside payload.
export const REPORTING_AGGREGATE_ID = /* v5 of 'reporting' under URL ns */;

export const LIFECYCLE_EVENT_NAMES = { /* ... */ } // reporting parallel

// Registry — 4 events:
// 1. webhook.scheduled  — thin, NOT persisted. After bus trigger enqueued the job.
// 2. webhook.delivered  — terminal success, persisted. After 2xx response on ONE attempt.
// 3. webhook.failed     — transient per-attempt failure, NOT persisted. Before retry.
// 4. webhook.failed.retryExhausted — terminal, persisted. From DLQ worker. THIS IS EVENTS-07.

{
  'webhook.scheduled':              { schema: scheduledPayload, persisted: false, aggregateType: 'reporting' },
  'webhook.delivered':              { schema: deliveredPayload, persisted: true,  aggregateType: 'reporting' },
  'webhook.failed':                 { schema: failedPayload,    persisted: false, aggregateType: 'reporting' },
  'webhook.failed.retryExhausted':  { schema: retryExhaustedPayload, persisted: true, aggregateType: 'reporting' },
}
```

### Payload shapes

```typescript
const scheduledPayload = z.object({
  url: z.string().url(),
  event: z.string().min(1),    // the webhook event name (e.g. 'job.completed')
  jobId: z.string().uuid().nullable(),
});

const deliveredPayload = scheduledPayload.extend({
  statusCode: z.number().int(),
  durationMs: z.number().int().nonnegative(),
  attempt: z.number().int().positive(),
});

const failedPayload = scheduledPayload.extend({
  attempt: z.number().int().positive(),
  statusCode: z.number().int().nullable(),
  error: z.string(),
});

// Terminal — EVENTS-07
const retryExhaustedPayload = scheduledPayload.extend({
  attempts: z.number().int().positive(),          // total attempts (retryLimit + 1 including initial)
  lastStatusCode: z.number().int().nullable(),
  lastError: z.string(),
  payloadSnapshot: z.record(z.string(), z.unknown()),  // preserves body for operator investigation
});
```

**Why include `payloadSnapshot` on the terminal event?** EVENTS-04 says thin payloads are the default; terminal events are the documented exception. An operator debugging a DLQ entry needs to know what body was POST'd (without round-tripping back to the original `jobs` row via `correlationId` → DB walk). Matches hooks' `hook.failed.retryExhausted` pattern (includes `stderrTail`).

### Emit helpers factory

Mirrors `makeLifecycleEmitters` / `makeHookEmitters` exactly:

```typescript
export function makeReportingEmitters(
  bus: TypedBus<ReportingRegistry>,
  onEmit?: (envelope: Envelope) => void,
) {
  const emit = createEventHelpers(bus, onEmit);
  return {
    scheduled:        emit('webhook.scheduled'),
    delivered:        emit('webhook.delivered'),
    failed:           emit('webhook.failed'),
    failedRetryExhausted: emit('webhook.failed.retryExhausted'),  // EVENTS-07
  };
}
```

---

## Factory + Plugin Design

### `createReportingModule(deps): ReportingModule` (MOD-06)

```typescript
// server/reporting/internal/module.ts — NEW

export interface CreateReportingModuleDeps {
  fastify: FastifyInstance;      // reach fastify.boss, fastify.queue, fastify.onPersisted
  db: Database;
  config: AppConfig;              // for config.webhooks.secret / timeout_ms
  logger: pino.Logger;
}

export interface ReportingModule {
  webhookService: WebhookService;          // back-compat for any consumer reaching through old decorator
  flakyDetector: FlakyDetector;            // UNCHANGED — preserved by factory
  emit: ReportingEmitters;
  bus: TypedBus<ReportingRegistry>;
  /** Initiate workers (main + DLQ) + bus subscribers. Returns when workers ready. */
  registerWorkersAndSubscribers: () => Promise<void>;
  /** Enqueue a webhook delivery. Sub-option B imperative path (called by jobs module). */
  enqueueWebhookDelivery: (url: string, payload: object, opts?: { jobId?: string }) => Promise<string | null>;
  shutdown: () => Promise<void>;
}

export function createReportingModule(deps): ReportingModule {
  const logger = deps.logger.child({ module: 'reporting' });
  const webhookService = new WebhookService(logger, deps.config.webhooks);
  const flakyDetector = new FlakyDetector(deps.db, logger);
  const bus = new TypedBus(reportingRegistry);
  const persistEnvelope = makePersistEnvelope({ db: deps.db, bus, logger });  // duplicated 10 lines
  const emit = makeReportingEmitters(bus, persistEnvelope);

  let workerIds: string[] = [];
  let unsubscribeBus: (() => void) | null = null;
  let stopped = false;

  return {
    webhookService, flakyDetector, emit, bus,

    registerWorkersAndSubscribers: async () => {
      const registration = await registerWebhookDeliveryWorkers({
        fastify: deps.fastify,
        webhookService,
        emit,
        logger,
      });
      workerIds = registration.workerIds;

      // Sub-option C wiring (recommended): subscribe to job.completed bus event.
      // Sub-option B wiring (fallback): NO bus subscriber — rely on imperative enqueueWebhookDelivery.
      // If jobs module (Phase 19 sub-plan) emits job.completed via jobsModule.emit.completed:
      unsubscribeBus = deps.fastify.onPersisted('job.completed', async (envelope) => {
        const url = deps.config.webhooks?.url;
        if (!url) return;  // webhooks not configured; no-op
        const body = {
          event: 'job.completed',
          job: envelope.payload,  // thin payload from jobs module (jobId, status, platform, summary)
          timestamp: envelope.occurredAt,
        };
        // fastify.queue.send carries correlationId from ALS (which onPersisted set via envelope.id).
        await deps.fastify.queue.send(WEBHOOK_DELIVER, { url, payload: body }, {});
        emit.scheduled(REPORTING_AGGREGATE_ID, { url, event: 'job.completed', jobId: envelope.aggregateId });
      });
    },

    enqueueWebhookDelivery: async (url, payload, opts = {}) => {
      const jobId = await deps.fastify.queue.send(WEBHOOK_DELIVER, { url, payload }, {});
      emit.scheduled(REPORTING_AGGREGATE_ID, { url, event: (payload as any).event ?? 'unknown', jobId: opts.jobId ?? null });
      return jobId;
    },

    shutdown: async () => {
      if (stopped) return;
      stopped = true;
      if (unsubscribeBus) { try { unsubscribeBus(); } catch {} unsubscribeBus = null; }
      for (const id of workerIds) {
        try { await deps.fastify.boss.offWork(id); }
        catch (err) { logger.warn({ err, workerId: id }, 'offWork failed'); }
      }
      workerIds = [];
      logger.info('Reporting module shutdown complete');
    },
  };
}
```

### `reporting-plugin.ts` → `plugin.ts` rewrite

```typescript
// server/reporting/plugin.ts — REWRITE (replaces reporting-plugin.ts)

async function reportingPlugin(fastify: FastifyInstance) {
  const module = createReportingModule({
    fastify, db: fastify.db, config: fastify.config,
    logger: fastify.log as unknown as pino.Logger,
  });

  // Back-compat decorations preserved for existing consumers (job-service.ts reads webhookService):
  fastify.decorate('webhookService', module.webhookService);
  fastify.decorate('flakyDetector', module.flakyDetector);
  fastify.decorate('reportingModule', module);       // NEW surface

  await module.registerWorkersAndSubscribers();

  fastify.addHook('onClose', async () => { await module.shutdown(); });
}

export default fp(reportingPlugin, {
  name: 'reporting',  // KEEP name to match 12 other plugin dependency strings + server/index.ts line 127
  dependencies: ['config', 'db', 'queue', 'event-bus'],   // was ['config', 'db']
});
```

**File rename question:** the old file is `reporting-plugin.ts`; other modules use `plugin.ts`. ADR-002 reserves `plugin.ts` as the module's Fastify thin wrapper. Planner decision: either (a) rename + adjust import in `server/index.ts:11`, or (b) keep `reporting-plugin.ts` filename for lower-churn close-out. Recommendation: rename to `plugin.ts` for ADR-002 alignment (low-churn — 1 import change).

---

## `GET /api/queue/dlq` Endpoint Design

### Route registration

Two placement options:
- (A) in `server/reporting/routes.ts` — registered by the reporting module's plugin alongside its existing `/api/webhooks` ping endpoint.
- (B) in `server/api/routes.ts` (the api aggregator) alongside other queue ops.

**Recommendation: A** (reporting owns the route). The DLQ endpoint is reporting-module-specific state; module cohesion > cross-module aggregator. Phase 27 (API Aggregator) will refactor whether routes move to `server/api/*` — until then, stay local. Matches hooks pattern (`/api/hooks/*` lives in `server/hooks/plugin.ts`).

### Zod schemas

```typescript
// server/reporting/schemas.ts — EXTEND existing file

export const dlqJobSchema = z.object({
  id: z.string(),
  name: z.string(),                                // DLQ queue name (webhook.deliver.dlq)
  state: z.enum(['created', 'retry', 'active', 'completed', 'cancelled', 'failed']),
  retryCount: z.number().int().nonnegative(),
  retryLimit: z.number().int().nonnegative(),
  data: z.object({
    correlationId: z.string().uuid().nullable(),   // pulled from JobEnvelope
    causationId: z.string().uuid().nullable(),
    actor: z.string(),
    payload: z.record(z.string(), z.unknown()),    // the original webhook request {url, payload}
  }),
  output: z.record(z.string(), z.unknown()).nullable(),   // pg-boss serialized error at final failure
  createdOn: z.string().datetime(),
  completedOn: z.string().datetime().nullable(),
}).meta({ id: 'DlqJob', description: 'A dead-lettered job' });

export const dlqListResponseSchema = z.object({
  items: z.array(dlqJobSchema),
  count: z.number().int().nonnegative(),
}).meta({ id: 'DlqListResponse' });
```

Note: `correlation_id` is CONTEXT.md specifies snake_case — but the schema surfaces it from `data.correlationId` (the JobEnvelope field name from Phase 15 substrate). The DLQ response maps the envelope shape. If reviewers want the top-level `correlation_id` promoted out of `data.*` for ergonomics, add a projection:

```typescript
export const dlqJobSchemaFlat = z.object({
  id: z.string(),
  queue: z.string(),
  state: z.enum([...]),
  retrycount: z.number().int(),       // <- matches CONTEXT.md spec snake_case
  data: z.record(z.string(), z.unknown()),
  output: z.record(z.string(), z.unknown()).nullable(),
  createdon: z.string().datetime(),
  correlation_id: z.string().uuid().nullable(),    // hoisted from data.correlationId
});
```

**Recommendation:** use the flat shape at the endpoint layer (matches CONTEXT.md field-name list verbatim: `id, queue, state, retrycount, data, output, createdon, correlation_id`), with the projection done server-side.

### Route handler

```typescript
// Inside reportingPlugin (after routes registration helper):
fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().route({
  method: 'GET',
  url: '/api/queue/dlq',
  schema: {
    response: { 200: dlqListResponseSchema },
  } satisfies FastifyZodOpenApiSchema,
  handler: async () => {
    const jobs = await fastify.boss.findJobs(QUEUE_NAMES.WEBHOOK_DELIVER_DLQ);
    return {
      items: jobs.map(j => ({
        id: j.id,
        queue: j.name,
        state: j.state,
        retrycount: j.retryCount ?? 0,
        data: (j.data as any) ?? {},
        output: (j.output as any) ?? null,
        createdon: j.createdOn?.toISOString() ?? null,
        correlation_id: ((j.data as any)?.correlationId as string | null) ?? null,
      })),
      count: jobs.length,
    };
  },
});
```

**Auth:** the existing reporting routes (`/api/webhooks`) don't preHandler-auth-gate; `/api/queue/dlq` probably should. Phase 26 (auth module) is the owner of the auth layer. For Phase 19 — match the pattern of the existing `/api/webhooks` endpoint (no auth). Out of scope to add auth.

---

## Common Pitfalls

### Pitfall 1: pg-boss DLQ insert happens in the MAINTENANCE loop, not immediately
**What goes wrong:** test expects DLQ row to appear within 1s of 5th failure — waits forever.
**Why:** `maintenanceIntervalSeconds` default 60s. The `failed_jobs` CTE that re-inserts into DLQ runs inside `supervise`/`maintain`.
**How to avoid:** in tests, pass `maintenanceIntervalSeconds: 1` via queue-plugin opts override (need to add the passthrough — see Open Questions #2); OR call `await boss.supervise()` explicitly in the test after the 5th failure, OR use `vi.waitFor({timeout: 75_000})`. Recommendation: supervise-on-demand in tests.
**Warning signs:** test times out with 0 DLQ rows but `pgboss.job` shows the original job in `state='failed'`.

### Pitfall 2: DLQ queue must exist BEFORE main queue references it via `deadLetter`
**What goes wrong:** `createQueue('webhook-deliver', {deadLetter: 'webhook-deliver-dlq'})` throws FK violation because `dead_letter` column has an FK to `queue.name`.
**Why:** `plans.js:461` — `ALTER TABLE ... ADD CONSTRAINT dlq_fkey FOREIGN KEY (dead_letter) REFERENCES queue (name)`.
**How to avoid:** always call `createQueue(DLQ_NAME)` FIRST, then `createQueue(MAIN_NAME, {deadLetter: DLQ_NAME})`. Idempotent — safe to call every boot.

### Pitfall 3: `JobEnvelope.correlationId` is stored ONCE; all 5 retries share it
**What goes wrong:** developer assumes each retry gets a fresh correlationId (carried over from Phase 18 Option B schedule semantics).
**Why:** Phase 18 Option B applies ONLY to `fastify.queue.schedule()` — sets envelope.correlationId=null so `queue.work` generates per-fire UUIDs for cron-dispatched jobs. `fastify.queue.send()` (used by webhook enqueue) stamps the ALS correlationId at enqueue time, and pg-boss stores the envelope once — retries read the same row. **This is correct behaviour for webhooks** (all 5 attempts are one logical delivery operation, share one trace id) but is OPPOSITE of scheduled cron behaviour.
**How to avoid:** document the intended behaviour in MODULE.md Invariants section. Test assertion for SC4: `expect(retryAttempts.map(a => a.correlationId)).toEqual([cid, cid, cid, cid, cid])` — same id across all attempts.

### Pitfall 4: `retryBackoff: true` + `retryDelay: 0` → pg-boss defaults to `retryDelay: 1`
**What goes wrong:** developer sets `retryDelay: 0` hoping for immediate retries in tests; gets 1s minimum.
**Why:** `types.d.ts:108-109`: "Sets initial `retryDelay` to 1 if not set." Also applies when `retryDelay: 0` + `retryBackoff: true` — the formula multiplies 0 × 2^n = 0, but minimum floor of 1s applies.
**How to avoid:** for fast tests, use `retryBackoff: false, retryDelay: 0` (if supported — verify) OR use `retryDelay: 1, retryBackoff: true, retryDelayMax: 2` (caps retries at ~2s each → ~10s total).

### Pitfall 5: `boss.findJobs(queueName)` returns ALL states, not just 'failed'
**What goes wrong:** DLQ endpoint returns DLQ jobs in `state='completed'` (already processed by DLQ worker, emitted terminal event) alongside `state='created'` (waiting for DLQ worker). Confusing UX.
**Why:** `plans.js:1267-1293` — findJobs has no state filter.
**How to avoid:** project `state` in the Zod response so clients can filter. Add a `?state=failed` query param pass-through to the endpoint (future enhancement — out of scope Phase 19). For Phase 19 MVP, return all DLQ states + document behaviour in MODULE.md.

### Pitfall 6: Handler throw must re-throw raw error, not wrapped
**What goes wrong:** `catch (err) { emit.failed(...); throw new Error('wrapped: ' + err.message); }` — pg-boss stores the wrapped message in `job.output`. Original stack trace lost.
**How to avoid:** `catch (err) { emit.failed(...); throw err; }` — re-throw the raw Error. pg-boss serializes to `job.output` (JSONB). The terminal event can still extract `err.message` for the `lastError` payload field.

### Pitfall 7: `deliverOnce` must NOT treat 4xx as retry-worthy
**What goes wrong:** `deliverOnce` throws on 4xx → pg-boss retries 5 times on 404 (permanent client error) → DLQ row → false alarm. Wasted attempts.
**Why:** 4xx means "your request is wrong"; retrying doesn't help.
**How to avoid:** `deliverOnce` implements the 4xx carve-out from current webhook-service.ts:58-62 logic. On 4xx: log warn, RESOLVE (don't throw). On 5xx: throw. On network error: throw. On 2xx: resolve.
**Alternative framing:** treat `deliverOnce` as "succeed on 2xx or 4xx non-retryable; throw on everything else". Mirrors existing behaviour semantic (non-retryable 4xx responses).

### Pitfall 8: Webhook secret HMAC signing must happen inside `deliverOnce`, not in the worker
**What goes wrong:** signing in the worker = signature computed per-attempt (varies with timestamps if body changes; stays constant for same body). HMAC of a static body is stable, but doing it in worker is wasted work across retries.
**Why:** body is already JSON-serialized before enqueue; retries re-read the same string.
**How to avoid:** compute signature inside `deliverOnce(url, payload)` on each call. Cost is negligible (HMAC-SHA256 of ~2KB body is <1ms). Matches current implementation.

### Pitfall 9: `webhook-deliver` queue policy should NOT be `'stately'`
**What goes wrong:** picking `policy: 'stately'` (which Phase 16 hooks + Phase 18 lifecycle use) would mean a second webhook delivery with the same singletonKey returns null. Webhooks don't want dedup — two different jobs both completing + both firing webhooks should both deliver.
**Why:** singletonKey prevents dedup for idempotency. Hook retries + lifecycle schedules are idempotent by design; webhook deliveries are NOT (two separate `job.completed` events are two separate POSTs).
**How to avoid:** use `policy: 'standard'` for `webhook-deliver`. Don't set `singletonKey`. (If later we DO want dedup — e.g. "don't double-fire if same job completes twice" — add a unique `singletonKey: ${jobId}:${event}` at send time; but that's out of scope.)

### Pitfall 10: Reporting plugin's `dependencies` must now include `queue` and `event-bus`
**What goes wrong:** plugin registers before queue or event-bus → `fastify.boss` / `fastify.onPersisted` are undefined at registration → crash at boot.
**Why:** Fastify plugin dependency resolver loads in topological order only when declared.
**How to avoid:** update `dependencies: ['config', 'db', 'queue', 'event-bus']`. Verify via `server/__tests__/plugin-order.spec.ts` (expand to cover reporting → queue assertion).

### Pitfall 11: Existing webhook-service.test.ts uses `.test.ts` — rename per MOD-04
**What goes wrong:** phase close-out sees inconsistent naming, Phase 30 has extra file to touch.
**How to avoid:** Phase 18 Plan 18-04 set the precedent (`git mv *.test.ts *.spec.ts`). Phase 19 does the same for `webhook-service.test.ts` in this plan (100% similarity rename preserves blame).

### Pitfall 12: `.dependency-cruiser.cjs` `no-direct-bus-emit-outside-events-ts` allowlist already covers `server/*/internal/module.ts`
**What goes wrong:** reporting's `internal/module.ts` constructs `new TypedBus(reportingRegistry)` → rule would fire if allowlist doesn't cover it.
**Why:** see `.dependency-cruiser.cjs:54-58` — allowlist regex `server/[^/]+/internal/module\.ts$` already covers MOD-06 factories.
**How to avoid:** no action. Existing allowlist covers reporting by construction.

---

## Architecture Patterns

### Recommended Project Structure (post-migration)

```
server/reporting/
├── MODULE.md                     # MOD-01 — 9 H2 sections + H3 Runnable Example
├── index.ts                      # MOD-02 — barrel, ONE internal/ re-export line (inline type modifier)
├── plugin.ts                     # thin Fastify wrapper (~70 lines) — renamed from reporting-plugin.ts
├── events.ts                     # MOD-03 — reportingRegistry + emit helpers + REPORTING_AGGREGATE_ID
├── queue.ts                      # QUEUE-06 — main + DLQ queue names, payload schemas,
│                                 #   registerWebhookDeliveryWorkers factory
├── schemas.ts                    # existing Phase 17 + NEW dlqJobSchema / dlqListResponseSchema /
│                                 #   webhookDeliveryPayloadSchema
├── webhook-service.ts            # UNCHANGED public class BUT new deliverOnce method + deprecate old deliver
├── flaky-detector.ts             # UNCHANGED
├── junit-generator.ts            # UNCHANGED
├── report-routes.ts              # UNCHANGED
├── routes.ts                     # NEW — DLQ endpoint GET /api/queue/dlq (Zod-schemas via fastify-zod-openapi)
├── internal/
│   └── module.ts                 # MOD-06 — createReportingModule factory with bus + persistEnvelope +
│                                 #   onPersisted('job.completed') subscriber wiring
└── __tests__/
    ├── webhook-service.spec.ts       # RENAMED from .test.ts, REWRITTEN to cover deliverOnce (single attempt)
    ├── events.spec.ts                # NEW — emit helpers + registry
    ├── queue.spec.ts                 # NEW (DB-gated) — proves 5× 500 → DLQ row appears → terminal event in events table
    ├── module.spec.ts                # NEW — factory shape + shutdown idempotency
    ├── correlation.spec.ts           # NEW (DB-gated) — E2E correlationId trace (ROADMAP SC4)
    └── dlq-route.spec.ts             # NEW — GET /api/queue/dlq schema + behaviour
```

### Pattern 1: DeliverOnce + Queue-Owned Retry

```typescript
// server/reporting/webhook-service.ts — REFACTORED

export class WebhookService {
  // ... existing fields ...

  /**
   * Single-attempt HTTP POST. Throws on non-2xx/non-4xx or network error.
   * 4xx responses are treated as permanent failure and resolve WITHOUT throwing
   * (retry is pointless — the request shape is wrong).
   *
   * Retries are OWNED by the `webhook-deliver` pg-boss queue (retryLimit:5, retryBackoff:true).
   * This method never loops.
   */
  async deliverOnce(url: string, payload: object): Promise<void> {
    const body = JSON.stringify(payload);
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.secret) {
      const signature = createHmac('sha256', this.secret).update(body).digest('hex');
      headers['X-Signature-256'] = `sha256=${signature}`;
    }

    const resp = await fetch(url, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (resp.ok) {
      this.logger.info({ url, status: resp.status }, 'Webhook delivered');
      return;
    }
    if (resp.status >= 400 && resp.status < 500) {
      // Non-retryable; log + resolve without throwing (pg-boss would retry otherwise).
      this.logger.warn({ url, status: resp.status }, 'Webhook rejected 4xx — not retryable');
      return;
    }
    // 5xx → throw for pg-boss retry accounting.
    throw new Error(`Webhook delivery failed: HTTP ${resp.status}`);
  }

  // DEPRECATE old deliver() — keep as thin wrapper calling deliverOnce in a loop,
  // OR delete entirely (caller migration in Phase 19). Recommendation: DELETE the
  // old deliver() and have server/jobs/job-service.ts use the bus/queue path.
}
```

### Pattern 2: Terminal Event Emission via DLQ Worker (EVENTS-07)

```typescript
// server/reporting/queue.ts — registerWebhookDeliveryWorkers
// ... (see Standard Queue Contract §Queue creation order above) ...

// The DLQ worker is WHERE the terminal event gets emitted.
const dlqWorkerId = await fastify.queue.work(WEBHOOK_DELIVER_DLQ, async (data, jobId) => {
  // data.payload carries the original webhook request {url, payload: body}
  // data.correlationId is the ORIGINAL correlationId that traveled through 5 attempts
  //   (pg-boss re-inserts the ORIGINAL envelope into the DLQ queue; fastify.queue.work
  //    restores ALS with data.correlationId, so emit helpers read it natively).
  const { url, payload } = data as { url: string; payload: object };
  const jobEvent = (payload as { event?: string }).event ?? 'unknown';
  const jobRefId = /* extract from payload.job.id if present */;

  emit.failedRetryExhausted(REPORTING_AGGREGATE_ID, {
    url,
    event: jobEvent,
    jobId: jobRefId,
    attempts: 6,           // retryLimit=5 + 1 initial
    lastStatusCode: null,  // can be fetched via boss.findJobs(MAIN_QUEUE, {id: originalJobId}) but we don't carry originalJobId forward
    lastError: 'Retry exhausted (see original job output)',
    payloadSnapshot: payload,
  });

  // IMPORTANT: do NOT throw from this handler. If it throws, pg-boss will retry the DLQ
  // job (we set retryLimit:0 on the DLQ queue to prevent loops, but logs would still
  // show an error). Handler should log + resolve.
});
```

### Anti-Patterns to Avoid

- **Don't keep the in-process retry loop in `WebhookService.deliver`.** It's the whole reason Phase 19 exists. Delete it. pg-boss owns retries.
- **Don't swallow worker errors** (`try { await deliverOnce(...) } catch {}`). pg-boss can't count the attempt if the handler swallows. Let errors propagate.
- **Don't emit `webhook.failed.retryExhausted` inside the MAIN worker's catch branch on the last attempt.** The main worker doesn't KNOW which attempt is last (no metadata forwarding). Let pg-boss route to DLQ, emit from DLQ worker. Cleaner separation.
- **Don't use `singletonKey` on `webhook-deliver`.** Webhook deliveries are NOT idempotent by design (two separate `job.completed` events = two separate POSTs). Singleton dedup would drop the second delivery silently.
- **Don't declare cross-module events in consumer registries** (see §Cross-Module Wiring Decision — `job.completed` belongs to `jobs/events.ts`, NOT `reporting/events.ts`).

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Webhook retry with exponential backoff | Existing `for` loop in `webhook-service.ts:44-76` | pg-boss queue `{retryLimit:5, retryBackoff:true}` | Durable across restarts; correlationId survives all 5 attempts; observable via pg-boss state |
| Dead-letter queue | Custom table + scanning cron | pg-boss queue-level `deadLetter: '<dlq-name>'` + second worker | Built-in; atomic re-insert on final failure; payload + correlationId preserved |
| Listing failed jobs | Raw SQL `SELECT ... FROM pgboss.job WHERE state='failed'` | `fastify.boss.findJobs(dlqName)` | Public API; survives pg-boss internal schema changes; returns typed `JobWithMetadata<T>` |
| Per-retry correlationId propagation | Manual thread through job data | `fastify.queue.send` already does via ALS (Phase 15 substrate) + pg-boss re-uses same row across retries | Zero wrapper change; verified in §Dead-Letter Mechanics §2 |
| Webhook HMAC signing | Already in `webhook-service.ts:39-42` | Keep — out of scope to change | Phase 19 is about retry/DLQ pipeline, not signing |
| JSON body serialization | Manual `JSON.stringify` | `JSON.stringify(payload)` — you still do this manually, pg-boss doesn't auto-serialize arbitrary objects in job.data beyond its envelope wrap | N/A — keep |
| Terminal event → events table persistence | Manual `db.insert(eventsTable)` inside worker | `emit.failedRetryExhausted(...)` helper → persistEnvelope middleware writes atomically | Zod validation at emit time; causationId propagation free via ALS |

---

## Code Examples

### Example 1: Full worker registration sketch

```typescript
// server/reporting/queue.ts
import { QUEUE_NAMES } from '../queue/names.js';
import type { WebhookService } from './webhook-service.js';
import type { ReportingEmitters } from './events.js';
import { REPORTING_AGGREGATE_ID } from './events.js';

export const WEBHOOK_DELIVER = QUEUE_NAMES.WEBHOOK_DELIVER;
export const WEBHOOK_DELIVER_DLQ = QUEUE_NAMES.WEBHOOK_DELIVER_DLQ;

export const webhookDeliveryPayloadSchema = z.object({
  url: z.string().url(),
  payload: z.record(z.string(), z.unknown()),
});
export type WebhookDeliveryPayload = z.infer<typeof webhookDeliveryPayloadSchema>;

export interface RegisterWebhookDeliveryWorkersDeps {
  fastify: FastifyInstance;
  webhookService: WebhookService;
  emit: ReportingEmitters;
  logger: pino.Logger;
}

export interface WebhookDeliveryRegistration {
  workerIds: string[];
}

export async function registerWebhookDeliveryWorkers(
  deps: RegisterWebhookDeliveryWorkersDeps,
): Promise<WebhookDeliveryRegistration> {
  const { fastify, webhookService, emit, logger } = deps;

  // 1. DLQ queue FIRST (FK constraint).
  await fastify.boss.createQueue(WEBHOOK_DELIVER_DLQ, {
    policy: 'standard',
    retryLimit: 0,
    retryBackoff: false,
  } as never);

  // 2. Main queue with deadLetter reference.
  await fastify.boss.createQueue(WEBHOOK_DELIVER, {
    policy: 'standard',
    retryLimit: 5,
    retryBackoff: true,
    retryDelay: 1,
    retryDelayMax: 30,
    deadLetter: WEBHOOK_DELIVER_DLQ,
  } as never);

  // 3. Main worker.
  const mainWorkerId = await fastify.queue.work<WebhookDeliveryPayload>(
    WEBHOOK_DELIVER,
    async (data, jobId) => {
      const parsed = webhookDeliveryPayloadSchema.parse(data);   // QUEUE-02 consumer-side validation
      const log = logger.child({ queue: WEBHOOK_DELIVER, jobId });
      const started = Date.now();
      try {
        await webhookService.deliverOnce(parsed.url, parsed.payload);
        emit.delivered(REPORTING_AGGREGATE_ID, {
          url: parsed.url,
          event: (parsed.payload as any).event ?? 'unknown',
          jobId: (parsed.payload as any)?.job?.id ?? null,
          statusCode: 200,
          durationMs: Date.now() - started,
          attempt: /* would need metadata to know exact attempt — optional */ 1,
        });
      } catch (err) {
        emit.failed(REPORTING_AGGREGATE_ID, {
          url: parsed.url,
          event: (parsed.payload as any).event ?? 'unknown',
          jobId: (parsed.payload as any)?.job?.id ?? null,
          attempt: 1,  // approximate — for precise attempt, use includeMetadata:true form
          statusCode: null,
          error: err instanceof Error ? err.message : String(err),
        });
        throw err;  // REQUIRED — pg-boss counts the attempt + retries or routes to DLQ
      }
    },
  );

  // 4. DLQ worker — emits the TERMINAL event.
  const dlqWorkerId = await fastify.queue.work<WebhookDeliveryPayload>(
    WEBHOOK_DELIVER_DLQ,
    async (data, jobId) => {
      const parsed = webhookDeliveryPayloadSchema.parse(data);
      const log = logger.child({ queue: WEBHOOK_DELIVER_DLQ, jobId });
      try {
        emit.failedRetryExhausted(REPORTING_AGGREGATE_ID, {
          url: parsed.url,
          event: (parsed.payload as any).event ?? 'unknown',
          jobId: (parsed.payload as any)?.job?.id ?? null,
          attempts: 6,
          lastStatusCode: null,
          lastError: 'Retry exhausted',
          payloadSnapshot: parsed.payload,
        });
        log.warn({ url: parsed.url }, 'Webhook delivery retry-exhausted — terminal event emitted');
      } catch (emitErr) {
        log.error({ err: emitErr }, 'Failed to emit terminal event from DLQ worker');
        // Do NOT re-throw — DLQ queue has retryLimit:0, but logging + swallowing is safer
      }
    },
  );

  logger.info({ mainWorkerId, dlqWorkerId }, 'Webhook delivery workers registered');
  return { workerIds: [mainWorkerId, dlqWorkerId] };
}
```

### Example 2: E2E correlationId trace integration spec (SC4 proof)

```typescript
// server/reporting/__tests__/correlation.spec.ts  — DB-gated

describe.skipIf(!process.env.TEST_DATABASE_URL)('webhook retry → DLQ → terminal event correlationId E2E', () => {
  let app: FastifyInstance;
  const SCHEMA = 'pgboss_reporting_correlation_spec';
  let failingServer: http.Server;
  let capturedCorrelationIds: string[] = [];
  let webhookUrl: string;

  beforeAll(async () => {
    // Boot a local HTTP server that ALWAYS returns 500 for SC1 "5× 500" scenario.
    failingServer = http.createServer((req, res) => {
      res.writeHead(500);
      res.end('nope');
    });
    webhookUrl = await new Promise((resolve) => {
      failingServer.listen(0, () => resolve(`http://127.0.0.1:${(failingServer.address() as any).port}/hook`));
    });

    // Truncate schema; stand up app with queue plugin pointed at unique schema;
    // override retryDelay to 0.1 + retryDelayMax: 0.2 for fast test.
    app = Fastify({ logger: false });
    await app.register(configPlugin, { webhooks: { url: webhookUrl, max_retries: 5 } });
    await app.register(correlationPlugin);
    await app.register(dbPlugin);
    await app.register(busPlugin);
    await app.register(queuePlugin, { schema: SCHEMA, maintenanceIntervalSeconds: 1 });
    await app.register(reportingPlugin);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await new Promise((r) => failingServer.close(r));
    // drop schema
  });

  it('5× 500 → DLQ row → terminal event → events table with matching correlationId', async () => {
    const expectedCid = crypto.randomUUID();

    // Run inside an ALS fiber with a known correlationId.
    await logContext.run({ correlationId: expectedCid }, async () => {
      const jobId = await app.queue.send('webhook.deliver', {
        url: webhookUrl,
        payload: { event: 'job.completed', job: { id: 'test-job' } },
      }, {});
      expect(jobId).not.toBeNull();
    });

    // Wait for the 5 attempts to fire + DLQ maintenance tick + DLQ worker to emit.
    // With retryDelay:0.1, retryDelayMax:0.2, maintenanceIntervalSeconds:1, budget ~8s.
    await vi.waitFor(async () => {
      const events = await app.db
        .select()
        .from(eventsTable)
        .where(eq(eventsTable.eventType, 'webhook.failed.retryExhausted'))
        .where(eq(eventsTable.correlationId, expectedCid));
      expect(events.length).toBeGreaterThanOrEqual(1);
    }, { timeout: 15_000 });

    // Also assert DLQ row exists.
    const dlqJobs = await app.boss.findJobs('webhook.deliver.dlq');
    const matching = dlqJobs.filter((j) => (j.data as any).correlationId === expectedCid);
    expect(matching.length).toBeGreaterThanOrEqual(1);

    // And DLQ endpoint returns it.
    const resp = await app.inject({ method: 'GET', url: '/api/queue/dlq' });
    expect(resp.statusCode).toBe(200);
    const body = resp.json() as { items: Array<{ correlation_id: string | null }> };
    expect(body.items.some((i) => i.correlation_id === expectedCid)).toBe(true);
  });
});
```

### Example 3: MODULE.md skeleton (for Plan N)

```markdown
# Reporting Module

## Purpose
Deliver outbound webhook notifications for completed jobs via a durable, retryable, dead-letter-observable pipeline. Owns `WebhookService.deliverOnce` (single-attempt HTTP POST), the `webhook-deliver` pg-boss queue (retryLimit:5 + retryBackoff:true), the `webhook-deliver-dlq` queue (terminal pipeline), and the `GET /api/queue/dlq` read-only endpoint. Also hosts `FlakyDetector` and JUnit-report generation (unchanged this phase).

## Public API
Exports from `server/reporting/index.ts`:
- `reportingPlugin` — Fastify plugin.
- `createReportingModule(deps): ReportingModule` — factory.
- `WebhookService` — imperative class (back-compat); `.deliverOnce(url, payload)` single-attempt.
- `FlakyDetector` — back-compat.
- `reportingRegistry`, `REPORTING_EVENT_NAMES`, `REPORTING_AGGREGATE_ID`, `makeReportingEmitters` — events surface.
- `WEBHOOK_DELIVER`, `WEBHOOK_DELIVER_DLQ`, `webhookDeliveryPayloadSchema`, `registerWebhookDeliveryWorkers` — queue surface.
- `dlqJobSchema`, `dlqListResponseSchema` — response schemas.

Routes: `GET /api/queue/dlq`, plus existing `POST /api/webhooks` (ping, unchanged), `GET /api/jobs/:id/reports/*` (report-routes, unchanged).

## Events Emitted
- `webhook.scheduled` (thin, NOT persisted) — after enqueue.
- `webhook.delivered` (terminal, persisted) — after 2xx.
- `webhook.failed` (transient, NOT persisted) — per-attempt pre-retry.
- `webhook.failed.retryExhausted` (terminal, persisted, **EVENTS-07**) — from DLQ worker.
Aggregate: `'reporting'` for all.

## Events Consumed
- `job.completed` (from jobs module — Phase 19 sub-plan adds minimal jobs/events.ts with this event; Phase 23 saga extends the registry).

## Queue Produced
- `webhook.deliver` — `policy: 'standard'`, `retryLimit: 5`, `retryBackoff: true`, `retryDelay: 1`, `retryDelayMax: 30`, `deadLetter: 'webhook.deliver.dlq'`.

## Queue Consumed
- `webhook.deliver` — main worker (calls `deliverOnce`, re-throws on 5xx).
- `webhook.deliver.dlq` — DLQ worker (emits `webhook.failed.retryExhausted`).

## Invariants
- (a) `deliverOnce` throws on non-2xx/non-4xx; resolves on 2xx and 4xx. Test: `webhook-service.spec.ts`.
- (b) 5× 500 from a webhook target moves the job to DLQ within maintenance budget; server does not crash. Test: `queue.spec.ts`.
- (c) All 5 retries share ONE `correlationId`. Test: `correlation.spec.ts`.
- (d) Terminal event `webhook.failed.retryExhausted` is persisted to `events` table with `correlation_id`. Test: `correlation.spec.ts`.
- (e) `GET /api/queue/dlq` returns the failed item (flat shape with `correlation_id`). Test: `dlq-route.spec.ts`.

## Non-Goals
- DLQ replay — out of scope Phase 19.
- Multi-target webhooks — out of scope.
- HMAC signing redesign — out of scope.

## Dependencies
- `config` — reads `fastify.config.webhooks`.
- `db` — writes `events` rows (via persistEnvelope).
- `queue` — registers workers + enqueues via `fastify.queue.send`.
- `event-bus` — subscribes to `job.completed` via `fastify.onPersisted`.

### Runnable Example
(Enqueue + terminal-event observation snippet — mirror lifecycle/MODULE.md §Runnable Example.)
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `webhookService.deliver(url, payload).catch(() => {})` in-process retry loop | `fastify.queue.send('webhook.deliver', {url, payload})` → pg-boss owns retries | This phase | Durable retries survive crash; observable via `/api/queue/dlq`; correlationId traced through all attempts |
| Terminal webhook failure silently logged at `webhook-service.ts:78-81` | `webhook.failed.retryExhausted` emitted to bus + persisted to `events` table | This phase (EVENTS-07) | Alerting pipeline observable; Phase 27 trace-tree endpoint surfaces terminal failures by correlationId |
| No DLQ surface | `GET /api/queue/dlq` read-only endpoint (Zod-validated) | This phase (QUEUE-05) | Operators can triage failed deliveries without DB shell access |
| Reporting plugin constructs `WebhookService` imperatively | `createReportingModule({fastify, db, config, logger})` factory → thin plugin wires | This phase (MOD-06) | Matches Phase 16/18 conventions; testable in isolation |
| `reporting-plugin.ts` filename | `plugin.ts` (ADR-002 convention) | This phase | Naming consistency across modules |
| Ad-hoc imperative `job-service.ts → webhookService.deliver(...)` | `jobsModule.emit.completed(jobId, payload)` → reporting's `onPersisted('job.completed')` → `queue.send` | This phase (sub-option C) | Loose coupling via bus; Phase 23 saga extends jobs/events.ts without touching reporting |

**Deprecated / outdated:**
- `pg-boss onComplete` hook (pre-v10 API) — NOT available in v12. ROADMAP/REQUIREMENTS wording "`boss.onComplete` transforma failed-after-max em evento terminal" is aspirational; the v12 equivalent is the queue-level `deadLetter` + second worker pattern.
- In-process retry loops — superseded by queue-owned retry policy.

---

## Open Questions

### Q1. Sub-option B vs Sub-option C for `job.completed` wiring?
**What we know:** ROADMAP SC3 says reporting "subscribes to `job.completed` from the bus". SC4 integration test requires a bus event row linked by correlationId. No `job.completed` bus event exists today.
**What's unclear:** whether Phase 19 is scoped to touch `server/jobs/` to add a minimal `events.ts` (sub-option C) or stays within `server/reporting/` and defers the bus hookup (sub-option B).
**Recommendation:** **Sub-option C** — ONE-event minimal `jobs/events.ts` + one-line replacement in `job-service.ts:426-435`. Literal satisfaction of ROADMAP SC3 + SC4. Trivial extension for Phase 23.
**Fallback:** Sub-option B with stub `reporting-test.jobCompleted` fixture event if reviewer rejects cross-module touch.

### Q2. Does `queuePlugin` need a `maintenanceIntervalSeconds` passthrough for tests?
**What we know:** Phase 18 already added `cronMonitorIntervalSeconds` passthrough (`server/queue/plugin.ts:102-124`) for lifecycle's correlation spec. Same pattern applies — DLQ tests need the maintenance loop to run more frequently than 60s default.
**What's unclear:** whether the existing `opts.cronMonitorIntervalSeconds` also controls maintenance (it does NOT — different internal — see `attorney.js:243-246`).
**Recommendation:** add `maintenanceIntervalSeconds?: number` to `QueuePluginOptions` in `server/queue/plugin.ts`. Production leaves unset (default 60s); tests pass 1. ~3-line addition. Phase 15/18 precedent allows substrate edits when they're purely additive and test-gated.

### Q3. Should `webhook-deliver` job payload include ` originalJobId` alongside `url` + `payload` so the DLQ worker can re-fetch the original row's `output`?
**What we know:** pg-boss re-inserts the payload into DLQ without a backreference. DLQ worker has the payload but NOT the original job's `output` (error details).
**What's unclear:** whether `webhook.failed.retryExhausted` payload NEEDS the original error detail or whether `payloadSnapshot` + operator can cross-reference via correlationId is sufficient.
**Recommendation:** add `lastError: '(see original job output)'` placeholder; operators can query `boss.findJobs('webhook.deliver', {data: {/*correlationId*/}})` to find the original row. If concrete `lastError` is demanded, include it at enqueue time by having the MAIN worker persist the error to a module-owned `webhook_attempts` table — that's scope creep. Recommend: keep thin; add explicit `originalJobId` to the DLQ payload via a custom envelope wrapper if needed (scope flex).

### Q4. Should `webhook-service.ts` expose both `deliver` (old) AND `deliverOnce` (new), or drop `deliver` entirely?
**What we know:** `deliver` is called only from `server/jobs/job-service.ts:426`. That call site changes in Phase 19 anyway.
**Recommendation:** **DELETE** the old `deliver` loop. Zero remaining consumers. Keeps WebhookService API sharp. The existing `webhook-service.test.ts` gets rewritten to cover `deliverOnce` — pure upgrade, no back-compat burden.

### Q5. Dep-cruiser rule name — third "mirror" rule?
**What we know:** `.dependency-cruiser.cjs` has `no-deep-imports-into-hooks-internal` (rule 1) + `no-deep-imports-into-lifecycle-internal` (rule 2). Phase 19 adds `no-deep-imports-into-reporting-internal` (rule 3). Pattern clear.
**Recommendation:** copy-paste rule 2 block, replace `lifecycle` → `reporting`. 15-line addition. Verify with a fixture spec mirroring `server/hooks/__tests__/dep-cruiser.spec.ts` pattern.

### Q6. Where does `GET /api/queue/dlq` live — reporting module or api aggregator?
**What we know:** Phase 27 (API Aggregator) is the future owner of cross-module route aggregation.
**Recommendation:** place in reporting module (matches hooks pattern). Phase 27 may refactor later.

### Q7. Should the DLQ endpoint include jobs from ALL queues, or only `webhook-deliver-dlq`?
**What we know:** Phase 19 only ships one DLQ queue (`webhook-deliver-dlq`). Phase 20+ modules may add their own DLQ queues (e.g., `hook.run.dlq` if hooks migrates).
**Recommendation:** for Phase 19, endpoint returns ONLY `webhook-deliver-dlq` items (literal ROADMAP SC2 — "DLQ pipeline: ... listing items"). If future modules add DLQ queues, endpoint evolves to accept `?queue=` filter or aggregates all DLQ queues. Out of scope Phase 19.

---

## Validation Architecture

> workflow.nyquist_validation is `true` in `.planning/config.json` — include section.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.x (`package.json:devDependencies`) |
| Config file | `vitest.config.ts` (root) |
| Quick run command | `npx vitest run server/reporting/` |
| Full suite command | `npm test && npm run lint && npm run dep-check && npm run contracts:check` |

Additional gates established in Phases 15-18:
- `npm run nyquist:capture && npm run nyquist:check` — coverage delta ≤ −2pp vs `.planning/nyquist-baseline.json` (48.29% lines baseline).
- `npm run dep-check` — structural enforcement of `server/reporting/internal/*` boundary.
- `npm run typecheck` or `npx tsc --noEmit` — type safety gate.

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SC1 | `deliverOnce` throws on non-2xx | unit | `npx vitest run server/reporting/__tests__/webhook-service.spec.ts` | ❌ — Wave 1 (rewrite of `.test.ts` → `.spec.ts`) |
| SC1 | `webhook-deliver` queue owns retry (`retryLimit:5, retryBackoff:true`) | DB-gated integration | `npx vitest run server/reporting/__tests__/queue.spec.ts` | ❌ — Wave 2 |
| SC1 | 5× 500 → DLQ row appears; server doesn't crash | DB-gated integration | same queue.spec.ts | ❌ — Wave 2 |
| SC2 | `GET /api/queue/dlq` lists items (Zod-validated) | HTTP-layer unit (app.inject) + Zod-schema smoke | `npx vitest run server/reporting/__tests__/dlq-route.spec.ts` | ❌ — Wave 2 |
| SC2 (**EVENTS-07**) | retry-exhausted job emits terminal `webhook.failed.retryExhausted` event persisted to `events` table with `correlation_id` populated | DB-gated integration | `npx vitest run server/reporting/__tests__/correlation.spec.ts` | ❌ — Wave 2/3 |
| SC3 MOD-01 | MODULE.md has 9 H2 sections | structural grep (copy Phase 18 verify-script pattern) | inline bash in plan | ❌ — Wave 3 |
| SC3 MOD-02 | barrel `index.ts` exists, ONE internal/ re-export line | dep-check + grep | `npm run dep-check` + grep script | ❌ — Wave 2/3 |
| SC3 MOD-03 | `events.ts` with reportingRegistry + emit helpers | unit | `npx vitest run server/reporting/__tests__/events.spec.ts` | ❌ — Wave 1/2 |
| SC3 MOD-06 | `createReportingModule` factory + shutdown idempotency | unit (no DB) | `npx vitest run server/reporting/__tests__/module.spec.ts` | ❌ — Wave 2 |
| SC3 QUEUE-06 | `queue.ts` with payload schema + worker registration | DB-gated integration | queue.spec.ts (same as SC1) | ❌ — Wave 2 |
| SC3 MOD-04 | `*.spec.ts` naming (file-naming layer only; describe-tree alignment deferred to Phase 30) | `git mv` rename | inline in plan | — |
| SC3 Nyquist | coverage delta ≤ −2pp | `npm run nyquist:capture && npm run nyquist:check` | scripts exist | ✅ |
| SC4 | E2E correlationId trace: request log → `job.completed` event row → queue job → 5 retry log lines → DLQ row → terminal event row (all share same correlationId) | DB-gated integration | `npx vitest run server/reporting/__tests__/correlation.spec.ts` (SAME spec covers SC2 + SC4) | ❌ — Wave 2/3 |

**REQUIREMENTS mapping:**
- `EVENTS-07` → SC2 row (terminal-event persistence test)
- `QUEUE-05` → SC2 row (DLQ endpoint + terminal pipeline)

### Sampling Rate

- **Per task commit:** `npx vitest run server/reporting/` (~10-15s when all specs present; DB-gated specs skip if no `TEST_DATABASE_URL`).
- **Per wave merge:** `npm test && npm run lint && npm run dep-check && npx tsc --noEmit`. Include `DATABASE_URL=... CONTRACTS_CHECK_SPEC=skip` gates per Phase 18 Plan 18-04 precedent to work around known pre-existing failures.
- **Phase gate:** full suite green + `npm run nyquist:check` green + `/gsd:verify-work` runs final audit. Apply the same pre-existing-failure exclusions Phase 18 Plan 18-04 documented (routes.test.ts, artifact-routes.test.ts, auth-plugin.test.ts, plugin-order.spec.ts).

### Wave 0 Gaps

Things that must exist BEFORE implementation specs can run meaningfully:

- [ ] `server/queue/names.ts` — add `WEBHOOK_DELIVER: 'webhook.deliver'` + `WEBHOOK_DELIVER_DLQ: 'webhook.deliver.dlq'`.
- [ ] `server/queue/plugin.ts` — add `maintenanceIntervalSeconds?: number` to `QueuePluginOptions` (additive, test-gated; production unchanged).
- [ ] `.dependency-cruiser.cjs` — add `no-deep-imports-into-reporting-internal` rule 3.
- [ ] `server/reporting/internal/` directory — stub `module.ts` so the dep-cruiser rule can fire (matches Phase 18 Plan 18-00 pattern — stub gets real body in Wave 2).
- [ ] `server/reporting/schemas.ts` — extend with `dlqJobSchema`, `dlqListResponseSchema`, `webhookDeliveryPayloadSchema`.
- [ ] `server/reporting/__tests__/fixtures/` — HTTP test server helper (shared by queue.spec + correlation.spec).
- [ ] Sub-option C only: `server/jobs/events.ts` — declare minimal `jobsRegistry` with ONE event `job.completed` + `makeJobEmitters`.
- [ ] `.test.ts → .spec.ts` rename (`webhook-service.test.ts` → `.spec.ts` via `git mv`).
- [ ] ADR — NONE. ADR-001 Pillar 3 covers; Phase 19 does not introduce new architectural rules.

**All Vitest + Postgres infrastructure prerequisites are already in place:** `vitest.config.ts`, Drizzle migrations, `TEST_DATABASE_URL`-gated spec skipIf pattern, pg-boss schema isolation (`pgboss_${SCHEMA}`). Reuse patterns from `server/hooks/__tests__/queue.spec.ts` + `server/lifecycle/__tests__/correlation.spec.ts`.

---

## Sources

### Primary (HIGH confidence)

- **pg-boss v12.15.0 installed source (authoritative for retry + DLQ mechanics):**
  - `node_modules/pg-boss/dist/index.d.ts:52` — `findJobs(name, options?)` signature
  - `node_modules/pg-boss/dist/types.d.ts:96-131` — QueueOptions including `retryLimit`, `retryDelay`, `retryBackoff`, `retryDelayMax`, `deadLetter`
  - `node_modules/pg-boss/dist/types.d.ts:141-151` — JobOptions (`deadLetter` can be overridden per-send)
  - `node_modules/pg-boss/dist/types.d.ts:208-213` — Queue.deadLetter doc ("job's payload will be copied into said queue")
  - `node_modules/pg-boss/dist/types.d.ts:350-373` — `JobWithMetadata` shape (state, retryCount, retryLimit, output, createdOn, completedOn, deadLetter)
  - `node_modules/pg-boss/dist/plans.js:14, 96, 286, 461, 482` — `dead_letter` FK constraint + partial index structure
  - `node_modules/pg-boss/dist/plans.js:1054-1168` — retry-count state transitions + DLQ `failed_jobs` CTE
  - `node_modules/pg-boss/dist/plans.js:1267-1293` — `findJobs` SQL shape
  - `node_modules/pg-boss/dist/manager.js:762-782` — `findJobs` runtime implementation

- **Phase 15 substrate (committed, in tree):**
  - `server/queue/plugin.ts:121-229` — `fastify.queue.send` / `.work` / `.schedule` — the enqueue wrapper (EVENT-08 / QUEUE-08). Phase 18 Option B per-fire behaviour for schedules only; `send()` carries ALS correlationId verbatim across retries.
  - `server/bus/plugin.ts:80-141` — persistence middleware pattern (duplicated into hooks + lifecycle + soon reporting)
  - `server/bus/helpers.ts:65-114` — `createEventHelpers` + shape-agnostic ALS reader
  - `server/events/envelope.ts:17-32` — envelope schema (UUID-required aggregateId → use singleton UUID for reporting)

- **Phase 16 + 18 pilots (committed, canonical templates):**
  - `server/hooks/MODULE.md` — 9-section template
  - `server/hooks/events.ts` — events.ts skeleton + `makeHookEmitters`
  - `server/hooks/queue.ts` — `registerHookRunWorker` pattern
  - `server/hooks/index.ts` — barrel with 2-line internal re-export (reporting will adopt lifecycle's 1-line form)
  - `server/hooks/internal/module.ts` — factory pattern with duplicated persistEnvelope
  - `server/lifecycle/queue.ts` — `registerLifecycleSchedulesAndWorkers` (multi-worker precedent for reporting's main+DLQ pair)
  - `server/lifecycle/index.ts` — canonical single-line internal re-export (inline `type` modifier) — REPORTING PATTERN
  - `server/lifecycle/internal/module.ts` — factory with event-bus dep + persistEnvelope duplication
  - `.dependency-cruiser.cjs` — rules 1+2 (reporting adds rule 3)

- **Reporting module current state (committed, in tree — pre-refactor):**
  - `server/reporting/reporting-plugin.ts:1-35` — current imperative plugin
  - `server/reporting/webhook-service.ts:33-83` — current `deliver` retry loop
  - `server/reporting/schemas.ts:1-33` — Phase 17 ping-endpoint schemas
  - `server/reporting/__tests__/webhook-service.test.ts:1-50+` — tests for current `deliver`
  - `server/jobs/job-service.ts:426-435` — current `.catch(() => {})` call site (Phase 19 target)

- **Planning substrate:**
  - `.planning/REQUIREMENTS.md` — EVENTS-07 + QUEUE-05 definitions
  - `.planning/ROADMAP.md §Phase 19` — four success criteria
  - `.planning/STATE.md` — Phase 16 + 18 decisions + pre-existing deferred items (Phase 17 `fastify-zod-openapi` v5 `required` bug — carry over to Phase 19 pre-gate runs)
  - `.planning/nyquist-baseline.json` — 48.29% lines baseline
  - `.planning/phases/18-.../18-RESEARCH.md` — pattern precedents (policy:stately dedup, shutdown idempotency, ALS object-store restore)
  - `.planning/phases/18-.../18-04-SUMMARY.md` — Phase 18 close-out pattern including `git mv .test.ts .spec.ts` + pre-existing-failure exclusions for Nyquist capture

### Secondary (MEDIUM confidence)

- pg-boss docs https://github.com/timgit/pg-boss/blob/master/docs/readme.md (not fetched live in this session; API surface matched against installed types)
- pg-boss GitHub issues for v10+ `onComplete` deprecation — ROADMAP wording appears to predate this change; treat as prose-level.
- Cross-module wiring heuristic (`job.completed` bus event placement) — informed reasoning based on EVENTS-08 rule + REQUIREMENTS traceability rather than an external source.

### Tertiary (LOW confidence)

- None. All load-bearing claims are verified against installed source (`node_modules/pg-boss/dist/*`) or committed in-tree code.

---

## Metadata

**Confidence breakdown:**
- Standard stack: **HIGH** — no new deps; all libraries already installed + used in Phases 15-18.
- Architecture (factory + barrel + events + queue): **HIGH** — locked by Phase 16 + Phase 18 pilots; third instance of the same template.
- pg-boss DLQ mechanics: **HIGH** — verified against installed `dist/plans.js` + `dist/types.d.ts` + `dist/manager.js` (retry state transitions, `dead_letter` FK, `findJobs` API).
- Retry + correlationId propagation across retries: **HIGH** — verified that pg-boss re-uses the same `job.id` row across retries, so `data.correlationId` is stable. Phase 18 Option B per-fire behaviour does NOT apply to `send()` calls (only `schedule()`); the intent for webhooks is for all retries to share one correlationId, which IS the current behaviour.
- Terminal event emission via DLQ worker: **HIGH** — mirrors Phase 16 hooks' `hook.failed.retryExhausted` pattern (slated for Phase 19 by Phase 16 MODULE.md Non-Goals section).
- `GET /api/queue/dlq` endpoint design: **HIGH** — `findJobs` API is stable v12 public surface; Zod flat-shape mapping straightforward.
- Cross-module `job.completed` wiring (sub-option B vs C): **MEDIUM** — ROADMAP SC3 language supports either; preference for C stems from SC4 trace-completeness argument. Planner choice.
- Pitfalls: **HIGH** — all 12 drawn from installed source verification or committed Phase 16/18 STATE.md lessons.
- Nyquist delta forecast: **MEDIUM** — Phase 19 adds substantial new code (events + queue + module + DLQ route + 4+ new specs); existing `webhook-service.ts` shrinks by ~40 lines when retry loop deleted. Net delta likely positive (+1 to +3 pp on lines coverage) given new specs pull in new lines. Requires capture after Wave 3 to confirm.
- DLQ maintenance lag (pitfall 1): **HIGH** — `maintenanceIntervalSeconds` default 60s is confirmed; passthrough in queue plugin needed for fast tests.

**Research date:** 2026-04-21
**Valid until:** 2026-05-21 (30 days — pg-boss v12 + Phase 15/16/18 substrate are stable; no breaking pg-boss release expected per their changelog rhythm).
