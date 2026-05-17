/**
 * Phase 16 / Plan 16-03 — Dep-cruiser rule fires on deliberate deep-import violation.
 *
 * This spec replaces the "manual-only" MOD-02 verification row in 16-VALIDATION.md
 * with an automated check. It invokes the `depcruise` CLI as a subprocess against
 * a fixture file (outside `server/` so it does not interfere with `npm run dep-check`)
 * that imports from `server/hooks/internal/*`. The spec asserts:
 *   - Exit code is non-zero (depcruise `err` reporter returns >0 when any forbidden
 *     rule fires; note: the `json` reporter does NOT set the exit code, so we run
 *     twice — once with `err` for exit status, once with `json` for structure).
 *   - JSON output contains a violation with rule name `no-deep-imports-into-hooks-internal`.
 *   - The violation references the fixture file.
 *
 * Pre-task verification (plan task 3.2 WARNING 8) determined `includeOnly: '^server/'`
 * in the config DOES suppress fixture-path violations even when passed explicitly on
 * the CLI — so we pass the PRIMARY FALLBACK flag `--include-only '^(server|__fixtures__)/'`
 * to override the config and bring the fixture into the graph. Documented in
 * 16-03-SUMMARY.md under "Deviations".
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const FIXTURE = '__fixtures__/dep-cruiser/bad-deep-import.ts';
const LIFECYCLE_FIXTURE = '__fixtures__/dep-cruiser/bad-lifecycle-deep-import.ts';
const REPORTING_FIXTURE = '__fixtures__/dep-cruiser/bad-reporting-deep-import.ts';
const POOL_FIXTURE = '__fixtures__/dep-cruiser/bad-pool-deep-import.ts';
const ARTIFACTS_FIXTURE = '__fixtures__/dep-cruiser/bad-artifacts-deep-import.ts';
const STREAMING_FIXTURE = '__fixtures__/dep-cruiser/bad-streaming-deep-import.ts';
const JOBS_FIXTURE = '__fixtures__/dep-cruiser/bad-jobs-deep-import.ts';
const MAESTRO_FIXTURE = '__fixtures__/dep-cruiser/bad-maestro-deep-import.ts';
const PIPELINES_FIXTURE = '__fixtures__/dep-cruiser/bad-pipelines-deep-import.ts';
const AUTH_FIXTURE = '__fixtures__/dep-cruiser/bad-auth-deep-import.ts';
const SESSIONS_FIXTURE = '__fixtures__/dep-cruiser/bad-sessions-deep-import.ts';
const EXPLORATIONS_FIXTURE = '__fixtures__/dep-cruiser/bad-explorations-deep-import.ts';
const CONFIG = '.dependency-cruiser.cjs';
const INCLUDE_ONLY_OVERRIDE = '^(server|__fixtures__)/';

describe('dependency-cruiser: deep-import denylist rules', () => {
  it('[MOD-02] deep import into server/hooks/internal/* from outside server/hooks/ fails', () => {
    expect(existsSync(FIXTURE)).toBe(true);
    expect(existsSync(CONFIG)).toBe(true);

    // --- Pass 1: default `err` reporter — this is what sets a non-zero exit code.
    const errResult = spawnSync(
      'npx',
      [
        'depcruise',
        '--config', CONFIG,
        '--include-only', INCLUDE_ONLY_OVERRIDE,
        FIXTURE,
      ],
      { encoding: 'utf8', timeout: 30_000 },
    );

    expect(
      errResult.status,
      `Expected non-zero exit code. stdout: ${errResult.stdout}\nstderr: ${errResult.stderr}`,
    ).not.toBe(0);

    // --- Pass 2: `json` reporter — parse structured violations.
    const jsonResult = spawnSync(
      'npx',
      [
        'depcruise',
        '--config', CONFIG,
        '--include-only', INCLUDE_ONLY_OVERRIDE,
        '--output-type', 'json',
        FIXTURE,
      ],
      { encoding: 'utf8', timeout: 30_000 },
    );

    let parsed: { summary?: { violations?: Array<{ rule?: { name?: string }; from?: string; to?: string }> } };
    try {
      parsed = JSON.parse(jsonResult.stdout || '{}');
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('dep-cruiser stdout:', jsonResult.stdout);
      // eslint-disable-next-line no-console
      console.error('dep-cruiser stderr:', jsonResult.stderr);
      throw err;
    }

    const violations = parsed.summary?.violations ?? [];

    const deepImportViolation = violations.find(
      (v) => v.rule?.name === 'no-deep-imports-into-hooks-internal',
    );

    expect(
      deepImportViolation,
      `Expected rule to fire. Violations: ${JSON.stringify(violations, null, 2)}`,
    ).toBeDefined();
    expect(deepImportViolation!.from).toMatch(/bad-deep-import\.ts$/);
    expect(deepImportViolation!.to).toMatch(/^server\/hooks\/internal\//);
  });

  it('[MOD-02 lifecycle extension] deep import into server/lifecycle/internal/* from outside server/lifecycle/ fails', () => {
    expect(existsSync(LIFECYCLE_FIXTURE)).toBe(true);
    expect(existsSync(CONFIG)).toBe(true);

    // Pass 1 — default err reporter, for exit status.
    const errResult = spawnSync(
      'npx',
      [
        'depcruise',
        '--config', CONFIG,
        '--include-only', INCLUDE_ONLY_OVERRIDE,
        LIFECYCLE_FIXTURE,
      ],
      { encoding: 'utf8', timeout: 30_000 },
    );

    expect(
      errResult.status,
      `Expected non-zero exit code. stdout: ${errResult.stdout}\nstderr: ${errResult.stderr}`,
    ).not.toBe(0);

    // Pass 2 — json reporter for structured violations.
    const jsonResult = spawnSync(
      'npx',
      [
        'depcruise',
        '--config', CONFIG,
        '--include-only', INCLUDE_ONLY_OVERRIDE,
        '--output-type', 'json',
        LIFECYCLE_FIXTURE,
      ],
      { encoding: 'utf8', timeout: 30_000 },
    );

    let report: { summary?: { violations?: Array<{ rule?: { name?: string }; from?: string; to?: string }> } };
    try {
      report = JSON.parse(jsonResult.stdout || '{}');
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('dep-cruiser stdout:', jsonResult.stdout);
      // eslint-disable-next-line no-console
      console.error('dep-cruiser stderr:', jsonResult.stderr);
      throw err;
    }

    const violations = report.summary?.violations ?? [];
    const matching = violations.filter(
      (v) => v.rule?.name === 'no-deep-imports-into-lifecycle-internal',
    );
    expect(
      matching.length,
      `Expected rule to fire. Violations: ${JSON.stringify(violations, null, 2)}`,
    ).toBeGreaterThan(0);
  });

  it('[MOD-02 reporting extension] deep import into server/reporting/internal/* from outside server/reporting/ fails', () => {
    expect(existsSync(REPORTING_FIXTURE)).toBe(true);
    expect(existsSync(CONFIG)).toBe(true);

    // Pass 1 — default err reporter for exit status.
    const errResult = spawnSync(
      'npx',
      [
        'depcruise',
        '--config', CONFIG,
        '--include-only', INCLUDE_ONLY_OVERRIDE,
        REPORTING_FIXTURE,
      ],
      { encoding: 'utf8', timeout: 30_000 },
    );

    expect(
      errResult.status,
      `Expected non-zero exit code. stdout: ${errResult.stdout}\nstderr: ${errResult.stderr}`,
    ).not.toBe(0);

    // Pass 2 — json reporter for structured violations.
    const jsonResult = spawnSync(
      'npx',
      [
        'depcruise',
        '--config', CONFIG,
        '--include-only', INCLUDE_ONLY_OVERRIDE,
        '--output-type', 'json',
        REPORTING_FIXTURE,
      ],
      { encoding: 'utf8', timeout: 30_000 },
    );

    let report: { summary?: { violations?: Array<{ rule?: { name?: string }; from?: string; to?: string }> } };
    try {
      report = JSON.parse(jsonResult.stdout || '{}');
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('dep-cruiser stdout:', jsonResult.stdout);
      // eslint-disable-next-line no-console
      console.error('dep-cruiser stderr:', jsonResult.stderr);
      throw err;
    }

    const violations = report.summary?.violations ?? [];
    const matching = violations.filter(
      (v) => v.rule?.name === 'no-deep-imports-into-reporting-internal',
    );
    expect(
      matching.length,
      `Expected rule to fire. Violations: ${JSON.stringify(violations, null, 2)}`,
    ).toBeGreaterThan(0);
  });

  it('[MOD-02 pool extension] deep import into server/pool/internal/* from outside server/pool/ fails', () => {
    expect(existsSync(POOL_FIXTURE)).toBe(true);
    expect(existsSync(CONFIG)).toBe(true);

    // Pass 1 — default err reporter for exit status.
    const errResult = spawnSync(
      'npx',
      [
        'depcruise',
        '--config', CONFIG,
        '--include-only', INCLUDE_ONLY_OVERRIDE,
        POOL_FIXTURE,
      ],
      { encoding: 'utf8', timeout: 30_000 },
    );

    expect(
      errResult.status,
      `Expected non-zero exit code. stdout: ${errResult.stdout}\nstderr: ${errResult.stderr}`,
    ).not.toBe(0);

    // Pass 2 — json reporter for structured violations.
    const jsonResult = spawnSync(
      'npx',
      [
        'depcruise',
        '--config', CONFIG,
        '--include-only', INCLUDE_ONLY_OVERRIDE,
        '--output-type', 'json',
        POOL_FIXTURE,
      ],
      { encoding: 'utf8', timeout: 30_000 },
    );

    let report: { summary?: { violations?: Array<{ rule?: { name?: string }; from?: string; to?: string }> } };
    try {
      report = JSON.parse(jsonResult.stdout || '{}');
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('dep-cruiser stdout:', jsonResult.stdout);
      // eslint-disable-next-line no-console
      console.error('dep-cruiser stderr:', jsonResult.stderr);
      throw err;
    }

    const violations = report.summary?.violations ?? [];
    const matching = violations.filter(
      (v) => v.rule?.name === 'no-deep-imports-into-pool-internal',
    );
    expect(
      matching.length,
      `Expected rule to fire. Violations: ${JSON.stringify(violations, null, 2)}`,
    ).toBeGreaterThan(0);
  });

  it('[MOD-02 artifacts extension] deep import into server/artifacts/internal/* from outside server/artifacts/ fails', () => {
    expect(existsSync(ARTIFACTS_FIXTURE)).toBe(true);
    expect(existsSync(CONFIG)).toBe(true);

    // Pass 1 — default err reporter for exit status.
    const errResult = spawnSync(
      'npx',
      [
        'depcruise',
        '--config', CONFIG,
        '--include-only', INCLUDE_ONLY_OVERRIDE,
        ARTIFACTS_FIXTURE,
      ],
      { encoding: 'utf8', timeout: 30_000 },
    );

    expect(
      errResult.status,
      `Expected non-zero exit code. stdout: ${errResult.stdout}\nstderr: ${errResult.stderr}`,
    ).not.toBe(0);

    // Pass 2 — json reporter for structured violations.
    const jsonResult = spawnSync(
      'npx',
      [
        'depcruise',
        '--config', CONFIG,
        '--include-only', INCLUDE_ONLY_OVERRIDE,
        '--output-type', 'json',
        ARTIFACTS_FIXTURE,
      ],
      { encoding: 'utf8', timeout: 30_000 },
    );

    let report: { summary?: { violations?: Array<{ rule?: { name?: string }; from?: string; to?: string }> } };
    try {
      report = JSON.parse(jsonResult.stdout || '{}');
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('dep-cruiser stdout:', jsonResult.stdout);
      // eslint-disable-next-line no-console
      console.error('dep-cruiser stderr:', jsonResult.stderr);
      throw err;
    }

    const violations = report.summary?.violations ?? [];
    const matching = violations.filter(
      (v) => v.rule?.name === 'no-deep-imports-into-artifacts-internal',
    );
    expect(
      matching.length,
      `Expected rule to fire. Violations: ${JSON.stringify(violations, null, 2)}`,
    ).toBeGreaterThan(0);
  });

  it('[MOD-02 streaming extension] deep import into server/streaming/internal/* from outside server/streaming/ fails', () => {
    expect(existsSync(STREAMING_FIXTURE)).toBe(true);
    expect(existsSync(CONFIG)).toBe(true);

    // Pass 1 — default err reporter for exit status.
    const errResult = spawnSync(
      'npx',
      [
        'depcruise',
        '--config', CONFIG,
        '--include-only', INCLUDE_ONLY_OVERRIDE,
        STREAMING_FIXTURE,
      ],
      { encoding: 'utf8', timeout: 30_000 },
    );

    expect(
      errResult.status,
      `Expected non-zero exit code. stdout: ${errResult.stdout}\nstderr: ${errResult.stderr}`,
    ).not.toBe(0);

    // Pass 2 — json reporter for structured violations.
    const jsonResult = spawnSync(
      'npx',
      [
        'depcruise',
        '--config', CONFIG,
        '--include-only', INCLUDE_ONLY_OVERRIDE,
        '--output-type', 'json',
        STREAMING_FIXTURE,
      ],
      { encoding: 'utf8', timeout: 30_000 },
    );

    let report: { summary?: { violations?: Array<{ rule?: { name?: string }; from?: string; to?: string }> } };
    try {
      report = JSON.parse(jsonResult.stdout || '{}');
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('dep-cruiser stdout:', jsonResult.stdout);
      // eslint-disable-next-line no-console
      console.error('dep-cruiser stderr:', jsonResult.stderr);
      throw err;
    }

    const violations = report.summary?.violations ?? [];
    const matching = violations.filter(
      (v) => v.rule?.name === 'no-deep-imports-into-streaming-internal',
    );
    expect(
      matching.length,
      `Expected rule to fire. Violations: ${JSON.stringify(violations, null, 2)}`,
    ).toBeGreaterThan(0);
  });

  it('[MOD-02 jobs extension] deep import into server/jobs/internal/* from outside server/jobs/ fails', () => {
    expect(existsSync(JOBS_FIXTURE)).toBe(true);
    expect(existsSync(CONFIG)).toBe(true);

    // Pass 1 — default err reporter for exit status.
    const errResult = spawnSync(
      'npx',
      [
        'depcruise',
        '--config', CONFIG,
        '--include-only', INCLUDE_ONLY_OVERRIDE,
        JOBS_FIXTURE,
      ],
      { encoding: 'utf8', timeout: 30_000 },
    );

    expect(
      errResult.status,
      `Expected non-zero exit code. stdout: ${errResult.stdout}\nstderr: ${errResult.stderr}`,
    ).not.toBe(0);

    // Pass 2 — json reporter for structured violations.
    const jsonResult = spawnSync(
      'npx',
      [
        'depcruise',
        '--config', CONFIG,
        '--include-only', INCLUDE_ONLY_OVERRIDE,
        '--output-type', 'json',
        JOBS_FIXTURE,
      ],
      { encoding: 'utf8', timeout: 30_000 },
    );

    let report: { summary?: { violations?: Array<{ rule?: { name?: string }; from?: string; to?: string }> } };
    try {
      report = JSON.parse(jsonResult.stdout || '{}');
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('dep-cruiser stdout:', jsonResult.stdout);
      // eslint-disable-next-line no-console
      console.error('dep-cruiser stderr:', jsonResult.stderr);
      throw err;
    }

    const violations = report.summary?.violations ?? [];
    const matching = violations.filter(
      (v) => v.rule?.name === 'no-deep-imports-into-jobs-internal',
    );
    expect(
      matching.length,
      `Expected rule to fire. Violations: ${JSON.stringify(violations, null, 2)}`,
    ).toBeGreaterThan(0);
  });

  it('[MOD-02 maestro extension] deep import into server/maestro/internal/* from outside server/maestro/ fails', () => {
    expect(existsSync(MAESTRO_FIXTURE)).toBe(true);
    expect(existsSync(CONFIG)).toBe(true);

    // Pass 1 — default err reporter for exit status.
    const errResult = spawnSync(
      'npx',
      [
        'depcruise',
        '--config', CONFIG,
        '--include-only', INCLUDE_ONLY_OVERRIDE,
        MAESTRO_FIXTURE,
      ],
      { encoding: 'utf8', timeout: 30_000 },
    );

    expect(
      errResult.status,
      `Expected non-zero exit code. stdout: ${errResult.stdout}\nstderr: ${errResult.stderr}`,
    ).not.toBe(0);

    // Pass 2 — json reporter for structured violations.
    const jsonResult = spawnSync(
      'npx',
      [
        'depcruise',
        '--config', CONFIG,
        '--include-only', INCLUDE_ONLY_OVERRIDE,
        '--output-type', 'json',
        MAESTRO_FIXTURE,
      ],
      { encoding: 'utf8', timeout: 30_000 },
    );

    let report: { summary?: { violations?: Array<{ rule?: { name?: string }; from?: string; to?: string }> } };
    try {
      report = JSON.parse(jsonResult.stdout || '{}');
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('dep-cruiser stdout:', jsonResult.stdout);
      // eslint-disable-next-line no-console
      console.error('dep-cruiser stderr:', jsonResult.stderr);
      throw err;
    }

    const violations = report.summary?.violations ?? [];
    const matching = violations.filter(
      (v) => v.rule?.name === 'no-deep-imports-into-maestro-internal',
    );
    expect(
      matching.length,
      `Expected rule to fire. Violations: ${JSON.stringify(violations, null, 2)}`,
    ).toBeGreaterThan(0);
  });

  it('[MOD-02 pipelines extension] deep import into server/pipelines/internal/* from outside server/pipelines/ fails', () => {
    expect(existsSync(PIPELINES_FIXTURE)).toBe(true);
    expect(existsSync(CONFIG)).toBe(true);

    // Pass 1 — default err reporter for exit status.
    const errResult = spawnSync(
      'npx',
      [
        'depcruise',
        '--config', CONFIG,
        '--include-only', INCLUDE_ONLY_OVERRIDE,
        PIPELINES_FIXTURE,
      ],
      { encoding: 'utf8', timeout: 30_000 },
    );

    expect(
      errResult.status,
      `Expected non-zero exit code. stdout: ${errResult.stdout}\nstderr: ${errResult.stderr}`,
    ).not.toBe(0);

    // Pass 2 — json reporter for structured violations.
    const jsonResult = spawnSync(
      'npx',
      [
        'depcruise',
        '--config', CONFIG,
        '--include-only', INCLUDE_ONLY_OVERRIDE,
        '--output-type', 'json',
        PIPELINES_FIXTURE,
      ],
      { encoding: 'utf8', timeout: 30_000 },
    );

    let report: { summary?: { violations?: Array<{ rule?: { name?: string }; from?: string; to?: string }> } };
    try {
      report = JSON.parse(jsonResult.stdout || '{}');
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('dep-cruiser stdout:', jsonResult.stdout);
      // eslint-disable-next-line no-console
      console.error('dep-cruiser stderr:', jsonResult.stderr);
      throw err;
    }

    const violations = report.summary?.violations ?? [];
    const matching = violations.filter(
      (v) => v.rule?.name === 'no-deep-imports-into-pipelines-internal',
    );
    expect(
      matching.length,
      `Expected rule to fire. Violations: ${JSON.stringify(violations, null, 2)}`,
    ).toBeGreaterThan(0);
  });

  it('[MOD-02 auth extension] deep import into server/auth/internal/* from outside server/auth/ fails', () => {
    expect(existsSync(AUTH_FIXTURE)).toBe(true);
    expect(existsSync(CONFIG)).toBe(true);

    // Pass 1 — default err reporter for exit status.
    const errResult = spawnSync(
      'npx',
      [
        'depcruise',
        '--config', CONFIG,
        '--include-only', INCLUDE_ONLY_OVERRIDE,
        AUTH_FIXTURE,
      ],
      { encoding: 'utf8', timeout: 30_000 },
    );

    expect(
      errResult.status,
      `Expected non-zero exit code. stdout: ${errResult.stdout}\nstderr: ${errResult.stderr}`,
    ).not.toBe(0);

    // Pass 2 — json reporter for structured violations.
    const jsonResult = spawnSync(
      'npx',
      [
        'depcruise',
        '--config', CONFIG,
        '--include-only', INCLUDE_ONLY_OVERRIDE,
        '--output-type', 'json',
        AUTH_FIXTURE,
      ],
      { encoding: 'utf8', timeout: 30_000 },
    );

    let report: { summary?: { violations?: Array<{ rule?: { name?: string }; from?: string; to?: string }> } };
    try {
      report = JSON.parse(jsonResult.stdout || '{}');
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('dep-cruiser stdout:', jsonResult.stdout);
      // eslint-disable-next-line no-console
      console.error('dep-cruiser stderr:', jsonResult.stderr);
      throw err;
    }

    const violations = report.summary?.violations ?? [];
    const matching = violations.filter(
      (v) => v.rule?.name === 'no-deep-imports-into-auth-internal',
    );
    expect(
      matching.length,
      `Expected rule to fire. Violations: ${JSON.stringify(violations, null, 2)}`,
    ).toBeGreaterThan(0);
  });

  it('[MOD-02 sessions extension] deep import into server/sessions/internal/* from outside server/sessions/ fails', () => {
    expect(existsSync(SESSIONS_FIXTURE)).toBe(true);
    expect(existsSync(CONFIG)).toBe(true);

    // Pass 1 — default err reporter for exit status.
    const errResult = spawnSync(
      'npx',
      [
        'depcruise',
        '--config', CONFIG,
        '--include-only', INCLUDE_ONLY_OVERRIDE,
        SESSIONS_FIXTURE,
      ],
      { encoding: 'utf8', timeout: 30_000 },
    );

    expect(
      errResult.status,
      `Expected non-zero exit code. stdout: ${errResult.stdout}\nstderr: ${errResult.stderr}`,
    ).not.toBe(0);

    // Pass 2 — json reporter for structured violations.
    const jsonResult = spawnSync(
      'npx',
      [
        'depcruise',
        '--config', CONFIG,
        '--include-only', INCLUDE_ONLY_OVERRIDE,
        '--output-type', 'json',
        SESSIONS_FIXTURE,
      ],
      { encoding: 'utf8', timeout: 30_000 },
    );

    let report: { summary?: { violations?: Array<{ rule?: { name?: string }; from?: string; to?: string }> } };
    try {
      report = JSON.parse(jsonResult.stdout || '{}');
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('dep-cruiser stdout:', jsonResult.stdout);
      // eslint-disable-next-line no-console
      console.error('dep-cruiser stderr:', jsonResult.stderr);
      throw err;
    }

    const violations = report.summary?.violations ?? [];
    const matching = violations.filter(
      (v) => v.rule?.name === 'no-deep-imports-into-sessions-internal',
    );
    expect(
      matching.length,
      `Expected rule to fire. Violations: ${JSON.stringify(violations, null, 2)}`,
    ).toBeGreaterThan(0);
  });

  it('[MOD-02 explorations extension] deep import into server/explorations/internal/* from outside server/explorations/ fails', () => {
    expect(existsSync(EXPLORATIONS_FIXTURE)).toBe(true);
    expect(existsSync(CONFIG)).toBe(true);

    // Pass 1 — default err reporter for exit status.
    const errResult = spawnSync(
      'npx',
      [
        'depcruise',
        '--config', CONFIG,
        '--include-only', INCLUDE_ONLY_OVERRIDE,
        EXPLORATIONS_FIXTURE,
      ],
      { encoding: 'utf8', timeout: 30_000 },
    );

    expect(
      errResult.status,
      `Expected non-zero exit code. stdout: ${errResult.stdout}\nstderr: ${errResult.stderr}`,
    ).not.toBe(0);

    // Pass 2 — json reporter for structured violations.
    const jsonResult = spawnSync(
      'npx',
      [
        'depcruise',
        '--config', CONFIG,
        '--include-only', INCLUDE_ONLY_OVERRIDE,
        '--output-type', 'json',
        EXPLORATIONS_FIXTURE,
      ],
      { encoding: 'utf8', timeout: 30_000 },
    );

    let report: { summary?: { violations?: Array<{ rule?: { name?: string }; from?: string; to?: string }> } };
    try {
      report = JSON.parse(jsonResult.stdout || '{}');
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('dep-cruiser stdout:', jsonResult.stdout);
      // eslint-disable-next-line no-console
      console.error('dep-cruiser stderr:', jsonResult.stderr);
      throw err;
    }

    const violations = report.summary?.violations ?? [];
    const matching = violations.filter(
      (v) => v.rule?.name === 'no-deep-imports-into-explorations-internal',
    );
    expect(
      matching.length,
      `Expected rule to fire. Violations: ${JSON.stringify(violations, null, 2)}`,
    ).toBeGreaterThan(0);
  });
});
