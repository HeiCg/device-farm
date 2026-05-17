/**
 * iOS Device Service
 * Handles physical iOS device management and streaming
 */

import {
  Device,
  VideoStreamMetadata,
  BaseDeviceService,
  DeviceMutexManager,
} from '@device-stream/core';
import { goIOSClient } from './go-ios-client';
import { webDriverAgentClient } from './wda-client';
import { mjpegStreamClient } from './mjpeg-client';
import { quickTimeCapture } from './quicktime-capture';

export class IOSDeviceService extends BaseDeviceService {
  private wdaSessions: Map<string, boolean> = new Map();
  private streamMode: Map<string, 'mjpeg' | 'quicktime'> = new Map();
  private mutexManager = new DeviceMutexManager();
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private screenDimensionsCache: Map<string, { width: number; height: number }> = new Map();

  constructor() {
    super('ios');
  }

  /**
   * Check if iOS tools are available
   */
  async checkAvailability(): Promise<{ available: boolean; missing: string[] }> {
    const missing: string[] = [];

    const goIOSAvailable = await goIOSClient.isAvailable();
    if (!goIOSAvailable) {
      missing.push('go-ios (install with: npm install -g go-ios or brew install go-ios)');
    }

    const wdaAvailable = await webDriverAgentClient.isAvailable();
    if (!wdaAvailable) {
      missing.push('WebDriverAgent (must be running on port 8100)');
    }

    return {
      available: missing.length === 0,
      missing,
    };
  }

  async listDevices(): Promise<Device[]> {
    try {
      const iosDevices = await goIOSClient.listDevices();
      const devices: Device[] = [];

      for (const iosDevice of iosDevices) {
        const { width, height } = this.getScreenDimensions(iosDevice.productType);

        let battery: number | undefined;
        try {
          battery = await goIOSClient.getBatteryLevel(iosDevice.udid);
        } catch {
          console.warn(`Could not get battery level for ${iosDevice.udid}`);
        }

        devices.push({
          serial: iosDevice.udid,
          platform: 'ios',
          model: iosDevice.deviceName || iosDevice.productType,
          osVersion: iosDevice.productVersion || 'Unknown',
          screenWidth: width,
          screenHeight: height,
          battery,
          connected: this.isConnected(iosDevice.udid),
        });
      }

      return devices;
    } catch (error) {
      console.error('Failed to list iOS devices:', error);
      return [];
    }
  }

  async connect(serial: string): Promise<void> {
    await this.mutexManager.withDeviceLock(serial, async () => {
      try {
        const device = await goIOSClient.getDeviceInfo(serial);
        if (!device) {
          throw new Error(`iOS device ${serial} not found`);
        }

        try {
          await goIOSClient.pairDevice(serial);
        } catch (error) {
          console.warn(`Device pairing failed (may already be paired): ${error}`);
        }

        try {
          await webDriverAgentClient.createSession(serial);
          this.wdaSessions.set(serial, true);
        } catch (wdaError) {
          console.log('Attempting to start WebDriverAgent...');
          try {
            await goIOSClient.installWebDriverAgent(serial);

            await new Promise(resolve => setTimeout(resolve, 3000));
            await webDriverAgentClient.createSession(serial);
            this.wdaSessions.set(serial, true);
          } catch (retryError) {
            await goIOSClient.cleanup(serial).catch(() => {});
            throw retryError;
          }
        }

        this.markConnected(serial, webDriverAgentClient.getSession(serial));

        // Cache screen dimensions for scroll() calls
        const dims = this.getScreenDimensions(device.productType);
        this.screenDimensionsCache.set(serial, dims);

        console.log(`iOS device ${serial} connected successfully`);
      } catch (error) {
        console.error(`Failed to connect iOS device ${serial}:`, error);
        throw new Error(`Failed to connect iOS device: ${error}`);
      }
    });
  }

  async disconnect(serial: string): Promise<void> {
    await this.mutexManager.withDeviceLock(serial, async () => {
      await this._teardown(serial);
    });
    this.mutexManager.removeMutex(serial);
  }

  private async _teardown(serial: string): Promise<void> {
    try {
      await webDriverAgentClient.deleteSession(serial);
      this.wdaSessions.delete(serial);

      await goIOSClient.cleanup(serial);

      this.markDisconnected(serial);
      this.streamMode.delete(serial);

      console.log(`iOS device ${serial} disconnected`);
    } catch (error) {
      console.error(`Failed to disconnect iOS device ${serial}:`, error);
      throw new Error(`Failed to disconnect iOS device: ${error}`);
    }
  }

  async tap(serial: string, x: number, y: number): Promise<void> {
    this.assertConnected(serial);
    await webDriverAgentClient.tap(serial, x, y);
  }

  async typeText(serial: string, text: string): Promise<void> {
    this.assertConnected(serial);
    await webDriverAgentClient.typeText(serial, text);
  }

