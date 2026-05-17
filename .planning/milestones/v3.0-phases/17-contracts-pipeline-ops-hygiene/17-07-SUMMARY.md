---
phase: 17-contracts-pipeline-ops-hygiene
plan: 07
subsystem: infra
tags: [fastify, plugin-graph, dependencies, debt-01, invariants, vitest]

# Dependency graph
requires:
  - phase: 17-contracts-pipeline-ops-hygiene
    provides: "17-VERIFICATION gap list (SC5 dep-graph items) — identified the two undeclared dep edges closed here"
  - phase: 15-fix-operational-dependencies
    provides: "plugin-order.spec.ts substrate invariant test (15-06)"
provides:
  - "websocket-plugin now declares pool-plugin in dependencies array"
  - "api plugin now declares lifecycle-plugin in dependencies array"
  - "plugin-order.spec.ts locks two new dep-graph invariants (ws > pool, api > lifecycle)"
  - "Honest plugin dep graph: future encapsulate:true boot no longer fails on these two edges"
affects: [future-encapsulation-work, debt-01-plugin-rename, phase-22-streaming, phase-23-jobs]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Fastify `dependencies:` arrays reflect actual decorator reads, not legacy placeholders"
    - "plugin-order.spec.ts locks dep-graph edges per-plan as invariants (additive, never weakening)"

key-files:
  created: []
  modified:
    - "server/streaming/websocket-plugin.ts — added 'pool-plugin' to dependencies"
    - "server/api/plugin.ts — appended 'lifecycle-plugin' to dependencies"
    - "server/__tests__/plugin-order.spec.ts — 3 new assertion lines (ws > pool, api > lifecycle, lifecycle present)"

key-decisions:
  - "Only dependency arrays were edited; plugin name renames (pool-plugin → pool, etc.) deferred to a future DEBT-01 targeted plan per plan scope boundary"
  - "lifecycle-plugin appended at the END of api's deps array (Fastify dependencies is a set, not a sequence — minimal diff)"
  - "Inline comment above websocket-plugin dep array documents WHY pool-plugin is listed (devicePreview/pool ownership link) — future-reader context without imposing code structure changes"
  - "Test assertions placed INSIDE the existing 'substrate plugins before application plugins' test (not a new it-block) — keeps the entire dep-graph story in one boot listing"

patterns-established:
  - "Pattern 1: Per-plan dep-graph invariant additions — append-only in plugin-order.spec.ts with a comment naming the owning plan"
  - "Pattern 2: Inline WHY-comment above the edited Fastify options object when a dep-edge is non-obvious from reading the plugin body alone"

requirements-completed: [DEBT-01]

# Metrics
duration: 3min
completed: 2026-04-20
---

# Phase 17 Plan 07: Plugin dep-graph gap closure Summary

**Closed the two remaining Phase 17 SC5 plugin-dep-graph gaps (websocket → pool, api → lifecycle) by adding dependency strings to the existing `dependencies:` arrays — no plugin renames, two new invariants locked.**

## Performance

- **Duration:** 3 min
- **Started:** 2026-04-20T20:05:14Z
- **Completed:** 2026-04-20T20:08:15Z
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments
- `server/streaming/websocket-plugin.ts` now declares `'pool-plugin'` in its `dependencies:` array (alongside existing `'config'`, `'auth'`) — matches the actual decorator read (WS `/ws/devices/:id/preview` subscribes to `devicePreview` keyed on a pool-state-machine `deviceId`)
- `server/api/plugin.ts` now declares `'lifecycle-plugin'` in its `dependencies:` array (alongside existing 8 deps) — matches the actual read at `server/api/routes.ts:439` of `fastify.lifecycleStats` decorated by `server/lifecycle/lifecycle-plugin.ts:33`
- `server/__tests__/plugin-order.spec.ts` extended with 3 new assertion lines locking: (1) `indexOf('websocket-plugin') > indexOf('pool-plugin')`, (2) `indexOf('lifecycle-plugin') > -1`, (3) `indexOf('api') > indexOf('lifecycle-plugin')`
- All 8 existing invariants preserved unchanged (correlation, event-bus > correlation, queue > event-bus, telemetry > queue, pool-plugin > telemetry, job-plugin > telemetry, db > -1, db < event-bus, db < queue)
- Spec still passes green in ~6s against test DB (1 test, 1 passed)

## Task Commits

Each task was committed atomically:

1. **Task 1: Add 'pool-plugin' to websocket-plugin dependencies array** — `a407ea3` (chore)
2. **Task 2: Add 'lifecycle-plugin' to api/plugin.ts dependencies array** — `43a5585` (chore)
3. **Task 3: Extend plugin-order.spec.ts with 2 new invariants** — `2769d27` (test)

**Plan metadata commit:** (next — docs for SUMMARY.md + STATE.md + ROADMAP.md)

