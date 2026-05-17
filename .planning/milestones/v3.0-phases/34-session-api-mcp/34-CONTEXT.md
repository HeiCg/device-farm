# Phase 34: Session API + MCP Server - Context

**Gathered:** 2026-05-15
**Status:** Ready for planning
**Source:** Pre-authored brief at `34-BRIEF.md` + cloned reference repos

<domain>
## Phase Boundary

Move device-farm from "batch only" to "session-aware": REST + WS lease/release plus actions (tap/tapByDescription/type/swipe/key/screenshot/screenRecord/install/uninstall/launch). Ship `@device-stream/mcp` package for Claude Code. NL targeting via pluggable backends (Maestro AI default, Claude Vision opt-in). Out of scope: multi-session-per-device, OmniParser, session replay.

</domain>

<decisions>
## Implementation Decisions

### External Dependencies Policy (LOCKED)
**Reference repos are STUDY-ONLY.** revyl-cli, mobile-devtools, kittyfarm at `/Users/heicg/Desktop/projects/_reference/` are read-only references — copy ideas/algorithms/pseudocode/API shapes into `device-stream/`/`device-farm/server`/`device-farm/cli`/`device-farm/web`, never link or `npm install`/`go get` them. Normal libs (Anthropic SDK, MCP SDK, fastify, zod) remain fine.

### Authoritative Sources (LOCKED)
- `34-BRIEF.md` — task list, architecture, action surface, Zod envelopes
- `/Users/heicg/Desktop/projects/_reference/revyl-cli/` — CLI session UX pattern (`device lease`, `device tap --target`)
- `/Users/heicg/Desktop/projects/_reference/mobile-devtools/README.md` — session API design
- `/Users/heicg/Desktop/projects/_reference/kittyfarm/KittyFarm/LocalControl/` — MCP server reference (LocalControlMCPHandler.swift, LocalControlServer.swift, MCPConfigurationInstaller.swift, LocalControlFrameEncoder.swift)
- Phase 26 auth — sessions inherit principal via ALS

### Architecture
- New plugin `server/sessions/` with module-pattern: `events.ts`, `MODULE.md`, `index.ts` barrel, factory `createSessionsModule(deps)`
- DB table `sessions(id, device_id, owner, status, lease_expires_at, created_at, released_at)`
- REST: `POST /api/sessions` lease | `DELETE /api/sessions/:id` release
- WS: `/api/sessions/:id` with Zod-validated action envelopes; `id`-echoed ack/error
- Rate limit: 30 actions / 10s per session
- TTL: 10 min idle → auto-release via pg-boss scheduled job
- Resolver: `MaestroAiResolver` (default) + `ClaudeVisionResolver` (opt-in env `DEVICE_FARM_CLAUDE_VISION=1`)
- MCP package as new monorepo workspace `mcp/` shipped via npm as `@device-stream/mcp` (stdio transport)

### Tasks (from brief)
- T-34.1: Schema + lease/release REST
- T-34.2: WS action protocol (Zod envelopes)
- T-34.3: Action dispatch into device-stream / Maestro
- T-34.4: NL target resolver: Maestro AI backend
- T-34.5: NL target resolver: Claude Vision backend (opt-in)
- T-34.6: Auth + rate limit + sweeper
- T-34.7: `@device-stream/mcp` package (MCP stdio server)
- T-34.8: CLI wrapper (`device-farm session ...`)
- T-34.9: Web UI panel `/sessions/[id]`
- T-34.10: Docs + example agents

### Claude's Discretion
- Drizzle migration filename numbering (existing sequence)
- Exact MCP tool names — match Anthropic naming conventions
- WS reconnect/resume semantics
- ClaudeVisionResolver caching strategy

</decisions>

<canonical_refs>
## Canonical References

### Reference implementations
- `/Users/heicg/Desktop/projects/_reference/revyl-cli/cmd/` — session-aware CLI commands
- `/Users/heicg/Desktop/projects/_reference/revyl-cli/pkg/` — session client lib
- `/Users/heicg/Desktop/projects/_reference/revyl-cli/internal/` — session/MCP internals
- `/Users/heicg/Desktop/projects/_reference/kittyfarm/KittyFarm/LocalControl/LocalControlMCPHandler.swift`
- `/Users/heicg/Desktop/projects/_reference/kittyfarm/KittyFarm/LocalControl/LocalControlServer.swift`
- `/Users/heicg/Desktop/projects/_reference/kittyfarm/KittyFarm/LocalControl/MCPConfigurationInstaller.swift`
- `/Users/heicg/Desktop/projects/_reference/mobile-devtools/README.md`

### Existing local code
- `server/auth/` — Phase 26 module (sessions consume `requireAuth` + `requireApiKey`)
- `server/jobs/` — sibling module pattern to copy
- `server/pool/` — device allocation surface
- `cli/cmd/` — Cobra command registration
- `web/src/routes/` — SvelteKit routes

### Phase brief
- `.planning/phases/34-session-api-mcp/34-BRIEF.md`

</canonical_refs>

<specifics>
## Specific Ideas

- Sessions module follows the same pattern as Phase 26 auth (factory + events + module + plugin)
- MCP server is a new npm workspace, not bundled with CLI — keeps install lightweight
- Default rate limit conservative (30/10s) — agents that hit it should batch via Maestro flows instead

</specifics>

<deferred>
## Deferred Ideas

- Multi-session-per-device (v3.1)
- OmniParser as 3rd NL resolver backend
- Session replay/recording (lives in Phase 35)

</deferred>

---

*Phase: 34-session-api-mcp*
*Context gathered: 2026-05-15 via brief-derived smart discuss*
