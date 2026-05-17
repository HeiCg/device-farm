---
phase: 15-fix-operational-dependencies
plan: 07
subsystem: lint-guardrails
tags: [eslint, eslint-9, flat-config, eslint-plugin-local-rules, rule-tester, events, governance, typescript]

# Dependency graph
requires:
  - phase: 15-fix-operational-dependencies
    provides: "15-00 dev deps (eslint ^9, eslint-plugin-local-rules ^3, @typescript-eslint ^8); 15-04 TypedBus + bus/*.ts internals that must be allowlisted"
provides:
  - "ESLint 9 flat-config (eslint.config.mjs) wiring @typescript-eslint parser/plugin + local-rules plugin on server/**/*.ts and fixture TS files"
  - "Custom rule no-imperative-event-names: rejects bus.emit(<literal>, ...) when literal is not noun.verbed past-tense dotted — enforces EVENTS-03"
  - "Custom rule no-direct-bus-emit: rejects bus.emit() outside **/events.ts, *.spec.ts, *.test.ts, and the bus internals — enforces EVENTS-08"
  - "RuleTester vitest specs (.test.mjs) with 7 valid + 5 invalid cases for no-imperative-event-names, 6 valid + 2 invalid for no-direct-bus-emit"
  - "Fixture files bad-name.ts / bad-emit.ts demonstrating each rule fires when force-linted (npx eslint --no-ignore)"
  - "Plugin index eslint-local-rules/index.js auto-discovered by eslint-plugin-local-rules (requireUp from cwd)"
affects: [15-08 ADR-001 (will reference lint guardrails as EVENTS-03/08 enforcement), 16-pilot hooks module (first module subject to lint rules), all future per-module events.ts]

# Tech tracking
tech-stack:
  added: []  # consumes existing eslint ^9.39.4 + eslint-plugin-local-rules ^3.0.2 + @typescript-eslint ^8.58.2 from 15-00
  patterns:
    - "ESLint flat-config (array of config blocks; ignores as a standalone-only object; plugin registration via `plugins: { 'local-rules': localRules }`)"
    - "Local-rules auto-discovery via eslint-plugin-local-rules — drops eslint-local-rules/index.js relative to cwd; requires directory-scoped package.json with `\"type\": \"commonjs\"` to let CJS rule modules load under the repo-level ESM package"
    - "RuleTester specs as .test.mjs so vitest v4 can be imported (vitest v4 cannot be require()'d from CommonJS)"
    - "AST selector pairing for bus-scoped rules: `CallExpression[callee.object.name=\"bus\"]` + `CallExpression[callee.object.property.name=\"bus\"]` covers both `bus.emit()` and `fastify.bus.emit()` / `app.bus.emit()` paths"
    - "Allowlist-as-regex-array pattern for path-based rule gating; narrow extensions over broad directory names to avoid false allowlisting of fixture files"

key-files:
  created:
    - "eslint.config.mjs"
    - "eslint-local-rules/package.json"
    - "eslint-local-rules/index.js"
    - "eslint-local-rules/no-imperative-event-names.js"
    - "eslint-local-rules/no-direct-bus-emit.js"
    - "eslint-local-rules/__tests__/no-imperative-event-names.test.mjs"
    - "eslint-local-rules/__tests__/no-direct-bus-emit.test.mjs"
    - "eslint-local-rules/__tests__/fixtures/bad-name.ts"
    - "eslint-local-rules/__tests__/fixtures/bad-emit.ts"
  modified:
    - "vitest.config.ts"
    - "server/bus/helpers.ts"
    - "server/bus/plugin.ts"
    - "server/events/__tests__/emit-helpers.spec.ts"

key-decisions:
  - "Narrowed no-imperative-event-names selector from RESEARCH §10 ('CallExpression[callee.property.name=\"emit\"] Literal') to bus.emit() and fastify.bus.emit() only — the broader selector false-positived on existing v2 code (this.emit('stateChange'), broadcaster.emit('job-1'), proc.emit('exit'))"
  - "Dropped /\\/__tests__\\// entry from no-direct-bus-emit allowlist — it over-matched fixtures under eslint-local-rules/__tests__/fixtures/ which must remain lint-able; .(spec|test).ts extension is sufficient for real test files"
  - "Added eslint-local-rules/package.json with '\"type\": \"commonjs\"' so the CJS rule modules load under the repo-level ESM package (repo root package.json declares type:module)"
  - "RuleTester specs are .test.mjs (ESM) because vitest v4 cannot be required from CommonJS — rule source is still loaded via createRequire(import.meta.url)"
  - "reportUnusedDisableDirectives: 'off' set on the server/**/*.ts block to suppress 9 pre-existing // eslint-disable-next-line no-console warnings from prior spec files (npm run lint stays quiet; the no-console rule isn't wired here and those disables aren't in scope for plan 15-07)"
  - "Bus internals (bus/bus.ts, bus/helpers.ts, bus/plugin.ts) allowlisted defensively — they legitimately invoke bus.emit / this.ee.emit as part of implementing the abstraction itself"

