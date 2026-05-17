---
phase: 33
slug: android-grpc
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-16
completed: 2026-05-16
---

# Phase 33 — Validation Strategy

> Pure Go native server + TypeScript adapter. Mixed-language Wave 0 substrate required.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Frameworks** | `go test` (native daemon) · Vitest (TypeScript adapter) · `protoc` codegen smoke · matrix CI on macos-14 |
| **Config files** | `device-stream/native-servers/android-grpc/go.mod` (Wave 0 installs) · `device-stream/packages/android/vitest.config.ts` (exists) · `.github/workflows/android-grpc-matrix.yml` (Wave 0 installs) |
| **Quick run** | `cd device-stream/native-servers/android-grpc && go test ./...` |
| **TS quick** | `cd device-stream/packages/android && npx vitest run` |
| **Full suite** | `npm test && (cd device-stream/native-servers/android-grpc && go test -race ./...)` |
| **Estimated runtime** | ~30s Go · ~45s TS · ~5min matrix CI |

---

## Sampling Rate

- **After every task commit:** Quick run of touched surface (Go or TS)
- **After every wave:** Both quick runs
- **Before phase verify:** Full suite + soak smoke on real emulator (manual or scripted)
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 33-T1 | 01 | 1 | AND-GRPC-PROTO | unit | `cd device-stream/native-servers/android-grpc && go test ./proto/...` | ✅ | ✅ green |
| 33-T2 | 01 | 1 | AND-GRPC-AUTH | unit | `go test ./auth/...` | ✅ | ✅ green |
| 33-T3 | 02 | 2 | AND-GRPC-CLIENT | unit + mock | `go test ./client/... -run TestFrameReader` | ✅ | ✅ green |
| 33-T4 | 02 | 2 | AND-GRPC-IPC | unit | `go test ./ipc/... -run TestFramer` | ✅ | ✅ green |
| 33-T5 | 03 | 3 | AND-GRPC-SPAWN | unit | `vitest run server/pool/__tests__/emulator-grpc.spec` | ✅ | ✅ green |
| 33-T6 | 04 | 4 | AND-GRPC-TS | unit | `cd device-stream/packages/android && npx vitest run tests/grpc-emu-client.spec.ts` | ✅ | ✅ green |
| 33-T7 | 04 | 4 | AND-GRPC-TOUCH | unit | `vitest run grpc-touch-fallback.spec` | ✅ | ✅ green |
| 33-T8 | 05 | 5 | AND-GRPC-INSTALL | integration | `bash device-stream/scripts/build-android-grpc.sh && test -x device-stream/bin/android-grpc-stream` | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `device-stream/native-servers/android-grpc/go.mod` — Go module init
- [ ] `device-stream/native-servers/android-grpc/proto/` — proto files copied from kittyfarm Protos/ + Go gRPC stubs
- [ ] `device-stream/native-servers/android-grpc/Makefile` — protoc + build + test targets
- [ ] `device-stream/packages/android/tests/grpc-emu-client.spec.ts` — TS stub
- [ ] `device-stream/scripts/build-android-grpc.sh` — build wrapper
- [ ] `device-stream/scripts/postinstall.js` — extend to also build android-grpc daemon
- [ ] `.github/workflows/android-grpc-matrix.yml` — daily Android emulator smoke matrix

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `device-farm run` on emulator uses gRPC, scrcpy.jar untouched | SC1 | Requires live emulator + adb + boot | Boot emulator, run job, inspect process tree + scrcpy.jar mtime |
| Touch latency < 80ms median | SC3 | Live timing required | `sim-touch-latency.sh` equivalent for android |
| 30-min soak with stable RSS | SC4 | Long-running | `android-grpc-soak.sh` for 30min, ps -o rss |
| Frame latency ≥30% better than scrcpy | SC3 | Live comparison | Side-by-side capture, frame-time analysis |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (Go module, proto codegen, build script, postinstall, CI workflow)
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s for unit; manual/CI for integration
- [ ] `nyquist_compliant: true` once Wave 0 lands

**Approval:** complete — all 8 AND-GRPC-* pseudo-IDs verified green via Plans 33-01..33-05 (see SUMMARYs and the requirements-completed frontmatter of each).
