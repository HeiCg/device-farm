# S03: Hooks Management UI

**Goal:** Users can manage lifecycle hooks from the Settings page — create, edit, toggle, delete, and test-run hooks with full visibility into results.
**Demo:** Open Settings → Hooks section shows a list of configured hooks. Click "Create Hook" → inline form appears with event dropdown, platform selector, command textarea (with template variable reference), timeout, failOnError toggle. Save → hook appears in list. Toggle enabled. Click "Test" → stdout/stderr/exit code/duration displayed inline. Edit a hook → form pre-fills. Delete with confirmation → hook removed.

## Must-Haves

- Hook list displaying name, event, platform, command preview, and enabled toggle (R038)
- Create/edit inline form with event dropdown (4 events), platform selector (android/ios/all), command textarea with `{{template}}` variable reference, timeout input, failOnError toggle (R039)
- Test button per hook that calls `POST /api/hooks/:name/test` and displays stdout, stderr, exit code, and duration (R040)
- Delete with confirmation dialog/prompt
- Error handling: 409 duplicate name on create, 404 on update/delete, validation errors
- Hooks section visually distinct from read-only config sections on Settings page

## Verification

- `npm run web:build` — TypeScript compiles, all imports resolve, zero errors
- `cd web && npm run check` — svelte-check passes with no type errors
- Visual: Settings page has a "LIFECYCLE_HOOKS" section below config, showing hook list with all CRUD actions functional against running backend

## Integration Closure

- Upstream surfaces consumed: `server/hooks/plugin.ts` API routes (5 endpoints), `web/src/lib/api/client.ts` (apiFetch wrapper), `web/src/lib/api/types.ts` (shared types)
- New wiring introduced: `web/src/lib/api/hooks.ts` API client, 3 new Svelte components in `web/src/lib/components/hooks/`, hooks section in Settings page
- What remains before the milestone is truly usable end-to-end: S04 (device cards), S05 (debug artifacts) — independent of this slice

## Tasks

- [x] **T01: Add hook types and API client** `est:20m`
  - Why: All UI components depend on typed API calls. Types mirror the server's `HookDefinition`, `HookResult`, and `HookEvent`. The API client wraps the 5 existing backend endpoints. This is foundational and must land first.
  - Files: `web/src/lib/api/types.ts`, `web/src/lib/api/hooks.ts`
  - Do: Add `HookEvent`, `HookDefinition`, `HookResult` types to `types.ts` (mirror `server/hooks/hook-executor.ts`). Create `hooks.ts` with `listHooks()`, `createHook()`, `updateHook(oldName, hook)`, `deleteHook(name)`, `testHook(name, deviceId?)` — all wrapping `apiFetch`. For `updateHook`, the `oldName` param goes in the URL path and the full hook body (which may have a new name) goes in the request body.
  - Verify: `npm run web:build` passes; `hooks.ts` exports match the 5 server routes in `server/hooks/plugin.ts`
  - Done when: Types and API client compile cleanly and match the server's route signatures (method, path, body shape, response shape)

- [x] **T02: Build HookList, HookForm, and HookTestResult components** `est:1h`
  - Why: These three components are the visual layer for R038/R039/R040. HookList renders the hook table with actions. HookForm provides the create/edit inline form. HookTestResult displays test-run output. Building them together ensures consistent interfaces.
  - Files: `web/src/lib/components/hooks/HookList.svelte`, `web/src/lib/components/hooks/HookForm.svelte`, `web/src/lib/components/hooks/HookTestResult.svelte`
  - Do: Build all three components following existing design patterns (Tailwind tokens, Material Symbols icons, Svelte 5 runes). Component interfaces — **HookList** props: `hooks: HookDefinition[]`, `onEdit: (hook) => void`, `onDelete: (name) => void`, `onTest: (name) => void`, `onToggleEnabled: (name, enabled) => void`, `testingHook: string | null`, `testResults: Record<string, HookResult>`. **HookForm** props: `hook: HookDefinition | null` (null = create mode), `onSave: (hook) => void`, `onCancel: () => void`, `saving: boolean`, `error: string | null`. **HookTestResult** props: `result: HookResult`. Use static Tailwind class lookups for dynamic styling (D016). Template variable reference near command textarea showing `{{device_id}}`, `{{emulator_id}}`, `{{serial}}`, `{{platform}}`, `{{port}}`, `{{job_id}}`. Form inputs follow login page pattern: `bg-surface-container-low border border-outline-variant/10 rounded-lg text-on-surface focus:ring-2 focus:ring-primary/40`.
  - Verify: `npm run web:build` passes with all three components importing correctly
  - Done when: All three components render with correct props interfaces, form includes all R039 fields, test result shows all R040 output fields

