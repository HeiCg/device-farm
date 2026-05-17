# Pitfalls Research — v3.0 Spec-Driven Architecture Refactor

**Domain:** Refactoring an existing working system (Fastify server + Go CLI + SvelteKit web) to add Zod-everywhere, typed event bus, pg-boss, correlation IDs, module conventions — without breaking users, live jobs, or regressing coverage.
**Researched:** 2026-04-16 (supersedes v1.0)
**Confidence:** HIGH on integration/refactor pitfalls (direct experience in the codebase), MEDIUM on pg-boss v10→v12 migration specifics and `drizzle-zod` JSONB round-tripping (need Phase 1 spike to confirm).

**Severity legend:** BLOCKER = will corrupt data / break prod / force rollback. MAJOR = significant rework, silent regressions, months-later cost. MINOR = friction, lint noise, localized bad taste.

**Scope note:** Pitfalls here are specific to ADDING these patterns to THIS existing codebase. Generic "use linters" advice is omitted.

---

## Critical Pitfalls (BLOCKER)

### Pitfall 1: Big-bang refactor drift — mixing pilot-module polish with a global rewrite

**Severity:** BLOCKER
**What goes wrong:** The team starts the pilot module (say `jobs/`), then while there edits the event bus, tweaks the logger, changes the API plugin, rewrites the barrel rules, touches the CLI — because everything is "kind of related." Phase 1 triples in scope, ships half-broken, and no pattern is actually validated. Subsequent phases have no reference implementation to copy.
**Why it happens:** Refactors feel like "while I'm in here I might as well…" The pillars are interdependent (Zod feeds events feeds bus feeds tests), so scope naturally bleeds.
**How to avoid:**
- Phase 1 = pilot module ONLY. Success criterion: one module fully on new pattern, everything else untouched. `MODULE.md` + `events.ts` + barrel + dependency-cruiser rule scoped to that module only.
- Every subsequent phase has a single `server/<module>/` it touches plus the bus wiring in `plugin.ts`. Changes outside that folder = out of scope, filed as separate phases.
- Use dependency-cruiser's "allowed import surface" rules to physically prevent drift into other modules.
**Warning signs:** Phase 1 PR touches >3 top-level folders. "While I'm here" in commit messages. Module's `MODULE.md` references events from unrefactored modules.
**Phase to address:** Phase 1 scope gate. Every phase thereafter as success criterion.

---

### Pitfall 2: Wrong pilot module — too critical or too trivial

