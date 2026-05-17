---
id: S03
parent: M003
milestone: M003
provides:
  - HookEvent, HookDefinition, HookResult client-side types
  - hooks API client (listHooks, createHook, updateHook, deleteHook, testHook)
  - HookList component with section header, badges, toggle, action buttons, delete confirmation
  - HookForm component with all R039 fields and template variable reference
  - HookTestResult component with stdout/stderr/exitCode/duration display
  - Settings page hooks section with full CRUD state management
requires:
  - slice: none
    provides: independent slice
affects:
  - none (terminal slice, no downstream consumers)
key_files:
  - web/src/lib/api/types.ts
  - web/src/lib/api/hooks.ts
  - web/src/lib/components/hooks/HookList.svelte
  - web/src/lib/components/hooks/HookForm.svelte
  - web/src/lib/components/hooks/HookTestResult.svelte
  - web/src/routes/settings/+page.svelte
key_decisions:
  - D021: Two-click inline delete confirmation instead of modal dialog
  - encodeURIComponent on hook names in URL paths for special character safety
  - Parallel loading of config and hooks via Promise.all in onMount
  - Synthetic HookResult on test API failure for consistent component data shape
patterns_established:
  - Toggle switch pattern: button[role=switch] with aria-checked + translate-x for thumb
  - Two-click delete: first click sets deleteConfirm state, second executes, cancel resets
  - Form initial-value capture via $state(prop?.field ?? default) — intentional non-reactive copy
  - Unicode escapes (\u007B/\u007D) for {{ }} in Svelte attribute strings
observability_surfaces:
  - 10 $state variables in Settings page inspectable via Svelte DevTools
  - All hook CRUD operations hit /api/hooks* — filterable in browser DevTools Network tab
  - formError state surfaces 409/404/validation errors inline in the form
  - testResults record stores per-hook test output for inline display
  - hooksError state surfaces initial load failures as inline banner
drill_down_paths:
  - .gsd/milestones/M003/slices/S03/tasks/T01-SUMMARY.md
  - .gsd/milestones/M003/slices/S03/tasks/T02-SUMMARY.md
  - .gsd/milestones/M003/slices/S03/tasks/T03-SUMMARY.md
duration: 37m
verification_result: passed
completed_at: 2026-03-19
---

# S03: Hooks Management UI

**Full CRUD hooks management section in Settings page — list with event/platform badges and enabled toggle, create/edit form with all hook fields and template variable reference, test-run with stdout/stderr/exit code display, inline delete confirmation**

## What Happened

Built the complete hooks management UI in three tasks, each layering cleanly on the previous:

**T01 (types + API client):** Added `HookEvent` (4-value union), `HookDefinition` (7 fields), and `HookResult` (9 fields) types to `types.ts`, exactly mirroring the server's `hook-executor.ts` interfaces. Created `hooks.ts` with 5 thin wrapper functions around `apiFetch` — one per server endpoint. Used `encodeURIComponent` for hook names in URL paths. All functions throw `ApiError` with RFC 7807 fields for upstream error display.

**T02 (three components):** Built `HookTestResult` (success/failure badge, exit code, formatted duration, stdout/stderr in pre blocks), `HookList` (section header with icon, per-hook rows with event/platform badges, truncated command preview, enabled toggle switch, edit/test/delete buttons, empty state), and `HookForm` (name input, event dropdown with 4 options, platform select, command textarea with template variable reference box listing 6 variables, timeout in seconds with ms conversion, failOnError toggle, enabled toggle, save/cancel). All follow Kinetic Console design tokens and D016 static class lookups. Fixed Svelte's `{{` expression parsing with Unicode escapes (knowledge base entry added).

**T03 (Settings page wiring):** Integrated all components into `+page.svelte` with 10 `$state` variables managing the full CRUD lifecycle. Hooks load in parallel with config via `Promise.all`. Seven handler functions cover create (with 409 duplicate detection), edit (PUT with old name in path), delete (two-click inline confirmation), toggle enabled, and test execution. `HookList` was enhanced with `deleteConfirm` and `onCancelDelete` props for parent-controlled confirmation state. Test failures produce synthetic `HookResult` objects for consistent rendering.

## Verification

- `npm run web:build` — zero errors across SSR and client bundles (both build passes)
- `cd web && npm run check` — zero errors in any hooks file; 14 pre-existing errors in Nav.svelte and home +page.svelte (health type narrowing, unrelated to this slice)
- All 5 API client functions cross-referenced against server routes in `server/hooks/plugin.ts` — methods, paths, and body shapes match exactly
- 9 `state_referenced_locally` warnings in HookForm are intentional (documented in T02) — form copies initial values from prop as local mutable state; parent creates new instances when switching modes

