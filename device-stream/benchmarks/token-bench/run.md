# Reproduction — token benchmark (Layer 1)

Mechanical payload capture: no LLM in the loop. A harness acts as an MCP **client**,
drives each server, and sizes every byte that would enter a model's context.
See `docs/specs/2026-08-31-token-benchmark.md` for the spec.

## What is measured

Seven configurations (see `adapters.ts`, printed in `results/RESULTS.md`):

| id | server | fixed context |
|----|--------|---------------|
| A1 | argent, defaults | alwaysLoad tool subset + `rules/argent.md` + 16 skill frontmatters + MCP instructions |
| A2 | argent, all tools | every tool def + rule + frontmatters + instructions |
| A3 | argent, `disable-auto-screenshot` | same fixed as A1 (differs only in flow) |
| A4 | argent `run-sequence` | same fixed as A1 (differs only in flow) |
| B1 | device-stream atomic `dsl_*` | 18 `dsl_*` tool defs |
| C1 | `dsl_run_script` | `dsl_run_script` def + `@device-stream/dsl` `.d.ts` surface |
| C2 | `dsl_run_script`, cold | same fixed as C1 (adds one selector-miss recovery round-trip) |

## Prerequisites

- Node 20+ (developed on Node 25). `adb` on `PATH`
  (`/opt/homebrew/share/android-commandlinetools/platform-tools`).
- `ANDROID_HOME=~/Library/Android/sdk`.
- Token counter: set `ANTHROPIC_API_KEY` to count via the Anthropic
  `count_tokens` API (`claude-sonnet-5`, authoritative). With no key the harness
  falls back to `js-tiktoken` `o200k_base` (an APPROXIMATION — every table says so).

## 1. argent (read-only, pinned)

```bash
# Clone pinned to the recorded SHA (skip if the session scratchpad clone is intact).
git clone https://github.com/software-mansion/argent argent-research
cd argent-research && git checkout b835de2326b2c396c010402b2a8f59613e23b462
npm install
# Build the dispatcher + the esbuild bundles the `argent mcp` adapter loads.
npm --workspace @swmansion/argent run build:dispatcher
node packages/argent/scripts/bundle-tools.cjs   # produces dist/mcp-server.mjs + dist/tool-server.cjs
```

`bundle-tools.cjs` fails at the end trying to fetch a `trace-processor` WASM asset
from a private release; that is AFTER `mcp-server.mjs` and `tool-server.cjs` are
written, and only gates the React-Native profiler tools. The live `tools/list`
consequently exposes **75** tools (the 2 profiler tools are absent) rather than the
77 in a full install — recorded as such in `RESULTS.md`.

Point the harness at the clone with `TOKENBENCH_ARGENT_ROOT=/abs/path/to/argent-research`
(defaults to the session scratchpad clone).

### 1a. Native device-driving binaries (required for the argent FLOW)

argent's screenshot / device driving needs native binaries the source clone does
NOT contain (`simulator-server`, `ax-service`, the Android screen-sharing agent).
CONTRIBUTING notes they are "installed separately". Take them from the **published**
package at the same pinned version and drop them into the clone (never our tree):

```bash
npm pack @swmansion/argent@0.22.1                 # → swmansion-argent-0.22.1.tgz
tar xzf swmansion-argent-0.22.1.tgz               # → package/
cp -R package/bin    <clone>/packages/argent/     # simulator-server, ax-service, agent
cp -R package/assets <clone>/packages/argent/      # trace-processor
chmod +x <clone>/packages/argent/bin/darwin/simulator-server <clone>/packages/argent/bin/darwin/ax-service
```

With these in place, `screenshot` returns a real image (argent auto-downscales the
Android frame to 270×600 ≈ 216 image tokens — recorded in `results/<A>.jsonl`).

## 2. device-stream MCP + DSL

```bash
# From device-stream/: build the DSL package (its .d.ts is C's documentation cost).
( cd packages/dsl && npx tsc -p tsconfig.json )
# Build the MCP server (exposes the 18 dsl_* tools + dsl_run_script).
( cd ../mcp && npm run build )
```

The MCP server needs `DEVICE_FARM_TOKEN` set (any non-empty value — `tools/list`
never calls the device-farm backend) and, to expose the DSL tools,
`DEVICE_STREAM_SERIAL` + `DEVICE_STREAM_PLATFORM=android`. The harness passes these.

