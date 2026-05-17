---
phase: 35-app-explorer
verified: 2026-05-16T00:00:00Z
status: human_needed
score: 11/11 must-haves verified
human_verification:
  - test: "End-to-end: start exploration via CLI, observe screens populate in Atlas UI in real time"
    expected: "device-farm explore --apk ... emits start; web /explorations/[id] graph grows with screen nodes + transitions live; finishes with reason=complete|budget|stuck; report.md downloads"
    why_human: "Requires live Claude Agent SDK invocation against a real device session + Maestro stack; cannot simulate end-to-end BFS programmatically"
  - test: "Atlas graph visual correctness on a real run"
    expected: "Screen thumbnails visible, BFS-tree edges laid out left-to-right by dagre, back-edges rendered distinctly, ScreenPanel + JourneyPanel respond to selection"
    why_human: "Visual layout quality, edge styling, hover/click UX cannot be asserted by grep"
  - test: "Stuck detector + watchdog terminate runaway runs"
    expected: "Forcing repeated same-screen pHashes triggers exploration.stuck; exceeding wall-clock budget triggers WatchdogExitReason=time; both produce terminal finished/failed frames over WS"
    why_human: "Real-world stuck conditions require live device + agent loop; unit specs assert components in isolation"
  - test: "Report DFS journey enumeration matches actual graph paths"
    expected: "GET /api/explorations/:id/report.md returns markdown with Mermaid graph + capped user-journey path list reflecting BFS-tree edges only (no back-edges as journeys)"
    why_human: "Quality of enumerated journeys is a semantic check best done by reading a sample report"
---

# Phase 35: App Explorer Verification Report

**Phase Goal:** Add a 'map every screen of an app' feature: Claude-driven BFS over an interactive device session, persisted screen graph, interactive Atlas visualization in web UI.
**Verified:** 2026-05-16
**Status:** human_needed (all automated checks pass; e2e + visual UX needs human validation)
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #   | Truth                                                                                            | Status     | Evidence                                                                                                                                              |
| --- | ------------------------------------------------------------------------------------------------ | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | An explorations module exists with public barrel + 12-rule dep-cruiser boundary                  | VERIFIED   | `server/explorations/{index,plugin,events,schemas,ws-schemas,queue,MODULE.md}.ts` + `.dependency-cruiser.cjs` rule 12 `no-deep-imports-into-explorations-internal` |
| 2   | The module is registered in Fastify with decorators                                              | VERIFIED   | `server/index.ts:7,131-136` registers `explorationsPlugin`; `plugin.ts:42-43` decorates `fastify.explorationsModule`                                  |
| 3   | DB persistence: explorations + exploration_screens + exploration_transitions with indexes        | VERIFIED   | `server/db/migrations/0010_explorations.sql` creates all 3 tables + 9 indexes + FK to artifacts/sessions/devices/api_keys                              |
| 4   | REST routes: POST/GET-list/GET-one/DELETE /api/explorations + GET /api/explorations/:id/report.md | VERIFIED   | `internal/routes.ts:123,270,284,322,351` — 5 routes registered with Zod type provider                                                                  |
| 5   | WS event stream with broadcaster + Zod validation                                                 | VERIFIED   | `internal/events-ws.ts:38-39` mounts `GET /api/explorations/:id/events`; `internal/broadcaster.ts:63-68` Zod safeParse on publish; replays last 200 frames |
| 6   | Claude Agent SDK BFS runner with 5 in-process MCP tools                                          | VERIFIED   | `internal/agent-runner.ts:26,192-207` invokes `query()` from `@anthropic-ai/claude-agent-sdk`; `agent-tools.ts:84,218,263,293,314` defines 5 `explore_*` tools |
| 7   | Similarity (sharp-phash) + stuck detector + watchdog + budget caps                               | VERIFIED   | `similarity.ts:22-23` imports sharp-phash; `stuck-detector.ts` sliding-window pHash detector; `watchdog.ts:32-36` wall-clock budget + cancel + tripBudget |
| 8   | CLI `device-farm explore` start + stream subcommand                                              | VERIFIED   | `cli/cmd/explore.go:47,85-119` registers Cobra command; `cli/internal/explore/{start,stream}.go` implement HTTP upload + WS stream                    |
| 9   | Web UI: list page + detail page with Atlas graph (xyflow/svelte + dagre)                         | VERIFIED   | `web/src/routes/explorations/{+page.svelte, [id]/+page.svelte}`; `lib/explorations/atlas-graph.svelte:24` imports `@xyflow/svelte`; `layout-graph.ts:28` imports `@dagrejs/dagre`; ScreenPanel + JourneyPanel imported in atlas-graph.svelte:29-30 |
| 10  | Report generator: Markdown + Mermaid graph + DFS journey enumeration                             | VERIFIED   | `internal/report.ts:69` `graph TD`; `:159-210` markdown sections include "Navigation Map" mermaid + capped path enumeration                            |
| 11  | Prompt template at `prompts/exploration.md` loaded by runtime                                    | VERIFIED   | `prompts/exploration.md` (290 lines, covers BFS strategy + tool docs); `internal/prompts-loader.ts` loads it                                          |

