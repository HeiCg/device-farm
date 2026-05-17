import { describe, it, expect, vi } from 'vitest';
import { PassThrough } from 'stream';
import { AndroidLogStream } from '../src/log-stream.js';

describe('AndroidLogStream', () => {
  it('emits one log event per line from adb logcat stdout', async () => {
    const fakeProc: any = { stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(), on: vi.fn() };
    const spawn = vi.fn().mockReturnValue(fakeProc);
    const stream = new AndroidLogStream({ adbSpawn: spawn as any });
    const seen: string[] = [];
    stream.on('line', (l: string) => seen.push(l));
    await stream.start('emulator-5554', { priority: 'I' });
    fakeProc.stdout.write('one\n');
    fakeProc.stdout.write('two\n');
    fakeProc.stdout.end();
    await new Promise((r) => setTimeout(r, 10));
    expect(seen).toEqual(['one', 'two']);
  });

  it('passes -v threadtime and serial to adb', async () => {
    const fakeProc: any = { stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(), on: vi.fn() };
    const spawn = vi.fn().mockReturnValue(fakeProc);
    const stream = new AndroidLogStream({ adbSpawn: spawn as any });
    await stream.start('emulator-5554', {});
    expect(spawn).toHaveBeenCalledWith(['-s', 'emulator-5554', 'logcat', '-v', 'threadtime']);
  });

  it('appends *:<priority> filterspec when priority is given', async () => {
    const fakeProc: any = { stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(), on: vi.fn() };
    const spawn = vi.fn().mockReturnValue(fakeProc);
    const stream = new AndroidLogStream({ adbSpawn: spawn as any });
    await stream.start('emulator-5554', { priority: 'I' });
    const args = spawn.mock.calls[0][0] as string[];
    expect(args[args.length - 1]).toBe('*:I');
  });

  it('filters out lines that do not contain bundleId when supplied', async () => {
    const fakeProc: any = { stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(), on: vi.fn() };
    const spawn = vi.fn().mockReturnValue(fakeProc);
    const stream = new AndroidLogStream({ adbSpawn: spawn as any });
    const seen: string[] = [];
    stream.on('line', (l: string) => seen.push(l));
    await stream.start('emulator-5554', { bundleId: 'com.argonav' });
    fakeProc.stdout.write('I/foo: com.argonav started\n');
    fakeProc.stdout.write('I/bar: other.app activity\n');
    fakeProc.stdout.end();
    await new Promise((r) => setTimeout(r, 10));
    expect(seen).toEqual(['I/foo: com.argonav started']);
  });

  it('stop() kills the child process with SIGTERM', async () => {
    const fakeProc: any = { stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(), on: vi.fn() };
    const spawn = vi.fn().mockReturnValue(fakeProc);
    const stream = new AndroidLogStream({ adbSpawn: spawn as any });
    await stream.start('emulator-5554', {});
    await stream.stop();
    expect(fakeProc.kill).toHaveBeenCalledWith('SIGTERM');
  });
});
