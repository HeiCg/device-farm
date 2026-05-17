/**
 * Auth module — DB-gated als-actor.spec (Plan 26-04).
 *
 * Proves ROADMAP §Phase 26 SC2 end-to-end: 4 actor sources resolve correctly
 * on the events.actor column:
 *
 *   1. apikey:<id>  — HTTP Bearer auth callback (server/auth/plugin.ts, entry
 *                     point #4)
 *   2. system       — fallback default in createEventHelpers (Plan 26-02
 *                     'anonymous' -> 'system' migration at bus/helpers.ts:100)
 *   3. system       — boot-time onReady ALS wrap (server/index.ts entry #3),
 *                     proven by emitting inside asyncLocalStorage.run(
 *                     {correlationId, actor:'system'}, ...)
 *   4. cron[:queue] — pg-boss worker stamp (Phase 18 substrate at
 *                     server/queue/plugin.ts:199 — runtime proof carried by
 *                     server/lifecycle/__tests__/correlation.spec.ts; this
 *                     spec marks it `it.todo` with a Phase 18 cross-reference
 *                     since standing up an isolated pg-boss queue inside the
 *                     auth-only harness is invasive and not necessary —
 *                     lifecycle-ownership.spec already grep-guards the literal
 *                     `actor: data.actor ?? 'cron'` byte-stable)
 *
 * Plus Pitfall 1 — concurrent requests with different keys: parallel POSTs
 * must NOT have actor bleed across fibers.
 *
 * Skipped when TEST_DATABASE_URL/DATABASE_URL unset (DB-gated).
 */
