# S04: Enriched Device Cards

**Goal:** Device cards on the Devices page display real metadata collected from running emulators (OS version, screen resolution, RAM, model, ABI) with an on-demand refresh button.
**Demo:** Navigate to `/devices`. Each booted device card shows OS version, resolution, RAM, model, and ABI below the platform badge. Click the refresh button on a card — metadata re-collects from the device and updates immediately.

## Must-Haves

- `DeviceMetadata` type in web client mirrors server's `DeviceMetadata` interface exactly (13 fields + `collectedAt`)
- `Device` type extended with `metadata: DeviceMetadata | null`, `port: number | null`, `pid: number | null` to match server `DeviceInfo`
- API client functions `fetchDeviceInfo(id)` and `refreshDeviceInfo(id)` calling `GET/POST /api/devices/:id/info[/refresh]`
- DeviceCard shows metadata fields (OS version, resolution, RAM, model, ABI) when metadata is non-null
- Graceful display when metadata is null (no empty sections or broken layout)
- Refresh button on each card triggers metadata re-collection from the device
- All Tailwind classes are full static strings in Record lookups (D016)

## Verification

- `npm run web:build` passes with zero errors
- `npx svelte-check --tsconfig web/tsconfig.json` reports no type errors
- `npm test` — all existing 300+ tests pass (no regressions)
- Visual inspection: device cards show metadata fields when a device has been booted; cards without metadata display cleanly without empty sections

## Tasks

- [x] **T01: Add DeviceMetadata type and device info API functions** `est:20m`
  - Why: The web client's `Device` type is missing `metadata`, `port`, and `pid` fields that the server already returns. No API functions exist for the per-device info or refresh endpoints. This unblocks the card UI with type safety.
  - Files: `web/src/lib/api/types.ts`, `web/src/lib/api/devices.ts`
  - Do: (1) Add `DeviceMetadata` interface mirroring `server/types/index.ts` lines 13-28 exactly (osVersion, sdkVersion, screenWidth, screenHeight, screenDensity, ramMb, abi, manufacturer, model, locale, timezone, batteryLevel, collectedAt). (2) Extend `Device` interface to add `metadata: DeviceMetadata | null`, `port: number | null`, `pid: number | null`. (3) Add `fetchDeviceInfo(id)` returning `Promise<{ device: Device; metadata: DeviceMetadata | null }>` hitting `GET /api/devices/${id}/info`. (4) Add `refreshDeviceInfo(id)` returning `Promise<{ deviceId: string; metadata: DeviceMetadata }>` hitting `POST /api/devices/${id}/info/refresh`.
  - Verify: `npx svelte-check --tsconfig web/tsconfig.json` reports zero errors; `npm run web:build` succeeds
  - Done when: `DeviceMetadata` type exists, `Device` has `metadata` field, both API functions compile clean

- [x] **T02: Enhance DeviceCard with metadata display and refresh button** `est:40m`
  - Why: This is the user-facing deliverable for R041. Cards currently show only name, platform badge, emulator ID, and state-specific content. They need a metadata section showing the 5 key fields and a refresh button.
  - Files: `web/src/lib/components/devices/DeviceCard.svelte`, `web/src/routes/devices/+page.svelte`, `web/src/lib/api/devices.ts` (import only)
  - Do: (1) In DeviceCard.svelte, add `onrefresh?: (id: string) => void` prop following the existing `onrestart` pattern. (2) Add a metadata display section below the emulator ID showing: OS version (e.g. "Android 15"), screen resolution (e.g. "1080×1920"), RAM (e.g. "2048 MB"), model (e.g. "Pixel 6"), ABI (e.g. "x86_64"). Use `$derived` to compute display strings from `device.metadata`. Show this section only when `device.metadata` is non-null. (3) Add a refresh button (material icon `refresh`, inline button matching existing `bg-primary/10 border-primary/20` pattern) that calls `onrefresh?.(device.id)`. (4) All conditional styles in static Record lookups per D016. (5) In `+page.svelte`, add `handleRefresh(id)` that calls `refreshDeviceInfo(id)` then `fetchDevices()`, and pass `onrefresh={handleRefresh}` to each DeviceCard. (6) Import `refreshDeviceInfo` in `+page.svelte`.
  - Verify: `npm run web:build` passes; `npx svelte-check --tsconfig web/tsconfig.json` clean; `npm test` all green; visual inspection confirms metadata renders on booted device cards
  - Done when: Device cards display metadata when available, refresh button triggers re-collection, build and checks pass

## Observability / Diagnostics

- **Runtime signals:** `refreshDeviceInfo(id)` calls `POST /api/devices/:id/info/refresh` — the server returns fresh `DeviceMetadata` or an RFC 7807 error. Network failures surface via `ApiError` in the client with status code and detail string.
- **Inspection surfaces:** Browser DevTools Network tab shows `/api/devices/:id/info` and `/api/devices/:id/info/refresh` calls. The `DeviceMetadata` payload is visible in the response JSON. The `Device` objects returned by `GET /api/devices` now include `metadata`, `port`, and `pid` fields.
- **Failure visibility:** If metadata collection fails server-side, `metadata` is `null` on the device — cards render gracefully without a metadata section. If the refresh POST fails, the `ApiError` propagates to the UI handler. No silent swallowing of errors.
- **Redaction constraints:** None — device metadata (OS version, screen res, RAM, model) contains no secrets or PII.

## Files Likely Touched

- `web/src/lib/api/types.ts`
- `web/src/lib/api/devices.ts`
- `web/src/lib/components/devices/DeviceCard.svelte`
- `web/src/routes/devices/+page.svelte`
