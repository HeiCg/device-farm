/**
 * Device-stream Android driver implementing DeviceDriver interface.
 * HYBRID: Retains emulator process spawning + AVD management from AndroidEmulatorDriver,
 * replaces health checks with AndroidDeviceService (TangoADB).
 */
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import * as net from 'node:net';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type pino from 'pino';
import { AndroidDeviceService } from '@device-stream/android';
import type { DeviceDriver, DeviceConfig, AndroidDeviceConfig, BootOptions, BootResult } from '../types.js';
import { ensureAvdExists, listAvds, deleteAvd } from './avd.js';
import { getZombieInfo, isProcessAlive, getProcessStat, isZombieStat } from '../zombie-detector.js';

const execFileAsync = promisify(execFile);

/** Port allocator: finds the lowest available even port starting at 5554 */
function allocatePort(usedPorts: Set<number>): number {
  let port = 5554;
  while (usedPorts.has(port)) {
    port += 2;
  }
  return port;
}

/**
 * Get the ADB serial for a given console port (e.g., emulator-5554).
 */
function adbSerial(consolePort: number): string {
  return `emulator-${consolePort}`;
}

export class DeviceStreamAndroidDriver implements DeviceDriver {
  /** Tracks PID per AVD name */
  private processes = new Map<string, { pid: number; port: number; process?: ChildProcess }>();
  /** Ports held by zombie processes -- persists for server lifetime */
  private blacklistedPorts = new Set<number>();
  /** AVD names held by zombie processes -- persists for server lifetime */
  private blacklistedAvds = new Set<string>();

  private readonly config: AndroidDeviceConfig;
  private readonly logger: pino.Logger;
  private readonly deviceService: AndroidDeviceService;

  constructor(config: AndroidDeviceConfig, logger: pino.Logger) {
    this.config = config;
    this.logger = logger.child({ component: 'android-device-stream' });
    this.deviceService = new AndroidDeviceService();
  }

  async create(name: string, config: DeviceConfig): Promise<string> {
    const androidConfig = config as AndroidDeviceConfig;
    await ensureAvdExists(name, androidConfig);
    return name;
  }

