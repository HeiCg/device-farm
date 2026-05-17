# Phase 35: App Explorer + Atlas Graph — Research

**Researched:** 2026-05-15
**Domain:** Claude-driven BFS exploration over an interactive device session; persisted screen graph + xyflow Atlas visualization
**Confidence:** HIGH

## Summary

Phase 35 turns Phase 34's "Claude can drive a device" primitive into a goal-directed product feature: a BFS agent that systematically taps every interactive element of a target app, persists each unique screen + transition, and renders the resulting navigation graph as an interactive Atlas in the web UI. The reference repo at `/Users/heicg/Desktop/projects/_reference/app-explorer/` ships every component this phase needs in working form — agent spec (`CLAUDE.md`), Python BFS runner (`app_explorer/`), React xyflow Atlas (`frontend/`), Markdown+Mermaid report generator (`app_explorer/report.py`) — and per the locked External Dependencies Policy, all of these are STUDY-ONLY: we port the algorithm + UX into device-farm, never link or vendor the package.

The build is structurally identical to Phase 34 and copies it verbatim: a new `server/explorations/` module-pattern plugin (factory + events.ts + MODULE.md + index.ts barrel + thin Fastify wirer), three Drizzle tables (`explorations`, `exploration_screens`, `exploration_transitions`), Zod-validated REST + WS surface, pg-boss for run scheduling + the watchdog timeout, and a `prompts/exploration.md` markdown spec that drives the Claude Agent SDK. The agent runs in-process inside the server: `@anthropic-ai/claude-agent-sdk` lets us register custom exploration tools (`explore_save_screen`, `explore_mark_explored`, `explore_get_unexplored`, `explore_finish`) as a `createSdkMcpServer({tools:[...]})` in-process MCP server, alongside the existing `@device-stream/mcp` package (Phase 34) that already exposes `device_tap`, `device_screenshot`, etc. via stdio transport. Result: ONE `query({prompt, options:{mcpServers:{...}}})` call drives both surfaces with zero subprocess overhead.

Loop detection is the only piece without a Phase-34 analog. The reference repo relies on the agent reading screenshots visually; that's expensive at scale, so we add an inline perceptual-hash sidecar (DCT-based 64-bit pHash via `sharp-phash` → Hamming distance < 8, confirmed by `sharp`-grayscale downsample + RMSE < 0.02). Sharp is already a transitive dep via `@device-stream/ios-simulator → appium-ios-simulator`. The web layer mirrors the React reference 1:1: `@xyflow/svelte` (officially Svelte 5–ready) + `@dagrejs/dagre`, BFS-aware layout that feeds ONLY tree edges to dagre and overlays back-edges as dashed strokes so the layout doesn't twist. ScreenPanel + JourneyPanel port directly to Svelte 5 runes.

**Primary recommendation:** Treat Phase 35 as a thin orchestration over Phase 34 — the agent talks to a device session via `@device-stream/mcp`, the in-process exploration MCP tools persist BFS state via Drizzle, and a watchdog enforces budget caps (taps, screens, wall-clock). No new device-stream surface. Web UI is a 250-LOC port of `frontend/src/components/AtlasGraph.tsx` (React → Svelte 5).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**External Dependencies Policy (LOCKED).** Reference repos are STUDY-ONLY. app-explorer at `/Users/heicg/Desktop/projects/_reference/app-explorer/` is read-only — copy the BFS agent loop, pHash algorithm, AtlasGraph component design, prompt templates into `device-farm/`; do NOT vendor or import the python package. Normal libs (Claude Agent SDK, xyflow/svelte, dagre) remain fine.

**Authoritative Sources (LOCKED).**
- `35-BRIEF.md` — schema, agent loop, loop/stuck detection, viz spec
- `/Users/heicg/Desktop/projects/_reference/app-explorer/` — full reference (CLAUDE.md spec, app_explorer/ runner, frontend/AtlasGraph.tsx)
- Phase 34 sessions — agent uses `@device-stream/mcp` actions, not Maestro flows

**Architecture.**
- New plugin `server/explorations/` module
- Tables: `explorations`, `exploration_screens`, `exploration_transitions` (BFS graph)
- Agent runner: Claude Agent SDK + `prompts/exploration.md`; stops on budget caps (taps, screens)
- Inline pHash + grayscale RMSE for screen-equivalence detection; "stuck" event on 3rd consecutive same-screen tap
- WS event stream for live progress
- CLI: `device-farm explore <apk>`
- Web: `/explorations/[id]` with xyflow-svelte + dagre layout; BFS tree-edges solid, back-edges dashed
- Reports: Markdown + Mermaid

**Tasks (from brief).**
- T-35.1: Schema + plugin + REST routes
- T-35.2: Agent runner (Claude Agent SDK + `prompts/exploration.md`)
- T-35.3: Loop / stuck detection (inline pHash)
- T-35.4: WS event stream
- T-35.5: CLI command (`device-farm explore`)
- T-35.6: Web UI Atlas graph + ScreenPanel + JourneyPanel
- T-35.7: Reports (Markdown + Mermaid)

### Claude's Discretion

- pHash algorithm choice (use existing JS lib vs port) — recommend `sharp-phash` (proven, sharp already in tree)
- Agent prompt template tuning
- xyflow-svelte vs straight SvelteFlow (whichever has clean dagre integration) — recommend `@xyflow/svelte` (officially renamed Svelte Flow 1.0; Svelte 5-native, has dagre example)
- Exact threshold values for RMSE/pHash similarity — recommend Hamming < 8 / RMSE < 0.02 per brief; tune in Wave 0 with sample APKs

### Deferred Ideas (OUT OF SCOPE)

- Multi-app comparison
- Stand-alone CLI tool outside device-farm
- Visual regression diffing across explorations (separate phase)
- Auto-Maestro-flow generation from the discovered graph (separate v3.1 feature)
- Android binary skeleton seeding (Phase 34 iOS-only feature; reused via optional `--seed-skeleton-id` if available)
- Login automation — agent surfaces `login-required` event; human resumes
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| EXP-SCHEMA | Three Drizzle tables (`explorations`, `exploration_screens`, `exploration_transitions`) with FK + partial unique indexes; migration `0010_explorations.sql`. | §Schema |
| EXP-AGENT | `agent-runner.ts` calls Claude Agent SDK `query({prompt: prompts/exploration.md, options:{mcpServers:{deviceStream, exploration}}})`; budget caps + watchdog enforce termination. | §Agent Runner |
| EXP-LOOP | `similarity.ts` exports `phashAndRmse(buf)` + `isSameScreen(newShot, screens)`; Hamming < 8 + grayscale-64 RMSE < 0.02. Stuck event emitted on 3rd consecutive same-screen tap. | §Loop / Stuck Detection |
| EXP-WS | `WS /api/explorations/:id/events` streams JSONL discriminated union of `screen-discovered \| transition \| tool-call \| stuck \| finished \| error`; reconnect replays last 200 events (matches Phase 22 broadcaster pattern). | §WS Event Stream |
| EXP-CLI | `device-farm explore --apk <path> [--budget-screens 50 --seed-skeleton <id> --json]`; streams events, exits 0 on `finished{reason:complete}`, non-zero on `failed`. | §CLI |
| EXP-UI | `/explorations/[id]/+page.svelte` renders `@xyflow/svelte` Atlas with BFS-aware dagre layout (tree-edges solid, back-edges dashed); ScreenPanel + JourneyPanel ported from React reference to Svelte 5. | §Web UI |
| EXP-REPORT | `GET /api/explorations/:id/report.md` returns Markdown + Mermaid graph + DFS user-path enumeration; format mirrors `_reference/app-explorer/app_explorer/report.py`. | §Reports |
</phase_requirements>

## Reference Walkthrough

### app-explorer/CLAUDE.md — agent spec (port to `prompts/exploration.md`)

The reference's CLAUDE.md is an executable BFS spec written for a Claude agent. We port it verbatim with two substitutions: `revyl device tap --target ...` → `device_tap_by_description` (Phase 34 MCP tool); `app-explorer screen add ...` → `explore_save_screen` (in-process MCP tool defined in `server/explorations/internal/agent-tools.ts`). Cite-by-cite map:

