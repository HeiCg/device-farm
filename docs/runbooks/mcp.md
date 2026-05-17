# `@device-stream/mcp` — MCP Server Runbook

**Phase 34 Plan 34-08.** Install + operate the `@device-stream/mcp` stdio
MCP server that exposes the Session API to Claude Code (or any MCP-compatible
client: Cursor, Continue, Zed, etc).

For module-level details see `server/sessions/MODULE.md` and the
sibling REST runbook (`docs/runbooks/session-api.md`).

## Install

```bash
# One-line install — registers under ~/.claude.json for Claude Code:
claude mcp add device-stream npx @device-stream/mcp \
  --env DEVICE_FARM_URL=http://localhost:3000 \
  --env DEVICE_FARM_TOKEN=df_xxxxx...
```

Local dev (against a checked-out repo before publishing to npm):

```bash
cd /path/to/device-farm
npm run mcp:build              # produces mcp/dist/index.js with shebang

claude mcp add device-stream node "$(pwd)/mcp/dist/index.js" \
  --env DEVICE_FARM_URL=http://localhost:3000 \
  --env DEVICE_FARM_TOKEN=df_xxxxx...
```

Restart Claude Code after registration. Ask it: *"What device tools do
you have?"* — it should list the 12 tools below.

## Required env vars

| Variable                  | Required | Default                  | Description                                                                                          |
| ------------------------- | -------- | ------------------------ | ---------------------------------------------------------------------------------------------------- |
| `DEVICE_FARM_URL`         | no       | `http://localhost:3000`  | Base URL of the device-farm server (REST + WS — the MCP server derives the WS URL from the lease response). |
| `DEVICE_FARM_TOKEN`       | **YES**  | —                        | Bearer API key. The MCP server exits 1 if unset.                                                     |
| `SESSION_RESOLVER_MODEL`  | no       | `claude-sonnet-4-5`      | Override the model used by the server-side ClaudeVisionResolver (when enabled).                       |

Server-side env (set in the device-farm server's environment, NOT the MCP
package):

| Variable               | Required (for NL `tap_by_description`) | Description                                                                                  |
| ---------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------- |
| `SESSION_RESOLVER`     | no — defaults to `maestro-ai`           | Set to `claude-vision` to enable the chained Maestro AI + Claude Vision fallback resolver.    |
| `ANTHROPIC_API_KEY`    | yes if `SESSION_RESOLVER=claude-vision` | Anthropic API key used by the Claude Vision resolver. See cost runbook before enabling.       |

## Tool catalog

12 tools exposed to the MCP client. All tools route to the device-farm
server's REST + WS surface; `device_lease` is the canonical entrypoint
(returns a `sessionId` consumed by every subsequent action tool).

| #   | Name                            | Input                                                                  | Output (success)                                                            |
| --- | ------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 1   | `device_lease`                  | `{platform: 'android'|'ios', ttlSeconds?: 60-3600, deviceQuery?: {…}, metadata?: {…}}` | `{sessionId, deviceId, wsUrl, ttlSeconds, leaseUntil, platform}`            |
| 2   | `device_release`                | `{sessionId: uuid}`                                                    | `{released: true, releasedAt}`                                              |
| 3   | `device_list`                   | `{}`                                                                   | `[{deviceId, name, platform, status, ...}]`                                 |
| 4   | `device_tap`                    | `{sessionId, x: int, y: int}`                                          | `{durationMs}`                                                              |
| 5   | `device_tap_by_description`     | `{sessionId, target: string}`                                          | `{x, y, durationMs}` — server resolver picks coords                          |
| 6   | `device_type`                   | `{sessionId, text: string ≤ 4096}`                                     | `{durationMs}`                                                              |
| 7   | `device_swipe`                  | `{sessionId, x1, y1, x2, y2, durationMs?: 50-5000}`                    | `{durationMs}`                                                              |
| 8   | `device_key`                    | `{sessionId, code: 'home|back|enter|volup|voldown|power|menu|recent'}` | `{durationMs}`                                                              |
| 9   | `device_screenshot`             | `{sessionId}`                                                          | image+text content blocks — base64 PNG inline + `{artifactId, url, width, height}` |
| 10  | `device_install`                | `{sessionId, artifactId: uuid}`                                        | `{durationMs}`                                                              |
| 11  | `device_launch`                 | `{sessionId, bundleId: string}`                                        | `{durationMs}`                                                              |
| 12  | `device_uninstall`              | `{sessionId, bundleId: string}`                                        | `{durationMs}`                                                              |

