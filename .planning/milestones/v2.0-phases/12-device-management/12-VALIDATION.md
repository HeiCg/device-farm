---
phase: 12
slug: device-management
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-15
---

# Phase 12 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run server/pool/__tests__/` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run server/pool/__tests__/`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 12-01-01 | 01 | 1 | DEV-01 | unit | `npx vitest run server/pool/android/__tests__/` | ❌ W0 | ⬜ pending |
| 12-01-02 | 01 | 1 | DEV-02 | unit | `npx vitest run server/pool/ios/__tests__/` | ❌ W0 | ⬜ pending |
| 12-02-01 | 02 | 2 | DEV-03 | unit | `npx vitest run server/pool/__tests__/allocation.test.ts` | ✅ | ⬜ pending |
| 12-02-02 | 02 | 2 | DEV-04 | unit | `npx vitest run server/pool/__tests__/health-checker.test.ts` | ✅ | ⬜ pending |
| 12-02-03 | 02 | 2 | DEV-05 | integration | `npx vitest run server/pool/__tests__/` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `server/pool/android/__tests__/device-stream-driver.test.ts` — stubs for DEV-01 (Android driver via device-stream)
- [ ] `server/pool/ios/__tests__/device-stream-driver.test.ts` — stubs for DEV-02 (iOS driver via device-stream)
- [ ] `server/pool/__tests__/integration.test.ts` — stubs for DEV-05 (full lifecycle integration)

*Existing allocation and health-checker tests cover DEV-03 and DEV-04.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Emulator actually boots | DEV-01 | Requires Android SDK + emulator binary | Run `npm run dev` with `config.yaml` android enabled, verify emulator-5554 appears in `adb devices` |
| Simulator actually boots | DEV-02 | Requires Xcode + simctl | Run `npm run dev` with `config.yaml` ios enabled, verify simulator in `xcrun simctl list devices` |
| Health check restarts failed device | DEV-04 | Requires killing a real device process | Kill emulator PID during health interval, verify replacement boots |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
