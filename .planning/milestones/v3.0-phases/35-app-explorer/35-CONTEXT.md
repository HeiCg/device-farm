# Phase 35: App Explorer + Atlas Graph - Context

**Gathered:** 2026-05-15
**Status:** Ready for planning
**Source:** Pre-authored brief at `35-BRIEF.md` + cloned `app-explorer` reference repo

<domain>
## Phase Boundary

Claude-driven BFS exploration over an interactive device session that produces a persisted screen graph + interactive Atlas viz in the web UI. Consumes the Session API from Phase 34. Out of scope: standalone agent runner outside device-farm, multi-app comparison.

</domain>

<decisions>
## Implementation Decisions

### External Dependencies Policy (LOCKED)
**Reference repos are STUDY-ONLY.** app-explorer at `/Users/heicg/Desktop/projects/_reference/app-explorer/` is read-only — copy the BFS agent loop, pHash algorithm, AtlasGraph component design, prompt templates into `device-farm/`; do NOT vendor or import the python package. Normal libs (Claude Agent SDK, xyflow/svelte, dagre) remain fine.

### Authoritative Sources (LOCKED)
- `35-BRIEF.md` — schema, agent loop, loop/stuck detection, viz spec
- `/Users/heicg/Desktop/projects/_reference/app-explorer/` — full reference (CLAUDE.md spec, app_explorer/ runner, frontend/AtlasGraph.tsx)
- Phase 34 sessions — agent uses `@device-stream/mcp` actions, not Maestro flows

### Architecture
- New plugin `server/explorations/` module
- Tables: `explorations`, `exploration_screens`, `exploration_transitions` (BFS graph)
- Agent runner: Claude Agent SDK + prompts/exploration.md; stops on budget caps (taps, screens)
- Inline pHash + grayscale RMSE for screen-equivalence detection; "stuck" event on 3rd consecutive same-screen tap
- WS event stream for live progress
- CLI: `device-farm explore <apk>`
- Web: `/explorations/[id]` with xyflow-svelte + dagre layout; BFS tree-edges solid, back-edges dashed
- Reports: Markdown + Mermaid

### Tasks (from brief)
- T-35.1: Schema + plugin + REST routes
- T-35.2: Agent runner (Claude Agent SDK + prompts/exploration.md)
- T-35.3: Loop / stuck detection (inline pHash)
- T-35.4: WS event stream
- T-35.5: CLI command (`device-farm explore`)
- T-35.6: Web UI Atlas graph + ScreenPanel + JourneyPanel
- T-35.7: Reports (Markdown + Mermaid)

### Claude's Discretion
- pHash algorithm choice (use existing JS lib vs port)
- Agent prompt template tuning
- xyflow-svelte vs straight SvelteFlow (whichever has clean dagre integration)
- Exact threshold values for RMSE/pHash similarity

</decisions>

<canonical_refs>
## Canonical References

### Reference implementation (READ FIRST)
- `/Users/heicg/Desktop/projects/_reference/app-explorer/CLAUDE.md` — agent spec
- `/Users/heicg/Desktop/projects/_reference/app-explorer/app_explorer/` — runner
- `/Users/heicg/Desktop/projects/_reference/app-explorer/frontend/` — AtlasGraph component
- `/Users/heicg/Desktop/projects/_reference/app-explorer/reports/` — report format examples

### Phase brief
- `.planning/phases/35-app-explorer/35-BRIEF.md`

</canonical_refs>

<specifics>
## Specific Ideas

- Use the same module pattern as Phase 26 / 34 (events.ts, MODULE.md, factory)
- Reports stored alongside artifacts, surfaced via existing artifacts API

</specifics>

<deferred>
## Deferred Ideas

- Multi-app comparison
- Stand-alone CLI tool outside device-farm
- Visual regression diffing across explorations (separate phase)

</deferred>

---

*Phase: 35-app-explorer*
*Context gathered: 2026-05-15 via brief-derived smart discuss*