import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq, desc, and } from 'drizzle-orm';
import { scryptSync, randomBytes, randomUUID } from 'node:crypto';
import { asyncLocalStorage } from '@fastify/request-context';
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
    '[auth/als-actor.spec] SKIPPED: set TEST_DATABASE_URL or DATABASE_URL to run',
  );
}

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
  '[Phase 26-04 SC2 TRACE-10] als-actor — 4 actor sources end-to-end on events.actor (DB-gated)',
  () => {
    let app: FastifyInstance;
    let client: ReturnType<typeof postgres>;
    let db: ReturnType<typeof drizzle>;
    let adminKeyA: { id: string; raw: string };
    let adminKeyB: { id: string; raw: string };
    const seededKeyIds: string[] = [];
    const seededAggregateIds: string[] = [];

    beforeAll(async () => {
      client = postgres(TEST_DATABASE_URL!);
      db = drizzle(client);

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
      app.setSerializerCompiler(() => (data: unknown) =>
        typeof data === 'string' ? data : JSON.stringify(data ?? ''),
      );
      await app.register(fastifyZodOpenApiPlugin);
      await app.register(stubConfigPlugin);
      await app.register(correlationPlugin);
      await app.register(liveDbPlugin);
      await app.register(busPlugin);
      await app.register(authPlugin);

      await app.register(async (scope) => {
        if (scope.verifyBearerAuth) {
          scope.addHook('onRequest', scope.verifyBearerAuth);
        }
        await scope.register(keyRoutes, { prefix: '/api' });
      });

      await app.ready();

      adminKeyA = await seedAdminKey(db, 'als-actor-A');
      adminKeyB = await seedAdminKey(db, 'als-actor-B');
      seededKeyIds.push(adminKeyA.id, adminKeyB.id);
    }, 60_000);

    afterAll(async () => {
      try {
        for (const id of seededAggregateIds) {
          await db
            .delete(schema.events)
            .where(eq(schema.events.aggregateId, id))
            .catch(() => undefined);
        }
        for (const id of seededKeyIds) {
          await db
            .delete(schema.apiKeys)
            .where(eq(schema.apiKeys.id, id))
            .catch(() => undefined);
        }
        await app?.close();
      } catch {
        /* tolerate */
      }
      await client?.end().catch(() => undefined);
    }, 30_000);

    it('1. HTTP Bearer auth -> events.actor = apikey:<id> (entry point #4)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/keys',
        headers: { authorization: `Bearer ${adminKeyA.raw}` },
        payload: { name: 'als-test-1-created' },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json() as { id: string };
      seededAggregateIds.push(body.id);
      seededKeyIds.push(body.id);

      await new Promise((r) => setTimeout(r, 100));

      const [row] = await db
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
      expect(row.actor).toBe(`apikey:${adminKeyA.id}`);
    });

    it('2. emit with NO ALS store -> events.actor = system (fallback default, Plan 26-02)', async () => {
      // Direct emit outside any asyncLocalStorage.run — relies on
      // createEventHelpers fallback `readAls('actor') ?? 'system'` at
      // server/bus/helpers.ts:100. Use a fresh UUID aggregate to avoid
      // collision with other tests' rows.
      const aggId = randomUUID();
      seededAggregateIds.push(aggId);

      // Run outside any ambient ALS by escaping via setImmediate (sub-fibers
      // inherit ALS). For an "outside" emit we use asyncLocalStorage.exit().
      await new Promise<void>((resolve) => {
        asyncLocalStorage.exit(() => {
          app.authModule.emit.keyCreated(aggId, {
            keyId: aggId,
            keyName: 'no-als-test',
            prefix: 'noals000',
            createdBy: 'system',
          });
          resolve();
        });
      });

      await new Promise((r) => setTimeout(r, 100));

      const [row] = await db
        .select()
        .from(schema.events)
        .where(eq(schema.events.aggregateId, aggId))
        .orderBy(desc(schema.events.occurredAt))
        .limit(1);
      expect(row.actor).toBe('system');
    });

    it("3. emit inside asyncLocalStorage.run({actor:'system'}) -> events.actor = system (boot-time entry #3)", async () => {
      const aggId = randomUUID();
      seededAggregateIds.push(aggId);

      await asyncLocalStorage.run(
        {
          correlationId: randomUUID(),
          actor: 'system',
        } as never,
        async () => {
          app.authModule.emit.keyCreated(aggId, {
            keyId: aggId,
            keyName: 'als-system-test',
            prefix: 'sys00000',
            createdBy: 'system',
          });
        },
      );

      await new Promise((r) => setTimeout(r, 100));

      const [row] = await db
        .select()
        .from(schema.events)
        .where(eq(schema.events.aggregateId, aggId))
        .orderBy(desc(schema.events.occurredAt))
        .limit(1);
      expect(row.actor).toBe('system');
    });

    it.todo(
      "4. pg-boss worker dispatch -> events.actor = cron (Phase 18 substrate). Runtime proof carried by server/lifecycle/__tests__/correlation.spec.ts; this auth-only harness does not stand up an isolated pg-boss worker. lifecycle-ownership.spec already grep-guards the byte-stable literal `actor: data.actor ?? 'cron'` at server/queue/plugin.ts:199.",
    );

    it('5. Pitfall 1 — concurrent requests A + B -> no actor bleed across fibers', async () => {
      // Fire 2 parallel POST /api/admin/keys requests using different Bearer keys.
      const [resA, resB] = await Promise.all([
        app.inject({
          method: 'POST',
          url: '/api/admin/keys',
          headers: { authorization: `Bearer ${adminKeyA.raw}` },
          payload: { name: 'concurrent-A' },
        }),
        app.inject({
          method: 'POST',
          url: '/api/admin/keys',
          headers: { authorization: `Bearer ${adminKeyB.raw}` },
          payload: { name: 'concurrent-B' },
        }),
      ]);
      expect(resA.statusCode).toBe(201);
      expect(resB.statusCode).toBe(201);
      const bodyA = resA.json() as { id: string };
      const bodyB = resB.json() as { id: string };
      seededAggregateIds.push(bodyA.id, bodyB.id);
      seededKeyIds.push(bodyA.id, bodyB.id);

      await new Promise((r) => setTimeout(r, 150));

      const [rowA] = await db
        .select()
        .from(schema.events)
        .where(
          and(
            eq(schema.events.eventType, 'auth.key.created'),
            eq(schema.events.aggregateId, bodyA.id),
          ),
        )
        .orderBy(desc(schema.events.occurredAt))
        .limit(1);
      const [rowB] = await db
        .select()
        .from(schema.events)
        .where(
          and(
            eq(schema.events.eventType, 'auth.key.created'),
            eq(schema.events.aggregateId, bodyB.id),
          ),
        )
        .orderBy(desc(schema.events.occurredAt))
        .limit(1);

      expect(rowA?.actor).toBe(`apikey:${adminKeyA.id}`);
      expect(rowB?.actor).toBe(`apikey:${adminKeyB.id}`);
    });
  },
);
