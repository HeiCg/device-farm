---
phase: 37
slug: platform-extensions
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-16
updated: 2026-05-16
---

# Phase 37 — Validation Strategy

> 4 independent feature tracks closing v3.0. Each track has its own validation thread.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Frameworks** | Vitest (server + web) · Go test (CLI iOS skeleton) · DB-gated subscriber tests |
| **Config files** | `server/preflight/__tests__/` · `server/integrations/github/__tests__/` · `cli/internal/macho/` · `server/jobs/__tests__/input-broadcaster.spec.ts` · `server/reporting/__tests__/webhook-payload.spec.ts` |
| **Quick run** | `npx vitest run server/preflight server/integrations/github server/jobs/__tests__/input-broadcaster server/jobs/__tests__/parallel-deploy server/reporting/__tests__/webhook-payload` |
| **CLI run** | `cd cli && go test ./internal/macho/...` |
| **Full suite** | `npm test && (cd cli && go test ./...)` |
| **Estimated runtime** | ~50s server · ~15s CLI · ~30s web |

---

## Sampling Rate

- **After every task commit:** Quick run of touched track
- **After every wave:** Full server vitest + CLI go test
- **Before phase verify:** Full suite + sample .ipa skeleton extraction + sample preflight + sandbox-repo PR webhook + 2-device input broadcast smoke
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

| Task ID | Track | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|-------|------|------|-------------|-----------|-------------------|-------------|--------|
| 37-T1 | A | 01 | 1 | EXT-IOS-SKELETON | unit | `cd cli && go test ./internal/macho/... && npx vitest run server/analysis/__tests__/routes.spec.ts` | ✅ | ✅ verified |
| 37-T2 | B | 02 | 1 | EXT-PREFLIGHT | unit + db | `npx vitest run server/preflight/__tests__/routes.spec` | ✅ | ✅ verified |
| 37-T3 | C | 03 | 1 | EXT-GITHUB-PR | unit + db | `npx vitest run server/integrations/github/__tests__/webhook-handler.spec.ts` | ✅ | ✅ verified |
| 37-T4 | D | 04 | 1 | EXT-INPUT-BROADCAST | unit | `npx vitest run server/jobs/__tests__/input-broadcaster.spec` | ✅ | ✅ verified |
| 37-T5 | D | 04 | 1 | EXT-BUILD-ONCE | unit | `npx vitest run server/jobs/__tests__/parallel-deploy.spec.ts` | ✅ | ✅ verified |
| 37-T6 | close | 05 | 2 | (all) | integration | `npx vitest run server/reporting/__tests__/webhook-payload.spec.ts` | ✅ | ✅ verified |

---

## Wave 0 Requirements

- [x] `server/preflight/` — module scaffold + rule pack JSON + spec stubs
- [x] `server/integrations/github/` — module scaffold + spec stubs
- [x] `cli/internal/macho/` — Go package + test stubs
- [x] `server/analysis/ipa-skeleton.ts` — TS wrapper stub + spec
- [x] `server/jobs/internal/input-broadcaster.ts` + `build-once.ts` — stubs + spec stubs
- [x] `web/src/routes/builds/[id]/skeleton/+page.svelte` — stub
- [x] `web/src/routes/preflight/+page.svelte` — stub
- [x] npm deps: `@octokit/app`, `@octokit/auth-app`, `@octokit/webhooks-methods`, `@plist/parse`, `bplist-parser`
- [x] DB migrations: 0011 (analyses + preflight_runs + github_* columns)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `device-farm analyze sample.ipa` outputs valid skeleton | EXT-IOS-SKELETON | Requires real .ipa | Run on test fixture, inspect JSON output |
| Known-bad IPA flagged with blockers | EXT-PREFLIGHT | Requires curated test fixture | `POST /api/preflight` with missing-PrivacyInfo IPA, verify red badge |
| Sandbox GitHub repo webhook delivers PR comment | EXT-GITHUB-PR | Requires real GitHub App + sandbox repo | Install app, open PR with `--github-pr` flag, observe comment + edit on rerun |
| 2-device InputBroadcaster fans out tap | EXT-INPUT-BROADCAST | Requires 2 devices | Lease 2 sessions, broadcast tap, observe both devices respond |

---

## Manual GitHub sandbox verification (Plan 37-05)

**Status:** Deferred to operator. The autonomous chain that closed Phase 37 had no real GitHub App or sandbox repo. The 7-step provisioning + 10-step verification flow remains documented in `docs/runbooks/github-integration.md` for first-deployment validation.

**Algorithmic correctness proven by Wave 1 automated tests** (37-03 Plan SUMMARY §Sandbox Verification Notes):
1. Forged signature → 401 (routes.spec.ts)
2. Valid signature → handler dispatches with correct (owner, repo, pr_number, installation_id) tuple
3. Commenter POST vs PATCH branches based on lookupCommentId
4. Template caps + emoji map (template-builder.spec.ts)
5. Raw-body preservation across whitespace variants (Pitfall 1 regression guard)

The remaining gap — confirming that GitHub itself accepts the signed delivery and the commenter is visible in the PR UI — is logged as the standard operator-side acceptance test for `EXT-GITHUB-PR`. When run, it should be appended below this section with timestamps + screenshot links.

---

## Validation Sign-Off — 2026-05-16

- [x] All tasks have automated `<verify>` commands; Wave 0 dependencies resolved
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covered all MISSING references (Plan 37-00 SUMMARY)
- [x] No watch-mode flags
- [x] `nyquist_compliant: true` post-Wave-1
- [x] Manual GitHub sandbox round-trip documented (operator-deferred)

**Approval:** Phase 37 complete. v3.0 PROVISIONAL.
