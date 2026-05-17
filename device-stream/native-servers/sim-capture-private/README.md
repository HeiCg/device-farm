# sim-capture-private

Private SimulatorKit-based daemon that captures iOS Simulator backboard frames
directly (IOSurface → CVPixelBuffer → H.264) without ScreenCaptureKit, then
streams them over a Unix socket. Replaces the TCC-prompting compositor path with
a headless, lower-latency alternative.

**Status:** scaffolding only (Phase 32 in progress). The daemon is a stub until
Plans 32-01..32-04 land. The `xcodebuild` invocation below is gated by Plan
32-04 (T-32.6); Wave 0 (this commit) only ships the project structure + test
scaffolds.

## Build

This target depends on private frameworks (`SimulatorKit`, `CoreSimulator`)
and requires a **full Xcode installation** (not just Command Line Tools).

```bash
# 1. Generate the .xcodeproj from project.yml (XcodeGen — `brew install xcodegen`)
xcodegen generate

# 2. Build the Release config
xcodebuild \
  -project sim-capture-private.xcodeproj \
  -scheme sim-capture-private \
  -configuration Release \
  -derivedDataPath build \
  build
```

The convenience wrapper at `device-stream/scripts/build-sim-capture-private.sh`
does both steps and stages the binary at `device-stream/bin/sim-capture-private`.

## Tests

```bash
xcodegen generate
xcodebuild \
  -project sim-capture-private.xcodeproj \
  -scheme Tests \
  -only-testing:Tests \
  test
```

All native tests ship as `XCTSkip` placeholders in Wave 0 — they activate as
each later wave lands its implementation (see file headers in `Tests/`).

The TypeScript adapter test lives at
`device-stream/packages/ios-simulator/tests/sim-capture-private-client.spec.ts`
and is exercised by the regular `npx vitest run` inside `packages/ios-simulator`.

## Signing

The binary runs **unsigned** during development. macOS Gatekeeper may quarantine
it on first run — clear with `xattr -d com.apple.quarantine path/to/binary`.
Signed builds for distribution are deferred to a later phase.

## Opt-out

The TypeScript adapter (Plan 32-04) consults `DEVICE_STREAM_SIM_PRIVATE=0` at
runtime and falls back to the existing ScreenCaptureKit path when the env var
is set or when this binary is missing / fails to start. Default once Plan 32-04
ships: opt-in (`DEVICE_STREAM_SIM_PRIVATE=1`); flips to default-on after the
first green Xcode-matrix CI run.

## Runbook

See `docs/runbooks/sim-capture-private.md` (created in Plan 32-05).

## Layout

```
sim-capture-private/
├── project.yml          # XcodeGen spec — 2 targets (daemon + XCTest)
├── README.md            # this file
├── .gitignore           # ignores generated .xcodeproj + build/
├── Sources/
│   ├── main.mm          # entry point (stub until Plan 32-01)
│   ├── Probe.mm         # symbol-resolution probe (stub until Plan 32-01)
│   ├── Bridge.h         # public bridge surface (implemented in Plans 02-04)
│   ├── DyldSymbols.h    # trie-walker surface (implemented in Plan 01)
│   └── IpcServer.h      # Unix-socket IPC surface (implemented in Plan 03)
└── Tests/
    ├── DyldSymbolsTests.mm  # SIM-PRIV-02 — XCTSkip scaffolds
    ├── IpcFramerTests.mm    # SIM-PRIV-REF — XCTSkip scaffolds
    ├── TouchInjectTests.mm  # SIM-PRIV-04 unit — XCTSkip scaffolds
    └── Fixtures/
        ├── MockSimDevice.h
        └── MockSimDevice.mm
```
