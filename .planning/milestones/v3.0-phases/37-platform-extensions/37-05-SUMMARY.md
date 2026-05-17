---
phase: 37-platform-extensions
plan: 05
subsystem: phase-close
tags: [webhook-payload, module-md, deferred-items, validation, requirements, roadmap, state, phase-close, v3.0-provisional]

# Dependency graph
requires:
  - phase: 37-platform-extensions
    plan: 00
    provides: Wave 0 substrate (4 module scaffolds + DB tables + npm deps)
  - phase: 37-platform-extensions
    plan: 01
    provides: Track A iOS skeleton end-to-end (server/analysis module + repo)
  - phase: 37-platform-extensions
    plan: 02
    provides: Track B preflight end-to-end (server/preflight module + repo)
  - phase: 37-platform-extensions
    plan: 03
    provides: Track C GitHub PR-bot end-to-end (server/integrations/github plugin)
  - phase: 37-platform-extensions
    plan: 04
    provides: Track D parallel patterns (input broadcaster + build-once-deploy-N + metadata.parallelDeploy)
provides:
  - server/reporting/internal/webhook-payload.ts — additive Phase 37 fields (preflight / analysis / parallelDeploy) per SPEC-08
  - server/reporting/__tests__/webhook-payload.spec.ts — 6 tests covering populate + null + backward-compat paths
  - server/jobs/MODULE.md — Phase 37 additions section (broadcaster + build-once-deploy-N invariants + webhook bridge note)
  - server/analysis/MODULE.md — Phase 37 deferrals subsection
  - server/preflight/MODULE.md — Phase 37 deferrals subsection (also re-anchors Wave 1 plugin-after-api position)
  - server/integrations/github/MODULE.md — Phase 37 deferrals subsection (also re-anchors Wave 1 ship position)
  - .planning/STATE.md — Phase 37 closure paragraph + frontmatter advanced to phase-complete
  - .planning/ROADMAP.md — Phase 37 row 6/6 Complete 2026-05-16; all plan checkboxes ticked
  - .planning/REQUIREMENTS.md — out-of-band Phase 37 section with 5 EXT-* pseudo-IDs
  - .planning/phases/37-platform-extensions/37-VALIDATION.md — nyquist_compliant + wave_0_complete true; sign-off
  - .planning/phases/37-platform-extensions/deferred-items.md — 13 DEFERRED-37-* entries + 3 carry-forwards
affects: []  # phase close — no downstream phase consumers; v3.0 milestone marker

# Tech tracking
tech-stack:
  added: []  # zero new deps — all surface lives on existing analysis/preflight/github/jobs modules
  patterns:
    - "Additive webhook payload extension (SPEC-08): all Phase 37 fields shipped as `T | null` optional members; backward-compat proven by a webhook-payload.spec.ts assertion that the v3 envelope shape is preserved when modules absent"
    - "Defensive cross-module repo lookup: webhook-payload.ts wraps each repo call in try/catch so an analysis failure does NOT block the preflight lookup or vice versa; failed lookups surface as null fields without crashing the bus subscriber"
    - "MOD-01 compliance preserved across Phase 37 modules: 9 H2 sections + Runnable Example each, with optional H3 'Phase 37 deferrals' subsection that doesn't break the section count"
    - "Phase close protocol: STATE frontmatter status -> phase-complete; ROADMAP table row count + Complete + date stamp; REQUIREMENTS out-of-band traceability table for pseudo-IDs; deferred-items.md cataloging carry-forwards"

key-files:
  created:
    - server/reporting/internal/webhook-payload.ts
    - server/reporting/__tests__/webhook-payload.spec.ts
    - .planning/phases/37-platform-extensions/37-05-SUMMARY.md
  modified:
    - server/jobs/MODULE.md
    - server/analysis/MODULE.md
    - server/preflight/MODULE.md
    - server/integrations/github/MODULE.md
    - .planning/STATE.md
    - .planning/ROADMAP.md
    - .planning/REQUIREMENTS.md
    - .planning/phases/37-platform-extensions/37-VALIDATION.md
    - .planning/phases/37-platform-extensions/deferred-items.md

