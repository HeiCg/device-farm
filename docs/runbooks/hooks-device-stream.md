# Lifecycle Hooks & Device Control

Device Farm runs user-defined commands at well-defined lifecycle points around every job. Use these hooks to prepare the device (install an APK, clear caches, set a permission) before a test starts and to clean up afterwards.

Hooks come in two flavours:

- **`kind: 'shell'`** (this runbook) — a `/bin/sh -c` command with `{{template}}` interpolation. Lightest weight; ideal for one-shot `adb` / `xcrun simctl` calls or a tsx one-liner.
- **`kind: 'script'`** — a TypeScript snippet executed under `tsx` with `@device-stream/dsl` pre-bound. Selector-based interactions, multi-step flows, cross-platform. **See [`dsl-hooks.md`](./dsl-hooks.md) for the full reference** and Section 3 below for when to pick which.

This runbook covers:

1. The hook lifecycle and how setup/teardown maps to it.
2. The HTTP API for registering hooks.
3. Template variables passed into the command.
4. Using the `device-stream` binaries from inside a hook for richer device control.
5. Concrete examples for the most common setup/teardown needs.

---

## 1. The four lifecycle events

| Event | Fires | Typical use |
|---|---|---|
| `device.booted` | Once, after a device finishes booting and is added to the pool | One-time provisioning: grant permissions, push a config file, warm caches |
| `device.shutdown` | Once, just before a device is removed from the pool | Detach loggers, archive state |
| `test.before` | Per job, just before Maestro is invoked | **Setup** — install/replace APK, clear app data, set system clock, log in via deeplink |
| `test.after` | Per job, after Maestro exits (passed or failed) | **Teardown** — uninstall the app, dump logs, screenshot the home screen, push state to a bucket |

Hooks for the same event run **sequentially in registration order**. A hook with `failOnError: true` halts the chain if it exits non-zero; a hook with `failOnError: false` (the default) is best-effort — its outcome is recorded but the next hook still runs.

---

## 2. Registering a hook

All hooks are managed over `/api/hooks` (auth required).

```bash
# Create a setup hook (test.before)
curl -X POST http://localhost:3000/api/hooks \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d '{
    "name": "install-apk",
    "event": "test.before",
    "command": "adb -s {{serial}} install -r ./fixtures/app.apk",
    "platform": "android",
    "timeoutMs": 60000,
    "failOnError": true,
    "enabled": true
  }'

# List
curl http://localhost:3000/api/hooks

# Update
curl -X PUT http://localhost:3000/api/hooks/install-apk -d '{"timeoutMs": 90000, ...}'

# Delete
curl -X DELETE http://localhost:3000/api/hooks/install-apk

# Smoke-test the hook against a specific device without waiting for a real job
curl -X POST http://localhost:3000/api/hooks/install-apk/test \
  -H "Content-Type: application/json" \
  -d '{"deviceId": "<uuid>"}'
```

`HookDefinition` schema (from `server/hooks/schemas.ts`):

| Field | Type | Default | Notes |
|---|---|---|---|
| `name` | string (1–255) | — | Unique. Used as the `singletonKey` suffix on `hook.run`. |
| `event` | enum | — | `device.booted` \| `device.shutdown` \| `test.before` \| `test.after` |
| `kind` | enum | `'shell'` | `'shell'` \| `'script'`. Discriminates payload. See [`dsl-hooks.md`](./dsl-hooks.md) for `'script'`. |
| `command` | string (1–4096) | — | **shell hooks only.** Any shell command. Runs in the server's working directory, server environment. |
| `script` | string (1–64000) | — | **script hooks only.** TS source for the DSL runner. |
| `vars` | object | — | **script hooks only.** Default vars merged with `context.vars` at runtime. |
| `iosKind` | enum | — | **script hooks only.** `'simulator'` \| `'device'` — picks simctl vs go-ios on iOS. |
| `platform` | enum | `all` | `android` \| `ios` \| `all` — skips when context platform doesn't match. |
| `timeoutMs` | int (1000–300000) | `30000` | Hook process is killed past this. Raise for script hooks (tsx boot ~1–2s). |
| `failOnError` | bool | `false` | If `true`, non-zero exit halts the chain *and* fails the job. |
| `enabled` | bool | `true` | Quick toggle without deleting. |

You can also pre-load hooks at server start via `config.yaml`:

