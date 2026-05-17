---
phase: 33-android-grpc
verified: 2026-05-16T10:00:00Z
status: human_needed
score: 9/9 must-haves verified
re_verification: true
  previous_status: gaps_found
  previous_score: 7/9
  gaps_closed:
    - "Pool-manager propagates grpcPort from BootResult to Device entity (all 3 boot sites)"
    - "setStreamingService called in production via pool/plugin.ts inside android.enabled block"
  gaps_remaining: []
  regressions: []
human_verification:
  - test: "Boot an Android emulator and confirm gRPC frame streaming path is active"
    expected: "Process tree shows android-grpc-stream daemon; web dashboard receives frames via gRPC (not scrcpy); scrcpy-server.jar mtime is unchanged"
    why_human: "Requires live emulator boot + adb + Pool integration — cannot verify programmatically"
  - test: "Touch on emulator routes through GrpcEmuClient, not ADB"
    expected: "Tapping in web dashboard sends 0xC1 frames via Unix socket; no 'adb shell input tap' process spawned"
    why_human: "Requires live session with gRPC wired; production wiring is now present but runtime behavior needs live verification"
  - test: "Physical Android device still uses scrcpy (regression check)"
    expected: "device.kind=physical -> scrcpy path taken; android-grpc-stream daemon NOT spawned"
    why_human: "Requires physical Android device connected via ADB"
---

# Phase 33: Android gRPC EmulatorController Verification Report

**Phase Goal:** Stream Android emulator frames and inject input via the emulator's built-in gRPC EmulatorController + MMAP transport, eliminating the scrcpy-server.jar dependency. Physical Android stays on scrcpy.
**Verified:** 2026-05-16T10:00:00Z
**Status:** human_needed
**Re-verification:** Yes — after gap closure by plan 33-06

---

## Re-verification Summary

Two BLOCKER gaps identified in the initial verification (2026-05-16T08:30:00Z) are now closed:

**Gap 1 — grpcPort discarded by pool-manager: CLOSED**
- `server/pool/device.ts` line 25: `grpcPort: number | null` field added to Device class
- `server/pool/device.ts` line 39: `this.grpcPort = null` initializer present
- `server/pool/device.ts` line 82: `grpcPort: this.grpcPort` included in `toInfo()` return
- `server/pool/pool-manager.ts` line 145: `device.grpcPort = result.grpcPort ?? null` in initPool boot path
- `server/pool/pool-manager.ts` line 316: `device.grpcPort = result.grpcPort ?? null` in allocate per-job reboot path
- `server/pool/pool-manager.ts` line 444: `device.grpcPort = result.grpcPort ?? null` in replaceDevice path
- All 3 boot sites now propagate grpcPort from BootResult to Device entity.

**Gap 2 — setStreamingService never called in production: CLOSED**
- `server/pool/plugin.ts` line 37: `import { androidDeviceService, androidStreamingService } from '@device-stream/android'`
- `server/pool/plugin.ts` line 68: `androidDeviceService.setStreamingService(androidStreamingService)` called inside `if (config.pool.android.enabled)` block
- The `_streaming` field on `AndroidDeviceService` is now populated at server startup; `tap()` and `pressKey()` will route through gRPC when the active session is `kind: 'grpc'`.

No regressions detected on the 7 previously-passing truths.

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Go daemon exists at device-stream/native-servers/android-grpc/ with all required packages | VERIFIED | All 7 packages present: proto (+ gen/), auth, client, mmap, ipc, encode, cmd/android-grpc-stream |
| 2 | Daemon binary builds via build-android-grpc.sh | VERIFIED | Pre-built binary at device-stream/bin/android-grpc-stream (14.5 MB); Makefile with proto/build/test targets confirmed |
| 3 | Emulator spawn injects `-grpc <port>` | VERIFIED | emulator.ts: allocateGrpcPort(), `-grpc String(grpcPort)` argv injection, BootResult returns grpcPort |
| 4 | Node-side adapter exists at device-stream/packages/android/src/grpc-emu-client.ts | VERIFIED | 371-line substantive implementation: spawn, parse loop, touch/key frame encoding, WS forwarding, stop teardown |
| 5 | Streaming service prefers gRPC for emulators with scrcpy fallback | VERIFIED | service.ts: 4-stage selection rule (emulator + grpcPort != null + env check + try/catch fallback) |
| 6 | Pool-manager propagates grpcPort from BootResult to Device entity for production use | VERIFIED | pool-manager.ts lines 145, 316, 444 all assign `device.grpcPort = result.grpcPort ?? null`; Device.toInfo() includes grpcPort |
| 7 | setStreamingService wired in production server initialization | VERIFIED | plugin.ts line 68 calls setStreamingService inside android.enabled block; singletons imported from @device-stream/android |
| 8 | CI matrix, runbook, and verification scripts present and substantive | VERIFIED | .github/workflows/android-grpc-matrix.yml (55 lines); docs/runbooks/android-grpc.md (221 lines); 4 verify scripts |
| 9 | Physical Android still routes to scrcpy (not regressed) | VERIFIED | service.ts line 7: `device.kind !== 'emulator' -> scrcpy`; selection rule unchanged |

