/**
 * Auth module — DB-gated subscriber.spec (Plan 26-04).
 *
 * Proves ROADMAP §Phase 26 SC1 end-to-end:
 *   - POST /api/admin/keys with valid admin Bearer key emits `auth.key.created`
 *     on the per-module bus AND inserts an `events` row with:
 *       event_type='auth.key.created', aggregate_type='auth',
 *       aggregate_id=<new-key-id>, actor='apikey:<requester-id>'
 *       (TRACE-10 — actor populated from caller's ALS via bearer-auth callback),
 *       correlation_id non-null, payload {keyId, keyName, prefix, createdBy}.
 *   - DELETE /api/admin/keys/:id emits `auth.key.revoked` + persists similarly
 *     with actor='apikey:<requester-id>'.
 *   - Two-layer assertion per test: in-process bus subscriber sees envelope
 *     AND events table row matches.
 *
 * Skipped when TEST_DATABASE_URL/DATABASE_URL is unset (DB-gated).
 *
 * Harness mirrors server/jobs/__tests__/drain-route.spec.ts pattern: builds a
 * minimal Fastify app with the real auth-plugin (which decorates authModule +
 * authService) + a protected scope mounting keyRoutes with verifyBearerAuth
 * hook (same shape as server/api/plugin.ts production scope).
 */
import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq, desc, and } from 'drizzle-orm';
import { scryptSync, randomBytes } from 'node:crypto';
import {
  fastifyZodOpenApiPlugin,
  validatorCompiler,
} from 'fastify-zod-openapi';

import * as schema from '../../db/schema.js';
import correlationPlugin from '../../correlation/plugin.js';
import busPlugin from '../../bus/plugin.js';
import authPlugin from '../plugin.js';
import { keyRoutes } from '../internal/key-routes.js';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const HAS_DB =
  typeof TEST_DATABASE_URL === 'string' && TEST_DATABASE_URL.length > 0;

if (!HAS_DB) {
  // eslint-disable-next-line no-console
  console.warn(
    '[auth/subscriber.spec] SKIPPED: set TEST_DATABASE_URL or DATABASE_URL to run',
  );
}

/** Mirrors AuthService.generateKey + insert shape — seeds an admin Bearer key. */
async function seedAdminKey(
  db: ReturnType<typeof drizzle>,
  name: string,
): Promise<{ id: string; raw: string }> {
  const rawBytes = randomBytes(32);
  const raw = 'df_' + rawBytes.toString('hex');
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(raw, salt, 64).toString('hex');
  const prefix = raw.substring(0, 8);
  const [row] = await db
    .insert(schema.apiKeys)
    .values({
      name,
      keyHash: hash,
      keySalt: salt,
      keyPrefix: prefix,
      claims: { admin: true } as never,
    })
    .returning({ id: schema.apiKeys.id });
  return { id: row.id, raw };
}

