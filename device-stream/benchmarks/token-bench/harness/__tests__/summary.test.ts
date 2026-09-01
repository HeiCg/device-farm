import { describe, it, expect } from 'vitest';
import { renderSummary, type SummaryInput } from '../summary.js';
import type { RunMeta } from '../report.js';
import { getAdapter } from '../../adapters.js';
import type { ConfigCapture, CallRecord } from '../types.js';

function cap(id: string, fixed: number, calls: CallRecord[]): ConfigCapture {
  return {
    configId: id,
    description: getAdapter(id).description,
    counter: 'js-tiktoken/o200k_base',
    counterApproximate: true,
    live: calls.length > 0,
    fixed: { configId: id, artifacts: [], totalBytes: fixed * 4, totalTokens: fixed },
    calls,
    capturedAt: '2026-08-31T00:00:00Z',
  };
}
const call = (step: number, tool: string, add: number): CallRecord => ({
  step,
  tool,
  origin: 'agent',
  requestBytes: 0,
  requestTokens: 0,
  resultBytes: 0,
  resultTokens: add,
  contentTypes: ['text'],
});

const meta: RunMeta = {
  counter: 'js-tiktoken/o200k_base',
  counterApproximate: true,
  counterDisclaimer: null,
  argentSha: 'a2ed83e0',
  argentVersion: '0.22.1',
  forkSha: 'deadbeef',
  emulatorImage: 'Pixel 7',
  scenarioName: 'android-settings-10-step',
  generatedAt: '2026-08-31T00:00:00Z',
  stepCount: 10,
};

describe('summary — fork-vs-upstream interpretation', () => {
  // A1: fixed 100, one call adding 100 => cached 200. F1: fixed 100, one call adding 50 => cached 150.
  const inputs: SummaryInput[] = [
    { adapter: getAdapter('A1'), capture: cap('A1', 100, [call(1, 'launch-app', 100)]) },
    { adapter: getAdapter('A4'), capture: cap('A4', 100, [call(1, 'run-sequence', 50)]) },
    { adapter: getAdapter('F1'), capture: cap('F1', 100, [call(2, 'describe', 25), call(3, 'run-script', 25)]) },
  ];
  const md = renderSummary(inputs, meta);

  it('renders side-by-side platform tables', () => {
    expect(md).toContain('### Android');
    expect(md).toContain('### iOS simulator');
  });

  it('computes the A1÷F billedCached multiplier', () => {
    // A1 cached = 100 + 100 = 200; F1 cached = 100 + 50 = 150; ratio 1.33×
    expect(md).toContain('1.33×');
  });

  it('states the caveats including the approximate counter and iOS navigation mirror', () => {
    expect(md).toContain('Approximate counter');
    expect(md).toContain('navigation mirror');
  });

  it('names the fork and upstream base commit provenance', () => {
    expect(md).toContain('a2ed83e0');
  });
});
