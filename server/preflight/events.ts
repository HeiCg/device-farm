/**
 * Phase 37 Plan 37-02 — preflight event registry + typed emitters.
 *
 * One event: preflight.completed (persisted, aggregateType='preflight').
 *
 * Allowlisted by eslint-local-rules/no-direct-bus-emit (`/events\.ts$`).
 * Every cross-module subscriber should reference PREFLIGHT_EVENT_NAMES.COMPLETED.
 */
import { z } from 'zod';

import { createEventHelpers } from '../bus/helpers.js';
import type { TypedBus } from '../bus/bus.js';
import type { EventRegistry } from '../bus/types.js';
import type { Envelope } from '../events/envelope.js';

export const PREFLIGHT_AGGREGATE_TYPE = 'preflight' as const;

export const PREFLIGHT_EVENT_NAMES = {
  COMPLETED: 'preflight.completed',
} as const;

export type PreflightEventName =
  (typeof PREFLIGHT_EVENT_NAMES)[keyof typeof PREFLIGHT_EVENT_NAMES];

export const preflightCompletedPayloadSchema = z.object({
  preflightRunId: z.string().uuid(),
  status: z.enum(['pass', 'pass_with_warnings', 'blocked']),
  rulesVersion: z.string(),
  blockerCount: z.number().int().nonnegative(),
  warningCount: z.number().int().nonnegative(),
});
export type PreflightCompletedPayload = z.infer<typeof preflightCompletedPayloadSchema>;

export const preflightRegistry = {
  [PREFLIGHT_EVENT_NAMES.COMPLETED]: {
    schema: preflightCompletedPayloadSchema,
    persisted: true,
    aggregateType: PREFLIGHT_AGGREGATE_TYPE,
  },
} as const satisfies EventRegistry;

export type PreflightRegistry = typeof preflightRegistry;

export function makePreflightEmitters(
  bus: TypedBus<PreflightRegistry>,
  onEmit?: (envelope: Envelope) => void,
) {
  const emit = createEventHelpers(bus, onEmit);
  return {
    completed: emit(PREFLIGHT_EVENT_NAMES.COMPLETED),
  };
}

export type PreflightEmitters = ReturnType<typeof makePreflightEmitters>;
