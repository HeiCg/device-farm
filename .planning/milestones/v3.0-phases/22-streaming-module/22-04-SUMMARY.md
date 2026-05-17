---
phase: 22-streaming-module
plan: 04
subsystem: testing
tags: [vitest, regex, structural-tests, plugin-order, sc2, trace-06, mod-02]

# Dependency graph
requires:
  - phase: 22-streaming-module
    provides: "Plan 22-02 7-callsite surgery in job-service.ts (jobBroadcaster.emit → jobsEmit?.log/step/status); Plan 22-02 thin streaming/plugin.ts wirer with 5-entry deps; Plan 22-03 runtime-proof subscriber.spec/correlation.spec/envelope.spec"
provides:
  - "server/streaming/__tests__/lifecycle-ownership.spec.ts — 4-test non-DB structural grep-guard locking SC2 invariants"
  - "server/__tests__/plugin-order.spec.ts extension — 4 new Phase 22 assertions inside existing it-block"
  - "wbIndex(haystack, name) word-boundary helper — fixes Phase 20 Plan 20-04 substring-bug for 'websocket-plugin' vs '@fastify/websocket'"
  - "CI-time enforcement that future job-service.ts edits cannot reintroduce imperative jobBroadcaster.emit calls without breaking the structural spec"
  - "CI-time enforcement that streaming/plugin.ts dependencies array stays at canonical 5-entry shape ['config', 'auth', 'pool-plugin', 'event-bus', 'db']"
affects: [Plan 22-05 close-out, Phase 23 jobs-module saga rewrite, future plugin.ts refactors]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Non-DB structural grep-guard spec via readFileSync + regex-count (mirrors Phase 20 pool/__tests__/lifecycle-ownership.spec + Phase 21 artifacts/__tests__/lifecycle-ownership.spec)"
    - "Word-boundary regex helper (?<![\\w-])name(?![\\w-]) to disambiguate hyphen-substring plugin name collisions"
    - "Additive-inside-existing-it-block extension to plugin-order.spec.ts (Phase 18/19/20/21 precedent preserved)"

key-files:
  created:
    - "server/streaming/__tests__/lifecycle-ownership.spec.ts"
  modified:
    - "server/__tests__/plugin-order.spec.ts"

key-decisions:
  - "Used inline `nosemgrep` suppression for new RegExp(pattern) call in countMatches/wbIndex helpers — patterns are hardcoded test strings (not user input), ReDoS not applicable; explicit annotation chosen over rewriting to dispatch table because existing Phase 20/21 lifecycle-ownership specs use the same dynamic-regex pattern"
  - "Migrated only the 1 existing indexOf('websocket-plugin') call to wbIndex (plan estimated 3-4 sites; actual count was 1) — left other indexOf calls (correlation, event-bus, db, queue, etc.) UNCHANGED because their plugin names have no substring collisions with @fastify/* dependency names"
  - "Kept describe/it structure at 1/1 — additive inside existing it-block per Phase 18/19/20/21 precedent ('A single app.printPlugins() boot serves the whole dep-graph story')"

patterns-established:
  - "SC2 structural lock pattern: imperative-emit count == 0 + substitute-emit count >= N + cleanup count == 1 (kept) + substitute-path-existence assertions in module factory"
  - "Word-boundary plugin-name matching for plugin-order assertions when names appear as substrings of @fastify/* package names"

requirements-completed: [TRACE-06, MOD-02]

# Metrics
duration: 4min
completed: 2026-05-08
---

# Phase 22 Plan 04: Wave 4 Structural Guards Summary

**SC2 structurally locked at CI-time via 4-test grep-guard spec; plugin-order.spec extended with Phase 22 5-entry deps + websocket-plugin substring-bug fix via word-boundary regex helper.**

## Performance

- **Duration:** 4 min
- **Started:** 2026-05-08T02:43:21Z
- **Completed:** 2026-05-08T02:47:57Z
- **Tasks:** 2
- **Files modified:** 2 (1 created, 1 modified)

## Accomplishments
- Locked SC2 ("no producer calls broadcaster.emit() directly") at CI-time via 4-test non-DB structural grep-guard
- Locked websocket-plugin canonical 5-entry dependency-array shape at CI-time via plugin-order.spec extension
- Fixed Phase 20 Plan 20-04 substring-bug (indexOf('websocket-plugin') matching inside '@fastify/websocket') via word-boundary `wbIndex` helper
- Phase 22 Wave 4 ships in 4 minutes — fastest plan in Phase 22 to date (vs 22-00 substrate, 22-01 envelope, 22-02 surgery, 22-03 runtime proofs)

## Task Commits

Each task was committed atomically:

1. **Task 4.1: Create streaming/__tests__/lifecycle-ownership.spec.ts (SC2 grep-guard)** — `958e446` (test)
2. **Task 4.2: Extend plugin-order.spec.ts with Phase 22 deps + wbIndex fix** — `6be7238` (test)

## Files Created/Modified

