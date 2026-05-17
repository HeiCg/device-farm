import { randomUUID } from 'node:crypto';
import { Mutex } from 'async-mutex';
import type pino from 'pino';
import { Device } from './device.js';
import { ProcessTracker } from './process-tracker.js';
import type { DeviceDriver, BootOptions } from './types.js';
import type { PoolEmitters } from './events.js';
import { DeviceState, type Platform, type DeviceInfo } from '../types/index.js';
import type { AppConfig } from '../config/schema.js';
import type { Envelope } from '../events/envelope.js';
import { withTimeout } from '../utils/timeout.js';
import type { DiscoveredDevice } from './internal/discovery/index.js';

/**
 * Module-level NOOP emit helper — used as the default 4th-parameter value on
 * PoolManager's constructor during the Plan 20-02 interim so existing call
 * sites (plugin.ts + existing specs) keep compiling without the real emit
 * wired. Plan 20-03's createPoolModule factory supplies a real
 * `makePoolEmitters(bus, persistEnvelope)` instance which replaces this.
 */
/**
 * Phase 31 / Plan 31-03 — true when bootOptions differs from documented
 * defaults (coldBoot:false, noAudio:true, gpu:'swiftshader_indirect') in
 * any way that would change emulator argv. Returning false skips the
 * shutdown+reboot dance during allocate() and reuses the pre-booted device.
 */
function shouldRebootForOptions(bootOptions?: BootOptions): boolean {
  if (!bootOptions) return false;
  if (bootOptions.coldBoot === true) return true;
  if (bootOptions.noAudio === false) return true;
  if (bootOptions.gpu && bootOptions.gpu !== 'swiftshader_indirect') return true;
  return false;
}

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

/**
 * Phase 36 / Plan 36-02 — driver registration key.
 *
 * `Platform` is the existing 'android' | 'ios' union (emulator / simulator
 * defaults). For physical devices we use a distinct compound key like
 * `'android-physical'` so `adoptDiscoveredDevice` can look up the right
 * driver without changing the Platform discriminator (per RESEARCH §"Type
 * Extensions" minimal-invasive approach).
 */
export type DriverKey = Platform | 'android-physical';

export class PoolManager {
  private readonly devices: Map<string, Device> = new Map();
  private readonly drivers: Map<DriverKey, DeviceDriver> = new Map();
  private readonly allocateMutex: Mutex = new Mutex();
  private readonly config: AppConfig;
  private readonly processTracker: ProcessTracker;
  private readonly logger: pino.Logger;
  private readonly emit: PoolEmitters;

  constructor(
    config: AppConfig,
    processTracker: ProcessTracker,
    logger: pino.Logger,
    emit: PoolEmitters = NOOP_POOL_EMIT,
  ) {
    this.config = config;
    this.processTracker = processTracker;
    this.logger = logger.child({ component: 'pool-manager' });
    this.emit = emit;
  }

  registerDriver(key: DriverKey, driver: DeviceDriver): void {
    this.drivers.set(key, driver);
  }

  /**
   * Add a device to the pool. Creates a Device in Booting state,
   * immediately transitions to Idle. Returns the device ID.
   */
  addDevice(platform: Platform, name: string, emulatorId?: string): string {
    const device = new Device(name, platform, { emulatorId });
    // Transition from Booting -> Idle
    const { from, to } = device.transition(DeviceState.Idle);
    this.emit.stateChanged(device.id, { deviceId: device.id, from, to });
    // Phase 24 / Plan 24-02 — fresh-boot signal (Booting→Idle).
    // Emit AFTER stateChanged (Pitfall 2 — emit AFTER mutation success).
    this.emit.booted(device.id, {
      deviceId: device.id,
      platform: device.platform,
      emulatorId: device.emulatorId,
      port: device.port,
    });
    this.devices.set(device.id, device);
    this.logger.info({ deviceId: device.id, name, platform }, 'Added device to pool');
    return device.id;
  }

