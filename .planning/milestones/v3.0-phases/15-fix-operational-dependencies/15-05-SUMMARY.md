---
phase: 15-fix-operational-dependencies
plan: 05
subsystem: infra
tags: [pg-boss, queue, als, correlation-id, fastify, postgres, graceful-shutdown, spike]

requires:
  - phase: 15-00
    provides: "pg-boss v12.15 + @fastify/request-context v6.2.1 installed (Wave 0 dep bootstrap)"
  - phase: 15-03
    provides: "correlationPlugin (@fastify/request-context onRequest hook) + asyncLocalStorage barrel + shape-agnostic alsMixin"

provides:
  - "server/queue/names.ts — QUEUE_NAMES + isValidQueueName (pg-boss v12 charset regex /^[a-z][a-z0-9._-]*$/) as the single extensible registry for every module's queue names"
  - "server/queue/plugin.ts — fastify-plugin starting pg-boss v12 against the default `pgboss` schema; decorates fastify.boss (raw PgBoss) + fastify.queue (ALS-aware send/work/schedule)"
  - "ALS cross-queue bridge: queue.send serialises correlationId/causationId/actor from the active ALS store into job.data; queue.work restores them on the worker fiber via asyncLocalStorage.run(objectStore) so requestContext.get() AND the pino alsMixin both work inside handlers"
  - "QUEUE_NAMES.DEMO queue created with retryLimit: 1 + retryBackoff: true + retryDelay: 30 (physical-side-effect default)"
  - "Graceful shutdown: fastify onClose hook calls boss.stop({ graceful: true, timeout: 30_000, destroy: false })"
  - "server/queue/index.ts barrel re-exporting plugin + QUEUE_NAMES + isValidQueueName + QueueName type"
  - "6 vitest spec files (names, plugin, als, als-crossqueue, retry-policy, migration, shutdown) — 17 passing tests against isolated per-file pg-boss schemas"
  - "scripts/spikes/shutdown-timing.ts + captured measurement (4032ms against 30_000ms budget — 26s headroom)"

affects: [15-06 plugin-reorder server/index.ts wiring, 16-hooks-pilot first module.queue.ts, every subsequent module that enqueues work via fastify.queue.send, every cron schedule via fastify.queue.schedule]

tech-stack:
  added: []
  patterns:
    - "pg-boss Fastify plugin pattern: fp(async (fastify, opts) => {...}, { name: 'queue', dependencies: ['db', 'correlation'] }) — explicit deps array matches existing plugin style"
    - "ALS store SHAPE is a plain object (not a Map) on restored worker fibers — needed because @fastify/request-context's requestContext.get(key) reads store[key] directly; the pino alsMixin (shape-agnostic) tolerates either, but downstream handlers calling requestContext.get() would fail on a Map"
    - "Per-spec-file Postgres schema isolation: every DB-backed queue spec uses its own pgboss_<suffix> schema so parallel Vitest workers don't clobber each other's state; plugin exposes opts.schema for tests, defaults to 'pgboss' in production"
    - "DB-gated spec pattern: `describe.skipIf(!process.env.TEST_DATABASE_URL)` + a one-liner console.warn at module load mirrors the existing server/db/__tests__/jsonb-roundtrip.spec.ts convention"

key-files:
  created:
    - "server/queue/names.ts"
    - "server/queue/plugin.ts"
    - "server/queue/index.ts"
    - "server/queue/__tests__/names.spec.ts"
    - "server/queue/__tests__/plugin.spec.ts"
    - "server/queue/__tests__/als.spec.ts"
    - "server/queue/__tests__/als-crossqueue.spec.ts"
    - "server/queue/__tests__/retry-policy.spec.ts"
    - "server/queue/__tests__/migration.spec.ts"
    - "server/queue/__tests__/shutdown.spec.ts"
    - "server/queue/__tests__/test-helpers.ts"
    - "scripts/spikes/shutdown-timing.ts"
    - ".planning/phases/15-fix-operational-dependencies/spikes/shutdown-timing.md"
  modified: []

