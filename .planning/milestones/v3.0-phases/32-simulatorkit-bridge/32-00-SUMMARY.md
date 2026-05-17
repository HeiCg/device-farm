---
phase: 32-simulatorkit-bridge
plan: 00
subsystem: infra
tags: [xcodegen, xctest, vitest, github-actions, simulatorkit, objc++, postinstall]

requires:
  - phase: 32-simulatorkit-bridge
    provides: BRIEF + RESEARCH + VALIDATION (Wave 0 substrate is the first plan)

provides:
  - XcodeGen project at device-stream/native-servers/sim-capture-private/ with 2 targets (daemon tool + XCTest bundle)
  - Empty header surface (Bridge.h / DyldSymbols.h / IpcServer.h) so future-wave test code can #import without compile errors
  - Stub XCTest scaffolds (DyldSymbolsTests / IpcFramerTests / TouchInjectTests) — all XCTSkip with phase-pointer comments
  - MockSimDevice fixture stub (objc_allocateClassPair-ready shape, body fills in Plan 02)
  - Vitest scaffold sim-capture-private-client.spec.ts with 5 it.todo placeholders matching 32-VALIDATION.md Per-Task map
  - device-stream/scripts/build-sim-capture-private.sh build wrapper (stub exits 1 with informative message)
  - device-stream/scripts/postinstall.js new ESM-safe CommonJS hook (first postinstall file in device-stream)
  - device-stream/scripts/smoke-sim-private.sh end-to-end smoke stub
  - .github/workflows/sim-private-matrix.yml daily Xcode-matrix workflow on macos-14 (4 Xcode versions)
  - 2 new npm scripts in device-stream/package.json (build:sim-capture-private + postinstall)

affects:
  - Plan 32-01 (T-32.1 fills DyldSymbols + Probe.mm)
  - Plan 32-02 (T-32.2/T-32.3 fills Bridge.h body + MockSimDevice.mm body)
  - Plan 32-03 (T-32.4 fills IpcServer body + framer)
  - Plan 32-04 (T-32.5/T-32.6 fills TS adapter + flips build-sim-capture-private.sh stub)
  - Plan 32-05 (T-32.7 fills smoke-sim-private.sh + runbook)

tech-stack:
  added:
    - XcodeGen 2.45.3 (project.yml → .xcodeproj generation; brew install xcodegen)
    - XCTest bundle.unit-test target via XcodeGen
    - matrix GitHub Actions on macos-14 (Apple Silicon)
  patterns:
    - "Empty-header substrate: ship #pragma once headers in Wave 0 so XCTest target compiles while later waves land .mm bodies"
    - "Env-gated stub scripts: SIM_PRIVATE_WAVE0_STUB=1 default exits 1 with phase-pointer message; Plan 04 flips default"
    - "Non-blocking postinstall: spawnSync result.status !== 0 logs warning but does not exit nonzero — npm install never fails on a stub build"
    - "Hoisted matrix vars: ${{ matrix.X }} written into env: block before run: per GitHub Actions injection guidance"

key-files:
  created:
    - device-stream/native-servers/sim-capture-private/project.yml
    - device-stream/native-servers/sim-capture-private/README.md
    - device-stream/native-servers/sim-capture-private/.gitignore
    - device-stream/native-servers/sim-capture-private/Sources/main.mm
    - device-stream/native-servers/sim-capture-private/Sources/Probe.mm
    - device-stream/native-servers/sim-capture-private/Sources/Bridge.h
    - device-stream/native-servers/sim-capture-private/Sources/DyldSymbols.h
    - device-stream/native-servers/sim-capture-private/Sources/IpcServer.h
    - device-stream/native-servers/sim-capture-private/Tests/DyldSymbolsTests.mm
    - device-stream/native-servers/sim-capture-private/Tests/IpcFramerTests.mm
    - device-stream/native-servers/sim-capture-private/Tests/TouchInjectTests.mm
    - device-stream/native-servers/sim-capture-private/Tests/Fixtures/MockSimDevice.h
    - device-stream/native-servers/sim-capture-private/Tests/Fixtures/MockSimDevice.mm
    - device-stream/packages/ios-simulator/tests/sim-capture-private-client.spec.ts
    - device-stream/scripts/build-sim-capture-private.sh
    - device-stream/scripts/postinstall.js
    - device-stream/scripts/smoke-sim-private.sh
    - .github/workflows/sim-private-matrix.yml
  modified:
    - device-stream/package.json (+ build:sim-capture-private + postinstall scripts)

