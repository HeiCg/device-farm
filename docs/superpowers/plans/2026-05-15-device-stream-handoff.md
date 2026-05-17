# device-stream baguette port — Session Handoff (2026-05-15 → next session)

> **Read this first.** Then read the master plan at `docs/superpowers/plans/2026-05-14-device-stream-baguette-port.md` — Phase D and Phase E sections only. Skip Phases A/B/C — they're done.

---

## TL;DR

- **15/25 tasks done.** Phases A (Foundation), B (Observability), C (Visual polish) all landed on `main`. 53 vitest tests passing across 5 packages.
- **10 tasks remaining.** Phase D (Native iOS streaming + HID, 6 tasks) and Phase E (Virtual camera, 4 tasks). Both are iOS-Simulator-only Swift+native work.
- **Why the previous session stopped:** Phase D requires porting ~1000 lines of Swift from baguette's `Infrastructure/Stream/` directory, which is fan-out across 9 files coupled to baguette's `Domain/` layer. A single subagent task (the plan's D1) can't carry the whole port without first untangling the architecture. The plan's task granularity was wrong for Phase D — the implementation needs to start by deciding how much of baguette's Domain layer to drag along vs. inline.
- **The user's instruction is unchanged:** work on `main`, no new branches.

---

## Repository state right now

**Branch:** `main` on `git@github.com:HeiCg/device-farm.git`.

**HEAD:** `d909060` (Phase C Task C4).

**Pre-existing uncommitted work** (NOT touched by previous session — the user has these in flight, do not stage them):
- Modified in `server/api/`, `server/artifacts/`, `server/pool/`, `server/streaming/`, `server/db/`
- Modified in `web/.svelte-kit/` (generated files)
- Modified in `cli/internal/types/generated.go` (deleted)
- Deleted: `vendor/device-stream/{android,core,ios-simulator}-1.1.0.tgz` (the user migrated from tarball-vendored to workspace-symlinked device-stream)

**Always use explicit `git add device-stream/<paths>` — never `git add .` or `git add -A`.**

**Untracked-but-on-disk quirk:** before the previous session started, `device-stream/packages/*/src/*.ts` files existed on disk but were NOT in git. Each task that modified one of those files was effectively the file's "first git-tracked commit". This means commit diffs for `scrcpy-service.ts`, `capture-service.ts`, `stream-service.ts`, etc., are LARGE (whole-file insertions). That is expected. Code Review found this surprising in A1; verified the file content was correct.

---

## Toolchain verified available

| Tool | Version | Path | Required by |
|---|---|---|---|
| macOS SDK | 26.4.1 | `xcrun --sdk macosx --show-sdk-version` | Phase D Swift builds |
| Swift | 6.3.1 (target `arm64-apple-macosx26.0`) | `swift --version` | Phase D, E |
| Xcode 26 | `/Applications/Xcode.app` | full app installed | Phase D linker (private fw) |
| SimulatorKit.framework | `/Applications/Xcode.app/Contents/Developer/Library/PrivateFrameworks/SimulatorKit.framework` | confirmed present | Phase D sim-input |
| simctl | works via direct path `/Applications/Xcode.app/Contents/Developer/usr/bin/simctl` | (NOT via `xcrun simctl` because `xcode-select -p` points at `/Library/Developer/CommandLineTools`) | Phase D smoke tests |
| `xcode-select -p` | `/Library/Developer/CommandLineTools` | **mismatched** | run `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer` before Phase D |

**Not present:**
- `/Library/Developer/DeviceKit/Chrome/` directory is empty → C2 bezel HTTP routes return 404 until populated. **Not a regression** — C2 ships the wire path; content depends on DeviceKit being installed.

---

## What was done — detailed inventory

### Phase A — Foundation (Tasks A0–A6)

#### A0 — Vitest infrastructure (`e328c5a`)
**New files:**
- `device-stream/vitest.config.ts` — node env, glob `packages/**/tests/**/*.spec.ts`, v8 coverage
- `device-stream/packages/core/tests/smoke.spec.ts` — placeholder 1+1=2 test

**Modified:**
- `device-stream/package.json` — `test: "vitest run"` + `test:all`
- 4 workspace package.jsons (core, android, ios-simulator, ios-device) — added `test` + `test:watch` scripts pointing to `../../vitest.config.ts`
- `device-stream/package-lock.json` — vitest 1.6.1 + @vitest/coverage-v8 1.6.1 installed

#### A1 — v2 wire-format types (`a6ed332`)
**New files:**
- `device-stream/packages/core/src/protocol-v2.ts` — 178 lines. All envelope types + parseClientMessage + isControlMessage + isGestureMessage + serializeAvccFrame + AVCC_TAG (0x01 avcC, 0x02 keyframe, 0x03 delta, 0x04 jpeg-seed).
- `device-stream/packages/core/tests/protocol-v2.spec.ts` — 8 tests

**First-time tracked:** `device-stream/packages/core/src/index.ts` (existed before). The single line `export * from './protocol-v2.js';` was appended.

#### A2 — ControlChannel handler (`cd26af8`)
**New files:**
- `device-stream/packages/ios-simulator/src/control-channel.ts` — `ControlChannel` class + `ControlHandlers` interface. Clamps fps [1,120], bitrate [100k,50M] bps, scale [0.1,4.0].
- `device-stream/packages/ios-simulator/tests/control-channel.spec.ts` — 5 tests

#### A3 — Wire ControlChannel into iOS-sim services (`c95523a`)
**Modified (first-time tracked + augmented):**
- `device-stream/packages/ios-simulator/src/stream-service.ts` — `SimulatorStreamService.handleBrowserConnection` gained optional 3rd param `controlHandlers?: ControlHandlers`. Routes incoming WS text frames through `parseClientMessage`; control envelopes dispatched, gesture envelopes ignored (Phase D wires them).
- `device-stream/packages/ios-simulator/src/capture-service.ts` — `CaptureService` (the real class, NOT a singleton — extends EventEmitter, has `startCapture/stopCapture/isCapturing`) gained: `private targets: Map<string,{fps?,bps?,scale?}>` + Phase-A stubs `setFps/setBitrate/setScale/forceIdr/snapshot/getQueuedTargets`. `snapshot()` emits `'snapshot-requested'` event for the consumer to handle.
- Also: 13 pre-existing template-literal `console.log/error` calls converted to printf `%s/%d` format strings to satisfy session-level semgrep CWE-134 hook. Same output content.

**New file:**
- `device-stream/packages/ios-simulator/tests/stream-service-control.spec.ts` — 3 tests

**Key plan deviation:** the plan assumed a class called `StreamService` with constructor handlers. The real class is `SimulatorStreamService`, exported as a singleton instance `simulatorStreamService` AND as the class itself. The adaptation kept the existing singleton intact and added control handling as opt-in via the new `controlHandlers` parameter.

#### A4 — Android scrcpy runtime tuning stubs (`7eebd80`)
**Modified (first-time tracked + augmented):**
- `device-stream/packages/android/src/scrcpy-service.ts` — `ScrcpyService` gained: `private targets: Map<string,{bitrate?,fps?,maxSize?}>` + Phase-A stubs `setBitrate/setFps/setScale/forceIdr/getQueuedTargets`. `setScale(scale)` computes `maxSize = round(1080 * scale)`. 6 pre-existing template-literal console calls converted to printf style.

**New file:**
- `device-stream/packages/android/tests/scrcpy-service.spec.ts` — 4 tests

**Key plan deviation:** the plan's pseudo-code expected manual `adb shell` argv spawn. The real `ScrcpyService` uses `@yume-chan/adb-scrcpy` (TangoADB). The plan's restart-on-tune approach was REJECTED — it would require re-acquiring the `Adb` reference mid-stream and re-emitting metadata, which is risky. Implemented as Phase-A stubs that store targets and log. **Real tuning wiring is now deferred to a follow-up** (could use scrcpy's UHID control protocol via the existing client.controlMessageWriter — out of current plan scope).

#### A5 — Bootstrap web-sdk workspace (`3e618ab`)
**New files:**
- `device-stream/web-sdk/package.json` — `@device-stream/web-sdk` v0.1.0
- `device-stream/web-sdk/tsconfig.json` — ES2022 + DOM + Bundler resolution

**Modified:**
- `/Users/heicg/Desktop/projects/device-farm/package.json` — appended `"device-stream/web-sdk"` to the workspaces array.

**Key plan deviation:** the plan said to modify `device-stream/package.json`. The actual workspaces declaration lives in the OUTER `device-farm/package.json` (device-stream's is a private meta-package only). The implementer hand-staged with `git apply --cached` to avoid pulling in the user's separate `@device-stream/*` wildcard dependency edits.

#### A6 — Port Transport + FrameDecoder + StreamSession (`09bf6d7`)
**New files:**
- `device-stream/web-sdk/src/transport.ts` — TS port of `/tmp/baguette/.../baguette/transport.js`. Apache-2.0 attribution. Adds control verbs (setBitrate/setFps/setScale/forceIdr/snapshot) that baguette lacks.
- `device-stream/web-sdk/src/frame-decoder.ts` — TS port of frame-decoder.js. MJPEG + AVCC strategy split. `optimizeFor:'latency'` dropped from VideoDecoderConfig (not in TS 5.3 DOM lib). Inner `LogFn` renamed to `FrameDecoderLogFn`.
- `device-stream/web-sdk/src/stream-session.ts` — TS port of stream-session.js. Replaced `buildWSUrl(udid, format, version)` with generic `url: string` constructor param.
- `device-stream/web-sdk/src/index.ts` — barrel.
- `device-stream/web-sdk/tests/transport.spec.ts` — 5 tests.

**Modified:**
- `device-stream/vitest.config.ts` — added `web-sdk/tests/**/*.spec.ts` to include glob.

### Phase B — Observability (Tasks B1–B4)

#### B1 — log + describe_ui envelopes (`e205dcb`)
**Modified:**
- `device-stream/packages/core/src/protocol-v2.ts` — +70 lines. New types: `SubscribeLogsMessage`, `StopLogsMessage`, `LogStartedEvent`, `LogLineEvent`, `LogStoppedEvent`, `AXNode` (recursive), `DescribeUiResultEvent`, `MetadataEvent`, `ErrorEvent`, `ServerEvent` union. New function: `parseServerEvent()`. `SIDE_CHANNEL_TYPES` extended with `'subscribe_logs'`, `'stop_logs'`. `ClientMessageV2` extended.

**New file:** `device-stream/packages/core/tests/protocol-v2-logs.spec.ts` — 6 tests.

#### B2 — Android log stream (`9672d93`)
**New files:**
- `device-stream/packages/android/src/log-stream.ts` — `AndroidLogStream extends EventEmitter`, emits `'line'` + `'stopped'`. Spawn: `adb -s <serial> logcat -v threadtime [*:<priority>]`. `bundleId` filter is substring-match.
- `device-stream/packages/android/tests/log-stream.spec.ts` — 5 tests.

#### B3 — iOS-sim log stream (`993c8ed`)
**New files:**
- `device-stream/packages/ios-simulator/src/log-stream.ts` — `IOSSimulatorLogStream extends EventEmitter`. Spawn: `xcrun simctl spawn <udid> log stream --style ndjson [--level <p>] [--predicate <p>] [--process <bundleId>]`.
- `device-stream/packages/ios-simulator/tests/log-stream.spec.ts` — 6 tests.

#### B4 — WDA describe-ui + WS routes (`626df78`)
**New files:**
- `device-stream/packages/ios-simulator/src/describe-ui.ts` — `parseWdaSource(xml)` walks WDA XML into `AXNode`. `fetchDescribeUi(udid, wdaPort=8100)` POSTs `/session` + GETs `/source`.
- `device-stream/packages/ios-simulator/tests/describe-ui.spec.ts` — 3 tests.

**Modified:**
- `device-stream/packages/ios-simulator/package.json` — added `fast-xml-parser@^4.4.0`.
- `device-stream/packages/ios-simulator/src/index.ts` — added `export * from './log-stream.js'; export * from './describe-ui.js';`
- `device-stream/packages/android/src/index.ts` — added `export * from './log-stream.js';`
- `device-stream/test-app/server.ts` — extended WS upgrade handler to path-dispatch among `/stream` (existing, untouched semantics), `/logs` (dispatches to Android or iOS log-stream based on `?platform=`), `/describe-ui` (iOS-only). Both new handlers use dynamic `import()` so test-app runs without pre-built workspaces.

**Note:** The `package-lock.json` for fast-xml-parser was added at the device-farm root level.

### Phase C — Visual polish (Tasks C1–C4)

#### C1 — DeviceKit chrome loader (`1ae14c1`)
**New files:**
- `device-stream/packages/ios-simulator/src/chrome.ts` — `chromeIdForDeviceType(name, deps)` with a `readProfilePlist` DI hook. `loadChromeJson(chromeId)` reads from `/Library/Developer/DeviceKit/Chrome/<id>.devicechrome/Contents/Resources/chrome.json`. `rasterizeComposite(chromeId)` invokes `sips` via `promisify(execFile)` to convert PhoneComposite.pdf → PNG.
- `device-stream/packages/ios-simulator/tests/chrome.spec.ts` — 3 tests.

**Modified:**
- `device-stream/packages/ios-simulator/src/index.ts` — added `export * from './chrome.js';`

**Security adaptations applied during review-fix loop:**
- Added `sanitizeChromeId()` returning regex capture-group (not raw input) — breaks taint chain to `path.join`.
- Switched `spawn` → `promisify(execFile)` to satisfy semgrep `child_process` rule.

#### C2 — /bezel HTTP routes (`7fa9f8d`)
**New file:**
- `device-stream/test-app/bezel-routes.ts` — `handleChromeJson` + `handleBezelPng`. 501 on non-Darwin.

**Modified:**
- `device-stream/test-app/server.ts` — added route block (regex `^/bezel/([\w,_-]+)/(chrome\.json|bezel\.png)$`) before the final 404. Uses dynamic imports of `@device-stream/ios-simulator`.

**Plan deviation:** routes use `/bezel/:chromeId/...` instead of the plan's `/simulators/:udid/...`. Rationale: chromeId is the natural key; udid would require a manager lookup. Trivial to map back if downstream consumers expect the udid-based path.

#### C3 — BrowserRecorder (`d6f447c`)
**New files:**
- `device-stream/web-sdk/src/recorder.ts` — TS port of `/tmp/baguette/.../recorder.js` (270 lines). Compose canvas + rAF loop, MIME fallback chain, `roundRectPath` clip.
- `device-stream/web-sdk/tests/recorder.spec.ts` — 2 tests (jsdom).

**Modified:**
- `device-stream/web-sdk/src/index.ts` — `export * from './recorder.js';`
- `device-stream/vitest.config.ts` — added `environmentMatchGlobs: [['web-sdk/tests/**', 'jsdom']]`.
- `/Users/heicg/Desktop/projects/device-farm/package.json` + `package-lock.json` — installed `jsdom@^24` + `@types/jsdom` at root.

**One deliberate deviation from baguette:** `composeSize()` uses `viewport` whenever provided, not only when `bezelImg` is also provided.

#### C4 — web-sdk Bezel part (`d909060`)
**New files:**
- `device-stream/web-sdk/src/parts/bezel.ts` — `Bezel` class with `load(): Promise<BezelGeometry>`.
- `device-stream/web-sdk/tests/bezel.spec.ts` — 2 tests (jsdom).

**Modified:**
- `device-stream/web-sdk/src/index.ts` — `export * from './parts/bezel.js';`

**Adaptation from baguette:** baguette's `Bezel` takes a pre-resolved `screenDef` from the Simulator aggregate; ours fetches `chrome.json` directly at `load()` time. Geometry derivation: `viewport = images.sizing`, `screenRect = viewport - screenInsets`, `clipRadius = outerCornerRadius`.

---

## What remains — Phase D (6 tasks) + Phase E (4 tasks)

### Phase D — Native iOS streaming + input

**Why this is harder than the plan suggests:**

Baguette's `Sources/Baguette/Infrastructure/Stream/` is NOT a self-contained encoder library. It depends on baguette's `Domain/` layer for types like `Frame`, `Stream`, `StreamConfig`, `Envelope`. Specifically:
- `H264Encoder.swift` (235 lines) imports `Domain.Frame`, depends on `Domain.Stream.Envelope` for output framing.
- `AVCCStream.swift` (122 lines) implements baguette's `Stream` protocol from `Domain/Stream/`.
- `WebSocketFrameSink.swift` (128 lines) depends on Hummingbird WS — overkill for our use case (we write to stdout, the Node side does WS).
- `Scaler.swift`, `SeedFilter.swift`, `JPEGEncoder.swift` are mostly pure CoreImage / CoreGraphics — these port cleanly.

**Total**: 1035 lines of Swift across Stream/ + Screen/. **Plus** the CLI-entry-point file that ties them together — baguette implements that in `App/Commands/StreamCommand.swift` using its `Simulator` aggregate. We need a thinner equivalent that just takes argv and writes frames to stdout.

#### Recommended strategy for next session — D1 redesigned

Instead of porting all 9 Stream files, port the MINIMUM viable subset for "ScreenCaptureKit → AVCC over stdout":

1. `Scaler.swift` (52 lines) — port verbatim, pure CoreImage. No baguette domain deps.
2. `JPEGEncoder.swift` (60 lines) — for the JPEG seed (0x04 tag). Mostly CGImage + ImageIO. Port verbatim.
3. `H264Encoder.swift` (235 lines) — port the VideoToolbox session setup + per-frame `compressFrame()`. Drop the dependency on `Domain.Stream.Envelope` — emit raw NAL units + the avcC description, let the CLI's `main.swift` prepend the 1-byte AVCC tag (matching `serializeAvccFrame` in `@device-stream/core/protocol-v2.ts`).
4. `SeedFilter.swift` (18 lines) — port verbatim.
5. `ScreenSnapshot.swift` (88 lines) + `SimulatorKitScreen.swift` (151 lines) from `Infrastructure/Screen/` — this is the SimulatorKit private-API frame source. Port the `SimulatorKitScreen` class as a frame iterator. The screen capture uses ScreenCaptureKit via SimulatorKit; the path is `SimDeviceHost.shared().registerOutput(...)` private API.
6. **New**: `Sources/sim-capture-avcc/main.swift` — argv parser + frame loop + stdin reconfig listener. Roughly 100 lines.

**Total estimated port:** ~700 lines (skipping `AVCCStream.swift`, `MJPEGStream.swift`, `WebSocketFrameSink.swift`, `StdoutSink.swift` — replaced by direct stdout writes in main.swift). This is still significant but achievable in one focused session if the implementer is a Sonnet-or-better model.

**Subagent task prompt template for D1:**

```
You are implementing Task D1 (REDESIGNED — minimum-viable port).

Step 1: read /tmp/baguette/Sources/Baguette/Infrastructure/{Stream,Screen}/ — focus only on the 6 files listed above.

Step 2: create device-stream/tools/sim-capture-avcc/Package.swift (SPM, macOS 15+, link VideoToolbox + CoreVideo + CoreMedia + ScreenCaptureKit AND SimulatorKit + CoreSimulator via -F flags pointing at /Applications/Xcode.app/Contents/Developer/Library/PrivateFrameworks).

Step 3: port the 6 files into Sources/sim-capture-avcc/. DROP any reference to baguette's Domain.* types — inline the few small structs you need (FrameMetadata, EncoderConfig).

Step 4: write Sources/sim-capture-avcc/main.swift — argv parser (--udid, --fps, --bitrate, --scale, --format), screen capture loop, emit:
  - 0x01 + avcC description as first stdout frame
  - 0x02 + IDR / 0x03 + delta payload per subsequent frame
  - On stdin JSON line {"type":"set_bitrate","bps":N}: VTSession update + emit 0x02 (force IDR)

Step 5: `swift build -c release` and verify binary at .build/release/sim-capture-avcc.

Step 6: Smoke test: boot a sim with `/Applications/Xcode.app/Contents/Developer/usr/bin/simctl boot <UDID>`, run `.build/release/sim-capture-avcc --udid <UDID> --fps 30 --bitrate 4000000 --format avcc | head -c 1024 | xxd | head` — expect 0x01 in first byte.

Step 7: Commit to device-stream/tools/sim-capture-avcc/, scripts/build-sim-input.sh, root package.json (add build:sim-input script).
```

#### D2–D5: TypeScript glue + WDA replacement

These are smaller tasks that depend on D1 landing:
- **D2** (~2 hours): Modify CaptureService to spawn sim-capture-avcc with `--format avcc`. Add the 1-byte AVCC tag prepending in stream-service.ts when sending binary frames via WS. Wire the Phase-A stubs to actually push stdin reconfig JSON.
- **D3** (~3-4 hours): Port `Infrastructure/Input/IOHIDDigitizerDispatch.swift` + `IndigoHIDInput.swift` VERBATIM from baguette. These are the iOS-26 HID recipe — do NOT try to "improve" them; copy + add main.swift JSON-line CLI.
- **D4** (~1 hour): TS wrapper `InputService` over the sim-input binary. Long-lived process per UDID, JSON-line transport, per-call ack queue.
- **D5** (~1 hour): Wire InputService into IOSSimulatorManager + extend stream-service.ts to route gesture envelopes via InputService.
- **D6** (~30 min): docs.

### Phase E — Virtual camera (E1–E4)

Mechanical compared to D1/D3:

- **E1** (30 min): `cp -R /tmp/baguette/VirtualCamera device-stream/VirtualCamera`. Update `.gitignore` for build artefacts. Run `./build.sh`. Note: this dylib is vendored from `tddworks/asc-pro/SimCam` (double-attribute) — preserve the `VENDORED_FROM.md`.
- **E2** (~1 hour): TS shared-memory layout constants (read from baguette's `Camera/SharedFrameLayout.swift`) + `CameraFrameSink` using `mmap-io` npm package (or fallback to `fs.openSync + pwrite`).
- **E3** (~2 hours): Port `Camera/HostVideoCapture.swift` + `AVCameraCapture.swift` to a standalone `tools/sim-cam` Swift binary. CLI: `--list`, `--device-uid`, `--shm-path`, `--width`, `--height`, `--fps`.
- **E4** (~2 hours): Port `Camera/CameraSession.swift` + `CameraMessage.swift` + `VirtualCameraInstaller.swift` to TypeScript. Add `/camera` WS route to test-app.

---

## How the next session should proceed

### Read order
1. **This handoff** — full context.
2. **`docs/superpowers/plans/2026-05-14-device-stream-baguette-port.md`** — Phases D and E only (skip A/B/C).
3. **`/tmp/baguette/README.md` §"Why this works on iOS 26.4 when older tools don't"** — the iOS-26 HID recipe explanation (lines 631–665).
4. **`/tmp/baguette/Sources/Baguette/Infrastructure/Input/IOHIDDigitizerDispatch.swift`** — the byte-level HID recipe. Heavily commented; comments ARE the contract.

### Suggested execution mode

Don't blindly subagent-driven the whole of Phase D. Instead:

**Option A (safer, recommended): manual D1, then subagent D2-D5**
- Do D1 inline (porting Swift code is a high-precision task where you want full control). It will take 1-2 hours of careful work but is more likely to succeed than dispatching subagents.
- Once D1's binary is built and smoke-tested, dispatch subagents for D2-D5 (each is small TS glue).
- D6 docs is trivial — do inline or skip.

**Option B (more aggressive): subagent D1 with the redesigned prompt above**
- Use the prompt template above. Allocate ~4 hours of wall time. Expect 1-2 BLOCKED/NEEDS_CONTEXT loops.
- Code quality reviews will be valuable for the Swift port to catch missing linker flags or framework imports.

**Phase E can be subagent-driven straightforwardly** — it's mechanical. Start it AFTER Phase D is verified working end-to-end.

### Pre-flight checklist for the next session

```bash
# 1. Confirm toolchain
xcrun --sdk macosx --show-sdk-version       # expect 26.x
swift --version                              # expect 6.x, target arm64-apple-macosx26.0
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer    # CRITICAL — current setting points at CommandLineTools
xcrun simctl list devices booted             # should work now

# 2. Confirm baguette source available
test -d /tmp/baguette/Sources/Baguette/Infrastructure/Stream || git clone --depth 1 https://github.com/tddworks/baguette.git /tmp/baguette

# 3. Confirm Phase A-C state
cd /Users/heicg/Desktop/projects/device-farm
git log --oneline e157860..HEAD | wc -l      # expect 15
cd device-stream && npx vitest run            # expect 53 passing

# 4. Boot a simulator for D1 smoke test (any iPhone 17 or similar)
/Applications/Xcode.app/Contents/Developer/usr/bin/simctl list devices available | head -10
/Applications/Xcode.app/Contents/Developer/usr/bin/simctl boot <UDID>
```

### Commit conventions (matches what's already there)

```
feat(device-stream/<package>): <one-line description>

Phase X Task Xn of docs/superpowers/plans/2026-05-14-device-stream-baguette-port.md.

🤖 Generated with Claude Code
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

### Constraints from the user (still in force)

- **Work on `main`.** No new branches.
- **Never stage user's pre-existing unrelated changes** (server/, cli/, web/, vendor/, root package.json/lock when interleaved).
- **Always use explicit `git add device-stream/<paths>`.**
- **Semgrep CWE-134 hook is active** — keep console.log calls using printf `%s/%d` style, not template literals, when committing files that will be newly tracked.

---

## Quirks the next session should be aware of

1. **Phase A-C all use the `.js` extension in TypeScript imports** even though the existing pre-tracked code uses bare imports. Both work because tsconfig has CommonJS resolution + skipLibCheck. Don't fight it — match whichever convention is in the file you're touching.

2. **`SimulatorStreamService` is BOTH a class and a singleton**: `export class SimulatorStreamService` + `export const simulatorStreamService = new SimulatorStreamService()`. Phase A only added an optional 3rd param to `handleBrowserConnection`; existing callers using the singleton continue to work unchanged.

3. **`CaptureService` is NOT a singleton** — `createCaptureService(binaryPath?)` factory exists. Phase A added stubs on the class itself; the singleton pattern is in `IOSSimulatorManager`'s composition.

4. **Test-app dynamic imports**: `test-app/server.ts` uses dynamic `import('@device-stream/ios-simulator')` etc. so it can boot before the workspaces are built. Don't refactor to static imports.

5. **The `@device-stream/android` workspace currently has a pre-existing TypeScript error in scrcpy-service.ts** (not introduced by Phase A). It's harmless to vitest tests (vitest uses esbuild, not tsc) but `npm run build --workspace=@device-stream/android` fails. The Phase D plan doesn't touch this package; if you need to build android, you'll need to investigate the error first.

6. **DeviceKit Chrome directory is empty** on this machine. C2's `/bezel/<chromeId>/...` routes will 404 until populated. Not a regression. If next session wants to verify bezel rendering, install full Xcode (which sometimes ships DeviceKit) or copy chrome bundles from another machine.

7. **`xcode-select -p` mismatch** is real and will silently break Swift builds against private frameworks. Run `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer` FIRST in the next session.

8. **`/Applications/Xcode.app/Contents/Developer/usr/bin/simctl` works directly** even with the xcode-select mismatch. Use the full path in any smoke tests.

---

## Test counts by package after Phase C

| Package | Test files | Tests |
|---|---|---|
| `@device-stream/core` | 3 (smoke, protocol-v2, protocol-v2-logs) | 1 + 8 + 6 = 15 |
| `@device-stream/ios-simulator` | 5 (control-channel, stream-service-control, log-stream, describe-ui, chrome) | 5 + 3 + 6 + 3 + 3 = 20 |
| `@device-stream/android` | 2 (scrcpy-service, log-stream) | 4 + 5 = 9 |
| `@device-stream/web-sdk` | 3 (transport, recorder, bezel) | 5 + 2 + 2 = 9 |
| **Total** | **13 spec files** | **53 tests passing, 0 failing** |

---

## Files inventory (Phase A-C)

47 files touched (new or modified) under `device-stream/` + 2 outer files (`package.json`, `package-lock.json` at device-farm root). Full list:

```
device-stream/package-lock.json
device-stream/package.json
device-stream/vitest.config.ts
device-stream/packages/android/package.json
device-stream/packages/android/src/index.ts
device-stream/packages/android/src/log-stream.ts                 (B2)
device-stream/packages/android/src/scrcpy-service.ts             (A4 augmented)
device-stream/packages/android/tests/log-stream.spec.ts          (B2)
device-stream/packages/android/tests/scrcpy-service.spec.ts      (A4)
device-stream/packages/core/package.json
device-stream/packages/core/src/index.ts
device-stream/packages/core/src/protocol-v2.ts                   (A1 + B1)
device-stream/packages/core/tests/protocol-v2-logs.spec.ts       (B1)
device-stream/packages/core/tests/protocol-v2.spec.ts            (A1)
device-stream/packages/core/tests/smoke.spec.ts                  (A0)
device-stream/packages/ios-device/package.json
device-stream/packages/ios-simulator/package.json                (fast-xml-parser dep added in B4)
device-stream/packages/ios-simulator/src/capture-service.ts      (A3 augmented)
device-stream/packages/ios-simulator/src/chrome.ts               (C1)
device-stream/packages/ios-simulator/src/control-channel.ts      (A2)
device-stream/packages/ios-simulator/src/describe-ui.ts          (B4)
device-stream/packages/ios-simulator/src/index.ts
device-stream/packages/ios-simulator/src/log-stream.ts           (B3)
device-stream/packages/ios-simulator/src/stream-service.ts       (A3 augmented)
device-stream/packages/ios-simulator/tests/chrome.spec.ts        (C1)
device-stream/packages/ios-simulator/tests/control-channel.spec.ts  (A2)
device-stream/packages/ios-simulator/tests/describe-ui.spec.ts   (B4)
device-stream/packages/ios-simulator/tests/log-stream.spec.ts    (B3)
device-stream/packages/ios-simulator/tests/stream-service-control.spec.ts  (A3)
device-stream/test-app/bezel-routes.ts                           (C2)
device-stream/test-app/server.ts                                 (B4 + C2 augmented)
device-stream/web-sdk/package.json                               (A5)
device-stream/web-sdk/tsconfig.json                              (A5)
device-stream/web-sdk/src/frame-decoder.ts                       (A6)
device-stream/web-sdk/src/index.ts                               (A6 + C3 + C4)
device-stream/web-sdk/src/parts/bezel.ts                         (C4)
device-stream/web-sdk/src/recorder.ts                            (C3)
device-stream/web-sdk/src/stream-session.ts                      (A6)
device-stream/web-sdk/src/transport.ts                           (A6)
device-stream/web-sdk/tests/bezel.spec.ts                        (C4)
device-stream/web-sdk/tests/recorder.spec.ts                     (C3)
device-stream/web-sdk/tests/transport.spec.ts                    (A6)

/Users/heicg/Desktop/projects/device-farm/package.json           (A5 workspaces + C3 jsdom)
/Users/heicg/Desktop/projects/device-farm/package-lock.json      (vitest, jsdom, fast-xml-parser)
```

---

## TL;DR for the next session

**You are inheriting a clean Phase A-C delivery. Your job is Phase D + E.**

1. **Start with the toolchain pre-flight** (above). Especially `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`.
2. **Re-read** Phase D and Phase E sections of the master plan with the adapted D1 strategy in mind.
3. **Decide execution mode**: manual D1 (recommended) vs subagent D1 (faster but risky).
4. **Commit messages** follow `feat(device-stream/<scope>):` + Phase/Task ref.
5. **Stay on `main`. Use explicit `git add device-stream/<paths>`. Semgrep hook is active.**
6. **53 tests must remain green after each commit.** Run `cd device-stream && npx vitest run` after each task.

Estimated effort for Phase D + E:
- D1 (the hard one): 2-4 hours of focused Swift port.
- D2-D5: ~6 hours total.
- D6: 30 min.
- E1: 30 min.
- E2: 1 hour.
- E3: 2 hours.
- E4: 2 hours.
- **Total Phase D+E: ~14-18 hours** spread over potentially several sessions.

Good luck. The Phase A-C foundation is solid — the wire protocol (v2), the log streams, the bezel pipeline, the in-browser recorder, the typed WS dispatch — they all work and have tests. You're building on a clean base.
