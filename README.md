# Device Farm

Self-hosted test execution platform for Apple Silicon Mac Minis. Manages Android emulators and iOS simulators, executes Maestro test flows, and provides real-time observability via WebSocket streaming and a web dashboard.

**Highlights**
- 🎬 **Report viewer** — ReportPortal-style 3-pane viewer at `/jobs/[id]`: step timeline with screenshots, video sync (click a step → video seeks), failure focus panel with log tail + jump-to-video, suite/history/trends sub-tabs, device + OS + Maestro version chips. Enable with `ui.use_report_shell: true`.
- 🔗 **Share links** — Mint per-job signed URLs (`?t=<jwt>`) for reviewers without Device Farm credentials. Plumbed into the Azure DevOps PR commenter.
- 🪝 **Lifecycle hooks (two flavours)** —
  - `kind: 'shell'` — interpolated `{{template}}` commands; thin wrappers around `adb` / `simctl`. See [`docs/runbooks/hooks-device-stream.md`](./docs/runbooks/hooks-device-stream.md).
  - `kind: 'script'` — TypeScript snippets with `@device-stream/dsl` pre-bound; selector-based (`ds.get({ id: 'username' }).fill(...)`) and cross-platform. See [`docs/runbooks/dsl-hooks.md`](./docs/runbooks/dsl-hooks.md).
- ✍️ **Monaco editor in `/settings`** — Authors `kind: 'script'` hooks with full TypeScript autocomplete loaded from the DSL's `.d.ts`. Inline diagnostics, parameter hints, `Selector` field completion.
- 📦 **`@device-stream/dsl`** — High-level DSL on top of `@device-stream/android-server` (HTTP), WDA (iOS), `adb`, `simctl`, and `go-ios`. Single source for `openUrl`, selector-based UI, install / grant / setLocation across Android + iOS Simulator + iOS Device. See [`device-stream/packages/dsl/README.md`](./device-stream/packages/dsl/README.md).
- 📺 **device-stream** monorepo (`device-stream/`) — TS packages + native binaries for screen streaming (the built-in Live Preview) and programmatic device control (taps/types/screenshots) reusable from hooks. See [`docs/runbooks/device-stream.md`](./docs/runbooks/device-stream.md).
- 🗑️ **Retention** — Configurable per-artifact retention (5/15/30 days) via `/settings` UI, applied by the `lifecycle` module's daily pg-boss schedule.

## Prerequisites

