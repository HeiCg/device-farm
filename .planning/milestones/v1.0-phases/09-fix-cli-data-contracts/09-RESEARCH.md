# Phase 9: Fix CLI Data Contracts - Research

**Researched:** 2026-03-11
**Domain:** Go CLI data contract alignment with server API
**Confidence:** HIGH

## Summary

Phase 9 fixes cross-phase data-contract breaks between the server API (TypeScript/Fastify) and the Go CLI. The milestone audit identified 4 specific breaks where the CLI Go structs and command logic use field names or parsing approaches that do not match the actual server JSON responses. All issues are on the CLI side -- the server API is correct and should not be modified.

The fixes are surgical: rename JSON struct tags in `types.go`, parse the JSON envelope in `logs.go` fetchLogs, and update tests to use server-accurate field names. No new libraries, no architectural changes, no server modifications.

**Primary recommendation:** Fix CLI `types.go` JSON tags and `logs.go` fetchLogs parsing to match server API contracts exactly. Update all tests to use server-accurate mock responses.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| CLI-02 | `device-farm status <job-id>` -- displays completion time and result summary | Fix Job struct: `completedAt` -> `finishedAt`, `result` -> `resultSummary`; update status.go result parsing path |
| CLI-03 | `device-farm logs <job-id>` -- prints extracted log text | Fix fetchLogs to parse JSON `{logs: "..."}` instead of printing raw body |
| CLI-04 | `device-farm devices` -- shows device state correctly | Fix Device struct: `status` -> `state` |
| API-05 | DELETE /api/jobs/:id -- cancel job | Server-side correct; CLI cancel already works. Marked partial because CLI logs consumer is broken (same endpoint family) |
| API-07 | POST /api/devices/:id/restart -- restart device | Server-side correct; CLI devices consumer reads wrong field name `status` vs `state` |
</phase_requirements>

## Standard Stack

### Core (no changes needed)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| cobra | v1.10.2 | CLI framework | Already in use, no changes needed |
| fatih/color | v1.18.0 | Terminal colors | Already in use |
| encoding/json | stdlib | JSON parsing | Standard Go JSON, already in use |

No new dependencies required. All fixes use existing stdlib and project code.

## Architecture Patterns

### Existing CLI Structure (no changes)
```
cli/
  cmd/
    status.go          # FIX: result parsing path
    logs.go            # FIX: fetchLogs JSON parsing
    devices.go         # FIX: uses d.Status -> d.State
    status_test.go     # FIX: mock responses use wrong field names
    devices_test.go    # FIX: mock responses use wrong field names
  internal/
    client/
      types.go         # FIX: Job and Device struct JSON tags
      jobs.go          # Already has GetJobLogs with JSON parsing (unused by cmd/logs.go!)
      devices.go       # No changes needed
```

### Pattern: Server Is Source of Truth
The server API is correct and must NOT be modified. All fixes are CLI-side only. The server returns:

**Job object** (from `GET /api/jobs/:id`):
```json
{
  "id": "uuid",
  "status": "passed",
  "platform": "android",
  "createdAt": "ISO8601",
  "startedAt": "ISO8601",
  "finishedAt": "ISO8601",        // CLI has "completedAt" -- WRONG
  "resultSummary": {...},          // CLI has "result" -- WRONG
  "metadata": {...},
  "deviceId": "uuid",
  "maestroOutput": "...",
  "errorMessage": "...",
  "steps": [...]
}
```

**Device object** (from `GET /api/devices`):
```json
{
  "id": "uuid",
  "name": "pixel-7",
  "platform": "android",
  "state": "idle",                 // CLI has "status" -- WRONG
  "emulatorId": "emulator-5554",
  "port": 5554,
  "pid": 12345,
  "currentJobId": null
}
```

**Logs response** (from `GET /api/jobs/:id/logs`):
```json
{
  "logs": "actual log text here"   // CLI prints raw body -- WRONG
}
```

### Anti-Patterns to Avoid
- **Modifying server to match CLI:** The server contracts are correct and consumed by the web UI too. Always fix the consumer.
- **Adding compatibility aliases:** Do not add fallback field parsing. Fix the struct tags to match the single source of truth.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JSON envelope parsing | Manual string extraction | `encoding/json` Decode into struct | Already done correctly in `client/jobs.go GetJobLogs` -- just needs to be called from `cmd/logs.go` |

