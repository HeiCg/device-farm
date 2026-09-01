# DSL Script Hooks (`kind: 'script'`)

Lifecycle hooks now have two flavours: the legacy `kind: 'shell'` (a shell command interpolated with `{{template}}` vars, see [`hooks-device-stream.md`](./hooks-device-stream.md)) and the new `kind: 'script'`, which runs a TypeScript snippet under `tsx` with a pre-bound `@device-stream/dsl` session.

Use `kind: 'script'` when you need:

- **Selector-based interactions** — `ds.get({ id: 'username' }).fill(...)` instead of pixel taps.
- **Multi-step flows** — open URL → fill form → tap → wait → install APK → grant permissions, all in one ordered block.
- **Cross-platform code** — the same script runs against Android emulators and iOS Simulators.
- **Typed autocomplete** — when authored in the web UI, the editor loads the DSL `.d.ts` and surfaces every verb + parameter inline.

If you only need to shell out to `adb` or `xcrun simctl`, stay on `kind: 'shell'` — it's lighter (no `tsx` boot).

---

## 1. Anatomy of a script hook

```yaml
hooks:
  - name: install-and-login
    event: test.before
    kind: script               # NEW — defaults to 'shell' if omitted
    platform: all
    timeoutMs: 120000
    failOnError: true
    enabled: true
    iosKind: simulator         # NEW, iOS only. 'simulator' (default) or 'device'.
    vars:                      # NEW. Default per-invocation variables.
      apkPath: "/artifacts/mseries.apk"
      packageName: "com.example.mseries"
    script: |
      await ds.openUrl(vars.url);
      await ds.get({ id: 'username' }).fill(vars.username);
      await ds.get({ id: 'password' }).fill(vars.password);
      await ds.tapOn({ text: 'Sign in' });

      const token = await ds.copyText({ id: 'token' });

      await ds.installApp(vars.apkPath);
      await ds.enableInstallByThirdParty(packageName);
      await ds.grantPermissions(packageName);

      await ds.launchApp(packageName);
      await ds.get({ id: 'token-input' }).fill(token);
      await ds.awaitUntil({ text: 'Sync' }).changeTo({ text: 'Synced' });
```

What the server does when this fires:

1. The hook executor builds the merged `vars` (definition `vars` ← per-invocation `context.vars`, context wins).
2. It writes a temp file `<projectRoot>/.df-hook-tmp/run-XXX/hook.mts` whose body is your `script:` wrapped in this prelude:
   ```ts
   import { createSession } from '@device-stream/dsl';
   const ctx = JSON.parse(process.env.DS_SCRIPT_CTX);
   const vars = JSON.parse(process.env.DS_SCRIPT_VARS);
   const { url, username, password, packageName /* every valid-identifier key in vars */ } = vars;
   const ds = await createSession({ serial: ctx.serial, platform: ctx.platform, iosKind: '<your iosKind>' });
   try {
     /* your script body */
   } finally {
     await ds.close();
   }
   ```
3. It runs the file via the project's local `node_modules/.bin/tsx` (falls back to `npx --yes tsx` if missing).
4. Captures stdout/stderr (capped at 10 KB each), surfaces them in the `HookResult`, deletes the temp dir.

---

## 2. Schema (Zod source-of-truth)

From `server/hooks/schemas.ts`:

| Field | Type | Default | Notes |
|---|---|---|---|
| `name` | string (1–255) | — | Unique. |
| `event` | enum | — | `device.booted` \| `device.shutdown` \| `test.before` \| `test.after` |
| `kind` | enum | `'shell'` | `'shell'` \| `'script'`. Discriminates payload. |
| `command` | string (1–4096) | — | **shell hooks only.** Required when `kind: 'shell'`. |
| `script` | string (1–64000) | — | **script hooks only.** Required when `kind: 'script'`. TS source. |
| `vars` | object | — | **script hooks only.** Default vars. Merged with `context.vars` at runtime. |
| `iosKind` | enum | — | **script hooks only, iOS only.** `'simulator'` (default) or `'device'`. Selects simctl vs go-ios. |
| `platform` | enum | `'all'` | `'android'` \| `'ios'` \| `'all'` |
| `timeoutMs` | int (1000–300000) | `30000` | Whole-script timeout including `tsx` startup (~1–2s). Default may be tight; raise for installs. |
| `failOnError` | bool | `false` | Non-zero exit halts the chain *and* fails the job. |
| `enabled` | bool | `true` | Quick toggle. |

A schema `.refine(...)` enforces that exactly one of `command` / `script` is present for the chosen `kind`.

---

## 3. What's in scope inside `script:`

