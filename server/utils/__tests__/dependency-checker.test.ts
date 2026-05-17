import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkDependencies } from '../dependency-checker.js';

// Mock node:child_process execFile (safe, no shell injection)
vi.mock('node:child_process', () => {
  return {
    execFile: vi.fn(),
  };
});

import { execFile } from 'node:child_process';

const mockExecFile = vi.mocked(execFile);

function setupExecFileMock(missingBinaries: string[] = []) {
  mockExecFile.mockImplementation(((
    command: string,
    args: string[],
    options: unknown,
    callback?: (error: Error | null, stdout: string, stderr: string) => void,
  ) => {
    // Handle the promisify pattern: execFile(cmd, args, opts) returns via callback
    const cb = typeof options === 'function' ? options : callback;
    if (!cb) return;

    const isMissing = missingBinaries.some((bin) => {
      if (bin === 'xcrun simctl') return command === 'xcrun';
      return command === bin;
    });

    if (isMissing) {
      const err = new Error(`Command not found: ${command}`) as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      cb(err, '', '');
    } else {
      cb(null, 'version 1.0', '');
    }
  }) as typeof execFile);
}

describe('Dependency Checker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves successfully when all binaries are present', async () => {
    setupExecFileMock([]);

    const config = {
      android: { enabled: true },
      ios: { enabled: true },
    };

    await expect(checkDependencies(config)).resolves.toBeUndefined();
  });

  it('throws error containing "adb" and install hint when adb is missing', async () => {
    setupExecFileMock(['adb']);

    const config = {
      android: { enabled: true },
      ios: { enabled: true },
    };

    await expect(checkDependencies(config)).rejects.toThrow('adb');
    try {
      await checkDependencies(config);
    } catch (err: any) {
      expect(err.message).toContain('Android SDK');
    }
  });

  it('skips Android deps when android.enabled=false', async () => {
    setupExecFileMock(['adb', 'emulator', 'avdmanager']);

    const config = {
      android: { enabled: false },
      ios: { enabled: true },
    };

    // Should not throw even though Android binaries are missing
    await expect(checkDependencies(config)).resolves.toBeUndefined();
  });

  it('skips iOS deps when ios.enabled=false', async () => {
    setupExecFileMock(['xcrun simctl']);

    const config = {
      android: { enabled: true },
      ios: { enabled: false },
    };

    // Should not throw even though iOS binaries are missing
    await expect(checkDependencies(config)).resolves.toBeUndefined();
  });

  it('reports multiple missing dependencies at once', async () => {
    setupExecFileMock(['adb', 'ffmpeg', 'maestro']);

    const config = {
      android: { enabled: true },
      ios: { enabled: true },
    };

    await expect(checkDependencies(config)).rejects.toThrow('adb');
    try {
      await checkDependencies(config);
    } catch (err: any) {
      expect(err.message).toContain('ffmpeg');
      expect(err.message).toContain('maestro');
    }
  });
});
