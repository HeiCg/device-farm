# `server/sessions/` — MODULE.md

## Purpose

The sessions module moves device-farm from "batch-only" to "session-aware".
It owns the interactive `lease → tap/tapByDescription/type/swipe/key/
screenshot/screenRecord/installApp/launchApp/uninstallApp → release` loop
exposed via REST (`POST/DELETE/GET /api/sessions`) and WebSocket
(`/ws/sessions/:id?token=` with Zod-validated action envelopes), and the
natural-language target resolvers (Maestro AI default, Claude Vision opt-in
via `SESSION_RESOLVER=claude-vision`) that turn strings like `"Sign In
button"` into `(x, y)` tap coordinates. Downstream consumers: the
`@device-stream/mcp` MCP stdio server (T-34.7), the `device-farm session`
CLI subcommand (T-34.8), and the `/sessions` + `/sessions/[id]` SvelteKit
panel (T-34.9). Phase 35 (App Explorer + Atlas Graph) and Phase 37 (PR
Review Bot, InputBroadcaster) consume the WS surface as external clients.

Requirements: **SESS-LEASE, SESS-WS, SESS-DISPATCH, SESS-NL-MAESTRO,
SESS-NL-CLAUDE, SESS-AUTH, SESS-MCP, SESS-CLI, SESS-WEB, SESS-DOCS**
(traced in `.planning/REQUIREMENTS.md` §Phase 34). Plan progression: 34-00
substrate → 34-01 REST lease/release + factory → 34-02 WS protocol +
dispatch → 34-03 NL resolvers → 34-04 rate limit + sweeper +
`device.health.failed` subscriber → 34-05 MCP package → 34-06 CLI
subcommands → 34-07 web UI panel → 34-08 phase close (this MODULE.md).

References to RESEARCH pitfalls + open questions are inlined per section.
See `.planning/phases/34-session-api-mcp/34-RESEARCH.md`.

## Public API

Exports from `server/sessions/index.ts` (the ONLY legitimate import surface
outside this module — enforced by the `dependency-cruiser` 11th forbidden
rule `no-deep-imports-into-sessions-internal` added in Phase 34 Plan 34-00).

- **Plugin:** `sessionsPlugin` (default — name `'sessions'`, dependencies
  `['config', 'db', 'event-bus', 'queue', 'pool-plugin', 'auth', 'websocket-plugin']`).
- **Factory (canonical v3.0):** `createSessionsModule(deps)` + type
  `SessionsModule` (MOD-06). Exposes
  `bus`, `emit`, `openSockets`, `rateLimiter`, `registerSubscribers`,
  `leaseDevice`, `releaseDevice`, `listSessions`, `shutdown`.
- **Events surface:** `sessionsRegistry`, `makeSessionsEmitters`,
  `SESSION_EVENT_NAMES`, `SESSIONS_AGGREGATE_TYPE`,
  `sessionLeasedPayloadSchema`, `sessionReleasedPayloadSchema`,
  `sessionExpiredPayloadSchema`, `sessionDeviceLostPayloadSchema`, types
  `SessionsRegistry`, `SessionsEmitters`, `SessionEventName`,
  `SessionLeasedPayload`, `SessionReleasedPayload`, `SessionExpiredPayload`,
  `SessionDeviceLostPayload`.
- **REST Zod schemas:** `leaseRequestSchema`, `leaseResponseSchema`,
  `releaseParamsSchema`, `releaseResponseSchema`, `listResponseSchema` +
  inferred types `LeaseRequest`, `LeaseResponse`, `ReleaseParams`,
  `ReleaseResponse`, `ListResponse`. All five carry `.meta({id:'...'})`
  so `fastify-zod-openapi` promotes them into `components.schemas`.
- **WS protocol schemas:** `clientEnvelope` (11 variants via
  `z.discriminatedUnion('type')`), `serverEnvelope` (ack/error/event/pong),
  plus per-variant narrowed types (`TapEnvelope`, `TapByDescriptionEnvelope`,
  `TypeEnvelope`, `SwipeEnvelope`, `KeyEnvelope`, `ScreenshotEnvelope`,
  `ScreenRecordEnvelope`, `InstallAppEnvelope`, `LaunchAppEnvelope`,
  `UninstallAppEnvelope`, `PingEnvelope`, `AckEnvelope`, `ErrorEnvelope`,
  `EventEnvelope`, `PongEnvelope`) and the supporting `KEY_CODES`,
  `ERROR_CODES`, `EVENT_KINDS` constants.
