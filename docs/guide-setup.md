# Device Farm — Setup Guide

End-to-end install for a fresh Apple Silicon Mac (mac mini, MacBook Pro M-series).
After this guide you can run Maestro tests on Android emulators, manage
interactive sessions via the CLI/web/MCP, and (with Xcode installed) cover iOS
simulators too.

**Target audience:** the engineer setting up the test runner machine for the
first time.

**Estimated time:**
- ~30 min if only Android matters
- ~1h if you want iOS too (Xcode + simulator runtimes are multi-GB downloads)

---

## Prerequisites

- Apple Silicon Mac (M1/M2/M3/M4) — Intel is not supported
- macOS 13+ (Sonoma/Sequoia/Tahoe). On Tahoe (26.x), the Android emulator
  must use `api_level: "35"` — API 36+ crashes due to mprotect/hvf
- 16GB RAM minimum (24GB recommended for 4 parallel devices)
- 80GB free disk (Android SDK + emulators + Xcode + iOS sims)
- Admin / sudo access on the local account
- A GitHub account if you want to clone via SSH (optional)

---

## Quick path (Android only — ~10 min after Homebrew)

```bash
# 1. Install Homebrew if you don't have it
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# 2. Clone the repo and build the CLI
git clone <your-repo-url> device-farm
cd device-farm
(cd cli && go build -o bin/device-farm .)

# 3. One-shot dependency install (Java, Android SDK, Maestro, ffmpeg, Postgres, ...)
./cli/bin/device-farm dependencies

# 4. Install Node deps for the server + drizzle
npm install

# 5. Initialise the database (creates DB, runs migrations)
./cli/bin/device-farm setup-db

# 6. Verify everything (should show all green except iOS rows)
./cli/bin/device-farm doctor

# 7. Boot the server (Android emulator auto-boots inside Fastify onReady)
DATABASE_URL=postgresql://$USER@localhost:5432/device_farm \
  ./node_modules/.bin/tsx server/index.ts &

# 8. Create your first API key (one-time bootstrap)
curl -sX POST http://localhost:3000/api/admin/keys \
  -H 'Content-Type: application/json' \
  -d '{"name":"bootstrap"}'

# 9. Submit a smoke test
./cli/bin/device-farm run --server http://localhost:3000 \
  --api-key <THE_KEY_FROM_STEP_8> \
  --platform android my-flow.yaml
```

---

## Detailed checklist

Tick off as you go.

### 1. System

- [ ] Apple Silicon Mac confirmed (`uname -m` → `arm64`)
- [ ] macOS version noted (`sw_vers -productVersion`)
- [ ] At least 80GB free disk (`df -h /`)
- [ ] sudo works (`sudo -v`)

### 2. Homebrew

- [ ] Homebrew installed (`brew --version`)
- [ ] On PATH (`which brew`)

**Install command (if missing):**
```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

### 3. Clone + build the CLI

- [ ] Repo cloned somewhere persistent (`~/projects/device-farm` recommended)
- [ ] Go installed (`brew install go` if missing)
- [ ] CLI built: `cli/bin/device-farm --help` works

```bash
git clone <your-repo-url> device-farm
cd device-farm
brew install go   # if needed
(cd cli && go build -o bin/device-farm .)
```

### 4. Auto-install dependencies (one command)

The CLI's `dependencies` command installs everything it can without sudo:

- [ ] `./cli/bin/device-farm dependencies` ran successfully

**Covers:**
- Java 17 (`brew install openjdk@17`)
- Android SDK + cmdline-tools + platform-tools + emulator
- Android system-images API 35 + default `android-1` AVD
- adb (part of Android SDK)
- Maestro CLI (`curl install.maestro.dev`)
- ffmpeg (`brew install ffmpeg`)
- PostgreSQL 17 (`brew install postgresql@17` + `initdb` + service start)
- Node.js (`brew install node`)
- git (`brew install git`)
- go-ios (`brew install`)
- idb_companion (requires Xcode.app; see iOS section below)
- sim-capture (symlinks `device-stream/bin/sim-capture-private`)

**On failure**, `device-farm doctor` shows actionable hints (e.g. "→ Run:
device-farm dependencies").

### 5. Node + npm install

- [ ] `node --version` → 18+
- [ ] In the repo root: `npm install` ran successfully
- [ ] `node_modules/.bin/tsx` exists
- [ ] `node_modules/.bin/drizzle-kit` exists

```bash
cd device-farm
npm install
```

### 6. Database setup

- [ ] Postgres running (`pg_isready -h localhost`)
- [ ] `./cli/bin/device-farm setup-db` ran successfully
- [ ] Connection works: `psql postgresql://$USER@localhost:5432/device_farm -c '\dt'` lists ~30 tables

The `setup-db` command:
1. Creates the `device_farm` database (idempotent)
2. Runs `drizzle-kit push` to apply the full schema
3. Prints next-step instructions

