# Phase 18: Lifecycle Migration (node-cron → pg-boss) — Research

**Researched:** 2026-04-20
**Domain:** pg-boss v12 scheduling, AsyncLocalStorage correlation propagation, Phase 16 module pattern conformance
**Confidence:** HIGH (Context7-equivalent via installed package source + Phase 15/16 committed precedents)

---

## Summary

Phase 18 is a single-requirement cutover (**QUEUE-08**) that migrates `server/lifecycle/` from `node-cron` to `boss.schedule()` AND establishes the correlation-id-carrying `enqueue()` wrapper that every future scheduled/manual job consumer will use. All prerequisites already exist in the tree:

1. **pg-boss v12 substrate is live** (`server/queue/plugin.ts`) and already exposes `fastify.queue.schedule(name, cron, data?, opts?)` and `fastify.queue.send(name, data, opts?)`, BOTH of which already inject `correlationId` / `causationId` / `actor` from ALS into a `JobEnvelope` wrapper and restore them on the worker fiber (Plan 15-05 — TRACE-05 ✅). **The "enqueue wrapper" that QUEUE-08 asks for already exists as `fastify.queue.send`**. Phase 18's scope is (a) cutting lifecycle to use `fastify.queue.schedule` + `fastify.queue.work`, (b) hardening + renaming the wrapper surface so consumers know it's the canonical path (optional alias `enqueue`), and (c) adding an integration test that proves a schedule-triggered fire carries correlationId from `timekeeper.onSendIt` through the worker log line.

2. **The Phase 16 pilot (`server/hooks/`) is the copy-from reference.** Lifecycle must mirror the same artifacts: `MODULE.md` (9 H2 sections), `index.ts` barrel, `events.ts` registry + emit helpers, `queue.ts` worker contract, `schemas.ts`, `internal/` for private helpers, `plugin.ts` as a thin factory-wirer, colocated `__tests__/*.spec.ts` (tests-as-spec), `createLifecycleModule(deps)` factory (MOD-06).

3. **Source-file pressure is low.** Three pure functions (`runCompressionTask`, `runRetentionTask`, `runDiskPressureTask`) are already factored out of the plugin in pure form — they accept `(db, config, logger, deps?)` and take no `node-cron` dependency. Only `lifecycle-plugin.ts` references `node-cron`. Cutover is mechanical: swap `cron.schedule('0 3 * * *', fn)` for `await fastify.queue.schedule('lifecycle-compress-daily', '0 3 * * *', {}, {singletonKey: 'lifecycle-compress-daily'})` and register workers via `fastify.queue.work(name, fn)`.

