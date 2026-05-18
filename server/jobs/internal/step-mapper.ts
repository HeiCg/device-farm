import type { JobStep } from '../types.js';

export interface PersistedStepRow {
  jobId: string;
  stepIndex: number;
  flowName: string | null;
  command: string | null;
  status: JobStep['status'];
  durationMs: number | null;
  startedAt?: Date;
  finishedAt?: Date;
}

/**
 * Build INSERT rows for job_steps. When the parser captured wallclock
 * timestamps for a command, attach them; otherwise leave the columns to
 * DB defaults (started_at = now()) so old behavior is preserved.
 */
export function mapStepsForPersistence(
  jobId: string,
  steps: JobStep[],
  timestamps: Map<string, { startedAt: Date; endedAt?: Date }>,
): PersistedStepRow[] {
  return steps.map((step, index) => {
    const key = step.command ?? '';
    const ts = key ? timestamps.get(key) : undefined;
    const row: PersistedStepRow = {
      jobId,
      stepIndex: index,
      flowName: step.flowName,
      command: step.command,
      status: step.status,
      durationMs: step.durationMs,
    };
    if (ts) {
      row.startedAt = ts.startedAt;
      if (ts.endedAt) row.finishedAt = ts.endedAt;
    }
    return row;
  });
}
