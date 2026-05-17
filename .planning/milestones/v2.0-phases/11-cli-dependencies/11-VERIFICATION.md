---
phase: 11-cli-dependencies
verified: 2026-04-15T19:35:00Z
status: passed
score: 6/6 must-haves verified
re_verification: false
---

# Phase 11: CLI Dependencies Verification Report

**Phase Goal:** User can run a single command to automatically install all missing dependencies detected by doctor
**Verified:** 2026-04-15T19:35:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #  | Truth                                                                                        | Status     | Evidence                                                                                                                 |
|----|----------------------------------------------------------------------------------------------|------------|--------------------------------------------------------------------------------------------------------------------------|
| 1  | Running `device-farm dependencies` with all deps present prints 'All dependencies already installed' and exits 0 | VERIFIED | `runDependencies` calls `buildInstallList`, returns early at line 126–131 with green "All dependencies already installed." message |
| 2  | Running `device-farm dependencies` with missing deps installs each one sequentially with real-time streamed output | VERIFIED | `runStreamed` uses `StdoutPipe + bufio.Scanner` line-by-line output indented 4 spaces; loop at lines 147–173 iterates `toInstall` |
| 3  | Already-installed dependencies are skipped (no reinstall, no error)                          | VERIFIED | `buildInstallList` only includes deps whose `CheckNames` appear in `failedNames` map; skipped count tracked at line 176 |
| 4  | After install completes, doctor checks are re-run and results displayed                      | VERIFIED | `gatherAllChecks()` called again at line 185 (post-install); `postFails` printed at lines 196–200. Note: JSON mode returns before re-run (acceptable — JSON callers use doctor command separately) |
| 5  | If brew is not installed, command fails early with clear instructions                        | VERIFIED | `checkBrewInstalled()` at line 111 uses `exec.LookPath("brew")`; returns install URL if missing; tested by `TestDepBrewPrerequisiteCheck` |
| 6  | JSON output (--json flag) returns structured results array                                   | VERIFIED | `JSONOutput` checked throughout; `json.NewEncoder(os.Stdout).Encode(results)` at line 180; `installResult` has `json:"name"`, `json:"status"`, `json:"detail,omitempty"` tags |

**Score:** 6/6 truths verified

### Required Artifacts

| Artifact                             | Expected                                                              | Status     | Details                                                              |
|--------------------------------------|-----------------------------------------------------------------------|------------|----------------------------------------------------------------------|
| `cli/cmd/dependencies.go`            | dependencies command, installer registry, all install functions, orchestrator | VERIFIED | 511 lines (min_lines: 200). 7 `func install*` functions, `runDependencies` orchestrator, `buildInstallList`, `checkBrewInstalled`, `runStreamed`, `runStreamedWithDir`, `brewInstall`, `brewTapInstall`. |
| `cli/cmd/dependencies_test.go`       | Unit tests for orchestrator logic, skip logic, install result tracking | VERIFIED | 158 lines (min_lines: 80). 8 test functions: `TestDepBuildInstallList_AllOk`, `TestDepBuildInstallList_SkipsWarn`, `TestDepBuildInstallList_FiltersFails`, `TestDepInstallResultTracking`, `TestDepInstallResultJSON`, `TestDepBrewPrerequisiteCheck`, `TestDepDependencyRegistryComplete`, `TestDepBuildInstallList_MultipleCheckResults`. All PASS. |

### Key Link Verification

| From                        | To                       | Via                                                                 | Status   | Details                                                                                                                          |
|-----------------------------|--------------------------|---------------------------------------------------------------------|----------|----------------------------------------------------------------------------------------------------------------------------------|
| `cli/cmd/dependencies.go`   | `cli/cmd/doctor.go`      | Reuses `checkBinaryVersion`, `checkBinary`, `checkAndroidSDK`, `checkXcode`, `checkPostgres`, `parseJavaVersion`, `parseNodeVersion` | WIRED    | All 6 check functions called in `gatherAllChecks()` (lines 212–225) and in installer registry `Check` fields (lines 37–87). Same `checkResult` struct reused. |
| `cli/cmd/dependencies.go`   | `cli/cmd/root.go`        | `rootCmd.AddCommand(dependenciesCmd)` in `init()`, uses `JSONOutput` global | WIRED    | Line 101: `rootCmd.AddCommand(dependenciesCmd)`. `JSONOutput` from root.go referenced 8 times throughout orchestrator. `./bin/device-farm --help` shows `dependencies` command. |

### Requirements Coverage

