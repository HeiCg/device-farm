---
phase: 19
slug: reporting-migration-webhooks-dlq
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-04-21
---

<!--
  HEADER NOTE (checker revision 2026-04-21):
  Both flags flipped to `true` because every per-task `<automated>` field is
  present across the 7 plans in this phase and every Wave-0 requirement below
  has a concrete task reference. The Wave-0 completion gate is enforced by
  plan 19-00 (all 6 tasks) plus the shared fixture added in plan 19-00 Task 0.6
  (addressed in the revision pass). The final Nyquist delta gate still runs at
  phase-close in plan 19-06 Task 6.4 — if that gate fails, the PHASE fails
  regardless of this frontmatter.
-->

# Phase 19 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 3.x (server), go test (CLI — not touched this phase) |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run server/reporting/__tests__/` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~8s quick / ~90s full |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run server/reporting/__tests__/` and the module under touch
- **After every plan wave:** Run `npm test` (full)
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 10s quick / 120s full

---

## Per-Task Verification Map

Populated by the planner in each PLAN.md via `<automated>` blocks. Required dimensions:

| Dim | Requirement | Test Type | Minimum | Plan |
|-----|-------------|-----------|---------|------|
| Unit | Factory shape + shutdown idempotency | `module.spec.ts` (no DB) | 1 spec | 19-03 Task 3.4 |
| Unit | Events registry + emitter | `events.spec.ts` (no DB) | 1 spec | 19-01 Task 1.2 |
| Unit | Webhook deliverOnce contract (SC1 unit layer) | `webhook-service.spec.ts` (no DB) | 12+ tests | 19-02 Task 2.1/2.2 |
| Integration | pg-boss retry to DLQ (SC1) | `queue.spec.ts` (DB-gated) | 1 spec proving 5× 500 → DLQ row | 19-04 Task 4.1 |
| Integration | Correlation trace (SC4) | `correlation.spec.ts` (DB-gated) | 1 spec asserting single correlationId across 5 retries + DLQ + events row | 19-04 Task 4.2 |
| Integration | Terminal event persistence (SC2) | `terminal-event.spec.ts` (DB-gated) | 1 spec — `webhook.failed.retryExhausted` row in events table | 19-04 Task 4.3 |
| Route | DLQ endpoint shape (SC2) | `dlq-route.spec.ts` (DB-gated) | 1 spec — Zod parse of response | 19-05 Task 5.3 (post-renumber) |
| Structural | Barrel + dep-cruiser rule (MOD-02) | `dep-cruiser.spec.ts` extension | 1 fixture | 19-00 Task 0.4 |
| Structural | Plugin dep-order regression guard | `plugin-order.spec.ts` extension | 3 additive assertions | 19-04 Task 4.4 |
| Shared | Failing-HTTP-server fixture (checker revision) | `__tests__/fixtures/failing-server.ts` | 1 module | 19-00 Task 0.6 |
| Delta | Nyquist coverage delta (SC3) | `scripts/capture-nyquist.mjs` | delta ≥ −2pp | 19-06 Task 6.4 |

---

## Wave 0 Requirements

- [x] `server/queue/names.ts` extended with `WEBHOOK_DELIVER` + `WEBHOOK_DELIVER_DLQ` constants (19-00 Task 0.1)
- [x] `server/reporting/schemas.ts` created with Zod webhook payload + DLQ response schema (19-00 Task 0.3)
- [x] `.dependency-cruiser.cjs` extended with `no-deep-imports-into-reporting-internal` forbidden rule (19-00 Task 0.4)
- [x] `__fixtures__/dep-cruiser/bad-reporting-deep-import.ts` fixture + extension of `dep-cruiser.spec.ts` (19-00 Task 0.4)
- [x] (Optional, test-only) `server/queue/plugin.ts` `maintenanceIntervalSeconds` passthrough option for DLQ tests (19-00 Task 0.2)
- [x] Shared failing-HTTP-server test fixture `server/reporting/__tests__/fixtures/failing-server.ts` — consumed by queue.spec, correlation.spec, terminal-event.spec, dlq-route.spec, webhook-service.spec (19-00 Task 0.6 — checker revision)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| None | — | Phase is pure infra; all success criteria are automatable | — |

*All phase behaviors have automated verification.*

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 120s full suite
- [x] `nyquist_compliant: true` set in frontmatter (captured at phase-close via plan 19-06 Task 6.4)

**Approval:** accepted (revision pass 2026-04-21 — blockers + warnings 1/2/5 addressed)