- [x] **T03: Wire hooks section into Settings page with CRUD state management** `est:45m`
  - Why: The components from T02 are inert until wired into the Settings page with state management. This task adds the hooks section below existing config, manages CRUD lifecycle (loading, create/edit mode, delete confirmation, test execution), and handles all error states.
  - Files: `web/src/routes/settings/+page.svelte`
  - Do: Import HookList, HookForm, HookTestResult, and API functions. Add a "LIFECYCLE_HOOKS" section below the existing config grid, visually distinct with its own section header (icon in `bg-primary/10 rounded-lg` + `font-headline` label). State management: `hooks` array loaded on mount via `listHooks()`, `showForm` boolean, `editingHook: HookDefinition | null`, `saving` boolean, `formError: string | null`, `testingHook: string | null`, `testResults: Record<string, HookResult>`, `deleteConfirm: string | null`. Wire handlers: create (POST, handle 409), edit (PUT with old name), delete (with inline confirmation prompt before DELETE), toggle enabled (PUT to flip `enabled`), test (POST test-run, store result). Show HookForm inline when creating/editing. Show HookTestResult inline below the tested hook's row. Empty state when no hooks exist with "Create your first hook" prompt.
  - Verify: `npm run web:build` passes; `cd web && npm run check` passes; visually the Settings page shows hooks section with create/edit/delete/toggle/test working against running backend
  - Done when: Settings page renders hooks section with full CRUD lifecycle, all three requirements (R038, R039, R040) are delivered, error states handled (409 duplicate, 404 not found, validation)

## Observability / Diagnostics

### Runtime Signals
- **API errors surfaced to UI**: All `apiFetch` calls throw `ApiError` with RFC 7807 fields (status, detail, type). The hooks UI displays `formError` state inline with the form for 400/409/404 errors.
- **Network requests visible in DevTools**: All hook CRUD operations hit `/api/hooks*` endpoints — filterable in browser Network tab.
- **Test-run output**: `POST /api/hooks/:name/test` returns `HookResult` with stdout, stderr, exitCode, durationMs — displayed inline below the tested hook row.

### Inspection Surfaces
- **Browser console**: `ApiError` instances include status code and detail message; uncaught errors logged automatically.
- **Server logs**: Hook plugin logs all CRUD operations and test runs via pino (component: `hook-executor`).
- **State inspection**: Hooks state is local Svelte 5 `$state` — inspectable via Svelte DevTools or `$inspect()` rune in dev mode.

### Failure Visibility
- **409 Conflict**: Duplicate hook name on create → form shows "A hook named '...' already exists".
- **404 Not Found**: Update/delete/test of non-existent hook → error toast or inline message.
- **400 Validation**: Missing/invalid fields → server returns Zod issue details, displayed in form error state.
- **Network failure**: `apiFetch` throws on non-OK responses; unhandled fetch errors surface as browser console errors.

### Redaction Constraints
- Hook commands may contain secrets in template variables or hardcoded values. No redaction is applied client-side — commands are displayed as-is. Server-side redaction (if any) is outside this slice's scope.

## Files Likely Touched

- `web/src/lib/api/types.ts` — add HookEvent, HookDefinition, HookResult types
- `web/src/lib/api/hooks.ts` — new API client for hooks CRUD + test-run
- `web/src/lib/components/hooks/HookList.svelte` — new hook list component
- `web/src/lib/components/hooks/HookForm.svelte` — new create/edit form component
- `web/src/lib/components/hooks/HookTestResult.svelte` — new test result display component
- `web/src/routes/settings/+page.svelte` — wire hooks section into existing page