**Key insight:** The `client/jobs.go` already has a `GetJobLogs` method that correctly parses the JSON envelope. The `cmd/logs.go` fetchLogs function bypasses it and calls `c.Do()` directly, then prints raw body. The fix should use the existing `GetJobLogs` method.

## Common Pitfalls

### Pitfall 1: Forgetting to Update Test Mock Responses
**What goes wrong:** Fix the struct tags but leave test HTTP handlers returning old field names. Tests pass because mocks match old (wrong) struct tags.
**Why it happens:** Tests were written against the wrong contract from the start.
**How to avoid:** Update ALL test mock responses to use server-accurate field names (`finishedAt`, `resultSummary`, `state`).
**Warning signs:** Tests pass but CLI still shows blank fields against real server.

### Pitfall 2: ResultSummary Structure Mismatch
**What goes wrong:** The CLI `status.go` reads `job.Result["summary"]` as a nested map. But the server stores `resultSummary` directly as `{total, passed, failed, skipped}` -- there is no nested "summary" key.
**Why it happens:** The CLI was coded assuming `result: {summary: {passed: N, ...}}` but the server stores `resultSummary: {passed: N, ...}` directly.
**How to avoid:** After renaming the JSON tag to `resultSummary`, update `status.go` to read directly from `job.ResultSummary` without looking for a nested "summary" key.
**Warning signs:** Result summary shows "0 passed, 0 failed, 0 skipped" despite job having results.

### Pitfall 3: Device Struct Field Name vs Display Label
**What goes wrong:** Renaming the Go struct field from `Status` to `State` requires updating all references in `cmd/devices.go` and `cmd/devices_test.go`.
**Why it happens:** The JSON tag changes but the Go field name used in code also needs updating for clarity.
**How to avoid:** Rename both the JSON tag AND the Go field: `Status string \`json:"status"\`` becomes `State string \`json:"state"\``. Then update all `d.Status` references to `d.State`.

### Pitfall 4: StatusSymbol/StatusColor Using Device State Values
**What goes wrong:** `output.StatusSymbol` and `output.StatusColor` may not handle device state values like "idle", "booting", "allocated", "cleanup", "error", "offline".
**Why it happens:** These functions were possibly designed for job statuses only (queued, running, passed, failed, cancelled, timeout).
**How to avoid:** Verify that StatusSymbol/StatusColor handle device states. If not, add cases or use a sensible default.

### Pitfall 5: Logs --json Mode Double-Wrapping
**What goes wrong:** The audit notes `--json mode double-wraps`. If fetchLogs is fixed to parse the JSON envelope, the `--json` path in `logs.go` line 64 manually creates `{"logs": string(body)}` which would be correct IF body is the extracted text. But currently body is the raw JSON `{"logs":"..."}`, causing double-wrapping.
**How to avoid:** Use `c.GetJobLogs()` which returns the extracted string, then the `--json` wrapper at line 64 creates the correct envelope.

## Code Examples

### Fix 1: types.go -- Job Struct Tags
```go
// Source: server/db/schema.ts lines 73-75, server/api/routes.ts line 153
type Job struct {
    ID             string         `json:"id"`
    Status         string         `json:"status"`
    Platform       string         `json:"platform"`
    CreatedAt      string         `json:"createdAt"`
    StartedAt      *string        `json:"startedAt"`
    FinishedAt     *string        `json:"finishedAt"`       // was: completedAt
    Metadata       map[string]any `json:"metadata"`
    ResultSummary  map[string]any `json:"resultSummary"`    // was: result
    Steps          []JobStep      `json:"steps"`
    DeviceName     *string        `json:"deviceName"`
    DeviceId       *string        `json:"deviceId"`
    MaestroOutput  *string        `json:"maestroOutput"`
    ErrorMessage   *string        `json:"errorMessage"`
}
```

### Fix 2: types.go -- Device Struct Tags
```go
// Source: server/types/index.ts DeviceInfo interface
type Device struct {
    ID           string  `json:"id"`
    Name         string  `json:"name"`
    Platform     string  `json:"platform"`
    State        string  `json:"state"`           // was: status
    EmulatorID   string  `json:"emulatorId"`
    Port         *int    `json:"port"`
    Pid          *int    `json:"pid"`
    CurrentJobID *string `json:"currentJobId"`
}
```

