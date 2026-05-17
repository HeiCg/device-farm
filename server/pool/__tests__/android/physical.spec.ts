/**
 * Phase 36 / Plan 36-02 — PhysicalAndroidDriver tests (PHYS-ANDROID-DRIVER).
 *
 * Mocks the promisified spawn helper so the 5 DeviceDriver methods can
 * be exercised without invoking real adb.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import pino from 'pino';

interface SpawnCall { cmd: string; args: string[]; opts: { timeout?: number } | undefined }

const spawnCalls: SpawnCall[] = [];
type Outcome =
  | { stdout: string; stderr?: string }
  | { error: Error };
let queuedOutcomes: Outcome[] = [];

vi.mock('node:util', async () => {
  const actual = await vi.importActual<typeof import('node:util')>('node:util');
  return {
    ...actual,
    promisify: (_fn: unknown) => async (
      cmd: string,
      args: string[],
      opts: { timeout?: number } | undefined,
    ) => {
      spawnCalls.push({ cmd, args, opts });
      const o = queuedOutcomes.shift() ?? { stdout: '' };
      if ('error' in o) throw o.error;
      return { stdout: o.stdout, stderr: o.stderr ?? '' };
    },
  };
});

import { PhysicalAndroidDriver } from '../../android/physical.js';

beforeEach(() => {
  spawnCalls.length = 0;
  queuedOutcomes = [];
});

function makeDriver(): PhysicalAndroidDriver {
  return new PhysicalAndroidDriver(pino({ level: 'silent' }));
}

describe('[Phase 36-02] PhysicalAndroidDriver', () => {
  it('create() returns the name argument unchanged', async () => {
    const d = makeDriver();
    const result = await d.create('R5CR1234567', { enabled: true, max_instances: 1 } as any);
    expect(result).toBe('R5CR1234567');
  });

  it('boot() runs adb wait-for-device then verifies sys.boot_completed === 1', async () => {
    const d = makeDriver();
    queuedOutcomes = [
      { stdout: '' }, // wait-for-device
      { stdout: '1\n' }, // getprop
    ];
    const result = await d.boot('R5CR1234567');
    expect(result).toEqual({ port: 0, pid: 0 });
    expect(spawnCalls[0]?.args).toEqual(['-s', 'R5CR1234567', 'wait-for-device']);
    expect(spawnCalls[1]?.args).toEqual(['-s', 'R5CR1234567', 'shell', 'getprop', 'sys.boot_completed']);
  });

  it('boot() throws when sys.boot_completed !== 1', async () => {
    const d = makeDriver();
    queuedOutcomes = [
      { stdout: '' },
      { stdout: '0\n' },
    ];
    await expect(d.boot('R5CR1234567')).rejects.toThrow(/boot-completed/i);
  });

  it('boot() respects options.timeout for wait-for-device', async () => {
    const d = makeDriver();
    queuedOutcomes = [
      { stdout: '' },
      { stdout: '1\n' },
    ];
    await d.boot('R5CR1234567', { timeout: 7_777 });
    expect(spawnCalls[0]?.opts?.timeout).toBe(7_777);
  });

  it('shutdown() is a no-op (does not spawn any process)', async () => {
    const d = makeDriver();
    await d.shutdown('R5CR1234567');
    expect(spawnCalls).toHaveLength(0);
  });

  it('isHealthy() returns true when adb get-state stdout === device', async () => {
    const d = makeDriver();
    queuedOutcomes = [{ stdout: 'device\n' }];
    const healthy = await d.isHealthy('R5CR1234567');
    expect(healthy).toBe(true);
    expect(spawnCalls[0]?.args).toEqual(['-s', 'R5CR1234567', 'get-state']);
  });

  it('isHealthy() returns false when adb get-state stdout === offline', async () => {
    const d = makeDriver();
    queuedOutcomes = [{ stdout: 'offline\n' }];
    expect(await d.isHealthy('R5CR1234567')).toBe(false);
  });

  it('isHealthy() returns false when spawn throws', async () => {
    const d = makeDriver();
    queuedOutcomes = [{ error: new Error('adb not found') }];
    expect(await d.isHealthy('R5CR1234567')).toBe(false);
  });

  it('cleanup() calls `adb logcat -c` and swallows errors', async () => {
    const d = makeDriver();
    queuedOutcomes = [{ error: new Error('whatever') }];
    await d.cleanup('R5CR1234567'); // must not throw
    expect(spawnCalls[0]?.args).toEqual(['-s', 'R5CR1234567', 'logcat', '-c']);
  });
});
