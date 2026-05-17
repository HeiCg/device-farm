---
phase: 20-pool-module-devices
plan: 00
subsystem: infra
tags: [pool, pg-boss, dep-cruiser, events, queue-names, mod-02, mod-03, mod-05]

# Dependency graph
requires:
  - phase: 19-reporting-migration-webhooks-dlq
    provides: "Canonical Wave-0 substrate pattern (QUEUE_NAMES extension + events.ts/queue.ts/internal/module.ts/MODULE.md/index.ts stubs + dep-cruiser 4th-rule template)"
  - phase: 18-lifecycle-migration-node-cron-pg-boss
    provides: "4-line throw-stub empirical finding (depcruise 17.x silently drops unresolvable imports before rule-matching — stub required for rule to fire)"
  - phase: 16-pilot-module-hooks
    provides: "MOD-02 dep-cruiser rule template + fixture + two-pass (err + json) spec pattern"
provides:
  - QUEUE_NAMES.DEVICE_BOOT ('device.boot') constant for Phase 23 jobs keystone forward-compat
  - QUEUE_NAMES.DEVICE_REAP ('device.reap') constant for Phase 20 Plan 20-03 reaper schedule
  - server/pool/events.ts POOL_EVENT_NAMES stub (4 dotted past-tense EVENTS-03 names) + POOL_AGGREGATE_ID placeholder + empty poolRegistry — body lands in 20-01
  - server/pool/queue.ts DEVICE_REAP_QUEUE_NAME / DEVICE_BOOT_QUEUE_NAME / REAP_CRON constants — factory body lands in 20-03
  - server/pool/internal/module.ts 4-line throw-stub (resolvable dep-cruiser target; overwritten in 20-03)
  - server/pool/MODULE.md placeholder (9-section body lands in 20-05)
  - server/pool/index.ts barrel stub with single internal/ re-export (MOD-02 invariant)
  - server/pool/__tests__/events.spec.ts 1-test stub (extended in 20-01)
  - .dependency-cruiser.cjs 4th forbidden rule no-deep-imports-into-pool-internal (MOD-02 structural enforcement)
  - __fixtures__/dep-cruiser/bad-pool-deep-import.ts fixture proving rule fires
  - server/hooks/__tests__/dep-cruiser.spec.ts 4th it-block [MOD-02 pool extension]
affects: [20-01-events-body, 20-02-emission-sites, 20-03-factory-plugin-rewire, 20-04-db-gated-proofs, 20-05-module-md-barrel-nyquist, 20-06-phase-close, 23-jobs-keystone]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Wave-0 substrate replication: 4-task template (QUEUE_NAMES extension → events+spec stubs → queue+internal+MODULE+index stubs → dep-cruiser rule+fixture+spec) identical in shape to Phase 18-00 + Phase 19-00 — fourth consecutive Wave 0 landing cleanly in one plan"
    - "4-line throw-stub at */internal/module.ts required for dep-cruiser rule to fire (Phase 18/19 empirical finding reaffirmed — depcruise 17.3.10 silently drops unresolvable imports before rule-matching)"
    - "Additive 4th it-block inside existing dep-cruiser spec describe block — shared CONFIG / INCLUDE_ONLY_OVERRIDE / spawnSync constants, no setup duplication"

key-files:
  created:
    - server/pool/events.ts
    - server/pool/queue.ts
    - server/pool/internal/module.ts
    - server/pool/MODULE.md
    - server/pool/index.ts
    - server/pool/__tests__/events.spec.ts
    - __fixtures__/dep-cruiser/bad-pool-deep-import.ts
  modified:
    - server/queue/names.ts
    - .dependency-cruiser.cjs
    - server/hooks/__tests__/dep-cruiser.spec.ts