  async boot(emulatorId: string, options?: BootOptions): Promise<BootResult> {
    const timeout = options?.timeout ?? 120_000;

    // 1. Scan for zombie processes
    const zombieInfo = await getZombieInfo();

    // 2. Build exclusion set: zombie ports + blacklisted ports + in-use ports
    const exclusionPorts = new Set<number>([
      ...zombieInfo.ports,
      ...this.blacklistedPorts,
      ...Array.from(this.processes.values()).map(p => p.port),
    ]);

    const port = allocatePort(exclusionPorts);

    // Merge zombie AVDs into blacklist
    for (const avd of zombieInfo.avdNames) this.blacklistedAvds.add(avd);
    for (const p of zombieInfo.ports) this.blacklistedPorts.add(p);

    // 3. Determine effective AVD name -- create replacement if zombie holds this one
    let effectiveAvd = emulatorId;
    if (this.blacklistedAvds.has(emulatorId) || zombieInfo.avdNames.has(emulatorId)) {
      effectiveAvd = `${emulatorId}-r${Date.now()}`;
      this.logger.warn(
        { originalAvd: emulatorId, replacementAvd: effectiveAvd },
        'AVD held by zombie, creating replacement',
      );
      await ensureAvdExists(effectiveAvd, this.config);
    } else {
      // Clear stale lock files for non-zombie AVDs
      this.clearAvdLocks(emulatorId);
    }

    // 4. Spawn emulator
    const proc = spawn(
      'emulator',
      [
        '-avd', effectiveAvd,
        '-no-window', '-no-audio', '-no-boot-anim',
        '-gpu', 'swiftshader_indirect',
        '-port', String(port),
      ],
      {
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    proc.unref();

    this.processes.set(emulatorId, {
      pid: proc.pid!,
      port,
      process: proc,
    });

    // 5. Wait for device to be ready
    const serial = adbSerial(port);
    await this.waitForBoot(serial, timeout);

    return { port, pid: proc.pid! };
  }

  async shutdown(emulatorId: string): Promise<void> {
    const info = this.processes.get(emulatorId);
    if (!info) return;

    // Disconnect device-stream first (non-fatal)
    const serial = adbSerial(info.port);
    try {
      await this.deviceService.disconnect(serial);
    } catch {
      // Non-fatal -- device may not be connected via device-stream
    }

    // SIGTERM -> 2s -> SIGKILL
    try {
      process.kill(-info.pid, 'SIGTERM');
    } catch (err: any) {
      if (err.code !== 'ESRCH') throw err;
    }

    await new Promise((resolve) => setTimeout(resolve, 2000));
    try {
      process.kill(-info.pid, 'SIGKILL');
    } catch {
      // Already dead, ignore
    }

    // Verify death (3s polling)
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      if (!isProcessAlive(info.pid)) {
        this.processes.delete(emulatorId);
        return;
      }
      await new Promise((r) => setTimeout(r, 500));
    }

    // Still alive -- check if zombie
    const stat = await getProcessStat(info.pid);
    if (stat && isZombieStat(stat)) {
      this.blacklistedPorts.add(info.port);
      this.blacklistedAvds.add(emulatorId);
      this.logger.warn(
        { pid: info.pid, port: info.port, avd: emulatorId, stat },
        'Zombie qemu detected during shutdown -- blacklisted port and AVD',
      );
      this.processes.delete(emulatorId);
      return;
    }

    // Non-zombie but still alive -- unusual, but clean up tracking
    this.processes.delete(emulatorId);
  }

  async isHealthy(emulatorId: string, port?: number): Promise<boolean> {
    const info = this.processes.get(emulatorId);
    const effectivePort = port ?? info?.port ?? 5554;
    const serial = adbSerial(effectivePort);

    try {
      const devices = await this.deviceService.listDevices();
      const device = devices.find(d => d.serial === serial);
      return device?.connected === true;
    } catch {
      return false;
    }
  }

  async cleanup(emulatorId: string): Promise<void> {
    const info = this.processes.get(emulatorId);
    if (!info) return;

    try {
      await this.snapshotRestore(info.port);
    } catch {
      await this.shutdown(emulatorId);
      const usedPorts = new Set(Array.from(this.processes.values()).map(p => p.port));
      const port = allocatePort(usedPorts);
      this.processes.set(emulatorId, { ...info, port });
    }
  }

  /**
   * Clean up replacement AVDs (matching `-r<timestamp>` suffix).
   * Called once during server startup after reboot clears zombies.
   */
  async cleanupReplacementAvds(): Promise<void> {
    try {
      const avds = await listAvds();
      for (const avd of avds) {
        if (/-r\d+$/.test(avd)) {
          this.logger.info({ avd }, 'Deleting replacement AVD');
          try {
            await deleteAvd(avd);
          } catch (err: any) {
            this.logger.warn({ avd, error: err.message }, 'Failed to delete replacement AVD');
          }
        }
      }
    } catch (err: any) {
      this.logger.warn({ error: err.message }, 'Failed to list AVDs for cleanup');
    }
  }

  /**
   * Clear stale AVD lock files (from normal crashes, not zombies).
   */
  private clearAvdLocks(avdName: string): void {
    const avdDir = path.join(os.homedir(), '.android', 'avd', `${avdName}.avd`);
    try {
      const files = fs.readdirSync(avdDir);
      for (const file of files) {
        if (file.endsWith('.lock')) {
          fs.unlinkSync(path.join(avdDir, file));
          this.logger.debug({ avd: avdName, lockFile: file }, 'Cleared stale lock file');
        }
      }
    } catch {
      // AVD dir may not exist yet -- that's fine
    }
  }

  /**
   * Wait for boot by polling sys.boot_completed via ADB.
   */
  private async waitForBoot(serial: string, timeoutMs: number): Promise<void> {
    const start = Date.now();

    await execFileAsync('adb', ['-s', serial, 'wait-for-device'], {
      timeout: timeoutMs,
    });

    while (Date.now() - start < timeoutMs) {
      try {
        const { stdout } = await execFileAsync('adb', [
          '-s', serial, 'shell', 'getprop', 'sys.boot_completed',
        ], { timeout: 10_000 });
        if (stdout.trim() === '1') return;
      } catch {
        // ADB not ready yet, retry
      }
      await new Promise((r) => setTimeout(r, 2000));
    }

    throw new Error(`Emulator ${serial} boot timed out after ${timeoutMs}ms`);
  }

  /**
   * Restore clean snapshot via emulator console (telnet).
   */
  private async snapshotRestore(consolePort: number): Promise<void> {
    const authTokenPath = path.join(os.homedir(), '.emulator_console_auth_token');
    let authToken = '';
    try {
      authToken = fs.readFileSync(authTokenPath, 'utf-8').trim();
    } catch {
      // No auth token file -- some emulator versions don't require it
    }

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        socket.destroy();
        reject(new Error('Snapshot restore timed out'));
      }, 10_000);

      const socket = net.connect(consolePort, 'localhost', () => {
        if (authToken) {
          socket.write(`auth ${authToken}\n`);
        }
        socket.write('avd snapshot load clean_snapshot\n');
        socket.write('quit\n');
      });

      socket.on('data', (data) => {
        const response = data.toString();
        if (response.includes('OK')) {
          clearTimeout(timeout);
          socket.end();
          resolve();
        }
      });

      socket.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });

      socket.on('close', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }
}