key-decisions:
  - "ALS worker store is an OBJECT, not a Map. Research §3 showed `new Map(...)` but that silently fails for any worker code calling `requestContext.get(key)` (which reads `store[key]` via bracket access — Map-incompatible). The pino alsMixin from plan 15-03 is already shape-agnostic, so upgrading the worker store to an object makes BOTH readers work with a single store shape."
  - "Plugin accepts opts.schema (default 'pgboss'). Needed to isolate parallel Vitest spec files into pgboss_<suffix> schemas so they don't race on the shared `pgboss` schema during the beforeAll DROP SCHEMA CASCADE. Production callers leave opts unset — behaviour identical to the plan spec."
  - "Shutdown spike uses a minimal Fastify (correlation + queue only) rather than server/index.js buildApp. buildApp pulls in pool/config/emulator infrastructure that would conflate pg-boss drain timing with pool shutdown timing, and requires a config.yaml with live device platform config that isn't available on CI."
  - "Only the DEMO queue is registered by this plugin. Real queue names (job.execute, webhook.deliver, etc.) will be registered by each Phase 16+ module's local queue.ts via fastify.boss.createQueue(...). The plugin provides the substrate; modules own their own queue definitions."
  - "retryLimit: 1 is baked into createQueue(DEMO, {...}) — the queue-level default. Per-send opts override freely (proven in retry-policy.spec). The wrapper never silently injects retryLimit at send time."

patterns-established:
  - "server/queue/__tests__/test-helpers.ts: shared stub config + db plugins for queue integration tests — fastify-plugin's `dependencies: [...]` check requires named-plugin registration, not just decorators"
  - "sql.unsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`): the `postgres` driver can't parameterise identifiers in tagged templates; unsafe() with a literal-interpolated schema name is the idiom used across all four DB-backed queue specs"
  - "Route registration BEFORE app.ready() in specs — Fastify throws 'Fastify instance is already listening. Cannot add route!' if a spec registers app.post() after ready()"

requirements-completed: [QUEUE-01, QUEUE-02, QUEUE-04, QUEUE-07, TRACE-05]

duration: 23min
completed: 2026-04-17
---

# Phase 15 Plan 05: pg-boss Queue Plugin + ALS Cross-Queue Wrapper Summary

**pg-boss v12 Fastify plugin with ALS-aware send/work wrappers that bridge the request->queue->worker boundary for correlation IDs (producer + consumer halves of TRACE-05), central QUEUE_NAMES registry with pg-boss-v12 charset validation, retryLimit:1 physical-side-effect default at queue level, 30s graceful-shutdown drain via onClose, plus two validation spikes (auto-migration + Mac-drain timing) — 17 specs green, 0 regressions across the full 473-test suite.**

## Performance

- **Duration:** 23 min
- **Started:** 2026-04-17T15:17:07Z
- **Completed:** 2026-04-17T15:40:49Z
- **Tasks:** 4 (all TDD)
- **Files created:** 13 (3 production + 7 spec + 2 test helpers/script + 1 spike markdown)
- **Files modified:** 0

## Accomplishments

- **pg-boss plugin live.** `fastify.register(queuePlugin)` starts pg-boss v12 against Postgres, auto-migrates the `pgboss` schema on fresh DB, idempotent on re-run (proven by migration.spec).
- **ALS cross-queue boundary sealed.** End-to-end request with `x-correlation-id: cid-abc` -> `fastify.queue.send('demo', {x:1})` -> worker -> `requestContext.get('correlationId')` -> `'cid-abc'` captured. `als-crossqueue.spec` proves TRACE-05 full round-trip.
- **QUEUE_NAMES + validator established.** One module owns the pg-boss-v12 charset regex (`^[a-z][a-z0-9._-]*$`); downstream phases extend `QUEUE_NAMES` without redeclaring the rule.
- **Graceful shutdown measured.** Fastify `onClose` -> `boss.stop({ graceful: true, timeout: 30_000, destroy: false })`. Shutdown.spec locks in sub-2s drain for single in-flight jobs; the standalone spike script measured 4032ms against a 50x5s workload on MBP (M4 Max). 30s budget retained with 26s headroom.
- **retryLimit: 1 physical-side-effect default in place.** `boss.createQueue(DEMO, { retryLimit: 1, retryBackoff: true, retryDelay: 30 })` — `retry-policy.spec` proves default inheritance + caller-override honoured.
- **Zero regressions.** Full 473-test suite green (64 files) with TEST_DATABASE_URL set; 461/473 green in skip-mode (12 DB-gated skipped cleanly — expected).

## Task Commits