When the executor runs your snippet it pre-binds these names without imports:

| Name | Type | Source |
|---|---|---|
| `ds` | `DeviceStreamSession` | `await createSession({ serial: ctx.serial, platform: ctx.platform, iosKind })` |
| `ctx` | `HookContext` | The full hook context: `deviceId`, `emulatorId`, `serial`, `platform`, `port`, `jobId?`, `vars?` |
| `vars` | `Record<string, any>` | Merged `{ ...hook.vars, ...context.vars }` |
| `<key>` for each valid identifier in `vars` | `any` | Destructured into the prelude — e.g. `vars: { url, username }` makes `url` and `username` available directly. |
| `console.log/warn/error` | standard | stdout/stderr are captured into the hook result. |

Top-level `await` works (the wrapper file is `.mts` → ESM under `tsx`).

Keys in `vars` that are NOT valid JS identifiers (e.g. `"weird-key"`, `"123foo"`) are skipped from the destructure and must be accessed as `vars["weird-key"]`.

---

## 4. Passing per-invocation `vars`

The hook definition's `vars` field is a **default** baseline. Each trigger source can supply additional vars that override:

```ts
// server side, when emitting the test.before event (e.g. from a Job pipeline):
await fastify.hookExecutor.execute('test.before', {
  deviceId, emulatorId, serial, platform, port, jobId,
  vars: {
    url: 'https://hq.example.com',
    username: 'ca4',
    password: '<resolved-from-secret-store>',
  },
});
```

When testing manually via the REST API, pass `vars` in the body:

```bash
curl -X POST http://localhost:3000/api/hooks/install-and-login/test \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d '{
    "deviceId": "<uuid>",
    "vars": {
      "url": "https://hq.example.com",
      "username": "ca4",
      "password": "p@ss"
    }
  }'
```

`context.vars` always overrides `hook.vars` on conflict. Shell hooks (`kind: 'shell'`) also receive `vars` via:

- `DEVICE_FARM_VAR_<KEY>` env vars (only for keys that are valid identifiers)
- `DEVICE_FARM_VARS_JSON` env var (the full bag for `jq`)

---

## 5. Authoring in the web UI

`/settings` has a hook form with a **KIND** selector at the top:

- **Shell command** — textarea + template variable reference (unchanged).
- **DSL script (TypeScript)** — Monaco editor pre-configured with:
  - Strict TypeScript language service.
  - `@device-stream/dsl/dist/index.d.ts` and `types.d.ts` loaded as virtual files, so `import { ... } from '@device-stream/dsl'` resolves.
  - Ambient declarations that make `ds`, `vars`, `ctx`, `console` available without imports (mirrors the runtime wrapper).
  - Default vars editor (JSON textarea) below the editor.
  - iOS backend selector (simulator / device) when platform is iOS or all.

Autocomplete examples:

- `ds.` → full surface (`openUrl`, `installApp`, `grantPermissions`, …).
- `ds.get({` → field hints for `Selector` (`id`, `text`, `contentDescription`, `className`, `index`, …).
- `ds.get({ id: 'x' }).` → handle methods (`fill`, `tap`, `longPress`, `clear`, `text`, `exists`, `waitFor`).
- Type errors render inline (red squiggles) using the real TypeScript checker — the editor's diagnostics match what `tsx` will execute.

The editor is dynamically imported (`browser`-only) so SSR isn't affected. Monaco workers are configured via `new URL(..., import.meta.url)` so Vite bundles them automatically.

---

## 6. Worked examples

### 6.1 Install + login + verify sync (the user's mSeries flow)

```yaml
- name: provision-and-login
  event: test.before
  kind: script
  platform: android
  timeoutMs: 180000
  failOnError: true
  vars:
    apkPath: "/artifacts/mseries.apk"
    packageName: "com.springwireless.mseries"
  script: |
    await ds.openUrl(vars.hqUrl);
    await ds.get({ id: 'username' }).fill(vars.username);
    await ds.get({ id: 'password' }).fill(vars.password);
    await ds.tapOn({ text: 'Generate installation' });

    const token = await ds.copyText({ id: 'token' });

    await ds.openDownloads();
    await ds.installApp(vars.apkPath);
    await ds.enableInstallByThirdParty(packageName);
    await ds.grantPermissions(packageName);

    await ds.launchApp(packageName);
    await ds.get({ id: 'token' }).fill(token);
    await ds.get({ id: 'username' }).fill(vars.username);
    await ds.get({ id: 'password' }).fill(vars.password);

    await ds.awaitUntil({ text: 'Sync' }).changeTo({ text: 'Synced' });
```

