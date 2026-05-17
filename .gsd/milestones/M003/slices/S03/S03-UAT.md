# S03: Hooks Management UI — UAT

**Milestone:** M003
**Written:** 2026-03-19

## UAT Type

- UAT mode: mixed (artifact-driven build verification + live-runtime CRUD testing against running backend)
- Why this mode is sufficient: Build verification proves all types, imports, and component interfaces compile. Live-runtime testing is needed to verify CRUD operations round-trip through the backend API and that test-run output renders correctly.

## Preconditions

- Server running: `DEVICE_FARM_CONFIG=config.dev.yaml npm run dev` (disables device pools, hooks API still available)
- Web app built: `npm run web:build` passes with zero errors
- Browser open to `http://localhost:3000/settings`
- No hooks configured initially (clean state) — or delete existing hooks before starting

## Smoke Test

Navigate to Settings page → scroll below config section → see "LIFECYCLE_HOOKS" section header with icon. If no hooks exist, see "No hooks configured" empty state with "Create your first hook" prompt.

## Test Cases

### 1. Create a new hook

1. Click "Create Hook" button in the hooks section header
2. Inline form appears below the header with fields: Name, Event, Platform, Command, Timeout, Fail on Error, Enabled
3. Fill in: Name = "wifi-on", Event = "device.booted", Platform = "android", Command = `adb -s {{serial}} shell settings put global wifi_on 1`, Timeout = 30, Fail on Error = off, Enabled = on
4. Verify template variable reference box is visible near the command textarea showing `{{device_id}}`, `{{emulator_id}}`, `{{serial}}`, `{{platform}}`, `{{port}}`, `{{job_id}}` with descriptions
5. Click "Save"
6. **Expected:** Form closes, hook "wifi-on" appears in the list with event badge "device.booted", platform badge "android", truncated command preview, and enabled toggle on

### 2. Duplicate name rejection

1. Click "Create Hook" again
2. Enter Name = "wifi-on" (same as the hook just created)
3. Fill remaining required fields (event, command)
4. Click "Save"
5. **Expected:** Form shows error message "A hook named 'wifi-on' already exists" (409 response). Form stays open for correction.

### 3. Edit an existing hook

1. Click the edit (pencil) icon on the "wifi-on" hook row
2. Form appears pre-filled with all current values: name "wifi-on" (disabled input), event "device.booted", platform "android", command with the adb command, timeout 30
3. Change event to "test.before" and platform to "all"
4. Click "Save"
5. **Expected:** Form closes, hook list updates to show event badge "test.before" and platform badge "all"

### 4. Toggle hook enabled/disabled

1. Find the "wifi-on" hook in the list with its toggle switch
2. Click the toggle to disable it
3. **Expected:** Toggle slides to off position, hook row dims (opacity-50). API call PUT to update enabled=false.
4. Click the toggle again to re-enable
5. **Expected:** Toggle slides to on position, row returns to full opacity

### 5. Test-run a hook

1. Click the "Test" (play) icon on the "wifi-on" hook row
2. **Expected:** Button shows a spinner while the test is in progress
3. After completion, a test result panel appears inline below the hook row showing:
   - Success/failure badge
   - Exit code
   - Duration (formatted as ms or seconds)
   - Executed command
   - stdout content (in a pre block)
   - stderr content (in a pre block, if any)
4. **Expected:** If no device is available, test fails gracefully — result panel shows failure with error message, not a crash

### 6. Delete a hook with confirmation

1. Click the delete (trash) icon on the "wifi-on" hook row
2. **Expected:** Action buttons are replaced with "Delete?" label and "Yes" / "No" buttons
3. Click "No"
4. **Expected:** Confirmation dismissed, original action buttons restored, hook still in list
5. Click the delete icon again
6. Click "Yes"
7. **Expected:** Hook removed from list. If it was the last hook, empty state appears with "No hooks configured" message.

### 7. Form cancel

1. Click "Create Hook" to open the form
2. Fill in some fields
3. Click "Cancel"
4. **Expected:** Form closes, no hook created, list unchanged

## Edge Cases

### Empty command validation

1. Open create form
2. Enter name but leave command empty
3. **Expected:** Save button is disabled (cannot submit without required fields)

### Long command preview

1. Create a hook with a command longer than 60 characters
2. **Expected:** Command preview in the list row is truncated to ~60 characters with ellipsis, displayed in monospace font

### Timeout conversion

1. Create a hook with timeout = 60 seconds
2. Edit the same hook
3. **Expected:** Timeout field shows 60 (seconds), not 60000 (ms). The API sends timeoutMs = 60000.

### Delete non-existent hook (race condition)

1. Open Settings in two browser tabs
2. In tab 1, delete a hook
3. In tab 2, try to delete the same hook
4. **Expected:** Tab 2 shows an error (404 not found), not a crash. Hook disappears from list on next refresh.

### Hooks loading error

1. Stop the server while the Settings page is open
2. Navigate away and back to Settings
3. **Expected:** Hooks section shows an error banner (tertiary-colored) indicating the load failed, rather than an empty list with no explanation

## Failure Signals

- Settings page doesn't show "LIFECYCLE_HOOKS" section at all → imports broken or hooks section template missing
- Create form missing fields (no event dropdown, no template variable reference) → HookForm incomplete
- Save button stays enabled with empty required fields → validation logic broken
- Delete removes hook immediately without confirmation → deleteConfirm state not wired
- Test button does nothing / no result panel appears → testHook API call or testResults state not wired
- 409 error on create doesn't show message → formError handling missing
- Hook appears in list but toggle doesn't work → handleToggleEnabled not connected

## Requirements Proved By This UAT

- R038 — Tests 1, 3, 4, 6, 7 prove hook list with name/event/platform/command/toggle and full CRUD with confirmation
- R039 — Tests 1, 3 prove form with all fields (event dropdown, platform selector, command textarea with template variables, timeout, failOnError toggle)
- R040 — Test 5 proves test button triggers dry-run and displays stdout/stderr/exit code/duration

## Not Proven By This UAT

- Hook commands executing during actual lifecycle events (device.booted, test.before, etc.) — that's server-side execution logic, not this UI slice
- Template variable substitution in commands — the UI displays the template reference, but substitution happens server-side during execution
- Server-side validation of hook fields beyond what the API returns — only client-side validation (required fields, duplicate name) is tested

## Notes for Tester

- The server must be running for CRUD operations (tests 1-7) to work. Without a server, only the empty state and form UI can be visually inspected.
- If using `config.dev.yaml` (no device pools), hook test-runs will fail because no device is available — this is expected. Verify the failure is displayed gracefully in the test result panel.
- The 14 svelte-check errors in Nav.svelte and +page.svelte are pre-existing and unrelated to hooks work. They don't affect functionality.
- HookForm's `state_referenced_locally` warnings are intentional — the form captures initial values, not reactive bindings. This is by design.
