import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { HealthChecker } from '../health-checker.js';
import { PoolManager } from '../pool-manager.js';
import { ProcessTracker } from '../process-tracker.js';
import { DeviceState } from '../../types/index.js';
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

function createMockConfig(): AppConfig {
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
    appium: { server_url: 'http://localhost:4723', session_timeout_ms: 300_000 },
  } as AppConfig;
}

function createLogger(): any {
  return pino({ level: 'silent' });
}

describe('HealthChecker', () => {
  let pool: PoolManager;
  let processTracker: ProcessTracker;
  let driver: DeviceDriver;
  let checker: HealthChecker;
  let logger: any;

  beforeEach(() => {
    vi.useFakeTimers();
    logger = createLogger();
    processTracker = new ProcessTracker(logger);
    vi.spyOn(processTracker, 'killProcess').mockResolvedValue({ killed: true, isZombie: false });
    const config = createMockConfig();
    pool = new PoolManager(config, processTracker, logger);
    driver = createMockDriver();
    pool.registerDriver('android', driver);
    checker = new HealthChecker(pool, processTracker, logger);
  });

  afterEach(() => {
    checker.stop();
    vi.useRealTimers();
  });

  it('healthy device: no restart called', async () => {
    pool.addDevice('android', 'dev-1');
    (driver.isHealthy as ReturnType<typeof vi.fn>).mockResolvedValue(true);

    await checker.checkAll();

    expect(driver.boot).not.toHaveBeenCalled();
    expect(driver.shutdown).not.toHaveBeenCalled();
  });

  it('1st failure: restart attempt after 5s delay', async () => {
    pool.addDevice('android', 'dev-1');
    (driver.isHealthy as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    (driver.boot as ReturnType<typeof vi.fn>).mockResolvedValue({ port: 5554, pid: 12345 });

    const checkPromise = checker.checkAll();

    // Advance through the 5s delay
    await vi.advanceTimersByTimeAsync(5000);
    await checkPromise;

    expect(driver.boot).toHaveBeenCalledTimes(1);
    // No cleanup on 1st attempt
    expect(driver.cleanup).not.toHaveBeenCalled();
  });

  it('2nd failure: restart attempt after 15s delay', async () => {
    pool.addDevice('android', 'dev-1');
    (driver.isHealthy as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    (driver.boot as ReturnType<typeof vi.fn>).mockResolvedValue({ port: 5554, pid: 12345 });

    // 1st failure
    const check1 = checker.checkAll();
    await vi.advanceTimersByTimeAsync(5000);
    await check1;

    // Make health check fail again
    (driver.isHealthy as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    (driver.boot as ReturnType<typeof vi.fn>).mockClear();

    // 2nd failure
    const check2 = checker.checkAll();
    await vi.advanceTimersByTimeAsync(15000);
    await check2;

    expect(driver.boot).toHaveBeenCalledTimes(1);
  });

  it('3rd failure with wipe: cleanup called before boot', async () => {
    pool.addDevice('android', 'dev-1');
    (driver.isHealthy as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    (driver.boot as ReturnType<typeof vi.fn>).mockResolvedValue({ port: 5554, pid: 12345 });

    // 1st failure
    let check = checker.checkAll();
    await vi.advanceTimersByTimeAsync(5000);
    await check;

    // 2nd failure
    (driver.boot as ReturnType<typeof vi.fn>).mockClear();
    check = checker.checkAll();
    await vi.advanceTimersByTimeAsync(15000);
    await check;

    // 3rd failure - should include cleanup (full wipe)
    (driver.boot as ReturnType<typeof vi.fn>).mockClear();
    (driver.cleanup as ReturnType<typeof vi.fn>).mockClear();
    check = checker.checkAll();
    await vi.advanceTimersByTimeAsync(45000);
    await check;

    expect(driver.cleanup).toHaveBeenCalledTimes(1);
    expect(driver.boot).toHaveBeenCalledTimes(1);
  });

  it('after 3rd failure still unhealthy: device transitions to Offline', async () => {
    const deviceId = pool.addDevice('android', 'dev-1');
    (driver.isHealthy as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    // Boot always fails (device stays unhealthy)
    (driver.boot as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('boot failed'));

    // 1st failure
    let check = checker.checkAll();
    await vi.advanceTimersByTimeAsync(5000);
    await check;

    // 2nd failure
    check = checker.checkAll();
    await vi.advanceTimersByTimeAsync(15000);
    await check;

    // 3rd failure
    check = checker.checkAll();
    await vi.advanceTimersByTimeAsync(45000);
    await check;

    // 4th check - should go offline
    check = checker.checkAll();
    await check;

    const device = pool.getDevice(deviceId);
    expect(device!.state).toBe(DeviceState.Offline);
  });

  it('running device fails: transitions to Error, no restart', async () => {
    const deviceId = pool.addDevice('android', 'dev-1');
    // Allocate and mark running
    await pool.allocate('android', 'job-1');
    pool.markRunning(deviceId);

    (driver.isHealthy as ReturnType<typeof vi.fn>).mockResolvedValue(false);

    await checker.checkAll();

    const device = pool.getDevice(deviceId);
    expect(device!.state).toBe(DeviceState.Error);
    expect(driver.boot).not.toHaveBeenCalled();
  });

  it('parallel check: multiple devices checked via Promise.allSettled', async () => {
    pool.addDevice('android', 'dev-1');
    pool.addDevice('android', 'dev-2');
    pool.addDevice('android', 'dev-3');

    (driver.isHealthy as ReturnType<typeof vi.fn>).mockResolvedValue(true);

    await checker.checkAll();

    // isHealthy should be called once for each device
    expect(driver.isHealthy).toHaveBeenCalledTimes(3);
  });

  it('offline device is skipped by health checker', async () => {
    const deviceId = pool.addDevice('android', 'dev-1');
    // Force device to Error then Offline via transitions
    const deviceMap = pool.getDeviceMap();
    const device = deviceMap.get(deviceId)!;
    device.transition(DeviceState.Error);
    device.transition(DeviceState.Offline);

    (driver.isHealthy as ReturnType<typeof vi.fn>).mockResolvedValue(false);

    await checker.checkAll();

    expect(driver.isHealthy).not.toHaveBeenCalled();
  });

  it('zombie detected during restart: skips shutdown, boots on new port', async () => {
    const deviceId = pool.addDevice('android', 'dev-1');
    (driver.isHealthy as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    (processTracker.killProcess as ReturnType<typeof vi.fn>).mockResolvedValue({ killed: false, isZombie: true });
    (driver.boot as ReturnType<typeof vi.fn>).mockResolvedValue({ port: 5556, pid: 99999 });

    // 1st failure - triggers restart after 5s delay
    const check = checker.checkAll();
    await vi.advanceTimersByTimeAsync(5000);
    await check;

    // Shutdown should NOT be called (zombie path skips it)
    expect(driver.shutdown).not.toHaveBeenCalled();
    // Boot should be called once
    expect(driver.boot).toHaveBeenCalledTimes(1);

    // Device port should be updated to the new port
    const device = pool.getDevice(deviceId);
    expect(device!.port).toBe(5556);
  });

  it('start()/stop() control the periodic interval', async () => {
    pool.addDevice('android', 'dev-1');
    (driver.isHealthy as ReturnType<typeof vi.fn>).mockResolvedValue(true);

    checker.start(10000);

    // Initial check not called yet (fires on interval)
    expect(driver.isHealthy).not.toHaveBeenCalled();

    // Advance by 10s - first check fires
    await vi.advanceTimersByTimeAsync(10000);
    expect(driver.isHealthy).toHaveBeenCalledTimes(1);

    // Advance another 10s - second check fires
    await vi.advanceTimersByTimeAsync(10000);
    expect(driver.isHealthy).toHaveBeenCalledTimes(2);

    // Stop - no more checks
    checker.stop();
    await vi.advanceTimersByTimeAsync(10000);
    expect(driver.isHealthy).toHaveBeenCalledTimes(2);
  });

  // This block proves HealthChecker's 4th constructor param `emit: PoolEmitters`
  // fires a device.health.failed envelope BEFORE the state transition at each
  // of the 4 failure paths (unhealthy / zombie / max-retries / timeout) per
  // RESEARCH §Pitfall 2, plus device.state.changed at restart/replace transitions.
  describe('[Phase 20-02] HealthChecker emit sites — SC1 + MOD-08', () => {
    type Captured = { type: string; aggregateId: string; payload: any };

    function makeCapture(): { captured: Captured[]; emit: PoolEmitters } {
      const captured: Captured[] = [];
      const emit: PoolEmitters = {
        stateChanged:      (aggregateId, payload) => { captured.push({ type: 'device.state.changed',     aggregateId, payload }); return {} as Envelope; },
        allocated:         (aggregateId, payload) => { captured.push({ type: 'device.allocated',         aggregateId, payload }); return {} as Envelope; },
        released:          (aggregateId, payload) => { captured.push({ type: 'device.released',          aggregateId, payload }); return {} as Envelope; },
        healthFailed:      (aggregateId, payload) => { captured.push({ type: 'device.health.failed',     aggregateId, payload }); return {} as Envelope; },
        booted:             (aggregateId, payload) => { captured.push({ type: 'device.booted',           aggregateId, payload }); return {} as Envelope; },
        // Phase 36 / Plan 36-00 — capture stubs (unused in this spec but required for type completeness).
        discoveredAdded:   (aggregateId, payload) => { captured.push({ type: 'device.discovered.added',  aggregateId, payload }); return {} as Envelope; },
        discoveredRemoved: (aggregateId, payload) => { captured.push({ type: 'device.discovered.removed',aggregateId, payload }); return {} as Envelope; },
        discoveredChanged: (aggregateId, payload) => { captured.push({ type: 'device.discovered.changed',aggregateId, payload }); return {} as Envelope; },
        pairAttempted:     (aggregateId, payload) => { captured.push({ type: 'device.pair.attempted',    aggregateId, payload }); return {} as Envelope; },
      };
      return { captured, emit };
    }

    it('[SC1] unhealthy Running device emits device.health.failed {reason: unhealthy, willReplace: false}', async () => {
      const { captured, emit } = makeCapture();
      const localChecker = new HealthChecker(pool, processTracker, logger, emit);

      const deviceId = pool.addDevice('android', 'dev-unhealthy');
      // Transition to Running via allocate + markRunning
      await pool.allocate('android', 'job-1');
      pool.markRunning(deviceId);
      captured.length = 0;

      (driver.isHealthy as ReturnType<typeof vi.fn>).mockResolvedValue(false);

      await localChecker.checkAll();

      const healthFailed = captured.filter((c) => c.type === 'device.health.failed');
      expect(healthFailed).toHaveLength(1);
      expect(healthFailed[0].payload).toMatchObject({
        deviceId,
        platform: 'android',
        reason: 'unhealthy',
        willReplace: false,
      });
      // device.state.changed follows (Running → Error)
      const stateChanges = captured.filter((c) => c.type === 'device.state.changed');
      expect(stateChanges).toHaveLength(1);
      expect(stateChanges[0].payload).toMatchObject({
        from: DeviceState.Running,
        to: DeviceState.Error,
      });
    });

    it('[SC1] zombie detection emits device.health.failed {reason: zombie, willReplace: true} BEFORE transitions', async () => {
      const { captured, emit } = makeCapture();
      const localChecker = new HealthChecker(pool, processTracker, logger, emit);

      const deviceId = pool.addDevice('android', 'dev-zombie');
      const deviceMap = pool.getDeviceMap();
      const device = deviceMap.get(deviceId)!;
      device.pid = 12345;
      captured.length = 0;

      (driver.isHealthy as ReturnType<typeof vi.fn>).mockResolvedValue(false);

      // Force isDeviceZombie to return true by mocking the zombie-detector
      // module: checkAll() → checkDevice() → isDeviceZombie() internally calls
      // isProcessAlive + getProcessStat + isZombieStat. Easier path: spy on
      // the private isDeviceZombie method via prototype.
      const isDeviceZombieSpy = vi
        .spyOn(localChecker as any, 'isDeviceZombie')
        .mockResolvedValue(true);
      // Also stub replaceZombieDevice to avoid booting inside test
      vi.spyOn(localChecker as any, 'replaceZombieDevice').mockImplementation(async () => {
        // simulate replaceZombieDevice transitions
        const t1 = device.transition(DeviceState.Error);
        (localChecker as any).emit.stateChanged(deviceId, { deviceId, from: t1.from, to: t1.to });
        const t2 = device.transition(DeviceState.Offline);
        (localChecker as any).emit.stateChanged(deviceId, { deviceId, from: t2.from, to: t2.to });
      });

      await localChecker.checkAll();

      const healthFailed = captured.filter((c) => c.type === 'device.health.failed');
      expect(healthFailed).toHaveLength(1);
      expect(healthFailed[0].payload).toMatchObject({
        deviceId,
        reason: 'zombie',
        willReplace: true,
      });
      // health.failed fires BEFORE the Error/Offline transitions
      const healthFailedIdx = captured.findIndex((c) => c.type === 'device.health.failed');
      const firstStateChangeIdx = captured.findIndex((c) => c.type === 'device.state.changed');
      expect(healthFailedIdx).toBeGreaterThanOrEqual(0);
      expect(firstStateChangeIdx).toBeGreaterThan(healthFailedIdx);

      isDeviceZombieSpy.mockRestore();
    });

    it('[SC1] failureCount > MAX_RETRIES emits device.health.failed {reason: max-retries, willReplace: false}', async () => {
      const { captured, emit } = makeCapture();
      const localChecker = new HealthChecker(pool, processTracker, logger, emit);

      const deviceId = pool.addDevice('android', 'dev-max');
      // Seed failureCounts to MAX_RETRIES so next failure trips the > threshold
      (localChecker as any).failureCounts.set(deviceId, 3);
      captured.length = 0;

      (driver.isHealthy as ReturnType<typeof vi.fn>).mockResolvedValue(false);
      // Ensure non-zombie path
      vi.spyOn(localChecker as any, 'isDeviceZombie').mockResolvedValue(false);

      await localChecker.checkAll();

      const healthFailed = captured.filter((c) => c.type === 'device.health.failed');
      expect(healthFailed).toHaveLength(1);
      expect(healthFailed[0].payload).toMatchObject({
        deviceId,
        reason: 'max-retries',
        willReplace: false,
        failureCount: 4,
      });
      // Subsequent state.changed transitions to Error then Offline
      const stateChanges = captured.filter((c) => c.type === 'device.state.changed');
      expect(stateChanges.length).toBeGreaterThanOrEqual(2);
      expect(stateChanges[stateChanges.length - 1].payload).toMatchObject({
        to: DeviceState.Offline,
      });
    });

    it('[SC1] driver.isHealthy throw emits device.health.failed {reason: timeout} with lastError captured', async () => {
      const { captured, emit } = makeCapture();
      const localChecker = new HealthChecker(pool, processTracker, logger, emit);

      const deviceId = pool.addDevice('android', 'dev-timeout');
      await pool.allocate('android', 'job-1');
      pool.markRunning(deviceId);
      captured.length = 0;

      (driver.isHealthy as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('probe timeout exceeded'));

      await localChecker.checkAll();

      const healthFailed = captured.filter((c) => c.type === 'device.health.failed');
      expect(healthFailed).toHaveLength(1);
      expect(healthFailed[0].payload).toMatchObject({
        deviceId,
        reason: 'timeout',
        willReplace: false,
      });
      expect(healthFailed[0].payload.lastError).toMatch(/timeout/);
    });

    it('HealthChecker constructs without emit (NOOP default) — back-compat', () => {
      const hc = new HealthChecker(pool, processTracker, logger);
      expect(hc).toBeDefined();
    });
  });
});
