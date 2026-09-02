# @device-stream/dsl

High-level selector + orchestration DSL on top of `@device-stream/android-server` (HTTP), WDA (iOS), `adb`, `xcrun simctl`, and `go-ios`.

Designed to be executed inside device-farm `kind: 'script'` hooks and to power IDE autocomplete via its `.d.ts` surface.

## Why

The other `@device-stream/*` packages expose **primitives by coordinate** (`tap(x, y)`, `typeText(text)`, raw `/hierarchy` JSON). The DSL adds:

- **Rich selectors** — find elements by `id`, `text`, `contentDescription`, `className`, `packageName`, `index`. Each text field accepts an exact string **or** a `{ contains | regex | caseInsensitive | equals }` matcher, plus `enabled` / `visible` filters and a relative `containsDescendant`. Resolver under the hood: Android `/hierarchy` JSON, iOS WDA `/session/:id/source` XML (parsed into a **nested** tree).
- **Gestures & scrolling** — `swipe(...)`, `scroll(direction)`, and `scrollUntilVisible(selector)` (scrolls, settles, and re-reads the hierarchy until a visible match appears).
- **Fluent waits** — `awaitUntil(...).changeTo(...)`, `toAppear`, `toDisappear`, plus `waitForIdle()` to settle animations before reading the UI.
- **Agent/debug-friendly `describe()`** — a pruned, normalized, visible-only outline of the screen (ids/text/center coords) instead of raw hierarchy JSON.
- **Flow recording** — record a sequence of `ds.*` calls and replay it deterministically (YAML).
- **Cross-platform verbs** — `openUrl`, `installApp`, `launchApp`, `stopApp`, `setLocation`, `pressKey`, `screenshot`.
- **Android-only verbs** — `grantPermissions`, `enableInstallByThirdParty`, `openDownloads`. Throw `NotSupportedOnPlatformError` on iOS.
- **Same code, both platforms** — script written against `ds.*` runs on Android emulators, iOS simulators, and (most verbs) iOS physical devices.

## Install

It's a workspace package; from the project root:

```bash
npm install
npm run build -w @device-stream/dsl
```

For consumers outside this monorepo, install via the published package (once released):

```bash
npm install @device-stream/dsl
```

## Quick start

```ts
import { createSession } from '@device-stream/dsl';

const ds = await createSession({ serial: 'emulator-5554', platform: 'android' });

await ds.openUrl('https://hq.example.com');
await ds.get({ id: 'username' }).fill('ca4');
await ds.get({ id: 'password' }).fill('p@ssw0rd');
await ds.tapOn({ text: 'Sign in' });

const token = await ds.copyText({ id: 'session-token' });
await ds.installApp('/path/to/mseries.apk');
await ds.enableInstallByThirdParty('com.example.mseries');
await ds.grantPermissions('com.example.mseries');
await ds.launchApp('com.example.mseries');
await ds.get({ id: 'token-input' }).fill(token);
await ds.awaitUntil({ text: 'Syncing' }).changeTo({ text: 'Synced' });

await ds.close();
```

The same script works on iOS Simulator by changing the platform:

```ts
const ds = await createSession({ serial: '<UDID>', platform: 'ios', iosKind: 'simulator' });
```

On `iosKind: 'device'` (physical device via go-ios), most verbs still work; `grantPermissions`, `setLocation`, `openUrl`, and `openDownloads` throw `NotSupportedOnPlatformError`.

## API

### `createSession(opts)`

```ts
interface SessionOptions {
  serial: string;
  platform: 'android' | 'ios';
  iosKind?: 'simulator' | 'device';   // iOS only, default 'simulator'
  androidServerUrl?: string;          // default 'http://localhost:9008'
  wdaUrl?: string;                    // default 'http://localhost:8100'
  wdaSessionId?: string;              // reuse an existing WDA session
  defaultTimeoutMs?: number;          // default 10000
  pollIntervalMs?: number;            // default 250
  androidMaxElements?: number;        // Android only, hierarchy() element cap, default 500
  wdaTimeoutMs?: number;              // iOS only, per-request WDA HTTP timeout, default 30000
}
```