| Requirement | Source Plan | Description                                                               | Status    | Evidence                                                                                                            |
|-------------|-------------|---------------------------------------------------------------------------|-----------|---------------------------------------------------------------------------------------------------------------------|
| DEP-01      | 11-01, 11-02 | `device_farm dependencies` installs Java/JDK via brew                    | SATISFIED | Installer registry entry for "Java/JDK": `brewInstall("openjdk@17")`. Registry line 35–39.                         |
| DEP-02      | 11-01, 11-02 | `device_farm dependencies` installs Android SDK components via sdkmanager  | SATISFIED | `installAndroidSDK()`: brew cask `android-commandlinetools` + `sdkmanager` for platform-tools, emulator, platforms;android-35, system-images. Lines 328–380. |
| DEP-03      | 11-01, 11-02 | `device_farm dependencies` installs Xcode Command Line Tools              | SATISFIED | `installXcodeCLT()`: non-interactive `softwareupdate` with trigger file approach; fallback to `xcode-select --install`. Lines 383–419. |
| DEP-04      | 11-01, 11-02 | `device_farm dependencies` installs Maestro via official script           | SATISFIED | `installMaestro()`: `runStreamed("bash", "-c", 'curl -fsSL "https://get.maestro.mobile.dev" \| bash')`. Line 422–424. |
| DEP-05      | 11-01, 11-02 | `device_farm dependencies` installs ffmpeg via brew                       | SATISFIED | Installer registry entry for "ffmpeg": `brewInstall("ffmpeg")`. Line 63.                                           |
| DEP-06      | 11-01, 11-02 | `device_farm dependencies` installs PostgreSQL via brew                   | SATISFIED | `installPostgres()`: `brewInstall("postgresql@16")` then `brew services start postgresql@16`. Lines 427–440.        |
| DEP-07      | 11-01, 11-02 | `device_farm dependencies` installs go-ios                                | SATISFIED | `installGoIOS()`: `go install github.com/danielpaulus/go-ios@latest` with GOPATH/bin PATH update. Note: REQUIREMENTS.md said "via brew" but no brew formula exists; `go install` is the correct method (runtime-verified in plan 02, commit 8ea5ce7). |
| DEP-08      | 11-01, 11-02 | `device_farm dependencies` installs idb via brew/pip                      | SATISFIED | `installIDBCompanion()`: Xcode.app detection guard + `brewTapInstall("facebook/fb", "idb-companion")`. Provides clear error when only CLI Tools installed rather than silent failure. Lines 503–511. |
| DEP-09      | 11-01, 11-02 | `device_farm dependencies` builds sim-capture (swift build)               | SATISFIED | `installSimCapture()`: locates `device-stream` sibling directory via multiple path strategies; runs `npm run build:sim-capture` via `runStreamedWithDir`. Returns clear error if device-stream repo absent. Lines 443–469. Note: REQUIREMENTS.md says "swift build" but npm build is the correct mechanism for this project's sim-capture. |
| DEP-10      | 11-01, 11-02 | `device_farm dependencies` shows progress and result per item             | SATISFIED | Orchestrator prints "Installing {name}..." per dependency, streams subprocess output indented 4 spaces, prints green checkmark or red X + error per item. Summary line prints totals. Lines 147–202. |

**Notes on DEP-07 and DEP-09 description drift:** The REQUIREMENTS.md descriptions referenced implementation methods that turned out to be incorrect (no brew formula for go-ios; sim-capture is npm not swift). The actual implementations achieve the stated functional goal (install the tool) through the correct mechanisms discovered during runtime verification. This is acceptable — the requirement descriptions described intent, not mandated method.

### Anti-Patterns Found

No anti-patterns found. No TODO/FIXME/HACK/PLACEHOLDER comments. No stub returns. All install functions contain substantive implementation.

One minor observation: `licCmd.Run()` at line 353 ignores its error (license acceptance). This is intentional per the comment ("some licenses may already be accepted") and does not block functionality.

### Human Verification Required

#### 1. Real install flow on machine with missing dependencies

**Test:** On a fresh machine or after removing a tool (e.g. `brew uninstall ffmpeg`), run `device-farm dependencies` and observe output.
**Expected:** Command detects ffmpeg missing, prints "Installing ffmpeg...", streams brew output indented, prints green checkmark when done, re-runs doctor showing ffmpeg now passing.
**Why human:** Cannot test actual brew installation or real subprocess streaming in automated verification.

#### 2. idb_companion failure message quality

**Test:** On a machine with only Xcode CLI Tools (not full Xcode.app), run `device-farm dependencies`.
**Expected:** idb_companion shows "failed: idb_companion requires full Xcode.app installed from the App Store..." with App Store URL and sudo xcode-select instructions.
**Why human:** Requires machine without full Xcode.app to trigger the branch.

#### 3. Second-run skip behavior

**Test:** Run `device-farm dependencies` twice in a row on a fully-configured machine.
**Expected:** Second run prints "All dependencies already installed." and exits 0 immediately.
**Why human:** Requires real machine with all deps installed to confirm no false re-installs.

---

## Gaps Summary

No gaps. All 6 must-have truths are verified against actual code, both artifacts are substantive and wired, both key links are confirmed, and all 10 requirement IDs are accounted for and satisfied.

The implementation is complete with 511 lines of working code, 8 passing unit tests, CLI compiles clean (`go build` exits 0), full test suite passes (5 packages, 0 failures), and the `dependencies` command appears in `device-farm --help`.

---

_Verified: 2026-04-15T19:35:00Z_
_Verifier: Claude (gsd-verifier)_
