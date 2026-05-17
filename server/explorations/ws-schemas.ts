/**
 * Explorations WS envelope — Phase 35 Plan 35-03.
 *
 * Strict discriminated union of 6 frame variants streamed on
 * `/api/explorations/:id/events`. Mirrors the Phase 22 streaming envelope
 * shape (v:1, ts ISO datetime, correlationId TRACE-06) but with a
 * type-discriminated `data` payload — broadcaster consumers can narrow on
 * `frame.type` to read the typed payload directly without re-parsing.
 *
 * Six variants (matches Phase 35 CONTEXT brief + RESEARCH §WS Event Stream):
 *   - screen-discovered  ← exploration.screen.discovered bus event
 *   - transition         ← exploration.transition.recorded bus event
 *   - tool-call          ← exploration.tool.called bus event
 *   - stuck              ← exploration.stuck bus event
 *   - finished           ← exploration.finished bus event
 *   - error              ← exploration.failed bus event (renamed for client clarity)
 *
 * `exploration.started` is NOT a WS frame variant — it fires from the REST
 * POST handler before any WS subscriber would have connected. Clients learn
 * the run exists by polling `GET /api/explorations/:id` (the row is
 * INSERTed before the 201 returns).
 *
 * `correlationId` is nullable — the bus envelope's correlationId is null
 * when no ALS fiber is active (e.g., agent runner kicked off from a
 * pg-boss worker without correlation plugin restoration). The TRACE-06
 * contract requires the field to be PRESENT (not absent); null is the
 * "no correlation context available" sentinel.
 */
import { z } from 'zod';

const baseFrame = z.object({
  v: z.literal(1),
  ts: z.string().datetime({ offset: true }),
  correlationId: z.string().uuid().nullable(),
});

export const wsScreenDiscoveredFrame = baseFrame.extend({
  type: z.literal('screen-discovered'),
  data: z.object({
    runId: z.string().uuid(),
    screenId: z.string().min(1),
    title: z.string(),
    bfsDepth: z.number().int().nonnegative(),
    screenshotArtifactId: z.string().uuid(),
  }),
});

export const wsTransitionFrame = baseFrame.extend({
  type: z.literal('transition'),
  data: z.object({
    runId: z.string().uuid(),
    fromScreenId: z.string().min(1),
    toScreenId: z.string().min(1),
    action: z.record(z.string(), z.unknown()),
    isBackEdge: z.boolean(),
  }),
});

export const wsToolCallFrame = baseFrame.extend({
  type: z.literal('tool-call'),
  data: z.object({
    runId: z.string().uuid(),
    name: z.string().min(1),
    args: z.record(z.string(), z.unknown()),
    durationMs: z.number().int().nonnegative(),
  }),
});

export const wsStuckFrame = baseFrame.extend({
  type: z.literal('stuck'),
  data: z.object({
    runId: z.string().uuid(),
    screenId: z.string().min(1),
    consecutive: z.number().int().min(1),
  }),
});

export const wsFinishedFrame = baseFrame.extend({
  type: z.literal('finished'),
  data: z.object({
    runId: z.string().uuid(),
    reason: z.enum(['complete', 'budget', 'stuck', 'login_required', 'cancelled']),
    stats: z.object({
      screensDiscovered: z.number().int().nonnegative(),
      transitionsTotal: z.number().int().nonnegative(),
      tapsTaken: z.number().int().nonnegative(),
      durationMs: z.number().int().nonnegative(),
    }),
  }),
});

export const wsErrorFrame = baseFrame.extend({
  type: z.literal('error'),
  data: z.object({
    runId: z.string().uuid(),
    message: z.string().min(1),
  }),
});

export const wsExplorationFrameSchema = z.discriminatedUnion('type', [
  wsScreenDiscoveredFrame,
  wsTransitionFrame,
  wsToolCallFrame,
  wsStuckFrame,
  wsFinishedFrame,
  wsErrorFrame,
]);

export type WsExplorationFrame = z.infer<typeof wsExplorationFrameSchema>;
export type WsScreenDiscoveredFrame = z.infer<typeof wsScreenDiscoveredFrame>;
export type WsTransitionFrame = z.infer<typeof wsTransitionFrame>;
export type WsToolCallFrame = z.infer<typeof wsToolCallFrame>;
export type WsStuckFrame = z.infer<typeof wsStuckFrame>;
export type WsFinishedFrame = z.infer<typeof wsFinishedFrame>;
export type WsErrorFrame = z.infer<typeof wsErrorFrame>;