key-decisions:
  - "QUEUE_NAMES alphabetical ordering: DEVICE_BOOT + DEVICE_REAP inserted BETWEEN DEMO and HOOK_RUN (D-E-M-O < D-E-V < H-O-O-K) — matches Phase 18 + Phase 19 precedent; constants pass pg-boss v12 regex ^[a-z][a-z0-9._-]*$"
  - "DEVICE_BOOT exports NAME constant only in Phase 20 — NOT registered as a queue (no consumer; pg-boss v12 would trap sends on unregistered queues). Registration lands in Phase 23 jobs keystone when consumer materialises."
  - "DEVICE_REAP will replace processTracker.startReaper setInterval via boss.schedule('device.reap', '* * * * *') in Plan 20-03 — Wave 0 just exports constants; plan 20-03 owns the factory body + schedule"
  - "POOL_AGGREGATE_ID placeholder '00000000-0000-5000-8000-000000000020' shipped as stub per plan directive — Plan 20-01 replaces with v5 UUID derivation of 'pool' under URL namespace (matches Phase 18 LIFECYCLE_AGGREGATE_ID / Phase 19 REPORTING_AGGREGATE_ID pattern)"
  - "server/pool/index.ts barrel adopts Phase 18/19 1-line internal/ re-export form (single export statement), not Phase 16 hooks' 2-line form — fourth module adopting the tighter invariant"
  - "Zero runtime changes to pool-manager.ts / device.ts / health-checker.ts / process-tracker.ts / plugin.ts — these ship in plans 20-02 and 20-03 per phase wave plan"

patterns-established:
  - "Wave-0 substrate continuity: Phase 20-00 is the fourth in a trilogy-plus-one (16 pilot → 18 lifecycle → 19 reporting → 20 pool). Identical 4-task structure, identical file shape, identical dep-cruiser rule shape. Template now fully validated for Phase 21+ modules (artifacts/streaming/jobs)."
  - "4-line throw-stub at internal/module.ts lands in Wave 0, dep-cruiser rule references it, and Wave 2/3 overwrites with real factory — preserves rule enforcement from the moment real internal/ code materialises without requiring a second config roundtrip"

requirements-completed: [MOD-02, MOD-03, MOD-05, QUEUE-06]

# Metrics
duration: 7min
completed: 2026-04-21
---

# Phase 20 Plan 00: Pool Module Wave-0 Substrate Summary

**Wave-0 substrate for the pool module — QUEUE_NAMES gains DEVICE_BOOT + DEVICE_REAP constants; server/pool/ gains events.ts + queue.ts + internal/module.ts + MODULE.md + index.ts + events.spec.ts stubs; dep-cruiser gains a fourth forbidden rule with fixture + spec — unblocking plans 20-01 through 20-05.**

## Performance

- **Duration:** 7min
- **Started:** 2026-04-21T20:03:49Z
- **Completed:** 2026-04-21T20:11:37Z
- **Tasks:** 4
- **Files created:** 7
- **Files modified:** 3

## Accomplishments

- `QUEUE_NAMES` extended from 7 → 9 entries; `DEVICE_BOOT` + `DEVICE_REAP` both pass the pg-boss v12 charset regex and existing `names.spec.ts` validator
- `server/pool/events.ts` stub lands with `POOL_EVENT_NAMES` (4 dotted past-tense EVENTS-03 names: `device.state.changed` / `device.allocated` / `device.released` / `device.health.failed`), `POOL_AGGREGATE_ID` placeholder, and empty `poolRegistry` placeholder — ready for Plan 20-01 to drop in payload schemas + `makePoolEmitters`
- `server/pool/queue.ts` constants-only stub exports `DEVICE_REAP_QUEUE_NAME`, `DEVICE_BOOT_QUEUE_NAME`, and `REAP_CRON = '* * * * *'` — ready for Plan 20-03 `registerPoolQueues` factory
- `server/pool/internal/module.ts` 4-line throw-stub makes the dep-cruiser rule resolvable (Phase 18/19 empirical pattern — depcruise 17.3.10 silently drops unresolvable imports before rule-matching)
- `server/pool/MODULE.md` placeholder (1 H2 section) + `server/pool/index.ts` barrel stub (1 internal/ re-export) satisfy file-existence checks in Plans 20-01 through 20-04 — full 9-section MODULE.md + full public surface land in Plan 20-05
- `.dependency-cruiser.cjs` gains a fourth forbidden rule `no-deep-imports-into-pool-internal` mirroring hooks / lifecycle / reporting; scope regex `pathNot: '^server/pool/'` → `path: '^server/pool/internal/'` matches prior rules verbatim (just s/reporting/pool/)
- `__fixtures__/dep-cruiser/bad-pool-deep-import.ts` fixture fires the new rule when depcruise runs against it; `server/hooks/__tests__/dep-cruiser.spec.ts` grows a fourth `[MOD-02 pool extension]` it-block reusing the two-pass (err + json) pattern — all 4 it-blocks green

