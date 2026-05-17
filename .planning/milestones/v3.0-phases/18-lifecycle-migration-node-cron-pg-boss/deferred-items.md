# Phase 18 Deferred Items

Out-of-scope discoveries logged per deviation-rule scope boundary. These are NOT caused
by Phase 18 changes and should be addressed in a follow-up plan.

## Plan 18-03 Execution

### Pre-existing failure in `server/__tests__/plugin-order.spec.ts`

**Status:** Pre-existing — reproduced on HEAD~2 (before any Plan 18-03 work).

**Symptom:** Test fails with `AssertionError: expected 424 to be greater than 1016`.

**Root cause:** The existing Phase 17 Plan 17-07 assertion at line 66
`expect(indexOf('api')).toBeGreaterThan(indexOf('lifecycle-plugin'))` uses plain string
`indexOf('api')`. `app.printPlugins()` tree contains `fastify-zod-openapi` (from Phase 17
Plan 17-00) BEFORE the actual `api` plugin, so `indexOf('api')` returns position 424 (inside
`fastify-zod-openapi`) instead of position 2392 (the real `api` plugin). The assertion fails
because 424 < 1016 (lifecycle-plugin).

**Evidence:**
- Positions in current `app.printPlugins()` output:
  - `fastify-zod-openapi` (substring `api` at char 436 — first match for `indexOf('api')`)
  - `api` plugin proper at char 2392
  - `lifecycle-plugin` at char 1016
- Test fails at same position both before (HEAD~2) and after Plan 18-03 — not caused by
  this plan.

**Not caused by Plan 18-03:**
- Plan 18-03 only swapped `lifecycle-plugin.ts` → `plugin.ts` (same plugin name) and
  added 3 NEW assertions (queue/event-bus/db < lifecycle-plugin) — all three would pass.
- The failing assertion was landed by Plan 17-07 and regressed silently when Plan 17-00
  inserted `fastify-zod-openapi` into the plugin tree at an earlier position.

**Suggested fix (out of scope for Plan 18-03):**
Change the `indexOf` helper in `plugin-order.spec.ts` to match exact plugin lines in the
tree rather than plain substrings. Options:
1. Split `app.printPlugins()` into lines and match whole tokens (`├── api ` with trailing
   space or ` ms`) to disambiguate from `fastify-zod-openapi`.
2. Use a regex matching the tree-branch prefix + plugin name + separator.
3. Switch to structured plugin-graph introspection (if Fastify 5 exposes such an API).

**Impact:** This spec currently does not enforce the plan-17-07 `api` ordering invariant,
but Plan 18-03's new `queue/event-bus/db < lifecycle-plugin` invariants ARE exercised
(they pass — confirmed via debug capture of the same tree).

**Referenced commits:**
- HEAD~2 (595e82e) — failure reproduced.
- Plan 18-03 final commit — failure still present but unchanged.

## Plan 18-04 Execution

### Pre-existing `npx tsc --noEmit` errors (6 in committed tree)

**Status:** Pre-existing — reproduced via `git stash` on Plan 18-04 HEAD to strip
both my own and any uncommitted working-tree edits; `tsc --noEmit` still reports 6
errors on the bare committed Phase 18-03 tree.

**Errors (all pre-existing Phase 15/16 top-level typing regressions):**
1. `server/bus/helpers.ts(72,12)` — TS2352 `RequestContext` → `Record<string, unknown>` conversion
2. `server/bus/plugin.ts(135,29)` — TS2769 `asyncLocalStorage.run(Map, ...)` vs `RequestContext` overload
3. `server/events/__tests__/emit-helpers.spec.ts(32,27)` — same Map-vs-RequestContext
4. `server/events/__tests__/emit-helpers.spec.ts(57,27)` — same
5. `server/hooks/__tests__/events.spec.ts(116,29)` — same
6. `server/pipelines/schema.ts(17,21)` — TS2554 (pre-existing Phase 17 pipelines debt)

