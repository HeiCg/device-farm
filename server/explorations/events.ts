/**
 * Explorations module — typed event surface (Phase 35 Plan 35-01).
 *
 * 7 event names (EVENTS-03 dotted past-tense). TRACE-08 split:
 *   - PERSISTED (audit/terminal):
 *       exploration.started     — agent run kicked off (audit start)
 *       exploration.stuck       — loop detector tripped (audit-notable behavior)
 *       exploration.finished    — terminal: run reached budget cap / cancelled
 *       exploration.failed      — terminal: agent / pool / device error
 *   - TRANSIENT (high-frequency, derivable from row tables):
 *       exploration.screen.discovered — derivable from exploration_screens
 *       exploration.transition.recorded — derivable from exploration_transitions
 *       exploration.tool.called — very high-frequency trace
 *
 * This file is allowlisted by eslint-local-rules/no-direct-bus-emit.js
 * (pattern /\/events\.ts$/) and by the .dependency-cruiser.cjs rule
 * `no-direct-bus-emit-outside-events-ts`. All `bus.emit(...)` call sites
 * in the explorations module MUST route through `makeExplorationsEmitters`.
 *
 * Emitter signature matches Phase 26 auth + Phase 34 sessions:
 *   emit.<name>(aggregateId, payload)
 * Aggregate id is the runId for every event (single run is the aggregate root).
 */
import { z } from 'zod';
import { v5 as uuidv5 } from 'uuid';

import { createEventHelpers } from '../bus/helpers.js';
import type { TypedBus } from '../bus/bus.js';
import type { EventRegistry } from '../bus/types.js';
import type { Envelope } from '../events/envelope.js';
import { actorSchema } from '../auth/index.js';

/** Aggregate-type literal for envelope.aggregateType. */
export const EXPLORATIONS_AGGREGATE_TYPE = 'exploration' as const;

/** RFC 4122 §4.3 URL namespace — same constant used by hooks/pool/jobs/maestro/pipelines/auth. */
const URL_NAMESPACE = '6ba7b811-9dad-11d1-80b4-00c04fd430c8';

/**
 * Stable v5 UUID derived from 'exploration' under URL namespace.
 * Reserved fallback aggregateId for events not tied to a specific runId.
 * Spec re-derives at test time to enforce single-source-of-truth.
 */
export const EXPLORATIONS_AGGREGATE_ID: string = uuidv5('exploration', URL_NAMESPACE);

/** Event-name constants (EVENTS-03 past-tense dotted). */
export const EXPLORATION_EVENT_NAMES = {
  STARTED: 'exploration.started',
  SCREEN_DISCOVERED: 'exploration.screen.discovered',
  TRANSITION: 'exploration.transition.recorded',
  STUCK: 'exploration.stuck',
  TOOL_CALL: 'exploration.tool.called',
  FINISHED: 'exploration.finished',
  FAILED: 'exploration.failed',
} as const;

export type ExplorationEventName =
  (typeof EXPLORATION_EVENT_NAMES)[keyof typeof EXPLORATION_EVENT_NAMES];

// ---------- Payload schemas (port from RESEARCH §WS Event Stream) ----------

export const explorationStartedPayloadSchema = z.object({
  runId: z.string().uuid(),
  deviceId: z.string().uuid(),
  sessionId: z.string().uuid(),
  bundleId: z.string().min(1),
  platform: z.enum(['android', 'ios']),
  startedBy: actorSchema,
});
export type ExplorationStartedPayload = z.infer<typeof explorationStartedPayloadSchema>;

export const explorationScreenDiscoveredPayloadSchema = z.object({
  runId: z.string().uuid(),
  screenId: z.string().min(1),
  title: z.string(),
  bfsDepth: z.number().int().nonnegative(),
  screenshotArtifactId: z.string().uuid(),
});
export type ExplorationScreenDiscoveredPayload = z.infer<
  typeof explorationScreenDiscoveredPayloadSchema
>;

export const explorationTransitionPayloadSchema = z.object({
  runId: z.string().uuid(),
  fromScreenId: z.string().min(1),
  toScreenId: z.string().min(1),
  action: z.record(z.string(), z.unknown()),
  isBackEdge: z.boolean(),
});
export type ExplorationTransitionPayload = z.infer<typeof explorationTransitionPayloadSchema>;

export const explorationStuckPayloadSchema = z.object({
  runId: z.string().uuid(),
  screenId: z.string().min(1),
  consecutive: z.number().int().min(1),
});
export type ExplorationStuckPayload = z.infer<typeof explorationStuckPayloadSchema>;

