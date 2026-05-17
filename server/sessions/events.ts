/**
 * Sessions module — typed event surface (Phase 34 Plan 34-01).
 *
 * Wave 0 substrate (Plan 34-00) shipped event-name constants + aggregate-type
 * + empty registry stub. Plan 34-01 ships the FULL body — 4 payload schemas,
 * registry with `persisted: true` on every entry, and `makeSessionsEmitters`
 * factory returning 4 typed helpers.
 *
 * 4 event names (EVENTS-03 dotted past-tense):
 *   - session.leased        — POST /api/sessions success
 *   - session.released      — DELETE /api/sessions/:id success
 *   - session.expired       — sweeper TTL hit (Plan 34-04 will emit)
 *   - session.device.lost   — device transitioned to Error mid-session (Plan 34-04 will emit)
 *
 * TRACE-08: ALL 4 events persisted — sessions are user-visible primary
 * resources and the audit trail is required (Phase 27 trace-tree endpoint
 * groups them by correlationId).
 *
 * MOD-03 + EVENTS-08 (emit helpers live in events.ts; direct bus.emit
 * forbidden by lint). This file is allowlisted by
 * eslint-local-rules/no-direct-bus-emit.js (pattern /\/events\.ts$/) and by
 * the .dependency-cruiser.cjs rule `no-direct-bus-emit-outside-events-ts`.
 */
import { z } from 'zod';

import { createEventHelpers } from '../bus/helpers.js';
import type { TypedBus } from '../bus/bus.js';
import type { EventRegistry } from '../bus/types.js';
import type { Envelope } from '../events/envelope.js';
import { actorSchema } from '../auth/index.js';

/** Event-name constants (EVENTS-03 past-tense dotted). */
export const SESSION_EVENT_NAMES = {
  LEASED: 'session.leased',
  RELEASED: 'session.released',
  EXPIRED: 'session.expired',
  DEVICE_LOST: 'session.device.lost',
} as const;

export type SessionEventName = typeof SESSION_EVENT_NAMES[keyof typeof SESSION_EVENT_NAMES];

/** Aggregate-type literal for envelope.aggregateType — session events are about a `session` aggregate. */
export const SESSIONS_AGGREGATE_TYPE = 'session' as const;

// ---------- Payload schemas (TRACE-10: actor fields use actorSchema type-narrowed) ----------

/**
 * Fires from sessions module leaseDevice() after pool allocation + DB insert
 * succeed. ownerActor is type-narrowed to Actor via actorSchema (NOT z.string()) — TRACE-10.
 */
export const sessionLeasedPayloadSchema = z.object({
  sessionId: z.string().uuid(),
  deviceId: z.string().uuid(),
  deviceName: z.string(),
  platform: z.enum(['android', 'ios']),
  ttlSeconds: z.number().int(),
  leaseUntil: z.string().datetime(),
  /** Actor who leased the device — TRACE-10 string format. */
  ownerActor: actorSchema,
  metadata: z.record(z.string(), z.unknown()).nullable(),
});
export type SessionLeasedPayload = z.infer<typeof sessionLeasedPayloadSchema>;

/**
 * Fires from sessions module releaseDevice() (or sweeper / device-lost handler).
 * releasedBy is type-narrowed to Actor via actorSchema — TRACE-10.
 */
export const sessionReleasedPayloadSchema = z.object({
  sessionId: z.string().uuid(),
  deviceId: z.string().uuid(),
  reason: z.enum(['explicit', 'sweeper', 'device-lost', 'shutdown']),
  releasedBy: actorSchema,
});
export type SessionReleasedPayload = z.infer<typeof sessionReleasedPayloadSchema>;

/**
 * Fires from sweeper (Plan 34-04) when an active session's lease_until has elapsed.
 * No actor field — emitter is the `cron` actor stamped via ALS.
 */
export const sessionExpiredPayloadSchema = z.object({
  sessionId: z.string().uuid(),
  deviceId: z.string().uuid(),
  leaseUntil: z.string().datetime(),
});
export type SessionExpiredPayload = z.infer<typeof sessionExpiredPayloadSchema>;

/**
 * Fires from device-state subscriber (Plan 34-04) when a device transitions
 * to Error while an active session is leased against it. Reason carries the
 * underlying device-error reason.
 */
export const sessionDeviceLostPayloadSchema = z.object({
  sessionId: z.string().uuid(),
  deviceId: z.string().uuid(),
  reason: z.string(),
});
export type SessionDeviceLostPayload = z.infer<typeof sessionDeviceLostPayloadSchema>;

// ---------- Registry (TRACE-08 persistence policy: ALL persisted) ----------

export const sessionsRegistry = {
  [SESSION_EVENT_NAMES.LEASED]: {
    schema: sessionLeasedPayloadSchema,
    persisted: true,
    aggregateType: SESSIONS_AGGREGATE_TYPE,
  },
  [SESSION_EVENT_NAMES.RELEASED]: {
    schema: sessionReleasedPayloadSchema,
    persisted: true,
    aggregateType: SESSIONS_AGGREGATE_TYPE,
  },
  [SESSION_EVENT_NAMES.EXPIRED]: {
    schema: sessionExpiredPayloadSchema,
    persisted: true,
    aggregateType: SESSIONS_AGGREGATE_TYPE,
  },
  [SESSION_EVENT_NAMES.DEVICE_LOST]: {
    schema: sessionDeviceLostPayloadSchema,
    persisted: true,
    aggregateType: SESSIONS_AGGREGATE_TYPE,
  },
} as const satisfies EventRegistry;

export type SessionsRegistry = typeof sessionsRegistry;

// ---------- Emit helpers factory (MOD-03 + EVENTS-08 — direct bus.emit forbidden) ----------

/**
 * Called by createSessionsModule (Plan 34-01) to construct the 4 typed emit
 * helpers. Each helper stamps correlationId/causationId/actor via the ALS
 * machinery in createEventHelpers. The factory passes its own
 * persistEnvelope (11TH SAMPLE POINT — DEFERRED-26-B) as `onEmit` so
 * persisted events land in the `events` table.
 *
 * Returns:
 *   emit.leased(sessionId, payload)
 *   emit.released(sessionId, payload)
 *   emit.expired(sessionId, payload)
 *   emit.deviceLost(sessionId, payload)
 */
export function makeSessionsEmitters(
  bus: TypedBus<SessionsRegistry>,
  onEmit?: (envelope: Envelope) => void,
) {
  const emit = createEventHelpers(bus, onEmit);
  return {
    leased:     emit(SESSION_EVENT_NAMES.LEASED),
    released:   emit(SESSION_EVENT_NAMES.RELEASED),
    expired:    emit(SESSION_EVENT_NAMES.EXPIRED),
    deviceLost: emit(SESSION_EVENT_NAMES.DEVICE_LOST),
  };
}

export type SessionsEmitters = ReturnType<typeof makeSessionsEmitters>;
