---
phase: 16-pilot-module-hooks
plan: 03
subsystem: ci-module-enforcement
tags: [dependency-cruiser, module-boundary, mod-02, ci-guardrail, barrel, spec-fixture, vitest]

# Dependency graph
requires:
  - phase: 16-pilot-module-hooks
    provides: "server/hooks/internal/ directory with 5 module-private files (hook-executor, hook-run-handler, idempotency, module, subscribers) + server/hooks/index.ts barrel as the only public surface — the structure the dep-cruiser rule now enforces"
  - phase: 16-pilot-module-hooks
    provides: "dependency-cruiser@^17.3.10 devDep installed in 16-00; this plan wires the config + script"
provides:
  - ".dependency-cruiser.cjs at repo root — two forbidden rules (no-deep-imports-into-hooks-internal + no-direct-bus-emit-outside-events-ts) + options block with tsConfig + enhancedResolveOptions.conditionNames for TS NodeNext .js specifier resolution"
  - "package.json scripts.dep-check = 'depcruise --config .dependency-cruiser.cjs server/' — exits 0 on clean tree, non-zero when any forbidden rule fires"
  - "__fixtures__/dep-cruiser/bad-deep-import.ts — fixture outside server/ that deliberately violates no-deep-imports-into-hooks-internal for the spec to assert against"
  - "server/hooks/__tests__/dep-cruiser.spec.ts — spawns depcruise via child_process against the fixture; asserts (a) non-zero exit via err reporter (b) JSON violation with rule.name == 'no-deep-imports-into-hooks-internal'. Replaces the VALIDATION.md Manual-Only deep-import proof with an automated check"
affects: [16-04, 17-contracts, 20-pool, 21-artifacts, 23-jobs, 27-consolidation]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Fixture-based dep-cruiser rule proof — a tiny intentionally-invalid file outside the `includeOnly` scope lets tests assert the rule fires without polluting `npm run dep-check`. Pattern copyable for any future MOD-02-style boundary rule."
    - "Dual-reporter dep-cruiser invocation — `err` reporter for exit code, `json` reporter for structured violation parsing. Required because dep-cruiser's `json` reporter does NOT set a non-zero exit code even when `severity: 'error'` rules fire (confirmed empirically, v17.3.10)."
    - "CLI --include-only override to bring external fixtures into the dep-cruiser graph while keeping `options.includeOnly` config-level for tree-wide runs — the idiomatic v17.3.10 approach for spec-only scope expansion."
    - "Belt-and-suspenders module enforcement: ESLint rule catches `.emit()` call-site violations at AST time; dep-cruiser rule catches import-graph leaks at CI time. Each layer covers what the other misses."

key-files:
  created:
    - .dependency-cruiser.cjs
    - __fixtures__/dep-cruiser/bad-deep-import.ts
    - server/hooks/__tests__/dep-cruiser.spec.ts
  modified:
    - package.json (scripts.dep-check added)

key-decisions:
  - "PRIMARY FALLBACK used: `--include-only '^(server|__fixtures__)/'` CLI override in the spec. The plan's pre-task verification (WARNING 8) confirmed the config's `includeOnly: '^server/'` suppresses fixture-path violations even when the fixture is passed explicitly on the CLI — so the spec overrides `includeOnly` at invocation time. `npm run dep-check` continues using the base config unchanged (fixture excluded from tree-wide runs)."
  - "Dual-reporter spec: `err` reporter (default) for exit-code assertion + `json` reporter for structured violation parse. The `json` reporter does NOT set a non-zero exit code when forbidden rules fire (empirical finding, v17.3.10) — so the spec runs depcruise twice and each invocation answers exactly one question."
  - "no-direct-bus-emit-outside-events-ts allowlist extended during Task 3.1 to cover (a) server/bus/index.ts (bus barrel re-exports TypedBus publicly) and (b) server/*/internal/module.ts (MOD-06 factories legitimately construct `new TypedBus(registry)` per the Phase 16 canonical pattern). Without these allowlist entries the rule fired on two clean-code sites: server/bus/index.ts → server/bus/bus.ts (barrel re-export) and server/hooks/internal/module.ts → server/bus/bus.ts (factory import). The ESLint rule already excludes these sites at the AST level — extending the dep-cruiser allowlist restores parity."
  - "Fixture lives at __fixtures__/dep-cruiser/bad-deep-import.ts (OUTSIDE server/) so `includeOnly: '^server/'` in the base config keeps it out of tree-wide `npm run dep-check` output. Spec brings it into the graph only via the --include-only CLI override."

