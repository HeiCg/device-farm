# `server/auth/` — MODULE.md

## Purpose

The auth module owns Bearer API-key authentication. It validates raw keys
against `api_keys.{key_hash, key_salt}` via scrypt + timing-safe compare,
exposes admin-gated key CRUD routes (POST/GET/DELETE `/admin/keys`) with
Zod-typed schemas promoted into `components.schemas`, publishes
`auth.key.created` and `auth.key.revoked` events on the typed bus
(both persisted per TRACE-08), and stamps the ALS `actor` field at HTTP
request entry so every persisted event downstream resolves to a meaningful
actor string (`apikey:{id}` / `user:{id}` / `system` / `cron`) — TRACE-10.
Phase 26 also formalizes the admin-claim gate (`apiKeys.claims.admin === true`)
for `/admin/drain` + `/admin/drain/resume` + `/api/keys/:id/claims/admin` —
the long-standing DEFERRED-23-A resolution.

## Public API

Exports from `server/auth/index.ts` (the ONLY legitimate import surface
outside this module — enforced by the `dependency-cruiser` 10th forbidden
rule `no-deep-imports-into-auth-internal` added in Phase 26 Plan 26-00).

- **Plugin:** `authPlugin` (default — name `'auth'`, dependencies
  `['config', 'db', 'event-bus']`).
- **Factory (canonical v3.0):** `createAuthModule(deps)` + type `AuthModule` (MOD-06).
- **Service (back-compat decorator still consumed):** `AuthService` + `MatchedApiKey`
  interface (with `validateKeyAndReturnRow`, `revokeKeyAndReturnRow`,
  `grantAdminClaim` Phase 26 extensions + the legacy `validateKey` shim).
- **Middleware:** `requireAdmin` Fastify preHandler — RFC 7807 403 on missing
  `claims.admin === true`. Imported via barrel by cross-module consumers
  (`server/jobs/internal/routes.ts` for /admin/drain + /admin/drain/resume).
- **Route registrar:** `keyRoutes` — Fastify plugin exposing 4 routes
  (POST/GET/DELETE `/admin/keys` + POST `/api/keys/:id/claims/admin`).
- **Events surface:** `authRegistry`, `makeAuthEmitters`, `AUTH_EVENT_NAMES`,
  `AUTH_AGGREGATE_TYPE`, `AUTH_AGGREGATE_ID`, `authKeyCreatedPayloadSchema`,
  `authKeyRevokedPayloadSchema`, types `AuthRegistry`, `AuthEmitters`,
  `AuthEventName`, `AuthKeyCreatedPayload`, `AuthKeyRevokedPayload`.
- **Actor surface (TRACE-10):** `actorSchema`, `Actor`, `asApiKeyActor`,
  `asUserActor`, `SYSTEM_ACTOR`, `CRON_ACTOR`.

Fastify decorators exposed by the plugin:

- `fastify.authModule: AuthModule` (NEW canonical surface)
- `fastify.authService: AuthService` (back-compat)
- `fastify.verifyBearerAuth` (`@fastify/bearer-auth` decorator when `auth.enabled=true`)
- `request.apiKey?: MatchedApiKey` (decorated by bearer-auth callback on auth success)

HTTP routes registered via `keyRoutes` (mounted under `/api` in `server/api/plugin.ts`):

| Method | Path                                  | Body / Params               | Emits             |
| ------ | ------------------------------------- | --------------------------- | ----------------- |
| POST   | `/admin/keys`                         | `{name, expiresAt?}`        | `auth.key.created` |
| GET    | `/admin/keys`                         | —                           | —                 |
| DELETE | `/admin/keys/:id`                     | `{id: uuid}`                | `auth.key.revoked` |
| POST   | `/api/keys/:id/claims/admin`          | `{admin: boolean}`          | —                 |

## Events Emitted

| Name                | Persisted (TRACE-08) | Aggregate Type | Payload                                                                |
| ------------------- | -------------------- | -------------- | ---------------------------------------------------------------------- |
| `auth.key.created`  | **YES**              | `auth`         | `{keyId, keyName, prefix, createdBy: Actor}`                           |
| `auth.key.revoked`  | **YES**              | `auth`         | `{keyId, keyName, revokedBy: Actor, revocationReason?: string}`        |

Persistence policy per TRACE-08: BOTH events PERSISTED — security-notable audit
events. Counter-pattern to the maestro registry (both transient telemetry).

The `createdBy` / `revokedBy` payload fields are **type-narrowed via
`actorSchema`** (NOT plain `z.string()`) — TRACE-10 contract enforced at the
schema layer.