- **`CLAUDE.md:1-23`** — Agent persona ("You systematically explore every screen…"). **Copy verbatim** as the prompt preamble.
- **`CLAUDE.md:36-65` Setup section** — initial screenshot, workspace init. **Adapt:** server pre-seeds the exploration row + first screenshot before invoking the agent, so the prompt opens at "Step 1" (already on the initial screen). Remove `app-explorer init` step (server owns it). Skip iOS skeleton extraction in v1 (deferred — agent reads optional `--seed-skeleton` from the run config and treats it as a hint, not a tool).
- **`CLAUDE.md:67-167` Exploration Algorithm** — five-step BFS loop. **Port faithfully:**
  - Step 1 "Capture and identify" → call `device_screenshot` (Phase 34 MCP) then `explore_save_screen({title, elements, notes})` (this phase's MCP tool). Server runs the pHash check inline before INSERT — if pHash matches an existing screen, the tool returns `{matched: existing_screen_id, isDuplicate: true}` and the agent skips the save (or records a back-edge).
  - Step 2 "Register the screen" → folded into Step 1's `explore_save_screen` call. Screenshot is auto-uploaded to artifacts and attached via `screenshot_artifact_id`.
  - Step 3 "Explore each element" → loop of `explore_get_unexplored()` → `device_tap_by_description({target})` → `device_screenshot` → branch on outcome A/B/C exactly as written.
  - Step 4 "Navigate back" → `device_key({code:'back'})` on Android; `device_swipe({…right-edge…})` on iOS. Both are existing Phase 34 envelopes.
  - Step 5 "Continue until done" → `explore_get_unexplored()`; when empty array AND no skeleton-unreached candidates remain → `explore_finish({reason:'complete'})`.
- **`CLAUDE.md:168-202` Edge Cases** — login walls, modals, scrolling, tabs, dead ends, **stuck detection**, app crash, screen cap. **Port verbatim with one tweak:** stuck detection is server-side (pHash sidecar emits `stuck` event after 3 consecutive same-screen taps) so the prompt only describes the agent's response ("you'll receive a `stuck` event — try a different element or back out"), not the detection mechanism.
- **`CLAUDE.md:203-216` Finishing Up** → agent calls `explore_finish({reason})`; server generates `report.md` automatically.
- **`CLAUDE.md:218-225` Rules** — "one action at a time, screenshot after every action, always pass --json, use descriptive --target". **Port verbatim.** These are the single most important behavioral guardrails — keep them in the system prompt as a final reminder block.

### app-explorer/app_explorer/models.py — Pydantic schema (port to Drizzle)

```python
# models.py:8-15
class Element(BaseModel):
    label: str
    element_type: str  # button, input, link, tab, list_item, icon
    explored: bool = False
    leads_to: str | None = None
    notes: str | None = None

# models.py:18-25
class Screen(BaseModel):
    screen_id: str
    title: str
    screenshot: str
    elements: list[Element] = Field(default_factory=list)
    notes: str | None = None

# models.py:28-32
class Transition(BaseModel):
    from_screen: str
    to_screen: str
    action: str
```

**Drizzle port (this phase):** Element becomes the `elements jsonb` column on `exploration_screens` (an array of element records; no separate table — element-level updates are rare and "explored" is a derived count not a query target). Screen + Transition each get their own table; see §Schema.

### app-explorer/app_explorer/store.py — JSON persistence (port to Drizzle helpers)

The reference uses a single `workspace/screen-map.json` flat file. Three operations we copy semantically:

- **`store.py:42-69` `add_screen()`** — idempotent upsert by `screen_id`. **Port to `server/explorations/internal/store.ts`:** `saveScreen(runId, screenId, fields)` does `INSERT … ON CONFLICT (run_id, screen_id) DO UPDATE SET …`. The CONFLICT comes from a UNIQUE (run_id, screen_id) index.
- **`store.py:72-81` `add_transition()`** — dedupes by `(from_screen, to_screen, action)`. **Port:** `saveTransition(runId, from, to, action)` does `INSERT … ON CONFLICT (run_id, from_screen_id, to_screen_id, action_hash) DO NOTHING`. `action_hash = sha256(JSON.stringify(action))` so equivalent action JSON dedupes cleanly.
- **`store.py:84-99` `get_unexplored_screens()`** — returns screens with `len([e for e in elements if not e.explored]) > 0`. **Port:** `getUnexplored(runId)` SQL using `jsonb_array_elements(elements) ↦ filter explored=false`. Returns array of `{screen_id, title, unexplored_elements:[label, type, ...]}`.

### app-explorer/app_explorer/cli.py — agent-facing CLI surface (NOT ported as CLI)

The reference's `app-explorer screen add` / `app-explorer screen list --unexplored` commands are how the BFS agent interacts with the store. **We DO NOT ship a TypeScript port of these as a CLI** — they become in-process MCP tools (next section). Reasoning: an MCP tool registered via `createSdkMcpServer` calls the same store helper directly, avoids one subprocess round-trip per action (200 actions × ~30ms = 6s saved per run), and gets typed errors via Zod instead of stdout parsing.

### app-explorer/app_explorer/report.py — Markdown + Mermaid (port verbatim)

```python
# report.py:16-32 _build_mermaid
def _build_mermaid(m: ScreenMap) -> str:
    lines = ["```mermaid", "graph TD"]
    for s in m.screens: lines.append(f'    {sid_safe(s.screen_id)}["{s.title}"]')
    for t in m.transitions: lines.append(f'    {sid_safe(t.from_screen)} --> |"{t.action}"| {sid_safe(t.to_screen)}')
    return "\n".join(lines)

# report.py:35-61 _enumerate_paths
def _enumerate_paths(m, max_paths=20):
    # Simple DFS from first screen, returns simple paths (no cycles)
```

**Port verbatim** to `server/explorations/internal/report.ts` as `buildMermaid(screens, transitions)` + `enumerateJourneys(screens, transitions, maxPaths=20)`. Both are ~30 LoC each.

### app-explorer/frontend/src/components/AtlasGraph.tsx — viz heart (port to Svelte 5)

This is the highest-fidelity reference component — 459 LoC of working BFS-aware xyflow + dagre layout. Cite-by-cite map for the Svelte port:

- **`AtlasGraph.tsx:22-40` `enumeratePaths`** — DFS simple-paths enumeration, capped at 20 paths from entry screen. **Port verbatim.** ScreenMap shape stays identical (`{screens, transitions, app_name, platform}`).
- **`AtlasGraph.tsx:44-47` Layout constants** — `NODE_WIDTH=175, NODE_HEIGHT=350, MARKER_WIDTH=160, MARKER_HEIGHT=50`. **Port verbatim.**
- **`AtlasGraph.tsx:53-79` BFS depth computation + tree-edge identification** — the load-bearing algorithm. From entry screen, BFS walks the adjacency map; every edge that discovers a NEW node is a tree edge (`treeEdges` Set keyed `"from->to"`). Every other transition is a back-edge or cross-edge. **Port verbatim.**
- **`AtlasGraph.tsx:85-89` Terminal screen detection** — screens with no outgoing transitions. **Port verbatim.**
- **`AtlasGraph.tsx:95-123` Dagre layout** — `new dagre.graphlib.Graph()`, `setGraph({rankdir:'TB', nodesep:100, ranksep:100, marginx:60, marginy:60})`, setNode for every screen + `__start__` + `__end_<id>__` markers, **setEdge ONLY for tree edges** + start→entry + terminal→__end. Then `dagre.layout(g)`. This is the BFS-aware twist: by feeding only tree edges to dagre we get a clean hierarchical layout; back-edges are drawn as dashed overlays after the fact and don't twist the rank assignment. **Port verbatim** — the `@xyflow/svelte` dagre example (https://svelteflow.dev/examples/layout/dagre) uses the same `dagre.graphlib.Graph` API.
- **`AtlasGraph.tsx:127-170` Node construction** — `screen` typed nodes (with `data: {label, screenshot, elementCount, notes, platform}`) + `startEnd` typed nodes. **Port verbatim** as Svelte components `ScreenNode.svelte` + `StartEndNode.svelte`.
- **`AtlasGraph.tsx:174-230` Edge construction with `is_back_edge` styling** — tree edges: solid `#9D61FF` strokeWidth 1.5; back edges: dashed `strokeDasharray: "6 4"`; terminal edges: dashed gray `#9ca3af`. Labels: `"smoothstep"` type, JetBrains Mono font, label-bg `#1f2937/0.9`. **Port verbatim** to Svelte `SvelteFlow` component (xyflow/svelte uses same prop shapes).
- **`AtlasGraph.tsx:246-441` Interactive shell** — fitView on mount, path-highlight selection, ScreenPanel + JourneyPanel coordination. **Port to Svelte 5 runes** (`$state`, `$derived`, `$effect`) — `useState/useMemo/useEffect` map straightforwardly. The `MutationObserver` for dark-mode detection (`AtlasGraph.tsx:258-266`) is unnecessary if we just use Tailwind's `dark:` variants in component styles (the reference inlines SVG fills because edge labels can't use Tailwind classes; xyflow/svelte has the same constraint — port the dark-mode detector).

### app-explorer/frontend/src/components/ScreenPanel.tsx — right rail (port to Svelte 5)

8.5K, 178 LoC. Three sections:
- **`ScreenPanel.tsx:48-74`** — header + screenshot with click-to-expand overlay. Port verbatim to Svelte; image-expanded state becomes `$state`.
- **`ScreenPanel.tsx:86-108`** — elements list (collapsed by default). Color-by-type map `elementTypeColors` ported verbatim.
- **`ScreenPanel.tsx:111-172`** — incoming/outgoing transition thumbnails. Click → `onNavigate(screenId)` callback up to AtlasGraph (Svelte: `let { onNavigate }: Props = $props()`).

### app-explorer/frontend/src/components/JourneyPanel.tsx — DFS path stepper (port to Svelte 5)

12.9K, 259 LoC. Two states:
- **List mode** (`JourneyPanel.tsx:98-163`) — cards for each enumerated path with start→end + via + length bar. Flow-type tag inference (`JourneyPanel.tsx:15-58` `getFlowTag`) uses regex matching against the path's screen titles. **Port verbatim** including the full regex rule list.
- **Stepper mode** (`JourneyPanel.tsx:166-256`) — path scrubber with prev/next + dot timeline + step-by-step listing. **Port verbatim** to Svelte 5.

### app-explorer/reports/exploration-report.md — sample report format

7.7K reference output. Sections: Summary table → Mermaid graph (`graph TD ... -->|"action"|...`) → Screen Inventory (one section per screen with screenshot + element list with explored/unexplored tags) → User Paths (DFS-enumerated, max 20) → Edge Cases table. **Port verbatim** as the `report.md` generator output.

## Schema

### Three Drizzle tables (migration `0010_explorations.sql`)