patterns-established:
  - "MOD-02 structural enforcement — dep-cruiser `forbidden` rule with regex-based `from.pathNot` / `to.path` enforces barrel-only imports across module boundaries. Copyable verbatim for Phase 20/21/23 modules."
  - "Automated deep-import proof — a tiny fixture + vitest spec assertion replaces a Manual-Only validation row. Future boundary rules should ship with the same pattern."
  - "Dep-cruiser allowlist discipline — when a `forbidden` rule fires on legitimate code, extend the allowlist (not the rule target). Document each allowlist entry inline in the config comment so future readers understand why each site is exempt."

requirements-completed: [MOD-02]

# Metrics
duration: 5min
completed: 2026-04-17
---

# Phase 16 Plan 03: Dependency-Cruiser CI Enforcement Summary

**.dependency-cruiser.cjs with two forbidden rules + npm run dep-check script + automated spec proving no-deep-imports-into-hooks-internal fires — MOD-02 module boundary is now mechanically non-violable across the repo, and the VALIDATION.md Manual-Only deep-import row is replaced by a runnable vitest check.**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-04-17T19:57:58Z
- **Completed:** 2026-04-17T20:02:54Z
- **Tasks:** 2
- **Files created:** 3
- **Files modified:** 1

## Accomplishments

- `.dependency-cruiser.cjs` at repo root declares two forbidden rules (`no-deep-imports-into-hooks-internal` + `no-direct-bus-emit-outside-events-ts`) plus the options block required for TS NodeNext `.js` specifier resolution (`tsConfig: { fileName: 'tsconfig.json' }` + `enhancedResolveOptions.conditionNames: ['import', 'node', 'default']`).
- `package.json` `scripts.dep-check` invokes `depcruise --config .dependency-cruiser.cjs server/`. `npm run dep-check` exits 0 on the committed codebase (178 modules / 389 dependencies cruised).
- `__fixtures__/dep-cruiser/bad-deep-import.ts` is a 3-line fixture outside `server/` that imports `HookExecutor` from `server/hooks/internal/hook-executor.js` — exactly the deep-import the MOD-02 rule forbids. Lives outside the config's `includeOnly: '^server/'` scope so it never trips tree-wide `npm run dep-check`.
- `server/hooks/__tests__/dep-cruiser.spec.ts` spawns depcruise as a subprocess against the fixture, runs it twice (default `err` reporter for exit code + `json` reporter for structured violation parse), and asserts both (a) non-zero exit code and (b) the violation JSON contains a rule named `no-deep-imports-into-hooks-internal` referencing the fixture path. Passes in ~1s. The VALIDATION.md Manual-Only "deep-import CI failure proof" row for MOD-02 is now covered by this automated spec.
- Belt-and-suspenders guarantee: the existing ESLint rule `no-direct-bus-emit` catches `.emit()` call-site violations at AST time; the new dep-cruiser rule of the same name catches import-graph leaks at CI time. A would-be `bus.emit` from a non-allowlisted file now fails BOTH lint AND dep-check.

## Task Commits

Each task was committed atomically:

1. **Task 3.1: Create .dependency-cruiser.cjs + wire npm run dep-check** — `1cd8680` (feat)
2. **Task 3.2: dep-cruiser.spec.ts fixture + spec proving deep-import rule fires** — `50e67cd` (test)

**Plan metadata commit:** (appended after SUMMARY.md is written)

## Files Created/Modified

### Created

