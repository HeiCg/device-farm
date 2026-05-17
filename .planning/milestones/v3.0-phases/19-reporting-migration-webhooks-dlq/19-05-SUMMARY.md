---
phase: 19-reporting-migration-webhooks-dlq
plan: 05
subsystem: api
tags: [fastify, fastify-zod-openapi, zod, pg-boss, openapi, dlq, webhook, reporting]

# Dependency graph
requires:
  - phase: 19-00
    provides: dlqJobSchema + dlqListResponseSchema Zod definitions with .meta({id}) registry hooks
  - phase: 19-03
    provides: WEBHOOK_DELIVER_DLQ_QUEUE_NAME constant + registered DLQ queue + reporting/plugin.ts thin wirer
  - phase: 17-01
    provides: fastify-zod-openapi v5 type-provider pattern (validatorCompiler + serializerCompiler + fastifyZodOpenApiPlugin)
provides:
  - GET /api/queue/dlq HTTP endpoint (QUEUE-05 observable surface)
  - server/reporting/routes.ts with registerReportingRoutes(fastify) async factory
  - Zod-typed response schema (response.200 = dlqListResponseSchema) → emits into server/openapi.json
  - Flat DlqJob projection from pg-boss JobWithMetadata<T> with correlation_id hoisted from envelope
  - DB-gated round-trip spec (dlq-route.spec.ts) proving Zod safeParse + field-name contract
affects: [phase-27-api-aggregator, phase-28-cli, phase-29-web]

# Tech tracking
tech-stack:
  added: []  # No new deps — reuses fastify-zod-openapi + pg-boss already in tree
  patterns:
    - "Reporting module owns its own routes (registerReportingRoutes inside plugin body, NOT a nested fp() wrapper — matches hooks plugin pattern); Phase 27 API aggregator MAY relocate later"
    - "Route schema = response Zod only (no body/query) — Phase 19 MVP returns full DLQ list; future ?state= / ?limit= filters out of scope (defer to Phase 27+ if usage demands)"
    - "Flat projection with snake_case/lowercase field names matching pg-boss column naming verbatim (id, queue, state, retrycount, data, output, createdon, correlation_id) — correlation_id hoisted from envelope.data.correlationId for operator one-pass visibility"
    - "Test harness for specs that register Zod-typed routes MUST install validatorCompiler + serializerCompiler + fastifyZodOpenApiPlugin at root scope BEFORE plugin register — else Ajv default chokes on required arrays (FST_ERR_SCH_VALIDATION_BUILD)"

key-files:
  created:
    - server/reporting/routes.ts
    - server/reporting/__tests__/dlq-route.spec.ts
    - .planning/phases/19-reporting-migration-webhooks-dlq/19-05-SUMMARY.md
  modified:
    - server/reporting/plugin.ts
    - server/openapi.json
    - server/reporting/__tests__/queue.spec.ts (Rule 3 unblocking — added zod-openapi type provider to harness)
    - server/reporting/__tests__/correlation.spec.ts (Rule 3 unblocking)
    - server/reporting/__tests__/terminal-event.spec.ts (Rule 3 unblocking)

key-decisions:
  - "Route registration lives directly in the reporting plugin body (await registerReportingRoutes(fastify)) — NOT a nested fastify-plugin wrapper. Matches hooks plugin pattern; keeps the module barrel-friendly."
  - "registerReportingRoutes is called AFTER module.registerWorkersAndSubscribers() and BEFORE the onClose hook so queues exist before the route handler could conceivably fire (findJobs on a missing queue is safe in pg-boss, but ordering matches the boot-phase mental model)."
  - "Zod response schema only (no body/query) — the endpoint is read-only; pagination + state-filter are deferred to Phase 27+."
  - "Flat projection with snake_case/lowercase field names (retrycount / createdon / correlation_id) verbatim from CONTEXT.md §Specifics — correlation_id hoisted from envelope.data.correlationId to give operators one-pass visibility without drilling."
  - "Rule 3 auto-fix: installing the fastify-zod-openapi validator/serializer/plugin in dlq-route.spec.ts (new) AND in the 3 plan-19-04 specs that register reportingPlugin (queue/correlation/terminal-event). Without it Fastify's default Ajv fails with FST_ERR_SCH_VALIDATION_BUILD on the Zod-emitted required arrays. Mirrors server/index.ts:94-96 pattern."
  - "No auth preHandler — matches the existing /api/webhooks ping endpoint behaviour (both are Phase 26 Auth Module scope)."

