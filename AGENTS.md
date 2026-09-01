# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Project Overview

Device Farm is a self-hosted test execution platform for Apple Silicon Macs. It manages Android emulators (and iOS simulators), executes Maestro test flows, and provides real-time observability via WebSocket streaming and a web dashboard.

**Stack:** TypeScript server (Fastify 5) + Go CLI (Cobra) + SvelteKit 5 web UI + PostgreSQL (Drizzle ORM)

## Commands

### Server
```bash
npm run dev                    # Start server with hot reload (tsx watch)
npm run build                  # TypeScript compile to dist/
npm test                       # Run all server tests (Vitest)
npx vitest run server/jobs/__tests__/job-service.test.ts  # Single test file
npx vitest run -t "test name"  # Single test by name
```

### CLI (from `cli/` directory)
```bash
make build                     # Build Go binary to bin/device-farm
make test                      # Run all Go tests
go test -run TestName ./cmd    # Single Go test
```

### Web (from project root)
```bash
npm run web:dev                # SvelteKit dev server on :5173
npm run web:build              # Production build to web/build/
```

### Database
```bash
npx drizzle-kit push           # Apply schema changes to DB
npx drizzle-kit generate       # Generate migration files
```

### Development without emulators
```bash
DEVICE_FARM_CONFIG=config.dev.yaml npm run dev  # Disables device pools
```

## Architecture

### Three-Component System
- **Server** (`server/`): Fastify with 12 plugins registered in dependency order in `server/index.ts`. Each plugin uses Fastify decorators to expose services (e.g., `fastify.jobService`, `fastify.pool`, `fastify.db`).
- **CLI** (`cli/`): Go binary using Cobra commands. Submits jobs via multipart HTTP, streams logs via WebSocket.
- **Web** (`web/`): SvelteKit SPA served by the server's static plugin from `web/build/`. Uses typed API client and WebSocket subscriptions.

### Plugin Registration Order (server/index.ts)
Plugins must register in dependency order. Each declares `{ dependencies: ['...'] }`:
1. config → 2. dependency-checker → 3. pool → 4. db → 5. auth → 6. websocket → 7. artifacts → 8. reporting → 9. jobs → 10. lifecycle → 11. api → 12. static

### device-stream Monorepo (`device-stream/`)
In-repo npm workspaces (`@device-stream/*`) plus native binaries that handle device control + streaming. The `streaming/` and `sessions/` modules consume the packages; **lifecycle hooks** can also invoke them via tsx scripts (see `docs/runbooks/device-stream.md` and `docs/runbooks/hooks-device-stream.md`). Per-device `DeviceMutexManager` (in `@device-stream/core`) serialises commands across streams, sessions, and hook-triggered scripts so they don't fight each other.

**`@device-stream/dsl`** (`device-stream/packages/dsl/`) — high-level selector + orchestration DSL on top of `@device-stream/android-server` (HTTP :9008), WDA (iOS :8100), `adb`, `xcrun simctl`, `go-ios`. Single API (`ds.get({ id }).fill(...)`, `ds.installApp(...)`, `ds.grantPermissions(...)`, `ds.awaitUntil(...).changeTo(...)`) that runs on Android emulators, iOS Simulators, and (most verbs) iOS physical devices. `iosKind: 'simulator' | 'device'` selects between simctl and go-ios. Android-only verbs (`grantPermissions`, `enableInstallByThirdParty`, `openDownloads`) throw `NotSupportedOnPlatformError` on iOS. Used by `kind: 'script'` hooks via the runner; the web Hook editor at `/settings` loads its `.d.ts` into Monaco for typed autocomplete. See `device-stream/packages/dsl/README.md` and `docs/runbooks/dsl-hooks.md`.

### Lifecycle Hooks (`server/hooks/`)
User-defined hooks triggered at 4 events: `device.booted`, `device.shutdown`, `test.before`, `test.after`. Setup/teardown for jobs lives here. Sequential per event, retry-safe via `hook_runs.operation_key`. Managed at `/api/hooks` (CRUD + `/test`).

Two `kind`s, discriminated by the Zod schema in `server/hooks/schemas.ts`:

- **`kind: 'shell'`** (legacy default) — `command` is interpolated with `{{serial}}`, `{{platform}}`, `{{job_id}}`, `{{device_id}}`, `{{emulator_id}}`, `{{port}}` template variables and run via `/bin/sh -c`. Per-invocation `context.vars` are also exposed as `DEVICE_FARM_VAR_<KEY>` env vars + `DEVICE_FARM_VARS_JSON`.
- **`kind: 'script'`** — `script` is a TypeScript snippet executed by `server/hooks/internal/script-runner.ts`. The runner writes a temp `.mts` under `<projectRoot>/.df-hook-tmp/`, wraps the body with a prelude that injects a `@device-stream/dsl` session (`ds`), the merged `vars` (definition `vars` ← `context.vars`, context wins), and `ctx` (full `HookContext`). Each `vars` key that's a valid JS identifier is also destructured into scope. `iosKind: 'simulator' | 'device'` picks the iOS backend. Runs via local `node_modules/.bin/tsx` (falls back to `npx --yes tsx`).

