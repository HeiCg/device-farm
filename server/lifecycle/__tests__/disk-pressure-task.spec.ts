import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runDiskPressureTask } from '../disk-pressure-task.js';

// --- Mock helpers ---

function createMockDb(totalUsage: number, artifacts: any[] = []) {
  const deleteWhere = vi.fn().mockResolvedValue(undefined);

  // The disk pressure task makes two types of queries:
  // 1. db.select({total: ...}).from(artifacts) -- custom select with SUM
  // 2. db.select().from(artifacts).orderBy(...) -- get oldest artifacts
  //
  // We need to differentiate them by tracking call order.
  let selectCallCount = 0;

  const selectFn = vi.fn().mockImplementation(() => {
    selectCallCount++;
    const callNum = selectCallCount;

    return {
      from: vi.fn().mockImplementation(() => {
        if (callNum === 1) {
          // SUM query - returns [{total}] directly (no where/orderBy)
          return Promise.resolve([{ total: totalUsage }]);
        }
        // Oldest artifacts query
        return {
          orderBy: vi.fn().mockResolvedValue(artifacts),
        };
      }),
    };
  });

  return {
    select: selectFn,
    delete: vi.fn().mockReturnValue({ where: deleteWhere }),
    _deleteWhere: deleteWhere,
  };
}

function createMockConfig(maxStorageGb = 0.00001) {
  return {
    storage: {
      artifacts: {
        path: '/tmp/test-artifacts',
        retention_days: 30,
        compress_after_days: 7,
        format: 'mp4' as const,
        max_storage_gb: maxStorageGb,
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

describe('runDiskPressureTask', () => {
  let mockLogger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    mockLogger = createMockLogger();
    vi.restoreAllMocks();
  });

  it('deletes oldest artifacts when over storage limit', async () => {
    const oldestArtifacts = [
      {
        id: 'art-1',
        jobId: 'job-1',
        type: 'video',
        filePath: '/tmp/test-artifacts/job-1/recording.mp4',
        fileName: 'recording.mp4',
        fileSizeBytes: 8000,
        createdAt: new Date('2020-01-01'),
      },
      {
        id: 'art-2',
        jobId: 'job-2',
        type: 'screenshot',
        filePath: '/tmp/test-artifacts/job-2/step-0.png',
        fileName: 'step-0.png',
        fileSizeBytes: 5000,
        createdAt: new Date('2020-01-02'),
      },
    ];

    // 20KB total, limit ~10KB
    const mockDb = createMockDb(20000, oldestArtifacts);
    const mockConfig = createMockConfig(0.00001);
    const mockRm = vi.fn().mockResolvedValue(undefined);

    const result = await runDiskPressureTask(
      mockDb as any,
      mockConfig as any,
      mockLogger,
      { rmFn: mockRm },
    );

    expect(result.deleted).toBeGreaterThan(0);
    expect(result.freedBytes).toBeGreaterThan(0);
    expect(result.currentUsageBytes).toBeDefined();
    expect(result.maxBytes).toBeGreaterThan(0);
  });

  it('does nothing when under storage limit', async () => {
    const mockDb = createMockDb(1000);
    const mockConfig = createMockConfig(50); // 50GB limit, only 1KB used

    const result = await runDiskPressureTask(
      mockDb as any,
      mockConfig as any,
      mockLogger,
      { rmFn: vi.fn() },
    );

    expect(result.deleted).toBe(0);
    expect(result.freedBytes).toBe(0);
    expect(result.currentUsageBytes).toBe(1000);
    expect(result.maxBytes).toBe(50 * 1024 * 1024 * 1024);
  });

  it('handles errors when deleting individual artifacts', async () => {
    const oldestArtifacts = [
      {
        id: 'art-1',
        jobId: 'job-1',
        type: 'video',
        filePath: '/tmp/test-artifacts/job-1/recording.mp4',
        fileName: 'recording.mp4',
        fileSizeBytes: 15000,
        createdAt: new Date('2020-01-01'),
      },
    ];

    const mockDb = createMockDb(20000, oldestArtifacts);
    const mockConfig = createMockConfig(0.00001);
    const mockRm = vi.fn().mockRejectedValue(new Error('Permission denied'));

    const result = await runDiskPressureTask(
      mockDb as any,
      mockConfig as any,
      mockLogger,
      { rmFn: mockRm },
    );

    // Should still count the deletion (DB record removed even if file fails)
    expect(result.deleted).toBe(1);
    expect(mockLogger.error).toHaveBeenCalled();
  });
});
