---
phase: 8
slug: fix-web-dashboard-data-contracts
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-11
---

# Phase 8 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | svelte-check (TypeScript validation) |
| **Config file** | `web/tsconfig.json` |
| **Quick run command** | `cd web && npx svelte-check --tsconfig ./tsconfig.json` |
| **Full suite command** | `cd web && npx svelte-check --tsconfig ./tsconfig.json` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `cd web && npx svelte-check --tsconfig ./tsconfig.json`
- **After every plan wave:** Run `cd web && npx svelte-check --tsconfig ./tsconfig.json`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 08-01-01 | 01 | 1 | UI-01 | type check | `cd web && npx svelte-check --tsconfig ./tsconfig.json` | N/A (type-level) | ⬜ pending |
| 08-01-02 | 01 | 1 | UI-02, API-01 | type check | `cd web && npx svelte-check --tsconfig ./tsconfig.json` | N/A (type-level) | ⬜ pending |
| 08-01-03 | 01 | 1 | UI-01 | type check | `cd web && npx svelte-check --tsconfig ./tsconfig.json` | N/A (type-level) | ⬜ pending |
| 08-01-04 | 01 | 1 | UI-02 | type check | `cd web && npx svelte-check --tsconfig ./tsconfig.json` | N/A (type-level) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements. No new test files or frameworks needed. `svelte-check` is already installed and configured.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Pool cards display correct values | UI-01 | Runtime visual check | Start server + web dev, open dashboard, verify Total/Idle/Running/Queue cards show real data |
| Load More pagination works | UI-02 | Runtime interaction | Open jobs page, click Load More, verify next page loads |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
