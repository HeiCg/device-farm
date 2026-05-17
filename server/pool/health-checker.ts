import type pino from 'pino';
import type { PoolManager } from './pool-manager.js';
import type { ProcessTracker } from './process-tracker.js';
import { Device } from './device.js';
import { DeviceState } from '../types/index.js';
import { withTimeout } from '../utils/timeout.js';
import { isProcessAlive, getProcessStat, isZombieStat } from './zombie-detector.js';
import type { PoolEmitters } from './events.js';
import type { Envelope } from '../events/envelope.js';

const BACKOFF_DELAYS = [5000, 15000, 45000];
const MAX_RETRIES = 3;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * NOOP emit helper used as the default 4th-parameter during Plan 20-02
 * interim so existing plugin.ts + specs keep compiling without the real
 * emit wired. Plan 20-03's createPoolModule factory supplies a real
 * `makePoolEmitters(bus, persistEnvelope)` instance.
 */
const NOOP_POOL_EMIT: PoolEmitters = {
  stateChanged:      () => ({} as Envelope),
  allocated:         () => ({} as Envelope),
  released:          () => ({} as Envelope),
  healthFailed:      () => ({} as Envelope),
  booted:            () => ({} as Envelope), // Phase 24 / Plan 24-01 (5th helper)
  // Phase 36 / Plan 36-00 — discovery + pairing helpers (6th-9th).
  discoveredAdded:   () => ({} as Envelope),
  discoveredRemoved: () => ({} as Envelope),
  discoveredChanged: () => ({} as Envelope),
  pairAttempted:     () => ({} as Envelope),
};

export class HealthChecker {
  private readonly poolManager: PoolManager;
  private readonly processTracker: ProcessTracker;
  private readonly logger: pino.Logger;
  private readonly failureCounts: Map<string, number> = new Map();
  private readonly emit: PoolEmitters;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  constructor(
    poolManager: PoolManager,
    processTracker: ProcessTracker,
    logger: pino.Logger,
    emit: PoolEmitters = NOOP_POOL_EMIT,
  ) {
    this.poolManager = poolManager;
    this.processTracker = processTracker;
    this.logger = logger.child({ component: 'health-checker' });
    this.emit = emit;
  }

  /**
   * Check all non-offline devices in parallel.
   */
  async checkAll(): Promise<void> {
    const deviceMap = this.poolManager.getDeviceMap();
    const checks: Promise<void>[] = [];

    for (const [, device] of deviceMap) {
      if (device.state === DeviceState.Offline) continue;
      // Skip Allocated devices — they are leased to a session or a job.
      // Health checks against a busy emulator race with active adb usage;
      // a transient failure should not trigger a reaper kill while a user
      // is mid-interaction. The session sweeper handles lease TTL expiry;
      // the job executor handles execution-time failures.
      if (device.state === DeviceState.Allocated) continue;
      checks.push(this.checkDevice(device));
    }

    await Promise.allSettled(checks);
  }