describe.skipIf(!HAS_DB)(
  '[Phase 26-04 SC1] auth subscriber — auth.key.* emit + persist with apikey actor (DB-gated)',
  () => {
    let app: FastifyInstance;
    let client: ReturnType<typeof postgres>;
    let bootstrapApiKey: { id: string; raw: string };

    beforeAll(async () => {
      client = postgres(TEST_DATABASE_URL!);
      const db = drizzle(client);

      const stubConfigPlugin = fp(
        async (fastify: FastifyInstance) => {
          fastify.decorate('config', {
            database_url: TEST_DATABASE_URL!,
            auth: { enabled: true },
            server: { port: 3000, host: '0.0.0.0' },
          } as never);
        },
        { name: 'config' },
      );

      const liveDbPlugin = fp(
        async (fastify: FastifyInstance) => {
          fastify.decorate('db', db as unknown as FastifyInstance['db']);
        },
        { name: 'db', dependencies: ['config'] },
      );

      app = Fastify({ logger: false, pluginTimeout: 60_000 });
      app.setValidatorCompiler(validatorCompiler);
      // No-op serializer: production code's `z.void()` on DELETE 204 cannot be
      // represented by fastify-zod-openapi v5.6.1's serializer (DEFERRED-17-A
      // inherited). Tests bypass response-schema validation; route handlers
      // still write their own status codes + bodies which our assertions check.
      app.setSerializerCompiler(() => (data: unknown) =>
        typeof data === 'string' ? data : JSON.stringify(data ?? ''),
      );
      await app.register(fastifyZodOpenApiPlugin);
      await app.register(stubConfigPlugin);
      await app.register(correlationPlugin);
      await app.register(liveDbPlugin);
      await app.register(busPlugin);
      await app.register(authPlugin);

      // Protected scope mirrors server/api/plugin.ts production wiring:
      // verifyBearerAuth runs on every request inside the scope. keyRoutes
      // mounted under /api so POST hits /api/admin/keys.
      await app.register(async (scope) => {
        if (scope.verifyBearerAuth) {
          scope.addHook('onRequest', scope.verifyBearerAuth);
        }
        await scope.register(keyRoutes, { prefix: '/api' });
      });

      await app.ready();

      // Seed bootstrap admin key AFTER ready so DB is reachable.
      bootstrapApiKey = await seedAdminKey(db, 'subscriber-spec-bootstrap');
    }, 60_000);

    afterAll(async () => {
      try {
        // Cleanup events + apiKeys we touched. Scoped delete (don't truncate
        // unrelated rows in shared dev DB).
        if (bootstrapApiKey) {
          await client`DELETE FROM events WHERE aggregate_type = 'auth' AND actor = ${
            'apikey:' + bootstrapApiKey.id
          }`.catch(() => undefined);
          await client`DELETE FROM api_keys WHERE id = ${bootstrapApiKey.id}`.catch(
            () => undefined,
          );
        }
        await app?.close();
      } catch {
        /* tolerate */
      }
      await client?.end().catch(() => undefined);
    }, 30_000);

    it('POST /api/admin/keys emits auth.key.created + persists events row with apikey actor', async () => {
      // Subscribe to bus to verify in-process envelope before HTTP fires.
      let observedEnvelope: unknown = null;
      const off = app.authModule.bus.on('auth.key.created', (payload) => {
        observedEnvelope = payload;
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/keys',
        headers: { authorization: `Bearer ${bootstrapApiKey.raw}` },
        payload: { name: 'subscriber-test-key-created' },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json() as { id: string; name: string; prefix: string };
      expect(body.id).toBeTruthy();

      // Wait briefly for fire-and-forget persistEnvelope insert.
      await new Promise((r) => setTimeout(r, 100));

      // Bus listener fired with payload.
      expect(observedEnvelope).toBeTruthy();

      // Events table has matching row.
      const rows = await app.db
        .select()
        .from(schema.events)
        .where(
          and(
            eq(schema.events.eventType, 'auth.key.created'),
            eq(schema.events.aggregateId, body.id),
          ),
        )
        .orderBy(desc(schema.events.occurredAt))
        .limit(1);
      expect(rows.length).toBe(1);
      const row = rows[0];
      expect(row.aggregateType).toBe('auth');
      expect(row.aggregateId).toBe(body.id);
      expect(row.actor).toBe(`apikey:${bootstrapApiKey.id}`);
      expect(row.correlationId).toBeTruthy();
      const payload = row.payload as {
        keyId: string;
        keyName: string;
        prefix: string;
        createdBy: string;
      };
      expect(payload.keyId).toBe(body.id);
      expect(payload.keyName).toBe('subscriber-test-key-created');
      expect(payload.prefix).toBe(body.prefix);
      expect(payload.createdBy).toBe(`apikey:${bootstrapApiKey.id}`);

      // Cleanup the created key so afterAll doesn't leave a dangling row.
      await app.db
        .delete(schema.apiKeys)
        .where(eq(schema.apiKeys.id, body.id))
        .catch(() => undefined);
      off();
    });

    it('DELETE /api/admin/keys/:id emits auth.key.revoked + persists events row with apikey actor', async () => {
      // Seed a target key DIRECTLY via authService (skip the route to avoid
      // entangling with subscriber.spec test 1).
      const target = await app.authService.createKey('subscriber-test-target');

      let observedEnvelope: unknown = null;
      const off = app.authModule.bus.on('auth.key.revoked', (payload) => {
        observedEnvelope = payload;
      });

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/admin/keys/${target.id}`,
        headers: { authorization: `Bearer ${bootstrapApiKey.raw}` },
      });
      expect(res.statusCode).toBe(204);

      await new Promise((r) => setTimeout(r, 100));

      expect(observedEnvelope).toBeTruthy();

      const rows = await app.db
        .select()
        .from(schema.events)
        .where(
          and(
            eq(schema.events.eventType, 'auth.key.revoked'),
            eq(schema.events.aggregateId, target.id),
          ),
        )
        .orderBy(desc(schema.events.occurredAt))
        .limit(1);
      expect(rows.length).toBe(1);
      const row = rows[0];
      expect(row.actor).toBe(`apikey:${bootstrapApiKey.id}`);
      expect(row.aggregateId).toBe(target.id);
      const payload = row.payload as {
        keyId: string;
        keyName: string;
        revokedBy: string;
      };
      expect(payload.keyId).toBe(target.id);
      expect(payload.keyName).toBe('subscriber-test-target');
      expect(payload.revokedBy).toBe(`apikey:${bootstrapApiKey.id}`);

      // Cleanup target row.
      await app.db
        .delete(schema.apiKeys)
        .where(eq(schema.apiKeys.id, target.id))
        .catch(() => undefined);
      off();
    });
  },
);
