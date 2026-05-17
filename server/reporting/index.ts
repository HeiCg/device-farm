/**
 * Phase 19 / Plan 19-06 — Reporting module public barrel (MOD-02).
 *
 * This is the ONLY import surface for consumers outside `server/reporting/`.
 * `dependency-cruiser` rule `no-deep-imports-into-reporting-internal` (added
 * to `.dependency-cruiser.cjs` in Phase 19 Plan 19-00) enforces the boundary
 * structurally — imports into `server/reporting/internal/**` from outside
 * the module fail CI.
 *
 * Exports in this file are PUBLIC and subject to semver-ish stability.
 * Anything under `./internal/` is module-private and may change without notice.
 *
 * The ONLY allowed internal/ re-export line is the factory entry point per
 * MOD-06. Runtime + types exported from a single statement (inline `type`
 * modifier) so plan 19-06 verify script sees exactly ONE internal/ re-export
 * line (MOD-02 structural invariant). Matches Phase 18 lifecycle 1-line form
 * which tightens on Phase 16 hooks' 2-line form.
 */

// Fastify plugin (default export — matches Phase 15 substrate convention).
export { default as reportingPlugin } from './plugin.js';

// Factory surface (the v3.0 canonical way to instantiate the module). MOD-06.
// ONE internal/ re-export line — MOD-02 structural invariant.
export { createReportingModule, type ReportingModule, type CreateReportingModuleDeps } from './internal/module.js';

// Back-compat class surfaces (preserved for existing consumers — webhookService
// decorator on fastify is still read by any code holding a reference).
export { WebhookService } from './webhook-service.js';
export type { WebhookConfig } from './webhook-service.js';
export { FlakyDetector } from './flaky-detector.js';

// Schemas + derived TS types (SPEC-01 / SPEC-03 / QUEUE-05 / Phase 17 ping endpoint).
export {
  webhookCreateRequestSchema,
  webhookSchema,
  webhookDeliveryPayloadSchema,
  dlqJobSchema,
  dlqListResponseSchema,
} from './schemas.js';
export type {
  WebhookCreateRequest,
  Webhook,
  WebhookDeliveryPayload,
  DlqJob,
  DlqListResponse,
} from './schemas.js';

// Events surface (MOD-03).
export {
  reportingRegistry,
  REPORTING_EVENT_NAMES,
  REPORTING_AGGREGATE_ID,
  makeReportingEmitters,
  webhookScheduledPayload,
  webhookDeliveredPayload,
  webhookFailedPayload,
  webhookFailedRetryExhaustedPayload,
} from './events.js';
export type { ReportingRegistry, ReportingEmitters, ReportingEventName } from './events.js';

// Queue surface (QUEUE-06 + QUEUE-05 DLQ).
export {
  WEBHOOK_DELIVER_QUEUE_NAME,
  WEBHOOK_DELIVER_DLQ_QUEUE_NAME,
  registerWebhookDeliveryWorkers,
} from './queue.js';
export type {
  RegisterWebhookDeliveryWorkersDeps,
  WebhookDeliveryRegistration,
} from './queue.js';

// NOTE: routes.ts / registerReportingRoutes is NOT re-exported — routes are
// plugin-internal (called by reporting/plugin.ts only). Barrel consumers who
// need the route shape can import DlqJob / DlqListResponse schemas above.