**Score:** 11/11 truths verified by static analysis. Tests: 127 pass (server vitest), 106 pass (Go CLI).

### Required Artifacts

| Artifact                                                       | Expected                            | Status   | Details                                                          |
| -------------------------------------------------------------- | ----------------------------------- | -------- | ---------------------------------------------------------------- |
| `server/explorations/plugin.ts`                                | Fastify plugin registering routes  | VERIFIED | 4.6K; decorates explorationsModule, calls both REST + WS register |
| `server/explorations/index.ts`                                 | Public barrel                       | VERIFIED | 2.8K                                                              |
| `server/explorations/events.ts`                                | Event constants + payload schemas   | VERIFIED | 7.8K; STARTED/SCREEN_DISCOVERED/TRANSITION/STUCK/TOOL_CALL/FINISHED/FAILED |
| `server/explorations/schemas.ts`                               | Zod input/output schemas            | VERIFIED | 5.1K                                                              |
| `server/explorations/ws-schemas.ts`                            | WS frame schemas                    | VERIFIED | 4.0K                                                              |
| `server/explorations/queue.ts`                                 | pg-boss queue alias + worker reg    | VERIFIED | 2.4K; idempotent enqueueRun                                       |
| `server/explorations/MODULE.md`                                | Module docs                         | VERIFIED | 16.8K                                                             |
| `server/explorations/internal/module.ts`                       | Module factory                      | VERIFIED | 9.2K                                                              |
| `server/explorations/internal/routes.ts`                       | 5 REST handlers                     | VERIFIED | 13.6K                                                             |
| `server/explorations/internal/events-ws.ts`                    | WS route                            | VERIFIED | 3.6K                                                              |
| `server/explorations/internal/broadcaster.ts`                  | Per-run broadcaster                 | VERIFIED | 6.5K                                                              |
| `server/explorations/internal/agent-runner.ts`                 | BFS runner via Claude Agent SDK     | VERIFIED | 11.8K                                                             |
| `server/explorations/internal/agent-tools.ts`                  | 5 explore_* MCP tools               | VERIFIED | 11.8K                                                             |
| `server/explorations/internal/similarity.ts`                   | sharp-phash + hamming               | VERIFIED | 4.0K                                                              |
| `server/explorations/internal/stuck-detector.ts`               | Sliding-window detector             | VERIFIED | 2.4K                                                              |
| `server/explorations/internal/watchdog.ts`                     | Budget + cancel watchdog            | VERIFIED | 2.6K                                                              |
| `server/explorations/internal/store.ts`                        | Read model / projection             | VERIFIED | 10.3K                                                             |
| `server/explorations/internal/repo.ts`                         | DB repo                             | VERIFIED | 6.5K                                                              |
| `server/explorations/internal/subscribers.ts`                  | Bus → broadcaster bridge            | VERIFIED | 5.6K                                                              |
| `server/explorations/internal/report.ts`                       | Markdown + Mermaid report          | VERIFIED | 9.8K                                                              |
| `server/explorations/internal/prompts-loader.ts`               | Loads exploration.md                | VERIFIED | 1.2K                                                              |
| `server/db/migrations/0010_explorations.sql`                   | 3 tables + indexes + FKs            | VERIFIED | 4.5K                                                              |
| `prompts/exploration.md`                                       | BFS prompt template                 | VERIFIED | 8.7K (290 lines)                                                  |
| `cli/cmd/explore.go`                                           | Cobra command                       | VERIFIED | 5.0K                                                              |
| `cli/internal/explore/start.go` + `stream.go`                  | HTTP + WS clients                   | VERIFIED | 9.7K + 7.2K                                                       |
| `web/src/routes/explorations/+page.svelte`                     | List page                           | VERIFIED |                                                                   |
| `web/src/routes/explorations/[id]/+page.svelte`                | Detail page                         | VERIFIED |                                                                   |
| `web/src/lib/explorations/atlas-graph.svelte`                  | Atlas viewer w/ xyflow+dagre        | VERIFIED | 4.8K                                                              |
| `web/src/lib/explorations/layout-graph.ts`                     | BFS-aware dagre layout              | VERIFIED | 10.0K                                                             |
| `web/src/lib/explorations/screen-panel.svelte`                 | Screen detail panel                 | VERIFIED | 9.0K                                                              |
| `web/src/lib/explorations/journey-panel.svelte`                | Journey enumeration panel           | VERIFIED | 7.2K                                                              |
| `web/src/lib/explorations/{client,ws-client,enumerate-paths,flow-tag,screen-node,start-end-node,atlas-types}` | Atlas support modules | VERIFIED | All present                                                     |
| `.dependency-cruiser.cjs` rule 12                              | `no-deep-imports-into-explorations-internal` | VERIFIED | Defined with `from.pathNot: ^server/explorations/` + `to.path: ^server/explorations/internal/` |