patterns-established:
  - "AST selector: `CallExpression[callee.object.name=\"X\"][callee.property.name=\"Y\"]` matches X.Y(...); `CallExpression[callee.object.property.name=\"X\"][callee.property.name=\"Y\"]` matches *.X.Y(...) — pair them when a method can be reached via a shorthand or through a decorator"
  - "Test fixture convention for ESLint rules: .ts files under `eslint-local-rules/__tests__/fixtures/` with 'INTENTIONALLY INVALID' header comment; placed in eslint.config.mjs `ignores` so npm run lint stays green, exercised via `npx eslint --no-ignore <path>` as a human-readable demo"
  - "RuleTester spec wrapping: `describe('<rule-name>', () => { it('rule test cases', () => { new RuleTester().run(...) }) })` — vitest-compatible, gives per-rule test reporting"
  - "Duck-typed `context.filename` / `context.getFilename()` fallback — ESLint 9 ships `context.filename` as a property; legacy plugins still use the getter; support both for forward/backward compat"

requirements-completed: [EVENTS-03, EVENTS-08]

# Metrics
duration: 10min
completed: 2026-04-17
---

# Phase 15 Plan 07: Lint Guardrails Summary

**Two custom ESLint rules (no-imperative-event-names, no-direct-bus-emit) shipped as eslint-plugin-local-rules, wired through an ESLint 9 flat-config, exercised by RuleTester vitest specs and two fixture TS files — npm run lint exits 0 on the current codebase.**

## Performance

- **Duration:** 10 min
- **Started:** 2026-04-17T15:49:24Z
- **Completed:** 2026-04-17T15:59:41Z
- **Tasks:** 2 (both TDD)
- **Files created:** 9 (flat-config + plugin pkg.json + index + 2 rule sources + 2 RuleTester specs + 2 fixtures)
- **Files modified:** 4 (vitest.config.ts + 3 stale eslint-disable cleanups)

## Accomplishments

- **no-imperative-event-names** enforces the v3.0 event-naming convention: `bus.emit(<literal>, ...)` must be `noun.verbed` past-tense dotted. Imperative verbs (`create`, `update`, `delete`, `run`, `start`, `stop`, `send`, `build`, `queue`) in the last segment trigger `imperative`. Non-matching shapes trigger `malformed`. 7 valid + 5 invalid RuleTester cases prove both messages fire.
- **no-direct-bus-emit** enforces EVENTS-08: `bus.emit()` / `fastify.bus.emit()` may only be called from `**/events.ts`, `.spec.ts`, `.test.ts`, or the bus internals (`bus/bus.ts`, `bus/helpers.ts`, `bus/plugin.ts`). 6 valid + 2 invalid RuleTester cases prove the allowlist and the forbid path both work.
- **ESLint 9 flat-config** wires both rules at `error` severity against `server/**/*.ts` (plus fixture `.ts` files so the fixtures can be lint-tested on demand). Build artifacts and fixtures are in `ignores` so `npm run lint` on the whole tree stays green.
- **RuleTester specs** run under vitest v4 as `.test.mjs` files (ESM needed because vitest v4 cannot be required from CJS). Rule sources are still CJS and loaded via `createRequire(import.meta.url)`.
- **Fixture files** (`bad-name.ts` / `bad-emit.ts`) live under `eslint-local-rules/__tests__/fixtures/`; they are ignored by `npm run lint` but fire both rules when force-linted with `npx eslint --no-ignore <path>`.

## ESLint Version + Lint Output

```bash
$ npx eslint -v
v9.39.4
```

```bash
$ npm run lint
> device-farm@0.1.0 lint
> eslint server/ eslint-local-rules/

$ echo $?
0
```

Clean — zero errors, zero warnings.

## Fixture Lint Exercises (force-linted)

