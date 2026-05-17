# Phase 35 — Deferred Items

Catalog of intentional deferrals + carry-forwards discovered across Plans
35-00 through 35-06. Each item is either explicitly out-of-scope for v3.0
(deferred to v3.1 or later) or a pre-existing issue inherited from prior
phases (carry-forward).

## Phase 35-specific deferrals

### DEFERRED-35-A — persistEnvelope 12TH sample point consolidation
Phase 27+ owns tree-wide extraction of the 10-line `persistEnvelope`
closure from `server/explorations/internal/module.ts` (and 11 other module
factories: hooks/pool/jobs/maestro/pipelines/auth/streaming/lifecycle/
reporting/artifacts/sessions) to `server/bus/middlewares/persist-envelope.ts`.
Phase 35 ships the 12th verbatim copy. Supersedes DEFERRED-26-B
(originally the 10th sample point) and DEFERRED-34-A (the 11th).

### DEFERRED-35-B — DEVICE_FARM_E2E gated sample-APK exploration
The `server/explorations/__tests__/e2e.spec.ts` harness is gated by
`DEVICE_FARM_E2E=1`. Requires a real Android emulator + Anthropic API
key + a known-stable APK (Wikipedia for Android recommended). Phase 35
ships the harness; CI activation deferred to ops capacity (matrix
runner cost + Anthropic API budget allocation).

### DEFERRED-35-C — Concurrent multi-run UI badge
Web UI lists explorations sequentially via `/explorations`; live "N
running" counter + live-list refresh on bus events deferred to Phase 36+
(CommandPalette + dashboard polish). Required: bus subscriber emits a
WS broadcast on every `exploration.started` / `exploration.finished` /
`exploration.failed` event; web UI maintains a Map<runId, status> in
$state and renders a badge.

### DEFERRED-35-D — Visual regression diffing across explorations
"Compare last 2 runs of same APK" feature deferred to a separate phase
(v3.1 scope or later). Required: per-screen pHash comparison across two
runs, side-by-side screenshot diff UI, summary report listing
"changed/added/removed" screens.

### DEFERRED-35-E — Auto-Maestro-flow generation from graph
Inferring a Maestro flow YAML from the BFS-discovered paths is a v3.1+
feature; explicitly out of Phase 35 scope. Required: DFS path
enumeration (already shipped via `enumerateJourneys` in
`internal/report.ts`) → Maestro YAML serializer → API endpoint
`GET /api/explorations/:id/flow.yaml`.

### DEFERRED-35-F — iOS device_tap_by_description reliability
Phase 34's MaestroAiResolver was Android-first. iOS support via
ClaudeVisionResolver is platform-agnostic but accuracy depends on
screenshot resolution + UI complexity. Tracked as a best-effort risk;
no automated fix until accuracy data accumulates from real iOS
exploration runs.

### DEFERRED-35-G — Playwright snapshot test for Atlas graph
Visual snapshot test of `/explorations/[id]` deferred to Phase 29 Web
Refactor when the Playwright harness lands. Current coverage:
`atlas.spec.ts` covers file existence + dispatchFrame translation
(camelCase → snake_case) + graceful degradation when handlers absent,
but does NOT mount Svelte components (no svelte test-renderer wired).

### DEFERRED-35-H — Concurrent web subscribers heartbeat policy
The broadcaster heartbeats every 30s per-run regardless of subscriber
count. Optimization (skip heartbeat when 0 subscribers attached, restart
on subscribe) deferred to optimization pass. Current behavior is
load-acceptable for typical exploration traffic (~1-5 runs concurrent).

### DEFERRED-35-I — Server-side POST /api/artifacts endpoint
The CLI's `device-farm explore` subcommand assumes a public POST
`/api/artifacts` upload endpoint per the Plan 35-04 contract, but the
server currently has artifacts as job-scoped (created internally by
the jobs upload pipeline at `server/api/routes.ts`). A standalone
artifact upload endpoint needs to be added for `device-farm explore`
to work end-to-end against a live server. Test coverage is locked at
the contract level (CLI tests pass against an httptest stub mimicking
the expected endpoint shape). Recommend landing in a Phase 36+
follow-up plan or a standalone hotfix.

### DEFERRED-35-J — Pagination on /explorations list
Currently `LIMIT 100` (server-side) on the list endpoint. Once the
dashboard accumulates >100 runs, add a DataGrid component with
cursor-based pagination. Phase 38+ Web Refactor candidate.

