# Phase 34: Session API + MCP Server — Research

**Researched:** 2026-05-15
**Domain:** Interactive device sessions over Fastify REST/WS + Anthropic MCP stdio bridge
**Confidence:** HIGH

## Summary

Phase 34 turns device-farm from a batch-only job submitter into a session-aware platform: a caller leases a device, sends real-time actions over WS (tap / type / swipe / key / screenshot / install / launch), and releases. The same surface is mirrored as MCP tools so Claude Code can drive a device directly.

The mechanical work is small because every primitive already exists in the codebase: `@device-stream/android`'s `AndroidDeviceService` provides `tap/typeText/pressKey/screenshot/swipe/longPress/launchApp` (verified at `node_modules/@device-stream/android/dist/device-service.d.ts:17-50`); `server/jobs/job-executor.ts:97` exposes `installApk(deviceId, apkPath)`; `server/artifacts/screenshot-service.ts` provides `captureOnce`; `server/pool` already owns mutex-protected device allocation; `server/maestro/internal/hierarchy-service.ts` already supports the four hierarchy sources we need for NL grounding. The session module is therefore a thin orchestrator with a Zod-validated WS protocol on top of these primitives — NOT a re-implementation.

The reference repos `revyl-cli` and `kittyfarm/LocalControl/` give us a complete, battle-tested action surface and MCP tool catalog to copy idea-for-idea. revyl's `WorkerRequestForSession(ctx, idx, path, body)` (`internal/mcp/device_session.go:1639`) is a clean blueprint for our action dispatcher, and kittyfarm's `LocalControlMCPHandler` (`LocalControlMCPHandler.swift:94-165`) gives the exact tool-to-store-method mapping pattern we copy into TypeScript.

**Primary recommendation:** Build `server/sessions/` strictly along Phase 26 Auth + Phase 22 Streaming patterns (factory + events.ts + MODULE.md + index.ts barrel + thin plugin). Use `requireAuth` chain from `server/auth/index.ts:30` verbatim. WS protocol is pure Zod discriminated union with per-message `id` echo. MCP package is a brand-new `mcp/` npm workspace (NOT bundled in the CLI) that wraps the same Zod schemas through `@modelcontextprotocol/sdk` and shells HTTP/WS to the device-farm server. ClaudeVisionResolver uses `@anthropic-ai/sdk` against Sonnet 4.5 with base64 image content blocks; it is gated behind `SESSION_RESOLVER=claude-vision` (default `maestro-ai`) and LRU-cached on `sha256(screenshot)+target`. TTL sweeper rides on the existing pg-boss with `boss.schedule('session.sweep', '*/30 * * * * *', ...)` (sub-minute cron supported by pg-boss v12).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**External Dependencies Policy (LOCKED).** Reference repos are STUDY-ONLY. revyl-cli, mobile-devtools, kittyfarm at `/Users/heicg/Desktop/projects/_reference/` are read-only references — copy ideas/algorithms/pseudocode/API shapes into `device-stream/`/`device-farm/server`/`device-farm/cli`/`device-farm/web`, never link or `npm install`/`go get` them. Normal libs (Anthropic SDK, MCP SDK, fastify, zod) remain fine.

**Authoritative Sources (LOCKED).**
- `34-BRIEF.md` — task list, architecture, action surface, Zod envelopes
- `_reference/revyl-cli/` — CLI session UX pattern (`device lease`, `device tap --target`)
- `_reference/mobile-devtools/README.md` — session API design
- `_reference/kittyfarm/KittyFarm/LocalControl/` — MCP server reference
- Phase 26 auth — sessions inherit principal via ALS

**Architecture.**
- New plugin `server/sessions/` with module-pattern: `events.ts`, `MODULE.md`, `index.ts` barrel, factory `createSessionsModule(deps)`
- DB table `sessions(id, device_id, owner, status, lease_expires_at, created_at, released_at)`
- REST: `POST /api/sessions` lease | `DELETE /api/sessions/:id` release
- WS: `/api/sessions/:id` with Zod-validated action envelopes; `id`-echoed ack/error
- Rate limit: 30 actions / 10s per session
- TTL: 10 min idle → auto-release via pg-boss scheduled job
- Resolver: `MaestroAiResolver` (default) + `ClaudeVisionResolver` (opt-in env `DEVICE_FARM_CLAUDE_VISION=1`)
- MCP package as new monorepo workspace `mcp/` shipped via npm as `@device-stream/mcp` (stdio transport)

**Tasks (from brief).**
- T-34.1 schema + lease/release REST; T-34.2 WS action protocol; T-34.3 action dispatch; T-34.4 Maestro AI resolver; T-34.5 Claude Vision resolver; T-34.6 auth + rate limit + sweeper; T-34.7 `@device-stream/mcp` package; T-34.8 CLI wrapper; T-34.9 web UI `/sessions/[id]`; T-34.10 docs + examples.

### Claude's Discretion

- Drizzle migration filename numbering (existing sequence)
- Exact MCP tool names — match Anthropic naming conventions
- WS reconnect/resume semantics
- ClaudeVisionResolver caching strategy

### Deferred Ideas (OUT OF SCOPE)

