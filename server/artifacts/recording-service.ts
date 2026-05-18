import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import type pino from 'pino';
import type { ScrcpyService } from '@device-stream/android';
import type { CaptureService } from '@device-stream/ios-simulator';
import type { ProcessTracker } from '../pool/process-tracker.js';

export interface PlatformServices {
  scrcpyService?: ScrcpyService;
  captureService?: CaptureService;
}

type Platform = 'android' | 'ios';

export interface RecordingResult {
  outputPath: string;
  duration: number;
  frameCount: number;
  codec: 'h264' | 'mjpeg';
  videoStartedAt: Date;
}

/** adb shell screenrecord — records directly on device, then pulled at stop. */
interface AdbRecordingEntry {
  process: ChildProcess;
  deviceSerial: string;
  devicePath: string;
  outputPath: string;
  jobId: string;
  startedAt: number;
  videoStartedAt: Date;
}

/**
 * Records Android device sessions via `adb shell screenrecord`. This is the
 * sole path after the @device-stream API removed `RecordingSession` /
 * `H264FrameSource` / `MJPEGFrameSource` in the 2026-05 sync. Scrcpy now
 * powers preview only (see streaming module); recordings stay on-device until
 * stop, then `adb pull`-ed to the artifacts store.
 *
 * iOS recording is not implemented — current device-stream `CaptureService`
 * exposes no FrameSource hook and no iOS jobs are in the pool.
 */
export class RecordingService {
  private readonly adbRecordings: Map<string, AdbRecordingEntry> = new Map();
  private readonly logger: pino.Logger;
  private readonly processTracker: ProcessTracker | null;

  constructor(logger: pino.Logger, processTracker?: ProcessTracker) {
    this.logger = logger.child({ component: 'recording-service' });
    this.processTracker = processTracker ?? null;
  }

  async startRecording(
    jobId: string,
    outputPath: string,
    platform: Platform,
    deviceSerial: string,
    _services: PlatformServices,
  ): Promise<void> {
    await mkdir(dirname(outputPath), { recursive: true });

    if (platform === 'ios') {
      throw new Error('iOS recording not implemented (no FrameSource API in current @device-stream)');
    }

    const devicePath = `/sdcard/recording-${jobId.substring(0, 8)}.mp4`;
    const child = spawn(
      'adb',
      [
        '-s', deviceSerial, 'shell', 'screenrecord',
        '--bit-rate', '4000000',
        '--size', '720x1280',
        devicePath,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );

    this.adbRecordings.set(jobId, {
      process: child,
      deviceSerial,
      devicePath,
      outputPath,
      jobId,
      startedAt: Date.now(),
      videoStartedAt: new Date(),
    });
    this.logger.info({ jobId, platform, outputPath, method: 'adb-screenrecord' }, 'Started recording');
  }

  async stopRecording(jobId: string): Promise<RecordingResult | null> {
    const entry = this.adbRecordings.get(jobId);
    if (!entry) return null;
    return this.stopAdbRecording(entry);
  }

  private async stopAdbRecording(entry: AdbRecordingEntry): Promise<RecordingResult> {
    const { process: child, deviceSerial, devicePath, outputPath, jobId, startedAt, videoStartedAt } = entry;
    this.adbRecordings.delete(jobId);

    child.kill('SIGINT');
    await new Promise<void>((resolve) => {
      child.on('exit', () => resolve());
      setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 5000);
    });

    await new Promise((r) => setTimeout(r, 1000));

    try {
      const pull = spawn('adb', ['-s', deviceSerial, 'pull', devicePath, outputPath], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      await new Promise<void>((resolve, reject) => {
        pull.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`adb pull exited ${code}`))));
        pull.on('error', reject);
      });

      spawn('adb', ['-s', deviceSerial, 'shell', 'rm', '-f', devicePath], { stdio: 'ignore' });

      await stat(outputPath).catch(() => null);
      const duration = (Date.now() - startedAt) / 1000;

      this.logger.info({ jobId, duration, outputPath }, 'ADB recording saved');

      return { outputPath, duration, frameCount: 0, codec: 'h264', videoStartedAt };
    } catch (err: any) {
      this.logger.error({ jobId, error: err.message }, 'Failed to pull recording from device');
      return { outputPath, duration: 0, frameCount: 0, codec: 'h264', videoStartedAt };
    }
  }

  killRecording(jobId: string): void {
    const entry = this.adbRecordings.get(jobId);
    if (!entry) return;
    entry.process.kill('SIGKILL');
    spawn('adb', ['-s', entry.deviceSerial, 'shell', 'rm', '-f', entry.devicePath], { stdio: 'ignore' });
    this.adbRecordings.delete(jobId);
    this.logger.info({ jobId }, 'ADB recording killed');
  }

  isRecording(jobId: string): boolean {
    return this.adbRecordings.has(jobId);
  }

  /**
   * Phase 21 / Plan 21-01 — read-only discriminator. Always returns
   * 'adb-screenrecord' for active Android recordings (scrcpy + capture-service
   * paths removed when @device-stream dropped RecordingSession). Returns null
   * when no recording is active for the job.
   */
  getRecordingMethod(jobId: string): 'scrcpy' | 'adb-screenrecord' | 'capture-service' | null {
    return this.adbRecordings.has(jobId) ? 'adb-screenrecord' : null;
  }
}