Example agent prompt:

> *"Lease an Android device, install the artifact at `<uuid>`, launch
> `com.example.app`, take a screenshot, then tap on the 'Sign In' button
> by description, then release."*

The agent issues `device_lease` → `device_install` → `device_launch` →
`device_screenshot` → `device_tap_by_description` → `device_release` in
sequence using only the tools above.

## Resources

| URI                        | Returns                                                                  |
| -------------------------- | ------------------------------------------------------------------------ |
| `device-farm://devices`    | JSON listing of all pool devices for human-in-the-loop selection ("which device should I use?"). Semantically equivalent to `device_list` but exposed as an MCP resource so the client can render it in its picker UI. |

## Architecture notes

- **Transport:** stdio (JSON-RPC over stdin/stdout per MCP spec). The MCP
  client owns the subprocess lifecycle; the server installs SIGINT /
  SIGTERM handlers that close all open WebSockets gracefully.
- **WS URL cache:** the internal `DeviceFarmClient.wsUrlBySession` Map is
  populated only by `device_lease` (server-authoritative URL from the
  lease response). Action tools (`device_tap`, etc.) read the cache and
  throw `'session not leased by this client'` on cache miss — there is
  NO server discovery roundtrip per action.
- **Action timeout:** 30 seconds per action (timer-tracked + rejected on
  expiry). Long-running operations (screen record, large installs)
  return the action ack on completion within the timeout window.
- **Auth:** `DEVICE_FARM_TOKEN` is forwarded as a Bearer header on every
  REST request and as the `?token=` query param on the WS upgrade.

## Troubleshooting

| Symptom                                                          | Likely cause                                                                                              | Resolution                                                                                                                                                |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MCP server exits immediately with `DEVICE_FARM_TOKEN required` stderr | Env var not forwarded to the subprocess.                                                                  | Pass via `claude mcp add --env DEVICE_FARM_TOKEN=...` (NOT via shell env — the MCP client controls the subprocess env).                                    |
| `401 unauthorized` from `device_lease`                            | API key revoked or wrong scope.                                                                            | Mint a fresh key: `POST /api/admin/keys` with an admin Bearer token. Update the MCP registration: `claude mcp remove device-stream && claude mcp add ...`. |
| Tool list empty in Claude Code after install                     | Stdio handshake failed; Node version mismatch.                                                              | Ensure Node 22+ is on PATH. Run `node --version` in the same shell that spawns the MCP server. Restart Claude Code after the registration changes.        |
| `device_tap_by_description` returns `resolver_failed`            | Default Maestro AI heuristic confidence < 0.5; Claude Vision not enabled.                                  | Set `SESSION_RESOLVER=claude-vision` + `ANTHROPIC_API_KEY=...` on the device-farm SERVER (not the MCP client). Restart server. See cost runbook.           |
| `session not leased by this client` from any action tool         | Cache miss — agent reused a `sessionId` from a previous MCP server instance, or `device_release` was called.| Always `device_lease` fresh; treat `sessionId`s as opaque to the current MCP server process.                                                              |
| Action ack never returns (>30s)                                  | Action exceeded the per-action timeout.                                                                    | Inspect server logs for the underlying dispatch error. Long installs may need a chunked upload first (`POST /api/artifacts` then `device_install`).        |
| `device_screenshot` returns text but no image                     | Artifact URL fetch failed (`file://` resolution outside the server).                                       | Verify the server returned an `http(s)://` artifact URL. The MCP package fetches with Bearer auth on http(s); `file://` is dev-only fallback.             |

## Verifying end-to-end

```bash
# 1. Build MCP package + boot server.
cd /path/to/device-farm
npm run mcp:build
npm run dev   # in another terminal

# 2. Register MCP with Claude Code.
claude mcp add device-stream node "$(pwd)/mcp/dist/index.js" \
  --env DEVICE_FARM_URL=http://localhost:3000 \
  --env DEVICE_FARM_TOKEN=df_xxxxx...

# 3. In Claude Code: ask "Lease an Android device and take a screenshot."
#    Expected: tool sequence device_lease → device_screenshot → device_release
#    completes within ~30s; screenshot renders in the conversation.
```

For agent prompt skeletons see `examples/agents/`:
- `pr-bot.md` — PR review bot using screenshot + tap-by-description loop.
- `exploration.md` — App explorer using BFS tap-by-description.

For cost guidance on the NL resolver chain see
`docs/runbooks/session-resolver-costs.md`.