### Selectors

```ts
type StringMatch =
  | string                                  // exact, case-sensitive equality
  | { equals?: string; contains?: string; regex?: string; caseInsensitive?: boolean };

interface Selector {
  id?: StringMatch;            // Android resource-id (stripped pkg prefix) / iOS accessibility id
  text?: StringMatch;          // visible text or value
  contentDescription?: StringMatch;
  className?: StringMatch;
  packageName?: StringMatch;
  index?: number;              // when multiple match, pick this one (default 0)
  enabled?: boolean;           // require el.enabled === this
  visible?: boolean;           // require visibility (unknown-visibility nodes are permitted)
  containsDescendant?: Selector; // relative: element must have a descendant matching this
}
```

A bare string is exact equality (back-compatible). The object form composes constraints — **all** provided constraints must hold; `caseInsensitive` applies to `equals` / `contains` / `regex`.

```ts
await ds.tapOn({ text: { contains: 'Sign' } });               // substring
await ds.get({ id: { regex: 'btn_(login|signin)$' } }).tap(); // regex
await ds.tapOn({ className: 'Row', containsDescendant: { text: 'Delete' } }); // relative
await ds.get({ text: 'Submit', visible: true }).tap();        // only if visible
```

### Session methods

| Method | Android | iOS Simulator | iOS Device |
|---|---|---|---|
| `openUrl(url)` | `am start VIEW -d` | `simctl openurl` | ❌ |
| `openDownloads()` | intent to `/Download` doc | ❌ | ❌ |
| `pressKey(key)` | `/key` keycode | WDA `pressButton` / `homescreen` | same |
| `screenshot({scale?})` | `/screenshot` JPEG, downscaled capture-side by `scale` | WDA b64 (full-res; `scale` ignored) | same |
| `hierarchy()` | `/hierarchy` JSON parsed → `UIElement[]` (capped at `androidMaxElements`, default 500) | WDA XML parsed | same |
| `get(selector)` → `ElementHandle` | hierarchy → bounds → resolve | same | same |
| `tapOn(selector)` | resolve + `/tap` | resolve + WDA `actions` | same |
| `swipe({fromX,fromY,toX,toY,durationMs?})` | `/swipe` (duration→steps) | WDA pointer `actions` | same |
| `scroll(direction, opts?)` | swipe across screen (from `/info` size) | swipe across screen (WDA `/window/size`) | same |
| `scrollUntilVisible(selector, opts?)` | scroll + settle + re-read until visible | same | same |
| `waitForIdle(timeoutMs?)` | `/waitForIdle` | poll `/source` until two reads settle (honors `timeoutMs`) | same |
| `describe()` / `describeText()` | pruned visible-only tree / indented outline | same | same |
| `copyText(selector)` | hierarchy text | source XML value/label | same |
| `awaitUntil(s).changeTo(t)` | poll `/hierarchy` | poll WDA `/source` | same |
| `installApp(path)` | `adb install -r -g` | `simctl install` | `ios install --udid --path` |
| `launchApp(id)` | `monkey -p ... LAUNCHER 1` | `simctl launch` | `ios launch --udid` |
| `stopApp(id)` | `am force-stop` | `simctl terminate` | `ios kill` |
| `grantPermissions(pkg, perms?)` | `pm grant` (auto-discovery with `'*'`) | `simctl privacy grant` (translates Android names to TCC) | ❌ |
| `enableInstallByThirdParty(pkg)` | `appops set REQUEST_INSTALL_PACKAGES allow` | ❌ | ❌ |
| `setLocation(lat, lon)` | `adb emu geo fix` (emulator only) | `simctl location set` | ❌ |
| `close()` | no-op | release WDA session | release WDA session |

Platform notes:

