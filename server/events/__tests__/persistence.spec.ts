/**
 * Phase 15 / Plan 15-04 / Task 4.3 — persistence middleware integration.
 *
 * Requires a live test Postgres with the latest migration applied. Gated on
 * TEST_DATABASE_URL (falls back to DATABASE_URL). Skips cleanly with a console
 * warning when no DB is configured.
 *
 * Asserts TRACE-08:
 *   - `demo.happened` (persisted: true) INSERTS a row into `events`.
 *   - `demo.thinned`  (persisted: false) does NOT insert a row.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import { events as eventsTable } from '../../db/schema.js';
import { correlationPlugin } from '../../correlation/index.js';
import busPlugin from '../../bus/plugin.js';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const HAS_DB = typeof TEST_DATABASE_URL === 'string' && TEST_DATABASE_URL.length > 0;

if (!HAS_DB) {
  // eslint-disable-next-line no-console
  console.warn('[persistence.spec] SKIPPED: set TEST_DATABASE_URL to run');
}

describe.skipIf(!HAS_DB)('bus persistence middleware (TRACE-08)', () => {
  let app: FastifyInstance;
  let client: ReturnType<typeof postgres>;
  const insertedIds: string[] = [];

  beforeAll(async () => {
    client = postgres(TEST_DATABASE_URL!);
    const db = drizzle(client);

    const liveDbPlugin = fp(
      async (fastify: FastifyInstance) => {
        fastify.decorate('db', db as unknown as FastifyInstance['db']);
      },
      { name: 'db' },
    );

    app = Fastify({ logger: false });
    await app.register(liveDbPlugin);
    await app.register(correlationPlugin);
    await app.register(busPlugin);
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    await client?.end();
  });

  afterEach(async () => {
    if (insertedIds.length > 0) {
      for (const id of insertedIds) {
        await client`DELETE FROM events WHERE id = ${id}`;
      }
      insertedIds.length = 0;
    }
  });

  async function waitForEventRow(id: string, timeoutMs = 2000): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const rows = await client<{ id: string }[]>`
        SELECT id FROM events WHERE id = ${id}
      `;
      if (rows.length > 0) return true;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return false;
  }

  it('inserts a row when the event is flagged persisted:true (demo.happened)', async () => {
    const aggId = randomUUID();
    const env = app.emit('demo.happened')(aggId, { value: 99 });
    insertedIds.push(env.id);

    const found = await waitForEventRow(env.id);
    expect(found).toBe(true);

    // Confirm envelope fields land correctly.
    const db = drizzle(client);
    const rows = await db.select().from(eventsTable).where(eq(eventsTable.id, env.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].eventType).toBe('demo.happened');
    expect(rows[0].correlationId).toBe(env.correlationId);
    expect(rows[0].aggregateId).toBe(aggId);
    expect(rows[0].payload).toEqual({ value: 99 });
  });

  it('does NOT insert a row when the event is flagged persisted:false (demo.thinned)', async () => {
    const aggId = randomUUID();
    const env = app.emit('demo.thinned')(aggId, { id: randomUUID() });

    // Wait a bit to let any stray writes land — they shouldn't.
    await new Promise((resolve) => setTimeout(resolve, 500));

    const rows = await client<{ id: string }[]>`
      SELECT id FROM events WHERE id = ${env.id}
    `;
    expect(rows).toHaveLength(0);
  });
});
