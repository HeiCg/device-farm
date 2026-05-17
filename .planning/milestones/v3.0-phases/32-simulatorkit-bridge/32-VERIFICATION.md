---
phase: 32-simulatorkit-bridge
verified: 2026-05-15T23:59:00Z
status: human_needed
score: 6/7 must-haves verified (1 requires real simulator)
human_verification:
  - test: "Zero TCC prompt on fresh macOS user (SIM-PRIV-01)"
    expected: "Running `device-farm run` on an iOS sim job produces no Screen Recording permission dialog on a fresh macOS user account that has never granted ScreenCapture permission."
    why_human: "OS-level permission flow is per-user and cannot be mocked or grepped. The runbook at docs/runbooks/sim-capture-private.md documents the exact 5-step verification procedure."
  - test: "Visual diff < 0.5% vs ScreenCaptureKit baseline (SIM-PRIV-03)"
    expected: "SSIM >= 0.995 when comparing private-bridge H.264 frames vs sim-capture-avcc frames on the same booted simulator content."
    why_human: "Requires a real booted iOS simulator, a calibration app, and ffmpeg SSIM computation. device-stream/scripts/sim-visual-diff.sh implements this but exits 0 informational-only (no CI gate yet per deferred-items.md)."
  - test: "Touch latency <= ScreenCaptureKit baseline (SIM-PRIV-04)"
    expected: "Median latency (touch sent -> first AU frame showing effect) is no greater than the sim-capture-avcc baseline measured on the same host."
    why_human: "Requires a real booted simulator, a calibration app with a millisecond timer, and physical measurement. device-stream/scripts/sim-touch-latency.sh implements the harness but is informational-only."
  - test: "Smoke script end-to-end on a real booted simulator"
    expected: "`bash device-stream/scripts/smoke-sim-private.sh <udid>` exits 0 and prints 'SMOKE: OK' after reading 30 frames from the daemon."
    why_human: "Requires a real iOS simulator UDID and Apple Silicon host. The script logic has been verified correct but cannot be executed without a booted simulator."
  - test: "CI matrix green on Xcode 16.0+ (SIM-PRIV-06)"
    expected: ".github/workflows/sim-private-matrix.yml runs and the build + probe + smoke steps pass on the macos-14 GitHub runner with Xcode 16.0 and 16.1."
    why_human: "CI matrix requires GitHub-hosted Apple Silicon runners and the simulator to boot during the run. The workflow YAML is structurally correct but live execution on multiple Xcode versions requires a real CI trigger."
---

# Phase 32: SimulatorKit Private Bridge Verification Report

