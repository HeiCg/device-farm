/**
 * Phase 15 / Plan 15-01 / Task 1.3 — SPEC-04 spike: JSONB round-trip.
 *
 * Gates the v3.0 Phase 15 exit criterion that drizzle-zod + Zod 4 +
 * Postgres jsonb preserve semantic equivalence on `jobs.metadata`.
 *
 * Postgres jsonb DOES NOT preserve key-order or duplicate keys (see
 * Postgres 18 docs §8.14). Therefore the assertions use deep-equal
 * (`toEqual`), never `JSON.stringify` equality — that would be a false-
 * positive failure (see RESEARCH §7 Pitfall #3).
 *
 * Skipped when no TEST_DATABASE_URL is set, to keep CI without a DB
 * green. When run, the test inserts a nested object, selects it back,
 * and asserts deep equality plus key-set preservation.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { jobs } from '../schema.js';
import { createDb } from '../index.js';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const HAS_DB = typeof TEST_DATABASE_URL === 'string' && TEST_DATABASE_URL.length > 0;

if (!HAS_DB) {
  // eslint-disable-next-line no-console
  console.warn('[jsonb-roundtrip.spec] SKIPPED: set TEST_DATABASE_URL to run');
}

describe.skipIf(!HAS_DB)('jobs.metadata JSONB round-trip (SPEC-04)', () => {
  let db: ReturnType<typeof createDb>['db'];
  let client: ReturnType<typeof createDb>['client'];
  const insertedIds: string[] = [];

  beforeAll(() => {
    const h = createDb(TEST_DATABASE_URL!);
    db = h.db;
    client = h.client;
  });

  afterEach(async () => {
    // Clean up inserted rows to keep the jobs table tidy.
    for (const id of insertedIds.splice(0)) {
      await db.delete(jobs).where(eq(jobs.id, id));
    }
  });

  afterAll(async () => {
    await client.end();
  });

  it('preserves semantic equivalence via toEqual across INSERT → SELECT', async () => {
    const input = {
      b: 2,
      a: 1,
      nested: { c: [1, 2, 3], d: { deep: true } },
      arr: [{ x: 1 }, { y: 2 }],
      unicode: 'café',
      nullField: null,
    };

    const [row] = await db
      .insert(jobs)
      .values({ platform: 'android', metadata: input })
      .returning();
    insertedIds.push(row.id);

    const fetched = await db.select().from(jobs).where(eq(jobs.id, row.id));
    expect(fetched).toHaveLength(1);
    expect(fetched[0].metadata).toEqual(input);
  });

  it('preserves keyset (order not asserted — Postgres jsonb does not guarantee key order)', async () => {
    const input = {
      b: 2,
      a: 1,
      nested: { c: [1, 2, 3], d: { deep: true } },
      arr: [{ x: 1 }, { y: 2 }],
      unicode: 'café',
      nullField: null,
    };

    const [row] = await db
      .insert(jobs)
      .values({ platform: 'android', metadata: input })
      .returning();
    insertedIds.push(row.id);

    const fetched = await db.select().from(jobs).where(eq(jobs.id, row.id));
    expect(Object.keys(fetched[0].metadata as object).sort())
      .toEqual(Object.keys(input).sort());
  });

  it('documents duplicate-key semantic (JSON.parse last-wins matches Postgres jsonb)', () => {
    // Can't craft duplicate keys from a JS object literal (JS objects unique).
    // Parsing "{\"a\":1,\"a\":2}" yields {a:2} — last-wins. Postgres jsonb
    // behaves identically (per §8.14). This is documentation-as-test.
    const input = JSON.parse('{"a": 1, "a": 2}');
    expect(input).toEqual({ a: 2 });
  });

  it('round-trips unicode, null, and array-of-objects via deep-equal', async () => {
    const input = {
      emoji: 'neutral',
      chinese: 'café',
      nullField: null,
      list: [{ k: 'v1' }, { k: 'v2' }, { k: null }],
    };

    const [row] = await db
      .insert(jobs)
      .values({ platform: 'ios', metadata: input })
      .returning();
    insertedIds.push(row.id);

    const fetched = await db.select().from(jobs).where(eq(jobs.id, row.id));
    expect(fetched[0].metadata).toEqual(input);
  });
});
