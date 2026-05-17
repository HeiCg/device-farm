/**
 * iOS Simulator Manager
 * Uses appium-ios-simulator for robust simulator management
 */

import { getSimulator, killAllSimulators } from 'appium-ios-simulator';
import type { Simulator } from 'appium-ios-simulator';
import { exec, execFile } from 'child_process';
import { promisify } from 'util';
import { EventEmitter } from 'events';
import {
  FarmDevice,
  DeviceStatus,
  CreateDeviceOptions,
  InstallAppResult,
  StreamResult,
} from '@device-stream/core';
import { CaptureService } from './capture-service';
import { InputService, type TapArgs, type SwipeArgs } from './input-service.js';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

interface SimctlDevice {
  udid: string;
  name: string;
  state: string;
  deviceTypeIdentifier?: string;
  runtime?: string;
}

interface SimctlRuntime {
  identifier: string;
  name: string;
  version: string;
  isAvailable: boolean;
}

export interface IOSSimulatorManagerOptions {
  bootTimeout?: number;
  captureService?: CaptureService;
  /**
   * Optional InputService for dispatching tap/swipe/key/text. If omitted,
   * the manager creates its own. Exposed for DI in tests.
   */
  inputs?: InputService;
}

export class IOSSimulatorManager extends EventEmitter {
  private devices: Map<string, FarmDevice> = new Map();
  private simulators: Map<string, Simulator> = new Map();
  private bootTimeout: number;
  private captureService: CaptureService | null;
  private readonly inputs: InputService;

  constructor(options: IOSSimulatorManagerOptions = {}) {
    super();
    this.bootTimeout = options.bootTimeout ?? 120000;
    this.captureService = options.captureService ?? null;
    this.inputs = options.inputs ?? new InputService();
  }

  /**
   * Accessor for the underlying InputService. The stream service uses
   * this to route gesture envelopes from the browser through the
   * sim-input pipeline.
   */
  get inputService(): InputService {
    return this.inputs;
  }

  // ==================== INPUT DISPATCH ====================

  /**
   * Tap at (x,y) in the simulator's screen-coordinate space. `width`
   * and `height` describe the source frame the coordinates were
   * captured in so sim-input can scale.
   */
  async tap(udid: string, args: TapArgs): Promise<void> {
    await this.inputs.tap(udid, args);
  }

  /**
   * Swipe from (fromX,fromY) to (toX,toY) over `durationMs` (default
   * 250ms).
   */
  async swipe(udid: string, args: SwipeArgs): Promise<void> {
    await this.inputs.swipe(udid, args);
  }

  /**
   * Press a hardware key by numeric code (HID usage). sim-input
   * brackets press as down+up atomically.
   */
  async pressKey(udid: string, key: number): Promise<void> {
    await this.inputs.pressKey(udid, key);
  }

  /**
   * Type literal text via sim-input's text path.
   */
  async typeText(udid: string, text: string): Promise<void> {
    await this.inputs.typeText(udid, text);
  }

  /**
   * Get appium-ios-simulator instance for a device
   */
  private async getSimulatorInstance(udid: string): Promise<Simulator> {
    let sim = this.simulators.get(udid);
    if (!sim) {
      sim = await getSimulator(udid);
      this.simulators.set(udid, sim);
    }
    return sim;
  }

  /**
   * List available device types
   */
  async listDeviceTypes(): Promise<string[]> {
    try {
      const { stdout } = await execAsync('xcrun simctl list devicetypes -j');
      const data = JSON.parse(stdout);
      return data.devicetypes.map((dt: { identifier: string }) => dt.identifier);
    } catch (error) {
      console.error('Failed to list device types:', error);
      return [];
    }
  }

  /**
   * List available runtimes
   */
  async listRuntimes(): Promise<SimctlRuntime[]> {
    try {
      const { stdout } = await execAsync('xcrun simctl list runtimes -j');
      const data = JSON.parse(stdout);
      return data.runtimes.filter((r: SimctlRuntime) => r.isAvailable);
    } catch (error) {
      console.error('Failed to list runtimes:', error);
      return [];
    }
  }