- `.dependency-cruiser.cjs` (62 lines) — two forbidden rules + options block. Comment block documents the purpose of each rule + references RESEARCH §Pitfall 3 for the TS ESM resolver config. `no-direct-bus-emit-outside-events-ts` allowlist now includes five exempt site classes: `events.ts` files (emit sites), `.spec.ts`/`.test.ts` files, bus internals (`server/bus/(bus|helpers|plugin|index)\.ts`), and MOD-06 module factories (`server/*/internal/module\.ts`) — documented inline in the config comment.
- `__fixtures__/dep-cruiser/bad-deep-import.ts` (11 lines) — intentional deep-import violation for the spec. Top comment explains why the file exists and references the spec that consumes it.
- `server/hooks/__tests__/dep-cruiser.spec.ts` (86 lines) — single `[MOD-02]` test, dual depcruise invocations (err reporter → exit-code assertion; json reporter → structured violation assertion). Header comment documents why the two-pass pattern is required + cross-references the WARNING 8 pre-task verification outcome.

### Modified

- `package.json` — added one line inside `scripts`: `"dep-check": "depcruise --config .dependency-cruiser.cjs server/",` positioned after `lint` for readability. No other changes (dependencies, devDependencies, other scripts untouched).

## Decisions Made

- **PRIMARY FALLBACK applied: `--include-only '^(server|__fixtures__)/'` CLI override.** Plan WARNING 8 required a pre-task manual verification to determine whether `includeOnly: '^server/'` in the base config would suppress fixture-path violations. The verification (Step C from the plan) confirmed it DOES suppress: `exit_code=0` and empty violations array when depcruise runs against the fixture with the base config. The spec therefore passes the PRIMARY FALLBACK flag `--include-only '^(server|__fixtures__)/'` on the CLI to override the config. `npm run dep-check` (no CLI override) continues using the base `^server/` scope and keeps the fixture out of tree-wide runs.
- **Dual-reporter spec pattern.** Empirical finding during verification: dep-cruiser's `json` reporter does NOT set a non-zero exit code even when `severity: 'error'` forbidden rules fire — only the default `err` reporter does. The spec therefore runs depcruise twice: once with the default `err` reporter to capture `status !== 0`, once with `json` to parse the structured violation. Each invocation answers exactly one question. No shared-state complexity.
- **Allowlist extension on `no-direct-bus-emit-outside-events-ts`.** Task 3.1's first `npm run dep-check` surfaced two violations on clean code: `server/bus/index.ts → server/bus/bus.ts` (the bus barrel re-exports `TypedBus`) and `server/hooks/internal/module.ts → server/bus/bus.ts` (the MOD-06 factory legitimately calls `new TypedBus(hooksRegistry)`). The original allowlist pattern `server/bus/(bus|helpers|plugin)\.ts$` missed `index.ts`; the factory pattern had no entry at all. Extended the allowlist to `server/bus/(bus|helpers|plugin|index)\.ts$` + `server/[^/]+/internal/module\.ts$`. The ESLint rule `no-direct-bus-emit` already excludes these sites at AST time (imports of `TypedBus` are not `.emit()` call sites) — the dep-cruiser allowlist now mirrors that semantic boundary.
- **Fixture placement outside `server/`.** Plan offered two locations: under `server/__tests__/fixtures/` or at repo root `__fixtures__/`. Chose the repo-root location because the config's `includeOnly: '^server/'` naturally excludes it from tree-wide runs — no `doNotFollow` / `exclude` config entry needed. Keeps the fixture discoverable (not buried under multiple `__tests__` dirs) and orthogonal to any future test-fixtures directory.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Extended `no-direct-bus-emit-outside-events-ts` allowlist for bus barrel + MOD-06 factory sites**

- **Found during:** Task 3.1 (first `npm run dep-check` run after creating the config).
- **Issue:** The allowlist pattern `server/bus/(bus|helpers|plugin)\.ts$` copied verbatim from RESEARCH §1 missed two legitimate graph-level import sites, causing `npm run dep-check` to fail with 2 violations on clean code:
  - `server/bus/index.ts → server/bus/bus.ts` — the bus barrel re-exports `TypedBus` publicly (Phase 15 Plan 15-04 pattern). Barrel re-export is not a `.emit()` call and the ESLint rule excludes it.
  - `server/hooks/internal/module.ts → server/bus/bus.ts` — the MOD-06 factory calls `new TypedBus(hooksRegistry)` to construct the per-module bus. Factory construction is not a `.emit()` call and the ESLint rule excludes it.
  - Without the fix, Task 3.1's acceptance criterion "`npm run dep-check` exits 0 on the committed codebase" would fail, blocking plan execution.