## Events Consumed

NONE. Phase 26 is emit-only. Phase 27+ may add OIDC `user.*` subscribers when
the auth surface broadens beyond API keys (DEFERRED-26-C).

## Queue Produced

NONE. Auth operations are synchronous HTTP request/response.

## Queue Consumed

NONE.

## Invariants

1. **`actorSchema` regex rejects `'anonymous'`** — `server/auth/internal/actor.ts`
   accepts only `user:<id>` / `apikey:<id>` / `system` / `cron[:<queue>]`. The
   Phase 26 default migration at `server/bus/helpers.ts:94` replaced
   `'anonymous' → 'system'`; downstream Zod parse on payload `createdBy` /
   `revokedBy` would reject any drift. Tested by
   `__tests__/actor.spec.ts` (Pitfall 4).
2. **Bearer-auth callback writes ALS actor before returning `true`** — the
   `@fastify/bearer-auth` v10 `(key, req) => Promise<boolean>` callback in
   `server/auth/plugin.ts` stamps `asApiKeyActor(matched.id)` into the
   `asyncLocalStorage.getStore()` (dual-shape Map + plain-object) AND
   decorates `request.apiKey = matched`. Tested by
   `__tests__/als-actor.spec.ts` Test 1 (HTTP entry) + Test 5
   (concurrent-fiber isolation, Pitfall 1).
3. **`requireAdmin` returns 403 RFC 7807 on missing claim** — the preHandler
   at `server/auth/internal/require-admin.ts` asserts
   `request.apiKey?.claims?.admin === true`; on miss it sends
   `application/problem+json` 403 (defensive optional-chain handles null
   claims per Pitfall 5). Tested by `__tests__/admin-claim.spec.ts` Tests 1-4.
4. **`grantAdminClaim` uses `jsonb_set` semantics (preserves other claim keys)** —
   `AuthService.grantAdminClaim(apiKeyId, granted)` runs
   `UPDATE api_keys SET claims = jsonb_set(coalesce(claims, '{}'::jsonb),
   '{admin}', $1::jsonb, true)`; existing keys (e.g. `feature_flag`) are
   preserved across the merge. Tested by `__tests__/admin-claim.spec.ts`
   Test 6 (jsonb_set merge preservation).
5. **`auth.key.created` + `auth.key.revoked` persist with TRACE-08 actor
   populated from caller's ALS** — POST/DELETE handlers emit via
   `makeAuthEmitters` which routes through the factory's `persistEnvelope`
   closure (10TH SAMPLE POINT — DEFERRED-26-B). The events row carries
   `actor = envelope.actor = readAls('actor') ?? 'system'` which for an
   authenticated request resolves to `apikey:{requesterId}`. Tested by
   `__tests__/subscriber.spec.ts` (two-layer: bus envelope listener + DB row).
6. **No `'anonymous'` literal in production code** — Plan 26-02 grep-guard
   in `__tests__/lifecycle-ownership.spec.ts` walks `server/**/*.ts`
   (excluding test bodies) and asserts zero `'anonymous'` matches. Test
   bodies may reference the literal in documentation comments without
   triggering the guard.
7. **No deep imports into `server/auth/internal/`** — `dependency-cruiser`
   rule 10 (`no-deep-imports-into-auth-internal`) blocks external imports
   structurally; `__tests__/dep-cruiser.spec.ts` MOD-02 auth extension
   proves the rule fires on `__fixtures__/dep-cruiser/bad-auth-deep-import.ts`.

## Non-Goals

- **Bootstrap CLI for first admin claim** (DEFERRED-26-A). Phase 26 ships
  the server-side route (POST `/api/keys/:id/claims/admin` gated on
  `requireAdmin`) + the operator SQL bootstrap runbook
  (`docs/runbooks/admin-bootstrap.md`); the Go CLI `device-farm admin-grant
  <keyId>` subcommand lands in Phase 28.
- **persistEnvelope 10TH SAMPLE POINT consolidation** (DEFERRED-26-B —
  supersedes DEFERRED-25-A). The 10-line `persistEnvelope` middleware in
  `internal/module.ts` is the 10th verbatim copy across the module factories;
  Phase 27+ (API Aggregator) owns the tree-wide extraction to
  `server/bus/persist-envelope.ts`.
- **OIDC / OAuth integration** (DEFERRED-26-C). v2 territory; out of scope
  for the spec-driven refactor milestone. `actorSchema` already accepts
  `user:<id>` for forward compatibility.
- **Audit log UI** (DEFERRED-26-D). Phase 27 ships the `GET /api/events`
  trace endpoint that exposes the audit trail programmatically; Phase 29
  Web Refactor owns the UI consumer.
