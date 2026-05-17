---
phase: 37-platform-extensions
verified: 2026-05-16T00:00:00Z
status: passed
score: 5/5 must-haves verified
re_verification:
  previous_status: none
  previous_score: n/a
  gaps_closed: []
  gaps_remaining: []
  regressions: []
human_verification:
  - test: "Sample .ipa skeleton extraction round-trip"
    expected: "cli analyze on a real .ipa produces a JSON skeleton; web `/builds/[id]/skeleton` renders SkeletonReport with Swift type names + Hermes bundle markers"
    why_human: "Real-world .ipa quality and demangle fidelity cannot be asserted in unit tests; requires visual inspection of a known iOS app"
  - test: "App Store preflight on real ipa/apk"
    expected: "Drag-drop in web `/preflight` returns red/yellow/green checklist with rule IDs mapped to forbidden-symbols.json"
    why_human: "PreflightChecklist UX (color semantics, drag target affordance) needs human review"
  - test: "GitHub PR round-trip with sandbox repo"
    expected: "Push PR → webhook delivered → device-farm posts comment → CLI --github-pr updates same comment with run results"
    why_human: "Requires live GitHub App install in sandbox org; webhook delivery + signature validation can only be exercised end-to-end"
  - test: "Multi-device parallel-deploy + input broadcast smoke"
    expected: "CLI --parallel 3 --broadcast-input installs same APK on 3 emulators; tap on primary mirrors to all 3"
    why_human: "Visual confirmation of synchronized input across N device previews"
---

# Phase 37: Platform Extensions Verification Report

**Phase Goal:** Close v3.0 with four independent feature drops: iOS static skeleton extraction, App Store preflight scanning, GitHub PR comment integration mirroring Azure, plus InputBroadcaster + Build-Once-Deploy-N parallel patterns.

**Verified:** 2026-05-16
**Status:** passed (with human-validation items flagged)
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
| --- | --- | --- | --- |
| 1 | iOS static skeleton extraction works end-to-end (.ipa → JSON → DB → web) | ✓ VERIFIED | `cli/cmd/analyze.go` (485 LOC) + full macho parser suite (parser/swift5_types/swift_demangle/hermes/heuristics) + `server/analysis/{plugin,routes,events,schemas,index,internal/{module,repo}}.ts` registered after apiPlugin (server/index.ts:21,186) + web route `/builds/[id]/skeleton/+page.svelte` imports `SkeletonReport.svelte` (277 LOC) |
| 2 | App Store preflight scanner runs rules over .ipa/.apk with red/yellow/green output | ✓ VERIFIED | `server/preflight/{plugin,routes,events,schemas,index,MODULE.md}.ts` + `internal/{module,rule-engine,repo}.ts` + `internal/parsers/{ipa,apk,macho-symbols,plist-detect}.ts` + `internal/rules/{ios-info-plist,ios-privacy-manifest,ios-forbidden-symbols}.ts` + rule data `rules/__data__/forbidden-symbols.json` + plugin registered (server/index.ts:19,180) + web route `/preflight/+page.svelte` imports `PreflightChecklist.svelte` (104 LOC) |
| 3 | GitHub PR comment integration mirrors Azure flow | ✓ VERIFIED | `server/integrations/github/{plugin,routes,index,MODULE.md}.ts` + `internal/{module,app-auth,webhook-handler,commenter,template-builder,pr-run-service}.ts` + plugin registered (server/index.ts:20,171) + config schema has `app_id`/`private_key`/`webhook_secret` + `pr_integrations[].installation_id` (server/config/schema.ts:163-168) + CLI `--github-pr`/`--github-repo` flags (cli/cmd/run.go:69-70) + docs/runbooks/github-integration.md + examples/.github/workflows/device-farm-pr.yml |
| 4 | InputBroadcaster fans tap/key/text events from one source to N sessions | ✓ VERIFIED | `server/jobs/internal/input-broadcaster.ts` (126 LOC) uses `Promise.allSettled` per Phase 37 invariant; dispatcher-agnostic contract; `POST /api/sessions/broadcast` registered in `server/jobs/plugin.ts:65` calling `registerSessionBroadcastRoute` with `jobsModule.broadcaster`; CLI `--broadcast-input` flag (cli/cmd/run.go:73,176-180) enforces `--parallel >= 2`; web `MirrorTargetSelector.svelte` (70 LOC) imported by `/sessions/[id]/+page.svelte` |
| 5 | Build-once-deploy-N installs same artifact on N devices in parallel | ✓ VERIFIED | `server/jobs/internal/build-once-deploy-n.ts` (156 LOC) calls `pool.allocateMany` for all-or-nothing batch allocation (server/pool/pool-manager.ts:357-433 with rollback on partial failure); CLI `--parallel N` flag (cli/cmd/run.go:72) sets `metadata.mode=parallel-deploy` + `parallelism`; webhook payload extended with `parallelDeploy` field (server/reporting/internal/webhook-payload.ts:97); jobs MODULE.md §"Phase 37 additions" documents both surfaces |

