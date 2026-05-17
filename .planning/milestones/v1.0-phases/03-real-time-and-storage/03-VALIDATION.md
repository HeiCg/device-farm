---
phase: 3
slug: real-time-and-storage
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-10
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.0.18 |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run --reporter=verbose` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=verbose`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 03-01-01 | 01 | 0 | REAL-01 | unit | `npx vitest run server/streaming/__tests__/job-broadcaster.test.ts` | ❌ W0 | ⬜ pending |
| 03-01-02 | 01 | 0 | REAL-02, REAL-03 | unit | `npx vitest run server/streaming/__tests__/device-preview.test.ts` | ❌ W0 | ⬜ pending |
| 03-01-03 | 01 | 0 | REAL-04 | unit | `npx vitest run server/artifacts/__tests__/recording-service.test.ts` | ❌ W0 | ⬜ pending |
| 03-01-04 | 01 | 0 | REAL-05 | unit | `npx vitest run server/artifacts/__tests__/screenshot-service.test.ts` | ❌ W0 | ⬜ pending |
| 03-01-05 | 01 | 0 | REAL-06 | unit | `npx vitest run server/artifacts/__tests__/logcat-service.test.ts` | ❌ W0 | ⬜ pending |
| 03-01-06 | 01 | 0 | REAL-07 | unit | `npx vitest run server/artifacts/__tests__/memory-service.test.ts` | ❌ W0 | ⬜ pending |
| 03-01-07 | 01 | 0 | STOR-01 | unit | `npx vitest run server/artifacts/__tests__/artifact-service.test.ts` | ❌ W0 | ⬜ pending |
| 03-01-08 | 01 | 0 | STOR-02 | unit | `npx vitest run server/lifecycle/__tests__/compression-task.test.ts` | ❌ W0 | ⬜ pending |
| 03-01-09 | 01 | 0 | STOR-03 | unit | `npx vitest run server/lifecycle/__tests__/retention-task.test.ts` | ❌ W0 | ⬜ pending |
| 03-01-10 | 01 | 0 | STOR-04 | unit | `npx vitest run server/lifecycle/__tests__/disk-pressure-task.test.ts` | ❌ W0 | ⬜ pending |
| 03-01-11 | 01 | 0 | STOR-05 | unit | `npx vitest run server/api/__tests__/artifact-routes.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `server/streaming/__tests__/job-broadcaster.test.ts` — stubs for REAL-01 (event broadcasting + replay buffer)
- [ ] `server/streaming/__tests__/device-preview.test.ts` — stubs for REAL-02, REAL-03 (mock device-stream)
- [ ] `server/artifacts/__tests__/recording-service.test.ts` — stubs for REAL-04 (mock ffmpeg spawn)
- [ ] `server/artifacts/__tests__/screenshot-service.test.ts` — stubs for REAL-05 (mock adb/simctl)
- [ ] `server/artifacts/__tests__/logcat-service.test.ts` — stubs for REAL-06 (mock adb logcat)
- [ ] `server/artifacts/__tests__/memory-service.test.ts` — stubs for REAL-07 (mock dumpsys)
- [ ] `server/artifacts/__tests__/artifact-service.test.ts` — stubs for STOR-01 (DB + filesystem ops)
- [ ] `server/lifecycle/__tests__/compression-task.test.ts` — stubs for STOR-02
- [ ] `server/lifecycle/__tests__/retention-task.test.ts` — stubs for STOR-03
- [ ] `server/lifecycle/__tests__/disk-pressure-task.test.ts` — stubs for STOR-04
- [ ] `server/api/__tests__/artifact-routes.test.ts` — stubs for STOR-05

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live video preview renders in browser | REAL-02, REAL-03 | Requires visual browser rendering | Connect to WS endpoint, verify video frames display in test HTML page |
| Device screen mirroring latency | REAL-02 | Requires real device hardware | Measure time from device action to preview update (<500ms target) |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
