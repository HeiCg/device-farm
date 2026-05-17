# App Explorer — Agent Skeleton

**Phase 34 Plan 34-08 stub.** Breadcrumb for Phase 35 (App Explorer +
Atlas Graph). This file documents the agent prompt + tool sequence
using only the Phase 34 MCP surface; the full implementation
(persisted screen graph, pHash + grayscale RMSE loop detection,
xyflow-svelte Atlas visualization, stuck-detection event) lands in
Phase 35.

## Use case

Given a fresh APK / IPA, map every reachable screen of the app by
exhaustively tapping interactive elements (BFS), recording transitions,
and producing a navigable screen graph for human review.

## Agent prompt skeleton

> You are an app explorer agent. Given:
>
> - An uploaded build artifact id: `<artifactId>`
> - A bundle id: `<bundleId>`
> - A tap budget: `<maxTaps>` (default 100)
> - A screen budget: `<maxScreens>` (default 25)
>
> Map every reachable screen of the app via breadth-first search:
>
> 1. Lease an `android` (or `ios`) device for 1800 seconds.
> 2. Install the artifact + launch the bundle id.
> 3. Maintain a BFS queue of (screen, action) candidates seeded from the
>    initial screen.
> 4. Repeat until the queue is empty OR a budget is exhausted:
>    a. Pop the next candidate.
>    b. Take a screenshot. If the screenshot hash matches a previously-
>       visited screen, mark it a loop edge and continue.
>    c. Otherwise, enumerate candidate tap targets visible on the screen
>       (heuristic: buttons, links, list items, tabs).
>    d. For each candidate, tap by description, screenshot, and enqueue
>       the resulting screen.
>    e. Tap "back" to return to the parent screen for the next BFS step.
> 5. Release the device.
> 6. Output a JSON graph: `{screens: [{id, screenshotArtifactId, label}],
>    edges: [{from, to, action}]}`.

## Tool sequence (Phase 34 MCP surface only)

```
device_lease(platform="android", ttlSeconds=1800)
  -> {sessionId, deviceId, wsUrl, ...}

device_install(sessionId, artifactId="<APK_UUID>")
device_launch(sessionId, bundleId="com.example.app")

# BFS loop:
device_screenshot(sessionId)           # snapshot current screen
# ... agent reasons about visible tappable elements ...
device_tap_by_description(sessionId, target="Settings gear icon")
device_screenshot(sessionId)           # snapshot result screen
device_key(sessionId, code="back")     # return to parent
# ... continue BFS ...

device_release(sessionId)
```

The "enumerate candidate tap targets" step is the agent's reasoning
work — Claude inspects the screenshot, picks visible interactive
elements, and emits a `device_tap_by_description` per candidate.

## What Phase 35 adds

- `POST /api/explorations` endpoint that launches this agent as a
  background pg-boss job (server-side, not Claude-Code-driven).
- Server-side schema: `exploration_screens` + `exploration_transitions`
  tables persisted across runs.
- Inline pHash + grayscale RMSE loop detection prevents re-saving
  identical screens; a `stuck` event fires on the 3rd consecutive
  same-screen tap.
- Web UI: `/explorations/[id]` renders an interactive Atlas graph
  (xyflow-svelte + dagre) with BFS-aware tree edges + dashed back
  edges. Click a node → opens a side panel with the screen artifact +
  full transition list.
- Markdown + Mermaid export of the graph for inclusion in docs / PRs.
- Budget caps enforced server-side.

## Recommended `SESSION_RESOLVER` setting

`claude-vision` — exploration agents are inherently exploratory, so
many tap targets won't be cleanly identifiable from the uiautomator XML
alone. The LRU cache amortizes well during BFS over a single app
(visiting the same screen multiple times during backtracking is
common). See `docs/runbooks/session-resolver-costs.md`.

## Status

**Phase 34: SKELETON ONLY.** Full implementation lands in Phase 35 per
the roadmap. Phase 34 ships the MCP tool surface this agent depends on.
