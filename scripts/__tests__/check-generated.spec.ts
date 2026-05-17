// scripts/__tests__/check-generated.spec.ts
// Phase 17 Plan 17-08 — verifies the drift detection path in scripts/check-generated.sh.
//
// The spec does NOT run the full regeneration pipeline (slow, needs DB +
// go-jsonschema). Instead it mutates one of the committed generated files
// and asserts the script's drift branch fires. The regeneration branch is
// proven indirectly (if the script regenerated the file from scratch, the
// drift would disappear — the fact that our mutation is still detected
// after the script runs confirms the regen step produced the same bytes,
// i.e., our mutation IS the only source of drift).
//
// Guardrails:
//   - afterEach runs `git checkout HEAD -- <path>` (via spawnSync, argv-array) to
//     restore any test-mutated file
//   - spawnSync is used for every subprocess — argv-array form only; the
//     shell-exec-style APIs are explicitly avoided
//   - Tests are skipped if the target generated file does not yet exist
//     on disk (prerequisite plans 17-03/17-04/17-05 must have run first)
//   - Tests are ALSO skipped if Postgres is unreachable on this host
//     (build-openapi.ts boots Fastify which auto-connects pg-boss; without
//     DB the script dies at Step 1/3 before ever reaching the diff loop,
//     so the drift assertion would false-fail on the dev laptop.
//     CI runners provision Postgres as a service — gate runs there.)

import { describe, test, expect, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '..', '..');
const REL_TARGET = 'cli/internal/types/generated.go';
const TARGET = resolve(REPO_ROOT, REL_TARGET);

function runScript(): { status: number; stdout: string; stderr: string } {
  const r = spawnSync('bash', ['scripts/check-generated.sh'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: { ...process.env },
  });
  return { status: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function restoreFromGit(relativePath: string): void {
  // spawnSync with argv array — no shell, no interpolation.
  spawnSync('git', ['checkout', 'HEAD', '--', relativePath], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
}

// Probe: can the regen pipeline actually run end-to-end on this host?
// The gate keeps the spec meaningful on CI (where generators + DB exist)
// while avoiding false-positive failures on dev machines lacking Postgres.
function canRunFullPipeline(): boolean {
  if (!existsSync(TARGET)) return false;
  // Opt-out for developers who can't run Postgres locally.
  if (process.env['CONTRACTS_CHECK_SPEC'] === 'skip') return false;
  // build-openapi.ts requires a reachable Postgres; short-circuit the gate
  // if no DATABASE_URL is configured (plain `psql -l` check would add a
  // system-dep; this env-var probe is deterministic + CI-friendly).
  if (!process.env['DATABASE_URL']) return false;
  return true;
}

const canRun = canRunFullPipeline();

describe.skipIf(!canRun)('scripts/check-generated.sh — drift detection', () => {
  afterEach(() => {
    restoreFromGit(REL_TARGET);
  });

  test('fires when a generated file is mutated', () => {
    expect(existsSync(TARGET)).toBe(true);
    const original = readFileSync(TARGET, 'utf8');

    // Append a marker byte the real generator will NOT reproduce.
    writeFileSync(TARGET, original + '\n// FORCED-DRIFT-FOR-TEST\n');

    const result = runScript();
    // Drift should be detected → exit non-zero.
    expect(result.status).not.toBe(0);
    // Failure message must name the drifted file.
    const combined = result.stdout + result.stderr;
    expect(combined).toMatch(/cli\/internal\/types\/generated\.go/);
    // Must include the "drift" keyword so CI readers understand the failure.
    expect(combined).toMatch(/drift/i);
  }, 300_000);

  test('fires when a generated file is missing', () => {
    const tmp = TARGET + '.test-backup';
    renameSync(TARGET, tmp);
    try {
      const result = runScript();
      expect(result.status).not.toBe(0);
      const combined = result.stdout + result.stderr;
      // Script should emit either "MISSING" or name the absent file.
      expect(combined).toMatch(/MISSING|cli\/internal\/types\/generated\.go/);
    } finally {
      // Restore the file — CRITICAL (tree must be clean after the test).
      if (existsSync(tmp)) {
        renameSync(tmp, TARGET);
      }
    }
  }, 300_000);
});
