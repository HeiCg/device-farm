/**
 * Phase 15 / Plan 15-04 / Task 4.1 — envelopeSchema runtime behavior.
 *
 * Proves the shared envelope (created in plan 15-01):
 *   - Accepts fully-populated envelopes with v: 1 (SPEC-10).
 *   - Rejects `v: 2` (literal enforcement — the v2 shape will live in a discriminated union).
 *   - Tolerates additive extra fields (`.looseObject`) without throwing (SPEC-08).
 *   - Rejects malformed correlationId.
 */
import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ZodError } from 'zod';

import { envelopeSchema } from '../envelope.js';

function baseEnvelope() {
  return {
    id: randomUUID(),
    type: 'demo.happened',
    v: 1 as const,
    correlationId: randomUUID(),
    causationId: null,
    occurredAt: new Date().toISOString(),
    aggregateType: 'demo',
    aggregateId: randomUUID(),
    actor: 'anonymous',
    payload: { value: 1 },
  };
}

describe('envelopeSchema', () => {
  it('accepts a fully-populated envelope with v:1 and returns parsed value', () => {
    const input = baseEnvelope();
    const parsed = envelopeSchema.parse(input);
    expect(parsed.v).toBe(1);
    expect(parsed.id).toBe(input.id);
    expect(parsed.correlationId).toBe(input.correlationId);
  });

  it('rejects envelopes with v:2 (literal 1 enforced)', () => {
    const bad = { ...baseEnvelope(), v: 2 };
    expect(() => envelopeSchema.parse(bad)).toThrow(ZodError);
  });

  it('tolerates additive extra fields without throwing (.looseObject)', () => {
    const extra = { ...baseEnvelope(), additiveField: 'x', traceparent: 'abc' };
    const parsed: Record<string, unknown> = envelopeSchema.parse(extra);
    // Extra fields pass through looseObject verbatim
    expect(parsed.additiveField).toBe('x');
    expect(parsed.traceparent).toBe('abc');
    expect(parsed.v).toBe(1);
  });

  it('rejects malformed correlationId (not a UUID)', () => {
    const bad = { ...baseEnvelope(), correlationId: 'not-a-uuid' };
    expect(() => envelopeSchema.parse(bad)).toThrow(ZodError);
  });
});
