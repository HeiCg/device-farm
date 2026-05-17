import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runRetentionTask } from '../retention-task.js';

// --- Mock helpers ---

function createMockDb() {
  const selectFromWhereOrderBy = vi.fn();
  const selectFromWhere = vi.fn().mockReturnValue({ orderBy: selectFromWhereOrderBy });
  const selectFrom = vi.fn().mockReturnValue({ where: selectFromWhere });
  const deleteWhere = vi.fn().mockResolvedValue(undefined);

  return {
    select: vi.fn().mockReturnValue({ from: selectFrom }),
    delete: vi.fn().mockReturnValue({ where: deleteWhere }),
    _selectFrom: selectFrom,
    _selectFromWhere: selectFromWhere,
    _selectFromWhereOrderBy: selectFromWhereOrderBy,
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

describe('runRetentionTask', () => {
  let mockDb: ReturnType<typeof createMockDb>;
  let mockConfig: ReturnType<typeof createMockConfig>;
  let mockLogger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    mockDb = createMockDb();
    mockConfig = createMockConfig();
    mockLogger = createMockLogger();
    vi.restoreAllMocks();
  });

  it('deletes expired artifacts from filesystem and DB', async () => {
    const expiredArtifacts = [
      {
        id: 'art-1',
        jobId: 'job-1',
        type: 'video',
        filePath: '/tmp/test-artifacts/job-1/recording.mp4',
        fileName: 'recording.mp4',
        fileSizeBytes: 5000,
        createdAt: new Date('2020-01-01'),
      },
      {
        id: 'art-2',
        jobId: 'job-1',
        type: 'screenshot',
        filePath: '/tmp/test-artifacts/job-1/step-0.png',
        fileName: 'step-0.png',
        fileSizeBytes: 2000,
        createdAt: new Date('2020-01-01'),
      },
    ];

    mockDb._selectFromWhereOrderBy.mockResolvedValue(expiredArtifacts);

    const mockRm = vi.fn().mockResolvedValue(undefined);

    const result = await runRetentionTask(
      mockDb as any,
      mockConfig as any,
      mockLogger,
      { rmFn: mockRm },
    );

    expect(result.deleted).toBe(2);
    expect(result.freedBytes).toBe(7000);
    // 2 artifact files + 1 directory cleanup = 3 rm calls
    expect(mockRm).toHaveBeenCalledTimes(3);
    expect(mockDb.delete).toHaveBeenCalled();
  });

  it('continues deleting even if one file rm fails', async () => {
    const expiredArtifacts = [
      {
        id: 'art-1',
        jobId: 'job-1',
        type: 'video',
        filePath: '/tmp/test-artifacts/job-1/recording.mp4',
        fileName: 'recording.mp4',
        fileSizeBytes: 5000,
        createdAt: new Date('2020-01-01'),
      },
      {
        id: 'art-2',
        jobId: 'job-2',
        type: 'screenshot',
        filePath: '/tmp/test-artifacts/job-2/step-0.png',
        fileName: 'step-0.png',
        fileSizeBytes: 2000,
        createdAt: new Date('2020-01-01'),
      },
    ];

    mockDb._selectFromWhereOrderBy.mockResolvedValue(expiredArtifacts);

    const mockRm = vi.fn()
      .mockRejectedValueOnce(new Error('ENOENT'))
      .mockResolvedValue(undefined);

    const result = await runRetentionTask(
      mockDb as any,
      mockConfig as any,
      mockLogger,
      { rmFn: mockRm },
    );

    // Both should still be deleted from DB even if filesystem fails for one
    expect(result.deleted).toBe(2);
    expect(mockLogger.error).toHaveBeenCalled();
  });

  it('returns zero counts when no expired artifacts exist', async () => {
    mockDb._selectFromWhereOrderBy.mockResolvedValue([]);

    const result = await runRetentionTask(
      mockDb as any,
      mockConfig as any,
      mockLogger,
      { rmFn: vi.fn() },
    );

    expect(result.deleted).toBe(0);
    expect(result.freedBytes).toBe(0);
  });
});
