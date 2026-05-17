---
phase: 17-contracts-pipeline-ops-hygiene
plan: 00
subsystem: infra
tags: [contracts, openapi, zod, fastify-zod-openapi, go-codegen, adr, scaffolding]

# Dependency graph
requires:
  - phase: 16-pilot-module-hooks
    provides: Module pattern (MODULE.md + index.ts barrel + events.ts + queue.ts + internal/ + __tests__/); ADR format precedent; dep-cruiser CI baseline (178 modules, 0 violations)
  - phase: 15-foundations
    provides: Zod 4.3.6 runtime (enables native z.toJSONSchema); Fastify 5.8.2 baseline; ADR directory convention (NNN-slug.md); linguist-generated .gitattributes idiom unused pre-17
provides:
  - fastify-zod-openapi@^5.6.1 + @fastify/swagger@^9.7.0 runtime deps (server-side Zod → OpenAPI 3.1 plumbing)
  - openapi-typescript@^7.13.0 devDep (web-side TS type generator)
  - Three npm scripts registered as orchestrators for later waves — `openapi:generate` (tsx server/scripts/build-openapi.ts), `contracts:check` (bash stub for Plan 17-07 CI drift detector), `web:types` (openapi-typescript → web/src/lib/api/generated-types.ts)
  - Directory scaffolds with .gitkeep markers — `contracts/openapi/`, `contracts/ws-messages/`, `contracts/ws-fixtures/`, `vendor/device-stream/`, `vendor/sim-capture/`
  - `.gitattributes` flagging 4 generated-file paths as `linguist-generated=true` with LF line endings (collapses GitHub diff viewer noise for machine output)
  - `server/scripts/build-openapi.ts` Wave 0 skeleton — boots buildApp(), awaits ready(), calls app.swagger(), writes server/openapi.json; WS JSON Schema emit block commented out behind TODO(17-02) marker
  - `server/scripts/__tests__/build-openapi.spec.ts` import-shape smoke test (green baseline for Wave 1 to extend)
  - ADR-003 Go discriminated-union mapping decision locked (hand-rolled cli/internal/types/unions.go with discriminator peek + per-variant UnmarshalJSON)
affects: [17-01, 17-02, 17-03, 17-04, 17-05, 17-06, 17-07, 28-cli, 29-web]

# Tech tracking
tech-stack:
  added:
    - "fastify-zod-openapi ^5.6.1 (runtime dep; built on samchungy/zod-openapi v5.x; OpenAPI 3.1 native)"
    - "@fastify/swagger ^9.7.0 (runtime dep; decorates fastify.swagger() with the OpenAPI JSON object)"
    - "openapi-typescript ^7.13.0 (devDep; emits web/src/lib/api/generated-types.ts from server/openapi.json)"
  patterns:
    - "Dedicated build-openapi.ts emitter script (RESEARCH §Pattern 3) — boots Fastify in NODE_ENV=contracts mode, awaits ready() before app.swagger(), exits cleanly; NOT tied to server boot path"
    - "Zod 4 native z.toJSONSchema(registry, {target: 'draft-2020-12', unrepresentable: 'throw', reused: 'ref'}) instead of zod-to-json-schema@3.x (resolves RESEARCH Open Question 1 in-plan)"
    - "linguist-generated=true .gitattributes marker for 4 file paths — collapses diff viewer by default so reviewers see the Zod source change, not the machine-emitted JSON/Go/TS output"
    - "5-directory scaffold-with-.gitkeep pattern — contracts/ for emitted artefacts (openapi.json + ws-messages.json + ws-fixtures/*.sample.json); vendor/ for committed tarballs + Swift source the build consumes from disk rather than GitHub network calls"