patterns-established:
  - "Module-local routes.ts file: reporting owns its own route registration function exported as registerReportingRoutes(fastify), called directly from the plugin body. Phase 20+ modules that need HTTP routes can replicate this pattern (pool/plugin.ts → pool/routes.ts, etc.) until Phase 27 aggregator consolidates."
  - "Fastify test harness for Zod-typed routes: the minimal harness pattern used by plan-19-04 specs must install `app.setValidatorCompiler(validatorCompiler); app.setSerializerCompiler(serializerCompiler); await app.register(fastifyZodOpenApiPlugin);` BEFORE registering any plugin that declares Zod schemas. Future plans touching Zod-typed routes in minimal test harnesses should copy this pre-amble."

requirements-completed: [QUEUE-05]

# Metrics
duration: 17min
completed: 2026-04-21
---

# Phase 19 Plan 05: Reporting DLQ HTTP Endpoint Summary

**GET /api/queue/dlq ships with Zod-typed response schema via fastify-zod-openapi — QUEUE-05 observable surface complete; CLI (Phase 28) + web (Phase 29) will codegen typed DlqJob / DlqListResponse consumers from server/openapi.json.**

## Performance

- **Duration:** 17min
- **Started:** 2026-04-21T06:41:25Z
- **Completed:** 2026-04-21T06:58:33Z
- **Tasks:** 4 (all completed, 1 TDD — Task 5.3)
- **Files modified:** 3 created + 1 modified + 3 updated specs (Rule 3 unblocking) = 7

## Accomplishments

