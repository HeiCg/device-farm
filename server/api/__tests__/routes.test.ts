import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import {
  fastifyZodOpenApiPlugin,
  validatorCompiler,
  serializerCompiler,
} from 'fastify-zod-openapi';
import { errorHandler } from '../error-handler.js';
import { jobRoutes, deviceRoutes, healthRoute } from '../routes.js';
import type { JobService } from '../../jobs/job-service.js';
import type { PoolManager } from '../../pool/pool-manager.js';
import type { HealthChecker } from '../../pool/health-checker.js';
import type { ArtifactService } from '../../artifacts/artifact-service.js';

// ---- Mock factories ----

function createMockJobService() {
  return {
    createJob: vi.fn(),
    cancelJob: vi.fn(),
    getQueueDepth: vi.fn().mockReturnValue({ android: 0, ios: 0 }),
    shutdown: vi.fn(),
  };
}

function createMockPool() {
  return {
    getDevices: vi.fn().mockReturnValue([]),
    getDevice: vi.fn().mockReturnValue(null),
    getDeviceMap: vi.fn().mockReturnValue(new Map()),
    getDriver: vi.fn().mockReturnValue(null),
  };
}

function createMockDb() {
  return {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };
}

function createMockHealthChecker() {
  return {
    checkAll: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  };
}

// ---- Test app builder ----

async function buildTestApp(overrides: {
  jobService?: ReturnType<typeof createMockJobService>;
  pool?: ReturnType<typeof createMockPool>;
  db?: any;
  healthChecker?: ReturnType<typeof createMockHealthChecker>;
} = {}) {
  const app = Fastify({ logger: false });

  const jobService = overrides.jobService ?? createMockJobService();
  const pool = overrides.pool ?? createMockPool();
  const db = overrides.db ?? createMockDb();
  const healthChecker = overrides.healthChecker ?? createMockHealthChecker();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(fastifyZodOpenApiPlugin);

  // Register multipart before routes
  await app.register(multipart, { limits: { fileSize: 1_048_576, files: 50, fields: 10 } });

  // Decorate with mocks
  app.decorate('jobService', jobService as unknown as JobService);
  app.decorate('pool', pool as unknown as PoolManager);
  app.decorate('db', db);
  app.decorate('healthChecker', healthChecker as unknown as HealthChecker);
  app.decorate('artifactService', {
    listByJob: vi.fn().mockResolvedValue([]),
    getById: vi.fn().mockResolvedValue(null),
    createArtifact: vi.fn(),
    deleteByJob: vi.fn(),
    ensureJobDir: vi.fn(),
    getArtifactPath: vi.fn(),
  } as unknown as ArtifactService);

  // Set error handler
  app.setErrorHandler(errorHandler);

  // Register routes
  await app.register(jobRoutes, { prefix: '/api' });
  await app.register(deviceRoutes, { prefix: '/api' });
  await app.register(healthRoute, { prefix: '/api' });

  return { app, jobService, pool, db, healthChecker };
}

// ---- Multipart helpers ----

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

// ---- Tests ----

