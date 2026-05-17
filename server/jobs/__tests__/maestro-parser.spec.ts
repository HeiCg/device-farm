import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MaestroParser } from '../maestro-parser.js';
import type { ParserCallbacks, JobSummary } from '../types.js';

function makeCallbacks(): ParserCallbacks & {
  calls: Record<string, unknown[][]>;
} {
  const calls: Record<string, unknown[][]> = {
    onFlowStart: [],
    onCommandStatus: [],
    onFlowResult: [],
    onSummary: [],
  };
  return {
    calls,
    onFlowStart(name: string) {
      calls.onFlowStart.push([name]);
    },
    onCommandStatus(command: string, status: string) {
      calls.onCommandStatus.push([command, status]);
    },
    onFlowResult(flow: string, status: string, durationMs: number) {
      calls.onFlowResult.push([flow, status, durationMs]);
    },
    onSummary(passed: number, total: number) {
      calls.onSummary.push([passed, total]);
    },
  };
}

describe('MaestroParser', () => {
  let parser: MaestroParser;
  let callbacks: ReturnType<typeof makeCallbacks>;

  beforeEach(() => {
    callbacks = makeCallbacks();
    parser = new MaestroParser(callbacks);
  });

  describe('flow start detection', () => {
    it('detects plain flow start lines', () => {
      parser.parseLine('Running flow login-test');
      expect(callbacks.calls.onFlowStart).toEqual([['login-test']]);
    });

    it('detects shard-prefixed flow start lines', () => {
      parser.parseLine('[shard 1] Running flow signup-flow');
      expect(callbacks.calls.onFlowStart).toEqual([['signup-flow']]);
    });
  });

  describe('command status detection', () => {
    it('detects COMPLETED commands', () => {
      parser.parseLine('Tap on element COMPLETED');
      expect(callbacks.calls.onCommandStatus).toEqual([
        ['Tap on element', 'COMPLETED'],
      ]);
    });

    it('detects FAILED commands', () => {
      parser.parseLine('Assert visible FAILED');
      expect(callbacks.calls.onCommandStatus).toEqual([
        ['Assert visible', 'FAILED'],
      ]);
    });

    it('detects SKIPPED commands', () => {
      parser.parseLine('Scroll down SKIPPED');
      expect(callbacks.calls.onCommandStatus).toEqual([
        ['Scroll down', 'SKIPPED'],
      ]);
    });

    it('detects RUNNING commands', () => {
      parser.parseLine('Input text RUNNING');
      expect(callbacks.calls.onCommandStatus).toEqual([
        ['Input text', 'RUNNING'],
      ]);
    });

    it('detects shard-prefixed command status', () => {
      parser.parseLine('[shard 2] Tap on button COMPLETED');
      expect(callbacks.calls.onCommandStatus).toEqual([
        ['Tap on button', 'COMPLETED'],
      ]);
    });
  });

  describe('flow result detection', () => {
    it('detects passed flow with duration', () => {
      parser.parseLine('[Passed] login-test (12s)');
      expect(callbacks.calls.onFlowResult).toEqual([
        ['login-test', 'Passed', 12000],
      ]);
    });

    it('detects failed flow with duration', () => {
      parser.parseLine('[Failed] checkout-flow (45s)');
      expect(callbacks.calls.onFlowResult).toEqual([
        ['checkout-flow', 'Failed', 45000],
      ]);
    });

    it('detects canceled flow with duration', () => {
      parser.parseLine('[Canceled] slow-test (120s)');
      expect(callbacks.calls.onFlowResult).toEqual([
        ['slow-test', 'Canceled', 120000],
      ]);
    });

    it('detects shard-prefixed flow result', () => {
      parser.parseLine('[shard 1] [Passed] profile-test (8s)');
      expect(callbacks.calls.onFlowResult).toEqual([
        ['profile-test', 'Passed', 8000],
      ]);
    });
  });

  describe('suite summary detection', () => {
    it('detects "Flows Passed" summary', () => {
      parser.parseLine('3/4 Flows Passed');
      expect(callbacks.calls.onSummary).toEqual([[3, 4]]);
    });

    it('detects "Flows Failed" summary', () => {
      parser.parseLine('1/5 Flows Failed');
      expect(callbacks.calls.onSummary).toEqual([[1, 5]]);
    });

    it('detects singular "Flow Passed"', () => {
      parser.parseLine('1/1 Flow Passed');
      expect(callbacks.calls.onSummary).toEqual([[1, 1]]);
    });
  });

  describe('ANSI code stripping', () => {
    it('strips ANSI codes before matching', () => {
      // Wrap in ANSI color escape sequences
      parser.parseLine('\x1b[32mRunning flow colored-test\x1b[0m');
      expect(callbacks.calls.onFlowStart).toEqual([['colored-test']]);
    });

    it('strips ANSI codes from flow results', () => {
      parser.parseLine('\x1b[32m[Passed]\x1b[0m login-test (5s)');
      expect(callbacks.calls.onFlowResult).toEqual([
        ['login-test', 'Passed', 5000],
      ]);
    });
  });

  describe('unrecognized lines', () => {
    it('collects unrecognized lines in rawOutput', () => {
      parser.parseLine('Some random debug output');
      parser.parseLine('Another unknown line');
      expect(parser.getRawOutput()).toBe(
        'Some random debug output\nAnother unknown line',
      );
    });

    it('does not include recognized lines in rawOutput', () => {
      parser.parseLine('Running flow test1');
      parser.parseLine('Some debug line');
      parser.parseLine('[Passed] test1 (3s)');
      expect(parser.getRawOutput()).toBe('Some debug line');
    });
  });

  describe('getSummary() aggregation', () => {
    it('computes summary from flow results', () => {
      parser.parseLine('[Passed] test1 (5s)');
      parser.parseLine('[Passed] test2 (3s)');
      parser.parseLine('[Failed] test3 (10s)');

      const summary = parser.getSummary();
      expect(summary).toEqual({
        total: 3,
        passed: 2,
        failed: 1,
        skipped: 0,
      });
    });

    it('returns zero summary for empty input', () => {
      const summary = parser.getSummary();
      expect(summary).toEqual({
        total: 0,
        passed: 0,
        failed: 0,
        skipped: 0,
      });
    });

    it('counts canceled flows as skipped', () => {
      parser.parseLine('[Passed] test1 (5s)');
      parser.parseLine('[Canceled] test2 (2s)');

      const summary = parser.getSummary();
      expect(summary).toEqual({
        total: 2,
        passed: 1,
        failed: 0,
        skipped: 1,
      });
    });

    it('uses suite summary line when available', () => {
      parser.parseLine('[Passed] test1 (5s)');
      parser.parseLine('[Failed] test2 (3s)');
      parser.parseLine('1/2 Flows Failed');

      const summary = parser.getSummary();
      // Suite summary says 1 passed out of 2 total (via "Failed" line, passed = total - failed context)
      // But we aggregate from flow results for accuracy
      expect(summary.total).toBe(2);
      expect(summary.passed).toBe(1);
      expect(summary.failed).toBe(1);
    });
  });

  describe('getSteps()', () => {
    it('returns accumulated steps from flow results', () => {
      parser.parseLine('Running flow login-test');
      parser.parseLine('Tap on button COMPLETED');
      parser.parseLine('[Passed] login-test (5s)');

      const steps = parser.getSteps();
      expect(steps.length).toBeGreaterThanOrEqual(1);
      expect(steps.some((s) => s.flowName === 'login-test')).toBe(true);
    });
  });
});
