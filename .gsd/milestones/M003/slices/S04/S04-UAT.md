# S04: Enriched Device Cards — UAT

**Milestone:** M003
**Written:** 2026-03-19

## UAT Type

- UAT mode: mixed
- Why this mode is sufficient: Type safety and build pass are verified artifact-driven. Metadata display and refresh behavior require live runtime with a booted emulator to confirm real data renders correctly.

## Preconditions

- Server running with at least one Android emulator booted (`npm run dev` or `DEVICE_FARM_CONFIG=config.dev.yaml npm run dev`)
- Web UI accessible at the server's address (default http://localhost:3000)
- At least one device in Idle or Running state (so metadata has been collected)
- Browser DevTools available for network inspection

## Smoke Test

Navigate to `/devices`. Confirm at least one device card shows metadata fields (OS version, resolution, RAM, model, ABI) below the emulator ID. If no metadata appears on any card, the slice is broken.

## Test Cases

### 1. Metadata display on booted device

1. Boot an Android emulator via the server (or ensure one is already idle)
2. Navigate to `/devices`
3. Find the card for the booted device
4. **Expected:** Below the emulator ID, a 2-column grid shows:
   - **OS** — e.g. "Android 15" (not "—")
   - **Resolution** — e.g. "1080×1920" (not "—")
   - **RAM** — e.g. "2048 MB" (not "—")
   - **Model** — e.g. "Pixel 6" (not "—")
   - **ABI** — e.g. "x86_64" (not "—")

### 2. No metadata on offline/error device

1. Navigate to `/devices`
2. Find a device card in Offline or Error state
3. **Expected:** No metadata section appears. Card shows only the standard content (name, platform badge, emulator ID, state badge, relevant action buttons). No empty grids, no "—" labels, no broken spacing.

### 3. Refresh button triggers metadata re-collection

1. Navigate to `/devices`
2. Find a booted device card with metadata visible
3. Open Browser DevTools → Network tab
4. Click the **Refresh** button on the card
5. **Expected:**
   - Button disables and shows spinning refresh icon with "Refreshing…" text
   - Network tab shows `POST /api/devices/:id/info/refresh` request
   - After response, button re-enables and shows "Refresh" text
   - Metadata values update (may be same values if device state hasn't changed)

### 4. Refresh button prevents double-click

1. Navigate to `/devices`
2. Find a booted device card
3. Click the **Refresh** button
4. Immediately click it again while it shows "Refreshing…"
5. **Expected:** Only one `POST /api/devices/:id/info/refresh` request fires (check Network tab). The button is disabled during the request.

### 5. Refresh button on different device states

1. Navigate to `/devices`
2. Check cards in Idle state
3. **Expected:** Refresh button is visible alongside Inspect button
4. Check cards in Running/Allocated/Cleanup state (if any)
5. **Expected:** Refresh button is visible
6. Check cards in Offline/Error/Booting state (if any)
7. **Expected:** No Refresh button visible

### 6. API client type safety

1. Run `npm run web:build`
2. **Expected:** Zero errors, build succeeds
3. Run `npm test`
4. **Expected:** All 311+ tests pass

## Edge Cases

### Device with partial metadata (some fields null)

1. If a device has metadata where some fields are null (e.g. batteryLevel is null but osVersion exists)
2. Navigate to `/devices`
3. **Expected:** Non-null fields show their values; null fields show "—" as fallback. No crashes or layout breaks.

### Server returns error on refresh

1. Simulate a refresh failure (e.g. device goes offline between page load and refresh click)
2. Click the Refresh button
3. **Expected:** Button re-enables after the error. Error surfaces via page-level error handling. Card does not crash or show stale "Refreshing…" state.

### Multiple rapid device list refreshes

1. Navigate to `/devices`
2. Click Refresh on one card, then quickly navigate away and back
3. **Expected:** No orphaned loading states. Cards render correctly on page re-entry.

## Failure Signals

- Device cards show no metadata section even when devices are booted and idle
- Metadata values all show "—" despite device being online (server endpoint returning null metadata)
- Refresh button stays permanently disabled or stuck on "Refreshing…"
- `POST /api/devices/:id/info/refresh` returns 404 or 500 (endpoint mismatch)
- Build fails with TypeScript errors related to DeviceMetadata or Device type
- Layout breaks — empty grids, overflow, or misaligned content when metadata section renders

## Requirements Proved By This UAT

- R041 — Device cards show OS version, screen resolution, RAM, model, ABI from DeviceInfoCollector with refresh button. Test cases 1, 3, 5, and 6 prove this.

## Not Proven By This UAT

- iOS simulator metadata display (only Android emulators are typically available in dev)
- Behavior under high device counts (10+ devices rendering simultaneously)
- Server-side DeviceInfoCollector correctness (this UAT only validates the web client rendering)

## Notes for Tester

- The metadata display depends on the server having collected device info. If you're using `config.dev.yaml` with device pools disabled, cards will show no metadata. You need at least one actual booted emulator.
- The 14 pre-existing svelte-check warnings (Nav.svelte health type) are known and not related to this slice.
- The Refresh button uses `material-symbols-outlined` icon font — if icons don't load (CDN issue), the button will show text only.