  /**
   * Initialize the pool from config: create and boot all configured devices.
   * Zombie-aware: detects running emulators by port, wraps each boot in a timeout.
   */
  async initPool(): Promise<void> {
    // Reap orphans BEFORE booting (so zombie ports are freed or detected)
    await this.processTracker.reapOrphans();

    // Clean up replacement AVDs from previous zombie workarounds
    for (const [, driver] of this.drivers) {
      if ('cleanupReplacementAvds' in driver) {
        await (driver as any).cleanupReplacementAvds();
      }
    }

    // Phase 36 / Plan 36-01 — bare `adb devices` pre-scan + physical-device
    // auto-detection moved to the DeviceDiscoveryService (the SOLE bare-list
    // caller per dep-cruiser rule 13). The discovery service's first tick
    // populates the pool via `adoptDiscoveredDevice` (Physical kind) and
    // emits `device.discovered.*` events for the dashboard + command palette.
    //
    // Until the discovery service ticks, initPool boots fresh emulators
    // without the previous "reuse already-running" optimisation. Already-
    // booted emulators are still detected by the driver's `isHealthy` check
    // below, but the dynamic port map is empty so the convention-based port
    // assignment (5554 + i*2) is used. This is acceptable on cold-start:
    // the discovery service ticks within 5s of boot and any conflicting
    // emulator will fail the isHealthy probe + trigger a reboot path.
    const runningPorts = new Map<string, number>();

    const platforms: Platform[] = ['android', 'ios'];

    for (const platform of platforms) {
      const platformConfig = this.config.pool[platform];
      if (!platformConfig.enabled) continue;

      const driver = this.drivers.get(platform);
      if (!driver) {
        this.logger.warn({ platform }, 'No driver registered for platform, skipping');
        continue;
      }

      for (let i = 0; i < platformConfig.max_instances; i++) {
        const name = `${platform}-${i + 1}`;
        try {
          await withTimeout(90_000, async () => {
            const emulatorId = await driver.create(name, platformConfig);
            const device = new Device(name, platform, { emulatorId });
            this.devices.set(device.id, device);

            // Check if emulator is already running and healthy
            // Use detected port from adb devices, falling back to convention
            const detectedPort = runningPorts.get(emulatorId) ?? (5554 + i * 2);
            const alreadyHealthy = await driver.isHealthy(emulatorId, detectedPort);

            if (alreadyHealthy) {
              device.port = detectedPort;
              this.logger.info({ emulatorId, port: detectedPort }, 'Reusing already-running emulator');
            } else {
              const result = await driver.boot(emulatorId);
              device.port = result.port;
              device.pid = result.pid;
              device.grpcPort = result.grpcPort ?? null;
              this.processTracker.register(device.id, result.pid);
            }

            const { from, to } = device.transition(DeviceState.Idle);
            this.emit.stateChanged(device.id, { deviceId: device.id, from, to });
            // Phase 24 / Plan 24-02 — fresh-boot signal (Booting→Idle).
            // Emit AFTER stateChanged (Pitfall 2 — emit AFTER mutation success).
            // device.port reflects the real port assigned above (detectedPort
            // for already-running emulators or driver.boot result.port).
            this.emit.booted(device.id, {
              deviceId: device.id,
              platform: device.platform,
              emulatorId: device.emulatorId,
              port: device.port,
            });
            this.logger.info({ deviceId: device.id, name, platform, emulatorId }, 'Device booted');
          }, `Boot ${name}`);
        } catch (err: any) {
          this.logger.error({ name, platform, error: err.message }, 'Failed to boot device');
        }
      }
    }
  }

  /**
   * Phase 36 / Plan 36-01 — adopt a Physical device discovered by the
   * DeviceDiscoveryService. Idempotent: no-op when the device is already
   * registered. Driver-aware: when no `android-physical` driver is
   * registered (Plan 36-02 wires it), the device is admitted as a
   * port-less Idle entry so the web UI + Maestro integration can still
   * interact with it (matches pre-36 detectPhysicalDevices behaviour).
   *
   * Emits `device.state.changed` (Booting→Idle) so downstream subscribers
   * (maestro device-info collector, jobs, streaming) fire as if the device
   * had just booted.
   */
  async adoptDiscoveredDevice(discovered: DiscoveredDevice): Promise<void> {
    if (discovered.deviceType !== 'Physical') return;

    // Idempotent: skip if a device with the same external id (serial) is
    // already in the pool. Pool's internal device.id is a UUID — we match
    // on emulatorId (serial).
    for (const [, existing] of this.devices) {
      if (existing.emulatorId === discovered.id) return;
    }

    const friendlyName = discovered.name && discovered.name.length > 0
      ? discovered.name
      : `physical-${discovered.id}`;

    const device = new Device(friendlyName, discovered.platform, {
      emulatorId: discovered.id,
    });
    device.port = null; // physical devices don't use emulator ports
    const { from, to } = device.transition(DeviceState.Idle);
    this.emit.stateChanged(device.id, { deviceId: device.id, from, to });
    // Synthetic boot signal — physical devices don't go through the
    // driver.boot path but the rest of the system expects a `device.booted`
    // signal at Booting→Idle (Phase 24 / Plan 24-02 invariant).
    this.emit.booted(device.id, {
      deviceId: device.id,
      platform: device.platform,
      emulatorId: device.emulatorId,
      port: device.port,
    });
    this.devices.set(device.id, device);

    this.logger.info(
      {
        deviceId: device.id,
        serial: discovered.id,
        model: discovered.model,
        platform: discovered.platform,
      },
      'Physical device adopted from discovery service',
    );
  }

