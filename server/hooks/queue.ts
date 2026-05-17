/**
 * Phase 16 / Plan 16-01 — Hooks module queue contract (QUEUE-06).
 *
 * Exports:
 *   - hookRunPayloadSchema — re-exported for producer-side validation (subscriber wires in 16-02)
 *   - registerHookRunWorker(deps) — factory that registers the HOOK_RUN worker with pg-boss
 *     using the shared fastify.queue wrapper (ALS-restoring, payload validation done internally).
 *
 * The worker handler body lives in internal/hook-run-handler.ts (module-private).
 * This file is the PUBLIC queue contract: queue name + payload schema + registration entry point.
 */
import type pino from 'pino';
import type { FastifyInstance } from 'fastify';

import { QUEUE_NAMES } from '../queue/names.js';
import { HookExecutor } from './hook-executor.js';
import type { HookEmitters } from './events.js';
import { createHookRunHandler, hookRunPayloadSchema, type HookRunPayload } from './internal/hook-run-handler.js';
import type { DrizzleDb } from './internal/idempotency.js';

export { hookRunPayloadSchema };
export type { HookRunPayload };

export const HOOK_RUN_QUEUE_NAME = QUEUE_NAMES.HOOK_RUN;

export interface RegisterHookRunWorkerDeps {
  /** Fastify instance with `queue` decorator (Phase 15 queue plugin). */
  fastify: FastifyInstance;
  db: DrizzleDb;
  executor: HookExecutor;
  emit: HookEmitters;
  logger: pino.Logger;
}

/**
 * Register the HOOK_RUN worker. Returns the worker id (string) from fastify.queue.work.
 * Caller (factory) stores this to call `boss.offWork(id)` on shutdown.
 */
export async function registerHookRunWorker(deps: RegisterHookRunWorkerDeps): Promise<string> {
  // Ensure the queue exists before attaching a worker. pg-boss v12 requires createQueue
  // before send/work; safe to call multiple times (idempotent per pg-boss source).
  //
  // Queue policy: 'stately' gates singletonKey dedup on state <= 'active' (includes
  // 'created', 'retry', 'active'). This is the policy that makes back-to-back
  // `boss.send(name, payload, {singletonKey})` return `null` on the second call —
  // the first call moves the job to 'created', the unique index
  // `job_i3 (name, state, COALESCE(singleton_key, '')) WHERE state <= 'active'`
  // then blocks the duplicate insert. Verified in
  // node_modules/pg-boss/dist/plans.js:470. Paired with the DB-level hook_runs
  // PK (operation_key) idempotency barrier to cover BOTH the queue-enqueue AND
  // the worker-exec replay surfaces (see RESEARCH §5 + Pitfall 8).
  await deps.fastify.boss.createQueue(HOOK_RUN_QUEUE_NAME, {
    policy: 'stately',
    retryLimit: 1,
    retryBackoff: true,
    retryDelay: 30,
  } as never);

  const handler = createHookRunHandler({
    db: deps.db,
    executor: deps.executor,
    emit: deps.emit,
    logger: deps.logger.child({ worker: HOOK_RUN_QUEUE_NAME }),
  });

  // fastify.queue.work restores ALS from job.data before invoking handler (TRACE-05).
  return deps.fastify.queue.work<unknown>(HOOK_RUN_QUEUE_NAME, handler);
}
