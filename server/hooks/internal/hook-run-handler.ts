/**
 * Phase 16 / Plan 16-01 — HOOK_RUN worker handler.
 *
 * Invoked by pg-boss when a `hook.run` job is ready. The handler:
 *   1. Validates the job payload via Zod.
 *   2. Claims the operation_key in hook_runs (idempotency barrier — RESEARCH §Pattern 3).
 *   3. If the claim was skipped (replay), logs and returns — NO hook invocation.
 *   4. Looks up the hook by name in the HookExecutor registry.
 *   5. Runs the hook via the existing `executor.execute(event, context)` API.
 *   6. Updates the hook_runs row with final status/exitCode/durationMs.
 *   7. Emits `hook.completed` (terminal) on success; emits `hook.failed` (per-attempt)
 *      and re-throws on failure so pg-boss counts the attempt + retries.
 *
 * `hook.failed.retryExhausted` is emitted by a separate onComplete hook wired in plan 16-02.
 */
import type pino from 'pino';
import { z } from 'zod';

import { HookExecutor } from '../hook-executor.js';
import type { HookContext } from '../hook-executor.js';
import type { HookEmitters } from '../events.js';
import {
  buildOperationKey,
  claimOperationKey,
  markHookRunStatus,
  type DrizzleDb,
} from './idempotency.js';

/**
 * Zod schema for the HOOK_RUN job payload — validated on both producer (bus→queue
 * subscriber in plan 16-02) and consumer (here). triggerEventId is the ORIGINATING
 * bus envelope.id; hookName names a registered HookDefinition; context is the
 * HookContext passed to executor.execute.
 */
export const hookRunPayloadSchema = z.object({
  triggerEventId: z.string().uuid(),
  hookName: z.string().min(1),
  context: z.object({
    deviceId: z.string(),
    emulatorId: z.string(),
    serial: z.string(),
    platform: z.enum(['android', 'ios']),
    port: z.number().int().nullable(),
    jobId: z.string().optional(),
  }),
});

export type HookRunPayload = z.infer<typeof hookRunPayloadSchema>;

export interface HookRunHandlerDeps {
  db: DrizzleDb;
  executor: HookExecutor;
  emit: HookEmitters;
  logger: pino.Logger;
}

export function createHookRunHandler(deps: HookRunHandlerDeps) {
  return async function handleHookRun(rawData: unknown, jobId: string): Promise<void> {
    const logger = deps.logger.child({ jobId });

    // 1. Validate payload — throws on malformed, which pg-boss will log as failure.
    const { triggerEventId, hookName, context } = hookRunPayloadSchema.parse(rawData);
    const operationKey = buildOperationKey(triggerEventId, hookName);

    // 2. Claim operation_key (idempotency barrier).
    const { claimed } = await claimOperationKey(deps.db, {
      operationKey,
      hookName,
      eventId: triggerEventId,
    });

    if (!claimed) {
      // Replay path — NO hook invocation. Invariant (c).
      logger.info({ operationKey, hookName }, 'Duplicate replay detected — skipping hook run');
      return;
    }

    // 3. Find the hook definition.
    const hook = deps.executor.getHooks().find(h => h.name === hookName);
    if (!hook) {
      logger.warn({ hookName }, 'Hook not registered; marking run as failed');
      await markHookRunStatus(deps.db, operationKey, 'failed', { durationMs: 0 });
      throw new Error(`Unknown hook: ${hookName}`);
    }

    const started = Date.now();

    try {
      // 4. Run via existing imperative API. executor.execute filters by event+platform+enabled internally.
      const results = await deps.executor.execute(hook.event, context as HookContext);
      const durationMs = Date.now() - started;

      // executor.execute returns all matching hooks' results; find the one for THIS hookName.
      const result = results.find(r => r.hookName === hookName);
      if (!result) {
        // Hook matched executor registry but was filtered out by platform/enabled — treat as success no-op.
        await markHookRunStatus(deps.db, operationKey, 'completed', { durationMs, exitCode: 0 });
        logger.info({ operationKey, hookName }, 'Hook filtered out (platform/enabled) — no-op');
        return;
      }

      // 5. Update row with final status.
      await markHookRunStatus(deps.db, operationKey, result.success ? 'completed' : 'failed', {
        durationMs,
        exitCode: result.exitCode,
      });

      // 6. Emit terminal or per-attempt event.
      const eventPayload = {
        hookName,
        event: hook.event,
        deviceId: null,              // context.deviceId is non-UUID ('test-device-id' possible); pass null for now
        jobId: null,                 // envelope aggregate carries this separately
        exitCode: result.exitCode ?? 0,
        durationMs,
        stderrTail: (result.stderr ?? '').slice(-1024),
      };

      if (result.success) {
        deps.emit.completed(triggerEventId, eventPayload);
      } else {
        deps.emit.failed(triggerEventId, eventPayload);
        // Re-throw to trigger pg-boss retry path.
        throw new Error(result.error ?? 'Hook failed');
      }
    } catch (err) {
      const durationMs = Date.now() - started;
      await markHookRunStatus(deps.db, operationKey, 'failed', { durationMs }).catch(() => {});
      throw err;   // propagate so pg-boss counts the attempt
    }
  };
}