- Multi-session-per-device (v3.1)
- OmniParser as 3rd NL resolver backend
- Session replay/recording (lives in Phase 35)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SESS-LEASE | `POST /api/sessions` allocates device via pool mutex, inserts `sessions` row, returns `{sessionId, deviceId, wsUrl, leaseUntil}`; `DELETE /api/sessions/:id` transitions device back through pool release. | §Schema, §REST Surface |
| SESS-WS | `WS /api/sessions/:id` accepts Zod-validated action envelopes, echoes `id` in ack/error, fans events back as `{type:'event', kind, ...}`. | §WS Protocol |
| SESS-DISPATCH | Action envelopes route through `actions.ts` switch → existing primitives in `@device-stream/android`, `server/jobs/job-executor.ts:installApk`, `xcrun simctl`, `server/artifacts/screenshot-service.ts`. | §Action Dispatch |
| SESS-NL-MAESTRO | `MaestroAiResolver` shells `maestro --ai-prompt` once per `tapByDescription`, parses normalized coords from output. Default resolver. | §NL Resolvers |
| SESS-NL-CLAUDE | `ClaudeVisionResolver` calls Anthropic Messages API with screenshot base64 + hierarchy XML + prompt; returns `{x, y, confidence}`; opt-in via `SESSION_RESOLVER=claude-vision`. | §NL Resolvers |
| SESS-AUTH | Lease/release routes chain `requireAuth` from `server/auth/index.ts`; WS handshake reads `?token=` query param like Phase 22 streaming. Principal stamped into ALS via existing bearer-auth callback (Phase 26 entry point #4). | §Auth + Rate-limit + Sweeper |
| SESS-MCP | `mcp/` workspace ships `@device-stream/mcp` npm package with `bin: device-stream-mcp`. Uses `@modelcontextprotocol/sdk` `McpServer.registerTool` + `StdioServerTransport`. Tool surface mirrors action envelopes. | §MCP Package |
| SESS-CLI | `device-farm session [lease|tap|type|swipe|key|screenshot|release]` Cobra subcommands; `~/.device-farm/session.json` persists `sessionId+wsUrl+token` between shell invocations. | §CLI Wrapper |
| SESS-WEB | `/sessions/+page.svelte` lists active sessions; `/sessions/[id]/+page.svelte` shows live preview + click-to-tap overlay + action history feed. | §Web UI |
| SESS-DOCS | `docs/runbooks/session-api.md`, `docs/runbooks/mcp.md`, `docs/runbooks/session-resolver-costs.md`, `examples/agents/pr-bot.md`, `examples/agents/exploration.md`. | §Docs |
</phase_requirements>

## Reference Walkthrough

### revyl-cli — session CLI pattern (copy idea-for-idea)

revyl's CLI proves the exact UX we want. Cite-by-cite map:

- **`cmd/revyl/device.go:485-498`** — top-level `device` command with `start/tap/type/screenshot` subcommands. Long description doubles as in-CLI docs. **Copy:** create `cli/cmd/session.go` with sibling structure (`device-farm session [lease/tap/type/swipe/key/screenshot/release]`).
- **`cmd/revyl/device.go:501-702`** — `device start` builds `mcppkg.StartSessionOptions{Platform, AppID, BuildVersionID, AppURL, AppLink, LaunchVars, IdleTimeout}` then `mgr.StartSession(ctx, startOpts)`. **Copy:** lease body shape `{platform, deviceQuery?, ttlSeconds?, metadata?}` — drop the artifact resolution (we already have multipart upload via jobs route; phase 34 leasing is platform-only).
- **`cmd/revyl/device.go:25-58`** — `getDeviceSessionMgr` builds an authenticated client + working dir for session persistence; `LoadPersistedSession()` reads the on-disk cache so shells can `lease` once then `tap` in a new shell. **Copy verbatim:** persist `{sessionId, wsUrl, token}` to `~/.device-farm/session.json`; subsequent commands read it via `$DEVICE_FARM_SESSION_ID` env override (matches brief T-34.8).
- **`cmd/revyl/device.go:64-76`** — `resolveSessionFlag(cmd, mgr)` reads `-s` flag, falls back to active session, returns `(*DeviceSession, error)`. **Copy:** `--session-id` flag with `$DEVICE_FARM_SESSION_ID` env fallback.
- **`cmd/revyl/device.go:818-878`** — `device tap` resolves `--target` (NL) OR `--x/--y` (coords); on `--target` it shells one HTTP call `WorkerRequestForSession(idx, "/tap_target", {target, session_id})`. **Insight:** revyl's worker exposes BOTH `/tap` (coords) and `/tap_target` (NL); for us, the WS envelope has BOTH `{type:'tap', x, y}` and `{type:'tapByDescription', target}` discriminated by message type — same idea, simpler shape.
- **`cmd/revyl/device.go:948-985`** — `device type` body: `{x, y, text, clear_first}`. **Copy partially:** our `{type:'type', text}` doesn't require coords because Android `inputText` types into focused field; iOS WDA similarly. The `--target` "tap before type" flow stays a 2-action sequence on the agent side (`tapByDescription` then `type`); don't bundle them.
- **`cmd/revyl/device.go:987-1033`** — `device swipe direction|--start-x/--end-x` — supports named directions (`up/down/left/right`) AND raw coords. **Recommendation:** WS envelope keeps coord-only `{type:'swipe', x1,y1,x2,y2, durationMs?}`; named-direction expansion happens in the CLI/MCP layer (compute from screen dimensions).
- **`internal/mcp/device_session.go:1639-1716`** — `WorkerRequestForSession(ctx, index, path, body)` is the canonical "send action to session" entry point. Single function, switches on path. **Copy:** `server/sessions/actions.ts` is the same idea — switch on `envelope.type`, dispatch to driver.
- **`internal/mcp/device_session.go:1921-2079`** — `ResolveTarget`/`ResolveTargetForSession` two-path resolution: try worker-local first (`resolveTargetViaWorkerForSession`), fall back to backend grounding (`resolveTargetViaBackendForSession`). **Insight for us:** `MaestroAiResolver` is the equivalent of "worker-local" (cheap, free, slow); `ClaudeVisionResolver` is the equivalent of "backend grounding" (expensive, fast, accurate). Use the same fallback pattern — try Maestro AI first; only escalate to Claude Vision on `confidence < 0.5` (the brief inverts this by default; we offer both modes via env var).

### kittyfarm — MCP handler pattern (copy idea-for-idea)

kittyfarm's `LocalControl/` ships a complete, working MCP server in 600 LoC. It is HTTP-transport (not stdio), but the JSON-RPC handler / tool catalog / schema declaration patterns map cleanly to a stdio TS implementation.

- **`LocalControlMCPHandler.swift:11-92`** — single `handle()` dispatcher: parses JSON-RPC, switches on `method`. Handles `initialize`/`ping`/`tools/list`/`resources/list`/`prompts/list`/`tools/call` + 12 notifications. **Note:** `@modelcontextprotocol/sdk` ships ALL of this glue automatically (`McpServer` handles handshake, capabilities, errors). We only register tools — no manual JSON-RPC parsing.
- **`LocalControlMCPHandler.swift:94-165`** — `callTool(name, arguments, store)` is the canonical "tool-name to backing-method" switch. Each tool decodes its arguments into a strongly-typed request, then calls the store method. **Copy verbatim:** `mcp/src/tools/*.ts` — one file per tool, each registering a Zod input schema + handler that POSTs to device-farm server. Use `registerTool` per official MCP SDK pattern (see §MCP Package).
- **`LocalControlMCPHandler.swift:251-279`** — declarative `tools: [[String: Any]]` static catalog with name + title + description + inputSchema. **Copy verbatim:** define each tool's Zod input schema in one place; `inputSchema` JSON Schema flows automatically via Zod-to-JSON-Schema in the MCP SDK.
- **`LocalControlMCPHandler.swift:185-207`** — `imageResult(LocalControlScreenshotResponse)` returns MCP `content: [{type:'image', data:base64, mimeType}, {type:'text', text:metadata}]`. **Copy:** our `device_screenshot` tool returns the same shape — base64 PNG inline so Claude Code can show it without extra fetch.
- **`LocalControlMCPHandler.swift:299-555`** — schema helpers (`deviceSchema`, `tapSchema`, etc.) — duplicate this pattern in `mcp/src/schemas.ts` (Zod versions).
- **`LocalControlServer.swift:120-198`** — HTTP routing layer (`/mcp` for MCP, REST routes for the actual control surface). We DON'T copy this — `device-farm` server already exposes REST; the MCP server is a thin RPC bridge that just forwards.
- **`MCPConfigurationInstaller.swift:52-126`** — registers MCP in client configs (`.claude.json`, `.codex/config.toml`, etc.). **Copy partially:** `docs/runbooks/mcp.md` documents the one-line `claude mcp add device-stream npx @device-stream/mcp` command. We do NOT ship an installer GUI (that's kittyfarm's product surface, not ours).
- **`LocalControlFrameEncoder.swift`** — pure PNG-encoding wrapper. Not relevant; our screenshots already arrive as PNG buffers from `ScreenshotService.captureOnce`.

### mobile-devtools — overall product pattern

`mobile-devtools/README.md:183-201` explicitly documents the design contract Phase 34 implements: "every device interaction is one shell command, naturally-language targeted, screenshot-evidenced, AI-orchestrated". Six downstream tools (PR Review Bot, Visual Regression, Figma Design Checker, etc.) collapse to thin clients of this primitive. **No code copied** — this is the "why" for the phase, not a "how".

## Schema

### `sessions` table (Drizzle migration `0009_sessions.sql`)

```typescript
// server/db/schema.ts append
export const sessionStatusEnum = pgEnum('session_status', [
  'active',
  'released',
  'expired',
]);

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  deviceId: uuid('device_id').notNull().references(() => devices.id),
  ownerApiKeyId: uuid('owner_api_key_id').references(() => apiKeys.id),
  // Actor literal from auth/internal/actor.ts: apikey:<id> | user:<id> | system | cron.
  // Mirrors events.actor; nullable when auth.enabled=false (development mode).
  ownerActor: varchar('owner_actor', { length: 255 }),
  status: sessionStatusEnum('status').notNull().default('active'),
  ttlSeconds: integer('ttl_seconds').notNull().default(600),
  leaseUntil: timestamp('lease_until', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  releasedAt: timestamp('released_at', { withTimezone: true }),
  metadata: jsonb('metadata'),  // client-supplied {purpose, agentId, ...}
}, (table) => [
  // ONE active session per device — DB-layer race protection.
  // Matches brief §Risks: "Two callers race on the same device → UNIQUE (device_id) WHERE status='active'".
  uniqueIndex('sessions_device_active_idx')
    .on(table.deviceId)
    .where(sql`${table.status} = 'active'`),
  index('sessions_lease_until_idx').on(table.leaseUntil),
  index('sessions_status_idx').on(table.status),
  index('sessions_owner_idx').on(table.ownerApiKeyId),
]);
```

**Notes:**
- `ownerApiKeyId` FK gives an audit trail without re-storing the bearer hash.
- `ownerActor` mirrors `events.actor` literal so we can persist + query session events by the same string the auth module already stamps via ALS (Phase 26 TRACE-10).
- **Partial unique index** `WHERE status = 'active'` enforces single-active-session-per-device at the DB layer (out-of-scope deferred says multi-session-per-device is v3.1; partial unique index is the cheapest way to enforce that now and lift later).
- `lease_until` indexed so sweeper `WHERE lease_until < now() AND status = 'active'` is a cheap scan.
- `metadata` is `jsonb` (no default — per Phase 15 RESEARCH pitfall on drizzle-kit JSONB defaults; existing `events` and `jobs.metadata` follow the same rule).

### Sessions Drizzle migration

```
server/db/migrations/0009_sessions.sql
```

Generate via `npx drizzle-kit generate`; do NOT hand-edit (CLI-02 invariant — `make types` regenerates and fails if diff uncommitted).

## REST Surface

### POST `/api/sessions` (lease)

```typescript
// server/sessions/internal/routes.ts
const leaseRequestSchema = z.object({
  platform: z.enum(['android', 'ios']),
  deviceQuery: z.object({
    deviceId: z.string().uuid().optional(),
    name: z.string().optional(),
  }).optional(),
  ttlSeconds: z.number().int().min(60).max(3600).default(600),
  metadata: z.record(z.string(), z.unknown()).optional(),
}).meta({ id: 'SessionLeaseRequest' });

const leaseResponseSchema = z.object({
  sessionId: z.string().uuid(),
  deviceId: z.string().uuid(),
  deviceName: z.string(),
  platform: z.enum(['android', 'ios']),
  wsUrl: z.string().url(),
  leaseUntil: z.string().datetime(),
  ttlSeconds: z.number().int(),
}).meta({ id: 'SessionLeaseResponse' });
```

**Semantics:**
1. `requireAuth` preHandler (copied from `server/jobs/internal/routes.ts:87-104`) validates Bearer token, stamps `apikey:<id>` into ALS.
2. Pool allocator (`fastify.pool.allocateDevice(platform, query)`) returns idle device under existing mutex, transitions `Idle → Allocated` (existing state machine).
3. INSERT into `sessions` with `leaseUntil = now() + ttlSeconds`. The partial unique index throws on race; we surface it as RFC 7807 409 `device_already_leased`.
4. Emit `session.leased` (persisted).
5. Return `{wsUrl: 'wss://host/ws/sessions/<id>?token=<bearer>'}` — token in query because @fastify/websocket cannot read Authorization header on upgrade (same constraint that streaming plugin handles in `server/streaming/plugin.ts:79-85`). Scheme MUST be `wss://` whenever the server terminates TLS (any non-loopback deployment); local development behind `127.0.0.1` may downgrade to plaintext, but the canonical example assumes a TLS-terminated server.

### DELETE `/api/sessions/:id` (release)

```typescript
const releaseParamsSchema = z.object({
  id: z.string().uuid(),
});

const releaseResponseSchema = z.object({
  sessionId: z.string().uuid(),
  released: z.literal(true),
  releasedAt: z.string().datetime(),
}).meta({ id: 'SessionReleaseResponse' });
```

**Semantics:**
1. `requireAuth`. **Authorization check:** the session row's `ownerApiKeyId` must match `request.apiKey.id` (admins can release any via `requireAdmin` chain — out of scope for v1 but design admits it).
2. Close any open WS for this session (broadcast `{type:'event', kind:'session-released', reason:'explicit'}` first, then 1000-close).
3. Pool release (`fastify.pool.releaseDevice(deviceId)`) — transitions `Allocated → Cleanup → Idle`.
4. UPDATE sessions SET status='released', releasedAt=now().
5. Emit `session.released` (persisted).

### GET `/api/sessions` (list)

```typescript
const listResponseSchema = z.object({
  sessions: z.array(z.object({
    sessionId: z.string().uuid(),
    deviceId: z.string().uuid(),
    deviceName: z.string(),
    platform: z.enum(['android', 'ios']),
    status: z.enum(['active', 'released', 'expired']),
    leaseUntil: z.string().datetime(),
    createdAt: z.string().datetime(),
    ownerActor: z.string().nullable(),
    metadata: z.record(z.string(), z.unknown()).nullable(),
  })),
});
```

Filter by status (default `active`). Web UI consumes this for `/sessions/+page.svelte`.

## WS Protocol

### Connection

`GET /ws/sessions/:id?token=<bearer>` over TLS (`wss://` in production; matches streaming plugin's auth shape verbatim — `server/streaming/plugin.ts:79-85`). On accept:
1. Validate session row `status='active'` AND `leaseUntil > now()` AND `ownerApiKeyId = request.apiKey.id`.
2. Decorate socket with `{sessionId, deviceId, platform, actor}` for ALS restore on every message.
3. Emit `{type:'event', kind:'connected', heartbeatIntervalMs:30000}`.

### Envelope schemas (Zod discriminated union)

```typescript
// server/sessions/protocol.ts
const baseEnvelope = z.object({
  id: z.string().uuid(),  // client-generated; server echoes
});

export const clientEnvelope = z.discriminatedUnion('type', [
  baseEnvelope.extend({ type: z.literal('tap'),
    x: z.number().int().nonnegative(),
    y: z.number().int().nonnegative(),
  }),
  baseEnvelope.extend({ type: z.literal('tapByDescription'),
    target: z.string().min(1).max(500),
  }),
  baseEnvelope.extend({ type: z.literal('type'),
    text: z.string().max(4096),
  }),
  baseEnvelope.extend({ type: z.literal('swipe'),
    x1: z.number().int().nonnegative(),
    y1: z.number().int().nonnegative(),
    x2: z.number().int().nonnegative(),
    y2: z.number().int().nonnegative(),
    durationMs: z.number().int().min(50).max(5000).default(500),
  }),
  baseEnvelope.extend({ type: z.literal('key'),
    code: z.enum(['home', 'back', 'enter', 'volup', 'voldown', 'power', 'menu', 'recent']),
  }),
  baseEnvelope.extend({ type: z.literal('screenshot') }),
  baseEnvelope.extend({ type: z.literal('screenRecord'),
    start: z.boolean(),
  }),
  baseEnvelope.extend({ type: z.literal('installApp'),
    artifactId: z.string().uuid(),  // pre-uploaded APK/IPA artifact
  }),
  baseEnvelope.extend({ type: z.literal('launchApp'),
    bundleId: z.string().min(1),
  }),
  baseEnvelope.extend({ type: z.literal('uninstallApp'),
    bundleId: z.string().min(1),
  }),
  baseEnvelope.extend({ type: z.literal('ping') }),
]);

export const serverEnvelope = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ack'),
    forMsgId: z.string().uuid(),
    durationMs: z.number().int().nonnegative(),
    result: z.unknown().optional(),  // e.g. screenshot returns {artifactId, url, width, height}
  }),
  z.object({ type: z.literal('error'),
    forMsgId: z.string().uuid().optional(),  // optional — server-initiated errors lack it
    code: z.enum([
      'rate_limited', 'invalid_envelope', 'session_expired', 'session_not_found',
      'resolver_failed', 'device_error', 'unauthorized', 'invalid_state',
    ]),
    message: z.string(),
  }),
  z.object({ type: z.literal('event'),
    kind: z.enum(['connected', 'device-lost', 'lease-expiring', 'app-crashed', 'session-released']),
    data: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({ type: z.literal('pong'),
    forMsgId: z.string().uuid(),
  }),
]);
```

**Invariants:**
- Every client message MUST include `id` (uuid). Server `ack`/`error` echoes it as `forMsgId`.
- Server-initiated `{type:'event', kind:...}` is unsolicited; no `forMsgId`.
- `result` on `ack` is action-specific (only `screenshot` populates it today; reserved for future expansion).
- Unknown envelope types → 1003-close with `{type:'error', code:'invalid_envelope'}` before close.
- Malformed JSON → drop frame, log structured warning (matches Phase 22 / WEB-03 spirit).

### WS subscriber lifecycle (mirrors `server/streaming/plugin.ts:73-134`)

```
on('upgrade')   → validate token + session row, decorate
on('message')   → parseFrame() → safeParse(clientEnvelope) → rateLimit() → dispatch() → sendAck/Error
on('pong')      → markAlive
setInterval(30s) → if !alive: terminate; else ping
on('close')     → unsubscribe rate-limit window, no DB write (release is explicit DELETE)
```

**Heartbeat pattern is copied verbatim from streaming plugin** (HEARTBEAT_INTERVAL_MS=30_000).

## Action Dispatch

`server/sessions/internal/actions.ts` is a single switch — same shape as kittyfarm's `LocalControlMCPHandler.callTool` (`LocalControlMCPHandler.swift:94-165`).

```typescript
// pseudocode
async function dispatch(envelope: ClientEnvelope, ctx: ActionContext): Promise<unknown> {
  const { deviceId, platform } = ctx.session;
  switch (envelope.type) {
    case 'tap': {
      if (platform === 'android') {
        const serial = await ctx.deviceSerial(deviceId);
        await ctx.androidDevice.tap(serial, envelope.x, envelope.y);
        return null;
      }
      // iOS: WDA or simctl bridge from Phase 32
      await ctx.iosBridge.sendTouch(deviceId, envelope.x, envelope.y);
      return null;
    }
    case 'tapByDescription': {
      const point = await ctx.resolver.resolve({
        target: envelope.target,
        screenshot: await ctx.screenshotService.captureOnce(deviceId),
        hierarchy: await ctx.hierarchyService.getHierarchy(deviceId, platform),
      });
      return dispatch({ ...envelope, type: 'tap', x: point.x, y: point.y, id: envelope.id }, ctx);
    }
    case 'type': {
      if (platform === 'android') {
        const serial = await ctx.deviceSerial(deviceId);
        await ctx.androidDevice.typeText(serial, envelope.text);
        return null;
      }
      await ctx.iosBridge.typeText(deviceId, envelope.text);
      return null;
    }
    case 'swipe': { /* androidDevice.swipe(serial, x1,y1,x2,y2, durationMs) */ }
    case 'key': { /* androidDevice.pressKey(serial, keyCodeFor(code)) / WDA key for iOS */ }
    case 'screenshot': {
      const artifact = await ctx.screenshotService.captureOnce(deviceId);
      return { artifactId: artifact.id, url: artifact.url, width: artifact.width, height: artifact.height };
    }
    case 'screenRecord': {
      if (envelope.start) await ctx.recordingService.startRecording(deviceId);
      else await ctx.recordingService.stopRecording(deviceId);
      return null;
    }
    case 'installApp': {
      // Resolve artifactId → local file path via artifacts module
      const apkPath = await ctx.artifactService.resolveArtifactPath(envelope.artifactId);
      if (platform === 'android') {
        const serial = await ctx.deviceSerial(deviceId);
        await ctx.jobExecutor.installApk(serial, apkPath);  // existing primitive at job-executor.ts:97
      } else {
        await execFileAsync('xcrun', ['simctl', 'install', deviceId, apkPath]);
      }
      return null;
    }
    case 'launchApp': {
      if (platform === 'android') {
        const serial = await ctx.deviceSerial(deviceId);
        await ctx.androidDevice.launchApp(serial, envelope.bundleId);  // device-service.d.ts:43
      } else {
        await execFileAsync('xcrun', ['simctl', 'launch', deviceId, envelope.bundleId]);
      }
      return null;
    }
    case 'uninstallApp': { /* adb uninstall / simctl uninstall */ }
    case 'ping': return null;
  }
}
```

**Existing primitives we lean on (NO re-implementation):**

| Action | Android | iOS |
|--------|---------|-----|
| tap | `tangoAdbService.tap(serial, x, y)` — `node_modules/@device-stream/android/dist/device-service.d.ts:17` | `iosBridge.sendTouch` (Phase 32 private bridge) or WDA touch |
| typeText | `tangoAdbService.typeText(serial, text)` | WDA `/wda/keys` |
| pressKey | `tangoAdbService.pressKey(serial, code)` | WDA `/wda/pressButton` |
| swipe | `tangoAdbService.swipe(serial, sx,sy,ex,ey, dur)` | WDA `/session/$/wda/dragfromtoforduration` |
| screenshot | `ScreenshotService.captureOnce(deviceId)` — `server/artifacts/screenshot-service.ts` (existing) | same — already cross-platform |
| screenRecord | `RecordingService` (existing) | same |
| installApk | `JobExecutor.installApk(serial, apkPath)` — `server/jobs/job-executor.ts:97` | `xcrun simctl install <udid> <ipa>` |
| launchApp | `tangoAdbService.launchApp(serial, packageId)` — line 43 | `xcrun simctl launch <udid> <bundleId>` |
| uninstall | `adb uninstall <pkg>` (one-liner, new) | `xcrun simctl uninstall <udid> <bundleId>` |

The session module is therefore ~150 LoC of orchestration over already-existing services. **No new device-stream surface area.**

### ActionContext factory (pattern matches `createStreamingModule` deps)

```typescript
interface ActionContext {
  session: { sessionId: string; deviceId: string; platform: 'android' | 'ios'; actor: string };
  androidDevice: AndroidDeviceService;       // injected via fastify.* decorator from artifacts plugin
  iosBridge: IOSPrivateBridge;               // from Phase 32 (server/pool/ios)
  screenshotService: ScreenshotService;      // fastify.screenshotService
  recordingService: RecordingService;        // fastify.recordingService
  hierarchyService: HierarchyService;        // fastify.hierarchyService (Phase 24 maestro module)
  artifactService: ArtifactService;          // fastify.artifactService — for resolveArtifactPath
  jobExecutor: JobExecutor;                  // fastify.jobExecutor — for installApk
  resolver: TargetResolver;                  // ClaudeVisionResolver | MaestroAiResolver
  deviceSerial(deviceId): Promise<string>;   // pool helper
}
```

## NL Resolvers

### Interface (`server/sessions/internal/resolver/types.ts`)

```typescript
export interface ResolveTargetRequest {
  target: string;
  screenshot: Buffer;       // raw PNG
  hierarchy: string;        // XML (Android) / JSON (iOS)
  platform: 'android' | 'ios';
  screenWidth: number;
  screenHeight: number;
}

export interface ResolveTargetResult {
  x: number;                // pixel x (origin top-left)
  y: number;                // pixel y
  confidence: number;       // 0-1; < 0.5 → resolver_failed error
  backend: 'maestro-ai' | 'claude-vision';
  cached: boolean;
  latencyMs: number;
}

export interface TargetResolver {
  resolve(req: ResolveTargetRequest): Promise<ResolveTargetResult>;
}
```

### MaestroAiResolver (default — `SESSION_RESOLVER` unset or `=maestro-ai`)

**Strategy:** shell `maestro hierarchy --device <serial>` (already in Phase 24 as `hierarchyService`) + run a one-shot `maestro test --ai-prompt 'tap on <target>'` against an ephemeral flow, capture the resolved coords from stderr/stdout.

**Reality check:** maestro's `--ai` flag works against full flows, not single-step interactive resolution. The cleaner path: use the **hierarchy XML** + a deterministic string-search heuristic (label, content-desc, resource-id, text) FIRST; only call Maestro AI if the heuristic returns no match. This is functionally equivalent to revyl's `resolveTargetViaWorkerForSession` (`internal/mcp/device_session.go:1990-2020`) which tries the worker's local grounder before backend AI.

**Implementation plan (T-34.4):**
1. Parse Android XML via `fast-xml-parser` (already a transitive dep via maestro-parser); for iOS, parse JSON hierarchy.
2. Tokenize `target` (e.g. `"Sign In button"` → `["sign", "in", "button"]`).
3. Score every element: substring-match on `text|content-desc|label|accessibility-id`; boost by tag (`Button` > `TextView`); penalize obstructed (`clickable=false`).
4. Return centroid of the highest-scoring element's bounds.
5. If no element scores above threshold, fall through to `maestro test --ai-prompt` (slow path; 3-8s) — or return `{confidence: 0.3}` so caller can escalate to ClaudeVision.

**Note:** because we control the hierarchy already (Phase 24 maestro module), the deterministic heuristic resolves 70-80% of real-world targets in < 100ms with zero external cost. This is the right default.

### ClaudeVisionResolver (opt-in — `SESSION_RESOLVER=claude-vision`)

**Strategy:** Anthropic Messages API with vision. Per Anthropic SDK docs, supply images via base64 content blocks; tool-use is NOT needed (one-shot response, parse JSON from text content).

```typescript
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const result = await client.messages.create({
  model: 'claude-sonnet-4-5',  // adjust to current Sonnet at impl time
  max_tokens: 256,
  messages: [{
    role: 'user',
    content: [
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: screenshot.toString('base64') } },
      { type: 'text', text: `You are a UI element locator for a ${platform} device.
Given a mobile screenshot (${screenWidth}x${screenHeight}px, origin top-left) and a target description,
return ONLY JSON: {"x": <0-1 normalized>, "y": <0-1 normalized>, "confidence": <0-1>}.
Coordinates are the center of the element. If not found, return {"x": null, "y": null, "confidence": 0}.

Hierarchy hint (use to disambiguate when image is ambiguous):
${hierarchy.slice(0, 4000)}

Target: ${target}` },
    ],
  }],
});
```

**Caching:** `lru-cache` keyed on `sha256(screenshot) + ':' + target` (LRU 100 entries, 5-minute TTL). Hits avoid both Maestro shell-out AND Anthropic call.

**Cost ceiling:** documented in `docs/runbooks/session-resolver-costs.md` (T-34.10). Sonnet 4.5 ~$3/Mtok input + $15/Mtok output; a 1080p PNG is ~1.6Mp = ~1500 tokens; per-resolve cost ~$0.005-0.01.

**Confidence < 0.5** → reply `{type:'error', code:'resolver_failed', message:'NL target not located with confidence > 0.5'}`. Caller (agent) re-tries with a clearer description.

**Test strategy:** mock `Anthropic` client in unit tests (return fixed JSON); single E2E spec gated on `ANTHROPIC_API_KEY` env (skip if absent) — same pattern as DB-gated tests in Phase 22.

## MCP Package

### Layout

```
mcp/
├── package.json          # name: "@device-stream/mcp", bin: { "device-stream-mcp": "./dist/index.js" }
├── tsconfig.json
├── src/
│   ├── index.ts          # entry — wires McpServer + StdioServerTransport
│   ├── client.ts         # HTTP+WS client for device-farm server
│   ├── schemas.ts        # Zod schemas (mirror server/sessions/protocol.ts)
│   ├── tools/
│   │   ├── device-lease.ts
│   │   ├── device-tap.ts
│   │   ├── device-tap-by-description.ts
│   │   ├── device-type.ts
│   │   ├── device-swipe.ts
│   │   ├── device-key.ts
│   │   ├── device-screenshot.ts
│   │   ├── device-install.ts
│   │   ├── device-launch.ts
│   │   ├── device-release.ts
│   │   └── index.ts      # barrel
│   └── resources/
│       └── devices.ts    # device-farm://devices resource — listDevices()
├── README.md
└── dist/                 # tsc output (gitignored; tarball ships dist + package.json + README)
```

### Entry skeleton (`mcp/src/index.ts`)

```typescript
#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { DeviceFarmClient } from './client.js';
import { registerAllTools } from './tools/index.js';
import { registerDevicesResource } from './resources/devices.js';

const server = new McpServer(
  { name: 'device-stream', version: '0.1.0' },
  { capabilities: { tools: {}, resources: {} } },
);

const client = new DeviceFarmClient({
  // Production deployments MUST set a TLS-terminated https:// URL; the localhost
  // default is for development only.
  baseUrl: process.env.DEVICE_FARM_URL ?? 'http://localhost:3000',
  token: process.env.DEVICE_FARM_TOKEN,
});

registerAllTools(server, client);
registerDevicesResource(server, client);

const transport = new StdioServerTransport();
await server.connect(transport);

process.on('SIGINT', () => server.close().then(() => process.exit(0)));
process.on('SIGTERM', () => server.close().then(() => process.exit(0)));
```

### Tool registration pattern (`mcp/src/tools/device-tap.ts`)

```typescript
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DeviceFarmClient } from '../client.js';

export function registerDeviceTap(server: McpServer, client: DeviceFarmClient): void {
  server.registerTool(
    'device_tap',
    {
      title: 'Tap device at coordinates',
      description: 'Tap a device by pixel coordinates. Use device_tap_by_description for natural-language targeting.',
      inputSchema: z.object({
        sessionId: z.string().uuid(),
        x: z.number().int().nonnegative(),
        y: z.number().int().nonnegative(),
      }),
    },
    async ({ sessionId, x, y }) => {
      try {
        await client.sendAction(sessionId, { type: 'tap', x, y, id: crypto.randomUUID() });
        return {
          content: [{ type: 'text', text: `Tapped (${x}, ${y})` }],
          structuredContent: { tapped: { x, y } },
        };
      } catch (err: any) {
        return {
          content: [{ type: 'text', text: `Tap failed: ${err.message}` }],
          isError: true,
        };
      }
    },
  );
}
```

### Tool catalog (mirrors brief T-34.7 + kittyfarm pattern)

| MCP tool | Maps to | Backing route |
|----------|---------|---------------|
| `device_lease` | `POST /api/sessions` | REST |
| `device_release` | `DELETE /api/sessions/:id` | REST |
| `device_list` | `GET /api/sessions` | REST |
| `device_tap` | `{type:'tap', x, y}` | WS |
| `device_tap_by_description` | `{type:'tapByDescription', target}` | WS |
| `device_type` | `{type:'type', text}` | WS |
| `device_swipe` | `{type:'swipe', x1,y1,x2,y2}` | WS |
| `device_key` | `{type:'key', code}` | WS |
| `device_screenshot` | `{type:'screenshot'}` | WS — returns base64 PNG inline (MCP `content: [{type:'image',...}]`) |
| `device_install` | `{type:'installApp', artifactId}` | WS — caller must first upload via existing `POST /api/artifacts` |
| `device_launch` | `{type:'launchApp', bundleId}` | WS |
| `device_uninstall` | `{type:'uninstallApp', bundleId}` | WS |

### MCP Resource: `device-farm://devices`

Exposes `fastify.pool.getDevices()` as a list of `{id, name, platform, state}` for human-in-the-loop selection. Reads through `GET /api/devices` (existing route).

### Client (`mcp/src/client.ts`)

Two responsibilities:
1. **REST:** `lease()` POST /api/sessions; `release()` DELETE; `listDevices()` GET /api/devices.
2. **WS:** lazy-open one WS per session (TLS-terminated `wss://` in production), send action envelopes, await ack by `id`. Per-session connection cached (reused across MCP tool calls).

```typescript
class DeviceFarmClient {
  private wsBySession = new Map<string, { socket: WebSocket; pending: Map<string, Resolver> }>();

  async sendAction(sessionId: string, envelope: ClientEnvelope): Promise<unknown> {
    const conn = await this.getOrOpenWs(sessionId);
    return new Promise((resolve, reject) => {
      conn.pending.set(envelope.id, { resolve, reject });
      conn.socket.send(JSON.stringify(envelope));
      setTimeout(() => {
        if (conn.pending.delete(envelope.id)) reject(new Error('timeout'));
      }, 30_000);
    });
  }
  // ... handleFrame: parse server envelope, lookup pending by forMsgId, resolve/reject
}
```

### Packaging

- `package.json` declares `"bin": { "device-stream-mcp": "./dist/index.js" }` — `npx @device-stream/mcp` invokes binary directly.
- Workspace registered in root `package.json` `workspaces: ["mcp", ...]`.
- Independent versioning (NOT tied to device-farm server version) so users can update MCP client without server restart.
- README documents one-line install: `claude mcp add device-stream npx @device-stream/mcp` + env vars `DEVICE_FARM_URL`, `DEVICE_FARM_TOKEN`.

## Auth + Rate-limit + Sweeper

### Auth (T-34.6)

**Identical pattern to `server/jobs/internal/routes.ts:87-104`** — copy verbatim:

```typescript
const requireAuth = async (req, reply) => {
  const authHeader = req.headers.authorization ?? req.headers['x-api-key'];
  const key = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
  if (!key) { reply.code(401).send({ error: 'unauthorized' }); return; }
  const matched = await fastify.authService.validateKeyAndReturnRow(key);
  if (!matched) { reply.code(401).send({ error: 'unauthorized' }); return; }
  // Phase 26 entry-point #4: stamp ALS so all downstream events inherit apikey:<id> actor.
  (req as any).apiKey = matched;
};
```

Note: the auth plugin's bearer-auth callback (`server/auth/plugin.ts:55-71`) ALREADY does ALS-stamping when bearer-auth is registered, but the JOBs admin routes use a manual auth chain because they predate the bearer-auth hook globalization. Phase 34 should chain manual auth for symmetry with jobs (the bearer-auth global hook would interfere with WS upgrade per Pitfall 2).

For WS `?token=` upgrade, validate manually in the route handler before `socket.accept()` (matches `server/streaming/plugin.ts:79-85`).

### Rate limit (T-34.6)

Sliding window 30 actions / 10 seconds per session. **Implementation:** in-memory `Map<sessionId, number[]>` of action timestamps, prune entries older than 10s on every check.

```typescript
function rateLimitOk(window: number[], now: number): boolean {
  const cutoff = now - 10_000;
  // prune in-place
  while (window.length && window[0] < cutoff) window.shift();
  if (window.length >= 30) return false;
  window.push(now);
  return true;
}
```

On overflow → `{type:'error', forMsgId:envelope.id, code:'rate_limited', message:'30 actions / 10s exceeded'}`. Do NOT close the socket — let the caller back off.

**Why in-memory:** rate-limit window is per-session and resets on disconnect; cross-server-instance limiting is out of scope (single-node project). For multi-node, future phase swaps to pg-boss singleton or redis token bucket.

### Sweeper (T-34.6)

pg-boss schedule:

```typescript
// server/sessions/internal/sweeper.ts
await fastify.boss.schedule(
  'session.sweep',
  '*/30 * * * * *',    // every 30 seconds — pg-boss v12 accepts 6-field cron (with seconds)
  {},
  { tz: 'UTC' },
);
await fastify.boss.work('session.sweep', { teamSize: 1 }, async () => {
  await sweepExpiredSessions(fastify);
});
```

`sweepExpiredSessions`:
```typescript
const expired = await db.select().from(sessions)
  .where(and(eq(sessions.status, 'active'), lt(sessions.leaseUntil, sql`now()`)));
for (const session of expired) {
  // (a) Broadcast lease-expired event to WS if open
  // (b) Pool release device
  // (c) UPDATE status='expired', releasedAt=now()
  // (d) Emit session.expired event (persisted)
}
```

**Verify sub-minute cron support:** pg-boss `boss.schedule` accepts standard 5-field cron — for sub-minute we may need `setInterval` directly inside the plugin or a 1-minute cron that the worker polls + sleeps. **Open question — see §Open Questions #1.**

### Reaper coordination

Pool's existing reaper (`server/pool/process-tracker.ts`) detects zombie emulators and emits `device.health.failed`. Sessions subscriber:

```typescript
fastify.poolModule.bus.on('device.health.failed', async (payload) => {
  const session = await findActiveSessionByDevice(payload.deviceId);
  if (session) {
    await broadcastEvent(session.sessionId, { kind: 'device-lost', deviceId: payload.deviceId });
    await markSessionExpired(session.id);
  }
});
```

This is the "device error → release session" path called out in brief Risks.

## CLI Wrapper

`cli/cmd/session.go` — single file with sub-commands. Mirror revyl-cli's `device` command shape (`_reference/revyl-cli/cmd/revyl/device.go:485-498`).

```go
var sessionCmd = &cobra.Command{
    Use:   "session",
    Short: "Interactive device sessions (lease, tap, type, screenshot, release)",
}

var sessionLeaseCmd = &cobra.Command{ /* POST /api/sessions */ }
var sessionTapCmd = &cobra.Command{ /* WS dial, send tap envelope, wait ack */ }
// ... type / swipe / key / screenshot / release
```

**Session persistence:** write `~/.device-farm/session.json` with `{sessionId, wsUrl, token, leaseUntil, deviceName}` on `lease`; read on subsequent commands; allow `--session-id` flag or `$DEVICE_FARM_SESSION_ID` env override. Pattern is byte-for-byte from `revyl-cli/internal/mcp/device_session.go:935-1022` (`persistSessions` + `loadLocalCache`).

**Use openapi-fetch-generated types:** the lease/release routes feed into `cli/internal/types/generated.go` via the existing CLI-01 codegen pipeline (`make types`). The WS envelope schema is hand-mapped in `cli/internal/types/unions.go` (CLI-03 — discriminated unions don't auto-generate).

WS dial uses `github.com/gorilla/websocket` (already a transitive dep via CLI-04's status/logs commands — verify in `go.mod`). The dialer MUST use the `wss://` scheme when the server runs behind TLS; the CLI reads scheme from the `wsUrl` returned by lease (server-authoritative).

## Web UI

### `/sessions/+page.svelte` — list

Reads `GET /api/sessions?status=active` via the existing typed client (`web/src/lib/api/client.ts`). Renders table: `device | platform | owner | leased | actions (View, Release)`.

### `/sessions/[id]/+page.svelte` — detail

Three panes:
1. **Live preview** — reuses the existing device preview WS route (TLS-terminated `wss://host/ws/devices/:deviceId/preview`; `server/streaming/plugin.ts:138-216`). Scheme is derived at runtime from `location.protocol` — `https:` → WSS, plaintext only on loopback dev. Renders scrcpy H.264 via WebCodecs (Phase 22).
2. **Click overlay** — canvas overlay on top of preview; click → POST tap WS message; type into hidden textarea + Enter → POST type WS message.
3. **Action history feed** — WebSocket subscription to the session action WS (`wss://host/ws/sessions/:id?token=<bearer>` in production; scheme derived from `location.protocol` as above), echoes every ack/event to a scrolling list. Live debug surface.

Svelte 5 runes (`$state`, `$derived`, `$effect`) per CLAUDE.md. Tailwind v4. No new dependencies.

**Authz:** route uses existing `(authenticated)` layout (Phase 26 Plan 26-05). 403 if non-owner non-admin.

## Test Strategy

**Tests-as-spec convention** (MOD-04) — files named `*.spec.ts` describing behaviors:

| Spec file | Proves |
|-----------|--------|
| `server/sessions/__tests__/lease.spec.ts` | POST → row created, pool allocated, WS URL returned; duplicate POST on same device → 409 via partial unique index |
| `server/sessions/__tests__/release.spec.ts` | DELETE → row updated, pool released, WS broadcast `session-released`; non-owner → 403 |
| `server/sessions/__tests__/protocol.spec.ts` | safeParse acceptance/rejection across every envelope; unknown type → invalid_envelope |
| `server/sessions/__tests__/rate-limit.spec.ts` | 31st message in 10s → rate_limited error; window slides correctly |
| `server/sessions/__tests__/dispatch.spec.ts` | tap envelope → mocked `androidDevice.tap` called with (serial, x, y); screenshot → artifact returned in ack result |
| `server/sessions/__tests__/resolver-maestro.spec.ts` | deterministic heuristic resolves "Sign In button" against a fixture hierarchy XML; low-confidence path returns 0.3 |
| `server/sessions/__tests__/resolver-claude.spec.ts` | mocked Anthropic client returns JSON → parsed into Point; cache hit on identical input |
| `server/sessions/__tests__/sweeper.spec.ts` | expired session row + active status → sweeper marks expired, releases device |
| `server/sessions/__tests__/auth.spec.ts` | missing token → 401; valid token + non-owner DELETE → 403 |
| `server/sessions/__tests__/events.spec.ts` | EVENTS-03 dotted past-tense names; persistence flags per TRACE-08 |
| `server/sessions/__tests__/subscriber.spec.ts` | DB-gated — session.leased persists with actor=apikey:<id>; session.expired persists with actor=system |
| `mcp/__tests__/index.spec.ts` | spawn child process, send `initialize` JSON-RPC over stdio, expect protocol-version response |
| `mcp/__tests__/tools.spec.ts` | each tool's input schema validates; sample call routes to mock client |

**Real-device E2E (gated on `DEVICE_FARM_E2E=1`):**
- `server/sessions/__tests__/e2e.spec.ts` — lease an Android emulator, tap+type+screenshot+release. Skipped in CI by default; runs on developer machines + nightly on the device-farm host itself.

**Web UI Playwright E2E** (Phase 29 has the test harness): one happy-path test — lease via REST, navigate to /sessions/[id], click overlay → verify ack received in feed.

## Validation Architecture

> nyquist_validation enabled per `.planning/config.json` (`workflow.nyquist_validation: true`).

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 1.6+ (server) / Go testing (cli) / Playwright (web E2E, Phase 29) |
| Config file | `vitest.config.ts` (root) — covers `server/**/*.spec.ts` |
| Quick run command | `npx vitest run server/sessions` |
| Full suite command | `npm test` (server) + `cd cli && make test` (Go) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| SESS-LEASE | POST creates row + pool alloc | integration | `npx vitest run server/sessions/__tests__/lease.spec.ts` | Wave 0 |
| SESS-LEASE | Partial unique index → 409 on duplicate | DB-gated integration | `npx vitest run server/sessions/__tests__/lease.spec.ts -t "race"` | Wave 0 |
| SESS-WS | Envelope schema parse/reject | unit | `npx vitest run server/sessions/__tests__/protocol.spec.ts` | Wave 0 |
| SESS-WS | id echo on ack/error | integration | `npx vitest run server/sessions/__tests__/protocol.spec.ts -t "id echo"` | Wave 0 |
| SESS-DISPATCH | Action → primitive call | unit (mocked) | `npx vitest run server/sessions/__tests__/dispatch.spec.ts` | Wave 0 |
| SESS-NL-MAESTRO | XML heuristic resolves fixture | unit | `npx vitest run server/sessions/__tests__/resolver-maestro.spec.ts` | Wave 0 |
| SESS-NL-CLAUDE | Mocked Anthropic returns JSON parsed | unit | `npx vitest run server/sessions/__tests__/resolver-claude.spec.ts` | Wave 0 |
| SESS-AUTH | Missing token 401, wrong owner 403 | integration | `npx vitest run server/sessions/__tests__/auth.spec.ts` | Wave 0 |
| SESS-AUTH | Rate limit 31st msg in 10s | unit | `npx vitest run server/sessions/__tests__/rate-limit.spec.ts` | Wave 0 |
| SESS-AUTH | Sweeper expires + releases | DB-gated integration | `npx vitest run server/sessions/__tests__/sweeper.spec.ts` | Wave 0 |
| SESS-MCP | Child process initialize handshake | smoke | `npx vitest run mcp/__tests__/index.spec.ts` | Wave 0 |
| SESS-MCP | Each tool input schema valid + routes | unit | `npx vitest run mcp/__tests__/tools.spec.ts` | Wave 0 |
| SESS-CLI | `device-farm session lease` returns sessionId | go test | `cd cli && go test ./cmd -run TestSessionLease` | Wave 0 |
| SESS-CLI | Persisted session.json round-trips | go test | `cd cli && go test ./cmd -run TestSessionPersistence` | Wave 0 |
| SESS-WEB | `/sessions` list render | Playwright | `cd web && npx playwright test sessions-list` | Wave 0 (Phase 29 harness) |
| SESS-WEB | `/sessions/[id]` click-to-tap | Playwright (manual gate) | `cd web && npx playwright test sessions-detail` | Wave 0 |
| SESS-DOCS | Runbook files exist + lint clean | filesystem | `test -f docs/runbooks/session-api.md docs/runbooks/mcp.md` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run server/sessions` (covers all unit + integration; ~5s)
- **Per wave merge:** `npm test && cd cli && make test` (full server + go suites; ~60s)
- **Phase gate:** Full suite green + `npm run nyquist:check` exit 0 (delta ≥ -2pp from baseline 48.29%) before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `server/sessions/__tests__/lease.spec.ts` — covers SESS-LEASE (does NOT exist; create in Wave 0)
- [ ] `server/sessions/__tests__/release.spec.ts` — covers SESS-LEASE
- [ ] `server/sessions/__tests__/protocol.spec.ts` — covers SESS-WS
- [ ] `server/sessions/__tests__/rate-limit.spec.ts` — covers SESS-AUTH
- [ ] `server/sessions/__tests__/dispatch.spec.ts` — covers SESS-DISPATCH
- [ ] `server/sessions/__tests__/resolver-maestro.spec.ts` — covers SESS-NL-MAESTRO
- [ ] `server/sessions/__tests__/resolver-claude.spec.ts` — covers SESS-NL-CLAUDE
- [ ] `server/sessions/__tests__/auth.spec.ts` — covers SESS-AUTH
- [ ] `server/sessions/__tests__/sweeper.spec.ts` — covers SESS-AUTH
- [ ] `server/sessions/__tests__/events.spec.ts` — covers EVENTS-03 invariants
- [ ] `server/sessions/__tests__/subscriber.spec.ts` — DB-gated, covers TRACE-10
- [ ] `mcp/__tests__/index.spec.ts` + `mcp/__tests__/tools.spec.ts` — covers SESS-MCP
- [ ] `mcp/vitest.config.ts` — new vitest config for workspace
- [ ] `cli/cmd/session_test.go` — covers SESS-CLI
- [ ] `server/sessions/__tests__/__fixtures__/android-hierarchy.xml` — sample hierarchy for resolver heuristic spec
- [ ] `server/sessions/__tests__/__fixtures__/screenshot.png` — fixture PNG (~50KB) for resolver cache spec

Framework install: NONE — vitest, drizzle, pg-boss, fastify, zod all already declared in `package.json`. **New runtime deps added in Wave 0:** `@modelcontextprotocol/sdk` (mcp workspace), `@anthropic-ai/sdk` (server resolver), `lru-cache` (resolver cache; may already be a transitive dep — verify).

## Open Questions

1. **pg-boss sub-minute cron support.**
   - **What we know:** pg-boss `boss.schedule(name, cron, data, options)` accepts standard 5-field cron. Brief asks for "auto-release fires within 30s of TTL expiry" (acceptance criterion).
   - **What's unclear:** whether pg-boss v12 accepts 6-field (with seconds) cron, OR if we need to fall back to 1-minute schedule + 30-second `setInterval` inside plugin.
   - **Recommendation:** Wave 0 — quick test against the local dev DB; if 6-field fails, use 1-minute pg-boss schedule + a 30s `setInterval` inside `createSessionsModule` (cleared in `shutdown`). This is the same belt-and-braces pattern artifacts uses for compression + retention.

2. **iOS touch primitive — WDA vs Phase 32 private bridge.**
   - **What we know:** Phase 32 shipped `sim-capture-private` for ScreenCaptureKit-free iOS simulator capture; it includes a touch-inject path (SIM-PRIV-04 verified). Physical iOS uses WDA.
   - **What's unclear:** whether the Phase 32 touch-inject is exposed as a clean TS API or still requires the daemon protocol unwrap.
   - **Recommendation:** Wave 0 — inspect `device-stream/native-servers/sim-capture-private/` exports; either expose `injectTouch(udid, x, y)` from there, or use `xcrun simctl io <udid> touch` for v1 simulator (slow but works). Physical iOS WDA is documented in Phase 24 as out-of-band.

3. **Drizzle migration numbering interaction with pgboss.**
   - **What we know:** existing migrations 0000-0008; pg-boss owns its own `pgboss` schema independently.
   - **Recommendation:** `0009_sessions.sql` is safe — pgboss schema doesn't conflict.

4. **MCP tool result for screenshot — inline base64 vs URL.**
   - **What we know:** kittyfarm returns inline base64 (`LocalControlMCPHandler.swift:194-199`); the MCP image content type is well-supported by Claude.
   - **Tradeoff:** Inline = no auth-token needed by client for image fetch + works air-gapped; URL = smaller MCP payload, smaller LLM context.
   - **Recommendation:** Inline for v1 (matches kittyfarm; simplest). MCP `content` can carry both `{type:'image'}` + `{type:'text', text:url}` so callers wanting URL still get it.

5. **WS reconnect/resume semantics.**
   - **What we know:** brief lists this as Claude's discretion. Phase 22 streaming has per-job replay history; sessions could mirror.
   - **Recommendation:** v1 — no resume. If WS drops, the session row stays active; client must re-open WS with `?token=` and resume from current state. Phase 35 may add replay if needed (session recording lives there).

6. **Rate-limit memory leak on long-lived servers.**
   - **What we know:** `Map<sessionId, number[]>` window cleared on socket close; session release also cleans up.
   - **Risk:** zombie session rows that never disconnect (network partition) leak the map entry.
   - **Mitigation:** sweeper clears the rate-limit map entry on `markSessionExpired`. Test in sweeper.spec.

7. **Anthropic SDK model name pinning.**
   - **What we know:** Sonnet 4.5 is current as of 2026-05; future Sonnet 4.6+ should be drop-in.
   - **Recommendation:** read model from `process.env.SESSION_RESOLVER_MODEL ?? 'claude-sonnet-4-5'`. Document in runbook.

8. **TLS-termination contract for WS routes.**
   - **What we know:** every canonical WS example in this document uses the `wss://` scheme because production deployments terminate TLS at the server (or upstream reverse proxy). Plaintext WS is acceptable ONLY for loopback (`127.0.0.1` / `localhost`) development and is never written verbatim in this research document.
   - **Recommendation:** lease response `wsUrl` is server-authoritative — the server picks the scheme based on `fastify.config.server.tls` (or `X-Forwarded-Proto` when behind a TLS-terminating reverse proxy). CLI and web clients use the URL verbatim. Operator runbook (`docs/runbooks/session-api.md`) calls out the TLS requirement for non-loopback deployments.

## Sources

### Primary (HIGH confidence)
- `_reference/revyl-cli/cmd/revyl/device.go:485-1700` — session-aware CLI commands (read in full)
- `_reference/revyl-cli/internal/mcp/device_session.go:300-2080` — DeviceSessionManager implementation
- `_reference/kittyfarm/KittyFarm/LocalControl/LocalControlMCPHandler.swift:1-583` — MCP handler reference
- `_reference/kittyfarm/KittyFarm/LocalControl/LocalControlServer.swift:1-337` — HTTP+MCP server reference
- `_reference/kittyfarm/KittyFarm/LocalControl/MCPConfigurationInstaller.swift:1-192` — MCP client config installation pattern
- `_reference/mobile-devtools/README.md` — product framing + design contract
- `server/auth/MODULE.md` + `server/auth/plugin.ts:55-71` — Phase 26 auth pattern to copy
- `server/jobs/MODULE.md` + `server/jobs/internal/routes.ts:87-104` — manual requireAuth chain pattern
- `server/streaming/plugin.ts:73-216` — WS upgrade + `?token=` pattern, heartbeat, FlushQueue
- `server/jobs/events.ts` — event registry + emit-helpers pattern to copy
- `server/jobs/internal/module.ts:1-120` — factory + persistEnvelope pattern (8th sample point)
- `server/db/schema.ts:1-160` — Drizzle table conventions, enum patterns, JSONB rules
- `node_modules/@device-stream/android/dist/device-service.d.ts` — primitive API surface (tap/type/swipe/key/screenshot/launchApp)
- `server/jobs/job-executor.ts:97-101` — `installApk(deviceId, apkPath)` primitive
- `server/artifacts/screenshot-service.ts` — `ScreenshotService` (existing)
- `server/maestro/internal/hierarchy-service.ts:1-95` — `HierarchyService` (existing) for Android XML + iOS hierarchy
- [Anthropic Claude API — Vision](https://docs.anthropic.com/en/docs/build-with-claude/vision) — base64 image content blocks
- [Anthropic TypeScript SDK on npm](https://www.npmjs.com/package/@anthropic-ai/sdk) — messages.create + image content
- [@modelcontextprotocol/sdk on npm](https://www.npmjs.com/package/@modelcontextprotocol/sdk) — registerTool + StdioServerTransport
- [MCP TypeScript SDK server.md](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/server.md) — registerTool + bin entry pattern (fetched)

### Secondary (MEDIUM confidence — WebSearch verified against multiple sources)
- [pg-boss boss.schedule cron syntax](https://www.npmjs.com/package/pg-boss) — 5-field cron confirmed; 6-field needs Wave-0 verification (Open Q #1)
- [How to build MCP servers with TypeScript SDK (dev.to)](https://dev.to/shadid12/how-to-build-mcp-servers-with-typescript-sdk-1c28) — community confirmation of registerTool pattern
- [Anthropic Claude API Developer Guide 2026 (APIScout)](https://apiscout.dev/guides/anthropic-claude-api-complete-developer-guide-2026) — confirms TypeScript SDK + vision usage

### Tertiary (LOW confidence — flagged for Wave-0 validation)
- Maestro CLI `--ai-prompt` interactive mode for single-step NL resolution — Maestro AI docs are sparse; falling back to deterministic XML heuristic is the safer default and matches revyl's worker-local resolver pattern.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libs (`@modelcontextprotocol/sdk`, `@anthropic-ai/sdk`, fastify, zod, drizzle, pg-boss) are either already in `package.json` or have well-documented usage; reference patterns verified against multiple sources.
- Architecture: HIGH — copies Phase 22 streaming + Phase 23 jobs + Phase 26 auth pattern verbatim; module skeleton is a near-clone with substitutions.
- Action surface: HIGH — every primitive verified to exist (`@device-stream/android` typedefs, `JobExecutor.installApk`, `ScreenshotService`, `HierarchyService`); ZERO new device-stream code.
- NL resolvers: MEDIUM — deterministic heuristic is straightforward; Claude Vision API shape verified; Maestro `--ai-prompt` real-world resolution time + accuracy needs Wave-0 spike.
- MCP package: HIGH — SDK pattern is one-shot per tool; kittyfarm provides a complete reference for tool catalog shape; no novel ground.
- Pitfalls: HIGH — sub-minute cron + iOS touch primitive flagged as Open Questions to clear in Wave 0; nothing else fragile.

**Research date:** 2026-05-15
**Valid until:** 2026-06-15 (30 days — Anthropic + MCP SDK move fast; revalidate model name + SDK shape if Wave 0 starts after this window)

## RESEARCH COMPLETE

**Phase:** 34 — Session API + MCP Server
**Confidence:** HIGH

### Key Findings
- Every action primitive exists today (`@device-stream/android` tap/type/swipe/screenshot/launchApp; `JobExecutor.installApk`; `ScreenshotService.captureOnce`; `HierarchyService` for both platforms). Phase 34 is orchestration, NOT new device-stream surface.
- Pattern is identical to Phase 22 streaming + Phase 23 jobs + Phase 26 auth: factory + events.ts + MODULE.md + barrel + thin plugin with manual `requireAuth` chain (NOT bearer-auth global hook) so WS `?token=` upgrade works.
- DB-layer race protection on `sessions(device_id) WHERE status='active'` partial unique index is the cleanest single-active-session enforcement (defers multi-session-per-device to v3.1 cleanly).
- MCP package is a brand-new `mcp/` workspace using `@modelcontextprotocol/sdk` `McpServer.registerTool` + `StdioServerTransport`; tool catalog mirrors action envelopes 1:1 (revyl's `WorkerRequestForSession` switch and kittyfarm's `LocalControlMCPHandler.callTool` are the two reference patterns).
- ClaudeVisionResolver opt-in via `SESSION_RESOLVER=claude-vision`; default MaestroAiResolver uses a deterministic XML-hierarchy heuristic that should resolve 70-80% of targets at zero cost in <100ms — Maestro CLI `--ai-prompt` shell-out is the slow fallback, not the hot path.
- All canonical WS URLs in this document use the TLS-terminated `wss://` scheme; plaintext WS is permitted only on loopback dev hosts and never appears verbatim. The server picks the scheme and stamps it into the lease response so clients consume the URL verbatim.

### File Created
`/Users/heicg/Desktop/projects/device-farm/.planning/phases/34-session-api-mcp/34-RESEARCH.md`

### Confidence Assessment
| Area | Level | Reason |
|------|-------|--------|
| Standard Stack | HIGH | All libs documented; Anthropic vision + MCP SDK shapes verified |
| Architecture | HIGH | Verbatim copy of three closed phases' patterns (22, 23, 26) |
| Action Dispatch | HIGH | Every primitive grep-verified in existing code |
| NL Resolvers | MEDIUM | Deterministic heuristic safe; Maestro `--ai-prompt` exact UX needs Wave-0 spike |
| MCP Package | HIGH | SDK docs fetched + kittyfarm full reference available |
| Pitfalls | HIGH | 8 open questions captured; 2 are Wave-0 spikes, 6 are documentation/discretion |

### Open Questions
- pg-boss sub-minute cron support (Wave-0 spike to confirm 6-field accepted; fallback plan documented)
- iOS touch injection — Phase 32 private bridge vs `xcrun simctl io touch` vs WDA — Wave-0 inspection of `device-stream/native-servers/sim-capture-private/` exports
- Maestro `--ai-prompt` real-world latency + accuracy (deterministic heuristic is the safer default; Maestro fallback is best-effort)
- TLS-termination contract for WS routes — server-authoritative scheme selection from lease response; operator runbook captures the requirement

### Ready for Planning
Research complete. Planner can now create PLAN.md files for T-34.0 (schema + Wave 0 substrate) through T-34.10 (docs + examples), inheriting the 6-wave shape proven across Phases 19-26.