**Phase Goal:** Replace ScreenCaptureKit-based iOS simulator capture with SimulatorKit private APIs that get IOSurface frames directly from the simulator process — no TCC prompt, no compositor latency, headless capable.
**Verified:** 2026-05-15
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | dyld exports-trie symbol resolver (DSFindSwiftSymbol) is a verbatim port from kittyfarm with DF→DS rename, no external repo dep | VERIFIED | `DyldSymbols.mm` (389 lines) contains `uleb128`, `LC_DYLD_EXPORTS_TRIE`, ARM64 asm shim; zero DF-prefixed identifiers in production code; no kittyfarm/simvyn/revyl/app-explorer/mobile-devtools in package.json or project.yml |
| 2 | `sim-capture-private --probe <udid>` prints `OK: 8/8 symbols resolved` output path exists | VERIFIED | `Probe.mm` calls `DSProbeCriticalSymbols()` and emits the `8 symbols resolved` message; `Bridge.mm` contains `kDSCriticalSymbols` with 8 entries locked; DyldSymbolsTests has 4 real XCTAssert cases (not XCTSkip) covering the 8-count contract |
| 3 | Screen attach sequence + IOSurface → CVPixelBuffer pipeline exists | VERIFIED | `ScreenAttach.mm` (493 lines) contains `registerScreenCallbacksWithUUID` and `DSResolveSwiftSymbol` calls for screenAdapter getter; 10s polling loop for adapter screens; Pitfall 7 Xcode 26.4 screen unwrap |
| 4 | HID touch injection via IndigoHIDMessageForMouseNSEvent + dispatch_semaphore sync | VERIFIED | `TouchInject.mm` (298 lines) contains `IndigoHIDMessageForMouseNSEvent`; `sendWithMessage:freeWhenDone:` via objc_msgSend; 4 real TouchInjectTests XCTAssert cases (previously XCTSkip, now un-skipped) |
| 5 | H.264 encoder (VTCompressionSession) + Unix-socket IPC server with locked wire format | VERIFIED | `H264Encoder.mm` (249 lines) contains `VTCompressionSessionCreate` + Baseline_AutoLevel/30fps/4Mbps config; `IpcServer.mm` (380 lines) contains `AF_UNIX` + wire kinds 0x01/0x02/0xC1/0xC9; 4 real IpcFramerTests passing |
| 6 | TypeScript adapter gates on `format === 'avcc' && DEVICE_STREAM_SIM_PRIVATE !== '0'` and falls back on spawn failure | VERIFIED | `capture-service.ts` line 118: `const tryPrivate = format === 'avcc' && process.env.DEVICE_STREAM_SIM_PRIVATE !== '0'`; dynamic import of `SimCapturePrivateClient`; 5 Vitest spec cases all real (not `it.todo`) covering framer round-trip, frame events, env=0 opt-out, spawn-failure fallback, sendTouch byte layout |
| 7 | Zero TCC prompt on fresh macOS user (runtime behavior) | HUMAN NEEDED | The daemon uses CoreSimulator IOSurface backboard path (no ScreenCaptureKit). Code evidence is correct; runtime confirmation requires a fresh macOS user account per the 5-step runbook procedure. |

