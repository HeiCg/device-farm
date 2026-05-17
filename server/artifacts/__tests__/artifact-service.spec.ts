import { describe, it, expect, vi, beforeEach } from 'vitest';
import pino from 'pino';
import { ArtifactService } from '../artifact-service.js';
import type { ArtifactType } from '../../streaming/internal/types.js';

// --- Mock helpers ---

function createMockDb() {
  const insertReturning = vi.fn().mockResolvedValue([{ id: 'art-1' }]);
  const insertValues = vi.fn().mockReturnValue({ returning: insertReturning });
  const selectFrom = vi.fn();
  const deleteWhere = vi.fn().mockResolvedValue(undefined);

  return {
    insert: vi.fn().mockReturnValue({ values: insertValues }),
    select: vi.fn().mockReturnValue({ from: selectFrom }),
    delete: vi.fn().mockReturnValue({ where: deleteWhere }),
    _selectFrom: selectFrom,
    _insertValues: insertValues,
    _insertReturning: insertReturning,
    _deleteWhere: deleteWhere,
  };
}

function createMockConfig() {
  return {
    storage: {
      artifacts: {
        path: '/tmp/test-artifacts',
        retention_days: 30,
        compress_after_days: 7,
        format: 'mp4' as const,
        max_storage_gb: 50,
      },
      logs: { retention_days: 90, path: './storage/logs' },
    },
    server: { port: 3000, host: '0.0.0.0' },
    pool: {
      max_devices: 10,
      android: { enabled: true, max_instances: 5, headless: true, api_level: '34', system_image_variant: 'google_apis', device_profile: 'pixel_7', ram_mb: 2048 },
      ios: { enabled: true, max_instances: 5, runtime: 'iOS-17-5', device_type: 'iPhone-15' },
    },
    jobs: { timeout_minutes: 30, max_queue_size: 100, cleanup_completed_after_days: 7 },
    job_metadata_schema: { required: [], optional: [] },
    database_url: 'postgresql://localhost:5432/test',
  };
}

function createMockLogger() {
  return {
    child: vi.fn().mockReturnThis(),
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  } as any;
}

