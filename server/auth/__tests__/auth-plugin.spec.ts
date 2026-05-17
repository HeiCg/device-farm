import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import {
  fastifyZodOpenApiPlugin,
  validatorCompiler,
  serializerCompiler,
} from 'fastify-zod-openapi';
import type { AuthService } from '../internal/auth-service.js';

// ---- Mock AuthService ----

function createMockAuthService(): AuthService {
  return {
    generateKey: vi.fn(),
    validateKey: vi.fn().mockResolvedValue(false),
    createKey: vi.fn().mockResolvedValue({
      id: '55555555-5555-4555-8555-555555555555',
      name: 'test-key',
      rawKey: 'df_testapikey123',
      prefix: 'df_testa',
      createdAt: new Date('2026-01-01'),
    }),
    listKeys: vi.fn().mockResolvedValue([
      {
        id: '55555555-5555-4555-8555-555555555555',
        name: 'test-key',
        prefix: 'df_testa',
        createdAt: new Date('2026-01-01'),
        lastUsedAt: null,
        expiresAt: null,
        revoked: false,
      },
    ]),
    revokeKey: vi.fn().mockResolvedValue(undefined),
  } as unknown as AuthService;
}

// ---- Test app builder ----

async function buildTestApp(authEnabled: boolean) {
  const app = Fastify({ logger: false });
  const mockAuthService = createMockAuthService();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(fastifyZodOpenApiPlugin);

  // Register fake 'config' plugin (must use fp for named dependency resolution)
  await app.register(fp(async (instance) => {
    instance.decorate('config', {
      auth: { enabled: authEnabled },
      server: { port: 3000, host: '0.0.0.0' },
    } as any);
  }, { name: 'config' }));

  // Register fake 'db' plugin
  await app.register(fp(async (instance) => {
    instance.decorate('db', {} as any);
  }, { name: 'db' }));

  // Decorate authService before auth plugin (so plugin skips creation)
  app.decorate('authService', mockAuthService);

  // Import and register auth plugin
  const { default: authPlugin } = await import('../plugin.js');
  await app.register(authPlugin);

  // Health route -- always public (registered OUTSIDE protected scope)
  app.get('/api/health', async () => ({ status: 'ok' }));

  // Protected scope -- mimics what api/plugin.ts does
  await app.register(async (scope) => {
    // Apply bearer auth hook on protected scope when auth is enabled
    if (authEnabled && scope.verifyBearerAuth) {
      scope.addHook('onRequest', scope.verifyBearerAuth);
    }

    // Protected routes
    scope.get('/api/jobs', async () => ({ jobs: [] }));

    // Admin key routes (also protected)
    const { keyRoutes } = await import('../internal/key-routes.js');
    await scope.register(keyRoutes, { prefix: '/api' });
  });

  await app.ready();

  return { app, mockAuthService };
}

describe('Auth Plugin', () => {
  let app: FastifyInstance;
  let mockAuthService: AuthService;

  afterEach(async () => {
    if (app) await app.close();
  });

  describe('when auth.enabled=true', () => {
    beforeEach(async () => {
      const result = await buildTestApp(true);
      app = result.app;
      mockAuthService = result.mockAuthService;
    });

    it('rejects requests without Bearer token to /api/jobs with 401', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/jobs' });
      expect(res.statusCode).toBe(401);
    });

    it('accepts requests with valid Bearer token to /api/jobs', async () => {
      (mockAuthService.validateKey as any).mockResolvedValueOnce(true);
      const res = await app.inject({
        method: 'GET',
        url: '/api/jobs',
        headers: { authorization: 'Bearer df_validkey123' },
      });
      expect(res.statusCode).toBe(200);
    });

    it('GET /api/health always returns 200 regardless of auth', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/health' });
      expect(res.statusCode).toBe(200);
    });
  });

  describe('when auth.enabled=false', () => {
    beforeEach(async () => {
      const result = await buildTestApp(false);
      app = result.app;
      mockAuthService = result.mockAuthService;
    });

    it('allows requests without Bearer token to /api/jobs', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/jobs' });
      expect(res.statusCode).toBe(200);
    });
  });

  describe('Admin key routes', () => {
    beforeEach(async () => {
      const result = await buildTestApp(false);
      app = result.app;
      mockAuthService = result.mockAuthService;
    });

    it('POST /api/admin/keys creates key and returns raw key', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/keys',
        payload: { name: 'test-key' },
      });
      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      expect(body).toMatchObject({
        id: '55555555-5555-4555-8555-555555555555',
        name: 'test-key',
        rawKey: 'df_testapikey123',
        prefix: 'df_testa',
      });
    });

    it('GET /api/admin/keys returns list without hashes', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/keys',
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body).toHaveLength(1);
      expect(body[0]).not.toHaveProperty('keyHash');
    });

    it('DELETE /api/admin/keys/:id revokes key', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/admin/keys/uuid-1',
      });
      expect(res.statusCode).toBe(204);
    });

    it('admin key routes require auth when auth.enabled=true', async () => {
      await app.close();
      const result = await buildTestApp(true);
      app = result.app;
      mockAuthService = result.mockAuthService;

      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/keys',
      });
      expect(res.statusCode).toBe(401);
    });
  });
});
