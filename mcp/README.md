# @device-stream/mcp

MCP stdio server exposing device-farm session actions (lease/tap/type/swipe/key/screenshot/install/launch/uninstall) to Claude Code and other MCP-compatible clients.

**Status:** Phase 34 Plan 34-05 — 12 tools + 1 resource shipped.

## Install

```bash
claude mcp add device-stream npx @device-stream/mcp
```

Or, for local development against a checkout:

```bash
cd /path/to/device-farm
npm install
npm run mcp:build
claude mcp add device-stream node "$(pwd)/mcp/dist/index.js"
```

## Environment

The server reads two env vars at startup. Pass them through `claude mcp add ... --env KEY=VALUE` (or your client's equivalent).

| Variable             | Required | Default                 | Description                                              |
| -------------------- | -------- | ----------------------- | -------------------------------------------------------- |
| `DEVICE_FARM_URL`    | no       | `http://localhost:3000` | Base URL of the device-farm server                       |
| `DEVICE_FARM_TOKEN`  | **yes**  | —                       | API key with session scope (`sessions:write` capability) |

If `DEVICE_FARM_TOKEN` is unset, the server exits 1 with a stderr message before connecting.

## Tools (12)

| Tool name                   | Purpose                                                                |
| --------------------------- | ---------------------------------------------------------------------- |
| `device_lease`              | Lease a device for an interactive session                              |
| `device_release`            | Release a previously-leased session                                    |
| `device_list`               | List all devices in the pool                                           |
| `device_tap`                | Tap by absolute pixel coordinates                                      |
| `device_tap_by_description` | Tap by natural-language description (vision/heuristic resolver)        |
| `device_type`               | Type text into the focused input                                       |
| `device_swipe`              | Swipe between coordinates                                              |
| `device_key`                | Press a physical key (home/back/enter/volup/voldown/power/menu/recent) |
| `device_screenshot`         | Capture PNG screenshot (returned inline as base64 + artifact URL)      |
| `device_install`            | Install an APK/IPA by pre-uploaded artifact id                         |
| `device_launch`             | Launch an installed app by bundle/package id                           |
| `device_uninstall`          | Uninstall an app by bundle/package id                                  |

All action tools (`device_tap`, `device_type`, etc.) require a `sessionId` from a prior `device_lease` call.

## Resources (1)

| URI                      | Description                |
| ------------------------ | -------------------------- |
| `device-farm://devices`  | JSON list of pool devices  |

## Architecture notes

- One `DeviceFarmClient` instance is shared by all tools.
- The client caches each session's WebSocket URL from the `device_lease` response and lazy-opens one WS per active session. Subsequent action calls reuse the open socket.
- Action calls await an `ack` frame echoing the envelope's `id`, with a 30s timeout.
- `device_screenshot` downloads the PNG bytes from the artifact URL returned in the ack and inlines them as a base64 `image/png` content block, matching the kittyfarm LocalControl handler pattern.

## See also

- `.planning/phases/34-session-api-mcp/34-RESEARCH.md` — full design rationale
- `.planning/phases/34-session-api-mcp/34-05-SUMMARY.md` — implementation summary
- `server/sessions/internal/protocol.ts` — server-side WS envelope schemas (source of truth)
