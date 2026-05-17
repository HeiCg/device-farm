/**
 * Phase 36 / Plan 36-02 — `adb pair` argv-array spawn wrapper (PAIR-WIRELESS).
 *
 * Uses node:child_process.execFile (argv form — NEVER shell string) to run
 * `adb pair <host>:<port> <pin>` with a 30s timeout and parses
 * stdout/stderr into a discriminated PairResult.
 *
 * Success regex: /Successfully paired to ([^\s]+) \[guid=([^\]]+)\]/
 *   The host:port captured here is the post-pair adb-connect endpoint
 *   the device advertises (distinct from the pairing port).
 *
 * Failure reasons:
 *   - 'auth'    — stderr matches /failed to authenticate/i
 *   - 'resolve' — stderr matches /cannot resolve/i
 *   - 'timeout' — err.killed === true (30s timeout reached)
 *   - 'unknown' — anything else
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type PairResult =
  | { ok: true;  guid: string; host: string; port: number }
  | { ok: false; reason: 'auth' | 'timeout' | 'resolve' | 'unknown'; rawStderr: string };

const SUCCESS_RE = /Successfully paired to ([^\s]+) \[guid=([^\]]+)\]/;
const HOST_PORT_RE = /^(.+):(\d+)$/;

export async function adbPair(host: string, port: number, pin: string): Promise<PairResult> {
  try {
    const { stdout } = await execFileAsync(
      'adb',
      ['pair', `${host}:${port}`, pin],
      { timeout: 30_000 },
    );
    const m = SUCCESS_RE.exec(stdout);
    if (!m) {
      return { ok: false, reason: 'unknown', rawStderr: stdout };
    }
    const endpoint = m[1]!;
    const guid = m[2]!;
    const ep = HOST_PORT_RE.exec(endpoint);
    if (!ep) {
      return { ok: false, reason: 'unknown', rawStderr: stdout };
    }
    return {
      ok: true,
      guid,
      host: ep[1]!,
      port: Number(ep[2]),
    };
  } catch (err: unknown) {
    const e = err as { killed?: boolean; stderr?: string; message?: string };
    const stderr = e.stderr ?? e.message ?? '';
    if (e.killed) return { ok: false, reason: 'timeout', rawStderr: stderr };
    if (/failed to authenticate/i.test(stderr)) return { ok: false, reason: 'auth', rawStderr: stderr };
    if (/cannot resolve/i.test(stderr)) return { ok: false, reason: 'resolve', rawStderr: stderr };
    return { ok: false, reason: 'unknown', rawStderr: stderr };
  }
}
