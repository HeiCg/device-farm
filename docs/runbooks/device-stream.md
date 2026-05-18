# device-stream

`device-stream` is the in-repo monorepo (under `device-stream/`) that powers Device Farm's two device-facing capabilities: **screen streaming** and **device control**. This runbook explains what it is, when you need it, and how to use it from each integration point — including the most common one for test authors: setup/teardown hooks around Maestro jobs.

> Looking for the deep dive on hooks? See [`hooks-device-stream.md`](./hooks-device-stream.md) — that runbook is a focused companion to this one.

---

## 1. What it is

A set of modular npm workspaces (`@device-stream/*`) plus a handful of native binaries that handle the platform-specific work of talking to phones and emulators.

| Package | Platform | Purpose |
|---|---|---|
| `@device-stream/core` | all | Shared types (`Device`, `VideoStreamMetadata`), interfaces (`DeviceService`), the WebSocket binary protocol, and `DeviceMutexManager` for per-device concurrency |
| `@device-stream/android` | all | Android streaming via TangoADB + scrcpy H.264; `AndroidDeviceService` (`tap`/`typeText`/`screenshot`/`swipe`) |
| `@device-stream/ios-simulator` | macOS | iOS Simulator lifecycle (`IOSSimulatorManager` — create/boot/install/launch/delete) + `CaptureService` (native Swift MJPEG via ScreenCaptureKit) |
| `@device-stream/ios-device` | macOS | Physical iOS devices via go-ios + WebDriverAgent + MJPEG |
| `@device-stream/android-server` | all (private) | On-device Kotlin JSON-RPC server (port 9008) that bypasses adb-shell overhead for tap/type/screenshot |

Plus four native binaries shipped under `device-stream/bin/` (built by `npm install` postinstall hooks):

- `android-grpc-stream` — Android streaming process used internally by the streaming module.
- `sim-capture`, `sim-capture-private`, `sim-capture-avcc` — Swift binaries (ScreenCaptureKit) for iOS Simulator MJPEG.

Inside Device Farm the streaming module (`server/streaming/`) and sessions module (`server/sessions/`) consume these packages to render the live preview that appears at `/devices/[id]/inspector` and inside the `/jobs/[id]` "Live Preview" tab while a test is running.

---

## 2. How to use it

There are three integration points, ordered from least to most invasive. Pick the highest one that solves your problem.

### Option A — Don't write any code (use the built-in features)

If you only need to **see** what a device is doing, Device Farm already does this for you:

- Open `/devices/<id>/inspector` for a live preview of any pooled device.
- Open `/jobs/<id>` while a job is running — the "Live Preview" tab streams the device that's executing your Maestro flow.
- When a job terminates, the recorded video is attached as an artifact and rendered by `SyncVideoPlayer` in the report viewer.

You don't import `@device-stream/*` and you don't run any scripts. The streaming module does it.

### Option B — Stream-only from your own process

If you need to subscribe to frames yourself (e.g., feed them into a custom UI, an OCR pipeline, an ML model), import the package directly:

```ts
import { createCaptureService } from '@device-stream/ios-simulator';

const capture = createCaptureService();
capture.on('frame', (udid, jpegBuffer) => {
  // jpegBuffer is a Buffer; do whatever you want with it
});
await capture.start(udid);
// ... later
await capture.stop(udid);
```

```ts
import { ScrcpyService } from '@device-stream/android';
import { Adb } from '@yume-chan/adb';

const scrcpy = new ScrcpyService();
const adb = new Adb(/* transport */);
const session = await scrcpy.start(adb, { codec: 'h264', bitrate: 4_000_000 });
session.on('frame', (h264Buffer) => { /* ... */ });
```

This path is read-only — frames flow out, nothing flows in. Use it when streaming is the goal and you don't need to tap/type. Keep the session alive for as long as you need frames and **always** call `stop` to release the device mutex held by `DeviceMutexManager`.

### Option C — Control the device (taps, type, swipe, screenshot)

When you need to drive the device — installing test data, dismissing a one-time onboarding screen, granting permissions, dumping logcat — use the `DeviceService` interface exposed by each platform package:

```ts
import { AndroidDeviceService } from '@device-stream/android';

const svc = new AndroidDeviceService();
await svc.connect(serial);
await svc.tap(540, 960);
await svc.typeText('hello');
const png = await svc.screenshot();
await svc.swipe({ from: [540, 1200], to: [540, 600], durationMs: 300 });
```

```ts
import { createIOSSimulatorManager } from '@device-stream/ios-simulator';

const mgr = createIOSSimulatorManager();
await mgr.bootDevice(udid);
await mgr.installApp(udid, '/path/to/App.app');
await mgr.launchApp(udid, 'com.example.myapp');
// ... after the test
await mgr.eraseDevice(udid);
```

