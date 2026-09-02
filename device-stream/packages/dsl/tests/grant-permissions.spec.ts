import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/shell', () => ({
  adb: vi.fn(async () => ({ stdout: '', stderr: '' })),
  adbShell: vi.fn(async () => ({ stdout: '', stderr: '' })),
}));

import { adbShell } from '../src/shell';
import { AndroidDriver } from '../src/drivers/android';

const DUMPSYS = [
  'Packages:',
  '  Package [com.example]:',
  '    requested permissions:',
  '      android.permission.CAMERA',
  '      android.permission.RECORD_AUDIO',
  '      android.permission.INTERNET',
  '    install permissions:',
  '      android.permission.INTERNET: granted=true',
].join('\n');

const mockAdbShell = adbShell as unknown as ReturnType<typeof vi.fn>;

function driver(): AndroidDriver {
  return new AndroidDriver('emulator-5554', '127.0.0.1:1');
}

beforeEach(() => {
  mockAdbShell.mockReset();
});

describe("AndroidDriver.grantPermissions('*') aggregation (Also)", () => {
  it('aggregates and throws the pm-grant failures after attempting all', async () => {
    mockAdbShell.mockImplementation(async (_serial: string, args: string[]) => {
      if (args[0] === 'dumpsys') return { stdout: DUMPSYS, stderr: '' };
      // args: ['pm', 'grant', pkg, perm]
      const perm = args[args.length - 1];
      if (perm.endsWith('CAMERA')) return { stdout: '', stderr: '' };
      throw new Error(`not a changeable permission type: ${perm}`);
    });

    await expect(driver().grantPermissions('com.example', '*')).rejects.toThrow(
      /failed for 2\/3 permission\(s\)/,
    );

    // Every declared permission was attempted (dumpsys + 3 grants = 4 calls).
    expect(mockAdbShell).toHaveBeenCalledTimes(4);
  });

  it('lists the specific failing permissions in the error', async () => {
    mockAdbShell.mockImplementation(async (_serial: string, args: string[]) => {
      if (args[0] === 'dumpsys') return { stdout: DUMPSYS, stderr: '' };
      const perm = args[args.length - 1];
      if (perm.endsWith('CAMERA')) return { stdout: '', stderr: '' };
      throw new Error(`not a changeable permission type: ${perm}`);
    });

    await expect(driver().grantPermissions('com.example', '*')).rejects.toThrow(
      /RECORD_AUDIO[\s\S]*INTERNET/,
    );
  });

  it('does not throw when every grant succeeds', async () => {
    mockAdbShell.mockImplementation(async (_serial: string, args: string[]) => {
      if (args[0] === 'dumpsys') return { stdout: DUMPSYS, stderr: '' };
      return { stdout: '', stderr: '' };
    });

    await expect(driver().grantPermissions('com.example', '*')).resolves.toBeUndefined();
  });
});
