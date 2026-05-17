import { execFile as nodeExecFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type pino from 'pino';

type Platform = 'android' | 'ios';

type ExecFileFn = (
  cmd: string,
  args: string[],
  options: Record<string, unknown>,
) => Promise<{ stdout: Buffer | string; stderr: string }>;

const defaultExecFile: ExecFileFn = promisify(nodeExecFile) as unknown as ExecFileFn;

export class ScreenshotService {
  private readonly logger: pino.Logger;
  private readonly execFile: ExecFileFn;

  constructor(logger: pino.Logger, execFileFn?: ExecFileFn) {
    this.logger = logger.child({ component: 'screenshot-service' });
    this.execFile = execFileFn ?? defaultExecFile;
  }

  /**
   * Capture a screenshot from a device using platform-native tools.
   * Android: adb screencap (binary stdout written to file)
   * iOS: xcrun simctl screenshot (writes directly to outputPath)
   */
  async capture(platform: Platform, deviceId: string, outputPath: string): Promise<void> {
    // Ensure output directory exists
    await mkdir(dirname(outputPath), { recursive: true });

    if (platform === 'android') {
      const { stdout } = await this.execFile(
        'adb',
        ['-s', deviceId, 'exec-out', 'screencap', '-p'],
        {
          encoding: 'buffer',
          maxBuffer: 10 * 1024 * 1024,
        },
      );

      await writeFile(outputPath, stdout as Buffer);
      this.logger.info({ platform, deviceId, outputPath }, 'Android screenshot captured');
    } else {
      await this.execFile(
        'xcrun',
        ['simctl', 'io', deviceId, 'screenshot', '--type=png', outputPath],
        {},
      );
      this.logger.info({ platform, deviceId, outputPath }, 'iOS screenshot captured');
    }
  }
}
