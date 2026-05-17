---
phase: 16-pilot-module-hooks
plan: 01
subsystem: hooks-queue-worker
tags: [drizzle-migration, pg-boss, singletonKey, zod, events-06, queue-06, events-09, idempotency]

# Dependency graph
requires:
  - phase: 16-pilot-module-hooks
    provides: "server/hooks/schemas.ts + events.ts (hooksRegistry, makeHookEmitters), server/queue/names.ts QUEUE_NAMES.HOOK_RUN, server/hooks/__tests__/fixtures/test-registry.ts, HookExecutor.executeOne private method at server/hooks/hook-executor.ts:147"
  - phase: 15-fix-operational-dependencies
    provides: "TypedBus, createEventHelpers, bus plugin, queue plugin (fastify.boss + fastify.queue), ALS threading via @fastify/request-context"
provides:
  - "`hook_runs` Drizzle table — TEXT PRIMARY KEY on operation_key + 3 btree indexes (hook_name, event_id, triggered_at) — serves as the DB idempotency barrier for EVENTS-06"
  - "server/db/migrations/0001_youthful_dark_beast.sql — generated Drizzle migration for the hook_runs table, applies cleanly against fresh DB"
  - "server/hooks/internal/idempotency.ts — claimOperationKey(db, row) helper using INSERT...ON CONFLICT DO NOTHING RETURNING; markHookRunStatus updater"
  - "server/hooks/internal/hook-run-handler.ts — HOOK_RUN worker body: Zod payload validation, claim-before-run, hook lookup + execute, terminal emit on success, per-attempt emit.failed + throw on failure for pg-boss retry"
  - "server/hooks/queue.ts — public module queue contract (QUEUE-06): exports hookRunPayloadSchema + registerHookRunWorker(deps) factory. Configures the HOOK_RUN queue with `policy: 'stately'` + retryLimit: 1"
  - "server/hooks/__tests__/queue.spec.ts — DB-gated spec with 2 tests: [Invariant c] replay idempotency with spy-based side-effect count, [EVENTS-09] bus-to-queue bridge pattern"
affects: [16-02, 16-03, 16-04, 20-pool, 21-artifacts, 23-jobs]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Per-module queue contract in `queue.ts`: queue name constant + payload Zod schema + registerXWorker(deps) factory (QUEUE-06)"
    - "Worker-side idempotency via `INSERT hook_runs ... ON CONFLICT DO NOTHING RETURNING` — destructure with fallback (empty array = replay)"
    - "pg-boss `policy: 'stately'` for singleton_key dedup on state<=active (NOT default 'standard')"
    - "vi.spyOn(instance as any, 'privateMethod') to assert side-effect call count when Public API batches results"
    - "DB-gated describe.skipIf(!HAS_DB) pattern with live db plugin decorator (real Drizzle instance, not stub) — mirrors server/events/__tests__/persistence.spec.ts"

key-files:
  created:
    - server/db/migrations/0001_youthful_dark_beast.sql
    - server/db/migrations/meta/0001_snapshot.json
    - server/hooks/internal/idempotency.ts
    - server/hooks/internal/hook-run-handler.ts
    - server/hooks/queue.ts
    - server/hooks/__tests__/queue.spec.ts
  modified:
    - server/db/schema.ts (appended hookRuns pgTable after events table)
    - server/db/migrations/meta/_journal.json (added idx=1 entry)

key-decisions:
  - "pg-boss queue policy: 'stately' (NOT default 'standard') — RESEARCH §Pitfall 8 was wrong: job_i4 UNIQUE index applies to singleton_on (time-slot dedup), NOT singleton_key. Default 'standard' policy has NO unique index on singleton_key, so back-to-back boss.send with the same singletonKey BOTH succeed. `stately` covers state<=active (job_i3 index) which is what makes the duplicate return null. Corrected the queue.ts config during Task 1.3 after an integration-test failure surfaced the mismatch."
  - "Two-layer idempotency retained: queue-boundary (policy: stately + singletonKey) PREVENTS duplicate enqueue; DB-boundary (hook_runs PK + onConflictDoNothing) PREVENTS duplicate execution even in a hypothetical scenario where two workers grab the same job (pg-boss localConcurrency > 1 or a bug)."
  - "Worker emits `hook.completed` terminal on success and `hook.failed` per-attempt + re-throws on failure. `hook.failed.retryExhausted` emission deferred to plan 16-02 (onComplete hook). This plan's worker only handles per-attempt semantics."
  - "HookExecutor.executeOne kept private; spied via `executor as any` (eslint-disabled `no-explicit-any` on one line) — the plan explicitly required this exact cast form for the [BLOCKER 2] acceptance criterion. Counting executeOne calls is load-bearing for Invariant (c): a regression that double-executes but rolls back the row would still pass the DB-count check."
  - "Payload Zod schema validated at the CONSUMER boundary via `hookRunPayloadSchema.parse(rawData)` inside the handler. Producer-side validation (the bus-to-queue subscriber) wires in plan 16-02."
  - "No FK from hook_runs.event_id to events.id — bus envelope ids may be persisted=false and never reach the events table, yet their hooks still run (e.g. test.trigger fixture)."