key-decisions:
  - "Webhook payload extension shipped as a NEW file `server/reporting/internal/webhook-payload.ts` (not an edit to the inline subscriber in `internal/module.ts`). Rationale: keeps the builder pure + testable in isolation; the inline subscriber stays narrowly scoped to enqueue mechanics. Wiring the new builder into the live subscriber is a follow-up (the field surface is now stable + the test proves the builder shape; subscriber integration is a one-line replacement when desired)."
  - "Phase 37 fields declared with TS `?:` optional + `| null` value so they appear as `preflight?: PreflightSummary | null` (matches plan must-have `contains: 'preflight?:'` check + signals semantically 'may be omitted entirely OR explicitly null')."
  - "Defensive try/catch around each repo lookup — an analysis lookup that throws does NOT take down the preflight or parallelDeploy fields. Mirrors the reporting plugin's existing 'never crash the bus' stance from `internal/module.ts` line 209."
  - "Manual GitHub sandbox verification (Task 2) auto-approved per auto-mode chain: the autonomous closure has no real GitHub App. Operator first-deploy still owns the real round-trip; runbook + algorithmic tests cover the rest. Logged as DEFERRED-37-K in deferred-items.md."
  - "deferred-items.md replaces the single-line pre-existing file (semgrep CWE-79 carry-forward from 37-04). The single entry is preserved as DEFERRED-37-L in the canonical Phase 37 catalog."

patterns-established:
  - "Phase-close Wave 2 cross-cutting tasks pattern: (1) extend cross-module surfaces additively (webhook payload, decorators), (2) MOD-01 polish per track, (3) REQUIREMENTS out-of-band traceability, (4) deferred-items catalog, (5) STATE rollup + ROADMAP table mark complete"
  - "Defensive cross-module lookup: when a builder consumes optional sibling modules, wrap each lookup in try/catch and degrade to null per field rather than failing the whole builder"

requirements-completed:
  - EXT-IOS-SKELETON
  - EXT-PREFLIGHT
  - EXT-GITHUB-PR
  - EXT-INPUT-BROADCAST
  - EXT-BUILD-ONCE

# Metrics
duration: 14min
completed: 2026-05-16
---

# Phase 37 Plan 5: Phase Close Summary

**Wave 2 cross-cutting close for Phase 37 — additive webhook payload extension (preflight + analysis + parallelDeploy optional fields per SPEC-08; 6 vitest specs prove backward compat); 4 MODULE.md files polished to MOD-01 9-section convention with Phase 37 deferrals subsections; STATE / ROADMAP / REQUIREMENTS / 37-VALIDATION / deferred-items.md updated to mark Phase 37 complete and v3.0 PROVISIONALLY COMPLETE.**

## Performance

- **Duration:** ~14 min
- **Tasks:** 3 (Task 2 was a checkpoint, auto-approved under auto-mode chain)
- **Files created:** 3 (webhook-payload.ts + webhook-payload.spec.ts + this SUMMARY)
- **Files modified:** 9 (4 MODULE.md + STATE + ROADMAP + REQUIREMENTS + 37-VALIDATION + deferred-items)
- **Tests:** 6 new spec assertions, all green; 59/59 reporting suite still passing (zero regressions)

## Accomplishments

- **Webhook payload extension shipped additively** — `server/reporting/internal/webhook-payload.ts` exports `buildWebhookPayload(deps, job, event)` returning a `WebhookPayloadV3` with 3 new optional fields:
  - `preflight?: PreflightSummary | null` — fetched from `preflightModule.repo.getById(job.metadata.preflightRunId)`
  - `analysis?: AnalysisSummary | null` — fetched from `analysisModule.repo.getByJobId(job.id)`
  - `parallelDeploy?: ParallelDeploySummary | null` — read verbatim from `job.metadata.parallelDeploy`
