---
phase: 22
slug: streaming-module
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-22
---

# Phase 22 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 3.x (ES modules, NodeNext resolution) |
| **Config file** | vitest.config.ts (existing) |
| **Quick run command** | `npx vitest run server/streaming/__tests__/` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~25-45 seconds (quick) / ~3-4 minutes (full) |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run server/streaming/__tests__/`
- **After every plan wave:** Run `npm test` (excluding Phase 17 fastify-zod-openapi pre-existing failures)
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 45 seconds

---

## Per-Task Verification Map

See RESEARCH.md §Validation Architecture for the full 11-row SC1..SC4 + TRACE-06 + MOD-01..04 + Nyquist delta gate mapping. Planner populates plan-level task IDs with per-task automated commands matching this table.

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 22-00-01 | 00 | 0 | MOD-02/03 | unit | `npx vitest run server/streaming/__tests__/events.spec.ts` | ❌ W0 | ⬜ pending |
| 22-00-02 | 00 | 0 | MOD-02 | unit | `npx vitest run server/hooks/__tests__/dep-cruiser.spec.ts` | ✅ existing | ⬜ pending |
| 22-01-01 | 01 | 1 | EVENTS-03 / TRACE-04 | unit | `npx vitest run server/streaming/__tests__/events.spec.ts` | ❌ W0 | ⬜ pending |
| 22-01-02 | 01 | 1 | Bridgehead | unit | `npx vitest run server/jobs/__tests__/events.spec.ts` | ✅ existing | ⬜ pending |
| 22-02-01 | 02 | 2 | SC2 / MOD-06 | unit | `npx vitest run server/streaming/__tests__/module.spec.ts` | ❌ W0 | ⬜ pending |
| 22-02-02 | 02 | 2 | SC2 grep | unit | `grep -c 'this.jobBroadcaster?.emit' server/jobs/job-service.ts` → 0 | ✅ existing | ⬜ pending |
| 22-03-01 | 03 | 3 | SC1 / SC2 | db-gated | `TEST_DATABASE_URL=... npx vitest run server/streaming/__tests__/subscriber.spec.ts` | ❌ W0 | ⬜ pending |
| 22-03-02 | 03 | 3 | SC1 / TRACE-06 / SC3 | db-gated | `TEST_DATABASE_URL=... npx vitest run server/streaming/__tests__/correlation.spec.ts` | ❌ W0 | ⬜ pending |
| 22-03-03 | 03 | 3 | SC1 safeParse drop | unit | `npx vitest run server/streaming/__tests__/envelope.spec.ts` | ❌ W0 | ⬜ pending |
| 22-04-01 | 04 | 4 | SC2 lifecycle | unit | `npx vitest run server/streaming/__tests__/lifecycle-ownership.spec.ts` | ❌ W0 | ⬜ pending |
| 22-04-02 | 04 | 4 | plugin-order + substring-fix | unit | `npx vitest run server/__tests__/plugin-order.spec.ts` | ✅ existing | ⬜ pending |
| 22-05-01 | 05 | 5 | MOD-01/04 | meta | `test -f server/streaming/MODULE.md && find server/streaming/__tests__ -name '*.test.ts' | wc -l` → 0 | ❌ W0 | ⬜ pending |
| 22-05-02 | 05 | 5 | Nyquist SC4 | gate | `npm run nyquist:check` exit 0 | ✅ existing | ⬜ pending |
| 22-06-01 | 06 | 6 | Full-suite sweep | gate | `npm test` passes (with inherited Phase 17 exclusions) | ✅ existing | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `server/streaming/events.ts` — minimal stub: STREAMING_EVENT_NAMES + STREAMING_AGGREGATE_ID placeholder + empty streamingRegistry (full body lands in Plan 22-01)
- [ ] `server/streaming/internal/module.ts` — 10-line throw-stub for dep-cruiser resolvable target (Phase 18/19/20/21 empirical 5th repeat)
- [ ] `server/streaming/MODULE.md` — Purpose-only placeholder (full body lands in Plan 22-05)
- [ ] `server/streaming/index.ts` — strict MOD-02 1-line `internal/` re-export (stays minimal through Plan 22-05)
- [ ] `server/streaming/__tests__/events.spec.ts` — 1 test EVENTS-03 shape
- [ ] `.dependency-cruiser.cjs` — add 6th forbidden rule `no-deep-imports-into-streaming-internal`
- [ ] `__fixtures__/dep-cruiser/bad-streaming-deep-import.ts` — fires the rule via `@ts-expect-error` import
- [ ] `server/hooks/__tests__/dep-cruiser.spec.ts` — extended with `[MOD-02 streaming extension]` it-block (two-pass err+json pattern)
- [ ] `server/jobs/events.ts` — 3-key placeholder extension: `job.log`/`job.step`/`job.status` added to JOB_EVENT_NAMES (body lands in Plan 22-01)
- [ ] `server/queue/names.ts` — NO change (streaming has no queue; documented deviation from Phase 16-21 template)

*If none: "Existing infrastructure covers all phase requirements."*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Web dev console shows correlationId in WS event JSON + server log has matching correlationId | SC3 | Requires running server + web + real WS client; automated version proves correlationId round-trips in isolation | 1. `npm run dev` + `npm run web:dev`. 2. Submit a Maestro job via CLI. 3. Open web UI, DevTools → WS tab → click any `job.log` frame. 4. Copy `correlationId` from envelope. 5. `grep <correlationId> server.log` — confirm matching structured log lines from the originating API request. |

*If none: "All phase behaviors have automated verification."*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 45s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