1. **Task 5.1 RED:** `9c11435` test(15-05): add failing tests for QUEUE_NAMES + charset validator
2. **Task 5.1 GREEN:** `59857c0` feat(15-05): add QUEUE_NAMES + charset validator module
3. **Task 5.2 RED:** `d368cc6` test(15-05): add failing specs for pg-boss plugin + ALS + retry policy
4. **Task 5.2 GREEN:** `f8ba771` feat(15-05): add pg-boss plugin with ALS-aware send/work + graceful shutdown
5. **Task 5.3:** `e2d1d8b` test(15-05): add pg-boss auto-migration spike
6. **Task 5.4:** `ee25057` test(15-05): add graceful shutdown timing spec + spike script

**Plan metadata commit:** appended after state updates below.

_Note: Task 5.2 is technically two TDD cycles (producer ALS + consumer ALS) but the implementation ships as a single plugin; RED and GREEN are combined commits covering both halves._

## Files Created/Modified

### Queue module

- `server/queue/names.ts` (40 lines) — QUEUE_NAME_RE + isValidQueueName + QUEUE_NAMES.DEMO + QueueName type
- `server/queue/plugin.ts` (202 lines) — fastify-plugin bootstrapping pg-boss v12; decorates fastify.boss + fastify.queue with send/work/schedule; onClose hook for graceful shutdown
- `server/queue/index.ts` (10 lines) — barrel re-exporting plugin + QUEUE_NAMES + isValidQueueName + QueueName

### Specs (7 files, 17 tests)

- `server/queue/__tests__/names.spec.ts` — 6 tests: validator charset rules + registry invariant
- `server/queue/__tests__/plugin.spec.ts` — 3 tests: decorator shape + pg-boss schema creation
- `server/queue/__tests__/als.spec.ts` — 1 test: ALS correlationId serialised into job.data (producer half of TRACE-05)
- `server/queue/__tests__/als-crossqueue.spec.ts` — 1 test: full request->send->worker ALS restore (TRACE-05 end-to-end)
- `server/queue/__tests__/retry-policy.spec.ts` — 2 tests: createQueue default + caller override (QUEUE-04)
- `server/queue/__tests__/migration.spec.ts` — 2 tests: fresh schema creation + idempotent restart (QUEUE-01 spike)
- `server/queue/__tests__/shutdown.spec.ts` — 2 tests: single-job drain < 2s + idle close < 1.5s (QUEUE-07 regression guard)
- `server/queue/__tests__/test-helpers.ts` — shared stub config + db plugins for queue integration specs

### Spikes

- `scripts/spikes/shutdown-timing.ts` — standalone tsx script (50 x 5s-sleep jobs + timed app.close())
- `.planning/phases/15-fix-operational-dependencies/spikes/shutdown-timing.md` — measurement (4032ms), conclusion (keep 30s timeout), Mac Mini re-run reminder for pre-Phase-16

## Decisions Made

