import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PoolManager } from '../pool-manager.js';
import { Device } from '../device.js';
import { ProcessTracker } from '../process-tracker.js';
import { DeviceState, type Platform } from '../../types/index.js';
import type { DeviceDriver } from '../types.js';
import type { AppConfig } from '../../config/schema.js';
import type { PoolEmitters } from '../events.js';
import type { Envelope } from '../../events/envelope.js';
import pino from 'pino';

function createMockDriver(): DeviceDriver {
  return {
    create: vi.fn().mockResolvedValue('mock-emulator-id'),
    boot: vi.fn().mockResolvedValue({ port: 5554, pid: 12345 }),
    shutdown: vi.fn().mockResolvedValue(undefined),
    isHealthy: vi.fn().mockResolvedValue(true),
    cleanup: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockConfig(overrides?: Partial<AppConfig>): AppConfig {
  return {
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
    auth: { enabled: false },
    webhooks: { timeout_ms: 10000, max_retries: 3 },
    hooks: [],
    maestro: { include_tags: [], exclude_tags: [], report_format: 'JUNIT', debug_output: true, shards: 0, android_server_port: 9008, wda_port: 8100 },
    ...overrides,
  } as AppConfig;
}

function createLogger(): any {
  return pino({ level: 'silent' });
}

describe('PoolManager', () => {
  let pool: PoolManager;
  let processTracker: ProcessTracker;
  let androidDriver: DeviceDriver;
  let logger: any;

  beforeEach(() => {
    logger = createLogger();
    processTracker = new ProcessTracker(logger);
    androidDriver = createMockDriver();
  });

  describe('allocate', () => {
    it('allocate("android") returns an idle Android device', async () => {
      const config = createMockConfig();
      pool = new PoolManager(config, processTracker, logger);
      pool.registerDriver('android', androidDriver);

      // Manually add a device that is Idle
      pool.addDevice('android', 'test-device-1');

      const result = await pool.allocate('android', 'job-1');
      expect(result).not.toBeNull();
      expect(result!.platform).toBe('android');
      expect(result!.state).toBe(DeviceState.Allocated);
      expect(result!.currentJobId).toBe('job-1');
    });

    it('allocate("ios") returns an idle iOS device', async () => {
      const config = createMockConfig();
      pool = new PoolManager(config, processTracker, logger);
      const iosDriver = createMockDriver();
      pool.registerDriver('ios', iosDriver);

      pool.addDevice('ios', 'test-ios-1');

      const result = await pool.allocate('ios', 'job-2');
      expect(result).not.toBeNull();
      expect(result!.platform).toBe('ios');
    });

    it('allocate("android") returns null when no Android devices are idle', async () => {
      const config = createMockConfig();
      pool = new PoolManager(config, processTracker, logger);
      pool.registerDriver('android', androidDriver);

      // No devices added
      const result = await pool.allocate('android', 'job-1');
      expect(result).toBeNull();
    });

    it('two concurrent allocate("android") calls with one idle device: one gets it, other gets null', async () => {
      const config = createMockConfig();
      pool = new PoolManager(config, processTracker, logger);
      pool.registerDriver('android', androidDriver);

      pool.addDevice('android', 'test-device-1');

      const [result1, result2] = await Promise.all([
        pool.allocate('android', 'job-1'),
        pool.allocate('android', 'job-2'),
      ]);

      const results = [result1, result2];
      const allocated = results.filter(r => r !== null);
      const nullResults = results.filter(r => r === null);

      expect(allocated).toHaveLength(1);
      expect(nullResults).toHaveLength(1);
    });

    it('FIFO: device-1 became idle before device-2, device-1 is allocated first', async () => {
      const config = createMockConfig();
      pool = new PoolManager(config, processTracker, logger);
      pool.registerDriver('android', androidDriver);

      // Add device-1 first, then device-2 (Map preserves insertion order)
      pool.addDevice('android', 'device-1');
      pool.addDevice('android', 'device-2');

      const result = await pool.allocate('android', 'job-1');
      expect(result).not.toBeNull();
      expect(result!.name).toBe('device-1');
    });
  });

  describe('release', () => {
    it('release(deviceId) transitions device through Cleanup back to Idle', async () => {
      const config = createMockConfig();
      pool = new PoolManager(config, processTracker, logger);
      pool.registerDriver('android', androidDriver);

      const deviceId = pool.addDevice('android', 'test-device-1');

      // Allocate it first
      await pool.allocate('android', 'job-1');

      // Simulate running state (Allocated -> Running)
      pool.markRunning(deviceId);

      // Release (Running -> Cleanup -> Idle)
      await pool.release(deviceId);

      const device = pool.getDevice(deviceId);
      expect(device).not.toBeNull();
      expect(device!.state).toBe(DeviceState.Idle);
      expect(device!.currentJobId).toBeNull();
    });
  });

  describe('getDevices / getDevice', () => {
    it('getDevices() returns all devices with current state', () => {
      const config = createMockConfig();
      pool = new PoolManager(config, processTracker, logger);
      pool.registerDriver('android', androidDriver);

      pool.addDevice('android', 'device-1');
      pool.addDevice('android', 'device-2');

      const devices = pool.getDevices();
      expect(devices).toHaveLength(2);
      expect(devices[0].name).toBe('device-1');
      expect(devices[1].name).toBe('device-2');
    });

    it('getDevice(id) returns single device info', () => {
      const config = createMockConfig();
      pool = new PoolManager(config, processTracker, logger);
      pool.registerDriver('android', androidDriver);

      const id = pool.addDevice('android', 'device-1');
      const device = pool.getDevice(id);
      expect(device).not.toBeNull();
      expect(device!.id).toBe(id);
    });

    it('getDevice(unknown-id) returns null', () => {
      const config = createMockConfig();
      pool = new PoolManager(config, processTracker, logger);

      const device = pool.getDevice('nonexistent');
      expect(device).toBeNull();
    });
  });

  // This block proves PoolManager's 4th constructor param `emit: PoolEmitters`
  // triggers envelopes at every state-machine site — in particular
  // emit.stateChanged on every transition + emit.allocated inside allocateMutex
  // + emit.released after device.release() with jobId captured pre-clear.
  describe('[Phase 20-02] PoolManager emit sites — SC1 + MOD-08', () => {
    type Captured = { type: string; aggregateId: string; payload: unknown };

    function makeCapture(): { captured: Captured[]; emit: PoolEmitters } {
      const captured: Captured[] = [];
      const emit: PoolEmitters = {
        stateChanged:      (aggregateId, payload) => { captured.push({ type: 'device.state.changed',     aggregateId, payload }); return {} as Envelope; },
        allocated:         (aggregateId, payload) => { captured.push({ type: 'device.allocated',         aggregateId, payload }); return {} as Envelope; },
        released:          (aggregateId, payload) => { captured.push({ type: 'device.released',          aggregateId, payload }); return {} as Envelope; },
        healthFailed:      (aggregateId, payload) => { captured.push({ type: 'device.health.failed',     aggregateId, payload }); return {} as Envelope; },
        booted:            (aggregateId, payload) => { captured.push({ type: 'device.booted',            aggregateId, payload }); return {} as Envelope; },
        // Phase 36 / Plan 36-00 — capture stubs (unused in this spec but required for type completeness).
        discoveredAdded:   (aggregateId, payload) => { captured.push({ type: 'device.discovered.added',  aggregateId, payload }); return {} as Envelope; },
        discoveredRemoved: (aggregateId, payload) => { captured.push({ type: 'device.discovered.removed',aggregateId, payload }); return {} as Envelope; },
        discoveredChanged: (aggregateId, payload) => { captured.push({ type: 'device.discovered.changed',aggregateId, payload }); return {} as Envelope; },
        pairAttempted:     (aggregateId, payload) => { captured.push({ type: 'device.pair.attempted',    aggregateId, payload }); return {} as Envelope; },
      };
      return { captured, emit };
    }

    it('[SC1] addDevice emits exactly one device.state.changed {booting → idle}', () => {
      const { captured, emit } = makeCapture();
      const config = createMockConfig();
      const pool = new PoolManager(config, processTracker, logger, emit);
      const deviceId = pool.addDevice('android', 'd1');
      const stateChanges = captured.filter((c) => c.type === 'device.state.changed');
      expect(stateChanges).toHaveLength(1);
      expect(stateChanges[0].aggregateId).toBe(deviceId);
      expect(stateChanges[0].payload).toMatchObject({
        deviceId,
        from: DeviceState.Booting,
        to: DeviceState.Idle,
      });
    });

    it('[SC1] allocate emits device.state.changed {idle → allocated} + device.allocated (in that order)', async () => {
      const { captured, emit } = makeCapture();
      const config = createMockConfig();
      const pool = new PoolManager(config, processTracker, logger, emit);
      pool.registerDriver('android', androidDriver);
      pool.addDevice('android', 'd1'); // booting → idle
      captured.length = 0; // clear addDevice emits

      const info = await pool.allocate('android', 'job-abc');
      expect(info).not.toBeNull();

      // stateChanged (idle→allocated) fires FIRST, then allocated
      expect(captured.map((c) => c.type)).toEqual(['device.state.changed', 'device.allocated']);
      expect(captured[0].payload).toMatchObject({
        from: DeviceState.Idle,
        to: DeviceState.Allocated,
      });
      expect(captured[1].payload).toMatchObject({
        jobId: 'job-abc',
        platform: 'android',
      });
    });

    it('[SC1] release after allocate emits running→cleanup + cleanup→idle + released (jobId NOT null)', async () => {
      const { captured, emit } = makeCapture();
      const config = createMockConfig();
      const pool = new PoolManager(config, processTracker, logger, emit);
      pool.registerDriver('android', androidDriver);
      pool.addDevice('android', 'd1');
      const info = await pool.allocate('android', 'job-abc');
      pool.markRunning(info!.id);
      captured.length = 0; // clear add/allocate/markRunning emits

      await pool.release(info!.id);

      const types = captured.map((c) => c.type);
      expect(types).toEqual(['device.state.changed', 'device.state.changed', 'device.released']);
      expect(captured[0].payload).toMatchObject({ from: DeviceState.Running, to: DeviceState.Cleanup });
      expect(captured[1].payload).toMatchObject({ from: DeviceState.Cleanup, to: DeviceState.Idle });
      // released.jobId captured BEFORE device.release() cleared it
      expect((captured[2].payload as { jobId: string | null }).jobId).toBe('job-abc');
    });

    it('[SC1] markRunning emits device.state.changed {allocated → running}', async () => {
      const { captured, emit } = makeCapture();
      const config = createMockConfig();
      const pool = new PoolManager(config, processTracker, logger, emit);
      pool.registerDriver('android', androidDriver);
      pool.addDevice('android', 'd1');
      const info = await pool.allocate('android', 'job-abc');
      captured.length = 0;

      pool.markRunning(info!.id);

      expect(captured).toHaveLength(1);
      expect(captured[0].type).toBe('device.state.changed');
      expect(captured[0].payload).toMatchObject({
        from: DeviceState.Allocated,
        to: DeviceState.Running,
      });
    });

    it('[Invariant MOD-08 (f)] PoolManager constructs with default NOOP_POOL_EMIT when emit omitted (back-compat)', async () => {
      // Existing test pattern — no emit param, no crash
      const config = createMockConfig();
      const pool = new PoolManager(config, processTracker, logger);
      pool.registerDriver('android', androidDriver);
      pool.addDevice('android', 'd1');
      const info = await pool.allocate('android', 'job-1');
      expect(info).not.toBeNull();
      expect(pool.getDevices()).toHaveLength(1);
    });
  });
});
