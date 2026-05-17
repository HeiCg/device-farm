/**
 * Spec for the pg-boss Fastify plugin — Phase 15 Plan 05, Task 5.2.
 *
 * Shape-only assertions: `fastify.boss` and `fastify.queue` are decorated after
 * `fastify.register(queuePlugin)`. DB-dependent because pg-boss.start() opens a
 * Postgres connection — gated on TEST_DATABASE_URL so unit runs without a DB stay green.
 *
 * Satisfies: QUEUE-01 (pg-boss plugin registered, `pgboss` schema isolated).
 *
 * NOTE: each spec file uses its own pg-boss schema (`pgboss_<file_suffix>`) so
 * parallel Vitest workers don't stomp on each other's state.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import postgres from 'postgres';
import { PgBoss } from 'pg-boss';
import { asyncLocalStorage } from '@fastify/request-context';
import { correlationPlugin } from '../../correlation/index.js';
import { queuePlugin, QUEUE_NAMES } from '../index.js';
import { makeStubConfigPlugin, stubDbPlugin } from './test-helpers.js';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const HAS_DB = typeof TEST_DATABASE_URL === 'string' && TEST_DATABASE_URL.length > 0;
/** Per-file schema so parallel Vitest files don't clobber each other's pg-boss state. */
const SCHEMA = 'pgboss_plugin_spec';
const SCHEMA_18 = 'pgboss_queue_plugin_18_spec';

if (!HAS_DB) {
  // eslint-disable-next-line no-console
  console.warn('[queue/plugin.spec] SKIPPED: set TEST_DATABASE_URL to run');
}

describe.skipIf(!HAS_DB)('queue plugin — decorator shape (QUEUE-01)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const sql = postgres(TEST_DATABASE_URL!);
    await sql.unsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await sql.end();

    app = Fastify({ logger: false });
    await app.register(makeStubConfigPlugin(TEST_DATABASE_URL!));
    await app.register(stubDbPlugin);
    await app.register(correlationPlugin);
    await app.register(queuePlugin, { schema: SCHEMA });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    const sql = postgres(TEST_DATABASE_URL!);
    await sql.unsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await sql.end();
  });

  it('decorates fastify.boss as a PgBoss instance', () => {
    expect(app.boss).toBeInstanceOf(PgBoss);
  });

  it('decorates fastify.queue with send / work / schedule methods', () => {
    expect(typeof app.queue.send).toBe('function');
    expect(typeof app.queue.work).toBe('function');
    expect(typeof app.queue.schedule).toBe('function');
  });

  it('creates the pg-boss schema in Postgres after plugin registration', async () => {
    const sql = postgres(TEST_DATABASE_URL!);
    const rows = await sql.unsafe(
      `SELECT schema_name FROM information_schema.schemata WHERE schema_name = '${SCHEMA}'`,
    );
    await sql.end();
    expect(rows.length).toBe(1);
  });
});

/**
 * Phase 18 / Plan 18-00 Task 0.2 — substrate queue.schedule correlationId fix spec.
 *
 * Proves Option B from RESEARCH §Enqueue Wrapper Design: the stored schedule
 * envelope has `correlationId: null` so every scheduled fire gets a fresh UUID
 * at work() time (pg-boss dispatch re-uses the stored envelope on every fire —
 * stamping a UUID at schedule() call would cause all fires to share one id).
 */
describe.skipIf(!HAS_DB)('queue.schedule per-fire correlationId (Phase 18-00)', () => {
  let app: FastifyInstance;
  let client: ReturnType<typeof postgres>;

  beforeAll(async () => {
    client = postgres(TEST_DATABASE_URL!);
    await client.unsafe(`DROP SCHEMA IF EXISTS ${SCHEMA_18} CASCADE`);

    app = Fastify({ logger: false });
    await app.register(makeStubConfigPlugin(TEST_DATABASE_URL!));
    await app.register(stubDbPlugin);
    await app.register(correlationPlugin);
    await app.register(queuePlugin, { schema: SCHEMA_18 });
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    await client?.unsafe(`DROP SCHEMA IF EXISTS ${SCHEMA_18} CASCADE`).catch(() => {});
    await client?.end();
  });

  it('stores envelope with correlationId: null so every fire generates a fresh UUID', async () => {
    const QUEUE = 'test.schedule.correlation-fix';
    await app.boss.createQueue(QUEUE, { policy: 'stately', retryLimit: 1 } as never);
    await app.queue.schedule(QUEUE, '* * * * *', { marker: 'phase-18' });

    const schedules = await app.boss.getSchedules();
    const row = schedules.find((s: { name: string }) => s.name === QUEUE);
    expect(row).toBeDefined();
    // pg-boss stores the envelope under `data`. Per Option B, correlationId must be null.
    expect((row as { data: { correlationId: unknown } }).data.correlationId).toBeNull();
    // The caller-supplied payload rides under envelope.payload.
    expect((row as { data: { payload: { marker: string } } }).data.payload.marker).toBe('phase-18');
    // actor stamped as 'cron' at schedule time (this part didn't change).
    expect((row as { data: { actor: string } }).data.actor).toBe('cron');

    await app.boss.unschedule(QUEUE);
  });

  it('queue.send still injects correlationId from active ALS store (existing behaviour preserved)', async () => {
    const QUEUE = QUEUE_NAMES.DEMO;
    const correlationId = randomUUID();

    // Run send() inside an ALS fiber with the correlationId set.
    const jobId = await asyncLocalStorage.run(
      { correlationId, currentEventId: null, actor: 'test' } as never,
      async () => app.queue.send(QUEUE, { marker: 'als-preserved' }),
    );
    expect(jobId).toBeTruthy();

    // Read back the stored job via pg-boss's internal job table.
    const rows = await client.unsafe<Array<{ data: { correlationId: string; payload: { marker: string } } }>>(
      `SELECT data FROM ${SCHEMA_18}.job WHERE name = $1 AND id = $2`,
      [QUEUE, jobId!],
    );
    expect(rows.length).toBe(1);
    expect(rows[0].data.correlationId).toBe(correlationId);
    expect(rows[0].data.payload.marker).toBe('als-preserved');
  });
});

