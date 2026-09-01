import { spawn } from 'node:child_process';
import { resolve, relative, isAbsolute } from 'node:path';
import type pino from 'pino';
import { createMarkerParser } from './inter-stage-env.js';

export interface DeviceStreamScriptOpts {
  workspaceDir: string;
  scriptPath: string;
  env: Record<string, string>;
  timeoutSec: number;
  onLog(line: string): void;
  onExport(key: string, value: string, opts?: { secret?: boolean }): void;
  logger: pino.Logger;
  /** Secret values from earlier stages to mask in this stage's log lines. */
  secretValues?: string[];
}

export interface DeviceStreamScriptResult {
  ok: boolean;
  exitCode?: number;
  timedOut?: boolean;
  error?: string;
}

export async function runDeviceStreamScript(
  opts: DeviceStreamScriptOpts,
): Promise<DeviceStreamScriptResult> {
  const absScript = isAbsolute(opts.scriptPath)
    ? opts.scriptPath
    : resolve(opts.workspaceDir, opts.scriptPath);
  const rel = relative(opts.workspaceDir, absScript);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    return {
      ok: false,
      error: `path traversal: scriptPath ${opts.scriptPath} escapes workspaceDir`,
    };
  }

  const parser = createMarkerParser(
    { set: (k, v, o) => opts.onExport(k, v, o), log: (l) => opts.onLog(l) },
    { secretNames: ['PASSWORD', 'PAT', 'TOKEN'], secretValues: opts.secretValues },
  );

  return new Promise((resolveOuter) => {
    const proc = spawn('node', [absScript], {
      cwd: opts.workspaceDir,
      env: { ...process.env, ...opts.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGTERM');
      setTimeout(() => proc.kill('SIGKILL'), 5000).unref();
    }, opts.timeoutSec * 1000);

    proc.stdout.setEncoding('utf8');
    proc.stderr.setEncoding('utf8');
    proc.stdout.on('data', (c: string) => parser.write(c));
    proc.stderr.on('data', (c: string) => parser.write(c));

    proc.on('exit', (code) => {
      clearTimeout(timer);
      parser.end();
      if (timedOut) {
        resolveOuter({ ok: false, timedOut: true, error: `timeout after ${opts.timeoutSec}s` });
      } else if (code === 0) {
        resolveOuter({ ok: true, exitCode: 0 });
      } else {
        resolveOuter({ ok: false, exitCode: code ?? -1, error: `exit ${code}` });
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      resolveOuter({ ok: false, error: err.message });
    });
  });
}
