---
phase: 14-fix-device-preview-pipeline
verified: 2026-04-15T23:57:00Z
status: human_needed
score: 4/4 must-haves verified
human_verification:
  - test: "Start server, run a job on Android emulator, connect to /ws/devices/:id/preview WebSocket"
    expected: "Binary H.264 frame data delivered over WebSocket during job execution"
    why_human: "Cannot verify live frame delivery without running emulator + job execution end-to-end"
  - test: "Start server, run a job on iOS simulator, connect to /ws/devices/:id/preview WebSocket"
    expected: "JPEG frame buffers delivered over WebSocket during job execution"
    why_human: "Cannot verify live CaptureService frameData events without running simulator + job"
  - test: "Run a recording job on Android while preview WebSocket is connected"
    expected: "Recording file is produced AND preview frames are delivered (no conflict)"
    why_human: "Callback chaining correctness under real ScrcpyService requires live execution"
---

# Phase 14: Fix Device Preview Pipeline Verification Report

**Phase Goal:** Device preview WebSocket delivers live frames from emulators/simulators via device-stream adapters
**Verified:** 2026-04-15T23:57:00Z
**Status:** human_needed (all automated checks passed; live delivery requires human test)
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | DevicePreviewManager receives a real adapter factory that creates platform-specific adapters | VERIFIED | `server/jobs/plugin.ts:37-39` calls `fastify.devicePreview.setAdapterFactory(createAdapterFactory(...))` |
| 2 | Android preview adapter taps into ScrcpyService recording callback without breaking recording | VERIFIED | `android-preview-adapter.ts:30-46` chains callbacks — saves `session.onPacket`, calls it first, then preview handler; `stop()` restores original at lines 51-55 |
| 3 | iOS preview adapter listens on CaptureService frameData events filtered by deviceId | VERIFIED | `ios-preview-adapter.ts:33-39` registers `captureService.on('frameData', ...)` with deviceId filter; `stop()` calls `captureService.off(...)` with exact reference |
| 4 | Preview WebSocket delivers frames to connected clients during job execution | VERIFIED (automated) / UNCERTAIN (live) | Factory wired at plugin startup; DevicePreviewManager.startPreview() calls adapter.start() then fans out frames via subscriber pattern — but live delivery requires emulator/simulator |

**Score:** 4/4 truths verified (automated); 3 truths need human confirmation for live execution

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `server/streaming/adapters/android-preview-adapter.ts` | AndroidPreviewAdapter implementing DeviceStreamAdapter | VERIFIED | Exports `AndroidPreviewAdapter`, implements `start/onFrame/stop`, chains recording callbacks |
| `server/streaming/adapters/ios-preview-adapter.ts` | IosPreviewAdapter implementing DeviceStreamAdapter | VERIFIED | Exports `IosPreviewAdapter`, uses `captureService.on('frameData')`, decodes base64 JPEG |
| `server/streaming/adapters/index.ts` | createAdapterFactory function | VERIFIED | Exports `createAdapterFactory`, returns platform-correct adapter |
| `server/streaming/device-preview.ts` | DevicePreviewManager with setAdapterFactory | VERIFIED | `setAdapterFactory(factory: AdapterFactory): void` at line 92 |
| `server/streaming/__tests__/android-preview-adapter.test.ts` | Unit tests for AndroidPreviewAdapter | VERIFIED | 7 tests, all pass |
| `server/streaming/__tests__/ios-preview-adapter.test.ts` | Unit tests for IosPreviewAdapter | VERIFIED | 6 tests, all pass |
| `server/streaming/__tests__/adapter-factory.test.ts` | Unit tests for adapter factory | VERIFIED | 3 tests, all pass |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `server/jobs/plugin.ts` | `server/streaming/device-preview.ts` | `devicePreview.setAdapterFactory(...)` | WIRED | Line 37: `fastify.devicePreview.setAdapterFactory(createAdapterFactory(fastify.scrcpyService, fastify.captureService))` |
| `server/streaming/adapters/android-preview-adapter.ts` | `@device-stream/android ScrcpyService` | `setRecordingCallback` with callback chaining | WIRED | Line 37: `this.scrcpyService.setRecordingCallback(deviceId, ...)` with chained handler |
| `server/streaming/adapters/ios-preview-adapter.ts` | `@device-stream/ios-simulator CaptureService` | `captureService.on('frameData', ...)` | WIRED | Line 39: `this.captureService.on('frameData', this.eventHandler)` |

### Requirements Coverage

| Requirement | Source | Description | Status | Evidence |
|-------------|--------|-------------|--------|----------|
| INTG-01 | Gap closure (PLAN gap_closure: true) | Device preview adapter factory missing | SATISFIED | `createAdapterFactory` in `adapters/index.ts`; wired in `jobs/plugin.ts` |
| FLOW-01 | Gap closure (PLAN gap_closure: true) | Device preview delivers no frames | SATISFIED (needs live confirmation) | Adapter factory wired; adapters connect to ScrcpyService/CaptureService frame sources |

**Note:** REQUIREMENTS.md lines 112-113 still show INTG-01 and FLOW-01 as "Pending" — the tracking document was not updated after implementation. The implementation is complete; this is a documentation-only discrepancy.

### Anti-Patterns Found

None. No TODO/FIXME/placeholder comments, no empty implementations, no stub handlers found in any of the 8 files.

### Human Verification Required

#### 1. Android Preview Frame Delivery

**Test:** Start server with `npm run dev`, submit a job against Android emulator, open a WebSocket connection to `ws://localhost:3000/ws/devices/:id/preview`
**Expected:** Binary WebSocket messages containing H.264 frames arrive while the job is running
**Why human:** ScrcpyService requires a live emulator session; cannot simulate the full recording callback chain in unit tests

#### 2. iOS Preview Frame Delivery

**Test:** Start server, submit a job against an iOS simulator, connect to `/ws/devices/:id/preview`
**Expected:** WebSocket messages containing raw JPEG bytes arrive while the job runs
**Why human:** CaptureService requires a live simulator session; `frameData` EventEmitter events only fire during real capture

#### 3. Android Recording + Preview Coexistence

**Test:** Submit a recording-enabled Android job while preview WebSocket is connected
**Expected:** Both a recording artifact is created AND preview frames are delivered to the WebSocket subscriber
**Why human:** Callback chaining correctness (`originalCallback` save/restore) must be validated under real ScrcpyService with an H264FrameSource already attached

### Gaps Summary

No automated gaps found. All artifacts exist, are substantive (no stubs), and are correctly wired. The 16 new unit tests all pass. The only open items are live integration behaviors that require running emulators/simulators and cannot be verified by static analysis.

---

_Verified: 2026-04-15T23:57:00Z_
_Verifier: Claude (gsd-verifier)_