// ===== Phase 19 / Plan 19-00 Task 0.2 — maintenanceIntervalSeconds passthrough =====
//
// Proves the additive opt forwards verbatim to the PgBoss constructor when set,
// and is omitted when unset (production default — pg-boss applies its own 60s).
// Downstream plans 19-03/19-04 pass {maintenanceIntervalSeconds: 1} so DLQ
// re-insertion lag collapses from 60s → ~1s for bounded test runtime.
//
// Structural assertion strategy: pg-boss v12 stores the merged config on a
// private field (#config) so we cannot read it directly. Instead, we subclass
// PgBoss at module-mock time to capture the constructor args, then assert the
// merged opts shape the plugin passes to `new PgBoss(...)`. This exercises
// the REAL `server/queue/plugin.ts` code path — the plugin is re-imported
// AFTER the spy is installed (via vi.doMock + dynamic import) so the
// `import { PgBoss } from 'pg-boss'` inside plugin.ts resolves to the spied
// class.

describe.skipIf(!HAS_DB)('queuePlugin maintenanceIntervalSeconds passthrough (Phase 19-00)', () => {
  const SCHEMA_A = 'pgboss_queue_plugin_19_spec_a'; // default (opt absent)
  const SCHEMA_B = 'pgboss_queue_plugin_19_spec_b'; // opt = 1

  beforeAll(async () => {
    const sql = postgres(TEST_DATABASE_URL!);
    await sql.unsafe(`DROP SCHEMA IF EXISTS ${SCHEMA_A} CASCADE`);
    await sql.unsafe(`DROP SCHEMA IF EXISTS ${SCHEMA_B} CASCADE`);
    await sql.end();
  });

  afterAll(async () => {
    const sql = postgres(TEST_DATABASE_URL!);
    await sql.unsafe(`DROP SCHEMA IF EXISTS ${SCHEMA_A} CASCADE`).catch(() => {});
    await sql.unsafe(`DROP SCHEMA IF EXISTS ${SCHEMA_B} CASCADE`).catch(() => {});
    await sql.end();
  });

  it('does NOT forward maintenanceIntervalSeconds when opt is absent (pg-boss default 60s)', async () => {
    const { vi } = await import('vitest');
    const actual = await vi.importActual<typeof import('pg-boss')>('pg-boss');
    let recordedArgs: Record<string, unknown> = {};

    class SpiedPgBoss extends actual.PgBoss {
      constructor(cfg: Record<string, unknown>) {
        super(cfg as never);
        recordedArgs = cfg;
      }
    }

    vi.doMock('pg-boss', () => ({
      ...actual,
      PgBoss: SpiedPgBoss,
    }));

    vi.resetModules();
    const pluginModule = await import('../plugin.js');
    const spiedQueuePlugin = pluginModule.default;

    const app = Fastify({ logger: false });
    try {
      await app.register(makeStubConfigPlugin(TEST_DATABASE_URL!));
      await app.register(stubDbPlugin);
      await app.register(correlationPlugin);
      await app.register(spiedQueuePlugin, { schema: SCHEMA_A });
      await app.ready();

      expect(recordedArgs.maintenanceIntervalSeconds).toBeUndefined();
      expect(recordedArgs.schema).toBe(SCHEMA_A);
      expect(recordedArgs.application_name).toBe('device-farm-server');
    } finally {
      await app.close();
      vi.doUnmock('pg-boss');
      vi.resetModules();
    }
  });

  it('forwards maintenanceIntervalSeconds when opt is set (DLQ tests bound to 1s)', async () => {
    const { vi } = await import('vitest');
    const actual = await vi.importActual<typeof import('pg-boss')>('pg-boss');
    let recordedArgs: Record<string, unknown> = {};

    class SpiedPgBoss extends actual.PgBoss {
      constructor(cfg: Record<string, unknown>) {
        super(cfg as never);
        recordedArgs = cfg;
      }
    }

    vi.doMock('pg-boss', () => ({
      ...actual,
      PgBoss: SpiedPgBoss,
    }));

    vi.resetModules();
    const pluginModule = await import('../plugin.js');
    const spiedQueuePlugin = pluginModule.default;

    const app = Fastify({ logger: false });
    try {
      await app.register(makeStubConfigPlugin(TEST_DATABASE_URL!));
      await app.register(stubDbPlugin);
      await app.register(correlationPlugin);
      await app.register(spiedQueuePlugin, {
        schema: SCHEMA_B,
        maintenanceIntervalSeconds: 1,
      });
      await app.ready();

      expect(recordedArgs.maintenanceIntervalSeconds).toBe(1);
      expect(recordedArgs.schema).toBe(SCHEMA_B);
    } finally {
      await app.close();
      vi.doUnmock('pg-boss');
      vi.resetModules();
    }
  });
});
