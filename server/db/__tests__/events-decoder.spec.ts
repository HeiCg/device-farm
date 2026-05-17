/**
 * Phase 15 / Plan 15-01 / Task 1.2 — events row decoder spec.
 *
 * Verifies `decodeEventRow`:
 * - Projects a valid Drizzle-shaped row (camelCase, Date timestamp) into
 *   the envelopeSchema shape with `event_type` → `type` rename and
 *   `occurredAt` ISO-8601 conversion.
 * - Rejects malformed rows with a ZodError (empty event type, non-UUID
 *   correlation id).
 * - Tolerates extra fields on the input row (.passthrough / looseObject).
 *
 * NOTE on column naming: the DB column is `event_type` (snake_case), but
 * drizzle-orm's select returns the row keyed by the Drizzle column name
 * (`eventType` camelCase). `createSelectSchema(events)` likewise produces
 * a camelCase-shape Zod schema. The decoder's job is therefore to rename
 * `eventType` → `type` (the envelope spec field) and to coerce
 * `occurredAt` Date → ISO string.
 *
 * This is an in-memory unit test — no DB required. It feeds fabricated
 * rows directly to decodeEventRow so it verifies the decoder contract
 * without depending on TEST_DATABASE_URL.
 */

import { describe, it, expect } from 'vitest';
import { ZodError } from 'zod';
import { decodeEventRow } from '../../events/decoder.js';

// Valid UUID v4 samples (Zod 4's uuid format is strict on version bits).
const ID_EVENT       = '886aeaf3-0964-44ae-ba24-a93b9f9e5625';
const ID_CORRELATION = '5d6ca7d9-610b-4f9e-9e15-34ebd04b7338';
const ID_AGGREGATE   = '613aea46-d255-4458-a581-479a3e416a2f';

// A row as returned by `db.select().from(events)` — camelCase keys, Date
// value for the timestamp column. Matches createSelectSchema(events) shape.
function baseRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: ID_EVENT,
    eventType: 'job.completed',
    eventVersion: 1,
    correlationId: ID_CORRELATION,
    causationId: null,
    aggregateType: 'job',
    aggregateId: ID_AGGREGATE,
    payload: { jobId: 'abc', durationMs: 42, status: 'passed' },
    occurredAt: new Date('2026-04-17T15:00:00.000Z'),
    actor: 'system',
    ...overrides,
  };
}

describe('decodeEventRow — events row projection (SPEC-04)', () => {
  it('parses a valid row into an Envelope shape', () => {
    const decoded = decodeEventRow(baseRow());
    expect(decoded).toMatchObject({
      id: ID_EVENT,
      type: 'job.completed',
      v: 1,
      correlationId: ID_CORRELATION,
      causationId: null,
      aggregateType: 'job',
      aggregateId: ID_AGGREGATE,
      actor: 'system',
      payload: { jobId: 'abc', durationMs: 42, status: 'passed' },
    });
    // occurredAt (Date) → occurredAt (ISO 8601 string)
    expect(decoded.occurredAt).toBe('2026-04-17T15:00:00.000Z');
  });

  it('throws ZodError when eventType is an empty string', () => {
    expect(() => decodeEventRow(baseRow({ eventType: '' }))).toThrowError(ZodError);
  });

  it('throws ZodError when correlationId is not a UUID', () => {
    expect(() => decodeEventRow(baseRow({ correlationId: 'not-a-uuid' }))).toThrowError(ZodError);
  });

  it('tolerates extra fields on the row (looseObject / passthrough)', () => {
    const row = baseRow({ extraField: 'ignore-me', another: 42 });
    const decoded = decodeEventRow(row);
    expect(decoded.type).toBe('job.completed');
  });

  it('renames eventType → type on the envelope', () => {
    const decoded = decodeEventRow(baseRow({ eventType: 'device.booted' }));
    expect(decoded.type).toBe('device.booted');
    expect((decoded as Record<string, unknown>).eventType).toBeUndefined();
  });

  it('preserves correlationId straight through', () => {
    const otherCid = '11111111-2222-4333-8444-555555555555'; // valid v4 uuid
    const row = baseRow({ correlationId: otherCid });
    const decoded = decodeEventRow(row);
    expect(decoded.correlationId).toBe(otherCid);
  });
});
