/**
 * Phase 15 Plan 05, Task 5.3 — pg-boss v12 auto-migration spike.
 *
 * Validates RESEARCH §1 claim that `boss.start()` on a fresh Postgres creates the
 * full pg-boss schema (job, schedule, archive, version, subscription at minimum),
 * and that calling `boss.start()` a second time against an already-migrated DB is
 * idempotent (no error, version count unchanged).
 *
 * This spike runs directly against pg-boss — NOT through the Fastify plugin — so
 * that a failure localises to the library rather than our wrapper.
 *
 * DB-gated via `describe.skipIf(!TEST_DATABASE_URL)`.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PgBoss } from 'pg-boss';
import postgres from 'postgres';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const HAS_DB = typeof TEST_DATABASE_URL === 'string' && TEST_DATABASE_URL.length > 0;
/** Isolated from other queue specs so this file can safely drop-and-recreate. */
const SCHEMA = 'pgboss_migration_spike';

if (!HAS_DB) {
  // eslint-disable-next-line no-console
  console.warn('[queue/migration.spec] SKIPPED: set TEST_DATABASE_URL to run');
}

describe.skipIf(!HAS_DB)('pg-boss v12 auto-migration (QUEUE-01 spike)', () => {
  let sql: ReturnType<typeof postgres>;

  beforeAll(async () => {
    sql = postgres(TEST_DATABASE_URL!);
    await sql.unsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  });

  afterAll(async () => {
    await sql.unsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await sql.end();
  });

  it('creates the pg-boss schema on fresh start', async () => {
    const boss = new PgBoss({
      connectionString: TEST_DATABASE_URL!,
      schema: SCHEMA,
      application_name: 'device-farm-migration-spike',
    });
    await boss.start();
    try {
      const rows = await sql.unsafe<Array<{ table_name: string }>>(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = '${SCHEMA}'`,
      );
      // v12 creates job, schedule, archive, version, subscription, queue, warning, ...
      // Assert at least the research-claimed floor of 5 tables.
      expect(rows.length).toBeGreaterThanOrEqual(5);
      const names = rows.map(r => r.table_name).sort();
      expect(names).toEqual(expect.arrayContaining(['job', 'schedule', 'version']));
    } finally {
      await boss.stop({ graceful: true, timeout: 5_000, destroy: false } as never);
    }
  });

  it('is idempotent on second start (version rowcount unchanged)', async () => {
    const boss1 = new PgBoss({ connectionString: TEST_DATABASE_URL!, schema: SCHEMA });
    await boss1.start();
    const before = await sql.unsafe<Array<{ c: string }>>(
      `SELECT COUNT(*)::text AS c FROM ${SCHEMA}.version`,
    );
    await boss1.stop({ graceful: true, timeout: 5_000, destroy: false } as never);

    const boss2 = new PgBoss({ connectionString: TEST_DATABASE_URL!, schema: SCHEMA });
    await boss2.start();
    const after = await sql.unsafe<Array<{ c: string }>>(
      `SELECT COUNT(*)::text AS c FROM ${SCHEMA}.version`,
    );
    await boss2.stop({ graceful: true, timeout: 5_000, destroy: false } as never);

    expect(after[0].c).toEqual(before[0].c);
  });
});
