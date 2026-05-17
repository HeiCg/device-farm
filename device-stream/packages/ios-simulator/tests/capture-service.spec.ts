import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

// Mock 'fs' so the AVCC binary is always reported as present.
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return { ...actual, existsSync: vi.fn(() => true) };
});

// Mock child_process.spawn to capture argv and return a fake process.
const spawned: Array<{ cmd: string; args: string[]; proc: FakeProc }> = [];

class FakeStream extends EventEmitter {
  destroyed = false;
  written: string[] = [];
  write(chunk: any): boolean {
    this.written.push(typeof chunk === 'string' ? chunk : chunk.toString());
    return true;
  }
  destroy() { this.destroyed = true; }
}

class FakeProc extends EventEmitter {
  stdin = new FakeStream();
  stdout = new FakeStream();
  stderr = new FakeStream();
  killed = false;
  killSignal: NodeJS.Signals | null = null;
  kill(signal?: NodeJS.Signals | number): boolean {
    this.killed = true;
    this.killSignal = (signal as NodeJS.Signals) ?? 'SIGTERM';
    return true;
  }
}

vi.mock('child_process', () => ({
  spawn: vi.fn((cmd: string, args: string[]) => {
    const proc = new FakeProc();
    spawned.push({ cmd, args, proc });
    return proc as any;
  }),
}));

// Importing AFTER the mocks so the module sees the mocked spawn/fs.
const { CaptureService } = await import('../src/capture-service.js');

describe('CaptureService AVCC mode', () => {
  let prevEnv: string | undefined;
  beforeEach(() => {
    spawned.length = 0;
    // Opt out of the Phase-32 private bridge so these tests exercise the
    // legacy AVCC sim-capture-avcc binary path exclusively.
    prevEnv = process.env.DEVICE_STREAM_SIM_PRIVATE;
    process.env.DEVICE_STREAM_SIM_PRIVATE = '0';
  });

  afterEach(() => {
    vi.clearAllMocks();
    if (prevEnv === undefined) delete process.env.DEVICE_STREAM_SIM_PRIVATE;
    else process.env.DEVICE_STREAM_SIM_PRIVATE = prevEnv;
  });

  it('spawns the AVCC binary with the right argv', async () => {
    const svc = new CaptureService({ avccBinaryPath: '/fake/sim-capture-avcc' });
    const promise = svc.startCapture('UDID-1', { format: 'avcc', fps: 24, bitrate: 6_000_000, scale: 0.5 });

    // Resolution waits up to 1s for first frame; advance fake timers.
    vi.useFakeTimers();
    vi.advanceTimersByTime(1100);
    await promise;
    vi.useRealTimers();

    expect(spawned.length).toBe(1);
    expect(spawned[0].cmd).toBe('/fake/sim-capture-avcc');
    expect(spawned[0].args).toEqual([
      '--udid', 'UDID-1',
      '--fps', '24',
      '--bitrate', '6000000',
      '--scale', '0.5',
      '--format', 'avcc',
    ]);
  });

  it('setBitrate writes a JSON line to the child stdin', async () => {
    const svc = new CaptureService({ avccBinaryPath: '/fake/sim-capture-avcc' });
    vi.useFakeTimers();
    const promise = svc.startCapture('UDID-2', { format: 'avcc' });
    vi.advanceTimersByTime(1100);
    await promise;
    vi.useRealTimers();

    await svc.setBitrate('UDID-2', 8_000_000);

    const stdin = spawned[0].proc.stdin;
    const last = stdin.written[stdin.written.length - 1];
    expect(last).toBe(JSON.stringify({ type: 'set_bitrate', bps: 8_000_000 }) + '\n');
  });

  it('forceIdr and snapshot also push JSON lines to stdin', async () => {
    const svc = new CaptureService({ avccBinaryPath: '/fake/sim-capture-avcc' });
    vi.useFakeTimers();
    const promise = svc.startCapture('UDID-3', { format: 'avcc' });
    vi.advanceTimersByTime(1100);
    await promise;
    vi.useRealTimers();

    await svc.forceIdr('UDID-3');
    await svc.snapshot('UDID-3');

    const lines = spawned[0].proc.stdin.written;
    expect(lines).toContain(JSON.stringify({ type: 'force_idr' }) + '\n');
    expect(lines).toContain(JSON.stringify({ type: 'snapshot' }) + '\n');
  });

  it('stop() SIGTERMs the child', async () => {
    const svc = new CaptureService({ avccBinaryPath: '/fake/sim-capture-avcc' });
    vi.useFakeTimers();
    const start = svc.startCapture('UDID-4', { format: 'avcc' });
    vi.advanceTimersByTime(1100);
    await start;

    const stop = svc.stop('UDID-4');
    // Simulate the child exiting in response to SIGTERM.
    spawned[0].proc.emit('exit', 0, 'SIGTERM');
    vi.advanceTimersByTime(3100);
    await stop;
    vi.useRealTimers();

    expect(spawned[0].proc.killed).toBe(true);
    expect(spawned[0].proc.killSignal).toBe('SIGTERM');
  });

  it('parses length-prefixed AVCC frames and emits frame events', async () => {
    const svc = new CaptureService({ avccBinaryPath: '/fake/sim-capture-avcc' });
    vi.useFakeTimers();
    const start = svc.startCapture('UDID-5', { format: 'avcc' });
    vi.advanceTimersByTime(1100);
    await start;
    vi.useRealTimers();

    const frames: Array<{ udid: string; kind: string; payload: Buffer }> = [];
    svc.on('frame', (f: any) => frames.push(f));

    // Compose a single AVCC keyframe wire frame: len(4 BE) | tag(0x02) | payload.
    const payload = Buffer.from([0xDE, 0xAD, 0xBE, 0xEF]);
    const wire = Buffer.alloc(4 + 1 + payload.length);
    wire.writeUInt32BE(1 + payload.length, 0);
    wire[4] = 0x02;
    payload.copy(wire, 5);

    spawned[0].proc.stdout.emit('data', wire);

    expect(frames.length).toBe(1);
    expect(frames[0].udid).toBe('UDID-5');
    expect(frames[0].kind).toBe('keyframe');
    expect(Buffer.from(frames[0].payload).equals(payload)).toBe(true);
  });

  it('queues bitrate target even before a child is spawned', async () => {
    const svc = new CaptureService({ avccBinaryPath: '/fake/sim-capture-avcc' });
    await svc.setBitrate('UDID-pre', 3_000_000);
    expect(svc.getQueuedTargets('UDID-pre')).toMatchObject({ bps: 3_000_000 });
  });
});