- `server/streaming/__tests__/lifecycle-ownership.spec.ts` (NEW, 105 lines) — 4-test non-DB structural grep-guard. Reads `server/jobs/job-service.ts` + `server/streaming/internal/module.ts` via readFileSync. Asserts: (a) `this.jobBroadcaster?.emit(` count == 0 (SC2 main); (b) `this.jobBroadcaster!.emit(` count == 0 (SC2 main); (c) `jobsEmit?.log()` ≥ 3 + `jobsEmit?.step()` ≥ 2 + `jobsEmit?.status()` ≥ 2, total ≥ 7 (SC2 substitute); (d) `this.jobBroadcaster!.cleanup(` count == 1 (SC2 non-violation per MODULE.md §Non-Goals); (e) `wsEnvelopeSchema.safeParse(` ≥ 1, `jobsModule.bus.on(` ≥ 3, `emit.frameDropped(` ≥ 1, `jobBroadcaster.emit(` ≥ 1 in streaming/internal/module.ts (substitute-path-existence proof).
- `server/__tests__/plugin-order.spec.ts` (MODIFIED, +69/-1 lines) — Added `wbIndex(haystack, name)` helper using word-boundary regex `(?<![\\w-])name(?![\\w-])`. Migrated 1 existing `indexOf('websocket-plugin')` call to `wbIndex(listing, 'websocket-plugin')`. Added 4 new Phase 22 assertions inside existing it-block: (a) `wbIndex('event-bus') < wbIndex('websocket-plugin')`; (b) `wbIndex('db') < wbIndex('websocket-plugin')`; (c) `streaming/plugin.ts` dependencies literal parsed via regex-extract + JSON.parse, asserts `arrayContaining(['config', 'auth', 'pool-plugin', 'event-bus', 'db'])` + `toHaveLength(5)`; (d) grep-friendly literal-array form. Test structure preserved: 1 describe, 1 it-block (additive inside).

## Decisions Made

- **Inline `nosemgrep` suppressions for RegExp(pattern) constructor calls** — semgrep flagged `new RegExp(pattern, 'g')` in `countMatches` and `wbIndex` as ReDoS risk. Patterns are hardcoded test strings (not user input); ReDoS not applicable. Explicit `nosemgrep` annotation referencing the rule ID was chosen over rewriting to a static-pattern dispatch table because existing Phase 20/21 lifecycle-ownership specs use the same dynamic-regex pattern (precedent preserved).
- **Migrated 1 (not 3-4) existing `indexOf('websocket-plugin')` call** — plan estimated 3-4 call sites based on RESEARCH §Pitfall 3, but actual file inspection found only 1 occurrence (line 66 in original spec). The discrepancy is harmless — the only indexOf collision-prone callsite is fully migrated, and the new Phase 22 block uses `wbIndex` from inception. The remaining `indexOf('websocket-plugin')` match in the file (line 36) is inside the `wbIndex` helper's docstring (cited as bug example).
- **Single describe/single it-block preserved** — Plan 22-04 explicitly forbids new it-blocks. All new assertions added inside the existing `it('registers substrate plugins before application plugins')` it-block, after the Phase 21 artifact-plugin block and before `await app.close()`. Matches Phase 18/19/20/21 precedent.

## Deviations from Plan

None — plan executed as written.

The plan estimated 3-4 existing `indexOf('websocket-plugin')` callsites to migrate; actual count was 1. This is not a deviation (the migration target — "all collision-prone callsites" — was achieved); it is a refinement of the planner's estimate. Documented under Decisions Made above.

## Issues Encountered

- **Semgrep PostToolUse hook flagged `new RegExp(pattern, 'g')` in `countMatches` helper as potential ReDoS** — false-positive (patterns are hardcoded test strings, not user input). Resolved by adding `// nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp` annotation above each dynamic RegExp construction site. Same pattern repeated in `wbIndex` helper for consistency.

## User Setup Required

None — no external service configuration required.

## Verification

- **Task 4.1:** `npx vitest run server/streaming/__tests__/lifecycle-ownership.spec.ts` → 4 tests pass in <100ms (no DB required)
- **Task 4.2:** `npx tsc --noEmit` shows 8 pre-existing errors in 6 files (Map-vs-RequestContext + pipelines), 0 new errors from this plan. `npx vitest run server/__tests__/plugin-order.spec.ts` skips cleanly (no DB) — current behavior preserved.
- **Streaming suite regression check:** `npx vitest run server/streaming/__tests__/` → 71 tests pass (4 new lifecycle-ownership + 67 existing across module.spec/subscriber.spec/correlation.spec/envelope.spec).

## Next Phase Readiness

- Plan 22-05 (MODULE.md + barrel + close-out) unblocked. SC2 structurally enforced — Plan 22-05 MODULE.md §Non-Goals can reference the kept cleanup call as documented invariant.
- Plan 22-06 (phase close + Nyquist) unblocked. Both new test files run in CI; lifecycle-ownership.spec runs on every push (no DB gate); plugin-order.spec runs DB-gated as before.
- Phase 22 Wave 4 closed; only Plan 22-05 (close-out) and Plan 22-06 (phase close) remain.

## Self-Check: PASSED

**Created files exist:**
- FOUND: server/streaming/__tests__/lifecycle-ownership.spec.ts

**Commits exist:**
- FOUND: 958e446 (test(22-04): add streaming/__tests__/lifecycle-ownership.spec.ts)
- FOUND: 6be7238 (test(22-04): extend plugin-order.spec with Phase 22 deps + wbIndex fix)

---
*Phase: 22-streaming-module*
*Completed: 2026-05-08*