- **`fastify-zod-openapi` v5 `required`-emission bug fix** (DEFERRED-26-E —
  supersedes DEFERRED-17-A scope for `auth-plugin.spec.ts` only). v6 was
  NOT released through 2026-05-08; the holistic library upgrade lands in
  Phase 27+ when the API aggregator can swap libraries module-wide.

## Dependencies

Plugin name: `'auth'` (preserved verbatim for back-compat with
`plugin-order.spec` + any dependency-array references in downstream plugins;
`server/jobs/plugin.ts` declares `'auth'` in its dependencies array because
the drain endpoints chain `[requireAuth, requireAdmin]`).

Plugin dependencies array (verbatim from `server/auth/plugin.ts`): 3 entries.

```
['config', 'db', 'event-bus']
```

- `config` — for `fastify.config.auth.enabled` toggle (when false, the
  bearer-auth hook is not registered and requests pass through).
- `db` — for `AuthService` Drizzle queries (`apiKeys` table scrypt validation
  + `claims` JSONB read/write) AND for the `persistEnvelope` middleware that
  writes `auth.key.*` rows to the `events` table.
- `event-bus` — `createEventHelpers` + ALS-aware envelope stamping in
  `makeAuthEmitters`.

Module dependencies (consumed via fastify decorators in the factory):

- `fastify.db` — Drizzle queries + `persistEnvelope` writes.
- `fastify.log` — child logger named `'auth'` (MOD-07).

Cross-module consumers via barrel (MOD-02 compliant):

- `server/jobs/internal/routes.ts` imports `requireAdmin` for /admin/drain
  + /admin/drain/resume preHandler chain.
- `server/api/plugin.ts` imports `keyRoutes` to mount auth-key CRUD under
  `/api`.

## Runnable Example

```bash
# (1) Bootstrap the FIRST admin claim via SQL — see docs/runbooks/admin-bootstrap.md.
# This is a one-shot operator procedure; subsequent admins are granted via
# the POST /api/keys/:id/claims/admin route gated on requireAdmin.

psql "$DATABASE_URL" <<'SQL'
UPDATE api_keys
SET claims = jsonb_set(coalesce(claims, '{}'::jsonb), '{admin}', 'true'::jsonb, true)
WHERE name = 'bootstrap-admin';
SQL
```

```bash
# (2) Create + revoke a key via HTTP, then inspect the persisted events.

ADMIN_KEY="df_xxxxx..."  # Bearer key with claims.admin=true (from bootstrap).
NEW_KEY_ID=$(
  curl -s -X POST http://localhost:3000/api/admin/keys \
    -H "Authorization: Bearer ${ADMIN_KEY}" \
    -H 'Content-Type: application/json' \
    -d '{"name":"ci-key"}' | jq -r '.id'
)

curl -s -X DELETE "http://localhost:3000/api/admin/keys/${NEW_KEY_ID}" \
  -H "Authorization: Bearer ${ADMIN_KEY}"

# Inspect the audit trail — both events persisted with apikey:<bootstrap-id> actor.
psql "$DATABASE_URL" <<SQL
SELECT event_type, aggregate_id, actor, payload->>'keyName' AS key_name
FROM events
WHERE aggregate_type = 'auth'
ORDER BY occurred_at DESC
LIMIT 5;
SQL
```

```typescript
// (3) Subscribe programmatically — module bus is exposed via fastify.authModule.bus.
import type { FastifyInstance } from 'fastify';

export function watchAuthAudit(fastify: FastifyInstance): void {
  fastify.authModule.bus.on('auth.key.created', (payload) => {
    fastify.log.info(
      { keyId: payload.keyId, keyName: payload.keyName, createdBy: payload.createdBy },
      'API key minted',
    );
  });
  fastify.authModule.bus.on('auth.key.revoked', (payload) => {
    fastify.log.warn(
      {
        keyId: payload.keyId,
        keyName: payload.keyName,
        revokedBy: payload.revokedBy,
        reason: payload.revocationReason,
      },
      'API key revoked',
    );
  });
}
```

References to RESEARCH pitfalls: Pitfall 1 (per-request decoration, not
`decorateRequest` proto-sharing), Pitfall 4 (actor default migration
`anonymous → system`), Pitfall 5 (defensive optional-chain on null claims),
Pitfall 6 (bearer-auth callback fiber inheritance), Pitfall 7 (DEFERRED-17-A
v5 `required`-emission, carried as DEFERRED-26-E). See
`.planning/phases/26-auth-module/26-RESEARCH.md`.
