/**
 * Sessions module — public barrel (MOD-02 strict; no `export *`).
 *
 * Strict 1-line internal/module re-export FIRST, followed by the canonical
 * full surface for cross-module consumers:
 *  - factory + SessionsModule type
 *  - plugin (default export)
 *  - events surface (registry, emitters, schemas, types, constants)
 *  - REST Zod schemas (re-exported from ./schemas.js)
 *  - WS protocol schemas (re-exported from ./internal/protocol.js)
 *  - Resolver factory + types (re-exported from ./internal/resolver/index.js)
 *
 * Mirrors server/auth/index.ts MOD-02 strict pattern. Finalized in
 * Plan 34-08 phase close — every public symbol re-exported via named
 * exports (NO `export *`).
 *
 * Plan 34-00: shipped strict 1-line internal/ re-export.
 * Plan 34-01: extended with plugin + events surface + schemas.
 * Plan 34-08: extended with WS protocol + resolver surface (final form).
 */
export { createSessionsModule, type SessionsModule } from './internal/module.js';
export { default as sessionsPlugin } from './plugin.js';
export {
  sessionsRegistry,
  makeSessionsEmitters,
  SESSION_EVENT_NAMES,
  SESSIONS_AGGREGATE_TYPE,
  sessionLeasedPayloadSchema,
  sessionReleasedPayloadSchema,
  sessionExpiredPayloadSchema,
  sessionDeviceLostPayloadSchema,
  type SessionsRegistry,
  type SessionsEmitters,
  type SessionEventName,
  type SessionLeasedPayload,
  type SessionReleasedPayload,
  type SessionExpiredPayload,
  type SessionDeviceLostPayload,
} from './events.js';
export {
  leaseRequestSchema,
  leaseResponseSchema,
  releaseParamsSchema,
  releaseResponseSchema,
  listResponseSchema,
  type LeaseRequest,
  type LeaseResponse,
  type ReleaseParams,
  type ReleaseResponse,
  type ListResponse,
} from './schemas.js';
export {
  clientEnvelope,
  serverEnvelope,
  KEY_CODES,
  ERROR_CODES,
  EVENT_KINDS,
  type ClientEnvelope,
  type ServerEnvelope,
  type KeyCode,
  type ErrorCode,
  type EventKind,
  type TapEnvelope,
  type TapByDescriptionEnvelope,
  type TypeEnvelope,
  type SwipeEnvelope,
  type KeyEnvelope,
  type ScreenshotEnvelope,
  type ScreenRecordEnvelope,
  type InstallAppEnvelope,
  type LaunchAppEnvelope,
  type UninstallAppEnvelope,
  type PingEnvelope,
  type AckEnvelope,
  type ErrorEnvelope,
  type EventEnvelope,
  type PongEnvelope,
} from './internal/protocol.js';
export {
  createResolver,
  ResolverError,
  type TargetResolver,
  type ResolveTargetRequest,
  type ResolveTargetResult,
} from './internal/resolver/index.js';