  /**
   * Phase 36 / Plan 36-01 — handle a device removed from the discovery
   * snapshot (USB unplugged, wireless dropped, simulator shutdown). No-op
   * when the device is not known to the pool. Transitions known entries to
   * Error so HealthChecker recovery / replacement paths can fire.
   */
  async handleDiscoveryRemoval(externalId: string): Promise<void> {
    let target: Device | undefined;
    for (const [, existing] of this.devices) {
      if (existing.emulatorId === externalId) {
        target = existing;
        break;
      }
    }
    if (!target) return;

    const jobId = target.currentJobId;
    try {
      const { from, to } = target.transition(DeviceState.Error);
      this.emit.stateChanged(target.id, { deviceId: target.id, from, to });
    } catch (err) {
      this.logger.warn(
        { err, deviceId: target.id, externalId },
        'Discovery removal: transition to Error failed (already in terminal state?)',
      );
    }

    if (jobId) {
      this.logger.warn(
        { deviceId: target.id, jobId, reason: 'device-disconnected' },
        'Discovery removal interrupted an active job',
      );
    }
  }

  /**
   * Allocate an idle device matching the given platform (FIFO ordering).
   * Returns DeviceInfo or null if no idle device available.
   * Mutex-protected to prevent concurrent double-allocation.
   *
   * Phase 31 / Plan 31-03 / SC3 — optional `bootOptions` parameter. Devices
   * are normally pre-booted by initPool(), so the per-job options take effect
   * via a shutdown+reboot sequence when explicitly requested (e.g. CLI
   * --cold-boot). When `bootOptions` is undefined OR all fields are at their
   * documented defaults (coldBoot:false, noAudio:true, gpu:'swiftshader_indirect'),
   * the pre-booted device is reused as-is to preserve current behavior.
   */
  async allocate(
    platform: Platform,
    jobId: string,
    bootOptions?: BootOptions,
  ): Promise<DeviceInfo | null> {
    return this.allocateMutex.runExclusive(async () => {
      // FIFO: Map preserves insertion order, iterate to find first idle
      for (const [, device] of this.devices) {
        if (device.platform === platform && device.state === DeviceState.Idle) {
          try {
            const prevState = device.state; // Idle; capture before device.allocate mutates
            await device.allocate(jobId); // internally transitions Idle → Allocated
            // Emit AFTER mutation success (RESEARCH §Pitfall 2). bus.emit is sync
            // + persistEnvelope fire-and-forgets; safe inside allocateMutex.
            this.emit.stateChanged(device.id, {
              deviceId: device.id,
              from: prevState,
              to: DeviceState.Allocated,
            });
            this.emit.allocated(device.id, {
              deviceId: device.id,
              jobId,
              platform: device.platform,
            });
            this.logger.info({ deviceId: device.id, jobId, platform }, 'Device allocated');

            // Phase 31 / Plan 31-03 — apply per-job boot options if they
            // would change the running emulator config (non-default).
            if (device.emulatorId && shouldRebootForOptions(bootOptions)) {
              const driver = this.drivers.get(platform);
              if (driver) {
                try {
                  this.logger.info(
                    { deviceId: device.id, jobId, bootOptions },
                    'Rebooting device with per-job boot options',
                  );
                  await driver.shutdown(device.emulatorId);
                  const result = await driver.boot(device.emulatorId, bootOptions);
                  device.port = result.port;
                  device.pid = result.pid;
                  device.grpcPort = result.grpcPort ?? null;
                  this.processTracker.register(device.id, result.pid);
                } catch (err: any) {
                  this.logger.error(
                    { deviceId: device.id, jobId, error: err.message },
                    'Per-job reboot failed; continuing with current device state',
                  );
                }
              }
            }

            return device.toInfo();
          } catch (err: any) {
            this.logger.error({ deviceId: device.id, error: err.message }, 'Failed to allocate');
            continue;
          }
        }
      }
      return null;
    });
  }