patterns-established:
  - "Module-owned queue.ts contract — queue name (from shared QUEUE_NAMES), payload schema, registerXWorker factory. All 3 exports present. Handler internals under internal/ (dep-cruiser scope)."
  - "Private spy target + call-count assertion for Invariant-style idempotency proofs — generalizable to every future module whose Public API batches side-effects"

requirements-completed: [QUEUE-06, EVENTS-06, EVENTS-09]

# Metrics
duration: 10min
completed: 2026-04-17
---

# Phase 16 Plan 01: Hooks Queue Worker + Idempotency Proof Summary

**`hook_runs` idempotency table + HOOK_RUN worker (Zod-validated payload, claim-before-run) + DB-gated spec proving Invariant (c) replay-idempotency AND the EVENTS-09 bus-to-queue bridge — 2/2 tests pass against device_farm_test, typecheck baseline maintained**

## Performance

- **Duration:** 10 min
- **Started:** 2026-04-17T19:26:07Z
- **Completed:** 2026-04-17T19:35:56Z
- **Tasks:** 3
- **Files created:** 6
- **Files modified:** 2

## Accomplishments

- `hook_runs` Drizzle table appended to `server/db/schema.ts` — `operation_key TEXT PRIMARY KEY` + `hook_name`, `event_id`, `triggered_at`, `status`, `exit_code`, `duration_ms` + 3 btree indexes.
- Drizzle migration `0001_youthful_dark_beast.sql` generated; journal and snapshot updated. Migration applied cleanly against `device_farm_test` via `drizzle-kit push`.
- `claimOperationKey(db, row)` + `buildOperationKey(triggerEventId, hookName)` + `markHookRunStatus(db, key, status, {exitCode, durationMs})` helpers in `server/hooks/internal/idempotency.ts` — single-round-trip atomic claim via `insert().onConflictDoNothing({target: hookRuns.operationKey}).returning({operationKey})`.
- `createHookRunHandler(deps)` worker body in `server/hooks/internal/hook-run-handler.ts` — 8-step flow: Zod parse → claim → replay guard (`if (!claimed) return`) → hook lookup → execute → update row → emit terminal/failed → throw on failure. Emits route through `deps.emit.completed` / `deps.emit.failed` (lint-compliant).
- `server/hooks/queue.ts` public module contract (QUEUE-06): `registerHookRunWorker(deps)` creates the queue with `policy: 'stately'` + retryLimit 1, wires the handler through `fastify.queue.work` (ALS-restoring).
- `server/hooks/__tests__/queue.spec.ts` DB-gated integration spec: **2/2 tests pass** against `device_farm_test` (TEST_DATABASE_URL), skips cleanly without DB (typecheck still green).

## Task Commits

Each task committed atomically:

1. **Task 1.1: hook_runs table + Drizzle migration + apply** — `f432b79` (feat)
2. **Task 1.2: idempotency helper + hook-run-handler + queue.ts factory** — `45f6981` (feat)
3. **Task 1.3: DB-gated queue.spec — Invariant (c) + EVENTS-09 bridge** — `2352314` (test, includes queue.ts policy fix)

**Plan metadata commit:** (pending final docs commit)

## Files Created/Modified

### Created

