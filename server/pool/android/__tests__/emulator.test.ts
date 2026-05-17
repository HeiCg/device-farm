import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AndroidEmulatorDriver } from '../emulator.js';
import type { AndroidDeviceConfig } from '../../types.js';
import pino from 'pino';

// Mock child_process
vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
  spawn: vi.fn(),
}));

vi.mock('node:util', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:util')>();
  return {
    ...actual,
    promisify: vi.fn((fn: any) => {
      // Return a mock async version that delegates to the mock
      return (...args: any[]) => {
        return new Promise((resolve, reject) => {
          fn(...args, (err: Error | null, result: any) => {
            if (err) reject(err);
            else resolve(result);
          });
        });
      };
    }),
  };
});

vi.mock('../../zombie-detector.js', () => ({
  getZombieInfo: vi.fn().mockResolvedValue({ ports: new Set(), avdNames: new Set() }),
  isProcessAlive: vi.fn().mockReturnValue(false),
  getProcessStat: vi.fn().mockResolvedValue(null),
  isZombieStat: vi.fn().mockReturnValue(false),
}));

// Import mocked modules
import { execFile, spawn } from 'node:child_process';
import { getZombieInfo } from '../../zombie-detector.js';

const mockExecFile = vi.mocked(execFile);
const mockSpawn = vi.mocked(spawn);
const mockGetZombieInfo = vi.mocked(getZombieInfo);

const logger = pino({ level: 'silent' });

const defaultConfig: AndroidDeviceConfig = {
  enabled: true,
  max_instances: 5,
  headless: true,
  api_level: '34',
  system_image_variant: 'google_apis',
  device_profile: 'pixel_7',
  ram_mb: 2048,
};