```yaml
hooks:
  - name: install-apk
    event: test.before
    command: adb -s {{serial}} install -r ./fixtures/app.apk
    platform: android
    timeoutMs: 60000
    failOnError: true
```

---

## 3. Template variables

The hook executor interpolates `{{var}}` placeholders against `HookContext` (`server/hooks/internal/hook-executor.ts`):

| Variable | Meaning |
|---|---|
| `{{device_id}}` | Internal device UUID (matches `devices.id`) |
| `{{emulator_id}}` | The AVD name (Android) or simulator UDID (iOS) |
| `{{serial}}` | The `adb` serial / simctl UDID — what you pass to `-s` |
| `{{platform}}` | `android` or `ios` |
| `{{port}}` | Allocated console/agent port; empty string if N/A |
| `{{job_id}}` | The job UUID for `test.before` / `test.after`; empty for `device.*` events |

Use `{{serial}}` for `adb` / `xcrun simctl`; use `{{job_id}}` to namespace per-job artifacts.

---

## 4. Calling `device-stream` from a hook

The `device-stream/` monorepo ships several binaries (under `device-stream/bin/`) and a node API (under `device-stream/packages/`) that give finer-grained device control than raw `adb`. Both are valid surfaces from inside a hook command.

### 4.1 The binaries

| Binary | Path | Platform | What it does |
|---|---|---|---|
| `android-grpc-stream` | `device-stream/bin/android-grpc-stream` | Android | Start the on-device gRPC tap/swipe/screenshot server. Used by sessions; can be triggered by hooks for one-off provisioning runs. |
| `sim-capture` (or `-private`, `-avcc`) | `device-stream/bin/sim-capture*` | iOS Sim | Launch the Swift ScreenCaptureKit MJPEG capturer. Mostly used by the streaming module, but useful as a hook for quick screen recordings. |

Because the server's working directory is the repo root, reference them as `./device-stream/bin/<name>` (or use an absolute path in production deployments). Always pass `{{serial}}` so the right device is targeted.

### 4.2 The node packages

For programmatic control beyond what `adb` / `simctl` offer, the `@device-stream/*` packages expose a `DeviceService` interface (`tap`, `typeText`, `screenshot`, `swipe`, `startMirroring`, ...). A hook can `npx tsx` a one-off script that imports the package and runs a precise sequence:

```bash
# test.before hook command
npx tsx device-stream/scripts/grant-permissions.ts {{serial}} {{platform}}
```

Where `device-stream/scripts/grant-permissions.ts` looks something like:

```ts
import { AndroidDeviceService } from '@device-stream/android';
import { IOSSimulatorManager } from '@device-stream/ios-simulator';

const [serial, platform] = process.argv.slice(2);
if (platform === 'android') {
  const svc = new AndroidDeviceService();
  await svc.connect(serial);
  // ... use svc.tap / svc.typeText / svc.screenshot
} else {
  const mgr = new IOSSimulatorManager();
  // ... use mgr methods
}
```

This pattern unlocks anything the streaming layer can do — including `tap(x, y)`, `typeText(...)`, `screenshot(...)`, and `swipe(...)` — from inside a hook, without writing custom adb glue.

### 4.3 Concurrency note

`device-stream` uses a `DeviceMutexManager` (per-device mutex) internally to serialize device commands. A hook that talks to the same device the test is about to run on is safe: the streaming module's mutex coordinates with anything the package does. **Do not** spawn long-lived `device-stream` streams from a hook — those belong in the streaming module and the hook will time out (default 30s).

---

## 5. Recipes

### 5.1 Setup: install a fresh build before every test

```yaml
hooks:
  - name: install-apk-android
    event: test.before
    command: adb -s {{serial}} install -r -d ./fixtures/app-debug.apk
    platform: android
    timeoutMs: 90000
    failOnError: true

  - name: install-app-ios
    event: test.before
    command: xcrun simctl install {{serial}} ./fixtures/App.app
    platform: ios
    timeoutMs: 90000
    failOnError: true
```

### 5.2 Setup: clear app data so tests start from a known state

```yaml
- name: clear-app-data-android
  event: test.before
  command: adb -s {{serial}} shell pm clear com.example.myapp
  platform: android
  timeoutMs: 10000
  failOnError: false
```

For iOS, use the same `--erase-state` flag or call into `IOSSimulatorManager.eraseAppData` via a tsx script (no native simctl equivalent).

### 5.3 Setup: grant runtime permissions via device-stream

