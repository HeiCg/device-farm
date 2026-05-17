# Phase 4: Go CLI - Context

**Gathered:** 2026-03-10
**Status:** Ready for planning

<domain>
## Phase Boundary

Go CLI binary for QAs and CI pipelines to submit Maestro test jobs, monitor execution in real time, and retrieve results from the command line. Commands: run, status, logs, devices, cancel, config. Consumes the REST API (Phase 2) and WebSocket streaming (Phase 3). No Web UI, no authentication enforcement — those are later phases.

Requirements: CLI-01 through CLI-07.

</domain>

<decisions>
## Implementation Decisions

### Output Formatting
- Compact aligned tables (like kubectl/docker ps) — column-aligned text with headers, no box-drawing characters
- Colors enabled by default — green pass, red fail, yellow warning, cyan info. Auto-detect TTY, disable when piped. `--no-color` flag to force off
- Global `--json` flag on all commands — outputs structured JSON instead of human-readable text
- Unicode status symbols: ✓ passed, ✗ failed, ○ pending, ● running, ⚠ warning

### Log Streaming UX
- `device-farm run` waits and streams by default — submit, connect WebSocket, stream progress until done, exit with 0/1/2. `--async` flag to return job ID immediately
- Inline step updates — current step updates in-place, completed steps stay visible (like vitest/pytest). Falls back to log-style append in non-TTY
- Compact summary block at end — pass/fail counts, total duration, device name, failed flow names with failing step
- `logs --follow` auto-exits with summary when job completes — no manual Ctrl+C needed, same exit code as `run`

### Config & Defaults
- Config file at `~/.device-farm.yaml` with: server_url, api_key, defaults (platform, timeout, output format)
- `config set/get` subcommands with dot notation for nested values: `config set defaults.platform ios`
- `config list` shows all current values
- API key masked in display — shows last 4 chars only (e.g., `df_key_***abc3`)
- Single server config — no profiles/contexts in v1. Override with `--server` flag or env var

### CI Pipeline Ergonomics
- Exit codes: 0 = all tests passed, 1 = test failures, 2 = infrastructure/CLI error (bad config, server unreachable, timeout)
- Environment variables with DEVICE_FARM_ prefix: DEVICE_FARM_URL, DEVICE_FARM_API_KEY, DEVICE_FARM_PLATFORM. Priority: flag > env > config > default
- Full TTY detection: TTY gets colors + inline updates + unicode; non-TTY gets plain text + log-style append + no colors
- `--meta key=value` flags for CI context — pass metadata (branch, PR, commit) that gets sent with the job submission

### Claude's Discretion
- Go CLI framework choice (cobra, urfave/cli, or stdlib)
- WebSocket client library choice
- YAML parsing library
- HTTP client implementation
- Binary name and build/release setup
- Internal code organization (cmd/, internal/, pkg/)
- Connection timeout and retry logic
- Multipart upload implementation for flow files

</decisions>

<specifics>
## Specific Ideas

- CLI consumes existing REST API endpoints: POST /api/jobs, GET /api/jobs, GET /api/jobs/:id, GET /api/jobs/:id/logs, DELETE /api/jobs/:id, GET /api/devices, GET /api/health
- CLI consumes existing WebSocket: /ws/jobs/:id (JSON messages with type: log/step/metrics/status) with late-join replay
- Artifact download via GET /api/jobs/:id/artifacts/:artifactId
- API errors come as RFC 7807 Problem Details — CLI should parse and display cleanly
- Cursor-based pagination on job list — CLI needs to handle cursor for `status --all` or similar listing
- Metadata filtering via dot notation query params for job listing

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- No existing Go code — greenfield CLI. Server is Node.js/TypeScript.

### Established Patterns
- Server API patterns are locked: RFC 7807 errors, cursor pagination, multipart upload, JSONB metadata filtering
- WebSocket protocol: JSON messages with `{ type, data, timestamp }` structure, late-join replay buffer

### Integration Points
- REST API at server_url (default http://localhost:3000)
- WebSocket at ws://server_url/ws/jobs/:id for job streaming
- WebSocket at ws://server_url/ws/devices/:id/preview for device preview (not consumed by CLI in v1)
- Config file at ~/.device-farm.yaml shared with future tools

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 04-go-cli*
*Context gathered: 2026-03-10*