  /**
   * Get latest iOS runtime
   */
  async getLatestIOSRuntime(): Promise<string | undefined> {
    const runtimes = await this.listRuntimes();
    const parseSemver = (v: string) => v.split('.').map(Number);
    const iosRuntimes = runtimes
      .filter(r => r.identifier.includes('iOS'))
      .sort((a, b) => {
        const [aMaj, aMin = 0] = parseSemver(a.version);
        const [bMaj, bMin = 0] = parseSemver(b.version);
        return bMaj !== aMaj ? bMaj - aMaj : bMin - aMin;
      });

    return iosRuntimes[0]?.identifier;
  }

  /**
   * List existing simulators
   */
  async listExistingSimulators(): Promise<SimctlDevice[]> {
    try {
      const { stdout } = await execAsync('xcrun simctl list devices -j');
      const data = JSON.parse(stdout);
      const devices: SimctlDevice[] = [];

      for (const runtime of Object.keys(data.devices)) {
        for (const device of data.devices[runtime]) {
          devices.push({
            ...device,
            runtime,
          });
        }
      }

      return devices;
    } catch (error) {
      console.error('Failed to list simulators:', error);
      return [];
    }
  }

  /**
   * Create a new iOS simulator
   */
  async createDevice(options: CreateDeviceOptions): Promise<FarmDevice> {
    const name = options.name || `farm-ios-${Date.now()}`;
    const deviceType = options.deviceType || 'com.apple.CoreSimulator.SimDeviceType.iPhone-15-Pro';
    const runtime = options.osVersion || await this.getLatestIOSRuntime();

    if (!runtime) {
      throw new Error('No iOS runtime available');
    }

    const device: FarmDevice = {
      id: '',
      platform: 'ios',
      name,
      status: 'creating',
      createdAt: Date.now(),
      metadata: {
        deviceType: deviceType.split('.').pop(),
        osVersion: runtime.split('.').pop(),
      },
    };

    this.emit('device:creating', device);

    try {
      // Check if simulator with this name already exists
      const existingSimulators = await this.listExistingSimulators();
      const existing = existingSimulators.find(s => s.name === name);

      if (existing) {
        device.id = existing.udid;
        device.serial = existing.udid;
        device.status = existing.state === 'Booted' ? 'ready' : 'stopped';
        this.devices.set(device.id, device);
        console.log(`Simulator already exists: ${name} (${existing.udid})`);
        return device;
      }

      // Create new simulator
      const { stdout } = await execAsync(
        `xcrun simctl create "${name}" "${deviceType}" "${runtime}"`
      );

      const udid = stdout.trim();
      device.id = udid;
      device.serial = udid;
      device.status = 'stopped';

      this.devices.set(udid, device);
      this.emit('device:created', device);

      console.log(`Created simulator: ${name} (${udid})`);
      return device;
    } catch (error) {
      device.status = 'error';
      device.error = error instanceof Error ? error.message : String(error);
      this.emit('device:error', { device, error: device.error });
      throw error;
    }
  }

  /**
   * Start a simulator using appium-ios-simulator
   */
  async startDevice(deviceId: string): Promise<FarmDevice> {
    const device = this.devices.get(deviceId);
    if (!device) {
      throw new Error(`Device not found: ${deviceId}`);
    }

    if (device.status === 'ready' || device.status === 'busy') {
      return device;
    }

    device.status = 'booting';
    this.emit('device:booting', device);

    try {
      const sim = await this.getSimulatorInstance(deviceId);

      // Run simulator in headless mode (no UI window)
      await sim.run({
        isHeadless: true,
        startupTimeout: this.bootTimeout,
        connectHardwareKeyboard: false,
        pasteboardAutomaticSync: 'off',
      });

      // Wait for boot to complete
      await sim.waitForBoot(this.bootTimeout);

      device.status = 'ready';
      this.emit('device:ready', device);
      return device;
    } catch (error) {
      // Check if already booted
      if (error instanceof Error && error.message.includes('already booted')) {
        device.status = 'ready';
        this.emit('device:ready', device);
        return device;
      }

      device.status = 'error';
      device.error = error instanceof Error ? error.message : String(error);
      this.emit('device:error', { device, error: device.error });
      throw error;
    }
  }

