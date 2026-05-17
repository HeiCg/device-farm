/**
 * Phase 17 Plan 17-01 (SPEC-06) — Reporting module Zod schemas.
 *
 * Representative request/response schemas for the webhook-ping endpoint
 * (POST /api/webhooks). Full webhook registration + persistence lands in
 * Phase 19 (Reporting Migration) — this endpoint is a thin validator +
 * fire-and-forget delivery that lets the contract pipeline enumerate the
 * route.
 */
import { z } from 'zod';

export const webhookCreateRequestSchema = z.object({
  url: z.string().url(),
  event: z.string().min(1).max(64).default('test.ping'),
  payload: z.record(z.string(), z.unknown()).optional(),
}).meta({
  id: 'WebhookCreateRequest',
  description: 'Register a webhook target — triggers a fire-and-forget ping delivery',
});

export const webhookSchema = z.object({
  url: z.string().url(),
  event: z.string(),
  status: z.enum(['queued']),
  queuedAt: z.string().datetime(),
}).meta({
  id: 'Webhook',
  description: 'Acknowledgement that a webhook delivery was queued',
});

export type WebhookCreateRequest = z.infer<typeof webhookCreateRequestSchema>;
export type Webhook = z.infer<typeof webhookSchema>;

// ============================================================
// Phase 19 — Webhook delivery queue payload + DLQ response schemas.
// ============================================================
//
// webhookDeliveryPayloadSchema — validated by both producer (reporting module
// bus subscriber) and consumer (queue worker) per QUEUE-02. Thin: caller
// supplies `url` + freeform `payload` (body to POST). The JobEnvelope
// (server/queue/plugin.ts) wraps this with correlationId/causationId/actor.
//
// dlqJobSchema — FLAT shape per CONTEXT.md §Specifics. Hoists
// `correlationId` out of `data` into a top-level `correlation_id` key so
// operators get one-pass visibility without drilling. Field names match
// CONTEXT verbatim: id, queue, state, retrycount, data, output, createdon,
// correlation_id. The endpoint handler (plan 19-04) projects pg-boss's
// `JobWithMetadata<T>` shape into this flat form.
//
// dlqListResponseSchema — the `GET /api/queue/dlq` 200 response body.
// `count` is included so clients don't need to scan `items.length` in
// paginated futures (Phase 19 returns all items; future ?limit= pagination
// can surface it meaningfully without response-shape churn).

export const webhookDeliveryPayloadSchema = z.object({
  url: z.string().url(),
  payload: z.record(z.string(), z.unknown()),
}).meta({
  id: 'WebhookDeliveryPayload',
  description: 'Queue payload for the webhook-deliver worker — {url, payload body}',
});

export type WebhookDeliveryPayload = z.infer<typeof webhookDeliveryPayloadSchema>;

export const dlqJobSchema = z.object({
  id: z.string(),
  queue: z.string(),
  state: z.enum(['created', 'retry', 'active', 'completed', 'cancelled', 'failed']),
  retrycount: z.number().int().nonnegative(),
  data: z.record(z.string(), z.unknown()),
  output: z.record(z.string(), z.unknown()).nullable(),
  createdon: z.string().datetime().nullable(),
  correlation_id: z.string().uuid().nullable(),
}).meta({
  id: 'DlqJob',
  description: 'A dead-lettered job from the webhook-deliver-dlq queue (flat shape; correlation_id hoisted from envelope)',
});

export type DlqJob = z.infer<typeof dlqJobSchema>;

export const dlqListResponseSchema = z.object({
  items: z.array(dlqJobSchema),
  count: z.number().int().nonnegative(),
}).meta({
  id: 'DlqListResponse',
  description: 'GET /api/queue/dlq response — list of dead-lettered webhook delivery jobs',
});

export type DlqListResponse = z.infer<typeof dlqListResponseSchema>;