_Note: Other 17-0x plans (17-03, 17-05, 17-06) committed in parallel between my task commits on the same branch — not a concern, each of the three 17-07 commits is atomic and touches only its own file._

## Files Created/Modified
- `server/streaming/websocket-plugin.ts` — dependencies changed from `['config', 'auth']` to `['config', 'auth', 'pool-plugin']`; explanatory comment added above the options object
- `server/api/plugin.ts` — dependencies changed from 8 strings to 9 (appended `'lifecycle-plugin'`)
- `server/__tests__/plugin-order.spec.ts` — 3 new assertion lines inserted before `await app.close();`, with Phase 17 / Plan 17-07 ownership comments

## Decisions Made

- **No plugin renames this plan.** The broader DEBT-01 normalization (`pool-plugin` → `pool`, `job-plugin` → `jobs`, `websocket-plugin` → `websocket`, etc. — see 17-CONTEXT.md §Plugin Naming Normalization) is deferred to a future targeted plan. This plan intentionally only ADDS missing dependency declarations using the CURRENT registered names.
- **Dep direction is one-way:** `api → lifecycle` (api reads `fastify.lifecycleStats`), not the reverse. No reciprocal change was made to `lifecycle-plugin.ts`.
- **Test assertions are additive within the existing `it(...)` block** rather than a new test. Rationale: the entire dep-graph story lives in one `app.printPlugins()` listing; fragmenting it across test blocks would force multiple boot cycles for no new coverage.

## Deviations from Plan

None — plan executed exactly as written.

All three tasks ran in the plan-specified order (ws-plugin → api-plugin → spec extension). The plan's automated verify grep patterns all passed on first try. The acceptance criteria for each task matched what was delivered byte-for-byte. No Rule 1/2/3/4 triggers encountered.

## Issues Encountered

None in-scope. Two minor environmental observations:

1. **Top-level typecheck baseline noise (OUT OF SCOPE per scope boundary):** `npx tsc --noEmit` emits pre-existing errors in 6 unrelated files (`server/artifacts/recording-service.ts`, `server/bus/helpers.ts`, `server/bus/plugin.ts`, `server/events/__tests__/emit-helpers.spec.ts`, `server/hooks/__tests__/events.spec.ts`, `server/pipelines/schema.ts`). None are in the 3 files touched by this plan. STATE already records this baseline (Phase 16 / Plan 16-00 entry: "Typecheck baseline=7 pre-existing top-level errors in unrelated modules"). Logged to `.planning/phases/17-contracts-pipeline-ops-hygiene/deferred-items.md` for a future typecheck-hygiene plan.
2. **`npm run openapi:generate` in this shell fell back to `npx tsx` which fetches a global tsx without local `zod`** — environmental quirk unrelated to this plan's changes (we only edited `dependencies:` array strings, which Fastify treats as set checks, not code paths). Plan 17-01 already proved build-openapi works; our changes cannot regress it because they don't alter code paths, only metadata strings.

## User Setup Required

None — no external service configuration required. The changes are pure metadata edits to existing plugin option objects + test assertions.

## Next Phase Readiness

- **SC5 dep-graph items are now closed:** both undeclared edges identified in 17-VERIFICATION (websocket → pool, api → lifecycle) are declared. Future introduction of Fastify `encapsulate: true` on these plugins will no longer fail-boot due to missing declarations.
- **17-08 (typebench, final) and the broader DEBT-01 plugin-rename plan** both remain open in phase scope. This plan deliberately left plugin names untouched so the rename can be a clean, isolated PR with its own spec coverage.
- **plugin-order.spec.ts** is now the canonical place to lock dep-graph invariants; any future plan adding a new Fastify `dependencies:` string should append an `indexOf(childName) > indexOf(parentName)` line with a comment naming the owning plan.

## Self-Check

Files modified (all verified present with expected content):
- FOUND: server/streaming/websocket-plugin.ts (grep `'pool-plugin'` and `dependencies: \['config', 'auth', 'pool-plugin'\]` both match)
- FOUND: server/api/plugin.ts (grep `'lifecycle-plugin'` and `name: 'api'` both match; all 8 original deps preserved)
- FOUND: server/__tests__/plugin-order.spec.ts (3 new assertion lines + all 8 existing assertions present)

Commits (all verified in git log):
- FOUND: a407ea3 (chore(17-07): declare pool-plugin dep on websocket-plugin)
- FOUND: 43a5585 (chore(17-07): declare lifecycle-plugin dep on api plugin)
- FOUND: 2769d27 (test(17-07): lock two new plugin dep-graph invariants)

Test run:
- FOUND: `npx vitest run server/__tests__/plugin-order.spec.ts` passes green (1 test file, 1 test, 6.19s) against `TEST_DATABASE_URL=postgresql://localhost/device_farm_test`.

## Self-Check: PASSED

---
*Phase: 17-contracts-pipeline-ops-hygiene*
*Completed: 2026-04-20*
