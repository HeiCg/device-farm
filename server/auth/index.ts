/**
 * Auth module — public barrel (MOD-02).
 *
 * Strict 1-line internal/module re-export FIRST, followed by the canonical
 * full surface for cross-module consumers + back-compat:
 *  - factory + AuthService + MatchedApiKey + requireAdmin + keyRoutes
 *  - events surface (registry, emitters, schemas, types)
 *  - actor surface (regex + helpers)
 *
 * NO `export *`. Each export is named.
 *
 * Plan 26-00: shipped strict 1-line internal/ re-export.
 * Plan 26-03: extended with requireAdmin + keyRoutes (cross-module surface).
 * Plan 26-05: extended with full surface — AuthService + events + actor.
 */
export { createAuthModule, type AuthModule } from './internal/module.js';
export { AuthService, type MatchedApiKey } from './internal/auth-service.js';
export { requireAdmin } from './internal/require-admin.js';
export { keyRoutes } from './internal/key-routes.js';
export {
  authRegistry,
  makeAuthEmitters,
  AUTH_EVENT_NAMES,
  AUTH_AGGREGATE_TYPE,
  AUTH_AGGREGATE_ID,
  authKeyCreatedPayloadSchema,
  authKeyRevokedPayloadSchema,
  type AuthRegistry,
  type AuthEmitters,
  type AuthEventName,
  type AuthKeyCreatedPayload,
  type AuthKeyRevokedPayload,
} from './events.js';
export {
  actorSchema,
  asApiKeyActor,
  asUserActor,
  SYSTEM_ACTOR,
  CRON_ACTOR,
  type Actor,
} from './internal/actor.js';