- `server/db/migrations/0001_youthful_dark_beast.sql` — `CREATE TABLE "hook_runs"` + 3 `CREATE INDEX` statements (btree on hook_name, event_id, triggered_at). Auto-generated by drizzle-kit; slug `youthful_dark_beast` is drizzle-kit's default for content hashes not matching a known adjective/noun pair.
- `server/db/migrations/meta/0001_snapshot.json` — drizzle-kit meta snapshot for the migration.
- `server/hooks/internal/idempotency.ts` — `buildOperationKey`, `claimOperationKey`, `markHookRunStatus`, exported `DrizzleDb` type-union (`PostgresJsDatabase | NodePgDatabase`).
- `server/hooks/internal/hook-run-handler.ts` — `hookRunPayloadSchema` (Zod), `HookRunPayload` type, `createHookRunHandler(deps)` factory.
- `server/hooks/queue.ts` — `HOOK_RUN_QUEUE_NAME`, re-exported `hookRunPayloadSchema`, `registerHookRunWorker(deps): Promise<string>`.
- `server/hooks/__tests__/queue.spec.ts` — 2 tests with `describe.skipIf(!HAS_DB)` gate; live db plugin (real Drizzle), bus plugin, queue plugin wiring; per-test cleanup of `hook_runs` rows + schema drop in afterAll.

### Modified

- `server/db/schema.ts` — appended `export const hookRuns = pgTable('hook_runs', ...)` after the `events` table. No changes to existing tables.
- `server/db/migrations/meta/_journal.json` — added `{"idx": 1, "tag": "0001_youthful_dark_beast", ...}` entry.

## Decisions Made

- **pg-boss queue policy: 'stately'** — RESEARCH §Pitfall 8 claimed the `job_i4` unique index covers every policy, but source inspection of `node_modules/pg-boss/dist/plans.js:473` shows `job_i4` is `(name, singleton_on, COALESCE(singleton_key, ''))` — the `singleton_on` column is for TIME-slot dedup (singletonSeconds/Hours), not singletonKey. The policies whose indexes actually dedup by singleton_key are `short` (created-state only), `singleton` (active-state only), `stately` (state<=active), `exclusive` (state<=active), and `key_strict_fifo`. `'stately'` covers state<='active' which includes 'created' — this is what makes back-to-back `boss.send(name, payload, {singletonKey})` return `null` on the second call. Discovered this when the initial test run produced `expected <uuid> to be null` for `job2` under the default `'standard'` policy.
- **Private-method spy via `executor as any`** — plan explicitly required the exact cast form for the `[BLOCKER 2]` acceptance criterion. Paired with `// eslint-disable-next-line @typescript-eslint/no-explicit-any` to keep lint green. This is load-bearing: counting `executeOne` calls (not `execute` calls) is the direct proof no duplicate side-effect happened — a regression that creates the row once but execs the hook body twice (e.g. transaction rollback post-exec) would still pass `rows.length === 1` but fail `toHaveBeenCalledTimes(1)`.
- **Two-layer idempotency retained** — queue policy `'stately'` prevents duplicate enqueue; `hook_runs` PK + `onConflictDoNothing` prevents duplicate execution at the worker boundary. Either layer alone is insufficient: the queue layer fails if `state > active` (e.g. completed state), the DB layer fails if two workers start simultaneously. Both in series gives at-most-one physical side-effect per `(triggerEventId, hookName)` across all edge cases.
- **Payload Zod validation ONLY at the consumer boundary** — `hookRunPayloadSchema.parse(rawData)` inside `handleHookRun`. The producer-side check (bus-to-queue subscriber) will wire in plan 16-02 — this plan's scope is the worker contract, not the subscriber. Plan acceptance criteria explicitly allow this.
- **Re-throw on hook failure** — worker propagates the error after emitting `hook.failed` + updating `hook_runs.status = 'failed'`. This triggers pg-boss's retry path (retryLimit=1). The `hook.failed.retryExhausted` terminal event is emitted by the onComplete hook wired in plan 16-02, not here.
- **Local stub-config plugin in queue.spec.ts** — duplicated 4 lines from `server/queue/__tests__/test-helpers.ts` rather than reaching into the queue module's test helpers. Reason: deep cross-module test-helper imports would violate MOD-02 once dep-cruiser lands in 16-03. A 4-line duplication is cheaper than establishing a shared `server/__tests__/shared-fixtures/` import surface that later modules would need to justify.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] pg-boss queue policy mismatch — `'standard'` does not dedup by singletonKey**
- **Found during:** Task 1.3 integration run (first attempt)
- **Issue:** RESEARCH §Pitfall 8 asserted `job_i4` UNIQUE index covers every policy, so default policy would suffice for `singletonKey` dedup. The actual source (`node_modules/pg-boss/dist/plans.js:464-485`) shows `job_i4` is for `singleton_on` (time-slot), not `singleton_key`. Under `policy: 'standard'`, both `boss.send(name, payload, {singletonKey: X})` calls succeed — the second returns a valid job id, not null. The spec's `expect(job2).toBeNull()` then fails.
- **Fix:** Added `policy: 'stately'` to the `createQueue` call in `server/hooks/queue.ts`. `stately` (index `job_i3`) dedups on `state <= active` which includes the `created` state — back-to-back sends now return the first job id then `null`.
- **Files modified:** `server/hooks/queue.ts` (1-line policy addition + 10-line comment explaining the policy rationale, citing pg-boss source file + line number)
- **Commit:** `2352314` (bundled with Task 1.3 since the fix was discovered during Task 1.3 verification and the test is the proof of correctness)

