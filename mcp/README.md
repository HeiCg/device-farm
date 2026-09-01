# @device-stream/mcp

MCP stdio server exposing device-farm session actions (lease/tap/type/swipe/key/screenshot/install/launch/uninstall) to Claude Code and other MCP-compatible clients, plus an optional set of richer **selector-based** tools backed by `@device-stream/dsl`.

**Status:** 12 WS session tools + 1 resource, plus 18 optional DSL tools (enabled when a direct device target is configured — see [DSL tools](#dsl-tools-18-optional)).

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

## DSL tools (18, optional)

The 12 tools above operate on **pixel coordinates / NL** and route through the device-farm server over WebSocket. When a **direct device target** is configured, the server also exposes a richer set backed by [`@device-stream/dsl`](../device-stream/packages/dsl/README.md) — these talk straight to `android-server` (:9008) / WDA (:8100) and give an agent **selector-based** control (id/text with `contains`/`regex`/`caseInsensitive`/`visible`), scroll-until-visible, a normalized screen outline, field fills, and flow replay.

Enable by setting both env vars before launching the MCP server:

| Variable                          | Required | Default                 | Description                                  |
| --------------------------------- | -------- | ----------------------- | -------------------------------------------- |
| `DEVICE_STREAM_SERIAL`            | yes\*    | —                       | Device serial / UDID to drive                |
| `DEVICE_STREAM_PLATFORM`          | yes\*    | —                       | `android` or `ios`                           |
| `DEVICE_STREAM_ANDROID_SERVER_URL`| no       | `http://localhost:9008` | android-server base URL (Android)            |
| `DEVICE_STREAM_WDA_URL`           | no       | `http://localhost:8100` | WDA base URL (iOS)                            |
| `DEVICE_STREAM_IOS_KIND`          | no       | `simulator`             | `simulator` or `device` (iOS)                |

\* When both `DEVICE_STREAM_SERIAL` and `DEVICE_STREAM_PLATFORM` are set, the DSL tools register; otherwise they're skipped and only the 12 WS tools are available. The DSL session is created lazily on first use and memoized.

| Tool name                  | Purpose                                                              |
| -------------------------- | ------------------------------------------------------------------- |
| `dsl_tap`                  | Tap the element matching a selector (waits for it)                  |
| `dsl_fill`                 | Tap a field by selector and type text                              |
| `dsl_long_press`           | Long-press an element by selector                                  |
| `dsl_element_text`         | Read the text of an element by selector                            |
| `dsl_press_key`            | Press a hardware key                                               |
| `dsl_swipe`                | Swipe in raw screen coordinates                                    |
| `dsl_scroll`               | Scroll one page in a direction                                     |
| `dsl_scroll_until_visible` | Scroll until a (visible) selector appears; returns it             |
| `dsl_wait_for_idle`        | Block until the UI stops changing                                  |
| `dsl_describe`             | Compact, normalized, visible-only screen outline for navigation    |
| `dsl_screenshot`           | Capture a PNG                                                      |
| `dsl_launch_app` / `dsl_stop_app` | Launch / force-stop an app                                  |
| `dsl_open_url`             | Open a URL or deep link                                           |
| `dsl_install_app`          | Install an APK / `.app` bundle                                    |
| `dsl_grant_permissions`    | Grant runtime permissions (`'*'` grants all declared)             |
| `dsl_set_location`         | Set the device GPS location                                       |
| `dsl_run_flow`             | Replay a recorded device-stream flow (YAML) step by step          |
| `dsl_run_script`           | Run an agent-authored TypeScript snippet against the `ds` session in one call | 

Selector example (passed as a tool arg): `{ "selector": { "text": { "contains": "Sign" }, "visible": true } }`.

> **Trust model:** `dsl_run_script` runs arbitrary local code via repo-local `tsx` in a child process, at the same trust level as the other `dsl_*` tools. The child gets a curated environment (PATH/HOME/ANDROID_* etc. — not the MCP server's full env), but it has normal filesystem and network access as your user. Enable the DSL tools only for agents you already trust to run code on this machine.

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
