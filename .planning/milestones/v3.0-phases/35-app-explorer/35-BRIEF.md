# Phase 35 — App Explorer + Atlas Graph

**Track:** DF
**Effort:** ~6 days
**Source idea:** Revyl `app-explorer` repo (BFS agent + `frontend/AtlasGraph.tsx`)
**Depends on:** Phase 34 (session API — agent uses sessions, not jobs)

## Goal

Add a "map every screen of an app" feature: launches a Claude-driven BFS exploration over an interactive device session, persists the resulting screen graph, and renders an interactive Atlas visualization in the web UI.

## Why

Three product wins:
- **Pre-test coverage**: shows users which screens exist before they author Maestro flows.
- **Regression-by-graph**: diff of "screens reachable" between two builds catches dead-end / broken-link regressions invisible to pixel diffs.
- **Demo magnet**: a navigation graph with screenshots is one of the most viscerally impressive things to show in a sales/onboarding context.

It's the natural next step once Phase 34 makes "Claude drives a device" trivial.

## Scope

### In
- `exploration_runs`, `exploration_screens`, `exploration_transitions` tables.
- `server/exploration/` plugin: `POST /api/explorations`, `GET /api/explorations/:id`, WS `/api/explorations/:id/events`.
- Agent runner: spawns a Claude Agent SDK process with `prompts/exploration.md` (CLAUDE.md-as-spec) and `@device-stream/mcp` already wired (from Phase 34).
- BFS state persisted as the agent runs — resumable if killed.
- Static iOS skeleton seed input (links to Phase 34 — optional `--seed-skeleton` arg).
- Web UI `/explorations/[id]/+page.svelte` with `@xyflow/svelte` + dagre layout.
- Screen-similarity loop detection (reuses inline pHash (see T-35.3)).

### Out
- Android binary skeleton seeding (Phase 34 covers iOS only)
- Login automation (out of scope — agent shall surface `loginRequired` event)
- Auto-Maestro-flow generation from the graph (separate v3.1 feature)

## Data model

```
exploration_runs:
  id              uuid PK
  device_id       uuid FK
  session_id      uuid FK -> sessions
  app_artifact_id uuid FK -> artifacts            -- the APK/IPA used
  bundle_id       text
  status          enum('queued','running','complete','failed','cancelled')
  start_screen    text                            -- usually first screen captured
  budget_taps     int default 200                 -- safety cap
  budget_screens  int default 60                  -- safety cap
  config          jsonb                           -- {model, temperature, seed_skeleton_id, ...}
  created_at      timestamptz
  finished_at     timestamptz

exploration_screens:
  id              uuid PK
  run_id          uuid FK
  screen_id       text                            -- agent-assigned stable id
  title           text
  screenshot_artifact_id uuid FK -> artifacts
  phash           bytea
  elements        jsonb                           -- [{label, type, explored, leads_to?}]
  notes           text
  visited_at      timestamptz
  UNIQUE (run_id, screen_id)

exploration_transitions:
  id              uuid PK
  run_id          uuid FK
  from_screen_id  text
  to_screen_id    text
  action          jsonb                           -- {kind: tap, target: 'Settings', x, y}
  is_back_edge    bool default false
  created_at      timestamptz
```

## Tasks

### T-35.1 — Schema + plugin + REST (~6h)

**Files**
- `server/db/schema.ts` — three new tables (above)
- `server/exploration/index.ts` (plugin)
- `server/exploration/runs.ts` (`POST /api/explorations`, `GET /api/explorations/:id`)
- `server/exploration/events-ws.ts` (`WS /api/explorations/:id/events`)
- `server/exploration/__tests__/runs.test.ts`

`POST /api/explorations` body:
```
{
  appArtifactId: uuid,
  platform: 'ios'|'android',
  budgetTaps?: int,
  budgetScreens?: int,
  seedSkeletonId?: uuid,        -- Phase 34
  model?: 'claude-sonnet-4-6'|'claude-opus-4-7'
}
```

Returns `{runId, sessionId, agentLogStreamUrl}`.

### T-35.2 — Agent runner (~8h)

**Files**
- `server/exploration/agent-runner.ts` — spawns Claude Agent SDK subprocess
- `prompts/exploration.md` (new, ports the BFS instructions from Revyl `app-explorer/CLAUDE.md`)
- `server/exploration/store.ts` — Drizzle helpers (`saveScreen`, `saveTransition`, `getUnexplored`)

Use `@anthropic-ai/claude-agent-sdk` (Node). Tools available to the agent: the MCP tools from Phase 34 (`device_tap_by_description`, `device_screenshot`, etc.) + 4 exploration-specific tools:

```
explore_save_screen({title, elements, notes})  -> {screen_id}
explore_mark_explored({screen_id, element_label, leads_to_screen_id|null})
explore_get_unexplored()                       -> [{screen_id, label, type}]
explore_finish({reason: 'complete'|'budget'|'stuck'})
```

Agent loop sketch (from `app-explorer/CLAUDE.md`):

```
1. screenshot -> visually identify -> if new save_screen, else mark visited
2. enumerate visible interactive elements -> persist
3. pick next unexplored element (BFS) -> tap_by_description -> screenshot
4. detect loop: phash(new screenshot) ≈ phash(any prior) -> mark as "leads_to existing"
5. dead-end / 3 consecutive taps without screen change -> backtrack via key:back
6. if elements_total < 3 -> stuck event
7. stop on budget or all elements explored
```