## 3. On-device driver (required for the FLOW, not the fixed context)

The DSL talks to `@device-stream/android-server` (TCP JSON-RPC on `:9008`), deployed
to the emulator as an instrumentation APK:

```bash
cd device-stream/packages/android-server && npm run start -- emulator-5554
```

The DSL driver was updated to speak TCP JSON-RPC (`android-rpc.ts`), and the
Kotlin server's tree pruning was fixed, so B1/C1/C2 now drive the emulator live.
Two harness accommodations remain for out-of-scope quirks of this emulator image,
both in `harness/ds-flow.ts`:
> - **Launch:** the DSL's `launchApp` shells `monkey -c android.intent.category.
>   LAUNCHER`, which does NOT foreground `com.android.settings` here (no matching
>   launcher activity). The harness foregrounds Settings via
>   `adb am start -n com.android.settings/.Settings --activity-clear-task` (the
>   `--activity-clear-task` is required — otherwise Settings restores its last
>   sub-screen, e.g. the search view, across a force-stop). The `dsl_launch_app`
>   call is still captured for its token cost; its navigation is a no-op here.
> - **Settle timing:** `getAccessibilityTree` can race to a partial tree during a
>   screen transition, so the harness waits between steps and keeps the largest of
>   several reads when measuring the describe size.

### Execution order — the single UiAutomation channel

Only ONE process may hold the device's UiAutomation at a time. The device-stream
android-server instrumentation and argent's `uiautomator dump` conflict, so drive
one stack at a time:

```bash
# Before the argent configs (A1-A4): stop the device-stream instrumentation.
adb -s emulator-5554 shell am force-stop com.devicestream.server
adb -s emulator-5554 shell am force-stop com.devicestream.server.test

# Before the device-stream configs (B1/C1/C2): the android-server instrumentation
# must be RUNNING (it needs UiAutomation), and no argent config running concurrently.
#   ( cd device-stream/packages/android-server && npm run start -- emulator-5554 )
```

The harness tolerates argent's flaky `uiautomator dump` (~60% success) with
exponential-backoff retries (`withRetry` in `harness/argent-flow.ts`): a tap whose
target isn't in the current tree triggers an explicit `describe` (retried) before
falling back to a recorded miss.

## 4. Install harness deps + run

```bash
cd device-stream/benchmarks/token-bench
npm install

# Device-free acceptance: pure metric / adapter / capture / report tests.
npx vitest run

# Live fixed-context capture (needs the two MCP servers, NOT the on-device driver):
export PATH="$ANDROID_HOME/platform-tools:$PATH"
npx tsx harness/cli.ts fixed              # all configs → results/<id>.capture.json + <id>.jsonl

# Live argent FLOW (needs step 1a binaries + the device-stream instrumentation STOPPED):
npx tsx harness/cli.ts flow A1 A2 A3 A4   # folds live calls into A1-A4 captures
                                          # A2 reuses A1's flow (only fixed context differs)
                                          # A3 sets disable-auto-screenshot; A4 is one run-sequence

# device-stream FLOW (B1/C1/C2) — needs android-server RUNNING (holds UiAutomation),
# no argent config concurrent. TOKENBENCH_ADB points the harness at adb for am start:
export TOKENBENCH_ADB="$ANDROID_HOME/platform-tools/adb"
npx tsx harness/cli.ts flow B1 C1 C2