**Score:** 9/9 truths verified

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `device-stream/native-servers/android-grpc/proto/` | Proto files + Go stubs | VERIFIED | emulator_controller.proto + gen/emulatorcontrol/*.pb.go |
| `device-stream/native-servers/android-grpc/auth/` | Token discovery | VERIFIED | token.go, ini.go — macOS path; Linux deferred per DEFERRED-33-A |
| `device-stream/native-servers/android-grpc/client/` | gRPC client + touch/key | VERIFIED | client.go (278 lines); StreamFrames/SendTouch/SendKey/authCtx |
| `device-stream/native-servers/android-grpc/mmap/` | MMAP transport | VERIFIED | mmap_unix.go (CGO), mmap_fallback.go (loopback) |
| `device-stream/native-servers/android-grpc/ipc/` | IPC framer | VERIFIED | framer.go, server.go |
| `device-stream/native-servers/android-grpc/encode/` | VideoToolbox encoder | VERIFIED | encoder_darwin.m (Objective-C); encoder_fallback.go |
| `device-stream/native-servers/android-grpc/cmd/android-grpc-stream/main.go` | Daemon entrypoint | VERIFIED | 216-line implementation wiring all packages |
| `device-stream/bin/android-grpc-stream` | Compiled binary | VERIFIED | 14.5 MB executable |
| `device-stream/packages/android/src/grpc-emu-client.ts` | Node-side adapter | VERIFIED | spawn, parse loop, sendTouch, sendKey, stop |
| `device-stream/packages/android/src/service.ts` | Streaming service selector | VERIFIED | 4-stage selection rule, routeTap/routeKey, singleton export |
| `device-stream/packages/android/src/device-service.ts` | tap/pressKey routing | VERIFIED | setStreamingService() defined; _streaming routing branches at lines 135-136 and 169-172; now called from plugin.ts |
| `server/pool/android/emulator.ts` | -grpc flag injection | VERIFIED | allocateGrpcPort helper, -grpc argv injection, BootResult includes grpcPort |
| `server/pool/types.ts` | BootResult.grpcPort | VERIFIED | grpcPort?: number in BootResult interface |
| `server/types/index.ts` | DeviceInfo.grpcPort | VERIFIED | grpcPort?: number | null in DeviceInfo interface |
| `server/pool/device.ts` | Device.grpcPort field + toInfo() | VERIFIED | grpcPort: number | null field (line 25); initialized null (line 39); included in toInfo() (line 82) |
| `server/pool/pool-manager.ts` | grpcPort propagation at all 3 boot sites | VERIFIED | Lines 145, 316, 444: `device.grpcPort = result.grpcPort ?? null` |
| `server/pool/plugin.ts` | setStreamingService wiring | VERIFIED | Import + call on lines 37 and 68 inside android.enabled block |
| `.github/workflows/android-grpc-matrix.yml` | CI matrix | VERIFIED | 55-line workflow with reactivecircus/android-emulator-runner steps |
| `docs/runbooks/android-grpc.md` | Operator runbook | VERIFIED | 221 lines |
| `device-stream/scripts/smoke-android-grpc.sh` | Smoke script | VERIFIED | 163 lines |
| `device-stream/scripts/android-grpc-soak.sh` | Soak script | VERIFIED | 136 lines |
| `device-stream/scripts/android-grpc-touch.sh` | Touch latency script | VERIFIED | 151 lines |
| `device-stream/scripts/android-grpc-visual.sh` | Visual diff script | VERIFIED | 152 lines |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| grpc-emu-client.ts | device-stream/bin/android-grpc-stream | child_process.spawn + --serial + --grpc-port + --socket | WIRED | DEFAULT_BINARY_PATH resolves to native-servers; spawn args confirmed |
| service.ts | grpc-emu-client.ts | import + GrpcEmuClient.spawn(serial, grpcPort, ws) | WIRED | Import + spawn call within selection rule |
| device-service.ts | service.ts (AndroidStreamingService) | setStreamingService injection + session.kind === 'grpc' routing | WIRED | setStreamingService now called from plugin.ts line 68; routing branches at device-service.ts lines 135-136 and 169-172 |
| emulator.ts | BootResult.grpcPort | return statement includes grpcPort | WIRED | `return { port, pid: proc.pid!, grpcPort }` |
| pool-manager.ts | Device.grpcPort | boot() result.grpcPort stored on Device entity | WIRED | Lines 145, 316, 444: all three boot sites assign grpcPort |
| plugin.ts | androidDeviceService.setStreamingService | @device-stream/android singleton import + call | WIRED | Lines 37 (import) + 68 (call) in plugin.ts |
| build-android-grpc.sh | native-servers/android-grpc/Makefile | make proto + make build | WIRED | Script calls make proto then make build |
| android-grpc-matrix.yml | smoke-android-grpc.sh | reactivecircus emulator-runner script step | WIRED | `script: bash device-stream/scripts/smoke-android-grpc.sh test` |

---

## Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| AND-GRPC-PROTO | 33-01 | Proto files + Go gRPC codegen stubs | SATISFIED | proto/emulator_controller.proto + gen/emulatorcontrol/*.pb.go |
| AND-GRPC-AUTH | 33-01 | gRPC Bearer token discovery (macOS) | SATISFIED | auth/token.go: per-instance INI + global fallback; Linux deferred (DEFERRED-33-A) |
| AND-GRPC-CLIENT | 33-02 | gRPC client: StreamFrames + SendTouch + SendKey | SATISFIED | client/client.go; all three RPCs implemented |
| AND-GRPC-IPC | 33-02 | IPC framer: Unix socket wire protocol | SATISFIED | ipc/framer.go; ipc/server.go |
| AND-GRPC-SPAWN | 33-03 | Emulator spawns with -grpc flag; BootResult.grpcPort | SATISFIED | emulator.ts argv injection + BootResult; pool-manager stores it on Device |
| AND-GRPC-TS | 33-04 | Node adapter GrpcEmuClient; AndroidStreamingService selection rule | SATISFIED | GrpcEmuClient and AndroidStreamingService complete and wired; grpcPort now propagated to Device entity |
| AND-GRPC-TOUCH | 33-04 | Touch/key route through daemon when grpc session active | SATISFIED | Routing branches implemented and setStreamingService now called in production |
| AND-GRPC-INSTALL | 33-05 | Build script + CI + runbook + verify scripts | SATISFIED | All artifacts verified present and substantive |

---

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| auth/token.go | 36 | TODO(phase-37+) Linux token path returns "" | Info | Documented in DEFERRED-33-A; graceful fallback to scrcpy on Linux |
| encode/encoder_fallback.go | 7 | Non-darwin returns error | Info | Documented in DEFERRED-33-G; intentional; DEVICE_STREAM_ANDROID_GRPC=0 workaround documented |

No blocker anti-patterns remain. The three blockers from the initial verification (grpcPort discarded, Device missing field, setStreamingService uncalled) are resolved.

---

## Human Verification Required

### 1. End-to-end gRPC streaming with live emulator

**Test:** Boot an Android emulator via device-farm server; submit a job; inspect process tree for android-grpc-stream daemon.
**Expected:** Daemon spawned; web dashboard receives H.264 frames via gRPC path; scrcpy-server.jar mtime unchanged; /tmp/device-stream-android-emu-*.sock present.
**Why human:** Requires live emulator + adb + full server stack. Production wiring is now present — this is a smoke test, not a gap investigation.

### 2. Touch injection via gRPC

**Test:** With server running, tap in web dashboard while monitoring for ADB `input tap` vs Unix socket writes.
**Expected:** 0xC1 frame written to daemon socket; no `adb shell input tap` process spawned.
**Why human:** Requires live session + socket monitoring.

### 3. Physical Android scrcpy non-regression

**Test:** Connect a physical Android device; start streaming; verify android-grpc-stream is NOT spawned.
**Expected:** Only scrcpy path used for physical device; device.kind check in service.ts routes directly to scrcpy.
**Why human:** Requires physical device; programmatic check only covers code path, not runtime behavior.

---

_Verified: 2026-05-16T10:00:00Z_
_Verifier: Claude (gsd-verifier)_