describe('ArtifactService', () => {
  let service: ArtifactService;
  let mockDb: ReturnType<typeof createMockDb>;
  let mockConfig: ReturnType<typeof createMockConfig>;
  let mockLogger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    mockDb = createMockDb();
    mockConfig = createMockConfig();
    mockLogger = createMockLogger();
    service = new ArtifactService(mockDb as any, mockConfig as any, mockLogger);
  });

  describe('createArtifact', () => {
    it('inserts into artifacts table and returns id', async () => {
      const result = await service.createArtifact({
        jobId: 'job-1',
        type: 'video' as ArtifactType,
        filePath: '/tmp/test-artifacts/job-1/recording.mp4',
        fileName: 'recording.mp4',
        mimeType: 'video/mp4',
        fileSizeBytes: 1024,
      });

      expect(result).toEqual({ id: 'art-1' });
      expect(mockDb.insert).toHaveBeenCalled();
    });
  });

  describe('listByJob', () => {
    it('returns all artifacts for a specific job', async () => {
      const mockArtifacts = [
        { id: 'art-1', jobId: 'job-1', type: 'video', fileName: 'recording.mp4' },
        { id: 'art-2', jobId: 'job-1', type: 'screenshot', fileName: 'step-0.png' },
      ];

      mockDb._selectFrom.mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockResolvedValue(mockArtifacts),
        }),
      });

      const result = await service.listByJob('job-1');
      expect(result).toEqual(mockArtifacts);
      expect(mockDb.select).toHaveBeenCalled();
    });
  });

  describe('getById', () => {
    it('returns null for unknown ID', async () => {
      mockDb._selectFrom.mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      });

      const result = await service.getById('unknown-id');
      expect(result).toBeNull();
    });

    it('returns artifact when found', async () => {
      const artifact = { id: 'art-1', jobId: 'job-1', type: 'video' };
      mockDb._selectFrom.mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([artifact]),
        }),
      });

      const result = await service.getById('art-1');
      expect(result).toEqual(artifact);
    });
  });

  describe('ensureJobDir', () => {
    it('creates nested directory and returns path', async () => {
      const path = await service.ensureJobDir('job-1');
      expect(path).toBe('/tmp/test-artifacts/job-1');
    });
  });

  describe('getArtifactPath', () => {
    it('returns resolved path within job dir', () => {
      const path = service.getArtifactPath('job-1', 'recording.mp4');
      expect(path).toBe('/tmp/test-artifacts/job-1/recording.mp4');
    });
  });

  // Phase 21 / Plan 21-01 — SC3 DB-LAYER idempotency tests (mock-based, no DB).

  describe('createArtifact — recordingId passthrough [Phase 21-01]', () => {
    it('threads recordingId through to db.insert().values()', async () => {
      const valuesSpy = vi.fn(() => ({ returning: vi.fn(async () => [{ id: 'artifact-uuid-1' }]) }));
      const db = { insert: vi.fn(() => ({ values: valuesSpy })) } as any;
      const svc = new ArtifactService(db, { storage: { artifacts: { path: '/tmp' } } } as any, pino({ level: 'silent' }));

      await svc.createArtifact({
        jobId: 'job-uuid-1',
        recordingId: 'rec-uuid-1',
        type: 'video',
        filePath: '/tmp/job-uuid-1/recording.mp4',
        fileName: 'recording.mp4',
        mimeType: 'video/mp4',
      });

      expect(valuesSpy).toHaveBeenCalledWith(expect.objectContaining({
        recordingId: 'rec-uuid-1',
        jobId: 'job-uuid-1',
        type: 'video',
      }));
    });

    it('omits recordingId when not provided (back-compat)', async () => {
      const valuesSpy = vi.fn(() => ({ returning: vi.fn(async () => [{ id: 'artifact-uuid-2' }]) }));
      const db = { insert: vi.fn(() => ({ values: valuesSpy })) } as any;
      const svc = new ArtifactService(db, { storage: { artifacts: { path: '/tmp' } } } as any, pino({ level: 'silent' }));

      await svc.createArtifact({
        jobId: 'job-uuid-2',
        type: 'log',
        filePath: '/tmp/job-uuid-2/maestro.log',
        fileName: 'maestro.log',
        mimeType: 'text/plain',
      });

      const calledWith = (valuesSpy.mock.calls[0] as any[])[0];
      expect(calledWith.recordingId).toBeUndefined();
    });
  });

  describe('createArtifactIdempotent [SC3 DB layer, Phase 21-01]', () => {
    it('returns {id} when insert succeeds (new recordingId)', async () => {
      const returningSpy = vi.fn(async () => [{ id: 'artifact-uuid-3' }]);
      const onConflictSpy = vi.fn(() => ({ returning: returningSpy }));
      const valuesSpy = vi.fn(() => ({ onConflictDoNothing: onConflictSpy }));
      const db = { insert: vi.fn(() => ({ values: valuesSpy })) } as any;
      const svc = new ArtifactService(db, { storage: { artifacts: { path: '/tmp' } } } as any, pino({ level: 'silent' }));

      const result = await svc.createArtifactIdempotent({
        jobId: 'job-uuid-3',
        recordingId: 'rec-uuid-3',
        type: 'video',
        filePath: '/tmp/job-uuid-3/recording.mp4',
        fileName: 'recording.mp4',
        mimeType: 'video/mp4',
      });

      expect(result).toEqual({ id: 'artifact-uuid-3' });
      expect(onConflictSpy).toHaveBeenCalledTimes(1);
      const targetArg = (onConflictSpy.mock.calls[0] as any[])[0] as { target: unknown };
      expect(targetArg).toHaveProperty('target');
    });

    it('returns null when recordingId already exists (conflict path)', async () => {
      const returningSpy = vi.fn(async () => []);  // empty → conflict skipped insert
      const onConflictSpy = vi.fn(() => ({ returning: returningSpy }));
      const valuesSpy = vi.fn(() => ({ onConflictDoNothing: onConflictSpy }));
      const db = { insert: vi.fn(() => ({ values: valuesSpy })) } as any;
      const svc = new ArtifactService(db, { storage: { artifacts: { path: '/tmp' } } } as any, pino({ level: 'silent' }));

      const result = await svc.createArtifactIdempotent({
        jobId: 'job-uuid-4',
        recordingId: 'rec-uuid-4',
        type: 'video',
        filePath: '/tmp/job-uuid-4/recording.mp4',
        fileName: 'recording.mp4',
        mimeType: 'video/mp4',
      });

      expect(result).toBeNull();
    });
  });
});
