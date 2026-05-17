import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runCompressionTask } from '../compression-task.js';

// --- Mock helpers ---

function createMockDb() {
  const updateWhere = vi.fn().mockResolvedValue(undefined);
  const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
  const selectFromWhere = vi.fn();
  const selectFrom = vi.fn().mockReturnValue({ where: selectFromWhere });

  return {
    select: vi.fn().mockReturnValue({ from: selectFrom }),
    update: vi.fn().mockReturnValue({ set: updateSet }),
    _selectFrom: selectFrom,
    _selectFromWhere: selectFromWhere,
    _updateSet: updateSet,
    _updateWhere: updateWhere,
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

describe('runCompressionTask', () => {
  let mockDb: ReturnType<typeof createMockDb>;
  let mockConfig: ReturnType<typeof createMockConfig>;
  let mockLogger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    mockDb = createMockDb();
    mockConfig = createMockConfig();
    mockLogger = createMockLogger();
    vi.restoreAllMocks();
  });

  it('compresses old uncompressed video artifacts', async () => {
    const oldArtifacts = [
      {
        id: 'art-1',
        jobId: 'job-1',
        type: 'video',
        filePath: '/tmp/test-artifacts/job-1/recording.mp4',
        fileName: 'recording.mp4',
        compressed: false,
        fileSizeBytes: 10000,
        createdAt: new Date('2020-01-01'),
      },
    ];

    // Mock: select().from().where() returns old videos
    mockDb._selectFromWhere.mockResolvedValue(oldArtifacts);

    const result = await runCompressionTask(
      mockDb as any,
      mockConfig as any,
      mockLogger,
      {
        spawnFn: createMockSpawnSuccess(),
        statFn: vi.fn().mockResolvedValue({ size: 3000 }),
        renameFn: vi.fn().mockResolvedValue(undefined),
      },
    );

    expect(result.compressed).toBe(1);
    expect(result.savedBytes).toBe(7000); // 10000 - 3000
    expect(mockDb.update).toHaveBeenCalled();
  });

  it('skips artifacts when ffmpeg fails', async () => {
    const oldArtifacts = [
      {
        id: 'art-1',
        jobId: 'job-1',
        type: 'video',
        filePath: '/tmp/test-artifacts/job-1/recording.mp4',
        fileName: 'recording.mp4',
        compressed: false,
        fileSizeBytes: 10000,
        createdAt: new Date('2020-01-01'),
      },
    ];

    mockDb._selectFromWhere.mockResolvedValue(oldArtifacts);

    const result = await runCompressionTask(
      mockDb as any,
      mockConfig as any,
      mockLogger,
      {
        spawnFn: createMockSpawnFailure(),
        statFn: vi.fn(),
        renameFn: vi.fn(),
      },
    );

    expect(result.compressed).toBe(0);
    expect(result.savedBytes).toBe(0);
    expect(mockLogger.error).toHaveBeenCalled();
  });

  it('returns zero counts when no artifacts need compression', async () => {
    mockDb._selectFromWhere.mockResolvedValue([]);

    const result = await runCompressionTask(
      mockDb as any,
      mockConfig as any,
      mockLogger,
      {
        spawnFn: createMockSpawnSuccess(),
        statFn: vi.fn(),
        renameFn: vi.fn(),
      },
    );

    expect(result.compressed).toBe(0);
    expect(result.savedBytes).toBe(0);
  });
});

// --- Helpers ---

function createMockSpawnSuccess() {
  return vi.fn().mockReturnValue({
    on: vi.fn((event: string, cb: (...args: any[]) => void) => {
      if (event === 'close') {
        setTimeout(() => cb(0), 0);
      }
    }),
    stderr: { on: vi.fn() },
  });
}

function createMockSpawnFailure() {
  return vi.fn().mockReturnValue({
    on: vi.fn((event: string, cb: (...args: any[]) => void) => {
      if (event === 'close') {
        setTimeout(() => cb(1), 0);
      }
    }),
    stderr: { on: vi.fn() },
  });
}