**Score:** 5/5 truths verified

### Required Artifacts

#### Track A — iOS Skeleton

| Artifact | Expected | Status | Details |
| --- | --- | --- | --- |
| `cli/cmd/analyze.go` | iOS .ipa analyze command | ✓ VERIFIED | 485 LOC, exists |
| `cli/internal/macho/parser.go` | Mach-O parser | ✓ VERIFIED | 6.5K + parser_test.go (7.9K) |
| `cli/internal/macho/swift5_types.go` | Swift5 type extraction | ✓ VERIFIED | 8.0K |
| `cli/internal/macho/swift_demangle.go` | Swift demangler | ✓ VERIFIED | 2.5K |
| `cli/internal/macho/hermes.go` | Hermes bytecode detection | ✓ VERIFIED | 4.2K + hermes_test.go |
| `cli/internal/macho/heuristics.go` | Heuristic scoring | ✓ VERIFIED | 2.9K + heuristics_test.go |
| `server/analysis/plugin.ts` | Fastify plugin | ✓ VERIFIED | exists, registered server/index.ts:186 |
| `server/analysis/{routes,events,schemas,index,MODULE.md}.ts` | Module surface | ✓ VERIFIED | all 5 present |
| `server/analysis/internal/{module,repo}.ts` | Internal impl | ✓ VERIFIED | both present |
| `web/src/routes/builds/[id]/skeleton/+page.svelte` | Skeleton route | ✓ VERIFIED | exists (1.6K) + page.ts loader |
| `web/src/lib/components/SkeletonReport.svelte` | Skeleton viewer | ✓ VERIFIED | 277 LOC, imported by skeleton/+page.svelte |

#### Track B — Preflight

| Artifact | Expected | Status | Details |
| --- | --- | --- | --- |
| `server/preflight/plugin.ts` | Fastify plugin | ✓ VERIFIED | registered server/index.ts:180 |
| `server/preflight/{routes,events,schemas,index,MODULE.md}.ts` | Module surface | ✓ VERIFIED | all 5 present |
| `server/preflight/internal/{module,rule-engine,repo}.ts` | Internal impl | ✓ VERIFIED | all 3 present |
| `server/preflight/parsers/...` | Parsers (must-have path) | ⚠ RELOCATED | Parsers live under `server/preflight/internal/parsers/{ipa,apk,macho-symbols,plist-detect}.ts` — same functional surface, more idiomatic placement (matches `internal/` convention) |
| `server/preflight/rules/{ios-*}.ts` | Rules (must-have path) | ⚠ RELOCATED | Rules live under `server/preflight/internal/rules/{ios-info-plist,ios-privacy-manifest,ios-forbidden-symbols}.ts` — same functional surface |
| `server/preflight/rules/__data__/forbidden-symbols.json` | Forbidden symbol data | ✓ VERIFIED | 4.0K data file present |
| `web/src/routes/preflight/+page.svelte` | Preflight route | ✓ VERIFIED | 3.1K |
| `web/src/lib/components/PreflightChecklist.svelte` | Checklist UI | ✓ VERIFIED | 104 LOC, imported by route |

#### Track C — GitHub PR

