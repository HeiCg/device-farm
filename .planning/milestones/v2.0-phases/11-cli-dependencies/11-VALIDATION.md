---
phase: 11
slug: cli-dependencies
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-15
---

# Phase 11 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | go test |
| **Config file** | cli/cmd/ (test files colocated) |
| **Quick run command** | `cd cli && go test -run TestDep ./cmd/` |
| **Full suite command** | `cd cli && go test ./...` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `cd cli && go test -run TestDep ./cmd/`
- **After every plan wave:** Run `cd cli && go test ./...`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 11-01-01 | 01 | 1 | DEP-01..DEP-09 | unit | `cd cli && go test -run TestInstall ./cmd/` | W0 | pending |
| 11-01-02 | 01 | 1 | DEP-10 | unit | `cd cli && go test -run TestDepProgress ./cmd/` | W0 | pending |

*Status: pending / green / red / flaky*

---

## Wave 0 Requirements

- [ ] `cli/cmd/dependencies_test.go` — tests for installer functions and progress output
- [ ] Mock helpers for exec.Command subprocess calls

*Existing infrastructure covers Go test framework.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Actual brew install | DEP-01,05,06,07,08 | Requires network + brew | Run `device_farm dependencies` on clean machine |
| sdkmanager install | DEP-02 | Requires Android SDK | Run on machine without SDK components |
| Xcode CLT install | DEP-03 | Requires softwareupdate | Run on machine without CLT |
| sim-capture build | DEP-09 | Requires device-stream sibling dir | Verify `../device-stream` build works |

---

## Validation Sign-Off

- [ ] All tasks have automated verify or Wave 0 dependencies
- [ ] Sampling continuity
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
