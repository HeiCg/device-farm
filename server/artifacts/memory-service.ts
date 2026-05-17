import { execFile as nodeExecFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile } from 'node:fs/promises';
import type pino from 'pino';
import type { MetricsData } from '../streaming/internal/types.js';

export type ExecFileFn = (cmd: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;

const defaultExecFile: ExecFileFn = promisify(nodeExecFile);

interface SamplingHandle {
  interval: ReturnType<typeof setInterval>;
  samples: MetricsData[];
}

export class MemoryService {
  private readonly logger: pino.Logger;
  private readonly execFileFn: ExecFileFn;
  private readonly handles: Map<string, SamplingHandle> = new Map();

  constructor(logger: pino.Logger, execFileFn?: ExecFileFn) {
    this.logger = logger.child({ component: 'memory-service' });
    this.execFileFn = execFileFn ?? defaultExecFile;
  }

  startSampling(
    jobKey: string,
    deviceId: string,
    intervalMs: number,
    onSample: (metrics: MetricsData) => void,
    packageName: string = 'com.example.app',
  ): void {
    if (this.handles.has(jobKey)) {
      throw new Error(`Already sampling for job ${jobKey}`);
    }

    const samples: MetricsData[] = [];

    const interval = setInterval(async () => {
      try {
        const { stdout } = await this.execFileFn('adb', [
          '-s', deviceId, 'shell', 'dumpsys', 'meminfo', packageName,
        ]);
        const metrics = this.parseDumpsys(stdout);
        if (metrics) {
          samples.push(metrics);
          onSample(metrics);
        }
      } catch (err: any) {
        this.logger.error({ jobKey, error: err.message }, 'Failed to sample memory');
      }
    }, intervalMs);

    this.handles.set(jobKey, { interval, samples });
    this.logger.info({ jobKey, deviceId, intervalMs }, 'Memory sampling started');
  }

  stopSampling(jobKey: string): { samples: MetricsData[] } {
    const handle = this.handles.get(jobKey);
    if (!handle) {
      this.logger.warn({ jobKey }, 'No sampling session found to stop');
      return { samples: [] };
    }

    clearInterval(handle.interval);
    const samples = [...handle.samples];
    this.handles.delete(jobKey);
    this.logger.info({ jobKey, sampleCount: samples.length }, 'Memory sampling stopped');
    return { samples };
  }

  async writeSamples(outputPath: string, samples: MetricsData[]): Promise<void> {
    await writeFile(outputPath, JSON.stringify(samples, null, 2), 'utf-8');
    this.logger.info({ outputPath, sampleCount: samples.length }, 'Memory samples written');
  }

  private parseDumpsys(output: string): MetricsData | null {
    let totalPss = 0;
    let nativeHeap = 0;
    let javaHeap = 0;

    const lines = output.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();

      // Parse "TOTAL    45678    ..." line
      if (/^TOTAL\s/.test(trimmed)) {
        const parts = trimmed.split(/\s+/);
        const pss = parseInt(parts[1], 10);
        if (!isNaN(pss)) totalPss = pss;
      }

      // Parse "Native Heap    15432    ..." line
      if (/^Native Heap\s/.test(trimmed)) {
        const parts = trimmed.split(/\s+/);
        const pss = parseInt(parts[2], 10);
        if (!isNaN(pss)) nativeHeap = pss;
      }

      // Parse "Dalvik Heap     8234    ..." line
      if (/^Dalvik Heap\s/.test(trimmed)) {
        const parts = trimmed.split(/\s+/);
        const pss = parseInt(parts[2], 10);
        if (!isNaN(pss)) javaHeap = pss;
      }
    }

    if (totalPss === 0 && nativeHeap === 0 && javaHeap === 0) {
      this.logger.warn('Could not parse any memory metrics from dumpsys output');
      return null;
    }

    return { totalPss, nativeHeap, javaHeap };
  }
}
