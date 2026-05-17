import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoryService, type ExecFileFn } from '../memory-service.js';
import type pino from 'pino';

function createMockLogger(): pino.Logger {
  return {
    child: vi.fn().mockReturnThis(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as unknown as pino.Logger;
}

// Sample compact dumpsys meminfo output
const DUMPSYS_OUTPUT = `Applications Memory Usage (in Kilobytes):
Uptime: 123456 Realtime: 123456

** MEMINFO in pid 1234 [com.example.app] **
                   Pss  Private  Private  SwapPss      Rss     Heap     Heap     Heap
                 Total    Dirty    Clean    Dirty    Total     Size    Alloc     Free
                ------   ------   ------   ------   ------   ------   ------   ------
  Native Heap    15432    15400       0        0    17000    20480    16384     4096
  Dalvik Heap     8234     8100       0        0    10000    12288     8192     4096
        TOTAL    45678    42000     1200      500    55000
`;

describe('MemoryService', () => {
  let logger: pino.Logger;
  let execFileFn: ExecFileFn;
  let service: MemoryService;

  beforeEach(() => {
    vi.useFakeTimers();
    logger = createMockLogger();
    execFileFn = vi.fn().mockResolvedValue({ stdout: DUMPSYS_OUTPUT, stderr: '' }) as unknown as ExecFileFn;
    service = new MemoryService(logger, execFileFn);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('startSampling() sets up interval that calls execFile with correct adb args', async () => {
    const onSample = vi.fn();
    service.startSampling('job-1', 'emulator-5554', 1000, onSample);

    // Advance timer to trigger first sample
    await vi.advanceTimersByTimeAsync(1000);

    expect(execFileFn).toHaveBeenCalledWith(
      'adb',
      ['-s', 'emulator-5554', 'shell', 'dumpsys', 'meminfo', 'com.example.app'],
    );
  });

  it('startSampling() parses dumpsys output and calls onSample with MetricsData', async () => {
    const onSample = vi.fn();
    service.startSampling('job-1', 'emulator-5554', 1000, onSample);

    await vi.advanceTimersByTimeAsync(1000);

    expect(onSample).toHaveBeenCalledWith(
      expect.objectContaining({
        totalPss: expect.any(Number),
        nativeHeap: expect.any(Number),
        javaHeap: expect.any(Number),
      }),
    );

    const metrics = onSample.mock.calls[0][0];
    expect(metrics.totalPss).toBe(45678);
    expect(metrics.nativeHeap).toBe(15432);
    expect(metrics.javaHeap).toBe(8234);
  });

  it('stopSampling() clears interval and returns accumulated samples', async () => {
    const onSample = vi.fn();
    service.startSampling('job-1', 'emulator-5554', 1000, onSample);

    // Generate 2 samples
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);

    const result = service.stopSampling('job-1');
    expect(result.samples).toHaveLength(2);
    expect(result.samples[0].totalPss).toBe(45678);
  });

  it('stopSampling() on unknown jobKey returns empty samples', () => {
    const result = service.stopSampling('unknown-job');
    expect(result.samples).toEqual([]);
  });

  it('handles execFile errors gracefully without crashing', async () => {
    const errorExecFile = vi.fn().mockRejectedValueOnce(new Error('adb not found')) as unknown as ExecFileFn;
    service = new MemoryService(logger, errorExecFile);
    const onSample = vi.fn();
    service.startSampling('job-1', 'emulator-5554', 1000, onSample);

    await vi.advanceTimersByTimeAsync(1000);

    // Should not call onSample on error
    expect(onSample).not.toHaveBeenCalled();
  });

  it('writeSamples() writes JSON array to file', async () => {
    const { writeFile } = await import('node:fs/promises');
    vi.mock('node:fs/promises', () => ({
      writeFile: vi.fn().mockResolvedValue(undefined),
    }));

    const samples = [
      { totalPss: 45678, nativeHeap: 15432, javaHeap: 8234 },
    ];

    await service.writeSamples('/tmp/memory.json', samples);

    const { writeFile: mockedWriteFile } = await import('node:fs/promises');
    expect(mockedWriteFile).toHaveBeenCalledWith(
      '/tmp/memory.json',
      JSON.stringify(samples, null, 2),
      'utf-8',
    );
  });

  it('startSampling() throws if already tracking same jobKey', () => {
    const onSample = vi.fn();
    service.startSampling('job-1', 'emulator-5554', 1000, onSample);

    expect(() =>
      service.startSampling('job-1', 'emulator-5554', 1000, onSample),
    ).toThrow(/already sampling/i);
  });
});
