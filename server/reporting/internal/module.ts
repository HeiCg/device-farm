/**
 * Phase 19 / Plan 19-03 — createReportingModule factory (MOD-06).
 *
 * Overwrites the plan 19-00 stub. Owns construction of:
 *   - WebhookService instance (from webhook-service.ts — deliverOnce surface)
 *   - FlakyDetector instance (UNCHANGED from pre-refactor)
 *   - per-module TypedBus<ReportingRegistry>
 *   - persistEnvelope middleware (10 lines duplicated from server/bus/plugin.ts
 *     per RESEARCH Open Question #1 — same decision as Phase 16 hooks + Phase 18
 *     lifecycle: consolidation deferred to Phase 27+)
 *   - emit helpers (makeReportingEmitters)
 *   - webhook-deliver main + DLQ workers via registerWebhookDeliveryWorkers
 *   - onPersisted('job.completed') bus subscriber — sub-option C from RESEARCH
 *     §Cross-Module Wiring Decision; enqueues webhook delivery via
 *     fastify.queue.send when config.webhooks.url is configured
 *   - shutdown lifecycle: unsubscribes bus + offWork's each registered worker id
 *
 * The Fastify plugin (server/reporting/plugin.ts) becomes a thin wrapper: it
 * calls this factory, decorates fastify.webhookService + flakyDetector
 * (back-compat for existing consumers) + reportingModule (new surface),
 * calls module.registerWorkersAndSubscribers(), and wires onClose → shutdown().
 */
import type pino from 'pino';
import type { FastifyInstance } from 'fastify';

import { TypedBus } from '../../bus/bus.js';
import { events as eventsTable } from '../../db/schema.js';
import type { Envelope } from '../../events/envelope.js';
import type { Database } from '../../db/index.js';
import type { AppConfig } from '../../config/schema.js';

import { WebhookService } from '../webhook-service.js';
import { FlakyDetector } from '../flaky-detector.js';
import {
  reportingRegistry,
  makeReportingEmitters,
  REPORTING_AGGREGATE_ID,
  type ReportingRegistry,
  type ReportingEmitters,
} from '../events.js';
import {
  registerWebhookDeliveryWorkers,
  WEBHOOK_DELIVER_QUEUE_NAME,
} from '../queue.js';

export interface CreateReportingModuleDeps {
  /** Fastify instance — used to reach fastify.boss + fastify.queue + fastify.onPersisted. */
  fastify: FastifyInstance;
  db: Database;
  config: AppConfig;
  logger: pino.Logger;
}

export interface ReportingModule {
  webhookService: WebhookService;
  flakyDetector: FlakyDetector;
  emit: ReportingEmitters;
  bus: TypedBus<ReportingRegistry>;
  /** Register main + DLQ workers + onPersisted('job.completed') bus subscriber. */
  registerWorkersAndSubscribers: () => Promise<void>;
  /**
   * Imperative façade for enqueueing a webhook delivery. Called by any
   * consumer that has a URL + payload ready without going through the bus.
   * For the bus-driven path (job.completed), the internal subscriber
   * does this automatically. Emits `webhook.scheduled` side-event so
   * scheduled-but-not-yet-delivered webhooks are visible in trace.
   */
  enqueueWebhookDelivery: (
    url: string,
    payload: object,
    opts?: { jobId?: string | null; event?: string },
  ) => Promise<string | null>;
  shutdown: () => Promise<void>;
}

/**
 * Duplicated from server/bus/plugin.ts lines 80-112 + server/hooks/internal/module.ts
 * + server/lifecycle/internal/module.ts per RESEARCH Open Question #1 — consolidation
 * deferred to Phase 27+ (three sample points now; consolidation PR will refactor
 * hooks + lifecycle + reporting into a shared helper).
 *
 * Fires the side-channel <type>.envelope event for onPersisted subscribers, then
 * fire-and-forgets an INSERT into `events` when the registry entry has persisted=true.
 */
function makePersistEnvelope(deps: {
  db: Database;
  bus: TypedBus<ReportingRegistry>;
  logger: pino.Logger;
}) {
  const ee = (deps.bus as unknown as { ee: import('node:events').EventEmitter }).ee;
  return function persistEnvelope(envelope: Envelope): void {
    ee.emit(`${envelope.type}.envelope`, envelope);

    const entry = reportingRegistry[envelope.type as keyof ReportingRegistry];
    if (!entry || !entry.persisted) return;

    void (async () => {
      try {
        await deps.db
          .insert(eventsTable)
          .values({
            id: envelope.id,
            eventType: envelope.type,
            eventVersion: envelope.v,
            correlationId: envelope.correlationId,
            causationId: envelope.causationId ?? undefined,
            aggregateType: envelope.aggregateType,
            aggregateId: envelope.aggregateId,
            payload: envelope.payload as unknown,
            occurredAt: new Date(envelope.occurredAt),
            actor: envelope.actor,
          });
      } catch (err) {
        deps.logger.error({ err, envelope }, 'Failed to persist reporting event');
      }
    })();
  };
}

