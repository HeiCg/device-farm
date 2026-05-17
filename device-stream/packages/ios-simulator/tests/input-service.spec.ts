import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import { InputService } from '../src/input-service.js';

interface FakeProc extends EventEmitter {
  stdin: PassThrough;
  stdout: PassThrough;
  stderr: PassThrough;
  kill: ReturnType<typeof vi.fn>;
}

function makeFakeProc(): FakeProc {
  const ee = new EventEmitter() as FakeProc;
  ee.stdin = new PassThrough();
  ee.stdout = new PassThrough();
  ee.stderr = new PassThrough();
  ee.kill = vi.fn();
  return ee;
}

function makeSpawn(proc: FakeProc) {
  return vi.fn().mockReturnValue(proc);
}

/** Capture each line written to stdin. */
function captureStdinLines(proc: FakeProc): string[] {
  const lines: string[] = [];
  let buf = '';
  proc.stdin.on('data', (chunk: Buffer) => {
    buf += chunk.toString('utf-8');
    let idx: number;
    while ((idx = buf.indexOf('\n')) >= 0) {
      lines.push(buf.slice(0, idx));
      buf = buf.slice(idx + 1);
    }
  });
  return lines;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('InputService', () => {
  it('writes the tap envelope verbatim and resolves on a matching ack', async () => {
    const proc = makeFakeProc();
    const spawn = makeSpawn(proc);
    const svc = new InputService({ binary: '/fake/sim-input', spawn: spawn as any });
    const lines = captureStdinLines(proc);

    const tapPromise = svc.tap('UDID-A', { x: 100, y: 200, width: 390, height: 844 });

    // Let the microtask drain so the write lands in the PassThrough.
    await new Promise((r) => setImmediate(r));

    expect(spawn).toHaveBeenCalledWith('/fake/sim-input', ['--udid', 'UDID-A']);
    expect(lines).toHaveLength(1);
    const env = JSON.parse(lines[0]!);
    expect(env).toMatchObject({
      type: 'tap',
      x: 100,
      y: 200,
      screenWidth: 390,
      screenHeight: 844,
    });
    expect(typeof env.id).toBe('number');

    proc.stdout.write(JSON.stringify({ id: env.id, ok: true }) + '\n');
    await expect(tapPromise).resolves.toBeUndefined();
  });

  it('resolves the correct caller when two taps are queued (id-match)', async () => {
    const proc = makeFakeProc();
    const spawn = makeSpawn(proc);
    const svc = new InputService({ binary: '/fake/sim-input', spawn: spawn as any });
    const lines = captureStdinLines(proc);

    const p1 = svc.tap('UDID-B', { x: 1, y: 1, width: 10, height: 10 });
    const p2 = svc.tap('UDID-B', { x: 2, y: 2, width: 10, height: 10 });

    await new Promise((r) => setImmediate(r));
    expect(lines).toHaveLength(2);
    const env1 = JSON.parse(lines[0]!);
    const env2 = JSON.parse(lines[1]!);
    expect(env1.id).not.toBe(env2.id);

    // Ack the SECOND request first — id-match should still resolve p2.
    proc.stdout.write(JSON.stringify({ id: env2.id, ok: true }) + '\n');
    await expect(p2).resolves.toBeUndefined();

    // Now ack the first.
    proc.stdout.write(JSON.stringify({ id: env1.id, ok: true }) + '\n');
    await expect(p1).resolves.toBeUndefined();
  });

  it('falls back to FIFO when the ack omits id', async () => {
    const proc = makeFakeProc();
    const spawn = makeSpawn(proc);
    const svc = new InputService({ binary: '/fake/sim-input', spawn: spawn as any });

    const p1 = svc.tap('UDID-C', { x: 1, y: 1, width: 10, height: 10 });
    const p2 = svc.tap('UDID-C', { x: 2, y: 2, width: 10, height: 10 });

    await new Promise((r) => setImmediate(r));

    // No id field → FIFO: first ack resolves p1.
    proc.stdout.write(JSON.stringify({ ok: true }) + '\n');
    await expect(p1).resolves.toBeUndefined();
    proc.stdout.write(JSON.stringify({ ok: true }) + '\n');
    await expect(p2).resolves.toBeUndefined();
  });

  it('rejects when sim-input returns ok=false with an error message', async () => {
    const proc = makeFakeProc();
    const spawn = makeSpawn(proc);
    const svc = new InputService({ binary: '/fake/sim-input', spawn: spawn as any });
    const lines = captureStdinLines(proc);

    const tapPromise = svc.tap('UDID-D', { x: 0, y: 0, width: 1, height: 1 });
    await new Promise((r) => setImmediate(r));
    const env = JSON.parse(lines[0]!);

    proc.stdout.write(JSON.stringify({ id: env.id, ok: false, error: 'tap failed' }) + '\n');
    await expect(tapPromise).rejects.toThrow(/tap failed/);
  });

  it('rejects all pending promises when the child process exits', async () => {
    const proc = makeFakeProc();
    const spawn = makeSpawn(proc);
    const svc = new InputService({ binary: '/fake/sim-input', spawn: spawn as any });

    const p1 = svc.tap('UDID-E', { x: 0, y: 0, width: 1, height: 1 });
    const p2 = svc.swipe('UDID-E', { fromX: 0, fromY: 0, toX: 1, toY: 1 });

    await new Promise((r) => setImmediate(r));

    proc.emit('exit', 1, null);

    await expect(p1).rejects.toThrow(/sim-input exited/);
    await expect(p2).rejects.toThrow(/sim-input exited/);
  });

  it('resolves releaseKey on the binary no-op ack', async () => {
    const proc = makeFakeProc();
    const spawn = makeSpawn(proc);
    const svc = new InputService({ binary: '/fake/sim-input', spawn: spawn as any });
    const lines = captureStdinLines(proc);

    const releasePromise = svc.releaseKey('UDID-F', 40);
    await new Promise((r) => setImmediate(r));

    const env = JSON.parse(lines[0]!);
    expect(env).toMatchObject({ type: 'release', key: 40 });
    expect(typeof env.id).toBe('number');

    proc.stdout.write(JSON.stringify({ id: env.id, ok: true }) + '\n');
    await expect(releasePromise).resolves.toBeUndefined();
  });

  it('stop() kills the child with SIGTERM and rejects pending entries', async () => {
    const proc = makeFakeProc();
    const spawn = makeSpawn(proc);
    const svc = new InputService({ binary: '/fake/sim-input', spawn: spawn as any });

    const p = svc.tap('UDID-G', { x: 0, y: 0, width: 1, height: 1 });
    await new Promise((r) => setImmediate(r));

    await svc.stop('UDID-G');
    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
    await expect(p).rejects.toThrow(/stopped/);
  });
});
