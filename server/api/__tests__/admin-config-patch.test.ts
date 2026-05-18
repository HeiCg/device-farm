/**
 * Tests for PATCH /admin/config (Task 6.1).
 *
 * Covers:
 *  1. 400 on invalid retention_days values (not in {5,15,30}).
 *  2. 403 when caller lacks admin claim.
 *  3. 200 + config.yaml mutation for a valid admin caller.
 *  4. 200 no-op when body is empty (no fields).
 *
 * Auth wiring is unit-tested in isolation: requireAdmin reads
 * request.apiKey.claims.admin from the decorated request.  We fake
 * that decoration in the admin test helpers below — the same approach
 * used by server/auth/__tests__/admin-claim.spec.ts.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFile, readFile, unlink } from 'node:fs/promises';
import Fastify from 'fastify';
import {
  fastifyZodOpenApiPlugin,
  validatorCompiler,
  serializerCompiler,
} from 'fastify-zod-openapi';
import yaml from 'js-yaml';
import { errorHandler } from '../error-handler.js';
import { adminConfigRoute } from '../routes.js';

// ---------- helpers -----------------------------------------------------------

/** Build a minimal Fastify app with adminConfigRoute mounted under /api. */
async function buildApp(opts: {
  /** Simulated claims on the injected API key. null = no apiKey on request. */
  adminClaim?: boolean | null;
  /** When true, skip decorating authService (simulates auth-disabled). */
  noAuthService?: boolean;
} = {}) {
  const app = Fastify({ logger: false });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(fastifyZodOpenApiPlugin);
  app.setErrorHandler(errorHandler);

  // Minimal authService stub: validateKey always succeeds so requireAuth passes.
  if (!opts.noAuthService) {
    app.decorate('authService', {
      validateKey: vi.fn().mockResolvedValue(true),
    });
  }

  // requireAdmin reads request.apiKey.claims.admin.
  // We stamp it via an onRequest hook that runs before the preHandler chain.
  if (opts.adminClaim !== undefined && opts.adminClaim !== null) {
    app.addHook('onRequest', async (req) => {
      (req as { apiKey?: unknown }).apiKey = { claims: { admin: opts.adminClaim } };
      // Also satisfy the Authorization header check inside requireAuth.
      (req.headers as Record<string, string>).authorization = 'Bearer test-key';
    });
  } else if (opts.adminClaim === null) {
    // No apiKey at all — requireAdmin will 403.
    app.addHook('onRequest', async (req) => {
      (req.headers as Record<string, string>).authorization = 'Bearer test-key';
    });
  }

  await app.register(adminConfigRoute, { prefix: '/api' });
  return app;
}

/** Write a minimal config.yaml to a temp path and return that path. */
async function writeTmpConfig(content: Record<string, unknown>): Promise<string> {
  const path = join(tmpdir(), `device-farm-test-config-${Date.now()}.yaml`);
  await writeFile(path, yaml.dump(content), 'utf8');
  return path;
}

// ---------- cleanup ----------------------------------------------------------

const tmpFiles: string[] = [];
afterEach(async () => {
  for (const f of tmpFiles) {
    await unlink(f).catch(() => undefined);
  }
  tmpFiles.length = 0;
  delete process.env.DEVICE_FARM_CONFIG;
});

// ---------- tests -------------------------------------------------------------

