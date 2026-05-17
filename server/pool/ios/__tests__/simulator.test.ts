import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IosSimulatorDriver } from '../simulator.js';
import type { IosDeviceConfig } from '../../types.js';

// Mock child_process
vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

vi.mock('node:util', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:util')>();
  return {
    ...actual,
    promisify: vi.fn((fn: any) => {
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

import { execFile } from 'node:child_process';

const mockExecFile = vi.mocked(execFile);

const defaultConfig: IosDeviceConfig = {
  enabled: true,
  max_instances: 5,
  runtime: 'iOS-17-5',
  device_type: 'iPhone-15',
};

describe('IosSimulatorDriver', () => {
  let driver: IosSimulatorDriver;

  beforeEach(() => {
    vi.clearAllMocks();
    driver = new IosSimulatorDriver();
  });

  describe('create()', () => {
    it('calls xcrun simctl create with device type and runtime, returns UDID', async () => {
      const expectedUdid = 'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE';

      mockExecFile.mockImplementation(((cmd: string, args: string[], opts: any, cb: Function) => {
        if (typeof opts === 'function') {
          cb = opts;
          opts = {};
        }
        if (cmd === 'xcrun' && args.includes('create')) {
          cb(null, { stdout: `${expectedUdid}\n`, stderr: '' });
        } else {
          cb(null, { stdout: '', stderr: '' });
        }
      }) as any);

      const udid = await driver.create('test-sim', defaultConfig);

      expect(udid).toBe(expectedUdid);

      const createCall = mockExecFile.mock.calls.find(
        (c) => c[0] === 'xcrun' && (c[1] as string[]).includes('create')
      );
      expect(createCall).toBeDefined();
      const createArgs = createCall![1] as string[];
      expect(createArgs).toContain('simctl');
      expect(createArgs).toContain('create');
      expect(createArgs).toContain('test-sim');
      expect(createArgs).toContain('iPhone-15');
      expect(createArgs).toContain('iOS-17-5');
    });
  });

  describe('boot()', () => {
    it('calls xcrun simctl boot then bootstatus', async () => {
      mockExecFile.mockImplementation(((cmd: string, args: string[], opts: any, cb: Function) => {
        if (typeof opts === 'function') {
          cb = opts;
          opts = {};
        }
        cb(null, { stdout: '', stderr: '' });
      }) as any);

      await driver.boot('test-udid');

      const bootCall = mockExecFile.mock.calls.find(
        (c) => c[0] === 'xcrun' && (c[1] as string[]).includes('boot')
      );
      expect(bootCall).toBeDefined();

      const statusCall = mockExecFile.mock.calls.find(
        (c) => c[0] === 'xcrun' && (c[1] as string[]).includes('bootstatus')
      );
      expect(statusCall).toBeDefined();
    });

    it('handles "already booted" error gracefully', async () => {
      let bootCalled = false;
      mockExecFile.mockImplementation(((cmd: string, args: string[], opts: any, cb: Function) => {
        if (typeof opts === 'function') {
          cb = opts;
          opts = {};
        }
        if (cmd === 'xcrun' && (args as string[]).includes('boot') && !(args as string[]).includes('bootstatus')) {
          bootCalled = true;
          const err = Object.assign(new Error('Unable to boot device in current state: Booted'), {
            stderr: 'Unable to boot device in current state: Booted',
          });
          cb(err, null);
        } else {
          cb(null, { stdout: '', stderr: '' });
        }
      }) as any);

      // Should not throw
      await driver.boot('test-udid');
      expect(bootCalled).toBe(true);
    });

    it('throws for non-booted boot errors', async () => {
      mockExecFile.mockImplementation(((cmd: string, args: string[], opts: any, cb: Function) => {
        if (typeof opts === 'function') {
          cb = opts;
          opts = {};
        }
        if (cmd === 'xcrun' && (args as string[]).includes('boot') && !(args as string[]).includes('bootstatus')) {
          const err = Object.assign(new Error('Device not found'), {
            stderr: 'Device not found',
          });
          cb(err, null);
        } else {
          cb(null, { stdout: '', stderr: '' });
        }
      }) as any);

      await expect(driver.boot('test-udid')).rejects.toThrow('Device not found');
    });
  });

  describe('shutdown()', () => {
    it('calls xcrun simctl shutdown', async () => {
      mockExecFile.mockImplementation(((cmd: string, args: string[], opts: any, cb: Function) => {
        if (typeof opts === 'function') {
          cb = opts;
          opts = {};
        }
        cb(null, { stdout: '', stderr: '' });
      }) as any);

      await driver.shutdown('test-udid');

      const shutdownCall = mockExecFile.mock.calls.find(
        (c) => c[0] === 'xcrun' && (c[1] as string[]).includes('shutdown')
      );
      expect(shutdownCall).toBeDefined();
    });

    it('ignores error if already shut down', async () => {
      mockExecFile.mockImplementation(((cmd: string, args: string[], opts: any, cb: Function) => {
        if (typeof opts === 'function') {
          cb = opts;
          opts = {};
        }
        if (cmd === 'xcrun' && (args as string[]).includes('shutdown')) {
          cb(new Error('Unable to shutdown device in current state: Shutdown'), null);
        } else {
          cb(null, { stdout: '', stderr: '' });
        }
      }) as any);

      // Should not throw
      await driver.shutdown('test-udid');
    });
  });

  describe('isHealthy()', () => {
    it('returns true when device state is Booted in simctl list', async () => {
      const simctlOutput = JSON.stringify({
        devices: {
          'com.apple.CoreSimulator.SimRuntime.iOS-17-5': [
            { udid: 'test-udid', state: 'Booted', name: 'test-sim' },
          ],
        },
      });

      mockExecFile.mockImplementation(((cmd: string, args: string[], opts: any, cb: Function) => {
        if (typeof opts === 'function') {
          cb = opts;
          opts = {};
        }
        cb(null, { stdout: simctlOutput, stderr: '' });
      }) as any);

      const healthy = await driver.isHealthy('test-udid');
      expect(healthy).toBe(true);
    });

    it('returns false when device is not Booted', async () => {
      const simctlOutput = JSON.stringify({
        devices: {
          'com.apple.CoreSimulator.SimRuntime.iOS-17-5': [
            { udid: 'test-udid', state: 'Shutdown', name: 'test-sim' },
          ],
        },
      });

      mockExecFile.mockImplementation(((cmd: string, args: string[], opts: any, cb: Function) => {
        if (typeof opts === 'function') {
          cb = opts;
          opts = {};
        }
        cb(null, { stdout: simctlOutput, stderr: '' });
      }) as any);

      const healthy = await driver.isHealthy('test-udid');
      expect(healthy).toBe(false);
    });

    it('returns false when simctl command fails', async () => {
      mockExecFile.mockImplementation(((cmd: string, args: string[], opts: any, cb: Function) => {
        if (typeof opts === 'function') {
          cb = opts;
          opts = {};
        }
        cb(new Error('simctl error'), null);
      }) as any);

      const healthy = await driver.isHealthy('test-udid');
      expect(healthy).toBe(false);
    });
  });

  describe('cleanup()', () => {
    it('calls shutdown then erase', async () => {
      const calls: string[] = [];
      mockExecFile.mockImplementation(((cmd: string, args: string[], opts: any, cb: Function) => {
        if (typeof opts === 'function') {
          cb = opts;
          opts = {};
        }
        if (cmd === 'xcrun') {
          const simctlArgs = args as string[];
          if (simctlArgs.includes('shutdown')) calls.push('shutdown');
          if (simctlArgs.includes('erase')) calls.push('erase');
        }
        cb(null, { stdout: '', stderr: '' });
      }) as any);

      await driver.cleanup('test-udid');

      expect(calls).toEqual(['shutdown', 'erase']);
    });
  });
});
