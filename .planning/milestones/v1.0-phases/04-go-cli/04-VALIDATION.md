---
phase: 4
slug: go-cli
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-10
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Go testing (stdlib) + go test |
| **Config file** | None — Go test is zero-config |
| **Quick run command** | `cd cli && go test ./... -short -count=1` |
| **Full suite command** | `cd cli && go test ./... -v -count=1 -race` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `cd cli && go test ./... -short -count=1`
- **After every plan wave:** Run `cd cli && go test ./... -v -count=1 -race`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 04-01-01 | 01 | 0 | CLI-01..07 | unit | `cd cli && go test ./... -short -count=1` | ❌ W0 | ⬜ pending |
| 04-01-02 | 01 | 1 | CLI-06 | unit | `cd cli && go test ./internal/config/ -run Test -v` | ❌ W0 | ⬜ pending |
| 04-01-03 | 01 | 1 | CLI-07 | unit | `cd cli && go test ./internal/client/ -run TestAuth -v` | ❌ W0 | ⬜ pending |
| 04-02-01 | 02 | 1 | CLI-01 | unit | `cd cli && go test ./cmd/ -run TestRun -v` | ❌ W0 | ⬜ pending |
| 04-02-02 | 02 | 1 | CLI-02 | unit | `cd cli && go test ./cmd/ -run TestStatus -v` | ❌ W0 | ⬜ pending |
| 04-02-03 | 02 | 1 | CLI-03 | unit | `cd cli && go test ./cmd/ -run TestLogs -v` | ❌ W0 | ⬜ pending |
| 04-02-04 | 02 | 1 | CLI-04 | unit | `cd cli && go test ./cmd/ -run TestDevices -v` | ❌ W0 | ⬜ pending |
| 04-02-05 | 02 | 1 | CLI-05 | unit | `cd cli && go test ./cmd/ -run TestCancel -v` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `cli/go.mod` — Go module initialization
- [ ] `cli/internal/client/client_test.go` — HTTP client with mock server (httptest)
- [ ] `cli/internal/config/config_test.go` — Config load/save/set/get
- [ ] `cli/internal/output/table_test.go` — Table formatting
- [ ] `cli/internal/streaming/ws_test.go` — WebSocket message parsing
- [ ] `cli/cmd/root_test.go` — Root command and global flag parsing

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| TTY inline step rendering | CLI-01 | Requires real terminal for ANSI escape sequences | Run `device-farm run test.yaml` in a real terminal, verify in-place step updates |
| Color output in terminal | CLI-01..05 | fatih/color auto-detection needs real TTY | Run commands in terminal, verify colored output; pipe to file, verify no ANSI codes |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
