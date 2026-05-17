/**
 * DeviceInfoCollector — queries real device metadata via adb (Android) and xcrun simctl (iOS).
 * Returns rich device info: OS version, screen size, RAM, ABI, etc.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type pino from 'pino';
import type { Platform } from '../../types/index.js';

const execFileAsync = promisify(execFile);
const CMD_TIMEOUT = 10_000;

export interface DeviceMetadata {
  osVersion: string | null;
  sdkVersion: string | null;
  screenWidth: number | null;
  screenHeight: number | null;
  screenDensity: number | null;
  ramMb: number | null;
  abi: string | null;
  manufacturer: string | null;
  model: string | null;
  locale: string | null;
  timezone: string | null;
  batteryLevel: number | null;
  collectedAt: string;
}

/**
 * Safely run an adb shell getprop command; returns null on any error.
 */
async function adbProp(serial: string, prop: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      'adb', ['-s', serial, 'shell', 'getprop', prop],
      { timeout: CMD_TIMEOUT },
    );
    const val = stdout.trim();
    return val.length > 0 ? val : null;
  } catch {
    return null;
  }
}

/**
 * Run an adb shell command; returns stdout or null on error.
 */
async function adbShell(serial: string, cmd: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      'adb', ['-s', serial, 'shell', cmd],
      { timeout: CMD_TIMEOUT },
    );
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Parse "Physical size: 1080x1920" or "Override size: 1080x1920"
 */
function parseScreenSize(wmOutput: string | null): { width: number; height: number } | null {
  if (!wmOutput) return null;
  // Prefer override, fall back to physical
  const overrideMatch = wmOutput.match(/Override size:\s*(\d+)x(\d+)/);
  if (overrideMatch) {
    return { width: parseInt(overrideMatch[1], 10), height: parseInt(overrideMatch[2], 10) };
  }
  const physicalMatch = wmOutput.match(/Physical size:\s*(\d+)x(\d+)/);
  if (physicalMatch) {
    return { width: parseInt(physicalMatch[1], 10), height: parseInt(physicalMatch[2], 10) };
  }
  return null;
}

/**
 * Parse "Physical density: 420" or "Override density: 420"
 */
function parseDensity(wmOutput: string | null): number | null {
  if (!wmOutput) return null;
  const overrideMatch = wmOutput.match(/Override density:\s*(\d+)/);
  if (overrideMatch) return parseInt(overrideMatch[1], 10);
  const physicalMatch = wmOutput.match(/Physical density:\s*(\d+)/);
  if (physicalMatch) return parseInt(physicalMatch[1], 10);
  return null;
}

/**
 * Parse MemTotal from /proc/meminfo (e.g. "MemTotal:        2048000 kB")
 */
function parseMemTotal(meminfoLine: string | null): number | null {
  if (!meminfoLine) return null;
  const match = meminfoLine.match(/MemTotal:\s+(\d+)\s+kB/);
  if (match) return Math.round(parseInt(match[1], 10) / 1024);
  return null;
}

export class DeviceInfoCollector {
  private readonly logger: pino.Logger;

  constructor(logger: pino.Logger) {
    this.logger = logger.child({ component: 'device-info-collector' });
  }

  /**
   * Collect rich metadata for a device.
   * Android: queries via adb shell getprop + wm commands.
   * iOS: queries via xcrun simctl list -j.
   */
  async collect(platform: Platform, emulatorId: string, port: number | null): Promise<DeviceMetadata> {
    if (platform === 'android') {
      return this.collectAndroid(emulatorId, port);
    }
    return this.collectIos(emulatorId);
  }

  private async collectAndroid(emulatorId: string, port: number | null): Promise<DeviceMetadata> {
    const serial = port != null ? `emulator-${port}` : emulatorId;

    // Fire all queries in parallel
    const [
      osVersion,
      sdkVersion,
      wmSize,
      wmDensity,
      meminfo,
      abi,
      manufacturer,
      model,
      locale,
      timezone,
      batteryRaw,
    ] = await Promise.all([
      adbProp(serial, 'ro.build.version.release'),
      adbProp(serial, 'ro.build.version.sdk'),
      adbShell(serial, 'wm size'),
      adbShell(serial, 'wm density'),
      adbShell(serial, 'cat /proc/meminfo | head -1'),
      adbProp(serial, 'ro.product.cpu.abi'),
      adbProp(serial, 'ro.product.manufacturer'),
      adbProp(serial, 'ro.product.model'),
      adbProp(serial, 'persist.sys.locale'),
      adbProp(serial, 'persist.sys.timezone'),
      adbShell(serial, 'dumpsys battery | grep level'),
    ]);

    const screen = parseScreenSize(wmSize);
    const density = parseDensity(wmDensity);
    const ramMb = parseMemTotal(meminfo);

    // Parse battery level from "  level: 100"
    let batteryLevel: number | null = null;
    if (batteryRaw) {
      const match = batteryRaw.match(/level:\s*(\d+)/);
      if (match) batteryLevel = parseInt(match[1], 10);
    }

    const metadata: DeviceMetadata = {
      osVersion: osVersion ? `Android ${osVersion}` : null,
      sdkVersion,
      screenWidth: screen?.width ?? null,
      screenHeight: screen?.height ?? null,
      screenDensity: density,
      ramMb,
      abi,
      manufacturer,
      model,
      locale,
      timezone,
      batteryLevel,
      collectedAt: new Date().toISOString(),
    };

    this.logger.info({ serial, osVersion: metadata.osVersion, model }, 'Android device info collected');
    return metadata;
  }

