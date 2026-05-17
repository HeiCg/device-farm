/**
 * Android Device Service using TangoADB
 * See: https://tangoadb.dev/
 */

import { Device, VideoStreamMetadata, BaseDeviceService } from '@device-stream/core';
import { Adb, AdbServerClient } from '@yume-chan/adb';
import { AdbServerNodeTcpConnector } from '@yume-chan/adb-server-node-tcp';
import type { AndroidStreamingService } from './service';

/**
 * Subset of Android `KEYCODE_*` numeric values used by the gRPC sendKey path.
 * Source: frameworks/base/core/java/android/view/KeyEvent.java (AOSP).
 * Keys outside this map fall through to the ADB `input keyevent` path so
 * operators retain access to the full AKEYCODE_* enum via the existing route.
 */
const NAMED_KEY_CODES: Record<string, number> = {
  back: 4,   // KEYCODE_BACK
  home: 3,   // KEYCODE_HOME
  menu: 82,  // KEYCODE_MENU
  enter: 66, // KEYCODE_ENTER
};

export class AndroidDeviceService extends BaseDeviceService {
  private client: AdbServerClient;
  private devices: Map<string, Adb> = new Map();
  private pendingConnections: Map<string, Promise<Adb>> = new Map();
  private deviceInfoCache: Map<string, Device> = new Map();
  /**
   * Optional injection point for the AndroidStreamingService session map.
   * When wired (Wave 4), tap/pressKey check the active session BEFORE shelling
   * out via ADB so emulator events can travel through the gRPC daemon instead
   * of `adb shell input`. Left undefined by default for back-compat — callers
   * that never wire streaming keep the legacy ADB behavior.
   */
  private _streaming?: AndroidStreamingService;

  constructor() {
    super('android');
    const connector = new AdbServerNodeTcpConnector({
      host: '127.0.0.1',
      port: 5037,
    });
    this.client = new AdbServerClient(connector);
  }

  /**
   * Inject the streaming service so tap/pressKey can route through the
   * gRPC daemon when an emulator has an active grpc session. Idempotent.
   * Called by the server's plugin wiring (Phase 33 Wave 5 will plug this
   * automatically; tests call it explicitly).
   */
  setStreamingService(svc: AndroidStreamingService): void {
    this._streaming = svc;
  }

  async listDevices(): Promise<Device[]> {
    try {
      const deviceList = await this.client.getDevices();
      const devices: Device[] = [];

      for (const device of deviceList) {
        let adb: Adb | undefined;
        try {
          // Use createTransport + new Adb()
          // See: https://tangoadb.dev/tango/server/transport/
          const transport = await this.client.createTransport(device);
          adb = new Adb(transport);
          const props = await this.getDeviceProperties(adb);

          const [width, height] = this.parseResolution(props.resolution);

          const deviceInfo: Device = {
            serial: device.serial,
            platform: 'android',
            model: props.model || 'Unknown',
            osVersion: props.androidVersion || 'Unknown',
            screenWidth: width,
            screenHeight: height,
            battery: props.battery || 100,
            connected: this.isConnected(device.serial),
          };
          this.deviceInfoCache.set(device.serial, deviceInfo);
          devices.push(deviceInfo);
        } catch (error) {
          console.error(`Failed to get properties for device ${device.serial}:`, error);
          devices.push({
            serial: device.serial,
            platform: 'android',
            model: 'Unknown',
            osVersion: 'Unknown',
            screenWidth: 1080,
            screenHeight: 1920,
            battery: 100,
            connected: false,
          });
        } finally {
          if (adb) await adb.close().catch(() => {});
        }
      }

      return devices;
    } catch (error) {
      console.error('Failed to list Android devices:', error);
      throw error;
    }
  }

  async connect(serial: string): Promise<void> {
    try {
      await this.getAdbDevice(serial);
      this.markConnected(serial);
      console.log(`Android device ${serial} connected via TangoADB`);
    } catch (error) {
      console.error(`Failed to connect Android device ${serial}:`, error);
      throw new Error(`Failed to connect device: ${error}`);
    }
  }

  async disconnect(serial: string): Promise<void> {
    if (this.devices.has(serial)) {
      const adb = this.devices.get(serial)!;
      await adb.close();
      this.devices.delete(serial);
      this.markDisconnected(serial);
      console.log(`Android device ${serial} disconnected`);
    }
  }

