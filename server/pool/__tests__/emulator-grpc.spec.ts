/**
 * Vitest spec for AndroidEmulatorDriver `-grpc` spawn injection (Phase 33 / Plan 33-03 / AND-GRPC-SPAWN).
 *
 * Proves:
 *   (a) emulator argv contains `-grpc <port>` immediately after `-port <port>`
 *   (b) two concurrent boots allocate distinct grpcPorts (8554 then 8555)
 *   (c) port-band 8554-8650 exhaustion throws a clear error
 *   (d) BootResult includes `grpcPort` field
 *
 * Mock pattern mirrors `server/pool/android/__tests__/emulator-boot-options.spec.ts`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import pino from 'pino';

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

vi.mock('../zombie-detector.js', () => ({
  getZombieInfo: vi.fn().mockResolvedValue({ ports: new Set(), avdNames: new Set() }),
  isProcessAlive: vi.fn().mockReturnValue(false),
  getProcessStat: vi.fn().mockResolvedValue(null),
  isZombieStat: vi.fn().mockReturnValue(false),
}));

import { AndroidEmulatorDriver } from '../android/emulator.js';
import type { AndroidDeviceConfig } from '../types.js';

const logger = pino({ level: 'silent' });

const defaultConfig: AndroidDeviceConfig = {
  enabled: true,
  max_instances: 5,
  headless: true,
  api_level: '35',
  system_image_variant: 'google_apis',
  device_profile: 'pixel_7',
  ram_mb: 2048,
};

let nextPid = 90000;
function newFakeProc(): any {
  const fakeProc: any = new EventEmitter();
  fakeProc.stdout = new EventEmitter();
  fakeProc.stderr = new EventEmitter();
  fakeProc.kill = vi.fn();
  fakeProc.unref = vi.fn();
  fakeProc.pid = nextPid++;
  return fakeProc;
}

beforeEach(() => {
  spawnMock.mockReset();
  execFileMock.mockClear();
  spawnMock.mockImplementation(() => newFakeProc());
});

describe('AndroidEmulatorDriver -grpc spawn (AND-GRPC-SPAWN)', () => {
  it('injects -grpc <port> flag into spawn argv between -port and -no-snapshot-load', async () => {
    const driver = new AndroidEmulatorDriver(defaultConfig, logger);
    const result = await driver.boot('test-avd-1', { coldBoot: true });

    expect(spawnMock).toHaveBeenCalledOnce();
    const args = spawnMock.mock.calls[0][1] as string[];

    expect(args).toEqual(expect.arrayContaining(['-grpc', String(result.grpcPort)]));

    const portIdx = args.indexOf('-port');
    const grpcIdx = args.indexOf('-grpc');
    const coldBootIdx = args.indexOf('-no-snapshot-load');

    expect(portIdx).toBeGreaterThanOrEqual(0);
    // `-grpc` is the token immediately after `-port <port>` (i.e., at portIdx + 2)
    expect(grpcIdx).toBe(portIdx + 2);
    // `-no-snapshot-load` comes after `-grpc <grpcPort>`
    expect(coldBootIdx).toBeGreaterThan(grpcIdx);
  });

  it('allocates distinct grpcPort for two concurrent boots (8554 then 8555)', async () => {
    const driver = new AndroidEmulatorDriver(defaultConfig, logger);
    const r1 = await driver.boot('test-avd-a');
    const r2 = await driver.boot('test-avd-b');
    expect(r1.grpcPort).toBe(8554);
    expect(r2.grpcPort).toBe(8555);
    expect(r1.grpcPort).not.toBe(r2.grpcPort);
  });

  it('throws when port band 8554-8650 is exhausted', async () => {
    const driver = new AndroidEmulatorDriver(defaultConfig, logger);
    // Force-fill the internal processes Map with all 97 entries holding 8554..8650
    const procs: any = (driver as any).processes;
    for (let p = 8554; p <= 8650; p++) {
      procs.set(`busy-${p}`, { pid: 1000 + p, port: 5000 + (p - 8554) * 2, grpcPort: p });
    }
    await expect(driver.boot('overflow-avd')).rejects.toThrow(/8554-8650/);
  });

  it('returns grpcPort in BootResult', async () => {
    const driver = new AndroidEmulatorDriver(defaultConfig, logger);
    const result = await driver.boot('test-avd-result');
    expect(result).toHaveProperty('grpcPort');
    expect(typeof result.grpcPort).toBe('number');
    expect(result.grpcPort).toBeGreaterThanOrEqual(8554);
    expect(result.grpcPort).toBeLessThanOrEqual(8650);
  });
});
