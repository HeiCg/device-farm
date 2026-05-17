---
phase: 1
slug: device-infrastructure
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-09
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (latest) |
| **Config file** | vitest.config.ts — Wave 0 installs |
| **Quick run command** | `npx vitest run --reporter=verbose` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=verbose`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 01-01-01 | 01 | 0 | INFRA-01 | unit | `npx vitest run server/config/__tests__/loader.test.ts -x` | ❌ W0 | ⬜ pending |
| 01-01-02 | 01 | 0 | INFRA-05 | unit | `npx vitest run server/pool/__tests__/device-state.test.ts -x` | ❌ W0 | ⬜ pending |
| 01-01-03 | 01 | 0 | INFRA-06 | unit | `npx vitest run server/pool/__tests__/allocation.test.ts -x` | ❌ W0 | ⬜ pending |
| 01-01-04 | 01 | 0 | INFRA-04 | unit | `npx vitest run server/pool/__tests__/health-checker.test.ts -x` | ❌ W0 | ⬜ pending |
| 01-01-05 | 01 | 0 | INFRA-08 | unit | `npx vitest run server/pool/__tests__/process-tracker.test.ts -x` | ❌ W0 | ⬜ pending |
| 01-02-01 | 02 | 1 | INFRA-02 | integration | `npx vitest run server/pool/android/__tests__/emulator.test.ts -x` | ❌ W0 | ⬜ pending |
| 01-02-02 | 02 | 1 | INFRA-03 | integration | `npx vitest run server/pool/ios/__tests__/simulator.test.ts -x` | ❌ W0 | ⬜ pending |
| 01-02-03 | 02 | 1 | INFRA-07 | integration | `npx vitest run server/pool/__tests__/cleanup.test.ts -x` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `vitest.config.ts` — Vitest configuration (TypeScript, path aliases)
- [ ] `tsconfig.json` — TypeScript configuration (ESM, strict, paths)
- [ ] `package.json` — Project manifest with dependencies
- [ ] `server/config/__tests__/loader.test.ts` — Config loading + validation tests
- [ ] `server/pool/__tests__/device-state.test.ts` — State machine unit tests
- [ ] `server/pool/__tests__/allocation.test.ts` — Allocation mutex + FIFO tests
- [ ] `server/pool/__tests__/health-checker.test.ts` — Health check logic tests
- [ ] `server/pool/__tests__/process-tracker.test.ts` — Process tracking tests
- [ ] `server/pool/android/__tests__/emulator.test.ts` — Android emulator integration tests (mock execFile)
- [ ] `server/pool/ios/__tests__/simulator.test.ts` — iOS simulator integration tests (mock execFile)
- [ ] `server/pool/__tests__/cleanup.test.ts` — Cleanup logic tests (mock execFile)
- [ ] Framework install: `npm install -D vitest` — if none detected

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Emulator actually boots headless on Mac Mini | INFRA-02 | Requires real hardware + Android SDK | Run `emulator @test -no-window -no-audio` on target machine |
| iOS simulator boots via simctl | INFRA-03 | Requires real macOS + Xcode | Run `xcrun simctl boot <UDID>` on target machine |
| Snapshot restore timing | INFRA-07 | Timing depends on host hardware | Measure `avd snapshot load` on target machine |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