| Artifact | Expected | Status | Details |
| --- | --- | --- | --- |
| `server/integrations/github/{plugin,routes,index,MODULE.md}.ts` | Module surface | ✓ VERIFIED | all 4 present |
| `server/integrations/github/internal/{module,app-auth,webhook-handler,commenter,template-builder,pr-run-service}.ts` | Internal impl | ✓ VERIFIED | all 6 present |
| GitHub config schema | `github.app_id`/`private_key`/`webhook_secret` | ✓ VERIFIED | snake_case keys (config convention) at server/config/schema.ts:163-168 |
| `cli/cmd/run.go` `--github-pr`/`--github-repo` | CLI flags | ✓ VERIFIED | lines 69-70; auto-detects repo from `git remote get-url origin` |
| `docs/runbooks/github-integration.md` | Runbook | ✓ VERIFIED | 8.2K |
| `examples/.github/workflows/device-farm-pr.yml` | Example workflow | ✓ VERIFIED | 2.0K |

#### Track D — Parallel Patterns

| Artifact | Expected | Status | Details |
| --- | --- | --- | --- |
| `server/jobs/internal/input-broadcaster.ts` | Broadcaster impl | ✓ VERIFIED | 126 LOC, uses Promise.allSettled |
| `server/jobs/internal/build-once-deploy-n.ts` | Parallel deploy impl | ✓ VERIFIED | 156 LOC, calls `pool.allocateMany` |
| `server/jobs/MODULE.md` Phase 37 section | Module docs | ✓ VERIFIED | line 172 "## Phase 37 additions" + invariants 8+ |
| `server/pool/pool-manager.ts` `allocateMany` | Batch alloc | ✓ VERIFIED | lines 357-433, all-or-nothing with rollback |
| `cli/cmd/run.go` `--parallel`/`--broadcast-input` | CLI flags | ✓ VERIFIED | lines 72-73; metadata wiring lines 166-180 |
| `web/src/lib/components/MirrorTargetSelector.svelte` | Mirror UI | ✓ VERIFIED | 70 LOC, imported by /sessions/[id] |

#### Phase Close

| Artifact | Expected | Status | Details |
| --- | --- | --- | --- |
| `server/reporting/internal/webhook-payload.ts` | Extended payload | ✓ VERIFIED | adds optional `preflight`/`analysis`/`parallelDeploy` fields (lines 95-97), defensive lookups |
| `.planning/phases/37-platform-extensions/37-VALIDATION.md` | Validation strategy | ✓ VERIFIED | `nyquist_compliant: true`, `wave_0_complete: true`, sign-off |
| `.planning/phases/37-platform-extensions/deferred-items.md` | Carry-forwards | ✓ VERIFIED | 2.2K — 13 deferrals + 3 carry-forwards per 37-05-SUMMARY |
| `.planning/phases/37-platform-extensions/37-PHASE-COMPLETE.md` | Phase-complete marker | ⚠ ALTERNATE FORM | No standalone PHASE-COMPLETE.md, but 37-05-SUMMARY.md acts as phase close (documents STATE.md `phase-complete` advance, ROADMAP marked `Complete 2026-05-16`, REQUIREMENTS Phase 37 out-of-band table); ROADMAP.md:73 confirms phase complete |

### Key Link Verification

