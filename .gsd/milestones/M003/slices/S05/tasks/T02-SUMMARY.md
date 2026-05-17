---
id: T02
parent: S05
milestone: M003
provides:
  - DebugArtifacts component with thumbnail grid and lightbox modal for per-step debug screenshots
  - Debug tab in job detail page, shown conditionally when screenshot artifacts exist
key_files:
  - web/src/lib/components/jobs/DebugArtifacts.svelte
  - web/src/routes/jobs/[id]/+page.svelte
key_decisions:
  - Used button elements for thumbnails (not bare divs) for keyboard accessibility
  - Lightbox uses svelte:window onkeydown for Escape/Arrow keys rather than $effect-based addEventListener
  - Step index parsed from fileName via regex /step-(\d+)/ with fallback to 0 for non-matching filenames
patterns_established:
  - Lightbox modal pattern: fixed overlay with backdrop click-to-close, role="dialog" aria-modal="true", tabindex="-1" for focus, and svelte-ignore comments for a11y linter
  - Screenshot entry mapping: derive sorted array of { artifact, stepIndex, src } from raw artifacts for ordered rendering
observability_surfaces:
  - Debug tab visibility controlled by artifacts.some(a => a.type === 'screenshot') — inspect /api/jobs/:id/artifacts if tab is missing
  - Thumbnail loading failures visible as 404/500 in browser Network tab on /api/jobs/{jobId}/artifacts/{artifactId}
  - Lightbox state via selectedIndex $state rune — inspect via Svelte DevTools if modal doesn't open/close
duration: 15m
verification_result: passed
completed_at: 2026-03-19
blocker_discovered: false
---

# T02: Build DebugArtifacts viewer and add Debug tab to job detail

**Created DebugArtifacts component with responsive thumbnail grid and lightbox modal, added conditional Debug tab to job detail page**

## What Happened

Created `DebugArtifacts.svelte` that filters artifacts to `type === 'screenshot'`, parses step index from `step-N.png` filenames, sorts ascending, and renders a responsive grid (2→3→4→5 columns at breakpoints). Each thumbnail is a `<button>` card with aspect-video image, hover overlay with zoom icon, and "Step N" label. Clicking opens a lightbox modal with dark overlay (bg-black/85), full-size constrained image, top bar with step label/filename/counter/close button, and left/right arrow navigation. Keyboard support via `svelte:window onkeydown`: Escape closes, ArrowLeft/ArrowRight navigate. Empty state shows a message with photo_library icon.

Updated job detail page with four changes: (1) imported DebugArtifacts, (2) extended activeTab union to include `'debug'`, (3) derived `hasScreenshots` from artifacts array, (4) added conditional Debug tab button with bug_report icon after Preview tab, and (5) added `{:else if activeTab === 'debug'}` content block rendering DebugArtifacts.

## Verification

- `svelte-check`: Zero errors and zero warnings from files touched by this task. The 14 pre-existing errors are all in `Nav.svelte` and root `+page.svelte` (unrelated health type narrowing issue).
- `npm run web:build`: Completed successfully (✔ done), all 504 client modules transformed.
- `npm test`: All 311 tests passed across 33 test files.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `cd web && npx svelte-check --tsconfig ./tsconfig.json` | 1 | ✅ pass (0 errors in T02 files; 14 pre-existing in Nav.svelte, +page.svelte root) | 4.9s |
| 2 | `npm run web:build` | 0 | ✅ pass | 12.2s |
| 3 | `npm test` | 0 | ✅ pass (311 tests, 33 files) | 31.1s |

## Diagnostics

- **Debug tab missing?** Check `GET /api/jobs/:id/artifacts` — the tab renders only when at least one artifact has `type: 'screenshot'`.
- **Thumbnails broken?** Each `<img>` loads from `/api/jobs/{jobId}/artifacts/{artifactId}`. Check browser Network tab for 404/500 responses.
- **Lightbox not closing?** Escape key handler is on `svelte:window onkeydown`. If another handler calls `stopPropagation`, it won't reach the lightbox. Check console for JS errors.
- **Keyboard nav not working?** ArrowLeft/ArrowRight are handled in the same `onkeydown` handler, guarded by `selectedIndex !== null`. The lightbox div has `tabindex="-1"` for focusability.

## Deviations

- Added `tabindex="-1"` and `onkeydown` directly on the dialog div (plus `svelte-ignore` comments) to satisfy Svelte a11y linter warnings. The plan's `svelte:window onkeydown` is retained as the primary handler; the dialog-level handler is redundant but keeps the linter clean.

## Known Issues

- Pre-existing: 14 svelte-check type errors in `Nav.svelte` and root `+page.svelte` (health type narrowing). Not introduced by this task.

## Files Created/Modified

- `web/src/lib/components/jobs/DebugArtifacts.svelte` — new component: thumbnail grid + lightbox modal for debug screenshots
- `web/src/routes/jobs/[id]/+page.svelte` — added DebugArtifacts import, extended activeTab type, added hasScreenshots derived, added conditional Debug tab button and content panel
- `.gsd/milestones/M003/slices/S05/tasks/T02-PLAN.md` — added Observability Impact section (pre-flight fix)
