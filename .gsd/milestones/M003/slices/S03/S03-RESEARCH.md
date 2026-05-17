# S03: Hooks Management UI — Research

**Date:** 2026-03-19
**Depth:** Light — CRUD UI wiring to existing backend endpoints with established design patterns.

## Summary

S03 adds a Hooks management section to the Settings page. The backend is fully built: `server/hooks/plugin.ts` exposes five routes — `GET /api/hooks` (list), `POST /api/hooks` (create), `PUT /api/hooks/:name` (update), `DELETE /api/hooks/:name` (delete), and `POST /api/hooks/:name/test` (dry-run). The `HookExecutor` class manages in-memory hook state with template variable interpolation (`{{device_id}}`, `{{serial}}`, etc.) and timeout-bounded shell execution. Zod validation on the server already enforces all field constraints (name 1-255 chars, command 1-4096 chars, timeout 1s-300s, event enum, platform enum).

The web UI needs: a typed API client module, `HookDefinition`/`HookResult` types in the shared types file, and a hooks section on the Settings page with list, create/edit form, enabled toggle, delete with confirmation, and test-run result display. No modal/dialog pattern exists in the codebase yet — inline expansion (form appears in-place within the hooks section) is the simplest approach and consistent with the Settings page's current flat layout.

## Recommendation

Build as inline CRUD within the Settings page. No routing changes needed — hooks section lives below the existing config sections on `/settings`. Use an inline form panel that expands/collapses for create/edit (not a modal), since the codebase has no modal infrastructure and introducing one for a single use adds unnecessary complexity. The test-run result should render inline below the hook row when triggered.

## Implementation Landscape

### Key Files

- **`server/hooks/plugin.ts`** — Backend CRUD routes. Defines `hookDefinitionSchema` (Zod) with all field validation. Routes: `GET /api/hooks`, `POST /api/hooks`, `PUT /api/hooks/:name`, `DELETE /api/hooks/:name`, `POST /api/hooks/:name/test`. Read-only reference; do not modify.
- **`server/hooks/hook-executor.ts`** — `HookDefinition` and `HookResult` interfaces. Template variables: `device_id`, `emulator_id`, `serial`, `platform`, `port`, `job_id`. Events: `device.booted`, `device.shutdown`, `test.before`, `test.after`. Platforms: `android`, `ios`, `all`. Read-only reference; do not modify.
- **`web/src/lib/api/types.ts`** — Client-side types. Needs `HookDefinition`, `HookResult`, and `HookEvent` types added (mirroring server types).
- **`web/src/lib/api/client.ts`** — `apiFetch<T>()` wrapper with auth headers and RFC 7807 error handling. All new API calls use this.
- **`web/src/lib/api/hooks.ts`** — New file. API client module for hooks CRUD + test-run. Follow the pattern of `devices.ts` and `maestro.ts` (thin wrappers around `apiFetch`).
- **`web/src/routes/settings/+page.svelte`** — Existing Settings page (read-only config display). The hooks section is added below the existing grid. Currently 130 lines.
- **`web/src/lib/components/hooks/HookList.svelte`** — New component. Table/list of hooks with name, event, platform, command preview, enabled toggle, edit/delete/test actions.
- **`web/src/lib/components/hooks/HookForm.svelte`** — New component. Create/edit form with: event dropdown, platform selector, command textarea, timeout input, failOnError toggle, enabled toggle. Template variable reference/help text.
- **`web/src/lib/components/hooks/HookTestResult.svelte`** — New component. Displays stdout, stderr, exit code, duration from test-run response.

### Patterns to Follow

- **Svelte 5 runes**: `$state`, `$derived`, `$effect` — no legacy `let:` or `$:` syntax. See any existing component.
- **Props**: `let { ... } = $props()` destructuring pattern (see `DeviceCard.svelte`, `StatusBadge.svelte`).
- **Static Tailwind classes**: Full class strings in `Record<string, string>` lookups — no template interpolation (D016, Knowledge Base entry).
- **Design tokens**: `bg-surface-container-low`, `border-white/5`, `text-on-surface`, `text-on-surface-variant`, `font-headline`, `tracking-widest`, `text-[10px]` for labels, Material Symbols Outlined for icons.
- **Form inputs**: Follow `login/+page.svelte` pattern — `bg-surface-container-low border border-outline-variant/10 rounded-lg text-on-surface focus:ring-2 focus:ring-primary/40 focus:border-primary/30`.
- **Section headers**: Icon in `bg-primary/10 rounded-lg` + `font-headline font-bold text-sm tracking-widest text-on-surface` (see Settings config sections).
- **Error display**: `bg-tertiary/10 border border-tertiary/20 text-tertiary` (see login page error pattern).
- **API client pattern**: Export named async functions wrapping `apiFetch`, one per endpoint (see `devices.ts`).

### Build Order

1. **Types + API client** — Add `HookDefinition`, `HookResult`, `HookEvent` to `types.ts`. Create `hooks.ts` API client. This is foundational and unblocks all UI work.
2. **HookList component** — Renders the hook table with enabled toggle, action buttons. This is the primary display.
3. **HookForm component** — Create/edit form with all fields. Depends on types being defined.
4. **HookTestResult component** — Test result display panel. Independent of form.
5. **Settings page integration** — Wire HookList + HookForm + HookTestResult into Settings page with state management for CRUD operations (selected hook, editing mode, test results).

### Verification Approach

- `npm run web:build` passes with zero errors — confirms TypeScript types are correct and all imports resolve.
- `npx svelte-check` (if available) for Svelte-specific type checking.
- Manual verification: Settings page renders hooks section, form fields match R039 spec, test result panel shows structured output.
- API contract: verify API client functions match server route signatures (method, path, body shape, response shape) by comparing to `server/hooks/plugin.ts`.

## Constraints

- **No modals in codebase** — No existing dialog/modal component or pattern. Building one just for hooks is overkill; use inline form expansion instead.
- **Tailwind v4 JIT** — All class names must be full static strings. No `bg-${color}/10` interpolation. Use `Record<string, string>` lookups for any dynamic styling (D016, Knowledge Base).
- **Svelte 5 only** — Must use runes (`$state`, `$derived`), not Svelte 4 reactive declarations (`$:`).
- **Settings page currently read-only** — Adding interactive CRUD is a departure from the existing read-only config display. The hooks section should be visually distinct (separate section header, clear "writable" affordance) so users understand hooks are editable while config is not.

## Common Pitfalls

- **409 Conflict on duplicate names** — Server returns 409 if a hook name already exists on create. The form must handle this error and display it clearly (not a generic error).
- **PUT replaces by name** — `PUT /api/hooks/:name` uses the URL param `:name` to find the old hook and the body `name` field for the new hook. If renaming a hook, the URL param is the old name and the body contains the new name. The API client must accept both old and new names.
- **Test-run needs device context** — `POST /api/hooks/:name/test` accepts an optional `deviceId` body param. Without it, the server uses synthetic test context (`emulator-5554`, etc.). The UI should offer a device picker when devices are available, but work without one.
- **Template variable display** — R039 specifies a "template variable reference" in the form. Show `{{device_id}}`, `{{emulator_id}}`, `{{serial}}`, `{{platform}}`, `{{port}}`, `{{job_id}}` as copyable hints near the command textarea.
