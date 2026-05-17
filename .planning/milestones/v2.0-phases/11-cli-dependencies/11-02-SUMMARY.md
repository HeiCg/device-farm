---
phase: 11-cli-dependencies
plan: 02
subsystem: cli
tags: [go, cobra, brew, go-install, dependencies, runtime-verification]

requires:
  - phase: 11-cli-dependencies
    plan: 01
    provides: dependencies command with 9 installers, installer registry pattern
provides:
  - runtime-verified dependencies command with fixed go-ios, idb_companion installers
  - clean JSON output in --json mode (no stdout pollution from installers)
affects: [cli-ux, onboarding, ci-setup]

tech-stack:
  added: []
  patterns: [go-install-with-path-update, xcode-detection-for-brew-casks]

key-files:
  created: []
  modified:
    - cli/cmd/dependencies.go

key-decisions:
  - "go-ios installed via go install (not brew) since no brew formula exists"
  - "idb_companion requires full Xcode.app detection before attempting brew tap install"
  - "Installer functions guard informational prints with JSONOutput flag"

patterns-established:
  - "Go tool install pattern: go install + GOPATH/bin PATH update for post-install verification"
  - "Prerequisite detection: check for full Xcode.app before attempting cask builds"

requirements-completed: [DEP-01, DEP-02, DEP-03, DEP-04, DEP-05, DEP-06, DEP-07, DEP-08, DEP-09, DEP-10]

duration: 5min
completed: 2026-04-15
---

# Phase 11 Plan 02: Dependencies Runtime Verification Summary

**Fixed go-ios (go install), idb_companion (Xcode detection), and JSON output cleanliness through real-machine testing**

## Performance

- **Duration:** 5 min
- **Started:** 2026-04-15T19:09:24Z
- **Completed:** 2026-04-15T19:23:04Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments
- Fixed go-ios installer: changed from nonexistent brew formula to `go install github.com/danielpaulus/go-ios@latest` with automatic GOPATH/bin PATH update
- Fixed idb_companion installer: added Xcode.app detection with clear error message when only CLI Tools are installed
- Fixed JSON output: suppressed informational prints from installer functions when --json flag is active
- Verified all 9 dependency installers run without crashes on real machine
- Confirmed go-ios successfully installs and passes doctor check after dependencies run

## Task Commits

Each task was committed atomically:

1. **Task 1: Build CLI and run dependencies command** - `8ea5ce7` (fix) - Fixed 3 runtime bugs found during real-machine testing
2. **Task 2: Verify dependencies command on real machine** - User approved checkpoint (no code changes)

## Files Created/Modified
- `cli/cmd/dependencies.go` - Fixed go-ios installer (go install), idb_companion Xcode detection, JSON output guard

## Decisions Made
- go-ios has no brew formula; `go install` is the official installation method, requires GOPATH/bin in PATH
- idb_companion depends on full Xcode.app (not just CLI Tools); detect and provide clear instructions rather than failing cryptically
- Installer functions must check JSONOutput before printing to stdout to avoid polluting JSON output

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] go-ios brew formula does not exist**
- **Found during:** Task 1 (runtime testing)
- **Issue:** `brew install go-ios` fails -- no such formula exists in Homebrew
- **Fix:** Changed to `go install github.com/danielpaulus/go-ios@latest` with automatic GOPATH/bin PATH update for post-install verification
- **Files modified:** cli/cmd/dependencies.go
- **Verification:** go-ios binary installed at ~/go/bin/go-ios, doctor shows ok
- **Committed in:** 8ea5ce7

**2. [Rule 1 - Bug] go-ios module path was wrong (v2 vs v1)**
- **Found during:** Task 1 (runtime testing, second attempt)
- **Issue:** Initial fix used `github.com/danielpaulus/go-ios/v2@latest` but the module is v1 (no /v2 path)
- **Fix:** Changed to `github.com/danielpaulus/go-ios@latest`
- **Files modified:** cli/cmd/dependencies.go
- **Verification:** go install succeeds, binary works
- **Committed in:** 8ea5ce7

**3. [Rule 1 - Bug] idb_companion brew install fails without full Xcode**
- **Found during:** Task 1 (runtime testing)
- **Issue:** `brew tap facebook/fb && brew install idb-companion` fails with "A full installation of Xcode.app 13.0 is required"
- **Fix:** Added Xcode.app detection check before attempting brew install; provides clear error with App Store link
- **Files modified:** cli/cmd/dependencies.go
- **Verification:** Clear error message shown instead of cryptic brew failure
- **Committed in:** 8ea5ce7

**4. [Rule 1 - Bug] JSON output polluted by installer fmt.Println calls**
- **Found during:** Task 1 (JSON verification)
- **Issue:** installGoIOS printed PATH instructions to stdout even in --json mode, breaking JSON parsing
- **Fix:** Guarded informational prints with `if !JSONOutput` check
- **Files modified:** cli/cmd/dependencies.go
- **Verification:** `dependencies --json` produces valid JSON parseable by python3
- **Committed in:** 8ea5ce7

---

**Total deviations:** 4 auto-fixed (4 bugs)
**Impact on plan:** All bugs discovered through real-machine testing as the plan intended. No scope creep.

## Issues Encountered
- sim-capture install fails as expected (requires device-stream sibling repo not present on this machine)
- idb_companion install fails as expected (requires full Xcode.app, only CLI Tools installed)
- These are environmental prerequisites, not code bugs

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `device-farm dependencies` command fully verified on real hardware
- All fixable dependencies install correctly (go-ios confirmed)
- Dependencies with external prerequisites (Xcode.app, device-stream) provide clear error messages
- Phase 11 (CLI Dependencies) is complete
- All existing tests pass with no regressions

---
*Phase: 11-cli-dependencies*
*Completed: 2026-04-15*
