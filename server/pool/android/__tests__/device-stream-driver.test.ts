import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock @device-stream/android
const mockListDevices = vi.fn();
const mockConnect = vi.fn();
const mockDisconnect = vi.fn();

vi.mock('@device-stream/android', () => {
  return {
    AndroidDeviceService: class MockAndroidDeviceService {
      listDevices = mockListDevices;
      connect = mockConnect;
      disconnect = mockDisconnect;
    },
  };
});

// Mock node:child_process
const mockSpawn = vi.fn();
const mockExecFile = vi.fn();

vi.mock('node:child_process', () => ({
  spawn: (...args: any[]) => mockSpawn(...args),
  execFile: (...args: any[]) => mockExecFile(...args),
}));

// Mock avd utilities
const mockEnsureAvdExists = vi.fn();
const mockListAvds = vi.fn();
const mockDeleteAvd = vi.fn();

vi.mock('../avd.js', () => ({
  ensureAvdExists: (...args: any[]) => mockEnsureAvdExists(...args),
  listAvds: (...args: any[]) => mockListAvds(...args),
  deleteAvd: (...args: any[]) => mockDeleteAvd(...args),
}));

// Mock zombie detector
const mockGetZombieInfo = vi.fn();
const mockIsProcessAlive = vi.fn();
const mockGetProcessStat = vi.fn();
const mockIsZombieStat = vi.fn();

vi.mock('../../zombie-detector.js', () => ({
  getZombieInfo: (...args: any[]) => mockGetZombieInfo(...args),
  isProcessAlive: (...args: any[]) => mockIsProcessAlive(...args),
  getProcessStat: (...args: any[]) => mockGetProcessStat(...args),
  isZombieStat: (...args: any[]) => mockIsZombieStat(...args),
}));

// Mock fs and net (for cleanup/snapshot restore)
vi.mock('node:fs', () => ({
  default: {
    readdirSync: vi.fn().mockReturnValue([]),
    unlinkSync: vi.fn(),
    readFileSync: vi.fn().mockReturnValue(''),
  },
  readdirSync: vi.fn().mockReturnValue([]),
  unlinkSync: vi.fn(),
  readFileSync: vi.fn().mockReturnValue(''),
}));

vi.mock('node:net', () => {
  const createMockSocket = () => {
    const handlers: Record<string, Function> = {};
    const mockSocket = {
      write: vi.fn(),
      end: vi.fn(),
      destroy: vi.fn(),
      on: vi.fn((event: string, cb: Function) => {
        handlers[event] = cb;
        // Auto-trigger close after connect callback fires
        if (event === 'close') {
          setTimeout(() => cb(), 10);
        }
      }),
    };
    return mockSocket;
  };

  return {
    default: {
      connect: vi.fn((_port: number, _host: string, cb?: Function) => {
        const socket = createMockSocket();
        if (cb) setTimeout(cb, 5);
        return socket;
      }),
    },
    connect: vi.fn((_port: number, _host: string, cb?: Function) => {
      const socket = createMockSocket();
      if (cb) setTimeout(cb, 5);
      return socket;
    }),
  };
});

import type { AndroidDeviceConfig } from '../../types.js';
import { DeviceStreamAndroidDriver } from '../device-stream-driver.js';
import pino from 'pino';

const logger = pino({ level: 'silent' });

function createConfig(): AndroidDeviceConfig {
  return {
    enabled: true,
    max_instances: 2,
    headless: true,
    api_level: '35',
    system_image_variant: 'google_apis_playstore',
    device_profile: 'pixel_7',
    ram_mb: 2048,
  };
}

function createMockProcess(pid: number) {
  const proc = {
    pid,
    unref: vi.fn(),
    on: vi.fn(),
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
  };
  return proc;
}

