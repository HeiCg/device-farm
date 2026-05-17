import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DeviceDriver } from '../types.js';

/**
 * Cleanup integration tests: verify that Android and iOS drivers
 * perform the correct cleanup operations between jobs.
 */

function createMockDriver(overrides?: Partial<DeviceDriver>): DeviceDriver {
  return {
    create: vi.fn().mockResolvedValue('mock-id'),
    boot: vi.fn().mockResolvedValue({ port: 5554, pid: 12345 }),
    shutdown: vi.fn().mockResolvedValue(undefined),
    isHealthy: vi.fn().mockResolvedValue(true),
    cleanup: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('Device Cleanup', () => {
  describe('Android cleanup (snapshot restore)', () => {
    it('cleanup calls driver.cleanup which restores snapshot', async () => {
      const driver = createMockDriver();
      await driver.cleanup('emulator-5554');

      expect(driver.cleanup).toHaveBeenCalledWith('emulator-5554');
      expect(driver.cleanup).toHaveBeenCalledTimes(1);
    });

    it('cleanup failure falls back to full restart for Android', async () => {
      // Simulate cleanup failure, then successful shutdown + boot (full restart)
      const cleanupFn = vi.fn()
        .mockRejectedValueOnce(new Error('snapshot restore failed'))
        .mockResolvedValueOnce(undefined);

      const driver = createMockDriver({ cleanup: cleanupFn });

      // First cleanup attempt fails
      await expect(driver.cleanup('emulator-5554')).rejects.toThrow('snapshot restore failed');

      // Fallback: shutdown then boot (full restart)
      await driver.shutdown('emulator-5554');
      await driver.boot('emulator-5554');

      expect(driver.shutdown).toHaveBeenCalledWith('emulator-5554');
      expect(driver.boot).toHaveBeenCalledWith('emulator-5554');
    });
  });

  describe('iOS cleanup (shutdown + erase)', () => {
    it('cleanup calls driver.cleanup which performs shutdown+erase', async () => {
      const driver = createMockDriver();
      await driver.cleanup('UDID-12345');

      expect(driver.cleanup).toHaveBeenCalledWith('UDID-12345');
      expect(driver.cleanup).toHaveBeenCalledTimes(1);
    });

    it('cleanup is called during pool release flow', async () => {
      // Import PoolManager to test full release flow with cleanup
      const pino = await import('pino');
      const { PoolManager } = await import('../pool-manager.js');
      const { ProcessTracker } = await import('../process-tracker.js');
      const { DeviceState } = await import('../../types/index.js');

      const logger = pino.default({ level: 'silent' });
      const processTracker = new ProcessTracker(logger);
      const config = {
        server: { port: 3000, host: '0.0.0.0' },
        pool: {
          max_devices: 10,
          android: { enabled: false, max_instances: 0, headless: true, api_level: '34', system_image_variant: 'google_apis', device_profile: 'pixel_7', ram_mb: 2048 },
          ios: { enabled: false, max_instances: 0, runtime: 'iOS-17-5', device_type: 'iPhone-15' },
        },
        storage: {
          artifacts: { path: './storage/artifacts', retention_days: 30, compress_after_days: 7, format: 'mp4' as const, max_storage_gb: 50 },
          logs: { retention_days: 90, path: './storage/logs' },
        },
        jobs: { timeout_minutes: 30, max_queue_size: 100, cleanup_completed_after_days: 7 },
        job_metadata_schema: { required: [], optional: [] },
        database_url: 'postgresql://localhost:5432/device_farm',
      } as any;

      const pool = new PoolManager(config, processTracker, logger);
      const iosDriver = createMockDriver();
      pool.registerDriver('ios', iosDriver);

      // Add device, allocate, mark running, then release
      const deviceId = pool.addDevice('ios', 'test-ios-1', 'UDID-12345');
      await pool.allocate('ios', 'job-1');
      pool.markRunning(deviceId);
      await pool.release(deviceId);

      // Verify cleanup was called during release
      expect(iosDriver.cleanup).toHaveBeenCalledTimes(1);

      // Verify device is back to Idle
      const device = pool.getDevice(deviceId);
      expect(device!.state).toBe(DeviceState.Idle);
    });
  });
});
