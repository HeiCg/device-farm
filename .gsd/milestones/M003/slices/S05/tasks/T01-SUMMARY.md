---
id: T01
parent: S05
milestone: M003
provides:
  - MaestroOptions type and extractMaestroOptions helper for defensive metadata extraction
  - MaestroOptionsPanel component rendering Maestro execution options as a styled card
  - Job detail page integration between header and tabs
key_files:
  - web/src/lib/api/types.ts
  - web/src/lib/components/jobs/MaestroOptionsPanel.svelte
  - web/src/routes/jobs/[id]/+page.svelte
key_decisions:
  - Used static Record lookups for tag pill classes (D016 compliance)
  - Structured row data via buildRows() helper with OptionRow interface for clean conditional rendering
patterns_established:
  - extractMaestroOptions returns null for empty metadata — component guards with {#if options} for zero-DOM rendering
  - Tag pill classes use Record<string, string> with named keys (pill, enabled) not dynamic interpolation
observability_surfaces:
  - MaestroOptionsPanel DOM presence/absence directly reflects extractMaestroOptions return value — inspect job.metadata via GET /api/jobs/:id
duration: 12m
verification_result: passed
completed_at: 2026-03-19
blocker_discovered: false
---

# T01: Build MaestroOptionsPanel and wire into job detail

**Added MaestroOptions type extraction from job.metadata and MaestroOptionsPanel component with tag pills, format badge, debug flag, and shard count — wired into job detail page between header and tabs**

## What Happened

Added three pieces: (1) `MaestroOptions` interface and `extractMaestroOptions()` pure function to `types.ts` — defensively extracts `includeTags`, `excludeTags`, `reportFormat`, `debugOutput`, `shards` from the job's `metadata` jsonb field using explicit type guards, returning null when no Maestro keys are populated. (2) `MaestroOptionsPanel.svelte` — a glass card component following MetricsPanel's border-l-2/bg-surface-container-low/high pattern. Uses a `buildRows()` helper that produces an `OptionRow[]` data structure for clean conditional rendering. Include tags render as `bg-secondary/10 text-secondary` pills, exclude tags as `bg-tertiary/10 text-tertiary` pills, debug flag as a `bg-primary/10 text-primary` chip, and format/shards as mono text. All class strings live in static Record lookups per D016. (3) Wired the panel into `+page.svelte` with a `$derived` variable for reactive extraction and rendered it between the header and tabs sections.

## Verification

- `svelte-check`: 14 errors and 9 warnings — all pre-existing in `Nav.svelte` and home `+page.svelte`, zero in files touched by this task.
- `web:build`: Completed successfully via `npm run web:build` — both SSR and client bundles built, adapter-static wrote site to `build/`.
- `npm test`: All 33 test files, 311 tests passed — zero regressions.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `cd web && npx svelte-check --tsconfig ./tsconfig.json` | 1 | ✅ pass (0 new errors — 14 pre-existing in unrelated files) | 3.4s |
| 2 | `npm run web:build` | 0 | ✅ pass | 11.4s |
| 3 | `npm test` | 0 | ✅ pass (311/311 tests) | 9.1s |

## Diagnostics

- **Inspect panel presence:** On any job detail page, look for a card with "Maestro Options" heading between header and tabs. If absent, `extractMaestroOptions(job.metadata)` returned null — verify metadata via `GET /api/jobs/:id`.
- **Inspect extraction logic:** `extractMaestroOptions()` is a pure function — can be tested by passing any `Record<string, unknown>` value.
- **No backend changes:** This task is UI-only; no new API endpoints, logs, or server-side observability.

## Deviations

None — implemented exactly as planned.

## Known Issues

- Pre-existing: `svelte-check` reports 14 TS errors in `Nav.svelte` and home `+page.svelte` related to `HealthResponse` type narrowing — unrelated to this task.

## Files Created/Modified

- `web/src/lib/api/types.ts` — Added `MaestroOptions` interface and `extractMaestroOptions()` function
- `web/src/lib/components/jobs/MaestroOptionsPanel.svelte` — New component: glass card rendering Maestro execution options
- `web/src/routes/jobs/[id]/+page.svelte` — Added MaestroOptionsPanel import, $derived extraction, and rendering between header and tabs
