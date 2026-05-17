# Runbook: sim-capture-private (SimulatorKit Private Bridge)

Phase 32 — operational guide for the `sim-capture-private` daemon, the SimulatorKit-based replacement for ScreenCaptureKit capture in `@device-stream/ios-simulator`.

## Purpose

The `sim-capture-private` daemon receives IOSurface frames directly from the iOS simulator backboard process via Apple's private `SimulatorKit` and `CoreSimulator` frameworks, then H.264-encodes them with VideoToolbox and emits them over a Unix domain socket. It replaces the legacy `sim-capture-avcc` (ScreenCaptureKit) pipeline with three operational wins:

1. **No TCC prompt.** ScreenCaptureKit needs Screen Recording permission. The private bridge attaches to the simulator's screen adapter directly — no permission dialog appears on fresh macOS users or CI runners.
2. **Headless capture.** Frames flow from the simulator's backboard process without requiring `Simulator.app` to host a visible window.
3. **Lower latency.** Frames arrive when the simulator renders, not when the compositor next refreshes a hidden host window.

**Trade-off:** binds to private Apple frameworks that can rename between Xcode releases. Mitigated by a dyld exports-trie symbol resolver and the [`sim-private-matrix.yml`](../../.github/workflows/sim-private-matrix.yml) daily Xcode-matrix CI workflow.

## Prerequisites

- macOS 13+ on **Apple Silicon (arm64)**. Intel Macs are NOT supported (the bridge uses ARM64 inline-asm shims to call Swift property getters by raw function pointer).
- Xcode 15.4+ installed (Xcode-select set to a real Xcode install, or `DEVELOPER_DIR` env var pointing at one — `xcode-select -p` MUST resolve to a `*.app/Contents/Developer` path, NOT `/Library/Developer/CommandLineTools`).
- `xcodegen` on PATH: `brew install xcodegen`.
- A booted iOS simulator UDID: `xcrun simctl list devices | head`.

## Install

```bash
cd device-farm
npm install            # postinstall hook builds sim-capture-private on darwin/arm64
# OR build manually:
bash device-stream/scripts/build-sim-capture-private.sh
ls -l device-stream/bin/sim-capture-private   # should exist + +x
```

The postinstall hook is non-blocking: if the build fails (e.g. on a non-Apple-Silicon host or a host without Xcode), `npm install` still exits 0. The TypeScript adapter (`SimCapturePrivateClient.spawn`) detects the missing binary at runtime and falls back to `sim-capture-avcc`.

## Verify (smoke)

```bash
device-stream/scripts/smoke-sim-private.sh <UDID>
# Expects: SMOKE: OK on stdout, exit code 0
```

