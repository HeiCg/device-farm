import { execFile } from 'node:child_process';

export interface RunResult {
  stdout: string;
  stderr: string;
}

export function runCmd(cmd: string, args: string[], timeoutMs = 60_000): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const e = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
        e.stdout = stdout?.toString();
        e.stderr = stderr?.toString();
        reject(e);
        return;
      }
      resolve({ stdout: stdout.toString(), stderr: stderr.toString() });
    });
  });
}

export async function adb(serial: string, args: string[], timeoutMs?: number): Promise<RunResult> {
  return runCmd('adb', ['-s', serial, ...args], timeoutMs);
}

export async function adbShell(serial: string, args: string[], timeoutMs?: number): Promise<RunResult> {
  return adb(serial, ['shell', ...args], timeoutMs);
}

export async function simctl(args: string[], timeoutMs?: number): Promise<RunResult> {
  return runCmd('xcrun', ['simctl', ...args], timeoutMs);
}
