/**
 * Auth module - lifecycle-ownership grep-guards (Plan 26-02).
 *
 * readFileSync-based structural assertions enforcing TRACE-10 invariants:
 *   1. server/bus/helpers.ts default fallback migrated 'anonymous' -> 'system' (Pitfall 4)
 *   2. server/index.ts onReady block wrapped in asyncLocalStorage.run with actor:'system' (Pitfall 2 - entry point #3)
 *   3. server/queue/plugin.ts byte-stable cron actor stamp (Phase 18 substrate; Pitfall 3)
 *   4. NO plain als.run blocks without actor key in production code (Pitfall 1 - actor must be set at every entry point that builds an inline store literal)
 *   5. NO 'anonymous' literal in unguarded production code (TRACE-10 contract - actorSchema regex does NOT include it). Two known-safe substrate carriers are allowlisted:
 *        - server/correlation/plugin.ts: defaultStoreValues for HTTP requests (Plan 26-03 owns the bearer-auth replacement)
 *        - server/auth/internal/actor.ts: JSDoc anti-pattern citations (no runtime use)
 *
 * These are STRUCTURAL grep-guards, not runtime tests. Plan 26-04 owns the
 * DB-gated runtime proof via als-actor.spec.
 *
 * Mirrors Phase 25 Plan 25-04 lifecycle-ownership.spec readFileSync grep-guard
 * pattern (server/pipelines/__tests__/lifecycle-ownership.spec.ts).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = resolve(__dirname, '../..');
const REPO_ROOT = resolve(__dirname, '../../..');

/** Walk every .ts file under server/, skipping node_modules and dotdirs. */
function walkServer(root: string, found: string[] = []): string[] {
  for (const entry of readdirSync(root)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(root, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walkServer(full, found);
    } else if (full.endsWith('.ts') && !full.endsWith('.d.ts')) {
      found.push(full);
    }
  }
  return found;
}

/** Strip JS/TS line + block comments so grep-guards measure code only. */
function stripComments(src: string): string {
  let out = src.replace(/\/\*[\s\S]*?\*\//g, '');
  out = out.replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  return out;
}

/** Predicate: file is production code (not __tests__ / __fixtures__ / .spec.ts / .test.ts). */
function isProductionFile(file: string): boolean {
  if (file.includes('/__tests__/')) return false;
  if (file.includes('/__fixtures__/')) return false;
  if (file.endsWith('.spec.ts')) return false;
  if (file.endsWith('.test.ts')) return false;
  return true;
}

/**
 * Allowlist of files that intentionally carry 'anonymous' in production code.
 * Documented in 26-02-SUMMARY.md as KNOWN-SAFE substrate carriers - Plan 26-03
 * (HTTP bearer-auth callback) replaces the correlation default; auth/internal/actor.ts
 * keeps the literal in JSDoc only as an anti-pattern citation.
 */
const KNOWN_SAFE_ANONYMOUS_PATHS = [
  resolve(SERVER_ROOT, 'correlation/plugin.ts'),
  resolve(SERVER_ROOT, 'auth/internal/actor.ts'),
];

describe('Phase 26 - TRACE-10 actor stamp lifecycle ownership', () => {
  it("1. server/bus/helpers.ts default fallback migrated to 'system' (Pitfall 4)", () => {
    const src = readFileSync(resolve(SERVER_ROOT, 'bus/helpers.ts'), 'utf8');
    const code = stripComments(src);
    expect(code).toContain("?? 'system'");
    expect(code).not.toContain("?? 'anonymous'");
  });

  it("2. server/index.ts onReady wrapped in asyncLocalStorage.run with actor:'system' (Pitfall 2)", () => {
    const src = readFileSync(resolve(SERVER_ROOT, 'index.ts'), 'utf8');
    // Combined match - asyncLocalStorage.run followed within ~400 chars by both correlationId: and actor: 'system'
    const wrapMatch = /asyncLocalStorage\.run\s*\(\s*\{[\s\S]{0,400}?correlationId:\s*[\s\S]{0,200}?actor:\s*'system'/m;
    expect(src).toMatch(wrapMatch);
  });

  it("3. server/queue/plugin.ts byte-stable cron actor stamp (Phase 18 substrate)", () => {
    const src = readFileSync(resolve(SERVER_ROOT, 'queue/plugin.ts'), 'utf8');
    expect(src).toContain("actor: data.actor ?? 'cron'");
  });

  it('4. NO plain als.run blocks without actor key in server/ production code (Pitfall 1)', () => {
    const files = walkServer(SERVER_ROOT).filter(isProductionFile);
    const offenders: string[] = [];
    for (const file of files) {
      // Strip JSDoc / line comments so doc-comment citations of the run shape
      // (e.g. helpers.ts JSDoc references `asyncLocalStorage.run({ ...defaultStoreValues }, ...)`)
      // do NOT trigger the grep-guard. Real code only.
      const src = stripComments(readFileSync(file, 'utf8'));
      // Match inline-object-literal call shapes only.
      // Variable-reference shapes (e.g. `asyncLocalStorage.run(store as never, ...)`)
      // are excluded - those entry points build the store object earlier and are
      // covered by per-site grep-guards (queue/plugin.ts cron stamp = Test 3;
      // bus/plugin.ts:135 reuses parent store via Map clone - no actor decision).
      const re = /(asyncLocalStorage|als)\.run\s*\(\s*(\{[\s\S]{0,400}?\})/g;
      let match: RegExpExecArray | null;
      while ((match = re.exec(src)) !== null) {
        const argBlock = match[2];
        if (!argBlock.includes('actor')) {
          offenders.push(`${relative(REPO_ROOT, file)}: ${argBlock.slice(0, 100)}`);
        }
      }
    }
    expect(offenders, `plain ALS runs missing actor key: ${offenders.join('\n')}`).toEqual([]);
  });

  it("5. NO 'anonymous' literal in unguarded server/ production code (TRACE-10 contract)", () => {
    const files = walkServer(SERVER_ROOT).filter(isProductionFile);
    const offenders: string[] = [];
    for (const file of files) {
      if (KNOWN_SAFE_ANONYMOUS_PATHS.includes(file)) continue;
      const code = stripComments(readFileSync(file, 'utf8'));
      if (code.includes("'anonymous'")) {
        offenders.push(relative(REPO_ROOT, file));
      }
    }
    expect(
      offenders,
      `'anonymous' must not appear in unguarded production code; found in: ${offenders.join(', ')}`,
    ).toEqual([]);
  });
});
