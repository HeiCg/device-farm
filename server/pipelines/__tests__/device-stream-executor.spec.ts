import { describe, it, expect } from 'vitest';
import { writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runDeviceStreamScript } from '../internal/device-stream-executor.js';

const fakeLogger: any = { info: () => {}, error: () => {}, warn: () => {}, child: () => fakeLogger };

describe('device-stream-script executor', () => {
  it('runs a script that exits 0', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dse-'));
    await writeFile(join(dir, 'ok.js'), `console.log("hello"); process.exit(0);`);

    const lines: string[] = [];
    const result = await runDeviceStreamScript({
      workspaceDir: dir,
      scriptPath: 'ok.js',
      env: { DEVICE_SERIAL: 'emulator-5554' },
      timeoutSec: 10,
      onLog: (l) => lines.push(l),
      onExport: () => {},
      logger: fakeLogger,
    });

    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(lines).toContain('hello');
  });

  it('captures env via marker', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dse-'));
    await writeFile(
      join(dir, 'export.js'),
      `console.log("##device-farm[setvariable name=CODE]xyz123"); process.exit(0);`,
    );

    const exported: Record<string, string> = {};
    const result = await runDeviceStreamScript({
      workspaceDir: dir,
      scriptPath: 'export.js',
      env: {},
      timeoutSec: 10,
      onLog: () => {},
      onExport: (k, v) => { exported[k] = v; },
      logger: fakeLogger,
    });

    expect(result.ok).toBe(true);
    expect(exported).toEqual({ CODE: 'xyz123' });
  });

  it('fails on non-zero exit', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dse-'));
    await writeFile(join(dir, 'fail.js'), `process.exit(2);`);
    const result = await runDeviceStreamScript({
      workspaceDir: dir,
      scriptPath: 'fail.js',
      env: {},
      timeoutSec: 10,
      onLog: () => {},
      onExport: () => {},
      logger: fakeLogger,
    });
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(2);
  });

  it('times out and reports', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dse-'));
    await writeFile(join(dir, 'hang.js'), `setInterval(() => {}, 1000);`);
    const result = await runDeviceStreamScript({
      workspaceDir: dir,
      scriptPath: 'hang.js',
      env: {},
      timeoutSec: 1,
      onLog: () => {},
      onExport: () => {},
      logger: fakeLogger,
    });
    expect(result.ok).toBe(false);
    expect(result.timedOut).toBe(true);
  });

  it('rejects relative paths escaping workspaceDir', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dse-'));
    const result = await runDeviceStreamScript({
      workspaceDir: dir,
      scriptPath: '../escape.js',
      env: {},
      timeoutSec: 5,
      onLog: () => {},
      onExport: () => {},
      logger: fakeLogger,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/path traversal/i);
  });
});