- **`setLocation(lat, lon)` on Android is emulator-only.** It runs `adb emu geo fix`,
  which only reaches the emulator's geo console. Physical Android devices have no
  general "set location" without an installed mock-location provider, so the call
  will fail there.
- **`screenshot({ scale })` is honored only on Android.** android-server downscales
  the bitmap capture-side, so a low `scale` shrinks the JPEG before it leaves the
  device. iOS/WDA returns a full-resolution PNG with no capture-time or host-side
  downscale (no image library is bundled), so `scale < 1` is ignored on iOS and a
  one-time warning is logged. Neither driver enforces a hard byte cap; callers that
  need one enforce it after encoding.
- **`clear()` never presses BACK.** Android clears the focused field via the
  android-server `clearText` RPC; iOS via WDA's element `/clear`. (The earlier
  implementation pressed BACK ~50×, which on Android dismissed the IME and walked
  out of the app.)
- **`hierarchy()` on Android is capped** at `androidMaxElements` (default 500). When
  a read hits the cap the tree is flagged truncated and `ElementNotFoundError`
  diagnostics hint at raising it via `SessionOptions.androidMaxElements`.

### `ElementHandle`

Chainable handle returned by `ds.get(selector)`. Implements `PromiseLike<UIElement>` so you can `await ds.get(s)` to materialize the element.

```ts
interface ElementHandle extends PromiseLike<UIElement> {
  fill(text: string): Promise<void>;          // tap + typeText
  tap(): Promise<void>;
  longPress(durationMs?: number): Promise<void>;
  clear(): Promise<void>;                     // tap + clear focused field (never BACK)
  text(): Promise<string>;
  exists(): Promise<boolean>;
  waitFor(opts?: { timeoutMs?: number }): Promise<UIElement>;
}
```

### `WaitHandle`

Returned by `ds.awaitUntil(selector)`. Polls `hierarchy()` until the predicate passes or the timeout fires.

```ts
interface WaitHandle {
  toAppear(): Promise<void>;
  toDisappear(): Promise<void>;
  changeTo(target: Selector): Promise<void>;
}
```

### Gestures & scrolling

```ts
// Raw swipe in screen coordinates.
await ds.swipe({ fromX: 200, fromY: 600, toX: 200, toY: 200, durationMs: 300 });

// One page in a direction. `direction` is the way you travel through content —
// the finger moves the opposite way (scroll 'down' reveals lower content).
await ds.scroll('down');                          // distance defaults to 0.6 of the screen
await ds.scroll('right', { distance: 0.8 });

// Scroll until a (visible) element appears, then act on it.
const el = await ds.scrollUntilVisible({ text: 'Place order' }, { direction: 'down', maxScrolls: 8 });
await ds.tapOn({ text: 'Place order' });
```

`scrollUntilVisible` reads the hierarchy, scrolls if the (visible) selector is absent, calls `waitForIdle` to settle animations, and repeats up to `maxScrolls` (default 10) before throwing `ElementNotFoundError`.

### `describe()` — agent/debug snapshot

`describe()` returns a pruned, normalized, **visible-only** tree (anonymous structural containers with no identifiable descendants are dropped); `describeText()` renders it as an indented outline you can hand to an LLM or print while debugging:

```ts
console.log(await ds.describeText());
// XCUIElementTypeWindow @195,422
//   Button #login "Log In" @195,725
//   StaticText "Total: $30" @120,300
```

Each node carries `center` (a tap target), `id`, `text`, `contentDescription`, `className`, and `enabled`.

### Flow recording

Record `ds.*` calls and replay them deterministically — handy for repro, fixtures, and CI:

```ts
import { FlowRecorder, serializeFlow, parseFlow, executeFlow } from '@device-stream/dsl';

const rec = new FlowRecorder(ds, 'checkout');
await rec.launchApp('com.example');
await rec.tapOn({ text: 'Buy' });
await rec.fill({ id: 'qty' }, '3');
const flow = rec.finish();

const yaml = serializeFlow(flow);     // persist
await executeFlow(ds, parseFlow(yaml)); // replay later (or via the MCP `dsl_run_flow` tool)
```