**Severity:** BLOCKER
**What goes wrong:** Picking `pool/` (too critical — device lifecycle, blocks users if wrong) or `reporting/` (too trivial — doesn't exercise event bus, queue, or JSONB) means the pilot either (a) risks the system or (b) doesn't validate the pattern. Phase 2 inherits a half-proven pattern.
**Why it happens:** "Start with the biggest one" or "start with the safest one" — both wrong.
**How to avoid:** Pilot must be: (a) non-critical (can be rolled back without user impact), (b) exercises all pillars (emits events, consumes events, uses pg-boss, has DB rows with JSONB, has API + WS surface), (c) already has decent test coverage to keep as regression net.
  - **Candidate: `artifacts/`** — recording + thumbnail lifecycle, has clear producers/consumers, emits events naturally (`artifact.ready`), uses queue for cleanup, medium blast radius.
  - **Avoid as pilot:** `pool/` (too risky), `reporting/` (too shallow), `auth/` (security-sensitive), `config/` (boot-path critical).
**Warning signs:** Pilot has no natural events to emit, or pilot's failure would take down job execution.
**Phase to address:** Phase 1 (pilot selection). Document why this module was chosen in its `MODULE.md`.

---

### Pitfall 3: Live in-memory queue drained incorrectly on deploy — jobs lost

**Severity:** BLOCKER
**What goes wrong:** Current `server/jobs/job-queue.ts` holds enqueued jobs in memory. When we cut over to pg-boss, an in-flight deploy has N jobs in the old queue that vanish on restart. QAs see "job accepted" and no output ever.
**Why it happens:** Drop-in replacement mindset ignores the migration window.
**How to avoid:**
- Dual-write window: the phase that introduces pg-boss keeps the in-memory queue as a **read path only** — stop enqueueing to it, enqueue only to pg-boss. Let existing in-memory items drain naturally before cutting reads.
- OR: pre-deploy drain script that refuses new submissions, waits for in-memory queue empty, then deploys.
- Explicit maintenance-mode endpoint (`/admin/drain`) that flips submissions to 503 during cutover.
- Document the cutover procedure in the phase plan. This is a runbook item, not just code.
**Warning signs:** Deploy happens mid-business-hours with no drain step. Queue depth metric absent.
**Phase to address:** Phase that introduces pg-boss (the queue migration phase). Success criterion: documented + rehearsed drain procedure.

---

### Pitfall 4: pg-boss retry doubles real-world side effects (emulator boot, APK install, ffmpeg record)

**Severity:** BLOCKER
**What goes wrong:** pg-boss retries a failed handler. Handler already booted an emulator + started recording before crashing. Retry boots a second emulator, starts a second recording, installs the APK twice, potentially allocates the device to two attempts simultaneously. Port conflicts, disk fills with duplicate MP4s, mutex deadlocks.
**Why it happens:** Devs treat pg-boss handlers like pure functions. They aren't — they own physical-world side effects on a Mac Mini.
**How to avoid:**
- **Idempotency key on every side-effectful step.** Use `jobId` as the key; each step checks DB state before acting (`if job.status === 'running' && job.deviceId: skip boot; reuse`).
- **Singleton option on pg-boss queues** (`singletonKey: jobId`, `singletonSeconds: <job-max-duration>`) prevents concurrent workers picking up the same logical job.
- **Step journal** in the `events` table: handler emits `job.boot_requested` → `job.booted` → `job.apk_installed` → `job.maestro_started`. On retry, handler reads journal and resumes from last completed step instead of restarting.
- Set `retryLimit: 1` or `0` on handlers where retry is worse than failure (device allocation). Use retry only for network-bound, idempotent steps (webhook post, cleanup).
- **Never retry ffmpeg recording start** — just mark job failed.
**Warning signs:** Two emulator processes for the same jobId in `ps`. Two rows in `allocations` for the same jobId. Duplicate MP4 files. Test passes but runs twice.
**Phase to address:** pg-boss adoption phase AND any phase where a handler spawns a process. Checklist item in every queue-using phase plan.

---

### Pitfall 5: Two Postgres drivers exhaust connection pool

**Severity:** BLOCKER
**What goes wrong:** `postgres` (porsager) drives Drizzle with, say, pool size 10. `pg` drives pg-boss with its own default pool (default 10). On a small Postgres (say 50 max_connections on a Mac Mini local dev setup), the server eats 20 connections; if the dev also has `psql` open or runs `drizzle-kit push` during a test run, we hit `too many clients already` and the server freezes on DB calls.
**Why it happens:** Nobody sizes the combined pools against `max_connections`. Invisible in dev until pg-boss scales up workers.
**How to avoid:**
- Explicit pool sizing: Drizzle `max: 8`, pg-boss `max: 4` on a single-node Mac Mini target. Total 12, well under a default Postgres `max_connections: 100`.
- Config-driven pool sizes exposed in `config.yaml` so ops can tune per-host.
- Health check on boot: `SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()` and warn if combined app usage >50% of `max_connections`.
- Document the two-pool reality in `MODULE.md` for the queue module.
**Warning signs:** `could not acquire connection` errors under load. `pg_stat_activity` shows idle connections from both driver user-agents. `drizzle-kit push` blocks.
**Phase to address:** pg-boss adoption phase. Success criterion: pool limits configured, documented, observable.

---

### Pitfall 6: AsyncLocalStorage context lost across pg-boss handler boundary

**Severity:** BLOCKER
**What goes wrong:** Producer inside a request creates a job with `boss.send('run', { jobId })`. Handler runs in a different async chain (pg-boss polling worker). `logContext.getStore()` returns `undefined` in the handler — every log loses `correlationId`, the `events` table loses the trace, debugging a production issue becomes impossible.
**Why it happens:** AsyncLocalStorage propagates through awaits in the SAME root async context. pg-boss workers are launched from a polling loop — they share process, not context.
**How to avoid:**
- **Always pass correlation IDs in the job payload** (`boss.send('run', { jobId, correlationId })`).
- Thin wrapper `wrapHandler(handler)` that pulls `correlationId` off the payload and calls `logContext.run({ log, correlationId }, () => handler(data))` before invoking the real handler.
- Enforce via lint/convention: every job schema has `correlationId: z.uuid()` required.
- Additionally test: emit a log inside a handler, assert the logged record has `correlationId` set.
**Also applies to:** `setTimeout` / `setImmediate` callbacks started outside the current async chain, EventEmitter listeners registered once then fired later (ALS may or may not propagate depending on emit site).
**Warning signs:** Grep logs for `"correlationId":""` or missing-field. `events` table rows with NULL correlation_id. Debug sessions where you can't tie a webhook log line back to its originating job.
**Phase to address:** Correlation ID / events table phase. Enforcement: test in every pg-boss handler adopted thereafter.

---

### Pitfall 7: Losing test coverage during module refactor (tests tightly coupled to old structure, deleted not ported)

**Severity:** BLOCKER
**What goes wrong:** Existing tests mock `fastify.jobService` directly or stub internals of `job-queue.ts`. When we move to event bus + pg-boss, old tests become impossible to run. Devs delete them promising to "rewrite against new surface" — but under phase pressure, ~30% of coverage is lost permanently and a regression ships in a later phase that old tests would have caught.
**Why it happens:** Tests coupled to implementation, not contract. Refactor breaks mocks. Fastest path is delete.
**How to avoid:**
- **Porting rule:** old test file must be rewritten or explicitly justified-for-deletion in the PR description. No `git rm test.ts` without replacement line count within 20%.
- **Coverage baseline gate:** CI records baseline coverage on `main` at milestone start. Each phase PR must not drop that baseline by more than 2 percentage points, and aggregate drop across milestone ≤5%.
- **Tests-as-spec pattern per module:** the new `__tests__/<module>.spec.ts` describes public contract from `MODULE.md` — if MODULE.md claims "emits `job.started` after device allocation," a spec asserts it. This replaces internal implementation tests, not just deletes them.
- Track ported tests in a simple matrix in the phase plan (old test → new test or explicit drop reason).
**Warning signs:** PR diff shows -500/+100 in tests. Coverage report drops mid-milestone. "I'll write tests in a follow-up" comments.
**Phase to address:** Every module-refactor phase. Success criterion: coverage delta ≤ -2pp, tests-as-spec describes MODULE.md contract.

---

### Pitfall 8: Module boundaries chosen wrong — too granular or too coarse

**Severity:** BLOCKER
**What goes wrong:** Too granular (`jobs-service/`, `jobs-api/`, `jobs-events/`, `jobs-types/`) → every feature touches 4 modules, barrel files are 90% re-exports, MODULE.md is useless boilerplate. Too coarse (`core/` holding jobs + devices + auth + config) → dependency-cruiser has nothing to enforce, events bus is a "god bus," we just renamed files.
**Why it happens:** Premature over-modularization vs lazy under-modularization. No explicit criterion for where a module boundary lives.
**How to avoid:**
- **Boundary rule:** a module = something that has its own events (emits and/or consumes distinctly), its own DB tables or well-defined JSONB shape, its own plugin in Fastify's registration order, and can be understood by an LLM reading only its folder + immediate event-bus subscribers.
- Target: 8–12 modules total in the server. Current plugin list (config, deps, pool, db, auth, websocket, artifacts, reporting, jobs, lifecycle, api) is roughly right; add queue, events (append-only table module), and pipelines.
- Validate each module against the rule in `MODULE.md` "why this module exists" section. If the answer is "organizational" not "behavioral," merge it.
- Dependency-cruiser rule: cross-module imports only via `index.ts` barrel. If a module needs deep imports from another, the boundary is wrong.
**Warning signs:** Barrels with >30 re-exports. Modules whose `MODULE.md` says "utilities used everywhere." Two modules that always change together in git history.
**Phase to address:** Phase 1 (module topology decision + pilot). Revisit at milestone midpoint: are we adding modules that should be submodules?

---

### Pitfall 9: Mixing old + new patterns for too long — half-refactored modules worse than either

**Severity:** BLOCKER
**What goes wrong:** Module half-migrated: has a new `events.ts` but internals still call Fastify decorators directly; has a barrel `index.ts` but old call sites still reach in deep. A reader can't tell which layer is the contract. Bugs land at the seam. Second refactor later is harder than the first.
**Why it happens:** Phase schedule pressure; "good enough" cutoff.
**How to avoid:**
- **A module is in exactly one of {unrefactored, refactored}.** No in-between branches in `main`.
- Feature flag at **module** level, not at API level. Either the whole module uses new bus+queue+barrel or it doesn't.
- Migration branch lives short — under one phase. If a module can't be finished in one phase, split the module (pitfall 8) and do half now, half later, each complete.
- Track migration state in a top-level `.planning/migration-status.md` so every contributor knows what's done.
**Warning signs:** A module with both `events.ts` AND direct `fastify.emit` calls. Barrel exports plus `import from '../jobs/internal/...'` elsewhere. PRs titled "partial migration of X."
**Phase to address:** Every phase. Success criterion: migrated modules are fully migrated; no hybrid state in `main`.

---

## Major Pitfalls (MAJOR)

### Pitfall 10: Zod parse in hot paths — event bus emit at 100+ events/s

**Severity:** MAJOR
**What goes wrong:** Every `bus.emit('log', payload)` calls `LogPayload.parse(payload)`. During an active Maestro run we emit 50–200 log lines/sec + frame-ready events from device-stream. Zod parse cost (~10–50μs per object with nested schemas) adds 1–10ms/sec of CPU per job. Multi-job, this chews event-loop budget and degrades WS latency visibly.
**Why it happens:** "Validate everywhere" interpreted as runtime-parse everywhere.
**How to avoid:**
- **Policy: parse at trust boundaries only.** A "boundary" = incoming HTTP body, incoming WS frame, DB row decoded into a domain object, job payload pulled from pg-boss. Bus emissions within a module that produced the value itself do not re-parse.
- For bus events crossing modules, use TypeScript types (compile-time only). Optional runtime check `NODE_ENV !== 'production'` via a debug wrapper.
- Use `schema.safeParse` only where a failure is expected; `parse` inside internal code is a contract assertion we're trying to avoid paying for.
- Benchmark before/after: a harness that emits 10k events and measures p99 emit latency. Gate in CI with a regression threshold.
**Warning signs:** `bus.emit` appears in a CPU profile. Frame-ready events visibly lag. `event_loop_lag` rising mid-job.
**Phase to address:** Event bus introduction phase. Perf budget written into `MODULE.md` of the shared bus.

---

### Pitfall 11: Response schema validation skipped — server emits malformed JSON silently

**Severity:** MAJOR
**What goes wrong:** Devs add `body` and `querystring` Zod schemas to Fastify routes, forget the `response` schema. Server can now return fields with wrong types (e.g., `deviceId` when spec says `deviceName`) — exactly the v2.0 tech debt bug. `openapi-fetch` trusts the spec; Go CLI generated structs fail to unmarshal. Integration tests only check status code.
**Why it happens:** Fastify response schemas were historically serialization optimizations; devs treat them as optional. Most tutorials only show request validation.
**How to avoid:**
- **Response schema required** by lint rule / convention review. Route registration helper that refuses routes without a 200-response schema: `createRoute({ schema: { body, response: { 200: Foo, 4xx: ErrorProblem } }, handler })`.
- CI step: diff generated OpenAPI spec between commits. If a route's response schema disappears, fail.
- Write contract tests against the OpenAPI spec: `openapi-examples-validator` or `dredd` or hand-rolled that exercise each endpoint and validate response against schema.
- For the CLI: `go-jsonschema`-generated Unmarshal reports "unknown field" and "wrong type" in tests. Run CLI integration tests against real server in CI.
**Warning signs:** A route without response schema in review. The v2.0 `deviceName`/`deviceId` bug happening again. Go CLI silently has `""` fields that should be populated.
**Phase to address:** Zod-at-boundaries phase. Every API-touching phase re-checks.

---

### Pitfall 12: `drizzle-zod` + JSONB columns — loose typing round-trip

**Severity:** MAJOR
**What goes wrong:** `jobs.metadata` (JSONB, generic CI-agnostic shape) gets typed as `z.unknown()` or `z.any()` by `drizzle-zod`'s `createSelectSchema`. Server passes it around as `any`; consumers that need specific fields (reporting dashboards, webhooks) still cast. The refactor adds no safety on the most complex data.
**Why it happens:** `drizzle-zod` can't infer structure of untyped JSONB columns — correct behavior, just unhelpful for our case.
**How to avoid:**
- Define `JobMetadataSchema` (Zod) explicitly for known-shape fields (e.g., `provider`, `branch`, `commit`, `triggeredBy`) plus `.passthrough()` for CI-specific extras.
- Override in Drizzle schema derivation: `createSelectSchema(jobs, { metadata: JobMetadataSchema })`.
- For truly unknown shapes (e.g., user-provided webhook payload metadata), keep `z.record(z.string(), z.unknown())` but document it as "opaque by design" in `MODULE.md`.
- Round-trip test: write, read, deep-equal — especially important for JSONB because Postgres silently reorders keys and normalizes numeric types (integers roundtrip as numbers, not bigints).
**Warning signs:** `metadata.someField` accessed as `any` in application code. Webhook tests pass but production payloads have fields stripped. Integration tests that round-trip metadata through DB fail on JSON key ordering.
**Phase to address:** Zod-at-boundaries phase. **Spike required in Phase 1** (STACK.md already flagged this). Document convention in a shared schema module.

---

### Pitfall 13: Listener errors swallowed — one listener throws, others don't run, emitter doesn't know

**Severity:** MAJOR
**What goes wrong:** `EventEmitter.emit` runs listeners synchronously; if one throws, remaining listeners are skipped and (for sync emits) the error propagates up to the emitter, which usually didn't plan for it. For async listeners returning rejected promises, `EventEmitter` silently ignores unless `captureRejections: true`. Result: reporting module fails → webhook module never runs → webhook never fires → user reports a mystery missing callback.
**Why it happens:** Node's `EventEmitter` is a pre-Promise API; async error handling was bolted on.
**How to avoid:**
- Typed bus wrapper (from STACK.md) wraps each listener in a try/catch at dispatch time: errors are logged with `correlationId` and continue to next listener. Emitter never sees listener failures.
- Policy: listeners must be side-effect-contained. If listener X needs "listener Y to have run," that's a queue job with explicit dependency, not a bus event.
- `captureRejections: true` on the underlying EventEmitter; an error listener logs without crashing.
- Test: "listener A throws, listener B still runs" — explicit test of the bus wrapper.
**Warning signs:** Silent missing side effects ("the webhook sometimes doesn't fire"). Unhandled promise rejection warnings in logs with no stack pointing to app code.
**Phase to address:** Event bus introduction phase. Test lives with the bus module.

---

### Pitfall 14: Sync bus blocks event loop — heavy listener work on emit path

**Severity:** MAJOR
**What goes wrong:** `job.completed` listener does synchronous file operations (compress video, generate thumbnail). emit() blocks for seconds. During that block, WebSocket pings time out, other jobs' emits queue behind it, health checks fail.
**Why it happens:** "Sync bus for fast reactions" (PROJECT.md pillar) is correct for the 99% case but devs put slow work in listeners anyway.
**How to avoid:**
- **Rule:** bus listeners do metadata work only (update counters, log, emit another event). Any I/O, CPU-bound work, or network call → enqueue a pg-boss job from the listener.
- Bus listener timeout: wrap each listener with `setImmediate`-style watchdog that logs a warning if sync work >5ms. Enforce via test + CI.
- MODULE.md for the bus documents the "listener does metadata only" rule loudly.
**Warning signs:** Event-loop lag rises during job completion. WebSocket disconnects clustered at end-of-job. Long `emit` stacks in profiles.
**Phase to address:** Event bus phase. Re-checked in every module that subscribes to events.

---

### Pitfall 15: Event ordering assumptions break subtly

**Severity:** MAJOR
**What goes wrong:** Developer assumes `job.started` listener always runs before `job.device_allocated` listener because "device allocation happens after start" — but that's producer semantics, not listener ordering. Two listeners on `job.started` run in registration order, fine. But across events, one listener may mutate state and another may read stale state, depending on registration timing (`plugin.ts` load order).
**Why it happens:** Mental model conflates "events emitted in order" with "handlers for different events run in order."
**How to avoid:**
- Bus docs state: listeners on the SAME event fire in registration order; across events, NO guarantee.
- If ordering across events matters, it's a state machine — use DB state + pg-boss, not bus listeners.
- Tests explicitly assert "after event A, state X is set" with polling, not listener order.
- Avoid "implicit choreography" patterns where modules chain reactions across events; prefer explicit queues.
**Warning signs:** Flaky tests that pass alone, fail in suite (listener registration order shifts). Bug reports that only reproduce on specific plugin registration sequences.
**Phase to address:** Event bus phase. Documented in `events.ts` pattern guide.

---

### Pitfall 16: Memory leaks from unregistered listeners in Fastify hot-reload (dev)

**Severity:** MAJOR
**What goes wrong:** `tsx watch` restarts server on file change. Each restart re-registers plugins. If the TypedBus is a module-level singleton (not a fresh instance per Fastify restart), listeners from old runs accumulate: second save → 2x listeners, tenth save → 10x, events fire N times. Dev thinks their test is passing but the bus is firing an old listener from a previous code version.
**Why it happens:** `tsx watch` reuses the Node process on some strategies. Module-level singletons survive. "I fixed this listener, why is the old one still running?" is a common confused moment.
**How to avoid:**
- TypedBus instance owned by the Fastify plugin, created in `onReady` or on register, torn down in `onClose`. Not a module-level singleton.
- `onClose` hook: `bus.removeAllListeners()` and any pg-boss worker stop.
- In dev, log `MaxListenersExceededWarning` as an error — our bus shouldn't approach 10 listeners per event.
- Test: register, emit, unregister, re-register, emit — only the new listener fires.
**Warning signs:** Dev console shows N duplicate "x.received" logs after several saves. Tests depend on `vi.restoreAllMocks()`. `process.listenerCount` grows.
**Phase to address:** Event bus phase. Dev-mode test in bus module.

---

### Pitfall 17: Circular emits — listener emits event that re-triggers itself

**Severity:** MAJOR
**What goes wrong:** `job.status_changed` listener updates DB and emits `job.status_changed` again for audit. Stack overflow or silent infinite loop.
**Why it happens:** Ergonomic "emit the same event shape downstream" without thinking about the source.
**How to avoid:**
- Naming convention distinguishes commands from events: `UpdateJobStatus` (command, imperative) triggers `JobStatusChanged` (event, past tense). Listeners on events emit different events or no events.
- Bus wrapper detects re-entrance with a small counter or AsyncLocalStorage-based "emit depth" and throws on >N nested emits.
- MODULE.md for each module lists events emitted vs consumed — catches cycles at review time.
**Warning signs:** `RangeError: Maximum call stack`. Test hangs. `events` table has same-event-for-same-entity chains.
**Phase to address:** Event bus phase. Lint or dev-mode assertion.

---

### Pitfall 18: "God bus" anti-pattern — one bus shared by all modules

**Severity:** MAJOR
**What goes wrong:** Single `bus` decorated on Fastify, every module emits and subscribes to everything. We've re-coupled every module to every other module's event names. MODULE.md "events consumed" sections grow unbounded. Dependency-cruiser can't help because imports go through `fastify.bus`, not module barrels.
**Why it happens:** Easier to `fastify.decorate('bus', bus)` once than to build per-module buses and wire cross-module subscriptions explicitly.
**How to avoid:**
- **Pattern: per-module bus + explicit cross-subscription.** Each module exposes its own `bus: TypedBus<ModuleEvents>` on its plugin. Cross-module subscriptions happen in a single `wiring.ts` at the app level — the ONLY place that imports multiple module buses.
- This makes cross-module coupling visible and auditable.
- For multi-publisher/single-subscriber fan-in (e.g., an audit module listening to many events), subscriber imports producers' event types, not vice versa.
**Warning signs:** `fastify.bus` used in >3 modules. A module consumes events from >3 other modules. MODULE.md "events consumed" list is longer than "emitted."
**Phase to address:** Event bus phase. Reviewed per module in subsequent phases.

---

### Pitfall 19: pg-boss schedule fires while previous run still executing (cron drift vs node-cron semantics)

**Severity:** MAJOR
**What goes wrong:** `node-cron` currently fires every tick regardless of whether the previous run finished. Team assumes pg-boss `schedule()` does the same. Actually, pg-boss scheduled jobs go to a queue; if worker is busy, they queue up. After a long hang, dozens of overdue scheduled runs fire back-to-back.
**Why it happens:** Cron-in-a-queue is not cron. Semantics differ from `node-cron`.
**How to avoid:**
- Use `singletonKey` + `singletonSeconds` on scheduled jobs: the scheduler re-enqueues, but the queue guarantees at most one in-flight per key. Old unfired scheduled runs are skipped, not queued.
- For jobs that MUST not overlap (pipeline runs, DB cleanup), explicit check at handler start: "is there an in-progress run for this pipeline? skip."
- Decide explicitly per-schedule: skip-if-busy vs queue-all vs run-latest-only. Document in the pipelines module MODULE.md.
**Warning signs:** After a server hang, a flood of pipeline runs fires. Or: a scheduled run never fires because of a stuck predecessor (the opposite failure).
**Phase to address:** pg-boss adoption phase + pipelines-scheduler migration phase.

---

### Pitfall 20: pg-boss schema migration on a live DB (v10 → v12)

**Severity:** MAJOR
**What goes wrong:** pg-boss auto-migrates its schema on `boss.start()`. On an existing DB with long-lived jobs in the table (we're a new adopter so less risk), schema migrations can take minutes or require a maintenance window. For a greenfield pg-boss install into our DB (no existing pg-boss schema), this is smaller but we must confirm the migration doesn't step on existing tables or require a specific Postgres version.
**Why it happens:** Silent schema writes on first start look innocuous until they aren't.
**How to avoid:**
- Spike on a dev DB first: install pg-boss, run `boss.start()`, inspect `pgboss` schema, note migration time, note Postgres version requirement (pg-boss 12 needs PG 13+).
- Production rollout: explicit migration step, not first-request-triggered. Run `boss.start()` in a one-shot migration script during deploy window.
- Schema lives in its own `pgboss` schema (Postgres namespace), low risk of collision with our public tables.
- STACK.md already flagged that no "v10→v12 migration guide" exists. Treat as MEDIUM confidence until spiked.
**Warning signs:** First prod start takes >30s. Jobs enqueued during start are lost. pg_stat shows DDL lock waits.
**Phase to address:** pg-boss adoption phase. Pre-flight spike required.

---

### Pitfall 21: Worker graceful shutdown drops in-flight jobs on SIGTERM

**Severity:** MAJOR
**What goes wrong:** Deploy sends SIGTERM. pg-boss worker is mid-Maestro-run. Process exits. Job's visibility timeout expires, pg-boss retries, new worker runs a fresh emulator boot, recording was lost, job "succeeds" but the artifact from run 1 is orphaned.
**Why it happens:** Default shutdown doesn't wait for handlers.
**How to avoid:**
- `boss.stop({ graceful: true, timeout: <max-job-duration> })` in Fastify `onClose`. Server refuses new SIGTERM-triggered shutdown until in-flight jobs finish or timeout.
- Supervisor (launchd / PM2 / systemd) grace period matches expected max job duration (our jobs can run 5–10 min — grace period must be that long).
- Alternatively, intentionally short grace + design handlers to be resumable (event journal, pitfall 4).
- Test: SIGTERM during job, assert either completion OR clean rollback + requeue.
**Warning signs:** After deploys, jobs show "running" forever or retry in bad state. Orphan MP4 files.
**Phase to address:** pg-boss adoption phase + deploy process phase.

---

### Pitfall 22: DLQ accumulates silently — jobs fail, nobody notices

**Severity:** MAJOR
**What goes wrong:** pg-boss `deadLetter: 'failed-jobs'` catches jobs exceeding retries. Queue grows. No alert. Weeks later QA reports "my jobs haven't been running" — actually half have been silently dying and the DLQ has 400 corpses.
**Why it happens:** DLQs are "dead" — nobody polls them unless wired to.
**How to avoid:**
- `/admin/dlq` API endpoint exposing count + recent items.
- Prometheus/health metric: `dlq_depth{queue="run-job"}` with an alert at >0 (for a low-volume system, any DLQ item deserves investigation).
- A "reaper" job that periodically logs DLQ depth to the `events` table, making it visible in the dashboard.
- Web UI page for DLQ inspection + manual re-queue.
**Warning signs:** DLQ has items. Nobody looked. Go look.
**Phase to address:** pg-boss adoption phase. Observability is a success criterion of that phase, not a follow-up.

---

### Pitfall 23: Events table grows unbounded — append-only without retention policy

**Severity:** MAJOR
**What goes wrong:** "Append-only business events" is the pillar. Six months in, the table is 50M rows, queries slow, backups painful. Nobody pruned because the policy was never set.
**Why it happens:** "Append-only" conflated with "keep forever."
**How to avoid:**
- Retention policy decided at schema design: e.g., "events older than 90 days move to `events_archive` table; archive older than 1 year dropped."
- Index strategy: `(correlation_id, created_at DESC)` for traces, `(event_type, created_at DESC)` for type browsing. Partition by month if volume warrants.
- Pruning job as pg-boss schedule (`0 3 * * *` daily).
- Define "business event" narrowly: state transitions, not transient logs. Pitfall 24 below.
**Warning signs:** events table row count doubling monthly. Slow dashboard. Backup size explosion.
**Phase to address:** Correlation IDs / events table phase. Retention is a design-time decision.

---

### Pitfall 24: "Business event" drift — events table fills with transient logs

**Severity:** MAJOR
**What goes wrong:** Team starts writing `bus.debug`, `log.info`-level data to the events table because "it's nice to have everything in one place." Table becomes a log dump; retention fills; important events lost in noise; append-only becomes a performance liability.
**Why it happens:** No bright line between "log" and "business event."
**How to avoid:**
- Define in `events/MODULE.md`: business event = an externally-observable state transition others reason about (job.completed, device.allocated, webhook.delivered). Internal diagnostics go to pino logs, not the table.
- Schema constraint: `event_type` must be from an enum of registered types, enforced at insert.
- Code review rule: new event_type requires MODULE.md update.
- Tests: each business event has a single producer module; a search for bus events matching "log" or "debug" in event_type fails CI.
**Warning signs:** `event_type` list >30 values. Types named `debug.*`. Devs asking "can I just write this to events?"
**Phase to address:** Correlation IDs / events table phase. Gate in MODULE.md convention.

---

### Pitfall 25: Transactional write of event + state change — partial writes

**Severity:** MAJOR
**What goes wrong:** Code updates `jobs.status = 'completed'` and writes `events` row — but in separate connections/transactions. One succeeds, other fails. DB state and event log disagree. Consumers of events see a job complete that the DB still shows running (or vice versa).
**Why it happens:** Devs think "update DB then emit event" is fine. Network partition between two ops breaks it.
**How to avoid:**
- **Single transaction:** `db.transaction(async (tx) => { await tx.update(jobs)...; await tx.insert(events)...; await boss.insert(queuedJobs, { db: tx }); })`. pg-boss supports transactional enqueue via `boss.insert([...], { db: tx })`.
- Pattern enforced in each module: "update + event" is one operation in the service layer, not two call sites.
- No business event written without a corresponding state write in the same tx.
**Warning signs:** Reconciliation reports between `events` and `jobs` find disagreement. Consumers retry because "event said done but DB said running."
**Phase to address:** Correlation IDs / events table phase. Applied in every module writing events.

---

### Pitfall 26: Over-validating internal-only data that never crosses a boundary

**Severity:** MAJOR (wastes effort, inflates schemas)
**What goes wrong:** Devs Zod-schema every intra-module function argument "for safety." Schemas proliferate. Bus events are schemas, DB rows are schemas, config is schemas, plus every helper function signature is a schema. Tests become schema-assertion ceremony. MODULE.md explodes.
**Why it happens:** Cargo-cult "Zod everywhere."
**How to avoid:**
- **Boundary = cross-trust surface.** HTTP in, WS in, DB read, queue payload, config load, events emitted to other modules. NOT every function inside a module.
- TypeScript types sufficient for intra-module contracts; Zod at the boundary that produces them.
- MODULE.md explicitly lists the module's boundaries — anything not on that list doesn't need a schema.
**Warning signs:** Schema count > function count. PRs that "add validation" inside a single service class.
**Phase to address:** Zod-at-boundaries phase. Explicit boundary list in `MODULE.md` template.

---

### Pitfall 27: Schema drift between server/web/CLI when codegen not enforced

**Severity:** MAJOR
**What goes wrong:** Server adds a field to `JobStatus`. Dev runs codegen locally for Go but forgets to commit the generated file. Web openapi-fetch types also outdated. CI passes because each side only checks itself. Next QA release fails at runtime — CLI can't unmarshal, web shows `undefined` fields.
**Why it happens:** Codegen is a developer-discipline step; humans are unreliable.
**How to avoid:**
- CI step: regenerate Go types + OpenAPI spec, `git diff` must be empty. If generated code drifts from committed, CI fails with "run `make codegen` and commit."
- One source of truth command (`make codegen` at root) runs all generation steps.
- Pre-commit hook (optional) that regenerates if Zod schemas touched.
- Version the OpenAPI spec in git (`openapi.json` in repo), not just an artifact.
**Warning signs:** A PR merges with server schema changes but no generated-code changes. CLI or web breaks at runtime on a field rename.
**Phase to address:** Contract-sync phase (Go codegen + OpenAPI pipeline). Every API-touching phase thereafter.

---

### Pitfall 28: Version skew — deployed server + older CLI in the wild

**Severity:** MAJOR
**What goes wrong:** Server v3.0 renames `deviceId` → `deviceName` in response. QA running old CLI gets empty fields, reports "CLI broken." We assume CI caught it — but CI runs with matching versions.
**Why it happens:** Remote clients (QAs on laptops, CI pipelines) update asynchronously.
**How to avoid:**
- **API versioning:** path prefix `/v1/`, `/v2/` or `Accept` header. v3.0 refactor keeps `/v1/` contract-compatible (same fields) OR introduces `/v2/` and CLI negotiates.
- CLI sends `X-Device-Farm-Client-Version` header. Server logs client version distribution + warns/errors on known-broken combos.
- Release notes flag CLI update requirement explicitly. `device-farm doctor` warns if CLI is behind server min-version.
- Contract tests: old CLI binary against new server smoke-tested in CI before release.
**Warning signs:** "My CLI broke after the server update" bug reports. Logs show mixed client versions.
**Phase to address:** Contract-sync phase. Versioning strategy decided in Phase 1.

---

### Pitfall 29: Web client type mismatch at runtime — OpenAPI spec missing a field server actually returns

**Severity:** MAJOR
**What goes wrong:** Server handler returns `{ ...job, extraField }` but response schema doesn't declare `extraField`. `fastify-type-provider-zod` may strip or may not depending on config. Web types (openapi-fetch) don't know it exists → Svelte page can't render it. Or vice versa: spec declares a field, server doesn't return it, web expects it, runtime crash.
**Why it happens:** Handler return type drifts from declared schema; TS can't catch if `as JobResponse` cast is used or if handler is untyped.
**How to avoid:**
- Response validation in dev/test mode (Fastify option): `response.parse` on actual outbound payload. Production skip for perf, dev fails loudly.
- Handler return type inferred from response schema (`z.infer<typeof ResponseSchema>`). No `as` casts in handlers — lint rule.
- Contract tests that hit each endpoint, validate actual response against spec.
**Warning signs:** Svelte pages show `undefined` for fields that used to render. Integration tests that exercise handlers pass but types say the field doesn't exist.
**Phase to address:** Zod-at-boundaries phase + web migration phase.

---

### Pitfall 30: Go codegen breaks on Zod discriminated unions (already flagged in STACK.md)

**Severity:** MAJOR
**What goes wrong:** WebSocket messages use `z.discriminatedUnion('type', [...])`. `zod-openapi` emits `oneOf` with discriminator; `go-jsonschema` struggles with Go's lack of sum types, produces awkward `interface{}` + type-switch output that's unpleasant and hard to use.
**Why it happens:** JSON Schema `oneOf` → Go mismatch is a fundamental impedance.
**How to avoid:**
- Keep WebSocket message types MANUALLY maintained in Go (`cli/internal/wsmsg/`). Only REST DTOs go through codegen.
- Unit tests in Go that assert each wsmsg type round-trips against a JSON fixture from the server.
- Document in `cli/README.md`: "WS message types are manual; regenerate REST types with `make codegen`."
- Spike `go-jsonschema` output in Phase 1 before committing.
**Warning signs:** Generated Go file has `interface{}` fields named like messages. CLI's message handling is fragile.
**Phase to address:** Contract-sync phase. Documented scope limit.

---

### Pitfall 31: `file:../device-stream` dependency resolution mid-refactor

**Severity:** MAJOR
**What goes wrong:** Current `@device-stream/*` packages are `file:../device-stream`. Mid-refactor we version-pin or publish to npm. If this happens inside a refactor phase, we change both the import surface AND the module boundaries of device code simultaneously. Half the issues that appear look like refactor issues but are actually "version upgrade" issues.
**Why it happens:** Tech debt (v2.0 carry-forward) bundled into refactor phases.
**How to avoid:**
- **Separate phase for device-stream resolution** (publish to npm or vendor into repo), with its own success criteria. Do NOT combine with pool/pool-module refactor phase.
- Version-pin before refactor: even file: imports can have a snapshot tag or submodule pin.
- CI that reproduces `file:../device-stream` setup; document ergonomics for contributors without sibling repo.
**Warning signs:** PRs that both refactor pool module AND change device-stream import path. Build fails only on contributor machines without sibling repo.
**Phase to address:** Dedicated tech-debt phase before pool-module refactor.

---

### Pitfall 32: CLI deviceName fix is an observable API change (not just a CLI bug)

**Severity:** MAJOR
**What goes wrong:** Fixing `Job.DeviceName` requires either (a) server rename `deviceId` → `deviceName` (breaking), (b) server emit both (bloated), or (c) server-side lookup `deviceId → name` and emit name. Each choice ripples through OpenAPI spec → Go codegen → web types → docs. Done in a vacuum as "fix CLI bug," it creates a hidden contract churn.
**Why it happens:** Fix looks local; it isn't.
**How to avoid:**
- Treat this as an API contract change. Decide field strategy in Phase 1 spec review.
- Prefer (c): server returns `{ deviceId, deviceName }`, CLI uses `deviceName` for display, `deviceId` for machine operations. Backward-compat (new field, old field kept).
- Generate, commit, test across all three surfaces in one phase.
**Warning signs:** "Just a CLI fix" that touches server routes.
**Phase to address:** Contract-sync phase OR tech-debt phase (bundled with device-stream resolution).

---

### Pitfall 33: Nyquist validation exposes uncovered code only after refactor

**Severity:** MAJOR (latent; bites at milestone end)
**What goes wrong:** Nyquist was never run in v2.0 (13/13 phases `nyquist_compliant: false`). Running it on a refactored module first-time likely reveals large gaps. Team treats the gap as "refactor broke coverage" when really it was always there.
**Why it happens:** Nyquist-as-phase-gate, not retroactive baseline.
**How to avoid:**
- **Record Nyquist baseline before milestone starts.** Run on current `main`; note the gap; this is the starting point.
- Each phase's Nyquist requirement = "don't make baseline worse" (for unrefactored modules) + "achieve target for refactored module" (not just "compliant").
- Separate uncovered-by-refactor gaps from pre-existing gaps in reports.
**Warning signs:** Phase 4 Nyquist run shows large surprising gaps that were silently present in main.
**Phase to address:** Phase 1 (baseline record). Every phase thereafter (delta enforcement).

---

### Pitfall 34: dependency-cruiser false positives block devs, rules get relaxed to ineffective

**Severity:** MAJOR
**What goes wrong:** Initial rules are too strict (e.g., block ALL cross-module imports). Real-world legitimate imports (shared types, shared schemas) trigger daily. Team relaxes rules via `allowed` lists until almost anything passes — boundaries are no longer enforced, we've lost the feature.
**Why it happens:** Boundary rules require iteration; first version rarely right.
**How to avoid:**
- Start with warning-only rules for one phase; convert to errors only after cleanup.
- Have a `shared/` allowlist from day one (shared types, shared schemas, shared bus interface) — these ARE legitimate cross-module.
- When a team member adds an exception, it's in a file, not a rule relaxation: `allowedFrom: ['server/x.ts' → 'server/y.ts', reason: "..."]`.
- Weekly review of added exceptions during milestone.
**Warning signs:** `.dependency-cruiser.cjs` diff frequently adding exceptions. Devs mutter about "that cruiser thing."
**Phase to address:** Module-boundary enforcement phase. Retro at milestone midpoint.

---

## Minor Pitfalls (MINOR)

### Pitfall 35: Circular type inference with Zod schemas referencing each other (edge case in v4)

**Severity:** MINOR
**What goes wrong:** Two schemas `A` and `B` reference each other (e.g., `Job` has `Device[]`, `Device` has `currentJob?: Job`). Zod v4 improved circular inference but some patterns still produce `any` types silently. Code compiles, TS gives no error, runtime works — but IDE autocomplete is lost.
**Why it happens:** Circular type graphs are hard; Zod uses `z.lazy` workaround with inference caveats.
**How to avoid:**
- Prefer unidirectional references; `Job.deviceId` (string) instead of `Job.device` (object).
- When bidirectional needed, use `z.lazy(() => OtherSchema)` and add an explicit type alias.
- Unit test that infers types and asserts they're non-`any` (via `expectTypeOf`).
**Warning signs:** VS Code shows `any` instead of the expected nested type.
**Phase to address:** Zod-at-boundaries phase. Tests in shared schemas module.

---

### Pitfall 36: MODULE.md rot

**Severity:** MINOR
**What goes wrong:** MODULE.md written at module creation, never updated. An LLM later reads stale "emits X, consumes Y" and generates code against old contracts.
**Why it happens:** MODULE.md is treated as docs, not tests.
**How to avoid:**
- Tests-as-spec: each MODULE.md claim about emitted events has a matching test that asserts it.
- Code review: MODULE.md update is a PR requirement if the module's public surface changes (barrel, events.ts, DB schema, routes).
- Periodic "doc drift" check: script that diffs MODULE.md events against `events.ts` exports; mismatch fails CI.
**Warning signs:** MODULE.md mentions events no longer in `events.ts`.
**Phase to address:** Module conventions phase. Checked per-module phase.

---

### Pitfall 37: Barrel `index.ts` circular imports

**Severity:** MINOR (but occasionally BLOCKER at runtime)
**What goes wrong:** `jobs/index.ts` re-exports from `jobs/service.ts`, which imports from `jobs/index.ts` (a type alias). TypeScript happy, runtime throws "Cannot access before initialization."
**Why it happens:** Barrel files invite lazy imports.
**How to avoid:**
- Convention: inside a module, imports use relative paths (`./service`), never the module's own barrel.
- Dependency-cruiser rule: forbid imports of `./index` from same module's files.
- Test: `tsx server/index.ts --check` runs without ReferenceError at boot.
**Warning signs:** Boot-time "Cannot access X before initialization."
**Phase to address:** Module conventions phase. Enforced by dependency-cruiser.

---

### Pitfall 38: events.ts bloat — every helper ends up there

**Severity:** MINOR
**What goes wrong:** `events.ts` grows 500 lines — zod schemas, type aliases, enum constants, helper functions, dispatcher logic. File becomes unreadable.
**Why it happens:** "Events folder" attraction.
**How to avoid:**
- Rule: `events.ts` = Zod schemas + event map type. Nothing else. Helpers go in `service.ts` or `internal/`.
- Target: events.ts <150 lines per module.
- Lint: warn if events.ts has functions.
**Warning signs:** events.ts >200 lines; imports from events.ts by modules that don't need to emit or listen.
**Phase to address:** Module conventions phase. Template shows the target shape.

---

### Pitfall 39: Tests-as-spec descriptor inflation (long `describe` chains nobody reads)

**Severity:** MINOR
**What goes wrong:** `describe('JobService > when a job is dispatched > with an android platform > and a device is available > should emit job.started')` — five levels deep. Test output is a novel; devs skim and skip.
**Why it happens:** "Read like English" taken too far.
**How to avoid:**
- Max 3 levels: `describe('jobs module', () => describe('contract: job dispatched', () => it('emits job.started when device allocated')))`.
- Prefer flat `it('does X when Y')` over nested describes.
- Style guide in the module conventions MODULE.md template.
**Warning signs:** Test output >200 lines for a module. describe nesting >3.
**Phase to address:** Module conventions phase. Style guide.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Skip response schema on "simple" routes | Faster route authoring | Silent API drift; exactly the v2.0 deviceName bug | Never — it's the bug class this refactor exists to eliminate |
| Global `bus` instead of per-module bus | Simpler wiring | God-bus re-couples everything; audit becomes impossible | Never |
| `as` cast on Fastify handler return | Compiles without fiddling | Runtime payload drift from schema | Never in production code; acceptable in throwaway scripts |
| Skip pg-boss DLQ monitoring ("we'll add later") | Fewer moving parts | Silent job loss detected weeks later | Never — DLQ must be observable from day one |
| Put heavy work in bus listeners ("it's fast enough now") | No queue plumbing | Event loop blocks under load; hard to untangle later | Never — use pg-boss for work, bus for signals |
| Leave JSONB as `z.unknown()` | Get shipped faster | Most valuable data has no safety; consumers cast | OK for truly opaque pass-through (e.g., CI-provided metadata); must document |
| Skip coverage baseline gate | No CI overhead | Coverage erosion invisible; regressions land | Never mid-milestone |
| Regenerate Go types locally, don't commit | Faster iteration | Release-time drift between spec and committed types | Never for shipped branches; OK in draft PRs |
| Merge "partial" module migration | Phase ships on time | Hybrid modules compound; second refactor harder | Only if accompanied by a follow-up phase ticket and ≤1 week lifetime |
| Keep node-cron alongside pg-boss temporarily | Gradual cutover | Two schedulers racing; double-runs | Only during a single cutover phase, ≤1 week |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| pg-boss + existing in-memory JobQueue | Hard swap on deploy; in-flight jobs lost | Drain procedure + dual-write window; new submissions only to pg-boss, let in-memory drain |
| pg-boss + Drizzle (two PG drivers) | Assume single pool; exhaust connections | Size both pools explicitly; document in queue MODULE.md; monitor pg_stat_activity |
| pg-boss handler + Fastify decorators | Access `fastify.jobService` expecting request context | Worker has no request; pass needed services through handler closure or a dedicated `workerContext` |
| AsyncLocalStorage + pg-boss | Expect context to propagate through boss queue | Always pass correlation ID in job payload; wrapper re-establishes context in handler |
| AsyncLocalStorage + EventEmitter listeners | Register listener in one context, fire in another | Context at listener invocation time ≠ registration time; don't rely on ALS inside listeners; pass correlation ID in event payload |
| AsyncLocalStorage + setImmediate/setTimeout | Context can leak or be lost depending on Node version | Use `AsyncResource.bind` for callbacks crossing timer boundaries when ALS matters |
| zod-openapi + discriminated unions | Expect clean Go codegen | Go lacks sum types; keep discriminated-union types (WS messages) manually in Go |
| drizzle-zod + JSONB | Accept default `z.unknown()` | Override with explicit schema for known-shape JSONB (jobs.metadata) |
| Fastify plugin order + pg-boss | Register queue before db | Queue depends on db; register AFTER db, BEFORE jobs/pipelines/lifecycle |
| Fastify hot-reload (tsx watch) + event bus | Module-level singleton bus accumulates listeners | Bus is plugin-owned; `onClose` removes listeners |
| device-stream `file:../` dependency | Refactor pool module while also changing dep path | Separate phases; pin or publish device-stream before pool refactor |
| Web openapi-fetch + shared Zod schemas | Duplicate validators in server and web | Import shared schemas (via `shared/` folder or workspace); openapi-fetch provides transport types, Zod validates at parse points |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Zod parse on every bus event | CPU profile shows `ZodObject._parse` hot; event-loop lag during active jobs | Parse at trust boundaries only; intra-module is TS types | At 5+ concurrent jobs or 200+ events/s total |
| Sync listener doing I/O | emit() blocks seconds; WebSocket disconnects cluster at job end | Listener does metadata only; I/O via pg-boss | At any concurrent job load if a listener does file work |
| pg-boss polling interval default | Jobs take 2s to start when queue empty | Tune `pollingIntervalSeconds` down (e.g., 0.5s) for snappier dev; up for fewer DB queries at scale | Dev experience always; prod at scale with many queues |
| Two PG pools under-sized | "too many clients" at peak; drizzle-kit push hangs | Explicit pool sizing totaling <50% of max_connections | At 2+ concurrent jobs + ops activity on the DB |
| events table without `(correlation_id, created_at DESC)` index | Correlation-trace queries slow | Index at table creation; partition by month if volume justifies | At 1M+ rows in events table |
| events table append with no pruning | Backup size balloons; JSONB scan cost rises | Retention policy + pg-boss pruning job | At 10M+ rows |
| Zod `.passthrough()` on webhook payloads stored to JSONB | JSONB bloat from arbitrary CI fields | Cap payload size at ingest; document max | At 1000+ jobs/day |
| Dependency-cruiser on every `tsx watch` reload | Slow dev loop | Run in CI only; optional `:fast` rule set for dev | Always in dev; never in prod runtime |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Correlation ID trusted from client without validation | Log injection, CRLF in logs, sensitive data smuggled into traces | Validate correlation ID as UUID v4; reject anything else; generate server-side if missing |
| events table includes raw job payloads | PII/secrets from CI env vars logged forever | Allowlist of fields written to events; never dump raw objects |
| Zod `.passthrough()` on user-provided metadata reaching Svelte rendering | Stored XSS via metadata values | Svelte auto-escapes, but don't `{@html}` metadata; enforce review rule |
| pg-boss DLQ containing sensitive payloads | DLQ is a PII timebomb | Redact known-sensitive fields before enqueue; retention on DLQ too |
| Response schema missing error fields | Leak internal stack traces on exception | RFC 7807 Problem+JSON already used; enforce schema; Fastify `errorHandler` sanitizes |
| Shared Zod schemas between server and web | Web imports server-only schemas containing secrets (e.g., `apiKey`) | Separate `schemas/public/` and `schemas/internal/`; web imports only public |
| API version header spoofable | Older client auto-negotiation tricked into unsafe path | Version is UX hint, not auth; auth stays on API key |

---

## UX Pitfalls (Operator/Developer-Facing)

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| DLQ hidden from Web UI | QA reports jobs missing; ops has no visibility | /admin/dlq page with count + recent items + retry button |
| Correlation ID not surfaced in CLI output | Debugging requires server-side log-digging | `device-farm status <jobId>` shows correlationId; logs command includes it |
| OpenAPI docs not served at `/docs` | Consumers guess the API shape | Serve Swagger UI at `/docs` in dev/staging |
| pg-boss schedule failures silent | Scheduled pipelines stop running; nobody notices | Web UI "Pipelines" page shows last run time + status; alert if late |
| Refactor causes log format change mid-milestone | QAs/ops lose their grep patterns | Version the log format; keep `correlationId` field stable across milestone |
| `device-farm doctor` doesn't check server/CLI version compatibility | QAs on old CLI hit mysterious errors | Doctor pings server, warns on version skew |

---

## "Looks Done But Isn't" Checklist

Things that appear complete but are missing critical pieces.

- [ ] **Zod at boundaries:** Every route has a REQUEST schema — verify it also has a RESPONSE schema (200 AND 4xx).
- [ ] **Event bus:** Listeners registered — verify `onClose` unregisters them and hot-reload doesn't accumulate.
- [ ] **pg-boss adoption:** Queue runs jobs — verify DLQ is monitored and retries are idempotent.
- [ ] **Correlation IDs:** Request logs have correlationId — verify pg-boss handler logs, webhook logs, cleanup logs all carry the same ID.
- [ ] **Events table:** Rows being written — verify retention policy exists and pruning job scheduled.
- [ ] **MODULE.md:** File exists — verify "events emitted" list matches actual `events.ts` exports (ideally enforced by test).
- [ ] **Barrel `index.ts`:** Exists — verify cross-module imports actually go through it (dep-cruiser green).
- [ ] **Go codegen:** Types generated — verify committed; CI fails if regenerating produces a diff.
- [ ] **OpenAPI spec:** Exists at `/docs` — verify spec matches runtime responses (contract tests).
- [ ] **Web client types:** openapi-fetch types regenerated — verify UI actually exercises each endpoint after rename.
- [ ] **Pilot module migration:** `MODULE.md` says "done" — verify old tests ported or justified-deleted; coverage not degraded >2pp.
- [ ] **Graceful shutdown:** `onClose` hook exists — verify SIGTERM during job either completes or cleanly requeues (test it).
- [ ] **JSONB metadata schema:** Defined — verify round-trip test (write, read, deep-equal).
- [ ] **CLI version skew:** Version header sent — verify server logs distribution and `doctor` warns.
- [ ] **Nyquist:** Phase marked compliant — verify against baseline recorded at milestone start.
- [ ] **Tech debt (device-stream, deviceName):** "Fixed" — verify it was its own phase, not bundled silently.

---

## Recovery Strategies

When pitfalls occur despite prevention, how to recover.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Live queue jobs lost on deploy (Pitfall 3) | HIGH | Review server logs for accepted-but-never-ran jobs; manually requeue via admin API; apologize; add drain step |
| pg-boss double side-effect (Pitfall 4) | HIGH | Identify duplicate emulators via `ps`; kill zombies; nuke duplicate artifacts; add idempotency key to handler; write postmortem |
| PG pool exhaustion (Pitfall 5) | MEDIUM | Restart server; increase pool sizes in config; add monitoring |
| Correlation ID lost in pg-boss handler (Pitfall 6) | LOW (but damage ongoing) | Fix wrapper; backfill correlation IDs where possible via DB join on jobId; redeploy |
| Test coverage loss (Pitfall 7) | MEDIUM | Audit deleted tests; prioritize restoring high-value ones; add coverage gate going forward |
| Half-refactored modules (Pitfall 9) | MEDIUM | Dedicate a phase to completing the migration; forbid new features in half-state modules until done |
| Sync listener blocking loop (Pitfall 14) | LOW | Move work to pg-boss job; emit the triggering event instead of doing the work in-listener |
| DLQ accumulation unnoticed (Pitfall 22) | LOW-MEDIUM | Triage DLQ manually; fix handler; replay jobs that were transient failures; drop those that are permanent |
| Events table explosion (Pitfall 23) | MEDIUM | Create `events_archive`; move old rows; add retention job; reindex |
| Generated-code drift (Pitfall 27) | LOW | Run `make codegen`; commit; release patch CLI if drift was released |
| Version skew in production (Pitfall 28) | MEDIUM | Publish CLI patch; notify QAs; add server-side shim for old client payload shape (temporary) |
| Dependency-cruiser rules too strict (Pitfall 34) | LOW | Retro; identify legitimate exceptions; move them to allowlist with reasons; tighten remaining rules |

---

## Pitfall-to-Phase Mapping

Roadmap uses this to bake prevention into phase success criteria. "Every phase" pitfalls are milestone-wide concerns.

| Pitfall | Primary Phase | Verification |
|---------|---------------|--------------|
| 1. Big-bang refactor drift | Every phase | Dep-cruiser rule blocks cross-module edits outside declared scope; PR checklist |
| 2. Wrong pilot module | Phase 1 (pilot) | Pilot MODULE.md justifies selection against criteria |
| 3. Live in-memory queue drain | pg-boss adoption phase | Rehearsed drain runbook in phase plan; deploy gate |
| 4. pg-boss double side-effects | pg-boss adoption phase + every queue-using phase | Idempotency key test; singleton queues; retryLimit review |
| 5. Two-PG-pool exhaustion | pg-boss adoption phase | Pool size in config; pg_stat_activity monitor; load test |
| 6. ALS lost in pg-boss handler | Correlation IDs phase | Test: handler log has correlationId from producer |
| 7. Test coverage loss | Every module-refactor phase | Coverage gate ≤-2pp; old-test-disposition matrix in PR |
| 8. Wrong module boundaries | Phase 1 + midpoint retro | Dep-cruiser passes; MODULE.md "why this module" test |
| 9. Half-refactored modules | Every phase | Migration status doc; "fully migrated or not started" rule |
| 10. Zod parse in hot paths | Event bus phase | Bus benchmark in CI; no parse calls on emit path |
| 11. Response schema skipped | Zod-at-boundaries phase + every API phase | Lint/review rule; contract tests against spec |
| 12. drizzle-zod + JSONB | Zod phase (with Phase 1 spike) | Round-trip test for `jobs.metadata` |
| 13. Listener error swallowed | Event bus phase | Test: listener A throws, B still runs; error logged |
| 14. Sync bus blocks loop | Event bus phase + every subscriber | Listener watchdog; perf test |
| 15. Event ordering assumptions | Event bus phase | Docs state no cross-event ordering; tests use polling not order |
| 16. Memory leak in hot-reload | Event bus phase | Dev-mode test: reload N times, listener count bounded |
| 17. Circular emits | Event bus phase | Emit-depth counter; dev-mode assertion |
| 18. God bus anti-pattern | Event bus phase | Per-module buses; wiring.ts is single cross-module site |
| 19. pg-boss cron overlap | pg-boss phase + pipelines migration phase | singletonKey + singletonSeconds; explicit overlap policy per schedule |
| 20. pg-boss schema migration | pg-boss phase (Phase 1 spike) | Dev-DB migration timing; prod migration window documented |
| 21. Graceful shutdown drops jobs | pg-boss phase + deploy phase | SIGTERM test; supervisor grace configured |
| 22. DLQ unnoticed | pg-boss phase | /admin/dlq endpoint; metric + alert |
| 23. Events table growth | Correlation IDs phase | Retention policy; pruning job; indexing |
| 24. Business event drift | Correlation IDs phase | event_type enum constraint; MODULE.md review gate |
| 25. Non-transactional event+state | Correlation IDs phase | Transactional helper; code review; reconciliation test |
| 26. Over-validating internal data | Zod phase + every module phase | MODULE.md boundary list; review |
| 27. Schema drift in codegen | Contract-sync phase + every API phase | CI regenerate + git-diff clean gate |
| 28. CLI version skew | Contract-sync phase | Version header; doctor check; N-1 compat test |
| 29. Web client type mismatch | Zod phase + web migration phase | Dev-mode response validation; contract tests |
| 30. Go codegen on discriminated union | Contract-sync phase | Phase 1 spike; WS types documented as manual |
| 31. device-stream dep resolution | Dedicated tech-debt phase before pool refactor | Version pinning; CI reproducibility |
| 32. CLI deviceName is API change | Tech-debt phase (bundled with 31) | Server response has both `deviceId` and `deviceName`; spec + codegen updated |
| 33. Nyquist reveals pre-existing gaps | Phase 1 (baseline) + every phase (delta) | Baseline recorded; delta enforcement |
| 34. Dep-cruiser false positives | Boundary phase + midpoint retro | Warning-only start; exceptions tracked; retro |
| 35. Circular type inference | Zod phase | Type-level test (`expectTypeOf`) |
| 36. MODULE.md rot | Every phase | Test asserts MODULE.md claims match `events.ts` |
| 37. Barrel circular imports | Module conventions phase | Dep-cruiser rule; boot-time check |
| 38. events.ts bloat | Module conventions phase | File-size lint; template |
| 39. Test describe inflation | Module conventions phase | Style guide; 3-level max |

---

## Sources

- **Direct read** of `.planning/PROJECT.md` v3.0 pillars — HIGH confidence on constraints
- **Direct read** of `.planning/research/STACK.md` v3.0 — HIGH confidence on package versions + already-flagged risks (pg-boss v10→v12 migration, drizzle-zod JSONB, go-jsonschema discriminated union)
- **Direct read** of `server/db/schema.ts` confirming JSONB columns (`jobs.metadata`, `jobs.resultSummary`, pipelines `variables`) — HIGH confidence
- **Direct read** of `server/jobs/job-queue.ts` + `server/pipelines/scheduler.ts` confirming current in-memory queue + node-cron — HIGH confidence
- **v2.0 audit** (`.planning/milestones/v2.0-MILESTONE-AUDIT.md` referenced in PROJECT.md) tech debt: Phase 15 operational deps, CLI deviceName, Nyquist never run — HIGH confidence
- **Node.js AsyncLocalStorage documentation** — behavior across timers, EventEmitter listeners, well-known propagation caveats — HIGH confidence (well-documented stdlib)
- **pg-boss GitHub release notes** (v11 named queues, v12 key_strict_fifo, singleton options) — HIGH confidence per STACK.md research
- **Fastify 5 plugin model** (encapsulation, dependency ordering, onClose hooks) — HIGH confidence from direct use in repo
- **Drizzle + two-driver reality** (Drizzle uses `postgres`, pg-boss uses `pg`) — HIGH confidence per STACK.md
- **Personal experience with large refactors** — MEDIUM confidence on "typical failure modes" (big-bang drift, half-migrated modules, test coverage erosion) — these are well-known but not project-specific
- **OpenAPI + Go codegen community knowledge** (oneOf/sum-type impedance, spec drift patterns) — MEDIUM-HIGH confidence

**Uncertainties flagged (to spike in Phase 1):**
- pg-boss v10→v12 migration on a DB without prior pg-boss schema (greenfield for us) — confirmed low risk but needs a dry run
- `drizzle-zod` behavior with JSONB + explicit Zod overrides — confirm round-trip fidelity for non-trivial metadata
- `go-jsonschema` output quality on Zod discriminated union → JSON Schema `oneOf` — confirm worth-committing-to before wiring full pipeline
- `tsx watch` effect on module-level bus singletons — verify with a hot-reload test

---
*Pitfalls research for: v3.0 Spec-Driven Architecture refactor of Device Farm*
*Researched: 2026-04-16 (supersedes 2025-12-04 v1.0 ecosystem research)*