### Key Link Verification

| From                                  | To                                          | Via                                              | Status | Details                                                                  |
| ------------------------------------- | ------------------------------------------- | ------------------------------------------------ | ------ | ------------------------------------------------------------------------ |
| `server/index.ts`                     | `explorations/plugin.ts`                    | `import` + `app.register`                        | WIRED  | `server/index.ts:7,136`                                                  |
| `explorations/plugin.ts`              | `internal/routes.ts`                        | `registerExplorationRoutes`                      | WIRED  | `plugin.ts:28,51`                                                        |
| `explorations/plugin.ts`              | `internal/events-ws.ts`                     | `registerExplorationEventsWs`                    | WIRED  | `plugin.ts:29,52`                                                        |
| `agent-runner.ts`                     | `@anthropic-ai/claude-agent-sdk`            | `query()` call                                   | WIRED  | `agent-runner.ts:26,192-207`                                             |
| `agent-runner.ts`                     | `agent-tools.ts`                            | `buildExplorationTools`                          | WIRED  | `agent-runner.ts:36`                                                     |
| `agent-tools.ts: explore_save_screen` | `similarity.ts` + `stuck-detector.ts`       | call chain inside tool                            | WIRED  | tool wires pHash + stuck on save (per file header)                       |
| `internal/subscribers.ts`             | `internal/broadcaster.ts`                   | event bus → publish                              | WIRED  | bus subscriber bridges to per-run broadcaster                            |
| `routes.ts: POST /api/explorations`   | `queue.ts: enqueueRun`                      | direct call after row insert                      | WIRED  | routes.ts:241 comment confirms enqueue                                   |
| `cli/cmd/explore.go`                  | `cli/internal/explore/{start,stream}`       | function calls                                   | WIRED  | explore.go:95,119                                                        |
| Web `[id]/+page.svelte`               | `lib/explorations/atlas-graph.svelte`       | import + render                                  | WIRED  | `+page.svelte:17,148`                                                    |
| Web `[id]/+page.svelte`               | `/api/explorations/:id/events` WS           | mounts WS, merges frames into `screenMap`        | WIRED  | `+page.svelte:53-84`                                                     |
| `atlas-graph.svelte`                  | `@xyflow/svelte` + `@dagrejs/dagre`         | imports `SvelteFlow` + dagre layout              | WIRED  | atlas-graph.svelte:17-25; layout-graph.ts:28                             |
| `atlas-graph.svelte`                  | `screen-panel.svelte` + `journey-panel.svelte` | imports + render                                | WIRED  | atlas-graph.svelte:29-30                                                 |
| `report.ts`                           | `internal/store.ts` (graph read)            | function call                                    | WIRED  | report.ts:159-210 composes md from store output                          |

