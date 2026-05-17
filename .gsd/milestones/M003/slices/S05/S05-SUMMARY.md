---
id: S05
parent: M003
milestone: M003
provides:
  - MaestroOptions type and extractMaestroOptions() defensive extractor for job.metadata
  - MaestroOptionsPanel component — glass card showing tags, format, debug flag, shards
  - DebugArtifacts component — responsive thumbnail grid with lightbox modal for per-step screenshots
  - Debug tab in job detail page, conditionally shown when screenshot artifacts exist
requires:
  - slice: none
    provides: none
affects:
  - none (last slice in M003)
key_files:
  - web/src/lib/api/types.ts
  - web/src/lib/components/jobs/MaestroOptionsPanel.svelte
  - web/src/lib/components/jobs/DebugArtifacts.svelte
  - web/src/routes/jobs/[id]/+page.svelte
key_decisions:
  - Static Record lookups for tag pill classes (D016 compliance) — include tags green, exclude tags red, debug flag purple
  - Structured buildRows() helper with OptionRow interface for clean conditional rendering in MaestroOptionsPanel
  - Button elements for thumbnails (not bare divs) for keyboard accessibility
  - Lightbox modal with svelte:window onkeydown for Escape/ArrowLeft/ArrowRight navigation
patterns_established:
  - extractMaestroOptions returns null for empty metadata — component guards with {#if options} for zero-DOM rendering
  - Lightbox modal pattern: fixed overlay with backdrop click-to-close, role="dialog" aria-modal="true", keyboard nav via svelte:window onkeydown
  - Screenshot entry mapping: derive sorted array of { artifact, stepIndex, src } from raw artifacts for ordered grid rendering
observability_surfaces:
  - MaestroOptionsPanel presence/absence directly reflects extractMaestroOptions return value — inspect job.metadata via GET /api/jobs/:id
  - Debug tab visibility controlled by artifacts.some(a => a.type === 'screenshot') — inspect GET /api/jobs/:id/artifacts
  - Thumbnail loading failures visible as 404/500 in browser Network tab on /api/jobs/{jobId}/artifacts/{artifactId}
drill_down_paths:
  - .gsd/milestones/M003/slices/S05/tasks/T01-SUMMARY.md
  - .gsd/milestones/M003/slices/S05/tasks/T02-SUMMARY.md
duration: 27m
verification_result: passed
completed_at: 2026-03-19
---

# S05: Maestro Options & Debug Artifacts

**Job detail page now displays Maestro execution options (tags, format, debug flag, shards) in a styled metadata card and a conditional Debug tab with per-step screenshot thumbnails and lightbox viewer**

## What Happened

Two tasks delivered the complete slice:

**T01** added the `MaestroOptions` interface and `extractMaestroOptions()` pure function to `types.ts`. The extractor defensively reads `includeTags`, `excludeTags`, `reportFormat`, `debugOutput`, and `shards` from the job's `metadata` jsonb field with explicit type guards, returning null when no Maestro keys are populated. `MaestroOptionsPanel.svelte` renders a glass card (border-l-2/bg-surface-container-low pattern matching existing MetricsPanel) with a `buildRows()` helper that produces `OptionRow[]` for clean conditional rendering. Include tags show as green pills (`bg-secondary/10`), exclude tags as red pills (`bg-tertiary/10`), debug flag as a purple chip (`bg-primary/10`), and format/shards as mono text. All class strings use static Record lookups per D016. The panel is wired into the job detail page between the header and tabs via `$derived(() => extractMaestroOptions(job?.metadata ?? null))`.

**T02** created `DebugArtifacts.svelte` — filters artifacts to `type === 'screenshot'`, parses step index from `step-N.png` filenames via regex (fallback to 0), sorts ascending, and renders a responsive grid (2→3→4→5 columns at breakpoints). Each thumbnail is a `<button>` card with aspect-video image, hover overlay with zoom icon, and "Step N" label. Clicking opens a lightbox modal with dark overlay (bg-black/85), full-size constrained image, top bar with step label/filename/counter/close button, and left/right arrow navigation. Keyboard support via `svelte:window onkeydown`: Escape closes, ArrowLeft/ArrowRight navigate. Empty state shows a message with photo_library icon. The job detail page gained an extended `activeTab` union (added `'debug'`), a derived `hasScreenshots` flag, and a conditional Debug tab button with bug_report icon.

## Verification

| # | Check | Result |
|---|-------|--------|
| 1 | `svelte-check` — zero errors in S05 files | ✅ 14 pre-existing errors (Nav.svelte, root +page.svelte), zero in touched files |
| 2 | `npm run web:build` — clean build | ✅ 504 client modules, adapter-static wrote to build/ |
| 3 | `npm test` — all tests pass | ✅ 311 tests, 33 files, zero failures |

## Requirements Advanced

- R042 — MaestroOptionsPanel reads and displays all 5 Maestro option keys (includeTags, excludeTags, reportFormat, debugOutput, shards) from job.metadata. Panel hides when no options are present.
- R043 — DebugArtifacts component renders per-step debug screenshots in a navigable thumbnail grid with lightbox. Debug tab appears only when screenshot artifacts exist for the job.

## Requirements Validated

- none — R042 and R043 require live runtime validation (job with Maestro metadata and debug screenshots) to move to validated status

## New Requirements Surfaced

- none

## Requirements Invalidated or Re-scoped

- none

## Deviations

- T02 added `tabindex="-1"` and `onkeydown` directly on the lightbox dialog div (plus `svelte-ignore` comments) to satisfy Svelte a11y linter warnings. The planned `svelte:window onkeydown` is retained as the primary handler; the dialog-level handler is redundant but keeps the linter clean.

## Known Limitations

- R042/R043 are advanced but not validated — no jobs with Maestro metadata or debug screenshot artifacts exist in the dev environment. The components render correctly against the type contracts but haven't been tested with live data.
- Pre-existing: 14 svelte-check type errors in Nav.svelte and root +page.svelte related to HealthResponse type narrowing. Not introduced by this slice.
- The `step-N.png` filename parsing assumes Maestro's debug output naming convention. If Maestro changes its filename format, the step index extraction will fall back to 0.

## Follow-ups

- none

## Files Created/Modified

- `web/src/lib/api/types.ts` — Added MaestroOptions interface and extractMaestroOptions() defensive extraction function
- `web/src/lib/components/jobs/MaestroOptionsPanel.svelte` — New component: glass card rendering Maestro execution options with tag pills, format badge, debug flag, shard count
- `web/src/lib/components/jobs/DebugArtifacts.svelte` — New component: responsive thumbnail grid with lightbox modal for per-step debug screenshots
- `web/src/routes/jobs/[id]/+page.svelte` — Added MaestroOptionsPanel/DebugArtifacts imports, extended activeTab union, added hasScreenshots derived, wired panel and Debug tab

## Forward Intelligence

### What the next slice should know
- This is the last slice in M003. All 5 slices are complete. The milestone is ready for final validation against its definition of done.
- The `extractMaestroOptions()` function is a pure function — downstream code can use it anywhere a job's metadata object is available, not just in the detail page.

### What's fragile
- `step-N.png` filename regex — Maestro's debug output naming is undocumented and could change between versions. If step indices show as 0 for all screenshots, check the filenames in the artifacts response.
- Pre-existing svelte-check errors (14 in Nav.svelte/root +page.svelte) — these are type narrowing issues with HealthResponse and should be fixed separately to avoid confusion in future slices.

### Authoritative diagnostics
- MaestroOptionsPanel visibility → `GET /api/jobs/:id` response `metadata` field — if panel is missing, the metadata has no Maestro keys
- Debug tab visibility → `GET /api/jobs/:id/artifacts` response — tab requires at least one artifact with `type: 'screenshot'`
- Thumbnail loading → browser Network tab, `/api/jobs/{jobId}/artifacts/{artifactId}` requests

### What assumptions changed
- The boundary map expected S05 might consume `maestro.ts` API client from S01 for a `fetchDebugArtifacts()` function — in practice, the existing artifacts endpoint (`GET /api/jobs/:id/artifacts`) already provides all needed data, so no new API client function was needed. The component filters artifacts client-side.
