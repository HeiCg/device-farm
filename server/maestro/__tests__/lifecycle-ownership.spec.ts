/**
 * Phase 24 / Plan 24-04 — Maestro lifecycle ownership grep-guards [SC1].
 *
 * Pure readFileSync structural assertions proving Phase 24 SC1 architectural
 * invariants. No DB, no fastify, no async — runs in <100ms.
 *
 * Six invariants covered:
 *
 *   (a) No source file imports from `pool/device-info-collector` — the
 *       old path is dead after Plan 24-03 git mv (collector relocated to
 *       server/maestro/internal/device-info-collector.ts).
 *
 *   (b) server/maestro/plugin.ts has zero `deviceInfoCollector.collect(`
 *       call sites — the imperative metadata-collection loop is GONE.
 *       Bus-driven subscriber owns the collection lifecycle now (relocated
 *       to server/maestro/internal/subscribers.ts).
 *
 *   (c) server/maestro/plugin.ts has zero `for (const d of devices)` — the
 *       old imperative onReady loop body that iterated each existing device
 *       at server boot is GONE.
 *
 *   (d) server/maestro/plugin.ts has exactly 1 `fastify.addHook('onReady'`
 *       — the registerSubscribers deferral (Pitfall 2 — pool plugin runs
 *       earlier; deferral keeps wiring agnostic to plugin-order shifts).
 *
 *   (e) server/index.ts STILL HAS `hookExecutor.execute('device.booted'`
 *       — different surface (lifecycle hooks), explicitly preserved per
 *       RESEARCH §Anti-Patterns. This is a guard against future deletion;
 *       the bus-driven subscriber and the hooks-side loop coexist.
 *
 *   (f) server/maestro/internal/subscribers.ts (or module.ts as fallback)
 *       contains the relocated `deviceInfoCollector.collect(` call — the
 *       calls were RELOCATED, not deleted.
 *
 * Comments are stripped before pattern matching so JSDoc references to the
 * anti-patterns (e.g. "DELETED ... `for (const d of devices)`") do not
 * cause false positives. The grep-guards measure REAL CODE only.
 *
 * Phase 21 reference: server/artifacts/__tests__/lifecycle-ownership.spec.ts.
 * Phase 22 reference: server/streaming/__tests__/lifecycle-ownership.spec.ts.
 * Phase 23 reference: server/jobs/__tests__/lifecycle-ownership.spec.ts.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Repository server/ root absolute path. */
const SERVER_ROOT = resolve(__dirname, '../..');

/** Strip JS/TS line and block comments so grep-guards measure code only. */
function stripComments(src: string): string {
  // Remove block comments first (non-greedy, multiline).
  let out = src.replace(/\/\*[\s\S]*?\*\//g, '');
  // Then remove line comments (preserving `://` in URLs).
  out = out.replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  return out;
}

function readCode(absPath: string): string {
  return stripComments(readFileSync(absPath, 'utf-8'));
}

function readRaw(absPath: string): string {
  return readFileSync(absPath, 'utf-8');
}

/** Walk all .ts files under server/, skipping __tests__ and node_modules. */
function* walkServerSrc(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules' || entry === '__fixtures__') continue;
      yield* walkServerSrc(full);
    } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
      yield full;
    }
  }
}

describe('[Phase 24-04 SC1] maestro lifecycle ownership grep-guards', () => {
  // ----------------------------------------------------------------
  // (a) No source file imports from old pool/device-info-collector path
  // ----------------------------------------------------------------
  it('(a) no source file imports from pool/device-info-collector (old path dead)', () => {
    const re = /from\s+['"][^'"]*pool\/device-info-collector/;
    const offenders: string[] = [];
    for (const file of walkServerSrc(SERVER_ROOT)) {
      const code = readCode(file);
      if (re.test(code)) offenders.push(file.replace(`${SERVER_ROOT}/`, 'server/'));
    }
    expect(
      offenders,
      `${offenders.length} files still import from pool/device-info-collector — Plan 24-03 git mv incomplete`,
    ).toEqual([]);
  });

  // ----------------------------------------------------------------
  // (b) plugin.ts has zero deviceInfoCollector.collect() calls
  // ----------------------------------------------------------------
  it('(b) server/maestro/plugin.ts has zero deviceInfoCollector.collect() calls (imperative loop deleted)', () => {
    const code = readCode(resolve(SERVER_ROOT, 'maestro/plugin.ts'));
    const matches = code.match(/deviceInfoCollector\.collect\(/g) ?? [];
    expect(
      matches,
      `plugin.ts has ${matches.length} deviceInfoCollector.collect() calls — should be 0 (relocated to subscribers.ts)`,
    ).toHaveLength(0);
  });

  // ----------------------------------------------------------------
  // (c) plugin.ts has zero "for (const d of devices)" loop body
  // ----------------------------------------------------------------
  it('(c) server/maestro/plugin.ts has zero "for (const d of devices)" (imperative loop body gone)', () => {
    const code = readCode(resolve(SERVER_ROOT, 'maestro/plugin.ts'));
    expect(
      code,
      'plugin.ts still contains the deleted imperative onReady loop body',
    ).not.toMatch(/for\s+\(const\s+d\s+of\s+devices\)/);
  });

  // ----------------------------------------------------------------
  // (d) plugin.ts has exactly 1 fastify.addHook('onReady'
  // ----------------------------------------------------------------
  it('(d) server/maestro/plugin.ts has exactly 1 fastify.addHook("onReady") (registerSubscribers deferral)', () => {
    const code = readCode(resolve(SERVER_ROOT, 'maestro/plugin.ts'));
    const matches = code.match(/fastify\.addHook\(\s*['"]onReady['"]/g) ?? [];
    expect(
      matches,
      `plugin.ts has ${matches.length} onReady hooks — expected exactly 1 (the registerSubscribers deferral)`,
    ).toHaveLength(1);
  });

  // ----------------------------------------------------------------
  // (e) server/index.ts STILL HAS hookExecutor.execute('device.booted')
  // ----------------------------------------------------------------
  it('(e) server/index.ts STILL HAS hookExecutor.execute("device.booted") (different surface — preserved)', () => {
    // Read the RAW source: the hookExecutor loop is real code, not in a
    // comment, so stripComments would also keep it — but using raw is
    // explicit about intent (we want the live call site).
    const src = readRaw(resolve(SERVER_ROOT, 'index.ts'));
    expect(
      src,
      'server/index.ts hookExecutor.execute(device.booted) loop deleted — must be preserved per RESEARCH Anti-Patterns',
    ).toMatch(/hookExecutor\.execute\(\s*['"]device\.booted['"]/);
  });

  // ----------------------------------------------------------------
  // (f) subscribers.ts (or module.ts) holds relocated collect call
  // ----------------------------------------------------------------
  it('(f) server/maestro/internal/{subscribers,module}.ts contains the relocated deviceInfoCollector.collect call', () => {
    // Calls relocated, not deleted. Either subscribers.ts or module.ts
    // holds the call (Plan 24-03 chose subscribers.ts).
    const subscribersPath = resolve(SERVER_ROOT, 'maestro/internal/subscribers.ts');
    let subscribersExists = false;
    try { subscribersExists = statSync(subscribersPath).isFile(); } catch { /* missing */ }
    const target = subscribersExists
      ? subscribersPath
      : resolve(SERVER_ROOT, 'maestro/internal/module.ts');
    const code = readCode(target);
    expect(
      code,
      `${target} should contain deviceInfoCollector.collect( (relocated from plugin.ts)`,
    ).toMatch(/deviceInfoCollector\.collect\(/);
  });
});