  async pressKey(serial: string, key: string): Promise<void> {
    this.assertConnected(serial);

    const keyMap: Record<string, 'home' | 'volumeUp' | 'volumeDown'> = {
      home: 'home',
      back: 'home',
      volumeup: 'volumeUp',
      volumedown: 'volumeDown',
    };

    const iosButton = keyMap[key.toLowerCase()];
    if (!iosButton) {
      throw new Error(`Unsupported key: ${key}`);
    }

    await webDriverAgentClient.pressButton(serial, iosButton);
  }

  async screenshot(serial: string): Promise<Buffer> {
    this.assertConnected(serial);
    return await webDriverAgentClient.screenshot(serial);
  }

  async swipe(
    serial: string,
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    duration?: number
  ): Promise<void> {
    this.assertConnected(serial);
    await webDriverAgentClient.swipe(serial, startX, startY, endX, endY, duration);
  }

  async scroll(
    serial: string,
    direction: 'up' | 'down' | 'left' | 'right',
    distance?: number
  ): Promise<void> {
    this.assertConnected(serial);

    const dims = this.screenDimensionsCache.get(serial);
    const centerX = dims ? Math.floor(dims.width / 2) : undefined;
    const centerY = dims ? Math.floor(dims.height / 2) : undefined;

    await webDriverAgentClient.scroll(serial, direction, distance, centerX, centerY);
  }

  async startMirroring(serial: string): Promise<VideoStreamMetadata> {
    this.assertConnected(serial);

    const devices = await this.listDevices();
    const device = devices.find(d => d.serial === serial);

    if (!device) {
      throw new Error(`iOS device ${serial} not found`);
    }

    try {
      const mjpegAvailable = await mjpegStreamClient.isAvailable();
      if (mjpegAvailable) {
        // Register error listener before connecting to avoid unhandled error events
        const errorHandler = (event: { udid: string; error: Error }) => {
          if (event.udid === serial) {
            console.error(`[IOSDeviceService] MJPEG stream error for ${serial}:`, event.error);
          }
        };
        mjpegStreamClient.on('error', errorHandler);
        mjpegStreamClient.connect(serial);
        this.streamMode.set(serial, 'mjpeg');
        console.log(`Started MJPEG screen mirroring for iOS device ${serial}`);

        return {
          codec: 'mjpeg',
          width: device.screenWidth,
          height: device.screenHeight,
          frameRate: 30,
        };
      }
    } catch (error) {
      console.warn(`MJPEG streaming not available, falling back to QuickTime: ${error}`);
    }

    try {
      await quickTimeCapture.startCapture(serial);
      this.streamMode.set(serial, 'quicktime');
      console.log(`Started QuickTime screen mirroring for iOS device ${serial}`);
    } catch (error) {
      console.error(`Failed to start QuickTime capture: ${error}`);
      throw new Error(`Screen mirroring failed: ${error}`);
    }

    return {
      codec: 'h264',
      width: device.screenWidth,
      height: device.screenHeight,
      frameRate: 60,
    };
  }

  async stopMirroring(serial: string): Promise<void> {
    const mode = this.streamMode.get(serial);

    if (mode === 'mjpeg') {
      mjpegStreamClient.disconnect(serial);
      console.log(`Stopped MJPEG screen mirroring for iOS device ${serial}`);
    } else {
      try {
        await quickTimeCapture.stopCapture(serial);
        console.log(`Stopped QuickTime screen mirroring for iOS device ${serial}`);
      } catch (error) {
        console.error(`Failed to stop QuickTime capture: ${error}`);
      }
    }

    this.streamMode.delete(serial);
  }

  /**
   * Get the current streaming mode for a device
   */
  getStreamMode(serial: string): 'mjpeg' | 'quicktime' | undefined {
    return this.streamMode.get(serial);
  }

  /**
   * Get the MJPEG stream client for direct access
   */
  getMjpegStreamClient(): typeof mjpegStreamClient {
    return mjpegStreamClient;
  }

  /**
   * Get the QuickTime capture instance for direct access
   */
  getQuickTimeCapture(): typeof quickTimeCapture {
    return quickTimeCapture;
  }

  /**
   * Health check for a specific device
   */
  async healthCheck(serial: string): Promise<boolean> {
    if (!this.isConnected(serial)) {
      return false;
    }

    return webDriverAgentClient.healthCheck(serial);
  }

  /**
   * Start periodic health checks
   */
  startHealthChecks(intervalMs: number = 30000): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    this.healthCheckInterval = setInterval(async () => {
      const connectedSerials = Array.from(this.connections.keys());

      for (const serial of connectedSerials) {
        try {
          const isHealthy = await this.healthCheck(serial);
          if (!isHealthy) {
            console.warn(`[IOSDeviceService] Device ${serial} failed health check, tearing down`);
            await this._teardown(serial).catch(err =>
              console.error(`[IOSDeviceService] Teardown failed for ${serial}:`, err)
            );
            this.mutexManager.removeMutex(serial);
          }
        } catch (error) {
          console.error(`[IOSDeviceService] Health check error for ${serial}:`, error);
        }
      }
    }, intervalMs);