**Score:** 6/7 truths verified automatically; 1 requires human

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `device-stream/native-servers/sim-capture-private/project.yml` | XcodeGen spec with 2 targets + SimulatorKit | VERIFIED | Contains `targets:`, `Tests:`, `SimulatorKit`, `/Library/Developer/PrivateFrameworks` |
| `device-stream/native-servers/sim-capture-private/Sources/DyldSymbols.mm` | Trie walker + uleb128 + ARM64 asm, ≥200 lines | VERIFIED | 389 lines, contains `uleb128`, ARM64 asm `mov x20` |
| `device-stream/native-servers/sim-capture-private/Sources/Bridge.mm` | `kDSCriticalSymbols` + `DSLoadPrivateFrameworks` | VERIFIED | Contains `kDSCriticalSymbols`, `dlopen.*CoreSimulator` pattern |
| `device-stream/native-servers/sim-capture-private/Sources/ScreenAttach.mm` | Attach sequence + frame callback, ≥200 lines | VERIFIED | 493 lines, `registerScreenCallbacksWithUUID`, `DSResolveSwiftSymbol` |
| `device-stream/native-servers/sim-capture-private/Sources/TouchInject.mm` | HID injection + dispatch_semaphore | VERIFIED | 298 lines, `IndigoHIDMessageForMouseNSEvent`, `sendWithMessage:freeWhenDone:` |
| `device-stream/native-servers/sim-capture-private/Sources/H264Encoder.mm` | VTCompressionSession, ≥150 lines | VERIFIED | 249 lines, `VTCompressionSessionCreate` |
| `device-stream/native-servers/sim-capture-private/Sources/IpcServer.mm` | AF_UNIX server + framer, ≥200 lines | VERIFIED | 380 lines, `AF_UNIX`, wire kinds in header |
| `device-stream/native-servers/sim-capture-private/Sources/Probe.mm` | Real probe, not stub | VERIFIED | Calls `DSProbeCriticalSymbols()`, outputs `8 symbols resolved` |
| `device-stream/native-servers/sim-capture-private/Tests/DyldSymbolsTests.mm` | Real XCTAssert (un-skipped) | VERIFIED | 7 XCTAssert/XCTSkip instances; 4 real assertions cover symbol count=8, NULL-resolve, probe count |
| `device-stream/native-servers/sim-capture-private/Tests/IpcFramerTests.mm` | Real round-trip tests (un-skipped) | VERIFIED | 6 XCTAssert instances covering wire-shape, 0xC1 decode, partial reassembly |
| `device-stream/native-servers/sim-capture-private/Tests/TouchInjectTests.mm` | Real HID round-trip tests (un-skipped) | VERIFIED | 6 XCTAssert instances covering DSIndigoMessage lifecycle + send round-trip |
| `device-stream/native-servers/sim-capture-private/Tests/Fixtures/MockSimDevice.h` | Interface for duck-typed mock | VERIFIED | Exists with `onHIDSend` property |
| `device-stream/native-servers/sim-capture-private/Tests/Fixtures/MockSimDevice.mm` | Mock implementation | VERIFIED | Contains `objc_allocateClassPair` reference |
| `device-stream/packages/ios-simulator/src/sim-capture-private-client.ts` | Node IPC client, ≥150 lines | VERIFIED | 279 lines, `DEVICE_STREAM_SIM_PRIVATE`, `spawn`, `device-stream/bin/sim-capture-private` |
| `device-stream/packages/ios-simulator/src/capture-service.ts` | Gate on format+env | VERIFIED | `format === 'avcc' && process.env.DEVICE_STREAM_SIM_PRIVATE !== '0'` at line 118; `SimCapturePrivateClient` imported dynamically |
| `device-stream/packages/ios-simulator/tests/sim-capture-private-client.spec.ts` | 5 real Vitest cases | VERIFIED | 5 `it(...)` implementations (not `it.todo`), describe block present |
| `device-stream/scripts/build-sim-capture-private.sh` | Real xcodebuild (no stub) | VERIFIED | Contains `xcodegen`, `xcodebuild`; `SIM_PRIVATE_WAVE0_STUB` removed |
| `device-stream/scripts/postinstall.js` | Links to build script | VERIFIED | Contains `build-sim-capture-private.sh` reference |
| `device-stream/scripts/smoke-sim-private.sh` | Real smoke (not stub) | VERIFIED | Contains `simctl boot`, `--probe`, python3 length-prefix framer, `SMOKE: OK` |
| `device-stream/scripts/sim-visual-diff.sh` | SSIM script | VERIFIED | Exists (3.8K) |
| `device-stream/scripts/sim-touch-latency.sh` | Latency script | VERIFIED | Exists (3.7K) |
| `device-stream/scripts/sim-soak.sh` | Soak script | VERIFIED | Exists (3.2K) |
| `device-stream/bin/sim-capture-private` | Executable daemon binary | VERIFIED | Exists at `device-stream/bin/sim-capture-private` (129 KB, `-rwxr-xr-x`) |
| `docs/runbooks/sim-capture-private.md` | Runbook ≥100 lines with TCC procedure | VERIFIED | 173 lines, SIM-PRIV-01 manual verification 5-step procedure at §Manual verification |
| `.github/workflows/sim-private-matrix.yml` | Daily matrix workflow, 4 Xcode versions | VERIFIED | Contains `matrix:`, `xcode:`, `smoke-sim-private.sh`; 4 Xcode versions (15.4/16.0/16.1/17.0) |
| `.planning/phases/32-simulatorkit-bridge/deferred-items.md` | Deferred catalog | VERIFIED | Contains `Code-signing` and `Multi-display` entries |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `Probe.mm` | `DyldSymbols.mm` | `DSProbeCriticalSymbols()` call | VERIFIED | `DSProbeCriticalSymbols` found in Probe.mm |
| `Bridge.mm` | CoreSimulator.framework | `dlopen` | VERIFIED | `dlopen.*CoreSimulator` pattern confirmed in Bridge.mm |
| `ScreenAttach.mm` | `DyldSymbols.mm` | `DSResolveSwiftSymbol` for screenAdapter | VERIFIED | Lines 83 and 257 call `DSResolveSwiftSymbol` |
| `IpcServer.mm` | `H264Encoder.mm` | encoder writes 0x01/0x02 frames to socket | VERIFIED | `g_encoder` in main.mm; `[g_encoder encodePixelBuffer:...]` at line 62; IpcServer.h declares wire kinds 0x01/0x02 |
| `IpcServer.mm` | `TouchInject.h` | decoded 0xC1 calls `bridge_send_touch` | VERIFIED | main.mm line 80: `bridge_send_touch(x, y, phase, pressure, touchId)` dispatched from touch handler |
| `main.mm` | `IpcServer.h` | `DSIpcServer` instantiation in daemon mode | VERIFIED | `g_ipc = [[DSIpcServer alloc] initWithSocketPath:...]` at line 28 of main.mm |
| `capture-service.ts` | `sim-capture-private-client.ts` | `SimCapturePrivateClient` dynamic import | VERIFIED | Lines 121-122: `const { SimCapturePrivateClient } = await import('./sim-capture-private-client.js')` |
| `sim-capture-private-client.ts` | `device-stream/bin/sim-capture-private` | `child_process.spawn` | VERIFIED | `DEFAULT_BINARY_PATH = path.resolve(__dirname, '../../../bin/sim-capture-private')` at line 43 |
| `postinstall.js` | `build-sim-capture-private.sh` | `spawnSync bash` | VERIFIED | `build-sim-capture-private.sh` reference confirmed in postinstall.js |
| `.github/workflows/sim-private-matrix.yml` | `smoke-sim-private.sh` | workflow run step | VERIFIED | `smoke-sim-private.sh` in workflow YAML |

