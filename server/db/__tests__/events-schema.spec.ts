/**
 * Phase 15 / Plan 15-01 / Task 1.1 — events table schema introspection spec.
 *
 * Verifies that the Postgres `public.events` table exists with exactly the
 * 10 columns and 4 non-PK indexes that TRACE-07 requires.
 *
 * Prerequisite: the latest Drizzle migration has been applied to
 * TEST_DATABASE_URL (run `npx drizzle-kit push` or the generated migration
 * SQL against the test DB before running this spec).
 *
 * This test is gated on TEST_DATABASE_URL — when absent, it skips with a
 * clear reason (CI without a DB must not fail hard).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { events } from '../schema.js';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const HAS_DB = typeof TEST_DATABASE_URL === 'string' && TEST_DATABASE_URL.length > 0;

if (!HAS_DB) {
  // eslint-disable-next-line no-console
  console.warn('[events-schema.spec] SKIPPED: set TEST_DATABASE_URL to run');
}

describe.skipIf(!HAS_DB)('events table schema (TRACE-07)', () => {
  let client: ReturnType<typeof postgres>;

  beforeAll(() => {
    client = postgres(TEST_DATABASE_URL!);
  });

  afterAll(async () => {
    await client.end();
  });

  it('exports events table from schema module', () => {
    expect(events).toBeDefined();
  });

  it('creates public.events table after migration', async () => {
    const rows = await client<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'events'
    `;
    expect(rows).toHaveLength(1);
  });

  it('has all 10 expected columns with correct types', async () => {
    const rows = await client<{ column_name: string; data_type: string }[]>`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'events'
      ORDER BY column_name
    `;

    const byName = new Map(rows.map((r) => [r.column_name, r.data_type]));

    expect(byName.get('id')).toBe('uuid');
    expect(byName.get('event_type')).toBe('character varying');
    expect(byName.get('event_version')).toBe('integer');
    expect(byName.get('correlation_id')).toBe('uuid');
    expect(byName.get('causation_id')).toBe('uuid');
    expect(byName.get('aggregate_type')).toBe('character varying');
    expect(byName.get('aggregate_id')).toBe('uuid');
    expect(byName.get('payload')).toBe('jsonb');
    expect(byName.get('occurred_at')).toBe('timestamp with time zone');
    expect(byName.get('actor')).toBe('character varying');

    // No extra columns beyond the 10 above
    expect(rows).toHaveLength(10);
  });

  it('has the 4 expected non-PK indexes', async () => {
    const rows = await client<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'events'
      ORDER BY indexname
    `;

    const names = rows.map((r) => r.indexname);
    expect(names).toContain('events_correlation_id_idx');
    expect(names).toContain('events_event_type_idx');
    expect(names).toContain('events_occurred_at_idx');
    expect(names).toContain('events_aggregate_idx');
  });
});
