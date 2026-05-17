---
id: T04
parent: S02
milestone: M004
provides: []
requires: []
affects: []
key_files: ["web/src/lib/components/test-cases/StepEditor.svelte", "web/src/lib/components/test-cases/LabelPicker.svelte", "web/src/routes/test-cases/new/+page.svelte", "web/src/routes/test-cases/[id]/edit/+page.svelte"]
key_decisions: ["StepEditor is a controlled component — parent owns state, child emits changes via onchange callback", "LabelPicker uses toggle pattern (click to select/deselect) with visual ring on selected pills", "Create and edit pages share StepEditor + LabelPicker but are separate routes (not a shared form component) to keep each page simple"]
patterns_established: []
drill_down_paths: []
observability_surfaces: []
duration: ""
verification_result: "svelte-check: 0 errors. npm run web:build clean."
completed_at: 2026-03-26T20:02:28.984Z
blocker_discovered: false
---

# T04: Create/edit forms with StepEditor (reorder/add/remove) and LabelPicker (toggle multi-select) components

> Create/edit forms with StepEditor (reorder/add/remove) and LabelPicker (toggle multi-select) components

## What Happened
---
id: T04
parent: S02
milestone: M004
key_files:
  - web/src/lib/components/test-cases/StepEditor.svelte
  - web/src/lib/components/test-cases/LabelPicker.svelte
  - web/src/routes/test-cases/new/+page.svelte
  - web/src/routes/test-cases/[id]/edit/+page.svelte
key_decisions:
  - StepEditor is a controlled component — parent owns state, child emits changes via onchange callback
  - LabelPicker uses toggle pattern (click to select/deselect) with visual ring on selected pills
  - Create and edit pages share StepEditor + LabelPicker but are separate routes (not a shared form component) to keep each page simple
duration: ""
verification_result: passed
completed_at: 2026-03-26T20:02:28.984Z
blocker_discovered: false
---

# T04: Create/edit forms with StepEditor (reorder/add/remove) and LabelPicker (toggle multi-select) components

**Create/edit forms with StepEditor (reorder/add/remove) and LabelPicker (toggle multi-select) components**

## What Happened

Created StepEditor (add/remove/reorder steps with action/expected/data fields) and LabelPicker (toggle multi-select with colored pills) as reusable components. Built create page (/test-cases/new) and edit page (/test-cases/[id]/edit) with full form: title, description, preconditions, priority/status/automation dropdowns, flow filename, steps editor, label picker. Create redirects to detail on success; edit pre-fills from API on mount.

## Verification

svelte-check: 0 errors. npm run web:build clean.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `npx svelte-check --threshold error` | 0 | ✅ pass | 4100ms |
| 2 | `npm run web:build` | 0 | ✅ pass | 3800ms |


## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `web/src/lib/components/test-cases/StepEditor.svelte`
- `web/src/lib/components/test-cases/LabelPicker.svelte`
- `web/src/routes/test-cases/new/+page.svelte`
- `web/src/routes/test-cases/[id]/edit/+page.svelte`


## Deviations
None.

## Known Issues
None.