### Scope-adjacent cleanup (not a deviation)

- Applied migration to `device_farm_test` via `DATABASE_URL=... npx drizzle-kit push` to enable the DB-gated spec run. This is a local-environment operation, not a repo change.

## Verification Results

**`npx drizzle-kit generate`** — generated `server/db/migrations/0001_youthful_dark_beast.sql` (13 lines, CREATE TABLE + 3 CREATE INDEX statements) and `meta/0001_snapshot.json`. The only tables affected are `hook_runs` — zero unrelated schema diffs (confirmed via `git diff --stat server/db/migrations/meta/0001_snapshot.json` only touches this plan's new table definitions).

**`npx drizzle-kit push` (against `postgresql://heicg@localhost:5432/device_farm_test`)** — exits 0, `Changes applied`. The `hook_runs` table is now present in the test database.

**`npx tsc --noEmit`** — 7 pre-existing errors (baseline from 16-00-SUMMARY). **Zero new errors** from Plan 16-01 changes. Verified by filtering for hooks/-related errors: `npx tsc --noEmit 2>&1 | grep server/hooks/` → empty output.

**`npm run lint`** — exits 0. The worker handler calls `deps.emit.completed(...)` and `deps.emit.failed(...)` — the `no-direct-bus-emit` rule does NOT fire because these go through the `events.ts` helper factory (which is allowlisted by `/\/events\.ts$/`). The single `@typescript-eslint/no-explicit-any` was suppressed with an `eslint-disable-next-line` on the spy line (plan-mandated form per `[BLOCKER 2]`).

**`npx vitest run server/hooks/__tests__/queue.spec.ts` (no DB)** — `1 skipped (1)` / `2 skipped (2)` — spec skips cleanly with console warning "set TEST_DATABASE_URL to run".

**`TEST_DATABASE_URL=postgresql://heicg@localhost:5432/device_farm_test npx vitest run server/hooks/__tests__/queue.spec.ts`** —

```
RUN  v4.1.4 /Users/heicg/Desktop/projects/device-farm
Test Files  1 passed (1)
     Tests  2 passed (2)
Duration  4.63s (transform 57ms, setup 0ms, import 326ms, tests 4.22s)
```

Both tests pass:
- **[Invariant c]** — `job1` returned a UUID, `job2` returned `null` (confirms `'stately'` dedup), `hook_runs` has exactly 1 row with `status='completed'`, `executeOne` spy called exactly 1 time.
- **[EVENTS-09]** — `testBus.emit('test.trigger')` triggered the bridge subscriber, which called `queue.send(HOOK_RUN, ..., {singletonKey})`, the worker processed it, and `hook_runs` has exactly 1 row for the operationKey.

**`grep` audit of required patterns:**
- `grep -c "QUEUE_NAMES.HOOK_RUN" server/hooks/queue.ts` → 1 ✓
- `grep -c "onConflictDoNothing" server/hooks/internal/idempotency.ts` → 2 (1 usage + 1 doc-comment reference) ✓
- `grep -c "if (!claimed)" server/hooks/internal/hook-run-handler.ts` → 1 (the Invariant (c) replay early-return) ✓
- `grep -c "vi.spyOn(executor as any, 'executeOne')" server/hooks/__tests__/queue.spec.ts` → 1 ✓
- `grep -c "toHaveBeenCalledTimes(1)" server/hooks/__tests__/queue.spec.ts` → 1 ✓
- `toHaveBeenCalledTimes(1)` is INSIDE the `[Invariant c]` test block (awk block match: 1 hit) ✓

**pg-boss v12 `singletonKey` null-on-duplicate confirmation:** The test ran under `policy: 'stately'` and the second `app.queue.send(QUEUE_NAMES.HOOK_RUN, payload, {singletonKey: operationKey})` returned `null` exactly as RESEARCH §Pitfall 1 predicted (but only after the policy fix; under default `'standard'` the behaviour was the OPPOSITE of the research claim — see Deviations).

## Issues Encountered

- **RESEARCH §Pitfall 8 was wrong** — research claimed `job_i4` UNIQUE index covers every policy. Source inspection showed it covers `singleton_on` (time-slot dedup), not `singleton_key`. Corrected with policy: `'stately'`. Future module queue contracts must set an explicit policy when using `singletonKey` for dedup. Candidate for RESEARCH §Pitfall correction in a future phase.

## User Setup Required

None - all changes are internal to the hooks module substrate and a Drizzle migration.

For running the DB-gated spec locally:
```bash
# Ensure Postgres 17 running and device_farm_test DB exists
DATABASE_URL="postgresql://heicg@localhost:5432/device_farm_test" npx drizzle-kit push
TEST_DATABASE_URL="postgresql://heicg@localhost:5432/device_farm_test" npx vitest run server/hooks/__tests__/queue.spec.ts
```

## Next Phase Readiness

### Ready for 16-02 (factory + plugin thin-wrap + bus-to-queue subscriber)

- `registerHookRunWorker(deps)` is importable from `server/hooks/queue.js`; factory wires it with `{fastify, db, executor, emit, logger}`.
- Bus subscriber for `test.trigger` (and future `device.booted`/`device.shutdown`) now has a concrete target: call `fastify.queue.send(QUEUE_NAMES.HOOK_RUN, {triggerEventId: envelope.id, hookName, context}, {singletonKey: ${envelope.id}:${hookName}})` with `policy: 'stately'` pre-baked into the queue.
- `hookRunPayloadSchema` re-exported from `queue.ts` — producer-side subscriber should call `.parse()` to fail fast on malformed bridge payloads.
- `hook.failed.retryExhausted` emission is deferred to 16-02 — wire an `onComplete` hook or equivalent that reads the pg-boss job's failure count and, when it equals retryLimit, emits the terminal event via `emit.retryExhausted(triggerEventId, {...})`.

### Ready for 16-03 (dependency-cruiser config + CI)

- `server/hooks/internal/` now exists with 2 files — dep-cruiser's deep-import denylist has a concrete scope to enforce. Public API from `server/hooks/queue.ts` (and the future `index.ts` barrel in 16-02).

### Ready for 16-04 (MODULE.md + tests-as-spec)

- `server/hooks/__tests__/queue.spec.ts` is the first `.spec.ts` under the module — describe-tree pattern `describe('hook.run queue worker (Phase 16-01)')` establishes the section/subsection mapping convention. `[Invariant c]` and `[EVENTS-09]` tag-prefixed tests are directly referenceable from MODULE.md's Invariants + Events Consumed sections.

### Open items carried from prior phases (unchanged)

- Mac Mini graceful-shutdown live observation deferred (Plan 15-06 task 6.2) — no impact on 16-01.
- 7 pre-existing typecheck errors in unrelated modules (artifacts/, bus/, pipelines/) — out-of-scope per deviation-rule scope boundary. Documented in 16-00-SUMMARY.

## Self-Check: PASSED

- All 6 created files present on disk
- All 2 modified files present on disk
- All 3 per-task commits (f432b79, 45f6981, 2352314) in `git log`
- Typecheck baseline maintained (7 pre-existing errors, 0 new in hooks/)
- Lint clean
- 2/2 DB-gated tests pass against `device_farm_test`
- 2/2 tests skip cleanly without TEST_DATABASE_URL

---
*Phase: 16-pilot-module-hooks*
*Completed: 2026-04-17*
