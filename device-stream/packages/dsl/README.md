# @device-stream/dsl

High-level selector + orchestration DSL on top of `@device-stream/android-server` (HTTP), WDA (iOS), `adb`, `xcrun simctl`, and `go-ios`.

Designed to be executed inside device-farm `kind: 'script'` hooks and to power IDE autocomplete via its `.d.ts` surface.

## Why

The other `@device-stream/*` packages expose **primitives by coordinate** (`tap(x, y)`, `typeText(text)`, raw `/hierarchy` JSON). The DSL adds:

- **Selectors** — find elements by `id`, `text`, `contentDescription`, `className`, `packageName`, `index`. Resolver under the hood: Android `/hierarchy` JSON, iOS WDA `/session/:id/source` XML.
- **Fluent waits** — `awaitUntil(...).changeTo(...)`, `toAppear`, `toDisappear`.
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
}
```

### Selectors

```ts
interface Selector {
  id?: string;              // Android resource-id (stripped pkg prefix) / iOS accessibility id
  text?: string;            // visible text or value
  contentDescription?: string;
  className?: string;
  packageName?: string;
  index?: number;           // when multiple match, pick this one (default 0)
}
```

### Session methods

| Method | Android | iOS Simulator | iOS Device |
|---|---|---|---|
| `openUrl(url)` | `am start VIEW -d` | `simctl openurl` | ❌ |
| `openDownloads()` | intent to `/Download` doc | ❌ | ❌ |
| `pressKey(key)` | `/key` keycode | WDA `pressButton` / `homescreen` | same |
| `screenshot()` | `/screenshot` JPEG | WDA b64 | same |
| `hierarchy()` | `/hierarchy` JSON parsed → `UIElement[]` | WDA XML parsed | same |
| `get(selector)` → `ElementHandle` | hierarchy → bounds → resolve | same | same |
| `tapOn(selector)` | resolve + `/tap` | resolve + WDA `actions` | same |
| `copyText(selector)` | hierarchy text | source XML value/label | same |
| `awaitUntil(s).changeTo(t)` | poll `/hierarchy` | poll WDA `/source` | same |
| `installApp(path)` | `adb install -r -g` | `simctl install` | `ios install --udid --path` |
| `launchApp(id)` | `monkey -p ... LAUNCHER 1` | `simctl launch` | `ios launch --udid` |
| `stopApp(id)` | `am force-stop` | `simctl terminate` | `ios kill` |
| `grantPermissions(pkg, perms?)` | `pm grant` (auto-discovery with `'*'`) | `simctl privacy grant` (translates Android names to TCC) | ❌ |
| `enableInstallByThirdParty(pkg)` | `appops set REQUEST_INSTALL_PACKAGES allow` | ❌ | ❌ |
| `setLocation(lat, lon)` | `adb emu geo fix` (emulator only) | `simctl location set` | ❌ |
| `close()` | no-op | release WDA session | release WDA session |

### `ElementHandle`

Chainable handle returned by `ds.get(selector)`. Implements `PromiseLike<UIElement>` so you can `await ds.get(s)` to materialize the element.

```ts
interface ElementHandle extends PromiseLike<UIElement> {
  fill(text: string): Promise<void>;          // tap + typeText
  tap(): Promise<void>;
  longPress(durationMs?: number): Promise<void>;
  clear(): Promise<void>;                     // best-effort
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
├── index.ts              # public surface: createSession + types
├── types.ts              # Selector, UIElement, SessionOptions, errors
├── session.ts            # DeviceStreamSessionImpl + Element/Wait handles + polling
├── shell.ts              # runCmd / adb / adbShell / simctl (execFile, no shell)
├── drivers/
│   ├── types.ts          # internal Driver interface
│   ├── android.ts        # android-server :9008 + adb
│   └── ios.ts            # WDA :8100 + simctl + go-ios
└── selectors/
    ├── matcher.ts        # findElement + centerOf
    └── wda-xml.ts        # zero-dep parser for WDA source XML
```

## See also

- [`docs/runbooks/dsl-hooks.md`](../../../docs/runbooks/dsl-hooks.md) — authoring `kind: 'script'` hooks that use this DSL.
- [`docs/runbooks/hooks-device-stream.md`](../../../docs/runbooks/hooks-device-stream.md) — shell-hook recipes and the `device-stream` binaries.

## License

MIT
