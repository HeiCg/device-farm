---
phase: 25
slug: pipelines-module
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-08
---

# Phase 25 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.x |
| **Config file** | `vitest.config.ts` (root) |
| **Quick run command** | `npx vitest run server/pipelines/` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~30s quick (DB-gated skip if no DATABASE_URL); ~3-4min full |

---

## Sampling Rate

- **Per task commit:** `npx vitest run server/pipelines/__tests__/<file>.spec.ts` (~200ms-15s).
- **Per wave:** `npx vitest run server/pipelines/ server/__tests__/plugin-order.spec.ts server/hooks/__tests__/dep-cruiser.spec.ts`.
- **Phase gate (Plan 25-05 close):** `npm test` excluding inherited DEFERRED-17-A; `npm run dep-check` ≤ 3 (artifacts→streaming pre-existing); `npx tsc --noEmit` 0 NEW errors; `npm run nyquist:check` exit 0; `npm run lint` clean; `! grep -rE "from 'node-cron'" server/`.
- **Max feedback latency:** 60s.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | SC / Convention | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-----------------|-----------|-------------------|-------------|--------|
| 25-00-01 | 00 | 0 | EVENTS-03 | unit | `npx vitest run server/pipelines/__tests__/events.spec.ts` (placeholder) | ❌ W0 | ⬜ pending |
| 25-00-02 | 00 | 0 | MOD-02 | unit | `find server/pipelines -name 'index.ts' -name 'MODULE.md' -name 'events.ts' -name 'queue.ts'` | ❌ W0 | ⬜ pending |
| 25-00-03 | 00 | 0 | MOD-02 | unit | `npx vitest run server/hooks/__tests__/dep-cruiser.spec.ts` (extend with 9th rule) | ✅ extend | ⬜ pending |
| 25-00-04 | 00 | 0 | (queue-names) | unit | `npx vitest run server/queue/__tests__/names.spec.ts` (PIPELINE_SCHEDULED_EXECUTE) | ✅ extend | ⬜ pending |
| 25-01-01 | 01 | 1 | EVENTS-03/TRACE-08 | unit | `npx vitest run server/pipelines/__tests__/events.spec.ts` (full body, registry shape, persistence flags) | ❌ W0 from 00 | ⬜ pending |
| 25-01-02 | 01 | 1 | (queue-body) | unit | `npx vitest run server/pipelines/__tests__/queue.spec.ts` (PIPELINE_SCHEDULED_EXECUTE retryLimit + helper) | ❌ Plan 25-01 | ⬜ pending |
| 25-02-01 | 02 | 2 | SC1 | DB-gated | `npx vitest run server/pipelines/__tests__/queue.spec.ts -t "idempotent upsert"` | ❌ Plan 25-02 | ⬜ pending |
| 25-02-02 | 02 | 2 | SC1 | DB-gated | `npx vitest run server/pipelines/__tests__/queue.spec.ts -t "unschedule on delete"` | ❌ Plan 25-02 | ⬜ pending |
| 25-02-03 | 02 | 2 | SC1 | structural | `! grep -rE "from 'node-cron'" server/scheduler.ts` (zero remaining imports) | ❌ Plan 25-02 | ⬜ pending |
| 25-03-01 | 03 | 3 | MOD-06 | unit | `npx vitest run server/pipelines/__tests__/module.spec.ts` (factory shape) | ❌ Plan 25-03 | ⬜ pending |
| 25-03-02 | 03 | 3 | SC2 | structural | `! grep -nE "Promise.*chain\\|await.*executor.*next" server/pipelines/internal/executor.ts` | ❌ Plan 25-03 | ⬜ pending |
| 25-03-03 | 03 | 3 | SC1 | structural | `! grep -E "node-cron" package.json` (deps removed) | ❌ Plan 25-03 | ⬜ pending |
| 25-03-04 | 03 | 3 | (registration) | structural | `grep -c "fastify.addHook\\('onReady'" server/pipelines/plugin.ts >= 1` (cross-module subscriber deferred per Pitfall 5) | ❌ Plan 25-03 | ⬜ pending |
| 25-04-01 | 04 | 4 | SC2 | DB-gated | `npx vitest run server/pipelines/__tests__/subscriber.spec.ts -t "3-stage"` | ❌ Plan 25-04 | ⬜ pending |
| 25-04-02 | 04 | 4 | SC2 | DB-gated | `npx vitest run server/pipelines/__tests__/subscriber.spec.ts -t "matrix"` | ❌ Plan 25-04 | ⬜ pending |
| 25-04-03 | 04 | 4 | SC2 | DB-gated | `npx vitest run server/pipelines/__tests__/correlation.spec.ts` | ❌ Plan 25-04 | ⬜ pending |
| 25-04-04 | 04 | 4 | SC1+SC2 | unit (readFileSync) | `npx vitest run server/pipelines/__tests__/lifecycle-ownership.spec.ts` (zero node-cron, zero Promise chain, zero polling) | ❌ Plan 25-04 | ⬜ pending |
| 25-05-01 | 05 | 5 | MOD-01 | structural | `grep -cE '^## (Purpose\|Public API\|Events Emitted\|Events Consumed\|Queue Produced\|Queue Consumed\|Invariants\|Non-Goals\|Dependencies)$' server/pipelines/MODULE.md` returns 9 | ❌ Plan 25-05 | ⬜ pending |
| 25-05-02 | 05 | 5 | MOD-04 | manual git | `find server/pipelines/__tests__ -name '*.test.ts' \| wc -l` returns 0 | ❌ Plan 25-05 | ⬜ pending |
| 25-05-03 | 05 | 5 | (plugin-order) | unit | `npx vitest run server/__tests__/plugin-order.spec.ts` (additive pipelines block) | ✅ extend | ⬜ pending |
| 25-05-04 | 05 | 5 | Nyquist | gate | `npm run nyquist:check` exit 0 (delta ≥ -2pp) | ✅ existing | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `server/pipelines/events.ts` — placeholder (PIPELINE_EVENT_NAMES + empty registry; full body 25-01)
- [ ] `server/pipelines/queue.ts` — placeholder (`PIPELINE_SCHEDULED_EXECUTE_QUEUE_NAME` alias; full helper body 25-01)
- [ ] `server/pipelines/internal/module.ts` — 10-line throw-stub for dep-cruiser resolvable target
- [ ] `server/pipelines/MODULE.md` — Purpose-only placeholder
- [ ] `server/pipelines/index.ts` — 1-line MOD-02 strict re-export from internal/
- [ ] `server/pipelines/__tests__/events.spec.ts` — registry-shape stub
- [ ] `.dependency-cruiser.cjs` — 9th rule `no-deep-imports-into-pipelines-internal`
- [ ] `__fixtures__/dep-cruiser/bad-pipelines-deep-import.ts` — fires 9th rule
- [ ] `server/hooks/__tests__/dep-cruiser.spec.ts` — extend with 9th rule check
- [ ] `server/queue/names.ts` — add `PIPELINE_SCHEDULED_EXECUTE: 'pipeline.scheduled.execute'`

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real cron timing fire | SC1 | `boss.schedule()` fires on cron expression schedule; can't reliably automate at 1-min granularity | Set up pipeline with `* * * * *` cron, observe pgboss.schedule row, wait 60s, verify run row created |
| Reconciliation on restart | SC1 | Server restart with stale schedules requires manual restart cycle | Restart server, verify `boss.getSchedules()` matches `pipelineSchedules` rows |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
