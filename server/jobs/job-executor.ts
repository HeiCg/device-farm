import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { createInterface } from 'node:readline';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import type pino from 'pino';
import { MaestroParser } from './maestro-parser.js';
import type { JobStep, JobSummary, Platform, ParserCallbacks } from './types.js';

const execFileAsync = promisify(execFile);
const TEMP_BASE = '/tmp/device-farm/jobs';
const APK_BASE = '/tmp/device-farm/apks';
const KILL_ESCALATION_MS = 5000;

export interface ExecutionResult {
  steps: JobStep[];
  summary: JobSummary;
  rawOutput: string;
  exitCode: number | null;
  status: 'passed' | 'failed' | 'timeout' | 'cancelled';
  commandTimestamps?: Map<string, { startedAt: Date; endedAt?: Date }>;
}

export interface ExecutionCallbacks extends ParserCallbacks {
  onStdoutLine?: (line: string) => void;
}

export interface ExecuteOptions {
  jobId: string;
  flowDir: string;
  deviceId: string;
  platform: Platform;
  signal?: AbortSignal;
  callbacks?: ExecutionCallbacks;
  env?: Record<string, string>;
  apkPath?: string;
  entryFile?: string;
  /** Tags to include (Maestro --include-tags) */
  includeTags?: string[];
  /** Tags to exclude (Maestro --exclude-tags) */
  excludeTags?: string[];
  /** Report format: JUNIT, HTML, NOOP */
  reportFormat?: 'JUNIT' | 'HTML' | 'NOOP';
  /** Enable Maestro debug output (screenshots per step) */
  debugOutput?: boolean;
  /** Output directory for Maestro test artifacts */
  outputDir?: string;
}

export class JobExecutor {
  private readonly logger: pino.Logger;
  private readonly timeoutMinutes: number;

  constructor(logger: pino.Logger, timeoutMinutes: number) {
    this.logger = logger.child({ component: 'job-executor' });
    this.timeoutMinutes = timeoutMinutes;
  }

  /**
   * Write flow files to a temp directory for Maestro to read.
   */
  async writeFlowFiles(
    jobId: string,
    files: Array<{ filename: string; content: string }>,
  ): Promise<string> {
    const dir = join(TEMP_BASE, jobId);
    await mkdir(dir, { recursive: true });

    const filenames: string[] = [];
    for (const file of files) {
      const filePath = join(dir, file.filename);
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, file.content);
      filenames.push(file.filename);
    }