---

## Requirements Coverage

| Requirement | Source Plans | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| SIM-PRIV-01 | 32-05 | Zero TCC prompt on fresh macOS user | HUMAN NEEDED | Runbook §Manual verification 5-step procedure exists; binary avoids ScreenCaptureKit by design (CoreSimulator backboard path). Requires live fresh-user test. |
| SIM-PRIV-02 | 32-01 | `--probe` prints `OK: 8/8 symbols resolved` | VERIFIED | Probe.mm + DyldSymbols.mm implement the probe; DyldSymbolsTests has 4 real assertions locking the 8-count; binary at `device-stream/bin/sim-capture-private` is executable |
| SIM-PRIV-03 | 32-02, 32-03 | H.264 stream visually equivalent to ScreenCaptureKit (SSIM ≥ 0.995) | HUMAN NEEDED | H264Encoder.mm implements VTCompressionSession with correct config (Baseline_AutoLevel/30fps/4Mbps). sim-visual-diff.sh implements the SSIM check. Live comparison against real simulator required. |
| SIM-PRIV-04 | 32-02, 32-03 | Touch latency ≤ ScreenCaptureKit baseline | HUMAN NEEDED | TouchInject.mm + dispatch_semaphore sync; TouchInjectTests passing with MockHIDClient. sim-touch-latency.sh harness exists. Live measurement on real simulator required. |
| SIM-PRIV-05 | 32-04 | Env opt-out + spawn failure → fallback to sim-capture-avcc | VERIFIED | `capture-service.ts` line 118 gates on `format === 'avcc' && DEVICE_STREAM_SIM_PRIVATE !== '0'`; 2 Vitest cases cover env=0 short-circuit and spawn-throws fallback; all 5 spec cases are real implementations |
| SIM-PRIV-06 | 32-05 | CI matrix passes on Xcode 16.0+ | HUMAN NEEDED | `.github/workflows/sim-private-matrix.yml` is structurally correct (4 Xcode versions, build+boot+smoke steps, no soft-fail echoes). Live CI execution on GitHub-hosted macos-14 runners required. |
| SIM-PRIV-REF | 32-00..32-05 | Faithful kittyfarm port; no external repo dep | VERIFIED | Zero kittyfarm/simvyn/revyl-cli/app-explorer/mobile-devtools in package.json / project.yml; DF→DS rename applied throughout Sources/; IpcFramerTests + Vitest framer spec prove wire-format byte compatibility; REQUIREMENTS.md §Phase 32 traceability table exists |

---

## External Dependency Policy (Critical Check)

**Result: CLEAN**

All three checked locations are free of forbidden reference repo dependencies:
- `device-stream/package.json` — no kittyfarm/simvyn/revyl-cli/app-explorer/mobile-devtools
- `device-stream/packages/ios-simulator/package.json` — no forbidden deps
- `device-stream/native-servers/sim-capture-private/project.yml` — no forbidden deps