### DEFERRED-35-K — /explorations route start-run modal
Plan 35-05 list view did NOT call for an in-UI "Start Exploration"
button; explorations are kicked off via the CLI (`device-farm explore`).
Future UX enhancement.

### DEFERRED-35-L — WS reconnect-on-disconnect
Current `web/src/lib/explorations/ws-client.ts` opens once and reports
onClose; if the server drops the connection mid-stream, the page does
NOT auto-reconnect. Add exponential-backoff retry loop in a future
hardening pass.

### DEFERRED-35-M — Stuck banner UI
The `onStuck` handler is wired in `ws-client.ts` but
`web/src/routes/explorations/[id]/+page.svelte` does NOT render a
banner yet. Cosmetic — add to phase-close polish or Phase 36
CommandPalette.

### DEFERRED-35-N — Linux iOS bundle-id detection
`plutil` (used by `cli/internal/explore/start.go` for iOS bundle-id
detection) is macOS-only. The CLI helpfully errors on Linux with
"plutil not in PATH (macOS-only; pass --bundle-id on Linux)". An
XML-parsing fallback (decode Info.plist XML directly without plutil)
would let Linux CI rigs auto-detect iOS bundle IDs.

### DEFERRED-35-O — Cookie-based WS auth path
Phase 22 streaming WS + Phase 35-03 explorations WS both use
`?token=<bearer>` query param. Cookie-based auth (would need CORS-aware
cookie semantics + CSRF guard for WebSocket-as-cross-origin) deferred
to a future security-hardening phase.

## Carry-forwards from prior phases

### DEFERRED-17-A — fastify-zod-openapi v5 `required`-emission bug
Still pending v6 release (or library swap). Phase 35 routes use
`.meta({id:'...'})` which works around the bug for promoted schemas;
component schemas with cross-field refines (none in Phase 35) would
still hit it. The DELETE 204 response is intentionally NOT typed via
Zod for the same reason (v5 cannot serialize `z.void()`). The
`GET /api/explorations/:id/report.md` response is also untyped because
v5 cannot serialize a plain-string body schema.

### DEFERRED-15-A — Map-vs-RequestContext tsc inheritance
24 pre-existing tsc errors in `server/correlation/*` carried forward
from Phase 15+26+34; ZERO new from Phase 35.

### DEFERRED-26-B — persistEnvelope sample-point consolidation chain
Originally the 10th sample point (auth module). Phase 34 extended to
the 11th (sessions). Phase 35 extends to the 12th (explorations).
Tracker continues until Phase 27+ owns the tree-wide extraction.
Superseded by DEFERRED-35-A as the new high-water mark.

## Pre-existing issues catalogued during Phase 35 execution

### Go CLI build errors (NOT caused by Phase 35)
- `cli/internal/types/unions.go:22-57` references `JobLogMessage`,
  `JobStepMessage`, `JobStatusMessage` — none of these symbols are
  defined in `cli/internal/types/`. Confirmed pre-existing via
  `git stash + build` experiment. Out of Phase 35 scope. `cli/cmd ./cmd`
  test target still compiles + passes because Go's test runner isolates
  per-package compilation. Defer fixing `unions.go` to a maintenance
  hotfix or Phase 36+ pickup.

### Pre-existing pipelines schema TS error
- `server/pipelines/internal/pipeline-schema.ts:27` — Zod call site
  missing arguments. Single pre-existing TSC error, unrelated to
  Phase 35 surface.

### Pre-existing svelte-check baseline (21 errors)
- Non-explorations files (Nav.svelte device store narrowing → `never`,
  +page.svelte dashboard route, pipeline-runs/pipelines route
  status-string narrowing). Inherited from prior phases. Plan 35-05
  REDUCED the count from 22 → 21 by fixing atlas-graph type errors
  during its execution. Logged for future cleanup phase.

### Pre-existing dep-cruiser baseline (5 violations)
- `server/artifacts/memory-service.ts` → `server/streaming/internal/types.ts`
- `server/artifacts/artifact-service.ts` → `server/streaming/internal/types.ts`
- `server/artifacts/__tests__/artifact-service.spec.ts` → `server/streaming/internal/types.ts`
- `server/api/plugin.ts` → `server/pipelines/internal/queue-status.ts`
- `server/api/internal/pipelines-queue-route.ts` → `server/pipelines/internal/queue-status.ts`

All 5 are pre-existing artifacts→streaming + api→pipelines deep-imports
out of Phase 35 scope. Baseline preserved through all 7 Phase 35 plans.