See `docs/runbooks/hooks-device-stream.md` (shell) and `docs/runbooks/dsl-hooks.md` (script).

### Report Viewer
- `/jobs/[id]` switches to a 3-pane `ReportShell` (tree | step detail | video/history) behind the `ui.use_report_shell` config flag. Legacy `LegacyJobView.svelte` preserves the rollback path.
- `GET /jobs/:id/report` returns the full bundle (job + steps + artifacts + failureFocus + history). Pure assembler is `server/reporting/report-bundle-service.ts`; route adds DB IO + log-tail extraction + flow history.
- Sub-tabs in `/jobs`: List | Suites (`GET /jobs/suites`) | History (filters on `GET /jobs`) | Trends (`GET /jobs/trends`).
- Share tokens (`server/auth/report-token.ts`): HS256 JWT scoped per job (`sub: 'job:<uuid>'`), minted via `POST /jobs/:id/share-token`. `?t=<jwt>` middleware in `server/api/plugin.ts` runs at `onRequest` (BEFORE `@fastify/bearer-auth`) to bypass auth on a small allowlist of viewer routes.
- Step timestamps come from `MaestroParser` wallclock map merged with Maestro's `commands-*.json` overrides (when available). `artifacts.video_started_at` lets the viewer derive per-step video offsets.
- OS / Maestro versions captured at job runtime via `adb getprop`/`xcrun simctl` and `maestro --version`, persisted in `jobs.metadata`. Legacy jobs fall back to the server's current Maestro version and config-derived OS version (`api_level` → Android marketing version, `runtime: iOS-18-5` → `iOS 18.5`).

### Device State Machine
Devices follow strict state transitions validated by `VALID_TRANSITIONS` in `server/types/index.ts`:
```
Booting → Idle ↔ Allocated → Running → Cleanup → Idle
Any state → Error → Booting/Offline
```

### DeviceDriver Interface (`server/pool/types.ts`)
Platform-specific drivers (Android `emulator.ts`, iOS `simulator.ts`) implement: `create`, `boot`, `shutdown`, `isHealthy`, `cleanup`. The PoolManager is platform-agnostic.

### Job Processing Pipeline
1. Multipart upload (flows + metadata + env + APK) → 2. Queue per platform → 3. Allocate device (mutex-protected) → 4. Execute Maestro → 5. Stream logs/steps via WebSocket → 6. Update DB + trigger webhook → 7. Cleanup device

### Key Patterns
- **Error responses:** RFC 7807 Problem+JSON format (`server/api/error-handler.ts`)
- **Job broadcaster:** In-memory per-job message history (last 100) replayed on WebSocket connect
- **Port allocation:** Dynamic allocation with zombie process blacklist to avoid "port in use" errors
- **Config:** Zod-validated YAML loaded from `config.yaml` (override with `DEVICE_FARM_CONFIG` env var)

## TypeScript Conventions
- ES modules with `.js` extensions in imports (NodeNext resolution)
- Zod for runtime validation of config and API inputs
- `async-mutex` for device allocation concurrency control
- Tests use `vi.mock()` at module level; mock factories for Pool, Database, Config, Logger

## Important Notes
- **API Level 35** is used (not 36.1) because API 36.1 crashes on macOS Tahoe due to mprotect/hvf issues
- `pluginTimeout: 120_000` in Fastify config to allow emulator boot during `onReady`
- Server DB schema: see `server/db/schema.ts` (additions in report-viewer rollout: `artifacts.video_started_at` for step↔video sync; `job_steps.started_at/finished_at` now populated from parser wallclock)
- Web app uses Svelte 5 runes (`$state`, `$derived`, `$effect`) and Tailwind CSS v4
- New deps from report-viewer rollout: `jose` (HS256 JWT for share tokens)
- Feature flags in `config.yaml`: `ui.use_report_shell` (default `false`), `sharing.enabled` (requires `security.share_token_secret >= 32 chars` when true)

## Runbooks
- `docs/runbooks/device-stream.md` — what device-stream is, when to use streaming-only vs hook-control
- `docs/runbooks/hooks-device-stream.md` — shell hooks (`kind: 'shell'`) lifecycle + recipes for setup/teardown
- `docs/runbooks/dsl-hooks.md` — DSL script hooks (`kind: 'script'`) authoring guide, schema, scope, examples
- `device-stream/packages/dsl/README.md` — `@device-stream/dsl` API reference (Selector, ElementHandle, WaitHandle, per-verb backend mapping)
- `docs/runbooks/` — other operational guides (drain, github-integration, wireless-android, mcp, session-api, etc.)