- **Resolver surface:** `createResolver({logger})` factory +
  `TargetResolver`, `ResolveTargetRequest`, `ResolveTargetResult` types +
  `ResolverError`. Exposed for tests and future external resolvers; the
  plugin wires the env-driven default via `fastify.sessionsResolver`.

Fastify decorators exposed by the plugin:

- `fastify.sessionsModule: SessionsModule` — full canonical surface.
- `fastify.sessionsResolver: TargetResolver` — env-driven, built once at
  plugin boot via `createResolver({logger: fastify.log})`. Tests inject
  alternative resolvers through the WS handler's `ActionContext` bundle
  rather than re-decorating fastify.

HTTP routes registered via `registerSessionRoutes` (mounted under `/api`):

| Method | Path                          | Body / Params               | Emits             |
| ------ | ----------------------------- | --------------------------- | ----------------- |
| POST   | `/api/sessions`               | `LeaseRequest`              | `session.leased`  |
| DELETE | `/api/sessions/:id`           | `ReleaseParams`             | `session.released` |
| GET    | `/api/sessions`               | `?status=active|released|expired` | —          |

WebSocket route registered via `registerSessionWebSocket`:

| Path                            | Auth                                  | Envelopes                              |
| ------------------------------- | ------------------------------------- | -------------------------------------- |
| `/ws/sessions/:id?token=`       | Bearer-via-query; owner-must-match    | `clientEnvelope` ↔ `serverEnvelope`    |

## Events Emitted

| Name                     | Persisted (TRACE-08) | Aggregate Type | Payload                                                                       |
| ------------------------ | -------------------- | -------------- | ----------------------------------------------------------------------------- |
| `session.leased`         | **YES**              | `session`      | `{sessionId, deviceId, deviceName, platform, ttlSeconds, leaseUntil, ownerActor, metadata}` |
| `session.released`       | **YES**              | `session`      | `{sessionId, deviceId, reason, releasedBy}`                                   |
| `session.expired`        | **YES**              | `session`      | `{sessionId, deviceId, leaseUntil}`                                           |
| `session.device.lost`    | **YES**              | `session`      | `{sessionId, deviceId, reason}`                                               |

Persistence policy per TRACE-08: ALL 4 events PERSISTED — sessions are
user-visible primary resources and the audit trail is required (Phase 27
trace-tree endpoint groups them by `correlationId`).

The `ownerActor` (on `session.leased`) and `releasedBy` (on
`session.released`) payload fields are **type-narrowed via `actorSchema`**
(NOT plain `z.string()`) — TRACE-10 contract enforced at the schema layer.

`session.expired` has no actor field — it is emitted by the sweeper worker
with the `cron` actor stamped via ALS. `session.device.lost` similarly
relies on the ALS-stamped envelope actor (typically `system` when emitted
from the `device.health.failed` subscriber).

## Events Consumed

| Name                    | Source       | Handler                                              |
| ----------------------- | ------------ | ---------------------------------------------------- |
| `device.health.failed`  | pool module  | `handleDeviceHealthFailed` (`internal/module.ts`)    |

The subscriber, wired in `registerSubscribers()` at `onReady`, finds any
active session against the failing device, broadcasts an `{type:'event',
kind:'device-lost'}` envelope on the open WS (if any), closes the WS with
1011, releases the pool device, marks the session row `status='expired'`,
emits `session.device.lost`, and clears the rate-limiter bucket for that
session id. NOT consuming `job.*` events (sessions are independent of job
lifecycle).

## Queue Produced

| Name                  | Schedule (preferred) | Schedule (fallback)                  | Handler                                |
| --------------------- | -------------------- | ------------------------------------ | -------------------------------------- |
| `session.sweep`       | 6-field cron `'*/30 * * * * *'` (every 30s) | 5-field `'* * * * *'` (minute granularity) + `setInterval(30_000)` | `sweepExpiredSessions` (`internal/sweeper.ts`) |

