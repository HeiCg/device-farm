/**
 * Phase 25 / Plan 25-04 — Pipelines lifecycle ownership grep-guards [SC1 + SC2].
 *
 * Filesystem-only spec (no DB, no shell exec). Mirrors Phase 21/22/23/24
 * lifecycle-ownership.spec pattern.
 *
 * Asserts post-rewrite codebase invariants:
 *   SC1 (node-cron retired):
 *     - Test 1: ZERO `from 'node-cron'` import statements anywhere in server/.
 *     - Test 4: package.json no longer declares node-cron + @types/node-cron.
 *   SC2 (Promise-chain / polling deleted):
 *     - Test 2: executor.ts holds NO references to stage iteration (pipeline.stages),
 *       pipelineRuns table, or triggerRun (executor is pure: executeScript +
 *       evaluateCondition only).
 *     - Test 3: service.ts does NOT poll jobs.status (no setInterval, no
 *       `await new Promise(r => setTimeout(r, 3000))` polling pattern from the
 *       pre-rewrite line 524, no deadline-based polling).
 *
 * Comments are stripped before pattern matching so JSDoc references to the
 * anti-patterns (e.g. "// Polling loop (3s setTimeout) DELETED") do NOT cause
 * false positives. Grep-guards measure REAL CODE only.
 *
 * Phase 21 reference: server/artifacts/__tests__/lifecycle-ownership.spec.ts.
 * Phase 23 reference: server/jobs/__tests__/lifecycle-ownership.spec.ts.
 * Phase 24 reference: server/maestro/__tests__/lifecycle-ownership.spec.ts.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

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
    } else if (full.endsWith('.ts')) {
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

describe('Phase 25 lifecycle ownership grep-guards (SC1 + SC2)', () => {
  it("SC1: zero `from 'node-cron'` imports anywhere in server/", () => {
    const files = walkServer(SERVER_ROOT);
    const selfPath = fileURLToPath(import.meta.url);
    const offenders: string[] = [];
    for (const file of files) {
      // Self-exclude this spec — it contains the regex literal we're searching for.
      if (file === selfPath) continue;
      const code = stripComments(readFileSync(file, 'utf-8'));
      if (/from\s+['"]node-cron['"]/.test(code)) {
        offenders.push(file);
      }
    }
    expect(offenders, `node-cron imports must be 0; found in: ${offenders.join(', ')}`).toEqual([]);
  });

  it('SC2: executor.ts holds no Promise chain over stages (pure: executeScript + evaluateCondition)', () => {
    const file = resolve(SERVER_ROOT, 'pipelines/internal/executor.ts');
    const code = stripComments(readFileSync(file, 'utf-8'));
    // executor.ts must NOT iterate stages or touch the pipelineRuns table.
    expect(code, 'executor.ts must not reference pipeline.stages').not.toMatch(/pipeline\w*\.stages\b/);
    expect(code, 'executor.ts must not reference pipelineRuns table').not.toMatch(/pipelineRuns/);
    expect(code, 'executor.ts must not invoke triggerRun').not.toMatch(/triggerRun/);
  });

  it('SC2: service.ts does not poll jobs.status (zero setInterval, zero 3s setTimeout polling, zero deadline polling)', () => {
    const file = resolve(SERVER_ROOT, 'pipelines/internal/service.ts');
    const code = stripComments(readFileSync(file, 'utf-8'));
    // No setInterval anywhere.
    expect(code, 'service.ts must not use setInterval').not.toMatch(/setInterval/);
    // The exact polling pattern from pre-rewrite line 524.
    expect(
      code,
      'service.ts must not contain `await new Promise(r => setTimeout(r, 3000))` polling',
    ).not.toMatch(/await\s+new\s+Promise\s*\(\s*r\s*=>\s*setTimeout\s*\(\s*r\s*,\s*3000\s*\)\s*\)/);
    // Polling-with-deadline shape (catch-all for variant phrasings, /s flag for cross-line).
    expect(code, 'service.ts must not poll jobs.status with a deadline').not.toMatch(/jobs\.status[\s\S]*deadline/);
  });

  it('SC1: package.json no longer declares node-cron or @types/node-cron', () => {
    const pkgPath = resolve(REPO_ROOT, 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect(pkg.dependencies?.['node-cron'], 'dependencies.node-cron must be undefined').toBeUndefined();
    expect(
      pkg.devDependencies?.['@types/node-cron'],
      'devDependencies.@types/node-cron must be undefined',
    ).toBeUndefined();
  });
});
