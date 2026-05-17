/**
 * IOSSimulatorLogStream — wraps `xcrun simctl spawn <udid> log stream`
 * with ndjson output. Mirrors AndroidLogStream's surface for cross-platform
 * parity. Reference: baguette `docs/features/logs.md`.
 */
import { EventEmitter } from 'events';
import { spawn as nodeSpawn, type ChildProcess } from 'child_process';

export type IOSLogPriority = 'info' | 'debug' | 'default';

export interface IOSLogStartOptions {
  priority?: IOSLogPriority;
  predicate?: string;
  bundleId?: string;
}

type XcrunSpawn = (args: string[]) => ChildProcess;

export class IOSSimulatorLogStream extends EventEmitter {
  private proc: ChildProcess | null = null;
  private xcrunSpawn: XcrunSpawn;

  constructor(opts: { xcrunSpawn?: XcrunSpawn } = {}) {
    super();
    this.xcrunSpawn = opts.xcrunSpawn ?? ((args) => nodeSpawn('xcrun', args));
  }

  async start(udid: string, opts: IOSLogStartOptions = {}): Promise<void> {
    if (this.proc) await this.stop();
    const args: string[] = ['simctl', 'spawn', udid, 'log', 'stream', '--style', 'ndjson'];
    if (opts.priority)  args.push('--level', opts.priority);
    if (opts.predicate) args.push('--predicate', opts.predicate);
    if (opts.bundleId)  args.push('--process', opts.bundleId);

    this.proc = this.xcrunSpawn(args);
    this.proc.stdout?.setEncoding('utf-8');

    let buf = '';
    this.proc.stdout?.on('data', (chunk: string) => {
      buf += chunk;
      let idx: number;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        this.emit('line', line);
      }
    });
    this.proc.on('exit', (code) => {
      this.emit('stopped', `xcrun exited ${code}`);
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
