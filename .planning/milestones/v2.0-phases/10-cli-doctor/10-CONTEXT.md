# Phase 10: CLI Doctor - Context

**Gathered:** 2026-04-15
**Status:** Ready for planning

<domain>
## Phase Boundary

Rewrite the Go CLI `doctor` command to check all dependencies required by device-farm v2.0, including device-stream deps. Produces a visual pass/fail summary with version info. CI-friendly exit codes.

</domain>

<decisions>
## Implementation Decisions

### Check Architecture
- Rewrite `doctor.go` in-place — expand the existing file with new checks
- Maintain `checkBinary()` pattern + add `checkService()` and `checkSDKComponent()` helpers
- Keep `--json` flag for CI output (already works)
- Sequential checks — each is <100ms, parallelism not worth complexity

### Output & Behavior
- Android SDK checks as hierarchical group: "Android SDK" header with indented sub-items (cmdline-tools, platform-tools, emulator, system-images API 35)
- PostgreSQL: "warn" when installed but not running, "fail" when not installed — distinguish the two states
- Exit codes: 0 for all-ok or warn-only, 1 when any check is "fail" — warns don't break CI
- Keep `fatih/color` for output styling — already a dependency

### Claude's Discretion
- Exact version parsing regex per tool
- Order of checks in output
- Specific error messages for each failure mode

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `cli/cmd/doctor.go` — existing doctor with `checkBinary()`, `checkAndroidHome()`, `checkServer()` helpers
- `checkResult` struct with Name, Status, Version, Path, Detail fields
- JSON output via `json.NewEncoder` when `JSONOutput` flag is set
- `fatih/color` for green/red/yellow terminal output

### Established Patterns
- Cobra command registration via `init()` function
- `RunE` returning error for non-zero exit
- `CombinedOutput()` for version string extraction
- First non-empty line as version, truncated at 80 chars

### Integration Points
- `rootCmd.AddCommand(doctorCmd)` in init()
- `JSONOutput` and `ServerFlag` global flags from root.go
- Doctor is standalone — no server connection required (except server check which is optional/warn)

</code_context>

<specifics>
## Specific Ideas

User wants comprehensive mapping of ALL dependencies:
1. Java/JDK 17+
2. Android SDK (cmdline-tools, platform-tools, emulator, system-images)
3. ADB
4. Xcode + Command Line Tools
5. Maestro CLI
6. ffmpeg
7. PostgreSQL (installed + running)
8. Node.js >= 18
9. go-ios
10. sim-capture binary (from device-stream)
11. idb (Facebook iOS Development Bridge)

scrcpy-server is auto-fetched by device-stream postinstall — NOT a doctor check.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>
