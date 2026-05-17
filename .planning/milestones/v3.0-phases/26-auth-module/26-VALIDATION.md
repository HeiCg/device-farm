---
phase: 26
slug: auth-module
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-08
---

# Phase 26 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.x |
| **Config file** | `vitest.config.ts` (root) |
| **Quick run command** | `npx vitest run server/auth/__tests__/` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~30s quick (DB-gated skip if no DATABASE_URL); ~3-4min full |

---

## Sampling Rate

- **Per task commit:** `npx vitest run server/auth/__tests__/<file>.spec.ts` (~200ms-15s).
- **Per wave:** `npx vitest run server/auth/ server/__tests__/plugin-order.spec.ts server/hooks/__tests__/dep-cruiser.spec.ts`.
- **Phase gate (Plan 26-05 close):** `npm test` excluding inherited DEFERRED-17-A; `npm run dep-check` ≤ 3 (artifacts→streaming pre-existing); `npx tsc --noEmit` 0 NEW errors; `npm run nyquist:check` exit 0; `npm run lint` clean.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | SC | Test Type | Automated Command | File Exists | Status |
|---------|------|------|----|-----------|-------------------|-------------|--------|
| 26-00-01 | 00 | 0 | MOD-02 | structural | `find server/auth -name 'MODULE.md' -name 'index.ts' -name 'events.ts' -name 'internal/module.ts'` | ❌ W0 | ⬜ |
| 26-00-02 | 00 | 0 | MOD-02 | unit | `npx vitest run server/hooks/__tests__/dep-cruiser.spec.ts` (10th rule) | ✅ extend | ⬜ |
| 26-00-03 | 00 | 0 | (claims col) | unit | `npx drizzle-kit push --dry-run` (apiKeys.claims migration) | ❌ W0 | ⬜ |
| 26-01-01 | 01 | 1 | EVENTS-03 | unit | `npx vitest run server/auth/__tests__/events.spec.ts` (2 events full body) | ❌ W0 from 00 | ⬜ |
| 26-01-02 | 01 | 1 | TRACE-10 | unit | `npx vitest run server/auth/__tests__/actor.spec.ts` (actorSchema regex) | ❌ Plan 26-01 | ⬜ |
| 26-02-01 | 02 | 2 | TRACE-10 | structural | `! grep -nE "als.run\\(\\{ ?correlationId:[^,}]+\\}" server/` (no plain ALS without actor) | ❌ Plan 26-02 | ⬜ |
| 26-02-02 | 02 | 2 | TRACE-10 | structural | `grep -c "actor: 'system'" server/index.ts >= 1` (boot-time wraps) | ❌ Plan 26-02 | ⬜ |
| 26-02-03 | 02 | 2 | TRACE-10 | structural | `grep -c "data.actor ?? 'cron'" server/queue/plugin.ts >= 1` (Phase 18 stamp confirmed; or extend) | ✅ exists | ⬜ |
| 26-02-04 | 02 | 2 | TRACE-10 | structural | `grep -c "readAls('actor')" server/bus/helpers.ts >= 1` (default 'system' not 'anonymous') | ❌ Plan 26-02 | ⬜ |
| 26-03-01 | 03 | 3 | MOD-06 | unit | `npx vitest run server/auth/__tests__/module.spec.ts` (factory shape) | ❌ Plan 26-03 | ⬜ |
| 26-03-02 | 03 | 3 | SC1 | unit | `npx vitest run server/auth/__tests__/contract.spec.ts` (Zod request + response) | ❌ Plan 26-03 | ⬜ |
| 26-03-03 | 03 | 3 | DEFERRED-23-A | unit | `grep -c "requireAdmin" server/jobs/internal/routes.ts >= 2` (drain + drain/resume gated) | ❌ Plan 26-03 | ⬜ |
| 26-03-04 | 03 | 3 | DEFERRED-26-A | unit | `grep -c "POST.*claims" server/auth/internal/key-routes.ts >= 1` | ❌ Plan 26-03 | ⬜ |
| 26-04-01 | 04 | 4 | SC1 | DB-gated | `npx vitest run server/auth/__tests__/subscriber.spec.ts` (auth.key.created/revoked emit + persist) | ❌ Plan 26-04 | ⬜ |
| 26-04-02 | 04 | 4 | TRACE-10 | DB-gated | `npx vitest run server/auth/__tests__/als-actor.spec.ts` (4 actor sources) | ❌ Plan 26-04 | ⬜ |
| 26-04-03 | 04 | 4 | DEFERRED-23-A | DB-gated | `npx vitest run server/auth/__tests__/admin-claim.spec.ts` (drain 403 without claim, 200 with) | ❌ Plan 26-04 | ⬜ |
| 26-04-04 | 04 | 4 | TRACE-10 | unit (readFileSync) | `npx vitest run server/auth/__tests__/lifecycle-ownership.spec.ts` (grep-guards) | ❌ Plan 26-04 | ⬜ |
| 26-05-01 | 05 | 5 | MOD-01 | structural | `grep -cE '^## (Purpose\|Public API\|Events Emitted\|Events Consumed\|Queue Produced\|Queue Consumed\|Invariants\|Non-Goals\|Dependencies)$' server/auth/MODULE.md` returns 9 | ❌ Plan 26-05 | ⬜ |
| 26-05-02 | 05 | 5 | MOD-04 | manual git | `find server/auth/__tests__ -name '*.test.ts' \| wc -l` returns 0 | ❌ Plan 26-05 | ⬜ |
| 26-05-03 | 05 | 5 | (plugin-order) | unit | `npx vitest run server/__tests__/plugin-order.spec.ts` (additive auth block) | ✅ extend | ⬜ |
| 26-05-04 | 05 | 5 | Nyquist | gate | `npm run nyquist:check` exit 0 | ✅ existing | ⬜ |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `server/auth/events.ts` — placeholder (AUTH_EVENT_NAMES + empty registry)
- [ ] `server/auth/internal/module.ts` — 10-line throw-stub
- [ ] `server/auth/internal/actor.ts` — actorSchema placeholder (full body 26-01)
- [ ] `server/auth/MODULE.md` — Purpose-only placeholder
- [ ] `server/auth/index.ts` — 1-line MOD-02 strict re-export
- [ ] `server/auth/__tests__/events.spec.ts` — registry stub
- [ ] `server/db/migrations/<NNNN>_api_keys_claims.sql` — drizzle-kit generate (`claims JSONB DEFAULT '{}'`)
- [ ] `.dependency-cruiser.cjs` — 10th rule `no-deep-imports-into-auth-internal`
- [ ] `__fixtures__/dep-cruiser/bad-auth-deep-import.ts` — fires 10th rule
- [ ] `server/hooks/__tests__/dep-cruiser.spec.ts` — extend with 10th rule check

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| First admin claim bootstrap procedure | DEFERRED-23-A | Production bootstrap requires careful first-key seeding | Documented in `docs/runbooks/admin-bootstrap.md` (Plan 26-03 deliverable); operator runs SQL `UPDATE api_keys SET claims = '{"admin": true}' WHERE id = ?` once after migration |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
