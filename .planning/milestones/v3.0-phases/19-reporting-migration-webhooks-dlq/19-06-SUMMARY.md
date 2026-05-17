---
phase: 19-reporting-migration-webhooks-dlq
plan: 06
subsystem: reporting
tags: [module-md, barrel, mod-01, mod-02, mod-04, nyquist, phase-close, events-07, queue-05]

# Dependency graph
requires:
  - phase: 19-reporting-migration-webhooks-dlq
    provides: "Plan 19-00 substrate (QUEUE_NAMES + schemas.ts + dep-cruiser rule + webhook-service.test.ts -> .spec.ts rename); Plan 19-01 events.ts (MOD-03 — 4 events) + jobs/events.ts bridgehead (job.completed); Plan 19-02 WebhookService.deliverOnce (single-attempt); Plan 19-03 queue.ts (QUEUE-05 DLQ + QUEUE-06 main) + internal/module.ts (MOD-06 createReportingModule) + thin plugin.ts; Plan 19-04 DB-gated specs (queue/correlation/terminal-event) + plugin-order extension; Plan 19-05 routes.ts (GET /api/queue/dlq QUEUE-05 HTTP surface)"
  - phase: 18-lifecycle-migration-node-cron-pg-boss
    provides: "server/lifecycle/MODULE.md + server/lifecycle/index.ts canonical templates (1-line internal re-export form) — mirrored for reporting"
  - phase: 16-pilot-module-hooks
    provides: "server/hooks/MODULE.md 9-section template + dep-cruiser `no-deep-imports-into-<module>-internal` rule pattern"
  - phase: 15-fix-operational-dependencies
    provides: "Nyquist baseline (48.29% lines at commit 55ff8ac) — frozen gate reference"
provides:
  - "server/reporting/MODULE.md (114 lines, 1291 words, 9 fixed H2 sections in canonical order + H3 Runnable Example) — MOD-01 LLM-first contract"
  - "server/reporting/index.ts (75 lines, 11 export statements) — MOD-02 public barrel; dep-cruiser rule from plan 19-00 now structurally enforced since internal/ has real code from plan 19-03"
  - "2 renamed *.test.ts -> *.spec.ts (flaky-detector, junit-generator) — MOD-04 file-naming alignment (git rename-preserved 100%, content byte-identical)"
  - "Nyquist delta captured: +8.19pp vs Phase 15 baseline (current 56.48% lines; baseline 48.29%)"
  - "Phase 19 CLOSED — all 7 plans shipped (19-00 through 19-06). ROADMAP §Phase 19 SC1/SC2/SC3/SC4 verified end-to-end. EVENTS-07 + QUEUE-05 requirements complete"
affects: [Phase 20, Phase 23, Phase 27, Phase 30]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "MODULE.md 9-section template replicated for THIRD module (after hooks + lifecycle) — proven pattern; reporting's richer public surface (4 events + 2 queues + DLQ route + WebhookService + FlakyDetector) produces 114-line file vs hooks' 96 / lifecycle's 104"
    - "Public barrel MOD-02 1-line internal/ re-export (via inline `type` modifier) matches Phase 18 lifecycle strict form — stricter than Phase 16 hooks' 2-line form; establishes precedent for Phase 20+"
    - "File-naming MOD-04 via git mv 100% similarity — second wave (plan 19-00 already renamed webhook-service; plan 19-06 completes flaky-detector + junit-generator). Vitest root include glob already matches *.spec.ts (zero config change)"
    - "Nyquist capture + exclusion-set inheritance from Phase 18 Plan 18-04 — the 4 fastify-zod-openapi v5 boot-failure files excluded so coverage-summary.json emits"

