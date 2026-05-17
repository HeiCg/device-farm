/**
 * Phase 18 / Plan 18-03 — lifecycle graceful shutdown DB-gated spec.
 *
 * Proves ROADMAP §Phase 18 SC4:
 *   "Graceful shutdown drains in-flight schedule jobs inside the configured
 *    timeout without dropping work."
 *
 * Scope of THIS spec: shutdown-path correctness when NO task is in-flight
 * (typical case — production schedules fire daily/hourly, not during a test run).
 * The queue plugin's onClose hook (Phase 15 Plan 15-05) owns the actual
 * drain budget via boss.stop({graceful: true, timeout: 30_000}); lifecycle's
 * onClose just needs to offWork the 3 workers ASAP so no new work is accepted
 * while boss.stop drains any in-flight fire. RESEARCH §Pitfall 5 notes the
 * path is FAST (offWork is near-instant).
 *
 * Gated on TEST_DATABASE_URL / DATABASE_URL. Isolated pg-boss schema.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';

import { correlationPlugin } from '../../correlation/index.js';
import busPlugin from '../../bus/plugin.js';
import queuePlugin from '../../queue/plugin.js';
import lifecyclePlugin from '../plugin.js';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const HAS_DB = typeof TEST_DATABASE_URL === 'string' && TEST_DATABASE_URL.length > 0;
const SCHEMA = 'pgboss_lifecycle_shutdown_spec';

if (!HAS_DB) {
  // eslint-disable-next-line no-console
  console.warn('[lifecycle/graceful-shutdown.spec] SKIPPED: set TEST_DATABASE_URL to run');
}

function makeStubConfigPlugin(databaseUrl: string) {
  return fp(async (fastify: FastifyInstance) => {
    fastify.decorate('config', {
      database_url: databaseUrl,
      storage: {
        artifacts: {
          path: '/tmp/artifacts-shutdown-spec',
          retention_days: 30,
          compress_after_days: 7,
          format: 'mp4' as const,
          max_storage_gb: 50,
        },
      },
    } as never);
  }, { name: 'config' });
}

describe.skipIf(!HAS_DB)('lifecycle graceful shutdown (Phase 18-03)', () => {
  let client: ReturnType<typeof postgres>;
  const unhandledRejections: unknown[] = [];
  const rejectionListener = (reason: unknown) => { unhandledRejections.push(reason); };

  beforeAll(async () => {
    client = postgres(TEST_DATABASE_URL!);
    await client.unsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await client.unsafe(`DROP SCHEMA IF EXISTS ${SCHEMA}_idempotent CASCADE`);
    process.on('unhandledRejection', rejectionListener);
  });

  afterAll(async () => {
    process.off('unhandledRejection', rejectionListener);
    await client?.unsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`).catch(() => { /* ignore */ });
    await client?.unsafe(`DROP SCHEMA IF EXISTS ${SCHEMA}_idempotent CASCADE`).catch(() => { /* ignore */ });
    await client?.end();
  });

  it('[SC4] app.close() resolves within 10s after lifecycle plugin registered', async () => {
    const app = Fastify({ logger: false });

    // Register a real db plugin so lifecycle's persistEnvelope has a valid fastify.db.
    const db = drizzle(client);
    const liveDbPlugin = fp(async (fastify) => {
      fastify.decorate('db', db as never);
    }, { name: 'db' });

    await app.register(makeStubConfigPlugin(TEST_DATABASE_URL!));
    await app.register(liveDbPlugin);
    await app.register(correlationPlugin);
    await app.register(busPlugin);
    await app.register(queuePlugin, { schema: SCHEMA });
    await app.register(lifecyclePlugin);
    await app.ready();

    const started = Date.now();
    await app.close();
    const elapsedMs = Date.now() - started;

    expect(elapsedMs).toBeLessThan(10_000);
  }, 30_000);

  it('[SC4 idempotency] second app.close() on an already-closed app resolves without throwing', async () => {
    const app = Fastify({ logger: false });

    const db = drizzle(client);
    const liveDbPlugin = fp(async (fastify) => {
      fastify.decorate('db', db as never);
    }, { name: 'db' });

    await app.register(makeStubConfigPlugin(TEST_DATABASE_URL!));
    await app.register(liveDbPlugin);
    await app.register(correlationPlugin);
    await app.register(busPlugin);
    await app.register(queuePlugin, { schema: SCHEMA + '_idempotent' });
    await app.register(lifecyclePlugin);
    await app.ready();

    await expect(app.close()).resolves.toBeUndefined();
    // Fastify itself guards double-close at the framework layer; lifecycle's module.shutdown()
    // has a `stopped` flag guard as belt-and-suspenders.
    await expect(app.close()).resolves.toBeUndefined();
  }, 30_000);

  it('no unhandled rejections surface after shutdown', async () => {
    // `unhandledRejections` accumulates across tests in beforeAll; assert empty at
    // the END of the describe block. If a fire-and-forget promise in persistEnvelope
    // or offWork rejects silently, it lands here.
    expect(unhandledRejections).toEqual([]);
  });
});