npx tsx harness/cli.ts report             # → results/RESULTS.md
```

Run configurations sequentially — never two servers driving the emulator at once.

## Outputs

- `results/<id>.jsonl` — one line per captured `tools/call`
  (`{step, tool, origin, requestBytes, requestTokens, resultBytes, resultTokens, contentTypes, images}`).
- `results/<id>.capture.json` — fixed context + calls + provenance for one config.
- `results/RESULTS.md` — per-platform comparison tables, cross-platform summary,
  per-step (live only), measured describe sizes, fixed-context breakdown, per-model
  adapter tables. Numbers + method only.
- `results/SUMMARY.md` — the interpreted companion (multipliers, per-step profile,
  caveats). Regenerated by `npx tsx harness/cli.ts summary`.

## 5. Fork-vs-upstream extension (configs F1/F2, A1-ios/A4-ios)

Adds the argent **fork** (`feat/run-script`, base a2ed83e0) and an **iOS**
simulator to the same Layer-1 method:

| id     | server            | platform         | flow                                        |
|--------|-------------------|------------------|---------------------------------------------|
| F1     | fork, run-script  | Android emulator | 1 describe + 1 `run-script` (10-step body)  |
| F2     | fork, run-script  | iOS simulator    | same shape, iOS scenario                    |
| A1-ios | upstream defaults | iOS simulator    | 10-step iOS flow, verb-per-call             |
| A4-ios | upstream run-seq  | iOS simulator    | best-case amortization                      |

### 5a. Build the fork + copy native binaries (post-build)

`bundle-tools.cjs` **wipes and regenerates** `packages/argent/bin/`, so the native
binaries must be copied in AFTER building (the opposite order trips up if you copy
first). Same for the upstream vendor clone.

```bash
FORK=<scratchpad>/argent-fork          # branch feat/run-script @ a2ed83e0-descendant
cd "$FORK" && npm install
npm run build                          # tsc --build (all workspaces)
npm run build -w @swmansion/argent     # dispatcher + bundle-tools (fails at trace-processor
                                       #   fetch AFTER writing mcp-server.mjs + tool-server.cjs — expected)
# native binaries from the published 0.22.1 (never committed; bin/ + assets/ are gitignored):
npm pack @swmansion/argent@0.22.1 && tar xzf swmansion-argent-0.22.1.tgz
cp -R package/bin/.    "$FORK/packages/argent/bin/"
cp -R package/assets/. "$FORK/packages/argent/assets/"
chmod +x "$FORK/packages/argent/bin/darwin/simulator-server" "$FORK/packages/argent/bin/darwin/ax-service"
git -C "$FORK" check-ignore packages/argent/bin/darwin/simulator-server   # must print the path
```

Point the harness at the fork with `TOKENBENCH_FORK_ROOT=/abs/path/to/argent-fork`
(defaults to the session scratchpad fork).

### 5b. Fairness: upstream base

The fork branched off upstream `a2ed83e0`, not the original benchmark SHA `b835de2`.
Move the vendor clone to the fork base and re-verify:

```bash
cd "$ARGENT_ROOT" && git checkout a2ed83e0 && npm install && npm run build && npm run build -w @swmansion/argent
# then restore its native binaries the same way as 5a.
```

Recorded decision (RESULTS.md): the upstream `tools/list` wire payload is
**byte-identical** at a2ed83e0 and b835de2 (same 75 tools, same 14 alwaysLoad), and
`rules/argent.md` + skill frontmatters are unchanged between them, so the existing
A1-A4 Android fixed context and flow numbers stand as the upstream baseline —
A-config Android flows were NOT re-run.

### 5c. iOS environment facts (see `scenario-ios.json`)

- **Boot via argent `boot-device` with `force:true`** so the pre-boot accessibility
  prefs are written — a sim booted by `simctl` returns a blind describe (empty
  `ROOT AXGroup` + a "not booted through argent" hint). `simulator-server` /
  `ax-service` must be present (5a) or every describe/screenshot fails.
- argent `launch-app` returns `init_failed` on this host (the RN native-devtools
  dylib is not shipped); the harness foregrounds Settings via `xcrun simctl launch`
  and resets to the root by tapping the `BackButton` element (iOS state restoration
  reopens the last sub-screen). Taps are fire-and-forget (#547) so each is verified.
- Direct `describe` returns a JSON object (`{"description": "<tree>", …}`) on both
  platforms; the auto-capture appended after an action is plain text. `parseTree`
  (harness/ext-flows.ts) normalizes both.

### 5d. Run the extension configs

```bash
# Fixed context (does NOT need a device; F1/F2 need the fork built, A*-ios the vendor):
npx tsx harness/cli.ts fixed F1 F2 A1-ios A4-ios

# Android fork flow (device-stream instrumentation STOPPED, like the A configs):
adb -s emulator-5554 shell am force-stop com.devicestream.server
adb -s emulator-5554 shell am force-stop com.devicestream.server.test
npx tsx harness/cli.ts flow F1