key-files:
  created:
    - "server/scripts/build-openapi.ts (60 lines; RESEARCH §Pattern 3 verbatim skeleton)"
    - "server/scripts/__tests__/build-openapi.spec.ts (15 lines; TDD RED+GREEN import-shape smoke test)"
    - "docs/adr/003-go-union-mapping.md (123 lines; Nygard format with verbatim Go UnmarshalJSON skeleton in Decision section)"
    - ".gitattributes (11 lines; LF eol on *.json + *.go; linguist-generated on 4 generated paths)"
    - "contracts/openapi/.gitkeep + contracts/ws-messages/.gitkeep + contracts/ws-fixtures/.gitkeep (0-byte markers)"
    - "vendor/device-stream/.gitkeep + vendor/sim-capture/.gitkeep (0-byte markers)"
    - ".planning/phases/17-contracts-pipeline-ops-hygiene/deferred-items.md (logs pre-existing typecheck errors out-of-scope per SCOPE BOUNDARY)"
  modified:
    - "package.json (add 3 deps, add 3 scripts; all original scripts + deps preserved)"
    - "package-lock.json (npm install auto-regenerated; 5 new packages added)"
    - "docs/adr/README.md (Index table row for ADR-003; numbering hint bumped from 003+ to 004+)"
    - ".gitignore (remove blanket `vendor/` exclude so Phase 17 vendored subtrees are tracked — Rule 3 Blocking deviation)"

key-decisions:
  - "Use fastify-zod-openapi@^5 (NOT @^4 as RESEARCH §Standard Stack specified) — empirical peer-dep check at install time showed fastify-zod-openapi@4.1.2 pins zod@^3.21.4 which conflicts with the locked project pillar zod@^4.3.6; v5.6.1 declares zod '^3.25.74 || ^4.0.0' and accepts Zod 4 natively. All other plan intent preserved (fastify: '5', @fastify/swagger: '^9.0.0' peers satisfied)."
  - "Zod 4 native z.toJSONSchema() path committed; zod-to-json-schema@3.x dep NOT added (resolves RESEARCH Open Question 1 in-plan — Zod 4 shipped the capability so the extra dep is redundant)."
  - "Removed `.gitignore` blanket `vendor/` rule rather than adding negation patterns. Reason: git negation rules do NOT re-include files beneath a parent-ignored directory, so `!vendor/device-stream/**` would silently fail. The only other `vendor/` candidate in the repo was `cli/vendor` (absent — cli/ uses Go modules), so dropping the line is safer than the git-incorrect negation idiom."
  - "build-openapi.ts skeleton includes WS emit block commented out with TODO(17-02) marker rather than deferring the file scaffold entirely — locates the activation point for the next wave and keeps the zod + mkdirSync imports live via `void` so TS stays green."

patterns-established:
  - "Wave-0 substrate plan shape: install peer-dep-audited deps → scaffold output directories with .gitkeep → create skeleton scripts with TODO(next-wave) markers → lock contested architecture decisions in ADR-00N → final plan-metadata commit (mirrors Phase 16 plan 16-00)."
  - "Peer-dep audit via `npm view <pkg> peerDependencies` BEFORE `npm install` (RESEARCH §Pitfall 10). When RESEARCH's version pin is empirically wrong, bump to the matching major and document in SUMMARY under key-decisions rather than using `--force` or `--legacy-peer-deps`."
  - "`linguist-generated=true` convention for repo-wide collapsible diffs — pattern established here (4 paths); Wave 1+ plans add the actual generated files at those paths without editing `.gitattributes` again."
  - "TDD discipline on script-shape tests: RED commit (test-only, fails with module-not-found) → GREEN commit (skeleton makes test pass) — even for import-shape tests that won't have a runtime test-failure behavior."

requirements-completed: [SPEC-06, SPEC-07, CLI-03]

# Metrics
duration: 10 min
completed: 2026-04-20
---

# Phase 17 Plan 17-00: Wave 0 Contract-Pipeline Substrate Summary

**Contract-pipeline dev deps + directory scaffolds + `build-openapi.ts` Wave 0 skeleton + ADR-003 locking hand-rolled Go discriminated-union pattern.**

## Performance

- **Duration:** 10 min
- **Started:** 2026-04-20T18:30:22Z
- **Completed:** 2026-04-20T18:40:47Z
- **Tasks:** 4 (Task 3 TDD expands to RED + GREEN commits)
- **Files created:** 9 (build-openapi.ts + its spec + ADR-003 + .gitattributes + 5 .gitkeep)
- **Files modified:** 4 (package.json + package-lock.json + docs/adr/README.md + .gitignore)

