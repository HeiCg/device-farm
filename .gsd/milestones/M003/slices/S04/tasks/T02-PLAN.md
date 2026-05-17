---
estimated_steps: 6
estimated_files: 3
---

# T02: Enhance DeviceCard with metadata display and refresh button

**Slice:** S04 — Enriched Device Cards
**Milestone:** M003

## Description

The DeviceCard component currently shows device name, platform, emulator ID, and state-specific actions (inspect, restart). This task adds a metadata section displaying OS version, screen resolution, RAM, model, and ABI from the `device.metadata` field (populated by T01's type extension). It also adds a refresh button for on-demand metadata re-collection, and wires the refresh handler through the devices page. This is the user-facing deliverable for requirement R041.

**Relevant skill:** `frontend-design` — load if you need guidance on Tailwind or component styling patterns. Follow the existing design system conventions in the component (glass cards, tonal layering, `text-on-surface-variant` for secondary info).

## Steps

1. In `DeviceCard.svelte`, update the props to add `onrefresh?: (id: string) => void` alongside the existing `onrestart`. The destructuring becomes: `let { device, onrestart, onrefresh }: { device: Device; onrestart?: (id: string) => void; onrefresh?: (id: string) => void } = $props();`

2. Add a metadata display section. Use `$derived` to check `device.metadata` existence. When metadata is non-null, render a compact grid/list below the platform badge showing:
   - **OS**: `device.metadata.osVersion` (e.g. "Android 15") — if null, show "—"
   - **Resolution**: `${device.metadata.screenWidth}×${device.metadata.screenHeight}` — if either null, show "—"
   - **RAM**: `${device.metadata.ramMb} MB` — if null, show "—"
   - **Model**: `device.metadata.model` (e.g. "Pixel 6") — if null, show "—"
   - **ABI**: `device.metadata.abi` (e.g. "x86_64") — if null, show "—"
   
   Style with `text-xs text-on-surface-variant` for labels and `text-xs text-on-surface font-mono` for values. Use a 2-column grid layout (`grid grid-cols-2 gap-x-3 gap-y-1`). Wrap the section in a conditional: `{#if device.metadata}...{/if}`.

3. Add a refresh button below the metadata section (or alongside existing action buttons). Use the same inline button pattern as the Inspect button: `class="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-primary bg-primary/10 border border-primary/20 rounded-lg hover:bg-primary/15 transition-colors"`. Material icon: `refresh`. Label: "Refresh". Only show when `onrefresh` is provided. Wire `onclick={() => onrefresh?.(device.id)}`. Add a `refreshing` local state (`let refreshing = $state(false)`) to show a spinner/disabled state during the API call — the parent handles the actual call, but the button should disable itself to prevent double-clicks.

4. Position the metadata section logically in the card. It should appear for **all device states where the emulator has booted** (idle, allocated, running, cleanup). For offline, error, and booting states, metadata is likely null so the `{#if device.metadata}` check handles it naturally. Don't duplicate the metadata block across all state branches — place it as a shared section before or after the state-specific content block.

5. In `web/src/routes/devices/+page.svelte`:
   - Import `refreshDeviceInfo` from `$lib/api/devices.js`
   - Add `handleRefresh(id: string)` async function that calls `await refreshDeviceInfo(id)` then `await fetchDevices()` to update the device list
   - Pass `onrefresh={handleRefresh}` to each `<DeviceCard>` alongside the existing `onrestart={handleRestart}`

6. Ensure all Tailwind classes are complete static strings per D016 (no template interpolation for colors/styles). All existing classes in DeviceCard already follow this pattern — maintain it for new additions.

## Must-Haves

- [ ] Device cards show OS version, resolution, RAM, model, ABI when `device.metadata` is non-null
- [ ] Cards with null metadata display cleanly — no empty sections or broken layout
- [ ] Refresh button appears on each card and calls `refreshDeviceInfo` then re-fetches device list
- [ ] All Tailwind classes are full static strings (D016)
- [ ] Svelte 5 reactivity: use `$derived` for computed display values (D017)
- [ ] `npm run web:build` passes
- [ ] `npx svelte-check` passes

## Verification

- `npm run web:build` passes with zero errors
- `npx svelte-check --tsconfig web/tsconfig.json` reports no type errors
- `npm test` — all existing 300+ tests pass
- Visual inspection: device cards show metadata fields when metadata is present; absent metadata shows no broken UI; refresh button is visible and matches existing button styling

## Inputs

- `web/src/lib/api/types.ts` — T01 added `DeviceMetadata` interface, extended `Device` with `metadata` field
- `web/src/lib/api/devices.ts` — T01 added `refreshDeviceInfo(id)` function
- `web/src/lib/components/devices/DeviceCard.svelte` — existing card with props `{ device, onrestart }`, state-conditional rendering sections, Material Symbols icons, Tailwind styling with static Record lookups
- `web/src/routes/devices/+page.svelte` — existing page with 5-second polling, `handleRestart(id)` pattern to follow for `handleRefresh(id)`
- Design conventions: `bg-primary/10 border-primary/20` for action buttons, `text-on-surface-variant` for secondary text, `font-mono` for technical values

## Observability Impact

- **New UI signal:** Device cards display metadata fields (OS, resolution, RAM, model, ABI) when `device.metadata` is non-null — visible at `/devices`.
- **Refresh button:** Triggers `POST /api/devices/:id/info/refresh` followed by `GET /api/devices` — both visible in browser DevTools Network tab.
- **Failure visibility:** If metadata is null (device not booted or collection failed), the metadata section is hidden entirely — no empty grids or broken layout. If the refresh POST fails, `ApiError` propagates to the UI handler; the refresh button re-enables after failure via `finally` block.
- **Inspection:** `device.metadata` payload visible in the `GET /api/devices` response JSON. Refresh button disabled state visible during in-flight request (prevents double-clicks).

## Expected Output

- `web/src/lib/components/devices/DeviceCard.svelte` — enhanced with metadata display section and refresh button
- `web/src/routes/devices/+page.svelte` — wires `handleRefresh` and passes `onrefresh` to DeviceCard
