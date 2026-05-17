/**
 * Auth module — DB-gated admin-claim.spec (Plan 26-04).
 *
 * Proves DEFERRED-23-A resolution end-to-end: `requireAdmin` middleware gates
 *   - /admin/drain
 *   - /admin/drain/resume
 *   - /api/keys/:id/claims/admin
 * with 403 RFC 7807 problem+json when `request.apiKey.claims.admin !== true`,
 * 2xx when the claim is set.
 *
 *   - Test 1: admin key → /admin/drain returns 2xx
 *   - Test 2: non-admin key → /admin/drain returns 403 RFC 7807 problem+json
 *   - Test 3: /admin/drain/resume same gate (403 without, 2xx with)
 *   - Test 4: claims=NULL row → 403 not 500 (Pitfall 5 defensive null-chain)
 *   - Test 5: POST /api/keys/:id/claims/admin — non-admin 403, admin 200 + DB round-trip
 *   - Test 6: grantAdminClaim preserves other jsonb claim keys (jsonb_set semantics)
 *
 * Skipped when TEST_DATABASE_URL/DATABASE_URL unset (DB-gated).
 *
 * /admin/drain + /admin/drain/resume are proxied by a minimal test route that
 * mirrors production's preHandler chain `[requireAuth, requireAdmin]` from
 * server/jobs/internal/routes.ts:109,187 — production wiring is identical and
 * verified independently by server/jobs/__tests__/drain-route.spec.ts. This
 * spec exercises requireAdmin's 403/2xx gate in isolation without standing up
 * the full pg-boss queue plugin stack.
 */
import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
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
import { requireAdmin } from '../internal/require-admin.js';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const HAS_DB =
  typeof TEST_DATABASE_URL === 'string' && TEST_DATABASE_URL.length > 0;

if (!HAS_DB) {
  // eslint-disable-next-line no-console
  console.warn(
    '[auth/admin-claim.spec] SKIPPED: set TEST_DATABASE_URL or DATABASE_URL to run',
  );
}

async function seedKey(
  db: ReturnType<typeof drizzle>,
  name: string,
  claims: Record<string, unknown>,
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
      claims: claims as never,
    })
    .returning({ id: schema.apiKeys.id });
  return { id: row.id, raw };
}