describe('POST /api/jobs', () => {
  it('creates a job with valid multipart -> 201', async () => {
    const jobService = createMockJobService();
    const jobId = '11111111-1111-4111-8111-111111111111';
    jobService.createJob.mockResolvedValue({
      id: jobId,
      status: 'queued',
      platform: 'android',
    });
    const { app } = await buildTestApp({ jobService });

    const boundary = 'testboundary123';
    const body = buildMultipartBody(
      [{ name: 'login.yaml', content: 'appId: com.test\n---\n- launchApp' }],
      {
        metadata: JSON.stringify({ branch: 'main', commit: 'abc123' }),
        platform: 'android',
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
    const json = res.json();
    expect(json.id).toBe(jobId);
    expect(json.status).toBe('queued');
    expect(jobService.createJob).toHaveBeenCalledWith({
      files: [{ filename: 'login.yaml', content: 'appId: com.test\n---\n- launchApp' }],
      metadata: { branch: 'main', commit: 'abc123' },
      platform: 'android',
    });
  });

  it('returns 400 for invalid YAML', async () => {
    const { app } = await buildTestApp();

    const boundary = 'testboundary456';
    const body = buildMultipartBody(
      [{ name: 'bad.yaml', content: '{{invalid yaml:::' }],
      {
        metadata: JSON.stringify({ branch: 'main' }),
        platform: 'android',
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
  });

  it('returns 429 when queue is full', async () => {
    const jobService = createMockJobService();
    const err = new Error('Queue full for platform android');
    (err as any).code = 'QUEUE_FULL';
    jobService.createJob.mockRejectedValue(err);
    const { app } = await buildTestApp({ jobService });

    const boundary = 'testboundary789';
    const body = buildMultipartBody(
      [{ name: 'test.yaml', content: 'appId: com.test\n---\n- launchApp' }],
      {
        metadata: JSON.stringify({ branch: 'main' }),
        platform: 'android',
      },
      boundary,
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/jobs',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });

    expect(res.statusCode).toBe(429);
    expect(res.headers['retry-after']).toBe('30');
    expect(res.headers['content-type']).toContain('application/problem+json');
  });

  it('returns 400 for missing platform field', async () => {
    const { app } = await buildTestApp();

    const boundary = 'testboundary000';
    const body = buildMultipartBody(
      [{ name: 'test.yaml', content: 'appId: com.test\n---\n- launchApp' }],
      { metadata: JSON.stringify({ branch: 'main' }) },
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
  });
});

describe('GET /api/jobs', () => {
  it('returns paginated list', async () => {
    const db = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([
        {
          id: 'job-1',
          status: 'passed',
          platform: 'android',
          metadata: { branch: 'main' },
          createdAt: new Date('2026-01-01'),
          startedAt: null,
          finishedAt: null,
          deviceId: null,
          resultSummary: null,
          maestroOutput: null,
          errorMessage: null,
        },
      ]),
    };
    const { app } = await buildTestApp({ db: db as any });

    const res = await app.inject({
      method: 'GET',
      url: '/api/jobs',
    });

    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.data).toHaveLength(1);
    expect(json.hasMore).toBe(false);
  });

  it('filters by status', async () => {
    const db = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    };
    const { app } = await buildTestApp({ db: db as any });

    const res = await app.inject({
      method: 'GET',
      url: '/api/jobs?status=passed',
    });

    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.data).toHaveLength(0);
  });

  it('filters by platform', async () => {
    const db = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    };
    const { app } = await buildTestApp({ db: db as any });

    const res = await app.inject({
      method: 'GET',
      url: '/api/jobs?platform=ios',
    });

    expect(res.statusCode).toBe(200);
  });
});

describe('GET /api/jobs/:id', () => {
  it('returns job with steps inline', async () => {
    const mockJob = {
      id: 'job-1',
      status: 'passed',
      platform: 'android',
      metadata: { branch: 'main' },
      createdAt: new Date('2026-01-01'),
      startedAt: new Date('2026-01-01'),
      finishedAt: new Date('2026-01-01'),
      deviceId: 'dev-1',
      resultSummary: { total: 1, passed: 1 },
      maestroOutput: 'test output',
      errorMessage: null,
    };
    const mockSteps = [
      { id: 's1', jobId: 'job-1', stepIndex: 0, flowName: 'login', command: 'launchApp', status: 'passed', durationMs: 100, error: null, screenshotPath: null, startedAt: new Date(), finishedAt: new Date() },
    ];

    // Build a chainable mock that handles three sequential select() calls:
    // 1st: select().from(jobs).where(eq(id)).limit(1) -> [mockJob]
    // 2nd: select().from(jobSteps).where(eq(jobId)).orderBy(stepIndex) -> mockSteps
    // 3rd: select().from(testExecutions).where(eq(jobId)).limit(1) -> [] (no linked execution)
    let selectCallCount = 0;
    const db = {
      select: vi.fn().mockImplementation(() => {
        selectCallCount++;
        if (selectCallCount === 1) {
          // Job query chain
          return {
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([mockJob]),
              }),
            }),
          };
        }
        if (selectCallCount === 2) {
          // Steps query chain
          return {
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                orderBy: vi.fn().mockResolvedValue(mockSteps),
              }),
            }),
          };
        }
        // Linked execution query chain
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([]),
            }),
          }),
        };
      }),
    };
    const { app } = await buildTestApp({ db: db as any });

    const res = await app.inject({
      method: 'GET',
      url: '/api/jobs/job-1',
    });

    // The route should call db.select for both job and steps
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.id).toBe('job-1');
  });

  it('returns 404 for non-existent job', async () => {
    const db = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
    };
    const { app } = await buildTestApp({ db: db as any });

    const res = await app.inject({
      method: 'GET',
      url: '/api/jobs/nonexistent',
    });

    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('application/problem+json');
  });
});

