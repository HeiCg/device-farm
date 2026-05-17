/**
 * Phase 23 / Plan 23-06 — Jobs lifecycle ownership spec [SC1 grep-guards].
 *
 * Proves the post-Plan-23-04 codebase has zero anti-patterns:
 *   - .catch(() => {})              — error swallowing (use job.failed emit instead)
 *   - setTimeout(...broadcaster...cleanup) — DEFERRED-22-D legacy
 *                                            (use job.cleanup.requested instead)
 *   - import from '../streaming/internal/'  — DEFERRED-22-F legacy
 *                                              (use fastify.streamingModule decorator)
 *   - bus.emit() outside events.ts   — direct emit
 *                                       (use makeJobsEmitters helpers)
 *
 * Scoped narrowly per RESEARCH §Pitfall 7 — checks only jobs/internal/* +
 * jobs/job-service.ts (the back-compat shim). DB-FREE; runs everywhere.
 *
 * Comments are stripped before pattern matching so JSDoc references to the
 * anti-patterns (e.g. "DOES NOT call .catch(() => {})") do NOT cause false
 * positives. The grep-guards measure REAL CODE only.
 *
 * Phase 21 reference: server/artifacts/__tests__/lifecycle-ownership.spec.ts.
 * Phase 22 reference: server/streaming/__tests__/lifecycle-ownership.spec.ts.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const FILES = [
  resolve(__dirname, '../internal/executor.ts'),
  resolve(__dirname, '../internal/module.ts'),
  resolve(__dirname, '../internal/subscribers.ts'),
  resolve(__dirname, '../job-service.ts'),
] as const;

/** Strip JS/TS line and block comments so grep-guards measure code only. */
function stripComments(src: string): string {
  // Remove block comments first (non-greedy, multiline).
  let out = src.replace(/\/\*[\s\S]*?\*\//g, '');
  // Then remove line comments.
  out = out.replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  return out;
}

function loadCode(file: string): { path: string; code: string } {
  const raw = readFileSync(file, 'utf-8');
  return { path: file, code: stripComments(raw) };
}

function countMatches(code: string, pattern: RegExp): number {
  return (code.match(pattern) ?? []).length;
}

describe('jobs lifecycle ownership [SC1 grep-guards]', () => {
  it('zero `.catch(() => {})` swallow patterns in executor + module + subscribers + shim', () => {
    const re = /\.catch\(\(\) => \{\}\)/g;
    for (const file of FILES) {
      const { path, code } = loadCode(file);
      const n = countMatches(code, re);
      expect(n, `${path} has .catch(() => {}) at ${n} sites`).toBe(0);
    }
  });

  it('zero `setTimeout(...broadcaster...cleanup)` patterns (DEFERRED-22-D resolved)', () => {
    const re = /setTimeout\([^)]*broadcaster[^)]*cleanup/gs;
    for (const file of FILES) {
      const { path, code } = loadCode(file);
      const n = countMatches(code, re);
      expect(n, `${path} has setTimeout-broadcaster-cleanup at ${n} sites`).toBe(0);
    }
  });

  it('zero imports from "../streaming/internal/" (DEFERRED-22-F resolved)', () => {
    const re = /from ['"]\.\.?\/streaming\/internal\//g;
    for (const file of FILES) {
      const { path, code } = loadCode(file);
      const n = countMatches(code, re);
      expect(n, `${path} has streaming/internal imports at ${n} sites`).toBe(0);
    }
  });

  it('zero direct `bus.emit(` outside events.ts (use makeJobsEmitters helpers)', () => {
    // events.ts is allowlisted by eslint-local-rules/no-direct-bus-emit.js;
    // it owns the emitters via createEventHelpers. The 4 files under test
    // must consume emit helpers (jobsModule.emit.X) and NEVER call bus.emit
    // directly.
    const re = /\bbus\.emit\(/g;
    for (const file of FILES) {
      const { path, code } = loadCode(file);
      const n = countMatches(code, re);
      expect(n, `${path} has direct bus.emit() at ${n} sites`).toBe(0);
    }
  });

  it('back-compat shim (job-service.ts) is small (≤ 200 lines)', () => {
    // The shim should not grow back into a 600+ line monolith. Bounded
    // gently (currently ~160 lines including blanks/comments).
    const file = resolve(__dirname, '../job-service.ts');
    const src = readFileSync(file, 'utf-8');
    const lineCount = src.split('\n').length;
    expect(
      lineCount,
      `job-service.ts back-compat shim should be small (got ${lineCount} lines)`,
    ).toBeLessThanOrEqual(200);
  });

  it('executor.ts uses jobsModule.emit (not direct bus.emit)', () => {
    const file = resolve(__dirname, '../internal/executor.ts');
    const { code } = loadCode(file);
    const emitCount = countMatches(code, /jobsModule\.emit\./g);
    expect(
      emitCount,
      'executor.ts must use jobsModule.emit.X helpers (saga emit surface)',
    ).toBeGreaterThan(2);
  });
});
