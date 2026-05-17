/**
 * Explorations bus → broadcaster subscribers — Phase 35 Plan 35-03.
 *
 * Wires per-module TypedBus<ExplorationsRegistry> events into
 * ExplorationsBroadcaster frames. The translation is 1-to-1 for 6 of the
 * 7 explorationsRegistry events (exploration.started is REST-side only —
 * fires from the POST handler before any WS subscriber would have
 * connected; client learns the run exists via GET /api/explorations/:id).
 *
 * Subscribers consume the side-channel `${type}.envelope` listener (not
 * `bus.on('type', payload-handler)`) so they receive the FULL Envelope
 * (with correlationId, occurredAt, actor, payload) — required for TRACE-06
 * correlationId propagation. The side-channel is populated by the
 * persistEnvelope hook inside the module factory (mirrors
 * server/streaming/internal/module.ts pattern).
 *
 * Subscriber registration is idempotent — returns an `unregister()` closure
 * the module shutdown calls to detach all 6 listeners.
 */
import { EventEmitter } from 'node:events';

import type { TypedBus } from '../../bus/index.js';
import type { Envelope } from '../../events/envelope.js';
import type { ExplorationsRegistry } from '../events.js';
import { EXPLORATION_EVENT_NAMES } from '../events.js';
import type {
  ExplorationScreenDiscoveredPayload,
  ExplorationTransitionPayload,
  ExplorationToolCallPayload,
  ExplorationStuckPayload,
  ExplorationFinishedPayload,
  ExplorationFailedPayload,
} from '../events.js';

import type { ExplorationsBroadcaster } from './broadcaster.js';

export interface SubscriberDeps {
  bus: TypedBus<ExplorationsRegistry>;
  broadcaster: ExplorationsBroadcaster;
}

/**
 * Reach into the per-bus EventEmitter to subscribe to the side-channel
 * `${type}.envelope` listener. This is the same mechanism the streaming
 * module uses (server/streaming/internal/module.ts line 113).
 *
 * NOTE: The bus class header documents this is an intentional public
 * implementation detail — the `ee` field is allow-listed for adjacent-
 * file consumption.
 */
function getEnvelopeEmitter(bus: TypedBus<ExplorationsRegistry>): EventEmitter {
  return (bus as unknown as { ee: EventEmitter }).ee;
}

export function registerExplorationSubscribers(
  deps: SubscriberDeps,
): () => void {
  const ee = getEnvelopeEmitter(deps.bus);
  const offs: Array<() => void> = [];

  function onEnvelope<P>(
    eventType: string,
    handler: (envelope: Envelope & { payload: P }) => void,
  ): void {
    const channel = `${eventType}.envelope`;
    const wrapped = (env: unknown): void => {
      handler(env as Envelope & { payload: P });
    };
    ee.on(channel, wrapped);
    offs.push(() => ee.removeListener(channel, wrapped));
  }

  // 1. screen-discovered
  onEnvelope<ExplorationScreenDiscoveredPayload>(
    EXPLORATION_EVENT_NAMES.SCREEN_DISCOVERED,
    (env) => {
      deps.broadcaster.publish(env.payload.runId, {
        v: 1,
        type: 'screen-discovered',
        ts: env.occurredAt,
        correlationId: env.correlationId ?? null,
        data: {
          runId: env.payload.runId,
          screenId: env.payload.screenId,
          title: env.payload.title,
          bfsDepth: env.payload.bfsDepth,
          screenshotArtifactId: env.payload.screenshotArtifactId,
        },
      });
    },
  );

  // 2. transition
  onEnvelope<ExplorationTransitionPayload>(
    EXPLORATION_EVENT_NAMES.TRANSITION,
    (env) => {
      deps.broadcaster.publish(env.payload.runId, {
        v: 1,
        type: 'transition',
        ts: env.occurredAt,
        correlationId: env.correlationId ?? null,
        data: {
          runId: env.payload.runId,
          fromScreenId: env.payload.fromScreenId,
          toScreenId: env.payload.toScreenId,
          action: env.payload.action,
          isBackEdge: env.payload.isBackEdge,
        },
      });
    },
  );

  // 3. tool-call
  onEnvelope<ExplorationToolCallPayload>(
    EXPLORATION_EVENT_NAMES.TOOL_CALL,
    (env) => {
      deps.broadcaster.publish(env.payload.runId, {
        v: 1,
        type: 'tool-call',
        ts: env.occurredAt,
        correlationId: env.correlationId ?? null,
        data: {
          runId: env.payload.runId,
          name: env.payload.name,
          args: env.payload.args,
          durationMs: env.payload.durationMs,
        },
      });
    },
  );

  // 4. stuck
  onEnvelope<ExplorationStuckPayload>(
    EXPLORATION_EVENT_NAMES.STUCK,
    (env) => {
      deps.broadcaster.publish(env.payload.runId, {
        v: 1,
        type: 'stuck',
        ts: env.occurredAt,
        correlationId: env.correlationId ?? null,
        data: {
          runId: env.payload.runId,
          screenId: env.payload.screenId,
          consecutive: env.payload.consecutive,
        },
      });
    },
  );

  // 5. finished
  onEnvelope<ExplorationFinishedPayload>(
    EXPLORATION_EVENT_NAMES.FINISHED,
    (env) => {
      deps.broadcaster.publish(env.payload.runId, {
        v: 1,
        type: 'finished',
        ts: env.occurredAt,
        correlationId: env.correlationId ?? null,
        data: {
          runId: env.payload.runId,
          reason: env.payload.reason,
          stats: env.payload.stats,
        },
      });
    },
  );

  // 6. failed → error (renamed for client clarity)
  onEnvelope<ExplorationFailedPayload>(
    EXPLORATION_EVENT_NAMES.FAILED,
    (env) => {
      deps.broadcaster.publish(env.payload.runId, {
        v: 1,
        type: 'error',
        ts: env.occurredAt,
        correlationId: env.correlationId ?? null,
        data: {
          runId: env.payload.runId,
          message: `[${env.payload.step}] ${env.payload.reason}`,
        },
      });
    },
  );

  return () => {
    for (const off of offs) off();
  };
}
