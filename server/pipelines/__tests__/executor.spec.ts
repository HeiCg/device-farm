import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PipelineExecutor } from '../internal/executor.js';
import type pino from 'pino';

function createLogger() {
  return {
    child: vi.fn().mockReturnThis(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as unknown as pino.Logger;
}

describe('PipelineExecutor', () => {
  let executor: PipelineExecutor;

  beforeEach(() => {
    executor = new PipelineExecutor(createLogger());
  });

  describe('executeScript', () => {
    it('executes a simple echo and captures stdout', async () => {
      const result = await executor.executeScript({
        script: 'echo "hello world"',
        workDir: '/tmp',
        variables: {},
        timeoutMs: 5000,
        onLog: vi.fn(),
      });
      expect(result.status).toBe('passed');
      expect(result.logs).toContain('hello world');
    });

    it('returns failed for non-zero exit code', async () => {
      const result = await executor.executeScript({
        script: 'exit 1',
        workDir: '/tmp',
        variables: {},
        timeoutMs: 5000,
        onLog: vi.fn(),
      });
      expect(result.status).toBe('failed');
    });

    it('interpolates variables in the script', async () => {
      const result = await executor.executeScript({
        script: 'echo "{{greeting}}"',
        workDir: '/tmp',
        variables: { greeting: 'hola' },
        timeoutMs: 5000,
        onLog: vi.fn(),
      });
      expect(result.status).toBe('passed');
      expect(result.logs).toContain('hola');
    });

    it('times out long-running scripts', async () => {
      const result = await executor.executeScript({
        script: 'sleep 30',
        workDir: '/tmp',
        variables: {},
        timeoutMs: 500,
        onLog: vi.fn(),
      });
      expect(result.status).toBe('failed');
      expect(result.error).toContain('timeout');
    }, 10_000);

    it('streams logs line by line via onLog callback', async () => {
      const onLog = vi.fn();
      await executor.executeScript({
        script: 'echo "line1"\necho "line2"',
        workDir: '/tmp',
        variables: {},
        timeoutMs: 5000,
        onLog,
      });
      expect(onLog).toHaveBeenCalledWith(expect.stringContaining('line1'));
      expect(onLog).toHaveBeenCalledWith(expect.stringContaining('line2'));
    });
  });

  describe('evaluateCondition', () => {
    it('returns true for success when no failures', () => {
      expect(executor.evaluateCondition('success', false)).toBe(true);
    });

    it('returns false for success when there are failures', () => {
      expect(executor.evaluateCondition('success', true)).toBe(false);
    });

    it('returns true for failure when there are failures', () => {
      expect(executor.evaluateCondition('failure', true)).toBe(true);
    });

    it('returns false for failure when no failures', () => {
      expect(executor.evaluateCondition('failure', false)).toBe(false);
    });

    it('returns true for always regardless', () => {
      expect(executor.evaluateCondition('always', false)).toBe(true);
      expect(executor.evaluateCondition('always', true)).toBe(true);
    });
  });
});