- **Fix:** Extended the allowlist regex from `server/bus/(bus|helpers|plugin)\.ts$` to `server/bus/(bus|helpers|plugin|index)\.ts$|server/[^/]+/internal/module\.ts$`. The first extension adds the bus barrel; the second adds MOD-06 module factories across the repo (generalizable — any module under `server/*/internal/module.ts` may legitimately construct its own `TypedBus<registry>`). Updated the config comment to document why each allowlist class is exempt.
- **Files modified:** `.dependency-cruiser.cjs` (allowlist regex + comment block).
- **Verification:** `npm run dep-check` now exits 0 with "no dependency violations found (178 modules, 389 dependencies cruised)". The rule still fires when an unauthorized file imports from `server/bus/bus.ts` (proved indirectly by the shape of the regex — `server/jobs/*.ts` or any other non-allowlisted path would still match `to.path: 'server/bus/bus\\.ts$'` and fail the `from.pathNot` allowlist).
- **Committed in:** `1cd8680` (Task 3.1 commit).

**2. [Rule 3 - Blocking] Used `--include-only` CLI override in spec (PRIMARY FALLBACK per plan)**

- **Found during:** Task 3.2 (WARNING 8 pre-task manual verification — Step C).
- **Issue:** `includeOnly: '^server/'` in `.dependency-cruiser.cjs` suppressed the fixture even when the fixture path (`__fixtures__/dep-cruiser/bad-deep-import.ts`) was passed explicitly on the CLI. Step C output: `exit_code=0`, `violations: []`. Without the override, the spec's `expect(result.status).not.toBe(0)` assertion would always fail.
- **Fix:** Plan-documented PRIMARY FALLBACK applied: pass `--include-only '^(server|__fixtures__)/'` on the CLI to override the config's `includeOnly`. Confirmed empirically: spec now produces `exit_code=1` + a violation with `rule.name: 'no-deep-imports-into-hooks-internal'` + `from: __fixtures__/dep-cruiser/bad-deep-import.ts` + `to: server/hooks/internal/hook-executor.ts`.
- **Files modified:** `server/hooks/__tests__/dep-cruiser.spec.ts` (includes the CLI override on both depcruise invocations).
- **Verification:** Spec passes (`Test Files 1 passed (1)`, `Tests 1 passed (1)`). `npm run dep-check` (no CLI override) still exits 0 — fixture stays outside tree-wide scope.
- **Committed in:** `50e67cd` (Task 3.2 commit).

**3. [Rule 2 - Missing Critical] Documented that dep-cruiser's `json` reporter does NOT set exit code on violations**

- **Found during:** Task 3.2 (WARNING 8 verification + spec drafting).
- **Issue:** The plan's initial spec draft used only the `json` reporter and asserted `expect(result.status).not.toBe(0)`. Empirical finding during verification: running `depcruise --output-type json --include-only '^(server|__fixtures__)/' ...` against the fixture produces `exit_code=0` despite the violation appearing in the JSON output (with `severity: 'error'`). Only the default `err` reporter sets the exit code. Without this finding, the spec would have been flaky or outright broken.
- **Fix:** Restructured the spec to run depcruise twice: once with the default `err` reporter to assert `status !== 0`, once with `json` to parse structured violations. Header comment documents the two-pass rationale.
- **Files modified:** `server/hooks/__tests__/dep-cruiser.spec.ts` (two `spawnSync` invocations with different `--output-type` flags).
- **Verification:** Spec passes reliably across multiple runs. No flakiness observed.
- **Committed in:** `50e67cd` (Task 3.2 commit).

---

**Total deviations:** 3 auto-fixed (2 Rule 3 blocking, 1 Rule 2 critical-docs).

**Impact on plan:** All three auto-fixes were required to meet the plan's success criteria. The plan explicitly forecast WARNING 8 (deviation #2) and documented the PRIMARY FALLBACK path. Deviation #1 (bus allowlist) was a minor hole in the plan's "Known potential issue" note — the plan called out `server/bus/plugin.ts` / `helpers.ts` / `bus.ts` but missed `server/bus/index.ts` (the bus barrel) and the MOD-06 factory pattern that Phase 16-02 established. Deviation #3 (dual-reporter) was an empirical finding from the WARNING 8 verification steps. Zero scope creep — all three fixes fall within the plan's stated intent (MOD-02 structural enforcement with a passing tree + passing spec).

