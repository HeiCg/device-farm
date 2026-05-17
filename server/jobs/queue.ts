/**
 * Phase 23 / Plan 23-02 — Jobs module queue contract (MOD-03 + QUEUE-03 + QUEUE-06).
 *
 * Owns the `job.execute` named queue. Idempotency is queue-layer:
 * `policy:'stately'` + per-send `singletonKey:jobId` drops duplicate
 * enqueue (Pitfall 2: policy:'standard' silently ignores singletonKey).
 * `retryLimit:0` because the worker handler boots an emulator and runs
 * Maestro — non-idempotent side effects, no retry (QUEUE-04 mandate).
 *
 * Worker registration is split from queue registration so the createJobsModule
 * factory (Plan 23-04) can wire the executor.run() handler with closure
 * over module-local state (runningJobs Map, AbortControllers).
 *
 * Phase 22 / Plan 22-01 NOTE: streaming has no queue (CONTEXT decision).
 * Phase 21 / Plan 21-03 NOTE: artifacts has recording.upload (retryLimit:3
 * because uploads are idempotent — different policy from job.execute).
 *
 * This file is allowlisted by eslint-local-rules/no-direct-bus-emit.js
 * (queue files do not emit bus events).
 */
import type { PgBoss } from 'pg-boss';
import type { Job } from 'pg-boss';
import { QUEUE_NAMES } from '../queue/names.js';

/**
 * Re-exported queue-name constant. Plan 23-04 imports this from the module
 * factory; routes (Plan 23-05) import directly.
 */
export const JOB_EXECUTE_QUEUE_NAME = QUEUE_NAMES.JOB_EXECUTE;

/**
 * Payload schema for `job.execute` queue items. Thin: jobId is the only
 * mandatory field — the worker re-fetches the full job row from DB
 * (server/jobs/internal/repo.ts) before executing. Platform passed for
 * worker logging convenience.
 *
 * NOT a Zod schema yet — Plan 23-04 wires Zod on the producer side
 * (enqueueJob) and consumer side (worker handler).
 */
export interface JobExecutePayload {
  jobId: string;
  platform: 'android' | 'ios';
}

/**
 * Idempotent queue registration. Calls boss.createQueue with the canonical
 * Phase 23 contract (policy:'stately' + retryLimit:0). pg-boss createQueue
 * is upsert-like: a second call against an existing queue with identical
 * options is a no-op; a call with conflicting options updates the queue
 * (we never expect to update — production code calls this once at boot).
 */
export async function registerJobsExecuteQueue(boss: PgBoss): Promise<void> {
  await boss.createQueue(JOB_EXECUTE_QUEUE_NAME, {
    policy: 'stately',                 // QUEUE-03 / Pitfall 2 — REQUIRED for singletonKey dedup
    retryLimit: 0,                     // QUEUE-04 / device-touching handler — no retry
  } as never);                         // pg-boss types don't expose `policy` at top-level Queue; cast matches Phase 16/21 precedent
}

/**
 * Worker registration. Plan 23-04 calls this from createJobsModule passing
 * the executor.run() handler closed over module-local state. Returns the
 * workerId for later boss.offWork(workerId) on shutdown / drain.
 */
export async function registerJobsExecuteWorker(
  boss: PgBoss,
  handler: (payload: JobExecutePayload, bossJobId: string) => Promise<void>,
): Promise<string> {
  // NOTE: jobs are enqueued via `fastify.queue.send` (server/queue/plugin.ts)
  // which wraps the payload in a JobEnvelope `{correlationId, causationId,
  // actor, payload}`. The raw pg-boss handler therefore receives the envelope;
  // unwrap to `payload.payload` before delegating, so existing executor code
  // keeps the un-wrapped JobExecutePayload signature.
  type Enveloped = { payload?: JobExecutePayload };
  const workerId = await boss.work<Enveloped>(
    JOB_EXECUTE_QUEUE_NAME,
    async (jobs: Job<Enveloped>[]) => {
      for (const job of jobs) {
        const inner = job.data?.payload;
        if (!inner?.jobId) continue; // malformed envelope — skip silently
        await handler(inner, job.id);
      }
    },
  );
  return workerId;
}
