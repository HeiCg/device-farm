/**
 * Phase 36 / Plan 36-02 — `adb connect` wrapper tests (PAIR-WIRELESS).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

type Outcome =
  | { stdout: string; stderr?: string }
  | { error: Error & { stderr?: string; killed?: boolean } };
let nextOutcome: Outcome = { stdout: '' };

vi.mock('node:util', async () => {
  const actual = await vi.importActual<typeof import('node:util')>('node:util');
  return {
    ...actual,
    promisify: (_fn: unknown) => async (_c: string, _a: string[], _o?: unknown) => {
      const o = nextOutcome;
      if ('error' in o) throw o.error;
      return { stdout: o.stdout, stderr: o.stderr ?? '' };
    },
  };
});

import { adbConnect } from '../../internal/wireless/connect.js';

beforeEach(() => {
  nextOutcome = { stdout: '' };
});

describe('[Phase 36-02] adb connect wrapper', () => {
  it('parses successful `connected to host:port`', async () => {
    nextOutcome = { stdout: 'connected to 192.168.1.42:5555\n' };
    const result = await adbConnect('192.168.1.42', 5555);
    expect(result).toEqual({ ok: true, host: '192.168.1.42', port: 5555 });
  });

  it('stderr `Connection refused` → reason=refused', async () => {
    const err = new Error('fail') as Error & { stderr?: string };
    err.stderr = 'failed to connect: Connection refused\n';
    nextOutcome = { error: err };
    const result = await adbConnect('192.168.1.42', 5555);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('refused');
  });

  it('timeout (err.killed) → reason=timeout', async () => {
    const err = new Error('Killed') as Error & { killed?: boolean };
    err.killed = true;
    nextOutcome = { error: err };
    const result = await adbConnect('192.168.1.42', 5555);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('timeout');
  });
});
