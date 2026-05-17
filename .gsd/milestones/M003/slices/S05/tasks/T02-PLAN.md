---
estimated_steps: 5
estimated_files: 3
---

# T02: Build DebugArtifacts viewer and add Debug tab to job detail

**Slice:** S05 — Maestro Options & Debug Artifacts
**Milestone:** M003

## Description

Create a `DebugArtifacts` component that displays per-step debug screenshots in a thumbnail grid with a click-to-expand lightbox modal. Add a "Debug" tab to the job detail page's tab bar, shown conditionally when the job has screenshot-type artifacts.

Screenshots are already saved as artifacts with `type: 'screenshot'` and `fileName: 'step-N.png'` pattern by the job executor (on flow failure). They're served via the existing `GET /api/jobs/:id/artifacts/:artifactId` endpoint. The artifact URL pattern for `<img src>` is `/api/jobs/{jobId}/artifacts/{artifactId}` — the browser sends auth cookies automatically if set, or the apiFetch adds a Bearer token. For `<img>` tags that can't use apiFetch, use the URL directly — the server serves artifact files via standard HTTP (no JSON content-type required).

**Design system notes:** Match the existing dark theme patterns (surface-container-low, outline-variant/10 borders). The lightbox should use a dark overlay (bg-black/80 or similar), centered full-size image, and a close button. Use Escape key to close. Svelte 5 runes — `$props()`, `$state`, `$derived`. Static Tailwind class strings (D016).

**Relevant skill:** `frontend-design` — load this skill for design system guidance.

## Steps

1. **Create `web/src/lib/components/jobs/DebugArtifacts.svelte`:**
   - Props: `let { jobId, artifacts }: { jobId: string; artifacts: Artifact[] } = $props();`
   - Import `type { Artifact }` from `$lib/api/types.js`.
   - Derive `screenshotArtifacts` from `artifacts`: filter to `type === 'screenshot'`, parse step index from fileName using regex `/step-(\d+)/`, sort by step index ascending. Map each to `{ artifact, stepIndex, src }` where `src = '/api/jobs/' + jobId + '/artifacts/' + artifact.id`.
   - If `screenshotArtifacts` is empty, render an empty state message.
   - Render a responsive thumbnail grid: `grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3`.
   - Each thumbnail: rounded card with border, the `<img>` tag loading from `src`, a label showing "Step N" below.
   - Lightbox state: `let selectedIndex = $state<number | null>(null);` — clicking a thumbnail sets it.
   - Lightbox modal (rendered when `selectedIndex !== null`):
     - Fixed overlay: `fixed inset-0 z-50 bg-black/80 flex items-center justify-center`
     - Click overlay backdrop to close (set `selectedIndex = null`)
     - Full-size `<img>` centered, max-width/max-height constrained
     - "Step N" label and close button (X icon or "Close" text)
     - Left/right arrow navigation buttons to move between screenshots
     - Escape key closes: use `svelte:window` `on:keydown` to handle Escape, ArrowLeft, ArrowRight
   - Use `$effect` cleanup if needed for keyboard listeners, or `onkeydown` on `svelte:window`.

2. **Extend `activeTab` type in `web/src/routes/jobs/[id]/+page.svelte`:**
   - Change `let activeTab = $state<'logs' | 'steps' | 'preview'>('logs');` to include `'debug'`: `$state<'logs' | 'steps' | 'preview' | 'debug'>('logs');`

3. **Add Debug tab button to the tab bar in job detail page:**
   - Import: `import DebugArtifacts from '$lib/components/jobs/DebugArtifacts.svelte';`
   - Derive screenshot presence: `let hasScreenshots = $derived(artifacts.some(a => a.type === 'screenshot'));`
   - Add the "Debug" tab button after the Preview tab conditional block, shown only when `hasScreenshots` is true. Follow the exact same pattern as the existing tab buttons (active vs inactive styling with border-b-2).
   - Use a bug_report or photo_library Material icon for the tab label.

4. **Add Debug tab content panel in the tab content section:**
   - Add `{:else if activeTab === 'debug'}` block after the preview content block.
   - Render: `<DebugArtifacts jobId={job.id} {artifacts} />`

5. **Final verification:**
   - Run `cd web && npx svelte-check --tsconfig ./tsconfig.json` — must produce zero errors.
   - Run `npm run web:build` — must complete successfully.
   - Run `npm test` from project root — all 300+ existing tests must pass.

## Must-Haves

- [ ] `DebugArtifacts.svelte` filters artifacts to `type === 'screenshot'` and renders a thumbnail grid
- [ ] Thumbnails ordered by step index parsed from `step-N.png` filename
- [ ] Click thumbnail opens a lightbox modal with full-size image, close button, and arrow navigation
- [ ] Escape key closes the lightbox
- [ ] "Debug" tab appears in job detail only when screenshot artifacts exist
- [ ] All existing tabs (Logs, Steps, Preview) continue to work unchanged
- [ ] `svelte-check`, `web:build`, and `npm test` all pass cleanly

## Verification

- `cd web && npx svelte-check --tsconfig ./tsconfig.json` — zero errors
- `npm run web:build` — zero errors
- `npm test` — all existing tests pass

## Inputs

- `web/src/routes/jobs/[id]/+page.svelte` — job detail page as modified by T01 (MaestroOptionsPanel already wired in below header)
- `web/src/lib/api/types.ts` — has `Artifact` type with `id`, `type`, `fileName` fields; also has `MaestroOptions` from T01
- `web/src/lib/components/jobs/VideoPlayer.svelte` — reference for artifact URL pattern (`/api/jobs/${jobId}/artifacts/${artifactId}`)
- `web/src/lib/components/jobs/StepList.svelte` — reference for grid/card styling patterns

## Observability Impact

- **Debug tab visibility:** The "Debug" tab button renders only when `artifacts.some(a => a.type === 'screenshot')` is true. If the tab is missing, inspect `/api/jobs/:id/artifacts` to verify screenshot artifacts exist with `type: 'screenshot'`.
- **Thumbnail loading failures:** Each `<img>` loads from `/api/jobs/{jobId}/artifacts/{artifactId}`. A broken thumbnail means a 404/500 on that URL — visible in browser DevTools Network tab.
- **Lightbox state:** `selectedIndex` is a `$state` rune. If the lightbox doesn't open/close, inspect the component's state via Svelte DevTools or check for JS errors in the browser console.
- **Keyboard navigation:** Escape, ArrowLeft, ArrowRight are handled via `svelte:window` `onkeydown`. If keyboard nav fails, verify no other handler is calling `stopPropagation` on those keys.
- **No backend changes:** This task is UI-only — no new API endpoints, server logs, or database changes.

## Expected Output

- `web/src/lib/components/jobs/DebugArtifacts.svelte` — new component with thumbnail grid + lightbox modal
- `web/src/routes/jobs/[id]/+page.svelte` — updated with Debug tab (conditional on screenshot artifacts), DebugArtifacts wired into tab content
