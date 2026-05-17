import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import pino from 'pino';

// Phase 31 / Plan 31-03 / SC3 — AndroidEmulatorDriver.boot argv plumbing.
// Each test boots a driver instance with specific BootOptions and asserts
// the resulting `child_process.spawn` argv contains the expected literals.

const { spawnMock, execFileMock } = vi.hoisted(() => {
  return {
    spawnMock: vi.fn(),
    execFileMock: vi.fn((cmd: string, args: any, optsOrCb: any, maybeCb: any) => {
      const cb = typeof optsOrCb === 'function' ? optsOrCb : maybeCb;
      if (cmd === 'adb' && Array.isArray(args) && args.includes('getprop')) {
        cb(null, { stdout: '1\r\n', stderr: '' });
        return;
      }
      cb(null, { stdout: '', stderr: '' });
    }),
  };
});

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
  execFile: execFileMock,
}));
vi.mock('child_process', () => ({
  spawn: spawnMock,
  execFile: execFileMock,
}));

// Use the real promisify so AndroidEmulatorDriver's `promisify(execFile)`
// returns a promise-shaped wrapper around our mock cb signature.
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

vi.mock('../../zombie-detector.js', () => ({
  getZombieInfo: vi.fn().mockResolvedValue({ ports: new Set(), avdNames: new Set() }),
  isProcessAlive: vi.fn().mockReturnValue(false),
  getProcessStat: vi.fn().mockResolvedValue(null),
  isZombieStat: vi.fn().mockReturnValue(false),
}));

import { AndroidEmulatorDriver } from '../emulator.js';
import type { AndroidDeviceConfig } from '../../types.js';

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

function newFakeProc(): any {
  const fakeProc: any = new EventEmitter();
  fakeProc.stdout = new EventEmitter();
  fakeProc.stderr = new EventEmitter();
  fakeProc.kill = vi.fn();
  fakeProc.unref = vi.fn();
  fakeProc.pid = 99999;
  return fakeProc;
}

beforeEach(() => {
  spawnMock.mockReset();
  execFileMock.mockClear();
  spawnMock.mockReturnValue(newFakeProc());
});

function getSpawnArgs(): string[] {
  expect(spawnMock).toHaveBeenCalledOnce();
  const call = spawnMock.mock.calls[0];
  return call[1] as string[];
}

describe('emulator boot options → argv', () => {
  it('cold boot: -no-snapshot-load present in argv', async () => {
    const driver = new AndroidEmulatorDriver(defaultConfig, logger);
    await driver.boot('test-avd', { coldBoot: true });
    expect(getSpawnArgs()).toContain('-no-snapshot-load');
  });

  it('audio enabled (noAudio=false): -no-audio absent from argv', async () => {
    const driver = new AndroidEmulatorDriver(defaultConfig, logger);
    await driver.boot('test-avd', { noAudio: false });
    expect(getSpawnArgs()).not.toContain('-no-audio');
  });

  it('audio disabled default: -no-audio present in argv', async () => {
    const driver = new AndroidEmulatorDriver(defaultConfig, logger);
    await driver.boot('test-avd', {});
    expect(getSpawnArgs()).toContain('-no-audio');
  });

  it('gpu host: argv contains "-gpu" followed by "host"', async () => {
    const driver = new AndroidEmulatorDriver(defaultConfig, logger);
    await driver.boot('test-avd', { gpu: 'host' });
    const args = getSpawnArgs();
    const gpuIdx = args.indexOf('-gpu');
    expect(gpuIdx).toBeGreaterThan(-1);
    expect(args[gpuIdx + 1]).toBe('host');
  });

  it('gpu default: argv contains "-gpu" followed by "swiftshader_indirect"', async () => {
    const driver = new AndroidEmulatorDriver(defaultConfig, logger);
    await driver.boot('test-avd', {});
    const args = getSpawnArgs();
    const gpuIdx = args.indexOf('-gpu');
    expect(args[gpuIdx + 1]).toBe('swiftshader_indirect');
  });

  it('spawn invoked: child_process.spawn called once with "emulator"', async () => {
    const driver = new AndroidEmulatorDriver(defaultConfig, logger);
    await driver.boot('test-avd', {});
    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(spawnMock.mock.calls[0][0]).toBe('emulator');
  });

  it('backward compat: boot with undefined options uses defaults', async () => {
    const driver = new AndroidEmulatorDriver(defaultConfig, logger);
    await driver.boot('test-avd', undefined);
    const args = getSpawnArgs();
    expect(args).toContain('-no-audio');
    expect(args).not.toContain('-no-snapshot-load');
    const gpuIdx = args.indexOf('-gpu');
    expect(args[gpuIdx + 1]).toBe('swiftshader_indirect');
  });
});