describe('AndroidEmulatorDriver', () => {
  let driver: AndroidEmulatorDriver;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetZombieInfo.mockResolvedValue({ ports: new Set(), avdNames: new Set() });
    driver = new AndroidEmulatorDriver(defaultConfig, logger);
  });

  describe('create()', () => {
    it('calls avdmanager to create AVD with correct ARM64 flags', async () => {
      // First call: emulator -list-avds (AVD doesn't exist)
      // Second call: avdmanager create avd
      mockExecFile.mockImplementation(((cmd: string, args: string[], opts: any, cb: Function) => {
        if (typeof opts === 'function') {
          cb = opts;
          opts = {};
        }
        if (cmd === 'emulator' && args[0] === '-list-avds') {
          cb(null, { stdout: '', stderr: '' });
        } else if (cmd === 'avdmanager') {
          cb(null, { stdout: 'Created AVD', stderr: '' });
        } else {
          cb(null, { stdout: '', stderr: '' });
        }
      }) as any);

      const emulatorId = await driver.create('test-avd', defaultConfig);

      expect(emulatorId).toBe('test-avd');
      // Verify avdmanager was called with ARM64 system image
      const avdCall = mockExecFile.mock.calls.find(
        (c) => c[0] === 'avdmanager'
      );
      expect(avdCall).toBeDefined();
      const avdArgs = avdCall![1] as string[];
      expect(avdArgs).toContain('create');
      expect(avdArgs).toContain('avd');
      expect(avdArgs).toContain('-n');
      expect(avdArgs).toContain('test-avd');
      expect(avdArgs.join(' ')).toContain('arm64-v8a');
    });

    it('skips creation if AVD already exists', async () => {
      mockExecFile.mockImplementation(((cmd: string, args: string[], opts: any, cb: Function) => {
        if (typeof opts === 'function') {
          cb = opts;
          opts = {};
        }
        if (cmd === 'emulator' && args[0] === '-list-avds') {
          cb(null, { stdout: 'test-avd\n', stderr: '' });
        } else {
          cb(null, { stdout: '', stderr: '' });
        }
      }) as any);

      const emulatorId = await driver.create('test-avd', defaultConfig);

      expect(emulatorId).toBe('test-avd');
      const avdCall = mockExecFile.mock.calls.find(
        (c) => c[0] === 'avdmanager'
      );
      expect(avdCall).toBeUndefined();
    });
  });

  describe('boot()', () => {
    it('spawns emulator with correct headless flags and returns { port, pid }', async () => {
      const mockProcess = {
        pid: 12345,
        on: vi.fn(),
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        unref: vi.fn(),
      };
      mockSpawn.mockReturnValue(mockProcess as any);

      // Mock adb calls for boot detection
      let callCount = 0;
      mockExecFile.mockImplementation(((cmd: string, args: string[], opts: any, cb: Function) => {
        if (typeof opts === 'function') {
          cb = opts;
          opts = {};
        }
        if (cmd === 'adb' && args.includes('wait-for-device')) {
          cb(null, { stdout: '', stderr: '' });
        } else if (cmd === 'adb' && args.includes('getprop')) {
          callCount++;
          // Return "1" (with carriage return to test trimming) on second poll
          if (callCount >= 2) {
            cb(null, { stdout: '1\r\n', stderr: '' });
          } else {
            cb(null, { stdout: '\r\n', stderr: '' });
          }
        } else {
          cb(null, { stdout: '', stderr: '' });
        }
      }) as any);

      const result = await driver.boot('test-avd');

      expect(result).toEqual({ port: 5554, pid: 12345 });

      // Check spawn was called with correct flags
      expect(mockSpawn).toHaveBeenCalledWith(
        'emulator',
        expect.arrayContaining([
          '-avd', 'test-avd',
          '-no-window', '-no-audio', '-no-boot-anim',
          '-gpu', 'swiftshader_indirect',
        ]),
        expect.objectContaining({ detached: true }),
      );
    });

    it('handles ADB carriage return trimming in boot detection', async () => {
      const mockProcess = {
        pid: 12345,
        on: vi.fn(),
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        unref: vi.fn(),
      };
      mockSpawn.mockReturnValue(mockProcess as any);

      mockExecFile.mockImplementation(((cmd: string, args: string[], opts: any, cb: Function) => {
        if (typeof opts === 'function') {
          cb = opts;
          opts = {};
        }
        if (cmd === 'adb' && args.includes('wait-for-device')) {
          cb(null, { stdout: '', stderr: '' });
        } else if (cmd === 'adb' && args.includes('getprop')) {
          // Return "1\r" -- carriage return without newline
          cb(null, { stdout: '1\r', stderr: '' });
        } else {
          cb(null, { stdout: '', stderr: '' });
        }
      }) as any);

      // Should not hang -- proves trimming works
      const result = await driver.boot('test-avd');

      expect(result).toEqual({ port: 5554, pid: 12345 });
      expect(mockSpawn).toHaveBeenCalled();
    });

    it('routes around zombie port', async () => {
      mockGetZombieInfo.mockResolvedValue({ ports: new Set([5554]), avdNames: new Set() });

      const mockProcess = {
        pid: 99999,
        on: vi.fn(),
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        unref: vi.fn(),
      };
      mockSpawn.mockReturnValue(mockProcess as any);

      mockExecFile.mockImplementation(((cmd: string, args: string[], opts: any, cb: Function) => {
        if (typeof opts === 'function') {
          cb = opts;
          opts = {};
        }
        if (cmd === 'adb' && args.includes('wait-for-device')) {
          cb(null, { stdout: '', stderr: '' });
        } else if (cmd === 'adb' && args.includes('getprop')) {
          cb(null, { stdout: '1\r\n', stderr: '' });
        } else {
          cb(null, { stdout: '', stderr: '' });
        }
      }) as any);

      const result = await driver.boot('test-avd');

      expect(result).toEqual({ port: 5556, pid: 99999 });

      // Verify emulator spawned with -port 5556
      const spawnArgs = mockSpawn.mock.calls[0][1] as string[];
      const portIdx = spawnArgs.indexOf('-port');
      expect(spawnArgs[portIdx + 1]).toBe('5556');
    });

    it('creates replacement AVD when zombie holds AVD name', async () => {
      mockGetZombieInfo.mockResolvedValue({ ports: new Set(), avdNames: new Set(['test-avd']) });

      const mockProcess = {
        pid: 88888,
        on: vi.fn(),
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        unref: vi.fn(),
      };
      mockSpawn.mockReturnValue(mockProcess as any);

      mockExecFile.mockImplementation(((cmd: string, args: string[], opts: any, cb: Function) => {
        if (typeof opts === 'function') {
          cb = opts;
          opts = {};
        }
        if (cmd === 'emulator' && args[0] === '-list-avds') {
          cb(null, { stdout: '', stderr: '' });
        } else if (cmd === 'avdmanager') {
          cb(null, { stdout: 'Created AVD', stderr: '' });
        } else if (cmd === 'adb' && args.includes('wait-for-device')) {
          cb(null, { stdout: '', stderr: '' });
        } else if (cmd === 'adb' && args.includes('getprop')) {
          cb(null, { stdout: '1\r\n', stderr: '' });
        } else {
          cb(null, { stdout: '', stderr: '' });
        }
      }) as any);

      await driver.boot('test-avd');

      // Verify spawn used a replacement AVD name matching -r\d+
      const spawnArgs = mockSpawn.mock.calls[0][1] as string[];
      const avdIdx = spawnArgs.indexOf('-avd');
      const avdName = spawnArgs[avdIdx + 1];
      expect(avdName).toMatch(/^test-avd-r\d+$/);
    });
  });

  describe('shutdown()', () => {
    it('kills process group (-pid)', async () => {
      const mockProcess = {
        pid: 12345,
        on: vi.fn(),
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        unref: vi.fn(),
      };
      mockSpawn.mockReturnValue(mockProcess as any);

      // Boot first so driver tracks the PID
      mockExecFile.mockImplementation(((cmd: string, args: string[], opts: any, cb: Function) => {
        if (typeof opts === 'function') {
          cb = opts;
          opts = {};
        }
        if (cmd === 'adb' && args.includes('wait-for-device')) {
          cb(null, { stdout: '', stderr: '' });
        } else if (cmd === 'adb' && args.includes('getprop')) {
          cb(null, { stdout: '1\r\n', stderr: '' });
        } else {
          cb(null, { stdout: '', stderr: '' });
        }
      }) as any);

      await driver.boot('test-avd');

      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);

      await driver.shutdown('test-avd');

      expect(killSpy).toHaveBeenCalledWith(-12345, 'SIGTERM');
      killSpy.mockRestore();
    });

    it('handles ESRCH (already dead process) gracefully', async () => {
      const mockProcess = {
        pid: 12345,
        on: vi.fn(),
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        unref: vi.fn(),
      };
      mockSpawn.mockReturnValue(mockProcess as any);

      mockExecFile.mockImplementation(((cmd: string, args: string[], opts: any, cb: Function) => {
        if (typeof opts === 'function') {
          cb = opts;
          opts = {};
        }
        if (cmd === 'adb' && args.includes('wait-for-device')) {
          cb(null, { stdout: '', stderr: '' });
        } else if (cmd === 'adb' && args.includes('getprop')) {
          cb(null, { stdout: '1\r\n', stderr: '' });
        } else {
          cb(null, { stdout: '', stderr: '' });
        }
      }) as any);

      await driver.boot('test-avd');

      const esrchError = Object.assign(new Error('kill ESRCH'), { code: 'ESRCH' });
      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => {
        throw esrchError;
      });

      // Should not throw
      await driver.shutdown('test-avd');

      killSpy.mockRestore();
    });
  });

  describe('isHealthy()', () => {
    it('returns true when sys.boot_completed is 1 (trimmed)', async () => {
      mockExecFile.mockImplementation(((cmd: string, args: string[], opts: any, cb: Function) => {
        if (typeof opts === 'function') {
          cb = opts;
          opts = {};
        }
        cb(null, { stdout: '1\r\n', stderr: '' });
      }) as any);

      const healthy = await driver.isHealthy('test-avd');
      expect(healthy).toBe(true);
    });

    it('returns false when adb shell fails', async () => {
      mockExecFile.mockImplementation(((cmd: string, args: string[], opts: any, cb: Function) => {
        if (typeof opts === 'function') {
          cb = opts;
          opts = {};
        }
        cb(new Error('device not found'), null);
      }) as any);

      const healthy = await driver.isHealthy('test-avd');
      expect(healthy).toBe(false);
    });
  });

  describe('cleanup()', () => {
    it('attempts snapshot restore via emulator console', { timeout: 30_000 }, async () => {
      // Mock net.connect for telnet
      const mockSocket = {
        on: vi.fn(),
        write: vi.fn(),
        end: vi.fn(),
        destroy: vi.fn(),
        setTimeout: vi.fn(),
      };

      // For cleanup, we need the port tracked. Boot first.
      const mockProcess = {
        pid: 12345,
        on: vi.fn(),
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        unref: vi.fn(),
      };
      mockSpawn.mockReturnValue(mockProcess as any);

      mockExecFile.mockImplementation(((cmd: string, args: string[], opts: any, cb: Function) => {
        if (typeof opts === 'function') {
          cb = opts;
          opts = {};
        }
        if (cmd === 'adb' && args.includes('wait-for-device')) {
          cb(null, { stdout: '', stderr: '' });
        } else if (cmd === 'adb' && args.includes('getprop')) {
          cb(null, { stdout: '1\r\n', stderr: '' });
        } else {
          cb(null, { stdout: '', stderr: '' });
        }
      }) as any);

      await driver.boot('test-avd');

      // cleanup should not throw even if telnet fails (falls back to restart)
      await expect(driver.cleanup('test-avd')).resolves.not.toThrow();
    });
  });
});