## Issues Encountered

None. All three deviations were handled inline via the deviation-rule framework; no blockers.

## Verification Results

### npm run dep-check (committed codebase)

```
> device-farm@0.1.0 dep-check
> depcruise --config .dependency-cruiser.cjs server/


✔ no dependency violations found (178 modules, 389 dependencies cruised)
```

Exit code: 0. No warnings. Module count rose from 175 (initial run) to 178 after the spec + plan artifacts landed under `server/hooks/__tests__/`. All three new modules are within the allowlist (`server/hooks/__tests__/dep-cruiser.spec.ts` is inside `server/hooks/` so the `from.pathNot: '^server/hooks/'` allowlist applies; the `.spec.ts` extension is also allowlisted by the belt-and-suspenders rule).

### npx depcruise --version

```
17.3.10
```

Matches the devDep pinned in Phase 16-00 (`dependency-cruiser: ^17.3.10`).

### npx vitest run server/hooks/__tests__/dep-cruiser.spec.ts

```
 RUN  v4.1.4 /Users/heicg/Desktop/projects/device-farm

 Test Files  1 passed (1)
      Tests  1 passed (1)
   Start at  16:02:53
   Duration  959ms (transform 9ms, setup 0ms, import 13ms, tests 860ms, environment 0ms)
```

1/1 passing in ~1s. The spec's two depcruise subprocess invocations dominate the 860ms test duration (npm/npx startup overhead).

### Pre-task manual verification (WARNING 8 — documented)

Plan task 3.2 Step C output recorded BEFORE writing the spec body:

```bash
$ npx depcruise --config .dependency-cruiser.cjs --output-type json __fixtures__/dep-cruiser/bad-deep-import.ts > /tmp/depcruise-out.json
$ echo "exit_code=$?"
exit_code=0
$ cat /tmp/depcruise-out.json | node -e "const d = JSON.parse(...); console.log('violations:', d.summary?.violations ?? []);"
violations: []
```

Result: PRIMARY path (no fallback) did NOT work — `includeOnly: '^server/'` suppressed the fixture. Decision gate in the plan directed use of the PRIMARY FALLBACK (`--include-only` CLI override), which empirically does fire the rule:

```bash
$ npx depcruise --config .dependency-cruiser.cjs --include-only '^(server|__fixtures__)/' __fixtures__/dep-cruiser/bad-deep-import.ts
  error no-deep-imports-into-hooks-internal: __fixtures__/dep-cruiser/bad-deep-import.ts → server/hooks/internal/hook-executor.ts
x 1 dependency violations (1 errors, 0 warnings). 4 modules, 3 dependencies cruised.
exit_code=1
```

The SECONDARY FALLBACK (dedicated spec-only config file) was not needed.

### Acceptance-criteria grep audit

- `grep -c "no-deep-imports-into-hooks-internal" .dependency-cruiser.cjs` → 2 (name + comment reference) ✓
- `grep -c "no-direct-bus-emit-outside-events-ts" .dependency-cruiser.cjs` → 2 (name + comment reference) ✓
- `grep -c "conditionNames" .dependency-cruiser.cjs` → 2 (the array entry + comment reference) ✓ (plan expected ≥1)
- `grep -n "server/hooks/internal" __fixtures__/dep-cruiser/bad-deep-import.ts` → 1 (the deliberate violation import) ✓
- `grep -c "spawnSync" server/hooks/__tests__/dep-cruiser.spec.ts` → 3 (import + 2 invocations) ✓
- `grep -c "\[MOD-02\]" server/hooks/__tests__/dep-cruiser.spec.ts` → 1 (test name tag) ✓
- `grep -c "no-deep-imports-into-hooks-internal" server/hooks/__tests__/dep-cruiser.spec.ts` → 3 (the spec asserts on this rule name) ✓

### Dep-cruiser warnings

No warnings (non-fatal or otherwise) during `npm run dep-check`. Summary line is clean: `✔ no dependency violations found (178 modules, 389 dependencies cruised)`.

### includeOnly interaction notes

