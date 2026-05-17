---
phase: 7
slug: cli-websocket-auth-token
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-11
---

# Phase 7 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Go testing (stdlib) |
| **Config file** | None needed (Go convention) |
| **Quick run command** | `cd cli && go test ./cmd/ -run TestBuildWSURL -count=1` |
| **Full suite command** | `cd cli && go test ./... -count=1` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `cd cli && go test ./cmd/ -run TestBuildWSURL -count=1`
- **After every plan wave:** Run `cd cli && go test ./... -count=1`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 07-01-01 | 01 | 0 | CLI-01, CLI-03 | unit | `cd cli && go test ./cmd/ -run TestBuildWSURL -count=1` | ❌ W0 | ⬜ pending |
| 07-01-02 | 01 | 1 | CLI-01, CLI-03 | unit | `cd cli && go test ./cmd/ -run TestBuildWSURL -count=1` | ❌ W0 | ⬜ pending |
| 07-01-03 | 01 | 1 | CLI-01 | manual | N/A — requires running server | N/A | ⬜ pending |
| 07-01-04 | 01 | 1 | CLI-03 | manual | N/A — requires running server | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `cli/cmd/run_test.go` — TestBuildWSURL covering all 4 combinations (http/https × with/without key)

*Existing Go test infrastructure covers framework needs.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `device-farm run` streams logs with auth.enabled=true | CLI-01 | Requires running server with auth enabled | 1. Start server with AUTH_ENABLED=true 2. Run `device-farm run test.yaml` 3. Verify WS connection stays open and logs stream |
| `device-farm logs --follow` streams with auth.enabled=true | CLI-03 | Requires running server with auth enabled | 1. Start server with AUTH_ENABLED=true 2. Create a job 3. Run `device-farm logs <job-id> --follow` 4. Verify WS connection stays open |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
