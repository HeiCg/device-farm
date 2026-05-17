/**
 * Phase 15 / Plan 15-01 — shared event envelope schema (SPEC-08, SPEC-10,
 * EVENTS-02).
 *
 * Every emitted event is wrapped in this envelope. `.looseObject` is the
 * Zod 4 preferred spelling for `.passthrough()` — it allows additive
 * forward-compat fields without breaking existing consumers (SPEC-08).
 *
 * `v: z.literal(1)` pins the current schema version; a `z.union` keyed
 * on `v` ships when v2 is needed (SPEC-10).
 *
 * Branded-ID tie-in (id / correlationId / aggregateId → branded types)
 * lives in Plan 04's bus wiring. Plan 01 stays on plain uuid strings to
 * keep the decoder dependency-free.
 */

import { z } from 'zod';

export const envelopeSchema = z.looseObject({
  id: z.string().uuid(),
  type: z.string().min(1),
  v: z.literal(1),
  correlationId: z.string().uuid(),
  causationId: z.string().uuid().nullable(),
  occurredAt: z.string().datetime(),
  aggregateType: z.string().min(1),
  aggregateId: z.string().uuid(),
  actor: z.string().min(1),
  payload: z.unknown(),
});

export type Envelope = z.infer<typeof envelopeSchema>;