  /**
   * Check a single device's health and handle failures.
   */
  private async checkDevice(device: Device): Promise<void> {
    const driver = this.poolManager.getDriver(device.platform);
    if (!driver) return;

    let healthy: boolean;
    let timeoutErr: string | null = null;
    try {
      healthy = await withTimeout(10_000, () => driver.isHealthy(device.emulatorId, device.port ?? undefined), 'isHealthy');
    } catch (e: any) {
      healthy = false;
      timeoutErr = e?.message ?? 'isHealthy timeout';
    }

    if (healthy) {
      this.failureCounts.set(device.id, 0);
      return;
    }

    // Physical Android devices (registered with name prefix `physical-`) are
    // never booted by us — we cannot "restart" them. Mark Offline directly on
    // failure and let the next initPool-style detection re-register them when
    // they reappear on adb.
    if (device.platform === 'android' && device.name.startsWith('physical-')) {
      if (device.state !== DeviceState.Offline) {
        const t = device.transition(DeviceState.Offline);
        this.emit.stateChanged(device.id, { deviceId: device.id, from: t.from, to: t.to });
        this.logger.warn(
          { deviceId: device.id, name: device.name, serial: device.emulatorId },
          'Physical device unreachable via adb, marking offline',
        );
      }
      return;
    }

    // Device is unhealthy — Running → Error path.
    // Emit device.health.failed BEFORE the transition (RESEARCH §Pitfall 2 —
    // health.failed is unconditional on every failed probe, independent of
    // whether the state-machine accepts the transition that follows).
    // `reason` discriminator: 'timeout' if driver.isHealthy threw (wrapped
    // withTimeout reject), otherwise 'unhealthy' for a clean probe=false.
    if (device.state === DeviceState.Running) {
      this.emit.healthFailed(device.id, {
        deviceId: device.id,
        platform: device.platform,
        reason: timeoutErr ? 'timeout' : 'unhealthy',
        failureCount: this.failureCounts.get(device.id) ?? 0,
        willReplace: false,
        lastError: timeoutErr,
      });
      const t = device.transition(DeviceState.Error);
      this.emit.stateChanged(device.id, { deviceId: device.id, from: t.from, to: t.to });
      this.logger.error(
        { deviceId: device.id, name: device.name },
        'Running job on device failed -- infrastructure error',
      );
      return;
    }

    // Check if the process is a zombie — if so, fast-track replacement.
    // device.health.failed fires BEFORE replaceZombieDevice transitions the
    // device Error → Offline; willReplace:true discriminates this path.
    const isZombie = await this.isDeviceZombie(device);
    if (isZombie) {
      this.emit.healthFailed(device.id, {
        deviceId: device.id,
        platform: device.platform,
        reason: 'zombie',
        failureCount: this.failureCounts.get(device.id) ?? 0,
        willReplace: true,
        lastError: timeoutErr,
      });
      this.logger.warn(
        { deviceId: device.id, name: device.name, pid: device.pid },
        'Zombie emulator detected — marking dead and booting replacement',
      );
      await this.replaceZombieDevice(device, driver);
      return;
    }

    // Non-zombie: increment failure count and attempt recovery with backoff
    const failures = (this.failureCounts.get(device.id) ?? 0) + 1;
    this.failureCounts.set(device.id, failures);

    if (failures > MAX_RETRIES) {
      this.emit.healthFailed(device.id, {
        deviceId: device.id,
        platform: device.platform,
        reason: 'max-retries',
        failureCount: failures,
        willReplace: false,
        lastError: timeoutErr,
      });
      if (device.state !== DeviceState.Error) {
        const t1 = device.transition(DeviceState.Error);
        this.emit.stateChanged(device.id, { deviceId: device.id, from: t1.from, to: t1.to });
      }
      const t2 = device.transition(DeviceState.Offline);
      this.emit.stateChanged(device.id, { deviceId: device.id, from: t2.from, to: t2.to });
      this.logger.error(
        { deviceId: device.id, name: device.name, failures },
        'Device exceeded max retries, marking offline',
      );
      return;
    }

    // Wait with exponential backoff
    const delayMs = BACKOFF_DELAYS[failures - 1];
    this.logger.warn(
      { deviceId: device.id, name: device.name, failures, delayMs },
      'Device unhealthy, attempting restart',
    );

    await delay(delayMs);

    const fullWipe = failures === MAX_RETRIES;
    await this.restartDevice(device, driver, fullWipe);
  }