export function createReportingModule(deps: CreateReportingModuleDeps): ReportingModule {
  const logger = deps.logger.child({ module: 'reporting' });

  // ---------- Back-compat class instances ----------
  const webhookService = new WebhookService(logger, {
    secret: deps.config.webhooks?.secret,
    timeout_ms: deps.config.webhooks?.timeout_ms,
    max_retries: deps.config.webhooks?.max_retries,  // stored but unused; pg-boss owns retries
  });
  const flakyDetector = new FlakyDetector(deps.db, logger);

  // ---------- Per-module typed bus + persistence ----------
  const bus = new TypedBus(reportingRegistry);
  const persistEnvelope = makePersistEnvelope({ db: deps.db, bus, logger });
  const emit = makeReportingEmitters(bus, persistEnvelope);

  // ---------- Shutdown state ----------
  let workerIds: string[] = [];
  let unsubscribeJobCompleted: (() => void) | null = null;
  let stopped = false;

  return {
    webhookService,
    flakyDetector,
    emit,
    bus,

    registerWorkersAndSubscribers: async () => {
      // 1. Register main + DLQ workers.
      const registration = await registerWebhookDeliveryWorkers({
        fastify: deps.fastify,
        webhookService,
        emit,
        logger,
      });
      workerIds = registration.workerIds;

      // 2. Subscribe to job.completed bus event (sub-option C from RESEARCH §Cross-Module Wiring).
      //    `fastify.onPersisted` is decorated by server/bus/plugin.ts (Phase 15).
      //    Its type signature is permissive (keyof demoRegistry & string); we cast to
      //    'job.completed' to match jobsRegistry declared in server/jobs/events.ts (plan 19-01).
      //    This cast is load-bearing: the onPersisted decorator's type inference
      //    pre-dates the jobs registry; Phase 27+ will consolidate bus surface typing.
      const onPersisted = deps.fastify.onPersisted as unknown as (
        type: 'job.completed',
        handler: (envelope: Envelope) => void | Promise<void>,
      ) => () => void;

      unsubscribeJobCompleted = onPersisted('job.completed', async (envelope) => {
        const url = deps.config.webhooks?.url;
        if (!url) {
          logger.debug(
            { aggregateId: envelope.aggregateId },
            'job.completed received but webhooks.url not configured — no-op',
          );
          return;
        }

        // Build the POST body — thin, references jobs aggregate by aggregateId (jobId).
        const body = {
          event: 'job.completed',
          job: envelope.payload,                           // {jobId, status, platform, summary?}
          timestamp: new Date(envelope.occurredAt).toISOString(),
        };

        try {
          // fastify.queue.send reads ALS and injects correlationId; the
          // envelope from onPersisted has already set the onPersisted wrapper's
          // ALS context (currentEventId → envelope.id) per Phase 15 TRACE-09
          // plumbing. All 5 retries on the resulting job share this correlationId.
          const sentJobId = await deps.fastify.queue.send(
            WEBHOOK_DELIVER_QUEUE_NAME,
            { url, payload: body },
            {},
          );
          emit.scheduled(REPORTING_AGGREGATE_ID, {
            url,
            event: 'job.completed',
            jobId: envelope.aggregateId,
          });
          logger.info(
            { sentJobId, jobId: envelope.aggregateId, url },
            'Webhook delivery enqueued',
          );
        } catch (err) {
          logger.error(
            { err, jobId: envelope.aggregateId, url },
            'Failed to enqueue webhook delivery',
          );
          // Do NOT re-throw — onPersisted subscribers should not crash the bus.
        }
      });

      logger.info(
        { workerIds, subscribers: ['job.completed'] },
        'Reporting module workers + subscribers registered',
      );
    },

    enqueueWebhookDelivery: async (url, payload, opts = {}) => {
      const jobId = await deps.fastify.queue.send(
        WEBHOOK_DELIVER_QUEUE_NAME,
        { url, payload },
        {},
      );
      const eventName =
        opts.event
        ?? ((payload as { event?: unknown }).event as string | undefined)
        ?? 'unknown';
      emit.scheduled(REPORTING_AGGREGATE_ID, {
        url,
        event: eventName,
        jobId: opts.jobId ?? null,
      });
      return jobId;
    },

    shutdown: async () => {
      if (stopped) return;   // idempotent
      stopped = true;

      // Unsubscribe bus subscriber first so no new jobs enqueue during shutdown.
      if (unsubscribeJobCompleted) {
        try {
          unsubscribeJobCompleted();
        } catch (err) {
          logger.warn({ err }, 'unsubscribe job.completed failed during reporting shutdown');
        }
        unsubscribeJobCompleted = null;
      }

      // offWork per registered worker id.
      for (const id of workerIds) {
        try {
          await deps.fastify.boss.offWork(id);
        } catch (err) {
          logger.warn({ err, workerId: id }, 'offWork failed during reporting shutdown');
        }
      }
      workerIds = [];

      logger.info('Reporting module shutdown complete');
    },
  };
}
