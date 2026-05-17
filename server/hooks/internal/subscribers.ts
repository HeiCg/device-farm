/**
 * Phase 16 / Plan 16-02 — bus to queue bridge subscriber (EVENTS-09).
 *
 * Registers a bus subscriber that translates inbound hook-triggering events into
 * durable hook.run queue jobs. The envelope's immutable `id` becomes the stable
 * half of the singletonKey — replaying the same bus trigger re-enqueues no-op at
 * the queue boundary (pg-boss singleton unique index) AND at the DB boundary
 * (hook_runs.operation_key PK), per plan 16-01 Invariant (c).
 *
 * Phase 16 wires ONLY the synthetic `test.trigger` event (test-driven exercise).
 * Real `device.*` and `job.*` subscribers land in Phases 20/21/23 once those
 * modules emit events.
 *
 * correlationId/causationId propagation happens automatically: `onPersisted`
 * sets `currentEventId` into ALS before invoking the handler (TRACE-09), and
 * `queueSend` reads correlationId + currentEventId from ALS when stamping the
 * pg-boss job envelope (TRACE-05).
 */
import type pino from 'pino';
import type { FastifyInstance } from 'fastify';
import type { Envelope } from '../../events/envelope.js';

import { HOOK_RUN_QUEUE_NAME, hookRunPayloadSchema } from '../queue.js';
import type { HookExecutor } from '../hook-executor.js';
import type { HookEmitters } from '../events.js';

export interface WireBusToQueueDeps {
  onPersisted: FastifyInstance['onPersisted'];
  queueSend: FastifyInstance['queue']['send'];
  executor: HookExecutor;
  emit: HookEmitters;
  logger: pino.Logger;
}

/**
 * Register the `test.trigger` → `hook.run` bridge subscriber.
 * Returns an unsubscribe function; the caller (createHooksModule.shutdown) invokes
 * it on teardown. Safe to call once per module instance.
 */
export function wireBusToQueue(deps: WireBusToQueueDeps): () => void {
  // NOTE: `onPersisted` expects a typed event-name that exists in the demoRegistry —
  // the default Phase 15 bus is typed to DemoRegistry. We cast to string at this
  // boundary because `test.trigger` is a test-only event (declared in the test
  // fixture registry server/hooks/__tests__/fixtures/test-registry.ts) that only
  // fires when a test harness explicitly publishes it on the shared bus.
  // Production behaviour: this subscriber stays idle until 20/21/23 wire real events.
  const unsubscribe = (deps.onPersisted as unknown as (
    type: string,
    handler: (envelope: Envelope) => void | Promise<void>,
  ) => () => void)('test.trigger', async (envelope) => {
    const eventPayload = envelope.payload as { event?: string };
    const hookEvent = eventPayload?.event;
    if (typeof hookEvent !== 'string') {
      deps.logger.warn({ envelope }, 'test.trigger envelope missing .payload.event — ignoring');
      return;
    }

    // executor.getHooksForEvent requires a HookEvent type; cast through unknown.
    const hooks = deps.executor.getHooksForEvent(hookEvent as never);
    for (const hook of hooks) {
      const singletonKey = `${envelope.id}:${hook.name}`;
      // PRODUCER-SIDE VALIDATION (must_haves.truths: "producer-side validation happens in 16-02 subscriber").
      // Validate payload against hookRunPayloadSchema BEFORE enqueueing so malformed payloads never hit pg-boss.
      // Consumer-side validation still runs in hook-run-handler.ts as a defense-in-depth measure.
      const parsed = hookRunPayloadSchema.parse({
        triggerEventId: envelope.id,
        hookName: hook.name,
        context: {
          deviceId: envelope.aggregateId,
          emulatorId: 'unknown',
          serial: 'unknown',
          platform: 'android',
          port: null,
        },
      });
      // queueSend reads correlationId + currentEventId from ALS (set by onPersisted wrapper).
      const jobId = await deps.queueSend(HOOK_RUN_QUEUE_NAME, parsed, { singletonKey, retryLimit: 1 });

      // jobId is null when pg-boss rejects the duplicate singletonKey — treat as success per RESEARCH Pitfall 1.
      deps.logger.debug({ hookName: hook.name, singletonKey, jobId }, 'test.trigger → hook.run enqueued');

      // Emit hook.scheduled AFTER the send succeeds (envelope.id becomes causationId via ALS).
      deps.emit.scheduled(envelope.aggregateId, {
        hookName: hook.name,
        event: hookEvent,
        deviceId: null,
        jobId: null,
      });
    }
  });

  return unsubscribe;
}
