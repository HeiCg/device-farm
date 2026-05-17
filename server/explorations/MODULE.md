# `server/explorations/` — MODULE.md

## Purpose

The explorations module owns Claude Agent SDK-driven BFS exploration of a
target mobile app. It accepts an `appArtifactId` + budget caps via REST,
leases a device session (Phase 34) or falls back to direct pool allocation,
runs the agent loop against a mix of in-process MCP tools
(`exploration-state` — explore_save_screen / explore_save_transition /
explore_mark_element_explored / explore_get_unexplored / explore_finish)
and the external `@device-stream/mcp` stdio server (7 device_* tools), and
persists the BFS-discovered screen graph (3 Drizzle tables: `explorations`,
`exploration_screens`, `exploration_transitions`).

Loop / stuck detection uses inline sharp-phash + grayscale RMSE crossover
(Hamming<8, RMSE<0.02 thresholds verified with PNG fixtures); a
sliding-window StuckDetector emits `exploration.stuck` on the 3rd
consecutive same-screen pHash match. Budget caps (taps/screens/seconds) are
enforced server-side inside the runner — never trusted to the agent prompt
— with a wall-clock setTimeout Watchdog terminating runaway runs.

Live progress streams to web + CLI via a WebSocket route
(`GET /api/explorations/:id/events`) carrying 6 typed frame variants
(screen-discovered / transition / tool-call / stuck / finished / error)
through a per-run in-memory broadcaster with a 200-entry ring buffer +
30s heartbeat + correlationId TRACE-06 propagation. Shareable Markdown
reports with embedded Mermaid `graph TD` blocks + DFS-enumerated user
journeys land at `GET /api/explorations/:id/report.md` — port of the
reference repo's `app_explorer/report.py`. Consumes the Phase 34 session
surface for device interaction; consumed by the Atlas graph viewer at
`/explorations/[id]` in the web UI (Phase 35 Plan 35-05 — Svelte 5 +
@xyflow/svelte + @dagrejs/dagre).

## Public API

Exports from `server/explorations/index.ts` (the ONLY legitimate import
surface outside this module — enforced by the `dependency-cruiser` 12th
forbidden rule `no-deep-imports-into-explorations-internal`).

- **Plugin:** `explorationsPlugin` (default — name `'explorations'`,
  dependencies `['config', 'db', 'event-bus', 'queue', 'auth']`).
- **Factory (canonical v3.0):** `createExplorationsModule(deps)` + type
  `ExplorationsModule` + `CreateExplorationsModuleDeps` (MOD-06).
- **Events surface:** `explorationsRegistry`, `makeExplorationsEmitters`,
  `EXPLORATION_EVENT_NAMES`, `EXPLORATIONS_AGGREGATE_TYPE`,
  `EXPLORATIONS_AGGREGATE_ID`, types `ExplorationsRegistry`,
  `ExplorationsEmitters`, `ExplorationEventName`, payload types
  (`ExplorationStartedPayload`, `ExplorationScreenDiscoveredPayload`,
  `ExplorationTransitionPayload`, `ExplorationStuckPayload`,
  `ExplorationToolCallPayload`, `ExplorationFinishedPayload`,
  `ExplorationFailedPayload`).
- **Schemas surface:** `startRequestSchema`, `startResponseSchema`,
  `getResponseSchema`, `listResponseSchema`, `explorationListItemSchema`,
  row decoders (`explorationRowSchema`, `explorationScreenRowSchema`,
  `explorationTransitionRowSchema`), inferred types
  (`ExplorationStartRequest`, `ExplorationStartResponse`, `Exploration`,
  `ExplorationScreen`, `ExplorationTransition`, `ExplorationGetResponse`,
  `ExplorationListItemDto`, `ExplorationListResponse`).
- **Queue surface:** `EXPLORATION_RUN_QUEUE_NAME`,
  `registerExplorationsRunWorker`, `explorationRunPayloadSchema`,
  `ExplorationRunPayload`.
- **WS surface:** `wsExplorationFrameSchema` (z.discriminatedUnion of 6
  frame variants), `WsExplorationFrame` (inferred union type).

Fastify decorators exposed by the plugin:

- `fastify.explorationsModule: ExplorationsModule`

HTTP routes registered (all under `/api`, gated by local `requireAuth`):