The PR-driven Azure run dispatches `test.before` with `context.vars = { hqUrl, username, password }` filled from the parsed `device-script` block + a server-side credential store.

### 6.2 Setup: clear app + grant + geolocate (cross-platform)

```yaml
- name: clean-slate-with-location
  event: test.before
  kind: script
  platform: all
  timeoutMs: 60000
  vars:
    packageName: "com.example.app"
  script: |
    await ds.stopApp(packageName);
    await ds.grantPermissions(packageName, [
      'android.permission.CAMERA',                  // → iOS 'camera'
      'android.permission.ACCESS_FINE_LOCATION',    // → iOS 'location'
    ]);
    await ds.setLocation(-23.5505, -46.6333);
    await ds.launchApp(packageName);
```

Single source — Android translates the permissions to `pm grant`, iOS Simulator translates to `simctl privacy grant`.

### 6.3 Teardown: dump UI hierarchy to artifacts

```yaml
- name: post-test-hierarchy-dump
  event: test.after
  kind: script
  platform: all
  timeoutMs: 15000
  script: |
    const tree = await ds.hierarchy();
    const fs = await import('node:fs/promises');
    await fs.mkdir(`./storage/artifacts/${ctx.jobId}`, { recursive: true });
    await fs.writeFile(
      `./storage/artifacts/${ctx.jobId}/hierarchy.json`,
      JSON.stringify(tree, null, 2),
    );
    console.log(`wrote ${tree.length} elements`);
```

The retention sweeper (`lifecycle/retention-task.ts`) cleans these up alongside videos.

### 6.4 Wait for an external sync to converge

```yaml
- name: wait-for-sync-banner
  event: test.before
  kind: script
  timeoutMs: 90000
  script: |
    await ds.awaitUntil({ text: 'Syncing' }, { timeoutMs: 60000 })
            .changeTo({ text: 'Synced' });
```

`changeTo` resolves when both: the source selector no longer matches **and** the target selector matches.

---

## 7. Observability

Same as shell hooks (see [`hooks-device-stream.md` §6](./hooks-device-stream.md#6-observability--failure-modes)):

- Every run writes a `hook_runs` row with `operation_key`, exit code, duration, and a 1 KB tail of stderr.
- Terminal `hook.completed` / `hook.failed.retryExhausted` events go to the `events` table with the original trigger's `correlation_id`.
- `failOnError: true` + non-zero exit → job moves to `failed` with the hook name and exit code in `errorMessage`.

For script hooks specifically:

- The `command` field of the `HookResult` is `'script:<name>'` (placeholder — the actual script body is in the hook definition).
- `stdout` contains everything your `console.log` printed.
- `stderr` contains both intentional `console.error` and uncaught throws / `tsx` import errors.
- The temp file at `<projectRoot>/.df-hook-tmp/run-<uuid>/hook.mts` is removed on success or failure; a leftover indicates a hard kill (SIGKILL beat the cleanup); the runner sweeps `run-*` entries older than 24 h on its next start.

---

## 8. Failure modes & gotchas

- **Timeout includes `tsx` startup** (~1–2s cold). For installs or long flows, set `timeoutMs` to a generous value (e.g. 120000+).
- **`tsx` must be on the local `node_modules/.bin`** — run `npm install` after pulling. If absent, the runner falls back to `npx --yes tsx`, which downloads `tsx` from the registry and is slow + needs internet.
- **`@device-stream/dsl` must be built** (`npm run build -w @device-stream/dsl`) at least once; the `dist/index.js` is what `tsx` loads.
- **Android primitives (`tap`, `type`, `hierarchy`) require the on-device server.** Start it with `npm run start -w @device-stream/android-server -- <serial>` per device.
- **iOS primitives require WDA on port 8100.** See [`device-stream` README](../../device-stream/README.md#ios-simulator--wda-setup) for setup.
- **`ds.openUrl(...)` on iOS physical device throws** — there's no clean way to deeplink-without-an-app. Use a simulator for those flows or pre-install a helper app.

---

## 9. Pointers

- DSL package: [`device-stream/packages/dsl/README.md`](../../device-stream/packages/dsl/README.md)
- DSL surface: `device-stream/packages/dsl/src/index.ts`
- Schema: `server/hooks/schemas.ts`
- Runner: `server/hooks/internal/script-runner.ts`
- Executor branch: `server/hooks/internal/hook-executor.ts` → `executeScript(...)`
- Web editor: `web/src/lib/components/hooks/ScriptEditor.svelte`
- Form: `web/src/lib/components/hooks/HookForm.svelte`
- Shell hooks (legacy `kind: 'shell'`): [`hooks-device-stream.md`](./hooks-device-stream.md)