  /**
   * Stop a simulator
   */
  async stopDevice(deviceId: string): Promise<void> {
    const device = this.devices.get(deviceId);
    if (!device) {
      throw new Error(`Device not found: ${deviceId}`);
    }

    if (device.status === 'stopped' || device.status === 'stopping') {
      return;
    }

    device.status = 'stopping';
    this.emit('device:stopping', device);

    try {
      const sim = await this.getSimulatorInstance(deviceId);
      await sim.shutdown({ timeout: 30000 });

      device.status = 'stopped';
      this.emit('device:stopped', device);
    } catch (error) {
      // Check if already shutdown
      if (error instanceof Error && error.message.includes('current state: Shutdown')) {
        device.status = 'stopped';
        this.emit('device:stopped', device);
        return;
      }

      device.status = 'error';
      device.error = error instanceof Error ? error.message : String(error);
      this.emit('device:error', { device, error: device.error });
      throw error;
    }
  }

  /**
   * Delete a simulator
   */
  async deleteDevice(deviceId: string): Promise<void> {
    const device = this.devices.get(deviceId);
    if (device && device.status !== 'stopped') {
      await this.stopDevice(deviceId);
    }

    try {
      const sim = await this.getSimulatorInstance(deviceId);
      await sim.delete();

      this.devices.delete(deviceId);
      this.simulators.delete(deviceId);
      console.log(`Deleted simulator: ${deviceId}`);
    } catch (error) {
      console.error('Failed to delete simulator %s: %s', deviceId, error);
      throw error;
    }
  }

