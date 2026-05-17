import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RecordingService } from '../recording-service.js';
import pino from 'pino';

const { mockMkdir } = vi.hoisted(() => ({
  mockMkdir: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('node:fs/promises', () => ({
  mkdir: mockMkdir,
  stat: vi.fn().mockResolvedValue({ size: 1024 }),
}));

const { mockSpawn } = vi.hoisted(() => ({
  mockSpawn: vi.fn(),
}));

vi.mock('node:child_process', async (importOriginal) => {
  const original = (await importOriginal()) as Record<string, unknown>;
  return { ...original, spawn: mockSpawn };
});

function createMockProcess(exitCode = 0): any {
  return {
    kill: vi.fn(),
    on: vi.fn((event: string, cb: Function) => {
      if (event === 'exit') setTimeout(() => cb(exitCode), 5);
    }),
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    pid: 12345,
  };
}

describe('RecordingService', () => {
  let logger: pino.Logger;
  let service: RecordingService;

  beforeEach(() => {
    vi.clearAllMocks();
    logger = pino({ level: 'silent' });
    service = new RecordingService(logger);
  });

  describe('startRecording', () => {
    it('spawns adb screenrecord for Android', async () => {
      mockSpawn.mockReturnValue(createMockProcess());

      await service.startRecording('job-1', '/output/job-1.mp4', 'android', 'emulator-5554', {});

      expect(mockSpawn).toHaveBeenCalledWith(
        'adb',
        ['-s', 'emulator-5554', 'shell', 'screenrecord', '--bit-rate', '4000000', '--size', '720x1280', expect.stringContaining('recording-')],
        expect.any(Object),
      );
      expect(service.isRecording('job-1')).toBe(true);
    });

    it('uses device serial in adb command (physical-device safe)', async () => {
      mockSpawn.mockReturnValue(createMockProcess());

      await service.startRecording('job-2', '/output/job-2.mp4', 'android', 'ZF524RZBHD', {});

      expect(mockSpawn).toHaveBeenCalledWith(
        'adb',
        expect.arrayContaining(['-s', 'ZF524RZBHD']),
        expect.any(Object),
      );
    });

    it('throws on iOS (FrameSource API removed from @device-stream)', async () => {
      await expect(
        service.startRecording('job-1', '/output/job-1.mp4', 'ios', 'DEVICE-UDID', {}),
      ).rejects.toThrow(/iOS recording not implemented/);
    });

    it('creates output directory before recording', async () => {
      mockSpawn.mockReturnValue(createMockProcess());

      await service.startRecording('job-1', '/deep/nested/recording.mp4', 'android', 'emulator-5554', {});

      expect(mockMkdir).toHaveBeenCalledWith('/deep/nested', { recursive: true });
    });
  });

  describe('stopRecording', () => {
    it('kills screenrecord, pulls file, returns result for Android', async () => {
      mockSpawn
        .mockReturnValueOnce(createMockProcess()) // initial screenrecord
        .mockReturnValueOnce(createMockProcess(0)) // adb pull
        .mockReturnValueOnce(createMockProcess(0)); // adb shell rm

      await service.startRecording('job-1', '/output/job-1.mp4', 'android', 'emulator-5554', {});
      const result = await service.stopRecording('job-1');

      expect(result).not.toBeNull();
      expect(result!.outputPath).toBe('/output/job-1.mp4');
      expect(result!.codec).toBe('h264');
      expect(result!.duration).toBeGreaterThanOrEqual(0);
    });

    it('returns null for unknown job', async () => {
      const result = await service.stopRecording('unknown');
      expect(result).toBeNull();
    });
  });

  describe('killRecording', () => {
    it('kills process and removes from recordings map', async () => {
      mockSpawn.mockReturnValue(createMockProcess());

      await service.startRecording('job-1', '/output/job-1.mp4', 'android', 'emulator-5554', {});
      expect(service.isRecording('job-1')).toBe(true);

      service.killRecording('job-1');
      expect(service.isRecording('job-1')).toBe(false);
    });

    it('is a no-op for unknown job', () => {
      expect(() => service.killRecording('unknown')).not.toThrow();
    });
  });

  describe('isRecording', () => {
    it('returns true while recording, false after kill', async () => {
      mockSpawn.mockReturnValue(createMockProcess());

      await service.startRecording('job-1', '/output/job-1.mp4', 'android', 'emulator-5554', {});
      expect(service.isRecording('job-1')).toBe(true);

      service.killRecording('job-1');
      expect(service.isRecording('job-1')).toBe(false);
    });
  });

  describe('getRecordingMethod', () => {
    it('returns adb-screenrecord while active, null otherwise', async () => {
      mockSpawn.mockReturnValue(createMockProcess());

      expect(service.getRecordingMethod('job-1')).toBeNull();

      await service.startRecording('job-1', '/output/job-1.mp4', 'android', 'emulator-5554', {});
      expect(service.getRecordingMethod('job-1')).toBe('adb-screenrecord');

      service.killRecording('job-1');
      expect(service.getRecordingMethod('job-1')).toBeNull();
    });
  });
});
