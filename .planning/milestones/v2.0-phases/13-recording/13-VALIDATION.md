---
phase: 13
slug: recording
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-16
---

# Phase 13 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run server/artifacts/__tests__/recording-service.test.ts` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run server/artifacts/__tests__/recording-service.test.ts`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 13-01-01 | 01 | 1 | REC-01 | unit | `npx vitest run server/artifacts/__tests__/recording-service.test.ts` | ✅ | ⬜ pending |
| 13-01-02 | 01 | 1 | REC-02 | unit | `npx vitest run server/artifacts/__tests__/recording-service.test.ts` | ✅ | ⬜ pending |
| 13-01-03 | 01 | 1 | REC-03 | integration | `npx vitest run server/jobs/__tests__/` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

*Existing test infrastructure covers all phase requirements — recording-service.test.ts and job-service.test.ts already exist.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Android recording produces playable MP4 | REC-01 | Requires running emulator + scrcpy stream | Submit a test job with android platform, verify MP4 in artifacts dir is playable |
| iOS recording produces playable MP4 | REC-02 | Requires running simulator + sim-capture binary | Submit a test job with ios platform, verify MP4 in artifacts dir is playable |
| MP4 downloadable via artifacts API | REC-03 | Requires server + artifact association | GET /api/jobs/{id}/artifacts, verify MP4 file downloads correctly |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
