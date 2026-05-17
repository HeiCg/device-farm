/**
 * Phase 23 Plan 23-03 — contract-devicename.spec [DEBT-02 / CLI-05 / SC3].
 *
 * Asserts the deviceName cross-field invariant + OpenAPI schema emit gate.
 * Dropping deviceName from jobResponseSchema or from openapi.json fails
 * this spec, mechanically blocking CI per success criterion 3.
 *
 * Test cases (RESEARCH §Code Examples §4):
 *   (a) Schema shape exposes deviceName
 *   (b) parse accepts deviceId=null + deviceName=null (job not yet allocated)
 *   (c) parse accepts deviceId=<uuid> + deviceName=non-empty
 *   (d) parse REJECTS deviceId=<uuid> + deviceName=null
 *   (e) parse REJECTS deviceId=<uuid> + deviceName='' (empty string)
 *   (f) openapi.json components.schemas.Job has deviceName in properties
 *
 * Optional: cross-tier Go proof (Task 3.4 attempts; falls back to DEFERRED-23-C).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { jobResponseSchema } from '../schemas.js';

// Versioned UUIDs (Zod 4 strict format requires v1-v8 in 3rd group).
const VALID_JOB_ID = '11111111-2222-4333-8444-555555555555';
const VALID_DEVICE_ID = '99999999-8888-4777-8666-555555555555';

const validBase = {
  id: VALID_JOB_ID,
  status: 'queued' as const,
  platform: 'android' as const,
  metadata: null,
  createdAt: '2026-05-08T00:00:00.000Z',
  startedAt: null,
  finishedAt: null,
  errorMessage: null,
};

describe('Job schema deviceName contract [DEBT-02 / CLI-05]', () => {
  it('(a) jobResponseSchema exposes deviceName field', () => {
    // jobResponseSchema is a ZodObject wrapped by .refine() (which becomes ZodEffects)
    // and then by .meta() (Zod 4 — preserves the underlying type). The `.def`
    // on a ZodEffects from refine has `.schema` pointing at the inner ZodObject;
    // ZodObject exposes `.shape` on the type instance.
    const root = jobResponseSchema as unknown as Record<string, unknown>;
    const def = (root._zod as { def?: Record<string, unknown> } | undefined)?.def
      ?? (root._def as Record<string, unknown> | undefined);
    // ZodEffects exposes `.schema` (the inner schema before refinement)
    const inner = (def?.schema as Record<string, unknown> | undefined) ?? def;
    const innerDef = (inner?._zod as { def?: Record<string, unknown> } | undefined)?.def
      ?? (inner?._def as Record<string, unknown> | undefined)
      ?? inner;
    const shape = (innerDef?.shape ?? (inner as Record<string, unknown>)?.shape) as Record<string, unknown> | undefined;
    expect(shape).toBeDefined();
    expect(shape?.deviceName).toBeDefined();
    expect(shape?.deviceId).toBeDefined();
  });

  it('(b) parse accepts deviceId=null + deviceName=null', () => {
    const r = jobResponseSchema.safeParse({ ...validBase, deviceId: null, deviceName: null });
    expect(r.success).toBe(true);
  });

  it('(c) parse accepts deviceId=<uuid> + deviceName="Pixel 7"', () => {
    const r = jobResponseSchema.safeParse({
      ...validBase,
      deviceId: VALID_DEVICE_ID,
      deviceName: 'Pixel 7 (5554)',
    });
    expect(r.success).toBe(true);
  });

  it('(d) parse REJECTS deviceId=<uuid> + deviceName=null', () => {
    const r = jobResponseSchema.safeParse({
      ...validBase,
      deviceId: VALID_DEVICE_ID,
      deviceName: null,
    });
    expect(r.success).toBe(false);
  });

  it('(e) parse REJECTS deviceId=<uuid> + deviceName=""', () => {
    const r = jobResponseSchema.safeParse({
      ...validBase,
      deviceId: VALID_DEVICE_ID,
      deviceName: '',
    });
    expect(r.success).toBe(false);
  });

  it('(f) server/openapi.json components.schemas.Job has deviceName in properties', () => {
    const spec = JSON.parse(readFileSync('server/openapi.json', 'utf-8'));
    expect(spec.components?.schemas?.Job).toBeDefined();
    expect(spec.components.schemas.Job.properties.deviceName).toBeDefined();
    expect(spec.components.schemas.Job.properties.deviceId).toBeDefined();
    // Sanity check: required[] includes deviceName (cross-field gate works at API layer too)
    expect(spec.components.schemas.Job.required).toContain('deviceName');
  });

  // (g) Optional Go cross-tier proof — DEFERRED-23-C if unreachable.
  const GO_AVAILABLE = (() => {
    try {
      const r = spawnSync('go', ['version'], { encoding: 'utf-8' });
      return r.status === 0;
    } catch {
      return false;
    }
  })();
  const itGo = GO_AVAILABLE ? it : it.skip;
  itGo('(g) Go CLI status_test asserts device name is displayed (DEFERRED-23-C if unreachable)', () => {
    // This test runs `cd cli && go test -run TestStatusDeviceName ./...` if the
    // Go test exists. If not present in cli/, this test logs a TODO + passes
    // (DEFERRED-23-C carries the assertion to Phase 28).
    const result = spawnSync('go', ['test', '-run', 'TestStatusDeviceName', './...'], {
      cwd: 'cli',
      encoding: 'utf-8',
    });
    if (result.status === 0) {
      // Go test exists AND passed
      expect(result.status).toBe(0);
    } else if (
      result.stderr.includes('no Go files')
      || result.stderr.includes('no test files')
      || (result.stdout && result.stdout.includes('no tests to run'))
      || result.stdout?.includes('[no tests to run]')
    ) {
      // Go test not yet written — DEFERRED-23-C ownership transfers to Phase 28
      // eslint-disable-next-line no-console
      console.warn('[DEFERRED-23-C] Go-side TestStatusDeviceName not yet present; Phase 28 ships it');
      expect(true).toBe(true);
    } else {
      // Real failure — surface it
      throw new Error(`Go test failed: ${result.stderr || result.stdout}`);
    }
  }, 30_000);
});