## Requirements Advanced

- R038 — Hook list displaying name, event, platform, command preview, and enabled toggle with create/edit/delete actions and inline delete confirmation. Fully delivered.
- R039 — Hook create/edit form with event dropdown (4 events), platform selector, command textarea with template variable reference (6 variables), timeout input, failOnError toggle. Fully delivered.
- R040 — Test button per hook calls POST /api/hooks/:name/test and displays stdout, stderr, exit code, duration inline below the hook row. Fully delivered.

## Requirements Validated

- R038 — Build verification passes; HookList renders all specified fields (name, event badge, platform badge, command preview, enabled toggle) with create/edit/delete actions and two-click delete confirmation.
- R039 — Build verification passes; HookForm includes all specified fields (event dropdown with 4 options, platform selector, command textarea with 6 template variables, timeout, failOnError toggle) with proper validation.
- R040 — Build verification passes; HookTestResult displays all output fields (stdout, stderr, exit code, duration, success badge) from POST /api/hooks/:name/test response.

## New Requirements Surfaced

- none

## Requirements Invalidated or Re-scoped

- none

## Deviations

- `onCreate` prop added to HookList (not in original plan's prop list) — needed for the "Create Hook" button in the section header to signal the parent. Minor interface addition consumed by T03.
- `deleteConfirm` and `onCancelDelete` props added to HookList — plan mentioned confirmation dialogs generically; implemented as inline two-click pattern with parent-controlled state rather than a modal dialog.
- Parallel loading via `Promise.all` — plan said "alongside config loading" without specifying mechanism; implemented as fully parallel for faster page load.

## Known Limitations

- Hook commands may contain secrets in template variables or hardcoded values. No client-side redaction is applied — commands are displayed as-is. Server-side redaction is outside this slice's scope.
- svelte-check exits 1 due to 14 pre-existing type errors in Nav.svelte and home +page.svelte (health type narrowing). These are not related to hooks work.
- HookForm `state_referenced_locally` warnings are intentional design — the form captures initial values from the hook prop rather than tracking it reactively, because the parent creates a new component instance when switching between create/edit modes.

## Follow-ups

- none

## Files Created/Modified

- `web/src/lib/api/types.ts` — added HookEvent, HookDefinition, HookResult types
- `web/src/lib/api/hooks.ts` — new API client with 5 functions for hooks CRUD + test-run
- `web/src/lib/components/hooks/HookList.svelte` — new hook list component with section header, badges, toggles, actions, delete confirmation, empty state
- `web/src/lib/components/hooks/HookForm.svelte` — new create/edit form with all R039 fields and template variable reference
- `web/src/lib/components/hooks/HookTestResult.svelte` — new test result display with success/fail badge, stdout/stderr, exit code, duration
- `web/src/routes/settings/+page.svelte` — added hooks imports, 10 state variables, 7 handler functions, hooks section template

## Forward Intelligence

### What the next slice should know
- The hooks API client in `web/src/lib/api/hooks.ts` follows the same thin-wrapper pattern as `devices.ts` and `maestro.ts` — use it as a template for any new API client modules.
- The Settings page now has two distinct sections (config grid + hooks management). Any new settings sections should follow the same pattern: icon in `bg-primary/10 rounded-lg` + `font-headline` label as section header.
- Template variable display (the reference box listing `{{device_id}}`, `{{serial}}`, etc.) is self-contained in HookForm — if variables are added server-side, only the `templateVars` array in HookForm needs updating.

### What's fragile
- HookForm relies on parent creating a new component instance when switching between create/edit modes (`{#if showForm}` toggling destroys/recreates). If someone changes this to persist the component and just swap the `hook` prop, the `$state(hook?.field)` initial-value capture will not update.
- The `encodeURIComponent` wrapping in hooks.ts is critical — hook names can contain dots (e.g., "pre.boot.wifi"), and without encoding the server would misroute the path.

### Authoritative diagnostics
- Browser DevTools Network tab filtering for `/api/hooks` — all CRUD operations and test-runs are visible there with request/response bodies.
- Svelte DevTools showing the 10 `$state` variables in the Settings page component — `hooks`, `hooksLoading`, `hooksError`, `showForm`, `editingHook`, `saving`, `formError`, `testingHook`, `testResults`, `deleteConfirm`.

### What assumptions changed
- Plan assumed a modal dialog for delete confirmation — implemented as inline two-click pattern (D021), which is simpler and more consistent with the dense UI philosophy.
- Plan listed `onShowCreate` as a prop name — HookList was already built with `onCreate` in T02, so T03 mapped to that instead of renaming.