Confirmed empirically: `options.includeOnly: '^server/'` is the correct config-level scope for tree-wide runs. It excludes `__fixtures__/` naturally. The spec bypasses it via the CLI `--include-only` override, which in v17.3.10 fully overrides (not merges with) the config value. No dedicated `.dependency-cruiser.spec.cjs` file was needed — the SECONDARY FALLBACK from the plan remains available if a future spec needs more invasive config changes.

## User Setup Required

None - no external service configuration required. `npm run dep-check` works out of the box on any clone with `npm install` completed.

## Next Phase Readiness

### Ready for 16-04 (MODULE.md + tests-as-spec)

- MOD-02 structural enforcement complete. The public-barrel boundary (`server/hooks/index.ts`) is now mechanically enforced — any PR that adds an import from outside `server/hooks/` to `server/hooks/internal/*` will fail `npm run dep-check`.
- The automated dep-cruiser spec replaces what would otherwise be a manual-review row in `16-VALIDATION.md`. 16-04 can now mark the MOD-02 "deep-import CI failure proof" validation row as "automated via `server/hooks/__tests__/dep-cruiser.spec.ts`" and point readers at the spec.
- `server/hooks/__tests__/` now has 3 spec files: `queue.spec.ts` (DB-gated integration, Plan 16-01), `module.spec.ts` (unit factory shape, Plan 16-02), `dep-cruiser.spec.ts` (structural rule proof, this plan). 16-04 writes MODULE.md with the describe-tree ↔ Public API mapping; the spec count is now stable.

### Ready for Phase 20/21/23 (consumer modules)

- Future module authors copy `.dependency-cruiser.cjs` rule patterns by analogy: add a new `forbidden` rule per module with the same `from.pathNot: '^server/<module>/'` + `to.path: '^server/<module>/internal/'` shape. The MOD-06 factory allowlist entry (`server/[^/]+/internal/module\.ts$`) already generalizes to every module, so no config edits needed when Phase 20 ships `server/pool/internal/module.ts`.
- `npm run dep-check` becomes the CI guardrail for all v3.0 modules. Phase 17 (Contracts) can cite this script as part of the canonical CI chain (lint → typecheck → dep-check → test → nyquist).

### Ready for Phase 27 (persistEnvelope consolidation)

- The `server/*/internal/module.ts` allowlist entry establishes the precedent: every module may legitimately construct its own `TypedBus<registry>`. When Phase 27 revisits Open Question #1 (consolidate duplicated `persistEnvelope`), the dep-cruiser graph already cleanly distinguishes legitimate factory sites from stray emit leaks — the consolidation work will not need to touch this config.

### Open items carried from prior phases (unchanged)

- Mac Mini graceful-shutdown live observation deferred (Plan 15-06 task 6.2) — no impact on 16-03.
- 7 pre-existing typecheck errors in unrelated modules (artifacts/, bus/, pipelines/) — out-of-scope per deviation-rule scope boundary. Not re-checked this plan (scope was config + spec only; no TypeScript source changes).
- persistEnvelope duplication (10 lines in `server/hooks/internal/module.ts` from bus plugin) — consolidation deferred to Phase 27+ per RESEARCH Open Question #1. The new dep-cruiser allowlist entry `server/*/internal/module\.ts$` future-proofs the consolidation.

## Self-Check: PASSED

- [x] `.dependency-cruiser.cjs` exists at repo root (`FOUND: .dependency-cruiser.cjs`)
- [x] `__fixtures__/dep-cruiser/bad-deep-import.ts` exists (`FOUND`)
- [x] `server/hooks/__tests__/dep-cruiser.spec.ts` exists (`FOUND`)
- [x] `package.json` modified with `dep-check` script (verified via `node -e "require('./package.json').scripts['dep-check']"` — present)
- [x] Task 3.1 commit `1cd8680` exists (`git log --oneline --all | grep 1cd8680` — present)
- [x] Task 3.2 commit `50e67cd` exists (`git log --oneline --all | grep 50e67cd` — present)
- [x] `npm run dep-check` exits 0 (confirmed — "no dependency violations found")
- [x] `npx vitest run server/hooks/__tests__/dep-cruiser.spec.ts` passes (1/1 in 959ms)

---
*Phase: 16-pilot-module-hooks*
*Completed: 2026-04-17*