key-files:
  created:
    - "server/reporting/MODULE.md (114 lines, 1291 words)"
    - "server/reporting/index.ts (75 lines, 11 named export statements)"
    - ".planning/phases/19-reporting-migration-webhooks-dlq/19-06-SUMMARY.md (this file)"
  renamed:
    - "server/reporting/__tests__/flaky-detector.test.ts -> flaky-detector.spec.ts (100% rename similarity)"
    - "server/reporting/__tests__/junit-generator.test.ts -> junit-generator.spec.ts (100% rename similarity)"
  modified:
    - ".planning/phases/19-reporting-migration-webhooks-dlq/deferred-items.md (added Plan 19-06 section documenting pre-existing envelope: 6+2 typecheck errors, 1 pre-existing dep-check violation, 31 pre-existing test failures + 1 spec hang, Nyquist exclusion pattern)"

key-decisions:
  - "MOD-02 strict 1-line internal/ re-export via inline type modifier — matches Phase 18 lifecycle precedent, stricter than Phase 16 hooks 2-line form. Single line `export { createReportingModule, type ReportingModule, type CreateReportingModuleDeps } from './internal/module.js';` satisfies MOD-02's structural invariant (grep count = 1) while exporting both runtime + 2 types"
  - "Barrel does NOT export registerReportingRoutes — routes are plugin-internal (called by reporting/plugin.ts only). Barrel consumers needing route shape import DlqJob / DlqListResponse schemas instead. Matches Phase 16 hooks pattern (barrel does not export HTTP route registration functions)"
  - "MODULE.md Invariants section documents 6 invariants (a)-(f) — one more than hooks (5) / lifecycle (5) because reporting has richer surface (webhook deliverOnce + DLQ pipeline + correlationId threading + terminal event persistence + DLQ endpoint shape + shutdown idempotency)"
  - "Nyquist capture inherits Phase 18 Plan 18-04 4-file exclusion set (routes.test, artifact-routes.test, auth-plugin.test, plugin-order.spec) — same fastify-zod-openapi v5 required-emission bug still present; documented in deferred-items.md with suggested hotfix options for pre-Phase-20 work"
  - "Baseline file (.planning/nyquist-baseline.json) NOT overwritten — verified via diff against /tmp/nyquist-baseline-19-06.bak before/after capture. Baseline remains frozen at Phase 15 substrate snapshot (commit 55ff8ac, 48.29% lines)"

patterns-established:
  - "MODULE.md 9-section canonical template now replicated across THREE modules (hooks + lifecycle + reporting) — strongly-proven pattern for remaining v3.0 module refactors (Phase 20 pool, Phase 21 artifacts, Phase 22 streaming, Phase 23 jobs, Phase 24 maestro, Phase 25 pipelines, Phase 26 auth)"
  - "Barrel pattern MOD-02 strict 1-line internal re-export: second module (lifecycle, reporting) confirms the Phase 18 precedent; hooks remains 2-line (Phase 20+ may tighten retroactively via Phase 30 repo-wide cleanup)"
  - "File-rename pattern MOD-04 for test files: git mv with 100% similarity preserves blame history through Git's rename detection; Vitest root include covers both *.test.ts and *.spec.ts so zero config changes"

requirements-completed: [EVENTS-07, QUEUE-05]

# Metrics
duration: 7min
completed: 2026-04-21
---

# Phase 19 Plan 06: MODULE.md + Barrel + Rename + Nyquist Close-out

**Phase 19 CLOSED: MODULE.md (9 sections, 1291 words) + public barrel (MOD-02) + 2 test-file renames (MOD-04) + Nyquist delta +8.19pp — ROADMAP §Phase 19 SC1/SC2/SC3/SC4 end-to-end verified. EVENTS-07 + QUEUE-05 requirements shipped. Pre-existing failures (6+2 typecheck errors, 1 dep-check violation, 31 test failures, 1 spec hang) all documented in deferred-items.md per SCOPE BOUNDARY rule.**

## Performance

