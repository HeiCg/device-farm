---
phase: 2
slug: job-execution-and-api
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-10
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.x |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run --reporter=verbose` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=verbose`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 2-01-01 | 01 | 1 | JOBS-01 | unit + integration | `npx vitest run server/jobs/__tests__/job-service.test.ts -t "create"` | ❌ W0 | ⬜ pending |
| 2-01-02 | 01 | 1 | JOBS-02 | unit | `npx vitest run server/jobs/__tests__/job-queue.test.ts` | ❌ W0 | ⬜ pending |
| 2-01-03 | 01 | 1 | JOBS-08 | unit | `npx vitest run server/jobs/__tests__/job-service.test.ts -t "metadata"` | ❌ W0 | ⬜ pending |
| 2-02-01 | 02 | 1 | JOBS-03 | unit | `npx vitest run server/jobs/__tests__/job-executor.test.ts -t "spawn"` | ❌ W0 | ⬜ pending |
| 2-02-02 | 02 | 1 | JOBS-04 | unit | `npx vitest run server/jobs/__tests__/maestro-parser.test.ts` | ❌ W0 | ⬜ pending |
| 2-02-03 | 02 | 1 | JOBS-05 | unit | `npx vitest run server/jobs/__tests__/job-executor.test.ts -t "timeout"` | ❌ W0 | ⬜ pending |
| 2-02-04 | 02 | 1 | JOBS-06 | unit | `npx vitest run server/jobs/__tests__/job-service.test.ts -t "cancel"` | ❌ W0 | ⬜ pending |
| 2-02-05 | 02 | 1 | JOBS-07 | unit | `npx vitest run server/jobs/__tests__/maestro-parser.test.ts -t "summary"` | ❌ W0 | ⬜ pending |
| 2-03-01 | 03 | 2 | API-01 | unit | `npx vitest run server/api/__tests__/routes.test.ts -t "list"` | ❌ W0 | ⬜ pending |
| 2-03-02 | 03 | 2 | API-02 | unit | `npx vitest run server/api/__tests__/routes.test.ts -t "detail"` | ❌ W0 | ⬜ pending |
| 2-03-03 | 03 | 2 | API-03 | unit | `npx vitest run server/api/__tests__/routes.test.ts -t "logs"` | ❌ W0 | ⬜ pending |
| 2-03-04 | 03 | 2 | API-04 | manual-only | N/A -- deferred to Phase 3 | N/A | ⬜ pending |
| 2-03-05 | 03 | 2 | API-05 | unit | `npx vitest run server/api/__tests__/routes.test.ts -t "cancel"` | ❌ W0 | ⬜ pending |
| 2-03-06 | 03 | 2 | API-06 | unit | `npx vitest run server/api/__tests__/routes.test.ts -t "devices"` | ❌ W0 | ⬜ pending |
| 2-03-07 | 03 | 2 | API-07 | unit | `npx vitest run server/api/__tests__/routes.test.ts -t "restart"` | ❌ W0 | ⬜ pending |
| 2-03-08 | 03 | 2 | API-08 | unit | `npx vitest run server/api/__tests__/routes.test.ts -t "health"` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `server/jobs/__tests__/job-service.test.ts` — stubs for JOBS-01, JOBS-02, JOBS-06, JOBS-08
- [ ] `server/jobs/__tests__/job-queue.test.ts` — stubs for JOBS-02
- [ ] `server/jobs/__tests__/job-executor.test.ts` — stubs for JOBS-03, JOBS-05
- [ ] `server/jobs/__tests__/maestro-parser.test.ts` — stubs for JOBS-04, JOBS-07
- [ ] `server/api/__tests__/routes.test.ts` — stubs for API-01 through API-08
- [ ] `server/api/__tests__/pagination.test.ts` — stubs for cursor encode/decode
- [ ] `server/api/__tests__/error-handler.test.ts` — stubs for RFC 7807 formatting

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Recording download | API-04 | Deferred to Phase 3 | N/A — stub endpoint returns 501 |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
