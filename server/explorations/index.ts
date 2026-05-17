/**
 * Explorations module — public barrel (MOD-02).
 *
 * Strict 1-line internal/module re-export FIRST, followed by the canonical
 * full surface for cross-module consumers:
 *  - factory + ExplorationsModule + CreateExplorationsModuleDeps
 *  - plugin (default export consumed by server/index.ts)
 *  - events surface (registry, emitters, schemas, types — 7 events)
 *  - REST + row decoder schemas surface
 *  - queue surface (name + worker registrar + payload schema)
 *  - WS surface (discriminated-union frame schema + inferred types)
 *
 * NO `export *`. Each export is named.
 *
 * Plan 35-00: shipped strict 1-line internal/ re-export.
 * Plan 35-01: extended with explorationsPlugin (cross-module surface).
 * Plan 35-06: extended with full surface — events + schemas + queue + ws.
 */
export {
  createExplorationsModule,
  type ExplorationsModule,
  type CreateExplorationsModuleDeps,
} from './internal/module.js';

// Plugin default export consumed by server/index.ts
export { default as explorationsPlugin } from './plugin.js';

// Events surface (7 events + registry + emitters)
export {
  EXPLORATION_EVENT_NAMES,
  EXPLORATIONS_AGGREGATE_TYPE,
  EXPLORATIONS_AGGREGATE_ID,
  explorationsRegistry,
  makeExplorationsEmitters,
  explorationStartedPayloadSchema,
  explorationScreenDiscoveredPayloadSchema,
  explorationTransitionPayloadSchema,
  explorationStuckPayloadSchema,
  explorationToolCallPayloadSchema,
  explorationFinishedPayloadSchema,
  explorationFailedPayloadSchema,
  type ExplorationsRegistry,
  type ExplorationsEmitters,
  type ExplorationEventName,
  type ExplorationStartedPayload,
  type ExplorationScreenDiscoveredPayload,
  type ExplorationTransitionPayload,
  type ExplorationStuckPayload,
  type ExplorationToolCallPayload,
  type ExplorationFinishedPayload,
  type ExplorationFailedPayload,
} from './events.js';

// Schemas surface (REST + row decoders + list endpoint)
export {
  startRequestSchema,
  startResponseSchema,
  getResponseSchema,
  listResponseSchema,
  explorationListItemSchema,
  explorationRowSchema,
  explorationScreenRowSchema,
  explorationTransitionRowSchema,
  type ExplorationStartRequest,
  type ExplorationStartResponse,
  type Exploration,
  type ExplorationScreen,
  type ExplorationTransition,
  type ExplorationGetResponse,
  type ExplorationListItemDto,
  type ExplorationListResponse,
} from './schemas.js';

// Queue surface
export {
  EXPLORATION_RUN_QUEUE_NAME,
  registerExplorationsRunWorker,
  explorationRunPayloadSchema,
  type ExplorationRunPayload,
} from './queue.js';

// WS surface (discriminated-union frame + per-variant types)
export {
  wsExplorationFrameSchema,
  type WsExplorationFrame,
  type WsScreenDiscoveredFrame,
  type WsTransitionFrame,
  type WsToolCallFrame,
  type WsStuckFrame,
  type WsFinishedFrame,
  type WsErrorFrame,
} from './ws-schemas.js';
