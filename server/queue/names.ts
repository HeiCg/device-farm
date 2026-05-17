/**
 * Central QUEUE_NAMES module — Phase 15 Plan 05, Task 5.1.
 *
 * pg-boss v12 tightened queue-name validation: names must match `[a-z][a-z0-9._-]*`
 * (see RESEARCH §1 pitfall #6). This module owns that regex + the registry so
 * downstream modules (Phase 16+) extend `QUEUE_NAMES` without redeclaring the
 * validator or risking a charset drift.
 *
 * Phase 15 ships ONLY the `DEMO` queue — real queue names (`job.execute`,
 * `webhook.deliver`, ...) land in module phases starting Phase 16.
 *
 * Satisfies: QUEUE-02 (named queues + charset validation).
 */

/**
 * pg-boss v12 queue-name charset:
 *   - First char: lowercase letter
 *   - Remaining chars: lowercase letter | digit | '.' | '_' | '-'
 *
 * Exact pattern: `^[a-z][a-z0-9._-]*$`
 * (Compatible with the regex in server/queue/__tests__/names.spec.ts.)
 */
const QUEUE_NAME_RE = /^[a-z][a-z0-9._-]*$/;

/** Returns true when `name` is a valid pg-boss v12 queue name. */
export function isValidQueueName(name: string): boolean {
  return QUEUE_NAME_RE.test(name);
}

/**
 * Phase 15 registers a `demo` queue for spikes + integration tests only.
 * Real queue names land in Phases 16+ — extend this object, do NOT redeclare
 * the validator or introduce a parallel registry.
 *
 * Phase 16 adds HOOK_RUN ('hook.run') for the hooks pilot (queue.ts in server/hooks/).
 * Phase 18 adds LIFECYCLE_COMPRESS_DAILY / LIFECYCLE_RETENTION_DAILY / LIFECYCLE_DISK_HOURLY
 * for the lifecycle module housekeeping schedules.
 * Phase 19 adds WEBHOOK_DELIVER + WEBHOOK_DELIVER_DLQ for the reporting module's
 * webhook delivery pipeline (retry + dead-letter per EVENTS-07 + QUEUE-05).
 * Phase 20 adds DEVICE_BOOT + DEVICE_REAP for the pool module (MOD-03 +
 * QUEUE-06). DEVICE_REAP replaces the raw setInterval reaper via
 * boss.schedule('device.reap', '* * * * *'); DEVICE_BOOT is a
 * forward-compat name constant only (consumer lands in Phase 23 jobs keystone).
 * Phase 21 adds RECORDING_UPLOAD for the artifacts module (MOD-03 + QUEUE-06 +
 * ROADMAP §Phase 21 SC2). Registered via boss.createQueue with policy:'stately'
 * + retryLimit:3; enqueued per-recording with singletonKey:recordingId for
 * SC3 idempotency (replay same recordingId → dropped enqueue + DB unique constraint).
 * Phase 23 adds JOB_EXECUTE for the jobs keystone module (MOD-03 + QUEUE-03).
 * Registered via boss.createQueue with policy:'stately' + retryLimit:0;
 * enqueued per-jobId with singletonKey:jobId for SC2 idempotency
 * (forced double-enqueue → 1 device boot).
 * Phase 25 adds PIPELINE_SCHEDULED_EXECUTE for the pipelines module's
 * boss.schedule()-based pipeline scheduler (last node-cron consumer in tree
 * migrates to pg-boss; ROADMAP §Phase 25 SC1). Registered via boss.createQueue
 * with policy:'standard' + retryLimit:0; per-pipelineSchedules.id schedules
 * upserted via boss.schedule(name, cron, data, {key: scheduleId}) — `key` is
 * the pg-boss per-schedule disambiguator (NOT singletonKey, NOT pipelineId).
 * Phase 34 adds SESSION_SWEEP for the sessions module's TTL sweeper (Plan
 * 34-04). Registered via boss.createQueue + boss.schedule('session.sweep',
 * '* * * * *', ...) — every minute scans `sessions WHERE lease_until < now()
 * AND status = 'active'` → emits `session.expired` + releases the device.
 * Sub-minute granularity is open question #1 (see 34-RESEARCH).
 * Phase 35 adds EXPLORATION_RUN for the explorations agent runner (Plan
 * 35-02). Registered via boss.createQueue with policy:'stately' +
 * retryLimit:0; enqueued per-runId with singletonKey:runId so duplicate
 * POST /api/explorations submissions are no-ops at the queue boundary.
 */
export const QUEUE_NAMES = {
  DEMO: 'demo',
  DEVICE_BOOT: 'device.boot',
  DEVICE_REAP: 'device.reap',
  /** Phase 35 — exploration agent run scheduling */
  EXPLORATION_RUN: 'exploration.run',
  HOOK_RUN: 'hook.run',
  JOB_EXECUTE: 'job.execute',
  LIFECYCLE_COMPRESS_DAILY:  'lifecycle.compress.daily',
  LIFECYCLE_DISK_HOURLY:     'lifecycle.disk.hourly',
  LIFECYCLE_RETENTION_DAILY: 'lifecycle.retention.daily',
  PIPELINE_SCHEDULED_EXECUTE: 'pipeline.scheduled.execute',
  RECORDING_UPLOAD:    'recording.upload',
  SESSION_SWEEP:       'session.sweep',
  WEBHOOK_DELIVER:     'webhook.deliver',
  WEBHOOK_DELIVER_DLQ: 'webhook.deliver.dlq',
} as const;

/** Union of legal queue names at compile time. */
export type QueueName = typeof QUEUE_NAMES[keyof typeof QUEUE_NAMES];
