---
phase: 10-cli-doctor
verified: 2026-04-15T00:00:00Z
status: human_needed
score: 14/14 must-haves verified
human_verification:
  - test: "Run `./bin/device-farm doctor` in terminal"
    expected: "Each dependency listed with pass/fail/warn icon and version. Android SDK section shows 4 indented sub-items. Summary line at bottom shows counts (e.g. '9 passed, 1 warning, 2 failed')."
    why_human: "Visual formatting, icon rendering, and color output cannot be verified programmatically"
  - test: "Run `./bin/device-farm doctor --json | python3 -m json.tool`"
    expected: "Valid JSON array with all 11+ check results, each with name/status and optional version/path/detail fields"
    why_human: "Requires CLI execution in a real terminal with live dependencies"
  - test: "Run `./bin/device-farm doctor; echo \"Exit: $?\"`"
    expected: "Exit code 0 when no failures, exit code 1 when any dependency has status fail"
    why_human: "Exit code behavior requires live execution; can't be verified by static analysis"
---

# Phase 10: CLI Doctor Verification Report

**Phase Goal:** User can run a single command to know exactly which dependencies are present, missing, or broken on their Mac
**Verified:** 2026-04-15
**Status:** human_needed — all automated checks pass; visual output requires human confirmation
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | checkBinaryVersion returns fail with detail when Java major version < 17 | VERIFIED | `checkBinaryVersion` at line 182 calls `parseJavaVersion`, compares major against minMajor, sets Status="fail" with detail |
| 2 | checkBinaryVersion returns fail with detail when Node major version < 18 | VERIFIED | Same `checkBinaryVersion` function used for node at line 56 with minMajor=18 |
| 3 | checkAndroidSDK returns hierarchical results for SDK root + 4 sub-components | VERIFIED | Function at line 200 returns []checkResult with root + 4 named components; TestCheckAndroidSDK_WithComponents passes (5 results) |
| 4 | checkAndroidSDK returns single fail result when ANDROID_HOME not set | VERIFIED | Line 207 returns single-element slice with Status="fail"; TestCheckAndroidSDK_NoHome passes |
| 5 | checkPostgres returns ok when pg_isready succeeds | VERIFIED | Line 254 returns Status="ok" when exec.Command returns nil error |
| 6 | checkPostgres returns warn when pg_isready found but service not running | VERIFIED | Line 256 returns Status="warn" with Detail="installed but not running" |
| 7 | checkPostgres returns fail when pg_isready not found anywhere | VERIFIED | Line 266 returns Status="fail" with install hint after exhausting LookPath and Homebrew glob |
| 8 | checkXcode returns ok with version when xcode-select -p succeeds | VERIFIED | Lines 236-247 return Status="ok" with version from pkgutil and path from xcode-select |
| 9 | checkXcode returns fail when xcode-select -p fails | VERIFIED | Lines 233-235 return Status="fail" with Detail="run: xcode-select --install" |
| 10 | checkBinary returns ok for go-ios, sim-capture, idb_companion when found | VERIFIED | Lines 58-60 call checkBinary for all three; checkBinary function at line 138 returns Status="ok" when binary found |
| 11 | Doctor exits with code 0 when all checks pass or only warnings exist | VERIFIED | Lines 109-112: doctorHasFailure drives return; returns nil (exit 0) when no fails; TestDoctorExitCodes_WarnOnly passes |
| 12 | Doctor exits with code 1 when any check has status fail | VERIFIED | Line 110: `return fmt.Errorf(...)` when doctorHasFailure is true; TestDoctorExitCodes_HasFail passes |
| 13 | Visual summary line shows count of passed, warned, and failed checks | VERIFIED | Lines 101-107: three branches print counts in parentheses via doctorCounts(); TestDoctorSummaryCounts passes |
| 14 | JSON output includes all 11+ check results with correct structure | VERIFIED | Lines 65-67: JSONOutput branch encodes full checks slice to stdout; checkResult struct has json tags |