- **ALS worker store = plain object, not Map.** Research §3 sketched the pattern as `new Map([...])`, but source inspection of `@fastify/request-context` v6.2.1 shows `requestContext.get(key)` reads `store[key]` via bracket access — Map-incompatible. Using a plain object makes BOTH readers work with a single store shape: (a) `requestContext.get()` via object property access, (b) the shape-agnostic pino `alsMixin` from plan 15-03 via `instanceof Map` branching. This is the right fix at the producer side of the cross-queue bridge, and it flows consistently to plans 15-04 (bus causation wrapper) and future module handlers that mix both readers.
- **Plugin accepts opts.schema (default 'pgboss').** Required to isolate parallel Vitest spec files into `pgboss_<suffix>` schemas so the per-file `beforeAll DROP SCHEMA CASCADE` doesn't race against other specs. Production call sites leave opts unset and get the canonical `'pgboss'` schema per plan 15 convention.
- **Shutdown spike uses a minimal app.** Not `buildApp` from `server/index.js` as the plan wrote — `buildApp` instantiates the full device farm (pool, emulator drivers, config.yaml) and would conflate pg-boss drain with pool shutdown. The spike's entire purpose is to measure pg-boss behaviour in isolation, so the minimal pattern (correlation + queue only + stub config/db) is correct.
- **Only DEMO registered by the plugin.** Real queue names land in Phase 16+ modules' own `queue.ts` files via `fastify.boss.createQueue(...)`. The plugin owns the substrate, not the module contracts. Plan 15-CONTEXT explicitly says "named queues registered colocated".

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Plugin needed opts.schema override for test isolation**
- **Found during:** Task 5.2 GREEN (running all 4 DB-backed specs in parallel)
- **Issue:** All four specs had `beforeAll` that dropped + recreated the single `pgboss` schema. Vitest runs spec files in parallel — races caused some tests to timeout after `boss.start()` hit a half-migrated schema.
- **Fix:** Added `QueuePluginOptions { schema?: string }`; plugin resolves `opts.schema ?? 'pgboss'`. Each spec file uses its own `pgboss_<suffix>` schema constant (`pgboss_plugin_spec`, `pgboss_als_spec`, `pgboss_alscq_spec`, `pgboss_retry_spec`, `pgboss_migration_spike`, `pgboss_shutdown_spec`, `pgboss_shutdown_spike`).
- **Files modified:** server/queue/plugin.ts, server/queue/__tests__/*.spec.ts
- **Verification:** `TEST_DATABASE_URL=... npx vitest run server/queue/__tests__/` -> 17/17 pass together; full suite 473/473 pass
- **Committed in:** `f8ba771` (task 5.2 GREEN)

**2. [Rule 1 - Bug] ALS restore MUST use object store, not Map**
- **Found during:** Task 5.2 GREEN (als-crossqueue.spec failing — `captured[0]` undefined)
- **Issue:** The plan's RESEARCH §3 code snippet used `new Map([...])` for the worker store. But `@fastify/request-context` v6.2.1 exposes `requestContext.get(key)` as `store[key]` — which returns `undefined` for Maps (bracket access on a Map returns `undefined`). Any worker handler that calls `requestContext.get('correlationId')` (as the test did, and as downstream module handlers will) would see undefined, breaking TRACE-05 end-to-end.
- **Fix:** queue.work wrapper uses `asyncLocalStorage.run(objectStore, ...)` with a plain object `{ correlationId, currentEventId, actor }` instead of a Map. The pino `alsMixin` from plan 15-03 already handles both shapes, so both readers work with one store.
- **Files modified:** server/queue/plugin.ts
- **Verification:** als-crossqueue.spec now proves `captured[0] === 'cid-abc'` end-to-end
- **Committed in:** `f8ba771` (task 5.2 GREEN)

**3. [Rule 3 - Blocking] Shutdown spike pickup grace increased 1s -> 3s**
- **Found during:** Task 5.4 spike execution
- **Issue:** First run of `scripts/spikes/shutdown-timing.ts` with 1s pickup grace returned `close took 17ms` — pg-boss hadn't dequeued any jobs yet, so graceful stop had nothing to drain (meaningless measurement).
- **Fix:** Bumped `PICKUP_GRACE_MS` from 1_000 to 3_000. Rerun returned `close took 4032ms` (one in-flight 5s-sleep job draining cleanly before stop timeout).
- **Files modified:** scripts/spikes/shutdown-timing.ts
- **Verification:** subsequent run produced the calibrated 4032ms; documented in shutdown-timing.md
- **Committed in:** `ee25057` (task 5.4)

**4. [Rule 3 - Blocking] Shutdown spike imports minimal plugins, not buildApp**
- **Found during:** Task 5.4 script drafting
- **Issue:** Plan action block said `import { buildApp } from '../../server/index.js'`. buildApp requires config.yaml + pool plugin + emulator driver infrastructure, which is unavailable on a pure-DB dev box and would measure pool shutdown + queue shutdown fused together.
- **Fix:** Built the spike's app inline with just `correlationPlugin` + `queuePlugin` + stub config/db. Isolates the measurement to pg-boss graceful stop.
- **Files modified:** scripts/spikes/shutdown-timing.ts
- **Verification:** script runs end-to-end against `device_farm_test`; produces calibrated timing measurement
- **Committed in:** `ee25057` (task 5.4)

### Out-of-scope issues logged (not fixed)

Pre-existing `tsc --noEmit` errors unrelated to 15-05 (identical to the set logged in 15-03-SUMMARY.md) remain in `.planning/phases/15-fix-operational-dependencies/deferred-items.md`:
- `server/artifacts/recording-service.ts:169,177` — `RecordingResult.errors` missing
- `server/pipelines/schema.ts:17` — function argument count mismatch
- `server/bus/helpers.ts:73` + `server/bus/plugin.ts:136` + `server/events/__tests__/emit-helpers.spec.ts:33,58` — existing `Map<string, unknown>` vs `RequestContext` cast pattern used by plan 15-04 (bus); same class of issue this plan sidesteps by using an object store in the queue wrapper.

My files (`server/queue/*`) typecheck cleanly via the project's `tsc --noEmit`.

---

**Total deviations:** 4 auto-fixed (3 blocking, 1 bug)
**Impact on plan:** All four were correctness-driven. Deviation #2 (Map -> object store) is the most consequential — without it the end-to-end TRACE-05 test would have silently returned undefined for `requestContext.get()` inside workers, meaning the entire "correlation id survives the queue boundary" contract would have shipped broken. No scope creep; all fixes stayed inside the plan's declared files.

## Issues Encountered

- **pg-boss v12 worker callback arity.** Research §1 used `async ([job]) => ...`. Runtime inspection showed pg-boss v12 invokes handlers with a raw array OR (in some configurations) a single job object. The plugin normalises: `const job = Array.isArray(jobs) ? jobs[0] : jobs`. Safe for Phase 15 (no batching). Phase 16+ may revisit if batch mode is opted into.
- **Fastify late-route registration.** `als-crossqueue.spec.ts` originally registered `app.post('/emit', ...)` after `await app.ready()` — Fastify 5 throws `FastifyError: Fastify instance is already listening. Cannot add route!`. Fixed by reordering: register routes before ready(), then register workers (workers go through boss.work, unaffected by ready state).
- **`sql` tagged-template identifier escaping.** Tried `sql\`DROP SCHEMA IF EXISTS ${sql(SCHEMA)} CASCADE\`` first — the `postgres` driver doesn't parameterise identifiers like that. Switched to `sql.unsafe(\`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE\`)` with a literal-interpolated constant. Safe because SCHEMA is a source-controlled constant, never user-supplied.

## Verification

### Plan-level verification (all green)

- `TEST_DATABASE_URL=... npx vitest run server/queue/__tests__/` -> 7 files, 17 tests, 0 failed
- `unset TEST_DATABASE_URL DATABASE_URL; npx vitest run server/queue/__tests__/` -> 6 tests pass (names), 11 tests skip cleanly with reason
- `TEST_DATABASE_URL=... npx vitest run` (full suite) -> 64 files, 473 tests, 0 failed
- `grep "import { PgBoss }" server/queue/plugin.ts` -> match (line 25)
- `grep "dependencies: ['db', 'correlation']" server/queue/plugin.ts` -> match (line 202)
- `grep "boss.stop({ graceful: true, timeout: 30_000, destroy: false }" server/queue/plugin.ts` -> match (line 194)
- `grep "requestContext" server/queue/plugin.ts` -> multiple matches (import + doc + guard)
- `grep "asyncLocalStorage.run" server/queue/plugin.ts` -> match (line 166)
- `grep "schema: 'pgboss'" server/queue/plugin.ts` -> match (documented default on line 93)
- `grep "boss.createQueue" server/queue/plugin.ts` -> match (line 112)
- `grep "close took" scripts/spikes/shutdown-timing.ts` -> 2 matches (docstring + output line)
- `grep "name: 'queue'" server/queue/plugin.ts` -> match
- `.planning/phases/15-fix-operational-dependencies/spikes/shutdown-timing.md` exists with captured `close took 4032ms`

### Success criteria (all satisfied)

- [x] **QUEUE-01** — pg-boss plugin registered with `pgboss` schema isolation; migration.spec proves fresh-create + idempotent restart
- [x] **QUEUE-02** — Named queues via QUEUE_NAMES; charset-validated by isValidQueueName; names.spec pins the regex
- [x] **QUEUE-04** — retryLimit: 1 default via createQueue(DEMO, ...); retry-policy.spec proves default inheritance + caller-override
- [x] **QUEUE-07** — Graceful shutdown via Fastify onClose -> boss.stop; shutdown.spec locks in the sub-2s single-job drain; spike markdown captures 4032ms/30_000ms budget with 26s headroom
- [x] **TRACE-05** — queue.send writes correlationId into job.data; queue.work restores ALS before handler; als-crossqueue.spec proves the round-trip end-to-end with `vi.waitFor`

### Pre-Phase-16 prerequisites delivered

- [x] pg-boss v12 auto-migration spike landed + GREEN (migration.spec)
- [x] Mac-drain timing spike landed + captured measurement (shutdown-timing.md); re-run on actual Mac Mini recommended before Phase 16 kickoff (MBP M4 Max was used as proxy; note in markdown)

## Dependency Output for Downstream Plans

- **pg-boss version resolved:** `12.15.0` (named export: `import { PgBoss } from 'pg-boss'`)
- **Plugin registration:** plan 15-06 will register `app.register(queuePlugin)` AFTER `correlation` + `db`, BEFORE `telemetry` (per 15-CONTEXT plugin-order decision)
- **Queue substrate contract (what Phase 16+ modules consume):**
  - `fastify.boss: PgBoss` — raw handle for `boss.createQueue('job.execute', {...})` inside each module's `queue.ts`
  - `fastify.queue.send(name, data, opts?)` — ALS-aware producer, returns pg-boss jobId
  - `fastify.queue.work<T>(name, handler)` — ALS-restoring consumer, handler receives unwrapped payload
  - `fastify.queue.schedule(name, cron, data?, opts?)` — cron producer, tags `actor: 'cron'` + fresh correlationId per fire
- **Env var status:** `TEST_DATABASE_URL` is NOT in developer `.env`; `.env` only has `DATABASE_URL=postgresql://heicg@localhost:5432/device_farm`. DB-gated queue specs fall back to `DATABASE_URL` via `process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL` — no setup needed for developer workflow. For CI, either env var works; preferred practice is to spin up a dedicated `device_farm_test` DB and set `TEST_DATABASE_URL` to keep job-queue state from polluting dev data.
- **Schema convention:** Production call sites of `queuePlugin` leave opts unset (defaults to `'pgboss'`). Tests pass `{ schema: 'pgboss_<spec_name>' }` to isolate.

## User Setup Required

None - no external service configuration required. All infrastructure is local Postgres + pg-boss auto-migration.

## Next Plan Readiness

- **Plan 15-06 (plugin reorder):** adds `app.register(queuePlugin)` to `server/index.ts` in the correct slot (AFTER correlation + db, BEFORE telemetry), wires the existing manual `shutdown()` function to let Fastify's plugin-ordered onClose chain take over (per RESEARCH §14 recommendation to remove `process.exit(0)` before `app.close()`).
- **Phase 16 (hooks pilot):** first real consumer of `fastify.queue.send/work`. Hooks module's `queue.ts` will register its own queues via `fastify.boss.createQueue('hooks.*', {...})` and register workers via `fastify.queue.work(...)`.

---

## Self-Check: PASSED

Verified every file and commit claimed above exists:

- `server/queue/names.ts` — FOUND
- `server/queue/plugin.ts` — FOUND
- `server/queue/index.ts` — FOUND
- `server/queue/__tests__/names.spec.ts` — FOUND
- `server/queue/__tests__/plugin.spec.ts` — FOUND
- `server/queue/__tests__/als.spec.ts` — FOUND
- `server/queue/__tests__/als-crossqueue.spec.ts` — FOUND
- `server/queue/__tests__/retry-policy.spec.ts` — FOUND
- `server/queue/__tests__/migration.spec.ts` — FOUND
- `server/queue/__tests__/shutdown.spec.ts` — FOUND
- `server/queue/__tests__/test-helpers.ts` — FOUND
- `scripts/spikes/shutdown-timing.ts` — FOUND
- `.planning/phases/15-fix-operational-dependencies/spikes/shutdown-timing.md` — FOUND
- commit `9c11435` (test 15-05 RED names) — FOUND
- commit `59857c0` (feat 15-05 GREEN names) — FOUND
- commit `d368cc6` (test 15-05 RED plugin+als+retry) — FOUND
- commit `f8ba771` (feat 15-05 GREEN plugin+als+retry) — FOUND
- commit `e2d1d8b` (test 15-05 migration spike) — FOUND
- commit `ee25057` (test 15-05 shutdown spec + spike script) — FOUND

---
*Phase: 15-fix-operational-dependencies*
*Plan: 05*
*Completed: 2026-04-17*
