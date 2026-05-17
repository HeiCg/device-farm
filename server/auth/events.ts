/**
 * Auth module — typed event surface (Phase 26 Plan 26-01).
 *
 * Publishes 2 events. Both PERSISTED per TRACE-08 — auth.key.created and
 * auth.key.revoked are security-notable audit events; events table provides
 * the audit trail (Phase 27 GET /api/events?correlationId=X exposes them).
 *
 * Phase 26 ROADMAP SC1: every auth route emits `auth.key.*` with correct
 * correlationId + actor populated via ALS (TRACE-10 enforced via actorSchema
 * type-narrowing on payload fields createdBy/revokedBy).
 *
 * MOD-03 + EVENTS-03 (`noun.verbed` past-tense dotted) + EVENTS-08 (emit
 * helpers in events.ts; direct bus.emit forbidden by lint).
 *
 * 10TH persistEnvelope sample point: when Plan 26-03 adds createAuthModule
 * factory, the 10th identical persistEnvelope copy lands. DEFERRED-25-A
 * consolidation moves to Phase 27+ (this plan does NOT consolidate).
 *
 * This file is allowlisted by eslint-local-rules/no-direct-bus-emit.js
 * (pattern /\/events\.ts$/) and by the .dependency-cruiser.cjs rule
 * `no-direct-bus-emit-outside-events-ts`. All `bus.emit(...)` call sites
 * in the auth module MUST route through these helpers.
 */
import { z } from 'zod';
import { v5 as uuidv5 } from 'uuid';

import { createEventHelpers } from '../bus/helpers.js';
import type { TypedBus } from './../bus/bus.js';
import type { EventRegistry } from '../bus/types.js';
import type { Envelope } from '../events/envelope.js';
import { actorSchema } from './internal/actor.js';

/** Event-name constants (EVENTS-03 past-tense dotted). */
export const AUTH_EVENT_NAMES = {
  KEY_CREATED: 'auth.key.created',
  KEY_REVOKED: 'auth.key.revoked',
} as const;

export type AuthEventName = typeof AUTH_EVENT_NAMES[keyof typeof AUTH_EVENT_NAMES];

/** Aggregate-type literal for envelope.aggregateType field (auth events about API keys). */
export const AUTH_AGGREGATE_TYPE = 'auth' as const;

/** RFC 4122 §4.3 URL namespace — same constant used by hooks, pool, jobs, maestro, pipelines. */
const URL_NAMESPACE = '6ba7b811-9dad-11d1-80b4-00c04fd430c8';

/**
 * Stable v5 UUID derived from 'auth' under the URL namespace (RFC 4122 §4.3).
 * Reserved for non-keyed admin operations (rare; emitters typically pass apiKey.id
 * as aggregateId per-event). Spec re-derives at test time and asserts match —
 * single-source-of-truth check (matches Phase 18 LIFECYCLE_AGGREGATE_ID +
 * Phase 20 POOL_AGGREGATE_ID + Phase 25 PIPELINE_RUN_AGGREGATE_ID derivations).
 *
 * Computed at runtime via the `uuid` library (already a project dep) rather
 * than embedded as a literal that could drift from the spec re-derivation.
 * The events.spec re-derives AUTH_AGGREGATE_ID at test time and asserts equality.
 */
export const AUTH_AGGREGATE_ID: string = uuidv5('auth', URL_NAMESPACE);

// ---------- Payload schemas (TRACE-10: actor fields use actorSchema type-narrowed) ----------

/**
 * Fires from key-routes POST /admin/keys handler (Plan 26-03 wiring).
 * createdBy is type-narrowed to Actor via actorSchema (NOT z.string()) — TRACE-10.
 */
export const authKeyCreatedPayloadSchema = z.object({
  keyId: z.string().uuid(),
  keyName: z.string().min(1),
  /** First 8-12 chars of the key for display/log identification (non-sensitive). */
  prefix: z.string().min(1),
  /** Actor who created the key — TRACE-10 string format. */
  createdBy: actorSchema,
});
export type AuthKeyCreatedPayload = z.infer<typeof authKeyCreatedPayloadSchema>;

/**
 * Fires from key-routes DELETE /admin/keys/:id handler (Plan 26-03 wiring).
 * revokedBy is type-narrowed to Actor via actorSchema — TRACE-10.
 */
export const authKeyRevokedPayloadSchema = z.object({
  keyId: z.string().uuid(),
  keyName: z.string().min(1),
  /** Actor who revoked the key — TRACE-10 string format. */
  revokedBy: actorSchema,
  /** Optional human-readable reason (e.g., 'compromised', 'rotation', 'employee-offboarded'). */
  revocationReason: z.string().min(1).optional(),
});
export type AuthKeyRevokedPayload = z.infer<typeof authKeyRevokedPayloadSchema>;

// ---------- Registry (TRACE-08 persistence policy: BOTH persisted) ----------
//
// Both events PERSISTED per TRACE-08 (security-notable audit trail).
// Counter-pattern to maestro registry (both transient telemetry).

export const authRegistry = {
  [AUTH_EVENT_NAMES.KEY_CREATED]: {
    schema: authKeyCreatedPayloadSchema,
    persisted: true,
    aggregateType: AUTH_AGGREGATE_TYPE,
  },
  [AUTH_EVENT_NAMES.KEY_REVOKED]: {
    schema: authKeyRevokedPayloadSchema,
    persisted: true,
    aggregateType: AUTH_AGGREGATE_TYPE,
  },
} as const satisfies EventRegistry;

export type AuthRegistry = typeof authRegistry;

// ---------- Emit helpers factory (MOD-03 + EVENTS-08 — direct bus.emit forbidden) ----------

/**
 * Called by createAuthModule (Plan 26-03) to construct the 2 typed emit
 * helpers. The factory passes its own persistEnvelope-equivalent via
 * `onEmit` so persisted events (BOTH per TRACE-08) land in the `events`
 * table — projecting envelope.actor onto events.actor TEXT column (TRACE-10).
 *
 * Returns an object with per-event helpers so callers read like:
 *   emit.keyCreated(apiKeyId, { keyId, keyName, prefix, createdBy: 'apikey:xxx' });
 *   emit.keyRevoked(apiKeyId, { keyId, keyName, revokedBy: 'system', revocationReason: 'rotation' });
 */
export function makeAuthEmitters(
  bus: TypedBus<AuthRegistry>,
  onEmit?: (envelope: Envelope) => void,
) {
  const emit = createEventHelpers(bus, onEmit);
  return {
    keyCreated: emit(AUTH_EVENT_NAMES.KEY_CREATED),
    keyRevoked: emit(AUTH_EVENT_NAMES.KEY_REVOKED),
  };
}

export type AuthEmitters = ReturnType<typeof makeAuthEmitters>;
