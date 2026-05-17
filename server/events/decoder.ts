/**
 * Phase 15 / Plan 15-01 — events row decoder (SPEC-04, TRACE-07).
 *
 * `decodeEventRow` projects a raw `events` table row (snake_case columns,
 * Date-typed `occurred_at`) into the shared `envelopeSchema` shape
 * (camelCase, ISO 8601 timestamp). It is the reference pattern for every
 * future module's row decoder — every table in v3.0 gets a decoder like
 * this (RESEARCH §6).
 *
 * drizzle-zod + Zod 4 compatibility: verified working at plan time on
 * drizzle-zod ^0.8.3 + zod ^4.3.6 + drizzle-orm ^0.45.1 (RESEARCH Open
 * Question #1 resolved — no fallback needed). If a future bump breaks
 * this import, fall back to a hand-typed Zod row schema.
 */

import { createSelectSchema } from 'drizzle-zod';
import { events } from '../db/schema.js';
import { envelopeSchema, type Envelope } from './envelope.js';

// Auto-generated row schema from the Drizzle events table definition.
const eventRowSchema = createSelectSchema(events);

export function decodeEventRow(row: unknown): Envelope {
  const parsed = eventRowSchema.parse(row);
  return envelopeSchema.parse({
    id: parsed.id,
    type: parsed.eventType,
    v: parsed.eventVersion,
    correlationId: parsed.correlationId,
    causationId: parsed.causationId,
    occurredAt:
      parsed.occurredAt instanceof Date
        ? parsed.occurredAt.toISOString()
        : parsed.occurredAt,
    aggregateType: parsed.aggregateType,
    aggregateId: parsed.aggregateId,
    actor: parsed.actor,
    payload: parsed.payload,
  });
}