The smoke script boots the simulator (or asserts it's already booted), runs `--probe`, spawns the daemon, reads 30 frames over the Unix socket, then cleanly tears down. See [`smoke-sim-private.sh`](../../device-stream/scripts/smoke-sim-private.sh).

## Verify (probe — symbol resolution only)

```bash
device-stream/bin/sim-capture-private --probe <UDID>
# Expects: "OK: 8/8 symbols resolved", exit 0
```

If the probe fails with `MISSING: <role>`, the local Xcode version has drifted Apple's mangled Swift symbol layout. See [§Troubleshooting](#troubleshooting).

## Configuration

| Env var | Effect |
|---------|--------|
| `DEVICE_STREAM_SIM_PRIVATE=0` | Disable the private bridge; force fallback to ScreenCaptureKit (`sim-capture-avcc`) |
| `DEVICE_STREAM_SIM_PRIVATE=1` (or unset) | Use the private bridge first; fall back automatically on spawn failure |
| `DEVELOPER_DIR` | Override path to Xcode (e.g., `/Applications/Xcode_16.0.app/Contents/Developer`) |
| `DEVICE_STREAM_SKIP_BUILD=1` | Skip the native build during `npm install` postinstall (no-op) |

## Manual verification: zero TCC prompt (SIM-PRIV-01)

This verification requires a fresh macOS user account to validate cleanly. Pre-existing accounts may already have ScreenCapture permission cached.

1. Create a fresh test user via **System Settings → Users & Groups → Add User**.
2. Log out of the current account, log into the new test user. Do NOT pre-grant any Screen Recording permission.
3. From a terminal in that user account:
   ```bash
   git clone <device-farm repo>
   cd device-farm
   npm install
   xcrun simctl boot "<UDID>"
   ./bin/device-farm run --platform ios --apk <ipa> /path/to/flow.yaml
   ```
4. **Verify:** NO system permission prompt appears asking to allow Screen Recording for the terminal, Node, or any helper binary.
5. **Verify:** the job completes with frames streamed to the dashboard.

If a prompt appears, the private daemon failed to spawn and the fallback engaged. Inspect logs (`~/Library/Logs/...`) and re-run with `DEVICE_STREAM_SIM_PRIVATE=1 NODE_DEBUG=stream` to surface diagnostics.

## Visual-diff verification (SIM-PRIV-03)

```bash
device-stream/scripts/sim-visual-diff.sh <UDID>
# Captures ~60s with both the private bridge and the ScreenCaptureKit fallback;
# computes SSIM via ffmpeg. Pass criterion: SSIM ≥ 0.995 (≤ 0.5% pixel diff).
```

This script is informational (always exits 0 in CI) but logs `PASS`/`FAIL` to stdout. Run interactively against a calibration app for ground truth.

## Touch-latency verification (SIM-PRIV-04)

```bash
device-stream/scripts/sim-touch-latency.sh <UDID>
# Sends 10 0xC1 touch frames via the daemon socket and measures
# touch_sent_ts → frame_with_touch_visual_ts delta. Reports median to stdout.
# Pass criterion (manual review): median ≤ ScreenCaptureKit baseline.
```

## Soak (memory leak detection)

```bash
device-stream/scripts/sim-soak.sh <UDID> --duration 1h
# Uses `leaks <pid>` after the run + RSS monitoring every 60s.
# Pass criterion: no RSS growth > 50 MB after a 5-minute warm-up window.
```

## CI

The daily matrix workflow [`sim-private-matrix.yml`](../../.github/workflows/sim-private-matrix.yml) runs on `macos-14` runners across Xcode 15.4 / 16.0 / 16.1 / 17.x. It executes daily at 09:00 UTC and on manual dispatch:

```bash
gh workflow run sim-private-matrix.yml
```

Failing matrix legs are not fail-fast — each Xcode version reports independently so a single-version Apple symbol drift does not mask the other legs.

## Troubleshooting

### Probe fails with `MISSING: SimDevice.screenAdapter.getter` (or any other symbol role)

The Swift mangled symbol changed in this Xcode release. Two options:

1. **Disable the private bridge.** Set `DEVICE_STREAM_SIM_PRIVATE=0` and the fallback `sim-capture-avcc` (ScreenCaptureKit) takes over. File an issue with the Xcode version and the missing role.
2. **Update the symbol prefix.** Edit `kDSCriticalSymbols` in `device-stream/native-servers/sim-capture-private/Sources/Probe.mm` with the new mangled prefix; re-run `--probe` to confirm. See `32-RESEARCH.md` §Symbol resolution for the trie walker behavior and §Common Pitfalls Pitfall 1 for the Xcode 26.4 break that prompted this design.

### Daemon spawn fails with `EACCES` or Gatekeeper block

The helper is unsigned (per CONTEXT.md §Deferred — code-signing is post-canary). macOS Gatekeeper may quarantine it on first run:

```bash
xattr -d com.apple.quarantine device-stream/bin/sim-capture-private || true
```

### `surfacesChanged` callback never fires (no frames within 10 s)

Open Question #1 in `32-RESEARCH.md`: SimulatorKit may require `activateDisplayIfNeeded` (which transitively needs an offscreen NSWindow host) on some configurations. Workarounds:

- Fall back via `DEVICE_STREAM_SIM_PRIVATE=0` and file an issue with the Xcode + macOS version.
- Check that the simulator was booted (`xcrun simctl bootstatus <UDID> -b`) BEFORE the daemon was spawned.

### Build fails with `Framework SimulatorKit not found`

- `xcode-select -p` resolves to Command Line Tools, NOT a full Xcode install:
  ```bash
  sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
  ```
- `DEVELOPER_DIR` points at the wrong Xcode (matrix CI sets it per Xcode version).

### `npm install` reports build failure but does not abort

This is intentional. The postinstall script always exits 0 (`process.exit(0)`); the runtime fallback in `SimCapturePrivateClient.spawn` checks `fs.existsSync(binaryPath)` and throws when missing, which `CaptureService` catches and routes to `sim-capture-avcc`. To re-attempt the build:

```bash
bash device-stream/scripts/build-sim-capture-private.sh
```

### Socket `/tmp/device-stream-sim-<udid>.sock` collision

If a previous daemon crashed without cleaning up:

```bash
rm /tmp/device-stream-sim-<udid>.sock
```

The smoke script unlinks stale sockets at startup; production callers do the same in `SimCapturePrivateClient.spawn` before `child_process.spawn`.

## Related

- Phase brief: [`.planning/phases/32-simulatorkit-bridge/32-BRIEF.md`](../../.planning/phases/32-simulatorkit-bridge/32-BRIEF.md)
- Research: [`.planning/phases/32-simulatorkit-bridge/32-RESEARCH.md`](../../.planning/phases/32-simulatorkit-bridge/32-RESEARCH.md)
- Validation: [`.planning/phases/32-simulatorkit-bridge/32-VALIDATION.md`](../../.planning/phases/32-simulatorkit-bridge/32-VALIDATION.md)
- Build script: [`device-stream/scripts/build-sim-capture-private.sh`](../../device-stream/scripts/build-sim-capture-private.sh)
- Reference impl (study-only): kittyfarm `KittyFarm/PrivateSimulator/DFPrivateSimulatorDisplayBridge.m`