export const explorationToolCallPayloadSchema = z.object({
  runId: z.string().uuid(),
  name: z.string().min(1),
  args: z.record(z.string(), z.unknown()),
  durationMs: z.number().int().nonnegative(),
});
export type ExplorationToolCallPayload = z.infer<typeof explorationToolCallPayloadSchema>;

export const explorationFinishedPayloadSchema = z.object({
  runId: z.string().uuid(),
  reason: z.enum(['complete', 'budget', 'stuck', 'login_required', 'cancelled']),
  stats: z.object({
    screensDiscovered: z.number().int().nonnegative(),
    transitionsTotal: z.number().int().nonnegative(),
    tapsTaken: z.number().int().nonnegative(),
    durationMs: z.number().int().nonnegative(),
  }),
});
export type ExplorationFinishedPayload = z.infer<typeof explorationFinishedPayloadSchema>;

export const explorationFailedPayloadSchema = z.object({
  runId: z.string().uuid(),
  step: z.enum(['lease', 'install', 'launch', 'agent', 'unknown']),
  reason: z.string().min(1),
});
export type ExplorationFailedPayload = z.infer<typeof explorationFailedPayloadSchema>;

// ---------- Registry (TRACE-08 persistence policy) ----------
//
// 4 persisted (started/stuck/finished/failed) + 3 transient (screen/transition/toolCall).
// aggregateType is 'exploration' for ALL 7 events (every event is about an
// exploration run; aggregateId = runId).

export const explorationsRegistry = {
  [EXPLORATION_EVENT_NAMES.STARTED]: {
    schema: explorationStartedPayloadSchema,
    persisted: true,                // audit start
    aggregateType: EXPLORATIONS_AGGREGATE_TYPE,
  },
  [EXPLORATION_EVENT_NAMES.SCREEN_DISCOVERED]: {
    schema: explorationScreenDiscoveredPayloadSchema,
    persisted: false,               // high-frequency, derivable from exploration_screens
    aggregateType: EXPLORATIONS_AGGREGATE_TYPE,
  },
  [EXPLORATION_EVENT_NAMES.TRANSITION]: {
    schema: explorationTransitionPayloadSchema,
    persisted: false,               // high-frequency, derivable from exploration_transitions
    aggregateType: EXPLORATIONS_AGGREGATE_TYPE,
  },
  [EXPLORATION_EVENT_NAMES.STUCK]: {
    schema: explorationStuckPayloadSchema,
    persisted: true,                // audit-notable behavior signal
    aggregateType: EXPLORATIONS_AGGREGATE_TYPE,
  },
  [EXPLORATION_EVENT_NAMES.TOOL_CALL]: {
    schema: explorationToolCallPayloadSchema,
    persisted: false,               // very high-frequency trace
    aggregateType: EXPLORATIONS_AGGREGATE_TYPE,
  },
  [EXPLORATION_EVENT_NAMES.FINISHED]: {
    schema: explorationFinishedPayloadSchema,
    persisted: true,                // terminal
    aggregateType: EXPLORATIONS_AGGREGATE_TYPE,
  },
  [EXPLORATION_EVENT_NAMES.FAILED]: {
    schema: explorationFailedPayloadSchema,
    persisted: true,                // terminal
    aggregateType: EXPLORATIONS_AGGREGATE_TYPE,
  },
} as const satisfies EventRegistry;

export type ExplorationsRegistry = typeof explorationsRegistry;

// ---------- Emit helpers factory ----------

/**
 * Per-event typed helpers — each takes (aggregateId, payload) per the codebase
 * convention (createEventHelpers signature). aggregateId is `runId` for every
 * exploration event.
 *
 * Called by createExplorationsModule (internal/module.ts) with the
 * persistEnvelope closure as the `onEmit` hook.
 */
export function makeExplorationsEmitters(
  bus: TypedBus<ExplorationsRegistry>,
  onEmit?: (envelope: Envelope) => void,
) {
  const emit = createEventHelpers(bus, onEmit);
  return {
    started: emit(EXPLORATION_EVENT_NAMES.STARTED),
    screenDiscovered: emit(EXPLORATION_EVENT_NAMES.SCREEN_DISCOVERED),
    transition: emit(EXPLORATION_EVENT_NAMES.TRANSITION),
    stuck: emit(EXPLORATION_EVENT_NAMES.STUCK),
    toolCall: emit(EXPLORATION_EVENT_NAMES.TOOL_CALL),
    finished: emit(EXPLORATION_EVENT_NAMES.FINISHED),
    failed: emit(EXPLORATION_EVENT_NAMES.FAILED),
  };
}

export type ExplorationsEmitters = ReturnType<typeof makeExplorationsEmitters>;
