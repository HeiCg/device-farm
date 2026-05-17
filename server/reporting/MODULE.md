# Reporting Module

## Purpose

Deliver outbound webhook notifications for completed jobs via a durable, retryable, dead-letter-observable pipeline. Owns `WebhookService.deliverOnce` (single-attempt HTTP POST — throws on 5xx/network, resolves on 2xx/4xx), the `webhook.deliver` pg-boss queue (retry + backoff owned at the queue layer), the `webhook.deliver.dlq` dead-letter queue (terminal pipeline), and the read-only `GET /api/queue/dlq` operator endpoint. Also hosts `FlakyDetector` (background analytics — unchanged by Phase 19) and JUnit-report generation (unchanged).

The module subscribes to `job.completed` from the bus and enqueues a webhook delivery when `config.webhooks.url` is configured; callers outside the bus may enqueue imperatively via `reportingModule.enqueueWebhookDelivery(url, payload)`.

## Public API

Exports from `server/reporting/index.ts` (the ONLY legitimate import surface outside this module — enforced by `dependency-cruiser` rule `no-deep-imports-into-reporting-internal` added in Phase 19 Plan 19-00):

- `reportingPlugin` — Fastify plugin (thin wrapper around `createReportingModule`).
- `createReportingModule(deps): ReportingModule` — factory returning `{webhookService, flakyDetector, emit, bus, registerWorkersAndSubscribers, enqueueWebhookDelivery, shutdown}`.
- `WebhookService` class — imperative surface: `deliverOnce(url, payload)` (single-attempt HTTP POST). Back-compat preserved for pre-existing `fastify.webhookService` decorator consumers.
- `FlakyDetector` class — back-compat (untouched by Phase 19).
- `reportingRegistry`, `REPORTING_EVENT_NAMES`, `REPORTING_AGGREGATE_ID`, `makeReportingEmitters` — per-module event registry + typed emit helpers.
- 4 payload schemas: `webhookScheduledPayload`, `webhookDeliveredPayload`, `webhookFailedPayload`, `webhookFailedRetryExhaustedPayload`.
- `WEBHOOK_DELIVER_QUEUE_NAME`, `WEBHOOK_DELIVER_DLQ_QUEUE_NAME`, `webhookDeliveryPayloadSchema`, `registerWebhookDeliveryWorkers` — queue contract.
- `webhookCreateRequestSchema`, `webhookSchema`, `dlqJobSchema`, `dlqListResponseSchema` — HTTP request/response schemas (SPEC-01 / SPEC-03 / QUEUE-05).
- Types: `ReportingModule`, `CreateReportingModuleDeps`, `ReportingRegistry`, `ReportingEmitters`, `ReportingEventName`, `WebhookDeliveryPayload`, `RegisterWebhookDeliveryWorkersDeps`, `WebhookDeliveryRegistration`, `DlqJob`, `DlqListResponse`, `WebhookCreateRequest`, `Webhook`, `WebhookConfig`.

HTTP routes (registered by the plugin):
- `GET /api/queue/dlq` — lists items in `webhook.deliver.dlq` via `fastify.boss.findJobs`; Zod-validated response via `fastify-zod-openapi` (Phase 17 SPEC-06 pipeline).
- `POST /api/webhooks` (ping endpoint — Phase 17) and `GET /api/jobs/:id/reports/*` (report-routes.ts — unchanged).

## Events Emitted

- `webhook.scheduled` — thin, NOT persisted. Fired after the `job.completed` bus subscriber (or `enqueueWebhookDelivery` facade) successfully enqueues a `webhook.deliver` job.
- `webhook.delivered` — terminal, **persisted**. Fired by the MAIN worker after `deliverOnce` returns (2xx response from target).
- `webhook.failed` — transient, NOT persisted. Fired by the MAIN worker on per-attempt failure (before pg-boss decides to retry or route to DLQ). pg-boss's own job row is the canonical per-attempt record — we skip events-table bloat here per TRACE-08.
- `webhook.failed.retryExhausted` — terminal, **persisted**. Fired by the DLQ worker after pg-boss moves the exhausted job to the DLQ queue. This is the **EVENTS-07** terminal event. Payload includes `payloadSnapshot` for operator debug visibility (EVENTS-04 documented exception for terminal events).

