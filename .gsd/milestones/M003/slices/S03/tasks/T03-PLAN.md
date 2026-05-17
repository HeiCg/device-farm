---
estimated_steps: 5
estimated_files: 1
---

# T03: Wire hooks section into Settings page with CRUD state management

**Slice:** S03 — Hooks Management UI
**Milestone:** M003

## Description

Integrate the HookList, HookForm, and HookTestResult components into the existing Settings page. This task adds the CRUD orchestration layer — loading hooks on mount, managing create/edit/delete/toggle/test state, handling API errors (409 duplicate, 404 not found), and rendering the hooks section below the existing read-only config grid. The Settings page becomes the single entry point for all hook management (R038, R039, R040).

**Relevant skills:** `frontend-design` — load for design consistency guidance

## Steps

1. Open `web/src/routes/settings/+page.svelte`. Add imports at the top of the `<script>` block:
   ```typescript
   import { listHooks, createHook, updateHook, deleteHook, testHook } from '$lib/api/hooks.js';
   import type { HookDefinition, HookResult } from '$lib/api/types.js';
   import HookList from '$lib/components/hooks/HookList.svelte';
   import HookForm from '$lib/components/hooks/HookForm.svelte';
   ```

2. Add hook-related state variables (Svelte 5 `$state` runes):
   ```typescript
   let hooks: HookDefinition[] = $state([]);
   let hooksLoading = $state(true);
   let hooksError: string | null = $state(null);
   let showForm = $state(false);
   let editingHook: HookDefinition | null = $state(null);
   let saving = $state(false);
   let formError: string | null = $state(null);
   let testingHook: string | null = $state(null);
   let testResults: Record<string, HookResult> = $state({});
   let deleteConfirm: string | null = $state(null);
   ```

3. Load hooks in the existing `onMount` callback (alongside config loading):
   ```typescript
   // Inside onMount, after config fetch (or in parallel):
   try {
     hooks = await listHooks();
   } catch (err: any) {
     hooksError = err.detail ?? err.message ?? 'Failed to load hooks';
   } finally {
     hooksLoading = false;
   }
   ```

4. Implement handler functions:
   - **handleCreateOrEdit(hook: HookDefinition):** If `editingHook` is non-null, call `updateHook(editingHook.name, hook)`. Otherwise call `createHook(hook)`. On success, re-fetch hooks via `listHooks()`, reset `showForm`/`editingHook`/`formError`. On error, if 409 set `formError` to "A hook with this name already exists", otherwise set `formError` to the error detail. Wrap in `saving = true` / `saving = false`.
   - **handleDelete(name: string):** If `deleteConfirm !== name`, set `deleteConfirm = name` (first click shows confirmation). If `deleteConfirm === name`, call `deleteHook(name)`, re-fetch hooks, reset `deleteConfirm`. On 404, show brief error then re-fetch (hook may have been deleted externally).
   - **handleToggleEnabled(name: string, enabled: boolean):** Find the hook in `hooks` array, call `updateHook(name, { ...foundHook, enabled })`, re-fetch hooks on success.
   - **handleTest(name: string):** Set `testingHook = name`. Call `testHook(name)` (no device ID — uses synthetic context). Store result in `testResults[name]`. Set `testingHook = null`. On error, store a synthetic failed `HookResult` with the error message.
   - **handleEdit(hook: HookDefinition):** Set `editingHook = hook`, `showForm = true`, `formError = null`.
   - **handleCancel():** Set `showForm = false`, `editingHook = null`, `formError = null`.
   - **handleShowCreate():** Set `editingHook = null`, `showForm = true`, `formError = null`.

