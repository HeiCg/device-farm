/**
 * Phase 20 / Plan 20-04 — Pool correlation DB-gated spec (SC4 proof).
 *
 * Proves correlationId threads from an ALS fiber → emit helper →
 * envelope → events-table row for the only persisted pool event
 * (device.health.failed). Also proves aggregate_id is the deviceId
 * (NOT POOL_AGGREGATE_ID) per events.ts registry convention.
 *
 * 20-CONTEXT §Specifics: uses CANONICAL plain-object ALS store shape.
 * Legacy Map form (`new Map([['correlationId', cid]])`) is explicitly
 * forbidden in new pool specs (enforced by grep gate + grep count = 0).
 *
 * DB-gated via TEST_DATABASE_URL or DATABASE_URL (skipIf). Uses isolated
 * pgboss_pool_correlation_<suffix> schema to avoid cross-file contention.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { and, eq } from 'drizzle-orm';
import { asyncLocalStorage } from '@fastify/request-context';

import correlationPlugin from '../../correlation/plugin.js';
import eventBusPlugin from '../../bus/plugin.js';
import queuePlugin from '../../queue/plugin.js';
import poolPlugin from '../plugin.js';
import { events as eventsTable } from '../../db/schema.js';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const HAS_DB = typeof TEST_DATABASE_URL === 'string' && TEST_DATABASE_URL.length > 0;
const SCHEMA = `pgboss_pool_correlation_${Math.random().toString(36).slice(2, 8)}`;

if (!HAS_DB) {
  // eslint-disable-next-line no-console
  console.warn('[pool/correlation.spec] SKIPPED: set TEST_DATABASE_URL or DATABASE_URL to run');
}

describe.skipIf(!HAS_DB)('[Phase 20-04] pool correlation proof (SC4)', () => {
  let app: FastifyInstance;
  let sqlClient: ReturnType<typeof postgres>;

  beforeAll(async () => {
    sqlClient = postgres(TEST_DATABASE_URL!);
    await sqlClient.unsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);

    const db = drizzle(sqlClient);

    // Stub config: pool drivers disabled (android/ios) so poolPlugin boots
    // without attempting to create real emulators/simulators.
    const stubConfigPlugin = fp(async (fastify: FastifyInstance) => {
      fastify.decorate('config', {
        database_url: TEST_DATABASE_URL!,
        pool: {
          max_devices: 10,
          android: { enabled: false, max_instances: 0 },
          ios: { enabled: false, max_instances: 0 },
        },
      } as never);
    }, { name: 'config' });

    const liveDbPlugin = fp(async (fastify: FastifyInstance) => {
      fastify.decorate('db', db as unknown as FastifyInstance['db']);
    }, { name: 'db' });

    app = Fastify({ logger: false, pluginTimeout: 60_000 });
    await app.register(stubConfigPlugin);
    await app.register(correlationPlugin);
    await app.register(liveDbPlugin);
    await app.register(eventBusPlugin);
    await app.register(queuePlugin, { schema: SCHEMA });
    await app.register(poolPlugin);
    await app.ready();
  }, 60_000);

  afterAll(async () => {
    await app?.close().catch(() => { /* ignore */ });
    await sqlClient?.unsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`).catch(() => { /* ignore */ });
    await sqlClient?.end();
  }, 30_000);

  it('[SC4] emit.healthFailed envelope carries ALS correlationId', async () => {
    const cid = randomUUID();
    const deviceId = randomUUID();

    const envelope = await asyncLocalStorage.run(
      { correlationId: cid, currentEventId: null, actor: 'test-actor' } as never,
      () => app.poolModule.emit.healthFailed(deviceId, {
        deviceId, platform: 'android', reason: 'unhealthy',
        failureCount: 1, willReplace: false, lastError: null,
      }),
    );

    expect(envelope.correlationId).toBe(cid);
    expect(envelope.type).toBe('device.health.failed');
    expect(envelope.aggregateType).toBe('pool');
    // Per-device aggregateId (NOT POOL_AGGREGATE_ID) — emit helper takes deviceId
    // as aggregateId arg in createEventHelpers (plan 20-01 MOD-03).
    expect(envelope.aggregateId).toBe(deviceId);
    expect(envelope.actor).toBe('test-actor');
  });

  it('[SC4] emit.healthFailed persists a row with correlation_id + aggregate_type=pool + aggregate_id=deviceId', async () => {
    const cid = randomUUID();
    const deviceId = randomUUID();

    const envelope = await asyncLocalStorage.run(
      { correlationId: cid, currentEventId: null, actor: 'health-checker' } as never,
      () => app.poolModule.emit.healthFailed(deviceId, {
        deviceId, platform: 'ios', reason: 'zombie',
        failureCount: 0, willReplace: true, lastError: 'stuck in D state',
      }),
    );

    // persistEnvelope uses fire-and-forget `void (async () => db.insert(events)...)()`
    // — poll for the row to appear (matches reporting/terminal-event.spec pattern).
    let rows: Array<typeof eventsTable.$inferSelect> = [];
    for (let i = 0; i < 30; i++) {
      rows = await app.db
        .select()
        .from(eventsTable)
        .where(eq(eventsTable.id, envelope.id));
      if (rows.length > 0) break;
      await new Promise((r) => setTimeout(r, 100));
    }

    expect(rows).toHaveLength(1);
    expect(rows[0].correlationId).toBe(cid);
    expect(rows[0].aggregateType).toBe('pool');
    // Per-device aggregateId — NOT POOL_AGGREGATE_ID.
    expect(rows[0].aggregateId).toBe(deviceId);
    expect(rows[0].eventType).toBe('device.health.failed');
    expect(rows[0].actor).toBe('health-checker');
    const payload = rows[0].payload as {
      deviceId: string;
      platform: string;
      reason: string;
      failureCount: number;
      willReplace: boolean;
      lastError: string | null;
    };
    expect(payload).toMatchObject({
      deviceId, platform: 'ios', reason: 'zombie',
      failureCount: 0, willReplace: true, lastError: 'stuck in D state',
    });
  }, 10_000);

  it('[SC4] non-persisted events (device.state.changed / allocated / released) do NOT create events-table rows', async () => {
    const cid = randomUUID();
    const deviceId = randomUUID();

    await asyncLocalStorage.run(
      { correlationId: cid, currentEventId: null, actor: 'test' } as never,
      async () => {
        app.poolModule.emit.stateChanged(deviceId, { deviceId, from: 'booting', to: 'idle' });
        app.poolModule.emit.allocated(deviceId, { deviceId, jobId: 'job-x', platform: 'android' });
        app.poolModule.emit.released(deviceId, { deviceId, jobId: 'job-x', platform: 'android' });
      },
    );

    // Wait a beat to let any fire-and-forget persist catch up (should be 0 but
    // polling the absence prevents race conditions).
    await new Promise((r) => setTimeout(r, 300));

    // Query ONLY by this test's ephemeral deviceId to avoid cross-test pollution.
    // Only health.failed persists; state.changed/allocated/released do NOT (TRACE-08).
    const rows = await app.db
      .select()
      .from(eventsTable)
      .where(and(
        eq(eventsTable.aggregateId, deviceId),
        eq(eventsTable.correlationId, cid),
      ));

    expect(rows).toHaveLength(0);
  });

  it('[TRACE-04] emit.healthFailed OUTSIDE ALS fiber generates fresh correlationId (fallback)', () => {
    const deviceId = randomUUID();

    // No asyncLocalStorage.run wrapper — directly call emit. createEventHelpers
    // falls back to `randomUUID()` for correlationId and 'anonymous' for actor
    // when ALS store is absent (server/bus/helpers.ts readAls fallback path).
    const envelope = app.poolModule.emit.healthFailed(deviceId, {
      deviceId, platform: 'android', reason: 'timeout',
      failureCount: 0, willReplace: false, lastError: 'driver.isHealthy timed out',
    });

    // UUID v4 shape — crypto.randomUUID() guarantees version 4 + RFC 4122 variant bits.
    expect(envelope.correlationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    // actor defaults to 'anonymous' (createEventHelpers fallback) when ALS missing.
    expect(envelope.actor).toBe('anonymous');
  });
});
