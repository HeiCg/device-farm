---
estimated_steps: 4
estimated_files: 2
---

# T02: Create client-side HierarchyNode types and Maestro API client

**Slice:** S01 — Hierarchy Viewer Canvas
**Milestone:** M003

## Description

The inspector UI components need TypeScript types and API functions to communicate with the server hierarchy and screenshot endpoints. This task adds `HierarchyNode`, `HierarchyResult`, and `HierarchySource` types to the existing web API types file, and creates a new `maestro.ts` API client module with functions for fetching hierarchy data and building screenshot URLs.

The API client follows the project's existing pattern: plain async functions using `apiFetch<T>()` from `client.ts`. The screenshot endpoint is binary (`image/png`), so the client returns a URL string for direct use in `<img src>` — it does not route through `apiFetch`.

## Steps

1. **Add types to `web/src/lib/api/types.ts`**:
   - `HierarchySource = 'maestro-cli' | 'device-server' | 'native'` — matches the server's source parameter
   - `HierarchyNode` interface:
     ```typescript
     interface HierarchyNode {
       className: string;
       text?: string;
       resourceId?: string;
       contentDescription?: string;
       bounds?: [number, number, number, number]; // [left, top, right, bottom]
       clickable?: boolean;
       enabled?: boolean;
       focused?: boolean;
       children: HierarchyNode[];
     }
     ```
   - `HierarchyResult` interface:
     ```typescript
     interface HierarchyResult {
       source: HierarchySource;
       hierarchy: HierarchyNode[];
       deviceId: string;
       timestamp: number;
     }
     ```
   - Check the server's `HierarchyNode` type in `server/maestro/hierarchy-service.ts` for the exact field names and match them. The types above are from the research — verify they align with the server before writing.

2. **Create `web/src/lib/api/maestro.ts`**:
   - Import `apiFetch` from `./client`
   - Import `HierarchyResult`, `HierarchySource` from `./types`
   - `fetchHierarchy(deviceId: string, source?: HierarchySource): Promise<HierarchyResult>` — calls `GET /api/devices/${deviceId}/hierarchy` with optional `?source=${source}` query param, using `apiFetch<HierarchyResult>`
   - `getScreenshotUrl(deviceId: string): string` — returns `/api/devices/${deviceId}/screenshot` (just a URL string, not a fetch — the `<img>` tag loads it directly)
   - `fetchDeviceState(deviceId: string): Promise<Record<string, unknown>>` — calls `GET /api/devices/${deviceId}/state` using `apiFetch`
   - `queryElements(deviceId: string, query: string): Promise<unknown>` — calls `GET /api/devices/${deviceId}/query?q=${query}` using `apiFetch` (used by S02 later, stub it now with the correct endpoint)

3. **Verify the `apiFetch` import pattern** by reading `web/src/lib/api/client.ts` — match whatever export shape it uses (named export, default export, etc). The research says it's `apiFetch<T>()`.

4. **Build check**: run `npm run web:build` to verify all types resolve and the new module compiles.

## Must-Haves

- [ ] `HierarchyNode` type matches server-side field names exactly
- [ ] `HierarchySource` type matches server's `'maestro-cli' | 'device-server' | 'native'`
- [ ] `fetchHierarchy()` passes `?source=` query param when provided
- [ ] `getScreenshotUrl()` returns a URL string (not a fetch call)
- [ ] All new code uses Svelte 5 / ES module conventions (`.js` import extensions if needed by project config)

## Verification

- `npm run web:build` — zero errors, new types and API client compile cleanly
- Manually inspect that `HierarchyNode` fields match the server's interface (read `server/maestro/hierarchy-service.ts` to confirm)

## Inputs

- `web/src/lib/api/client.ts` — existing `apiFetch<T>()` wrapper (import pattern)
- `web/src/lib/api/types.ts` — existing types file to append to
- `server/maestro/hierarchy-service.ts` — server-side `HierarchyNode` interface (reference for field names)
- T01 completed: server now accepts `?source=` query parameter

## Expected Output

- `web/src/lib/api/types.ts` — augmented with `HierarchyNode`, `HierarchyResult`, `HierarchySource` exports
- `web/src/lib/api/maestro.ts` — new file with `fetchHierarchy()`, `getScreenshotUrl()`, `fetchDeviceState()`, `queryElements()` exports