| Dependency | Required | Install |
|------------|----------|---------|
| **Node.js** >= 20 | Always | [nodejs.org](https://nodejs.org) or `brew install node` |
| **Go** >= 1.21 | CLI only | `brew install go` |
| **PostgreSQL** >= 16 | Always | `brew install postgresql@17` |
| **ffmpeg** | Always | `brew install ffmpeg` |
| **Maestro** >= 2.x | Always | `curl -Ls "https://get.maestro.mobile.dev" \| bash` |
| **Android SDK** (adb, emulator) | When `pool.android.enabled: true` | See [Android Setup](#android-setup) |
| **Xcode + simctl** | When `pool.ios.enabled: true` | Install Xcode from the App Store |

## Full Setup Guide (macOS / Apple Silicon)

### 1. Install system dependencies

```bash
# Homebrew (if not installed)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Core tools
brew install node go postgresql@17 ffmpeg

# Start PostgreSQL
brew services start postgresql@17
```

### 2. Install Maestro

```bash
curl -Ls "https://get.maestro.mobile.dev" | bash
```

After install, restart your terminal or run `source ~/.zshrc`. Verify with `maestro --version`.

### 3. Android Setup

#### 3a. Install Android SDK via Android Studio (recommended)

Install [Android Studio](https://developer.android.com/studio). It installs the SDK to `~/Library/Android/sdk` automatically.

**Or** install just the command-line tools:

```bash
brew install --cask android-commandlinetools
```

#### 3b. Set environment variables

Add to your `~/.zshrc`:

```bash
export ANDROID_HOME="$HOME/Library/Android/sdk"
export ANDROID_SDK_ROOT="$HOME/Library/Android/sdk"
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"
```

Then `source ~/.zshrc`.

#### 3c. Install cmdline-tools (workaround)

> **Workaround**: The Homebrew `avdmanager`/`sdkmanager` often fails with
> `"Failed to create SDK root dir"` because it uses `/Library/Android/sdk`
> instead of `~/Library/Android/sdk`. Install cmdline-tools directly inside
> your SDK to avoid this:

```bash
cd ~/Library/Android/sdk
mkdir -p cmdline-tools

# Download latest cmdline-tools (check https://developer.android.com/studio#command-tools for latest URL)
curl -sL "https://dl.google.com/android/repository/commandlinetools-mac-13114758_latest.zip" -o /tmp/cmdline-tools.zip
unzip -qo /tmp/cmdline-tools.zip -d /tmp/cmdline-tools-tmp
mv /tmp/cmdline-tools-tmp/cmdline-tools ~/Library/Android/sdk/cmdline-tools/latest
rm /tmp/cmdline-tools.zip && rm -rf /tmp/cmdline-tools-tmp
```

From now on, always use `~/Library/Android/sdk/cmdline-tools/latest/bin/sdkmanager` and `avdmanager` instead of the Homebrew versions.

#### 3d. Install system image and platform

```bash
# Accept licenses
yes | ~/Library/Android/sdk/cmdline-tools/latest/bin/sdkmanager --licenses

# Install platform and system image (Android 16 / API 36.1)
~/Library/Android/sdk/cmdline-tools/latest/bin/sdkmanager \
  "platform-tools" \
  "emulator" \
  "platforms;android-36.1" \
  "system-images;android-36.1;google_apis_playstore;arm64-v8a"
```

> **Note**: For other Android versions, replace `36.1` with the desired API level.
> List available images with:
> `~/Library/Android/sdk/cmdline-tools/latest/bin/sdkmanager --list | grep system-images`

#### 3e. Create an AVD

```bash
echo "no" | ~/Library/Android/sdk/cmdline-tools/latest/bin/avdmanager \
  create avd \
  -n device_farm_pixel7_0 \
  -k "system-images;android-36.1;google_apis_playstore;arm64-v8a" \
  -d "pixel_7" \
  --force
```

Verify: `~/Library/Android/sdk/cmdline-tools/latest/bin/avdmanager list avd`

### 4. Set up the project

```bash
# Clone the repo
git clone <repo-url> device-farm && cd device-farm

# Install server dependencies
npm install

# Install web dashboard dependencies
npm run web:install

# Build the web dashboard
npm run web:build

# Create the database
createdb device_farm

# Push the schema
npx drizzle-kit push

# Create storage directories
mkdir -p storage/artifacts storage/logs
```

### 5. Configure

Edit `config.yaml` to match your setup:

```yaml
pool:
  max_devices: 10
  android:
    enabled: true
    max_instances: 1        # number of simultaneous emulators
    headless: true
    api_level: "36.1"       # Android version (string: "34", "35", "36.1", etc.)
    system_image_variant: "google_apis_playstore"  # or "google_apis"
    device_profile: "pixel_7"
    ram_mb: 2048
  ios:
    enabled: false          # requires Xcode
    max_instances: 0
```

The `api_level` and `system_image_variant` fields must match a system image installed on the machine. Together they form the AVD package path: `system-images;android-{api_level};{system_image_variant};arm64-v8a`.

### 6. Start the server

```bash
npm run dev
```

The server starts at `http://localhost:3000`. Open it in a browser to see the dashboard.

### 7. Build and configure the CLI

```bash
cd cli && make build && cd ..

# Configure the CLI to point at the server
./cli/bin/device-farm config set server_url http://localhost:3000
```

### 8. Run a test

```bash
# Create a test flow
mkdir -p tests
cat > tests/login.yaml << 'EOF'
appId: com.example.app
---
- launchApp
- tapOn: "Login"
- inputText: "user@test.com"
- tapOn: "Submit"
- assertVisible: "Welcome"
EOF

# Submit the job
./cli/bin/device-farm run --platform android tests/login.yaml

# Check devices
./cli/bin/device-farm devices

# Check job status
./cli/bin/device-farm status <job-id>

# View logs
./cli/bin/device-farm logs <job-id>
```

## Development (without emulators)

To run the server without Android/iOS dependencies (for UI/API development):

```bash
DEVICE_FARM_CONFIG=config.dev.yaml npm run dev
```

This uses `config.dev.yaml` which disables both device pools, skipping the dependency checks for `adb`, `emulator`, `avdmanager`, `xcrun simctl`, and `maestro`.

## API Usage (curl)

```bash
# Health check
curl http://localhost:3000/api/health

# List devices
curl http://localhost:3000/api/devices

# Submit a job
curl -X POST http://localhost:3000/api/jobs \
  -F "flows=@tests/login.yaml" \
  -F 'metadata={"platform":"android","branch":"main"}'

# List jobs
curl http://localhost:3000/api/jobs

# Job details
curl http://localhost:3000/api/jobs/<job-id>

# Job logs
curl http://localhost:3000/api/jobs/<job-id>/logs

# Cancel a job
curl -X DELETE http://localhost:3000/api/jobs/<job-id>
```

## Deploy to Mac Mini (production)

1. Clone the repo on the Mac Mini
2. Install all dependencies: Node.js, Go, PostgreSQL, ffmpeg, Maestro, Android SDK (follow steps above)
3. Install project deps:
   ```bash
   npm install && npm run web:install && npm run web:build
   ```
4. Create the database:
   ```bash
   createdb device_farm
   npx drizzle-kit push
   ```
5. Edit `config.yaml`:
   - Increase `max_instances` based on available RAM (each emulator uses ~2GB)
   - Enable iOS if Xcode is installed
   - Configure `webhooks` for CI integration
6. Build and run in production:
   ```bash
   npm run build
   node server/index.js
   ```
7. On your dev machine, point the CLI to the Mac Mini:
   ```bash
   ./cli/bin/device-farm config set server_url http://<mac-mini-ip>:3000
   ```

## Configuration

The server reads `config.yaml` from the project root. Override with `DEVICE_FARM_CONFIG` env var.

| Env Variable | Description |
|---|---|
| `DEVICE_FARM_CONFIG` | Path to config file (default: `config.yaml`) |
| `DEVICE_FARM_PORT` | Server port override |
| `DATABASE_URL` | PostgreSQL connection string |
| `LOG_LEVEL` | Pino log level (`debug`, `info`, `warn`, `error`) |

### Key config sections

- **`pool`** — Max devices, Android/iOS enable toggles, emulator specs
- **`storage`** — Artifact paths, retention days, compression, max disk
- **`jobs`** — Timeout, queue size, cleanup schedule
- **`auth`** — Enable/disable API key authentication
- **`webhooks`** — Webhook URL, secret, retry config

See `config.yaml` for the full reference with comments.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start server with hot reload (tsx watch) |
| `npm run build` | TypeScript compile |
| `npm test` | Run all tests (Vitest) |
| `npm run web:install` | Install web dashboard deps |
| `npm run web:dev` | Start web dashboard dev server |
| `npm run web:build` | Build web dashboard for production |

## Architecture

```
server/           # Fastify server (TypeScript)
  api/            # REST routes + static SPA serving
  auth/           # API key management + bearer auth
  artifacts/      # Recording, screenshot, logcat, memory services
  config/         # Zod schema + YAML config loader
  db/             # Drizzle ORM + PostgreSQL
  jobs/           # Job queue, executor, Maestro parser
  lifecycle/      # Cron: compression, retention, disk pressure
  pool/           # Device state machine, pool manager, drivers
  reporting/      # Webhooks, JUnit XML, flaky detection
  streaming/      # WebSocket: job logs, device preview
  types/          # Shared TypeScript types

web/              # SvelteKit SPA (Svelte 5 + Tailwind v4)
  src/lib/
    api/          # Typed API client
    auth/         # Auth store (reactive, localStorage)
    components/   # UI components (jobs, devices, layout)
    ws/           # WebSocket clients (job stream, device preview)
  src/routes/     # SvelteKit pages

cli/              # Go CLI binary
  cmd/            # Cobra commands (run, status, logs, devices, cancel, config)
  internal/       # HTTP client, WebSocket, output formatting
```

## API Endpoints

REST endpoints under `/api/`:

**Jobs**
- `POST /api/jobs` — Submit test job (multipart: YAML flows + metadata)
- `GET /api/jobs` — List jobs with filters (`status`, `platform`, `flowName`, `dateFrom`, `dateTo`) and cursor pagination
- `GET /api/jobs/:id` — Job details with steps and result
- `GET /api/jobs/:id/logs` — Job logs
- `GET /api/jobs/:id/recording` — Download recorded video
- `DELETE /api/jobs/:id` — Cancel job

**Report viewer** (introduced with the `ui.use_report_shell` flag)
- `GET /api/jobs/:id/report` — Full report bundle (job + steps + artifacts + failureFocus + history)
- `POST /api/jobs/:id/share-token` — Mint a per-job HS256 JWT for unauthenticated reviewers; pass back via `?t=<jwt>` on the viewer URL
- `GET /api/jobs/suites` — Per-flow aggregation (counts, pass rate, sparkline trend, last run)
- `GET /api/jobs/trends` — Pass/fail series by day and by flow
- `GET /api/jobs/:id/report.xml` — JUnit XML report

**Devices**
- `GET /api/devices` — List all devices and status
- `POST /api/devices/:id/restart` — Restart a device

**Hooks** (lifecycle setup/teardown — see `docs/runbooks/hooks-device-stream.md`)
- `GET|POST /api/hooks`, `PUT|DELETE /api/hooks/:name`, `POST /api/hooks/:name/test`

**Server / config**
- `GET /api/health` — Server + pool health
- `GET /api/config` — Server configuration (sanitized)
- `GET /api/ui-config` — UI feature flags (public, used by the web app to decide which views to render)
- `PATCH /api/admin/config` — Update mutable settings (e.g., `retention_days: 5|15|30`); admin auth required
- `GET /api/reports/flaky` — Flaky test report

**Auth**
- `POST /api/auth/keys`, `GET /api/auth/keys`, `DELETE /api/auth/keys/:id`, `POST /api/auth/validate`

WebSocket endpoints:
- `GET /ws/jobs/:id` — Live job logs + step updates
- `GET /ws/devices/:id/preview` — Live device screen preview

## Troubleshooting

### `sdkmanager`/`avdmanager` fails with "Failed to create SDK root dir"

The Homebrew-installed tools default to `/Library/Android/sdk` (root path). Use the cmdline-tools installed inside your SDK at `~/Library/Android/sdk/cmdline-tools/latest/bin/` instead. See [3c. Install cmdline-tools](#3c-install-cmdline-tools-workaround).

### Port 3000 already in use

```bash
# Find what's using the port
lsof -ti:3000

# Kill it
kill $(lsof -ti:3000)
```

### Emulator won't boot on Apple Silicon

Make sure you're using `arm64-v8a` system images (not `x86_64`). All commands in this guide already use the correct architecture.

### PostgreSQL connection refused

```bash
# Check if running
brew services list | grep postgresql

# Start it
brew services start postgresql@17
```

## License

MIT — see [LICENSE](./LICENSE) for details. This is a personal/portfolio project; use at your own risk.
