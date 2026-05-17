# Phase 11: CLI Dependencies - Context

**Gathered:** 2026-04-15
**Status:** Ready for planning

<domain>
## Phase Boundary

Add `device_farm dependencies` command to the Go CLI that auto-installs all missing dependencies detected by `device_farm doctor`. Each dependency has a specific install method (brew, sdkmanager, curl script, swift build). Shows real-time progress per item.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — pure infrastructure phase.

Key install methods per dependency (from research):
- Java/JDK: `brew install openjdk@17`
- Android SDK: `brew install --cask android-commandlinetools` then `sdkmanager "platform-tools" "emulator" "platforms;android-35" "system-images;android-35;google_apis_playstore;arm64-v8a"`
- Xcode CLT: `xcode-select --install`
- Maestro: `curl -fsSL "https://get.maestro.mobile.dev" | bash`
- ffmpeg: `brew install ffmpeg`
- PostgreSQL: `brew install postgresql@16 && brew services start postgresql@16`
- go-ios: `brew install go-ios`
- idb: `brew tap facebook/fb && brew install idb-companion`
- sim-capture: `cd ../device-stream && npm run build:sim-capture`
- Node.js: already required to run device-farm, skip or warn

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `cli/cmd/doctor.go` — check functions that detect what's missing (reuse to determine what to install)
- `cli/cmd/root.go` — Cobra root command, global flags
- `fatih/color` — terminal coloring for progress output

### Established Patterns
- Cobra command registration via `init()` function
- `RunE` returning error for non-zero exit
- `exec.Command` for running external tools
- `CombinedOutput()` for capturing results

### Integration Points
- `rootCmd.AddCommand(dependenciesCmd)` in init()
- Reuse `checkResult` struct and check functions from doctor.go to determine what needs installing
- `--json` flag for CI-friendly output

</code_context>

<specifics>
## Specific Ideas

- Run doctor checks first to determine what's missing, then install only missing items
- Show per-item progress: "Installing Java/JDK... done" or "Installing Java/JDK... failed: [error]"
- Skip already-installed dependencies gracefully
- After all installs, run doctor again to verify everything passes
- Xcode CLT requires interactive GUI prompt (xcode-select --install) — handle this specially

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>
