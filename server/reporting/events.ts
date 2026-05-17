/**
 * Phase 19 / Plan 19-01 — Reporting module event registry + emit helpers (MOD-03).
 *
 * Declares the 4 webhook-delivery lifecycle events:
 *   - webhook.scheduled               (thin, NOT persisted) — after enqueue
 *   - webhook.delivered               (terminal, persisted) — after 2xx
 *   - webhook.failed                  (transient, NOT persisted) — per-attempt pre-retry
 *   - webhook.failed.retryExhausted   (terminal, persisted)  — **EVENTS-07** — from DLQ worker
 *
 * Terminal events are persisted per TRACE-08 (observable in Phase 27's
 * GET /api/events?correlationId=… trace-tree). Per-attempt transient events
 * are NOT persisted — we skip the events-table bloat, the pg-boss job row
 * itself is the canonical per-attempt record.
 *
 * aggregateType: 'reporting' on all 4 entries (singleton aggregate — the module).
 *
 * NOTE on aggregateId: envelopeSchema (server/events/envelope.ts) requires
 * `aggregateId: z.string().uuid()`. The reporting module is a singleton so every
 * event shares one aggregateId — REPORTING_AGGREGATE_ID below is a stable v5 UUID
 * derived from the string 'reporting' under the URL namespace (RFC 4122 §4.3),
 * matching Phase 18 lifecycle's LIFECYCLE_AGGREGATE_ID approach.
 *
 * `createEventHelpers` (Phase 15 substrate) wraps TypedBus.emit + envelope
 * stamping (ALS-sourced correlationId) + optional onEmit side-channel (used by
 * the module factory in plan 19-03 to forward to bus persistence middleware).
 *
 * This file is allowlisted by eslint-local-rules/no-direct-bus-emit.js
 * (pattern /\/events\.ts$/) and by the .dependency-cruiser.cjs rule
 * `no-direct-bus-emit-outside-events-ts`. All `bus.emit(...)` call sites
 * in the reporting module MUST route through these helpers.
 */
import { z } from 'zod';

import { createEventHelpers } from '../bus/helpers.js';
import type { TypedBus } from '../bus/bus.js';
import type { EventRegistry } from '../bus/types.js';
import type { Envelope } from '../events/envelope.js';

/** Event-name constants. Use these anywhere the literal string is referenced. */
export const REPORTING_EVENT_NAMES = {
  SCHEDULED:              'webhook.scheduled',
  DELIVERED:              'webhook.delivered',
  FAILED:                 'webhook.failed',
  FAILED_RETRY_EXHAUSTED: 'webhook.failed.retryExhausted',
} as const;

export type ReportingEventName = typeof REPORTING_EVENT_NAMES[keyof typeof REPORTING_EVENT_NAMES];

/**
 * Fixed singleton UUID for the reporting aggregate. Stable v5 UUID derived
 * from the string 'reporting' under the URL namespace. Matches the pattern
 * Phase 18 established with LIFECYCLE_AGGREGATE_ID. Any consumer wanting to
 * group events by module can equivalently filter `aggregateType === 'reporting'`.
 */
export const REPORTING_AGGREGATE_ID = 'bca46f4f-d5bd-5d65-bf73-0a59a7f3c6d7' as const;

// ---------- Payload schemas ----------

/** Common base payload. `jobId` nullable because future non-jobs webhooks may reach this module. */
export const webhookScheduledPayload = z.object({
  url: z.string().url(),
  event: z.string().min(1),         // the webhook event name (e.g. 'job.completed')
  jobId: z.string().nullable(),     // jobs-owned reference when applicable
});

export const webhookDeliveredPayload = webhookScheduledPayload.extend({
  statusCode: z.number().int(),
  durationMs: z.number().int().nonnegative(),
  attempt: z.number().int().positive(),
});

export const webhookFailedPayload = webhookScheduledPayload.extend({
  attempt: z.number().int().positive(),
  statusCode: z.number().int().nullable(),
  error: z.string(),
});

/**
 * EVENTS-07 terminal payload. Fires from the DLQ worker (plan 19-03) after
 * pg-boss exhausts retries. Includes `payloadSnapshot` for operator debug
 * visibility — EVENTS-04 explicitly allows terminal events to carry full
 * snapshot instead of thin references. Matches hooks' `hook.failed.retryExhausted`
 * pattern (which carries stderrTail).
 */
export const webhookFailedRetryExhaustedPayload = webhookScheduledPayload.extend({
  attempts: z.number().int().positive(),                       // total attempts (retryLimit + 1)
  lastStatusCode: z.number().int().nullable(),
  lastError: z.string(),
  payloadSnapshot: z.record(z.string(), z.unknown()),          // original POST body for debug
});

// ---------- Registry ----------
//
// Persisted policy per TRACE-08:
//   - scheduled / failed: per-attempt telemetry, NOT persisted (pg-boss job row is canonical)
//   - delivered / failedRetryExhausted: TERMINAL, PERSISTED — Phase 27 trace-tree surfaces them

export const reportingRegistry = {
  [REPORTING_EVENT_NAMES.SCHEDULED]:              { schema: webhookScheduledPayload,             persisted: false, aggregateType: 'reporting' },
  [REPORTING_EVENT_NAMES.DELIVERED]:              { schema: webhookDeliveredPayload,             persisted: true,  aggregateType: 'reporting' },
  [REPORTING_EVENT_NAMES.FAILED]:                 { schema: webhookFailedPayload,                persisted: false, aggregateType: 'reporting' },
  [REPORTING_EVENT_NAMES.FAILED_RETRY_EXHAUSTED]: { schema: webhookFailedRetryExhaustedPayload,  persisted: true,  aggregateType: 'reporting' },
} as const satisfies EventRegistry;

export type ReportingRegistry = typeof reportingRegistry;

// ---------- Emit helpers factory ----------

/**
 * Called by createReportingModule (plan 19-03) to construct the 4 typed
 * emit helpers. The factory passes its own `persistEnvelope`-equivalent via
 * `onEmit` so persisted events land in the `events` table per TRACE-08.
 *
 * Callers read like:
 *   emit.scheduled(REPORTING_AGGREGATE_ID, { url, event, jobId });
 *   emit.failedRetryExhausted(REPORTING_AGGREGATE_ID, { ...terminal shape... });
 */
export function makeReportingEmitters(
  bus: TypedBus<ReportingRegistry>,
  onEmit?: (envelope: Envelope) => void,
) {
  const emit = createEventHelpers(bus, onEmit);
  return {
    scheduled:              emit(REPORTING_EVENT_NAMES.SCHEDULED),
    delivered:              emit(REPORTING_EVENT_NAMES.DELIVERED),
    failed:                 emit(REPORTING_EVENT_NAMES.FAILED),
    failedRetryExhausted:   emit(REPORTING_EVENT_NAMES.FAILED_RETRY_EXHAUSTED),
  };
}

export type ReportingEmitters = ReturnType<typeof makeReportingEmitters>;
