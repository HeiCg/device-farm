---
phase: 15-fix-operational-dependencies
plan: 08
subsystem: docs
tags: [adr, nygard, architecture, documentation, spec-driven, event-driven]

# Dependency graph
requires:
  - phase: 15-00
    provides: "Locked v3.0 pillars in CONTEXT.md (Zod / typed bus / pg-boss / correlation IDs / LLM-first modules) plus EVENTS-05 sync-vs-queue rule"
provides:
  - "docs/adr/ directory seeded with Nygard convention + Index table"
  - "NNN-slug.md filename convention locked (zero-padded 3-digit)"
  - "ADR-001 canonical 'why' reference for v3.0 architecture (Nygard format)"
  - "EVENTS-05 sync-bus-vs-queue rule committed in durable, LLM-readable form"
  - "Reserved number 002 for the Phase 16 file-naming ADR"
affects:
  - "Phase 16 Pilot — hooks (ADR-002 file-naming will land there)"
  - "Phase 17 Contracts Pipeline (codegen decisions cite ADR-001)"
  - "Phase 18 Lifecycle Migration (node-cron → pg-boss cites ADR-001)"
  - "Phase 23 Jobs Keystone (saga + singletonKey + drain cites ADR-001)"
  - "Phase 27 API Aggregator (GET /api/events trace tree cites ADR-001)"
  - "Every subsequent v3.0 phase (ADR-001 is the canonical why-doc)"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Michael Nygard ADR format (Status / Context / Decision / Consequences)"
    - "Append-only ADR policy (supersede rather than edit)"
    - "NNN-slug.md filename convention for architecture decision records"

key-files:
  created:
    - "docs/adr/README.md"
    - "docs/adr/001-spec-driven-architecture.md"
  modified: []

key-decisions:
  - "ADRs live at docs/adr/ with NNN-slug.md filename convention (zero-padded 3-digit)"
  - "Michael Nygard format is canonical: Status / Context / Decision / Consequences H2 sections in order"
  - "ADRs are append-only: supersede rather than edit (preserves decision history for LLM traceability)"
  - "Number 002 reserved for Phase 16 file-naming ADR; 003+ assigned on write"
  - "EVENTS-05 sync-vs-queue rule documented verbatim inside ADR-001 Decision → Pillar 3 section"
  - "All five v3.0 pillars (Zod boundaries / typed bus / pg-boss v12 / correlation + events table / LLM-first modules) locked in ADR-001 Decision section with ≥150 words each"
  - "Constraints locked in Consequences section apply to every subsequent v3.0 phase (noun.verbed names, passthrough envelopes, v: z.literal(1), retryLimit:1 + singletonKey on physical side-effects, 30s shutdown budget, Node 22.12+)"

patterns-established:
  - "ADR as durable LLM-readable decision record: future phases cite ADR-001 for 'why' answers without reading the source tree"
  - "Dense single-paragraph prose broken into shorter paragraphs with H3 subsection headers inside Decision — readability for LLMs and humans without padding"
  - "Version pins and phase-by-title references in ADR prose (pg-boss v12, @fastify/request-context v6, Zod 4, drizzle-orm ^0.45.1; Phase 17 Contracts Pipeline & Ops Hygiene, Phase 23 Jobs Module Keystone, ...)"

requirements-completed: [MOD-10]

# Metrics
duration: 5min
completed: 2026-04-17
---

# Phase 15 Plan 08: ADR-001 + docs/adr/ Seed Summary

**Seeded `docs/adr/` with Nygard convention and authored the 137-line ADR-001 that canonicalises v3.0's five pillars, the EVENTS-05 sync-bus-vs-queue rule verbatim, and every constraint that binds subsequent phases.**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-04-17T15:48:52Z
- **Completed:** 2026-04-17T15:53:57Z
- **Tasks:** 2/2 completed
- **Files created:** 2 (`docs/adr/README.md`, `docs/adr/001-spec-driven-architecture.md`)
- **Files modified:** 0

## Accomplishments

- Created `docs/adr/` directory (did not exist before this plan).
- Wrote `docs/adr/README.md` (22 lines): Nygard convention + `NNN-slug.md` filename pattern + Index table with ADR-001 row + reserved number 002 for Phase 16 + explicit append-only policy.
- Wrote `docs/adr/001-spec-driven-architecture.md` (137 lines): four Nygard H2 sections — `## Status`, `## Context`, `## Decision`, `## Consequences`. Decision section subdivided with H3 headers for each of the five pillars (Zod boundaries / typed bus / pg-boss v12 / correlation + events table / LLM-first modules).
- EVENTS-05 sync-bus-vs-queue rule documented verbatim ("sync bus = same request / cache / WS broadcast; pg-boss queue = anything that retries, survives crash, or calls external") inside Pillar 3.
- Both custom lint rules cited by name: `no-direct-bus-emit` and `no-imperative-event-names`.
- Library versions pinned in prose: pg-boss v12, `@fastify/request-context` v6, Zod 4, drizzle-orm ^0.45.1, Node 22.12+.
- Future phases referenced by ROADMAP title: Phase 16 Pilot, Phase 17 Contracts Pipeline & Ops Hygiene, Phase 18 Lifecycle Migration, Phase 23 Jobs Module Keystone, Phase 25 Pipelines Module, Phase 27 API Aggregator & Events API, Phase 30 Test Migration Cleanup.
- Out-of-scope explicitly listed: OpenTelemetry, full event sourcing, multi-node pg-boss, SSO, late-starting subscribers / event replay.