describe.skipIf(!HAS_DB)(
  '[Phase 26-04 DEFERRED-23-A] admin-claim — requireAdmin gates drain + admin-grant routes (DB-gated)',
  () => {
    let app: FastifyInstance;
    let client: ReturnType<typeof postgres>;
    let db: ReturnType<typeof drizzle>;
    let adminKey: { id: string; raw: string };
    let nonAdminKey: { id: string; raw: string };
    const seededKeyIds: string[] = [];

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

      // Mock /admin/drain + /admin/drain/resume routes mirroring production's
      // preHandler chain [requireAuth, requireAdmin]. requireAuth is the same
      // shape as server/jobs/internal/routes.ts:87 (Bearer extraction +
      // authService.validateKey check). Production is tested independently by
      // server/jobs/__tests__/drain-route.spec.ts; this spec exercises the
      // requireAdmin claim gate.
      const requireAuth = async (
        req: FastifyRequest,
        reply: FastifyReply,
      ): Promise<void> => {
        const authHeader =
          (req.headers['authorization'] as string | undefined) ??
          (req.headers['x-api-key'] as string | undefined);
        const key = authHeader?.startsWith('Bearer ')
          ? authHeader.slice(7)
          : authHeader;
        if (!key) {
          await reply.code(401).send({ error: 'unauthorized' });
          return;
        }
        const matched = await app.authService.validateKeyAndReturnRow(key);
        if (!matched) {
          await reply.code(401).send({ error: 'unauthorized' });
          return;
        }
        (req as { apiKey?: typeof matched }).apiKey = matched;
      };

      app.route({
        method: 'POST',
        url: '/admin/drain',
        preHandler: [requireAuth, requireAdmin],
        handler: async (_req, reply) => reply.code(200).send({ drained: true }),
      });

      app.route({
        method: 'POST',
        url: '/admin/drain/resume',
        preHandler: [requireAuth, requireAdmin],
        handler: async (_req, reply) =>
          reply.code(200).send({ resumed: true }),
      });

      // Real /api/keys/:id/claims/admin route via auth's keyRoutes (mounted
      // under /api so requests hit /api/api/keys/:id/claims/admin — but in
      // production server/api/plugin.ts also prefixes /api which produces the
      // documented surface /api/keys/:id/claims/admin in 17-01-PLAN; here we
      // mount at /api so the route URL becomes /api/keys/:id/claims/admin per
      // the route's url field which already includes /api/keys/...).
      await app.register(async (scope) => {
        if (scope.verifyBearerAuth) {
          scope.addHook('onRequest', scope.verifyBearerAuth);
        }
        await scope.register(keyRoutes);
      });

      await app.ready();

      adminKey = await seedKey(db, 'admin-claim-admin', { admin: true });
      nonAdminKey = await seedKey(db, 'admin-claim-non-admin', {});
      seededKeyIds.push(adminKey.id, nonAdminKey.id);
    }, 60_000);

    afterAll(async () => {
      try {
        for (const id of seededKeyIds) {
          await db.delete(schema.apiKeys).where(eq(schema.apiKeys.id, id)).catch(() => undefined);
        }
        await app?.close();
      } catch {
        /* tolerate */
      }
      await client?.end().catch(() => undefined);
    }, 30_000);

    it('1. POST /admin/drain with admin claim returns 2xx', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/admin/drain',
        headers: { authorization: `Bearer ${adminKey.raw}` },
      });
      expect([200, 204]).toContain(res.statusCode);
    });

    it('2. POST /admin/drain WITHOUT admin claim returns 403 RFC 7807', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/admin/drain',
        headers: { authorization: `Bearer ${nonAdminKey.raw}` },
      });
      expect(res.statusCode).toBe(403);
      expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
      const body = res.json() as {
        type: string;
        title: string;
        status: number;
        detail: string;
      };
      expect(body.title).toBe('Forbidden');
      expect(body.status).toBe(403);
      expect(body.detail).toMatch(/admin claim/i);
    });

    it('3. POST /admin/drain/resume same gate (403 without, 2xx with)', async () => {
      const denied = await app.inject({
        method: 'POST',
        url: '/admin/drain/resume',
        headers: { authorization: `Bearer ${nonAdminKey.raw}` },
      });
      expect(denied.statusCode).toBe(403);

      const allowed = await app.inject({
        method: 'POST',
        url: '/admin/drain/resume',
        headers: { authorization: `Bearer ${adminKey.raw}` },
      });
      expect([200, 204]).toContain(allowed.statusCode);
    });

    it('4. POST /admin/drain with claims=NULL row returns 403 not 500 (Pitfall 5 defensive)', async () => {
      // Production schema is `claims JSONB NOT NULL DEFAULT '{}'::jsonb`
      // (Phase 26 migration 0005). Pitfall 5 documents the case where a
      // pre-existing row escapes the migration backfill — the NOT NULL
      // constraint structurally prevents that post-26-00, but requireAdmin
      // is STILL defensive against `apiKey?.claims?.admin !== true` so
      // missing / explicit-false / unexpected-shape claims still 403.
      //
      // We drop the NOT NULL constraint temporarily, force a NULL row, and
      // assert 403 (not 500). Restore the constraint in finally so other
      // tests + the schema stay consistent.
      await client.unsafe(
        'ALTER TABLE api_keys ALTER COLUMN claims DROP NOT NULL',
      );
      try {
        const fresh = await seedKey(db, 'admin-claim-null-test', {});
        seededKeyIds.push(fresh.id);
        await client.unsafe(
          `UPDATE api_keys SET claims = NULL WHERE id = '${fresh.id}'`,
        );

        const res = await app.inject({
          method: 'POST',
          url: '/admin/drain',
          headers: { authorization: `Bearer ${fresh.raw}` },
        });
        // requireAdmin uses optional-chain `apiKey?.claims?.admin === true`
        // which is `undefined === true` → false → 403. No 500.
        expect(res.statusCode).toBe(403);
      } finally {
        // Restore schema: backfill any NULL rows we left behind, then re-add
        // NOT NULL. Idempotent under retry.
        await client
          .unsafe(`UPDATE api_keys SET claims = '{}'::jsonb WHERE claims IS NULL`)
          .catch(() => undefined);
        await client
          .unsafe('ALTER TABLE api_keys ALTER COLUMN claims SET NOT NULL')
          .catch(() => undefined);
      }
    });

    it('5. POST /api/keys/:id/claims/admin: non-admin → 403, admin → 200 round-trip', async () => {
      const target = await app.authService.createKey('grant-target');
      seededKeyIds.push(target.id);

      // Non-admin attempt — denied by requireAdmin preHandler.
      const denied = await app.inject({
        method: 'POST',
        url: `/api/keys/${target.id}/claims/admin`,
        headers: { authorization: `Bearer ${nonAdminKey.raw}` },
        payload: { admin: true },
      });
      expect(denied.statusCode).toBe(403);

      // Admin attempt — grants, returns 200 with claims.admin=true.
      const granted = await app.inject({
        method: 'POST',
        url: `/api/keys/${target.id}/claims/admin`,
        headers: { authorization: `Bearer ${adminKey.raw}` },
        payload: { admin: true },
      });
      expect(granted.statusCode).toBe(200);
      const body = granted.json() as {
        success: true;
        claims: { admin: boolean };
      };
      expect(body.success).toBe(true);
      expect(body.claims.admin).toBe(true);

      // DB round-trip — apiKeys.claims.admin === true after grant.
      const [row] = await db
        .select()
        .from(schema.apiKeys)
        .where(eq(schema.apiKeys.id, target.id));
      const persistedClaims = row.claims as { admin: boolean };
      expect(persistedClaims.admin).toBe(true);
    });

    it('6. grantAdminClaim preserves other JSONB claim keys (jsonb_set semantics)', async () => {
      const target = await app.authService.createKey('preserve-claims-test');
      seededKeyIds.push(target.id);

      // Seed an existing claim (e.g. scopes) directly via UPDATE.
      await db
        .update(schema.apiKeys)
        .set({ claims: { scopes: ['read'] } as never })
        .where(eq(schema.apiKeys.id, target.id));

      // Grant admin via service method (jsonb_set merge).
      await app.authService.grantAdminClaim(target.id, true);

      const [row] = await db
        .select()
        .from(schema.apiKeys)
        .where(eq(schema.apiKeys.id, target.id));
      const claims = row.claims as { admin: boolean; scopes: string[] };
      expect(claims.admin).toBe(true);
      expect(claims.scopes).toEqual(['read']); // preserved
    });
  },
);