### 7. Config file

- [ ] `config.yaml` exists in the repo root
- [ ] `pool.android.api_level` is `"35"` (NOT 36+ on macOS Tahoe)
- [ ] `pool.android.max_instances` set to your desired parallel count (start with 1)
- [ ] `pool.android.headless: true` (for production / mac mini server)
- [ ] `pool.android.enabled: true`
- [ ] `pool.ios.enabled: false` UNTIL Xcode is set up

The repo ships a default `config.yaml`. Edit it inline.

### 8. iOS support (optional)

If you want iOS test execution, all three below are required.

#### 8a. Install Xcode.app

- [ ] `/Applications/Xcode.app` exists (full IDE, not just Command Line Tools)

**Download:** Mac App Store → Xcode (10+ GB, requires Apple ID sign-in).
Cannot be automated by the CLI.

#### 8b. Switch developer dir + accept license + download iOS runtime

- [ ] `./cli/bin/device-farm setup-xcode` ran successfully

This command walks through three sudo steps interactively:
1. `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`
2. `sudo xcodebuild -license accept`
3. `sudo xcodebuild -downloadPlatform iOS` (~5GB, ~10 min)

Use `--yes` to skip prompts: `./cli/bin/device-farm setup-xcode --yes`.

#### 8c. Verify iOS runtime

- [ ] `xcrun simctl list runtimes` lists at least one iOS runtime
- [ ] `xcrun simctl list devicetypes | grep iPhone-16` shows the device type

#### 8d. Enable iOS in config

```yaml
pool:
  ios:
    enabled: true
    max_instances: 1
    runtime: "iOS-18-5"   # match what simctl list shows
    device_type: "iPhone-16"
```

### 9. Final doctor