    console.log(`[IOSDeviceService] Started health checks with ${intervalMs}ms interval`);
  }

  /**
   * Stop periodic health checks
   */
  stopHealthChecks(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
      console.log('[IOSDeviceService] Stopped health checks');
    }
  }

  /**
   * Get list of all connected device serials
   */
  getConnectedDevices(): string[] {
    return Array.from(this.connections.keys());
  }

  // Explorer Methods

  async captureUIHierarchy(serial: string): Promise<string> {
    this.assertConnected(serial);
    return await webDriverAgentClient.captureUIHierarchy(serial);
  }

  async getCurrentApp(serial: string): Promise<string> {
    this.assertConnected(serial);
    try {
      const appInfo = await webDriverAgentClient.getActiveAppInfo(serial);
      return appInfo.bundleId;
    } catch {
      return 'unknown';
    }
  }

  async getCurrentActivity(serial: string): Promise<string> {
    this.assertConnected(serial);
    try {
      const appInfo = await webDriverAgentClient.getActiveAppInfo(serial);
      return `${appInfo.bundleId}/${appInfo.name}`;
    } catch {
      return 'unknown/unknown';
    }
  }

  async launchApp(serial: string, bundleId: string): Promise<void> {
    this.assertConnected(serial);
    await webDriverAgentClient.launchApp(serial, bundleId);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  async terminateApp(serial: string, bundleId: string): Promise<void> {
    this.assertConnected(serial);
    await webDriverAgentClient.terminateApp(serial, bundleId);
  }

  async activateApp(serial: string, bundleId: string): Promise<void> {
    this.assertConnected(serial);
    await webDriverAgentClient.activateApp(serial, bundleId);
  }

  async longPress(serial: string, x: number, y: number, duration: number = 1000): Promise<void> {
    this.assertConnected(serial);
    await webDriverAgentClient.longPress(serial, x, y, duration);
  }

  /**
   * Get screen dimensions based on iOS device product type
   */
  private getScreenDimensions(productType: string): { width: number; height: number } {
    const dimensionsMap: Record<string, { width: number; height: number }> = {
      // iPhone 16 series
      'iPhone17,1': { width: 1206, height: 2622 },
      'iPhone17,2': { width: 1320, height: 2868 },
      'iPhone17,3': { width: 1179, height: 2556 },
      'iPhone17,4': { width: 1290, height: 2796 },
      // iPhone 15 series
      'iPhone16,1': { width: 1179, height: 2556 },
      'iPhone16,2': { width: 1290, height: 2796 },
      'iPhone15,4': { width: 1179, height: 2556 },
      'iPhone15,5': { width: 1290, height: 2796 },
      // iPhone 14 series
      'iPhone15,2': { width: 1179, height: 2556 },
      'iPhone15,3': { width: 1290, height: 2796 },
      'iPhone14,7': { width: 1170, height: 2532 },
      'iPhone14,8': { width: 1284, height: 2778 },
      // iPhone 13 series
      'iPhone14,2': { width: 1170, height: 2532 },
      'iPhone14,3': { width: 1284, height: 2778 },
      'iPhone14,4': { width: 1080, height: 2340 },
      'iPhone14,5': { width: 1170, height: 2532 },
      // iPhone 12 series
      'iPhone13,1': { width: 1080, height: 2340 },
      'iPhone13,2': { width: 1170, height: 2532 },
      'iPhone13,3': { width: 1170, height: 2532 },
      'iPhone13,4': { width: 1284, height: 2778 },
      // iPhone SE series
      'iPhone14,6': { width: 750, height: 1334 },
      'iPhone12,8': { width: 750, height: 1334 },
      // iPhone 11 series
      'iPhone12,1': { width: 828, height: 1792 },
      'iPhone12,3': { width: 1125, height: 2436 },
      'iPhone12,5': { width: 1242, height: 2688 },
      // iPad Pro 12.9"
      'iPad13,8': { width: 2048, height: 2732 },
      'iPad14,5': { width: 2048, height: 2732 },
      'iPad14,6': { width: 2048, height: 2732 },
      // iPad Pro 11"
      'iPad13,4': { width: 1668, height: 2388 },
      'iPad14,3': { width: 1668, height: 2388 },
      'iPad14,4': { width: 1668, height: 2388 },
      // Default
      'default': { width: 1170, height: 2532 },
    };

    return dimensionsMap[productType] || dimensionsMap['default'];
  }
}

// Export singleton instance
export const iosDeviceService = new IOSDeviceService();