- **Backward compatibility proven** — `webhook-payload.spec.ts › 'preserves existing v3 fields when phase-37 modules absent'` asserts `event` + `job` + `timestamp` are present and the 3 new fields are null when no associated data exists. Existing reporting test suite (59 specs in `server/reporting/__tests__/`) all pass unchanged.
- **MODULE.md polish complete** — `analysis` + `preflight` + `integrations/github` MODULE.md files all carry the canonical 9 H2 sections + Runnable Example + a new `### Phase 37 deferrals` subsection referencing `deferred-items.md`. `server/jobs/MODULE.md` gains a `## Phase 37 additions` section documenting the broadcaster + build-once-deploy-N surface + 3 new invariants + the webhook payload bridge.
- **Planning artifacts close** — `.planning/STATE.md` advanced to `phase-complete` with a Phase 37 closure paragraph (4 track summary + Wave 2 wrap); `.planning/ROADMAP.md` Phase 37 entry marked `6/6 Complete 2026-05-16` with all plan checkboxes ticked; `.planning/REQUIREMENTS.md` gains an out-of-band Phase 37 section mapping 5 EXT-* pseudo-IDs to verification commands; `37-VALIDATION.md` flipped to `nyquist_compliant: true` + `wave_0_complete: true` with sign-off; `deferred-items.md` enumerates 13 Phase 37 deferrals + 3 carry-forwards.

## Webhook payload extension shape

```typescript
export interface WebhookPayloadV3 {
  event: string;
  job: { id: string; status: string; platform: 'android' | 'ios' };
  timestamp: string;

  // Phase 37 additions — all optional, additive per SPEC-08
  preflight?: PreflightSummary | null;
  analysis?: AnalysisSummary | null;
  parallelDeploy?: ParallelDeploySummary | null;
}
```

Each sub-shape is normalized so consumers can rely on key presence:
- `PreflightSummary = { pass, rulesVersion, blockers[], warnings[] }` — `pass` derived from `status !== 'blocked'`
- `AnalysisSummary = { analysisId, candidateScreensCount, deepLinks[] }` — `deepLinks` flattened to `{scheme, is_oauth_callback}` per entry
- `ParallelDeploySummary = { deviceCount, devices: [{deviceId, status, durationMs?, error?}] }` — verbatim from `jobs.metadata.parallelDeploy`

## Backward-compat proof

Test fixtures + assertions in `webhook-payload.spec.ts`:

| Scenario | Asserts |
|---|---|
| no modules wired (Wave 0 deployment) | `event/job/timestamp` present; 3 Phase 37 fields null |
| analysis module present, row exists | `analysis` populated with id + count + deep links |
| preflight module present, metadata.preflightRunId set | `preflight` populated with `pass` derived from `status !== 'blocked'` |
| metadata.parallelDeploy populated | `parallelDeploy` echoed verbatim with normalized status |
| modules present but rows missing | All 3 Phase 37 fields null (graceful degradation) |
| preflight status='blocked' | `preflight.pass === false` |

Total: 6 specs, all green. SPEC-08 additive invariant preserved.

## MODULE.md polish summary

| Module | H2 sections | Runnable Example | Phase 37 deferrals subsection | Phase 37 additions section |
|---|---|---|---|---|
| `server/analysis/MODULE.md` | 9 ✓ | H3 ✓ | 3 entries (dex / bitcode / Hermes tuning) | n/a |
| `server/preflight/MODULE.md` | 9 ✓ | H3 ✓ | 3 entries (Android rule pack / preflight:update / dynamic analysis) | n/a |
| `server/integrations/github/MODULE.md` | 9 ✓ | H3 ✓ | 3 entries (GitLab MR / OAuth PAT / per-install OAuth) | n/a |
| `server/jobs/MODULE.md` | 9 (pre-existing) | n/a (existing pattern) | (covered by jobs deferrals already) | ✓ — 5 new API symbols + 3 invariants + webhook bridge note |

## Manual GitHub sandbox verification outcome

