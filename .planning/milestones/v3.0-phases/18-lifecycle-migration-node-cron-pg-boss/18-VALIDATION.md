---
phase: 18
slug: lifecycle-migration-node-cron-pg-boss
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-20
---

# Phase 18 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 3.x |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `DATABASE_URL=postgres://localhost/device_farm_test npx vitest run server/lifecycle/__tests__/` |
| **Full suite command** | `DATABASE_URL=postgres://localhost/device_farm_test npm test` |
| **Estimated runtime** | ~30s for module scope, ~3 min full suite |

---

## Sampling Rate

- **After every task commit:** Run module-scoped vitest
- **After every plan wave:** Run full server test suite
- **Before verification:** Full suite green + lifecycle integration specs green
- **Max feedback latency:** 30s

---

## Per-Task Verification Map

Filled by planner — mirror 18-01-PLAN.md, 18-02-PLAN.md, etc.

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `server/lifecycle/__tests__/module.spec.ts` — factory-shape parity with hooks
- [ ] `server/lifecycle/__tests__/schedules.spec.ts` — pg-boss schedule registration assertions
- [ ] `server/lifecycle/__tests__/correlation.spec.ts` — per-fire correlationId injection (integration test)
- [ ] `server/lifecycle/__tests__/graceful-shutdown.spec.ts` — in-flight drain within configured timeout

*All Vitest; real Postgres via DATABASE_URL.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Cron-like timing correctness across DST/clock skew | QUEUE-08 | Requires multi-day wall-clock observation; pg-boss owns this | Deploy, let run 2 weeks, confirm schedules fire at expected wall-clock times |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