The sweeper picks the schedule strategy at boot: pg-boss `boss.schedule()`
is attempted with the 6-field cron first; if pg-boss rejects (the upstream
cron parser version differs across pg-boss minor releases — RESEARCH §Open
Q #1), the sweeper falls back to a 5-field cron + a Node `setInterval(30s)`
so the 30-second TTL boundary is still honored. Chosen strategy is logged
at startup and exposed on the `SweeperHandle` so `onClose` can `clearInterval`
the fallback timer.

Retry policy: `policy:'standard'` (single attempt per tick — sweeper is
idempotent; the work fn updates only rows where `status='active' AND
leaseUntil < now()`).

## Queue Consumed

| Name             | Consumer                                                      |
| ---------------- | ------------------------------------------------------------- |
| `session.sweep`  | `boss.work(SESSION_SWEEP, sweepExpiredSessions)` — same module |

The producer + consumer live in the same module; the queue name is exported
from `server/queue/names.ts` (`QUEUE_NAMES.SESSION_SWEEP`) per Phase 15
naming convention.

## Invariants

1. **One active session per device** — the `sessions` table has a partial
   unique index `WHERE status='active'` (Drizzle migration 0009). Concurrent
   `POST /api/sessions` calls racing on the same device serialize at the
   index: the loser receives Postgres SQLSTATE `23505`, which the factory
   rethrows as RFC 7807 `409 device_already_leased`. Tested by
   `__tests__/routes.spec.ts` (concurrent-lease test) + the partial-unique
   index migration ships with the same WHERE clause.

2. **WS upgrade requires owner match** — the `/ws/sessions/:id?token=`
   handler verifies the bearer token via `authService.validateKey()`, then
   asserts `session.ownerApiKeyId === apiKey.id`. Mismatch → close with
   1008 + `{type:'error', code:'unauthorized'}`. Implementation in
   `internal/ws.ts:authenticateAndAuthorize`; tested by
   `__tests__/ws.spec.ts`.

3. **Rate limit 30 actions / 10s sliding window per session** — every WS
   client message (except `pong` from the server) increments the bucket via
   `sessionsModule.rateLimiter.check(sessionId)`. Overflow returns
   `{type:'error', code:'rate_limited'}` and the socket STAYS OPEN
   (NOT close) so the client can back off and continue. Defaults from
   CONTEXT.md (LOCKED). Tested by `__tests__/auth-rate-sweeper.spec.ts`.

4. **Sweeper releases expired sessions within 30s of TTL** — the
   `session.sweep` schedule fires every 30s; the work fn updates any
   `active` session whose `leaseUntil < now()` to `status='expired'`,
   broadcasts `{type:'event', kind:'lease-expiring'}` on the open WS (if
   any), and emits `session.expired`. Tested by
   `__tests__/auth-rate-sweeper.spec.ts` (sweeper-timing test) and verified
   via Plan 34-04's smoke-test on the 30-second TTL lease.

5. **Resolver `confidence < 0.5` → `resolver_failed` error envelope** —
   the WS dispatch path (`internal/ws.ts`) calls
   `fastify.sessionsResolver.resolve(req)` for `tapByDescription` envelopes.
   When the result confidence is `< 0.5`, the handler returns
   `{type:'error', code:'resolver_failed', message: <backend>:<latencyMs>}`
   to the client. The `FallbackResolver` (when SESSION_RESOLVER=claude-vision)
   internally escalates Maestro → Claude before this gate. Tested by
   `__tests__/resolver-maestro.spec.ts` + `resolver-claude.spec.ts`.

6. **TLS-first WS scheme guard (force-upgrade non-loopback plaintext)** —
   the web client's `deriveWsScheme()` (Plan 34-07) defaults to `wss:` and
   force-upgrades plaintext `ws:` when the hostname is NOT a loopback
   literal (`localhost`/`127.0.0.1`/`[::1]`). Server-side, the
   `buildWsUrl()` helper in `internal/module.ts` is the single
   construction point; the production scheme upgrade lands in Phase 36+
   when the config schema gains `tls`/`publicHost` fields. RESEARCH §Open
   Q #8 + CWE-319 defense. Web-side enforcement tested by
   `web/src/lib/sessions/__tests__/sessions-detail.spec.ts`.

7. **No deep imports into `server/sessions/internal/`** —
   `dependency-cruiser` rule 11 (`no-deep-imports-into-sessions-internal`)
   blocks external imports structurally;
   `server/hooks/__tests__/dep-cruiser.spec.ts` MOD-02 sessions extension
   proves the rule fires on
   `__fixtures__/dep-cruiser/bad-sessions-deep-import.ts`.

## Non-Goals

- **Multi-session-per-device** (v3.1). One active session per device — the
  partial unique index makes this a hard server-side guarantee. Multi-tenant
  device sharing is a future-feature decision (collaborative driving,
  observer mode, etc.) that requires WS broadcast topology design.
- **OmniParser (third NL resolver backend)** — deferred. Phase 34 ships two
  resolvers (Maestro AI default + Claude Vision opt-in). OmniParser is a
  larger integration (model hosting + ONNX runtime) gated on real-world
  cost evidence from the Claude Vision opt-in.
- **Session replay/recording** — owned by Phase 35 (App Explorer + Atlas
  Graph). The recording surface lives in artifact storage; sessions emit
  the event trail but don't store frame-by-frame replay artifacts.
- **Live `/sessions` list updates via WS** — the list view is currently
  static at load time. Phase 36 (CommandPalette) ships a WS subscription
  to a session broadcast channel so leases/releases from other actors
  propagate to all viewers in real time.
- **Full iOS hierarchy walker for the NL resolver** — Plan 34-03 ships a
  best-effort hierarchy collector that resolves `simctl` UI dumps on a
  best-effort basis. Production-grade iOS resolver coverage lands in
  Phase 36 or 37 with the full WDA bridge integration.
- **persistEnvelope 11TH SAMPLE POINT consolidation** (DEFERRED-34-A —
  continues the DEFERRED-26-B chain). The 10-line `persistEnvelope`
  middleware in `internal/module.ts` is the 11th verbatim copy across
  module factories; Phase 27+ (API Aggregator) owns the tree-wide
  extraction to `server/bus/persist-envelope.ts`.
- **Per-session resolver cost cap** (DEFERRED-34-D). Cost ceiling per
  resolve is documented in `docs/runbooks/session-resolver-costs.md` but
  no per-session call cap is enforced at the resolver layer. Phase 37 may
  add this after 30-day production usage shows whether the cap is needed.

## Dependencies

Plugin name: `'sessions'` (verbatim — referenced by
`server/__tests__/plugin-order.spec.ts` Phase 34 additive block + any
downstream plugin that may declare `'sessions'` in its dependencies array
in future).

Plugin dependencies array (verbatim from `server/sessions/plugin.ts`):
7 entries.

```
['config', 'db', 'event-bus', 'queue', 'pool-plugin', 'auth', 'websocket-plugin']
```

- `config` — for `fastify.config.server.host/port` (server-authoritative
  `wsUrl` construction in `buildWsUrl()`).
- `db` — for sessions INSERT + UPDATE (Drizzle transactions) AND for the
  `persistEnvelope` middleware that writes `session.*` rows to the
  `events` table.
- `event-bus` — `createEventHelpers` + ALS-aware envelope stamping in
  `makeSessionsEmitters`.
- `queue` — pg-boss `boss.schedule()` + `boss.work()` for the
  `session.sweep` TTL sweeper.
- `pool-plugin` — `fastify.pool.allocate()` / `fastify.pool.release()` for
  device allocation, AND `fastify.poolModule.bus.on('device.health.failed',
  ...)` for the cross-module subscriber.
- `auth` — `fastify.authService.validateKey()` for the REST + WS auth
  preHandler chain. The lease handler also requires the requester to be
  Bearer-authenticated (the WS upgrade token is the same key).
- `websocket-plugin` — `@fastify/websocket`-backed upgrade route under
  `/ws/sessions/:id`. Streaming plugin registers `@fastify/websocket`
  first so this plugin only registers the route handler.

Module dependencies (consumed via fastify decorators in the factory):

- `fastify.db` — Drizzle queries + `persistEnvelope` writes.
- `fastify.pool` — device allocate / release for lease + cleanup.
- `fastify.authService` — bearer validation in WS handshake + REST
  preHandler chain.
- `fastify.boss` — pg-boss instance for the sweeper schedule.
- `fastify.log` — child logger named `'sessions'` (MOD-07).
- `fastify.config` — server host/port for wsUrl construction.

Cross-module consumers via barrel (MOD-02 compliant):

- `@device-stream/mcp` (npm workspace `mcp/`) — REST + WS consumer; runs
  out-of-process as an MCP stdio server (NOT a fastify decorator
  consumer). 12 tools + 1 resource exposed to Claude Code.
- `web/src/routes/sessions/` (SvelteKit) — REST + WS consumer via the
  typed `web/src/lib/sessions/client.ts` + `ws.ts` wrappers. NOT a
  fastify decorator consumer (web/ is a separate runtime).
- `cli/cmd/session*.go` (Go CLI) — REST + WS consumer via the
  `cli/internal/session/` Go client. NOT a fastify decorator consumer.

Plugin-order constraints (enforced by
`server/__tests__/plugin-order.spec.ts` Phase 34 additive block):

- `sessions` registers AFTER `auth`, `pool-plugin`, `event-bus`, `queue`,
  AND `websocket-plugin` (all in `dependencies`).
- `sessions` registers BEFORE `static-spa` (web UI served from the same
  Fastify instance must register the API surface first so /api/sessions
  isn't caught by the static catch-all).

## Runnable Example

```bash
# (1) Lease a device via curl, receive sessionId + wsUrl.
DF_TOKEN="df_xxxxx..."  # Bearer key with claims.admin OR a regular key.
LEASE=$(
  curl -s -X POST http://localhost:3000/api/sessions \
    -H "Authorization: Bearer ${DF_TOKEN}" \
    -H 'Content-Type: application/json' \
    -d '{"platform":"android","ttlSeconds":600}'
)
SESSION_ID=$(echo "$LEASE" | jq -r .sessionId)
WS_URL=$(echo "$LEASE" | jq -r .wsUrl)
echo "leased $SESSION_ID; ws=$WS_URL"
```

```bash
# (2) Send a tap via ws CLI (e.g. websocat); ack returns with forMsgId echo.
MSG_ID=$(uuidgen)
echo "{\"id\":\"$MSG_ID\",\"type\":\"tap\",\"x\":540,\"y\":960}" \
  | websocat -n1 "$WS_URL"
# -> {"type":"ack","forMsgId":"<MSG_ID>","durationMs":42}
```

```bash
# (3) Inspect the persisted audit trail — both session.leased and
#     session.released land in the events table with TRACE-10 actor.
psql "$DATABASE_URL" <<SQL
SELECT event_type,
       aggregate_id,
       actor,
       payload->>'deviceName'  AS device_name,
       payload->>'reason'      AS reason
FROM events
WHERE aggregate_type = 'session'
ORDER BY occurred_at DESC
LIMIT 5;
SQL
```

```typescript
// (4) Subscribe programmatically — module bus is exposed via fastify.sessionsModule.bus.
import type { FastifyInstance } from 'fastify';

export function watchSessionAudit(fastify: FastifyInstance): void {
  fastify.sessionsModule.bus.on('session.leased', (payload) => {
    fastify.log.info(
      { sessionId: payload.sessionId, deviceId: payload.deviceId, ownerActor: payload.ownerActor },
      'session leased',
    );
  });
  fastify.sessionsModule.bus.on('session.released', (payload) => {
    fastify.log.info(
      { sessionId: payload.sessionId, reason: payload.reason, releasedBy: payload.releasedBy },
      'session released',
    );
  });
}
```

References to RESEARCH pitfalls / open questions:
- §Open Q #1 — sweeper cron-30s preferred / 5-field + setInterval fallback (Invariant 4).
- §Open Q #6 — rate-limiter Map cleared on session expiry by sweeper.
- §Open Q #7 — ClaudeVisionResolver default model `claude-sonnet-4-5`.
- §Open Q #8 — TLS-first WS scheme guard (Invariant 6).
- Pitfall — partial unique index race protection (Invariant 1).
- Pitfall — bearer-via-query owner verification (Invariant 2).

See `.planning/phases/34-session-api-mcp/34-RESEARCH.md`.
