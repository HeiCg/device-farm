/**
 * Phase 36 / Plan 36-02 — `adb connect` argv-array spawn wrapper (PAIR-WIRELESS).
 *
 * Uses node:child_process.execFile (argv form — NEVER shell string) to run
 * `adb connect <host>:<port>` with a 15s timeout. Parses output into a
 * discriminated ConnectResult.
 *
 * Failure reasons:
 *   - 'refused' — stderr/stdout matches /refused/i
 *   - 'timeout' — err.killed === true (15s timeout)
 *   - 'unknown' — anything else
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type ConnectResult =
  | { ok: true; host: string; port: number }
  | { ok: false; reason: 'refused' | 'timeout' | 'unknown'; rawStderr: string };

const SUCCESS_RE = /connected to ([^\s]+)/i;
const HOST_PORT_RE = /^(.+):(\d+)$/;

export async function adbConnect(host: string, port: number): Promise<ConnectResult> {
  try {
    const { stdout, stderr } = await execFileAsync(
      'adb',
      ['connect', `${host}:${port}`],
      { timeout: 15_000 },
    );
    const combined = `${stdout}\n${stderr}`;
    if (/refused/i.test(combined)) {
      return { ok: false, reason: 'refused', rawStderr: combined };
    }
    const m = SUCCESS_RE.exec(stdout);
    if (!m) {
      return { ok: false, reason: 'unknown', rawStderr: combined };
    }
    const ep = HOST_PORT_RE.exec(m[1]!);
    if (!ep) {
      // Use the original args when parsing failed
      return { ok: true, host, port };
    }
    return { ok: true, host: ep[1]!, port: Number(ep[2]) };
  } catch (err: unknown) {
    const e = err as { killed?: boolean; stderr?: string; message?: string };
    const stderr = e.stderr ?? e.message ?? '';
    if (e.killed) return { ok: false, reason: 'timeout', rawStderr: stderr };
    if (/refused/i.test(stderr)) return { ok: false, reason: 'refused', rawStderr: stderr };
    return { ok: false, reason: 'unknown', rawStderr: stderr };
  }
}
