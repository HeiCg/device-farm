---
phase: 34
slug: session-api-mcp
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-16
---

# Phase 34 — Validation Strategy

> Session module + MCP stdio server. All-TypeScript phase; Vitest end-to-end.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Frameworks** | Vitest (server module + MCP package + web) · DB-gated subscriber tests via `DATABASE_URL` |
| **Config files** | `server/sessions/__tests__/` (Wave 0 installs) · `mcp/__tests__/` (Wave 0 installs) · `web/src/lib/sessions/__tests__/` (Wave 0 installs) |
| **Quick run** | `npx vitest run server/sessions` |
| **MCP run** | `cd mcp && npx vitest run` |
| **Full suite** | `npm test` (server + mcp + web) |
| **Estimated runtime** | ~60s server · ~20s mcp · ~30s web |

---

## Sampling Rate

- **After every task commit:** Quick run of touched surface
- **After every wave:** Full server vitest run
- **Before phase verify:** Full suite + live MCP smoke (`npx @device-stream/mcp`) + WS smoke
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 34-T1 | 01 | 1 | SESS-LEASE | unit + db | `npx vitest run server/sessions/__tests__/routes.spec` | ❌ W0 | ⬜ pending |
| 34-T2 | 02 | 2 | SESS-WS | unit | `npx vitest run server/sessions/__tests__/ws.spec` | ❌ W0 | ⬜ pending |
| 34-T3 | 02 | 2 | SESS-DISPATCH | unit + mock | `npx vitest run server/sessions/__tests__/dispatch.spec` | ❌ W0 | ⬜ pending |
| 34-T4 | 03 | 3 | SESS-NL-MAESTRO | unit | `npx vitest run server/sessions/__tests__/resolver-maestro.spec` | ❌ W0 | ⬜ pending |
| 34-T5 | 03 | 3 | SESS-NL-CLAUDE | unit | `npx vitest run server/sessions/__tests__/resolver-claude.spec` | ❌ W0 | ⬜ pending |
| 34-T6 | 04 | 4 | SESS-AUTH | unit + db | `npx vitest run server/sessions/__tests__/auth-rate-sweeper.spec` | ❌ W0 | ⬜ pending |
| 34-T7 | 05 | 5 | SESS-MCP | unit + smoke | `cd mcp && npx vitest run` | ❌ W0 | ⬜ pending |
| 34-T8 | 06 | 5 | SESS-CLI | unit | `cd cli && go test ./cmd/session/...` | ❌ W0 | ⬜ pending |
| 34-T9 | 07 | 5 | SESS-WEB | unit | `cd web && npx vitest run lib/sessions/` | ❌ W0 | ⬜ pending |
| 34-T10 | 08 | 6 | SESS-DOCS | doc | `test -f docs/runbooks/session-api.md && test -f docs/runbooks/mcp.md` | ❌ W0 | ⬜ pending |

---

## Wave 0 Requirements

- [ ] `server/sessions/__tests__/` — Vitest scaffolds (routes, ws, dispatch, resolver, auth-rate-sweeper)
- [ ] `mcp/` — new workspace with `package.json`, `vitest.config.ts`, `__tests__/`
- [ ] `server/db/schema.ts` — `sessions` table added (Wave 0 schema-only; impl lands later)
- [ ] `cli/cmd/session/` — Cobra command skeleton (no impl)
- [ ] `web/src/routes/sessions/[id]/+page.svelte` — stub route
- [ ] `web/src/lib/sessions/__tests__/` — UI test stubs

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real Claude Code can register and use MCP server | SESS-MCP | Requires Claude Code app + valid API key | Add to ~/.config/claude/mcp.json, restart, list tools, lease device, run action |
| Sweeper auto-releases TTL'd session within 30s | SESS-AUTH | Time-dependent | Lease with 10s TTL, observe release event within 30s |
| 30 actions / 10s rate limit triggers 429 | SESS-AUTH | Live timing | Spam WS actions, observe 31st returns rate-limit error |
| `tap_by_description` resolves real Login button | SESS-NL | Live device + AI model | Lease device with sample app, send `{action:'tapByDescription', target:'Login button'}` |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] `nyquist_compliant: true` once Wave 0 lands

**Approval:** pending
