/**
 * Phase 19 / Plan 19-03 — Reporting module queue contract (QUEUE-05, QUEUE-06).
 *
 * Exports:
 *   - WEBHOOK_DELIVER_QUEUE_NAME + WEBHOOK_DELIVER_DLQ_QUEUE_NAME (aliases of
 *     QUEUE_NAMES.WEBHOOK_DELIVER*) for ergonomic imports.
 *   - webhookDeliveryPayloadSchema (re-exported from ./schemas.js) + type.
 *   - registerWebhookDeliveryWorkers(deps) — factory that performs:
 *       1. DLQ queue FIRST (FK constraint: plans.js:461 — dead_letter FK to
 *          queue.name). {policy:'standard', retryLimit:0, retryBackoff:false}.
 *          DLQ is terminal; avoid loops.
 *       2. MAIN queue with deadLetter reference
 *          {policy:'standard', retryLimit:5, retryBackoff:true, retryDelay:1,
 *          retryDelayMax:30, deadLetter: DLQ_NAME}.
 *          ROADMAP SC1 verbatim: retryLimit:5 + retryBackoff:true.
 *          policy:'standard' (NOT stately — RESEARCH §Pitfall 9: webhooks are
 *          not idempotent by enqueue).
 *       3. MAIN worker handler: parse payload → deliverOnce → emit delivered
 *          on success / emit failed + re-throw on failure (pg-boss counts the
 *          attempt; retries or routes to DLQ).
 *       4. DLQ worker handler: parse payload → emit failedRetryExhausted
 *          (EVENTS-07) → DO NOT throw (DLQ has retryLimit:0 but explicit
 *          non-throw is safer per RESEARCH §Pattern 2).
 *
 * Ordering is load-bearing — pg-boss v12 requires the DLQ queue to exist before
 * the MAIN queue references it via the `deadLetter` FK. See RESEARCH §Pitfall 2.
 *
 * Correlation trace: `fastify.queue.work` restores ALS from the job's
 * `JobEnvelope.correlationId` BEFORE invoking the handler. Retries read the
 * SAME envelope (pg-boss updates the SAME row's state across attempts — see
 * RESEARCH §Pitfall 3), so all 5 attempts share ONE correlationId. The DLQ
 * re-insert copies the envelope verbatim, so the DLQ worker runs with the
 * same correlationId too. End-to-end trace: ROADMAP SC4.
 */
import type pino from 'pino';
import type { FastifyInstance } from 'fastify';

import { QUEUE_NAMES } from '../queue/names.js';
import type { WebhookService } from './webhook-service.js';
import {
  REPORTING_AGGREGATE_ID,
  type ReportingEmitters,
} from './events.js';
import {
  webhookDeliveryPayloadSchema,
  type WebhookDeliveryPayload,
} from './schemas.js';

// ============================================================
// Re-exports + queue-name constants.
// ============================================================

export { webhookDeliveryPayloadSchema };
export type { WebhookDeliveryPayload };

export const WEBHOOK_DELIVER_QUEUE_NAME     = QUEUE_NAMES.WEBHOOK_DELIVER;
export const WEBHOOK_DELIVER_DLQ_QUEUE_NAME = QUEUE_NAMES.WEBHOOK_DELIVER_DLQ;

// ============================================================
// Worker registration factory.
// ============================================================

export interface RegisterWebhookDeliveryWorkersDeps {
  /** Fastify instance — used to reach fastify.boss + fastify.queue. */
  fastify: FastifyInstance;
  webhookService: WebhookService;
  emit: ReportingEmitters;
  logger: pino.Logger;
}

export interface WebhookDeliveryRegistration {
  workerIds: string[];
}