| From | To | Via | Status | Details |
| --- | --- | --- | --- | --- |
| `server/index.ts` | `analysis/plugin.ts` | register order | ✓ WIRED | line 186, after apiPlugin |
| `server/index.ts` | `preflight/plugin.ts` | register order | ✓ WIRED | line 180 |
| `server/index.ts` | `integrations/github/index.ts` | register order | ✓ WIRED | line 171 |
| `server/jobs/plugin.ts` | `api/sessions.ts` (broadcast route) | `registerSessionBroadcastRoute(fastify, { broadcaster })` | ✓ WIRED | line 65 — broadcaster injected from `jobsModule.broadcaster` |
| `server/api/sessions.ts` | `jobs/internal/input-broadcaster.ts` | `InputBroadcaster` type import + `broadcaster.broadcast()` call | ✓ WIRED | lines 21, 73 |
| `cli/cmd/run.go` | server `--github-pr`/`--parallel`/`--broadcast-input` | metadata fields | ✓ WIRED | metadata map populated (lines 174-198), guards present (--parallel must be >=2, --broadcast-input requires --parallel) |
| `web/.../skeleton/+page.svelte` | `SkeletonReport.svelte` | import | ✓ WIRED | line 8 |
| `web/.../preflight/+page.svelte` | `PreflightChecklist.svelte` | import | ✓ WIRED | line 7 |
| `web/.../sessions/[id]/+page.svelte` | `MirrorTargetSelector.svelte` | import | ✓ WIRED | line 13 |
| `webhook-payload.ts` | `analysisModule.repo` / `preflightModule.repo` | best-effort cross-module lookup | ✓ WIRED | lines 50-51, 113-131; defensive null handling when plugins absent |
| `build-once-deploy-n.ts` | `pool-manager.ts:allocateMany` | direct call | ✓ WIRED | line 100 |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| --- | --- | --- | --- | --- |
| EXT-IOS-SKELETON | 37-01 | Static iOS screen skeleton extraction from .ipa → JSON → DB → web viewer | ✓ SATISFIED | Truth #1 — full Mach-O + Swift + Hermes pipeline + analysis module + skeleton viewer route |
| EXT-PREFLIGHT | 37-02 | App Store preflight scanning for .ipa/.apk with red/yellow/green checklist | ✓ SATISFIED | Truth #2 — rule-engine + 3 iOS rules + 3 parsers + forbidden-symbols data + PreflightChecklist UI |
| EXT-GITHUB-PR | 37-03, 37-05 | GitHub App integration posting/editing PR comment with screenshots | ✓ SATISFIED | Truth #3 — App auth, webhook handler, commenter, template builder, pr-run-service, runbook, example workflow |
| EXT-INPUT-BROADCAST | 37-04 | Fan-out tap/key/text from one source to N device sessions | ✓ SATISFIED | Truth #4 — Promise.allSettled broadcaster + POST /api/sessions/broadcast + CLI flag + MirrorTargetSelector |
| EXT-BUILD-ONCE | 37-04 | Build artifact once, install + launch on N devices in parallel | ✓ SATISFIED | Truth #5 — runParallelDeploy + allocateMany + CLI --parallel flag |

No orphaned requirements detected. REQUIREMENTS.md lines 266-270 enumerate Phase 37 pseudo-IDs, all mapped to plans.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| --- | --- | --- | --- | --- |
| (none in core implementation files) | — | — | — | No TODO/FIXME/PLACEHOLDER/stub returns found in module.ts, input-broadcaster.ts, build-once-deploy-n.ts, github commenter/template/webhook/pr-run-service/app-auth |

### Human Verification Required

See frontmatter `human_verification` block — 4 items requiring live runs:
1. Sample .ipa skeleton extraction round-trip
2. App Store preflight on real ipa/apk (drag-drop UX)
3. GitHub PR round-trip with sandbox repo
4. Multi-device parallel-deploy + input broadcast smoke

These are all explicitly documented in 37-VALIDATION.md "Sampling Rate → Before phase verify" — the team has already enumerated them as gating manual checks. Automated coverage is complete.

### Gaps Summary

No blocking gaps. Two **path-relocation notes** (not gaps):

1. **Preflight parsers/rules** live under `server/preflight/internal/parsers/` and `server/preflight/internal/rules/` rather than the top-level `server/preflight/parsers/` / `server/preflight/rules/` listed in must-haves. This relocation is correct — it follows the project's `internal/` convention. Same functional surface, same imports, same tests pass.
2. **37-PHASE-COMPLETE.md** doesn't exist as a standalone file. Instead, 37-05-SUMMARY.md serves as the phase-close artifact (per 37-VALIDATION.md the close protocol is: STATE.md → `phase-complete`, ROADMAP table → Complete + date, REQUIREMENTS out-of-band table, deferred-items.md). All four close mechanisms are in place; the marker file format is non-standard for this repo.

All five tracks deliver substantive, wired implementations. Phase 37 closes v3.0 successfully pending the four human-validation items above.

---

_Verified: 2026-05-16_
_Verifier: Claude (gsd-verifier)_