**Root cause (items 2-5):** `@fastify/request-context` v6 narrowed `RequestContext` store
shape to an object-store interface; Phase 15 Plan 15-04/15-05 chose Map-shape ALS stores
for pg-boss worker restore. The Map-vs-RequestContext mismatch was accepted as a typing
debt (see STATE decisions log: "[Phase 15] Plan 15-05: ALS worker restore uses plain OBJECT
store, not Map ... `@fastify/request-context`'s requestContext.get(key) uses `store[key]`
bracket access — Map-incompatible.") — but the helper + test usages of Map shape still
exist at the type level.

**Not caused by Plan 18-04:**
- All 6 errors surface on committed tree at HEAD~1 (Plan 18-03 completion).
- `server/lifecycle/index.ts` (Plan 18-04 Task 4.2) contributes 0 new errors —
  `grep 'lifecycle/index' tsc.out` returns empty.
- All 3 renamed `.spec.ts` files (Plan 18-04 Task 4.3) are content-identical; rename
  contributes 0 new errors.

**Impact on Phase 18 close-out:** Plan 18-04 does NOT fix these — out of scope per
deviation-rule SCOPE BOUNDARY ("Only auto-fix issues DIRECTLY caused by the current
task's changes. Pre-existing warnings, linting errors, or failures in unrelated files
are out of scope.").

**Suggested follow-up:** Either (a) consolidate all ALS store shapes to `Record<string, unknown>`
across bus/plugin.ts + test fixtures + helpers, or (b) widen the `@fastify/request-context`
type import to accept Map via the `store[key]` conditional accessor path documented in the
STATE log. Standalone ops-hygiene plan.

### Pre-existing test failures (31 tests across 4 files)

**Status:** Pre-existing — reproduced on HEAD~3 (before any Plan 18-04 work); 17/17 of
`server/api/__tests__/routes.test.ts` fails with identical error on HEAD~3.

**Failing files:**
1. `server/api/__tests__/routes.test.ts` — 17 tests failed
2. `server/api/__tests__/artifact-routes.test.ts` — 5 tests failed
3. `server/auth/__tests__/auth-plugin.test.ts` — 8 tests failed
4. `server/__tests__/plugin-order.spec.ts` — 1 test failed (the Plan 18-03 already-deferred
   `indexOf('api')` substring-match bug; see Plan 18-03 Execution section above)

**Root cause (items 1-3):** `FastifyError: Failed building the serialization schema for
POST: /api/jobs, due to error schema is invalid: data/required must be array`. The
fastify-zod-openapi v5 integration (Phase 17 Plan 17-00/17-01) emits a JSON Schema with
`required: { ... }` object-shape where Fastify's underlying Ajv compiler expects an array.
This surfaces for every Zod schema that declares required fields — routes.test.ts and
artifact-routes.test.ts both mount POST /api/jobs via a shared buildApp helper so the boot
fails before any test runs; auth-plugin.test.ts hits the same path.

**Not caused by Plan 18-04:**
- `git checkout HEAD~3 && vitest run server/api/__tests__/routes.test.ts` reproduces the
  same 17 failures with the same FastifyError at the same line.
- Plan 18-04 Tasks 4.1 (MODULE.md), 4.2 (barrel), 4.3 (file rename) touch ZERO runtime code
  paths exercised by these routes.

**Also stuck in the suite:** `scripts/__tests__/check-generated.spec.ts` (Plan 17-08) hangs
indefinitely when invoked during `npm test` — the spec spawns `server/scripts/build-openapi.ts`
child processes that block on Fastify boot (the same POST /api/jobs serialization error).
Workaround: run `CONTRACTS_CHECK_SPEC=skip npm test`. Proper fix: make the spec gate on
`openapi:generate` exit code before diff-checking. Deferred to a standalone ops-hygiene plan.

**Impact on Phase 18 close-out:** Plan 18-04 does NOT fix these — out of scope per
deviation-rule SCOPE BOUNDARY. Lifecycle module has 30 passing specs (3 renamed + 5 existing)
which is the real coverage signal for Phase 18 deliverables. The failing tests belong to
Phase 17 contracts ownership.

**Suggested follow-up:** Hotfix plan (call it 17-09 or a standalone) that either:
1. Fixes fastify-zod-openapi v5 emission to use array-shape `required` (upstream bug?), or
2. Pins fastify-zod-openapi back to v4 + reverts Plan 17-00 Zod 4 integration until v5's
   Zod 4 path stabilises, or
3. Adds an Ajv-compatible `required` normalisation shim in server/index.ts' setValidatorCompiler.
