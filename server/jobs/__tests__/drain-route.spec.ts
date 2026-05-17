/**
 * Phase 23 / Plan 23-05 — drain-route.spec DB-gated proof of /admin/drain
 * surface (Pitfall 1 corrected — boss.offWork + system_state pattern).
 *
 * Proves:
 *   - POST /admin/drain → 200 + {drained:true, in_flight:0, drained_at:<iso>}
 *     when no jobs in flight; system_state row upserted
 *   - POST /admin/drain rejects requests without a Bearer/X-API-Key (when
 *     auth is enabled) — uses requireAuth wrapping authService.validateKey
 *   - With drain row present, fastify.jobsModule.enqueueJob throws 503
 *     with code='DRAINING' (admission gate from Plan 23-04)
 *   - POST /admin/drain/resume → 200 + {resumed:true}, system_state row deleted
 *   - system.drain.completed event row persisted to events table after drain
 *
 * DB-gated (TEST_DATABASE_URL / DATABASE_URL). Skips cleanly when unset.
 *
 * Mirrors server/reporting/__tests__/dlq-route.spec.ts harness shape.
 */
import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import {
  fastifyZodOpenApiPlugin,
  validatorCompiler,
  serializerCompiler,
} from 'fastify-zod-openapi';

import * as schema from '../../db/schema.js';
import correlationPlugin from '../../correlation/plugin.js';
import busPlugin from '../../bus/plugin.js';
import queuePlugin from '../../queue/plugin.js';
import jobsPlugin from '../plugin.js';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const HAS_DB = typeof TEST_DATABASE_URL === 'string' && TEST_DATABASE_URL.length > 0;
const SCHEMA = `pgboss_jobs_drain_${Math.random().toString(36).slice(2, 8)}`;

if (!HAS_DB) {
  // eslint-disable-next-line no-console
  console.warn('[jobs/drain-route.spec] SKIPPED: set TEST_DATABASE_URL or DATABASE_URL to run');
}

