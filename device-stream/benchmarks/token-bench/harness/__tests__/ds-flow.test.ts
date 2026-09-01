import { describe, it, expect } from 'vitest';
import { b1Plan, C_SCRIPT, C_SCRIPT_MISS } from '../ds-flow.js';

describe('ds-flow — B1 plan + C scripts', () => {
  it('B1 covers all 10 logical steps with atomic dsl_* calls only', () => {
    const covered = new Set(b1Plan().map((c) => c.step));
    for (let s = 1; s <= 10; s++) expect(covered.has(s), `missing step ${s}`).toBe(true);
    expect(b1Plan().every((c) => c.tool.startsWith('dsl_'))).toBe(true);
  });

  it('B1 pays an explicit dsl_describe for orientation and each assert (no auto-capture)', () => {
    const describes = b1Plan().filter((c) => c.tool === 'dsl_describe').length;
    expect(describes).toBeGreaterThanOrEqual(6);
  });

  it('the C happy-path script drives the flow without ds.launchApp (monkey no-op here)', () => {
    expect(C_SCRIPT).not.toContain('launchApp');
    expect(C_SCRIPT).toContain("tapOn({ text: 'Network & internet' })");
    expect(C_SCRIPT).toContain('flow-complete');
  });

  it('the C2 miss script uses a deliberately wrong selector to trigger the WS1 diagnostic', () => {
    expect(C_SCRIPT_MISS).toContain('Netwrok'); // typo on purpose
  });
});