  async tap(serial: string, x: number, y: number): Promise<void> {
    this.assertConnected(serial);
    // Phase 33: if the streaming service has an active gRPC session for this
    // serial, route the tap through the emulator's gRPC sendTouch path
    // (kittyfarm AndroidEmulatorTouchTranslator semantics) and skip ADB.
    if (this._streaming) {
      const routed = await this._streaming.routeTap(serial, x, y);
      if (routed) return;
    }
    try {
      const adb = await this.getAdbDevice(serial);
      await this.runShellCommand(adb, `input tap ${x} ${y}`);
      console.log(`Tapped at (${x}, ${y}) on Android device ${serial}`);
    } catch (error) {
      console.error(`Failed to tap on Android device ${serial}:`, error);
      throw new Error(`Failed to tap: ${error}`);
    }
  }

  async typeText(serial: string, text: string): Promise<void> {
    this.assertConnected(serial);
    try {
      const adb = await this.getAdbDevice(serial);
      const shellEscape = (s: string) => "'" + s.replace(/'/g, "'\\''") + "'";
      const escapedText = text.replace(/ /g, '%s');
      await this.runShellCommand(adb, `input text ${shellEscape(escapedText)}`);
      console.log(`Input text "${text}" on Android device ${serial}`);
    } catch (error) {
      console.error(`Failed to input text on Android device ${serial}:`, error);
      throw new Error(`Failed to input text: ${error}`);
    }
  }

  async pressKey(serial: string, key: string): Promise<void> {
    this.assertConnected(serial);
    // Phase 33: if there's an active gRPC session, route the key event
    // through the daemon's sendKey path. Numeric AKEYCODE_* values map by
    // name->code via NAMED_KEY_CODES; unknown names fall through to ADB so
    // operators retain access to the full AKEYCODE_* enum via the ADB path.
    if (this._streaming) {
      const code = NAMED_KEY_CODES[key];
      if (typeof code === 'number') {
        const routed = await this._streaming.routeKey(serial, code);
        if (routed) return;
      }
    }
    try {
      const adb = await this.getAdbDevice(serial);
      const keyCodes: Record<string, string> = {
        back: 'KEYCODE_BACK',
        home: 'KEYCODE_HOME',
        menu: 'KEYCODE_MENU',
        enter: 'KEYCODE_ENTER',
      };

      const code = keyCodes[key] || key;
      await this.runShellCommand(adb, `input keyevent ${code}`);
      console.log(`Pressed key ${key} on Android device ${serial}`);
    } catch (error) {
      console.error(`Failed to press key on Android device ${serial}:`, error);
      throw new Error(`Failed to press key: ${error}`);
    }
  }

  async screenshot(serial: string): Promise<Buffer> {
    this.assertConnected(serial);
    try {
      const adb = await this.getAdbDevice(serial);
      const output = await this.runShellCommandBinary(adb, 'screencap -p');
      console.log(`Screenshot captured from Android device ${serial}`);
      return Buffer.from(output);
    } catch (error) {
      console.error(`Failed to capture screenshot from Android device ${serial}:`, error);
      throw new Error(`Failed to capture screenshot: ${error}`);
    }
  }

  async startMirroring(serial: string): Promise<VideoStreamMetadata> {
    this.assertConnected(serial);
    // Use cached device info to avoid full listDevices call
    let device = this.deviceInfoCache.get(serial);
    if (!device) {
      const devices = await this.listDevices();
      device = devices.find(d => d.serial === serial);
    }
    if (!device) {
      throw new Error(`Device ${serial} not found`);
    }

    return {
      codec: 'h264',
      width: device.screenWidth,
      height: device.screenHeight,
      frameRate: 60,
    };
  }

  async stopMirroring(serial: string): Promise<void> {
    // Scrcpy mirroring is handled by ScrcpyService
    console.log(`Stop mirroring requested for Android device ${serial}`);
  }

  // Android-specific helper methods

  private async getAdbDevice(serial: string): Promise<Adb> {
    if (this.devices.has(serial)) {
      return this.devices.get(serial)!;
    }

    // Coalesce concurrent connection requests for the same device
    if (this.pendingConnections.has(serial)) {
      return this.pendingConnections.get(serial)!;
    }

    const p = this._createAdbConnection(serial).finally(() => {
      this.pendingConnections.delete(serial);
    });
    this.pendingConnections.set(serial, p);
    return p;
  }

  private async _createAdbConnection(serial: string): Promise<Adb> {
    const deviceList = await this.client.getDevices();
    const device = deviceList.find(d => d.serial === serial);
    if (!device) {
      throw new Error(`Device ${serial} not found`);
    }

    // Use createTransport + new Adb()
    // See: https://tangoadb.dev/tango/server/transport/
    const transport = await this.client.createTransport(device);
    const adb = new Adb(transport);
    this.devices.set(serial, adb);
    return adb;
  }

  /**
   * Run a shell command and return text output
   * Uses spawnWaitText for simplicity
   * See: https://tangoadb.dev/api/adb/subprocess/none-protocol/
   */
  private async runShellCommand(adb: Adb, command: string): Promise<string> {
    const output = await adb.subprocess.noneProtocol.spawnWaitText(command);
    return output;
  }

  /**
   * Run a shell command and return binary output
   * Uses spawnWait for binary data
   */
  private async runShellCommandBinary(adb: Adb, command: string): Promise<Uint8Array> {
    const output = await adb.subprocess.noneProtocol.spawnWait(command);
    return output;
  }

  private async getDeviceProperties(adb: Adb): Promise<{
    model: string;
    androidVersion: string;
    resolution: string;
    battery: number;
  }> {
    const [model, androidVersion, resolution, battery] = await Promise.all([
      this.getProperty(adb, 'ro.product.model'),
      this.getProperty(adb, 'ro.build.version.release'),
      this.getDisplaySize(adb),
      this.getBatteryLevel(adb),
    ]);

    return { model, androidVersion, resolution, battery };
  }

  private async getProperty(adb: Adb, property: string): Promise<string> {
    try {
      const output = await this.runShellCommand(adb, `getprop ${property}`);
      return output.trim() || 'Unknown';
    } catch (error) {
      console.error(`Failed to get property ${property}:`, error);
      return 'Unknown';
    }
  }

  private async getDisplaySize(adb: Adb): Promise<string> {
    try {
      const output = await this.runShellCommand(adb, 'wm size');
      const match = output.match(/Physical size: (\d+x\d+)/);
      return match ? match[1] : '1080x1920';
    } catch (error) {
      console.error('Failed to get display size:', error);
      return '1080x1920';
    }
  }

  private async getBatteryLevel(adb: Adb): Promise<number> {
    try {
      const output = await this.runShellCommand(adb, 'dumpsys battery');
      const match = output.match(/level: (\d+)/);
      return match ? parseInt(match[1], 10) : 100;
    } catch (error) {
      console.error('Failed to get battery level:', error);
      return 100;
    }
  }

  private parseResolution(resolution: string): [number, number] {
    const match = resolution.match(/(\d+)x(\d+)/);
    if (match) {
      return [parseInt(match[1], 10), parseInt(match[2], 10)];
    }
    return [1080, 1920];
  }

  // Public method for backward compatibility
  getClient(): AdbServerClient {
    return this.client;
  }

  // Public method for backward compatibility with existing scrcpy-service
  async getDevice(serial: string): Promise<Adb> {
    return this.getAdbDevice(serial);
  }

  // Explorer Methods

  async captureUIHierarchy(serial: string): Promise<string> {
    this.assertConnected(serial);
    const adb = await this.getAdbDevice(serial);
    try {
      await this.runShellCommand(adb, 'uiautomator dump /sdcard/ui_dump.xml');

      const xmlContent = await this.runShellCommand(adb, 'cat /sdcard/ui_dump.xml');

      if (!xmlContent || xmlContent.includes('ERROR')) {
        throw new Error('Failed to capture UI hierarchy');
      }

      console.log(`Captured UI hierarchy from Android device ${serial}`);
      return xmlContent.trim();
    } catch (error) {
      console.error(`Failed to capture UI hierarchy from ${serial}:`, error);
      throw new Error(`Failed to capture UI hierarchy: ${error}`);
    } finally {
      await this.runShellCommand(adb, 'rm /sdcard/ui_dump.xml').catch(() => {});
    }
  }

  async getCurrentActivity(serial: string): Promise<string> {
    this.assertConnected(serial);
    try {
      const adb = await this.getAdbDevice(serial);

      const output = await this.runShellCommand(adb, 'dumpsys window | grep mCurrentFocus');

      const match = output.match(/mCurrentFocus=Window\{[^\s]+ [^\s]+ ([^\s}]+)\}/);
      if (match && match[1]) {
        return match[1];
      }

      const output2 = await this.runShellCommand(adb, 'dumpsys window | grep mFocusedApp');
      const match2 = output2.match(/mFocusedApp=.*ActivityRecord\{[^}]+ ([^\s}]+)/);
      if (match2 && match2[1]) {
        return match2[1];
      }

      return 'unknown/unknown';
    } catch (error) {
      console.error(`Failed to get current activity from ${serial}:`, error);
      return 'unknown/unknown';
    }
  }

  async getCurrentApp(serial: string): Promise<string> {
    try {
      const activity = await this.getCurrentActivity(serial);
      const packageName = activity.split('/')[0];
      return packageName || 'unknown';
    } catch {
      return 'unknown';
    }
  }

  async launchApp(serial: string, packageId: string): Promise<void> {
    this.assertConnected(serial);
    try {
      const adb = await this.getAdbDevice(serial);

      await this.runShellCommand(adb, `monkey -p ${packageId} -c android.intent.category.LAUNCHER 1`);

      await new Promise(resolve => setTimeout(resolve, 1000));

      console.log(`Launched app ${packageId} on Android device ${serial}`);
    } catch (error) {
      console.error(`Failed to launch app ${packageId} on ${serial}:`, error);
      throw new Error(`Failed to launch app: ${error}`);
    }
  }

  async forceStopApp(serial: string, packageId: string): Promise<void> {
    this.assertConnected(serial);
    try {
      const adb = await this.getAdbDevice(serial);
      await this.runShellCommand(adb, `am force-stop ${packageId}`);
      console.log(`Force stopped app ${packageId} on Android device ${serial}`);
    } catch (error) {
      console.error(`Failed to force stop app ${packageId} on ${serial}:`, error);
      throw new Error(`Failed to force stop app: ${error}`);
    }
  }

  async clearAppData(serial: string, packageId: string): Promise<void> {
    this.assertConnected(serial);
    try {
      const adb = await this.getAdbDevice(serial);
      await this.runShellCommand(adb, `pm clear ${packageId}`);
      console.log(`Cleared app data for ${packageId} on Android device ${serial}`);
    } catch (error) {
      console.error(`Failed to clear app data for ${packageId} on ${serial}:`, error);
      throw new Error(`Failed to clear app data: ${error}`);
    }
  }

  async swipe(
    serial: string,
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    duration: number = 300
  ): Promise<void> {
    this.assertConnected(serial);
    try {
      const adb = await this.getAdbDevice(serial);
      await this.runShellCommand(adb, `input swipe ${startX} ${startY} ${endX} ${endY} ${duration}`);
      console.log(`Swiped from (${startX}, ${startY}) to (${endX}, ${endY}) on Android device ${serial}`);
    } catch (error) {
      console.error(`Failed to swipe on Android device ${serial}:`, error);
      throw new Error(`Failed to swipe: ${error}`);
    }
  }

  async longPress(serial: string, x: number, y: number, duration: number = 1000): Promise<void> {
    this.assertConnected(serial);
    try {
      const adb = await this.getAdbDevice(serial);
      await this.runShellCommand(adb, `input swipe ${x} ${y} ${x} ${y} ${duration}`);
      console.log(`Long pressed at (${x}, ${y}) on Android device ${serial}`);
    } catch (error) {
      console.error(`Failed to long press on Android device ${serial}:`, error);
      throw new Error(`Failed to long press: ${error}`);
    }
  }

  async listPackages(serial: string): Promise<string[]> {
    this.assertConnected(serial);
    try {
      const adb = await this.getAdbDevice(serial);
      const output = await this.runShellCommand(adb, 'pm list packages -3');

      const packages = output
        .split('\n')
        .filter((line: string) => line.startsWith('package:'))
        .map((line: string) => line.replace('package:', '').trim());

      return packages;
    } catch (error) {
      console.error(`Failed to list packages on ${serial}:`, error);
      return [];
    }
  }
}

// Export singleton instance
export const androidDeviceService = new AndroidDeviceService();

// Export legacy alias for backward compatibility
export const tangoAdbService = androidDeviceService;