# iOS flows (boot the sim via argent boot-device force:true first):
export TOKENBENCH_IOS_UDID=<sim-udid>
npx tsx harness/cli.ts flow F2 A1-ios A4-ios

npx tsx harness/cli.ts report    # → results/RESULTS.md (per-platform tables)
npx tsx harness/cli.ts summary   # → results/SUMMARY.md (multipliers + caveats)
```

Do NOT re-run `fixed` for A1-A4 / B1 / C1 / C2 — it would overwrite their captured
live flows with an empty flow.

## 6. Integration config FX (both flags: run-script + open-device-server)

**FX** (Android) / **FX-ios** (iOS) drive the `integration/device-stream` branch
(run-script + rich-selectors + android-system-verbs + android-open-server merged;
EXPECTED_TOOL_COUNT 81, live tools/list 79 with the 2 trace-processor profiler
tools gated) with BOTH feature flags enabled. Point the harness at the integration
clone with `TOKENBENCH_INT_ROOT=/abs/path/to/argent-integration`.

### 6a. Build + native assets (same post-build order as §5a)

```bash
INT=<scratchpad>/argent-integration
cd "$INT" && npm install && npm run build && npm run build -w @swmansion/argent   # trace-processor step fails AFTER bundles — expected
# native binaries (post-build) + the open-server APK:
cp -R <published-0.22.1>/package/bin/.    "$INT/packages/argent/bin/"
cp -R <published-0.22.1>/package/assets/. "$INT/packages/argent/assets/"
ANDROID_HOME=/opt/homebrew/share/android-commandlinetools bash packages/android-device-server/scripts/build.sh
cp "$INT/packages/android-device-server/bin/argent-device-control-0.1.0.apk" "$INT/packages/argent/bin/"
adb -s emulator-5554 install -r -t "$INT/packages/argent/bin/argent-device-control-0.1.0.apk"   # fresh server (supports getAccessibilityTree)
```

### 6b. KNOWN INTEGRATION BUG + workaround (required for the open-server describe)

On the integration branch as built, `serverManifest()` (open-device-server) and
`helperManifest()` (android-devtools) BOTH read the same bundled
`packages/argent/assets/manifest.json`, which `bundle-tools.cjs` fills with the
**android-devtools** (SnapshotInstrumentation) manifest. So an as-built
`open-device-server` describe spawns the wrong instrumentation and fails with
`Unknown method: getAccessibilityTree`, silently falling back to android-devtools.
Until fixed upstream (bundle the device-server manifest to its own path, or have
`serverManifest()` read `@argent/android-device-server`'s manifest), correct the
bundled manifest in the clone (a gitignored build asset — never committed):

```bash
cp "$INT/node_modules/@argent/android-device-server/assets/manifest.json" "$INT/packages/argent/assets/manifest.json"
```

With that, `describe` reports `Source: open-device-server`.

### 6c. Flag + tool-server isolation

Both flags live in `<INT>/.argent/flags.json` (`{"flags":{"run-script":true,
"open-device-server":true}}`); the harness writes this and runs `argent mcp` with
`cwd=<INT>` so the tool-server resolves to the clone and reads the project flags.
It also sets a unique `ARGENT_PORT` so the client does NOT attach to a
globally-installed argent's shared tool-server (same version 0.22.1) on the default
port — that daemon runs upstream code without open-device-server. If describe still
reports `android-devtools`, a stale global tool-server is being reused: `pkill -f
tool-server.cjs` and retry.

### 6d. Run

```bash
npx tsx harness/cli.ts fixed FX FX-ios          # integration tools/list (79) + run-script def + ui .d.ts + rule + frontmatters
# Android (device-stream instrumentation STOPPED):
adb -s emulator-5554 shell am force-stop com.devicestream.server com.devicestream.server.test
npx tsx harness/cli.ts flow FX                   # proves Source: open-device-server; records describe size
# iOS (sim booted via argent boot-device, AX prefs — see §5c):
npx tsx harness/cli.ts flow FX-ios
npx tsx harness/cli.ts report && npx tsx harness/cli.ts summary
```

FX Android uses direct navigation with rich selectors (`contains`/`caseInsensitive`)
rather than F1's search-result tap: the open-device-server tree flattens Settings
search results into non-clickable StaticText + standalone Switch nodes. Same 10
steps / 2 round-trips, so the token cost stays comparable to F1.
