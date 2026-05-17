# Session API — Operator Runbook

**Phase 34 Plan 34-08.** Operational reference for the interactive
session lease/release REST + WS surface introduced in Phase 34.
For module-level architecture see `server/sessions/MODULE.md`.

## Overview

Session API moves device-farm from "batch-only" (submit a Maestro flow,
wait for completion) to "session-aware" (lease a device, drive it
interactively, release). The same primitives back the
`@device-stream/mcp` MCP server (`docs/runbooks/mcp.md`), the `device-farm
session` Cobra subcommands, and the `/sessions/[id]` SvelteKit panel.

Quickstart REST flow:

```bash
DF_TOKEN="df_xxxxx..."   # Bearer key minted via POST /api/admin/keys

# 1. Lease an Android emulator for 10 minutes (default ttl=600).
LEASE=$(curl -s -X POST http://localhost:3000/api/sessions \
  -H "Authorization: Bearer ${DF_TOKEN}" \
  -H 'Content-Type: application/json' \
  -d '{"platform":"android","ttlSeconds":600}')

SESSION_ID=$(echo "${LEASE}" | jq -r .sessionId)
WS_URL=$(echo "${LEASE}" | jq -r .wsUrl)
echo "leased ${SESSION_ID}; ws=${WS_URL}"

# 2. (interact via WS — see "WebSocket envelope contract" below) ...

# 3. Release.
curl -s -X DELETE "http://localhost:3000/api/sessions/${SESSION_ID}" \
  -H "Authorization: Bearer ${DF_TOKEN}"
```

## REST surface

| Method | Path                          | Body / Params                         | Notes                                                           |
| ------ | ----------------------------- | ------------------------------------- | --------------------------------------------------------------- |
| POST   | `/api/sessions`               | `{platform, ttlSeconds?, deviceQuery?, metadata?}` | Lease — returns `{sessionId, deviceId, wsUrl, ttlSeconds, leaseUntil}`. |
| DELETE | `/api/sessions/:id`           | path: `id` (uuid)                     | Release — owner OR admin claim required.                        |
| GET    | `/api/sessions`               | query: `status=active|released|expired` | List + filter; left-joins device name.                          |

All routes Bearer-authenticated via the auth plugin. RFC 7807
`application/problem+json` on error (`code` field carries the machine-
readable type).

Common error envelopes:

| Code                       | HTTP | Cause                                                                |
| -------------------------- | ---- | -------------------------------------------------------------------- |
| `no_device_available`      | 503  | Pool has no idle device of the requested platform.                  |
| `device_already_leased`    | 409  | Concurrent lease won the device (partial unique index race).        |
| `session_not_found`        | 404  | DELETE called on a non-active session id.                            |
| `forbidden`                | 403  | Requester is neither the session owner nor an admin claim holder.    |
| `unauthorized`             | 401  | Missing / invalid Bearer key.                                        |

## WebSocket envelope contract

WS URL is server-authoritative (returned in the lease response). Token is
passed as a query parameter (`?token=`) because the browser `WebSocket`
constructor cannot set headers.

Path: `/ws/sessions/:id?token=<bearer>`

Client → server envelopes — every message MUST carry `id: uuid` so the
server can echo it in the ack/error:

```json
{"id":"<uuid>", "type":"tap", "x":540, "y":960}
{"id":"<uuid>", "type":"tapByDescription", "target":"Sign In button"}
{"id":"<uuid>", "type":"type", "text":"hello@example.com"}
{"id":"<uuid>", "type":"swipe", "x1":540, "y1":1800, "x2":540, "y2":600, "durationMs":500}
{"id":"<uuid>", "type":"key", "code":"back"}    // home|back|enter|volup|voldown|power|menu|recent
{"id":"<uuid>", "type":"screenshot"}            // → ack with {artifactId, url, width, height}
{"id":"<uuid>", "type":"screenRecord", "start":true|false}
{"id":"<uuid>", "type":"installApp", "artifactId":"<uuid>"}
{"id":"<uuid>", "type":"launchApp", "bundleId":"com.example.app"}
{"id":"<uuid>", "type":"uninstallApp", "bundleId":"com.example.app"}
{"id":"<uuid>", "type":"ping"}                   // → pong
```

Server → client envelopes — 4 variants:

```json
{"type":"ack",   "forMsgId":"<client uuid>", "durationMs":42, "result":{...?}}
{"type":"error", "forMsgId":"<client uuid>?", "code":"rate_limited", "message":"..."}
{"type":"event", "kind":"device-lost|lease-expiring|app-crashed|session-released|connected", "data":{...?}}
{"type":"pong",  "forMsgId":"<client uuid>"}
```

Error codes: `rate_limited`, `invalid_envelope`, `session_expired`,
`session_not_found`, `resolver_failed`, `device_error`, `unauthorized`,
`invalid_state`.

## TLS-first WS scheme guard

**Production deployments MUST terminate TLS in front of the server.** The
web client (`web/src/lib/sessions/ws.ts:deriveWsScheme`) defaults to
`wss:` and force-upgrades plaintext `ws:` when the hostname is NOT a
loopback literal (`localhost` / `127.0.0.1` / `[::1]`). This is a
CWE-319 defense — Bearer tokens travel in the `?token=` query parameter,
so plaintext WS would expose credentials on the wire.