## Task Commits

1. **Task 0.1: Extend QUEUE_NAMES with DEVICE_BOOT + DEVICE_REAP** — `f76577f` (feat)
2. **Task 0.2: Create server/pool/events.ts stub + pool/__tests__/events.spec.ts stub** — `44deba6` (feat)
3. **Task 0.3: Create server/pool/queue.ts stub + internal/module.ts throw-stub + MODULE.md placeholder + index.ts barrel stub** — `dffe901` (feat)
4. **Task 0.4: Add no-deep-imports-into-pool-internal rule to .dependency-cruiser.cjs + fixture + spec extension** — `4c77761` (feat)

## Files Created/Modified

- `server/queue/names.ts` — added DEVICE_BOOT + DEVICE_REAP constants + Phase 20 doc-comment section
- `server/pool/events.ts` *(new)* — POOL_EVENT_NAMES + POOL_AGGREGATE_ID + poolRegistry placeholder
- `server/pool/queue.ts` *(new)* — DEVICE_REAP_QUEUE_NAME / DEVICE_BOOT_QUEUE_NAME / REAP_CRON constants
- `server/pool/internal/module.ts` *(new)* — createPoolModule throw-stub
- `server/pool/MODULE.md` *(new)* — placeholder (1 H2 section)
- `server/pool/index.ts` *(new)* — barrel stub (1 internal/ re-export)
- `server/pool/__tests__/events.spec.ts` *(new)* — 1-test shape spec
- `.dependency-cruiser.cjs` — 4th forbidden rule + header-comment bump to 5 rules
- `__fixtures__/dep-cruiser/bad-pool-deep-import.ts` *(new)* — fixture triggering the new rule
- `server/hooks/__tests__/dep-cruiser.spec.ts` — 4th `[MOD-02 pool extension]` it-block + POOL_FIXTURE constant

## Decisions Made

- **Alphabetical ordering preserved** — DEVICE_BOOT + DEVICE_REAP between DEMO and HOOK_RUN. Rationale: four consecutive phases (16 / 18 / 19 / 20) have extended QUEUE_NAMES with alphabetical inserts; consistency beats any reordering cleverness.
- **DEVICE_BOOT name-only (not registered)** — Phase 20 has no consumer for `device.boot`; pg-boss v12 would trap `boss.send('device.boot', ...)` calls on an unregistered queue. Registration + worker + schedule all land in Phase 23 jobs keystone when a real boot event producer + consumer pair materialise.
- **POOL_AGGREGATE_ID placeholder** — plan directive explicitly allows a placeholder v5 UUID in Wave 0; Plan 20-01 finalises with `uuidv5('pool', NAMESPACE_URL)` + asserts the derivation in a spec. Matches the Phase 19 REPORTING_AGGREGATE_ID / Phase 18 LIFECYCLE_AGGREGATE_ID pattern.
- **1-line internal/ re-export in index.ts** — chose Phase 18 lifecycle / Phase 19 reporting stricter form over Phase 16 hooks' 2-line form. Plan 20-05 will extend the barrel with back-compat class exports + reporting-plugin-style re-export, but the MOD-02 structural invariant (`grep -c "from './internal/" = 1`) holds from the substrate onward.
- **Pre-existing dep-check violation left in place** — `server/jobs/plugin.ts → server/bus/bus.ts` reports a `no-direct-bus-emit-outside-events-ts` violation on the committed codebase (introduced Phase 19 Plan 19-01 jobs bridgehead, documented in STATE.md; Phase 23 scope). Per SCOPE BOUNDARY rule: out-of-scope for Plan 20-00. Confirmed pre-existing via `git stash` round-trip.

