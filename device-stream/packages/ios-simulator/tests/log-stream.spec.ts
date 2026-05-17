import { describe, it, expect, vi } from 'vitest';
import { PassThrough } from 'stream';
import { IOSSimulatorLogStream } from '../src/log-stream.js';

describe('IOSSimulatorLogStream', () => {
  it('emits one log event per line from xcrun stdout', async () => {
    const fakeProc: any = { stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(), on: vi.fn() };
    const spawn = vi.fn().mockReturnValue(fakeProc);
    const stream = new IOSSimulatorLogStream({ xcrunSpawn: spawn as any });
    const seen: string[] = [];
    stream.on('line', (l: string) => seen.push(l));
    await stream.start('UDID-1', {});
    fakeProc.stdout.write('hello\n');
    fakeProc.stdout.write('world\n');
    fakeProc.stdout.end();
    await new Promise((r) => setTimeout(r, 10));
    expect(seen).toEqual(['hello', 'world']);
  });

  it('uses simctl spawn <udid> log stream --style ndjson', async () => {
    const fakeProc: any = { stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(), on: vi.fn() };
    const spawn = vi.fn().mockReturnValue(fakeProc);
    const stream = new IOSSimulatorLogStream({ xcrunSpawn: spawn as any });
    await stream.start('UDID-1', {});
    expect(spawn).toHaveBeenCalledWith(['simctl', 'spawn', 'UDID-1', 'log', 'stream', '--style', 'ndjson']);
  });

  it('passes --level when priority is given', async () => {
    const fakeProc: any = { stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(), on: vi.fn() };
    const spawn = vi.fn().mockReturnValue(fakeProc);
    const stream = new IOSSimulatorLogStream({ xcrunSpawn: spawn as any });
    await stream.start('UDID-1', { priority: 'debug' });
    const args = spawn.mock.calls[0][0] as string[];
    const idx = args.indexOf('--level');
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe('debug');
  });

  it('passes --predicate when predicate is given', async () => {
    const fakeProc: any = { stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(), on: vi.fn() };
    const spawn = vi.fn().mockReturnValue(fakeProc);
    const stream = new IOSSimulatorLogStream({ xcrunSpawn: spawn as any });
    await stream.start('UDID-1', { predicate: 'subsystem == "com.apple.UIKit"' });
    const args = spawn.mock.calls[0][0] as string[];
    const idx = args.indexOf('--predicate');
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe('subsystem == "com.apple.UIKit"');
  });

  it('passes --process when bundleId is given', async () => {
    const fakeProc: any = { stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(), on: vi.fn() };
    const spawn = vi.fn().mockReturnValue(fakeProc);
    const stream = new IOSSimulatorLogStream({ xcrunSpawn: spawn as any });
    await stream.start('UDID-1', { bundleId: 'com.apple.MobileSafari' });
    const args = spawn.mock.calls[0][0] as string[];
    const idx = args.indexOf('--process');
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe('com.apple.MobileSafari');
  });

  it('stop() kills the child with SIGTERM', async () => {
    const fakeProc: any = { stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(), on: vi.fn() };
    const spawn = vi.fn().mockReturnValue(fakeProc);
    const stream = new IOSSimulatorLogStream({ xcrunSpawn: spawn as any });
    await stream.start('UDID-1', {});
    await stream.stop();
    expect(fakeProc.kill).toHaveBeenCalledWith('SIGTERM');
  });
});
