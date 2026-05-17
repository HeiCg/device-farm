/**
 * Phase 37 Plan 37-04 — POST /api/jobs parallel-deploy cap integration spec.
 *
 * Verifies the route-layer Pitfall 9 cap check: when metadata.mode
 * === 'parallel-deploy' AND metadata.parallelism > config.pool.<platform>.max_parallelism,
 * the response is 503 + Retry-After: 60 + RFC 7807 problem+json body.
 */
import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import {
  fastifyZodOpenApiPlugin,
  validatorCompiler,
  serializerCompiler,
} from 'fastify-zod-openapi';
import { errorHandler } from '../error-handler.js';
import { jobRoutes } from '../routes.js';
import type { JobService } from '../../jobs/job-service.js';
import type { PoolManager } from '../../pool/pool-manager.js';
import type { HealthChecker } from '../../pool/health-checker.js';
import type { ArtifactService } from '../../artifacts/artifact-service.js';

function createMockJobService() {
  return {
    createJob: vi.fn(),
    cancelJob: vi.fn(),
    getQueueDepth: vi.fn().mockReturnValue({ android: 0, ios: 0 }),
    shutdown: vi.fn(),
  };
}

async function buildTestApp(jobService = createMockJobService()) {
  const app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(fastifyZodOpenApiPlugin);
  await app.register(multipart, { limits: { fileSize: 1_048_576, files: 50, fields: 10 } });

  app.decorate('jobService', jobService as unknown as JobService);
  app.decorate('pool', {
    getDevices: vi.fn().mockReturnValue([]),
    getDevice: vi.fn().mockReturnValue(null),
  } as unknown as PoolManager);
  app.decorate('db', { select: vi.fn(), insert: vi.fn(), update: vi.fn(), delete: vi.fn() } as never);
  app.decorate('healthChecker', {
    checkAll: vi.fn(), start: vi.fn(), stop: vi.fn(),
  } as unknown as HealthChecker);
  app.decorate('artifactService', {
    listByJob: vi.fn().mockResolvedValue([]),
    getById: vi.fn().mockResolvedValue(null),
  } as unknown as ArtifactService);
  // Phase 37 — needed for cap check (router reads fastify.config.pool[platform].max_parallelism).
  app.decorate('config', {
    pool: {
      android: { max_parallelism: 4 },
      ios: { max_parallelism: 2 },
    },
  } as never);

  app.setErrorHandler(errorHandler);
  await app.register(jobRoutes, { prefix: '/api' });

  return { app, jobService };
}

function buildMultipartBody(
  files: Array<{ name: string; content: string }>,
  fields: Record<string, string>,
  boundary: string,
): string {
  let body = '';
  for (const file of files) {
    body += `--${boundary}\r\n`;
    body += `Content-Disposition: form-data; name="file"; filename="${file.name}"\r\n`;
    body += `Content-Type: application/x-yaml\r\n\r\n`;
    body += `${file.content}\r\n`;
  }
  for (const [key, value] of Object.entries(fields)) {
    body += `--${boundary}\r\n`;
    body += `Content-Disposition: form-data; name="${key}"\r\n\r\n`;
    body += `${value}\r\n`;
  }
  body += `--${boundary}--\r\n`;
  return body;
}

describe('POST /api/jobs — parallel-deploy cap (Pitfall 9)', () => {
  it('returns 503 + Retry-After when parallelism exceeds platform cap', async () => {
    const { app, jobService } = await buildTestApp();
    const boundary = 'paralleloverboundary';
    const body = buildMultipartBody(
      [{ name: 'flow.yaml', content: 'appId: com.test\n---\n- launchApp' }],
      {
        platform: 'android',
        metadata: JSON.stringify({ mode: 'parallel-deploy', parallelism: 99 }),
      },
      boundary,
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/jobs',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });

    expect(res.statusCode).toBe(503);
    expect(res.headers['retry-after']).toBe('60');
    // jobService.createJob MUST NOT be called when cap is exceeded.
    expect(jobService.createJob).not.toHaveBeenCalled();

    const json = res.json();
    expect(json.status).toBe(503);
    expect(json.type).toContain('PARALLELISM_EXCEEDED');
    expect(json.detail).toContain('cap=4');
    await app.close();
  });

  it('returns 400 when parallel-deploy mode missing parallelism field', async () => {
    const { app, jobService } = await buildTestApp();
    const boundary = 'parallelmissingboundary';
    const body = buildMultipartBody(
      [{ name: 'flow.yaml', content: 'appId: com.test\n---\n- launchApp' }],
      {
        platform: 'android',
        metadata: JSON.stringify({ mode: 'parallel-deploy' }), // missing parallelism
      },
      boundary,
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/jobs',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });

    expect(res.statusCode).toBe(400);
    expect(jobService.createJob).not.toHaveBeenCalled();
    await app.close();
  });

  it('accepts parallel-deploy when parallelism within cap', async () => {
    const jobService = createMockJobService();
    jobService.createJob.mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
      status: 'queued',
      platform: 'android',
    });
    const { app } = await buildTestApp(jobService);
    const boundary = 'parallelokboundary';
    const body = buildMultipartBody(
      [{ name: 'flow.yaml', content: 'appId: com.test\n---\n- launchApp' }],
      {
        platform: 'android',
        metadata: JSON.stringify({ mode: 'parallel-deploy', parallelism: 3 }),
      },
      boundary,
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/jobs',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });

    expect(res.statusCode).toBe(201);
    expect(jobService.createJob).toHaveBeenCalledOnce();
    await app.close();
  });
});