## Deviations from Plan

None — plan executed exactly as written. All 4 tasks landed verbatim from the plan spec.

## Issues Encountered

None.

## Self-Check

**Files verified on disk:**

- FOUND: `server/pool/events.ts`
- FOUND: `server/pool/queue.ts`
- FOUND: `server/pool/internal/module.ts`
- FOUND: `server/pool/MODULE.md`
- FOUND: `server/pool/index.ts`
- FOUND: `server/pool/__tests__/events.spec.ts`
- FOUND: `__fixtures__/dep-cruiser/bad-pool-deep-import.ts`

**Commits verified in git log:**

- FOUND: `f76577f` Task 0.1 QUEUE_NAMES extension
- FOUND: `44deba6` Task 0.2 pool events stubs
- FOUND: `dffe901` Task 0.3 pool substrate stubs
- FOUND: `4c77761` Task 0.4 dep-cruiser pool rule

**Verification gates:**

- `npx tsc --noEmit` — 8 pre-existing errors (documented in STATE.md envelope: 6 Phase 15 Map-vs-RequestContext + 2 working-tree `artifacts/recording-service.ts` edits), ZERO new errors from plan 20-00 files
- `npm run dep-check` — 1 pre-existing violation (jobs/plugin.ts → bus/bus.ts, Phase 23 scope); ZERO new pool-internal violations
- `npx vitest run server/pool/__tests__/events.spec.ts` — 1 test pass
- `npx vitest run server/hooks/__tests__/dep-cruiser.spec.ts` — 4 tests pass (hooks + lifecycle + reporting + pool)
- `npx vitest run server/queue/__tests__/names.spec.ts` — 6 tests pass (new DEVICE_* constants accepted by validator)
- `npm run lint` — No issues found

**Runtime-pool-files-untouched invariant:** `git log --oneline main..HEAD -- server/pool/pool-manager.ts server/pool/device.ts server/pool/health-checker.ts server/pool/process-tracker.ts server/pool/plugin.ts` returns empty — zero runtime changes (ships in Plans 20-02 + 20-03).

## Self-Check: PASSED

## Next Phase Readiness

- **Plan 20-01 (events body)** unblocked — extends `events.ts` with 4 payload Zod schemas + `poolRegistry` entries + `makePoolEmitters` + finalises `POOL_AGGREGATE_ID` v5 UUID derivation
- **Plan 20-02 (emission sites)** unblocked — wires PoolManager state transitions + HealthChecker probe failures to `makePoolEmitters` emit helpers
- **Plan 20-03 (factory + plugin rewire)** unblocked — overwrites `server/pool/internal/module.ts` throw-stub with real `createPoolModule` factory; adds `registerPoolQueues` body; `device.reap` schedule replaces `processTracker.startReaper` setInterval; dep-cruiser rule enforces MOD-02 boundary structurally from the moment real `internal/` code lands
- **Plans 20-04 (DB-gated proofs) + 20-05 (MODULE.md + barrel + Nyquist) + 20-06 (phase close)** unblocked — substrate file-existence checks satisfied; Nyquist baseline (Phase 15 frozen) preserved
- **Pattern trilogy matured:** Wave-0 substrate is now a 4-module template (hooks / lifecycle / reporting / pool). Phase 21 (artifacts) and Phase 22 (streaming) can copy this plan nearly verbatim with s/pool/artifacts|streaming/
- **Concerns inherited from Phase 19:** fastify-zod-openapi v5 `required` emission bug (31 pre-existing test failures + contracts:check hang) still present; documented in Phase 19 deferred-items.md; Phase 20 Plan 20-04 DB-gated proofs may need the same harness unblock pattern as Plan 19-04/19-05 applied

---
*Phase: 20-pool-module-devices*
*Completed: 2026-04-21*
