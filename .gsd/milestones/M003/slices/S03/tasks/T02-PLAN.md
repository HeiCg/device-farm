---
estimated_steps: 6
estimated_files: 3
---

# T02: Build HookList, HookForm, and HookTestResult components

**Slice:** S03 — Hooks Management UI
**Milestone:** M003

## Description

Create the three UI components for hooks management: a list/table of hooks with action buttons, a create/edit form, and a test result display panel. All use Svelte 5 runes (`$state`, `$derived`, `$props`), Tailwind v4 design tokens, and Material Symbols Outlined icons. These components communicate via callback props — the parent (Settings page, T03) owns the state.

**Relevant skills:** `frontend-design` — load this skill for design quality guidance

## Steps

1. Create `web/src/lib/components/hooks/HookList.svelte` with these props (use `let { ... } = $props()` destructuring):
   ```
   hooks: HookDefinition[]
   onEdit: (hook: HookDefinition) => void
   onDelete: (name: string) => void
   onTest: (name: string) => void
   onToggleEnabled: (name: string, enabled: boolean) => void
   testingHook: string | null
   testResults: Record<string, HookResult>
   ```
   Render a table/list where each row shows:
   - Hook name (primary text)
   - Event badge (e.g. `device.booted`) — use static Tailwind class lookups per event (D016). Color scheme: `device.booted` → secondary, `device.shutdown` → tertiary, `test.before` → primary, `test.after` → on-surface-variant
   - Platform badge (`android` / `ios` / `all`)
   - Command preview — first ~60 chars of the command, monospaced, truncated with ellipsis
   - Enabled toggle — a toggle/switch or checkbox that calls `onToggleEnabled(hook.name, !hook.enabled)`. When disabled, the row should appear dimmed (e.g. `opacity-50`)
   - Action buttons: Edit (icon: `edit`), Test (icon: `play_arrow`, disabled+spinning when `testingHook === hook.name`), Delete (icon: `delete`, tertiary color)
   - If `testResults[hook.name]` exists, render `HookTestResult` inline below that row
   - Empty state when `hooks.length === 0`: centered message "No hooks configured" with a muted icon

   Section header style: icon in `bg-primary/10 rounded-lg` + `font-headline font-bold text-sm tracking-widest text-on-surface` label "LIFECYCLE_HOOKS". Include a "Create Hook" button (icon: `add`) in the header row, right-aligned.

2. Create `web/src/lib/components/hooks/HookForm.svelte` with these props:
   ```
   hook: HookDefinition | null    // null = create mode, non-null = edit mode (pre-fill)
   onSave: (hook: HookDefinition) => void
   onCancel: () => void
   saving: boolean
   error: string | null
   ```
   Form fields (all required per R039):
   - **Name** — text input, required, max 255 chars
   - **Event** — `<select>` dropdown with 4 options: `device.booted`, `device.shutdown`, `test.before`, `test.after`
   - **Platform** — `<select>` or radio group: `android`, `ios`, `all` (default: `all`)
   - **Command** — `<textarea>` for the shell command, required, max 4096 chars, monospace font
   - **Template variable reference** — below the command textarea, show a help box listing available variables: `{{device_id}}`, `{{emulator_id}}`, `{{serial}}`, `{{platform}}`, `{{port}}`, `{{job_id}}` with brief descriptions. Style: `bg-surface-container rounded-lg p-3 text-xs text-on-surface-variant`. Each variable in `font-mono text-primary`
   - **Timeout** — number input in seconds (display as seconds, convert to/from ms for the API: `timeoutMs = seconds * 1000`). Default: 30. Min: 1, Max: 300
   - **Fail on Error** — toggle/checkbox. Default: false
   - **Enabled** — toggle/checkbox. Default: true

   Form input styling (from login page pattern):
   `bg-surface-container-low border border-outline-variant/10 rounded-lg text-on-surface focus:ring-2 focus:ring-primary/40 focus:border-primary/30 px-3 py-2 text-sm`

   Buttons: "Save" (primary, shows spinner when `saving`), "Cancel" (ghost/outlined).
   If `error` is non-null, show error banner: `bg-tertiary/10 border border-tertiary/20 text-tertiary rounded-lg px-4 py-3 text-sm`.
   If `hook` is non-null, pre-fill all fields from it (edit mode). Title: "Edit Hook" vs "Create Hook".

   Internal state: use `$state` for each form field. On save, construct a `HookDefinition` object and call `onSave(hook)`. Convert timeout from seconds to ms.

