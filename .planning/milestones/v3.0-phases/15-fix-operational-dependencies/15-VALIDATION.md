---
phase: 15
slug: fix-operational-dependencies
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-17
---

# Phase 15 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.x |
| **Config file** | `vitest.config.ts` (existing) |
| **Quick run command** | `npx vitest run server/` |
| **Full suite command** | `npm test && npm run lint` |
| **Estimated runtime** | ~45 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run server/<module>/__tests__/` (scoped)
- **After every plan wave:** Run `npm test && npm run lint`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 15-00-01 | 00 | 0 | SPEC-04 (JSONB spike) | integration | `npx vitest run server/db/__tests__/jsonb-roundtrip.spec.ts` | ❌ W0 | ⬜ pending |
| 15-00-02 | 00 | 0 | QUEUE-01 (pg-boss spike) | integration | `npx vitest run server/queue/__tests__/migration.spec.ts` | ❌ W0 | ⬜ pending |
| 15-00-03 | 00 | 0 | SPEC-09 (branded IDs) | compile | `npx tsc --noEmit server/types/__tests__/ids.tsd.ts` | ❌ W0 | ⬜ pending |
| 15-00-04 | 00 | 0 | QUEUE-07 (shutdown timing) | integration | `npx vitest run server/queue/__tests__/shutdown.spec.ts` | ❌ W0 | ⬜ pending |
| 15-01-01 | 01 | 1 | TRACE-07 (events table) | migration | `npx drizzle-kit push && npx vitest run server/db/__tests__/events-schema.spec.ts` | ❌ W0 | ⬜ pending |
| 15-01-02 | 01 | 1 | SPEC-04 (row decoder) | unit | `npx vitest run server/db/__tests__/events-decoder.spec.ts` | ❌ W0 | ⬜ pending |
| 15-02-01 | 02 | 1 | SPEC-09 (branded IDs central) | unit | `npx vitest run server/types/__tests__/ids.spec.ts` | ❌ W0 | ⬜ pending |
| 15-03-01 | 03 | 1 | TRACE-01/02/03, MOD-07 (correlation plugin + pino mixin) | integration | `npx vitest run server/correlation/__tests__/plugin.spec.ts` | ❌ W0 | ⬜ pending |
| 15-04-01 | 04 | 2 | EVENTS-01/02/03/04/05/08, SPEC-05/08/10 (typed bus + envelope + helpers) | unit | `npx vitest run server/bus/__tests__/` | ❌ W0 | ⬜ pending |
| 15-04-02 | 04 | 2 | TRACE-04/08/09 (middleware: correlationId, persistence filter, causation) | integration | `npx vitest run server/bus/__tests__/middleware.spec.ts` | ❌ W0 | ⬜ pending |
| 15-05-01 | 05 | 2 | QUEUE-01/02/04/07 (pg-boss plugin + wrapper + shutdown) | integration | `npx vitest run server/queue/__tests__/` | ❌ W0 | ⬜ pending |
| 15-05-02 | 05 | 2 | TRACE-05 (ALS cross-queue restore) | integration | `npx vitest run server/queue/__tests__/als.spec.ts` | ❌ W0 | ⬜ pending |
| 15-06-01 | 06 | 3 | (plugin reorder) | integration | `npx vitest run server/__tests__/plugin-order.spec.ts` | ❌ W0 | ⬜ pending |
| 15-07-01 | 07 | 3 | EVENTS-03/08 (lint rules) | lint | `npm run lint` | ❌ W0 | ⬜ pending |
| 15-08-01 | 08 | 3 | MOD-10 (ADR-001) | doc | `test -f docs/adr/001-spec-driven-architecture.md && grep -q '## Status' docs/adr/001-spec-driven-architecture.md` | ❌ W0 | ⬜ pending |
| 15-09-01 | 09 | 3 | DEBT-03 (Nyquist baseline) | file | `test -f .planning/nyquist-baseline.json && jq -e '.tests >= 0' .planning/nyquist-baseline.json` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `server/db/__tests__/jsonb-roundtrip.spec.ts` — SPEC-04 JSONB round-trip (Postgres `jsonb` does not preserve key order; assert deep equality, not string equality)
- [ ] `server/queue/__tests__/migration.spec.ts` — pg-boss v12 auto-migration creates `pgboss` schema on first `boss.start()`; idempotent on re-run
- [ ] `server/queue/__tests__/shutdown.spec.ts` — measures `boss.stop({graceful:true, timeout:30_000})` drains within budget
- [ ] `server/types/__tests__/ids.tsd.ts` — `@ts-expect-error` proofs that `JobId` and `DeviceId` brands prevent cross-assignment
- [ ] `eslint-plugin-local-rules` installed + `eslint.config.mjs` wired to run custom rules
- [ ] `@fastify/request-context` v6 and `pg-boss` v12 added to dependencies
- [ ] Node version pinned ≥ 22.12 (pg-boss v12 requirement); `.nvmrc` updated if needed

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Fresh-boot on dev Mac Mini registers plugins in target order without crash | Phase goal SC #1 | Requires Mac Mini + Postgres running; plugin load order is side-effect observable in logs | 1. Drop dev DB. 2. `npm run dev`. 3. Watch startup logs for plugin registration order: config → event-bus → correlation → dependency-checker → db → queue → telemetry → …. 4. Send SIGTERM; confirm "boss stopped gracefully" log before "db plugin closed". |
| `X-Correlation-Id` end-to-end | Phase goal SC #2 | Requires live HTTP request + worker round-trip | 1. `curl -v http://localhost:3000/api/health` with no header; note response `X-Correlation-Id`. 2. Grep pino logs for same UUID across request + any business event inserted. |
| Producer-worker correlation ID parity | Phase goal SC #3 | Needs inside-request `boss.send` + worker log inspection | 1. Hit a route that invokes `queue.send('demo', ...)`. 2. Confirm producer log line and worker log line share the same `correlationId`. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