References to `kittyfarm` in source files are exclusively in comments (study citations with file:line references), never as import paths or dependency declarations. The External Dependencies Policy is honored.

---

## Anti-Patterns Found

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| `.planning/ROADMAP.md` line 68 | Summary list shows `[ ]` for Phase 32 while the detailed §Phase 32 section (line 319-324) shows all 6 plans as `[x]` complete | Info | Cosmetic inconsistency — STATE.md and the Phase Details section are authoritative and correctly show Phase 32 CLOSED. The summary list `[ ]` is not updated, but this does not affect any automated check. |

No blocker anti-patterns found. No production stubs (`return null`, `return {}`, `not implemented` handlers) in delivered source files. The smoke-sim-private.sh has the word "stub" in a Wave-0 comment at the top (`# replaces the Wave 0 stub`) — this is a historical comment, not a stub implementation; the file is 105 lines of real bash logic.

---

## Human Verification Required

### 1. Zero TCC prompt on fresh macOS user (SIM-PRIV-01)

**Test:** Follow the 5-step procedure in `docs/runbooks/sim-capture-private.md` §Manual verification: create a fresh macOS user, log in with no pre-granted Screen Recording permission, run `device-farm run` on an iOS sim job.
**Expected:** No system permission dialog appears for Screen Recording. The job completes successfully.
**Why human:** OS-level TCC permission flow is per-user and per-session. It cannot be mocked or verified by code inspection alone.

### 2. H.264 visual quality vs ScreenCaptureKit (SIM-PRIV-03)

**Test:** Boot a simulator, capture 60 seconds with both private bridge and sim-capture-avcc, run `bash device-stream/scripts/sim-visual-diff.sh <udid>`.
**Expected:** SSIM ≥ 0.995 reported ("SSIM PASS").
**Why human:** Requires a real booted iOS simulator, ffmpeg installation, and side-by-side capture. Script exits 0 informational-only (gate not yet in CI).

### 3. Touch latency vs baseline (SIM-PRIV-04)

**Test:** Run `bash device-stream/scripts/sim-touch-latency.sh <udid>` on a booted simulator with a calibration app showing a millisecond timer. Compare result to sim-capture-avcc baseline.
**Expected:** Median latency (touch → on-screen frame showing tap) ≤ ScreenCaptureKit baseline.
**Why human:** Requires physical measurement on real hardware; script is informational-only.

### 4. Smoke test on real simulator (SIM-PRIV-02 end-to-end)

**Test:** Boot a simulator, run `bash device-stream/scripts/smoke-sim-private.sh <udid>`.
**Expected:** Exits 0, prints "SMOKE: OK". Probe passes 8/8 symbols, 30 frames read successfully.
**Why human:** Requires a real iOS simulator UDID on an Apple Silicon host. The script logic is verified correct by inspection.

### 5. Xcode matrix CI green on 16.0+ (SIM-PRIV-06)

**Test:** Run `gh workflow run sim-private-matrix.yml` and observe all 4 matrix legs (Xcode 15.4, 16.0, 16.1, 17.0).
**Expected:** Build step passes, probe passes 8/8, smoke passes on Xcode 16.0 and 16.1 at minimum.
**Why human:** CI execution requires GitHub-hosted macos-14 Apple Silicon runners and live simulator boot.

---

## Gaps Summary

No gaps blocking goal achievement. All programmatically verifiable artifacts exist, are substantive, and are wired correctly. The 5 human-verification items above are expected for a native macOS daemon phase — they are all documented as Manual-Only in `32-VALIDATION.md` and require a real iOS simulator, a fresh macOS user, or CI runner access.

The ROADMAP summary list at line 68 shows `[ ]` for Phase 32 while the Phase Details section correctly shows all 6 plans complete. This is a cosmetic documentation inconsistency (not a code gap); STATE.md and REQUIREMENTS.md both correctly record Phase 32 as CLOSED.

---

_Verified: 2026-05-15_
_Verifier: Claude (gsd-verifier)_