    this.logger.info({ jobId, fileCount: files.length, dir, filenames }, 'Flow files written');
    return dir;
  }

  /**
   * Clean up the temp directory for a job. Call only after process exits.
   */
  async cleanupTempDir(jobId: string): Promise<void> {
    const dir = join(TEMP_BASE, jobId);
    await rm(dir, { recursive: true, force: true });
    this.logger.info({ jobId }, 'Temp dir cleaned up');
  }

  /**
   * Execute Maestro test run on a device.
   * Spawns `maestro test <flowDir>` with platform-specific configuration.
   * Handles timeout and cancellation via AbortSignal.
   */
  /**
   * Install an APK on an Android device via adb.
   */
  async installApk(deviceId: string, apkPath: string): Promise<void> {
    this.logger.info({ deviceId, apkPath }, 'Installing APK');
    await execFileAsync('adb', ['-s', deviceId, 'install', '-r', '-t', apkPath]);
    this.logger.info({ deviceId, apkPath }, 'APK installed');
  }

  /**
   * Wait for ADB device to be fully booted and responsive.
   * Maestro uses its own ADB client (dadb) and needs the device fully ready.
   */
  private async waitForDevice(serial: string, timeoutMs = 15_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const { stdout } = await execFileAsync('adb', ['-s', serial, 'shell', 'getprop', 'sys.boot_completed'], { timeout: 5000 });
        if (stdout.trim() === '1') return;
      } catch { /* retry */ }
      await new Promise(r => setTimeout(r, 1000));
    }
    throw new Error(`Device ${serial} not ready after ${timeoutMs}ms`);
  }

  async execute(opts: ExecuteOptions): Promise<ExecutionResult> {
    const { jobId, flowDir, deviceId, platform, signal, callbacks } = opts;

    // Ensure device is fully booted before any operations
    await this.waitForDevice(deviceId);

    // Install APK if provided (before running Maestro)
    if (opts.apkPath) {
      await this.installApk(deviceId, opts.apkPath);
    }

    // Build spawn args — point at specific entry file if provided, else directory
    const testTarget = opts.entryFile ? join(flowDir, opts.entryFile) : flowDir;
    const args = ['test', testTarget];
    // Always pass --device explicitly so Maestro targets the right emulator/simulator,
    // especially when zombie qemu holds an offline ADB serial that confuses device discovery
    args.push('--device', deviceId);

    // Add environment variable flags for Maestro
    if (opts.env) {
      for (const [key, value] of Object.entries(opts.env)) {
        args.push('-e', `${key}=${value}`);
      }
    }

    // Maestro tag filtering
    if (opts.includeTags && opts.includeTags.length > 0) {
      args.push('--include-tags', opts.includeTags.join(','));
    }
    if (opts.excludeTags && opts.excludeTags.length > 0) {
      args.push('--exclude-tags', opts.excludeTags.join(','));
    }

    // Maestro report format (default: JUNIT for CI integration)
    if (opts.reportFormat && opts.reportFormat !== 'NOOP') {
      args.push('--format', opts.reportFormat);
    }

    // Debug output: Maestro saves screenshots and logs per step
    if (opts.debugOutput && opts.outputDir) {
      args.push('--debug-output', opts.outputDir);
    }

    // Output directory for test artifacts (JUnit XML, etc.)
    if (opts.outputDir) {
      args.push('--output', join(opts.outputDir, 'report.xml'));
    }

    // Build env
    const env: Record<string, string> = { ...process.env as Record<string, string> };
    if (platform === 'android') {
      env.ANDROID_SERIAL = deviceId;
    }

    this.logger.info({ jobId, platform, deviceId, args }, 'Spawning Maestro');

    const child = spawn('maestro', args, {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
    });

    return new Promise<ExecutionResult>((resolve) => {
      // Create parser with user-provided callbacks or no-ops
      const parser = new MaestroParser({
        onFlowStart: callbacks?.onFlowStart ?? (() => {}),
        onCommandStatus: callbacks?.onCommandStatus ?? (() => {}),
        onFlowResult: callbacks?.onFlowResult ?? (() => {}),
        onSummary: callbacks?.onSummary ?? (() => {}),
      });

      let timedOut = false;
      let cancelled = false;
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
      let escalationHandle: ReturnType<typeof setTimeout> | undefined;

      const killProcessGroup = () => {
        if (child.pid) {
          try {
            process.kill(-child.pid, 'SIGTERM');
          } catch {
            // Process may have already exited
          }

          // Escalate to SIGKILL after 5s
          escalationHandle = setTimeout(() => {
            try {
              process.kill(-child.pid!, 'SIGKILL');
            } catch {
              // Already dead
            }
          }, KILL_ESCALATION_MS);
        }
      };

      // Set up timeout
      const timeoutMs = this.timeoutMinutes * 60 * 1000;
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        this.logger.warn({ jobId, timeoutMinutes: this.timeoutMinutes }, 'Job timed out');
        killProcessGroup();
      }, timeoutMs);

      // Set up cancel via AbortSignal
      const onAbort = () => {
        cancelled = true;
        this.logger.info({ jobId }, 'Job cancelled via AbortSignal');
        killProcessGroup();
      };
      if (signal) {
        if (signal.aborted) {
          cancelled = true;
          killProcessGroup();
        } else {
          signal.addEventListener('abort', onAbort, { once: true });
        }
      }

      // Parse stdout line-by-line
      if (child.stdout) {
        const rl = createInterface({ input: child.stdout });
        rl.on('line', (line) => {
          parser.parseLine(line);
          callbacks?.onStdoutLine?.(line);
        });
      }

      // Collect stderr
      let stderr = '';
      if (child.stderr) {
        child.stderr.on('data', (chunk: Buffer) => {
          stderr += chunk.toString();
        });
      }

      // Handle process exit
      child.on('exit', (exitCode, sig) => {
        // Clean up timers
        if (timeoutHandle) clearTimeout(timeoutHandle);
        if (escalationHandle) clearTimeout(escalationHandle);
        if (signal) signal.removeEventListener('abort', onAbort);

        const steps = parser.getSteps();
        const summary = parser.getSummary();
        const rawOutput = parser.getRawOutput();

        let status: ExecutionResult['status'];
        if (timedOut) {
          status = 'timeout';
        } else if (cancelled) {
          status = 'cancelled';
        } else if (exitCode === 0 && summary.failed === 0) {
          status = 'passed';
        } else {
          status = 'failed';
        }

        if (stderr) {
          this.logger.warn({ jobId, stderr: stderr.substring(0, 2000) }, 'Maestro stderr');
        }

        this.logger.info(
          { jobId, exitCode, signal: sig, status, steps: steps.length },
          'Maestro process exited',
        );

        // Combine stdout + stderr for full output
        const fullOutput = rawOutput + (stderr ? '\n--- STDERR ---\n' + stderr : '');

        resolve({
          steps,
          summary,
          rawOutput: fullOutput,
          exitCode: exitCode ?? null,
          status,
          commandTimestamps: parser.getCommandTimestamps(),
        });
      });
    });
  }
}