All four events carry aggregate `'reporting'` and `aggregateId === REPORTING_AGGREGATE_ID` (the stable v5 UUID `bca46f4f-d5bd-5d65-bf73-0a59a7f3c6d7` derived from `'reporting'` under the URL namespace, mirroring Phase 18 lifecycle's `LIFECYCLE_AGGREGATE_ID` pattern).

## Events Consumed

- `job.completed` (from the jobs module — Plan 19-01 added minimal `server/jobs/events.ts` declaring this event; Phase 23 Jobs Module Keystone extends the registry with the full saga).

Phase 19's subscription handler is registered via `fastify.onPersisted('job.completed', handler)` inside `createReportingModule`. The handler reads `config.webhooks?.url` — no-ops if absent; otherwise builds a POST body `{event: 'job.completed', job: envelope.payload, timestamp: ISO(envelope.occurredAt)}` and enqueues via `fastify.queue.send(WEBHOOK_DELIVER_QUEUE_NAME, {url, payload: body})`. The enqueued job inherits the current ALS correlationId (Phase 15/18 substrate) so all 5 retries + the DLQ row + the terminal event share ONE correlationId.

## Queue Produced

- `webhook.deliver` — `policy: 'standard'`, `retryLimit: 5`, `retryBackoff: true`, `retryDelay: 1`, `retryDelayMax: 30`, `deadLetter: 'webhook.deliver.dlq'`. Payload shape: `{url: string, payload: Record<string, unknown>}` validated by `webhookDeliveryPayloadSchema`. Policy is `'standard'` (NOT `'stately'`) because webhook deliveries are NOT idempotent by enqueue — two different `job.completed` events SHOULD both fire deliveries (RESEARCH §Pitfall 9).
- `webhook.deliver.dlq` — `policy: 'standard'`, `retryLimit: 0`, `retryBackoff: false`. pg-boss re-inserts exhausted main-queue payloads into this queue verbatim (including the original envelope's `correlationId`) via its maintenance loop. The DLQ worker emits `webhook.failed.retryExhausted` (EVENTS-07) and does not throw (retryLimit:0 prevents loops regardless).

## Queue Consumed

- `webhook.deliver` — MAIN worker (calls `WebhookService.deliverOnce`; emits `webhook.delivered` on 2xx; emits `webhook.failed` and re-throws raw on 5xx/network for pg-boss retry accounting per RESEARCH §Pitfall 6).
- `webhook.deliver.dlq` — DLQ worker (emits terminal `webhook.failed.retryExhausted`; swallows emit errors; does not re-throw per RESEARCH §Pattern 2).

Both queues are self-loops (producer and consumer live in the reporting module).

## Invariants

Every invariant below has at least one test (MOD-08):

- **(a) `deliverOnce` contract** — `WebhookService.deliverOnce` throws on 5xx or network error; resolves on 2xx (success) or 4xx (non-retryable per RESEARCH §Pitfall 7). Test: `__tests__/webhook-service.spec.ts` (`[Invariant a]`).
- **(b) 5× 500 → DLQ without crash** — A local HTTP server returning 500 for every request produces a DLQ row after pg-boss exhausts retries + the maintenance loop; the Fastify app does not crash. Test: `__tests__/queue.spec.ts` (`[SC1]`).
- **(c) Single `correlationId` across retries + DLQ + events row** — A webhook enqueued inside an ALS fiber carries ONE correlationId through all 5 retry attempts (pg-boss re-uses the same row across retries), the DLQ row (pg-boss copies the envelope verbatim into the DLQ queue), and the terminal event persisted to the `events` table (envelope emitted by the DLQ worker inherits the restored ALS correlationId). Test: `__tests__/correlation.spec.ts` (`[SC4]`).
- **(d) Terminal event persistence** — The DLQ worker fires `webhook.failed.retryExhausted` which is persisted to the `events` table with `aggregate_type='reporting'`, `aggregate_id=REPORTING_AGGREGATE_ID`, non-null `correlation_id`, and a `payload` JSON containing `url`, `event`, `attempts`, `payloadSnapshot`. Test: `__tests__/terminal-event.spec.ts` (`[EVENTS-07]`).
- **(e) DLQ endpoint shape** — `GET /api/queue/dlq` returns 200 with a body that round-trips through `dlqListResponseSchema.safeParse`; items have flat shape with snake_case `correlation_id` + lowercase `retrycount` / `createdon` (matches CONTEXT.md §Specifics verbatim). Test: `__tests__/dlq-route.spec.ts` (`[QUEUE-05]`).
- **(f) Shutdown idempotency** — `reportingModule.shutdown()` called twice is a no-op; first call unsubscribes the `job.completed` bus subscriber and `boss.offWork`s each registered worker id; second call exits without additional side-effects. Test: `__tests__/module.spec.ts` (`[MOD-06 idempotency]`).

## Non-Goals

- **DLQ replay endpoint** — `GET /api/queue/dlq` is read-only. Re-enqueueing from the DLQ back into the main queue is out of scope for Phase 19.
- **Webhook HMAC signing redesign** — current `WebhookService` HMAC-SHA256 signing (via `X-Signature-256` header) is preserved unchanged. Out of scope.
- **Multi-target webhook fan-out** — current single-target model (`config.webhooks.url` → one POST) carries through. Fan-out is out of scope.
- **Webhook event types beyond `job.completed`** — `device.*` webhooks are downstream scope once the pool module (Phase 20) emits `device.*` events.
- **Full reporting route Zod coverage** — Phase 17 met the one-route-minimum (the `/api/webhooks` ping endpoint). Full Zod coverage across all reporting endpoints is downstream.
- **Auth gating on `/api/queue/dlq`** — matches the existing `/api/webhooks` endpoint (no auth); Phase 26 (Auth Module) adds gating when it lands.
- **`?state=` filter on `/api/queue/dlq`** — RESEARCH §Pitfall 5 notes `findJobs` returns all states; a future query-param filter is deliberately deferred.
- **Consolidation of the `persistEnvelope` middleware** — 10-line duplication across hooks + lifecycle + reporting per RESEARCH Open Question #1; Phase 27+ consolidates.

## Dependencies

Declared in `server/reporting/plugin.ts` `dependencies: ['config', 'db', 'queue', 'event-bus']`:

- `config` — reads `fastify.config.webhooks?.{url, secret, timeout_ms, max_retries}`.
- `db` — writes `events` rows via the `persistEnvelope` middleware.
- `queue` — registers MAIN + DLQ workers via `fastify.queue.work`; enqueues deliveries via `fastify.queue.send`.
- `event-bus` — subscribes to `job.completed` via `fastify.onPersisted` (decorated by the bus plugin — Phase 15).

---

### Runnable Example

```typescript
// Inside a Fastify plugin that has already registered config + db + queue + event-bus + reporting:
import {
  WEBHOOK_DELIVER_QUEUE_NAME,
  REPORTING_EVENT_NAMES,
  REPORTING_AGGREGATE_ID,
} from 'server/reporting/index.js';

// Enqueue a delivery directly (bypassing the bus — matches reportingModule.enqueueWebhookDelivery):
const sentJobId = await app.queue.send(WEBHOOK_DELIVER_QUEUE_NAME, {
  url: 'https://example.com/hook',
  payload: { event: 'job.completed', job: { id: 'abc-123' } },
}, {});

// Listen for the terminal event (requires the reporting module's private bus —
// access via app.reportingModule.bus.on for now; Phase 27+ may consolidate into a global bus):
app.reportingModule.bus.on(REPORTING_EVENT_NAMES.FAILED_RETRY_EXHAUSTED, (payload) => {
  app.log.warn({ url: payload.url, attempts: payload.attempts }, 'Webhook retry-exhausted');
});

// Query the DLQ endpoint:
// curl http://localhost:3000/api/queue/dlq
// → { items: [{id, queue: 'webhook.deliver.dlq', state, retrycount, data, output, createdon, correlation_id}, ...], count }
```

Phase 27 (MOD-09) will add CI-level typechecking of this example snippet. For Phase 19, reviewer spot-checks the block.