key-decisions:
  - "XcodeGen over hand-written .xcodeproj: project.yml lives in tree, .xcodeproj is generated + gitignored (matches Phase 17+ infra-as-text discipline)"
  - "Empty-header substrate: Bridge.h / DyldSymbols.h / IpcServer.h ship with only #pragma once + phase-pointer comments so XCTest target can #import them in Wave 0 without compile errors waiting on later .mm bodies"
  - "Stub scripts exit 1 with informative stderr message and SIM_PRIVATE_WAVE0_STUB env gate — Plan 04 (T-32.6) flips the gate without restructuring the script"
  - "Postinstall is non-blocking: spawnSync result.status !== 0 logs a warning but the parent Node process exits 0 so npm install never fails on a stub build (Phase 32 success criterion #5)"
  - "CI matrix uses XCODE_VERSION env hoist instead of inlining ${{ matrix.xcode }} into the run: script — Rule 2 hardening per GitHub Actions workflow injection guide (auto-applied during Task 0.3)"

patterns-established:
  - "Wave 0 substrate-only plan: 0 production lines, every later plan's <verify> command has a target file to run against (resolves all ❌ Wave 0 entries in 32-VALIDATION.md to ✅ exists)"
  - "Test file naming mirrors implementing-plan acceptance: testResolveStableSymbol_isImplementedInPlan01 / testRoundTripFrame_isImplementedInPlan03 — grep-friendly for future plan-checker phases"

requirements-completed:
  - SIM-PRIV-02   # scaffold exists; production code lands Plan 32-01
  - SIM-PRIV-05   # scaffold exists; production code lands Plan 32-04
  - SIM-PRIV-06   # CI matrix workflow exists; production smoke lands Plan 32-05
  - SIM-PRIV-REF  # IPC framer scaffold exists; production code lands Plan 32-03

duration: 10min
completed: 2026-05-15
---

# Phase 32 Plan 00: Substrate Scaffolding Summary

**XcodeGen-based Obj-C++ project + XCTest skips + Vitest todos + stub build script + non-blocking postinstall + daily Xcode-matrix CI — 17 new files, zero production logic, every later wave's verify command now resolves.**

## Performance

- **Duration:** 10 min
- **Started:** 2026-05-15T23:34:13Z
- **Completed:** 2026-05-15T23:43:57Z
- **Tasks:** 3
- **Files created:** 17 (+ 1 modified: device-stream/package.json)

## Accomplishments

- XcodeGen `project.yml` declares two targets (`sim-capture-private` tool + `Tests` bundle.unit-test) with weak-linked `SimulatorKit.framework` + `CoreSimulator.framework` from both `/Library/Developer/PrivateFrameworks` and `$(DEVELOPER_DIR)/Library/PrivateFrameworks`. `xcodegen generate` runs cleanly on the local machine (xcodegen 2.45.3 via brew). `.xcodeproj` is gitignored.
- `main.mm` compiles standalone (`clang -fobjc-arc -framework Foundation`) and exits 1 with `sim-capture-private: not implemented yet (Phase 32 in progress)`.
- 5 test scaffolds (3 XCTest `.mm` + 1 Vitest `.spec.ts` + 1 MockSimDevice fixture pair) ship with `XCTSkip` / `it.todo` placeholders whose messages reference the exact downstream plan + requirement ID.
- `npx vitest run device-stream/packages/ios-simulator/tests/sim-capture-private-client.spec.ts` exits 0 with 5 todos reported.
- `bash device-stream/scripts/build-sim-capture-private.sh` exits 1 with the stub message on stderr. `bash device-stream/scripts/smoke-sim-private.sh` does the same. `node device-stream/scripts/postinstall.js` runs the stub, observes status=1, logs a warning, and exits 0 — npm install will never fail on a Wave 0 stub.
- `.github/workflows/sim-private-matrix.yml` parses cleanly via js-yaml; `matrix.xcode` enumerates 4 Xcode versions; all matrix substitutions hoisted into `env:` blocks before `run:` per GitHub Actions injection guidance.

## Task Commits

Each task was committed atomically:

1. **Task 0.1: XcodeGen project.yml + Sources + headers + README** — `1ba7538` (feat)
2. **Task 0.2: XCTest scaffolds + MockSimDevice fixture + Vitest scaffold** — `b1fcc58` (test)
3. **Task 0.3: Build script stub + postinstall + smoke + Xcode matrix workflow** — `15e89dd` (chore)

**Plan metadata commit:** _pending_ (this SUMMARY + STATE.md + ROADMAP.md update)