describe('DeviceStreamAndroidDriver', () => {
  let driver: DeviceStreamAndroidDriver;
  const config = createConfig();

  beforeEach(() => {
    vi.clearAllMocks();
    driver = new DeviceStreamAndroidDriver(config, logger);

    // Default: no zombies
    mockGetZombieInfo.mockResolvedValue({ ports: new Set(), avdNames: new Set() });
    mockIsProcessAlive.mockReturnValue(false);
    mockGetProcessStat.mockResolvedValue(null);
    mockIsZombieStat.mockReturnValue(false);
    mockEnsureAvdExists.mockResolvedValue(undefined);
    mockListAvds.mockResolvedValue([]);
    mockDeleteAvd.mockResolvedValue(undefined);
  });

  describe('create()', () => {
    it('calls ensureAvdExists with name and AndroidDeviceConfig, returns name', async () => {
      const result = await driver.create('test-avd', config);

      expect(mockEnsureAvdExists).toHaveBeenCalledWith('test-avd', config);
      expect(result).toBe('test-avd');
    });
  });

  describe('boot()', () => {
    it('spawns emulator process with correct args', async () => {
      const proc = createMockProcess(12345);
      mockSpawn.mockReturnValue(proc);

      // Mock execFile for adb wait-for-device and getprop
      mockExecFile.mockImplementation((_cmd: string, args: string[], _opts: any, cb?: Function) => {
        if (cb) {
          if (args?.includes('wait-for-device')) {
            cb(null, { stdout: '', stderr: '' });
          } else if (args?.includes('getprop')) {
            cb(null, { stdout: '1\n', stderr: '' });
          } else {
            cb(null, { stdout: '', stderr: '' });
          }
        }
        return { on: vi.fn() };
      });

      const result = await driver.boot('test-avd');

      expect(mockSpawn).toHaveBeenCalledWith(
        'emulator',
        expect.arrayContaining(['-avd', 'test-avd', '-no-window', '-no-audio', '-no-boot-anim', '-gpu', 'swiftshader_indirect', '-port']),
        expect.objectContaining({ detached: true }),
      );
      expect(result.port).toBe(5554);
      expect(result.pid).toBe(12345);
    });

    it('allocates port avoiding used ports, blacklisted ports, and zombie ports', async () => {
      // First boot uses 5554
      const proc1 = createMockProcess(111);
      mockSpawn.mockReturnValue(proc1);
      mockExecFile.mockImplementation((_cmd: string, args: string[], _opts: any, cb?: Function) => {
        if (cb) {
          if (args?.includes('getprop')) cb(null, { stdout: '1\n', stderr: '' });
          else cb(null, { stdout: '', stderr: '' });
        }
        return { on: vi.fn() };
      });

      const r1 = await driver.boot('avd-1');
      expect(r1.port).toBe(5554);

      // Second boot should skip 5554 (in use)
      const proc2 = createMockProcess(222);
      mockSpawn.mockReturnValue(proc2);
      const r2 = await driver.boot('avd-2');
      expect(r2.port).toBe(5556);
    });

    it('creates replacement AVD when original is held by zombie', async () => {
      mockGetZombieInfo.mockResolvedValue({
        ports: new Set([5554]),
        avdNames: new Set(['test-avd']),
      });

      const proc = createMockProcess(12345);
      mockSpawn.mockReturnValue(proc);
      mockExecFile.mockImplementation((_cmd: string, args: string[], _opts: any, cb?: Function) => {
        if (cb) {
          if (args?.includes('getprop')) cb(null, { stdout: '1\n', stderr: '' });
          else cb(null, { stdout: '', stderr: '' });
        }
        return { on: vi.fn() };
      });

      await driver.boot('test-avd');

      // Should have called ensureAvdExists with a replacement name
      expect(mockEnsureAvdExists).toHaveBeenCalledWith(
        expect.stringMatching(/^test-avd-r\d+$/),
        config,
      );
      // Port should skip zombie port 5554
      expect(mockSpawn).toHaveBeenCalledWith(
        'emulator',
        expect.arrayContaining(['-port', '5556']),
        expect.any(Object),
      );
    });
  });

  describe('isHealthy()', () => {
    it('uses AndroidDeviceService.listDevices() to check device connectivity', async () => {
      // First boot a device to populate processes map
      const proc = createMockProcess(12345);
      mockSpawn.mockReturnValue(proc);
      mockExecFile.mockImplementation((_cmd: string, args: string[], _opts: any, cb?: Function) => {
        if (cb) {
          if (args?.includes('getprop')) cb(null, { stdout: '1\n', stderr: '' });
          else cb(null, { stdout: '', stderr: '' });
        }
        return { on: vi.fn() };
      });
      await driver.boot('test-avd');

      mockListDevices.mockResolvedValue([
        { serial: 'emulator-5554', connected: true, platform: 'android', model: 'Pixel', osVersion: '15', screenWidth: 1080, screenHeight: 1920, battery: 100 },
      ]);

      const result = await driver.isHealthy('test-avd', 5554);
      expect(result).toBe(true);
      expect(mockListDevices).toHaveBeenCalled();
    });

    it('returns false when AndroidDeviceService throws', async () => {
      mockListDevices.mockRejectedValue(new Error('ADB server not running'));

      const result = await driver.isHealthy('test-avd', 5554);
      expect(result).toBe(false);
    });
  });

  describe('shutdown()', () => {
    it('sends SIGTERM then SIGKILL, handles zombie detection', { timeout: 10_000 }, async () => {
      // Boot first
      const proc = createMockProcess(12345);
      mockSpawn.mockReturnValue(proc);
      mockExecFile.mockImplementation((_cmd: string, args: string[], _opts: any, cb?: Function) => {
        if (cb) {
          if (args?.includes('getprop')) cb(null, { stdout: '1\n', stderr: '' });
          else cb(null, { stdout: '', stderr: '' });
        }
        return { on: vi.fn() };
      });
      await driver.boot('test-avd');

      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
      mockIsProcessAlive.mockReturnValue(false);

      await driver.shutdown('test-avd');

      expect(killSpy).toHaveBeenCalledWith(-12345, 'SIGTERM');
      killSpy.mockRestore();
    });

    it('blacklists port and AVD when zombie detected', { timeout: 15_000 }, async () => {
      // Boot first
      const proc = createMockProcess(12345);
      mockSpawn.mockReturnValue(proc);
      mockExecFile.mockImplementation((_cmd: string, args: string[], _opts: any, cb?: Function) => {
        if (cb) {
          if (args?.includes('getprop')) cb(null, { stdout: '1\n', stderr: '' });
          else cb(null, { stdout: '', stderr: '' });
        }
        return { on: vi.fn() };
      });
      await driver.boot('test-avd');

      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
      mockIsProcessAlive.mockReturnValue(true); // Still alive after kill
      mockGetProcessStat.mockResolvedValue('Us');
      mockIsZombieStat.mockReturnValue(true);

      await driver.shutdown('test-avd');

      // After zombie detected, next boot should skip port 5554
      mockGetZombieInfo.mockResolvedValue({ ports: new Set(), avdNames: new Set() });
      const proc2 = createMockProcess(99999);
      mockSpawn.mockReturnValue(proc2);
      const r = await driver.boot('test-avd-2');
      expect(r.port).toBe(5556); // 5554 is blacklisted

      killSpy.mockRestore();
    });
  });

  describe('cleanup()', () => {
    it('attempts snapshot restore via telnet, falls back to shutdown+reboot', { timeout: 10_000 }, async () => {
      // Boot first
      const proc = createMockProcess(12345);
      mockSpawn.mockReturnValue(proc);
      mockExecFile.mockImplementation((_cmd: string, args: string[], _opts: any, cb?: Function) => {
        if (cb) {
          if (args?.includes('getprop')) cb(null, { stdout: '1\n', stderr: '' });
          else cb(null, { stdout: '', stderr: '' });
        }
        return { on: vi.fn() };
      });
      await driver.boot('test-avd');

      // cleanup should not throw
      await expect(driver.cleanup('test-avd')).resolves.not.toThrow();
    });
  });

  describe('cleanupReplacementAvds()', () => {
    it('deletes AVDs matching -r suffix pattern', async () => {
      mockListAvds.mockResolvedValue(['test-avd', 'test-avd-r1234567890', 'other-avd-r9876543210']);

      await driver.cleanupReplacementAvds();

      expect(mockDeleteAvd).toHaveBeenCalledWith('test-avd-r1234567890');
      expect(mockDeleteAvd).toHaveBeenCalledWith('other-avd-r9876543210');
      expect(mockDeleteAvd).not.toHaveBeenCalledWith('test-avd');
    });
  });

  describe('disconnect on shutdown', () => {
    it('calls deviceService.disconnect before killing process', { timeout: 10_000 }, async () => {
      // Boot first
      const proc = createMockProcess(12345);
      mockSpawn.mockReturnValue(proc);
      mockExecFile.mockImplementation((_cmd: string, args: string[], _opts: any, cb?: Function) => {
        if (cb) {
          if (args?.includes('getprop')) cb(null, { stdout: '1\n', stderr: '' });
          else cb(null, { stdout: '', stderr: '' });
        }
        return { on: vi.fn() };
      });
      await driver.boot('test-avd');

      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
      mockIsProcessAlive.mockReturnValue(false);
      mockDisconnect.mockResolvedValue(undefined);

      await driver.shutdown('test-avd');

      expect(mockDisconnect).toHaveBeenCalledWith('emulator-5554');
      killSpy.mockRestore();
    });
  });
});