- **Duration:** ~7 min
- **Started:** 2026-04-21T07:05:48Z
- **Completed:** 2026-04-21T07:13:01Z
- **Tasks:** 4 (all `type="auto"`)
- **Files created:** 3 (MODULE.md + index.ts + SUMMARY.md)
- **Files renamed:** 2 (*.test.ts -> *.spec.ts, 100% similarity each)
- **Files modified:** 1 (deferred-items.md — pre-existing failure envelope)

## Accomplishments

- `server/reporting/MODULE.md` shipped (114 lines, 1291 words) with all 9 fixed H2 sections in canonical order: Purpose, Public API, Events Emitted, Events Consumed, Queue Produced, Queue Consumed, Invariants, Non-Goals, Dependencies. Plus H3 Runnable Example. Documents all 4 events (scheduled/failed transient; delivered/failedRetryExhausted terminal EVENTS-07), both queues (webhook.deliver retryLimit:5 retryBackoff:true deadLetter:webhook.deliver.dlq + webhook.deliver.dlq retryLimit:0), `job.completed` bus consumer, 6 invariants (a)-(f) each citing a spec file test, and dependencies array ['config','db','queue','event-bus'] matching plugin.ts verbatim.
- `server/reporting/index.ts` public barrel (75 lines, 11 export statements) ships with MOD-02 invariant: EXACTLY ONE `from './internal/` re-export line (runtime + 2 types via inline `type` modifier). Re-exports: reportingPlugin (default), createReportingModule + ReportingModule + CreateReportingModuleDeps (internal/module.ts), WebhookService + WebhookConfig + FlakyDetector (back-compat classes), 5 schemas (webhookCreateRequest + webhook + webhookDeliveryPayload + dlqJob + dlqListResponse) + 5 derived TS types, reportingRegistry + REPORTING_EVENT_NAMES + REPORTING_AGGREGATE_ID + makeReportingEmitters + 4 payload schemas + 3 event types, 2 queue-name constants + registerWebhookDeliveryWorkers + 2 queue types. Does NOT export registerReportingRoutes (plugin-internal). Does NOT use `export *`.
- 2 test files renamed via `git mv` with 100% similarity (byte-identical content — blame history preserved through Git's rename detection). All 19 tests (7 flaky-detector + 12 junit-generator) still pass green. Vitest root-include glob already covered both extensions.
- Nyquist delta captured: current lines **56.48%** vs Phase 15 baseline **48.29%** = **+8.19pp**. Well above -2pp gate threshold. Baseline file NOT modified (verified via pre/post diff).
- ROADMAP §Phase 19 SC1-SC4 verified end-to-end (see Verification Evidence below).
- Phase 19 is CLOSED (plans 19-00 through 19-06 all shipped). EVENTS-07 + QUEUE-05 requirements complete.

## Task Commits

1. **Task 6.1: Create server/reporting/MODULE.md** — `ac1743a` (docs)
   - 114 lines, 1291 words
   - All 9 H2 sections present in canonical order (verified by loop in <verify>)
   - EVENTS-07 referenced 3 times (Events Emitted + Invariants + Non-Goals)
   - webhook.failed.retryExhausted mentioned 4 times
   - REPORTING_AGGREGATE_ID referenced 4 times
   - All 4 event names listed with persisted flags
   - Dependencies array matches plugin.ts verbatim
   - H3 Runnable Example present (Phase 27 MOD-09 typecheck extension point)
2. **Task 6.2: Create server/reporting/index.ts barrel (MOD-02)** — `d72a1a5` (feat)
   - 75 lines, 11 named export statements
   - EXACTLY ONE `from './internal/` re-export line (grep count = 1)
   - Inline `type` modifier form: `export { createReportingModule, type ReportingModule, type CreateReportingModuleDeps } from './internal/module.js';`
   - Does NOT export registerReportingRoutes (grep count = 0 for `^export.*registerReportingRoutes`)
   - Does NOT use `export *` (grep count = 0)
   - `npx tsc --noEmit` adds ZERO errors attributable to reporting/index.ts or MODULE.md or renames
   - `npm run dep-check` adds ZERO new violations (pre-existing jobs/plugin.ts violation remains — Phase 23 scope)
3. **Task 6.3: Rename test files .test.ts -> .spec.ts** — `7568215` (refactor)
   - 2 files via `git mv` (100% rename similarity preserved blame)
   - Content byte-identical
   - All 19 tests still pass (7 + 12) in 312ms
   - `git log --follow` on flaky-detector.spec.ts shows history back to commit `915b970` (Phase 06 original authorship)
4. **Task 6.4: Run Nyquist delta gate + document deferrals** — (this SUMMARY.md + deferred-items.md update + final metadata commit)
   - Nyquist capture via Phase 18 exclusion set; coverage-summary.json emitted cleanly
   - Delta: +8.19pp (56.48% - 48.29%)
   - Baseline file unchanged (diff returned 0)
   - Phase 19 pre-existing envelope documented in deferred-items.md (6+2 typecheck, 1 dep-check, 31 tests, 1 spec hang)

## Files Created/Modified

### Created

- `server/reporting/MODULE.md` (114 lines) — MOD-01 LLM-first contract
- `server/reporting/index.ts` (75 lines) — MOD-02 public barrel
- `.planning/phases/19-reporting-migration-webhooks-dlq/19-06-SUMMARY.md` (this file)

### Renamed (via `git mv`, 100% similarity)

- `server/reporting/__tests__/flaky-detector.test.ts` -> `flaky-detector.spec.ts`
- `server/reporting/__tests__/junit-generator.test.ts` -> `junit-generator.spec.ts`

### Modified

- `.planning/phases/19-reporting-migration-webhooks-dlq/deferred-items.md` — added Plan 19-06 section documenting: (a) 6+2 pre-existing typecheck errors (6 Phase 15 Map-vs-RequestContext + 2 working-tree artifacts edits); (b) 1 pre-existing dep-check violation (jobs/plugin.ts → bus/bus.ts, Phase 23 scope); (c) 31 pre-existing test failures + 1 spec hang (Phase 17 fastify-zod-openapi v5 JSON Schema bug); (d) Nyquist exclusion pattern inherited from Phase 18 Plan 18-04 precedent.

## Verification Evidence

### ROADMAP §Phase 19 success criteria — all 4 met

- [x] **SC1**: Five consecutive 500 responses produce a single DLQ row + terminal `webhook.failed.retryExhausted` event — **Plan 19-04** `queue.spec.ts` [SC1]. retryLimit:5 + retryBackoff:true verified in queue.ts (plan 19-03) and documented in MODULE.md Queue Produced section.
- [x] **SC2**: `GET /api/queue/dlq` lists dead-lettered jobs with full shape (id, queue, state, retrycount, data, output, createdon, correlation_id) — **Plan 19-05** `dlq-route.spec.ts` [QUEUE-05]. OpenAPI codegen via fastify-zod-openapi emits DlqListResponse + DlqJob to `server/openapi.json` (plan 19-05).
- [x] **SC3**: Reporting module follows Phase 16 conventions:
  - `MODULE.md` (9 H2 sections) — **Plan 19-06 Task 6.1**
  - Public barrel `index.ts` (MOD-02) — **Plan 19-06 Task 6.2**
  - `events.ts` (MOD-03) — Plan 19-01
  - `queue.ts` (QUEUE-06) + DLQ (QUEUE-05) — Plan 19-03
  - `internal/module.ts` factory (MOD-06) — Plan 19-03
  - File naming `.spec.ts` (MOD-04 file-naming layer) — Plan 19-00 (webhook-service) + **Plan 19-06 Task 6.3** (flaky-detector + junit-generator)
  - Nyquist delta: +8.19pp (well within -2pp budget) — **Plan 19-06 Task 6.4**
  - (Describe-tree alignment (MOD-04 tests-as-spec) deferred to Phase 30 repo-wide migration — matches Phase 18 precedent)
- [x] **SC4**: Single correlationId threads through ALS fiber → queue.send → 5 retries → DLQ row → events-table terminal row — **Plan 19-04** `correlation.spec.ts` [SC4]. Documented as invariant (c) in MODULE.md Invariants section.

### Reporting test suite (all 9 spec files, 59 tests green)

```
$ DATABASE_URL=... npx vitest run server/reporting/__tests__/ --reporter=default

 ✓ server/reporting/__tests__/events.spec.ts
 ✓ server/reporting/__tests__/flaky-detector.spec.ts (7 tests)
 ✓ server/reporting/__tests__/junit-generator.spec.ts (12 tests)
 ✓ server/reporting/__tests__/module.spec.ts
 ✓ server/reporting/__tests__/webhook-service.spec.ts
 ✓ server/reporting/__tests__/dlq-route.spec.ts (3 tests)   DB-gated
 ✓ server/reporting/__tests__/queue.spec.ts                 DB-gated
 ✓ server/reporting/__tests__/correlation.spec.ts (1 test)  DB-gated 22179ms
 ✓ server/reporting/__tests__/terminal-event.spec.ts (1 test) DB-gated 22180ms

 Test Files  9 passed (9)
      Tests  59 passed (59)
   Duration  22.66s
```

### Gate commands

```
$ npm run lint
(no output — clean)

$ npm run dep-check
  error no-direct-bus-emit-outside-events-ts: server/jobs/plugin.ts → server/bus/bus.ts
x 1 dependency violations (1 errors, 0 warnings). 215 modules, 524 dependencies cruised.
(the 1 violation is pre-existing from Plan 19-01 jobs bridgehead — Phase 23 scope)

$ npx tsc --noEmit
(6 pre-existing + 2 working-tree errors — all reproduced at HEAD~5; 0 new from plan 19-06;
 documented in deferred-items.md Plan 19-06 section)
```

### Nyquist delta

```
$ CONTRACTS_CHECK_SPEC=skip DATABASE_URL=... npx vitest run --coverage \
    --exclude='server/api/__tests__/routes.test.ts' \
    --exclude='server/api/__tests__/artifact-routes.test.ts' \
    --exclude='server/auth/__tests__/auth-plugin.test.ts' \
    --exclude='server/__tests__/plugin-order.spec.ts'

=============================== Coverage summary ===============================
Statements   : 54.95% ( 2481/4515 )
Branches     : 38.5% ( 787/2044 )
Functions    : 54.31% ( 441/812 )
Lines        : 56.48% ( 2392/4235 )
================================================================================

$ npm run nyquist:check
baseline.lines = 48.29, current.lines = 56.48, delta = 8.19pp
OK: coverage within -2pp of baseline
```

Baseline preservation verified:
```
$ diff /tmp/nyquist-baseline-19-06.bak .planning/nyquist-baseline.json
(no output — baseline unchanged)
```

Reporting-module-specific coverage snapshot:
```
server/reporting        |   87.83 |    62.66 |      84 |   88.02
  flaky-detector.ts     |   95.83 |    84.61 |     100 |     100
  junit-generator.ts    |     100 |    71.42 |     100 |     100
  queue.ts              |   92.85 |    41.66 |     100 |   92.85
  routes.ts             |     100 |    64.28 |     100 |     100
server/reporting/internal |   75.47 |    77.77 |    87.5 |    74.5
  module.ts             |   75.47 |    77.77 |    87.5 |    74.5
```

## Phase 19 Roll-up — All 7 plans (19-00 through 19-06)

| Plan  | Wave | Duration | Deliverables                                                                                                                                                                         | New tests            |
| ----- | ---- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------- |
| 19-00 | 0    | 13 min   | QUEUE_NAMES (webhook.deliver + webhook.deliver.dlq) + schemas (webhookDeliveryPayload + dlqJob + dlqListResponse) + dep-cruiser rule (no-deep-imports-into-reporting-internal) + internal/module.ts stub + failing-server fixture + webhook-service.test.ts -> .spec.ts rename | —                    |
| 19-01 | 1    | 12 min   | server/reporting/events.ts (4 events, MOD-03, TRACE-04, TRACE-08) + server/jobs/events.ts bridgehead (job.completed) + job-service bus emit                                                                                                                                  | events.spec.ts       |
| 19-02 | 1    | 9 min    | WebhookService.deliverOnce single-attempt HTTP POST (throws on 5xx, resolves on 2xx/4xx); in-process deliver() retry loop DELETED                                                                                                                                              | webhook-service.spec.ts |
| 19-03 | 2    | 9 min    | queue.ts (registerWebhookDeliveryWorkers main + DLQ) + internal/module.ts factory (MOD-06 createReportingModule) + thin plugin.ts rewire + old reporting-plugin.ts DELETED                                                                                                    | module.spec.ts       |
| 19-04 | 2    | 6 min    | DB-gated proofs: queue.spec.ts (SC1) + correlation.spec.ts (SC4) + terminal-event.spec.ts (EVENTS-07) + plugin-order.spec.ts extension                                                                                                                                         | 3 DB-gated specs     |
| 19-05 | 2    | 17 min   | server/reporting/routes.ts (GET /api/queue/dlq + Zod response via fastify-zod-openapi) + openapi.json regen + 3 plan-19-04 specs unblocked with Zod validator install                                                                                                          | dlq-route.spec.ts    |
| 19-06 | 3    | 7 min    | MODULE.md (MOD-01 9 sections) + index.ts barrel (MOD-02 one internal re-export) + 2 *.test.ts -> *.spec.ts renames (MOD-04 file-naming) + Nyquist delta +8.19pp                                                                                                                | — (renames only)     |
| **TOTAL** | — | **73 min** | Reporting module fully migrated; EVENTS-07 + QUEUE-05 shipped; Phase 19 CLOSED                                                                                                           | **5 new + 4 renamed** |

Phase 19 final test count: 9 reporting spec files / 59 tests — all green in 22.66s.

## Decisions Made

1. **MOD-02 strict 1-line internal/ re-export** — Plan 19-06 adopts the Phase 18 lifecycle precedent. Inline `type` modifier keeps createReportingModule + ReportingModule + CreateReportingModuleDeps on one statement. Functionally identical to hooks' 2-line form but passes `grep -c "from './internal/" = 1` invariant.

2. **MOD-04 file-naming only (describe-tree alignment deferred)** — Plan 19-06 renames `.test.ts -> .spec.ts` via `git mv` (byte-identical content). Rewriting describe blocks to match MODULE.md invariants (a)-(f) would be a cross-cutting repo-wide migration; belongs to Phase 30. Keeping the scope tight lets plan 19-06 close Phase 19 cleanly.

3. **Barrel does NOT export registerReportingRoutes** — Routes are plugin-internal (called by reporting/plugin.ts only). Barrel consumers needing route shapes can import DlqJob + DlqListResponse schemas. Matches Phase 16 hooks barrel pattern (hooks/index.ts also does not export its route registration).

4. **Nyquist capture with 4 pre-existing broken test files excluded** — Same 4 files as Phase 18 Plan 18-04 (routes.test, artifact-routes.test, auth-plugin.test, plugin-order.spec). Phase 17 fastify-zod-openapi v5 `required` emission bug still present. Exclusion is necessary for vitest v4 to emit coverage-summary.json. Documented with suggested hotfix options.

5. **Baseline file preserved** — Backed up to `/tmp/nyquist-baseline-19-06.bak` before capture; `diff` verified unchanged afterwards. Baseline remains frozen at Phase 15 substrate (commit `55ff8ac`, 48.29% lines). Overwriting would make the gate trivially pass against itself.

## Deviations from Plan

**None** at the plan-specified scope. Plan 19-06 executed all 4 tasks as written.

### Scope-boundary discoveries (documented in deferred-items.md, NOT fixed)

1. **8 total typecheck errors (6 pre-existing committed + 2 working-tree edits)** — All reproduced at HEAD~5. Zero new errors attributable to plan 19-06 files (MODULE.md, index.ts, renames). Out of scope per SCOPE BOUNDARY rule.
2. **1 pre-existing dep-check violation** (server/jobs/plugin.ts → server/bus/bus.ts) — documented by Plan 19-03 deferred-items.md section; Phase 23 Jobs Module Keystone scope.
3. **31 pre-existing test failures + 1 spec hang** — Phase 17 fastify-zod-openapi v5 bug. Not caused by Plan 19-06. Same root cause + workaround as Phase 18 Plan 18-04.
4. **2 working-tree-uncommitted changes** (artifacts/recording-service.ts + .test.ts, maestro-parser.ts, cli/dependencies.go, web/.svelte-kit/) — pre-existing uncommitted edits per Plan 19-01 deferred-items.md section, NOT touched by any Phase 19 plan.

## Issues Encountered

**None** during planned work. All 4 tasks executed atomically with verification green at each step. The pre-existing failures surfaced during the final gate runs were all verified as pre-existing and logged per the SCOPE BOUNDARY rule.

## User Setup Required

None — no external service configuration required for this plan. (Phase 20 pre-work: consider running the suggested fastify-zod-openapi v5 `required` emission hotfix to unblock 31 currently-failing tests.)

## Next Phase Readiness

- **Phase 19 is CLOSED**: plans 19-00 (substrate) + 19-01 (events.ts / MOD-03 + jobs bridgehead) + 19-02 (WebhookService.deliverOnce) + 19-03 (queue.ts + internal/module.ts MOD-06 + thin plugin.ts) + 19-04 (DB-gated proofs SC1/SC4/EVENTS-07 + plugin-order) + 19-05 (routes.ts QUEUE-05 HTTP + openapi regen) + 19-06 (MODULE.md / MOD-01 + index.ts / MOD-02 + file renames / MOD-04 + Nyquist gate).
- **EVENTS-07 requirement: CLOSED** (webhook.failed.retryExhausted terminal event persisted to events table from DLQ worker).
- **QUEUE-05 requirement: CLOSED** (webhook.deliver.dlq queue + GET /api/queue/dlq HTTP endpoint + Zod-typed OpenAPI contract).
- **ROADMAP §Phase 19 success criteria SC1-SC4: all satisfied end-to-end.**
- **Next:** `/gsd:execute-phase 20` (Pool Module — device lifecycle events). Phase 20 will benefit from Phase 19's pattern trilogy (hooks + lifecycle + reporting) as a strongly-proven template.

### Recommended standalone hotfix before Phase 20 kickoff

A small hotfix plan (call it 17-09 or route through Phase 20 Wave 0) should address the fastify-zod-openapi v5 `required` emission bug blocking 31 tests + the contracts:check spec hang. Options per deferred-items.md:

1. Upstream patch to fastify-zod-openapi v5.
2. Ajv `required` normalisation shim in server/index.ts' setValidatorCompiler.
3. Pin fastify-zod-openapi back to v4 (loses Zod 4 native JSON Schema emit capability Phase 17 Plan 17-03 adopted).

This is the third consecutive phase (17 → 18 → 19) inheriting this deferred item; a proactive hotfix would save future phases from the same exclusion-set footwork.

## Self-Check: PASSED

Verified via script:
- 3/3 files exist (MODULE.md, index.ts, 19-06-SUMMARY.md)
- 2/2 renamed *.spec.ts files correctly present
- 2/2 original *.test.ts files correctly absent
- 3/3 commit hashes present in git log (ac1743a, d72a1a5, 7568215)

---
*Phase: 19-reporting-migration-webhooks-dlq*
*Completed: 2026-04-21*