  private async collectIos(udid: string): Promise<DeviceMetadata> {
    try {
      // Phase 36 / Plan 36-01 — query a single UDID instead of listing all
      // devices. Keeps this collector outside the discovery sole-caller
      // invariant (only adapters under server/pool/internal/discovery/adapters/
      // may list all devices).
      const { stdout } = await execFileAsync('xcrun', ['simctl', 'list', 'devices', udid, '-j'], {
        timeout: CMD_TIMEOUT,
      });
      const data = JSON.parse(stdout);
      const allDevices: Record<string, Array<{
        udid: string;
        name: string;
        state: string;
        deviceTypeIdentifier?: string;
      }>> = data.devices;

      let foundRuntime: string | null = null;
      let foundDevice: { name: string; deviceTypeIdentifier?: string } | null = null;

      for (const [runtime, devices] of Object.entries(allDevices)) {
        for (const device of devices) {
          if (device.udid === udid) {
            // Runtime looks like "com.apple.CoreSimulator.SimRuntime.iOS-17-5"
            foundRuntime = runtime;
            foundDevice = device;
            break;
          }
        }
        if (foundDevice) break;
      }

      // Parse iOS version from runtime string
      let osVersion: string | null = null;
      if (foundRuntime) {
        const match = foundRuntime.match(/iOS-(\d+)-(\d+)/);
        if (match) osVersion = `iOS ${match[1]}.${match[2]}`;
      }

      // Get device type info for screen dimensions
      let screenWidth: number | null = null;
      let screenHeight: number | null = null;
      let model: string | null = foundDevice?.name ?? null;

      if (foundDevice?.deviceTypeIdentifier) {
        try {
          const { stdout: dtStdout } = await execFileAsync(
            'xcrun', ['simctl', 'list', 'devicetypes', '-j'],
            { timeout: CMD_TIMEOUT },
          );
          const dtData = JSON.parse(dtStdout);
          const deviceTypes: Array<{
            identifier: string;
            name: string;
            minRuntimeVersion?: number;
            maxRuntimeVersion?: number;
          }> = dtData.devicetypes ?? [];

          const dt = deviceTypes.find(d => d.identifier === foundDevice!.deviceTypeIdentifier);
          if (dt) model = dt.name;
        } catch {
          // Non-critical
        }
      }

      // Screen resolution from device type mapping (common values)
      const screenMap: Record<string, { w: number; h: number }> = {
        'iPhone 15': { w: 1179, h: 2556 },
        'iPhone 15 Pro': { w: 1179, h: 2556 },
        'iPhone 15 Pro Max': { w: 1290, h: 2796 },
        'iPhone 16': { w: 1179, h: 2556 },
        'iPhone 16 Pro': { w: 1206, h: 2622 },
        'iPhone 16 Pro Max': { w: 1320, h: 2868 },
        'iPhone SE (3rd generation)': { w: 750, h: 1334 },
        'iPad Pro (12.9-inch)': { w: 2048, h: 2732 },
        'iPad Air': { w: 1640, h: 2360 },
      };

      if (model) {
        const screenInfo = screenMap[model];
        if (screenInfo) {
          screenWidth = screenInfo.w;
          screenHeight = screenInfo.h;
        }
      }

      const metadata: DeviceMetadata = {
        osVersion,
        sdkVersion: null,
        screenWidth,
        screenHeight,
        screenDensity: null,
        ramMb: null, // Not easily queryable from simctl
        abi: 'arm64', // Apple Silicon simulators are always arm64
        manufacturer: 'Apple',
        model,
        locale: null,
        timezone: null,
        batteryLevel: null, // Simulators don't have battery
        collectedAt: new Date().toISOString(),
      };

      this.logger.info({ udid, osVersion: metadata.osVersion, model }, 'iOS simulator info collected');
      return metadata;
    } catch (err: any) {
      this.logger.error({ udid, error: err.message }, 'Failed to collect iOS device info');
      return this.emptyMetadata();
    }
  }

  private emptyMetadata(): DeviceMetadata {
    return {
      osVersion: null,
      sdkVersion: null,
      screenWidth: null,
      screenHeight: null,
      screenDensity: null,
      ramMb: null,
      abi: null,
      manufacturer: null,
      model: null,
      locale: null,
      timezone: null,
      batteryLevel: null,
      collectedAt: new Date().toISOString(),
    };
  }
}
