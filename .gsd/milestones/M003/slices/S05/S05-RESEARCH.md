# S05 — Maestro Options & Debug Artifacts — Research

**Date:** 2026-03-19
**Depth:** Targeted

## Summary

This slice adds two UI features to the existing job detail page: (1) a metadata section showing which Maestro execution options were used (tags, format, debug, shards), and (2) a "Debug" tab displaying per-step screenshots from Maestro's `--debug-output`.

The job detail page (`web/src/routes/jobs/[id]/+page.svelte`) already has a tabbed layout (Logs, Steps, Preview). Adding a metadata section above the tabs and a new "Debug" tab is straightforward Svelte component work following established patterns.

**Key gap discovered:** The Maestro execution options (`includeTags`, `excludeTags`, `reportFormat`, `debugOutput`) are defined in `ExecuteOptions` and `CreateJobOpts` but are **not currently persisted to the database**. The `jobs.metadata` jsonb column stores user-provided CI metadata (branch, commit, PR info), not Maestro-specific flags. The `CreateJobOpts` interface accepts `includeTags`/`excludeTags` but `createJob()` never passes them to the executor — they're wired in `ExecuteOptions` but the service's `executeJob()` call doesn't forward them from the `QueuedJob`. The CLI (`run.go`) also doesn't expose these flags yet. This slice is UI-only per the roadmap ("Out of Scope: New server-side endpoints"), so it should display whatever is available in the existing `metadata` jsonb and the existing artifacts — not add new server plumbing.

## Recommendation

**Approach: Display what's already stored, add a debug artifacts viewer.**

1. **Maestro Options section** — Read from `job.metadata` (the jsonb column already returned by `GET /jobs/:id`). If the submitter included Maestro options in metadata (e.g., `tags`, `debugOutput`), display them. Show a structured card with known option keys, gracefully hiding the section when no Maestro options are present. This is a pure frontend read of existing data.

2. **Debug Artifacts tab** — Filter the existing `artifacts` array (already fetched by `fetchArtifacts()`) for screenshot-type artifacts. The job executor already saves per-step failure screenshots as `step-N.png` artifacts with type `screenshot`. Display these as a navigable timeline with thumbnails. The artifact download endpoint (`GET /jobs/:id/artifacts/:artifactId`) already serves the files.

3. **No server changes needed** — Both features read from existing API responses (`job.metadata` and `artifacts` list). The debug tab filters artifacts by type; the options section reads metadata keys.

## Implementation Landscape

### Key Files

- `web/src/routes/jobs/[id]/+page.svelte` — **Primary edit target.** Currently has header, 3 tabs (logs/steps/preview), and content panels. Needs: (a) Maestro options metadata section below header, (b) new "Debug" tab that shows when screenshot artifacts exist.
- `web/src/lib/api/types.ts` — Add `MaestroOptions` interface for typed metadata extraction. Already has `Job`, `Artifact`, `JobStep` types.
- `web/src/lib/api/jobs.ts` — Already has `getJob()`, `getJobArtifacts()`. No changes needed — existing endpoints return everything we need.
- `web/src/lib/components/jobs/StepList.svelte` — Existing component showing step rows with status icons. Reference for styling patterns.
- `web/src/lib/components/jobs/VideoPlayer.svelte` — Existing artifact viewer. Reference for how artifacts are loaded/displayed.

### New Components to Create

- `web/src/lib/components/jobs/MaestroOptionsPanel.svelte` — Displays Maestro execution options (tags, format, debug flag, shard count) extracted from `job.metadata`. Uses the glass card pattern from D004/D007. Shows nothing if no options present.
- `web/src/lib/components/jobs/DebugArtifacts.svelte` — Grid/timeline of debug screenshots. Each thumbnail links to the full artifact. Shows step index, flow name (if correlatable with steps), and screenshot. Uses existing artifact download URL pattern: `/api/jobs/{jobId}/artifacts/{artifactId}`.

### Build Order

1. **MaestroOptionsPanel** — Pure display component, no dependencies. Extracts known keys from `job.metadata` and renders a card. Fast to build and verify.
2. **DebugArtifacts** — Filters `artifacts` array for type `screenshot`, renders thumbnails in a grid with lightbox/expand on click. Depends on understanding artifact structure (already clear).
3. **Wire into job detail page** — Add the options panel below the header, add "Debug" tab alongside existing tabs (conditionally shown when screenshot artifacts exist), render DebugArtifacts in tab content.

### Verification Approach

- `npm run web:build` passes with zero errors (contract check)
- `npx svelte-check` clean in web directory
- Visual inspection: job detail page shows options section when metadata has Maestro keys
- Visual inspection: Debug tab appears when job has screenshot artifacts, thumbnails load via artifact endpoint
- All existing 300+ tests still pass (`npm test`)

## Constraints

- **D016:** Full static Tailwind class strings in Record lookups — no template interpolation for any conditional styling
- **D017:** `$derived` for reactive lookups in Svelte 5
- **Svelte 5 runes:** Components use `$props()`, `$state`, `$derived`, `$effect` — no legacy `export let`
- **Kinetic Console design system:** Dark theme, glass cards, tonal layering, ghost borders — match existing job detail page styling exactly
- **No server changes:** Roadmap explicitly says "Out of Scope: New server-side endpoints (already built)." This slice reads from existing API responses only.

## Common Pitfalls

- **Metadata shape is arbitrary** — `job.metadata` is `Record<string, unknown>`. The panel must defensively extract known Maestro option keys (`includeTags`, `excludeTags`, `reportFormat`, `debugOutput`, `shards`) with type guards. Don't assume they exist.
- **Artifact type filtering** — The `artifacts` array mixes video, screenshot, memory, and log types. Filter to `type === 'screenshot'` for the debug tab. The `fileName` pattern is `step-N.png` — parse the index for ordering.
- **Screenshot artifact URLs** — Artifacts are served via `/api/jobs/:id/artifacts/:artifactId` with auth headers. Use this endpoint (not direct file paths) since the browser needs the auth token. For `<img>` tags, consider fetching as blob or using the URL directly (the existing `apiFetch` adds auth).
- **Svelte double curly braces** — Per KNOWLEDGE.md, avoid `{{` in Svelte template attribute values. Use script-block constants for any strings containing braces.

## Open Risks

- **Maestro options not yet persisted by the submission pipeline** — Currently, `includeTags`/`excludeTags`/`debugOutput`/`reportFormat` are accepted by `CreateJobOpts` and `ExecuteOptions` but the CLI doesn't send them, and `createJob()` doesn't store them separately from user metadata. The options panel may be empty for all existing jobs. This is acceptable — the UI is ready for when the server pipeline wires these through. The panel gracefully hides when no options are present.
- **Debug screenshots only captured on failure** — The job executor currently saves `step-N.png` screenshots only when a flow *fails* (see `onFlowResult` callback in `job-service.ts`). The `--debug-output` flag would save screenshots for every step, but that pipeline isn't fully wired yet. The Debug tab will show whatever screenshots exist — possibly only failure screenshots.
