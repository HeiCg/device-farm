# S05: Maestro Options & Debug Artifacts

**Goal:** Job detail page displays Maestro execution options and per-step debug screenshots from existing API data.
**Demo:** Open a job detail page → see Maestro options (tags, format, debug flag, shards) in a metadata card below the header. If the job has screenshot artifacts, a "Debug" tab appears showing a thumbnail grid of per-step screenshots with click-to-expand lightbox.

## Must-Haves

- MaestroOptionsPanel component reads known keys from `job.metadata` and renders them in a styled card
- Panel gracefully hides when no Maestro options are present in metadata
- Debug tab appears only when screenshot-type artifacts exist for the job
- Screenshot thumbnails load via the existing artifact endpoint (`/api/jobs/:id/artifacts/:artifactId`)
- Thumbnails are ordered by step index (parsed from `step-N.png` filename pattern)
- Click a thumbnail → lightbox/modal shows the full-size screenshot
- All existing tabs (Logs, Steps, Preview) continue to work unchanged

## Verification

- `cd web && npx svelte-check --tsconfig ./tsconfig.json` passes with zero errors
- `npm run web:build` passes with zero errors
- `npm test` — all existing 300+ server tests pass (no regressions)
- Visual inspection: job detail page renders MaestroOptionsPanel when metadata has Maestro keys
- Visual inspection: Debug tab appears when job has screenshot artifacts, thumbnails load

## Integration Closure

- Upstream surfaces consumed: `GET /api/jobs/:id` (returns `job.metadata`), `GET /api/jobs/:id/artifacts` (returns artifact list), `GET /api/jobs/:id/artifacts/:artifactId` (serves artifact files)
- New wiring introduced in this slice: MaestroOptionsPanel rendered in job detail header area, "Debug" tab + DebugArtifacts component added to tab system
- What remains before the milestone is truly usable end-to-end: nothing — this is the last slice in M003

## Tasks

- [x] **T01: Build MaestroOptionsPanel and wire into job detail** `est:45m`
  - Why: Delivers R042 — users need to see what Maestro flags were active when a job ran. The panel reads from `job.metadata` which is already returned by the API.
  - Files: `web/src/lib/api/types.ts`, `web/src/lib/components/jobs/MaestroOptionsPanel.svelte`, `web/src/routes/jobs/[id]/+page.svelte`
  - Do: (1) Add `MaestroOptions` interface and `extractMaestroOptions()` helper to types.ts. (2) Create MaestroOptionsPanel.svelte — accepts `options: MaestroOptions | null`, renders a glass card with tag pills, format badge, debug flag, shard count; renders nothing when options is null. Use static Tailwind class Record lookups per D016. Use `$derived` for reactive derivation per D017. (3) Import and render the panel in the job detail page below the header, above the tabs. Extract options via `$derived(() => extractMaestroOptions(job?.metadata ?? null))`.
  - Verify: `cd web && npx svelte-check --tsconfig ./tsconfig.json` — zero errors. `npm run web:build` — builds cleanly.
  - Done when: MaestroOptionsPanel renders Maestro option keys from job metadata, hides when none present, and the web build passes.

- [x] **T02: Build DebugArtifacts viewer and add Debug tab to job detail** `est:1h`
  - Why: Delivers R043 — per-step debug screenshots are Maestro's primary debugging tool; rendering them in the web UI avoids manual file inspection. The artifacts endpoint already serves the files.
  - Files: `web/src/lib/components/jobs/DebugArtifacts.svelte`, `web/src/routes/jobs/[id]/+page.svelte`
  - Do: (1) Create DebugArtifacts.svelte — accepts `jobId: string` and `artifacts: Artifact[]`. Filters for `type === 'screenshot'`, parses step index from `step-N.png` filename, sorts by index. Renders a responsive thumbnail grid. Each thumbnail loads via `/api/jobs/{jobId}/artifacts/{artifactId}`. Click opens a lightbox modal (dark overlay + full-size image + close button). (2) Add "Debug" tab to the job detail page tab bar — shown conditionally when screenshot artifacts exist. Wire DebugArtifacts into the tab content panel. Extend the `activeTab` union type to include `'debug'`. (3) Run full verification: svelte-check, web build, npm test.
  - Verify: `cd web && npx svelte-check --tsconfig ./tsconfig.json` — zero errors. `npm run web:build` — builds cleanly. `npm test` — all tests pass.
  - Done when: Debug tab appears in job detail when screenshot artifacts exist, thumbnails render in a grid, clicking a thumbnail opens a full-size lightbox, and all builds/tests pass.

## Observability / Diagnostics

- **Runtime signals:** MaestroOptionsPanel renders conditionally based on `job.metadata` contents — if panel is absent on a job detail page, inspect `job.metadata` via `GET /api/jobs/:id` to confirm whether Maestro keys (`includeTags`, `excludeTags`, `reportFormat`, `debugOutput`, `shards`) are present.
- **Inspection surfaces:** Browser DevTools → Network tab shows the `/api/jobs/:id` response payload including `metadata`. The panel's DOM is a `div` with a `border-l-2 border-primary` card; its absence means `extractMaestroOptions()` returned null.
- **Debug tab visibility:** The "Debug" tab appears only when `artifacts.filter(a => a.type === 'screenshot').length > 0`. If the tab is missing, inspect `/api/jobs/:id/artifacts` to verify screenshot artifacts exist.
- **Failure visibility:** If thumbnail images fail to load, the browser Network tab will show 404/500 on `/api/jobs/:id/artifacts/:artifactId`. The lightbox modal uses click-outside-to-close; if it's stuck, check for JS errors in console.
- **Redaction:** No secrets or PII are involved — `job.metadata` contains execution config only (tags, format strings, booleans, counts).

## Files Likely Touched

- `web/src/lib/api/types.ts`
- `web/src/lib/components/jobs/MaestroOptionsPanel.svelte`
- `web/src/lib/components/jobs/DebugArtifacts.svelte`
- `web/src/routes/jobs/[id]/+page.svelte`