describe.skipIf(!HAS_DB)('POST /admin/drain + /admin/drain/resume [Phase 23-05 / QUEUE-03 / Pitfall 1]', () => {
  let app: FastifyInstance;
  let client: ReturnType<typeof postgres>;

  beforeAll(async () => {
    client = postgres(TEST_DATABASE_URL!);
    await client.unsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);

    // Drain row + events table cleanup (live public-schema tables — drain spec
    // touches them but doesn't own them). DELETE rather than DROP.
    await client`DELETE FROM system_state WHERE key = 'drain_requested_at'`.catch(() => undefined);

    const db = drizzle(client);

    const stubConfigPlugin = fp(async (fastify: FastifyInstance) => {
      fastify.decorate('config', {
        database_url: TEST_DATABASE_URL!,
        auth: { enabled: false },           // disable bearer-auth wrapping; spec validates requireAuth path independently
      } as never);
    }, { name: 'config' });

    const liveDbPlugin = fp(async (fastify: FastifyInstance) => {
      fastify.decorate('db', db as unknown as FastifyInstance['db']);
    }, { name: 'db' });

    // Stub authService — drain spec validates the requireAuth header parsing
    // path; mock validateKey to accept 'test-key' only.
    const stubAuthPlugin = fp(async (fastify: FastifyInstance) => {
      fastify.decorate('authService', {
        validateKey: async (key: string) => key === 'test-key',
      } as never);
    }, { name: 'auth', dependencies: ['db'] });

    // Stub pool plugin — jobs plugin declares 'pool-plugin' dependency.
    // No pool operations exercised here.
    const stubPoolPlugin = fp(async (fastify: FastifyInstance) => {
      fastify.decorate('pool', {
        allocate: async () => null,
        release: async () => undefined,
      } as never);
      fastify.decorate('poolModule', {
        bus: { on: () => () => undefined },
      } as never);
    }, { name: 'pool-plugin', dependencies: ['db'] });

    app = Fastify({ logger: false, pluginTimeout: 60_000 });
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    await app.register(fastifyZodOpenApiPlugin);
    await app.register(stubConfigPlugin);
    await app.register(correlationPlugin);
    await app.register(liveDbPlugin);
    await app.register(busPlugin);
    await app.register(queuePlugin, { schema: SCHEMA });
    await app.register(stubAuthPlugin);
    await app.register(stubPoolPlugin);
    await app.register(jobsPlugin);
    await app.ready();
  }, 60_000);

  afterAll(async () => {
    // Cleanup any drain row we left behind.
    await client`DELETE FROM system_state WHERE key = 'drain_requested_at'`.catch(() => undefined);
    await app?.close().catch(() => undefined);
    await client?.unsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`).catch(() => undefined);
    await client?.end();
  }, 30_000);

  it('POST /admin/drain with empty in-flight returns drained:true + upserts system_state row', async () => {
    // Ensure clean state.
    await client`DELETE FROM system_state WHERE key = 'drain_requested_at'`;

    const resp = await app.inject({
      method: 'POST',
      url: '/admin/drain?timeout=2',
      headers: { authorization: 'Bearer test-key' },
    });
    expect(resp.statusCode).toBe(200);
    const body = resp.json() as { drained: boolean; in_flight: number; drained_at?: string };
    expect(body.drained).toBe(true);
    expect(body.in_flight).toBe(0);
    expect(typeof body.drained_at).toBe('string');

    // Verify system_state row written.
    const rows = await app.db
      .select()
      .from(schema.systemState)
      .where(eq(schema.systemState.key, 'drain_requested_at'));
    expect(rows.length).toBe(1);
    expect((rows[0].value as { iso?: string }).iso).toBeDefined();
  }, 15_000);

  it('POST /admin/drain rejects request without API key (401)', async () => {
    const resp = await app.inject({
      method: 'POST',
      url: '/admin/drain?timeout=1',
      // No Authorization / X-API-Key header.
    });
    expect(resp.statusCode).toBe(401);
    const body = resp.json() as { error?: string };
    expect(body.error).toBe('unauthorized');
  });

  it('POST /admin/drain rejects request with invalid API key (401)', async () => {
    const resp = await app.inject({
      method: 'POST',
      url: '/admin/drain?timeout=1',
      headers: { authorization: 'Bearer not-the-test-key' },
    });
    expect(resp.statusCode).toBe(401);
  });

  it('admission gate — fastify.jobsModule.enqueueJob throws 503 DRAINING when drain row present', async () => {
    // Ensure drain row is present (set by previous test, but make explicit).
    await app.db
      .insert(schema.systemState)
      .values({
        key: 'drain_requested_at',
        value: { iso: new Date().toISOString() },
      })
      .onConflictDoUpdate({
        target: schema.systemState.key,
        set: { value: { iso: new Date().toISOString() }, updatedAt: new Date() },
      });

    let caught: { message?: string; statusCode?: number; code?: string } | undefined;
    try {
      await app.jobsModule.enqueueJob('job-drain-admit-test', {
        jobId: 'job-drain-admit-test',
        platform: 'android',
      });
    } catch (err) {
      caught = err as { message?: string; statusCode?: number; code?: string };
    }
    expect(caught).toBeDefined();
    expect(caught?.message).toBe('system_draining');
    expect(caught?.statusCode).toBe(503);
    expect(caught?.code).toBe('DRAINING');
  });

  it('POST /admin/drain/resume deletes system_state row + returns {resumed:true}', async () => {
    // Drain row should still be present from prior test.
    const before = await app.db
      .select()
      .from(schema.systemState)
      .where(eq(schema.systemState.key, 'drain_requested_at'));
    expect(before.length).toBe(1);

    const resp = await app.inject({
      method: 'POST',
      url: '/admin/drain/resume',
      headers: { authorization: 'Bearer test-key' },
    });
    expect(resp.statusCode).toBe(200);
    const body = resp.json() as { resumed: boolean };
    expect(body.resumed).toBe(true);

    // system_state row gone.
    const after = await app.db
      .select()
      .from(schema.systemState)
      .where(eq(schema.systemState.key, 'drain_requested_at'));
    expect(after.length).toBe(0);
  }, 15_000);

  it('after successful drain, events table has a system.drain.completed row', async () => {
    // Trigger a fresh drain so the event is freshly emitted.
    await client`DELETE FROM system_state WHERE key = 'drain_requested_at'`;

    const drainResp = await app.inject({
      method: 'POST',
      url: '/admin/drain?timeout=2',
      headers: { authorization: 'Bearer test-key' },
    });
    expect(drainResp.statusCode).toBe(200);

    // Persistence is fire-and-forget (void async); allow event loop a tick.
    await new Promise((resolve) => setTimeout(resolve, 200));

    const rows = await app.db
      .select()
      .from(schema.events)
      .where(eq(schema.events.eventType, 'system.drain.completed'));
    expect(rows.length).toBeGreaterThanOrEqual(1);

    // Resume so we leave a clean slate.
    await app.inject({
      method: 'POST',
      url: '/admin/drain/resume',
      headers: { authorization: 'Bearer test-key' },
    });
  }, 15_000);
});