## Accomplishments

- Locked the Wave 0 substrate every subsequent Phase 17 plan depends on. Wave 1 (17-01 + 17-02) now has a ready `build-openapi.ts` to call from npm scripts, a pre-scaffolded `contracts/` tree to emit into, and a peer-dep-verified `fastify-zod-openapi + @fastify/swagger` pair to register in `server/index.ts`.
- Shipped ADR-003 with the verbatim hand-rolled Go discriminated-union skeleton so Wave 2 (17-03 Go codegen) inherits a pre-argued pattern for the `cli/internal/types/unions.go` file.
- Resolved RESEARCH Open Question 1 in-plan — the Zod 4 native `z.toJSONSchema()` call path is now committed (via the `void z` import anchor in the skeleton), so the CONTEXT's `zod-to-json-schema@3.x` dep is NOT carried into the codebase.
- Discovered + fixed the stale RESEARCH version pin on `fastify-zod-openapi@^4` at install time — empirical peer-dep audit caught the Zod 4 incompatibility before it landed in package.json.

## Task Commits

Each task committed atomically:

1. **Task 1: Install contract-pipeline dev deps + add npm scripts** — `125bf28` (chore)
2. **Task 2: Scaffold contracts/ + vendor/ directory tree with .gitkeep** — `282a124` (chore)
3. **Task 3a: RED smoke test for build-openapi.ts skeleton** — `acf6d77` (test)
4. **Task 3b: GREEN build-openapi.ts Wave 0 skeleton** — `d6fe6a8` (feat)
5. **Task 4: Lock Go discriminated-union pattern in ADR-003** — `706bff5` (docs)

_Plan metadata commit follows after this SUMMARY lands._

## Files Created/Modified

### Created
- `server/scripts/build-openapi.ts` — RESEARCH §Pattern 3 skeleton; `main()` boots Fastify via `buildApp()` → `await app.ready()` → `app.swagger()` → writes `server/openapi.json`. WS-schema emit block commented out behind `TODO(17-02)` marker.
- `server/scripts/__tests__/build-openapi.spec.ts` — Vitest import-shape assertion: `mod.main` is an AsyncFunction. No live Fastify boot (deferred to 17-01).
- `docs/adr/003-go-union-mapping.md` — Nygard-format ADR (123 lines). Decision section contains verbatim `unions.go` UnmarshalJSON skeleton; Consequences enumerate adding-a-variant steps.
- `.gitattributes` — Linguist-generated flag on 4 generated paths + LF eol on `*.json` + `*.go`.
- `contracts/openapi/.gitkeep`, `contracts/ws-messages/.gitkeep`, `contracts/ws-fixtures/.gitkeep`, `vendor/device-stream/.gitkeep`, `vendor/sim-capture/.gitkeep` — empty markers so git tracks the otherwise-empty scaffold directories.
- `.planning/phases/17-contracts-pipeline-ops-hygiene/deferred-items.md` — logs pre-existing typecheck errors out-of-scope per SCOPE BOUNDARY.