  /**
   * Restart a device. Zombie-aware: if kill reveals zombie, skip shutdown and go straight to boot.
   */
  private async restartDevice(
    device: Device,
    driver: { boot(emulatorId: string): Promise<{ port: number; pid: number }>; shutdown(emulatorId: string): Promise<void>; cleanup(emulatorId: string): Promise<void>; isHealthy(emulatorId: string, port?: number): Promise<boolean> },
    fullWipe: boolean,
  ): Promise<void> {
    try {
      await withTimeout(90_000, async () => {
        // Kill process and check if zombie
        const killResult = await this.processTracker.killProcess(device.id);

        if (killResult.isZombie) {
          this.logger.warn(
            { deviceId: device.id, name: device.name },
            'Zombie detected — skipping shutdown, routing around with fresh boot',
          );
          // Skip shutdown/cleanup — go straight to boot (which auto-routes around zombie)
        } else {
          if (fullWipe) {
            this.logger.info({ deviceId: device.id }, 'Full wipe before restart');
            await driver.shutdown(device.emulatorId);
            await driver.cleanup(device.emulatorId);
          }
        }

        // Transition to Error -> Booting for restart
        if (device.state !== DeviceState.Error) {
          const tErr = device.transition(DeviceState.Error);
          this.emit.stateChanged(device.id, { deviceId: device.id, from: tErr.from, to: tErr.to });
        }
        const tBoot = device.transition(DeviceState.Booting);
        this.emit.stateChanged(device.id, { deviceId: device.id, from: tBoot.from, to: tBoot.to });

        const result = await driver.boot(device.emulatorId);

        // Update device with new port and PID
        device.port = result.port;
        device.pid = result.pid;
        this.processTracker.register(device.id, result.pid);

        const tIdle = device.transition(DeviceState.Idle);
        this.emit.stateChanged(device.id, { deviceId: device.id, from: tIdle.from, to: tIdle.to });
        this.logger.info({ deviceId: device.id, port: result.port, pid: result.pid }, 'Device restarted successfully');
      }, `Restart ${device.name}`);
    } catch (err: any) {
      this.logger.error(
        { deviceId: device.id, error: err.message },
        'Failed to restart device',
      );
      if (device.state !== DeviceState.Error) {
        try {
          const t = device.transition(DeviceState.Error);
          this.emit.stateChanged(device.id, { deviceId: device.id, from: t.from, to: t.to });
        } catch {
          // Already in error or offline state
        }
      }
    }
  }

  /**
   * Check if a device's underlying process is a zombie (uninterruptible sleep).
   */
  private async isDeviceZombie(device: Device): Promise<boolean> {
    if (device.pid == null) return false;
    if (!isProcessAlive(device.pid)) return false;
    const stat = await getProcessStat(device.pid);
    return stat != null && isZombieStat(stat);
  }

  /**
   * Fast-track zombie replacement: mark old device Offline immediately,
   * boot a fresh replacement on a new port. No backoff, no retries on the dead slot.
   */
  private async replaceZombieDevice(
    device: Device,
    driver: { boot(emulatorId: string): Promise<{ port: number; pid: number }>; shutdown(emulatorId: string): Promise<void>; cleanup(emulatorId: string): Promise<void>; isHealthy(emulatorId: string, port?: number): Promise<boolean> },
  ): Promise<void> {
    // Mark the zombie device as dead immediately
    if (device.state !== DeviceState.Error) {
      try {
        const t = device.transition(DeviceState.Error);
        this.emit.stateChanged(device.id, { deviceId: device.id, from: t.from, to: t.to });
      } catch { /* already there */ }
    }
    try {
      const t = device.transition(DeviceState.Offline);
      this.emit.stateChanged(device.id, { deviceId: device.id, from: t.from, to: t.to });
    } catch { /* already there */ }
    this.failureCounts.delete(device.id);

    this.logger.warn(
      { deviceId: device.id, name: device.name, pid: device.pid, port: device.port },
      'Zombie device marked offline — booting replacement',
    );

    // Boot a replacement via pool manager (new Device object, fresh port)
    try {
      await withTimeout(90_000, async () => {
        await this.poolManager.replaceDevice(device.id, device.platform, device.name);
      }, `Replace zombie ${device.name}`);
    } catch (err: any) {
      this.logger.error(
        { deviceId: device.id, name: device.name, error: err.message },
        'Failed to boot zombie replacement — manual reboot may be required',
      );
    }
  }

  /**
   * Start periodic health checks.
   */
  start(intervalMs: number = 30000): void {
    this.intervalHandle = setInterval(() => {
      this.checkAll().catch((err) => {
        this.logger.error({ error: err.message }, 'Health check cycle failed');
      });
    }, intervalMs);
  }

  /**
   * Stop periodic health checks.
   */
  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }
}
