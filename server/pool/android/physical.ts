/**
 * Phase 36 / Plan 36-02 — PhysicalAndroidDriver (PHYS-ANDROID-DRIVER).
 *
 * Implements the platform-agnostic DeviceDriver contract (server/pool/types.ts)
 * for physical Android devices (USB-tethered or wirelessly paired).
 *
 *   - `create`: returns the adb serial unchanged (no AVD to create)
 *   - `boot`:   `adb -s <serial> wait-for-device` then verify
 *               `getprop sys.boot_completed === 1` (reachability check —
 *               physical phones do not power-cycle from the host).
 *               Returns `{ port: 0, pid: 0 }` (physical devices have neither).
 *   - `shutdown`: no-op (cannot remotely power off a real phone)
 *   - `isHealthy`: `adb -s <serial> get-state` → checks stdout === 'device'
 *   - `cleanup`: `adb -s <serial> logcat -c` (best-effort; errors swallowed)
 *
 * Process spawn uses node:child_process.execFile (argv-array form — NEVER
 * shell string) wrapped via promisify, matching the security policy
 * called out in 36-02 PLAN.md.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type pino from 'pino';
import type {
  DeviceDriver,
  DeviceConfig,
  BootOptions,
  BootResult,
} from '../types.js';

const execFileAsync = promisify(execFile);

export class PhysicalAndroidDriver implements DeviceDriver {
  private readonly logger: pino.Logger;

  constructor(logger: pino.Logger) {
    this.logger = logger.child({ component: 'android-physical' });
  }

  async create(name: string, _config: DeviceConfig): Promise<string> {
    // Physical devices are discovered, not created. `name` IS the adb serial.
    return name;
  }

  async boot(serial: string, options?: BootOptions): Promise<BootResult> {
    const timeout = options?.timeout ?? 30_000;
    await execFileAsync(
      'adb',
      ['-s', serial, 'wait-for-device'],
      { timeout },
    );
    const { stdout } = await execFileAsync(
      'adb',
      ['-s', serial, 'shell', 'getprop', 'sys.boot_completed'],
      { timeout: 10_000 },
    );
    if (stdout.trim() !== '1') {
      throw new Error(`Physical device ${serial} not boot-completed (sys.boot_completed=${stdout.trim()})`);
    }
    this.logger.info({ serial }, 'Physical device reachable');
    return { port: 0, pid: 0 };
  }

  async shutdown(_serial: string): Promise<void> {
    // No-op — cannot power off a real phone from the host.
  }

  async isHealthy(serial: string, _port?: number | null): Promise<boolean> {
    try {
      const { stdout } = await execFileAsync(
        'adb',
        ['-s', serial, 'get-state'],
        { timeout: 5_000 },
      );
      return stdout.trim() === 'device';
    } catch {
      return false;
    }
  }

  async cleanup(serial: string): Promise<void> {
    try {
      await execFileAsync(
        'adb',
        ['-s', serial, 'logcat', '-c'],
        { timeout: 5_000 },
      );
    } catch (err) {
      // Best-effort — log buffer clear is non-fatal.
      this.logger.warn({ err, serial }, 'logcat -c failed (non-fatal)');
    }
  }
}
