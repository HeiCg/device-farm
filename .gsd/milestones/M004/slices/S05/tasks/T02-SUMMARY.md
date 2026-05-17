---
id: T02
parent: S05
milestone: M004
provides: []
requires: []
affects: []
key_files: ["web/src/routes/jobs/[id]/+page.svelte"]
key_decisions: ["Linked execution shown as a green banner with link icon below Maestro options panel", "Shows truncated execution ID as monospace for recognizability"]
patterns_established: []
drill_down_paths: []
observability_surfaces: []
duration: ""
verification_result: "svelte-check 0 errors. Web build clean."
completed_at: 2026-03-26T21:40:11.609Z
blocker_discovered: false
---

# T02: Job detail page shows linked execution banner when auto-link matched

> Job detail page shows linked execution banner when auto-link matched

## What Happened
---
id: T02
parent: S05
milestone: M004
key_files:
  - web/src/routes/jobs/[id]/+page.svelte
key_decisions:
  - Linked execution shown as a green banner with link icon below Maestro options panel
  - Shows truncated execution ID as monospace for recognizability
duration: ""
verification_result: passed
completed_at: 2026-03-26T21:40:11.610Z
blocker_discovered: false
---

# T02: Job detail page shows linked execution banner when auto-link matched

**Job detail page shows linked execution banner when auto-link matched**

## What Happened

Added linkedExecutionId state to job detail page, fetched from the updated API response. Renders as a green banner link when present, linking to /test-executions/:id. Banner shows link icon, label text, truncated execution ID, and forward arrow.

## Verification

svelte-check 0 errors. Web build clean.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `npx svelte-check --threshold error` | 0 | ✅ pass | 4000ms |
| 2 | `npm run web:build` | 0 | ✅ pass | 4000ms |


## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `web/src/routes/jobs/[id]/+page.svelte`


## Deviations
None.

## Known Issues
None.