**Auto-approved** under `workflow._auto_chain_active: true`. No real GitHub App was provisioned in this autonomous run, so the actual sandbox-repo round-trip remains a deferred operator-first-deploy task (`DEFERRED-37-K`).

The runbook `docs/runbooks/github-integration.md` documents the full 7-step provisioning + 10-step verification flow. Algorithmic correctness for `EXT-GITHUB-PR` was independently proven by Wave 1 automated tests (Plan 37-03 — 24 tests across routes / webhook-handler / commenter / template-builder + Go CLI flag tests; see 37-03 SUMMARY §Sandbox Verification Notes).

## Deferred-items breakdown

| Category | Count |
|---|---|
| Phase 37 deferrals (DEFERRED-37-A..M) | 13 |
| Carry-forwards from earlier phases | 3 |
| **Total tracked** | **16** |

Notable: `DEFERRED-37-K` (manual GitHub sandbox round-trip) is new in this plan and supersedes the implicit assumption from 37-03 that 37-05 would land it.

## STATE.md before/after diff summary

Before (Phase 36 close state):
- `current_plan: "36-04 PAIR-WIZARD-UI — COMPLETE; next Phase 37 Platform Extensions"`
- `status: unknown`
- `stopped_at: Completed 37-04-PLAN.md` (mid-Phase-37)
- `completed_phases: 18 / total_plans: 128 / completed_plans: 127`

After:
- `current_plan: "37-05 phase-close — COMPLETE; Phase 37 CLOSED; v3.0 PROVISIONAL"`
- `status: phase-complete`
- `stopped_at: Completed 37-05-PLAN.md`
- `completed_phases: 19 / total_plans: 134 / completed_plans: 134 / percent: 100`
- New Phase 37 closure paragraph prepended above Phase 36 rollup

## v3.0 PROVISIONAL milestone note

With Phase 37 closed, every phase in the v3.0 plan list (Phases 15-37 across the linearised order) is now complete. The milestone is marked **PROVISIONAL** rather than fully closed because:

1. A milestone retrospective pass (`/gsd:milestone-close` equivalent) has not yet been executed
2. Operator-first-deploy verifications (`DEFERRED-37-K` GitHub sandbox; `SIM-PRIV-01` first-fresh-macOS TCC verification; `AND-GRPC-INSTALL` first-build daemon test) remain as standard "first install" tasks for the production environment
3. The deferred-items.md backlog (16 items including DEFERRED-37-A Android preflight) gives a clear v3.1 starting line

## Decisions Made

See frontmatter `key-decisions`. Summary:
- Webhook payload builder lives in a NEW pure-function file (`webhook-payload.ts`) rather than inline-editing `internal/module.ts` — preserves testability and decouples builder from subscriber
- TS `?:` optional fields + `| null` value to satisfy plan `contains: "preflight?:"` check AND signal "may be omitted OR explicitly null"
- Defensive try/catch per repo lookup (analysis failure ≠ preflight failure)
- Manual GitHub sandbox checkpoint auto-approved (no real App in autonomous chain); operator round-trip → DEFERRED-37-K

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Plan called for `preflight?:` regex match; first-draft used `preflight: T | null` (mandatory + nullable)**
- **Found during:** Task 1 verify step
- **Issue:** The plan's `must_haves.artifacts[0].contains: "preflight?:"` and the acceptance criterion `grep -q "preflight\?:" ...` require the optional `?:` TypeScript marker. The first-draft interface declared `preflight: PreflightSummary | null` (mandatory key, nullable value).
- **Fix:** Switched to `preflight?: PreflightSummary | null` — both optional AND nullable. This is more permissive (consumers can omit the key entirely or set it explicitly null) and satisfies the regex contract.
- **Files modified:** `server/reporting/internal/webhook-payload.ts`
- **Verification:** `grep -q "preflight?:" server/reporting/internal/webhook-payload.ts` succeeds; all 6 spec assertions still green (the test uses `.toBeNull()` which passes for both `null` and missing keys via the test fixtures setting them explicitly).
- **Committed in:** a9896ae (Task 1 GREEN commit)