## Task Commits

Each task committed atomically:

1. **Task 8.1: Create docs/adr/README.md index** — `1a9e3f5` (docs)
2. **Task 8.2: Author ADR-001 Spec-Driven Architecture** — `49909fb` (docs)

_No TDD tasks; ADR authoring is a documentation workflow._

## Files Created/Modified

- `docs/adr/README.md` (created, 22 lines) — ADR index + Nygard convention + `NNN-slug.md` pattern + reserved numbers.
- `docs/adr/001-spec-driven-architecture.md` (created, 137 lines) — v3.0 spec + event driven architecture ADR in Nygard format.

## Decisions Made

- **Paragraph structure inside Decision section.** The plan required each section be at least 150 words of "real prose (not just bullet dumps)". The initial draft collapsed each pillar into a single dense paragraph, which pushed the total line count to 66 — below the 100-line acceptance floor. Rewrote with (a) H3 subsection per pillar and (b) paragraph breaks inside each pillar at natural topic shifts. Final file hits 137 lines (in the 100-400 band) without padding fluff; word counts per section are Context ~450, Decision ~900, Consequences ~700.
- **EVENTS-05 rendered as a blockquote.** The sync-vs-queue rule is the load-bearing operational heuristic for every future phase; rendering it as a Markdown blockquote inside Pillar 3 makes it the most visually prominent claim in the file, and the plan's grep `sync bus = same request` still matches because the quoted rule contains that exact substring.
- **H3 subsections inside Decision.** Nygard format specifies top-level Status / Context / Decision / Consequences H2 sections; this is preserved. Adding H3 subsections under Decision (one per pillar) is compatible with Nygard (he allows free-form structure inside sections) and makes the five pillars individually scannable.

## Deviations from Plan

None — plan executed exactly as written. Both acceptance-criteria blocks passed on first-author for the README; the ADR passed grep/section checks on first author, and the only post-write change was line-count expansion by restructuring dense paragraphs (not a deviation, just meeting the stated `wc -l 100-400` acceptance criterion).

## Issues Encountered

None.

## Content Areas: Quoted vs Paraphrased from CONTEXT.md

**Quoted verbatim:**
- EVENTS-05 sync-bus-vs-queue rule (Pillar 3 blockquote).
- Nygard section order (Status / Context / Decision / Consequences).
- Graceful-shutdown 30s timeout (from 15-CONTEXT.md decisions block; Plan 15-05 spike value 4032 ms added for concreteness).
- Plugin-registration facts about `jobService.executeJob` reaching into other services (from CONTEXT.md code-context section).
- Five-pillar phrasing matches CONTEXT.md + PROJECT.md pillars verbatim.

**Paraphrased / expanded:**
- Context narrative: CONTEXT.md lists specific pain points as bullets; ADR-001 reshapes them into three paragraphs (platform-works / cross-module-mess / team-is-one-plus-LLMs).
- Pillar prose: each pillar expanded from CONTEXT.md's terse bullet ("Zod at all boundaries") into a 150-200 word paragraph that names the concrete files and lint rules.
- Consequences → Constraints locked: derived from 15-RESEARCH §11 outline + CONTEXT.md decisions block; added version pins (`drizzle-orm ^0.45.1`, Node 22.12+) and the lint-rule allowlist (`**/events.ts`, `**/*.spec.ts`, `**/*.test.ts`) from Plan 15-04 + 15-05 summaries.
- Out-of-scope: pulled from PROJECT.md "Out of Scope" table and REQUIREMENTS.md `## Out of Scope` section.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- **Phase 15 Plans 15-06 / 15-07 / 15-09 unblocked.** ADR-001 existence is independent of them; nothing downstream in Phase 15 waited on this plan.
- **Future phases can cite ADR-001 by filename.** Plan 15-09 Nyquist baseline doc can link to `docs/adr/001-spec-driven-architecture.md` from its own text; Phase 16 pilot ADR (ADR-002 file-naming) has a clean Index slot reserved.
- **No blockers for Phase 16.** The `hooks` pilot plan will cite ADR-001 as the canonical "why" reference and land ADR-002 file-naming alongside.

## Self-Check: PASSED

Verified files and commits exist:
- `docs/adr/README.md` — FOUND
- `docs/adr/001-spec-driven-architecture.md` — FOUND
- Commit `1a9e3f5` (Task 8.1) — FOUND in `git log`
- Commit `49909fb` (Task 8.2) — FOUND in `git log`
- All four Nygard H2 sections present (`grep -c "^## "` returns 4)
- EVENTS-05 verbatim substring present (`grep "sync bus = same request"`)
- Line count 137 (in 100-400 acceptance band)
- README references Michael Nygard, `NNN-slug.md`, reserves 002, has `| 001 |` row

---
*Phase: 15-fix-operational-dependencies*
*Plan: 08*
*Completed: 2026-04-17*