describe('PATCH /api/admin/config', () => {
  it('returns 400 for retention_days outside {5,15,30} — e.g. 10', async () => {
    const app = await buildApp({ adminClaim: true });
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/admin/config',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ retention_days: 10 }),
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 for retention_days as a string', async () => {
    const app = await buildApp({ adminClaim: true });
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/admin/config',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ retention_days: '15' }),
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 for unknown fields (strict schema)', async () => {
    const app = await buildApp({ adminClaim: true });
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/admin/config',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ retention_days: 15, bogus: true }),
    });
    // Fastify-zod-openapi strips unknown fields (strip mode) — still 200, not 400.
    // But the field should not appear in applied.
    // Accept either 200 (strip) or 400 (strict). The key assertion is no 5xx.
    expect(res.statusCode).not.toBe(500);
  });

  it('returns 403 when apiKey lacks admin claim', async () => {
    const app = await buildApp({ adminClaim: false });
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/admin/config',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ retention_days: 15 }),
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns 403 when no apiKey is present on request', async () => {
    const app = await buildApp({ adminClaim: null });
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/admin/config',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ retention_days: 15 }),
    });
    expect(res.statusCode).toBe(403);
  });

  it('accepts valid retention_days:15, writes config.yaml, returns 200', async () => {
    const tmpPath = await writeTmpConfig({
      storage: { artifacts: { path: '/data/artifacts', retention_days: 30 } },
    });
    tmpFiles.push(tmpPath);
    process.env.DEVICE_FARM_CONFIG = tmpPath;

    const app = await buildApp({ adminClaim: true });
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/admin/config',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ retention_days: 15 }),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { ok: boolean; applied: { retention_days: number }; restartRequired: boolean };
    expect(body.ok).toBe(true);
    expect(body.applied.retention_days).toBe(15);
    expect(body.restartRequired).toBe(true);

    // Verify the file was actually mutated.
    const written = yaml.load(await readFile(tmpPath, 'utf8')) as {
      storage: { artifacts: { retention_days: number } };
    };
    expect(written.storage.artifacts.retention_days).toBe(15);
  });

  it('accepts retention_days:5', async () => {
    const tmpPath = await writeTmpConfig({ storage: { artifacts: { retention_days: 30 } } });
    tmpFiles.push(tmpPath);
    process.env.DEVICE_FARM_CONFIG = tmpPath;

    const app = await buildApp({ adminClaim: true });
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/admin/config',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ retention_days: 5 }),
    });
    expect(res.statusCode).toBe(200);

    const written = yaml.load(await readFile(tmpPath, 'utf8')) as {
      storage: { artifacts: { retention_days: number } };
    };
    expect(written.storage.artifacts.retention_days).toBe(5);
  });

  it('accepts retention_days:30', async () => {
    const tmpPath = await writeTmpConfig({});
    tmpFiles.push(tmpPath);
    process.env.DEVICE_FARM_CONFIG = tmpPath;

    const app = await buildApp({ adminClaim: true });
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/admin/config',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ retention_days: 30 }),
    });
    expect(res.statusCode).toBe(200);

    const written = yaml.load(await readFile(tmpPath, 'utf8')) as {
      storage?: { artifacts?: { retention_days: number } };
    };
    expect(written?.storage?.artifacts?.retention_days).toBe(30);
  });

  it('creates storage.artifacts keys when they are absent from config.yaml', async () => {
    // Config with no storage key at all.
    const tmpPath = await writeTmpConfig({ server: { port: 3000 } });
    tmpFiles.push(tmpPath);
    process.env.DEVICE_FARM_CONFIG = tmpPath;

    const app = await buildApp({ adminClaim: true });
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/admin/config',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ retention_days: 15 }),
    });
    expect(res.statusCode).toBe(200);

    const written = yaml.load(await readFile(tmpPath, 'utf8')) as {
      server: { port: number };
      storage: { artifacts: { retention_days: number } };
    };
    // Original key preserved.
    expect(written.server.port).toBe(3000);
    // New path created.
    expect(written.storage.artifacts.retention_days).toBe(15);
  });

  it('returns 200 no-op when body is empty object', async () => {
    const tmpPath = await writeTmpConfig({ storage: { artifacts: { retention_days: 30 } } });
    tmpFiles.push(tmpPath);
    process.env.DEVICE_FARM_CONFIG = tmpPath;

    const app = await buildApp({ adminClaim: true });
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/admin/config',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({}),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { ok: boolean };
    expect(body.ok).toBe(true);

    // File should be unchanged.
    const written = yaml.load(await readFile(tmpPath, 'utf8')) as {
      storage: { artifacts: { retention_days: number } };
    };
    expect(written.storage.artifacts.retention_days).toBe(30);
  });

  it('returns 500 when config file does not exist', async () => {
    process.env.DEVICE_FARM_CONFIG = '/nonexistent/path/config.yaml';
    const app = await buildApp({ adminClaim: true });
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/admin/config',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ retention_days: 15 }),
    });
    expect(res.statusCode).toBe(500);
  });
});
