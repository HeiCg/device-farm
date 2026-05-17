---
phase: 6
slug: authentication-and-reporting
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-10
---

# Phase 6 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.x |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run server/auth/__tests__/ server/reporting/__tests__/ --reporter=verbose` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run server/auth/__tests__/ server/reporting/__tests__/ --reporter=verbose`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 06-01-01 | 01 | 1 | AUTH-01 | unit | `npx vitest run server/auth/__tests__/auth-service.test.ts -x` | ❌ W0 | ⬜ pending |
| 06-01-02 | 01 | 1 | AUTH-02 | unit | `npx vitest run server/auth/__tests__/auth-plugin.test.ts -x` | ❌ W0 | ⬜ pending |
| 06-01-03 | 01 | 1 | AUTH-03 | manual | Manual: open UI without key, verify redirect | N/A | ⬜ pending |
| 06-02-01 | 02 | 1 | REPT-01 | unit | `npx vitest run server/reporting/__tests__/webhook-service.test.ts -x` | ❌ W0 | ⬜ pending |
| 06-02-02 | 02 | 1 | REPT-02 | unit | `npx vitest run server/reporting/__tests__/junit-generator.test.ts -x` | ❌ W0 | ⬜ pending |
| 06-02-03 | 02 | 1 | REPT-03 | unit | `npx vitest run server/reporting/__tests__/flaky-detector.test.ts -x` | ❌ W0 | ⬜ pending |
| 06-02-04 | 02 | 1 | REPT-04 | unit | `npx vitest run server/reporting/__tests__/flaky-detector.test.ts -x` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `server/auth/__tests__/auth-service.test.ts` — stubs for AUTH-01
- [ ] `server/auth/__tests__/auth-plugin.test.ts` — stubs for AUTH-02
- [ ] `server/reporting/__tests__/webhook-service.test.ts` — stubs for REPT-01
- [ ] `server/reporting/__tests__/junit-generator.test.ts` — stubs for REPT-02
- [ ] `server/reporting/__tests__/flaky-detector.test.ts` — stubs for REPT-03, REPT-04

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Web UI redirects to login without API key | AUTH-03 | Browser-only SPA behavior with localStorage | 1. Clear localStorage 2. Navigate to dashboard 3. Verify redirect to /login 4. Enter key 5. Verify access granted |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
