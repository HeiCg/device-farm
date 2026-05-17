---
phase: 32
slug: simulatorkit-bridge
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-15
---

# Phase 32 — Validation Strategy

> Per-phase validation contract. Mixed-language phase (Obj-C++, Swift, TypeScript) with native build steps.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Frameworks** | XCTest (Obj-C++ native target) · Vitest (TypeScript adapter) · `xcodebuild test` smoke (Xcode matrix) |
| **Config files** | `device-stream/native-servers/sim-capture-private/sim-capture-private.xcodeproj` (Wave 0 installs) · `device-stream/packages/ios-simulator/vitest.config.ts` (exists) · `.github/workflows/sim-private-matrix.yml` (Wave 0 installs) |
| **Quick run** | `cd device-stream/packages/ios-simulator && npx vitest run` |
| **Native quick** | `xcodebuild -project sim-capture-private.xcodeproj -scheme Tests test -quiet` |
| **Full suite** | `npm test && npm run build:sim-capture-private && xcodebuild ... test` |
| **Estimated runtime** | ~45s TS · ~90s native unit · ~5min Xcode-matrix CI (daily, not gating) |

---

## Sampling Rate

- **After every task commit:** Quick run of whichever surface that task touched (TS or native)
- **After every plan wave:** Both quick runs
- **Before phase verify:** Full suite green + at least one real-sim smoke (manual or scripted)
- **Max feedback latency:** 90 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 32-T1 | 01 | 1 | SIM-PRIV-01 (8/8 symbols resolve) | unit (XCTest) | `xcodebuild ... -only-testing:Tests/DyldSymbolsTests test` | ❌ W0 | ⬜ pending |
| 32-T2 | 02 | 2 | SIM-PRIV-02 (frame callback) | build-check | `xcodebuild ... -scheme sim-capture-private build` (no dedicated test target — verified by Plan 02 daemon build) | ❌ W0 | ⬜ pending |
| 32-T3 | 03 | 2 | SIM-PRIV-03 (HID injection) | unit | `xcodebuild ... -only-testing:Tests/TouchInjectTests test` | ❌ W0 | ⬜ pending |
| 32-T4 | 04 | 3 | SIM-PRIV-04 (H.264 + IPC) | unit | `xcodebuild ... -only-testing:Tests/IpcFramerTests test` | ❌ W0 | ⬜ pending |
| 32-T5 | 05 | 4 | SIM-PRIV-05 (TS adapter + fallback) | unit | `cd device-stream/packages/ios-simulator && npx vitest run sim-capture-private-client.spec` | ❌ W0 | ⬜ pending |
| 32-T6 | 06 | 4 | SIM-PRIV-REF (build script idempotent) | integration | `bash device-stream/scripts/build-sim-capture-private.sh && test -x device-stream/bin/sim-capture-private` | ❌ W0 | ⬜ pending |
| 32-T7 | 07 | 5 | SIM-PRIV-06 (matrix CI) | CI | `gh workflow run sim-private-matrix.yml` (manual) | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `device-stream/native-servers/sim-capture-private/sim-capture-private.xcodeproj` — XcodeGen-produced project
- [ ] `device-stream/native-servers/sim-capture-private/project.yml` — XcodeGen spec
- [ ] `device-stream/native-servers/sim-capture-private/Tests/` — XCTest target with fixtures
- [ ] `device-stream/packages/ios-simulator/tests/sim-capture-private-client.spec.ts` — TS stubs
- [ ] `device-stream/scripts/build-sim-capture-private.sh` — build wrapper
- [ ] `device-stream/scripts/postinstall.js` — install hook (currently doesn't exist; Wave 0 creates)
- [ ] `.github/workflows/sim-private-matrix.yml` — daily Xcode-matrix smoke

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Zero TCC permission prompt on fresh macOS user | SIM-PRIV-01 | Permission flow is per-user OS-level, cannot mock | Create fresh macOS user, run `device-farm run` on iOS sim job, verify no system prompt appears |
| Visual diff < 0.5% vs ScreenCaptureKit baseline | SIM-PRIV-04 | Requires same boot, same content, pixel-comparable captures | Script: boot sim, install calibration app, capture 60s with both paths, compute SSIM in CI artifact |
| Touch latency ≤ baseline | SIM-PRIV-03 | Requires high-FPS capture of physical action → on-screen response | Manual stopwatch on calibration screen with millisecond timer, 10 samples each path |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (XCTest target, vitest spec, build script, postinstall, CI workflow)
- [ ] No watch-mode flags
- [ ] Feedback latency < 90s for unit; manual/CI for integration
- [ ] `nyquist_compliant: true` set in frontmatter once Wave 0 lands

**Approval:** pending
