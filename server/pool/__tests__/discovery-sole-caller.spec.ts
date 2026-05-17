/**
 * Phase 36 / Plan 36-01 — Discovery sole-caller grep-guard spec.
 *
 * Runtime enforcement of the `no-bare-adb-list-outside-discovery` invariant
 * from dep-cruiser rule 13. dep-cruiser is path-based and cannot grep file
 * contents — this spec walks `server/` looking for bare `adb devices` and
 * bare `simctl list devices` regex matches and asserts they only appear
 * under `server/pool/internal/discovery/adapters/`.
 *
 * Regex design notes:
 *   - `(?<![.\w])` negative lookbehind ensures we only match top-level
 *     `execFile(...)` / `execFileAsync(...)` calls — NOT member-access
 *     forms like `this.execFile(...)` or `deps.execFile(...)` (those are
 *     dependency-injected wrappers, not bare native shell-outs).
 *   - The `'devices'` literal must be the FINAL argv element (followed by
 *     `]` or `)` modulo options). Calls like
 *     `simctl list devices <UDID> -j` (a per-UDID probe) do NOT match
 *     because a non-flag argument follows `'devices'`.
 *   - Per-device probes (`adb -s X get-state`, `adb -s X shell ...`,
 *     `simctl bootstatus <udid>`) never include the `'devices'` literal
 *     so they are unconditionally allowed.
 */
import { describe, it, expect } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

/** Matches bare `execFile(...) / execFileAsync(...)` calls (not `.execFile(...)`)
 *  whose argv contains `'adb'` followed by `'devices'` as the LAST positional
 *  arg (only flags `'-l'` etc. allowed after). */
const BARE_ADB_LIST = /(?<![.\w])execFile(?:Async)?\s*\(\s*['"]adb['"]\s*,\s*\[[^\]]*['"]devices['"](?:\s*,\s*['"]-{1,2}[a-zA-Z][a-zA-Z0-9-]*['"])*\s*\]/;

/** Matches bare `execFile(...) / execFileAsync(...)` calls whose argv contains
 *  `'xcrun'` ... `'simctl'` ... `'list'` ... `'devices'` followed only by
 *  flags (so per-UDID forms `simctl list devices <UDID> -j` are excluded —
 *  the UDID is a non-flag positional). Flag pattern allows both short
 *  (`-j`) and long (`--json`) forms. */
const BARE_SIMCTL_LIST = /(?<![.\w])execFile(?:Async)?\s*\(\s*['"]xcrun['"]\s*,\s*\[[^\]]*['"]simctl['"][^\]]*['"]list['"][^\]]*['"]devices['"](?:\s*,\s*['"]-{1,2}[a-zA-Z][a-zA-Z0-9-]*['"])*\s*\]/;

const ALLOWED_PREFIX = path.join('server', 'pool', 'internal', 'discovery', 'adapters');

async function walk(dir: string, acc: string[] = []): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (
        e.name === 'node_modules' ||
        e.name === '__tests__' ||
        e.name === '__fixtures__' ||
        e.name === 'dist'
      ) {
        continue;
      }
      await walk(full, acc);
    } else if (e.isFile() && (full.endsWith('.ts') || full.endsWith('.js'))) {
      acc.push(full);
    }
  }
  return acc;
}

describe('[Phase 36-01 DISC-SVC] discovery adapters are the sole bare adb/simctl list callers', () => {
  it('only adapters/* contains bare `adb devices` shell-outs', async () => {
    const files = await walk('server');
    const offenders: string[] = [];
    for (const f of files) {
      const text = await readFile(f, 'utf-8');
      if (BARE_ADB_LIST.test(text) && !f.includes(ALLOWED_PREFIX)) {
        offenders.push(f);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('only adapters/* contains bare `simctl list devices` shell-outs', async () => {
    const files = await walk('server');
    const offenders: string[] = [];
    for (const f of files) {
      const text = await readFile(f, 'utf-8');
      if (BARE_SIMCTL_LIST.test(text) && !f.includes(ALLOWED_PREFIX)) {
        offenders.push(f);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('adapters/android.ts DOES contain bare `adb devices` (positive control)', async () => {
    const text = await readFile(
      path.join('server', 'pool', 'internal', 'discovery', 'adapters', 'android.ts'),
      'utf-8',
    );
    expect(BARE_ADB_LIST.test(text)).toBe(true);
  });

  it('adapters/ios.ts DOES contain bare `simctl list devices` (positive control)', async () => {
    const text = await readFile(
      path.join('server', 'pool', 'internal', 'discovery', 'adapters', 'ios.ts'),
      'utf-8',
    );
    expect(BARE_SIMCTL_LIST.test(text)).toBe(true);
  });

  it('per-device probes (adb -s X get-state) do not match the bare-list regex', () => {
    expect(BARE_ADB_LIST.test("execFile('adb', ['-s', 'emu-1', 'get-state'])")).toBe(false);
    expect(BARE_ADB_LIST.test("execFileAsync('adb', ['-s', serial, 'shell', 'getprop', 'foo'])")).toBe(false);
  });

  it('per-UDID simctl list (simctl list devices <udid> -j) does not match the bare-list regex', () => {
    expect(BARE_SIMCTL_LIST.test("execFileAsync('xcrun', ['simctl', 'list', 'devices', udid, '-j'])")).toBe(false);
    expect(BARE_SIMCTL_LIST.test("execFile('xcrun', ['simctl', 'list', 'devices', 'ABC-123-XYZ', '-j'])")).toBe(false);
  });

  it('member-call form (this.execFile / deps.execFile) does not match (DI wrappers)', () => {
    expect(BARE_ADB_LIST.test("this.execFile('adb', ['devices'])")).toBe(false);
    expect(BARE_SIMCTL_LIST.test("this.execFile('xcrun', ['simctl', 'list', 'devices', '-j'])")).toBe(false);
  });
});