Flows serialize to YAML with JSON-inline step args (valid YAML, exact round-trip):

```yaml
# device-stream flow
name: checkout
steps:
  - action: launchApp
    args: {"id":"com.example"}
  - action: tapOn
    args: {"selector":{"text":"Buy"}}
  - action: fill
    args: {"selector":{"id":"qty"},"text":"3"}
```

## Permission name translation (iOS)

When `grantPermissions(pkg, perms)` runs on `iosKind: 'simulator'`, Android-style permission strings are auto-translated to `simctl privacy` services:

| Android | iOS service |
|---|---|
| `android.permission.CAMERA` | `camera` |
| `android.permission.RECORD_AUDIO` | `microphone` |
| `android.permission.READ_CONTACTS` / `WRITE_CONTACTS` | `contacts` |
| `android.permission.READ_CALENDAR` / `WRITE_CALENDAR` | `calendar` |
| `android.permission.ACCESS_FINE_LOCATION` / `COARSE_LOCATION` | `location` |
| `android.permission.ACCESS_BACKGROUND_LOCATION` | `location-always` |
| `android.permission.READ_EXTERNAL_STORAGE` / media images / videos | `photos` |
| `android.permission.WRITE_EXTERNAL_STORAGE` | `photos-add` |
| `android.permission.ACTIVITY_RECOGNITION` | `motion` |

Native iOS service names (e.g. `'camera'`, `'location-always'`, `'all'`) also work directly. `'*'` grants `all`.

## Runtime dependencies

These must be present on `$PATH` when the DSL runs:

- **`adb`** — for Android verbs (install, grant, openurl, geo). The `@device-stream/android-server` HTTP must also be running on `localhost:9008` for primitives (tap, type, hierarchy).
- **`xcrun`** — for iOS Simulator verbs (`simctl install`, `simctl privacy`, `simctl openurl`, `simctl location`).
- **`ios`** (from go-ios) — for iOS device verbs (`ios install`, `ios launch`).
- **WDA** running on `localhost:8100` — for iOS UI primitives (tap, type, source).

## Errors

- `NotSupportedOnPlatformError(method, platform)` — verb is not implemented for the current platform/kind. The `method` property carries the verb name and platform-qualifier (e.g. `'grantPermissions (iOS device)'`).
- `ElementNotFoundError(selector, timeoutMs)` — selector did not resolve within the default or per-call timeout.

## Architecture

```
src/
├── index.ts              # public surface: createSession + types + flow exports
├── types.ts              # Selector, StringMatch, UIElement, gesture/scroll opts, errors
├── session.ts            # DeviceStreamSessionImpl + Element/Wait handles + gestures + polling
├── flow.ts               # FlowRecorder + serialize/parse/execute (YAML)
├── shell.ts              # runCmd / adb / adbShell / simctl (execFile, no shell)
├── drivers/
│   ├── types.ts          # internal Driver interface (incl. swipe/screenSize/waitForIdle)
│   ├── android.ts        # android-server :9008 + adb
│   └── ios.ts            # WDA :8100 + simctl + go-ios
└── selectors/
    ├── matcher.ts        # matchString + elementMatches + flattenTree + findElement + centerOf
    ├── describe.ts       # pruned/normalized tree (describeElements + renderDescription)
    └── wda-xml.ts        # zero-dep nested parser for WDA source XML
```

## See also

- [`docs/runbooks/dsl-hooks.md`](../../../docs/runbooks/dsl-hooks.md) — authoring `kind: 'script'` hooks that use this DSL.
- [`docs/runbooks/hooks-device-stream.md`](../../../docs/runbooks/hooks-device-stream.md) — shell-hook recipes and the `device-stream` binaries.

## License

MIT
