---
phase: 09-fix-cli-data-contracts
verified: 2026-03-11T15:30:00Z
status: passed
score: 3/3 must-haves verified
re_verification: false
---

# Phase 9: Fix CLI Data Contracts Verification Report

**Phase Goal:** CLI correctly parses server API responses so job status, log output, and device listing display correctly
**Verified:** 2026-03-11T15:30:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #   | Truth                                                                 | Status     | Evidence                                                                                             |
| --- | --------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------- |
| 1   | device-farm status displays finishedAt timestamp and resultSummary counts | ✓ VERIFIED | status.go L57-70: reads `job.FinishedAt` and `job.ResultSummary` directly; test asserts "Completed:" and "2 passed" |
| 2   | device-farm logs prints extracted log text, not raw JSON envelope     | ✓ VERIFIED | logs.go L51-62: fetchLogs calls `c.GetJobLogs()` which parses JSON; TestLogsFetch asserts plain text output |
| 3   | device-farm devices shows device state from the state field correctly | ✓ VERIFIED | devices.go L51-53: all three references use `d.State`; test mock uses `"state"` field               |

**Score:** 3/3 truths verified

### Required Artifacts

| Artifact                              | Expected                                         | Status     | Details                                                                                      |
| ------------------------------------- | ------------------------------------------------ | ---------- | -------------------------------------------------------------------------------------------- |
| `cli/internal/client/types.go`        | Corrected JSON struct tags matching server API   | ✓ VERIFIED | Job struct: `finishedAt` (L10), `resultSummary` (L12); Device struct: `state` (L34)         |
| `cli/cmd/logs.go`                     | fetchLogs using client.GetJobLogs for JSON parsing | ✓ VERIFIED | L51-62: fetchLogs calls `c.GetJobLogs(ctx, jobID)`, accepts `io.Writer` parameter            |
| `cli/cmd/logs_test.go`                | Unit test for fetchLogs JSON envelope parsing    | ✓ VERIFIED | TestLogsFetch (L15), TestLogsFetchJSON (L41), TestLogsFetchServerError (L64) all present     |

### Key Link Verification

| From                     | To                              | Via                                       | Pattern                           | Status     | Details                                                    |
| ------------------------ | ------------------------------- | ----------------------------------------- | --------------------------------- | ---------- | ---------------------------------------------------------- |
| `cli/cmd/status.go`      | `cli/internal/client/types.go`  | job.FinishedAt and job.ResultSummary fields | `job\.FinishedAt\|job\.ResultSummary` | ✓ WIRED    | status.go L57: `job.FinishedAt`, L65-70: `job.ResultSummary` |
| `cli/cmd/devices.go`     | `cli/internal/client/types.go`  | d.State field access                      | `d\.State`                        | ✓ WIRED    | devices.go L51, L52, L53: all three uses confirmed         |
| `cli/cmd/logs.go`        | `cli/internal/client/jobs.go`   | c.GetJobLogs() call                       | `c\.GetJobLogs`                   | ✓ WIRED    | logs.go L52: `c.GetJobLogs(ctx, jobID)`; function exists in jobs.go L27 |

### Requirements Coverage

| Requirement | Source Plan | Description                                                     | Status      | Evidence                                                                                       |
| ----------- | ----------- | --------------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------- |
| CLI-02      | 09-01-PLAN  | `device-farm status` — shows status and job result              | ✓ SATISFIED | types.go uses `finishedAt`/`resultSummary`; status.go reads both fields; TestStatusWithSteps asserts "2 passed" |
| CLI-03      | 09-01-PLAN  | `device-farm logs` — complete logs or --follow streaming        | ✓ SATISFIED | fetchLogs uses GetJobLogs; TestLogsFetch verifies plain text extraction from JSON envelope      |
| CLI-04      | 09-01-PLAN  | `device-farm devices` — table with emulator statuses            | ✓ SATISFIED | Device struct uses `state` JSON tag; devices.go reads `d.State`; TestDevicesTable mock uses `"state"` field |
| API-05      | 09-01-PLAN  | DELETE /api/jobs/:id — cancel job                               | ✓ SATISFIED | No CLI-side breakage; cancel command was already correct; overall test suite passes             |
| API-07      | 09-01-PLAN  | POST /api/devices/:id/restart — restart device                  | ✓ SATISFIED | devices.go consumer fixed (d.Status -> d.State); Device struct correctly maps `"state"` field  |

No orphaned requirements. All five IDs declared in plan frontmatter are mapped above and all appear in REQUIREMENTS.md Phase 9 column as "Complete".

### Anti-Patterns Found

No anti-patterns detected across all 9 modified files. No TODO/FIXME/HACK comments, no empty implementations, no stub returns.

### Human Verification Required

None. All behavioral assertions are covered by automated tests that pass.

### Build and Test Verification

- `go build ./...` — passes with zero errors
- `go test ./... -count=1` — all 5 packages pass:
  - `cli/cmd` — 1.320s
  - `cli/internal/client` — 0.913s
  - `cli/internal/config` — 0.709s
  - `cli/internal/output` — 0.514s
  - `cli/internal/streaming` — 1.100s

### Commits Verified

All three task commits documented in SUMMARY exist in git history:
- `3d3d92b` — fix(09-01): correct CLI struct JSON tags and field references to match server API
- `9cb0229` — test(09-01): add failing tests for server-accurate mocks and logs fetch
- `3b580c2` — feat(09-01): fix fetchLogs to use GetJobLogs and update all test mocks

### Summary

Phase goal is fully achieved. All three observable behaviors work:

1. **Status command** reads `finishedAt` and `resultSummary` directly from the server-correct struct fields, displays completion time and result counts.
2. **Logs command** uses the existing `GetJobLogs` client method which parses the `{"logs": "..."}` JSON envelope, printing extracted text only. The `io.Writer` refactor enables clean test coverage via `bytes.Buffer`.
3. **Devices command** reads `d.State` throughout, matching the server's `state` field. Output helpers (`symbols.go`, `color.go`) handle all device state values including `booting`, `allocated`, `cleanup`, and `offline`.

No old field references (`completedAt`, `job.Result[`, `d.Status`) remain anywhere in the codebase.

---

_Verified: 2026-03-11T15:30:00Z_
_Verifier: Claude (gsd-verifier)_