```typescript
// server/db/schema.ts append

export const explorationStatusEnum = pgEnum('exploration_status', [
  'queued',
  'running',
  'complete',
  'failed',
  'cancelled',
]);

export const explorations = pgTable('explorations', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  deviceId: uuid('device_id').notNull().references(() => devices.id),
  sessionId: uuid('session_id').notNull().references(() => sessions.id),  // Phase 34 FK
  appArtifactId: uuid('app_artifact_id').notNull().references(() => artifacts.id),
  bundleId: text('bundle_id').notNull(),
  platform: platformEnum('platform').notNull(),  // existing 'android'|'ios' enum
  status: explorationStatusEnum('status').notNull().default('queued'),
  startScreenId: text('start_screen_id'),  // populated after first screenshot lands

  budgetTaps: integer('budget_taps').notNull().default(200),
  budgetScreens: integer('budget_screens').notNull().default(60),
  budgetSeconds: integer('budget_seconds').notNull().default(1800),  // 30 min wall-clock

  config: jsonb('config').notNull(),    // {model, temperature, seedSkeletonId?, resolver?, prompt_overrides?}
  stats: jsonb('stats'),                // {taps_taken, screens_discovered, transitions_total, ...} updated as run progresses

  ownerApiKeyId: uuid('owner_api_key_id').references(() => apiKeys.id),
  ownerActor: varchar('owner_actor', { length: 255 }),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  errorMessage: text('error_message'),
}, (table) => [
  index('explorations_device_idx').on(table.deviceId),
  index('explorations_session_idx').on(table.sessionId),
  index('explorations_status_idx').on(table.status),
  index('explorations_owner_idx').on(table.ownerApiKeyId),
  index('explorations_created_idx').on(table.createdAt),
]);

export const explorationScreens = pgTable('exploration_screens', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  runId: uuid('run_id').notNull().references(() => explorations.id, { onDelete: 'cascade' }),
  screenId: text('screen_id').notNull(),               // agent-assigned kebab-case stable id (e.g. 'shop-tab')
  title: text('title').notNull(),
  screenshotArtifactId: uuid('screenshot_artifact_id').notNull().references(() => artifacts.id),
  phash: bytea('phash'),                                // 8 bytes (64-bit DCT hash)
  elements: jsonb('elements').notNull(),                // [{label, element_type, explored, leads_to?, notes?}]
  notes: text('notes'),
  bfsDepth: integer('bfs_depth').notNull().default(0),  // computed at save time; entry=0
  visitedAt: timestamp('visited_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('exploration_screens_run_screen_idx').on(table.runId, table.screenId),
  index('exploration_screens_phash_idx').on(table.phash),  // for similarity lookups
  index('exploration_screens_run_idx').on(table.runId),
]);

export const explorationTransitions = pgTable('exploration_transitions', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  runId: uuid('run_id').notNull().references(() => explorations.id, { onDelete: 'cascade' }),
  fromScreenId: text('from_screen_id').notNull(),
  toScreenId: text('to_screen_id').notNull(),
  action: jsonb('action').notNull(),                       // {kind:'tap', target?:string, x?:int, y?:int, ...}
  actionHash: varchar('action_hash', { length: 64 }).notNull(),  // sha256(stringify(action)) for dedup
  isBackEdge: boolean('is_back_edge').notNull().default(false),
  bfsOrder: integer('bfs_order').notNull(),                // 0..N — insertion order within the run
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('exploration_transitions_dedup_idx').on(
    table.runId, table.fromScreenId, table.toScreenId, table.actionHash,
  ),
  index('exploration_transitions_run_idx').on(table.runId),
  index('exploration_transitions_from_idx').on(table.runId, table.fromScreenId),
]);
```

