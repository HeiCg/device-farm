# S04: Enriched Device Cards — Research

**Date:** 2026-03-19

## Summary

This is a straightforward UI wiring slice. The entire backend is already built: `DeviceInfoCollector` collects OS version, screen resolution, RAM, model, ABI, etc. via adb/xcrun. The `Device` class stores `metadata: DeviceMetadata | null`. The `GET /api/devices` endpoint already returns metadata in each device's `toInfo()` response. Dedicated endpoints exist at `GET /api/devices/:id/info` and `POST /api/devices/:id/info/refresh` for per-device metadata access and forced re-collection.

The work is: (1) add the `DeviceMetadata` type to the web client, (2) extend the `Device` interface to include `metadata`, (3) add API functions for info/refresh, (4) enhance `DeviceCard.svelte` to display the metadata fields and offer a refresh button.

## Recommendation

Follow the existing patterns exactly. The `Device` type in `web/src/lib/api/types.ts` is missing `metadata`, `port`, and `pid` fields that the server already returns. Add `DeviceMetadata` interface (mirroring `server/types/index.ts`) and extend `Device`. The card enhancement should add a collapsible or always-visible metadata section using the same Tailwind styling conventions (glass cards, tonal layering, `text-on-surface-variant` for secondary info). The refresh button should follow the same inline icon-button pattern used by the existing "Inspect" and "RESTART" buttons on `DeviceCard.svelte`.

## Implementation Landscape

### Key Files

- `server/types/index.ts` (lines 13-28) — `DeviceMetadata` interface definition. This is the source of truth for the type shape. Mirror exactly in the web client.
- `server/pool/device-info-collector.ts` — Backend collector. No changes needed. Returns `DeviceMetadata` with fields: `osVersion`, `sdkVersion`, `screenWidth`, `screenHeight`, `screenDensity`, `ramMb`, `abi`, `manufacturer`, `model`, `locale`, `timezone`, `batteryLevel`, `collectedAt`.
- `server/pool/device.ts` — `Device` class with `metadata: DeviceMetadata | null` field, exposed via `toInfo()`.
- `server/maestro/plugin.ts` (lines 160-190) — `GET /api/devices/:id/info` returns `{ device, metadata }`. `POST /api/devices/:id/info/refresh` re-collects and returns `{ deviceId, metadata }`.
- `server/api/routes.ts` (line 272) — `GET /api/devices` calls `pool.getDevices()` which returns `DeviceInfo[]` including `metadata`.
- `web/src/lib/api/types.ts` — **Needs change.** Add `DeviceMetadata` interface. Extend `Device` to add `metadata: DeviceMetadata | null` (also `port: number | null` and `pid: number | null` to match server `DeviceInfo`).
- `web/src/lib/api/devices.ts` — **Needs change.** Add `fetchDeviceInfo(id)` hitting `GET /api/devices/:id/info` and `refreshDeviceInfo(id)` hitting `POST /api/devices/:id/info/refresh`.
- `web/src/lib/components/devices/DeviceCard.svelte` — **Needs change.** Add metadata display section showing OS version, screen resolution (WxH), RAM, model, ABI. Add refresh button. Follow existing button patterns (inline icon + text, `bg-primary/10 border-primary/20` style).
- `web/src/routes/devices/+page.svelte` — May need minor changes if per-card refresh needs to trigger `refreshDeviceInfo()` and update the device list. Currently polls `listDevices()` every 5 seconds, which will pick up metadata since `getDevices()` already includes it.

### Build Order

1. **Types first** — Add `DeviceMetadata` interface and extend `Device` type in `web/src/lib/api/types.ts`. This unblocks everything else with type safety.
2. **API client** — Add `fetchDeviceInfo()` and `refreshDeviceInfo()` in `web/src/lib/api/devices.ts`. Straightforward `apiFetch` calls.
3. **DeviceCard enhancement** — Add metadata display and refresh button to `DeviceCard.svelte`. This is the bulk of the visual work. The card already has conditional sections per device state — metadata display should appear for all states where the device has been booted (idle, allocated, running, cleanup). Refresh button triggers `refreshDeviceInfo(device.id)` and updates the local metadata.

### Verification Approach

- `npm run web:build` passes with zero errors (contract verification)
- `npx svelte-check` reports no type errors
- Visual inspection: device cards show metadata fields when metadata is non-null, show graceful "—" or omission when fields are null
- Refresh button calls `POST /api/devices/:id/info/refresh` and updates displayed metadata
- Existing 300+ tests remain green (`npm test`)

## Constraints

- D016: All Tailwind classes must be full static strings in Record lookups — no template interpolation for dynamic colors/styles.
- D017: Use `$derived` for reactive lookups in Svelte 5.
- The `Device` type extension must be backward-compatible — metadata is `null` when devices haven't been booted or when the collector fails.
- The existing 5-second poll in `+page.svelte` already calls `listDevices()` which includes metadata via `toInfo()`, so cards will auto-refresh metadata on the normal polling cycle. The explicit refresh button is for on-demand re-collection from the device.
