/**
 * Phase 37 Plan 37-01 — analysis events surface.
 *
 * 1 event: analysis.ingested (TRACE-08: NOT persisted — derivable from
 * the analyses table; emitted for subscribers that want to react on
 * fresh ingest without polling).
 *
 * Mirror shape: server/azure/events.ts + server/explorations/events.ts.
 */

import { z } from 'zod';

import { createEventHelpers } from '../bus/helpers.js';
import type { TypedBus } from '../bus/bus.js';
import type { EventRegistry } from '../bus/types.js';
import type { Envelope } from '../events/envelope.js';

export const ANALYSIS_AGGREGATE_TYPE = 'build' as const;

export const ANALYSIS_EVENT_NAMES = {
  INGESTED: 'analysis.ingested',
} as const;

export type AnalysisEventName =
  (typeof ANALYSIS_EVENT_NAMES)[keyof typeof ANALYSIS_EVENT_NAMES];

export const analysisIngestedPayloadSchema = z.object({
  analysisId: z.string().uuid(),
  jobId: z.string().uuid().nullable(),
  platform: z.enum(['android', 'ios']),
});
export type AnalysisIngestedPayload = z.infer<typeof analysisIngestedPayloadSchema>;

export const analysisRegistry = {
  [ANALYSIS_EVENT_NAMES.INGESTED]: {
    schema: analysisIngestedPayloadSchema,
    persisted: false, // TRACE-08 — derivable from analyses table
    aggregateType: ANALYSIS_AGGREGATE_TYPE,
  },
} as const satisfies EventRegistry;

export type AnalysisRegistry = typeof analysisRegistry;

export function makeAnalysisEmitters(
  bus: TypedBus<AnalysisRegistry>,
  onEmit?: (envelope: Envelope) => void,
) {
  const emit = createEventHelpers(bus, onEmit);
  return {
    ingested: emit(ANALYSIS_EVENT_NAMES.INGESTED),
  };
}

export type AnalysisEmitters = ReturnType<typeof makeAnalysisEmitters>;
