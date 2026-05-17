---
phase: 10
slug: cli-doctor
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-15
---

# Phase 10 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | go test |
| **Config file** | cli/cmd/ (test files colocated) |
| **Quick run command** | `cd cli && go test -run TestDoctor ./cmd/` |
| **Full suite command** | `cd cli && go test ./...` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `cd cli && go test -run TestDoctor ./cmd/`
- **After every plan wave:** Run `cd cli && go test ./...`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 10-01-01 | 01 | 1 | DOC-01..DOC-11 | unit | `cd cli && go test -run TestDoctor ./cmd/` | ❌ W0 | ⬜ pending |
| 10-01-02 | 01 | 1 | DOC-12 | unit | `cd cli && go test -run TestDoctorSummary ./cmd/` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `cli/cmd/doctor_test.go` — tests for all 11 dependency checks + summary output
- [ ] Mock helpers for exec.LookPath and exec.Command output

*Existing infrastructure covers Go test framework.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Visual output formatting | DOC-12 | Color output requires terminal | Run `device_farm doctor` in terminal, verify colors and alignment |
| PostgreSQL running detection | DOC-07 | Requires actual pg_isready | Start/stop PostgreSQL, verify warn vs fail |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
