import { describe, it, expect } from 'vitest';
import { renderResults, type RunMeta, type ConfigReportInput } from '../report.js';
import { getAdapter } from '../../adapters.js';
import type { ConfigCapture } from '../types.js';

function pendingCapture(id: string): ConfigCapture {
  return {
    configId: id,
    description: getAdapter(id).description,
    counter: 'js-tiktoken/o200k_base',
    counterApproximate: true,
    live: false,
    pendingReason: 'on-device server unbuildable in this environment',
    fixed: {
      configId: id,
      artifacts: [{ name: 'tool defs', bytes: 4000, tokens: 1000 }],
      totalBytes: 4000,
      totalTokens: 1000,
    },
    calls: [],
    capturedAt: '2026-08-31T00:00:00Z',
  };
}

function liveCapture(id: string): ConfigCapture {
  return {
    configId: id,
    description: getAdapter(id).description,
    counter: 'js-tiktoken/o200k_base',
    counterApproximate: true,
    live: true,
    fixed: {
      configId: id,
      artifacts: [{ name: 'dsl_run_script + .d.ts', bytes: 9000, tokens: 2300 }],
      totalBytes: 9000,
      totalTokens: 2300,
    },
    calls: [
      { step: 1, tool: 'dsl_describe', origin: 'agent', requestBytes: 2, requestTokens: 1, resultBytes: 400, resultTokens: 200, contentTypes: ['text'] },
      { step: 2, tool: 'dsl_run_script', origin: 'agent', requestBytes: 600, requestTokens: 150, resultBytes: 20, resultTokens: 5, contentTypes: ['text'] },
    ],
    describeSize: { bytes: 400, tokens: 200 },
    capturedAt: '2026-08-31T00:00:00Z',
  };
}

const meta: RunMeta = {
  counter: 'js-tiktoken/o200k_base',
  counterApproximate: true,
  counterDisclaimer: 'approx disclaimer text',
  argentSha: 'b835de2',
  argentVersion: '0.22.1',
  emulatorImage: 'Pixel 7, Android 15',
  scenarioName: 'android-settings-10-step',
  generatedAt: '2026-08-31T00:00:00Z',
  stepCount: 10,
};

describe('report — RESULTS.md rendering', () => {
  const inputs: ConfigReportInput[] = [
    { adapter: getAdapter('A1'), capture: pendingCapture('A1') },
    { adapter: getAdapter('C1'), capture: liveCapture('C1') },
  ];
  const md = renderResults(inputs, meta);

  it('states the token counter and disclaimer', () => {
    expect(md).toContain('js-tiktoken/o200k_base');
    expect(md).toContain('approx disclaimer text');
  });

  it('records the argent SHA and version', () => {
    expect(md).toContain('b835de2');
    expect(md).toContain('0.22.1');
  });

  it('marks a pending config with pending cells and a reason', () => {
    expect(md).toContain('| A1 | 1000 | pending | pending | pending |');
    expect(md).toContain('on-device server unbuildable in this environment');
  });

  it('shows live billing numbers for a live config', () => {
    // fixed 2300; added: (1+200)=201, (150+5)=155 -> cached = 2300+356 = 2656
    expect(md).toContain('| C1 | 2300 | 356 | 2656 |');
  });

  it('prints the adapter fairness table for each config', () => {
    expect(md).toContain('Per-model adapter tables (fairness audit)');
    expect(md).toContain('auto-screenshot'); // A1 appends auto-screenshot + auto-describe
    expect(md).toContain('dsl_run_script'); // C1 collapses the flow into one script call
  });

  it('includes measured describe sizes and a fixed-context breakdown', () => {
    expect(md).toContain('Measured describe sizes');
    expect(md).toContain('Fixed-context breakdown');
  });

  it('contains no prose-conclusion words (numbers and method only)', () => {
    // guard against accidentally editorializing the results
    for (const banned of ['therefore', 'conclusion', 'we conclude', 'clearly', 'winner', 'better than', 'worse than']) {
      expect(md.toLowerCase()).not.toContain(banned);
    }
  });
});
