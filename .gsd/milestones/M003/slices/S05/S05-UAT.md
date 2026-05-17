# S05: Maestro Options & Debug Artifacts — UAT

**Milestone:** M003
**Written:** 2026-03-19

## UAT Type

- UAT mode: artifact-driven
- Why this mode is sufficient: Both components render from API data already served by existing endpoints. The UI logic is deterministic — given known metadata and artifact payloads, the rendering is predictable. Live runtime testing would only add value for Maestro debug output filename format validation.

## Preconditions

- Server running (`npm run dev`)
- Web UI accessible at the configured port (typically http://localhost:3000)
- At least one job exists in the database
- For Debug tab testing: a job must have artifacts with `type: 'screenshot'` and filenames matching `step-N.png` pattern

## Smoke Test

Navigate to any job detail page (`/jobs/:id`). If the job has Maestro metadata keys (includeTags, excludeTags, reportFormat, debugOutput, shards), a "Maestro Options" card appears between the header and tabs.

## Test Cases

### 1. MaestroOptionsPanel renders with include tags

1. Create or identify a job whose `metadata` includes `{ "includeTags": ["smoke", "login"], "debugOutput": true }`
2. Navigate to `/jobs/:id` for that job
3. **Expected:** A "Maestro Options" card appears below the header, showing:
   - "Include Tags" row with two green pills: "smoke" and "login"
   - "Debug Output" row with a purple "Enabled" chip
   - No rows for excludeTags, reportFormat, or shards (not set)

### 2. MaestroOptionsPanel renders all fields

1. Create or identify a job with metadata: `{ "includeTags": ["regression"], "excludeTags": ["flaky", "wip"], "reportFormat": "junit", "debugOutput": true, "shards": 4 }`
2. Navigate to that job's detail page
3. **Expected:** Maestro Options card shows 5 rows:
   - Include Tags: 1 green pill "regression"
   - Exclude Tags: 2 red pills "flaky", "wip"
   - Report Format: monospace text "junit"
   - Debug Output: purple "Enabled" chip
   - Shards: monospace text "4"

### 3. MaestroOptionsPanel hidden when no Maestro metadata

1. Navigate to a job detail page for a job with empty metadata or metadata containing only non-Maestro keys (e.g., `{ "platform": "android" }`)
2. **Expected:** No "Maestro Options" card appears. The tabs section follows immediately after the header.

### 4. Debug tab appears with screenshot artifacts

1. Ensure a job has artifacts with `type: 'screenshot'` (e.g., filenames `step-0.png`, `step-1.png`, `step-2.png`)
2. Navigate to that job's detail page
3. **Expected:** A "Debug" tab button with bug_report icon appears after the Preview tab. Clicking it shows a grid of screenshot thumbnails, each labeled "Step 0", "Step 1", "Step 2", ordered by step index.

### 5. Debug tab hidden when no screenshots

1. Navigate to a job detail page for a job with no screenshot artifacts (or no artifacts at all)
2. **Expected:** No "Debug" tab appears in the tab bar. Only Logs, Steps, and Preview tabs are visible.

### 6. Lightbox opens and navigates

1. On a job with 3+ debug screenshots, click the Debug tab
2. Click the "Step 1" thumbnail
3. **Expected:** A full-screen lightbox opens with dark overlay, showing the full-size Step 1 screenshot. Top bar shows "Step 1", the filename, and "2 / 3" counter. Left and right arrow buttons are visible.
4. Click the right arrow (or press ArrowRight)
5. **Expected:** Image advances to Step 2. Counter updates to "3 / 3". Right arrow disappears (last image).
6. Press ArrowLeft
7. **Expected:** Image returns to Step 1. Counter shows "2 / 3".
8. Press Escape
9. **Expected:** Lightbox closes. Thumbnail grid is visible again.

### 7. Lightbox close via backdrop click

1. Open the lightbox on any debug screenshot
2. Click the dark area outside the image (not on the image itself)
3. **Expected:** Lightbox closes

### 8. Other tabs still work

1. Navigate to any job detail page
2. Click Logs tab → verify log output renders
3. Click Steps tab → verify step list renders
4. Click Preview tab → verify preview content renders
5. **Expected:** All existing tabs continue to work unchanged. Adding the Debug tab did not break existing tab functionality.

## Edge Cases

### No screenshots match step-N pattern

1. Create a job with screenshot artifacts named `debug-output.png` (no `step-N` pattern)
2. Navigate to Debug tab
3. **Expected:** Thumbnails still render. Step index defaults to 0 for all. All thumbnails show "Step 0".

### Single screenshot

1. Job has exactly one screenshot artifact
2. Open Debug tab, click the thumbnail
3. **Expected:** Lightbox opens. No left/right arrows are shown. Counter shows "1 / 1". Escape or close button dismisses.

### Empty debug tab (no screenshot artifacts after filtering)

1. Job has artifacts but none with `type: 'screenshot'`
2. The Debug tab should not appear at all (it's conditionally rendered)
3. **Expected:** Tab bar shows only Logs, Steps, Preview.

## Failure Signals

- **MaestroOptionsPanel not rendering on a job with Maestro metadata:** Inspect `GET /api/jobs/:id` response — check that `metadata` contains the expected keys. If present, `extractMaestroOptions()` may have a bug.
- **Debug tab missing on a job with screenshots:** Inspect `GET /api/jobs/:id/artifacts` — verify at least one artifact has `type: 'screenshot'`. If artifacts exist but tab is missing, the `hasScreenshots` derived may have a bug.
- **Thumbnails show broken images:** Check browser Network tab for 404/500 on `/api/jobs/{jobId}/artifacts/{artifactId}`. The artifact endpoint may not be serving the file correctly.
- **Lightbox doesn't close on Escape:** Check browser console for JS errors. Another event handler may be intercepting the keydown event.
- **Tag pills show no background color:** Tailwind JIT may not be scanning the component. Verify the component file is in the Tailwind content paths.

## Requirements Proved By This UAT

- R042 — Test cases 1, 2, 3 prove that Maestro execution options (tags, format, debug flag, shards) are displayed in the job detail page and hidden when absent
- R043 — Test cases 4, 5, 6, 7 prove that per-step debug screenshots are rendered in a navigable grid with lightbox viewer, shown only when debug artifacts exist

## Not Proven By This UAT

- Actual Maestro `--debug-output` file format — the `step-N.png` naming convention is assumed based on Maestro documentation. Live validation requires running a real Maestro test with `--debug-output` flag and verifying filenames match.
- The artifacts endpoint (`GET /api/jobs/:id/artifacts/:artifactId`) correctly serves screenshot files — this is server infrastructure tested elsewhere.
- Mobile/tablet responsiveness of the thumbnail grid — responsive columns are defined but not verified in this UAT.

## Notes for Tester

- The easiest way to test is to manually insert a job with Maestro metadata via the database or API. Use `metadata: { "includeTags": ["smoke"], "debugOutput": true }` for a minimal test case.
- For debug screenshots, create artifact records with `type: 'screenshot'` and filenames like `step-0.png`, `step-1.png`. The actual image files must exist at the artifact storage path for thumbnails to load.
- The 14 pre-existing svelte-check errors (Nav.svelte, root +page.svelte) are unrelated to this slice — ignore them during testing.
