---
id: T02
parent: S01
milestone: M003
provides:
  - HierarchyNode, HierarchyResult, HierarchySource, QueryResult client types
  - fetchHierarchy(), getScreenshotUrl(), fetchDeviceState(), queryElements() API client
  - flattenTree(), mapBoundsToSVG() coordinate mapping utilities
key_files:
  - web/src/lib/api/types.ts
  - web/src/lib/api/maestro.ts
  - web/src/lib/utils/coordinate-mapping.ts
key_decisions:
  - getScreenshotUrl returns a raw URL string (not apiFetch) since screenshots are binary PNG loaded as <img src>
  - queryElements builds URLSearchParams from text/id fields rather than stringifying a JSON body
  - flattenTree uses depth-first traversal — order is irrelevant for SVG overlay rendering
patterns_established:
  - Maestro API functions live in web/src/lib/api/maestro.ts as the single module for hierarchy/inspector endpoints
  - Coordinate utilities live in web/src/lib/utils/coordinate-mapping.ts — pure functions, no Svelte dependencies
observability_surfaces:
  - none — pure client-side types and utilities with no runtime signals; build-time verification only
duration: 10m
verification_result: passed
completed_at: 2026-03-19
blocker_discovered: false
---

# T02: Create client-side HierarchyNode types, Maestro API client, and coordinate mapping utility

**Added HierarchyNode/HierarchyResult/QueryResult client types, maestro.ts API client with 4 endpoint functions, and coordinate-mapping utilities for SVG overlay rendering**

## What Happened

Appended four types/interfaces to `web/src/lib/api/types.ts` mirroring the server's hierarchy-service interfaces exactly: `HierarchySource`, `HierarchyNode`, `HierarchyResult`, and `QueryResult`. Created `web/src/lib/api/maestro.ts` with four exported functions — `fetchHierarchy` (with optional `?source=` param), `getScreenshotUrl` (direct URL with cache-buster), `fetchDeviceState`, and `queryElements` (URLSearchParams-based). Created `web/src/lib/utils/coordinate-mapping.ts` with `flattenTree` (depth-first tree flattening) and `mapBoundsToSVG` (converts `[l,t,r,b]` bounds to SVG `{x,y,width,height}` rect attributes). All imports use `.js` extensions per SvelteKit/NodeNext convention.

## Verification

- `npm run web:build` — SvelteKit production build completed with zero errors
- `npx vitest run server/maestro/__tests__/hierarchy-service.test.ts` — 12/12 server tests pass (T01 tests still green)
- Confirmed all 4 types exported from `types.ts`, all 4 functions exported from `maestro.ts`, both utilities exported from `coordinate-mapping.ts`

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `npm run web:build` | 0 | ✅ pass | 6.8s |
| 2 | `npx vitest run server/maestro/__tests__/hierarchy-service.test.ts` | 0 | ✅ pass | 3.3s |

## Diagnostics

No runtime diagnostics — this task produces client-side types and pure utility functions only. Verification is build-time: `npm run web:build` confirms the contract compiles. Downstream tasks (T03 overlay component, T04 inspector page) will exercise these at runtime.

## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `web/src/lib/api/types.ts` — appended HierarchySource, HierarchyNode, HierarchyResult, QueryResult types
- `web/src/lib/api/maestro.ts` — new: API client with fetchHierarchy, getScreenshotUrl, fetchDeviceState, queryElements
- `web/src/lib/utils/coordinate-mapping.ts` — new: flattenTree and mapBoundsToSVG pure utility functions
- `.gsd/milestones/M003/slices/S01/tasks/T02-PLAN.md` — added Observability Impact section (pre-flight fix)