  /**
   * Phase 37 Plan 37-04 Wave 1 Track D — batch allocation for parallel-deploy.
   *
   * Allocates `count` devices of the given platform via Promise.allSettled
   * over N parallel `allocate()` calls. Each call uses a synthetic
   * jobId (`parallel-deploy-<uuid>`) so the pool's per-device currentJobId
   * tracking stays consistent (the real job's jobId is later associated by
   * the executor that called allocateMany).
   *
   * Failure semantics:
   *   - On full success, returns `count` DeviceInfo entries.
   *   - On partial failure (fewer than `count` healthy idle devices),
   *     releases successfully-allocated devices and throws AggregateError
   *     so the caller (route layer) can surface a 503 Retry-After cleanly.
   *     This matches kittyfarm BuildPlayRunner behaviour: pre-allocation is
   *     all-or-nothing, but per-device install/launch failures (in
   *     runParallelDeploy) do NOT roll back successful sends.
   *
   * Pitfall 9 protection: the route layer enforces the
   * `config.pool.<platform>.max_parallelism` cap BEFORE calling this method.
   * `allocateMany` is defensive against races (e.g. another caller stole
   * a device between cap-check and allocation), surfacing them as
   * AggregateError rather than silently returning fewer devices.
   */
  async allocateMany(platform: Platform, count: number): Promise<DeviceInfo[]> {
    const tags = Array.from(
      { length: count },
      () => `parallel-deploy-${randomUUID()}`,
    );
    const settled = await Promise.allSettled(
      tags.map((tag) => this.allocate(platform, tag)),
    );

    const allocated: DeviceInfo[] = [];
    const errors: Error[] = [];
    for (const r of settled) {
      if (r.status === 'fulfilled') {
        if (r.value !== null) {
          allocated.push(r.value);
        } else {
          errors.push(new Error('no idle device available'));
        }
      } else {
        // r.status === 'rejected' — TS narrows .reason to unknown here.
        const reason: unknown = (r as PromiseRejectedResult).reason;
        errors.push(reason instanceof Error ? reason : new Error(String(reason)));
      }
    }

    if (allocated.length < count) {
      // Roll back partial allocations so the pool isn't left with N-K
      // Allocated devices that will never run a job. release() expects the
      // device to be in Running state (Phase 23 saga invariant), but allocate
      // leaves it in Allocated — synthesize the missing markRunning step so
      // the Cleanup→Idle transition chain succeeds. Failures are best-effort.
      for (const d of allocated) {
        try {
          this.markRunning(d.id);
          await this.release(d.id);
        } catch (err) {
          this.logger.warn(
            { deviceId: d.id, err },
            'allocateMany rollback release failed',
          );
        }
      }
      // Node 22+ has AggregateError natively. Stringified message includes the
      // requested vs allocated counts so 503 responders can synthesize a
      // human-readable `detail` field without reformatting.
      throw new AggregateError(
        errors,
        `allocateMany(${platform}, ${count}): only ${allocated.length} devices allocated`,
      );
    }

    this.logger.info(
      { platform, count, deviceIds: allocated.map((d) => d.id) },
      'allocateMany succeeded',
    );
    return allocated;
  }

  /**
   * Mark a device as Running (Allocated -> Running).
   */
  markRunning(deviceId: string): void {
    const device = this.devices.get(deviceId);
    if (!device) throw new Error(`Device ${deviceId} not found`);
    const { from, to } = device.transition(DeviceState.Running);
    this.emit.stateChanged(device.id, { deviceId: device.id, from, to });
  }

