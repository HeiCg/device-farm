import type { Platform } from '../types/index.js';

export type { Platform } from '../types/index.js';

export interface QueuedJob {
  id: string;
  platform: Platform;
  metadata: Record<string, unknown>;
  files: Array<{ filename: string; content: string }>;
  createdAt: Date;
  env?: Record<string, string>;
  apkPath?: string;
}

export interface JobStep {
  flowName: string;
  command: string | null;
  status: 'passed' | 'failed' | 'skipped' | 'running';
  durationMs: number | null;
}

export interface JobSummary {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
}

export interface ParserCallbacks {
  onFlowStart(name: string): void;
  onCommandStatus(command: string, status: string): void;
  onFlowResult(flow: string, status: string, durationMs: number): void;
  onSummary(passed: number, total: number): void;
}