**Primary recommendation:** Keep the three task functions as-is (they're already pure). Move them under `internal/`, create `events.ts` + `queue.ts` + barrel + MODULE.md, register three schedules + three workers via the factory, add ONE integration spec proving `correlationId` round-trips from a scheduled fire, and ship. No new dependencies. No `node-cron` in `server/lifecycle/*` imports.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

Phase scope is sharply defined by ROADMAP §Phase 18 success criteria (reproduced verbatim below):

1. `node-cron` no longer imported by `server/lifecycle/*`; compression, retention, and disk-pressure jobs run via named pg-boss schedules (`lifecycle-compress-daily`, `lifecycle-retention-daily`, `lifecycle-disk-hourly`) with `singletonKey` preventing overlapping fires.
2. A `boss.send()` wrapper (`enqueue(name, data, opts)`) automatically injects `correlationId` read from ALS into every enqueued job; consumers restore ALS via `logContext.run()` before invoking the handler; an integration test proves schedule-triggered work carries a correlationId from scheduler to worker logs.
3. Lifecycle module follows Phase 16 conventions (MODULE.md, barrel, events.ts, tests-as-spec); Nyquist passes; coverage delta ≤ −2pp.
4. Graceful shutdown drains in-flight schedule jobs inside the configured timeout without dropping work.

### Claude's Discretion

All implementation choices — this is a pure infrastructure phase. Use `server/hooks/` (Phase 16 pilot) as the canonical template. Reuse `server/correlation/` ALS plumbing and `server/bus/` helpers from Phase 15. Apply ADR-003 patterns where relevant.

### Deferred Ideas (OUT OF SCOPE)

- Pipeline scheduler migration to `boss.schedule()` (still uses `node-cron` in `server/pipelines/scheduler.ts`) — that is Phase 25 (QUEUE-08 closes the LIFECYCLE half; Phase 25 closes the PIPELINES half and drops the `node-cron` package.json dep).
- DLQ endpoint + terminal event emission for retry-exhausted jobs — Phase 19 (EVENTS-07, QUEUE-05).
- Subscribing to real `device.*` / `job.*` bus events — lifecycle's role is scheduled housekeeping, not reactive work.
- New `lifecycle.*` business events beyond operational telemetry (what tasks ran, how much freed) — no business-rule change requested.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| **QUEUE-08** | `node-cron` removido de `pipelines-plugin` e `lifecycle-plugin`; substituido por `boss.schedule()`; correlationId injetado em todo `boss.send()` via wrapper lendo da AsyncLocalStorage | Phase 18 closes the LIFECYCLE half (Phase 25 closes the PIPELINES half). Wrapper exists at `server/queue/plugin.ts:121-187` as `fastify.queue.send` + `fastify.queue.schedule` + `fastify.queue.work` — injects correlationId/causationId/actor into `JobEnvelope` (lines 129-137), restores via `asyncLocalStorage.run({...})` on worker fiber (lines 146-169). See §pg-boss Schedule API and §Enqueue Wrapper Design below. |
</phase_requirements>

---

## Current State Analysis

### File-level inventory of `server/lifecycle/`

| File | Lines | Uses node-cron? | Status for Phase 18 |
|------|-------|-----------------|---------------------|
| `lifecycle-plugin.ts` | 99 | **YES** (`import cron from 'node-cron'`, `cron.schedule`, `ScheduledTask[]`, `cron.ScheduledTask.stop()`) | **REWRITE** as thin factory-wirer (mirror `server/hooks/plugin.ts`) |
| `compression-task.ts` | 132 | NO (pure function: `spawn`, `rename`, `stat`) | **KEEP AS-IS** (optionally move under `internal/`) |
| `retention-task.ts` | 94 | NO (pure function: `rm`) | **KEEP AS-IS** (optionally move under `internal/`) |
| `disk-pressure-task.ts` | 92 | NO (pure function: `rm` + DB SUM) | **KEEP AS-IS** (optionally move under `internal/`) |
| `__tests__/compression-task.test.ts` | 175 | NO (mocks db + spawn) | **KEEP**, consider rename to `.spec.ts` for MOD-04 consistency |
| `__tests__/retention-task.test.ts` | — | NO | **KEEP**, consider rename |
| `__tests__/disk-pressure-task.test.ts` | — | NO | **KEEP**, consider rename |

**Critical observation:** the three task *bodies* are already pure (take `db`, `config`, `logger`, `deps?`). Cutover is purely a *scheduling-mechanism* swap at the plugin layer — the imperative logic in `runCompressionTask` etc. stays 100% unchanged. Risk is isolated to the ~100 lines of `lifecycle-plugin.ts`.

### Existing node-cron usage points

Only two imports of `node-cron` remain in server code:

| File | Line | Call | Phase that removes it |
|------|------|------|-----------------------|
| `server/lifecycle/lifecycle-plugin.ts` | 2 | `import cron from 'node-cron'` | **Phase 18 (this phase)** |
| `server/lifecycle/lifecycle-plugin.ts` | 38 | `cron.schedule('0 3 * * *', fn)` — daily compression+retention | **Phase 18** |
| `server/lifecycle/lifecycle-plugin.ts` | 67 | `cron.schedule('0 * * * *', fn)` — hourly disk pressure | **Phase 18** |
| `server/pipelines/scheduler.ts` | 1 | `import cron from 'node-cron'` | Phase 25 (pipelines module refactor) |
| `server/pipelines/scheduler.ts` | 90 | `cron.schedule(row.cronExpression, fn)` | Phase 25 |

After Phase 18, `node-cron` still ships in `package.json` (via `server/pipelines/scheduler.ts`). Package removal is **Phase 25**, not Phase 18.

### Current schedule semantics

Today's `lifecycle-plugin.ts`:

| Schedule | Cron | Tasks | Overlap-protection |
|----------|------|-------|--------------------|
| Daily | `0 3 * * *` | `runCompressionTask` then `runRetentionTask` (sequential inside one closure) | `new Mutex()` from `async-mutex` — prevents overlap with hourly disk-pressure fires AND with itself |
| Hourly | `0 * * * *` | `runDiskPressureTask` | Same `Mutex` instance |

**One `LifecycleStats` decorator** (`fastify.lifecycleStats`) is consumed by `server/api/routes.ts:439` (health endpoint). Must be preserved post-migration.

**Dep declaration:** `dependencies: ['config', 'db']`. Post-migration must become `['config', 'db', 'queue']` (and through `queue`, transitively `correlation`). The api plugin still depends on `lifecycle-plugin` for `fastify.lifecycleStats` — Phase 17 Plan 17-07 already fixed that declaration (see STATE.md).

---

## Standard Stack

### Core (already installed — no new deps)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `pg-boss` | `^12.15.0` | Postgres-backed job queue + cron scheduler (replaces `node-cron`). Declares `boss.schedule(name, cron, data, opts)`, `boss.unschedule(name, key)`, `boss.getSchedules()`, `boss.work(name, handler)`, `boss.stop({graceful, timeout})`. | Project pillar (ADR-001). Phase 15 substrate. |
| `@fastify/request-context` | `^6.2.1` | AsyncLocalStorage wrapper used by `server/correlation/`. Exports both `requestContext` (object-store reader) and `asyncLocalStorage` (raw ALS primitive for shape-agnostic read/write). | Project standard since Phase 15. |
| `fastify` | 5.x | Plugin host. | Project standard. |
| `fastify-plugin` | — | `fp(...)` wrapper with `{name, dependencies}` metadata. | All v3.0 plugins use it. |
| `drizzle-orm` + `postgres` | 0.45.x + 3.x | DB layer (already used by task bodies). | Project standard. |
| `zod` | `^4.3.6` | Schema validation. Used in module `schemas.ts` + `events.ts`. | Project pillar SPEC-01/03. |
| `pino` | — | Logger. `logger.child({module: 'lifecycle'})` per MOD-07. | Project standard. |

### Supporting (REMOVED)

| Library | Version | Reason for removal |
|---------|---------|---------------------|
| `node-cron` | `^4.2.1` | Replaced by `pg-boss.schedule()`. **DO NOT remove from `package.json` this phase** — still used by `server/pipelines/scheduler.ts`; removal is Phase 25 (QUEUE-08 half 2). |
| `@types/node-cron` | `^3.0.11` | Same as above. |
| `async-mutex` `Mutex` (inside `lifecycle-plugin.ts`) | — | **REMOVABLE** — `singletonKey` on `boss.schedule()` prevents overlap at the queue layer; in-process mutex is redundant. Remaining `async-mutex` uses in the codebase (e.g., pool allocation) are unrelated and stay. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `pg-boss.schedule` | Keep `node-cron` per-module | Violates Pillar 3 + ADR-001. Fails QUEUE-08. |
| Three separate schedules | Single `lifecycle-daily` schedule that does both compression + retention serially (matches today's behaviour) | Reviewed: ROADMAP §Phase 18 SC1 explicitly names THREE schedules (`lifecycle-compress-daily`, `lifecycle-retention-daily`, `lifecycle-disk-hourly`). **Use three.** Rationale: independent failure semantics, independent retry counters, observable per-task telemetry. |
| `singletonKey` per schedule | `singletonSeconds` bucketing | `singletonKey` is the explicit recommendation in Phase 16 pilot + pg-boss docs for dedup-on-state. `singletonSeconds` is time-slot dedup (different semantic). **Use `singletonKey: name` (same string as schedule name) — matches Phase 16 pattern.** |
| Custom `enqueue()` wrapper layer | Use `fastify.queue.send` directly (already wraps ALS) | The Phase 15 `fastify.queue.send` IS the wrapper. No second wrapper needed. Phase 18 may optionally add an `enqueue` alias export or a thin module-local helper that adds validation/logging, but must not re-implement ALS injection. **Consume `fastify.queue.send` / `.schedule` / `.work` directly.** |

---

## pg-boss Schedule API Patterns (v12.15.0)

Verified against installed types (`node_modules/pg-boss/dist/timekeeper.d.ts`, `types.d.ts`, `index.d.ts`) and runtime (`dist/timekeeper.js`, `dist/index.js`).

### `boss.schedule(name, cron, data?, options?)` — signature

```typescript
// Source: node_modules/pg-boss/dist/index.d.ts:68
schedule(name: string, cron: string, data?: object | null, options?: ScheduleOptions): Promise<void>;

// Source: node_modules/pg-boss/dist/types.d.ts:235-238
export type ScheduleOptions = SendOptions & {
  tz?: string;    // timezone (default 'UTC')
  key?: string;   // per-schedule key — disambiguates multiple schedules on the same queue name
};
```

`SendOptions = JobOptions & QueueOptions & ConnectionOptions` — includes `singletonKey`, `singletonSeconds`, `priority`, `retryLimit`, `retryBackoff`, `retryDelay`, `expireInSeconds`, `deadLetter`, etc.

**Behaviour per `timekeeper.js:164-180`:**
- Validates the cron expression via `CronExpressionParser.parse(cron, {tz, strict: false})`.
- Inserts into `pgboss.schedule` (upsert on `(name, key)`).
- **Idempotent**: calling `schedule()` with the same `(name, key)` updates the cron/data/options in place (no error, no duplicate row).
- Throws `Queue ${name} not found` if the named queue doesn't exist — must call `boss.createQueue(name)` first.

### How schedules actually fire (internals)

```
Timekeeper.onCron() runs every `cronWorkerIntervalSeconds` (default 5s)
  ↓
  reads pgboss.schedule rows, filters by shouldSendIt(cron, tz)
  ↓
  Timekeeper.onCron() — source timekeeper.js:136-141
  await manager.insert(QUEUES.SEND_IT, scheduled)
  with data: {name, data, options}, singletonKey: `${name}__${key}`, singletonSeconds: 60
  ↓
  SEND_IT worker (__pgboss__send-it queue) receives the tick and CALLS boss.send(name, data, options)
```

**Critical:** pg-boss itself uses `singletonKey: ${name}__${key}, singletonSeconds: 60` on the SEND_IT queue — that's how it prevents the SAME cron fire from being dispatched twice. This is INDEPENDENT of `singletonKey` you set on your own schedule's `options`. Your `singletonKey` applies to the DOWNSTREAM job (the one your worker executes).

### Default scheduling config (`attorney.js:243-246`)

| Option | Default | Range | Purpose |
|--------|---------|-------|---------|
| `cronMonitorIntervalSeconds` | 30 | 1–45 | How often to rebuild cron-fire cache |
| `cronWorkerIntervalSeconds` | 5 | 1–45 | How often the SEND_IT worker polls |
| `schedule` | `true` | — | Boolean enable/disable (set `false` to run only as a worker, no scheduling) |

Phase 18 does **NOT** need to tune these — Phase 15 defaults apply (see `server/queue/plugin.ts`).

### `boss.unschedule(name, key?)` — signature

```typescript
unschedule(name: string, key?: string): Promise<void>;
```

Removes the row from `pgboss.schedule`. Safe to call during shutdown as a cleanup for test suites, but NOT needed in production — schedules are durable (survive restarts). For Phase 18, `unschedule` is likely only exercised in spec teardown.

### `boss.getSchedules()` — diagnostic

```typescript
getSchedules(name?: string, key?: string): Promise<Schedule[]>;
// Returns [{name, key, cron, timezone, data, options}, ...]
```

Useful in an integration spec to assert all three schedules landed:

```typescript
const rows = await app.boss.getSchedules();
expect(rows.find(s => s.name === 'lifecycle-compress-daily')?.cron).toBe('0 3 * * *');
```

### `singletonKey` on scheduled jobs — semantics

From installed types (`dist/types.d.ts:145-188`) and Phase 16 Plan 16-01 verified behaviour:

```
Queue policy 'standard' (the default):
  - singletonKey alone does NOT dedup active jobs.
  - Must combine with policy 'short' / 'singleton' / 'stately' / 'exclusive' / 'key_strict_fifo' to enforce dedup.

Queue policy 'stately' (Phase 16 pilot choice):
  - Index job_i3: UNIQUE(name, state, COALESCE(singleton_key, ''))
    WHERE state IN ('created', 'retry', 'active')
  - Back-to-back sends with same singletonKey: second call returns null (duplicate blocked).

Queue policy 'short' (interesting for lifecycle):
  - Only 1 job allowed in 'created' state; unlimited 'active'. With singletonKey,
    acts as "don't enqueue another fire if one is already queued but not yet picked up."
```

**Phase 18 recommendation:** use policy `'stately'` on all three queues, `singletonKey: <schedule-name>` (same literal string as the schedule name, e.g., `'lifecycle-compress-daily'`). This matches `server/hooks/queue.ts:52-57` and gives the strongest overlap protection: if the daily job is STILL RUNNING when the next fire arrives (rare but possible — ffmpeg on 100 videos can take hours), the second fire is DROPPED at the queue boundary instead of stacking up behind the first.

**Pitfall:** ROADMAP §SC1 says "singletonKey preventing overlapping fires". For a policy-`'standard'` queue, singletonKey DOESN'T do that alone — you need `'stately'` (or `'short'` / `'singleton'` / `'exclusive'`). This is the load-bearing knob. Document the policy choice in `queue.ts`.

### Graceful stop — `boss.stop({graceful, timeout})`

From `dist/index.js:102-131`:

```javascript
async stop(options = {}) {
  let { close = true, graceful = true, timeout = 30000 } = options;
  timeout = Math.max(timeout, 1000);   // floor 1s
  this.#stoppingOn = Date.now();
  await this.#manager.stop();      // stops accepting new work
  await this.#timekeeper.stop();   // stops cron polling
  await this.#boss.stop();         // stops supervise loop
  await this.#bam.stop();

  if (!graceful) return await shutdown();

  // Wait up to `timeout` for in-flight work to complete
  while ((Date.now() - this.#stoppingOn) < timeout && this.#manager.hasPendingCleanups()) {
    await delay(500);
  }
  await shutdown();   // calls db.close() if `close: true`
}
```

**Already wired correctly in Phase 15:** `server/queue/plugin.ts:192-196` registers an `onClose` hook calling `boss.stop({graceful: true, timeout: 30_000, destroy: false})`. Phase 18 inherits this — **no new shutdown code needed in `server/lifecycle/`**. The lifecycle plugin's own `onClose` only needs to `offWork` the three local workers (mirror `server/hooks/internal/module.ts:127-147` `shutdown()` pattern).

### Persistence across restart

Schedules live in `pgboss.schedule` (Postgres table). Restarting the server does NOT re-register schedules — they're already there. Calling `boss.schedule(name, cron, data, opts)` with an existing `(name, key)` pair is idempotent-upsert. This means **Phase 18's register-on-boot flow is safe to run on every restart**.

---

## Enqueue Wrapper Design (ALS injection + consumer restore)

### The wrapper already exists — `fastify.queue` (Phase 15 Plan 15-05)

From `server/queue/plugin.ts:121-187` (verbatim behaviour summary):

**`fastify.queue.send(name, data, opts?)` — the "enqueue" in QUEUE-08 language**

```typescript
// server/queue/plugin.ts:121-137
async send(name, data, opts = {}) {
  if (!isValidQueueName(name)) throw new Error(`Invalid queue name: ${name}`);
  const store = asyncLocalStorage.getStore();
  const correlationId =
    (readStore(store, 'correlationId') as string | null) ?? randomUUID();
  const causationId = (readStore(store, 'currentEventId') as string | null) ?? null;
  const actor = (readStore(store, 'actor') as string | null) ?? 'system';
  const envelope: JobEnvelope = { correlationId, causationId, actor, payload: data };
  return boss.send(name, envelope, opts);
}
```

- Reads BOTH store shapes (object or Map) via `readStore()` at `plugin.ts:75-80`.
- Falls back to fresh UUID if no ambient ALS fiber.
- Wraps user's `data` inside a `JobEnvelope` so the correlation triple rides alongside the payload.

**`fastify.queue.work(name, handler)` — the consumer-side ALS restore**

```typescript
// server/queue/plugin.ts:139-171
async work<T>(name, handler) {
  return boss.work(name, async (jobs) => {
    const job = Array.isArray(jobs) ? jobs[0] : jobs;
    const data = (job as {data?: Partial<JobEnvelope>}).data ?? {};
    const store: Record<string, unknown> = {          // OBJECT store — not Map
      correlationId: data.correlationId ?? randomUUID(),
      currentEventId: data.causationId ?? null,
      actor: data.actor ?? 'cron',
    };
    await asyncLocalStorage.run(store as never, async () => {
      await handler(data.payload as T, job.id);
    });
  });
}
```

- OBJECT-shape store (Phase 15 Plan 15-05 locked this — `@fastify/request-context`'s `requestContext.get(key)` uses `store[key]` bracket access, which Maps don't support).
- Falls back to `actor: 'cron'` when no actor was stamped (the scheduled-fire case).
- `handler` receives the UNWRAPPED `data.payload` (the envelope is transparent to consumers).

**`fastify.queue.schedule(name, cron, data?, opts?)` — scheduled producer**

```typescript
// server/queue/plugin.ts:173-186
async schedule(name, cron, data = {}, opts = {}) {
  if (!isValidQueueName(name)) throw new Error(`Invalid queue name: ${name}`);
  const envelope: JobEnvelope = {
    correlationId: randomUUID(),     // fresh per CALL (not per fire — see pitfall below)
    causationId: null,
    actor: 'cron',
    payload: data,
  };
  await boss.schedule(name, cron, envelope as never, opts);
}
```

**IMPORTANT pitfall — correlationId is per-schedule-registration, not per-fire.** The envelope is stored ONCE in `pgboss.schedule.data`. Every fire dispatches the SAME envelope. This means all fires of a given schedule would share one correlationId in the current implementation. This is **wrong for lifecycle** — we want per-fire distinct correlation ids so logs for two separate daily runs can be disambiguated.

### The per-fire correlationId problem — three resolution options

**Option A (recommended, minimal change in Phase 18):** The consumer-side `work` handler, after restoring ALS from `data.correlationId`, **overwrites `correlationId` with a fresh `randomUUID()` at the top of each fire**. This gives per-fire trace isolation. Downside: the producer-side correlationId in `pgboss.schedule.data` is never actually observed in logs. Upside: 3-line change to `work` (or to a lifecycle-local wrapper).

**Option B (cleaner, slight refactor of `queue.schedule`):** change `queue.schedule` so that it stores `data` WITHOUT a correlationId stamp, and `queue.work` generates a fresh `correlationId` on each fire when `data.correlationId` is missing. This makes scheduled jobs always generate per-fire ids, while `queue.send` (manual enqueue) keeps its ALS-propagation semantic. Requires touching Phase 15 substrate — acceptable because QUEUE-08 explicitly asks to "establish the correlation-id-carrying wrapper" (implying Phase 18 owns the final shape). Recommended.

**Option C (overkill for Phase 18):** Use pg-boss's own `${name}__${key}` SEND_IT dispatch and hook an `onSend` interceptor that stamps a fresh id. Rejected — no public API for that.

**Recommendation: Option B.** Change `queue.schedule` to emit envelopes WITHOUT stamping correlationId (leave it `null`), and change `queue.work` to `correlationId = data.correlationId ?? randomUUID()` (already does this at line 159). The effective behaviour becomes: **each scheduled fire starts a fresh trace; manual `send()` still propagates the caller's trace.** One-line simplification in `schedule`, zero change in `work`.

### The ALS restore pattern — WHAT `logContext.run()` actually is

The CONTEXT.md / ROADMAP wording "consumers restore ALS via `logContext.run()`" is a **naming convention** — in this codebase the actual primitive is `asyncLocalStorage.run()` from `@fastify/request-context`. The `logContext` name is aspirational (from the roadmap draft). Phase 18 should either:
- Use `asyncLocalStorage.run()` verbatim (matches Phase 15 substrate at `queue/plugin.ts:167`), OR
- Add a thin re-export `export const logContext = { run: asyncLocalStorage.run.bind(asyncLocalStorage), ... }` from `server/correlation/index.ts` if the planner wants roadmap-language alignment.

The `fastify.queue.work` wrapper **already calls `asyncLocalStorage.run(store, async () => await handler(...))`** on every worker invocation. **Consumers do not need to call `logContext.run` themselves** — it's already wrapped. The ROADMAP wording is slightly misleading; lifecycle consumers just pass an async function to `queue.work` and ALS is already live inside.

### Final enqueue wrapper surface (Phase 18 deliverable)

Three options for how to expose it:

1. **No new symbol — document `fastify.queue` as THE wrapper.** Easiest. Just write docs + examples in MODULE.md pointing at `fastify.queue.send` / `.schedule` / `.work`.
2. **Add a module-local `enqueue()` alias** in `server/lifecycle/queue.ts` that delegates to `fastify.queue.send` but also payload-validates via a Zod schema. Matches `server/hooks/queue.ts:39-68` pattern.
3. **Lift `enqueue` to `server/queue/index.ts`** (barrel) as a named export. Every future module can import `{ enqueue } from '../queue/index.js'`. Slight coupling — the barrel would need a Fastify instance passed in, which is unergonomic.

**Recommendation: hybrid of 1 and 2.** Document `fastify.queue.*` as the canonical wrapper in `lifecycle/MODULE.md`. Add a module-local `registerLifecycleWorkers(deps)` in `server/lifecycle/queue.ts` that encapsulates the three `fastify.queue.work(...)` registrations + their payload Zod schemas. Mirror `registerHookRunWorker` from `server/hooks/queue.ts`.

---

## Phase 16 Module Pattern Comparison (what lifecycle must adopt)

Side-by-side gap analysis. Left column = what `server/hooks/` has. Right column = what `server/lifecycle/` currently has. Middle = what's missing.

| Artifact | Hooks (Phase 16) | Lifecycle (today) | Gap |
|----------|------------------|-------------------|-----|
| `MODULE.md` with 9 H2 sections | ✅ 97 lines, 9 H2s | ❌ absent | **Write it** |
| `index.ts` barrel | ✅ 46 lines, only public API | ❌ absent | **Write it** |
| `events.ts` with registry + emit helpers | ✅ 90 lines, `hooksRegistry` + `makeHookEmitters` | ❌ absent | **Write it** — see §Events Design below |
| `queue.ts` with worker registration + payload schemas | ✅ 68 lines, `registerHookRunWorker` + `hookRunPayloadSchema` | ❌ absent | **Write it** — see §Queue Contract below |
| `schemas.ts` (if any module-specific Zod schemas) | ✅ 20 lines (`hookDefinitionSchema`, `hookSchema`, `hookConflictSchema`) | ❌ absent (task result types are TS interfaces, not Zod) | **Add** `lifecycleResultSchemas.ts` with per-task result Zod shapes OR skip if all task results stay TS-only (not a trust boundary) |
| `internal/` subdir for private helpers | ✅ `internal/{hook-executor,hook-run-handler,idempotency,module,subscribers}.ts` | ❌ absent (tasks are at root level) | **Move** three task files under `internal/` OR keep at root (fewer file moves — acceptable since dep-cruiser rule only forbids CROSS-MODULE deep imports, and tasks are already internal implementation) |
| `plugin.ts` as thin wrapper | ✅ 204 lines (parses config, calls factory, decorates, registers routes, wires shutdown) | ❌ current `lifecycle-plugin.ts` does scheduling directly | **Rewrite** as thin factory-wirer (~80 lines target) |
| `createXModule(deps): XModule` factory (MOD-06) | ✅ `createHooksModule({fastify, db, logger, hooks})` | ❌ absent | **Write it** — see §Factory Design below |
| Co-located `__tests__/*.spec.ts` tests-as-spec (MOD-04) | ✅ `dep-cruiser.spec.ts`, `events.spec.ts`, `hook-executor.spec.ts`, `module.spec.ts`, `queue.spec.ts` | ⚠️ existing `.test.ts` files (different naming convention) — cover pure task bodies | **Rename** `.test.ts` → `.spec.ts`; **add** `events.spec.ts`, `module.spec.ts`, `queue.spec.ts` for new artifacts; MODULE.md describe-tree alignment is reviewer-gated per 16-VALIDATION.md |
| Plugin `dependencies: [...]` declaration | ✅ `['config', 'event-bus', 'queue', 'pool-plugin']` | ⚠️ `['config', 'db']` | **Update** to `['config', 'db', 'queue']` (lifecycle does NOT need `event-bus` unless it emits bus events — see §Events Design) |
| QUEUE_NAMES extension | ✅ `HOOK_RUN: 'hook.run'` added in `server/queue/names.ts:39` | ❌ absent | **Add** `LIFECYCLE_COMPRESS_DAILY`, `LIFECYCLE_RETENTION_DAILY`, `LIFECYCLE_DISK_HOURLY` to `QUEUE_NAMES` — see §Queue Contract below |
| ADR touch | Phase 16 landed ADR-002 (file naming) | — | **No new ADR** needed; reference ADR-001 Pillar 3 in MODULE.md |
| Logger child | `logger.child({module: 'hooks'})` at factory line 87 | ⚠️ inline `logger.child({task: 'compression'})` only | **Add** module-scoped child at factory |
| `persistEnvelope` middleware for persisted bus events | ✅ 10 lines duplicated in `internal/module.ts:51-84` | — | **Skip** unless lifecycle emits persisted events (see below) |

### Events Design (per MOD-03 + TRACE-08)

**Question:** does lifecycle need an `events.ts` with a bus registry at all? Lifecycle does scheduled housekeeping; it's not reactive. It does NOT need to consume bus events. Does it need to EMIT bus events?

**Options:**

**A. No bus events (minimal).** Tasks return `CompressionResult` / `RetentionResult` / `DiskPressureResult`; plugin updates `fastify.lifecycleStats`; health endpoint reads the decorator. Matches today's behaviour. No `events.ts` needed — but MOD-03 says "every module has events.ts". Workaround: ship an `events.ts` that exports an EMPTY `lifecycleRegistry = {} as const satisfies EventRegistry` plus name constants reserved for future expansion. Documented as "reserved for Phase 19+". **Acceptable**.

**B. Operational-telemetry events** (recommended). Emit four events:
- `lifecycle.compression.completed` (persisted: true) — `{deleted, savedBytes, durationMs}`
- `lifecycle.retention.completed` (persisted: true) — `{deleted, freedBytes, durationMs}`
- `lifecycle.disk.checked` (persisted: true) — `{currentUsageBytes, maxBytes, deleted, freedBytes, durationMs}`
- `lifecycle.task.failed` (persisted: true) — `{task: 'compression' | 'retention' | 'disk'; error; durationMs}`

All terminal → `persisted: true` (TRACE-08). Aggregate `'lifecycle'`. Enables Phase 27's causal-trace endpoint to surface lifecycle activity by `correlationId`. Low cost (4 tiny schema entries). **Recommended.**

**C. `lifecycle.failed.retryExhausted`** for DLQ surface. Deferred to Phase 19 (EVENTS-07) — NOT Phase 18. Retain hook in registry but no emit call site yet.

**Recommendation: Option B** — four emitted, persisted events. Adds `event-bus` to `dependencies: ['config', 'db', 'queue', 'event-bus']`. Mirrors `server/hooks/events.ts` structure exactly. Coverage impact: positive (events.spec.ts adds coverage on new lines; existing pure-function coverage is preserved).

### Queue Contract (per QUEUE-06)

**Three named queues, three schedules, three workers:**

```typescript
// server/queue/names.ts — extend QUEUE_NAMES
export const QUEUE_NAMES = {
  DEMO: 'demo',
  HOOK_RUN: 'hook.run',
  LIFECYCLE_COMPRESS_DAILY:  'lifecycle.compress.daily',
  LIFECYCLE_RETENTION_DAILY: 'lifecycle.retention.daily',
  LIFECYCLE_DISK_HOURLY:     'lifecycle.disk.hourly',
} as const;
```

Note: ROADMAP §SC1 names the schedules as `lifecycle-compress-daily` (hyphen) but pg-boss v12 queue-name regex is `^[a-z][a-z0-9._-]*$` — both hyphen and dot are allowed. The codebase convention so far uses dot-separation (`hook.run`, `job.execute`, `webhook.deliver`). **Use dot-separation for consistency** with existing queue names; the roadmap's hyphenated form is prose-level, not a hard spec. Planner may opt for either — flag as a decision point.

**Payload Zod schema** (per QUEUE-06 requires validation both sides):

```typescript
// server/lifecycle/queue.ts
export const lifecycleJobPayloadSchema = z.object({
  kind: z.enum(['compression', 'retention', 'disk-pressure']),
  triggeredAt: z.string().datetime(),
});
```

**Queue policy**: `'stately'` + `singletonKey: <queue-name>` for all three (see §pg-boss Schedule API — singletonKey semantics).

**Retry policy**: these tasks are idempotent-by-design (compression uses a DB flag `compressed: true` to skip re-compression; retention deletes-then-logs; disk-pressure recomputes usage each run). `retryLimit: 1` is appropriate (one retry; on second failure, let pg-boss mark the job failed — Phase 19 DLQ pipeline will surface it later). `retryBackoff: true`, `retryDelay: 30` matches hooks queue.

### Factory Design (MOD-06)

Mirror `createHooksModule`. Sketch:

```typescript
// server/lifecycle/internal/module.ts
export interface CreateLifecycleModuleDeps {
  fastify: FastifyInstance;
  db: DrizzleDb;
  config: AppConfig;
  logger: pino.Logger;
}

export interface LifecycleModule {
  stats: LifecycleStats;
  emit: LifecycleEmitters;        // from events.ts (if option B chosen)
  bus: TypedBus<LifecycleRegistry>;
  registerSchedulesAndWorkers: () => Promise<void>;
  shutdown: () => Promise<void>;
}

export function createLifecycleModule(deps): LifecycleModule {
  // 1. Construct child logger
  // 2. Construct TypedBus + persistEnvelope + emit helpers (10-line persist middleware duplicated from bus/plugin.ts per RESEARCH Open Question #1 of Phase 16)
  // 3. Create stats object; stored in closure — exposed as module.stats
  // 4. Return { stats, emit, bus, registerSchedulesAndWorkers, shutdown }
}
```

`registerSchedulesAndWorkers` does:
1. `await fastify.boss.createQueue('lifecycle.compress.daily', {policy: 'stately', retryLimit: 1, retryBackoff: true, retryDelay: 30})` × 3
2. `await fastify.queue.schedule('lifecycle.compress.daily', '0 3 * * *', {}, {singletonKey: 'lifecycle.compress.daily'})` × 3 (with different crons)
3. `workerId1 = await fastify.queue.work('lifecycle.compress.daily', async (data, jobId) => runCompressionTask(...))` × 3

`shutdown` does:
1. `await fastify.boss.offWork(workerId)` × 3 — idempotent via `stopped` flag (mirror `hooks/internal/module.ts:127-147`).

### Plugin (thin wrapper)

```typescript
// server/lifecycle/plugin.ts — target ~80 lines
async function lifecyclePlugin(fastify: FastifyInstance) {
  const module = createLifecycleModule({
    fastify,
    db: fastify.db,
    config: fastify.config,
    logger: fastify.log,
  });
  fastify.decorate('lifecycleStats', module.stats);   // back-compat for server/api/routes.ts:439
  fastify.decorate('lifecycleModule', module);        // new barrel surface
  await module.registerSchedulesAndWorkers();
  fastify.addHook('onClose', async () => { await module.shutdown(); });
}
export default fp(lifecyclePlugin, {
  name: 'lifecycle-plugin',
  dependencies: ['config', 'db', 'queue', 'event-bus'],  // +'event-bus' if option B chosen; +'queue' always
});
```

### Coverage delta — tests-as-spec plan

**Existing tests** (all pure-function, DB-mocked, no queue):
- `compression-task.test.ts` — unit
- `retention-task.test.ts` — unit
- `disk-pressure-task.test.ts` — unit

**New tests** (mirror hooks phase 16 patterns):
- `events.spec.ts` — hooksRegistry equivalent, ALS correlationId read, SPEC-03 defaults. Unit, no DB.
- `module.spec.ts` — factory shape + shutdown idempotency. Unit, no DB. Mirror `hooks/__tests__/module.spec.ts`.
- `queue.spec.ts` — DB-gated integration proving ONE schedule → ONE fire → worker runs task with correlationId ≠ null. TEST_DATABASE_URL gated. Mirrors `hooks/__tests__/queue.spec.ts`.
- `plugin.spec.ts` (optional) — Fastify boot + ready + close, no-throw smoke.

Coverage delta target: +N new spec lines covering the new factory / events / queue registration; existing task coverage is preserved (logic unchanged). Net delta on lifecycle module should be neutral-to-positive. Phase-wide delta must be ≤ −2pp per Nyquist gate.

---

## Architecture Patterns

### Recommended Project Structure (post-migration)

```
server/lifecycle/
├── MODULE.md                    # 9 H2 sections per MOD-01
├── index.ts                     # barrel (only public API)
├── plugin.ts                    # thin Fastify wrapper (~80 lines)
├── events.ts                    # lifecycleRegistry + makeLifecycleEmitters (MOD-03)
├── queue.ts                     # per-queue names + payload schemas + registerLifecycleWorkers (QUEUE-06)
├── schemas.ts                   # (optional) Zod result schemas if treated as trust boundary
├── compression-task.ts          # (KEEP as-is OR move to internal/)
├── retention-task.ts            # (KEEP as-is OR move to internal/)
├── disk-pressure-task.ts        # (KEEP as-is OR move to internal/)
├── internal/
│   └── module.ts                # createLifecycleModule factory (MOD-06)
└── __tests__/
    ├── compression-task.spec.ts  # renamed from .test.ts
    ├── retention-task.spec.ts    # renamed
    ├── disk-pressure-task.spec.ts # renamed
    ├── events.spec.ts            # NEW
    ├── module.spec.ts            # NEW
    └── queue.spec.ts             # NEW (DB-gated)
```

### Pattern 1: Scheduled Job Registration

```typescript
// Source: derived from server/hooks/queue.ts:52-68 + server/queue/plugin.ts:173-186
// Register THEN schedule THEN work.

await fastify.boss.createQueue('lifecycle.compress.daily', {
  policy: 'stately',
  retryLimit: 1,
  retryBackoff: true,
  retryDelay: 30,
} as never);

await fastify.queue.schedule(
  'lifecycle.compress.daily',
  '0 3 * * *',
  {} as never,                                        // empty payload — task body re-fetches from DB
  { singletonKey: 'lifecycle.compress.daily' },       // same-string overlap guard
);

const workerId = await fastify.queue.work('lifecycle.compress.daily', async (_payload, jobId) => {
  // ALS is ALREADY restored by fastify.queue.work (correlationId, currentEventId, actor).
  // logger.child() picks up correlationId via pino alsMixin automatically.
  const started = Date.now();
  try {
    const result = await runCompressionTask(db, config, logger);
    stats.lastCompressionRun = { timestamp: new Date().toISOString(), result };
    emit.compressionCompleted('lifecycle', {...result, durationMs: Date.now() - started});
  } catch (err) {
    emit.taskFailed('lifecycle', {task: 'compression', error: String(err), durationMs: Date.now() - started});
    throw err;   // re-throw so pg-boss counts the attempt for retry
  }
});
```

### Pattern 2: Lifecycle-Owned Bus Persistence

If option B (operational-telemetry events) is adopted, copy the 10-line `persistEnvelope` factory from `server/hooks/internal/module.ts:51-84` verbatim. Phase 16 RESEARCH Open Question #1 left consolidation to Phase 27 — Phase 18 continues the duplicate-for-now pattern. Do NOT build a shared helper.

### Anti-Patterns to Avoid

- **Don't re-implement ALS injection.** `fastify.queue.send` / `.schedule` / `.work` already do it. Adding a second wrapper that calls `getCorrelationId()` manually leads to divergent behaviour (cf. Phase 15 Plan 15-04 readAls vs alsMixin shape-mismatch lesson in STATE.md).
- **Don't keep the in-process `Mutex`.** `singletonKey` + `policy: 'stately'` is the correct overlap guard at the queue boundary. Double-guarding with a mutex is redundant and hides queue-layer failures.
- **Don't emit events inside the task bodies** (`compression-task.ts` etc.). Emit in the WORKER HANDLER (the thin wrapper around the task call) so the task bodies stay pure and easy to unit-test. Follows Phase 16 `hook-run-handler.ts:119-125` separation.
- **Don't use `node-cron` for schedule-validation.** The old plugin uses `cron.validate(expr)` — pg-boss v12 does the same via `CronExpressionParser.parse(cron, {tz, strict: false})` internally at `timekeeper.js:166`. Invalid cron throws at `schedule()` call time.
- **Don't forget `dependencies: ['queue']`** on the plugin. Omitting it means the plugin might boot before pg-boss starts → `fastify.boss` undefined → crash.
- **Don't set `schedule: false`** in pg-boss options. Phase 15 defaults leave it `true`. If a plan accidentally flips it off, `boss.schedule()` calls still succeed (the row is inserted) but the timekeeper never polls — silent data loss.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cron parsing + validation | Custom cron regex | `boss.schedule()` delegates to `cron-parser` (pg-boss's internal dep) | Already installed. Validates timezone-aware. Reject invalid input at schedule-time. |
| Overlap-prevention between fires | `async-mutex` `Mutex` in-process | pg-boss queue policy `'stately'` + `singletonKey` | Queue-layer guard survives restart + covers multi-process (if ever). Mutex is per-process only. |
| Correlation-id propagation | Manually thread `correlationId` through schedule → worker | `fastify.queue.schedule` + `fastify.queue.work` already serialise and restore via ALS | Phase 15 Plan 15-05 locked the pattern. Duplicating it adds drift risk (cf. STATE.md Phase 15 Plan 15-04 readAls shape lesson). |
| Schedule-registration idempotency | Custom "already-registered" flag | `boss.schedule()` is idempotent-upsert on `(name, key)` | Built-in. Calling every boot is safe. |
| Per-fire trace id | Generate UUID in task body | Let `fastify.queue.work` generate `randomUUID()` when `data.correlationId` is null (see Option B in §Enqueue Wrapper Design) | One authority for correlation. |
| Stopping schedules on shutdown | `cron.schedule(...).stop()` array iteration | `boss.stop({graceful: true, timeout: 30_000})` on the top-level instance + `boss.offWork(workerId)` for local workers | Phase 15 Plan 15-05 `onClose` hook already calls `boss.stop`; lifecycle module only needs to offWork its three workers. |
| Cron timezone handling | Custom tz offset | Pass `{tz: 'America/Sao_Paulo'}` (or whatever) to `boss.schedule()` options | Built-in, tested against `CronExpressionParser`. |
| Lifecycle stats aggregation | Custom metrics endpoint | Keep current `fastify.lifecycleStats` decorator read by `/health` — back-compat | Zero-churn behaviour for existing consumers. Coverage of `GET /health` is unchanged. |

**Key insight:** every piece of scheduling infrastructure that might be tempting to roll is already provided by the Phase 15 substrate or pg-boss v12 itself. Phase 18 is genuinely a "wire three task function calls into three queue workers" job.

---

## Common Pitfalls

### Pitfall 1: `singletonKey` alone does not dedup on queue policy `'standard'`

**What goes wrong:** Code sets `singletonKey: 'lifecycle.compress.daily'` and assumes overlap is prevented. In reality, `policy: 'standard'` (the default) ignores `singletonKey` for overlap — it's only used by specific policies (`short`, `singleton`, `stately`, `exclusive`, `key_strict_fifo`).

**Why it happens:** pg-boss docs describe `singletonKey` as "a unique key" without making the policy dependency obvious. Phase 16 Plan 16-01 STATE.md entry explicitly called this out after inspecting `node_modules/pg-boss/dist/plans.js:467-485`.

**How to avoid:** explicitly pass `{policy: 'stately'}` to `createQueue`. Add a test that enqueues twice with the same singletonKey and asserts the second returns `null`.

**Warning signs:** two fires happen back-to-back in logs; `hook.compressed` events arrive in pairs; ffmpeg processes stack.

### Pitfall 2: `boss.createQueue` must be called BEFORE `boss.schedule`

**What goes wrong:** `boss.schedule(name, cron, ...)` throws `Queue ${name} not found` (per `timekeeper.js:174-177`).

**Why it happens:** pg-boss v12 decoupled queue-creation from job-sending. `schedule()` under the hood does a `boss.send()` via SEND_IT dispatcher, which requires the queue to exist.

**How to avoid:** order in `registerSchedulesAndWorkers`:
1. `createQueue` × 3 (idempotent — safe to call every boot)
2. `schedule` × 3 (idempotent upsert)
3. `work` × 3 (returns worker id for later `offWork`)

### Pitfall 3: Envelope correlationId stamped once at schedule-registration applies to EVERY fire

**What goes wrong:** all fires of `lifecycle.compress.daily` share the same `correlationId` in logs (the one generated at `queue.schedule(...)` call time).

**Why it happens:** `queue.schedule` (plugin.ts:179-185) creates a single envelope and stores it in `pgboss.schedule.data`. The SEND_IT worker re-dispatches the SAME envelope every tick.

**How to avoid:** either Option A (overwrite in worker) or Option B (store NO correlationId at schedule-time, generate per-fire in `queue.work`). See §Enqueue Wrapper Design — Option B recommended.

**Warning signs:** grep'ing logs by a single correlationId returns dozens of rows spread across days.

### Pitfall 4: Worker restore uses OBJECT store, not Map

**What goes wrong:** developer copies an older RESEARCH sketch that used `new Map([['correlationId', cid]])` for the worker's ALS store. `requestContext.get('correlationId')` returns `undefined` inside the task because `@fastify/request-context` uses `store[key]` bracket access which Maps don't honour.

**Why it happens:** Plan 15-05 originally sketched Map; Plan 15-04 uses Map (for emit helpers on detached fibers); the production queue wrapper standardised on OBJECT for requestContext compatibility. Two shapes co-exist in the codebase.

**How to avoid:** consume `fastify.queue.work` as-is — don't call `asyncLocalStorage.run(...)` yourself. If you must, use the OBJECT shape: `{correlationId: ..., currentEventId: ..., actor: ...}`.

**Warning signs:** pino log lines from worker code have `"correlationId": null` despite the envelope carrying one.

### Pitfall 5: Graceful shutdown double-drain

**What goes wrong:** lifecycle module's `shutdown()` awaits its own drain AND pg-boss `onClose` also awaits `boss.stop({graceful: true, timeout: 30_000})` — total shutdown budget could be 60s instead of 30s if both wait sequentially.

**Why it happens:** both shutdown paths try to be helpful. In reality, `boss.offWork(workerId)` is near-instant (stops accepting new jobs, doesn't wait for in-flight); the 30s drain budget is owned by the top-level `boss.stop`.

**How to avoid:** lifecycle `shutdown()` only calls `boss.offWork(workerId)` (fast); the `boss.stop({graceful: true})` owned by `server/queue/plugin.ts` handles actual drain. Match `server/hooks/internal/module.ts:127-147` pattern.

**Warning signs:** server close takes 60s+ in tests.

### Pitfall 6: Queue name violates pg-boss regex

**What goes wrong:** `boss.createQueue('lifecycle-compress-daily')` — this is VALID (dash allowed). But `'Lifecycle.compress.daily'` (uppercase) or `'1-compress'` (leading digit) is REJECTED by `isValidQueueName` at `server/queue/names.ts:22` (regex `^[a-z][a-z0-9._-]*$`).

**Why it happens:** pg-boss v12 tightened queue-name validation. Codebase has its own pre-check at the wrapper layer.

**How to avoid:** use lowercase, start with letter, allowed separators are `.`, `_`, `-`. Verify via `isValidQueueName`.

### Pitfall 7: Skipping Nyquist gate because "just infrastructure"

**What goes wrong:** plan removes `async-mutex` import AND removes the mutex-acquire/release lines, net-deleting ~8 lines of branch-covered code. Coverage drops > 2pp on the lifecycle module.

**Why it happens:** legitimate simplification looks like coverage loss.

**How to avoid:** add the three new `.spec.ts` files (events, module, queue) with enough assertions to offset the deletions. The queue.spec.ts DB-gated test alone typically covers the factory + schedule path. Run `npm run nyquist:capture` + `npm run nyquist:check` locally BEFORE final PR.

### Pitfall 8: Forgetting to drop `async-mutex` import but keeping the dep

**What goes wrong:** `async-mutex` is only used here AND in `server/pool/*` (device allocation). Removing it from lifecycle-plugin.ts does not let you drop the package.json dep.

**How to avoid:** audit via `grep -rn "from 'async-mutex'" server/` BEFORE declaring the dep removable. Pool still uses it — keep the dep.

### Pitfall 9: `logger` typed as `FastifyBaseLogger` vs `pino.Logger`

**What goes wrong:** task body signature is `runCompressionTask(db, config, logger: pino.Logger, ...)` but callers pass `fastify.log` which is `FastifyBaseLogger` (supertype). Existing code works because of `as any` cast at lifecycle-plugin.ts:43. New factory should pass `fastify.log as unknown as pino.Logger` matching Phase 16's `plugin.ts:56` idiom, OR change task signatures to `FastifyBaseLogger` (preferred — stronger typing).

**How to avoid:** pick one: either (a) keep tasks typed as `pino.Logger` and cast at call site (matches hooks module), or (b) widen tasks to accept `FastifyBaseLogger`. Option (a) is lower-churn.

---

## Code Examples

### Example 1: Register a single lifecycle schedule + worker (canonical)

```typescript
// Source: synthesised from server/hooks/queue.ts:39-68 + server/queue/plugin.ts:121-186
// Register once at factory.registerSchedulesAndWorkers() time.

import { QUEUE_NAMES } from '../queue/names.js';
import { runCompressionTask } from './compression-task.js';

const QUEUE = QUEUE_NAMES.LIFECYCLE_COMPRESS_DAILY;  // 'lifecycle.compress.daily'

// 1. Create queue with overlap-preventing policy
await fastify.boss.createQueue(QUEUE, {
  policy: 'stately',
  retryLimit: 1,
  retryBackoff: true,
  retryDelay: 30,
} as never);

// 2. Register the schedule (idempotent — safe every boot)
await fastify.queue.schedule(
  QUEUE,
  '0 3 * * *',
  {} as never,
  { singletonKey: QUEUE },
);

// 3. Register the worker — ALS already restored inside the handler
const workerId = await fastify.queue.work<unknown>(QUEUE, async (_payload, jobId) => {
  const log = logger.child({ queue: QUEUE, jobId });
  const started = Date.now();
  try {
    const result = await runCompressionTask(db, config, log);
    const durationMs = Date.now() - started;
    stats.lastCompressionRun = { timestamp: new Date().toISOString(), result };
    emit.compressionCompleted('lifecycle', { ...result, durationMs });
  } catch (err) {
    const durationMs = Date.now() - started;
    emit.taskFailed('lifecycle', { task: 'compression', error: String(err), durationMs });
    throw err;   // re-raise for pg-boss retry accounting
  }
});

// Store workerId in factory closure for shutdown's boss.offWork(workerId) call.
```

### Example 2: Integration test proving correlationId flows scheduler → worker

```typescript
// Source: synthesised from server/queue/__tests__/als-crossqueue.spec.ts + server/hooks/__tests__/queue.spec.ts
// Goal: schedule fires → worker runs → captured correlationId is a non-empty UUID.

import Fastify from 'fastify';
import postgres from 'postgres';
import { correlationPlugin } from '../../correlation/index.js';
import queuePlugin from '../../queue/plugin.js';
import { requestContext } from '@fastify/request-context';

const SCHEMA = 'pgboss_lifecycle_sched_spec';
const SCHEDULE = 'lifecycle.test.every-second';

describe.skipIf(!process.env.TEST_DATABASE_URL)('lifecycle schedule → worker correlationId round-trip', () => {
  let app: FastifyInstance;
  const captured: Array<string | null | undefined> = [];

  beforeAll(async () => {
    const sql = postgres(process.env.TEST_DATABASE_URL!);
    await sql.unsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await sql.end();

    app = Fastify({ logger: false });
    await app.register(makeStubConfigPlugin(process.env.TEST_DATABASE_URL!));
    await app.register(stubDbPlugin);
    await app.register(correlationPlugin);
    await app.register(queuePlugin, { schema: SCHEMA });

    await app.boss.createQueue(SCHEDULE, { policy: 'stately', retryLimit: 1 } as never);
    await app.queue.schedule(SCHEDULE, '* * * * * *', {} as never, { singletonKey: SCHEDULE });
    await app.queue.work(SCHEDULE, async () => {
      captured.push(requestContext.get('correlationId') as string | null | undefined);
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    const sql = postgres(process.env.TEST_DATABASE_URL!);
    await sql.unsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await sql.end();
  });

  it('worker observes a non-empty correlationId on schedule-triggered fire', async () => {
    // pg-boss cronWorkerIntervalSeconds default 5s; wait up to 15s for first fire
    await vi.waitFor(() => expect(captured.length).toBeGreaterThan(0), { timeout: 15_000 });
    expect(captured[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}/);    // looks like UUID
  });
});
```

Note: this spec runs a cron `* * * * * *` (every second) for practicality. Production schedules are daily/hourly — those are validated via `boss.getSchedules()` existence check, not fire-observation.

### Example 3: Factory shutdown idempotency

```typescript
// Source: server/hooks/internal/module.ts:126-147 (direct copy)
let workerIds: string[] = [];
let stopped = false;

return {
  // ...
  shutdown: async () => {
    if (stopped) return;     // idempotent
    stopped = true;
    for (const id of workerIds) {
      try {
        await deps.fastify.boss.offWork(id);
      } catch (err) {
        logger.warn({ err, workerId: id }, 'offWork failed during lifecycle shutdown');
      }
    }
    workerIds = [];
    logger.info('Lifecycle module shutdown complete');
  },
};
```

### Example 4: MODULE.md skeleton

```markdown
# Lifecycle Module

## Purpose
Run durable housekeeping tasks on pg-boss schedules: video compression (daily), expired-artifact retention (daily), disk-pressure-driven cleanup (hourly). Replaces v2.0's node-cron-based scheduling.

## Public API
From `server/lifecycle/index.ts`:
- `lifecyclePlugin` — Fastify plugin.
- `createLifecycleModule(deps): LifecycleModule` — factory.
- `LifecycleStats` type — stats decorator shape.
- `lifecycleRegistry`, `makeLifecycleEmitters`, `LIFECYCLE_EVENT_NAMES` — events surface.
- `LIFECYCLE_COMPRESS_DAILY`, `LIFECYCLE_RETENTION_DAILY`, `LIFECYCLE_DISK_HOURLY` — queue name constants.

## Events Emitted
- `lifecycle.compression.completed` (persisted)
- `lifecycle.retention.completed` (persisted)
- `lifecycle.disk.checked` (persisted)
- `lifecycle.task.failed` (persisted)
All aggregate `'lifecycle'`.

## Events Consumed
None. Lifecycle is a scheduled producer.

## Queue Produced
- `lifecycle.compress.daily` — cron `0 3 * * *`, `singletonKey: 'lifecycle.compress.daily'`, `policy: 'stately'`, `retryLimit: 1`
- `lifecycle.retention.daily` — cron `0 3 * * *`, same policy, runs AFTER compression (separate schedule; can run concurrently — no dependency)
- `lifecycle.disk.hourly` — cron `0 * * * *`, same policy

## Queue Consumed
Same three queues (self-loop: producer + consumer in same module).

## Invariants
- (a) No two fires of the SAME schedule run concurrently (policy 'stately' + singletonKey).
- (b) A failed task does NOT crash the plugin; the error is logged + emitted as `lifecycle.task.failed` + re-thrown for pg-boss retry accounting.
- (c) `fastify.lifecycleStats` is updated AFTER each successful run (back-compat for /health endpoint).
- (d) Graceful shutdown via `boss.stop({graceful: true, timeout: 30_000})` drains in-flight task within budget.

## Non-Goals
- Event-driven housekeeping (e.g., cleanup-on-job-completed) — future phase.
- DLQ surface for retry-exhausted lifecycle jobs — Phase 19.
- Removing `node-cron` from package.json — Phase 25 (pipelines still uses it).

## Dependencies
- `config` — reads `fastify.config.storage` for retention_days / compress_after_days / max_storage_gb.
- `db` — reads `fastify.db` for artifact queries.
- `queue` — uses `fastify.queue.schedule` / `.work` / `fastify.boss.createQueue`.
- `event-bus` — emits persisted telemetry events (optional; skip if option A chosen).
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `node-cron` in-process scheduling | `pg-boss.schedule()` durable Postgres-backed cron | This phase | Schedules survive restarts; traces carry correlationId; overlap prevention at queue boundary. |
| `new Mutex()` wrapping daily task | `policy: 'stately'` + `singletonKey` | This phase | Queue-layer overlap guard; survives restart. |
| Scheduled jobs opaque to correlation tracing | Every fire gets a fresh correlationId stamped at `queue.work` | This phase (Option B) | Per-fire log grouping; future trace-tree endpoint (Phase 27) includes lifecycle activity. |
| `LifecycleStats` ad-hoc decorator | Typed emitted events + `LifecycleStats` decorator (both) | This phase | Back-compat for `/health`; new observability via events table. |
| Flat module (plugin at root doing scheduling + task calls) | Factory (MOD-06) + barrel + events.ts + queue.ts | This phase | LLM-first structure matching Phase 16 pilot. |

**Deprecated / outdated (referenced in old docs / tests only):**
- `cron.ScheduledTask` type — superseded by pg-boss worker id (string).
- `cron.validate(expr)` — superseded by pg-boss's internal `CronExpressionParser.parse` (throws at schedule time).

---

## Open Questions

1. **Three separate schedules vs one daily rollup schedule that runs both compression + retention serially?**
   - What we know: ROADMAP §SC1 names three schedules. Today's plugin uses ONE closure for daily that does both sequentially inside a mutex.
   - What's unclear: if compression takes > 1 hour (100 videos × 2 min each ≈ 3 hours), do we want retention to WAIT (today's behaviour) or run concurrently?
   - Recommendation: **three schedules, allow concurrency** — deletion of expired artifacts is orthogonal to compression of recent artifacts; there's no overlap in the artifact set they touch. If operational concerns arise, daily schedules can be staggered (`0 3` vs `30 3`). Document this as a deliberate behaviour change.

2. **Queue name format: `lifecycle-compress-daily` (hyphen, roadmap prose) vs `lifecycle.compress.daily` (dot, codebase convention)?**
   - What we know: both pass pg-boss regex. Phase 16 used dots (`hook.run`).
   - What's unclear: whether ROADMAP's hyphen is prescriptive or prose.
   - Recommendation: **use dots for codebase consistency**. Flag in plan Context section; rename requires a one-line change to `QUEUE_NAMES`.

3. **Option A (worker overwrites) vs Option B (schedule stores null → worker generates) for per-fire correlationId?**
   - What we know: current `queue.schedule` stamps one id at registration — wrong.
   - What's unclear: whether Phase 15 substrate owners (same agent) would prefer a substrate-level fix (Option B) or an opt-in module-local fix (Option A).
   - Recommendation: **Option B** — modify `server/queue/plugin.ts:173-186` to pass `correlationId: null` into the envelope; `queue.work` already falls back to `randomUUID()`. One-line change, cleaner semantics. Phase 18 explicitly claims "establish the wrapper" so it owns the final shape.

4. **Emit `lifecycle.*` bus events (Option B in §Events Design) or ship empty registry (Option A)?**
   - What we know: MOD-03 says every module has `events.ts`. Lifecycle's role doesn't strictly require events.
   - What's unclear: coverage delta impact + whether `api/routes.ts` `/health` consumers want event-sourced stats in the future.
   - Recommendation: **Option B (four events)** — minimal incremental work, adds real observability, offsets coverage loss from mutex+cron removal.

5. **Rename `.test.ts` → `.spec.ts` in existing lifecycle tests for MOD-04 consistency?**
   - What we know: Phase 16 uses `.spec.ts` convention. Phase 16 Plan 16-04 VALIDATION confirmed MOD-04 (tests-as-spec file-naming) is deferred to Phase 30.
   - What's unclear: whether Phase 18 should pre-empt that Phase 30 migration here.
   - Recommendation: **rename in this phase** — cheap (three files), matches pilot, reduces Phase 30 scope. Optional; planner may defer.

6. **`logContext.run()` naming alignment with ROADMAP wording?**
   - What we know: codebase primitive is `asyncLocalStorage.run()`. `logContext` as a named surface doesn't exist.
   - What's unclear: whether to add a re-export alias.
   - Recommendation: **do NOT add alias** — the current `asyncLocalStorage.run` naming is consistent across Phase 15 substrate and Phase 16 pilot. The roadmap wording is aspirational prose. Note the naming divergence in MODULE.md prose. (Alternative: spend 5 lines in `server/correlation/index.ts` adding a `logContext` re-export; low value, low cost.)

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.x (from `package.json`) |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run server/lifecycle/` |
| Full suite command | `npm test && npm run lint && npm run dep-check && npm run contracts:check` |

Additional gates that Phase 16+ established:
- `npm run nyquist:capture && npm run nyquist:check` — coverage delta ≤ −2pp vs `.planning/nyquist-baseline.json`.
- `npm run dep-check` — dependency-cruiser forbids deep imports into `server/lifecycle/internal/*` from other modules.

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| QUEUE-08 (lifecycle half) SC1 | `node-cron` no longer imported by `server/lifecycle/*` | structural grep | `grep -rn "node-cron" server/lifecycle/ && exit 1 \|\| exit 0` | Wave 0 (verification script) |
| QUEUE-08 SC1 | three named schedules registered with `singletonKey` | DB-gated integration | `npx vitest run server/lifecycle/__tests__/queue.spec.ts` — assert `boss.getSchedules()` returns the three names | ❌ — new file (Wave 1) |
| QUEUE-08 SC1 | `singletonKey` prevents overlap | DB-gated integration | (part of queue.spec.ts) assert `policy: 'stately'` in `boss.getQueues` output | ❌ — Wave 1 |
| QUEUE-08 SC2 | `enqueue` wrapper injects correlationId | unit | `npx vitest run server/queue/__tests__/plugin.spec.ts` (existing) — no new assertion needed; wrapper already tested | ✅ existing |
| QUEUE-08 SC2 | consumer restores ALS | unit + integration | existing `server/queue/__tests__/als.spec.ts` + `als-crossqueue.spec.ts` | ✅ existing |
| QUEUE-08 SC2 | integration test proves schedule-triggered work carries correlationId to worker logs | DB-gated integration | `npx vitest run server/lifecycle/__tests__/queue.spec.ts` — `captured correlationId` test from §Code Examples Example 2 | ❌ — Wave 1 |
| SC3 (Phase 16 conventions) MOD-01 | MODULE.md has 9 H2 sections | structural grep | `node -e "…grep ^## in MODULE.md …"` (mirror 16-04 task 4.1) | ❌ — Wave 3 |
| SC3 MOD-02 | barrel `index.ts` exists; deep imports into `internal/` forbidden | structural grep + dep-check | `npm run dep-check` | ⚠️ config adds denylist rule |
| SC3 MOD-03 | `events.ts` with Zod schemas + emit helpers | unit | `npx vitest run server/lifecycle/__tests__/events.spec.ts` — mirror `hooks/__tests__/events.spec.ts` | ❌ — Wave 2 |
| SC3 MOD-06 | `createLifecycleModule` factory + shutdown idempotency | unit (no DB) | `npx vitest run server/lifecycle/__tests__/module.spec.ts` — mirror `hooks/__tests__/module.spec.ts` | ❌ — Wave 2 |
| SC3 QUEUE-06 | `queue.ts` with worker registration + payload schemas | DB-gated integration | same queue.spec.ts as above | ❌ — Wave 1 |
| SC3 Nyquist | coverage delta ≤ −2pp | capture/check script | `npm run nyquist:capture && npm run nyquist:check` | ✅ scripts exist |
| SC4 | graceful shutdown drains in-flight schedule jobs | DB-gated integration | `npx vitest run server/lifecycle/__tests__/shutdown.spec.ts` — enqueue a long-running task, `app.close()`, assert no uncaught errors + `captured` count unchanged post-close | ❌ — Wave 1 or Wave 3 (optional; `server/queue/__tests__/shutdown.spec.ts` already proves at substrate level) |
| SC4 | `node-cron` import removed from lifecycle | structural grep | see SC1 row | — |

### Sampling Rate

- **Per task commit:** `npx vitest run server/lifecycle/` (quick, <10s when new specs added)
- **Per wave merge:** `npm test && npm run lint && npm run dep-check`
- **Phase gate:** full suite green + `npm run nyquist:check` green + `/gsd:verify-work` runs final audit

### Wave 0 Gaps

Things that must exist BEFORE implementation specs can run meaningfully:

- [ ] `server/lifecycle/events.ts` — declared registry + emit helpers (Wave 2 produces; can't be Wave 0 because depends on TypedBus import structure)
- [ ] `server/lifecycle/queue.ts` — payload schemas + queue name constants (Wave 1-2)
- [ ] `QUEUE_NAMES` extension in `server/queue/names.ts` — add `LIFECYCLE_COMPRESS_DAILY`, `LIFECYCLE_RETENTION_DAILY`, `LIFECYCLE_DISK_HOURLY` (Wave 0 — single-line change, unblocks all downstream specs importing queue name constants)
- [ ] `.dependency-cruiser.cjs` — extend denylist rule to include `server/lifecycle/internal/*` as a new forbidden deep-import target (Wave 0 or Wave 3; Phase 16's rule targets `server/hooks/internal/*` specifically — needs broadening or parallel rule)
- [ ] ADR — NONE required for this phase (ADR-001 Pillar 3 already covers; ADR-002 already covers file naming)

**All three Vitest + Postgres infrastructure prerequisites are already in place:** vitest.config.ts, Drizzle migrations, `TEST_DATABASE_URL`-gated spec skipIf pattern, pg-boss schema isolation (`pgboss_${SCHEMA}`) — copy verbatim from `server/hooks/__tests__/queue.spec.ts` and `server/queue/__tests__/als-crossqueue.spec.ts`.

---

## Sources

### Primary (HIGH confidence)

- **Installed pg-boss v12.15.0 source of truth:**
  - `node_modules/pg-boss/dist/index.d.ts:66-70` — `schedule`/`unschedule`/`getSchedules` signatures
  - `node_modules/pg-boss/dist/types.d.ts:143-167, 173-188, 235-238, 406-410` — `JobOptions`, queue policies, `ScheduleOptions`, `StopOptions`
  - `node_modules/pg-boss/dist/timekeeper.d.ts` + `dist/timekeeper.js:136-185` — scheduled dispatch + `schedule()`/`unschedule()` runtime
  - `node_modules/pg-boss/dist/attorney.js:243-246` — default cron monitor/worker intervals
  - `node_modules/pg-boss/dist/index.js:80-131` — `start`/`stop` flow including `graceful` + `timeout` semantics
  - `node_modules/pg-boss/dist/plans.js:467-485` — `job_i3` unique index enforcing `singletonKey` on state ≤ active (Phase 16 verified)

- **Phase 15 substrate (committed, in tree):**
  - `server/queue/plugin.ts:121-202` — `fastify.queue.send` / `.work` / `.schedule` — the enqueue wrapper that QUEUE-08 asks for
  - `server/correlation/plugin.ts` — ALS foundation (TRACE-01/02)
  - `server/bus/helpers.ts:65-77` — shape-agnostic ALS reader pattern (mirror in lifecycle)
  - `server/queue/__tests__/als-crossqueue.spec.ts` — reference pattern for schedule → worker correlationId integration test

- **Phase 16 pilot (committed, in tree — canonical template):**
  - `server/hooks/MODULE.md` — 9-section MODULE template
  - `server/hooks/events.ts` — events.ts skeleton
  - `server/hooks/queue.ts` — queue contract skeleton
  - `server/hooks/index.ts` — barrel skeleton
  - `server/hooks/plugin.ts` — thin-wrapper plugin skeleton
  - `server/hooks/internal/module.ts` — factory pattern (MOD-06), persistEnvelope duplicated from bus plugin
  - `server/hooks/__tests__/queue.spec.ts` — DB-gated integration spec pattern
  - `server/hooks/__tests__/module.spec.ts` — factory unit spec pattern
  - `server/hooks/__tests__/events.spec.ts` — events spec pattern

- **Planning substrate:**
  - `.planning/REQUIREMENTS.md` — QUEUE-08 definition
  - `.planning/ROADMAP.md §Phase 18` — four success criteria
  - `.planning/STATE.md` — Phase 15 Plan 15-05 ALS shape lessons, Phase 16 singletonKey/policy lessons
  - `.planning/nyquist-baseline.json` — coverage gate reference (48.29% lines)

### Secondary (MEDIUM confidence)

- WebSearch 2026 — pg-boss v10+ graceful-stop default behaviour (waits 30s by default); confirmed against installed runtime
- `.planning/research/ARCHITECTURE.md` + `STACK.md` + `SUMMARY.md` — v3.0 architectural blueprints (pre-implementation) that align with installed implementation

### Tertiary (LOW confidence)

- None — all claims verified against installed source or Phase 15/16 committed precedent.

---

## Metadata

**Confidence breakdown:**
- Standard stack: **HIGH** — all libraries already installed + used in Phase 15/16
- Architecture: **HIGH** — factory/barrel/events/queue pattern locked by Phase 16 pilot
- pg-boss schedule API: **HIGH** — verified against installed type definitions + runtime source
- Enqueue wrapper: **HIGH** — wrapper exists and is already used in Phase 16
- Per-fire correlationId: **MEDIUM** — Option B recommended but touches Phase 15 substrate; plan may prefer Option A (module-local) to stay within Phase 18 scope
- Pitfalls: **HIGH** — all drawn from committed STATE.md lessons + installed source inspection
- Coverage delta forecast: **MEDIUM** — depends on whether Option A or B for events adopted

**Research date:** 2026-04-20
**Valid until:** 2026-05-20 (30 days — pg-boss v12 and Phase 15/16 substrate are stable)
