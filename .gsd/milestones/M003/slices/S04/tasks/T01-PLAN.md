---
estimated_steps: 4
estimated_files: 2
---

# T01: Add DeviceMetadata type and device info API functions

**Slice:** S04 — Enriched Device Cards
**Milestone:** M003

## Description

The web client's `Device` type is missing `metadata`, `port`, and `pid` fields that the server already returns in `DeviceInfo`. The dedicated endpoints `GET /api/devices/:id/info` and `POST /api/devices/:id/info/refresh` have no client-side API functions. This task adds the `DeviceMetadata` interface, extends `Device`, and adds two API functions — unblocking the card UI work in T02 with full type safety.

## Steps

1. In `web/src/lib/api/types.ts`, add a `DeviceMetadata` interface matching the server's definition in `server/types/index.ts` (lines 13-28). Fields: `osVersion: string | null`, `sdkVersion: string | null`, `screenWidth: number | null`, `screenHeight: number | null`, `screenDensity: number | null`, `ramMb: number | null`, `abi: string | null`, `manufacturer: string | null`, `model: string | null`, `locale: string | null`, `timezone: string | null`, `batteryLevel: number | null`, `collectedAt: string`. Place it after the `Device` interface.
2. Extend the existing `Device` interface to add three missing fields: `metadata: DeviceMetadata | null`, `port: number | null`, `pid: number | null`. This matches the server's `DeviceInfo` type. The server already returns these fields from `GET /api/devices` — the client was just ignoring them.
3. In `web/src/lib/api/devices.ts`, add `fetchDeviceInfo(id: string)` that calls `apiFetch<{ device: Device; metadata: DeviceMetadata | null }>(\`/devices/${id}/info\`)`. Import `DeviceMetadata` from types.
4. In the same file, add `refreshDeviceInfo(id: string)` that calls `apiFetch<{ deviceId: string; metadata: DeviceMetadata }>(\`/devices/${id}/info/refresh\`, { method: 'POST' })`.

## Must-Haves

- [ ] `DeviceMetadata` interface has all 13 fields matching server definition exactly
- [ ] `Device` interface includes `metadata: DeviceMetadata | null`, `port: number | null`, `pid: number | null`
- [ ] `fetchDeviceInfo(id)` function exists and returns `{ device, metadata }`
- [ ] `refreshDeviceInfo(id)` function exists and uses POST method

## Verification

- `npx svelte-check --tsconfig web/tsconfig.json` reports zero errors
- `npm run web:build` succeeds with no TypeScript errors
- `npm test` — all existing tests pass (no regressions from type changes)

## Inputs

- `web/src/lib/api/types.ts` — existing types file with `Device`, `HierarchyNode`, `HookDefinition`, etc.
- `web/src/lib/api/devices.ts` — existing API client with `listDevices()` and `restartDevice()`
- `web/src/lib/api/client.ts` — `apiFetch` wrapper used by all API functions
- Server `DeviceMetadata` shape (from `server/types/index.ts` lines 13-28): `{ osVersion, sdkVersion, screenWidth, screenHeight, screenDensity, ramMb, abi, manufacturer, model, locale, timezone, batteryLevel, collectedAt }`
- Server `GET /api/devices/:id/info` returns `{ device: DeviceInfo, metadata: DeviceMetadata | null }`
- Server `POST /api/devices/:id/info/refresh` returns `{ deviceId: string, metadata: DeviceMetadata }`

## Expected Output

- `web/src/lib/api/types.ts` — extended with `DeviceMetadata` interface and `Device` gains `metadata`, `port`, `pid` fields
- `web/src/lib/api/devices.ts` — extended with `fetchDeviceInfo()` and `refreshDeviceInfo()` functions

## Observability Impact

- **New signals:** Two new API functions (`fetchDeviceInfo`, `refreshDeviceInfo`) produce network requests visible in browser DevTools. Successful calls return typed `DeviceMetadata`; failures throw `ApiError` with RFC 7807 detail.
- **Inspection:** A future agent can verify the types exist by running `npx svelte-check` or `grep -n 'DeviceMetadata' web/src/lib/api/types.ts`. The API functions can be exercised by calling them from browser console against a running server.
- **Failure state:** Type mismatches between server and client will surface as TypeScript errors during `svelte-check` or `web:build`. If the server changes its `DeviceMetadata` shape, the client type must be updated in `web/src/lib/api/types.ts`.