```yaml
- name: grant-permissions
  event: test.before
  command: npx tsx device-stream/scripts/grant-permissions.ts {{serial}} {{platform}}
  timeoutMs: 30000
  failOnError: false
```

The script can issue precise taps/swipes through the permission dialog when `pm grant` is not enough (e.g. iOS location prompts).

### 5.4 Setup: seed test data

```yaml
- name: deep-link-login
  event: test.before
  command: adb -s {{serial}} shell am start -a android.intent.action.VIEW -d "myapp://login?token=$TEST_TOKEN"
  platform: android
  timeoutMs: 15000
  failOnError: false
```

`$TEST_TOKEN` is resolved from the server's environment, not the hook context — useful for short-lived test credentials managed outside the YAML.

### 5.5 Teardown: dump device logs before tearing down

```yaml
- name: dump-logcat
  event: test.after
  command: |
    mkdir -p ./storage/artifacts/{{job_id}} &&
    adb -s {{serial}} logcat -d > ./storage/artifacts/{{job_id}}/logcat.txt
  platform: android
  timeoutMs: 30000
  failOnError: false
```

The path lives under `storage.artifacts.path` so the retention sweeper (`lifecycle/retention-task.ts`) cleans it up alongside videos and screenshots after `retention_days`.

### 5.6 Teardown: take an extra screenshot through device-stream

```yaml
- name: post-test-screenshot
  event: test.after
  command: npx tsx device-stream/scripts/snap.ts {{serial}} {{platform}} ./storage/artifacts/{{job_id}}/post-test.png
  timeoutMs: 15000
  failOnError: false
```

The `snap.ts` script uses `DeviceService.screenshot()`, which on Android goes through the streaming module's pHash detector and on iOS goes through `xcrun simctl io ... screenshot`. The screenshot lands inside the per-job artifacts dir and shows up in the report viewer's debug tab automatically.

### 5.7 Teardown: uninstall when CI runs against a shared device

```yaml
- name: uninstall-app
  event: test.after
  command: adb -s {{serial}} uninstall com.example.myapp || true
  platform: android
  timeoutMs: 30000
  failOnError: false
```

`|| true` keeps the hook successful even if the app was never installed (e.g., the previous job's setup hook failed early).

### 5.8 Boot-time provisioning: warm caches once per emulator lifetime

```yaml
- name: warm-cache
  event: device.booted
  command: |
    adb -s {{serial}} shell am force-stop com.example.myapp &&
    adb -s {{serial}} shell pm trim-caches 999999G
  platform: android
  timeoutMs: 60000
  failOnError: false
```

`device.booted` runs once when the pool brings up an emulator and survives across many jobs. Use it for setup that's stable across jobs.

---

## 6. Observability & failure modes

Every hook execution writes a row to `hook_runs` with `operation_key`, exit code, duration, and a 1KB tail of stderr. Inspect via:

```bash
psql -d device_farm -c "SELECT operation_key, status, exit_code, duration_ms, stderr_tail FROM hook_runs ORDER BY started_at DESC LIMIT 20"
```

Terminal events (`hook.completed` and `hook.failed.retryExhausted`) land in the persisted `events` table with the same `correlation_id` as the originating `test.before`/`test.after` event — `git grep correlationId server/hooks/MODULE.md` for the contract.

Retries: `hook.run` has `retryLimit: 1` because hook commands are physical side-effects (installing an APK twice is fine; tapping a coordinate twice is not). Idempotency is enforced via the `hook_runs.operation_key` primary key, so a re-emit produces zero extra invocations.

If a hook with `failOnError: true` fails, the job moves to `failed` with `errorMessage` reflecting the hook name and exit code. The report viewer (`/jobs/<id>`) surfaces this in the failure-focus panel.

---

## 7. Pointers

- Schema: `server/hooks/schemas.ts`
- Executor (template interpolation lives at line ~208): `server/hooks/internal/hook-executor.ts`
- Module overview: `server/hooks/MODULE.md`
- device-stream binaries: `device-stream/bin/`
- device-stream node API: `device-stream/packages/{android,ios-simulator,ios-device}/`
- DSL package (for `kind: 'script'` hooks): `device-stream/packages/dsl/`
- Script-hook runner: `server/hooks/internal/script-runner.ts`
- Script-hook authoring guide: [`dsl-hooks.md`](./dsl-hooks.md)
- Retention behaviour for hook-generated artifacts: `docs/runbooks/drain.md` and `server/lifecycle/retention-task.ts`