The cleanest place to wire these calls is a small `tsx` script invoked from a hook (Option C.1 below). For longer-lived in-process control, you can also import the packages directly into the server (Option C.2).

---

## 3. The two main use cases

### Use case 1 — Screen streaming only (read frames, don't touch the device)

You want frames out of the device but you do **not** need to send commands.

- **Inside the Device Farm UI:** nothing to do — `/devices/<id>/inspector` and `/jobs/<id>` Live Preview already cover this. The streaming module owns the mutex and lifecycle.
- **From your own code:** use Option B above (`createCaptureService` / `ScrcpyService`). Treat the device as read-only. Stop the session as soon as you have the frames you need — long-lived sessions hold the per-device mutex and block any control work.

What you **don't** do in this mode:
- Don't call `tap`/`typeText`/`swipe` on a service started for streaming. Those methods exist on the same service but issuing them while frames are flowing fights the streaming codec.
- Don't run a streaming session inside a hook (hooks have a 30s timeout — streams are long-lived).

Where streaming lives in the codebase:
- Producer: `server/streaming/` and `device-stream/packages/{android,ios-simulator,ios-device}`
- Consumer: web UI via `useDeviceStream` and the `DevicePreview` component
- Wire format: binary WebSocket protocol declared in `device-stream/packages/core/protocol.ts` (METADATA, FRAME, DATA, PING/PONG, COMMAND messages)

### Use case 2 — Device control inside a job's setup/teardown hooks

You need to prepare or clean up the device around a specific job: install a build, clear app data, dump logcat, grant permissions. This is the high-leverage path for test authors — you don't need to touch the streaming module.

Device Farm exposes four lifecycle events for this: `device.booted`, `device.shutdown`, `test.before`, `test.after`. Hooks run as shell commands with `{{var}}` placeholders that Device Farm interpolates from the device context (`{{serial}}`, `{{platform}}`, `{{job_id}}`, etc.).

The simplest hooks call `adb` or `xcrun simctl` directly:

```yaml
hooks:
  - name: install-apk-android
    event: test.before
    command: adb -s {{serial}} install -r ./fixtures/app-debug.apk
    platform: android
    timeoutMs: 90000
    failOnError: true
```

For anything that adb/simctl can't express well (precise tap sequences, multi-step UI navigation, programmatic UiAutomator queries), wrap a tsx script around the device-stream packages and invoke it from the hook:

```yaml
- name: grant-runtime-permissions
  event: test.before
  command: npx tsx device-stream/scripts/grant-permissions.ts {{serial}} {{platform}}
  timeoutMs: 30000
  failOnError: false
```

Where `device-stream/scripts/grant-permissions.ts` is a small script that uses `AndroidDeviceService.tap()` / `IOSSimulatorManager` to dismiss a permission dialog deterministically — something raw `pm grant` can't do for runtime prompts on iOS.

Full reference (HookContext fields, all template variables, observability, retries, idempotency, six recipes for common setup/teardown patterns): **[`hooks-device-stream.md`](./hooks-device-stream.md)**.

What to keep in mind when controlling the device from hooks:
- **Per-device mutex.** `DeviceMutexManager` in `@device-stream/core` serialises all calls against a given serial. A hook talking to the device is safe even if the streaming module is broadcasting frames for `/jobs/<id>` Live Preview — the mutex coordinates both sides.
- **Hook timeout (default 30s, max 5min).** Don't sleep inside a hook. If your provisioning legitimately takes longer, raise `timeoutMs` per hook.
- **Side-effects.** The `hook.run` queue has `retryLimit: 1` because hook commands are physical (tapping a button twice is not idempotent). Idempotency is enforced via `hook_runs.operation_key`. Write your scripts to be safe to re-run anyway — disconnects happen.
- **No long-lived streams.** Don't start a streaming session in a hook. Streams belong in the streaming module's process. If you want a screenshot for diagnostics, use `DeviceService.screenshot()` and write the JPEG to `./storage/artifacts/{{job_id}}/`.

---

## 4. Pointers

- Package READMEs: `device-stream/README.md` and per-package `device-stream/packages/*/README.md`
- Architecture / protocols: `device-stream/CLAUDE.md`
- Hooks-specific deep dive: [`docs/runbooks/hooks-device-stream.md`](./hooks-device-stream.md)
- Streaming module wiring (consumer of device-stream): `server/streaming/MODULE.md`
- Sessions module wiring (alternative consumer for ad-hoc device control): `server/sessions/MODULE.md`
- Per-device concurrency control: `device-stream/packages/core/mutex.ts` (`DeviceMutexManager`)
- WebSocket binary protocol: `device-stream/packages/core/protocol.ts`
