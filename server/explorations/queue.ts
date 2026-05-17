/**
 * Explorations module — pg-boss queue contract (Phase 35 Plan 35-00 + Plan 35-02).
 *
 * Plan 35-00 substrate: shipped the queue-name alias + payload type.
 * Plan 35-02 (this file extension): adds `registerExplorationsRunWorker(boss, deps)`
 * which calls boss.createQueue with `policy:'stately'` + `retryLimit:0`
 * (agent runs are not retryable — partial DB state is preserved) and
 * boss.work attaches the handler that invokes `runExploration(payload.runId, deps)`.
 *
 * Why retryLimit:0 — same rationale as jobs.execute: the handler boots an
 * external MCP child process and drives the Claude Agent SDK. Side effects
 * are not idempotent; retry would re-spend the run's budget without value.
 *
 * Why policy:'stately' — combined with `singletonKey: runId` on `boss.send`,
 * this drops duplicate enqueues for the same run (defense-in-depth alongside
 * the row-level CHECK that explorations.status starts at 'queued').
 */
import type { PgBoss, Job } from 'pg-boss';
import { z } from 'zod';

import { runExploration, type ExplorationRunnerDeps } from './internal/agent-runner.js';

/** Queue name — kept stable across plans (already shipped in 35-00 substrate). */
export const EXPLORATION_RUN_QUEUE_NAME = 'exploration.run' as const;

/** Payload schema — runId is the only mandatory field; worker re-fetches the row. */
export const explorationRunPayloadSchema = z.object({
  runId: z.string().uuid(),
});

export type ExplorationRunPayload = z.infer<typeof explorationRunPayloadSchema>;

/**
 * Plan 35-02 — idempotent queue + worker registration.
 *
 * Called from createExplorationsModule.registerWorker() on plugin onReady.
 * Returns the workerId so the caller can `boss.offWork(workerId)` on shutdown.
 *
 * Mirrors server/jobs/queue.ts registerJobsExecuteWorker shape verbatim.
 */
export async function registerExplorationsRunWorker(
  boss: PgBoss,
  deps: ExplorationRunnerDeps,
): Promise<string> {
  await boss.createQueue(EXPLORATION_RUN_QUEUE_NAME, {
    policy: 'stately',
    retryLimit: 0,
    // Allow up to 2h per run (max budgetSeconds is 7200 per the start request schema).
    expireInSeconds: 7200,
  } as never);

  const workerId = await boss.work<ExplorationRunPayload>(
    EXPLORATION_RUN_QUEUE_NAME,
    async (jobs: Job<ExplorationRunPayload>[]) => {
      for (const job of jobs) {
        const payload = explorationRunPayloadSchema.parse(job.data);
        await runExploration(payload.runId, deps);
      }
    },
  );
  return workerId;
}