export async function registerWebhookDeliveryWorkers(
  deps: RegisterWebhookDeliveryWorkersDeps,
): Promise<WebhookDeliveryRegistration> {
  const { fastify, webhookService, emit, logger } = deps;

  // ------------------------------------------------------------
  // 1. DLQ queue FIRST (FK constraint — see RESEARCH §Pitfall 2).
  // ------------------------------------------------------------
  await fastify.boss.createQueue(WEBHOOK_DELIVER_DLQ_QUEUE_NAME, {
    policy: 'standard',
    retryLimit: 0,           // terminal; don't loop if the DLQ worker throws
    retryBackoff: false,
  } as never);

  // ------------------------------------------------------------
  // 2. MAIN queue with deadLetter reference.
  //    ROADMAP SC1: retryLimit:5 + retryBackoff:true. retryDelay:1 seeds
  //    the 2^n formula (default would be 0 but retryBackoff forces floor 1
  //    per RESEARCH §Pitfall 4). retryDelayMax:30 caps production retry
  //    delays (5th retry caps ~16-30s); tests override via custom queue
  //    opts if faster cycles are needed.
  // ------------------------------------------------------------
  await fastify.boss.createQueue(WEBHOOK_DELIVER_QUEUE_NAME, {
    policy: 'standard',      // NOT 'stately' — webhooks are not idempotent by enqueue (RESEARCH §Pitfall 9)
    retryLimit: 5,           // ROADMAP SC1 verbatim
    retryBackoff: true,      // ROADMAP SC1 verbatim
    retryDelay: 1,
    retryDelayMax: 30,
    deadLetter: WEBHOOK_DELIVER_DLQ_QUEUE_NAME,
  } as never);

  // ------------------------------------------------------------
  // 3. MAIN worker — deliverOnce + emit + re-throw on failure.
  //    fastify.queue.work restores ALS from envelope.correlationId BEFORE
  //    invoking the handler (Phase 15 substrate at plugin.ts:182-194).
  // ------------------------------------------------------------
  const mainWorkerId = await fastify.queue.work<WebhookDeliveryPayload>(
    WEBHOOK_DELIVER_QUEUE_NAME,
    async (data, jobId) => {
      const parsed = webhookDeliveryPayloadSchema.parse(data);
      const log = logger.child({ queue: WEBHOOK_DELIVER_QUEUE_NAME, jobId });
      const started = Date.now();
      const eventName =
        ((parsed.payload as { event?: unknown }).event as string | undefined) ?? 'unknown';
      const jobIdFromPayload =
        (((parsed.payload as { job?: { id?: unknown } }).job?.id
          ?? (parsed.payload as { jobId?: unknown }).jobId) as
          | string
          | null
          | undefined) ?? null;

      try {
        await webhookService.deliverOnce(parsed.url, parsed.payload);
        emit.delivered(REPORTING_AGGREGATE_ID, {
          url: parsed.url,
          event: eventName,
          jobId: jobIdFromPayload,
          statusCode: 200,           // approximation; deliverOnce doesn't expose actual status
          durationMs: Date.now() - started,
          attempt: 1,                // pg-boss v12 does not forward retryCount without includeMetadata
        });
      } catch (err) {
        emit.failed(REPORTING_AGGREGATE_ID, {
          url: parsed.url,
          event: eventName,
          jobId: jobIdFromPayload,
          attempt: 1,                // approximate
          statusCode: null,
          error: err instanceof Error ? err.message : String(err),
        });
        log.warn(
          { err, url: parsed.url },
          'Webhook delivery attempt failed — re-throwing for pg-boss retry/DLQ',
        );
        throw err;  // RESEARCH §Pitfall 6: raw re-throw so pg-boss sees original message
      }
    },
  );

  // ------------------------------------------------------------
  // 4. DLQ worker — emits the terminal EVENTS-07 event.
  //    ALS is restored from the original envelope.correlationId (pg-boss's
  //    failed_jobs CTE copies data verbatim — RESEARCH §Dead-Letter Mechanics §2).
  //    Does NOT throw — DLQ has retryLimit:0 but explicit non-throw is safer
  //    per RESEARCH §Pattern 2.
  // ------------------------------------------------------------
  const dlqWorkerId = await fastify.queue.work<WebhookDeliveryPayload>(
    WEBHOOK_DELIVER_DLQ_QUEUE_NAME,
    async (data, jobId) => {
      const parsed = webhookDeliveryPayloadSchema.parse(data);
      const log = logger.child({ queue: WEBHOOK_DELIVER_DLQ_QUEUE_NAME, jobId });
      const eventName =
        ((parsed.payload as { event?: unknown }).event as string | undefined) ?? 'unknown';
      const jobIdFromPayload =
        (((parsed.payload as { job?: { id?: unknown } }).job?.id
          ?? (parsed.payload as { jobId?: unknown }).jobId) as
          | string
          | null
          | undefined) ?? null;

      try {
        emit.failedRetryExhausted(REPORTING_AGGREGATE_ID, {
          url: parsed.url,
          event: eventName,
          jobId: jobIdFromPayload,
          attempts: 6,                        // retryLimit:5 + 1 initial
          lastStatusCode: null,               // pg-boss doesn't expose the original output without explicit findJobs
          lastError: 'Retry exhausted (see original job output via boss.findJobs)',
          payloadSnapshot: parsed.payload as Record<string, unknown>,
        });
        log.warn(
          { url: parsed.url, event: eventName, jobId: jobIdFromPayload },
          'Webhook delivery retry-exhausted — terminal event emitted',
        );
      } catch (emitErr) {
        log.error({ err: emitErr }, 'Failed to emit terminal event from DLQ worker');
        // Do NOT re-throw — DLQ has retryLimit:0 so re-throw would be terminal anyway
        // but explicit swallow + log is safer per RESEARCH §Pattern 2.
      }
    },
  );

  logger.info(
    {
      mainWorkerId,
      dlqWorkerId,
      mainQueue: WEBHOOK_DELIVER_QUEUE_NAME,
      dlqQueue: WEBHOOK_DELIVER_DLQ_QUEUE_NAME,
    },
    'Webhook delivery workers registered',
  );

  return { workerIds: [mainWorkerId, dlqWorkerId] };
}
