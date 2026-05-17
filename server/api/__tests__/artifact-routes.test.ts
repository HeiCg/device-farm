import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  fastifyZodOpenApiPlugin,
  validatorCompiler,
  serializerCompiler,
} from 'fastify-zod-openapi';
import { jobRoutes } from '../routes.js';
import { errorHandler } from '../error-handler.js';
import multipart from '@fastify/multipart';
import type { JobService } from '../../jobs/job-service.js';
import type { PoolManager } from '../../pool/pool-manager.js';
import type { Database } from '../../db/index.js';
import type { ArtifactService } from '../../artifacts/artifact-service.js';

// --- Mock helpers ---

function createMockArtifactService() {
  return {
    listByJob: vi.fn().mockResolvedValue([]),
    getById: vi.fn().mockResolvedValue(null),
    createArtifact: vi.fn(),
    deleteByJob: vi.fn(),
    ensureJobDir: vi.fn(),
    getArtifactPath: vi.fn(),
  };
}

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
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
        orderBy: vi.fn().mockResolvedValue([]),
      }),
    }),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };
}

async function buildTestApp(overrides: {
  artifactService?: ReturnType<typeof createMockArtifactService>;
  jobService?: ReturnType<typeof createMockJobService>;
} = {}) {
  const app = Fastify({ logger: false });

  const artifactService = overrides.artifactService ?? createMockArtifactService();
  const jobService = overrides.jobService ?? createMockJobService();
  const pool = createMockPool();
  const db = createMockDb();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(fastifyZodOpenApiPlugin);

  await app.register(multipart, { limits: { fileSize: 1_048_576, files: 50, fields: 10 } });

  app.decorate('jobService', jobService as unknown as JobService);
  app.decorate('pool', pool as unknown as PoolManager);
  app.decorate('db', db as unknown as Database);
  app.decorate('artifactService', artifactService as unknown as ArtifactService);
  app.setErrorHandler(errorHandler);

  await app.register(jobRoutes, { prefix: '/api' });
  await app.ready();

  return { app, artifactService, jobService };
}

describe('Artifact Routes', () => {
  let app: FastifyInstance;
  let artifactService: ReturnType<typeof createMockArtifactService>;

  afterEach(async () => {
    if (app) await app.close();
  });

  describe('GET /api/jobs/:id/artifacts', () => {
    it('returns 200 with JSON array of artifacts when artifacts exist', async () => {
      const jobId = '66666666-6666-4666-8666-666666666666';
      const mockArtifacts = [
        {
          id: '77777777-7777-4777-8777-777777777777',
          jobId,
          type: 'video',
          filePath: `/tmp/artifacts/${jobId}/recording.mp4`,
          fileName: 'recording.mp4',
          mimeType: 'video/mp4',
          fileSizeBytes: 1024,
          compressed: false,
          compressedAt: null,
          createdAt: new Date('2026-01-01'),
        },
        {
          id: '88888888-8888-4888-8888-888888888888',
          jobId,
          type: 'screenshot',
          filePath: `/tmp/artifacts/${jobId}/step-0.png`,
          fileName: 'step-0.png',
          mimeType: 'image/png',
          fileSizeBytes: 512,
          compressed: false,
          compressedAt: null,
          createdAt: new Date('2026-01-01'),
        },
      ];

      ({ app, artifactService } = await buildTestApp({
        artifactService: {
          ...createMockArtifactService(),
          listByJob: vi.fn().mockResolvedValue(mockArtifacts),
        },
      }));

      const res = await app.inject({
        method: 'GET',
        url: `/api/jobs/${jobId}/artifacts`,
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body).toHaveLength(2);
      expect(body[0].id).toBe(mockArtifacts[0].id);
      expect(body[1].id).toBe(mockArtifacts[1].id);
    });

    it('returns 200 with empty array when no artifacts for job', async () => {
      ({ app, artifactService } = await buildTestApp());

      const res = await app.inject({
        method: 'GET',
        url: '/api/jobs/66666666-6666-4666-8666-666666666666/artifacts',
      });

      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.payload)).toEqual([]);
    });
  });

  describe('GET /api/jobs/:id/artifacts/:artifactId', () => {
    it('returns 404 when artifactId does not exist', async () => {
      ({ app, artifactService } = await buildTestApp());

      const res = await app.inject({
        method: 'GET',
        url: '/api/jobs/66666666-6666-4666-8666-666666666666/artifacts/nonexistent',
      });

      expect(res.statusCode).toBe(404);
    });

    it('returns 404 when artifact.jobId does not match route :id param', async () => {
      const wrongJobArtifact = {
        id: 'art-1',
        jobId: 'other-job',
        type: 'video',
        filePath: '/tmp/artifacts/other-job/recording.mp4',
        fileName: 'recording.mp4',
        mimeType: 'video/mp4',
      };

      ({ app, artifactService } = await buildTestApp({
        artifactService: {
          ...createMockArtifactService(),
          getById: vi.fn().mockResolvedValue(wrongJobArtifact),
        },
      }));

      const res = await app.inject({
        method: 'GET',
        url: '/api/jobs/66666666-6666-4666-8666-666666666666/artifacts/art-1',
      });

      expect(res.statusCode).toBe(404);
    });

    it('returns 404 when artifact DB record exists but file is missing on disk', async () => {
      const artifact = {
        id: 'art-1',
        jobId: '66666666-6666-4666-8666-666666666666',
        type: 'video',
        filePath: '/tmp/nonexistent/recording.mp4',
        fileName: 'recording.mp4',
        mimeType: 'video/mp4',
      };

      ({ app, artifactService } = await buildTestApp({
        artifactService: {
          ...createMockArtifactService(),
          getById: vi.fn().mockResolvedValue(artifact),
        },
      }));

      const res = await app.inject({
        method: 'GET',
        url: '/api/jobs/66666666-6666-4666-8666-666666666666/artifacts/art-1',
      });

      expect(res.statusCode).toBe(404);
    });
  });
});