**Notes:**
- `sessionId` FK ties the exploration to the Phase 34 session — when the session is released, the exploration is too (the agent runner releases on `finish`/`failed`/budget).
- `phash` stored as raw 8 bytes (not text) for fastest Hamming lookups; index lets similarity queries scan only this column.
- `bfsDepth` stored at save time (not derived) so the Atlas viz doesn't need to re-run BFS on every page load.
- `actionHash` is the dedup key — the agent might tap the same button twice (recursion-into-self); we don't want twin edges. `(run_id, from, to, action_hash)` partial-unique catches this at the DB layer.
- `bfsOrder` is monotonic insertion counter per run (start at 0, increment per transition save) — enables "replay the exploration in order" in the future without inferring from `createdAt` (which can collide at ms granularity).
- ON DELETE CASCADE so deleting an exploration cleans up screens + transitions (no orphaned rows when users delete old explorations).
- `bytea` column type comes from `drizzle-orm/pg-core`'s `customType` or `varbinary` shim — Drizzle's Postgres dialect supports `bytea` natively as of 0.30+; verify shape in Wave 0 (Open Question #1).

### Migration

```
server/db/migrations/0010_explorations.sql
```

Generate via `npx drizzle-kit generate` (NEVER hand-edit per CLI-02). Sequence follows Phase 34's `0009_sessions.sql`.

## REST Surface

### POST `/api/explorations` (start a run)

```typescript
const startRequestSchema = z.object({
  appArtifactId: z.string().uuid(),                       // pre-uploaded APK/IPA from existing /api/artifacts
  platform: z.enum(['android', 'ios']),
  bundleId: z.string().min(1),
  budgetTaps: z.number().int().min(10).max(2000).default(200),
  budgetScreens: z.number().int().min(5).max(500).default(60),
  budgetSeconds: z.number().int().min(60).max(7200).default(1800),
  seedSkeletonId: z.string().uuid().optional(),           // Phase 34 — iOS only
  model: z.enum(['claude-sonnet-4-5', 'claude-opus-4-7']).default('claude-sonnet-4-5'),
  metadata: z.record(z.string(), z.unknown()).optional(),
}).meta({ id: 'ExplorationStartRequest' });

const startResponseSchema = z.object({
  runId: z.string().uuid(),
  sessionId: z.string().uuid(),                           // lease created server-side
  deviceId: z.string().uuid(),
  agentLogStreamUrl: z.string().url(),                    // wss://.../api/explorations/<id>/events
  estimatedDurationMin: z.number().int(),                 // computed from budgetScreens × ~30s/screen
}).meta({ id: 'ExplorationStartResponse' });
```

**Semantics:**
1. `requireAuth` preHandler (copy from `server/jobs/internal/routes.ts:87-104` — same chain as Phase 34).
2. Server-side lease a session via `fastify.sessionsModule.lease({platform, ttlSeconds: budgetSeconds + 60})` (Phase 34 API — pool allocator handles device).
3. Install + launch the app via Phase 34 session WS: `{type:'installApp', artifactId}` then `{type:'launchApp', bundleId}`.
4. Capture the initial screenshot (`{type:'screenshot'}`); save as the entry-screen artifact.
5. INSERT exploration row (status `queued`); emit `exploration.started` (persisted).
6. Enqueue `exploration.run` queue with `{runId}` payload + `singletonKey: runId`. The pg-boss worker handler invokes `agent-runner.ts:runExploration(runId)`.
7. Return immediately with `runId` + WS URL (client subscribes to events).

### GET `/api/explorations/:id`

```typescript
const getResponseSchema = z.object({
  exploration: explorationRowSchema,
  screens: z.array(explorationScreenRowSchema),
  transitions: z.array(explorationTransitionRowSchema),
}).meta({ id: 'ExplorationGetResponse' });
```

Returns the full graph for the web UI to render. Web `+page.ts` loader hits this on navigation; AtlasGraph re-renders when WS events update the in-memory store.

### GET `/api/explorations/:id/report.md`

Returns Markdown + Mermaid (text/markdown). Streamed on-demand from the report generator (see §Reports).

### DELETE `/api/explorations/:id`

Soft-delete (status='cancelled' if running; row stays for audit). If the run is active, sends a `cancel` signal to the agent runner (sets `status='cancelled'`, watchdog observes on next tick and tears down).

## Agent Runner

### `prompts/exploration.md` — agent system prompt (NEW file)

Port of `_reference/app-explorer/CLAUDE.md` with substitutions:

```markdown
# App Explorer Agent

You systematically explore every screen and user path in a mobile app
using breadth-first search.

## Your tools (MCP)

### Device control (via @device-stream/mcp — Phase 34)
- `device_screenshot({sessionId})` → returns `{artifactId, url, width, height}` + inline base64 image
- `device_tap({sessionId, x, y})` / `device_tap_by_description({sessionId, target})`
- `device_type({sessionId, text})`
- `device_swipe({sessionId, x1,y1,x2,y2})`
- `device_key({sessionId, code: 'back'|'home'|...})`
- `device_launch({sessionId, bundleId})`  -- in case the app crashes

### Exploration state (this run)
- `explore_save_screen({title, elements, notes?})` → `{screen_id, isDuplicate, matched?}`
  - Server runs pHash. If the new screenshot matches an existing one, `isDuplicate=true`
    and the agent should NOT re-explore — record a back-edge instead.
- `explore_save_transition({from, to, action, isBackEdge?})` → `{ok}`
- `explore_mark_element_explored({screen_id, element_label, leads_to?})` → `{ok}`
- `explore_get_unexplored()` → `[{screen_id, title, unexplored_elements:[label, type]}]`
- `explore_finish({reason: 'complete'|'budget'|'stuck'|'login_required', message?})`

## Algorithm

[port CLAUDE.md:67-216 verbatim with the substitutions above]

## Stop conditions

You will receive a `stuck` event from the harness if 3 consecutive taps
don't change the screen. When you do: back out (`device_key code:back`)
and try a DIFFERENT unexplored element.

You will receive a `budget` event when budgetTaps or budgetScreens is
reached. Call `explore_finish` immediately.

## Rules

[port CLAUDE.md:218-225 verbatim]
```

Stored at `prompts/exploration.md` (new top-level directory). Loaded at agent-runner startup, not inlined into TS — keeps the prompt editable without TS recompile.

### `agent-runner.ts` — invokes Claude Agent SDK

```typescript
// server/explorations/internal/agent-runner.ts
import { query, tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { readFile } from 'node:fs/promises';

export async function runExploration(
  runId: string,
  deps: { db, sessionsModule, bus, logger, fileSystem, artifactsModule, sessionToken: string },
): Promise<void> {
  const run = await deps.db.query.explorations.findFirst({ where: eq(explorations.id, runId) });
  if (!run) throw new Error(`Exploration ${runId} not found`);

  // Build in-process MCP server for the four exploration tools.
  const explorationServer = createSdkMcpServer({
    name: 'exploration-state',
    version: '1.0.0',
    tools: buildExplorationTools(runId, deps),  // see below
  });

  const systemPrompt = await readFile('prompts/exploration.md', 'utf-8');

  // Cancellation + budget watchdog runs alongside.
  const watchdog = startWatchdog(runId, deps);

  try {
    const q = query({
      prompt: buildInitialPrompt(run),
      options: {
        model: run.config.model,
        systemPrompt: systemPrompt,
        mcpServers: {
          'exploration-state': explorationServer,
          // Phase 34's @device-stream/mcp is an EXTERNAL (stdio) MCP server — we
          // launch it as a child process configured with the sessionId+token so the
          // agent can talk to the device. Per platform.claude.com/docs MCP config:
          'device-stream': {
            type: 'stdio',
            command: 'npx',
            args: ['@device-stream/mcp'],
            env: {
              DEVICE_FARM_URL: deps.serverUrl,
              DEVICE_FARM_TOKEN: deps.sessionToken,
              DEVICE_FARM_SESSION_ID: run.sessionId,
            },
          },
        },
        allowedTools: [
          // device-stream tools (auto-approved)
          'device_screenshot', 'device_tap', 'device_tap_by_description',
          'device_type', 'device_swipe', 'device_key', 'device_launch',
          // exploration tools (auto-approved)
          'explore_save_screen', 'explore_save_transition',
          'explore_mark_element_explored', 'explore_get_unexplored',
          'explore_finish',
        ],
        permissionMode: 'default',
        maxTurns: run.budgetTaps * 3,  // each tap is ~2-3 turns (screenshot + classify + tap)
      },
    });

    for await (const msg of q) {
      // Stream every assistant + tool-call message to the WS broadcaster
      // (one envelope per turn). See §WS Event Stream.
      await broadcastAgentMessage(runId, msg, deps);

      // If budget exhausted or cancel requested, abort.
      if (watchdog.shouldStop()) {
        q.return?.();
        break;
      }
    }

    await finalizeRun(runId, watchdog.exitReason(), deps);
  } finally {
    watchdog.dispose();
  }
}
```

**Source:** Claude Agent SDK API per official docs at `code.claude.com/docs/en/agent-sdk/typescript` — `query({prompt, options:{mcpServers, allowedTools, permissionMode, maxTurns}})` returns `AsyncGenerator<SDKMessage>`. `createSdkMcpServer({name, version, tools})` wraps in-process tools defined via `tool(name, description, zodSchema, handler)`. `mcpServers` can mix in-process (SdkMcpServerConfig) and external (stdio) servers in one config.

### Exploration MCP tools (`buildExplorationTools`)

```typescript
function buildExplorationTools(runId: string, deps: Deps) {
  return [
    tool(
      'explore_save_screen',
      'Save a newly-discovered screen with its title, screenshot (auto-resolved from the most recent device_screenshot call), and interactive elements. Returns isDuplicate=true if pHash matches an existing screen.',
      {
        title: z.string().min(1).max(200),
        elements: z.array(z.object({
          label: z.string(),
          element_type: z.enum(['button', 'input', 'link', 'tab', 'list_item', 'icon', 'text']),
          notes: z.string().optional(),
        })),
        notes: z.string().optional(),
        screenshot_artifact_id: z.string().uuid(),  // returned by previous device_screenshot
      },
      async ({ title, elements, notes, screenshot_artifact_id }) => {
        const screenshotBuf = await deps.artifactsModule.readBuffer(screenshot_artifact_id);
        const { phash } = await computePhash(screenshotBuf);
        const existing = await findSimilarScreen(deps.db, runId, phash, screenshotBuf);
        if (existing) {
          return {
            content: [{ type: 'text', text: `Duplicate of ${existing.screenId}` }],
            structuredContent: { screen_id: existing.screenId, isDuplicate: true, matched: existing.screenId },
          };
        }
        const screenId = slugify(title);
        await deps.db.insert(explorationScreens).values({
          runId, screenId, title, elements, notes, phash,
          screenshotArtifactId: screenshot_artifact_id,
          bfsDepth: await computeBfsDepth(deps.db, runId, /* current parent */),
        }).onConflictDoUpdate({ ... });
        await deps.bus.emit('exploration.screen.discovered', { runId, screenId, title });
        return {
          content: [{ type: 'text', text: `Saved screen "${title}" as ${screenId}` }],
          structuredContent: { screen_id: screenId, isDuplicate: false },
        };
      },
    ),
    tool('explore_save_transition', 'Record a navigation edge', /* ... */),
    tool('explore_mark_element_explored', 'Mark an element on a screen as explored', /* ... */),
    tool('explore_get_unexplored', 'Return screens with unexplored elements', /* zod schema */, async () => {
      const rows = await deps.db.execute(sql`
        SELECT screen_id, title,
               jsonb_agg(elem) FILTER (WHERE NOT (elem->>'explored')::bool) AS unexplored
        FROM exploration_screens, jsonb_array_elements(elements) elem
        WHERE run_id = ${runId}
        GROUP BY screen_id, title
        HAVING COUNT(*) FILTER (WHERE NOT (elem->>'explored')::bool) > 0
      `);
      return { content: [{ type: 'text', text: JSON.stringify(rows) }], structuredContent: { screens: rows } };
    }),
    tool('explore_finish', 'Mark the exploration complete', /* ... */),
  ];
}
```

**Why in-process MCP and not subprocess:** the Claude Agent SDK supports both in one config (see official docs); in-process tools avoid stdio framing latency (~30ms per call × 200 actions = 6s saved); typing flows through Zod directly into the handler; errors surface as native Error throws instead of JSON-RPC parse failures.

### Initial prompt

```
You are exploring the app "<run.bundleId>" on <platform>. Your sessionId is
<run.sessionId>. The app has been launched and is on its initial screen.

Budget: max <run.budgetTaps> taps, <run.budgetScreens> screens,
<run.budgetSeconds>s wall-clock.

Start by calling device_screenshot to see the current screen, then begin BFS
exploration per your instructions.
```

## Loop / Stuck Detection

### `similarity.ts` — inline pHash + RMSE

```typescript
// server/explorations/internal/similarity.ts
import sharp from 'sharp';
import sharpPhash from 'sharp-phash';
import sharpPhashDistance from 'sharp-phash/distance';

const PHASH_THRESHOLD = 8;     // Hamming distance — see brief T-35.3
const RMSE_THRESHOLD = 0.02;   // 64x64 grayscale per-pixel RMSE

export async function computePhash(buf: Buffer): Promise<{ phash: string; phashBuffer: Buffer }> {
  // sharp-phash returns a 64-character "0"/"1" string. We persist it as a
  // packed 8-byte buffer for compact storage; comparisons use the string form.
  const hashStr = await sharpPhash(buf);  // "0010110100..." length 64
  const phashBuffer = packBitstringToBuffer(hashStr);   // 8 bytes
  return { phash: hashStr, phashBuffer };
}

export function hammingDistance(a: string, b: string): number {
  return sharpPhashDistance(a, b);
}

export async function grayscaleRmse(bufA: Buffer, bufB: Buffer): Promise<number> {
  const [pixA, pixB] = await Promise.all([
    sharp(bufA).resize(64, 64, { fit: 'fill' }).grayscale().raw().toBuffer(),
    sharp(bufB).resize(64, 64, { fit: 'fill' }).grayscale().raw().toBuffer(),
  ]);
  let sumSq = 0;
  for (let i = 0; i < pixA.length; i++) {
    const d = (pixA[i] - pixB[i]) / 255;
    sumSq += d * d;
  }
  return Math.sqrt(sumSq / pixA.length);
}

export async function isSameScreen(
  newShot: Buffer,
  candidates: Array<{ screenId: string; phash: string; screenshotArtifactId: string }>,
  loadArtifact: (id: string) => Promise<Buffer>,
): Promise<{ screenId: string; rmse: number } | null> {
  const { phash } = await computePhash(newShot);
  const closeOnes = candidates.filter((c) => hammingDistance(phash, c.phash) < PHASH_THRESHOLD);
  if (closeOnes.length === 0) return null;
  for (const c of closeOnes) {
    const candidateBuf = await loadArtifact(c.screenshotArtifactId);
    const rmse = await grayscaleRmse(newShot, candidateBuf);
    if (rmse < RMSE_THRESHOLD) return { screenId: c.screenId, rmse };
  }
  return null;
}
```

**Source:** `sharp-phash` README at https://github.com/btd/sharp-phash — `phash(buffer): Promise<string>` returns 64-char binary string; `sharp-phash/distance(a, b): number` is the Hamming distance. `sharp` already a transitive dep (`appium-ios-simulator → @appium/support`), so no new install in the runtime tree (but declare it as a direct dependency in Wave 0 to make the dep explicit).

### Stuck detection

```typescript
// server/explorations/internal/stuck-detector.ts
export class StuckDetector {
  private recentPhashes: string[] = [];
  private readonly windowSize = 3;
  private readonly threshold = 8;

  observe(phash: string): { stuck: boolean; reason?: string } {
    this.recentPhashes.push(phash);
    if (this.recentPhashes.length > this.windowSize) this.recentPhashes.shift();
    if (this.recentPhashes.length === this.windowSize) {
      // All three within Hamming threshold of the first?
      const allSame = this.recentPhashes.every((p) =>
        hammingDistance(p, this.recentPhashes[0]) < this.threshold);
      if (allSame) return { stuck: true, reason: '3 consecutive taps without screen change' };
    }
    return { stuck: false };
  }

  reset() { this.recentPhashes = []; }
}
```

Server-side: every `device_screenshot` call from the agent runs through the StuckDetector (via a hook on the device-stream MCP forwarding layer, OR via a post-screenshot tap-counter). On stuck → emit `exploration.stuck` event over the WS broadcaster + inject a system message into the agent stream telling it to back out.

**Realization:** the simplest hook point is inside `explore_save_screen` — since we already pHash there, we can detect "the agent saved/re-saw the same pHash 3 times in a row" without intercepting the device-stream MCP. This keeps the in-process MCP layer pure.

## WS Event Stream

### Event envelopes

```typescript
// server/explorations/events.ts (Zod registry pattern from server/jobs/events.ts)
export const explorationScreenDiscoveredPayload = z.object({
  runId: z.string().uuid(),
  screenId: z.string(),
  title: z.string(),
  bfsDepth: z.number().int(),
  screenshotUrl: z.string().url(),
});

export const explorationTransitionPayload = z.object({
  runId: z.string().uuid(),
  fromScreenId: z.string(),
  toScreenId: z.string(),
  action: z.record(z.string(), z.unknown()),
  isBackEdge: z.boolean(),
});

export const explorationStuckPayload = z.object({
  runId: z.string().uuid(),
  screenId: z.string(),
  consecutive: z.number().int(),
});

export const explorationToolCallPayload = z.object({
  runId: z.string().uuid(),
  name: z.string(),
  args: z.record(z.string(), z.unknown()),
  durationMs: z.number().int().nonnegative(),
});

export const explorationFinishedPayload = z.object({
  runId: z.string().uuid(),
  reason: z.enum(['complete', 'budget', 'stuck', 'login_required', 'cancelled']),
  stats: z.object({
    screensDiscovered: z.number().int(),
    transitionsTotal: z.number().int(),
    tapsTaken: z.number().int(),
    durationMs: z.number().int(),
  }),
});

export const explorationErrorPayload = z.object({
  runId: z.string().uuid(),
  message: z.string(),
});

export const EXPLORATION_EVENT_NAMES = {
  STARTED: 'exploration.started',                          // persisted
  SCREEN_DISCOVERED: 'exploration.screen.discovered',      // transient (high-frequency)
  TRANSITION: 'exploration.transition.recorded',           // transient
  STUCK: 'exploration.stuck',                              // persisted (audit-notable)
  TOOL_CALL: 'exploration.tool.called',                    // transient
  FINISHED: 'exploration.finished',                        // persisted (terminal)
  FAILED: 'exploration.failed',                            // persisted (terminal)
} as const;
```

### Broadcaster

Per-run in-memory broadcaster (mirror `server/streaming/job-broadcaster.ts`) with last-200 history replay on WS reconnect. Same pattern Phase 22 streaming established: `Map<runId, BroadcasterState>`, FlushQueue + heartbeat + auto-close on lease release.

WS route: `GET /api/explorations/:id/events` (upgrade with `?token=<bearer>`). Frame shape:

```json
{"type":"screen-discovered","ts":"2026-05-15T...","data":{...}}
{"type":"transition","ts":"...","data":{...}}
{"type":"tool-call","ts":"...","data":{"name":"device_tap","args":{...},"durationMs":342}}
{"type":"stuck","ts":"...","data":{...}}
{"type":"finished","ts":"...","data":{"reason":"complete","stats":{...}}}
{"type":"error","ts":"...","data":{"message":"..."}}
```

### Subscriber wiring

The agent-runner subscribes to its own bus emissions and forwards them to the broadcaster:

```typescript
explorationsModule.bus.on('exploration.screen.discovered', (env) => {
  broadcaster.publish(env.payload.runId, { type: 'screen-discovered', ts: env.occurredAt, data: env.payload });
});
// ... and so on for each event
```

Same pattern as `server/streaming` consuming jobs events.

## CLI

### `cli/cmd/explore.go`

```go
var exploreCmd = &cobra.Command{
    Use:   "explore",
    Short: "Run a Claude-driven BFS exploration of an app, building a navigation graph + Atlas viz",
    Long: `Uploads the APK/IPA to device-farm, leases a device, then runs a Claude agent
that systematically taps every screen and persists the result as an interactive
graph viewable at /explorations/<id>.

Examples:
  device-farm explore --apk myapp.apk --platform android
  device-farm explore --apk myapp.apk --budget-screens 80 --json
  device-farm explore --apk myapp.ipa --seed-skeleton <id> --model claude-opus-4-7`,
    RunE: runExplore,
}

func init() {
    rootCmd.AddCommand(exploreCmd)
    exploreCmd.Flags().StringVar(&exploreApk, "apk", "", "Path to APK/IPA")
    exploreCmd.Flags().StringVar(&exploreBundleId, "bundle-id", "", "Bundle ID (auto-detected if omitted)")
    exploreCmd.Flags().StringVar(&explorePlatform, "platform", "android", "android|ios")
    exploreCmd.Flags().IntVar(&exploreBudgetTaps, "budget-taps", 200, "")
    exploreCmd.Flags().IntVar(&exploreBudgetScreens, "budget-screens", 60, "")
    exploreCmd.Flags().IntVar(&exploreBudgetSeconds, "budget-seconds", 1800, "")
    exploreCmd.Flags().StringVar(&exploreSeedSkeletonId, "seed-skeleton", "", "Optional Phase 34 skeleton ID")
    exploreCmd.Flags().StringVar(&exploreModel, "model", "claude-sonnet-4-5", "")
    exploreCmd.Flags().BoolVar(&exploreJSON, "json", false, "Emit JSON events on stdout")
}

func runExplore(cmd *cobra.Command, args []string) error {
    // 1. Upload APK via existing POST /api/artifacts (multipart) — same path as `device-farm run`
    artifactId, err := uploadArtifact(exploreApk, explorePlatform)
    // 2. POST /api/explorations
    resp, err := startExploration(StartReq{
        AppArtifactId: artifactId,
        Platform: explorePlatform,
        // ... budget flags
    })
    // 3. Open WS to resp.AgentLogStreamUrl using gorilla/websocket (same as `device-farm logs`).
    // 4. Stream events to stdout in JSON or human-readable form.
    // 5. Exit 0 when {type:'finished', reason:'complete'}; non-zero on 'failed' or 'cancelled'.
}
```

**Pattern source:** mirrors `cli/cmd/run.go` (multipart upload + WS log streaming) and `cli/cmd/status.go` (deviceName join). Reuses `cli/internal/types/generated.go` once Phase 35's `ExplorationStartRequest` lands in openapi.json via the existing CLI-01 codegen pipeline.

## Web UI

### Dependencies (Wave 0)

Add to `web/package.json`:
```json
"dependencies": {
  "@xyflow/svelte": "^1",
  "@dagrejs/dagre": "^1"
}
```

(Note: package is `@dagrejs/dagre`, NOT the legacy `dagre` — the official xyflow Svelte example uses `@dagrejs/dagre`. Verify in Wave 0.)

### Route structure

```
web/src/routes/explorations/
├── +page.svelte                     # list view (table of recent runs)
├── +page.ts                         # loader: GET /api/explorations
└── [id]/
    ├── +page.svelte                 # AtlasGraph + sidepanels
    └── +page.ts                     # loader: GET /api/explorations/:id
```

### `AtlasGraph.svelte` — Svelte 5 port

```svelte
<script lang="ts">
  import dagre from '@dagrejs/dagre';
  import {
    SvelteFlow, Background, Controls, ConnectionLineType, Position,
    type Node, type Edge,
  } from '@xyflow/svelte';
  import '@xyflow/svelte/dist/style.css';
  import ScreenNode from './ScreenNode.svelte';
  import StartEndNode from './StartEndNode.svelte';
  import ScreenPanel from './ScreenPanel.svelte';
  import JourneyPanel from './JourneyPanel.svelte';
  import type { ScreenMap } from './atlas-types';

  let { screenMap, screenshotBase }: { screenMap: ScreenMap; screenshotBase: string } = $props();

  const NODE_WIDTH = 175;
  const NODE_HEIGHT = 350;

  // BFS-aware layout — port verbatim from AtlasGraph.tsx:53-233
  function layoutGraph(map: ScreenMap): { nodes: Node[]; edges: Edge[] } {
    if (!map.screens.length) return { nodes: [], edges: [] };
    // ... port AtlasGraph.tsx:53-79 BFS depth + tree-edge identification
    // ... port AtlasGraph.tsx:95-123 dagre layout (tree edges only)
    // ... port AtlasGraph.tsx:127-230 node + edge construction
  }

  const layouted = $derived(layoutGraph(screenMap));
  let nodes = $state.raw<Node[]>(layouted.nodes);
  let edges = $state.raw<Edge[]>(layouted.edges);

  $effect(() => {
    // Re-layout when screenMap changes (WS events push new screens/transitions live)
    const next = layoutGraph(screenMap);
    nodes = next.nodes;
    edges = next.edges;
  });

  const nodeTypes = { screen: ScreenNode, startEnd: StartEndNode };

  let activeScreenId = $state<string | null>(null);
  let selectedPathIdx = $state<number | null>(null);
  let stepIndex = $state(0);

  const paths = $derived(enumeratePaths(screenMap));
  // ... port path-highlighting + click handlers
</script>

<div class="flex w-full h-full">
  <JourneyPanel {screenMap} {paths} {selectedPathIdx} {stepIndex}
    onSelectPath={(i) => { selectedPathIdx = i; stepIndex = 0; }}
    onClearPath={() => { selectedPathIdx = null; }}
    onGoToStep={(i) => { stepIndex = i; }}
  />
  <div class="flex-1 relative">
    <SvelteFlow bind:nodes bind:edges fitView
      {nodeTypes}
      connectionLineType={ConnectionLineType.SmoothStep}
      onnodeclick={(e) => { if (!e.detail.node.id.startsWith('__')) activeScreenId = e.detail.node.id; }}
    >
      <Background />
      <Controls />
    </SvelteFlow>
  </div>
  {#if activeScreenId}
    <ScreenPanel
      screen={screenMap.screens.find((s) => s.screen_id === activeScreenId)!}
      {screenMap} {screenshotBase}
      onNavigate={(id) => { activeScreenId = id; }}
      onClose={() => { activeScreenId = null; }}
    />
  {/if}
</div>
```

**Source for SvelteFlow+dagre integration:** official Svelte Flow Dagre example at https://svelteflow.dev/examples/layout/dagre — uses `dagre.graphlib.Graph`, `setGraph({rankdir})`, `setNode/setEdge`, `dagre.layout(g)` — identical API to the React reference. `$state.raw<Node[]>` is the Svelte 5 idiom for "this is a large array, don't deep-track it."

### `ScreenNode.svelte` / `StartEndNode.svelte`

Direct port of `_reference/.../ScreenNode.tsx` (72 LoC) and `StartEndNode.tsx`. Use `Handle` from `@xyflow/svelte` (same prop shape). Tailwind classes port 1:1.

### `ScreenPanel.svelte`

Port of `_reference/.../ScreenPanel.tsx` (178 LoC). `useState` → `$state`. Click-to-expand image overlay, elements-list collapsible, incoming/outgoing transition thumbnails clickable. No new dependencies.

### `JourneyPanel.svelte`

Port of `_reference/.../JourneyPanel.tsx` (259 LoC). The `getFlowTag` regex inference (lines 15-58) ports verbatim — domain-agnostic flow categorization (auth/payment/checkout/etc.) is useful for any app and costs nothing.

### Live updates

The `[id]/+page.svelte` opens a WS to `/api/explorations/:id/events` on mount and merges incoming events into a local `$state` `screenMap`:

```ts
const ws = new WebSocket(wsUrl);
ws.addEventListener('message', (e) => {
  const msg = JSON.parse(e.data);
  if (msg.type === 'screen-discovered') {
    screenMap.screens = [...screenMap.screens, msg.data];
  } else if (msg.type === 'transition') {
    screenMap.transitions = [...screenMap.transitions, msg.data];
  }
  // ...
});
```

AtlasGraph's `$effect` re-runs `layoutGraph` on every update — dagre is fast enough at this size (60-screen cap × 200-edge cap) that re-layout per event is fine.

## Reports

### `server/explorations/internal/report.ts`

```typescript
import type { ExplorationScreen, ExplorationTransition } from '../schemas.js';

export function buildMermaid(screens: ExplorationScreen[], transitions: ExplorationTransition[]): string {
  if (transitions.length === 0) return '';
  const lines = ['```mermaid', 'graph TD'];
  const titles = new Map(screens.map((s) => [s.screenId, s.title]));
  const seen = new Set<string>();
  for (const t of transitions) {
    for (const sid of [t.fromScreenId, t.toScreenId]) {
      if (!seen.has(sid)) {
        const label = titles.get(sid) ?? sid;
        lines.push(`    ${sidSafe(sid)}["${label}"]`);
        seen.add(sid);
      }
    }
  }
  for (const t of transitions) {
    const action = describeAction(t.action).replace(/"/g, "'");
    lines.push(`    ${sidSafe(t.fromScreenId)} --> |"${action}"| ${sidSafe(t.toScreenId)}`);
  }
  lines.push('```');
  return lines.join('\n');
}

export function enumerateJourneys(
  screens: ExplorationScreen[], transitions: ExplorationTransition[], maxPaths = 20,
): string[][] {
  // Port _reference/.../report.py:35-61 DFS verbatim
}

export function buildReport(run: Exploration, screens: ExplorationScreen[], transitions: ExplorationTransition[]): string {
  // Port report.py:64-151 verbatim:
  // - H1 with app name
  // - Summary table (Screens / Transitions / Elements / Coverage %)
  // - Mermaid graph
  // - Screen inventory (one section per screen with screenshot link + elements list)
  // - User Paths (DFS-enumerated)
  // - Edge Cases (screens with notes)
}
```

Route handler:

```typescript
fastify.get('/api/explorations/:id/report.md', async (req, reply) => {
  const id = req.params.id;
  const [run, screens, transitions] = await Promise.all([
    db.query.explorations.findFirst({ where: eq(explorations.id, id) }),
    db.query.explorationScreens.findMany({ where: eq(explorationScreens.runId, id) }),
    db.query.explorationTransitions.findMany({ where: eq(explorationTransitions.runId, id) }),
  ]);
  if (!run) return reply.code(404).send({ error: 'not_found' });
  reply.type('text/markdown');
  return buildReport(run, screens, transitions);
});
```

Format match exists at `_reference/app-explorer/reports/exploration-report.md` for visual reference.

## Budget Caps

Three caps, enforced server-side (NOT trusted to the agent):

| Cap | Default | Where enforced |
|-----|---------|----------------|
| `budgetTaps` | 200 | Tap counter incremented inside `device_tap` / `device_tap_by_description` interception in the broadcaster; on overflow → publish `budget` event + cancel agent (`q.return()`) |
| `budgetScreens` | 60 | `explore_save_screen` returns `{error: 'budget_exceeded'}` once `COUNT(*) FROM exploration_screens WHERE run_id = ?` ≥ cap; agent must call `explore_finish({reason:'budget'})` |
| `budgetSeconds` | 1800 (30 min) | Watchdog `setTimeout` fired at run start; on fire → cancel agent + mark `status='cancelled'` |

The watchdog (`server/explorations/internal/watchdog.ts`) is a small class:

```typescript
export class Watchdog {
  private timeout: NodeJS.Timeout;
  private exitReasonValue: 'complete' | 'budget' | 'time' | 'cancelled' | null = null;
  constructor(private runId: string, private budgetSeconds: number, private onTrigger: (reason: string) => void) {
    this.timeout = setTimeout(() => { this.exitReasonValue = 'time'; this.onTrigger('budgetSeconds exhausted'); }, budgetSeconds * 1000);
  }
  shouldStop(): boolean { return this.exitReasonValue !== null; }
  exitReason() { return this.exitReasonValue ?? 'complete'; }
  cancel() { this.exitReasonValue = 'cancelled'; this.onTrigger('user cancellation'); }
  dispose() { clearTimeout(this.timeout); }
}
```

Tap counter lives in the broadcaster (single source of truth — every tool-call event already flows through it).

## Test Strategy

Tests-as-spec convention (MOD-04 closed in Phase 30) — `*.spec.ts` per behavior.

| Spec file | Proves |
|-----------|--------|
| `server/explorations/__tests__/routes.spec.ts` | POST creates row + leases session + enqueues `exploration.run`; GET returns full graph |
| `server/explorations/__tests__/similarity.spec.ts` | `computePhash` returns 64-bit hash; identical buffer → distance 0; 2 distinct screenshots → distance > 8; RMSE crossover works |
| `server/explorations/__tests__/stuck-detector.spec.ts` | 3 identical pHashes in window → `{stuck:true}`; 3 different → `{stuck:false}`; reset clears state |
| `server/explorations/__tests__/store.spec.ts` | `saveScreen` upserts idempotently; `saveTransition` dedupes by `(run, from, to, actionHash)`; `getUnexplored` returns screens with `explored=false` elements |
| `server/explorations/__tests__/agent-tools.spec.ts` | Mock Claude SDK; each MCP tool input schema validates; `explore_save_screen` calls store + emits event |
| `server/explorations/__tests__/budget.spec.ts` | Tap counter trips at `budgetTaps + 1` → watchdog signals stop; screen-cap returns `budget_exceeded` from `explore_save_screen` |
| `server/explorations/__tests__/watchdog.spec.ts` | Timer fires after `budgetSeconds`; cancel() short-circuits |
| `server/explorations/__tests__/report.spec.ts` | Mermaid graph deterministic for fixture map; DFS enumeration matches snapshot |
| `server/explorations/__tests__/events.spec.ts` | EVENTS-03 dotted-past-tense names; TRACE-08 persistence flags correct |
| `server/explorations/__tests__/ws-broadcaster.spec.ts` | History replay last 200 events; reconnect resumes; heartbeat 30s |
| `server/explorations/__tests__/e2e.spec.ts` (gated `DEVICE_FARM_E2E=1`) | Run sample APK (Wikipedia Android — F-Droid pick) end-to-end; assert ≥ 10 screens discovered + report.md generates |
| `web/src/lib/components/atlas/__tests__/layout.spec.ts` | `layoutGraph` produces tree-edges-only dagre + back-edges as dashed edges; entry node first |
| `cli/cmd/explore_test.go` | Cobra flag parsing; mock server happy path returns exit 0; budget error returns exit 1 |

### Real-device E2E

`DEVICE_FARM_E2E=1` + an actual emulator. Run against Wikipedia for Android (open-source, stable, 20+ screens). Assert:
- `screensDiscovered >= 10`
- `transitions_total >= screensDiscovered - 1` (BFS minimum)
- Status `complete` (not `budget` — Wikipedia fits in default budget)
- Report.md exists and parses as valid Markdown

Note: the agent SDK call is the only non-deterministic piece. Use deterministic prompt + low temperature + recorded sample-APK to keep CI flakes minimal. If too flaky, gate behind a nightly job, not per-PR.

## Validation Architecture

> nyquist_validation enabled per `.planning/config.json` (`workflow.nyquist_validation: true`).

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.0+ (server) / Go testing (cli) / Svelte-check + Playwright (web — Phase 29 harness) |
| Config file | `vitest.config.ts` (root) — pattern `server/**/*.spec.ts` |
| Quick run command | `npx vitest run server/explorations` |
| Full suite command | `npm test && cd cli && make test && cd web && npm run check` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| EXP-SCHEMA | Drizzle migration applies clean; FK + uniqueIndex shape | DB-gated integration | `npx vitest run server/explorations/__tests__/store.spec.ts -t "migration"` | Wave 0 |
| EXP-SCHEMA | Cascade delete clears screens + transitions | DB-gated integration | `npx vitest run server/explorations/__tests__/store.spec.ts -t "cascade"` | Wave 0 |
| EXP-AGENT | Agent SDK invoked with correct mcpServers config; in-process tools registered | unit (mocked SDK) | `npx vitest run server/explorations/__tests__/agent-runner.spec.ts` | Wave 0 |
| EXP-AGENT | `prompts/exploration.md` loaded + injected as system prompt | unit | `npx vitest run server/explorations/__tests__/prompts.spec.ts` | Wave 0 |
| EXP-LOOP | `computePhash` deterministic for fixture PNG | unit | `npx vitest run server/explorations/__tests__/similarity.spec.ts -t "phash"` | Wave 0 |
| EXP-LOOP | Hamming + RMSE both below threshold → match; one above → no match | unit | `npx vitest run server/explorations/__tests__/similarity.spec.ts -t "isSameScreen"` | Wave 0 |
| EXP-LOOP | StuckDetector signals on 3 consecutive close pHashes | unit | `npx vitest run server/explorations/__tests__/stuck-detector.spec.ts` | Wave 0 |
| EXP-WS | WS frame discriminated union parses every event type | unit | `npx vitest run server/explorations/__tests__/ws-broadcaster.spec.ts -t "envelope"` | Wave 0 |
| EXP-WS | Reconnect replays last 200 events; heartbeat 30s | integration | `npx vitest run server/explorations/__tests__/ws-broadcaster.spec.ts -t "replay"` | Wave 0 |
| EXP-CLI | `device-farm explore --apk <fixture>` → exit 0 on `finished{reason:complete}` | go test | `cd cli && go test ./cmd -run TestExploreHappy` | Wave 0 |
| EXP-CLI | `device-farm explore` non-zero on `failed` | go test | `cd cli && go test ./cmd -run TestExploreFailExit` | Wave 0 |
| EXP-UI | `layoutGraph` produces tree-edges-only dagre layout | unit | `cd web && npx vitest run src/lib/components/atlas` | Wave 0 |
| EXP-UI | Click node → ScreenPanel renders; click incoming/outgoing thumb → navigate | Playwright | `cd web && npx playwright test explorations-detail` | Wave 0 (Phase 29 harness) |
| EXP-REPORT | Mermaid graph deterministic for fixture map | unit (snapshot) | `npx vitest run server/explorations/__tests__/report.spec.ts -t "mermaid"` | Wave 0 |
| EXP-REPORT | DFS enumerates ≤ maxPaths simple paths | unit | `npx vitest run server/explorations/__tests__/report.spec.ts -t "journeys"` | Wave 0 |
| EXP-* (E2E) | Sample APK exploration discovers ≥ 10 screens | nightly E2E gated | `DEVICE_FARM_E2E=1 npx vitest run server/explorations/__tests__/e2e.spec.ts` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run server/explorations` (≈ 5s — covers all unit + DB-gated integration)
- **Per wave merge:** `npm test && cd cli && make test && cd web && npm run check` (full suites; ≈ 90s)
- **Phase gate:** Full suite green + `npm run nyquist:check` exit 0 (delta ≥ -2pp from baseline) + sample-APK E2E green (gated) before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `server/explorations/__tests__/routes.spec.ts` — covers EXP-SCHEMA + REST surface
- [ ] `server/explorations/__tests__/similarity.spec.ts` — covers EXP-LOOP
- [ ] `server/explorations/__tests__/stuck-detector.spec.ts` — covers EXP-LOOP
- [ ] `server/explorations/__tests__/store.spec.ts` — covers EXP-SCHEMA
- [ ] `server/explorations/__tests__/agent-runner.spec.ts` — covers EXP-AGENT (mocked SDK)
- [ ] `server/explorations/__tests__/agent-tools.spec.ts` — covers EXP-AGENT
- [ ] `server/explorations/__tests__/prompts.spec.ts` — covers EXP-AGENT (prompt loading)
- [ ] `server/explorations/__tests__/budget.spec.ts` — covers budget caps
- [ ] `server/explorations/__tests__/watchdog.spec.ts` — covers budget caps
- [ ] `server/explorations/__tests__/report.spec.ts` — covers EXP-REPORT (snapshot)
- [ ] `server/explorations/__tests__/events.spec.ts` — covers EVENTS-03/TRACE-08 invariants
- [ ] `server/explorations/__tests__/ws-broadcaster.spec.ts` — covers EXP-WS
- [ ] `server/explorations/__tests__/e2e.spec.ts` — DEVICE_FARM_E2E-gated sample APK exploration
- [ ] `server/explorations/__tests__/__fixtures__/screenshot-home.png` + `screenshot-shop.png` + `screenshot-home-dup.png` (a perceptually-identical variant of home for pHash crossover test)
- [ ] `web/src/lib/components/atlas/__tests__/layout.spec.ts` — covers EXP-UI layoutGraph
- [ ] `cli/cmd/explore_test.go` — covers EXP-CLI
- [ ] `prompts/exploration.md` — NEW file (port of `_reference/app-explorer/CLAUDE.md` with substitutions)

**New runtime deps added in Wave 0:**
- `@anthropic-ai/claude-agent-sdk` (server)
- `sharp-phash` (server) — sharp already transitive but declare direct
- `@xyflow/svelte` (web)
- `@dagrejs/dagre` (web)

**No framework install needed:** vitest, drizzle, pg-boss, fastify, zod, all already in `package.json`. CLI's gorilla/websocket already imported via Phase 22 logs command. SvelteKit + Tailwind v4 already in web.

## Open Questions

1. **Drizzle `bytea` column shape.**
   - **What we know:** Drizzle 0.45+ supports `customType<{data: Buffer}>` for bytea; PHASH is 8 bytes packed. Existing schema uses `jsonb` and `text` and `uuid` — no `bytea` precedent in repo.
   - **What's unclear:** whether the simpler `varchar(64)` for the bitstring form (`"0010..."`) is preferable — smaller-than-bytes-but-larger-than-bytes tradeoff; varchar comparisons work with `sharp-phash/distance` directly.
   - **Recommendation:** Wave 0 spike — use `text` (or `varchar(64)`) for the bitstring. Tradeoff: 64 bytes per row vs 8 bytes for bytea, but with ≤ 60 screens per run × ≤ 100 runs = trivial storage. Comparison code stays as-is (no buffer packing/unpacking). Switch to bytea ONLY if a benchmark shows index scan slowness, which is implausible at this scale.

2. **Claude Agent SDK behavior under server crash mid-run.**
   - **What we know:** brief says "BFS state persisted as the agent runs — resumable if killed." The agent SDK's `query()` returns an async generator that's tied to the process; if the server crashes the conversation dies.
   - **What's unclear:** whether the agent can be re-attached or whether resumption means "start a NEW agent with prior state injected as system prompt context."
   - **Recommendation:** v1 — restart-from-state. On server restart, mark any `status='running'` exploration as `failed{reason:'server_restart'}`. Resume is "re-run with the same parameters" (the DB state is preserved; the next run inherits it). Defer true mid-run resumption to v2 (Anthropic SDK doesn't currently support cross-process query continuation).

3. **Watchdog and Anthropic API timeout interaction.**
   - **What we know:** Agent SDK's underlying Anthropic API has a 10-min request timeout. A long run is ~30 min of wall-clock = 60+ API turns.
   - **What's unclear:** how the SDK handles per-turn timeout vs total-run timeout.
   - **Recommendation:** Wave 0 — set `maxTurns` so each request is bounded; rely on the watchdog for wall-clock. SDK README confirms `query()` is stateful across turns within one process — no special handling needed beyond `maxTurns` cap.

4. **Stuck detection signal back to agent.**
   - **What we know:** the agent runs inside the server process; we can't easily inject a "stuck" notification mid-stream.
   - **Solutions considered:**
     - (a) Make stuck a tool result (`explore_save_screen` returns `{isDuplicate:true, stuckCount:N}` — agent sees `stuckCount >= 3` and self-corrects via the prompt rule).
     - (b) Use SDK's `canUseTool` callback to inject pre-tool messages.
   - **Recommendation:** Option (a). Simpler. The prompt already instructs the agent to back out on stuck-condition; the tool return is the natural carrier.

5. **`@xyflow/svelte` Svelte 5 / Svelte 4 compatibility.**
   - **What we know:** Svelte Flow 1.0 (Aug 2024) ships Svelte 5 support per https://xyflow.com/blog/svelte-flow-launch + https://svelteflow.dev/whats-new. Web project uses Svelte 5.53.
   - **Confidence:** HIGH — verified via WebFetch of the official Svelte 5 dagre example.
   - **Recommendation:** pin `@xyflow/svelte: ^1` and `@dagrejs/dagre: ^1` in Wave 0; both APIs are post-1.0 stable.

6. **`sharp-phash` correctness vs hand-rolled DCT.**
   - **What we know:** brief described a hand-rolled 32×32 → DCT → 8×8 → median-threshold algorithm. `sharp-phash` does exactly this internally.
   - **Recommendation:** use `sharp-phash` — proven, downloaded 100K/week, single-purpose, 200-line implementation. Hand-rolling adds ~150 LoC and risks subtle bugs in DCT. Skip the "build it in-tree" exercise.

7. **In-process MCP tool: pre-uploaded vs auto-uploaded screenshot artifact.**
   - **What we know:** `device_screenshot` (Phase 34 MCP) returns `{artifactId, url}` — agent receives the id and passes it to `explore_save_screen`.
   - **What's unclear:** whether the agent can be relied upon to chain "screenshot → save_screen" with the correct id, or whether `explore_save_screen` should re-fetch the latest screenshot from the session.
   - **Recommendation:** require the agent to pass `screenshot_artifact_id` (forces explicit chaining, fails fast if the agent forgets). The prompt rule "Screenshot after every action" already encodes the right behavior.

8. **iOS support in v1.**
   - **What we know:** brief lists Android as the primary target; iOS-only mention is via `--seed-skeleton` (a Phase 34 optional hint).
   - **What's unclear:** does device_tap_by_description work reliably on iOS (Phase 34's MaestroAiResolver was designed Android-first)?
   - **Recommendation:** ship Android-first in v1; mark iOS as best-effort. Phase 34's ClaudeVisionResolver is platform-agnostic and works on iOS, but accuracy depends on the screenshot resolution + UI complexity.

## Sources

### Primary (HIGH confidence)

- `_reference/app-explorer/CLAUDE.md:1-225` — agent BFS spec (read in full)
- `_reference/app-explorer/app_explorer/models.py:1-43` — Pydantic schema (read in full)
- `_reference/app-explorer/app_explorer/store.py:1-100` — JSON persistence (read in full)
- `_reference/app-explorer/app_explorer/cli.py:1-242` — agent CLI surface (read in full)
- `_reference/app-explorer/app_explorer/report.py:1-152` — Mermaid + DFS report generator (read in full)
- `_reference/app-explorer/frontend/src/components/AtlasGraph.tsx:1-459` — xyflow + dagre BFS-aware layout (read in full)
- `_reference/app-explorer/frontend/src/components/ScreenPanel.tsx:1-178` — right rail
- `_reference/app-explorer/frontend/src/components/JourneyPanel.tsx:1-259` — DFS path stepper
- `_reference/app-explorer/frontend/src/components/ScreenNode.tsx:1-72` — xyflow node
- `_reference/app-explorer/frontend/src/components/types.ts:1-29` — ScreenMap/Screen/Element/Transition shapes
- `.planning/phases/34-session-api-mcp/34-RESEARCH.md:1-997` — Phase 34 sessions infra this builds on
- `server/jobs/MODULE.md` — module-pattern blueprint (events.ts, MODULE.md, index.ts, factory)
- `server/jobs/events.ts:1-427` — events.ts registry pattern (port)
- `server/streaming/plugin.ts` — WS broadcaster + heartbeat + history replay pattern (port)
- `server/jobs/internal/routes.ts:87-104` — `requireAuth` chain
- [Claude Agent SDK TypeScript docs (official)](https://code.claude.com/docs/en/agent-sdk/typescript) — `query()`, `tool()`, `createSdkMcpServer()` signatures + complete in-process MCP example
- [@anthropic-ai/claude-agent-sdk on npm](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) — version + Node 18+ + Zod requirements
- [Svelte Flow Dagre Layout example (official)](https://svelteflow.dev/examples/layout/dagre) — complete Svelte 5 + `@dagrejs/dagre` working example
- [Svelte Flow 1.0 launch announcement (xyflow.com)](https://xyflow.com/blog/svelte-flow-launch) — confirms Svelte 5 support
- [sharp-phash GitHub README](https://github.com/btd/sharp-phash) — `phash(buffer)` + `distance(a,b)` API
- [Perceptual Hashing in Node.js with Sharp pHash (context.dev)](https://www.context.dev/blog/perceptual-hashing-in-node-js-with-sharp-phash-for-developers) — DCT explanation + integration pattern

### Secondary (MEDIUM confidence — verified against multiple sources)

- [Claude Agent SDK Quickstart 2026 (TokenMix)](https://tokenmix.ai/blog/anthropic-claude-agent-sdk-quickstart-guide-2026) — confirms in-process MCP + Zod schema patterns
- [Building Custom AI Agents (MadPlay)](https://madplay.github.io/en/post/claude-agent-sdk-tutorial) — alternative tutorial confirming `tool()` + `createSdkMcpServer()` semantics
- [Svelte Flow Layouting Libraries docs](https://svelteflow.dev/learn/layouting/layouting-libraries) — confirms dagre is the recommended hierarchical option for xyflow/svelte

### Tertiary (LOW confidence — flagged for Wave-0 validation)

- Drizzle `bytea` vs `varchar(64)` for pHash storage — Open Question #1
- Claude Agent SDK behavior when server crashes mid-run — Open Question #2

## Metadata

**Confidence breakdown:**
- Standard Stack: HIGH — Claude Agent SDK + sharp-phash + @xyflow/svelte + @dagrejs/dagre all verified via official docs/npm; sharp already transitive in tree.
- Architecture: HIGH — verbatim copy of Phase 34 sessions pattern + Phase 22 streaming broadcaster + Phase 23 jobs queue + Phase 26 auth chain.
- Reference port fidelity: HIGH — every load-bearing file in `_reference/app-explorer/` read in full; cite-by-cite map produced for all 4 components + 4 Python files.
- Loop detection: HIGH — sharp-phash README + context.dev tutorial verified the DCT + Hamming approach; sample threshold (8 / 0.02) ported from brief.
- Web UI: HIGH — Svelte Flow 1.0 confirmed Svelte 5-native; dagre example fetched from official docs; React → Svelte 5 port is mechanical.
- Pitfalls: HIGH — 8 open questions captured; 2 are Wave-0 spikes, 6 are documentation/discretion.

**Research date:** 2026-05-15
**Valid until:** 2026-06-15 (30 days — Claude Agent SDK + Svelte Flow both move fast; revalidate SDK shape + xyflow APIs if Wave 0 starts after this window)

## RESEARCH COMPLETE

**Phase:** 35 — App Explorer + Atlas Graph
**Confidence:** HIGH

### Key Findings
- Every component this phase needs ships in working form in `_reference/app-explorer/` (agent CLAUDE.md spec, BFS Python runner, React xyflow AtlasGraph, Mermaid report generator); per locked External Dependencies Policy we port each verbatim with TS substitutions.
- Pattern is identical to Phase 34 sessions: factory + events.ts + MODULE.md + barrel + thin plugin + manual `requireAuth` chain. Three new Drizzle tables (`explorations`, `exploration_screens`, `exploration_transitions`) with cascade delete + partial-unique dedup indexes.
- Claude Agent SDK supports in-process MCP tools via `createSdkMcpServer({tools:[...]})` mixed with external (stdio) MCP servers in one `query({options:{mcpServers:{...}}})` call. Phase 35 registers 4 in-process exploration tools alongside the Phase 34 `@device-stream/mcp` external server — zero subprocess overhead, full Zod typing.
- pHash via `sharp-phash` (proven, sharp already transitive); Hamming < 8 + sharp-grayscale-64 RMSE < 0.02 gives reliable screen-equivalence. Stuck detection lives inside `explore_save_screen` (server-side, 3-pHash sliding window) and signals the agent via tool return value, not out-of-band message injection.
- Web UI is a 1:1 port of `frontend/src/components/AtlasGraph.tsx` (459 LoC) to Svelte 5 + `@xyflow/svelte` + `@dagrejs/dagre`. The load-bearing BFS-aware layout algorithm (feeds ONLY tree edges to dagre; overlays back-edges as dashed strokes) ports verbatim. ScreenPanel + JourneyPanel + ScreenNode are mechanical React-to-Svelte-5 ports.
- Reports are Markdown + Mermaid via `_reference/app_explorer/report.py` port — ~80 LoC including DFS journey enumeration. Served at `GET /api/explorations/:id/report.md` as text/markdown.

### File Created
`/Users/heicg/Desktop/projects/device-farm/.planning/phases/35-app-explorer/35-RESEARCH.md`

### Confidence Assessment
| Area | Level | Reason |
|------|-------|--------|
| Standard Stack | HIGH | Every lib verified via official docs/npm; sharp transitive verified in npm list |
| Architecture | HIGH | Verbatim copy of Phase 34 sessions + Phase 22 streaming + Phase 26 auth |
| Reference port | HIGH | All 8 reference files read in full; cite-by-cite map produced |
| Agent runner | HIGH | Claude Agent SDK in-process MCP + external MCP mix verified from official TS docs |
| Loop detection | HIGH | sharp-phash README verified; brief threshold values preserved |
| Web UI | HIGH | Svelte Flow 1.0 Svelte 5-native confirmed; dagre example fetched |
| Pitfalls | HIGH | 8 open questions captured; 2 are Wave-0 spikes, 6 are documentation/discretion |

### Open Questions
- Drizzle `bytea` vs `varchar(64)` for pHash storage — recommend varchar(64) (Open Question #1)
- Server crash mid-run resume semantics — v1 = restart-from-state, true resume deferred (Open Question #2)
- Stuck detection signal channel — recommend tool-return-value carrier (Open Question #4)
- iOS reliability of `device_tap_by_description` — Android-first; iOS best-effort (Open Question #8)

### Ready for Planning
Research complete. Planner can now create PLAN.md files for T-35.0 (schema + Wave 0 substrate) through T-35.7 (reports), inheriting the 6-wave shape proven across Phases 19-34.