### Modified
- `package.json` — dependencies: `fastify-zod-openapi@^5.6.1`, `@fastify/swagger@^9.7.0`; devDependencies: `openapi-typescript@^7.13.0`; scripts: `openapi:generate`, `contracts:check`, `web:types`.
- `package-lock.json` — npm install auto-regenerated (+5 packages total; added `fastify-zod-openapi`, `@fastify/swagger`, `openapi-typescript`, their transitive deps).
- `docs/adr/README.md` — Index table gains ADR-003 row; numbering hint bumped from `003+` to `004+`.
- `.gitignore` — removed blanket `vendor/` exclude rule (Rule 3 - Blocking; git negation rules can't re-include files under an ignored parent; no other `vendor/` subtrees exist in the project, so dropping the line is safer than attempting negation).

## Decisions Made

1. **fastify-zod-openapi@^5 instead of @^4** — RESEARCH §Standard Stack locked `^4.x` claiming `zod: '^4.0'` peer, but `npm view fastify-zod-openapi@4.1.2 peerDependencies` empirically returned `zod: '^3.21.4'`. The Zod 4 support actually landed in v5 (5.0.0 cutover). Project's locked Zod 4.3.6 pillar makes v5 the only viable path. All other plan intent preserved: `fastify: '5'` satisfied (5.8.2), `@fastify/swagger: '^9.0.0'` satisfied (9.7.0).
2. **Zod 4 native `z.toJSONSchema()` path committed, zod-to-json-schema NOT added** — resolves RESEARCH Open Question 1 in-plan. The build-openapi.ts skeleton's commented WS emit block calls the native method on `wsMessageRegistry` (symbol lands in 17-02). `void z` at the end of `main()` anchors the import so TS doesn't prune it pre-Wave-1.
3. **Drop `.gitignore` `vendor/` rule rather than negation pattern** — git docs: "It is not possible to re-include a file if a parent directory of that file is excluded." Negation attempts (`!vendor/device-stream/**`) silently failed `git check-ignore`. No other `vendor/` subtrees exist in the repo (cli/ uses Go modules), so dropping the line is the safe + minimal fix.
4. **WS emit block stays as commented-out TODO rather than deferring the skeleton** — locates the activation point for 17-02 via the `TODO(17-02):` marker and via `void z`/`void mkdirSync` anchors. Keeps the skeleton at the plan's min_lines=40 while honoring the "Wave 1 activates" intent.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Bumped fastify-zod-openapi from ^4 to ^5**
- **Found during:** Task 1 (peer-dep audit step)
- **Issue:** `npm install fastify-zod-openapi@^4 @fastify/swagger@^9.7` exited with `ERESOLVE` — fastify-zod-openapi@4.1.2 (latest 4.x) pins `zod@^3.21.4`, but the project has `zod@^4.3.6` locked as a v3.0 pillar.
- **Fix:** Empirical `npm view` audit discovered v5.x declares `zod: '^3.25.74 || ^4.0.0'` and satisfies all other plan constraints (`fastify: '5'`, `@fastify/swagger: '^9.0.0'`). Installed `fastify-zod-openapi@^5` instead.
- **Files modified:** `package.json`, `package-lock.json`
- **Verification:** `node -e "require('fastify-zod-openapi'); require('@fastify/swagger')"` both resolve; `npx tsc --noEmit` introduces 0 new errors; deferred-items.md logs pre-existing typecheck baseline.
- **Committed in:** `125bf28` (Task 1 commit)

**2. [Rule 3 - Blocking] Dropped `.gitignore` blanket `vendor/` rule**
- **Found during:** Task 2 (staging vendor/.gitkeep files)
- **Issue:** `git add vendor/device-stream/.gitkeep` rejected with `paths are ignored by one of your .gitignore files`. The existing `vendor/` rule (from Go/PHP conventions) blanket-excluded the Phase 17 scaffold subtree.
- **Fix:** Attempted negation pattern first (`!vendor/device-stream/**`) — `git check-ignore -v` confirmed git does NOT re-include files under an ignored parent. Fell back to removing the `vendor/` line entirely. No other `vendor/` subtree exists (`cli/` uses Go modules; no PHP/composer), so the risk of catching unrelated junk is zero. Added an explanatory comment referencing the Phase 17 commitment.
- **Files modified:** `.gitignore`
- **Verification:** `git check-ignore -v vendor/device-stream/.gitkeep vendor/sim-capture/.gitkeep` exits 1 (not ignored); both files staged + committed successfully.
- **Committed in:** `282a124` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (2 Rule 3 - Blocking, 0 Rule 1 - Bug, 0 Rule 2 - Missing Critical, 0 Rule 4 - Architectural).
**Impact on plan:** Both auto-fixes were single-line config resolutions necessary to unblock the plan's stated intent (install deps, track scaffolds). Zero scope creep; zero new tech introduced beyond what the plan specified. The fastify-zod-openapi version bump supersedes RESEARCH's stale Apr-2026 version pin — Wave 1 (17-01) should cite v5 APIs when wiring the type provider.

## Issues Encountered

### Peer-dep verification result (Task 1 Step 1)

- `npm view fastify-zod-openapi peerDependencies` returned `{'@fastify/swagger': '^9.0.0', '@fastify/swagger-ui': '^5.0.1', fastify: '5', zod: '^3.25.74 || ^4.0.0'}` — this is the v5.x (latest) peer manifest, misleading when the plan pins `^4`. The `^4.1.2` peer manifest pins `zod@^3.21.4` which excludes Zod 4.
- `npm view @fastify/swagger@^9.7 peerDependencies` returned empty. 9.7.0 has no declared peer constraints, accepts fastify 5.8.2 transparently.
- `fastify@5.8.2` satisfied all plugin peer ranges at v5.6.1 + 9.7.0. No `overrides` block needed in package.json.

### fastify@5.8.2 peer-range verdict

- `fastify-zod-openapi@5.6.1` peer: `fastify: '5'` → any v5.x → SATISFIED by 5.8.2.
- `@fastify/swagger@9.7.0` peer: (none declared) → SATISFIED trivially.
- No overrides required.

### z.toJSONSchema native path confirmation

- `package.json` has NO `zod-to-json-schema` entry (grep -c returned 0).
- `server/scripts/build-openapi.ts` imports `{ z } from 'zod'` and calls `z.toJSONSchema(...)` in the commented Wave-1-activation block.
- RESEARCH Open Question 1 is resolved in-plan — no separate dep, no CONTEXT backfill needed.

### Scaffolding gotchas

- `.gitignore` had a pre-existing blanket `vendor/` rule from earlier conventions. Fixed via deviation Rule 3 (see Deviations section). No actual conflicts under `contracts/` — that directory did not exist pre-plan, so scaffolding was collision-free.

### Pre-existing typecheck errors (out-of-scope)

- `npx tsc --noEmit` reports 8 errors in 6 unrelated files. All pre-date Plan 17-00 (documented in `.planning/phases/17-contracts-pipeline-ops-hygiene/deferred-items.md`). 0 new errors from any of the 4 tasks in this plan. Diff-against-stash verification confirmed the 2 errors in `server/artifacts/recording-service.ts` originate from uncommitted working-tree changes predating this plan; the other 6 are the Phase 16 baseline carried in STATE.md.

## User Setup Required

None — all changes are code + config; no external service configuration.

## Next Phase Readiness

- **Ready for Plan 17-01** (wire fastify-zod-openapi into `server/index.ts` + per-module route signatures). The dep is installed, the npm script that will invoke the generator is registered, and the `contracts/openapi/` sink directory exists.
- **Ready for Plan 17-02** (WS schemas + contracts/ws-messages.ts registry). The `TODO(17-02)` marker in `build-openapi.ts` locates the single import + 8 commented lines that Wave 1 uncomments.
- **Ready for Plan 17-03** (Go codegen). ADR-003 locks the hand-rolled `unions.go` pattern; Wave 2 just consumes the decision.
- **Ready for Plan 17-05** (@device-stream vendoring). `vendor/device-stream/` + `vendor/sim-capture/` subtrees are tracked; `.gitattributes` keeps future tarball diffs collapsed by default.
- **No blockers.** The two deviations were single-line fixes applied + committed.

## Self-Check: PASSED

Verified:
- Created files on disk: `server/scripts/build-openapi.ts`, `server/scripts/__tests__/build-openapi.spec.ts`, `docs/adr/003-go-union-mapping.md`, `.gitattributes`, 5 `.gitkeep` files under contracts/ + vendor/, deferred-items.md — all present.
- Commits exist in git log: `125bf28` (Task 1), `282a124` (Task 2), `acf6d77` (Task 3 RED), `d6fe6a8` (Task 3 GREEN), `706bff5` (Task 4) — all verified with `git log --oneline | grep`.
- Plan verification block passes: all deps resolve, all scripts registered, 5 .gitkeep files tracked, smoke test green, ADR-003 indexed in README, 4 linguist-generated entries in .gitattributes, typecheck at pre-plan baseline (8 unchanged errors, 0 regressions).

---
*Phase: 17-contracts-pipeline-ops-hygiene*
*Completed: 2026-04-20*
