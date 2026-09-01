# Spec: DSL AndroidDriver ↔ android-server protocol fix + tree pruning fix

Date: 2026-08-31 · Owner: heicg · Unblocks: token benchmark configs B1/C1/C2
(`docs/specs/2026-08-31-token-benchmark.md`)

## Background (verified by research 2026-08-31)

`@device-stream/android-server` v1.1.0 was an HTTP NanoHTTPD server; v1.2.0 switched
to TCP JSON-RPC 2.0 (newline-delimited) on the same port 9008 without updating any
client. The DSL `AndroidDriver` (`device-stream/packages/dsl/src/drivers/android.ts:35-110`)
still speaks the dead HTTP contract. Params/fields map 1:1 (same lineage); only
transport + method names differ. Independently, `getAccessibilityTree` returns
`{tree:[]}` on populated screens: `NodeSerializer.kt:44-54` applies
`TreeCompressor.shouldSkipSubtree` — which inspects only the node itself — and
returns before traversing children, so the id-less root `FrameLayout` prunes the
entire tree.

## Scope

Two coupled fixes + end-to-end verification on the live emulator `emulator-5554`
(physical device `ZF524RZBHD` also attached — NEVER target it). One implementor.

### Part 1 — TS: `AndroidDriver` speaks JSON-RPC (route (b))

File: `device-stream/packages/dsl/src/drivers/android.ts` (plus the minimal type
touch-points it drags in).

1. Replace the HTTP `get()/post()` transport with a TCP newline-delimited JSON-RPC
   client (`net.Socket`): write `{jsonrpc:'2.0', method, params, id}\n`, read one
   `\n`-terminated JSON reply, correlate by `id`. One connection reused with a
   simple in-order queue is fine (server handles one request per line); reconnect
   on ECONNRESET/close; per-request timeout (default 10s) that destroys the socket.
2. Method/field mapping (verified against the Kotlin handlers):
   - `/hierarchy?maxElements=N` → `getAccessibilityTree`, `params.maxElements`;
     reply `{tree:[...]}` unchanged shape.
   - `/info` → `getInfo`; map `screenWidth/screenHeight` → the driver's
     `{width,height}`.
   - `/screenshot?quality&scale` → `screenshot`; base64 arrives in `result.data`
     (today the HTTP path expected raw bytes) — decode to Buffer so the driver's
     public return type is unchanged.
   - `/tap`, `/swipe`, `/longPress`, `/key`, `/type`, `/wait` etc. → their JSON-RPC
     method names as implemented in
     `device-stream/native-servers/android-device-server/.../handlers/*.kt`
     (`tap`, `swipe`, `longPress`, `pressKey`/`KeyHandler`, …) — read each handler
     for the exact method string registered in `JsonRpcHandler.kt:53-67`; params
     already match 1:1.
   - JSON-RPC `error` replies become thrown `Error`s carrying `error.message`.
3. Config: the existing `androidServerUrl` option (`session.ts:311`, `types.ts:63`,
   `mcp/src/dsl/register.ts:84`) currently holds `http://host:port`. Keep the
   option name; accept both `http://host:port` (parse host+port, scheme ignored
   with a deprecation note in the jsdoc) and `host:port`. Default unchanged
   (`localhost:9008` equivalent).
4. Public driver API (`drivers/types.ts`) unchanged — transport is internal.

Out of scope (record, don't fix): `server/maestro/internal/hierarchy-service.ts:578`,
`server/maestro/routes.ts:182,258`, `device-stream/test-app/server.ts` are the same
dead HTTP clients; a shared client extraction is a follow-up decision. Stale docs
(`device-stream/README.md`, `packages/dsl/README.md`, root `CLAUDE.md:60`,
`CHANGELOG.md`) — follow-up.

### Part 2 — Kotlin: fix subtree pruning + settle

Files under `device-stream/native-servers/android-device-server/` (Gradle build now
works: wrapper committed in working tree, `local.properties` present; build via
`cd device-stream/packages/android-server && ANDROID_HOME=/opt/homebrew/share/android-commandlinetools npm run build`).

1. `NodeSerializer.kt:44-57`: never early-return based on the node's own
   skippability alone. Correct semantics: always recurse into children; a node is
   *emitted* iff `shouldKeep(node)`; drop the `shouldSkipSubtree` short-circuit
   entirely (flat output — the TS side reconstructs hierarchy since WS2), OR make
   it genuinely recursive (skip a subtree only when no descendant would be kept).
   Prefer the simplest: emit-filter on the node, always recurse, keep the
   `maxElements` cap as the traversal stop.
2. `HierarchyHandler.kt`: call the same `waitForIdle` the `StateHandler.kt:32`
   uses before serializing (bounded, e.g. 2s), so describe isn't racing layout.
3. Version bump `packages/android-server/package.json` 1.2.0 → 1.2.1.

### Part 3 — Redeploy + end-to-end verification (live emulator)

1. Rebuild APKs, redeploy: `cd device-stream/packages/android-server &&
   npm run start -- emulator-5554` (stop the previously running instrumentation
   first: `adb -s emulator-5554 shell am force-stop com.devicestream.server`).
2. Rebuild dsl (`npm run build -w @device-stream/dsl` from `device-stream/`).
3. Prove, against the live emulator with Settings open
   (`adb -s emulator-5554 shell am start -a android.settings.SETTINGS`):
   - `getAccessibilityTree` returns a non-empty tree (>20 elements on Settings root).
   - Through the DSL: a small tsx script using `@device-stream/dsl` —
     `ds.describe()` returns non-empty text; `ds.get({ text: 'Network' /* adjust
     to a label actually present */ }).tap()` navigates; `ds.screenshot()` returns
     a Buffer. Paste the observed describe line count + byte size in the report.
4. Unit tests: dsl suite (`npx vitest run packages/dsl` from `device-stream/`) and
   mcp suite (`npx vitest run` in `mcp/`) must stay green — the driver mock surface
   in existing tests may need updating to the JSON-RPC transport, keep assertions'
   intent identical. Add transport unit tests (framing, id correlation, error
   mapping, timeout) with a fake TCP server (net.createServer in-test).

## Constraints

- No commits. Kotlin + TS changes stay in working tree.
- Don't touch `benchmarks/token-bench/`, `server/maestro/`, `test-app/`.
- The UiAutomation channel is exclusive: while verifying, don't run argent's
  `uiautomator dump` concurrently (bench-token may be driving argent configs —
  coordinate by checking `adb -s emulator-5554 shell ps | grep devicestream` and
  keeping your verification window short; if the instrumentation is stopped when
  you finish, restart it and say so in the report).

## Acceptance

Live: non-empty tree on Settings; DSL describe/tap/screenshot working end-to-end
over JSON-RPC. Suites green (dsl, mcp, plus the transport tests). Report: method
mapping table as implemented, tree size measured on Settings root, files changed,
any handler whose method name differed from expectations.
