/**
 * go-ios CLI wrapper for iOS device management
 */

import { exec, spawn, ChildProcess } from 'child_process';
import { promisify } from 'util';
import { iosConfig } from './config';

const execAsync = promisify(exec);

/**
 * Validation patterns for security
 */
const UDID_PATTERN = /^[0-9a-fA-F-]{25,}$/;
const BUNDLE_ID_PATTERN = /^[a-zA-Z][a-zA-Z0-9.-]+$/;

/**
 * Validates UDID format to prevent command injection
 */
function validateUdid(udid: string): void {
  if (!udid || !UDID_PATTERN.test(udid)) {
    throw new Error(`Invalid UDID format: ${udid}`);
  }
}

/**
 * Validates Bundle ID format to prevent command injection
 */
function validateBundleId(bundleId: string): void {
  if (!bundleId || !BUNDLE_ID_PATTERN.test(bundleId)) {
    throw new Error(`Invalid Bundle ID format: ${bundleId}`);
  }
}

/**
 * Interface for iOS device information from go-ios
 */
export interface GoIOSDevice {
  udid: string;
  deviceName: string;
  productType: string;
  productVersion: string;
  connectionType: string;
}

/**
 * Client wrapper for go-ios CLI tool
 */
export class GoIOSClient {
  private cachedDevices: GoIOSDevice[] = [];
  private lastCacheTime: number = 0;
  private readonly CACHE_TTL = 5000; // 5 seconds
  private activeProcesses: Map<string, ChildProcess[]> = new Map();

  /**
   * Check if go-ios is installed and available
   */
  async isAvailable(): Promise<boolean> {
    try {
      await execAsync('which ios');
      return true;
    } catch {
      console.warn('go-ios not found. Install with: npm install -g go-ios');
      return false;
    }
  }

  /**
   * List all connected iOS devices
   */
  async listDevices(): Promise<GoIOSDevice[]> {
    const now = Date.now();
    if (this.cachedDevices.length > 0 && now - this.lastCacheTime < this.CACHE_TTL) {
      return this.cachedDevices;
    }

    try {
      const { stdout } = await execAsync('ios list --details');
      const devices = this.parseDeviceList(stdout);

      this.cachedDevices = devices;
      this.lastCacheTime = now;

      return devices;
    } catch (error) {
      console.error('Failed to list iOS devices:', error);
      throw new Error(`go-ios list command failed: ${error}`);
    }
  }

  /**
   * Get device info by UDID
   */
  async getDeviceInfo(udid: string): Promise<GoIOSDevice | null> {
    const devices = await this.listDevices();
    return devices.find(d => d.udid === udid) || null;
  }

  /**
   * Pair with iOS device
   */
  async pairDevice(udid: string): Promise<void> {
    validateUdid(udid);
    try {
      await execAsync(`ios pair --udid=${udid}`);
      console.log(`Paired with iOS device: ${udid}`);
    } catch (error) {
      console.error(`Failed to pair with device ${udid}:`, error);
      throw new Error(`Device pairing failed: ${error}`);
    }
  }

  /**
   * Launch an app on the device
   */
  async launchApp(udid: string, bundleId: string): Promise<void> {
    validateUdid(udid);
    validateBundleId(bundleId);
    try {
      await execAsync(`ios launch --udid=${udid} ${bundleId}`);
      console.log(`Launched app ${bundleId} on device ${udid}`);
    } catch (error) {
      console.error(`Failed to launch app on device ${udid}:`, error);
      throw new Error(`App launch failed: ${error}`);
    }
  }

  /**
   * Kill an app on the device
   */
  async killApp(udid: string, bundleId: string): Promise<void> {
    validateUdid(udid);
    validateBundleId(bundleId);
    try {
      await execAsync(`ios kill --udid=${udid} ${bundleId}`);
      console.log(`Killed app ${bundleId} on device ${udid}`);
    } catch (error) {
      console.error(`Failed to kill app on device ${udid}:`, error);
      throw new Error(`App kill failed: ${error}`);
    }
  }

  /**
   * Get battery information for a device
   */
  async getBatteryLevel(udid: string): Promise<number | undefined> {
    validateUdid(udid);

    try {
      const { stdout } = await execAsync(`ios diagnostics battery --udid=${udid}`);

      const levelMatch = stdout.match(/CurrentCapacity[:\s]+(\d+)/i) ||
                         stdout.match(/BatteryLevel[:\s]+(\d+)/i) ||
                         stdout.match(/"CurrentCapacity"[:\s]+(\d+)/i);

      if (levelMatch) {
        const level = parseInt(levelMatch[1], 10);
        if (!isNaN(level) && level >= 0 && level <= 100) {
          return level;
        }
      }

      try {
        const jsonData = JSON.parse(stdout);
        if (jsonData.CurrentCapacity !== undefined) {
          return jsonData.CurrentCapacity;
        }
        if (jsonData.BatteryLevel !== undefined) {
          return jsonData.BatteryLevel;
        }
      } catch {
        // Not JSON, continue
      }

      return undefined;
    } catch (error) {
      console.warn(`[GoIOSClient] Failed to get battery info for device ${udid}:`, error);
      return undefined;
    }
  }