  /**
   * Install a .app bundle on the simulator
   */
  async installApp(deviceId: string, appPath: string): Promise<InstallAppResult> {
    const device = this.devices.get(deviceId);
    if (!device) {
      return { success: false, error: 'Device not found' };
    }

    if (device.status !== 'ready' && device.status !== 'busy') {
      return { success: false, error: `Device not ready (status: ${device.status})` };
    }

    try {
      const sim = await this.getSimulatorInstance(deviceId);
      await sim.installApp(appPath);

      // Get bundle ID from Info.plist
      let bundleId: string | undefined;
      try {
        const { stdout } = await execFileAsync(
          '/usr/libexec/PlistBuddy',
          ['-c', 'Print :CFBundleIdentifier', `${appPath}/Info.plist`]
        );
        bundleId = stdout.trim();
      } catch {
        try {
          const { stdout } = await execFileAsync(
            'defaults',
            ['read', `${appPath}/Info`, 'CFBundleIdentifier']
          );
          bundleId = stdout.trim();
        } catch {
          console.warn('Could not extract bundle ID from app');
        }
      }

      return { success: true, bundleId };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Launch an app on the simulator
   */
  async launchApp(deviceId: string, bundleId: string): Promise<boolean> {
    try {
      const sim = await this.getSimulatorInstance(deviceId);
      await sim.launchApp(bundleId, { wait: true, timeoutMs: 10000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Terminate an app on the simulator
   */
  async terminateApp(deviceId: string, bundleId: string): Promise<boolean> {
    try {
      const sim = await this.getSimulatorInstance(deviceId);
      await sim.terminateApp(bundleId);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if an app is installed
   */
  async isAppInstalled(deviceId: string, bundleId: string): Promise<boolean> {
    try {
      const sim = await this.getSimulatorInstance(deviceId);
      return await sim.isAppInstalled(bundleId);
    } catch {
      return false;
    }
  }

  /**
   * Check if an app is running
   */
  async isAppRunning(deviceId: string, bundleId: string): Promise<boolean> {
    try {
      const sim = await this.getSimulatorInstance(deviceId);
      return await sim.isAppRunning(bundleId);
    } catch {
      return false;
    }
  }

  /**
   * Uninstall an app from the simulator
   */
  async uninstallApp(deviceId: string, bundleId: string): Promise<boolean> {
    try {
      const sim = await this.getSimulatorInstance(deviceId);
      await sim.removeApp(bundleId);
      return true;
    } catch {
      return false;
    }
  }

  // ==================== PERMISSIONS ====================

  /**
   * Set app permission
   * @param permission - e.g., 'calendar', 'camera', 'contacts', 'location', 'microphone', 'photos', etc.
   * @param value - 'yes', 'no', 'unset'
   */
  async setAppPermission(deviceId: string, bundleId: string, permission: string, value: 'yes' | 'no' | 'unset'): Promise<void> {
    const sim = await this.getSimulatorInstance(deviceId);
    await sim.setPermission(bundleId, permission, value);
  }

  /**
   * Set multiple app permissions at once
   */
  async setAppPermissions(deviceId: string, bundleId: string, permissions: Record<string, 'yes' | 'no' | 'unset'>): Promise<void> {
    const sim = await this.getSimulatorInstance(deviceId);
    await sim.setPermissions(bundleId, permissions);
  }

  /**
   * Get app permission value
   */
  async getAppPermission(deviceId: string, bundleId: string, permission: string): Promise<string> {
    const sim = await this.getSimulatorInstance(deviceId);
    return await sim.getPermission(bundleId, permission);
  }

  // ==================== BIOMETRICS ====================

  /**
   * Enroll or unenroll biometric (Face ID / Touch ID)
   */
  async setBiometricEnrolled(deviceId: string, enrolled: boolean): Promise<void> {
    const sim = await this.getSimulatorInstance(deviceId);
    await sim.enrollBiometric(enrolled);
  }

  /**
   * Check if biometric is enrolled
   */
  async isBiometricEnrolled(deviceId: string): Promise<boolean> {
    const sim = await this.getSimulatorInstance(deviceId);
    return await sim.isBiometricEnrolled();
  }

  /**
   * Send biometric match/non-match
   * @param shouldMatch - true for successful auth, false for failure
   * @param biometricName - 'touchId' or 'faceId'
   */
  async sendBiometricMatch(deviceId: string, shouldMatch: boolean, biometricName: 'touchId' | 'faceId' = 'faceId'): Promise<void> {
    const sim = await this.getSimulatorInstance(deviceId);
    await sim.sendBiometricMatch(shouldMatch, biometricName);
  }

  // ==================== SYSTEM SETTINGS ====================

  /**
   * Set device geolocation
   */
  async setGeolocation(deviceId: string, latitude: number, longitude: number): Promise<void> {
    const sim = await this.getSimulatorInstance(deviceId);
    await sim.setGeolocation(latitude, longitude);
  }

  /**
   * Set device appearance (light/dark mode)
   */
  async setAppearance(deviceId: string, mode: 'light' | 'dark'): Promise<void> {
    const sim = await this.getSimulatorInstance(deviceId);
    await sim.setAppearance(mode);
  }

  /**
   * Get current appearance
   */
  async getAppearance(deviceId: string): Promise<string> {
    const sim = await this.getSimulatorInstance(deviceId);
    return await sim.getAppearance();
  }

  /**
   * Configure localization (language, locale, keyboard)
   */
  async configureLocalization(deviceId: string, options: {
    language?: { name: string };
    locale?: { name: string; calendar?: string };
    keyboard?: { name: string; layout: string };
  }): Promise<void> {
    const sim = await this.getSimulatorInstance(deviceId);
    await sim.configureLocalization(options);
  }

  // ==================== UTILITIES ====================

  /**
   * Send push notification to the simulator
   */
  async pushNotification(deviceId: string, bundleId: string, payload: Record<string, unknown>): Promise<void> {
    const sim = await this.getSimulatorInstance(deviceId);
    await sim.pushNotification({
      ...payload,
      'Simulator Target Bundle': bundleId,
    });
  }

  /**
   * Shake the device (triggers shake gesture)
   */
  async shake(deviceId: string): Promise<void> {
    const sim = await this.getSimulatorInstance(deviceId);
    await sim.shake();
  }

  /**
   * Clear keychains
   */
  async clearKeychains(deviceId: string): Promise<void> {
    const sim = await this.getSimulatorInstance(deviceId);
    await sim.clearKeychains();
  }

  /**
   * Open URL in simulator (Safari or deep link)
   */
  async openUrl(deviceId: string, url: string): Promise<void> {
    const sim = await this.getSimulatorInstance(deviceId);
    await sim.openUrl(url);
  }

  /**
   * Get list of running processes on simulator
   */
  async getRunningProcesses(deviceId: string): Promise<Array<{ pid: number; name: string; group: string | null }>> {
    const sim = await this.getSimulatorInstance(deviceId);
    return await sim.ps();
  }

  // ==================== STREAMING (ScreenCaptureKit only) ====================

  /**
   * Start streaming from simulator via ScreenCaptureKit (sim-capture binary).
   */
  async startStreaming(deviceId: string): Promise<StreamResult> {
    const device = this.devices.get(deviceId);
    if (!device || (device.status !== 'ready' && device.status !== 'busy')) {
      return { success: false, error: `Device ${deviceId} is not ready` };
    }

    if (!this.captureService) {
      return { success: false, error: 'No CaptureService configured' };
    }

    if (!this.captureService.isBinaryAvailable()) {
      return { success: false, error: 'sim-capture binary not found. Run: cd device-stream/tools/sim-capture && ./build.sh' };
    }

    console.log(`[Streaming] Starting ScreenCaptureKit for ${deviceId}`);
    const started = await this.captureService.startCapture(deviceId);
    if (!started) {
      return { success: false, error: 'ScreenCaptureKit capture failed to start' };
    }

    console.log(`[Streaming] ScreenCaptureKit active for ${deviceId}`);
    return { success: true };
  }

  /**
   * Stop streaming from simulator.
   */
  async stopStreaming(deviceId: string): Promise<void> {
    this.captureService?.stopCapture(deviceId);
  }

  // ==================== DEVICE MANAGEMENT ====================

  /**
   * Get device by ID
   */
  getDevice(deviceId: string): FarmDevice | undefined {
    return this.devices.get(deviceId);
  }

  /**
   * Get all devices
   */
  getAllDevices(): FarmDevice[] {
    return Array.from(this.devices.values());
  }

  /**
   * Get devices by status
   */
  getDevicesByStatus(status: DeviceStatus): FarmDevice[] {
    return this.getAllDevices().filter(d => d.status === status);
  }

  /**
   * Mark device as busy
   */
  markBusy(deviceId: string, taskId: string): void {
    const device = this.devices.get(deviceId);
    if (device) {
      device.status = 'busy';
      device.taskId = taskId;
      device.lastUsedAt = Date.now();
      this.emit('device:busy', { device, taskId });
    }
  }

  /**
   * Release device (mark as ready)
   */
  releaseDevice(deviceId: string): void {
    const device = this.devices.get(deviceId);
    if (device && device.status === 'busy') {
      device.status = 'ready';
      device.taskId = undefined;
      this.emit('device:released', device);
    }
  }

  /**
   * Stop all simulators
   */
  async stopAll(): Promise<void> {
    const stopPromises = this.getAllDevices()
      .filter(d => d.status !== 'stopped')
      .map(d => this.stopDevice(d.id));

    await Promise.allSettled(stopPromises);
  }

  /**
   * Kill all simulators (force)
   */
  async killAll(): Promise<void> {
    await killAllSimulators();

    // Update all device statuses
    for (const device of this.devices.values()) {
      device.status = 'stopped';
    }
  }

  /**
   * Clean up - stop all captures, simulators, and delete farm-created simulators
   */
  async cleanup(): Promise<void> {
    // Stop all sim-input child processes first so they don't keep the
    // event loop alive past simulator shutdown.
    await this.inputs.stopAll().catch(() => {});

    // Stop all screen captures
    this.captureService?.cleanup();

    await this.stopAll();

    // Delete simulators created by the farm
    const farmDevices = this.getAllDevices().filter(d => d.name.startsWith('farm-ios-'));
    for (const device of farmDevices) {
      try {
        await this.deleteDevice(device.id);
      } catch (error) {
        console.error('Failed to delete %s: %s', device.id, error);
      }
    }
  }
}

// Export factory function
export function createIOSSimulatorManager(options?: IOSSimulatorManagerOptions): IOSSimulatorManager {
  return new IOSSimulatorManager(options);
}