describe('GET /api/jobs/:id/logs', () => {
  it('returns maestro output', async () => {
    const db = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([
              { id: 'job-1', maestroOutput: 'Running flow: login\nPASSED' },
            ]),
          }),
        }),
      }),
    };
    const { app } = await buildTestApp({ db: db as any });

    const res = await app.inject({
      method: 'GET',
      url: '/api/jobs/job-1/logs',
    });

    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.logs).toBe('Running flow: login\nPASSED');
  });

  it('returns 404 for non-existent job', async () => {
    const db = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
    };
    const { app } = await buildTestApp({ db: db as any });

    const res = await app.inject({
      method: 'GET',
      url: '/api/jobs/nonexistent/logs',
    });

    expect(res.statusCode).toBe(404);
  });
});

// Recording stub test removed -- replaced by artifact routes in Plan 03-05
// See server/api/__tests__/artifact-routes.test.ts for artifact endpoint tests

describe('DELETE /api/jobs/:id', () => {
  it('cancels a job -> 200', async () => {
    const jobService = createMockJobService();
    jobService.cancelJob.mockResolvedValue(undefined);
    const { app } = await buildTestApp({ jobService });

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/jobs/job-1',
    });

    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.status).toBe('cancelled');
    expect(jobService.cancelJob).toHaveBeenCalledWith('job-1');
  });

  it('returns 404 for non-existent job', async () => {
    const jobService = createMockJobService();
    const err = new Error('Job not-found not found in queue or running jobs');
    (err as any).code = 'NOT_FOUND';
    jobService.cancelJob.mockRejectedValue(err);
    const { app } = await buildTestApp({ jobService });

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/jobs/not-found',
    });

    expect(res.statusCode).toBe(404);
  });
});

describe('GET /api/devices', () => {
  it('returns device list', async () => {
    const pool = createMockPool();
    const dev1 = '22222222-2222-4222-8222-222222222222';
    const dev2 = '33333333-3333-4333-8333-333333333333';
    const job1 = '44444444-4444-4444-8444-444444444444';
    pool.getDevices.mockReturnValue([
      {
        id: dev1,
        name: 'android-1',
        platform: 'android',
        state: 'idle',
        emulatorId: 'emulator-5554',
        port: 5554,
        pid: 1234,
        currentJobId: null,
        metadata: null,
      },
      {
        id: dev2,
        name: 'ios-1',
        platform: 'ios',
        state: 'running',
        emulatorId: 'sim-1',
        port: null,
        pid: null,
        currentJobId: job1,
        metadata: null,
      },
    ]);
    const { app } = await buildTestApp({ pool });

    const res = await app.inject({
      method: 'GET',
      url: '/api/devices',
    });

    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json).toHaveLength(2);
    expect(json[0].id).toBe(dev1);
    expect(json[1].currentJobId).toBe(job1);
  });
});

describe('POST /api/devices/:id/restart', () => {
  it('restarts a device -> 200', async () => {
    const pool = createMockPool();
    pool.getDevice.mockReturnValue({
      id: 'dev-1',
      name: 'android-1',
      platform: 'android',
      state: 'idle',
      emulatorId: 'emulator-5554',
    });
    const mockDriver = {
      shutdown: vi.fn().mockResolvedValue(undefined),
      boot: vi.fn().mockResolvedValue({ port: 5554, pid: 12345 }),
    };
    pool.getDriver.mockReturnValue(mockDriver);
    pool.getDeviceMap.mockReturnValue(new Map([
      ['dev-1', { id: 'dev-1', platform: 'android', emulatorId: 'emulator-5554', state: 'idle', transition: vi.fn() }],
    ]));
    const { app } = await buildTestApp({ pool });

    const res = await app.inject({
      method: 'POST',
      url: '/api/devices/dev-1/restart',
    });

    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.status).toBe('restarting');
  });

  it('returns 404 for unknown device', async () => {
    const pool = createMockPool();
    pool.getDevice.mockReturnValue(null);
    const { app } = await buildTestApp({ pool });

    const res = await app.inject({
      method: 'POST',
      url: '/api/devices/unknown/restart',
    });

    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('application/problem+json');
  });
});

describe('GET /api/health', () => {
  it('returns status with queue depth', async () => {
    const jobService = createMockJobService();
    jobService.getQueueDepth.mockReturnValue({ android: 3, ios: 1 });
    const pool = createMockPool();
    pool.getDevices.mockReturnValue([
      { id: 'dev-1', name: 'android-1', platform: 'android', state: 'idle' },
    ]);
    const { app } = await buildTestApp({ jobService, pool });

    const res = await app.inject({
      method: 'GET',
      url: '/api/health',
    });

    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.status).toBe('ok');
    expect(json.queue).toEqual({ android: 3, ios: 1 });
    expect(json.devices).toHaveLength(1);
    expect(typeof json.uptime).toBe('number');
  });
});