## Files Created/Modified

### Created (17)

- `device-stream/native-servers/sim-capture-private/project.yml` — XcodeGen spec, 2 targets, macOS 13+ arm64, weak-linked SimulatorKit + CoreSimulator
- `device-stream/native-servers/sim-capture-private/README.md` — build commands, unsigned-dev caveat, env opt-out, layout map
- `device-stream/native-servers/sim-capture-private/.gitignore` — `sim-capture-private.xcodeproj/`, `build/`, `DerivedData/`
- `device-stream/native-servers/sim-capture-private/Sources/main.mm` — entry stub (compiles, exits 1)
- `device-stream/native-servers/sim-capture-private/Sources/Probe.mm` — symbol-probe stub (Plan 32-01 fills)
- `device-stream/native-servers/sim-capture-private/Sources/Bridge.h` — empty header (Plans 32-02/04 implement)
- `device-stream/native-servers/sim-capture-private/Sources/DyldSymbols.h` — empty header (Plan 32-01 implements)
- `device-stream/native-servers/sim-capture-private/Sources/IpcServer.h` — empty header + IPC wire-format doc-comment (Plan 32-03 implements)
- `device-stream/native-servers/sim-capture-private/Tests/DyldSymbolsTests.mm` — 2 XCTSkip placeholders for SIM-PRIV-02
- `device-stream/native-servers/sim-capture-private/Tests/IpcFramerTests.mm` — 2 XCTSkip placeholders for SIM-PRIV-REF
- `device-stream/native-servers/sim-capture-private/Tests/TouchInjectTests.mm` — 1 XCTSkip placeholder for SIM-PRIV-04 unit
- `device-stream/native-servers/sim-capture-private/Tests/Fixtures/MockSimDevice.h` — interface only
- `device-stream/native-servers/sim-capture-private/Tests/Fixtures/MockSimDevice.mm` — `+deviceWithUDID:` stub; body for `onHIDSend` block fills in Plan 32-02
- `device-stream/packages/ios-simulator/tests/sim-capture-private-client.spec.ts` — 5 it.todo placeholders matching 32-VALIDATION.md Per-Task map
- `device-stream/scripts/build-sim-capture-private.sh` — wrapper stub, `SIM_PRIVATE_WAVE0_STUB=1` default
- `device-stream/scripts/postinstall.js` — ESM-safe CommonJS hook; spawnSync stub; non-blocking on failure
- `device-stream/scripts/smoke-sim-private.sh` — 1-line stub for Plan 32-05
- `.github/workflows/sim-private-matrix.yml` — daily cron + workflow_dispatch; macos-14; 4 Xcode versions; XCODE_VERSION env hoist

### Modified (1)

- `device-stream/package.json` — added 2 script keys (`build:sim-capture-private`, `postinstall`), preserved all existing keys verbatim

## Decisions Made

- **XcodeGen over hand-written .xcodeproj.** `project.yml` is the single source of truth; the generated `.xcodeproj` is reproducible on every checkout via `xcodegen generate` and gitignored. Matches Phase 17+ infra-as-text discipline (no binary blobs in source tree).
- **Empty-header substrate.** `Bridge.h`, `DyldSymbols.h`, `IpcServer.h` ship with only `#pragma once` + phase-pointer comment. This lets the XCTest target `#import` them in Wave 0 without compile errors while waiting on later waves to land `.mm` bodies — the test-target build never breaks across the plan transition.
- **Env-gated stub scripts.** `SIM_PRIVATE_WAVE0_STUB=1` default exits 1 immediately; Plan 04 (T-32.6) flips the default to 0 (or removes the gate). The bottom half of the script — the real xcodebuild invocation — is already present and dead-code-correct, so Plan 04 only edits the gate, not the build logic.
- **Non-blocking postinstall.** `spawnSync` result is logged but never re-thrown; the parent Node process exits 0 regardless of child status. This satisfies Phase 32 success criterion #5 ("Postinstall hook is non-blocking on stub failure (npm install must still succeed)").
- **CI matrix env hoist.** Per GitHub Actions injection guide, all `${{ matrix.X }}` substitutions are hoisted into `env:` blocks. Concretely: `${{ matrix.xcode }}` → `env: { XCODE_VERSION: ${{ matrix.xcode }} }` → `run: ... "$XCODE_VERSION" ...`. Applied during Task 0.3 as a Rule 2 hardening when the PreToolUse security-reminder hook flagged the file.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 — Missing Critical] CI workflow matrix variable injection hardening**

