---
phase: 35
slug: app-explorer
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-16
---

# Phase 35 — Validation Strategy

> All-TypeScript phase: agent runner + Atlas viz. Vitest end-to-end with sample APK exploration as integration smoke.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Frameworks** | Vitest (server + web) · DB-gated subscriber tests · sharp/sharp-phash unit tests |
| **Config files** | `server/explorations/__tests__/` (Wave 0 installs) · `web/src/lib/explorations/__tests__/` (Wave 0 installs) |
| **Quick run** | `npx vitest run server/explorations` |
| **Web run** | `cd web && npx vitest run lib/explorations` |
| **Full suite** | `npm test` |
| **Estimated runtime** | ~60s server · ~30s web |

---

## Sampling Rate

- **After every task commit:** Quick run of touched surface
- **After every wave:** Full server + web vitest run
- **Before phase verify:** Full suite + sample APK exploration end-to-end smoke
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 35-T1 | 01 | 1 | EXP-SCHEMA | unit + db | `npx vitest run server/explorations/__tests__/routes.spec` | ❌ W0 | ⬜ pending |
| 35-T2 | 02 | 2 | EXP-AGENT | unit + mock | `npx vitest run server/explorations/__tests__/runner.spec` | ❌ W0 | ⬜ pending |
| 35-T3 | 02 | 2 | EXP-LOOP | unit | `npx vitest run server/explorations/__tests__/loop-detection.spec` | ❌ W0 | ⬜ pending |
| 35-T4 | 03 | 3 | EXP-WS | unit | `npx vitest run server/explorations/__tests__/ws.spec` | ❌ W0 | ⬜ pending |
| 35-T5 | 04 | 4 | EXP-CLI | unit | `cd cli && go test ./cmd/explore/...` | ❌ W0 | ⬜ pending |
| 35-T6 | 05 | 5 | EXP-UI | unit | `cd web && npx vitest run lib/explorations/atlas.spec` | ❌ W0 | ⬜ pending |
| 35-T7 | 06 | 6 | EXP-REPORT | unit + integration | `npx vitest run server/explorations/__tests__/report.spec` | ❌ W0 | ⬜ pending |

---

## Wave 0 Requirements

- [ ] `server/db/schema.ts` — 3 new tables (explorations, exploration_screens, exploration_transitions)
- [ ] `server/db/migrations/0010_explorations.sql` — generated migration
- [ ] `server/explorations/` — module scaffold (events.ts, MODULE.md, internal/, plugin.ts, index.ts barrel)
- [ ] `server/explorations/__tests__/` — Vitest stubs (routes, runner, loop-detection, ws, report)
- [ ] `cli/cmd/explore/` — Cobra subcommand stub
- [ ] `web/src/routes/explorations/+page.svelte` — list stub
- [ ] `web/src/routes/explorations/[id]/+page.svelte` — detail stub
- [ ] `web/src/lib/explorations/atlas-graph.svelte` + `__tests__/` — UI stub
- [ ] `prompts/exploration.md` — agent prompt template stub

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Sample APK exploration finds ≥10 distinct screens within budget | EXP-AGENT | Requires live device + APK + Claude API key | `device-farm explore sample.apk --max-screens 30 --max-taps 50` |
| Atlas graph renders interactively with BFS layout | EXP-UI | Requires browser | Open `/explorations/[id]`, verify nodes laid out by dagre, back-edges dashed |
| Stuck detection fires on 3rd consecutive same-screen tap | EXP-LOOP | Live agent loop | Run exploration on a known-dead-end screen, observe stuck event in WS |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] `nyquist_compliant: true` once Wave 0 lands

**Approval:** pending