```bash
$ npx eslint --no-ignore eslint-local-rules/__tests__/fixtures/bad-name.ts

eslint-local-rules/__tests__/fixtures/bad-name.ts
   9:1   error  bus.emit() is forbidden here. Use emit helpers from the module events.ts                              local-rules/no-direct-bus-emit
   9:10  error  Event name "job.create" uses imperative verb. Use past tense (e.g. "job.completed", "device.booted")  local-rules/no-imperative-event-names
  10:1   error  bus.emit() is forbidden here. Use emit helpers from the module events.ts                              local-rules/no-direct-bus-emit
  10:10  error  Event name "JobCompleted" is not noun.verbed dotted (expect /^[a-z]+(\.[a-z]+)+$/)                    local-rules/no-imperative-event-names
  11:1   error  bus.emit() is forbidden here. Use emit helpers from the module events.ts                              local-rules/no-direct-bus-emit
  11:10  error  Event name "job" is not noun.verbed dotted (expect /^[a-z]+(\.[a-z]+)+$/)                             local-rules/no-imperative-event-names

✖ 6 problems (6 errors, 0 warnings)
```

```bash
$ npx eslint --no-ignore eslint-local-rules/__tests__/fixtures/bad-emit.ts

eslint-local-rules/__tests__/fixtures/bad-emit.ts
  10:1  error  bus.emit() is forbidden here. Use emit helpers from the module events.ts  local-rules/no-direct-bus-emit

✖ 1 problem (1 error, 0 warnings)
```