| Method | Path                                          | Body / Response                                                     |
| ------ | --------------------------------------------- | ------------------------------------------------------------------- |
| POST   | `/api/explorations`                           | `ExplorationStartRequest` → 201 `ExplorationStartResponse`          |
| GET    | `/api/explorations`                           | — → 200 `ExplorationListResponse` (paginated, LIMIT 100)            |
| GET    | `/api/explorations/:id`                       | — → 200 `ExplorationGetResponse` (full graph), 404 problem+json     |
| GET    | `/api/explorations/:id/report.md`             | — → 200 `text/markdown`, 404 problem+json                           |
| DELETE | `/api/explorations/:id`                       | — → 204 (cancelled if running), 404 problem+json                    |
| GET    | `/api/explorations/:id/events` (WS upgrade)   | `?token=<bearer>` → discriminated-union JSONL stream, 200 ring + 30s heartbeat |

## Events Emitted

| Name                                | Persisted (TRACE-08) | Aggregate Type | Payload                                                                                |
| ----------------------------------- | -------------------- | -------------- | -------------------------------------------------------------------------------------- |
| `exploration.started`               | **YES**              | `exploration`  | `{runId, deviceId, sessionId, bundleId, platform, startedBy: Actor}`                   |
| `exploration.screen.discovered`     | no                   | `exploration`  | `{runId, screenId, title, bfsDepth, screenshotArtifactId}`                             |
| `exploration.transition.recorded`   | no                   | `exploration`  | `{runId, fromScreenId, toScreenId, action, isBackEdge}`                                |
| `exploration.stuck`                 | **YES**              | `exploration`  | `{runId, screenId, consecutive}`                                                       |
| `exploration.tool.called`           | no                   | `exploration`  | `{runId, name, args, durationMs}`                                                      |
| `exploration.finished`              | **YES**              | `exploration`  | `{runId, reason, stats: {screensDiscovered, transitionsTotal, tapsTaken, durationMs}}` |
| `exploration.failed`                | **YES**              | `exploration`  | `{runId, step, reason}`                                                                |

Persistence policy per TRACE-08: 4 persisted (audit start + audit-notable
stuck signal + 2 terminals) + 3 transient (high-frequency screen / transition
/ tool-call traces). The transient events are derivable from
`exploration_screens` + `exploration_transitions` tables; persisting them
would 10x the events row count for no audit value.

`startedBy` is type-narrowed via `actorSchema` (TRACE-10).

## Events Consumed

NONE. Phase 35 is emit-only. Phase 36+ (CommandPalette, multi-app comparison)
may add subscribers for cross-app graph diffing (DEFERRED-35-D) or live
"N running" dashboard badges (DEFERRED-35-C).

## Queue Produced

`exploration.run` — single per-run job carrying `{runId: uuid}`.

| Field             | Value                                  |
| ----------------- | -------------------------------------- |
| Queue name        | `exploration.run` (alias `EXPLORATION_RUN_QUEUE_NAME`) |
| Policy            | `stately` (drops duplicate enqueues for the same singletonKey) |
| `singletonKey`    | `runId` (defense-in-depth alongside DB row status='queued') |
| `retryLimit`      | `0` (agent runs are not idempotent — partial DB state preserved) |
| `expireInSeconds` | `7200` (matches max `budgetSeconds`)   |

Worker registered on plugin `onReady` via
`module.registerWorker(runnerDeps)`. Handler invokes `runExploration(runId, deps)`
from `internal/agent-runner.ts`.

## Queue Consumed

NONE. The module produces but does not consume queues.

## Invariants

1. **Cascade delete clears child rows** — `DELETE FROM explorations WHERE id=X`
   removes all matching `exploration_screens` + `exploration_transitions`
   via `ON DELETE CASCADE` FKs on `run_id`. Tested by
   `__tests__/store.spec.ts` cascade verification.
2. **`(runId, screenId)` UNIQUE prevents duplicate screen saves** — even if
   the agent re-emits `explore_save_screen` for the same logical screen,
   the upsert path (`ON CONFLICT (run_id, screen_id) DO UPDATE`) merges
   element annotations instead of creating duplicate rows. Tested by
   `__tests__/store.spec.ts` (saveScreen upsert path).
3. **`(runId, from_screen, to_screen, action_hash)` UNIQUE prevents duplicate
   transitions** — the agent's tap dedup via `action_hash` (computed at
   save time from `{kind, target}`) keeps the transition table free of
   exact-duplicate edges from the same node pair. Tested by
   `__tests__/store.spec.ts` (saveTransition action-hash dedup).
