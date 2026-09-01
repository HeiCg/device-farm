import { describe, it, expect } from 'vitest';
import { ADAPTERS, getAdapter, roundTripCount, stepCount } from '../../adapters.js';

describe('adapters — per-model expansion tables', () => {
  it('has the required configuration set A1-A4, B1, C1-C2 + fork/iOS/integration extension', () => {
    expect(ADAPTERS.map((a) => a.id).sort()).toEqual(
      ['A1', 'A1-ios', 'A2', 'A3', 'A4', 'A4-ios', 'B1', 'C1', 'C2', 'F1', 'F2', 'FX', 'FX-ios'].sort(),
    );
  });

  it('FX/FX-ios are the integration branch (both flags) with the run-script shape', () => {
    for (const id of ['FX', 'FX-ios']) {
      const a = getAdapter(id);
      expect(a.variant).toBe('integration');
      const agentCalls = a.plan.filter((p) => p.origin === 'agent');
      expect(agentCalls.map((p) => p.tool)).toEqual(['describe', 'run-script']);
    }
    expect(getAdapter('FX').platform).toBe('android');
    expect(getAdapter('FX-ios').platform).toBe('ios');
  });

  it('every configuration declares a platform and a variant', () => {
    for (const a of ADAPTERS) {
      expect(['android', 'ios']).toContain(a.platform);
      expect(['upstream', 'fork', 'integration', 'device-stream']).toContain(a.variant);
    }
  });

  it('F1/F2 are one orientation describe + one run-script call (auto-capture bundled)', () => {
    for (const id of ['F1', 'F2']) {
      const a = getAdapter(id);
      expect(a.variant).toBe('fork');
      const agentCalls = a.plan.filter((p) => p.origin === 'agent');
      expect(agentCalls.map((p) => p.tool)).toEqual(['describe', 'run-script']);
      expect(a.plan.some((p) => p.tool === 'run-script' && p.coversSteps.length === 10)).toBe(true);
    }
    expect(getAdapter('F1').platform).toBe('android');
    expect(getAdapter('F2').platform).toBe('ios');
  });

  it('A1-ios is verb-per-call on iOS with an explicit orientation describe', () => {
    const a = getAdapter('A1-ios');
    expect(a.platform).toBe('ios');
    expect(a.variant).toBe('upstream');
    // iOS launch-app does not auto-describe, so step 2 is an explicit agent describe.
    const step2 = a.plan.filter((p) => p.coversSteps.includes(2) && p.origin === 'agent');
    expect(step2.some((p) => p.tool === 'describe')).toBe(true);
    expect(a.plan.some((p) => p.origin === 'auto-screenshot')).toBe(true);
  });

  it('A4-ios is a single run-sequence agent call plus one auto-capture pair', () => {
    const a = getAdapter('A4-ios');
    expect(a.platform).toBe('ios');
    const agentCalls = a.plan.filter((p) => p.origin === 'agent');
    expect(agentCalls).toHaveLength(1);
    expect(agentCalls[0].tool).toBe('run-sequence');
  });

  it('every configuration covers all 10 logical steps', () => {
    for (const a of ADAPTERS) {
      const covered = new Set<number>();
      for (const p of a.plan) for (const s of p.coversSteps) covered.add(s);
      for (let s = 1; s <= stepCount(); s++) {
        expect(covered.has(s), `${a.id} missing step ${s}`).toBe(true);
      }
    }
  });

  it('A1/A2 append both auto-screenshot and auto-describe after each interaction', () => {
    for (const id of ['A1', 'A2']) {
      const a = getAdapter(id);
      expect(a.autoScreenshot).toBe(true);
      expect(a.autoDescribe).toBe(true);
      expect(a.plan.some((p) => p.origin === 'auto-screenshot')).toBe(true);
      expect(a.plan.some((p) => p.origin === 'auto-describe')).toBe(true);
    }
  });

  it('A3 keeps the element tree but drops auto-screenshot', () => {
    const a = getAdapter('A3');
    expect(a.autoScreenshot).toBe(false);
    expect(a.plan.some((p) => p.origin === 'auto-screenshot')).toBe(false);
    expect(a.plan.some((p) => p.origin === 'auto-describe')).toBe(true);
  });

  it('A4 is a single run-sequence agent call plus one auto-capture pair', () => {
    const a = getAdapter('A4');
    const agentCalls = a.plan.filter((p) => p.origin === 'agent');
    expect(agentCalls).toHaveLength(1);
    expect(agentCalls[0].tool).toBe('run-sequence');
  });

  it('B1 pays an explicit describe for orientation and every assert (no auto-capture)', () => {
    const a = getAdapter('B1');
    expect(a.autoDescribe).toBe(false);
    expect(a.plan.every((p) => p.origin === 'agent')).toBe(true);
    const describes = a.plan.filter((p) => p.tool === 'dsl_describe').length;
    expect(describes).toBeGreaterThanOrEqual(6);
  });

  it('C1 is one orientation describe + one script round-trip', () => {
    const a = getAdapter('C1');
    expect(a.plan).toHaveLength(2);
    expect(a.plan[0].tool).toBe('dsl_describe');
    expect(a.plan[1].tool).toBe('dsl_run_script');
  });

  it('C2 adds a second script round-trip for the selector-miss recovery', () => {
    const a = getAdapter('C2');
    const scripts = a.plan.filter((p) => p.tool === 'dsl_run_script');
    expect(scripts).toHaveLength(2);
  });

  it('round-trip counts are ordered C1 < C2 < B1 and A1 has the most', () => {
    const rt = (id: string) => roundTripCount(getAdapter(id));
    expect(rt('C1')).toBeLessThan(rt('C2'));
    expect(rt('C2')).toBeLessThan(rt('B1'));
    expect(rt('A1')).toBeGreaterThan(rt('B1'));
  });
});
