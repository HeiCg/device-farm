---
phase: 9
slug: fix-cli-data-contracts
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-11
---

# Phase 9 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Go testing (stdlib) + httptest |
| **Config file** | None (Go convention) |
| **Quick run command** | `cd cli && go test ./cmd/ -run TestStatus -v -count=1` |
| **Full suite command** | `cd cli && go test ./... -count=1` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `cd cli && go test ./cmd/ -v -count=1`
- **After every plan wave:** Run `cd cli && go test ./... -count=1`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 09-01-01 | 01 | 1 | CLI-02 | unit | `cd cli && go test ./cmd/ -run TestStatus -v -count=1` | Yes (needs update) | ⬜ pending |
| 09-01-02 | 01 | 1 | CLI-03 | unit | `cd cli && go test ./cmd/ -run TestLogs -v -count=1` | No (W0) | ⬜ pending |
| 09-01-03 | 01 | 1 | CLI-04 | unit | `cd cli && go test ./cmd/ -run TestDevices -v -count=1` | Yes (needs update) | ⬜ pending |
| 09-01-04 | 01 | 1 | API-05 | unit | `cd cli && go test ./cmd/ -run TestCancel -v -count=1` | Yes | ⬜ pending |
| 09-01-05 | 01 | 1 | API-07 | unit | `cd cli && go test ./cmd/ -run TestDevices -v -count=1` | Yes (needs update) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `cli/cmd/logs_test.go` — add fetchLogs test for non-follow mode (CLI-03)
- [ ] Update `cli/cmd/status_test.go` mock responses to use `finishedAt`, `resultSummary`
- [ ] Update `cli/cmd/devices_test.go` mock responses to use `state` instead of `status`

---

## Manual-Only Verifications

*All phase behaviors have automated verification.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