**Total deviations:** 1 auto-fixed (plan-contract regex mismatch). No scope creep.

## Authentication Gates

The Task 2 checkpoint (`checkpoint:human-verify`) requires a real GitHub App + sandbox repo + ngrok-exposed server. In the autonomous chain (`_auto_chain_active: true`), human-verify checkpoints are auto-approved with the actual verification recorded as a deferred operator task (DEFERRED-37-K). No interactive auth was attempted.

## Issues Encountered

- **No live GitHub App available in autonomous chain:** Per the plan's intent, this is the only Phase 37 surface that genuinely requires manual interaction with an external service. The runbook `docs/runbooks/github-integration.md` documents the operator flow; algorithmic tests cover the rest.
- **Pre-existing TypeScript errors in unrelated files** (24 baseline tsc errors from DEFERRED-15-A) and pre-existing semgrep warnings (`DEFERRED-37-L` artifact-download stream, `DEFERRED-37-M` `buildWSURL`) are all unchanged by this plan. Logged in deferred-items.md.
- **`server/reporting/internal/module.ts` not edited:** The existing job.completed subscriber still builds its own inline body. The new `webhook-payload.ts` is exported + tested in isolation; wiring it into the subscriber is a single-line replacement (`const body = await buildWebhookPayload(deps, job, 'job.completed')`) that can land in a Phase 27+ follow-up when the analysis/preflight modules' lifecycles are also wired through reporting deps. This is a conscious scope boundary — the plan's must-have-truths require the FIELD SURFACE (which is shipped + tested), not the live subscriber rewrite.

## User Setup Required

None for Plan 37-05 itself. Operators wanting to consume the new webhook fields should:
- Ensure `analysisModule` and `preflightModule` are wired into the reporting plugin's deps (follow-up; not in scope for this plan)
- Update downstream webhook consumers to optionally read `payload.preflight`, `payload.analysis`, `payload.parallelDeploy`

For the EXT-GITHUB-PR sandbox round-trip, see `docs/runbooks/github-integration.md`.

## Next Phase Readiness

**Phase 37 CLOSED. v3.0 milestone PROVISIONALLY COMPLETE.**

Next steps (post-v3.0):
- Milestone retrospective pass (compare against v3.0 ROADMAP success criteria)
- DEFERRED-37-A (Android preflight rules) — high-value v3.1 starter
- Operator first-deploy verifications (DEFERRED-37-K + SIM-PRIV-01 + AND-GRPC-INSTALL)
- Reporting plugin wiring of `analysisModule` + `preflightModule` deps to activate the new webhook fields in production

## Self-Check: PASSED

All claimed files exist on disk; all 3 task commits exist in git log.

- `server/reporting/internal/webhook-payload.ts`: FOUND
- `server/reporting/__tests__/webhook-payload.spec.ts`: FOUND
- `server/jobs/MODULE.md` (Phase 37 additions): FOUND
- `server/analysis/MODULE.md` (Phase 37 deferrals): FOUND
- `server/preflight/MODULE.md` (Phase 37 deferrals): FOUND
- `server/integrations/github/MODULE.md` (Phase 37 deferrals): FOUND
- `.planning/STATE.md` (Phase 37 closed roll-up): FOUND
- `.planning/ROADMAP.md` (Phase 37 row Complete): FOUND
- `.planning/REQUIREMENTS.md` (EXT-* IDs out-of-band): FOUND
- `.planning/phases/37-platform-extensions/37-VALIDATION.md` (nyquist_compliant true): FOUND
- `.planning/phases/37-platform-extensions/deferred-items.md` (13 DEFERRED-37 entries): FOUND
- Commit `d8c1f35`: FOUND (Task 1 RED)
- Commit `a9896ae`: FOUND (Task 1 GREEN)
- Commit `6df1783`: FOUND (Task 3 docs)

---
*Phase: 37-platform-extensions*
*Completed: 2026-05-16*
*v3.0 milestone: PROVISIONALLY COMPLETE*
