---
phase: 17-contracts-pipeline-ops-hygiene
plan: 06
subsystem: infra
tags: [npm, vendoring, device-stream, debt-01, package-management, tarball]

# Dependency graph
requires:
  - phase: 17-00
    provides: vendor/ scaffold (device-stream/.gitkeep, sim-capture/.gitkeep) + .gitattributes linguist-generated rules
provides:
  - Vendored @device-stream/{core,android,ios-simulator} 1.1.0 npm-pack tarballs committed at vendor/device-stream/*.tgz (~171KB total)
  - package.json @device-stream/* refs migrated from file:../device-stream/packages/* → file:./vendor/device-stream/*-1.1.0.tgz
  - scripts/vendor-device-stream.sh reproducible refresh tool (manual, committed, not CI-run)
  - vendor/device-stream/README.md vendoring contract (contents + refresh procedure + reversibility to npm registry)
  - vendor/sim-capture/README.md deferral contract (Swift source vendoring scoped to follow-up plan)
  - npm ci succeeds on a fresh clone without a sibling ../device-stream repo — DEBT-01 npm portion closed
affects: [17-07, 17-08, 20-pool-module, 28-cli-refactor]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Vendored npm-pack tarballs committed to vendor/<pkg>/<name>-<version>.tgz with matching file:./vendor/<pkg>/<name>-<version>.tgz refs in package.json"
    - "Companion refresh script at scripts/vendor-<pkg>.sh that npm-packs each source package, cleans stale tarballs, and writes into vendor/"
    - "vendor/<pkg>/README.md documents contents + refresh procedure + reversibility path (registry migration) — committed alongside the tarballs"

key-files:
  created:
    - scripts/vendor-device-stream.sh
    - vendor/device-stream/core-1.1.0.tgz
    - vendor/device-stream/android-1.1.0.tgz
    - vendor/device-stream/ios-simulator-1.1.0.tgz
    - vendor/device-stream/README.md
    - vendor/sim-capture/README.md
  modified:
    - package.json (3 @device-stream/* deps rewritten)
    - package-lock.json (regenerated; references vendor/device-stream paths)
  deleted:
    - vendor/device-stream/.gitkeep (replaced by real tarballs)
    - vendor/sim-capture/.gitkeep (replaced by README.md)

key-decisions:
  - "Chose npm-pack tarball vendoring over @device-stream/* workspace inclusion — workspaces require a monorepo layout incompatible with device-stream shipping as its own repo and namespace"
  - "Kept sim-capture Swift source vendoring out of scope — installSimCapture in cli/cmd/dependencies.go runs at user-setup time, not npm install time, so deferring it does not break the DEBT-01 goal (fresh-clone npm install)"
  - "Removed vendor/device-stream/.gitkeep and vendor/sim-capture/.gitkeep — real content (tarballs + READMEs) now tracks both directories, making the scaffold placeholders obsolete"
  - "Reversibility documented explicitly in vendor/device-stream/README.md: migration to a published registry only requires swapping file: specs for version specs plus an .npmrc — no code changes needed"

patterns-established:
  - "Reproducible-refresh contract: every vendored dependency subtree (vendor/<pkg>/) pairs a script (scripts/vendor-<pkg>.sh) + README (vendor/<pkg>/README.md) so a human can regenerate the tarballs without tribal knowledge"
  - "Scope-boundary documentation: vendor/sim-capture/README.md explicitly marks what is in-scope vs deferred so a reader landing on the directory understands the follow-up plan without reading 17-06-PLAN.md"

requirements-completed: [DEBT-01]

# Metrics
duration: 6min
completed: 2026-04-20
---

# Phase 17 Plan 06: Vendor @device-stream/* via npm-pack tarballs Summary

**Closed DEBT-01 npm portion — device-farm consumes @device-stream/{core,android,ios-simulator} via committed `file:./vendor/device-stream/*-1.1.0.tgz` tarballs; fresh `npm ci` succeeds on a clean machine without a sibling `../device-stream` repo**

## Performance

- **Duration:** 6 min
- **Started:** 2026-04-20T20:05:15Z
- **Completed:** 2026-04-20T20:12:00Z (approx)
- **Tasks:** 4
- **Files created:** 6 (script + 3 tarballs + 2 READMEs)
- **Files modified:** 2 (package.json, package-lock.json)
- **Files deleted:** 2 (obsolete .gitkeeps)

## Accomplishments

- `scripts/vendor-device-stream.sh` — 76-line reproducible refresh tool accepting an optional device-stream checkout path (defaults to `../device-stream`), runs `npm install` (if missing) + `npm run build` + `npm pack` in each of the 3 sub-packages, moves the resulting tarballs into `vendor/device-stream/<pkg>-<version>.tgz`; cleans stale tarballs before packing
- `vendor/device-stream/` populated with 3 valid npm-pack archives totaling 171KB: `core-1.1.0.tgz` (97KB), `android-1.1.0.tgz` (31KB), `ios-simulator-1.1.0.tgz` (43KB) — well under the <20MB guideline
- `package.json` dependencies block rewritten to reference the vendored tarballs via `file:./vendor/device-stream/<pkg>-1.1.0.tgz` for all 3 `@device-stream/*` packages
- `package-lock.json` regenerated from scratch (`rm -rf node_modules package-lock.json && npm install`); lock now references `vendor/device-stream` paths in resolved fields; fresh-clone simulation via `rm -rf node_modules && npm ci` succeeds in ~12s with 681 packages installed
- `vendor/device-stream/README.md` (60 lines) documents contents, npm consumption pattern, refresh procedure via the companion script, reversibility to a published npm registry (note: @device-stream/* source already declares `publishConfig.registry: "https://npm.pkg.github.com"`), and the rationale for not using npm workspaces
- `vendor/sim-capture/README.md` (36 lines) explicitly marks the directory as an empty scaffold, names `cli/cmd/dependencies.go:installSimCapture()` as the future consumer, and defers Swift source vendoring to a follow-up plan in Phase 20 (Pool Module) or Phase 28 (CLI Refactor) scope — keeps the DEBT-01 scope-closure story honest about what remains

## Task Commits

1. **Task 1: Create scripts/vendor-device-stream.sh refresh script** — `bdb1c83` (chore)
2. **Task 2: Run vendor script to produce 3 tarballs** — `0ebafbd` (chore)
3. **Task 3: Rewrite package.json @device-stream refs + regenerate package-lock.json** — `5a2231c` (fix)
4. **Task 4: Document vendoring contract in 2 README files** — `6d178d3` (docs)

**Plan metadata commit:** (final SUMMARY + STATE + ROADMAP commit — hash follows)

## Files Created/Modified

- `scripts/vendor-device-stream.sh` — Manual refresh tool; `bash -n` clean; executable; PACKAGES=(core android ios-simulator)
- `vendor/device-stream/core-1.1.0.tgz` — @device-stream/core v1.1.0 npm-pack archive (97KB)
- `vendor/device-stream/android-1.1.0.tgz` — @device-stream/android v1.1.0 npm-pack archive (31KB)
- `vendor/device-stream/ios-simulator-1.1.0.tgz` — @device-stream/ios-simulator v1.1.0 npm-pack archive (43KB)
- `vendor/device-stream/README.md` — Vendoring contract: contents, refresh, reversibility, workspace rationale
- `vendor/sim-capture/README.md` — Deferral contract: marks empty-scaffold status, names installSimCapture + cli/cmd/dependencies.go as future consumer
- `package.json` — 3 `@device-stream/*` deps rewritten to `file:./vendor/device-stream/<pkg>-1.1.0.tgz`
- `package-lock.json` — Full regeneration; references vendor/device-stream paths; accepted by `npm ci`
- `vendor/device-stream/.gitkeep` (DELETED) — Scaffold placeholder from Plan 17-00, made obsolete by real tarball content
- `vendor/sim-capture/.gitkeep` (DELETED) — Scaffold placeholder from Plan 17-00, made obsolete by README.md

## Decisions Made

- **Pattern: reproducible-refresh via committed script + README** — The vendor-device-stream.sh script is NOT run by CI; it is a human tool invoked when device-stream ships a new version. Committing the script + README together ensures the procedure survives turnover and is discoverable by any maintainer who lands on vendor/device-stream/.
- **Scope boundary: npm packages only, Swift source deferred** — The Swift `sim-capture` source used by `cli/cmd/dependencies.go:installSimCapture` is only invoked at `device-farm dependencies` user-setup time, not at `npm install` time. Plan 17-06's goal (fresh-clone `npm install` succeeds) is complete without vendoring sim-capture sources. Follow-up plan will vendor `tools/sim-capture/` under `vendor/sim-capture/` and update installSimCapture to read from there.
- **Removed .gitkeep scaffolds** — Keeping `.gitkeep` alongside real content (tarballs, README) is misleading. Real files track the directory without them; Plan 17-00's scaffold purpose is now fulfilled.
- **No npm workspaces** — device-stream ships as its own repo with its own npm namespace and publishConfig.registry. A workspace would require collapsing both repos into one monorepo, out of scope for Phase 17. The `file:` tarball pattern is the lowest-friction bridge until registry publishing lands.
- **Reversibility is one search-and-replace away** — vendor/device-stream/README.md documents the registry-migration path: swap `file:./vendor/device-stream/<pkg>-<version>.tgz` for `^<version>` and add `.npmrc` pointing at `https://npm.pkg.github.com`. The source repo already declares the publish registry, so only the consumer side needs editing.

## Deviations from Plan

None — plan executed exactly as written. All 4 tasks completed atomically, each verification block passed first try, no auto-fixes needed, no architectural decisions surfaced.

## Issues Encountered

None of substance. One non-issue to flag for future readers:

- The initial `npm install` run surfaced a buffer-dump that looked alarming in the terminal tail — a post-install script had a transient noise message — but the actual `added N packages` line confirmed success and `test -d node_modules/@device-stream/*` passed for all three packages. Subsequent `npm install` (idempotent) and `npm ci` (strict, from a clean slate) both exited 0. Not a deviation; flagged here only so a reader re-running the verification sees the same noise without confusion.

## User Setup Required

None — no external service configuration needed. Downstream consumers (developers cloning device-farm for the first time) now skip the prior "also clone sibling device-stream repo" step; `git clone device-farm && npm ci` is the complete setup for the JS half of the stack. (iOS simulator capture via `installSimCapture` still requires the sibling repo until the Swift-source follow-up plan lands — see vendor/sim-capture/README.md.)

## Verification Summary

Plan's overall verification block ran clean:

- `rm -rf node_modules && npm ci --no-audit --no-fund` → exit 0, 681 packages installed in 12s
- `grep 'file:\.\./device-stream' package.json` → exit 1 (no sibling refs remain)
- `grep -c 'file:\./vendor/device-stream' package.json` → 3 (one per @device-stream package)
- `tar -xzOf vendor/device-stream/<pkg>-1.1.0.tgz package/package.json` → name + version match for all 3
- `test -x scripts/vendor-device-stream.sh && bash -n scripts/vendor-device-stream.sh` → exits 0
- Both README files > 15 lines, contain required keywords (tarball filenames, reversibility, installSimCapture, cli/cmd/dependencies.go, defer)

## Next Phase Readiness

- **DEBT-01 npm portion closed.** CI containers and fresh-clone contributors can run `npm install` without provisioning a sibling `../device-stream` checkout.
- **Remaining DEBT-01 work** (Swift sim-capture source vendoring) is documented in `vendor/sim-capture/README.md` as a follow-up; not blocking for any other Phase 17 plan.
- **Phase 17 Plan 17-07** unblocked — ops hygiene plans can proceed on any clean checkout; no hidden sibling-repo dependency remains in the npm dependency graph.
- **Phase 20 (Pool Module)** and **Phase 28 (CLI Refactor)** authors have a documented entry point (`vendor/sim-capture/README.md`) for picking up the Swift vendoring.

## Self-Check: PASSED

- All 6 created files present on disk (script, 3 tarballs, 2 READMEs, SUMMARY)
- All 4 task commits reachable via `git log` (bdb1c83, 0ebafbd, 5a2231c, 6d178d3)
- `npm ci` on a clean node_modules verified end-to-end during Task 3

---
*Phase: 17-contracts-pipeline-ops-hygiene*
*Completed: 2026-04-20*
