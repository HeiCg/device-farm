---
phase: 11-cli-dependencies
plan: 01
subsystem: cli
tags: [go, cobra, brew, sdkmanager, softwareupdate, installer, automation]

requires:
  - phase: 10-cli-doctor
    provides: checkResult struct, check functions (checkBinary, checkBinaryVersion, checkAndroidSDK, checkXcode, checkPostgres)
provides:
  - dependencies command with 9 auto-installers
  - installer registry pattern (dependency struct with CheckNames, Check, Install)
  - runStreamed subprocess helper with real-time output
  - brewInstall/brewTapInstall helpers
  - buildInstallList orchestrator filtering logic
affects: [cli-ux, onboarding, ci-setup]

tech-stack:
  added: []
  patterns: [installer-registry, streamed-subprocess-output, brew-no-auto-update]

key-files:
  created:
    - cli/cmd/dependencies.go
    - cli/cmd/dependencies_test.go
  modified: []

key-decisions:
  - "Fail early on missing brew rather than auto-install (requires sudo, user should consent)"
  - "CheckNames field on dependency struct for matching doctor results without re-running checks"
  - "Hardcoded sdkComponents string instead of dynamic array to avoid shell injection surface"

patterns-established:
  - "Installer registry: dependency struct with Name, CheckNames, Check, Install for mapping checks to installs"
  - "runStreamed: StdoutPipe + bufio.Scanner + Wait-after-drain for real-time subprocess output"

requirements-completed: [DEP-01, DEP-02, DEP-03, DEP-04, DEP-05, DEP-06, DEP-07, DEP-08, DEP-09, DEP-10]

duration: 6min
completed: 2026-04-15
---

# Phase 11 Plan 01: Dependencies Command Summary

**`device-farm dependencies` command auto-installs 9 tools via brew/sdkmanager/curl with streamed progress, skip logic, and JSON output**

## Performance

- **Duration:** 6 min
- **Started:** 2026-04-15T19:00:15Z
- **Completed:** 2026-04-15T19:06:54Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Installer registry with 9 dependencies mapped to check functions and install methods
- Orchestrator flow: check -> filter fails -> install -> re-verify -> summary
- Android SDK installer: brew cask + ANDROID_HOME + sdkmanager with license acceptance via `yes` pipe
- Xcode CLT: non-interactive softwareupdate approach (no GUI dialog)
- Brew prerequisite check with early failure and clear install instructions
- JSON output support for CI/scripting via --json flag
- 8 unit tests covering orchestrator logic, filtering, result tracking, JSON serialization

## Task Commits

Each task was committed atomically:

1. **Task 1: Unit tests for dependencies command** - `31e001e` (test) - TDD RED phase
2. **Task 2: Implement dependencies command with all installers** - `c72ec74` (feat) - TDD GREEN phase

## Files Created/Modified
- `cli/cmd/dependencies.go` - Dependencies command with 9 installers, orchestrator, helpers, JSON output
- `cli/cmd/dependencies_test.go` - 8 unit tests for orchestrator logic and result tracking

## Decisions Made
- Fail early on missing brew rather than auto-install (sudo required, user should consent)
- Added CheckNames field to dependency struct for precise matching of doctor check results without re-running live checks
- Hardcoded sdkComponents string constant instead of dynamic array construction

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed buildInstallList re-running live checks**
- **Found during:** Task 2 (implementation)
- **Issue:** Initial buildInstallList called d.Check() for each dependency as a fallback, which re-ran real system checks and produced false positives in tests
- **Fix:** Added CheckNames field to dependency struct for static name matching against pre-gathered check results; removed d.Check() fallback
- **Files modified:** cli/cmd/dependencies.go
- **Verification:** All 8 tests pass
- **Committed in:** c72ec74 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Necessary for correct orchestrator logic. No scope creep.

## Issues Encountered
None beyond the deviation above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Dependencies command registered with Cobra, accessible via `device-farm dependencies`
- Ready for Phase 11 Plan 02 (if any remaining plans)
- Full test suite green with no regressions

---
*Phase: 11-cli-dependencies*
*Completed: 2026-04-15*