### T-35.3 — Loop / stuck detection (~4h)

**Files**
- `server/exploration/similarity.ts` — pHash + cheap byte-level diff (no external diff lib)
- `server/exploration/store.ts` (extend)

**pHash inline implementation** (since Phase 28 was cut):
- Decode the PNG to grayscale with `sharp` (already a transitive dep of several packages; verify, add if missing).
- Resize to 32×32, run a 2D DCT, take the top-left 8×8 block excluding the DC term, threshold against the median → 64-bit hash.
- Hamming distance < 8 over 64 bits ≈ "looks the same".
- Confirm with a downsampled (64×64 grayscale) byte-level RMSE < 0.02 to filter false positives.

```
isSameScreen(newShot, screens):
  hash = phash(newShot)
  candidates = screens where hammingDistance(hash, s.phash) < 8
  for c in candidates:
    if rmseGray64(newShot, c.screenshot) < 0.02:
      return c
  return null
```

~150 LOC total, no new heavy dep. Surface `stuck` via WS when agent emits same screen 3x in a row.

### T-35.4 — WS event stream (~3h)

**Files**
- `server/exploration/events-ws.ts`

Streams JSONL of:
```
{type:'screen-discovered', screen}
{type:'transition', from, to, action}
{type:'tool-call', name, args}
{type:'finished', reason, stats}
{type:'error', message}
```

History replayed on reconnect (last 200 events).

### T-35.5 — CLI command (~2h)

**Files**
- `cli/cmd/explore.go`

```
device-farm explore --apk myapp.apk --budget-screens 50 --seed-skeleton <id> --json
```

Streams events. Exits when `finished`.

### T-35.6 — Web UI: Atlas graph (~8h)

**Files**
- `web/src/routes/explorations/[id]/+page.svelte`
- `web/src/routes/explorations/[id]/+page.ts` (loader)
- `web/src/lib/components/AtlasGraph.svelte` (~250 LOC port of `AtlasGraph.tsx`)
- `web/src/lib/components/ScreenPanel.svelte`
- `web/src/lib/components/JourneyPanel.svelte`

Dependencies (add to `web/package.json`):
- `@xyflow/svelte` (official Svelte 5 port of React Flow)
- `dagre`

**Layout algorithm** (port of `AtlasGraph.tsx:53` `layoutGraph`):

```
buildLayout(screens, transitions):
  treeEdges = transitions filter (!is_back_edge)
  g = new dagre.graphlib.Graph(); g.setGraph({rankdir:'TB', nodesep:60, ranksep:80})
  for s in screens: g.setNode(s.screen_id, {width:200, height:140})
  for t in treeEdges: g.setEdge(t.from, t.to)
  dagre.layout(g)
  return {
    nodes: screens.map(s => ({...g.node(s.screen_id), data:s})),
    edges: transitions.map(t => ({...t, type: t.is_back_edge ? 'back' : 'tree'}))
  }
```

Tree edges feed dagre; back-edges drawn as dashed bezier overlays so they don't twist the layout.

`ScreenPanel.svelte` — right rail: full-size screenshot, elements list, incoming/outgoing transitions.

`JourneyPanel.svelte` — DFS path enumeration (max 20 paths) with a step-through scrubber.

### T-35.7 — Reports (~2h)

**Files**
- `server/exploration/report.ts` — Markdown + Mermaid graph generator
- `GET /api/explorations/:id/report.md`

For pasting in PRs / docs.

## Acceptance criteria

- [ ] `POST /api/explorations` launches an agent that fills `exploration_screens` and `exploration_transitions` from a real APK (sample: F-Droid pick).
- [ ] Loop detection prevents the same screen being saved twice (pHash + pixelmatch).
- [ ] Stuck event fires on the 3rd consecutive same-screen tap.
- [ ] WS events stream to the dashboard; reconnect replays.
- [ ] `/explorations/:id` renders an interactive Atlas; clicking a node opens ScreenPanel.
- [ ] Budget caps (taps, screens) are honored.
- [ ] An exploration of a known sample app (Wikipedia for Android) finds ≥ 10 distinct screens within budget.
- [ ] `device-farm explore` exits 0 on success and non-zero on `failed`.

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Agent gets stuck in modal / login | Stuck detection + WS event surfaces it; user can resume after auth |
| Cost of agent runs explodes | Budget caps; default Sonnet not Opus; per-org daily limit setting |
| Screens that differ only in dynamic data (lists) flagged as new | pHash threshold tunable; allow user to merge screens manually |
| Hermes / heavily-virtualized RN apps confuse hierarchy | Phase 34 iOS skeleton seed mitigates by pre-listing screens |

## References

- app-explorer: `CLAUDE.md` (executable BFS spec — port verbatim with adjustments)
- app-explorer: `app_explorer/store.py` (Pydantic models — guide for our Drizzle schema)
- app-explorer: `app_explorer/models.py` (Screen/Element/Transition)
- app-explorer: `frontend/src/components/AtlasGraph.tsx` (BFS-aware dagre layout — line 53 `layoutGraph`)
- app-explorer: `frontend/src/components/ScreenPanel.tsx`, `JourneyPanel.tsx`
- Anthropic Claude Agent SDK docs
- Current code: `server/sessions/` (Phase 34)

## Done = Nyquist-compliant

Unit tests for similarity/loop detection, integration test against a sample APK with deterministic outcome (assert ≥ N screens), WS event contract tests, web UI snapshot test, sweep test for budget enforcement.
