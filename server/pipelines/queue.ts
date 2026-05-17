/**
 * Pipelines module — pg-boss queue surface (Phase 25 Plan 25-01).
 *
 * Owns the `pipeline.scheduled.execute` queue + per-schedule lifecycle helpers.
 * Each pipelineSchedules row maps to ONE pg-boss schedule entry, disambiguated
 * by the row's UUID via pg-boss's `key` parameter (NOT singletonKey, NOT
 * pipelineId — see RESEARCH §Pattern 1 Schedule Identity Decision and Pitfall 1).
 *
 * Wave 1 (this plan): payload schema + 4 helpers
 *   - registerPipelineScheduledExecuteQueue (createQueue, policy:'standard' retryLimit:0)
 *   - registerPipelineScheduledExecuteWorker (boss.work + Zod-parse + delegate)
 *   - upsertPipelineSchedule           (boss.schedule with {key: scheduleId, tz:'UTC'})
 *   - removePipelineSchedule           (boss.unschedule positional)
 *
 * Wave 2 (Plan 25-02): scheduler.ts uses upsertPipelineSchedule + removePipelineSchedule
 *                      to replace the prior in-memory ScheduleEntry Map.
 * Wave 3 (Plan 25-03): factory module wires registerPipelineScheduledExecuteQueue +
 *                      registerPipelineScheduledExecuteWorker at boot.
 *
 * QUEUE-06 (queue.ts colocated per module) + QUEUE-08 (boss.schedule is the
 * canonical scheduler surface; the legacy timer-based scheduler retires in
 * Plan 25-02).
 *
 * Pitfalls covered:
 *   1. boss.unschedule(name, key) is positional in pg-boss v12 (NOT object form).
 *   2. createQueue MUST run before any schedule call (queue must exist first).
 *  10. tz:'UTC' is explicit — never rely on local TZ for cron interpretation.
 */
import { z } from 'zod';
import type { PgBoss, Job } from 'pg-boss';

import { QUEUE_NAMES } from '../queue/names.js';

export const PIPELINE_SCHEDULED_EXECUTE_QUEUE_NAME = QUEUE_NAMES.PIPELINE_SCHEDULED_EXECUTE;

/**
 * Payload sent to the pipeline.scheduled.execute queue every time a pg-boss
 * schedule fires. The worker's job is to spawn a fresh pipeline run by
 * delegating to the executor (Plan 25-02 / 25-03 wires the actual handler).
 *
 * variables is Record<string,string> — the runtime variable map carried from
 * the pipelineSchedules row (cron-time substitution context).
 */
export const pipelineScheduledExecutePayloadSchema = z.object({
  pipelineId: z.string(),
  scheduleId: z.string(),
  variables: z.record(z.string(), z.string()),
});

export type PipelineScheduledExecutePayload = z.infer<typeof pipelineScheduledExecutePayloadSchema>;

/**
 * Register the `pipeline.scheduled.execute` queue. Must run BEFORE any
 * boss.schedule() call (Pitfall 2: pg-boss v12 throws "Queue ${name} not
 * found" otherwise — schedule does not auto-create queues).
 *
 * policy:'standard' — pipeline runs are independent (no schedule-time dedup;
 *                      that lives in the run-start path via DB row insert).
 * retryLimit:0       — schedule-fire failures should not retry. The
 *                      pipeline_runs row is the source of truth; if a
 *                      schedule fire fails to spawn a run, prefer manual
 *                      re-trigger over re-firing the same schedule slot
 *                      (which would cause overlapping run windows).
 */
export async function registerPipelineScheduledExecuteQueue(boss: PgBoss): Promise<void> {
  await boss.createQueue(PIPELINE_SCHEDULED_EXECUTE_QUEUE_NAME, {
    policy: 'standard',
    retryLimit: 0,
  } as never);
}

/**
 * Register the worker that handles every schedule fire. The handler is
 * invoked AFTER Zod parse (defensive boundary — malformed payloads throw,
 * triggering pg-boss DLQ accounting rather than silent skip). Returns the
 * workerId for offWork during graceful shutdown.
 */
export async function registerPipelineScheduledExecuteWorker(
  boss: PgBoss,
  handler: (payload: PipelineScheduledExecutePayload, jobId: string) => Promise<void>,
): Promise<string> {
  return boss.work<PipelineScheduledExecutePayload>(
    PIPELINE_SCHEDULED_EXECUTE_QUEUE_NAME,
    async (jobs: Array<Job<PipelineScheduledExecutePayload>>) => {
      for (const job of jobs) {
        // Defensive Zod parse — payload validated at the boundary.
        const parsed = pipelineScheduledExecutePayloadSchema.parse(job.data);
        await handler(parsed, job.id);
      }
    },
  );
}

/**
 * Idempotently upsert a pipeline schedule. Calling this twice with the same
 * `scheduleId` overwrites the prior schedule (pg-boss v12 schedule semantics
 * — same queue name + same `key` is upsert).
 *
 * Must be called per-schedule-row (NOT per-pipeline — a pipeline can have
 * multiple schedules per the existing pipelineSchedules schema and route
 * surface).
 *
 * IMPORTANT: pg-boss v12's per-schedule disambiguator is `key` (NOT
 * singletonKey). singletonKey is for execution-time job dedup (when
 * boss.send fires with that key, drop if a job with the same key is
 * already pending). For schedules, use `key` as the upsert primitive.
 *
 * tz:'UTC' is explicit (Pitfall 10 — never rely on host local TZ for cron
 * interpretation; matches Phase 18 lifecycle convention).
 */
export async function upsertPipelineSchedule(opts: {
  boss: PgBoss;
  scheduleId: string;
  pipelineId: string;
  cronExpression: string;
  variables: Record<string, string>;
}): Promise<void> {
  const { boss, scheduleId, pipelineId, cronExpression, variables } = opts;
  const data: PipelineScheduledExecutePayload = { pipelineId, scheduleId, variables };
  await boss.schedule(
    PIPELINE_SCHEDULED_EXECUTE_QUEUE_NAME,
    cronExpression,
    data,
    { key: scheduleId, tz: 'UTC' } as never,
  );
}

/**
 * Remove a pg-boss schedule. Pitfall 1: pg-boss v12 unschedule takes
 * positional args (name, key) — NOT an object form. Older pg-boss exposed
 * an object form; v12 standardized on positional.
 */
export async function removePipelineSchedule(opts: {
  boss: PgBoss;
  scheduleId: string;
}): Promise<void> {
  const { boss, scheduleId } = opts;
  await boss.unschedule(PIPELINE_SCHEDULED_EXECUTE_QUEUE_NAME, scheduleId);
}