4. **Budget caps enforced server-side, not agent-trusted** — `tapCounter`
   intercept inside `agent-runner.ts` increments on every `device_*`
   tool_use; when `tapCounter > budgetTaps` → `watchdog.tripBudget()` →
   `queryInstance.return()` → SDK loop exits. `budgetScreens` is enforced
   inside `explore_save_screen` (returns `{error:'budget_exceeded'}` pre-write).
   `budgetSeconds` is enforced via wall-clock `setTimeout` in Watchdog.
   Tested by `__tests__/budget.spec.ts` (4 cases: in-memory cap + watchdog
   fake-timer + DB-gated budget trip).
5. **pHash + RMSE thresholds locked** — `PHASH_THRESHOLD=8` (Hamming) and
   `RMSE_THRESHOLD=0.02` (grayscale) for `isSameScreen` in
   `internal/similarity.ts`. Real PNG fixtures confirm wide crossover
   margins: Hamming(home, home-dup)=0 vs Hamming(home, shop)=29; RMSE 0
   vs 0.043. Tested by `__tests__/similarity.spec.ts`.
6. **StuckDetector emits `exploration.stuck` on 3rd consecutive same-screen**
   — sliding window of `windowSize=3` (configurable) close pHashes fires
   the bus event AND carries `{isDuplicate:true, stuckCount:N≥3}` back
   through the tool return value so the agent can adapt. Tested by
   `__tests__/stuck-detector.spec.ts`.
7. **No deep imports into `server/explorations/internal/`** —
   `dependency-cruiser` rule 12 (`no-deep-imports-into-explorations-internal`)
   blocks external imports structurally; `__tests__/dep-cruiser.spec.ts`
   MOD-02 explorations extension proves the rule fires on
   `__fixtures__/dep-cruiser/bad-explorations-deep-import.ts`.

## Non-Goals

- **Concurrent multi-run UI badge** (DEFERRED-35-C). Web UI lists
  explorations sequentially; live "N running" counter + live-list refresh
  on bus events deferred to Phase 36+ (CommandPalette + dashboard polish).
- **Visual regression diffing across explorations** (DEFERRED-35-D).
  "Compare last 2 runs of same APK" feature deferred to a separate phase
  (v3.1 scope or later).
- **Auto-Maestro-flow generation from graph** (DEFERRED-35-E). Inferring
  a Maestro flow YAML from the BFS-discovered paths is a v3.1+ feature;
  explicitly out of Phase 35 scope.
- **iOS device_tap_by_description reliability past best-effort**
  (DEFERRED-35-F). Phase 34's MaestroAiResolver was Android-first. iOS
  support via ClaudeVisionResolver is platform-agnostic but accuracy
  depends on screenshot resolution + UI complexity. Tracked as a
  best-effort risk; no automated fix until accuracy data accumulates.
- **persistEnvelope 12TH sample point consolidation** (DEFERRED-35-A
  inherits from DEFERRED-26-B chain). The 10-line `persistEnvelope`
  middleware in `internal/module.ts` is the 12th verbatim copy across the
  module factories; Phase 27+ (API Aggregator) owns the tree-wide
  extraction to `server/bus/persist-envelope.ts`.
- **DEVICE_FARM_E2E gated sample-APK exploration in CI** (DEFERRED-35-B).
  The `__tests__/e2e.spec.ts` harness ships but CI activation (real
  Android emulator + Anthropic API key + known-stable APK) deferred to
  ops capacity.
- **Pagination on /explorations list** — currently LIMIT 100. Once the
  dashboard accumulates >100 runs, add a DataGrid component with
  cursor-based pagination. Phase 38+ Web Refactor candidate.

## Dependencies

Plugin name: `'explorations'` (preserved verbatim for back-compat with
`plugin-order.spec` + any dependency-array references in downstream plugins).

Plugin dependencies array (verbatim from `server/explorations/plugin.ts`):
5 entries.

```
['config', 'db', 'event-bus', 'queue', 'auth']
```

- `config` — for `fastify.config.server.host/port` (used to build
  server-authoritative `agentLogStreamUrl` returned from POST).
- `db` — for Drizzle queries (`explorations` INSERT/SELECT,
  `exploration_screens`/`exploration_transitions` upserts) AND for the
  `persistEnvelope` middleware that writes 4 persisted event types to
  the `events` table.
- `event-bus` — `busFactory` + ALS-aware envelope stamping in
  `makeExplorationsEmitters`.
- `queue` — `boss.send` (POST handler enqueues `exploration.run`) +
  `boss.createQueue` + `boss.work` (worker registered on plugin onReady).
- `auth` — `fastify.authService` (local `requireAuth` preHandler validates
  bearer tokens on REST + ?token= on WS upgrade).