- **server/reporting/routes.ts (67 lines)** ships `registerReportingRoutes(fastify)` as a plain async function (NOT fp() wrapper). Registers ONE route via `fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().route({...})`: `GET /api/queue/dlq` with `schema.response.200 = dlqListResponseSchema` (plan 19-00 Zod schema with `.meta({id: 'DlqListResponse'})`).
- **Handler queries `fastify.boss.findJobs(WEBHOOK_DELIVER_DLQ_QUEUE_NAME)`** (Path A from 19-RESEARCH §Endpoint Design — pg-boss public API, NOT raw SQL against `pgboss.job`). Projects each `JobWithMetadata<T>` into the flat DlqJob shape: `id, queue, state, retrycount, data, output, createdon, correlation_id`. Field names match CONTEXT.md §Specifics verbatim (snake_case for `correlation_id`, lowercase `retrycount`/`createdon` mirroring pg-boss column names). `correlation_id` is hoisted from `envelope.data.correlationId` so operators get one-pass visibility without drilling into `data.correlationId`.
- **server/reporting/plugin.ts (+8 lines)** extended with `import { registerReportingRoutes } from './routes.js'` and `await registerReportingRoutes(fastify)` inserted between `module.registerWorkersAndSubscribers()` and the `onClose` hook. Plugin NAME ('reporting') and dependencies (`['config', 'db', 'queue', 'event-bus']`) unchanged. Log message extended to mention the new route.
- **server/reporting/__tests__/dlq-route.spec.ts (186 lines, 3 tests, 155ms DB-gated runtime)** proves: (1) empty DLQ → 200 + `{items: [], count: 0}` passing `dlqListResponseSchema.safeParse`; (2) seeded DLQ row → 200 with flat shape + `correlation_id` hoisted from envelope matching expected UUID; (3) response JSON field-name contract — all 8 CONTEXT-mandated snake_case/lowercase keys present, no camelCase drift at top level. Isolated schema `pgboss_reporting_dlq_route_spec`; seeds via `app.queue.send(DLQ_QUEUE_NAME, ...)` inside `asyncLocalStorage.run({correlationId, currentEventId, actor} as never, ...)` per the canonical plain-object ALS shape (checker W5) — bypasses the ~35s retry path (that's covered by plan 19-04 specs).
- **server/openapi.json (+122 lines, byte-deterministic)** regenerated via `DATABASE_URL=... npm run openapi:generate`. Adds `paths./api/queue/dlq.get` with `responses.200 → $ref #/components/schemas/DlqListResponse`, plus `components.schemas.DlqListResponse` (items: array of `$ref DlqJob` + count: nonnegative integer) and `components.schemas.DlqJob` (flat 8-field shape including state enum, null-bearing output/createdon, UUID-nullable correlation_id). CLI + web codegen will now consume the typed surface without hand-rolled DTOs.
- **Rule 3 unblocking:** 3 plan-19-04 DB-gated specs (queue.spec.ts, correlation.spec.ts, terminal-event.spec.ts) updated to install `fastify-zod-openapi` validator/serializer/plugin at root scope before registering reportingPlugin — otherwise Fastify's default Ajv chokes on Zod-emitted `required` arrays at `app.ready()` with `FST_ERR_SCH_VALIDATION_BUILD`. This was directly caused by Task 5.2 adding a Zod-typed route to reportingPlugin; mirrors server/index.ts:94-96 pattern shipped in plan 17-01.

## Task Commits

Each task was committed atomically:

1. **Task 5.1: Write server/reporting/routes.ts** — `00fbb18` (feat) — TDD
2. **Task 5.2: Wire registerReportingRoutes into plugin.ts** — `78c2ad2` (feat)
3. **Task 5.3: Write dlq-route.spec.ts DB-gated proof** — `b5058d2` (test) — TDD
4. **Task 5.4: Regenerate openapi.json with new DLQ surface** — `9a72d58` (chore)

**Rule 3 unblocking commit:** `c632979` (fix) — install zod-openapi type provider in 3 plan-19-04 specs that previously booted reportingPlugin without the compilers.

## Files Created/Modified

- **server/reporting/routes.ts** (created, 67 lines) — `registerReportingRoutes(fastify)` exports async function; ONE route GET /api/queue/dlq; Zod response schema via `FastifyZodOpenApiTypeProvider`; handler projects `fastify.boss.findJobs(WEBHOOK_DELIVER_DLQ_QUEUE_NAME)` into flat DlqJob shape with correlation_id hoisted.
- **server/reporting/plugin.ts** (modified, +8 lines) — import + call to registerReportingRoutes inserted after workers/subscribers; log message extended.
- **server/reporting/__tests__/dlq-route.spec.ts** (created, 186 lines) — 3 DB-gated it-blocks (empty list + seeded row + field-name contract) all green in 155ms.
- **server/openapi.json** (modified, +122 lines) — new path + 2 new schemas (DlqListResponse + DlqJob).
- **server/reporting/__tests__/queue.spec.ts** (modified, Rule 3) — test harness installs zod-openapi type provider before reportingPlugin.
- **server/reporting/__tests__/correlation.spec.ts** (modified, Rule 3) — same harness fix.
- **server/reporting/__tests__/terminal-event.spec.ts** (modified, Rule 3) — same harness fix.

## Decisions Made

- **Route in plugin body, not nested fp():** `registerReportingRoutes` is a plain async function called directly from the reporting plugin. Matches hooks plugin pattern (routes are inline in plugin body, not a nested Fastify plugin). Keeps the module barrel (plan 19-06's `server/reporting/index.ts`) clean — only `createReportingModule` is the allowed internal/ re-export per MOD-02.
- **Route registration ordering:** after `module.registerWorkersAndSubscribers()` so queues exist before the route handler could fire, before `onClose` so cleanup still works. `pg-boss` findJobs on a missing queue is safe, but ordering matches boot-phase mental model.
- **Response-only schema:** no body/query schema — GET endpoints don't need them, and the Phase 19 MVP returns the full list (pagination + state filter deferred to Phase 27+ aggregator or a future targeted plan).
- **Flat projection (not nested envelope):** field names match CONTEXT.md verbatim — `correlation_id` (snake_case) hoisted from `envelope.data.correlationId` gives operators one-pass visibility. Envelope's other keys (causationId, actor, payload) stay nested under `data` for forward-compat.
- **No auth preHandler:** matches existing `/api/webhooks` ping endpoint; Phase 26 Auth Module adds the auth layer across all plan-19 + plan-17 endpoints uniformly.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Install fastify-zod-openapi type provider in 3 plan-19-04 specs**

- **Found during:** Overall verification (running full reporting spec suite after Task 5.4)
- **Issue:** Task 5.2 added `GET /api/queue/dlq` to reportingPlugin declaring a Zod response schema. The 3 DB-gated specs shipped by plan 19-04 (queue.spec.ts, correlation.spec.ts, terminal-event.spec.ts) each register reportingPlugin in a minimal Fastify harness WITHOUT the Zod validator/serializer compilers that server/index.ts:94-96 installs in production. Post-Task-5.2 they fail at `app.ready()` with `FST_ERR_SCH_VALIDATION_BUILD — data/required must be array` (Fastify's default Ajv serializer chokes on Zod-emitted `required` arrays).
- **Fix:** Mirrored server/index.ts:94-96 + plan 17-01 pattern — installed `fastify-zod-openapi`'s `validatorCompiler`, `serializerCompiler`, and `fastifyZodOpenApiPlugin` at root scope BEFORE `reportingPlugin` registration in each of the 3 specs (same pattern applied to the new dlq-route.spec.ts). Zero behavioural change to existing test logic.
- **Files modified:** server/reporting/__tests__/queue.spec.ts, server/reporting/__tests__/correlation.spec.ts, server/reporting/__tests__/terminal-event.spec.ts
- **Verification:** Full reporting/ spec suite (9 files, 59 tests) green: dlq-route 155ms + queue 20.2s + correlation 22.2s + terminal-event runs in parallel. Before fix: 3 DB-gated specs failed at boot; after fix: all pass.
- **Committed in:** `c632979` (fix) — separate commit post-Task-5.4 since the fix was identified during overall verification.

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** The auto-fix was necessary to keep the pre-existing plan-19-04 specs green after plan-19-05's route addition. Scope boundary: directly caused by Task 5.2's route addition, so unblocking it falls inside plan 19-05 scope per Rule 3. Zero scope creep; no production code changed.

## Issues Encountered

- **Pre-existing plugin-order.spec failure** (unchanged by this plan): `server/__tests__/plugin-order.spec.ts` still fails on the Phase 17 `fastify-zod-openapi` substring-match bug (`expected 424 to be greater than 1064` — 'websocket-plugin' string at position 424 is a substring of 'fastify-websocket', vs 'pool-plugin' at ~1064). Documented in STATE.md deferred-items and 19-04-SUMMARY; out-of-scope per scope-boundary rule.
- **Pre-existing dep-check violation** (unchanged by this plan): `npm run dep-check` reports 1 error — `server/jobs/plugin.ts → server/bus/bus.ts` violates `no-direct-bus-emit-outside-events-ts`. Introduced by plan 19-01's minimal jobs bridgehead, documented in `.planning/phases/19-reporting-migration-webhooks-dlq/deferred-items.md`. Phase 23 Jobs Module Keystone fixes via MOD-06 `server/jobs/internal/module.ts` which the allowlist already covers.
- **Pre-existing typecheck errors** (unchanged by this plan): 8 TS errors in artifacts/recording-service.ts (+tests), bus/plugin.ts, bus/helpers.ts, events/__tests__/emit-helpers.spec.ts, hooks/__tests__/events.spec.ts, pipelines/schema.ts — all documented in STATE.md as out-of-scope Phase 17/18 drift. Verified no new errors in plan 19-05's files (routes.ts, plugin.ts, dlq-route.spec.ts, queue.spec.ts, correlation.spec.ts, terminal-event.spec.ts all type-check clean).

## Verification Evidence

### Task 5.1 — routes.ts grep checks

```
grep -c "export async function registerReportingRoutes" server/reporting/routes.ts → 1
grep -c "url: '/api/queue/dlq'" server/reporting/routes.ts                         → 1
grep -c "fastify.boss.findJobs(WEBHOOK_DELIVER_DLQ_QUEUE_NAME)" .../routes.ts      → 1
grep -c "dlqListResponseSchema" server/reporting/routes.ts                         → 2
grep -c "FastifyZodOpenApiTypeProvider" server/reporting/routes.ts                 → 2
grep -c "correlation_id" server/reporting/routes.ts                                → 3
grep -c "createdon:" server/reporting/routes.ts                                    → 1
grep -c "fp(" server/reporting/routes.ts                                           → 0 (confirms NOT a nested plugin)
npx tsc --noEmit (filtered to routes.ts)                                           → 0 new errors
```

### Task 5.2 — plugin.ts grep checks

```
grep -c "import { registerReportingRoutes } from './routes.js'"                    → 1
grep -c "await registerReportingRoutes(fastify)"                                   → 1
grep -c "/api/queue/dlq" server/reporting/plugin.ts                                → 2 (comment + log message)
grep -c "name: 'reporting'"                                                        → 1 (preserved)
grep -c "dependencies: \['config', 'db', 'queue', 'event-bus'\]"                   → 1 (preserved)
npx tsc --noEmit (filtered to plugin.ts)                                           → 0 new errors
```

### Task 5.3 — dlq-route.spec.ts test run

```
$ DATABASE_URL=postgres://localhost/device_farm_test TEST_DATABASE_URL=postgres://localhost/device_farm_test \
  npx vitest run server/reporting/__tests__/dlq-route.spec.ts --reporter=default
 ✓ server/reporting/__tests__/dlq-route.spec.ts (3 tests) 155ms
   ✓ returns 200 + empty list when DLQ is empty; body passes dlqListResponseSchema.safeParse
   ✓ seeded DLQ row → 200 with flat shape + correlation_id hoisted from envelope
   ✓ response JSON contains CONTEXT-mandated snake_case/lowercase field names (no camelCase drift)

 Test Files  1 passed (1)
      Tests  3 passed (3)
   Duration  623ms
```

### Task 5.4 — openapi.json regeneration

```
$ DATABASE_URL=... npm run openapi:generate
... (full plugin boot log)
wrote /Users/.../server/openapi.json
wrote /Users/.../contracts/ws-messages.json

$ grep -c '"/api/queue/dlq"' server/openapi.json        → 1
$ grep -c '"DlqListResponse"' server/openapi.json        → 1
$ grep -c '"DlqJob"' server/openapi.json                 → 1
$ grep -c '"correlation_id"' server/openapi.json         → 2 (schema def + required)
$ grep -c '"retrycount"' server/openapi.json             → 2
$ grep -c '"createdon"' server/openapi.json              → 2
$ git diff --stat server/openapi.json
 server/openapi.json | 122 ++++++++++++++++++++++++++++++++++++++++++++++++++++
 1 file changed, 122 insertions(+)
```

### Overall verification — full reporting spec suite

```
$ DATABASE_URL=... TEST_DATABASE_URL=... npx vitest run server/reporting/__tests__/ --reporter=default
 ✓ server/reporting/__tests__/dlq-route.spec.ts (3 tests) 155ms
 ✓ server/reporting/__tests__/events.spec.ts (31 tests)
 ✓ server/reporting/__tests__/module.spec.ts (10 tests) 6ms
 ✓ server/reporting/__tests__/webhook-service.spec.ts (3 tests)
 ✓ server/reporting/__tests__/flaky-detector.test.ts (6 tests)
 ✓ server/reporting/__tests__/junit-generator.test.ts (4 tests)
 ✓ server/reporting/__tests__/queue.spec.ts (1 test) 20193ms
 ✓ server/reporting/__tests__/terminal-event.spec.ts (1 test)
 ✓ server/reporting/__tests__/correlation.spec.ts (1 test) 22187ms

 Test Files  9 passed (9)
      Tests  59 passed (59)
   Duration  22.67s
```

## User Setup Required

None — no external service configuration required. The endpoint is live once the server is running against a Postgres database with the pg-boss schema migrated (automatic on first boot).

## Next Phase Readiness

- **Plan 19-06 unblocked:** ships MODULE.md + barrel index.ts + test renames + Nyquist gate for the reporting module. All routes + internals now stable — ready for docs.
- **Phase 19 progress:** 6 of 7 plans complete (19-00 substrate + 19-01 events.ts pair + 19-02 deliverOnce + 19-03 queue/factory/plugin rewire + 19-04 DB-gated proofs + 19-05 DLQ HTTP endpoint). Only 19-06 remains.
- **ROADMAP SC2 fully satisfied end-to-end:** "DLQ pipeline is observable" — DLQ queue receives failed payloads (plan 19-03 factory + plan 19-04 SC1 proof) + endpoint lists them (this plan) + terminal event persisted to events table (plan 19-04 EVENTS-07 proof).
- **OpenAPI contract propagation ready for Phase 28 CLI + Phase 29 web:** `server/openapi.json` now has DlqJob + DlqListResponse + /api/queue/dlq path. CLI codegen (make -C cli types) + web codegen (npm run web:types) will pick them up on next run.
- **Requirement QUEUE-05 complete:** "GET /api/queue/dlq — operator-facing endpoint that lists dead-lettered webhook deliveries" — shipped with Zod-typed response, flat field-name contract matching CONTEXT, DB-gated Zod round-trip proof.

## Self-Check: PASSED

All claimed files exist:
- `server/reporting/routes.ts` ✓
- `server/reporting/plugin.ts` ✓
- `server/reporting/__tests__/dlq-route.spec.ts` ✓
- `server/openapi.json` ✓

All claimed commits exist:
- `00fbb18` — feat(19-05): add server/reporting/routes.ts ✓
- `78c2ad2` — feat(19-05): wire registerReportingRoutes into reporting plugin ✓
- `b5058d2` — test(19-05): add DB-gated dlq-route.spec.ts ✓
- `9a72d58` — chore(19-05): regenerate openapi.json ✓
- `c632979` — fix(19-05): install zod-openapi type provider in 3 plan-19-04 specs ✓

---
*Phase: 19-reporting-migration-webhooks-dlq*
*Completed: 2026-04-21*