Loopback exception exists for local development only. RESEARCH §Open Q #8
documents the migration plan for adding a `config.server.tls` + `publicHost`
field to fully wire the server-side `buildWsUrl()` (Phase 36+).

Operator implication: if your reverse proxy terminates TLS, configure the
upstream `wss://` URL in the web app's environment and ensure the server's
`config.server.host` reflects the public hostname (not `0.0.0.0`).

## Rate limit

30 actions per 10-second sliding window per session, defaults from
CONTEXT.md (LOCKED). Overflow returns:

```json
{"type":"error","forMsgId":"<msg uuid>","code":"rate_limited","message":"30 actions per 10s window exceeded"}
```

The socket STAYS OPEN on rate-limit overflow (the client should back off
+ retry, not reconnect). Agents that hit the limit consistently should
batch actions via a Maestro flow instead of streaming individual taps.

The rate limiter is a per-session `Map<sessionId, timestamps[]>` cleared
on session expiry by the sweeper. RESEARCH §Open Q #6 mitigation.

To temporarily raise the limit in development, edit
`server/sessions/internal/rate-limit.ts` constants — there is no env knob
in Phase 34 (DEFERRED — Phase 37 may add a configurable per-session
ceiling).

## Sweeper

Background TTL sweeper releases sessions whose `leaseUntil` has elapsed.
Strategy is selected at server boot:

- **Preferred:** 6-field pg-boss cron `'*/30 * * * * *'` (every 30s).
- **Fallback:** 5-field cron `'* * * * *'` (every minute) + Node
  `setInterval(30_000)` for sub-minute granularity. RESEARCH §Open Q #1
  — fallback exists because pg-boss minor releases ship different
  upstream cron parsers; the 6-field grammar is not universally accepted.

Chosen strategy is logged at startup:

```
Sessions sweeper registered { strategy: 'cron-30s' | 'cron-1m+interval' }
```

The sweeper's work fn updates only rows where
`status='active' AND leaseUntil < now()`, broadcasts `lease-expiring` on
any open WS, emits `session.expired` (persisted), and clears the rate-
limiter bucket. Auto-release fires within 30 seconds of TTL expiry.

## Troubleshooting

| Symptom                                                  | Likely cause                                                                                                | Resolution                                                                                                                                                                                              |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `503 no_device_available`                                | Pool has no idle device of the requested platform.                                                          | `GET /api/devices` to inspect pool state. Boot more emulators (server lifecycle plugin) or release a stale session (`GET /api/sessions?status=active` → `DELETE`).                                       |
| `409 device_already_leased`                              | Concurrent lease lost the partial-unique-index race.                                                         | Retry — the winning session will release eventually. If persistent, inspect for stuck `status='active'` rows: `SELECT id, lease_until FROM sessions WHERE status='active' AND lease_until < now()`.       |
| `404 session_not_found` on DELETE                        | Session already released (explicit, sweeper, or device-lost).                                                | Re-lease.                                                                                                                                                                                               |
| `401 unauthorized` on WS upgrade                         | Missing or wrong `?token=` query param; key revoked; or token belongs to different owner.                    | Mint a fresh key (POST `/api/admin/keys`). Owner-mismatch case requires the original lease holder OR an admin claim.                                                                                    |
| `{type:'error', code:'resolver_failed'}` on `tapByDescription` | Default Maestro AI heuristic confidence < 0.5 (no matching XML element).                                    | Opt into Claude Vision fallback: set `SESSION_RESOLVER=claude-vision` + `ANTHROPIC_API_KEY=...` in server env. Restart server. Cost ceiling: see `docs/runbooks/session-resolver-costs.md`.                |
| `{type:'event', kind:'device-lost'}` mid-session         | Pool health check failed (emulator crash, ADB disconnect).                                                  | Server auto-releases the session + closes the WS. Re-lease — the pool will allocate a fresh device.                                                                                                     |
| Sweeper not running (sessions persist past TTL)          | pg-boss boot failed silently OR cron rejected.                                                              | Check server logs for `Sessions sweeper registered { strategy: ... }`. If absent, inspect `boss.schedule()` error from pg-boss; the fallback strategy should engage automatically.                       |
| Rate limit fires too aggressively                        | Agent flooding actions in <10s burst (e.g. screenshot loop).                                                 | Reduce action rate OR batch into a Maestro flow (`device-farm run` instead of session API).                                                                                                             |

## Verifying a lease end-to-end

```bash
# Smoke test: lease → screenshot → release.
LEASE=$(curl -s -X POST http://localhost:3000/api/sessions \
  -H "Authorization: Bearer ${DF_TOKEN}" \
  -H 'Content-Type: application/json' \
  -d '{"platform":"android","ttlSeconds":120}')

SESSION_ID=$(echo "${LEASE}" | jq -r .sessionId)
WS_URL=$(echo "${LEASE}" | jq -r .wsUrl)

# Send a screenshot envelope; receive an ack with the artifact URL.
MSG_ID=$(uuidgen)
echo "{\"id\":\"$MSG_ID\",\"type\":\"screenshot\"}" \
  | websocat -n1 "${WS_URL}"

curl -s -X DELETE "http://localhost:3000/api/sessions/${SESSION_ID}" \
  -H "Authorization: Bearer ${DF_TOKEN}"
```

See `docs/runbooks/mcp.md` for the agent-driven equivalent via Claude
Code, and `docs/runbooks/session-resolver-costs.md` for cost guidance on
the natural-language resolver chain.
