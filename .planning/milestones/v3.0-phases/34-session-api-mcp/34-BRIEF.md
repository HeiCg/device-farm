# Phase 34 — Interactive Session API + MCP Server

**Track:** DF (foundational)
**Effort:** ~10 days
**Source idea:** Revyl CLI pattern (`device lease`, `device tap --target`, `device screenshot`) + Anthropic MCP
**Depends on:** Phase 26 (auth module — already shipped)

## Goal

Move device-farm from "batch only" to "session-aware": a caller can lease a device, send interactive commands (tap/type/screenshot/swipe/key), and release. Expose those commands as a Claude Code-compatible MCP server. Make natural-language targeting (`tap on "Login button"`) a primitive so downstream tools (PR Review Bot, App Explorer, Figma Checker) become thin clients.

## Why

Today every device interaction requires submitting a Maestro flow as a job. That works for CI but blocks the entire "AI agent driving devices" use case. Revyl's whole product is built around a single `device tap --target "X"` primitive — once we expose the same, six downstream features collapse from 1 week each to 1-2 days each.

## Scope

### In
- `server/sessions/` Fastify plugin: lease/release REST + WS for actions.
- `sessions` table (id, device_id, owner, status, lease_expires_at, created_at, released_at).
- WS protocol with typed message envelopes (Zod-validated).
- Actions: `tap`, `tapByDescription`, `type`, `swipe`, `key`, `screenshot`, `screenRecord`, `installApp`, `uninstallApp`, `launchApp`.
- NL `target` resolver: pluggable interface, two backends shipped — `maestroAi` (delegates to Maestro CLI's AI selectors) and `claudeVision` (Anthropic Claude Sonnet 4.6 with vision).
- New `mcp/` workspace package `@device-stream/mcp` exposing the same actions as MCP tools.
- Server-side rate limit per session (anti-runaway agent) — 30 actions / 10s default.
- TTL with auto-release (e.g., 10 minutes idle → release).

### Out
- Multi-session-per-device (one session per device until v3.1)
- Cross-platform NL grounding model (OmniParser etc.) — defer
- Session replay/recording (Phase 35 uses sessions but recording lives there — see Phase 35)

## Architecture

```
+-----------------------------------------------------+
| Claude Code (or Cursor, Continue, ...)              |
|   stdio MCP <-> @device-stream/mcp                  |
+-----------------------------------+-----------------+
                                    |
                                    | HTTP/WS
                                    v
+-----------------------------------------------------+
| Fastify server                                      |
|   plugin: sessions                                  |
|     POST /api/sessions          (lease)             |
|     DELETE /api/sessions/:id    (release)           |
|     WS /api/sessions/:id        (actions)           |
|   plugin: sessions/resolver/                        |
|     MaestroAiResolver  ClaudeVisionResolver         |
+-----------------------------------+-----------------+
                                    |
                                    v
+-----------------------------------------------------+
| pool + device-stream                                |
|   tap/type/screenshot via existing services         |
+-----------------------------------------------------+
```

## Tasks

### T-34.1 — Schema + lease/release REST (~6h)

**Files**
- `server/db/schema.ts` — `sessions` table
- `server/sessions/index.ts` — plugin registration after `jobs`
- `server/sessions/lease.ts` — `POST /api/sessions`, `DELETE /api/sessions/:id`
- `server/sessions/__tests__/lease.test.ts`

```
sessions:
  id              uuid PK
  device_id       uuid FK -> devices
  owner_token     text NOT NULL    -- maps to auth principal
  status          enum('active','released','expired')
  lease_until     timestamptz NOT NULL
  ttl_seconds     int default 600
  created_at      timestamptz default now()
  released_at     timestamptz
  metadata        jsonb            -- client-supplied (e.g. "purpose":"pr-review")
```

`POST /api/sessions` body: `{platform, deviceQuery?, ttlSeconds?}` — allocates from pool using existing mutex-protected allocator, transitions device `Idle → Allocated`. Returns session id + WS URL.

`DELETE /api/sessions/:id` releases. Background sweeper (`server/sessions/sweeper.ts`) auto-releases past `lease_until`.

### T-34.2 — WS action protocol (~8h)

**Files**
- `server/sessions/ws.ts` — `WS /api/sessions/:id`
- `server/sessions/protocol.ts` — Zod schemas for all envelopes
- `server/sessions/__tests__/protocol.test.ts`

**Envelopes (client → server)**

```
{type:'tap', x:number, y:number}                          -- pixel coords (origin top-left)
{type:'tapByDescription', target:string}                  -- NL
{type:'type', text:string}
{type:'swipe', x1,y1,x2,y2, durationMs?}
{type:'key', code: 'home'|'back'|'enter'|'volup'|...}
{type:'screenshot'}
{type:'screenRecord', start:boolean}
{type:'installApp', artifactId:string}                    -- pre-uploaded APK/IPA
{type:'launchApp', bundleId:string}
{type:'uninstallApp', bundleId:string}
{type:'ping'}
```

**Envelopes (server → client)**

```
{type:'ack', forMsgId:string, durationMs:number}
{type:'screenshot', artifactId:string, url:string, width:number, height:number}
{type:'error', forMsgId?:string, code:string, message:string}
{type:'event', kind:'device-lost'|'lease-expiring'|'app-crashed', ...}
```

Every client message MUST include `id:string` (uuid v4); server echoes it in `ack`/`error`. Server enforces 30 actions / 10s sliding window (configurable per-session).

### T-34.3 — Action dispatch into device-stream / Maestro (~6h)

**Files**
- `server/sessions/actions.ts` — switch over msg.type → service call
- `server/sessions/dispatch-android.ts`
- `server/sessions/dispatch-ios.ts`

Reuse existing primitives:
- Tap/swipe/type: device-stream's android `sendTouch`/`sendKey`, iOS sim `bridge_send_touch` (Phase 32) or WDA touch for physical.
- Screenshot: existing `ScreenshotService.captureOnce(deviceId)` returns an artifact.
- App install: `adb install` / `simctl install` via current installer.
- App launch: `monkey -p ... 1` (Android) / `simctl launch` (iOS).

### T-34.4 — NL target resolver interface + Maestro AI backend (~6h)

**Files**
- `server/sessions/resolver/types.ts` — `interface TargetResolver { resolve(target, screenshot, hierarchy): Point }`
- `server/sessions/resolver/maestro-ai.ts`
- `server/sessions/resolver/__tests__/maestro-ai.test.ts`

**Flow**

```
resolveTapByDescription(target):
  shot = await screenshot(device)
  hier = await uiHierarchy(device)         // adb exec uiautomator dump / simctl ui
  point = await resolver.resolve(target, shot, hier)
  return point
```

Maestro CLI has an `--ai` mode that accepts natural-language step descriptions. We can call it once per `tapByDescription` to convert a description into coords (`maestro test --ai-prompt "tap on Login button"`). Slow (~3-8s) but free-of-additional-deps for v1.

### T-34.5 — Claude Vision backend (~6h)

**Files**
- `server/sessions/resolver/claude-vision.ts`
- `server/sessions/resolver/__tests__/claude-vision.test.ts`

Sends `{screenshot, hierarchy, target}` to Claude Sonnet 4.6 with vision; prompt:

```
You are a UI element locator. Given a mobile screenshot and a description,
return JSON {x: <0-1 normalized>, y: <0-1>, confidence: <0-1>}.
Coordinates are the center of the element. If not found, {x:null,y:null,confidence:0}.
```

Cache on `hash(screenshot)+target` (LRU 100). Surface `confidence < 0.5` as an error to caller.

**Cost note:** documented under `docs/runbooks/session-resolver-costs.md`. Heavy users opt in via `SESSION_RESOLVER=claude-vision`; default `maestro-ai`.

### T-34.6 — Auth + rate limit + sweeper (~3h)

**Files**
- `server/sessions/auth.ts` — reuse Phase 26's auth middleware; sessions inherit principal
- `server/sessions/rate-limit.ts` — sliding window 30/10s default
- `server/sessions/sweeper.ts` — `setInterval(checkExpired, 30s)`

Sessions only released by: explicit DELETE, sweeper, device error (transition to `Error` state), or server shutdown.

### T-34.7 — MCP server package (~6h)

**Files**
- `mcp/` (new npm workspace root)
- `mcp/package.json` — `@device-stream/mcp`, `bin: device-stream-mcp`
- `mcp/src/index.ts` — MCP stdio server using `@modelcontextprotocol/sdk`
- `mcp/src/tools/*.ts` — one file per tool
- `mcp/README.md`

**Tools exposed**

```
device_lease({platform, ttlSeconds?})    -> {sessionId, deviceId}
device_tap({sessionId, x, y})
device_tap_by_description({sessionId, target})
device_type({sessionId, text})
device_swipe({sessionId, x1,y1,x2,y2})
device_key({sessionId, code})
device_screenshot({sessionId})           -> {url, width, height}
device_install({sessionId, appArtifactId})
device_launch({sessionId, bundleId})
device_release({sessionId})
```

MCP server reads `DEVICE_FARM_URL` + `DEVICE_FARM_TOKEN` from env. Resource: `device-farm://devices` listing available devices for human-in-the-loop selection.

### T-34.8 — CLI wrapper (~3h)

**Files**
- `cli/cmd/session.go` — `device-farm session lease|tap|type|...` for shell use

```
device-farm session lease --platform android --ttl 600
# -> exports DEVICE_FARM_SESSION_ID
device-farm session tap --x 540 --y 960
device-farm session screenshot -o cur.png
device-farm session release
```

### T-34.9 — Web UI panel (~5h)

**Files**
- `web/src/routes/sessions/+page.svelte` — list active sessions
- `web/src/routes/sessions/[id]/+page.svelte` — live screen + click-to-tap overlay

Click anywhere on the live stream → POST tap. Type into a textarea + Enter → POST `type`. Designed primarily as a debug surface for ops/dev — not the main UX.

### T-34.10 — Docs + example agents (~3h)

**Files**
- `docs/runbooks/session-api.md`
- `docs/runbooks/mcp.md`
- `examples/agents/pr-bot.md` (skeleton for Phase 34)
- `examples/agents/exploration.md` (skeleton for Phase 35)

## Acceptance criteria

- [ ] `POST /api/sessions` returns 200 with a WS URL; `DELETE` releases.
- [ ] E2E: Python script leases an Android sim, taps, types text into a form, screenshots, releases — all without a Maestro flow file.
- [ ] Auto-release fires within 30s of TTL expiry.
- [ ] Rate limit kicks in on a stress test (verified by `429` envelope).
- [ ] `npx @device-stream/mcp` registered in `~/.claude.json` allows Claude Code to drive a device.
- [ ] `device-farm session tap` works in a fresh shell.
- [ ] All sessions visible at `/sessions`; clicking a stream sends a real tap.
- [ ] Concurrency: 4 sessions on 4 devices simultaneously — no cross-talk.

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Claude Vision cost spirals | Default to `maestro-ai`; cap per-session resolver calls; surface cost in dashboard |
| Long-lived WS sessions leak memory | Sweeper closes idle > TTL; heap-snapshot test in CI |
| Two callers race on the same device | Single-active-session-per-device constraint at DB level (`UNIQUE (device_id) WHERE status='active'`) |
| Untrusted MCP client owns a device | Tokens scoped per principal; admin can revoke; per-token quotas |

## References

- mobile-devtools README — overall pattern (`device tap --target NL`)
- Anthropic MCP TypeScript SDK
- Current code: `server/auth/`, `server/pool/`, `server/screenshot-service.ts`, `server/index.ts` plugin order

## Done = Nyquist-compliant

Lease/release contract tests, WS protocol fuzz test (random envelope mutations), resolver mock + real-emulator E2E, sweeper unit test, MCP package smoke test (spawn child process + JSON-RPC happy path), web UI E2E with Playwright.
