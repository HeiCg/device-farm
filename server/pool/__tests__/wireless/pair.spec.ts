/**
 * Phase 36 / Plan 36-02 — `adb pair` wrapper tests (PAIR-WIRELESS).
 *
 * Mocks the promisified spawn helper so we can inject canned
 * stdout/stderr/throw scenarios.
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
    promisify: (_fn: unknown) => {
      return async (_c: string, _a: string[], _o?: unknown) => {
        const o = nextOutcome;
        if ('error' in o) {
          throw o.error;
        }
        return { stdout: o.stdout, stderr: o.stderr ?? '' };
      };
    },
  };
});

import { adbPair } from '../../internal/wireless/pair.js';

beforeEach(() => {
  nextOutcome = { stdout: '' };
});

describe('[Phase 36-02] adb pair wrapper', () => {
  it('parses successful stdout `Successfully paired to host:port [guid=adb-XYZ]`', async () => {
    nextOutcome = {
      stdout: 'Successfully paired to 192.168.1.42:33861 [guid=adb-XYZ]\n',
    };
    const result = await adbPair('192.168.1.42', 12345, '123456');
    expect(result).toEqual({
      ok: true,
      guid: 'adb-XYZ',
      host: '192.168.1.42',
      port: 33861,
    });
  });

  it('stderr `failed to authenticate` → reason=auth', async () => {
    const err = new Error('Command failed') as Error & { stderr?: string };
    err.stderr = 'adb: failed to authenticate to 192.168.1.42:12345\n';
    nextOutcome = { error: err };
    const result = await adbPair('192.168.1.42', 12345, '000000');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('auth');
  });

  it('timeout (err.killed === true) → reason=timeout', async () => {
    const err = new Error('Killed') as Error & { killed?: boolean };
    err.killed = true;
    nextOutcome = { error: err };
    const result = await adbPair('192.168.1.42', 12345, '000000');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('timeout');
  });

  it('stderr `cannot resolve host` → reason=resolve', async () => {
    const err = new Error('failed') as Error & { stderr?: string };
    err.stderr = 'adb: cannot resolve host: bogus\n';
    nextOutcome = { error: err };
    const result = await adbPair('bogus', 12345, '000000');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('resolve');
  });

  it('unrecognised failure → reason=unknown', async () => {
    const err = new Error('weird internal error') as Error & { stderr?: string };
    err.stderr = 'segfault\n';
    nextOutcome = { error: err };
    const result = await adbPair('192.168.1.42', 12345, '000000');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('unknown');
  });
});