Plugin self-registers `@fastify/websocket` (idempotent if already
registered by `websocket-plugin`; explorations plugin sits BEFORE
websocket-plugin in `server/index.ts`, so cannot depend on it
transitively).

Sessions integration is OPTIONAL — when `fastify.sessionsModule.leaseDevice`
is decorated (Phase 34 shipped), POST handler uses it for device lease;
otherwise falls back to direct `fastify.pool.allocate` with a sentinel
sessionId. Both paths exercised by `__tests__/routes.spec.ts`.

Cross-module consumers via barrel (MOD-02 compliant):

- `server/index.ts` imports `explorationsPlugin` for registration.
- Future Phase 36+ subscribers (cross-app comparison, command palette) may
  import the registry + emitter types from the barrel.

External dependencies (npm):

- `@anthropic-ai/claude-agent-sdk` ^0.3.143 — agent runner SDK
- `@anthropic-ai/sdk` ^0.96.0 — peer-dep of agent-sdk
- `sharp-phash` ^2.2.0 — perceptual hash for screen similarity
- `sharp` ^0.34.5 — grayscale RMSE pipeline
- `@modelcontextprotocol/sdk` (consumed via `@device-stream/mcp` workspace) — MCP stdio client

### Runnable Example

```bash
# (1) Start an exploration via POST /api/explorations.
# Requires: appArtifactId (uploaded APK or .app via POST /api/artifacts),
#           a valid Bearer API key, and an idle device matching `platform`.

API_KEY="df_xxxxx..."  # Bearer key from POST /admin/keys.
APK_ID="44444444-4444-4444-8444-444444444444"  # appArtifactId.

curl -s -X POST http://localhost:3000/api/explorations \
  -H "Authorization: Bearer ${API_KEY}" \
  -H 'Content-Type: application/json' \
  -d '{
    "appArtifactId":"'"${APK_ID}"'",
    "platform":"android",
    "bundleId":"com.example.app",
    "budgetTaps":150,
    "budgetScreens":40,
    "budgetSeconds":900
  }'
# → 201 {"runId":"...", "sessionId":"...", "deviceId":"...",
#         "agentLogStreamUrl":"ws://localhost:3000/api/explorations/<runId>/events",
#         "estimatedDurationMin":20}
```

```bash
# (2) Tail the live event stream over WebSocket.
#     Browser-side WebSocket cannot send Authorization header, so the
#     bearer rides on ?token= (Phase 22 streaming convention).

RUN_ID="<from POST response>"
websocat "ws://localhost:3000/api/explorations/${RUN_ID}/events?token=${API_KEY}"
# Streams JSONL frames: screen-discovered / transition / tool-call / stuck / finished / error.
# Reconnect replays last 200 frames; 30s heartbeat keeps idle connections alive.
```

```bash
# (3) Fetch the shareable Markdown report after the run finishes.
#     Embeds a Mermaid graph TD block + DFS-enumerated user journeys.

curl -s "http://localhost:3000/api/explorations/${RUN_ID}/report.md" \
  -H "Authorization: Bearer ${API_KEY}" | tee exploration-report.md
# → text/markdown body. Rendered in any Markdown viewer with Mermaid support.
```

```typescript
// (4) Subscribe programmatically — module bus is exposed via fastify.explorationsModule.bus.
import type { FastifyInstance } from 'fastify';

export function watchExplorationAudit(fastify: FastifyInstance): void {
  fastify.explorationsModule.bus.on('exploration.started', (payload) => {
    fastify.log.info(
      { runId: payload.runId, bundleId: payload.bundleId, platform: payload.platform },
      'Exploration started',
    );
  });
  fastify.explorationsModule.bus.on('exploration.stuck', (payload) => {
    fastify.log.warn(
      { runId: payload.runId, screenId: payload.screenId, consecutive: payload.consecutive },
      'Exploration stuck — agent unable to progress',
    );
  });
  fastify.explorationsModule.bus.on('exploration.finished', (payload) => {
    fastify.log.info(
      { runId: payload.runId, reason: payload.reason, stats: payload.stats },
      'Exploration finished',
    );
  });
}
```

References to RESEARCH pitfalls: Pitfall 3 (PNG fixture deterministic
generation via sharp pipeline), Pitfall 4 (stuck signal via tool-return
carrier vs MCP intercept — Open Q #4 resolved), Pitfall 6 (Position enum
inlining for vitest Node ESM loader compatibility), Pitfall 7 (xyflow/svelte
style as CSS string vs object). See
`.planning/phases/35-app-explorer/35-RESEARCH.md`.