### Fix 3: status.go -- ResultSummary Parsing
```go
// Before: job.Result["summary"].(map[string]any)
// After: job.ResultSummary directly contains {passed, failed, skipped, total}
if job.ResultSummary != nil {
    passed := formatNum(job.ResultSummary["passed"])
    failed := formatNum(job.ResultSummary["failed"])
    skipped := formatNum(job.ResultSummary["skipped"])
    fmt.Fprintf(w, "  Results: %s passed, %s failed, %s skipped\n", passed, failed, skipped)
}
```

### Fix 4: logs.go -- Use Existing GetJobLogs
```go
// Before: c.Do() + io.ReadAll + raw print
// After: use the existing client method that parses JSON
func fetchLogs(ctx context.Context, c *client.Client, jobID string) error {
    logs, err := c.GetJobLogs(ctx, jobID)
    if err != nil {
        return err
    }
    if JSONOutput {
        return json.NewEncoder(os.Stdout).Encode(map[string]string{"logs": logs})
    }
    fmt.Fprint(os.Stdout, logs)
    return nil
}
```

### Fix 5: devices.go -- Field Reference Update
```go
// Before: d.Status
// After: d.State
sym := output.StatusSymbol(d.State, IsTTY)
col := output.StatusColor(d.State)
statusStr := sym + " " + col.Sprint(d.State)
```

## State of the Art

No external changes or version upgrades needed. All fixes are internal contract alignment.

| Old (CLI) | Correct (Server) | Impact |
|-----------|------------------|--------|
| `completedAt` JSON tag | `finishedAt` | Completion time now displays |
| `result` JSON tag | `resultSummary` | Result summary now displays |
| `result["summary"]` nesting | Direct `resultSummary` fields | No double-nesting |
| `status` JSON tag (Device) | `state` | Device state column shows value |
| Raw body print for logs | Parse JSON `{logs}` envelope | Clean log text output |

## Open Questions

None. All data contracts are verified by reading both server source code and CLI source code. The mismatches are clear and the fixes are straightforward.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Go testing (stdlib) + httptest |
| Config file | None (Go convention) |
| Quick run command | `cd cli && go test ./cmd/ -run TestStatus -v` |
| Full suite command | `cd cli && go test ./...` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CLI-02 | status displays finishedAt and resultSummary | unit | `cd cli && go test ./cmd/ -run TestStatus -v -count=1` | Yes (needs update) |
| CLI-03 | logs prints extracted text, not JSON envelope | unit | `cd cli && go test ./cmd/ -run TestLogs -v -count=1` | No (needs creation) |
| CLI-04 | devices shows state field correctly | unit | `cd cli && go test ./cmd/ -run TestDevices -v -count=1` | Yes (needs update) |
| API-05 | cancel works (already passing) | unit | `cd cli && go test ./cmd/ -run TestCancel -v -count=1` | Yes |
| API-07 | devices endpoint consumer reads state | unit | `cd cli && go test ./cmd/ -run TestDevices -v -count=1` | Yes (needs update) |

### Sampling Rate
- **Per task commit:** `cd cli && go test ./cmd/ -v -count=1`
- **Per wave merge:** `cd cli && go test ./... -count=1`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `cli/cmd/logs_test.go` -- needs fetchLogs test (currently no test for non-follow mode)
- [ ] Update `cli/cmd/status_test.go` mock responses to use `finishedAt`, `resultSummary`
- [ ] Update `cli/cmd/devices_test.go` mock responses to use `state` instead of `status`

## Sources

### Primary (HIGH confidence)
- `server/db/schema.ts` -- Job table uses `finishedAt`, `resultSummary` column names (lines 74-75)
- `server/types/index.ts` -- DeviceInfo interface uses `state` field (line 17)
- `server/api/routes.ts` -- GET /jobs/:id returns `{...job, steps}` (line 153), GET /jobs/:id/logs returns `{logs: string}` (line 172)
- `server/pool/device.ts` -- `toInfo()` returns `state: this._state` (line 69)
- `cli/internal/client/types.go` -- Current (wrong) JSON tags verified
- `cli/cmd/logs.go` -- fetchLogs prints raw body without JSON parsing (lines 51-68)
- `cli/internal/client/jobs.go` -- `GetJobLogs` already parses JSON correctly (lines 27-41) but is unused by cmd/logs.go
- `.planning/v1.0-MILESTONE-AUDIT.md` -- Cross-phase integration breaks documented

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - no new libraries needed, all existing
- Architecture: HIGH - surgical fixes to JSON tags and one function
- Pitfalls: HIGH - all verified by reading both codebases

**Research date:** 2026-03-11
**Valid until:** Indefinite (contract alignment, not version-dependent)