5. Add the hooks section in the template, **below** the closing `</div>` of the existing `grid grid-cols-12` config grid, still inside the `{:else if config}` block. Structure:

   ```svelte
   <!-- Hooks Management Section -->
   <div class="mt-8">
     {#if hooksLoading}
       <div class="text-sm text-on-surface-variant py-8 text-center">Loading hooks...</div>
     {:else if hooksError}
       <div class="rounded-lg bg-tertiary/10 border border-tertiary/20 px-4 py-3 text-sm text-tertiary">{hooksError}</div>
     {:else}
       {#if showForm}
         <div class="mb-6">
           <HookForm
             hook={editingHook}
             onSave={handleCreateOrEdit}
             onCancel={handleCancel}
             saving={saving}
             error={formError}
           />
         </div>
       {/if}
       <HookList
         hooks={hooks}
         onEdit={handleEdit}
         onDelete={handleDelete}
         onTest={handleTest}
         onToggleEnabled={handleToggleEnabled}
         testingHook={testingHook}
         testResults={testResults}
         onShowCreate={handleShowCreate}
       />
     {/if}
   </div>
   ```

   Note: The HookList component includes the section header with the "Create Hook" button. When the button is clicked, it calls `onShowCreate` which triggers `handleShowCreate()` to show the form above the list. Adjust the HookList prop interface if needed to include `onShowCreate`.

   The delete confirmation should be handled inline — when `deleteConfirm` equals a hook's name, that hook's row shows a "Confirm delete?" prompt with "Yes" / "Cancel" buttons instead of the normal action buttons. Pass `deleteConfirm` as a prop to HookList if needed, or handle it via a two-click pattern on the delete button (first click sets confirm, second click executes).

## Must-Haves

- [ ] Hooks load on mount and display in the hooks section below config
- [ ] "Create Hook" button opens inline form; save creates hook via API and refreshes list
- [ ] Edit button pre-fills form; save updates hook via API (using old name in URL) and refreshes list
- [ ] Delete requires confirmation before calling API; hook disappears from list on success
- [ ] Enabled toggle calls update API with flipped enabled value
- [ ] Test button calls test endpoint, displays result inline below the hook
- [ ] 409 error on create shows "A hook with this name already exists" in form error banner
- [ ] 404 errors on update/delete handled gracefully (re-fetch list)
- [ ] Loading and error states for the hooks section
- [ ] Hooks section visually separated from read-only config sections

## Verification

- `npm run web:build` passes with zero errors
- `cd web && npm run check` passes (svelte-check)
- Settings page renders both config sections (unchanged) and hooks section below
- All CRUD operations work against running backend: create, edit (including rename), delete, toggle, test-run

## Inputs

- `web/src/routes/settings/+page.svelte` — existing Settings page (read-only config display, ~130 lines)
- `web/src/lib/api/hooks.ts` — API client from T01 (listHooks, createHook, updateHook, deleteHook, testHook)
- `web/src/lib/api/types.ts` — HookDefinition, HookResult types from T01
- `web/src/lib/components/hooks/HookList.svelte` — hook list component from T02
- `web/src/lib/components/hooks/HookForm.svelte` — hook form component from T02
- `web/src/lib/components/hooks/HookTestResult.svelte` — test result component from T02

## Observability Impact

### Signals Changed
- **Hooks CRUD state** is now surfaced as Svelte 5 `$state` variables on the Settings page: `hooks`, `hooksLoading`, `hooksError`, `saving`, `formError`, `testingHook`, `testResults`, `deleteConfirm`. All inspectable via Svelte DevTools or `$inspect()` rune in dev mode.
- **API error visibility**: 409 (duplicate name) and 404 (not found) errors are caught and displayed inline in the form error banner or trigger a silent list re-fetch. Other errors surface via `hooksError` or `formError` state.
- **Test-run results**: `POST /api/hooks/:name/test` responses stored in `testResults` record — visible inline below each hook row with stdout/stderr/exit code/duration.

### Inspection Points
- **Browser DevTools → Network**: All hook operations hit `/api/hooks*` — filter by this prefix to see CRUD traffic and response codes.
- **Browser Console**: `ApiError` instances include `status`, `detail`, and `type` fields if uncaught.
- **Svelte DevTools**: All hook state variables are reactive `$state` — inspectable live in the component tree under `+page.svelte`.

### Failure States
- `hooksError` — non-null when initial hook list fetch fails (network error, server down).
- `formError` — non-null when create/update fails (409 duplicate, validation error, network error).
- `testResults[name].success === false` — test-run failed; stdout/stderr/error visible inline.
- `deleteConfirm` — tracks which hook is awaiting delete confirmation (two-click pattern).

## Expected Output

- `web/src/routes/settings/+page.svelte` — updated with hooks section, CRUD state management, and all handler functions wired to components and API client
