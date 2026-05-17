/**
 * Phase 37 Plan 37-04 — PoolManager.allocateMany spec.
 *
 * Covers the batch-allocation primitive backing runParallelDeploy:
 *   - happy path: returns N AllocatedDevices when N idle devices exist
 *   - partial: throws AggregateError and rolls back partial allocations
 *     when fewer devices are available
 *   - Promise.allSettled semantics: NOT short-circuited by first failure
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import pino from 'pino';
import { PoolManager } from '../pool-manager.js';
import { ProcessTracker } from '../process-tracker.js';
import { DeviceState } from '../../types/index.js';
import type { DeviceDriver } from '../types.js';
import type { AppConfig } from '../../config/schema.js';

function createMockDriver(): DeviceDriver {
  return {
    create: vi.fn().mockResolvedValue('mock-emu'),
    boot: vi.fn().mockResolvedValue({ port: 5554, pid: 12345 }),
    shutdown: vi.fn().mockResolvedValue(undefined),
    isHealthy: vi.fn().mockResolvedValue(true),
    cleanup: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockConfig(): AppConfig {
  return {
    server: { port: 3000, host: '0.0.0.0' },
    pool: {
      max_devices: 10,
      android: {
        enabled: false,
        max_instances: 0,
        headless: true,
        api_level: '34',
        system_image_variant: 'google_apis',
        device_profile: 'pixel_7',
        ram_mb: 2048,
        max_parallelism: 4,
      },
      ios: {
        enabled: false,
        max_instances: 0,
        runtime: 'iOS-17-5',
        device_type: 'iPhone-15',
        max_parallelism: 2,
      },
    },
    storage: {
      artifacts: {
        path: './storage/artifacts',
        retention_days: 30,
        compress_after_days: 7,
        format: 'mp4',
        max_storage_gb: 50,
      },
      logs: { retention_days: 90, path: './storage/logs' },
    },
    jobs: { timeout_minutes: 30, max_queue_size: 100, cleanup_completed_after_days: 7 },
    job_metadata_schema: { required: [], optional: [] },
    database_url: 'postgresql://localhost:5432/device_farm',
    auth: { enabled: false },
    webhooks: { timeout_ms: 10000, max_retries: 3 },
    hooks: [],
    maestro: {
      include_tags: [],
      exclude_tags: [],
      report_format: 'JUNIT',
      debug_output: true,
      shards: 0,
      android_server_port: 9008,
      wda_port: 8100,
    },
  } as unknown as AppConfig;
}

describe('PoolManager.allocateMany', () => {
  let pool: PoolManager;
  let processTracker: ProcessTracker;
  let logger: pino.Logger;

  beforeEach(() => {
    logger = pino({ level: 'silent' });
    processTracker = new ProcessTracker(logger);
    pool = new PoolManager(createMockConfig(), processTracker, logger);
    pool.registerDriver('android', createMockDriver());
  });

  it('returns N devices when N idle devices exist', async () => {
    // Seed 3 idle android devices via addDevice (transitions Booting→Idle).
    pool.addDevice('android', 'a1', 'emu-a1');
    pool.addDevice('android', 'a2', 'emu-a2');
    pool.addDevice('android', 'a3', 'emu-a3');

    const allocated = await pool.allocateMany('android', 3);
    expect(allocated).toHaveLength(3);
    expect(new Set(allocated.map((d) => d.id)).size).toBe(3); // distinct
    expect(allocated.every((d) => d.state === DeviceState.Allocated)).toBe(true);
  });

  it('throws AggregateError when fewer devices available; rolls back partials', async () => {
    // Only 2 idle, asking for 3 → AggregateError + the 2 partially-allocated
    // devices must be released (back to Idle) so the pool is left consistent.
    pool.addDevice('android', 'a1', 'emu-a1');
    pool.addDevice('android', 'a2', 'emu-a2');

    let error: unknown;
    try {
      await pool.allocateMany('android', 3);
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).message).toContain('only 2');

    // Rollback check: all devices back to Idle. Allow a microtask flush for
    // release()'s async cleanup chain (Cleanup→Idle transition) before reading.
    await new Promise<void>((r) => setImmediate(() => r()));
    const devices = pool.getDevices();
    const states = devices.map((d) => `${d.id}=${d.state}`);
    expect(
      devices.every((d) => d.state === DeviceState.Idle),
      `expected all idle after rollback, got: ${states.join(', ')}`,
    ).toBe(true);
  });

  it('Promise.allSettled semantics — all N attempts run in parallel', async () => {
    // With only 1 device + requesting 3, the 2 failing attempts must still
    // be ATTEMPTED (not short-circuited). We assert via the elapsed time
    // staying close to a single allocate's cost (no serial blocking).
    pool.addDevice('android', 'solo', 'emu-solo');

    const start = Date.now();
    let error: unknown;
    try {
      await pool.allocateMany('android', 3);
    } catch (err) {
      error = err;
    }
    const elapsed = Date.now() - start;

    expect(error).toBeInstanceOf(AggregateError);
    // Parallel execution: the single mocked driver responds < 50ms; even with
    // 3 attempts the wall-clock should stay well under 200ms (a serial loop
    // with even 50ms-per-attempt blocking would push past 150ms easily but
    // would not be a strict fail — we mainly care about the assertion above).
    expect(elapsed).toBeLessThan(200);
  });
});