3. Create `web/src/lib/components/hooks/HookTestResult.svelte` with props:
   ```
   result: HookResult
   ```
   Display:
   - Success/failure badge: green "SUCCESS" if `result.success`, red "FAILED" otherwise. Use static class lookups (D016).
   - Exit code: `result.exitCode`
   - Duration: `result.durationMs` formatted as e.g. "1.2s" or "340ms"
   - Stdout: if non-empty, show in a `<pre>` block with `bg-surface-container rounded-lg p-3 font-mono text-xs max-h-40 overflow-auto`
   - Stderr: if non-empty, show similarly but with `text-tertiary` styling
   - Interpolated command: `result.command` shown in monospace as "Executed command"
   - If `result.error` is present, show it in the error banner style

   Overall container: `bg-surface-container-low rounded-lg border border-white/5 p-4 mt-2`

4. Ensure all imports use `.js` extensions. Import types from `$lib/api/types.js`.

5. **Tailwind constraint (D016):** All dynamic class selection must use `Record<string, string>` lookups with full static class strings. For example, event badge colors:
   ```typescript
   const eventStyles: Record<string, string> = {
     'device.booted': 'bg-secondary/10 text-secondary border-secondary/20',
     'device.shutdown': 'bg-tertiary/10 text-tertiary border-tertiary/20',
     'test.before': 'bg-primary/10 text-primary border-primary/20',
     'test.after': 'bg-on-surface-variant/10 text-on-surface-variant border-on-surface-variant/20',
   };
   ```

6. Run `npm run web:build` to verify all three components compile.

## Must-Haves

- [ ] HookList renders hooks with name, event badge, platform badge, command preview, enabled toggle, and edit/delete/test action buttons
- [ ] HookList has empty state for zero hooks
- [ ] HookList renders HookTestResult inline below a hook when test result is available
- [ ] HookForm has all R039 fields: event dropdown (4 events), platform selector, command textarea, template variable reference, timeout input, failOnError toggle, enabled toggle
- [ ] HookForm supports create mode (empty) and edit mode (pre-filled from existing hook)
- [ ] HookForm converts timeout between seconds (display) and milliseconds (API)
- [ ] HookTestResult displays stdout, stderr, exit code, duration, and success/failure indicator
- [ ] All dynamic styling uses static Tailwind class lookups (D016)
- [ ] All components use Svelte 5 runes ($state, $derived, $props)

## Verification

- `npm run web:build` passes with zero errors
- Each component file is syntactically valid Svelte 5 with correct TypeScript typing
- Visually inspect that component markup follows existing design token patterns

## Observability Impact

- **Component inspection**: All three components use Svelte 5 `$state` and `$props` — inspectable via Svelte DevTools or `$inspect()` rune in dev mode.
- **HookList signals**: The `testingHook` prop shows which hook is currently being tested (spinner visible), and `testResults` record shows inline test output — both inspectable in parent state.
- **HookForm validation**: Form fields are local `$state` — on save, the constructed `HookDefinition` is passed to `onSave` callback. The `error` prop surfaces API errors inline in a styled banner.
- **HookTestResult output**: Renders stdout/stderr/exitCode/durationMs from `HookResult` — the raw data from `POST /api/hooks/:name/test` made visible to the user.
- **Failure visibility**: No new runtime failure modes — these are pure presentational components. Failures surface via the parent's API error handling (T03).

## Inputs

- `web/src/lib/api/types.ts` — `HookDefinition`, `HookResult`, `HookEvent` types from T01
- `web/src/routes/login/+page.svelte` — form input styling reference
- `web/src/routes/settings/+page.svelte` — section header and layout pattern reference
- `web/src/lib/components/devices/DeviceCard.svelte` — Svelte 5 `$props()` pattern reference

## Expected Output

- `web/src/lib/components/hooks/HookList.svelte` — hook list with actions, section header, empty state
- `web/src/lib/components/hooks/HookForm.svelte` — create/edit form with all R039 fields and template variable reference
- `web/src/lib/components/hooks/HookTestResult.svelte` — test result display panel