- [ ] `./cli/bin/device-farm doctor` shows **0 failed** (warnings on `go-ios agent not running` are OK if you don't need iOS physical devices)

### 10. Start the server

- [ ] Server boots cleanly + Android emulator becomes `idle`

```bash
DATABASE_URL=postgresql://$USER@localhost:5432/device_farm \
  ./node_modules/.bin/tsx server/index.ts &

# Wait until /api/devices returns state=idle (boot takes 1-3 min)
curl -s http://localhost:3000/api/devices
```

For long-running production: use `launchd` (macOS) or systemd-style supervisor.
Sample launchd plist not included — the dev who maintains the mac mini can
adapt from a standard Node script template.

### 11. Bootstrap the first API key

- [ ] Got a `rawKey` response from the admin endpoint
- [ ] Saved it somewhere (1Password, vault, etc.) — `rawKey` is shown ONCE

```bash
curl -sX POST http://localhost:3000/api/admin/keys \
  -H 'Content-Type: application/json' \
  -d '{"name":"bootstrap"}'
```

> ⚠️ Once your first API key exists, you may want to gate `/api/admin/keys`
> behind auth (it currently allows unauthenticated creation when no keys
> exist — see `server/auth/internal/key-routes.ts`).

### 12. Smoke test

- [ ] CLI device list works
- [ ] Submitting a Maestro flow runs end-to-end

```bash
export DF_KEY=<your bootstrap key>

# 12a. Device list
./cli/bin/device-farm devices --server http://localhost:3000 --api-key $DF_KEY

# 12b. A simple flow you control (calculator, settings, your app, ...)
cat > /tmp/smoke.yaml <<EOF
appId: com.android.settings
---
- launchApp
- assertVisible: "Settings"
- takeScreenshot: smoke
- stopApp
EOF

./cli/bin/device-farm run \
  --server http://localhost:3000 --api-key $DF_KEY \
  --platform android /tmp/smoke.yaml
```

### 13. Web UI (optional)

- [ ] `cd web && npm install` ran successfully
- [ ] `npm run web:dev` (from repo root) starts Vite at http://localhost:5173
- [ ] You can sign in with your API key

For production, run `npm run web:build` and let the server serve `web/build/`
as static (already wired via `server/api/static-plugin.ts`).

---

## Azure DevOps Pipeline integration (optional)

If you want PRs from Azure Repos to trigger test runs + post results back:

- [ ] Personal Access Token (PAT) generated in Azure DevOps with
      `Code (read)` + `Build (read & execute)` scope
- [ ] Webhook configured in Azure project → `POST` to
      `https://<your-server>/api/azure/pr-events` with Basic Auth
- [ ] `config.yaml` populated:

```yaml
azure_devops:
  pat: "<azure-pat>"
  webhook_basic_auth:
    username: "df-azure"
    password: "<secret>"
  pr_integrations:
    - org_url: "https://dev.azure.com/<org>"
      project: "<project>"
      repo_id: "<repo-uuid>"
      pipeline_id: 42
```

See `server/azure/MODULE.md` (in code) for full schema + behavior.

---

## GitHub PR integration (optional)

Alternative to Azure. Requires a GitHub App with `pull_request` + `checks` perms.

- [ ] GitHub App created (`https://github.com/settings/apps/new`)
- [ ] App installed on the target repo
- [ ] `installation_id` noted (visible in the install URL)
- [ ] `config.yaml` populated:

```yaml
github:
  app_id: 12345
  private_key: |
    -----BEGIN RSA PRIVATE KEY-----
    ...
    -----END RSA PRIVATE KEY-----
  webhook_secret: "<random-32-bytes>"
  pr_integrations:
    - repo_owner: "your-org"
      repo_name: "your-app"
      installation_id: 12345678
      pipeline_name: "default"
```

See `docs/runbooks/github-integration.md` for the workflow file template and
PR comment format.

---

## Operational notes

### Restart after machine reboot

```bash
brew services start postgresql@17
cd ~/projects/device-farm
DATABASE_URL=postgresql://$USER@localhost:5432/device_farm \
  ./node_modules/.bin/tsx server/index.ts &
```

### When the emulator dies (qemu Tahoe instability)

If `device-farm devices` shows `state=offline` but qemu is gone:

```bash
pkill -9 qemu
pkill -9 -f "tsx server"
sleep 3
# restart server — it boots a fresh emulator
DATABASE_URL=... ./node_modules/.bin/tsx server/index.ts &
```

If the AVD's userdata is corrupted:

```bash
~/Library/Android/sdk/emulator/emulator -avd android-1 -wipe-data -no-window -no-audio &
# Wait until adb sees it, then kill — server will adopt the cleaned AVD on next boot
```

### Log locations

- Maestro per-job logs: `/tmp/device-farm/logs/<jobId>/maestro.log`
- Recording artifacts: `storage/artifacts/<jobId>/recording.mp4`
- Maestro debug bundle: `~/.maestro/tests/<timestamp>/` (includes UI hierarchy
  XML + per-step screenshots — useful for failed flows)
- Server log: stderr of the `tsx server/index.ts` process

### Cleanup old AVDs

If the AVD list (`emulator -list-avds`) accumulates `android-1-r…` replacement
AVDs from past failed runs, the next server boot will reap them automatically.
Manual cleanup if needed:

```bash
~/Library/Android/sdk/cmdline-tools/latest/bin/avdmanager list avd
~/Library/Android/sdk/cmdline-tools/latest/bin/avdmanager delete avd -n <name>
```

---

## Troubleshooting

### `device-farm dependencies` says "device-stream repo not found"

Fixed in commit `6ed796b`. Rebuild the CLI:
```bash
(cd cli && go build -o bin/device-farm .)
```

### Server fails to start with "z.void() cannot be represented in OpenAPI"

Fixed in commit `065bff3`. Pull main + rebuild.

### Sessions WS times out with no error frame

Fixed in commit `3434e45` (Bug 8 — `socket.on('message')` registered too late).
Pull main + restart.

### Jobs sit queued forever

Fixed in commit `82209aa` (Bug 12 — pg-boss envelope not unwrapped). Pull main +
restart.

### Doctor passes but iOS sim doesn't appear

Make sure `pool.ios.enabled: true` is set in `config.yaml` AND
`xcrun simctl list runtimes` shows a runtime AND `xcrun simctl list devicetypes`
shows the device type from your config. Restart the server.

### "no idle device available" on first lease

The pool might be in a stale state from a previous run. Cleanest reset:

```bash
psql -d device_farm -c "DELETE FROM sessions; DELETE FROM jobs; DELETE FROM devices; DELETE FROM pgboss.job;"
# Restart server
```

---

## Reference — all CLI setup commands

| Command | What it does |
|---------|-------------|
| `device-farm doctor` | Diagnoses all dependencies + shows actionable hints |
| `device-farm dependencies` | Auto-installs everything the CLI can handle (no sudo, no GUI) |
| `device-farm setup-db` | Creates the Postgres DB + runs Drizzle migrations |
| `device-farm setup-xcode` | Walks through the 3 sudo steps for iOS (Xcode license + iOS runtime download) |
| `device-farm devices` | Lists the pool (sanity check post-setup) |
| `device-farm run flow.yaml` | Submit a Maestro job |
| `device-farm session lease` | Open an interactive session |
| `device-farm explore` | BFS-explore an app via Claude Agent SDK |
| `device-farm analyze app.ipa` | Extract iOS skeleton (Mach-O parser, no execution) |

---

## What this guide does NOT cover

- Production deployment topology (reverse proxy, TLS, secrets management)
- Multi-machine setups (one server, multiple device hosts)
- Backup / restore of the Postgres `device_farm` DB
- Upgrades between major versions (will be in CHANGELOG.md per milestone)

For those, see the per-runbook docs in `docs/runbooks/`.
