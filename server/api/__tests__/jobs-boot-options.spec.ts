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

// Phase 31 / Plan 31-03 / SC3 — multipart `boot_options` field parsing in
// POST /api/jobs. The schema is bootOptionsSchema (server/config/schema.ts);
// invalid JSON or invalid shape returns RFC 7807 problem+json with
// code='VALIDATION_ERROR'.

// ---- Test app builder (mirrors routes.test.ts canonical pattern) ----

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
  const db: any = {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };
  app.decorate('db', db);
  app.decorate('healthChecker', {
    checkAll: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  } as unknown as HealthChecker);
  app.decorate('artifactService', {
    listByJob: vi.fn().mockResolvedValue([]),
    getById: vi.fn().mockResolvedValue(null),
  } as unknown as ArtifactService);

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

describe('POST /api/jobs — boot_options multipart', () => {
  it('boot_options field parsed and forwarded to JobService.createJob', async () => {
    const jobService = createMockJobService();
    const jobId = '22222222-2222-4222-8222-222222222222';
    jobService.createJob.mockResolvedValue({
      id: jobId,
      status: 'queued',
      platform: 'android',
    });
    const { app } = await buildTestApp(jobService);

    const boundary = 'bootoptboundary1';
    const body = buildMultipartBody(
      [{ name: 'flow.yaml', content: 'appId: com.test\n---\n- launchApp' }],
      {
        platform: 'android',
        metadata: JSON.stringify({}),
        boot_options: JSON.stringify({ coldBoot: true, noAudio: false }),
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
    const callArg = jobService.createJob.mock.calls[0][0];
    expect(callArg.bootOptions).toEqual({
      coldBoot: true,
      noAudio: false,
      gpu: 'swiftshader_indirect',
    });
  });

  it('missing boot_options field: job created with bootOptions=undefined', async () => {
    const jobService = createMockJobService();
    const jobId = '33333333-3333-4333-8333-333333333333';
    jobService.createJob.mockResolvedValue({
      id: jobId,
      status: 'queued',
      platform: 'android',
    });
    const { app } = await buildTestApp(jobService);

    const boundary = 'bootoptboundary2';
    const body = buildMultipartBody(
      [{ name: 'flow.yaml', content: 'appId: com.test\n---\n- launchApp' }],
      {
        platform: 'android',
        metadata: JSON.stringify({}),
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
    const callArg = jobService.createJob.mock.calls[0][0];
    expect(callArg.bootOptions).toBeUndefined();
  });

  it('invalid JSON in boot_options field → 400 VALIDATION_ERROR', async () => {
    const { app } = await buildTestApp();

    const boundary = 'bootoptboundary3';
    const body = buildMultipartBody(
      [{ name: 'flow.yaml', content: 'appId: com.test\n---\n- launchApp' }],
      {
        platform: 'android',
        metadata: JSON.stringify({}),
        boot_options: 'not-json',
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
    expect(res.headers['content-type']).toContain('application/problem+json');
    const json = res.json();
    // RFC 7807 problem+json: code is encoded in `type` URI
    // (server/api/error-handler.ts).
    expect(json.type).toContain('VALIDATION_ERROR');
  });

  it('invalid shape in boot_options (gpu=metal) → 400 VALIDATION_ERROR', async () => {
    const { app } = await buildTestApp();

    const boundary = 'bootoptboundary4';
    const body = buildMultipartBody(
      [{ name: 'flow.yaml', content: 'appId: com.test\n---\n- launchApp' }],
      {
        platform: 'android',
        metadata: JSON.stringify({}),
        boot_options: JSON.stringify({ gpu: 'metal' }),
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
    expect(res.headers['content-type']).toContain('application/problem+json');
    const json = res.json();
    // RFC 7807 problem+json: code is encoded in `type` URI
    // (server/api/error-handler.ts).
    expect(json.type).toContain('VALIDATION_ERROR');
  });
});
