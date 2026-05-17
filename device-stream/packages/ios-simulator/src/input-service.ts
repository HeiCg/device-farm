/**
 * InputService — long-lived `sim-input` child process per UDID with a
 * per-call FIFO ack queue. Mirrors baguette's input dispatch surface
 * (tap / swipe / press / release / text) over JSON lines on stdin,
 * with `{id, ok}` acks on stdout.
 *
 * The sim-input binary is built from `device-stream/tools/sim-input/`
 * and emits `{"id":<int>,"ok":true|false[,"error":"..."]}` per command.
 * Acks include the `id` so we match by id when present; otherwise we
 * fall back to FIFO (pop the head of the per-UDID pending queue).
 */
import { spawn as nodeSpawn, type ChildProcess } from 'child_process';
import * as path from 'path';

export type SpawnLike = typeof nodeSpawn;

export interface InputServiceOptions {
  /** Override the path to the sim-input binary. */
  binary?: string;
  /** Override the spawn implementation (for tests). */
  spawn?: SpawnLike;
}

export interface TapArgs {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Reserved — sim-input currently treats tap as instantaneous. */
  duration?: number;
}

export interface SwipeArgs {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  durationMs?: number;
  width?: number;
  height?: number;
}

interface PendingAck {
  id: number;
  resolve: () => void;
  reject: (err: Error) => void;
}

interface ProcEntry {
  proc: ChildProcess;
  pending: PendingAck[];
  buffer: string;
}

const DEFAULT_BINARY = path.resolve(
  __dirname,
  '../../../tools/sim-input/.build/release/sim-input'
);

export class InputService {
  private readonly binary: string;
  private readonly spawnFn: SpawnLike;
  private readonly procs = new Map<string, ProcEntry>();
  private nextId = 1;

  constructor(opts: InputServiceOptions = {}) {
    this.binary = opts.binary ?? DEFAULT_BINARY;
    this.spawnFn = opts.spawn ?? nodeSpawn;
  }

  // ---- public surface ----

  tap(udid: string, args: TapArgs): Promise<void> {
    return this.send(udid, {
      type: 'tap',
      x: args.x,
      y: args.y,
      screenWidth: args.width,
      screenHeight: args.height,
    });
  }

  swipe(udid: string, args: SwipeArgs): Promise<void> {
    const env: Record<string, unknown> = {
      type: 'swipe',
      fromX: args.fromX,
      fromY: args.fromY,
      toX: args.toX,
      toY: args.toY,
      durationMs: args.durationMs ?? 250,
    };
    if (args.width !== undefined) env.screenWidth = args.width;
    if (args.height !== undefined) env.screenHeight = args.height;
    return this.send(udid, env);
  }

  pressKey(udid: string, key: number): Promise<void> {
    return this.send(udid, { type: 'press', key });
  }

  releaseKey(udid: string, key: number): Promise<void> {
    // sim-input acks release as a no-op (press brackets down+up
    // atomically). We still go through the wire so callers can
    // observe ordering w.r.t. other queued commands.
    return this.send(udid, { type: 'release', key });
  }

  typeText(udid: string, text: string): Promise<void> {
    return this.send(udid, { type: 'text', text });
  }

  /**
   * Raw escape hatch — write an arbitrary envelope. The service
   * stamps `id` onto the object before writing.
   */
  send(udid: string, envelope: object): Promise<void> {
    const entry = this.ensureProc(udid);
    const id = this.nextId++;
    return new Promise<void>((resolve, reject) => {
      const stamped = { id, ...envelope };
      const line = JSON.stringify(stamped) + '\n';
      entry.pending.push({ id, resolve, reject });
      const stdin = entry.proc.stdin;
      if (!stdin || stdin.destroyed) {
        // Remove the pending entry we just enqueued and reject.
        const idx = entry.pending.findIndex((p) => p.id === id);
        if (idx >= 0) entry.pending.splice(idx, 1);
        reject(new Error('sim-input stdin is not writable'));
        return;
      }
      stdin.write(line, (err) => {
        if (err) {
          const idx = entry.pending.findIndex((p) => p.id === id);
          if (idx >= 0) entry.pending.splice(idx, 1);
          reject(err);
        }
      });
    });
  }

  async stop(udid: string): Promise<void> {
    const entry = this.procs.get(udid);
    if (!entry) return;
    this.procs.delete(udid);
    this.rejectAll(entry, new Error('sim-input stopped'));
    try {
      entry.proc.kill('SIGTERM');
    } catch {
      /* already dead */
    }
  }

  async stopAll(): Promise<void> {
    const udids = Array.from(this.procs.keys());
    await Promise.all(udids.map((u) => this.stop(u)));
  }

  // ---- internals ----

  private ensureProc(udid: string): ProcEntry {
    const existing = this.procs.get(udid);
    if (existing) return existing;

    const proc = this.spawnFn(this.binary, ['--udid', udid]);
    const entry: ProcEntry = { proc, pending: [], buffer: '' };
    this.procs.set(udid, entry);

    proc.stdout?.setEncoding('utf-8');
    proc.stdout?.on('data', (chunk: string) => {
      entry.buffer += chunk;
      let idx: number;
      while ((idx = entry.buffer.indexOf('\n')) >= 0) {
        const line = entry.buffer.slice(0, idx);
        entry.buffer = entry.buffer.slice(idx + 1);
        if (line.length === 0) continue;
        this.handleAckLine(entry, line);
      }
    });

    proc.stderr?.setEncoding('utf-8');
    let errBuf = '';
    proc.stderr?.on('data', (chunk: string) => {
      errBuf += chunk;
      let idx: number;
      while ((idx = errBuf.indexOf('\n')) >= 0) {
        const line = errBuf.slice(0, idx);
        errBuf = errBuf.slice(idx + 1);
        if (line.length === 0) continue;
        console.error('[sim-input %s] %s', udid, line);
      }
    });

    proc.on('exit', (code, signal) => {
      // Only reject if the entry is still the current one (i.e. we
      // didn't already remove it during stop()).
      const current = this.procs.get(udid);
      if (current === entry) {
        this.procs.delete(udid);
      }
      const reason = signal
        ? `sim-input exited (signal=${signal})`
        : `sim-input exited (code=${code})`;
      this.rejectAll(entry, new Error(reason));
    });

    proc.on('error', (err) => {
      this.rejectAll(entry, err);
    });

    return entry;
  }

  private handleAckLine(entry: ProcEntry, line: string): void {
    let obj: { id?: number; ok?: boolean; error?: string };
    try {
      obj = JSON.parse(line);
    } catch {
      console.error('[sim-input] failed to parse ack line: %s', line);
      return;
    }
    const ok = obj.ok === true;
    const err = obj.error ?? 'sim-input reported failure';

    if (typeof obj.id === 'number') {
      // Match by id.
      const idx = entry.pending.findIndex((p) => p.id === obj.id);
      if (idx < 0) {
        console.error('[sim-input] no pending entry for ack id=%d', obj.id);
        return;
      }
      const pending = entry.pending.splice(idx, 1)[0]!;
      if (ok) pending.resolve();
      else pending.reject(new Error(err));
      return;
    }

    // FIFO fallback.
    const pending = entry.pending.shift();
    if (!pending) {
      console.error('[sim-input] received ack with empty pending queue');
      return;
    }
    if (ok) pending.resolve();
    else pending.reject(new Error(err));
  }

  private rejectAll(entry: ProcEntry, err: Error): void {
    const pending = entry.pending.splice(0, entry.pending.length);
    for (const p of pending) {
      p.reject(err);
    }
  }
}
