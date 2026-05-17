/**
 * AndroidLogStream — streams `adb logcat -v threadtime` for one serial.
 * Emits one 'line' event per log entry. Optional bundleId substring filter
 * is applied before emit (matches baguette's iOS-side `--process` semantics
 * for the Android side, without using the platform-specific filterspec).
 */
import { EventEmitter } from 'events';
import { spawn as nodeSpawn, type ChildProcess } from 'child_process';

export type LogPriority = 'V' | 'D' | 'I' | 'W' | 'E';

export interface AndroidLogStartOptions {
  priority?: LogPriority;
  bundleId?: string;
  /** Accepted for cross-platform API parity; ignored on Android. */
  predicate?: string;
}

type AdbSpawn = (args: string[]) => ChildProcess;

export class AndroidLogStream extends EventEmitter {
  private proc: ChildProcess | null = null;
  private adbSpawn: AdbSpawn;

  constructor(opts: { adbSpawn?: AdbSpawn } = {}) {
    super();
    this.adbSpawn = opts.adbSpawn ?? ((args) => nodeSpawn('adb', args));
  }

  async start(serial: string, opts: AndroidLogStartOptions = {}): Promise<void> {
    if (this.proc) await this.stop();
    const args: string[] = ['-s', serial, 'logcat', '-v', 'threadtime'];
    if (opts.priority) args.push(`*:${opts.priority}`);

    this.proc = this.adbSpawn(args);
    this.proc.stdout?.setEncoding('utf-8');

    let buf = '';
    this.proc.stdout?.on('data', (chunk: string) => {
      buf += chunk;
      let idx: number;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        if (opts.bundleId && !line.includes(opts.bundleId)) continue;
        this.emit('line', line);
      }
    });
    this.proc.on('exit', (code) => {
      this.emit('stopped', `adb exited ${code}`);
    });
  }

  async stop(): Promise<void> {
    if (!this.proc) return;
    try {
      this.proc.kill('SIGTERM');
    } catch { /* already dead */ }
    this.proc = null;
  }
}