**Score:** 14/14 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `cli/cmd/doctor.go` | All 11 dependency check functions | VERIFIED | 289 lines; contains checkBinaryVersion, checkAndroidSDK, checkXcode, checkPostgres, parseJavaVersion, parseNodeVersion, doctorHasFailure, doctorCounts |
| `cli/cmd/doctor_test.go` | Unit tests for version parsers and new check functions | VERIFIED | 200 lines; contains TestParseJavaVersion, TestParseNodeVersion, TestCheckAndroidSDK_* (3 variants), TestDoctorExitCodes_* (3 variants), TestDoctorSummaryCounts |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `cli/cmd/doctor.go` | `checkBinaryVersion` | parseJavaVersion and parseNodeVersion callbacks | VERIFIED | Lines 44 and 56 call checkBinaryVersion with the respective parser functions |
| `cli/cmd/doctor.go` | `checkAndroidSDK` | returns []checkResult for hierarchical group | VERIFIED | Function signature `func checkAndroidSDK() []checkResult` at line 200; called with spread at line 46 |
| `cli/cmd/doctor.go` | runDoctor exit logic | hasFailure boolean drives return nil vs error | VERIFIED | Lines 109-112: `if doctorHasFailure(checks) { return fmt.Errorf(...) }; return nil` |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| DOC-01 | 10-01 | Java/JDK 17+ check with version | SATISFIED | Line 44: `checkBinaryVersion("java", "-version", 17, parseJavaVersion)` |
| DOC-02 | 10-01 | Android SDK with sub-components | SATISFIED | Lines 46, 200-229: checkAndroidSDK() returns hierarchical results |
| DOC-03 | 10-01 | ADB accessible | SATISFIED | Line 47: `checkBinary("adb", "--version")` |
| DOC-04 | 10-01 | Xcode CLI Tools | SATISFIED | Line 48: `checkXcode()` (lines 231-248) |
| DOC-05 | 10-01 | Maestro CLI | SATISFIED | Line 50: `checkBinary("maestro", "--version")` |
| DOC-06 | 10-01 | ffmpeg | SATISFIED | Line 52: `checkBinary("ffmpeg", "-version")` |
| DOC-07 | 10-01 | PostgreSQL installed and running | SATISFIED | Line 54: `checkPostgres()` (lines 250-267) distinguishes ok/warn/fail |
| DOC-08 | 10-01 | Node.js >= 18 | SATISFIED | Line 55: `checkBinaryVersion("node", "--version", 18, parseNodeVersion)` |
| DOC-09 | 10-01 | go-ios | SATISFIED | Line 57: `checkBinary("go-ios", "version")` |
| DOC-10 | 10-01 | sim-capture binary | SATISFIED | Line 58: `checkBinary("sim-capture", "--version")` |
| DOC-11 | 10-01 | idb_companion | SATISFIED | Line 59: `checkBinary("idb_companion", "--version")` |
| DOC-12 | 10-02 | Visual pass/fail summary | SATISFIED | Lines 98-112: doctorCounts() + summary printf + CI-friendly exit codes |

All 12 requirement IDs from REQUIREMENTS.md (DOC-01 through DOC-12) are claimed by the plans and verified in the implementation. No orphaned requirements.

### Anti-Patterns Found

None. No TODO/FIXME/HACK/PLACEHOLDER comments. No empty implementations. No stub returns. `return nil` at line 112 is the legitimate success path from `runDoctor`, not a stub.

### Human Verification Required

#### 1. Doctor command terminal output

**Test:** Build CLI (`cd cli && go build -o bin/device-farm .`) then run `./bin/device-farm doctor`
**Expected:** Formatted table of dependencies with colored pass/fail/warn icons and version strings. Android SDK section shows root entry plus 4 indented sub-items (cmdline-tools, platform-tools, emulator, system-images API 35). Summary line at bottom shows counts matching actual results.
**Why human:** Color rendering, icon display, and visual indentation cannot be verified by static analysis.

#### 2. JSON output structure

**Test:** `./bin/device-farm doctor --json | python3 -m json.tool`
**Expected:** Valid JSON array with all 11+ check objects, each containing "name" and "status" fields plus optional "version", "path", "detail".
**Why human:** Requires live execution with real installed dependencies.

#### 3. Exit code behavior

**Test:** `./bin/device-farm doctor; echo "Exit: $?"`
**Expected:** Exit code 0 when all checks pass or only warnings present; exit code 1 when any dependency has status "fail".
**Why human:** Live execution required; the specific exit code depends on which dependencies are actually installed on the machine.

### Test Results Summary

All automated tests pass:

- TestParseJavaVersion — 5 subtests PASS
- TestParseNodeVersion — 5 subtests PASS
- TestCheckAndroidSDK_NoHome — PASS
- TestCheckAndroidSDK_WithComponents — PASS
- TestCheckAndroidSDK_MissingComponent — PASS
- TestCheckBinaryVersion_BelowMinimum — PASS
- TestCheckXcode_ReturnsCheckResult — PASS
- TestDoctorExitCodes_AllOk — PASS
- TestDoctorExitCodes_WarnOnly — PASS
- TestDoctorExitCodes_HasFail — PASS
- TestDoctorSummaryCounts — PASS
- TestCheckPostgres_ReturnsCheckResult — PASS

Full CLI test suite: all packages pass (`go test ./...`). Build: clean (`go build` zero errors). Vet: clean (`go vet ./...` zero issues).

### Negative Checks

- `allOk` variable: absent from doctor.go (replaced by doctorHasFailure/doctorCounts)
- `checkAndroidHome` function: absent from doctor.go (replaced by checkAndroidSDK)
- No stub implementations — every function performs real work (exec calls, env reads, file stat)

---

_Verified: 2026-04-15_
_Verifier: Claude (gsd-verifier)_