  /**
   * Release a device: transition through Cleanup back to Idle.
   * Calls the driver's cleanup method.
   */
  async release(deviceId: string): Promise<void> {
    const device = this.devices.get(deviceId);
    if (!device) throw new Error(`Device ${deviceId} not found`);

    const driver = this.drivers.get(device.platform);

    // Capture jobId BEFORE device.release() clears currentJobId — the
    // device.released envelope links the release to its originating job
    // (see RESEARCH §Emission Points: "jobId captured before release() clears it").
    const jobId = device.currentJobId;

    // Running -> Cleanup
    const t1 = device.transition(DeviceState.Cleanup);
    this.emit.stateChanged(device.id, { deviceId: device.id, from: t1.from, to: t1.to });

    if (driver && device.emulatorId) {
      try {
        await driver.cleanup(device.emulatorId);
      } catch (err: any) {
        this.logger.error({ deviceId, error: err.message }, 'Cleanup failed');
      }
    }

    // Cleanup -> Idle (device.release() internally calls transition(Idle) +
    // clears currentJobId/pid). Capture prevState BEFORE the release call so
    // the emitted envelope has the correct `from` without re-reading state.
    const prevStateBeforeRelease = device.state;
    device.release();
    this.emit.stateChanged(device.id, {
      deviceId: device.id,
      from: prevStateBeforeRelease,
      to: DeviceState.Idle,
    });
    this.emit.released(device.id, {
      deviceId: device.id,
      jobId, // captured pre-release — NOT null if device was allocated
      platform: device.platform,
    });
    this.logger.info({ deviceId }, 'Device released');
  }

  /**
   * Get all devices info.
   */
  getDevices(): DeviceInfo[] {
    return Array.from(this.devices.values()).map(d => d.toInfo());
  }

  /**
   * Get a single device info by ID.
   */
  getDevice(id: string): DeviceInfo | null {
    const device = this.devices.get(id);
    return device ? device.toInfo() : null;
  }

  /**
   * Get internal devices map (used by HealthChecker).
   */
  getDeviceMap(): Map<string, Device> {
    return this.devices;
  }

  /**
   * Get driver for a platform (used by HealthChecker).
   */
  getDriver(platform: Platform): DeviceDriver | undefined {
    return this.drivers.get(platform);
  }

  /**
   * Replace a dead/zombie device: remove old device from pool, create and boot
   * a fresh one with the same name and platform. Returns the new device ID.
   */
  async replaceDevice(oldDeviceId: string, platform: Platform, name: string): Promise<string> {
    // Remove old device from pool
    this.devices.delete(oldDeviceId);
    this.logger.info({ oldDeviceId, name, platform }, 'Removed dead device from pool');

    const driver = this.drivers.get(platform);
    if (!driver) {
      throw new Error(`No driver registered for platform: ${platform}`);
    }

    // Create and boot fresh device
    const emulatorId = await driver.create(name, this.config.pool[platform]);
    const device = new Device(name, platform, { emulatorId });
    this.devices.set(device.id, device);

    const result = await driver.boot(emulatorId);
    device.port = result.port;
    device.pid = result.pid;
    device.grpcPort = result.grpcPort ?? null;
    this.processTracker.register(device.id, result.pid);

    const { from, to } = device.transition(DeviceState.Idle);
    this.emit.stateChanged(device.id, { deviceId: device.id, from, to });
    // Phase 24 / Plan 24-02 — fresh-boot signal (Booting→Idle).
    // Emit AFTER stateChanged (Pitfall 2 — emit AFTER mutation success).
    // device.port is the real port from driver.boot result above.
    this.emit.booted(device.id, {
      deviceId: device.id,
      platform: device.platform,
      emulatorId: device.emulatorId,
      port: device.port,
    });
    this.logger.info(
      { deviceId: device.id, name, platform, port: result.port, pid: result.pid },
      'Replacement device booted and ready',
    );

    return device.id;
  }

  /**
   * Shutdown all devices cleanly.
   */
  async shutdown(): Promise<void> {
    this.logger.info('Shutting down pool...');

    for (const [, device] of this.devices) {
      const driver = this.drivers.get(device.platform);
      if (driver && device.emulatorId) {
        try {
          await driver.shutdown(device.emulatorId);
        } catch (err: any) {
          this.logger.error({ deviceId: device.id, error: err.message }, 'Failed to shutdown device');
        }
      }
    }

    this.processTracker.killAll();
    this.processTracker.stop();
    this.logger.info('Pool shutdown complete');
  }
}
