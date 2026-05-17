---
phase: 14
slug: fix-device-preview-pipeline
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-04-15
---

# Phase 14 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run server/streaming/__tests__/ -x` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run server/streaming/__tests__/ -x`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 14-01-01 | 01 | 1 | INTG-01 | unit (TDD) | `npx vitest run server/streaming/__tests__/android-preview-adapter.test.ts server/streaming/__tests__/ios-preview-adapter.test.ts server/streaming/__tests__/adapter-factory.test.ts -x` | No (created by TDD task) | ⬜ pending |
| 14-01-02 | 01 | 1 | FLOW-01 | unit + full | `npx vitest run server/streaming/__tests__/ -x && npm test` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Task 1 in plan 14-01 has `tdd="true"` — test files are written first as part of the TDD red-green cycle within the task. This satisfies Wave 0 intent: tests exist before implementation, and the `<verify>` command runs them. No separate Wave 0 task is needed.

Test files created by Task 1's TDD cycle:
- `server/streaming/__tests__/android-preview-adapter.test.ts`
- `server/streaming/__tests__/ios-preview-adapter.test.ts`
- `server/streaming/__tests__/adapter-factory.test.ts`

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live frame delivery via WebSocket | FLOW-01 | Requires running emulator producing frames | Start emulator, connect WS client to /ws/devices/:id/preview, verify binary frame data arrives |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (TDD task creates test files first)
- [x] No watch-mode flags
- [x] Feedback latency < 15s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