  /**
   * Install WebDriverAgent on the device
   */
  async installWebDriverAgent(udid: string): Promise<void> {
    validateUdid(udid);

    try {
      await this.cleanup(udid);

      const bundleId = iosConfig.wdaBundleId;
      validateBundleId(bundleId);

      const processes: ChildProcess[] = [];

      // Start WDA process
      const wdaProcess = spawn('ios', [
        'runwda',
        `--udid=${udid}`,
        `--bundleid=${bundleId}`,
        `--testrunnerbundleid=${bundleId}`,
        '--xctestconfig=WebDriverAgentRunner.xctest',
        '--env', `USE_PORT=${iosConfig.wdaPort}`
      ]);

      processes.push(wdaProcess);

      wdaProcess.stdout.on('data', (data: Buffer) => {
        console.log(`[WDA ${udid}] ${data}`);
      });

      wdaProcess.stderr.on('data', (data: Buffer) => {
        console.error(`[WDA ${udid} ERR] ${data}`);
      });

      wdaProcess.on('close', (code: number | null) => {
        console.log(`WDA process exited with code ${code}`);
        const deviceProcesses = this.activeProcesses.get(udid);
        if (deviceProcesses) {
          const idx = deviceProcesses.indexOf(wdaProcess);
          if (idx >= 0) deviceProcesses.splice(idx, 1);
        }
      });

      await new Promise(resolve => setTimeout(resolve, 5000));

      console.log(`WebDriverAgent started on device ${udid}`);

      // Start port forwarding
      const wdaPortStr = String(iosConfig.wdaPort);
      const mjpegPortStr = String(iosConfig.mjpegPort);

      const forwardProcessWda = spawn('ios', ['forward', wdaPortStr, wdaPortStr]);
      processes.push(forwardProcessWda);
      forwardProcessWda.stderr.on('data', (data: Buffer) => {
        console.error(`[Forward ${wdaPortStr} ERR] ${data}`);
      });

      const forwardProcessMjpeg = spawn('ios', ['forward', mjpegPortStr, mjpegPortStr]);
      processes.push(forwardProcessMjpeg);
      forwardProcessMjpeg.stderr.on('data', (data: Buffer) => {
        console.error(`[Forward ${mjpegPortStr} ERR] ${data}`);
      });

      this.activeProcesses.set(udid, processes);

      await new Promise(resolve => setTimeout(resolve, 1000));
      console.log('Port forwarding started');
    } catch (error) {
      console.error(`Failed to start WebDriverAgent on device ${udid}:`, error);
      throw new Error(`WebDriverAgent installation failed: ${error}`);
    }
  }

  /**
   * Cleanup all processes for a device
   */
  async cleanup(udid: string): Promise<void> {
    const processes = this.activeProcesses.get(udid);
    if (!processes || processes.length === 0) {
      return;
    }

    console.log(`[GoIOSClient] Cleaning up ${processes.length} processes for device ${udid}`);

    for (let i = processes.length - 1; i >= 0; i--) {
      const proc = processes[i];
      if (proc && !proc.killed) {
        try {
          proc.kill('SIGTERM');
        } catch (error) {
          console.warn(`[GoIOSClient] Error sending SIGTERM:`, error);
        }
      }
    }

    await new Promise(resolve => setTimeout(resolve, 500));

    for (let i = processes.length - 1; i >= 0; i--) {
      const proc = processes[i];
      if (proc && !proc.killed) {
        try {
          proc.kill('SIGKILL');
        } catch (error) {
          console.warn(`[GoIOSClient] Error sending SIGKILL:`, error);
        }
      }
    }

    this.activeProcesses.delete(udid);
    console.log(`[GoIOSClient] Cleanup complete for device ${udid}`);
  }

  /**
   * Cleanup all processes for all devices
   */
  async cleanupAll(): Promise<void> {
    const udids = Array.from(this.activeProcesses.keys());
    for (const udid of udids) {
      await this.cleanup(udid);
    }
  }

  /**
   * Check if device has active processes
   */
  hasActiveProcesses(udid: string): boolean {
    const processes = this.activeProcesses.get(udid);
    return !!processes && processes.length > 0 && processes.some(p => !p.killed);
  }

  /**
   * Parse device list output from go-ios
   */
  private parseDeviceList(output: string): GoIOSDevice[] {
    try {
      const jsonData = JSON.parse(output);
      if (jsonData.deviceList && Array.isArray(jsonData.deviceList)) {
        return jsonData.deviceList.map((device: Record<string, unknown>) => ({
          udid: device.Udid as string,
          deviceName: (device.DeviceName || device.ProductName || 'Unknown Device') as string,
          productType: device.ProductType as string,
          productVersion: device.ProductVersion as string,
          connectionType: 'USB',
        }));
      }
    } catch {
      // Not valid JSON, fall back to text parsing
    }

    const devices: GoIOSDevice[] = [];
    const deviceBlocks = output.split('\n\n').filter(block => block.trim());

    for (const block of deviceBlocks) {
      const lines = block.split('\n');
      const device: Partial<GoIOSDevice> = {};

      for (const line of lines) {
        const [key, ...valueParts] = line.split(':');
        const value = valueParts.join(':').trim();

        if (key.includes('UDID')) {
          device.udid = value;
        } else if (key.includes('DeviceName')) {
          device.deviceName = value;
        } else if (key.includes('ProductType')) {
          device.productType = value;
        } else if (key.includes('ProductVersion')) {
          device.productVersion = value;
        } else if (key.includes('ConnectionType')) {
          device.connectionType = value;
        }
      }

      if (device.udid) {
        devices.push(device as GoIOSDevice);
      }
    }

    return devices;
  }

  /**
   * Clear device cache
   */
  clearCache(): void {
    this.cachedDevices = [];
    this.lastCacheTime = 0;
  }
}

// Export singleton instance
export const goIOSClient = new GoIOSClient();