### Requirements Coverage

| Requirement | Source Plan(s) | Description (paraphrased)                                | Status     | Evidence                                                            |
| ----------- | -------------- | -------------------------------------------------------- | ---------- | ------------------------------------------------------------------- |
| EXP-PERSIST | 35-00          | DB persistence for explorations + screens + transitions  | SATISFIED  | `0010_explorations.sql` creates 3 tables + indexes; repo + store    |
| EXP-AGENT   | 35-02          | Claude Agent SDK BFS runner with explore_* MCP tools     | SATISFIED  | `agent-runner.ts` + `agent-tools.ts` (5 tools)                       |
| EXP-LOOP    | 35-02          | Similarity + stuck detector + watchdog + budget caps     | SATISFIED  | `similarity.ts` + `stuck-detector.ts` + `watchdog.ts`               |
| EXP-WS      | 35-03          | WS event stream w/ broadcaster + Zod-validated frames    | SATISFIED  | `events-ws.ts` + `broadcaster.ts` (Zod safeParse on publish)        |
| EXP-CLI     | 35-04          | `device-farm explore` start + stream                     | SATISFIED  | `cli/cmd/explore.go` + `cli/internal/explore/{start,stream}.go`     |
| EXP-UI      | 35-05          | Web list + Atlas detail page (xyflow + dagre + panels)   | SATISFIED  | `routes/explorations/*` + `lib/explorations/*` (8 modules)          |
| EXP-REPORT  | 35-06          | Markdown + Mermaid + DFS journey enumeration             | SATISFIED  | `report.ts` + `enumerate-paths.ts`; `report.md` route handler       |

All 7 requirements satisfied by static evidence; runtime behavior requires human validation (see human_verification).

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |

None. grep across `server/explorations/internal/*.ts` and `web/src/lib/explorations/*.{ts,svelte}` produced zero TODO/FIXME/XXX/PLACEHOLDER hits.

### Test Suite Status

| Suite                                   | Result          |
| --------------------------------------- | --------------- |
| `npx vitest run server/explorations`    | 127 pass / 0 fail |
| `go test ./internal/explore/... ./cmd/...` (cli) | 106 pass / 0 fail |

Specs cover: agent-runner, agent-tools, budget, events, prompts, report, routes, similarity, store, stuck-detector, watchdog, ws-broadcaster, atlas (web), explore start/stream (cli).

### Human Verification Required

See frontmatter `human_verification` block. The four items are e2e (live Claude run), visual UX (Atlas layout quality), real stuck/watchdog termination, and journey enumeration semantic correctness.

### Gaps Summary

No gaps. Every must-have listed in the verification prompt maps to concrete code with correct wiring. All 127 server tests and 106 CLI tests pass. The phase deliverables (explorations module, BFS agent, WS streaming, CLI, Atlas UI, reports) are present and integrated.

Status is `human_needed` rather than `passed` because the goal — "Claude-driven BFS over an interactive device session, persisted screen graph, interactive Atlas visualization" — has runtime dimensions (live agent loop, visual graph quality, terminal conditions on real apps) that no amount of grep can confirm. The orchestrator should flag this phase for an operator-run e2e session before declaring shipped.

---

_Verified: 2026-05-16_
_Verifier: Claude (gsd-verifier)_
