/**
 * Device-stream iOS driver implementing DeviceDriver interface.
 * PURE wrapper: all lifecycle operations delegated to IOSSimulatorManager.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { IOSSimulatorManager } from '@device-stream/ios-simulator';
import type { DeviceDriver, DeviceConfig, IosDeviceConfig, BootOptions, BootResult } from '../types.js';

const execFileAsync = promisify(execFile);

export class DeviceStreamIosDriver implements DeviceDriver {
  private readonly manager: IOSSimulatorManager;

  constructor() {
    this.manager = new IOSSimulatorManager({ bootTimeout: 120_000 });
  }

  async create(name: string, config: DeviceConfig): Promise<string> {
    const iosConfig = config as IosDeviceConfig;
    const device = await this.manager.createDevice({
      platform: 'ios',
      name,
      deviceType: `com.apple.CoreSimulator.SimDeviceType.${iosConfig.device_type}`,
      osVersion: `com.apple.CoreSimulator.SimRuntime.${iosConfig.runtime}`,
    });
    return device.id;
  }

  async boot(emulatorId: string, _options?: BootOptions): Promise<BootResult> {
    await this.manager.startDevice(emulatorId);
    return { port: 0, pid: 0 };
  }

  async shutdown(emulatorId: string): Promise<void> {
    try {
      await this.manager.stopDevice(emulatorId);
    } catch {
      // Ignore error if already shut down
    }
  }

  async isHealthy(emulatorId: string, _port?: number): Promise<boolean> {
    const device = this.manager.getDevice(emulatorId);
    return device?.status === 'ready';
  }

  async cleanup(emulatorId: string): Promise<void> {
    // Stop device first, then erase for fast between-job cleanup
    // Uses xcrun simctl erase (NOT deleteDevice -- that's slow full re-creation)
    await this.manager.stopDevice(emulatorId);
    await execFileAsync('xcrun', ['simctl', 'erase', emulatorId]);
  }
}