- **Found during:** Task 0.3 (writing `.github/workflows/sim-private-matrix.yml`)
- **Issue:** Plan literal inlined `${{ matrix.xcode }}` directly into the `run:` script body. PreToolUse security-reminder hook flagged this against the GitHub Actions workflow injection guide.
- **Fix:** Hoisted `${{ matrix.xcode }}` into an `env: { XCODE_VERSION: ${{ matrix.xcode }} }` block; `run:` script reads `"$XCODE_VERSION"`. Functionally equivalent, safe against any future change that might let workflow inputs flow into the matrix expression.
- **Files modified:** `.github/workflows/sim-private-matrix.yml`
- **Verification:** `js-yaml` parses cleanly; `grep -c "matrix:"` = 1; `grep -c "xcode:"` = 1; 4 Xcode versions enumerated; XCODE_VERSION env present in Select Xcode step.
- **Committed in:** `15e89dd` (Task 0.3 commit)

---

**Total deviations:** 1 auto-fixed (1 missing critical / security hardening)
**Impact on plan:** No scope creep. Output shape identical to plan literal; only the variable-passing mechanism changed.

## Issues Encountered

- **PreToolUse Write hook silent-blocked the first attempt at `.github/workflows/sim-private-matrix.yml`.** The hook fires on workflow files and printed a security reminder; the first Write returned `File created successfully` but the file did not appear on disk (likely `.github/` parent directory did not exist combined with the hook's interaction). Resolution: created `.github/workflows/` explicitly with `mkdir -p`, re-ran Write with the Rule 2 env-hoist applied. File appeared on disk. Self-check confirms.
- **`python3 -c "import yaml"` failed (pyyaml not installed).** Plan suggested yamllint with python3 fallback; both unavailable. Used `node -e "require('js-yaml').load(...)"` instead — `js-yaml` is a transitive dependency in the repo. YAML parses cleanly. Documented for the next phase: prefer `node -e` YAML validation in stub verify commands until a uniform tool is mandated.

## Next Phase Readiness

- **Plan 32-01 unblocked.** `DyldSymbols.h` + `DyldSymbolsTests.mm` + `Probe.mm` all exist as stubs; Plan 01 fills `DyldSymbols.h`'s declarations, `Probe.mm`'s body, and converts the two `XCTSkip` placeholders to real assertions.
- **Plan 32-02 unblocked.** `Bridge.h` + `MockSimDevice.{h,mm}` + `TouchInjectTests.mm` all exist; Plan 02 fills `MockSimDevice.mm` via `objc_allocateClassPair` and converts the `XCTSkip` to a real assertion calling `bridge_send_touch`.
- **Plan 32-03 unblocked.** `IpcServer.h` + `IpcFramerTests.mm` exist; Plan 03 fills the framer surface + decoder tests.
- **Plan 32-04 unblocked.** `build-sim-capture-private.sh` stub gate + `sim-capture-private-client.spec.ts` 5 it.todo tests exist; Plan 04 flips `SIM_PRIVATE_WAVE0_STUB` default + converts the 5 todos to real assertions against the TS adapter.
- **Plan 32-05 unblocked.** `smoke-sim-private.sh` stub + `sim-private-matrix.yml` workflow exist; Plan 05 fills the smoke script + adds the runbook.
- **External Dependencies Policy honored.** No npm/Go/CocoaPods/SwiftPM dependency added on any reference repo (kittyfarm, simvyn, revyl, app-explorer, mobile-devtools). All transcribed knowledge lives in plan + summary documentation only.

## Self-Check: PASSED

- 18/18 files on disk (17 created by this plan + 1 modified device-stream/package.json scripts block)
- 3/3 task commits present in git history (`1ba7538`, `b1fcc58`, `15e89dd`)
- `npx vitest run device-stream/packages/ios-simulator/tests/sim-capture-private-client.spec.ts` → 5 todo tests reported (PASS 5 FAIL 0)
- `bash device-stream/scripts/build-sim-capture-private.sh` → exit 1 with stub message
- `bash device-stream/scripts/smoke-sim-private.sh` → exit 1 with stub message
- `node device-stream/scripts/postinstall.js` (with stub) → exit 0 (non-blocking)
- `node -e "require('js-yaml').load(require('fs').readFileSync('.github/workflows/sim-private-matrix.yml','utf8'))"` → success
- xcodegen 2.45.3 generates `sim-capture-private.xcodeproj` cleanly from project.yml (verified locally, not committed)

---
*Phase: 32-simulatorkit-bridge*
*Completed: 2026-05-15*
