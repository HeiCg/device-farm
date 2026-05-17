# Phase 37: Platform Extensions - Context

**Gathered:** 2026-05-15
**Status:** Ready for planning
**Source:** Pre-authored brief at `37-BRIEF.md` + cloned reference repos

<domain>
## Phase Boundary

Four independent feature drops closing v3.0:
1. iOS static skeleton extraction (ObjC classlist + Swift5 types + Hermes scan from .ipa)
2. App Store preflight scanning (PrivacyInfo + minimum OS + entitlements)
3. GitHub PR comment integration mirroring existing Azure DevOps path
4. Parallel patterns: InputBroadcaster (fan-out tap to N devices) + Build-Once-Deploy-N

</domain>

<decisions>
## Implementation Decisions

### External Dependencies Policy (LOCKED)
**Reference repos are STUDY-ONLY.** app-explorer (iOS skeleton), mobile-devtools (Greenlight + PR Review Bot), kittyfarm (InputCoordinator + BuildPlayRunner) at `/Users/heicg/Desktop/projects/_reference/` are read-only references — copy ideas/algorithms/data structures into `device-farm/server` and `device-farm/web`; never add them as deps. Normal libs (GitHub App SDK, plist parsers, ipa-extract tooling we choose) remain fine.

### Authoritative Sources (LOCKED)
- `37-BRIEF.md` — 4-track task list, success criteria per track
- `/Users/heicg/Desktop/projects/_reference/app-explorer/` — iOS skeleton extraction code
- `/Users/heicg/Desktop/projects/_reference/mobile-devtools/` — Greenlight (preflight) + PR Review Bot
- `/Users/heicg/Desktop/projects/_reference/kittyfarm/KittyFarm/Input/InputCoordinator.swift` — fan-out pattern
- `/Users/heicg/Desktop/projects/_reference/kittyfarm/KittyFarm/Lifecycle/BuildPlayRunner.swift` — Build-Once-Deploy-N pattern

### Architecture per track

**Track A — iOS Skeleton**
- New `server/analysis/ipa-skeleton.ts` — extract classes/types from `.ipa`
- CLI: `device-farm analyze sample.ipa`
- Web: `/builds/[id]/skeleton` page

**Track B — Preflight**
- New module `server/preflight/` — Greenlight rules
- REST: `POST /api/preflight` accepts `.ipa` or `.apk`
- UI: red/yellow/green checklist

**Track C — GitHub PR**
- New plugin `server/integrations/github/` — GitHub App webhook + comment poster
- HMAC verification on webhooks
- CLI flag: `device-farm run --github-pr <num>` posts comment with screenshots; edits on subsequent runs

**Track D — Parallel patterns**
- `server/jobs/internal/input-broadcaster.ts` — fan-out tap/key to N device sessions
- `server/jobs/internal/build-once-deploy-n.ts` — build artifact once, install on N devices

### Tasks (from brief)
The brief outlines tracks rather than enumerated T-37.x. Planner should produce 4 sub-track plans (one per track, plus close-out).

### Claude's Discretion
- iOS skeleton tooling (port kittyfarm? use class-dump-tng?)
- Greenlight rule set (start with brief's known-bad fixtures)
- GitHub App vs personal access token (App is correct for production)
- Whether all 4 tracks land in parallel waves or sequentially

</decisions>

<canonical_refs>
## Canonical References

### Reference implementations
- `/Users/heicg/Desktop/projects/_reference/app-explorer/` (iOS skeleton extraction)
- `/Users/heicg/Desktop/projects/_reference/mobile-devtools/README.md` (Greenlight + PR bot)
- `/Users/heicg/Desktop/projects/_reference/kittyfarm/KittyFarm/Input/InputCoordinator.swift`
- `/Users/heicg/Desktop/projects/_reference/kittyfarm/KittyFarm/Lifecycle/BuildPlayRunner.swift`

### Existing local code
- `server/integrations/` (if exists — sibling for github plugin)
- Phase 24 Maestro module — execution context tracks 4 may consume
- Phase 34 sessions — InputBroadcaster fan-out uses sessions

### Phase brief
- `.planning/phases/37-platform-extensions/37-BRIEF.md`

</canonical_refs>

<specifics>
## Specific Ideas

- 4 tracks ship as 4 independent plans/waves — each can be reviewed standalone
- GitHub App: mirror Azure DevOps integration's HMAC verification approach exactly
- iOS skeleton: start with classlist+Swift5; defer Hermes to a follow-up if scope tight

</specifics>

<deferred>
## Deferred Ideas

- Bitcode-based deeper analysis (post-Apple-deprecation, may not be feasible)
- GitLab MR equivalent (mirror Azure path for now; add later)
- Cross-platform skeleton (Android dex) — separate feature

</deferred>

---

*Phase: 37-platform-extensions*
*Context gathered: 2026-05-15 via brief-derived smart discuss*
