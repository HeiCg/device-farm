import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { Readable } from 'node:stream';

// Mock child_process
vi.mock('node:child_process', async () => {
  const { promisify } = await import('node:util');
  const execFileMock = vi.fn((...args: any[]) => {
    const cb = args[args.length - 1];
    if (typeof cb === 'function') cb(null, '1\n', '');
  }) as any;
  // promisify(execFile) uses this custom symbol to return {stdout, stderr}
  execFileMock[promisify.custom] = vi.fn().mockResolvedValue({ stdout: '1\n', stderr: '' });
  return {
    spawn: vi.fn(),
    execFile: execFileMock,
  };
});

// Mock fs/promises
vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  rm: vi.fn().mockResolvedValue(undefined),
}));

import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import { JobExecutor, type ExecutionResult } from '../job-executor.js';

function createMockProcess(): ChildProcess & EventEmitter {
  const proc = new EventEmitter() as ChildProcess & EventEmitter;
  (proc as any).pid = 12345;
  proc.stdout = new Readable({ read() {} });
  proc.stderr = new Readable({ read() {} });
  (proc as any).killed = false;
  proc.kill = vi.fn();
  return proc;
}

function createLogger() {
  return {
    child: vi.fn().mockReturnThis(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as any;
}

describe('JobExecutor', () => {
  let executor: JobExecutor;
  let logger: any;

  beforeEach(() => {
    vi.clearAllMocks();
    logger = createLogger();
    executor = new JobExecutor(logger, 30);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('writeFlowFiles', () => {
    it('creates temp dir and writes files', async () => {
      const files = [
        { filename: 'login.yaml', content: 'appId: com.test\n---\n- launchApp' },
        { filename: 'signup.yaml', content: 'appId: com.test\n---\n- tapOn: SignUp' },
      ];

      const dir = await executor.writeFlowFiles('job-123', files);

      expect(dir).toBe('/tmp/device-farm/jobs/job-123');
      expect(fs.mkdir).toHaveBeenCalledWith('/tmp/device-farm/jobs/job-123', { recursive: true });
      expect(fs.writeFile).toHaveBeenCalledTimes(2);
      expect(fs.writeFile).toHaveBeenCalledWith(
        '/tmp/device-farm/jobs/job-123/login.yaml',
        'appId: com.test\n---\n- launchApp',
      );
      expect(fs.writeFile).toHaveBeenCalledWith(
        '/tmp/device-farm/jobs/job-123/signup.yaml',
        'appId: com.test\n---\n- tapOn: SignUp',
      );
    });
  });

  describe('cleanupTempDir', () => {
    it('removes the job temp directory', async () => {
      await executor.cleanupTempDir('job-456');

      expect(fs.rm).toHaveBeenCalledWith('/tmp/device-farm/jobs/job-456', {
        recursive: true,
        force: true,
      });
    });
  });

  describe('execute', () => {
    it('spawns maestro with correct args for Android (ANDROID_SERIAL in env)', async () => {
      const mockProc = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProc);

      const executePromise = executor.execute({
        jobId: 'job-1',
        flowDir: '/tmp/device-farm/jobs/job-1',
        deviceId: 'emulator-5554',
        platform: 'android',
      });

      // Emit exit after a tick
      process.nextTick(() => {
        mockProc.stdout!.push(null);
        mockProc.stderr!.push(null);
        mockProc.emit('exit', 0, null);
      });

      await executePromise;

      expect(spawn).toHaveBeenCalledWith(
        'maestro',
        ['test', '/tmp/device-farm/jobs/job-1', '--device', 'emulator-5554'],
        expect.objectContaining({
          detached: true,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: expect.objectContaining({
            ANDROID_SERIAL: 'emulator-5554',
          }),
        }),
      );
    });

    it('spawns maestro with --device flag for iOS', async () => {
      const mockProc = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProc);

      const executePromise = executor.execute({
        jobId: 'job-2',
        flowDir: '/tmp/device-farm/jobs/job-2',
        deviceId: 'AAAA-BBBB-CCCC',
        platform: 'ios',
      });

      process.nextTick(() => {
        mockProc.stdout!.push(null);
        mockProc.stderr!.push(null);
        mockProc.emit('exit', 0, null);
      });

      await executePromise;

      expect(spawn).toHaveBeenCalledWith(
        'maestro',
        ['test', '/tmp/device-farm/jobs/job-2', '--device', 'AAAA-BBBB-CCCC'],
        expect.objectContaining({
          detached: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        }),
      );
    });

    it('parses stdout lines via MaestroParser and returns steps in result', async () => {
      const mockProc = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProc);

      const executePromise = executor.execute({
        jobId: 'job-3',
        flowDir: '/tmp/flows',
        deviceId: 'dev-1',
        platform: 'android',
      });

      // Push Maestro output lines (setTimeout to wait for waitForDevice + spawn)
      setTimeout(() => {
        mockProc.stdout!.push('Running flow login\n');
        mockProc.stdout!.push('[Passed] login (5s)\n');
        mockProc.stdout!.push('1/1 Flows Passed\n');
        mockProc.stdout!.push(null);
        mockProc.stderr!.push(null);
        mockProc.emit('exit', 0, null);
      }, 10);

      const result = await executePromise;

      expect(result.steps).toHaveLength(1);
      expect(result.steps[0]).toEqual(
        expect.objectContaining({
          flowName: 'login',
          status: 'passed',
          durationMs: 5000,
        }),
      );
      expect(result.summary.total).toBe(1);
      expect(result.summary.passed).toBe(1);
      expect(result.status).toBe('passed');
    });

    it('returns status "failed" when exit code is non-zero', async () => {
      const mockProc = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProc);

      const executePromise = executor.execute({
        jobId: 'job-4',
        flowDir: '/tmp/flows',
        deviceId: 'dev-1',
        platform: 'android',
      });

      process.nextTick(() => {
        mockProc.stdout!.push('[Failed] login (3s)\n');
        mockProc.stdout!.push('0/1 Flows Failed\n');
        mockProc.stdout!.push(null);
        mockProc.stderr!.push(null);
        mockProc.emit('exit', 1, null);
      });

      const result = await executePromise;

      expect(result.status).toBe('failed');
      expect(result.exitCode).toBe(1);
    });

    it('kills process group on timeout (negative PID)', async () => {
      // Use a short timeout for testing
      const shortExecutor = new JobExecutor(logger, 0.001); // ~60ms
      const mockProc = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProc);

      // Mock process.kill for the group kill
      const processKillSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);

      const executePromise = shortExecutor.execute({
        jobId: 'job-5',
        flowDir: '/tmp/flows',
        deviceId: 'dev-1',
        platform: 'android',
      });

      // Wait for timeout to fire, then emit exit
      await new Promise((r) => setTimeout(r, 200));
      mockProc.stdout!.push(null);
      mockProc.stderr!.push(null);
      mockProc.emit('exit', null, 'SIGTERM');

      const result = await executePromise;

      // Should have called process.kill with negative PID (process group kill)
      expect(processKillSpy).toHaveBeenCalledWith(-12345, 'SIGTERM');
      expect(result.status).toBe('timeout');

      processKillSpy.mockRestore();
    });

    it('cancels via AbortSignal and kills process', async () => {
      const mockProc = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProc);

      const processKillSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);

      const abortController = new AbortController();

      const executePromise = executor.execute({
        jobId: 'job-6',
        flowDir: '/tmp/flows',
        deviceId: 'dev-1',
        platform: 'android',
        signal: abortController.signal,
      });

      // Abort after a small delay
      setTimeout(() => {
        abortController.abort();
      }, 50);

      // Wait for abort, then emit exit
      await new Promise((r) => setTimeout(r, 150));
      mockProc.stdout!.push(null);
      mockProc.stderr!.push(null);
      mockProc.emit('exit', null, 'SIGTERM');

      const result = await executePromise;

      expect(processKillSpy).toHaveBeenCalledWith(-12345, 'SIGTERM');
      expect(result.status).toBe('cancelled');

      processKillSpy.mockRestore();
    });
  });
});