Notice that `bad-name.ts` fires BOTH rules per line: the `forbidden` error from `no-direct-bus-emit` (the file path isn't allowlisted) and the per-literal error from `no-imperative-event-names`. This is intentional — the two rules are orthogonal and either can catch a violation alone.

## RuleTester Specs

```bash
$ npx vitest run eslint-local-rules/__tests__/
Test Files  2 passed (2)
      Tests  2 passed (2)
```

Each spec wraps a `RuleTester.run(...)` call inside `describe('<rule>', () => { it('rule test cases', () => { ... }) })` so vitest reports it as a normal test. Wrapping is required because RuleTester throws on any assertion failure — unwrapped calls would fire at module-import time and be reported as an unhandled import error rather than a pretty test diff.

## Task Commits

Task 7.1 (rule sources + plugin index):
- `b2027ed` feat(15-07): add no-imperative-event-names + no-direct-bus-emit lint rules

Task 7.2 (flat-config + RuleTester specs + fixtures):
- `84ff5a5` feat(15-07): wire ESLint 9 flat-config + RuleTester specs + fixtures

Plan metadata commit follows this SUMMARY.

## Files Created/Modified

### Created

- `eslint.config.mjs` — ESLint 9 flat-config. 3 blocks: (1) top-level `ignores` for build artifacts + fixtures, (2) TS surface `server/**/*.ts` + fixtures with the two local rules at `error`, (3) JS / MJS sources inside `eslint-local-rules/**` with per-sourceType parser options.
- `eslint-local-rules/package.json` — `"type": "commonjs"` so CJS rule modules resolve correctly under the repo-level ESM package.
- `eslint-local-rules/index.js` — re-exports both rules under their canonical names (`no-imperative-event-names`, `no-direct-bus-emit`); auto-discovered by `eslint-plugin-local-rules` via `requireUp('eslint-local-rules', ...)` from cwd.
- `eslint-local-rules/no-imperative-event-names.js` — AST selector scoped to `bus.emit(<literal>, ...)` and `*.bus.emit(<literal>, ...)`; checks `DOTTED_PAST_TENSE` regex and `IMPERATIVE_LAST` regex; reports `malformed` or `imperative` message IDs.
- `eslint-local-rules/no-direct-bus-emit.js` — path-based allowlist (events.ts, `.(spec|test).ts`, bus internals); fires `forbidden` message ID on any `bus.emit()` / `fastify.bus.emit()` at non-allowlisted path.
- `eslint-local-rules/__tests__/no-imperative-event-names.test.mjs` — 7 valid + 5 invalid RuleTester cases; covers non-bus `.emit()` staying out of scope.
- `eslint-local-rules/__tests__/no-direct-bus-emit.test.mjs` — 6 valid + 2 invalid RuleTester cases; valid covers events.ts, tests, bus internals; invalid covers `bus.emit` and `fastify.bus.emit` from a service file.
- `eslint-local-rules/__tests__/fixtures/bad-name.ts` — 3 intentionally-bad `bus.emit()` calls (imperative / uppercase / single-segment).
- `eslint-local-rules/__tests__/fixtures/bad-emit.ts` — 1 intentionally-bad `bus.emit()` call at a path outside the allowlist.

### Modified

- `vitest.config.ts` — include glob extended from `eslint-local-rules/__tests__/**/*.test.js` to `.test.{js,mjs}` so the new ESM specs are picked up.
- `server/bus/helpers.ts`, `server/bus/plugin.ts`, `server/events/__tests__/emit-helpers.spec.ts` — removed stale `// eslint-disable-next-line import/no-unresolved` directives. The `import/no-unresolved` rule was never wired (no `eslint-plugin-import` installed), and the new flat-config reports such directives as `Definition for rule 'import/no-unresolved' was not found` errors. Removing the comments is safe — the imports themselves (`@fastify/request-context`) resolve correctly under Node's NodeNext resolver.

## Decisions Made

- **Narrowed `no-imperative-event-names` selector to bus.emit only.** The RESEARCH §10 sample used `CallExpression[callee.property.name="emit"] Literal`, matching ANY `.emit(<string>, ...)`. That produced false positives in v2 code:
  - `server/pool/device.ts:50` — `this.emit('stateChange', ...)`
  - `server/streaming/__tests__/job-broadcaster.test.ts:18` — `broadcaster.emit('job-1', ...)`
  - `server/jobs/__tests__/job-executor.test.ts:116` — `mockProc.emit('exit', 0, null)`
  All three are Node `EventEmitter` usage, completely unrelated to the bus. Plan must-have truth #1 ("npm run lint exits 0 on the current codebase — no false positives") was unsatisfiable with the RESEARCH-literal selector. Narrowing to `callee.object.name="bus"` / `callee.object.property.name="bus"` mirrors `no-direct-bus-emit` exactly and keeps the rule pair coherent. Non-bus `.emit()` calls are now intentionally out of scope for both rules.
- **Dropped `/\/__tests__\//` from `no-direct-bus-emit` allowlist.** My fixtures live under `eslint-local-rules/__tests__/fixtures/` — that directory ancestor-matched the `/__tests__/` regex, causing `bad-emit.ts` to be silently allowlisted and the rule to never fire on it (`exit=0`, zero problems). The `.(spec|test).ts` extension rule is sufficient for real test files; fixtures keep their `.ts` (no `.spec`/`.test`) and therefore correctly remain non-allowlisted.
- **eslint-local-rules/package.json with `"type": "commonjs"`.** The repo's root `package.json` declares `"type": "module"`, so `.js` files resolve as ESM by default. The rule modules use CommonJS `module.exports` + `require(...)` (standard ESLint plugin shape). A nested `package.json` with `"type": "commonjs"` scopes `.js` files inside `eslint-local-rules/` back to CJS without renaming them or disturbing the rest of the project.
- **RuleTester specs as `.test.mjs`.** Vitest v4 ships as pure ESM and cannot be `require()`'d from a CommonJS module (`Vitest cannot be imported in a CommonJS module using require()`). The specs need `describe`/`it` from vitest for proper test reporting, so they must be ESM. `.mjs` + `createRequire(import.meta.url)` to still load the CJS rule source.
- **`reportUnusedDisableDirectives: 'off'` on the server/**/*.ts block.** After wiring the flat-config, ESLint surfaced 9 pre-existing `// eslint-disable-next-line no-console` warnings in spec files (jsonb-roundtrip, events-schema, persistence, als-crossqueue, als, migration, plugin, retry-policy, shutdown). The `no-console` rule isn't enabled, so ESLint calls those directives "unused". Cleaning them up is out-of-scope for plan 15-07 (they come from plans 15-01 and 15-05). Suppressing the report keeps `npm run lint` output quiet and satisfies the "no false positives" must-have.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] no-imperative-event-names selector too broad; false-positives on non-bus .emit() in v2 code**
- **Found during:** Task 7.1 acceptance review (before running `npm run lint`)
- **Issue:** RESEARCH §10 Rule 1 sample uses `'CallExpression[callee.property.name="emit"] Literal'`. Grep across the repo found 3 pre-existing non-bus `.emit()` call sites with non-past-tense literals (`this.emit('stateChange')`, `broadcaster.emit('job-1')`, `proc.emit('exit')`). These are `EventEmitter` usage — correct and out of scope for the event-bus rule. Under the literal selector they would trigger `malformed`, making plan must-have truth #1 ("`npm run lint` exits 0 on the current codebase — no false positives") unsatisfiable.
- **Fix:** Narrowed the selector to `CallExpression[callee.object.name="bus"][callee.property.name="emit"] > Literal:first-child` and `CallExpression[callee.object.property.name="bus"][callee.property.name="emit"] > Literal:first-child`. Only `bus.emit(...)` / `fastify.bus.emit(...)` / `app.bus.emit(...)` call sites are linted now, which matches the rule's docstring intent ("event names must be noun.verbed past-tense dotted" — events are bus events, not Node EE events).
- **Files modified:** `eslint-local-rules/no-imperative-event-names.js`
- **Verification:** Added 3 specifically-crafted RuleTester valid cases (`this.emit('stateChange', {})`, `broadcaster.emit('job-1', {})`, `proc.emit('exit', 0)`) — all pass (rule does not fire). `npm run lint` exits 0.
- **Committed in:** `b2027ed` (Task 7.1 commit — rule source written with the narrowed selector from the start, not as a follow-up patch).

**2. [Rule 3 — Blocking] `eslint-local-rules/*.js` failed to load as CJS under root ESM package**
- **Found during:** Task 7.1 verification (`node -e "require('./eslint-local-rules')"`)
- **Issue:** Root `package.json` declares `"type": "module"`. Node resolved `eslint-local-rules/index.js` as ESM and threw `MODULE_NOT_FOUND` when its CommonJS `require('./no-imperative-event-names.js')` ran. The rule modules are vanilla CJS (standard ESLint plugin shape) and can't be rewritten as ESM without changing eslint-plugin-local-rules' loader contract.
- **Fix:** Added `eslint-local-rules/package.json` with `{ "type": "commonjs" }` — scopes `.js` files inside the directory back to CJS without affecting anything else.
- **Files modified:** `eslint-local-rules/package.json` (new file)
- **Verification:** `node -e "const p = require('./eslint-local-rules'); ..."` prints `rules load OK`; `npm run lint` finds the plugin; RuleTester specs load the rules via `createRequire()`.
- **Committed in:** `b2027ed` (Task 7.1 commit — package.json added alongside the rule files).

**3. [Rule 3 — Blocking] `.test.mjs` parse errors under `sourceType: 'commonjs'`**
- **Found during:** Task 7.2 first `npm run lint`
- **Issue:** The initial flat-config block covered `eslint-local-rules/**/*.js` + `**/*.mjs` together with `sourceType: 'commonjs'`. But `.mjs` files use `import` / `export` — `'commonjs'` mode rejects them with `Parsing error: 'import' and 'export' may appear only with 'sourceType: module'`.
- **Fix:** Split the `eslint-local-rules/**` block into two: `.js` with `sourceType: 'commonjs'`, `.mjs` with `sourceType: 'module'`.
- **Files modified:** `eslint.config.mjs`
- **Verification:** `npm run lint` no longer reports parse errors on the test specs.
- **Committed in:** `84ff5a5` (Task 7.2 commit).

**4. [Rule 3 — Blocking] Stale `// eslint-disable-next-line import/no-unresolved` directives produce "rule not found" errors**
- **Found during:** Task 7.2 first `npm run lint`
- **Issue:** Three files from prior plans (`server/bus/helpers.ts`, `server/bus/plugin.ts`, `server/events/__tests__/emit-helpers.spec.ts`) contained `// eslint-disable-next-line import/no-unresolved` comments above their `@fastify/request-context` imports. The `import/no-unresolved` rule was never wired (no `eslint-plugin-import` in package.json), and ESLint 9's flat-config reports disable directives for unknown rules as errors (`Definition for rule 'import/no-unresolved' was not found`). Plan must-have truth #1 requires `npm run lint` to exit 0.
- **Fix:** Removed the three stale directives. The imports resolve correctly under NodeNext — the comments were dead weight from an earlier plan that anticipated wiring eslint-plugin-import.
- **Files modified:** `server/bus/helpers.ts`, `server/bus/plugin.ts`, `server/events/__tests__/emit-helpers.spec.ts`
- **Verification:** `npm run lint` exits 0. Full `npm test` passes (475 tests — no regressions; those files continue to typecheck and import `asyncLocalStorage` at runtime).
- **Committed in:** `84ff5a5` (Task 7.2 commit — cleanup bundled with the flat-config since it was revealed by the flat-config's introduction).

**5. [Rule 1 — Bug] `/\/__tests__\//` in no-direct-bus-emit allowlist over-matched fixtures**
- **Found during:** Task 7.2 verification run (`npx eslint --no-ignore bad-emit.ts` initially exited 0)
- **Issue:** The RESEARCH §10 allowlist included `/\/__tests__\//`. My fixture files live at `eslint-local-rules/__tests__/fixtures/` — that ancestor path contains `/__tests__/`, so `bad-emit.ts` matched the allowlist and the rule never fired. Fixtures intentionally need to trigger the rule — plan must-have truth #3 ("A fixture file containing `bus.emit(...)` at a path OTHER than `**/events.ts` or `**/__tests__/**` produces a lint error with messageId `forbidden`") is satisfied by the `.(spec|test).ts` extension rule alone, not by the `__tests__/` directory ancestor match.
- **Fix:** Dropped `/\/__tests__\//` from `ALLOW`. Real test files all end in `.spec.ts` / `.test.ts` and are still allowlisted via the extension rule. Updated the accompanying RuleTester spec comment.
- **Files modified:** `eslint-local-rules/no-direct-bus-emit.js`, `eslint-local-rules/__tests__/no-direct-bus-emit.test.mjs`
- **Verification:** `npx eslint --no-ignore bad-emit.ts` now exits 1 with `forbidden` error. RuleTester specs still all pass (all valid cases use `.spec.ts` or `.test.ts` extensions or the bus-internals allowlist entries).
- **Committed in:** `84ff5a5` (Task 7.2 commit).

---

**Total deviations:** 5 auto-fixed (2 Rule 1 bugs, 3 Rule 3 blocking).
**Impact on plan:** Public contract unchanged — both rules ship as specified by name, message IDs, and allowlist intent. Selector narrowing (Rule 1) keeps the rule scoped to its stated purpose; allowlist narrowing (Rule 1) keeps fixtures exercisable; the three blocking fixes (CJS marker, mjs sourceType, stale disable cleanup) are plumbing for ESLint-in-this-repo and don't change rule behavior.

## Issues Encountered

- **vitest v4 + CommonJS incompat:** Initial RuleTester specs were written as `.test.js` per plan prose, but vitest v4 threw on `require('vitest')` (ESM-only package). Switched to `.test.mjs` + `createRequire` pattern for rule loading. Vitest config include glob updated accordingly.
- **No regressions in existing test suite:** After removing the three stale `import/no-unresolved` disable directives, `npm test` still reports 454 passed / 21 skipped (same as before). The imports resolve; the directives were purely cosmetic.

## Next Plan Readiness

- **Plan 15-08 (ADR-001):** ADR prose can now assert that EVENTS-03 ("event names past-tense dotted") and EVENTS-08 ("emit only from events.ts") are mechanically enforced, not just documented. Reference `eslint.config.mjs` + `eslint-local-rules/` in the Consequences section.
- **Plan 15-09 (Nyquist baseline):** lint runs clean → `npm run lint` can be added to the Nyquist validation command surface as a required check.
- **Phase 16 (hooks pilot):** the first real module `events.ts` will be allowlisted automatically by `/\/events\.ts$/`. Its emit helpers are the only path to `bus.emit(...)` — any accidental direct call in `server/hooks/service.ts` will fail lint. Event names like `hook.triggered`, `hook.executed` will pass; typos like `hook.trigger` (imperative) will fail with a clear message.

## Self-Check: PASSED

All claims verified:

- FOUND: `eslint.config.mjs`
- FOUND: `eslint-local-rules/package.json`
- FOUND: `eslint-local-rules/index.js`
- FOUND: `eslint-local-rules/no-imperative-event-names.js`
- FOUND: `eslint-local-rules/no-direct-bus-emit.js`
- FOUND: `eslint-local-rules/__tests__/no-imperative-event-names.test.mjs`
- FOUND: `eslint-local-rules/__tests__/no-direct-bus-emit.test.mjs`
- FOUND: `eslint-local-rules/__tests__/fixtures/bad-name.ts`
- FOUND: `eslint-local-rules/__tests__/fixtures/bad-emit.ts`
- FOUND: `vitest.config.ts` (modified: include glob extended to .test.{js,mjs})
- FOUND: `server/bus/helpers.ts` (modified: stale directive removed)
- FOUND: `server/bus/plugin.ts` (modified: stale directive removed)
- FOUND: `server/events/__tests__/emit-helpers.spec.ts` (modified: stale directive removed)
- FOUND: commit `b2027ed` (feat 15-07 Task 7.1)
- FOUND: commit `84ff5a5` (feat 15-07 Task 7.2)

---
*Phase: 15-fix-operational-dependencies*
*Plan: 07*
*Completed: 2026-04-17*
