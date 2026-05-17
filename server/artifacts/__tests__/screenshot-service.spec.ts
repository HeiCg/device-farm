import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ScreenshotService } from '../screenshot-service.js';
import pino from 'pino';

function createLogger() {
  return pino({ level: 'silent' }) as unknown as pino.Logger;
}

// Mock fs/promises
vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

import { mkdir, writeFile } from 'node:fs/promises';

describe('ScreenshotService', () => {
  let logger: pino.Logger;
  let mockExecFile: ReturnType<typeof vi.fn>;
  let service: ScreenshotService;

  beforeEach(() => {
    logger = createLogger();
    mockExecFile = vi.fn();
    service = new ScreenshotService(logger, mockExecFile as any);
    vi.mocked(mkdir).mockClear();
    vi.mocked(writeFile).mockClear();
  });

  describe('capture - Android', () => {
    it('calls execFile with adb screencap args', async () => {
      const screenshotData = Buffer.from('fake-png-data');
      mockExecFile.mockResolvedValue({ stdout: screenshotData, stderr: '' });

      await service.capture('android', 'emulator-5554', '/output/screenshot.png');

      expect(mockExecFile).toHaveBeenCalledWith(
        'adb',
        ['-s', 'emulator-5554', 'exec-out', 'screencap', '-p'],
        expect.objectContaining({
          encoding: 'buffer',
          maxBuffer: 10 * 1024 * 1024,
        }),
      );
    });

    it('writes binary stdout to output file', async () => {
      const screenshotData = Buffer.from('fake-png-data');
      mockExecFile.mockResolvedValue({ stdout: screenshotData, stderr: '' });

      await service.capture('android', 'emulator-5554', '/output/screenshot.png');

      expect(writeFile).toHaveBeenCalledWith('/output/screenshot.png', screenshotData);
    });
  });

  describe('capture - iOS', () => {
    it('calls execFile with xcrun simctl args', async () => {
      mockExecFile.mockResolvedValue({ stdout: '', stderr: '' });

      await service.capture('ios', 'ABCD-1234', '/output/screenshot.png');

      expect(mockExecFile).toHaveBeenCalledWith(
        'xcrun',
        ['simctl', 'io', 'ABCD-1234', 'screenshot', '--type=png', '/output/screenshot.png'],
        expect.any(Object),
      );
    });
  });

  describe('directory creation', () => {
    it('creates output directory before writing', async () => {
      mockExecFile.mockResolvedValue({ stdout: Buffer.from('data'), stderr: '' });

      await service.capture('android', 'emulator-5554', '/deep/nested/path/screenshot.png');

      expect(mkdir).toHaveBeenCalledWith('/deep/nested/path', { recursive: true });
    });
  });

  describe('error handling', () => {
    it('propagates execFile errors', async () => {
      mockExecFile.mockRejectedValue(new Error('adb not found'));

      await expect(
        service.capture('android', 'emulator-5554', '/output/screenshot.png'),
      ).rejects.toThrow('adb not found');
    });
  });
});
