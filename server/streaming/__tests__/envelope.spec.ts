/**
 * Phase 22 / Plan 22-03 — Envelope schema + subscriber drop-path unit spec.
 *
 * Non-DB, fast-feedback tests that prove:
 *   - wsEnvelopeSchema.safeParse correctly identifies valid/invalid candidates.
 *   - Missing required fields (correlationId, v, ts) produce structured errors.
 *   - Wrong v value (literal 1 required) produces a structured error.
 *   - Valid envelope passes + returns typed data.
 *
 * The subscriber-side drop path (emit.frameDropped + structured log + skip
 * broadcaster.emit) is tested integration-style in subscriber.spec (Task 3.1)
 * and correlation.spec (Task 3.2); this spec covers the pure schema contract.
 */
import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';

import { wsEnvelopeSchema } from '../internal/ws-schemas.js';

function validCandidate(): unknown {
  return {
    type: 'log',
    correlationId: randomUUID(),
    v: 1,
    ts: new Date().toISOString(),
    payload: { line: 'hello', stream: 'stdout' },
  };
}

describe('[Phase 22-03] wsEnvelopeSchema safeParse', () => {
  it('accepts a valid envelope candidate', () => {
    const parsed = wsEnvelopeSchema.safeParse(validCandidate());
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.type).toBe('log');
      expect(parsed.data.v).toBe(1);
      expect(parsed.data.correlationId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    }
  });

  it('rejects when correlationId is missing', () => {
    const candidate = validCandidate() as Record<string, unknown>;
    delete candidate.correlationId;
    const parsed = wsEnvelopeSchema.safeParse(candidate);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const paths = parsed.error.issues.map((issue) => issue.path.join('.'));
      expect(paths).toContain('correlationId');
    }
  });

  it('rejects when correlationId is not a UUID', () => {
    const candidate = validCandidate() as Record<string, unknown>;
    candidate.correlationId = 'not-a-uuid';
    const parsed = wsEnvelopeSchema.safeParse(candidate);
    expect(parsed.success).toBe(false);
  });

  it('rejects when v is missing', () => {
    const candidate = validCandidate() as Record<string, unknown>;
    delete candidate.v;
    const parsed = wsEnvelopeSchema.safeParse(candidate);
    expect(parsed.success).toBe(false);
  });

  it('rejects when v is not literal 1', () => {
    const candidate = validCandidate() as Record<string, unknown>;
    candidate.v = 2;
    const parsed = wsEnvelopeSchema.safeParse(candidate);
    expect(parsed.success).toBe(false);
  });

  it('rejects when ts is missing', () => {
    const candidate = validCandidate() as Record<string, unknown>;
    delete candidate.ts;
    const parsed = wsEnvelopeSchema.safeParse(candidate);
    expect(parsed.success).toBe(false);
  });

  it('rejects when ts is not an ISO datetime string', () => {
    const candidate = validCandidate() as Record<string, unknown>;
    candidate.ts = '2026-04-22'; // missing time portion
    const parsed = wsEnvelopeSchema.safeParse(candidate);
    expect(parsed.success).toBe(false);
  });

  it('rejects when type is empty string', () => {
    const candidate = validCandidate() as Record<string, unknown>;
    candidate.type = '';
    const parsed = wsEnvelopeSchema.safeParse(candidate);
    expect(parsed.success).toBe(false);
  });

  it('accepts arbitrary payload shape (z.unknown())', () => {
    const variants: unknown[] = [
      { ...(validCandidate() as object), payload: null },
      { ...(validCandidate() as object), payload: 'string payload' },
      { ...(validCandidate() as object), payload: 42 },
      { ...(validCandidate() as object), payload: { nested: { deep: true } } },
      { ...(validCandidate() as object), payload: [1, 2, 3] },
    ];
    for (const v of variants) {
      const parsed = wsEnvelopeSchema.safeParse(v);
      expect(
        parsed.success,
        `payload variant ${JSON.stringify((v as { payload: unknown }).payload)} should pass`,
      ).toBe(true);
    }
  });
});
