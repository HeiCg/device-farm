/**
 * iOS simulator driver implementing DeviceDriver interface.
 * Manages full lifecycle: create simulator, boot, health check, shutdown, cleanup.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { DeviceDriver, DeviceConfig, IosDeviceConfig, BootOptions, BootResult } from '../types.js';

const execFileAsync = promisify(execFile);

export class IosSimulatorDriver implements DeviceDriver {
  async create(name: string, config: DeviceConfig): Promise<string> {
    const iosConfig = config as IosDeviceConfig;
    const { stdout } = await execFileAsync('xcrun', [
      'simctl', 'create', name, iosConfig.device_type, iosConfig.runtime,
    ]);
    return stdout.trim(); // Returns UDID
  }

  async boot(emulatorId: string, options?: BootOptions): Promise<BootResult> {
    const timeout = options?.timeout ?? 120_000;

    try {
      await execFileAsync('xcrun', ['simctl', 'boot', emulatorId]);
    } catch (err: any) {
      // PITFALL 3: Handle "already booted" gracefully
      const errorMsg = err.stderr || err.message || '';
      if (errorMsg.includes('Booted')) {
        // Already booted, that's fine
      } else {
        throw err;
      }
    }

    // Wait for boot to complete
    await execFileAsync('xcrun', ['simctl', 'bootstatus', emulatorId, '-b'], {
      timeout,
    });

    return { port: 0, pid: 0 }; // iOS simulators use UDIDs, not ports/PIDs
  }

  async shutdown(emulatorId: string): Promise<void> {
    try {
      await execFileAsync('xcrun', ['simctl', 'shutdown', emulatorId]);
    } catch {
      // Ignore error if already shut down
    }
  }

  async isHealthy(emulatorId: string, _port?: number): Promise<boolean> {
    try {
      // Phase 36 / Plan 36-01 — narrow scope by querying a single UDID
      // instead of listing all devices. Keeps this driver outside the
      // discovery sole-caller invariant (only adapters under
      // server/pool/internal/discovery/adapters/ may list all devices).
      const { stdout } = await execFileAsync('xcrun', [
        'simctl', 'list', 'devices', emulatorId, '-j',
      ]);
      const data = JSON.parse(stdout);
      const devices: Record<string, Array<{ udid: string; state: string }>> = data.devices;

      for (const runtime of Object.values(devices)) {
        for (const device of runtime) {
          if (device.udid === emulatorId) {
            return device.state === 'Booted';
          }
        }
      }

      return false;
    } catch {
      return false;
    }
  }

  async cleanup(emulatorId: string): Promise<void> {
    // Shutdown then erase for iOS
    await this.shutdown(emulatorId);
    await execFileAsync('xcrun', ['simctl', 'erase', emulatorId]);
  }
}
