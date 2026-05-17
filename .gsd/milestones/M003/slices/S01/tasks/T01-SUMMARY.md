---
id: T01
parent: S01
milestone: M003
provides:
  - HierarchySource type export for source selection
  - source parameter on getHierarchy() for direct strategy routing
  - fetchNativeHierarchy() method parsing adb uiautomator dump XML
  - ?source= query parameter on /api/devices/:id/hierarchy route with Fastify schema validation
key_files:
  - server/maestro/hierarchy-service.ts
  - server/maestro/plugin.ts
  - server/maestro/__tests__/hierarchy-service.test.ts
key_decisions: []
patterns_established:
  - vi.hoisted() for mock state needed by vi.mock factories (Vitest hoisting)
  - Regex-based XML parsing for uiautomator dump (avoids adding XML parser dependency)
observability_surfaces:
  - GET /api/devices/:id/hierarchy?source=native returns { source: 'native', ... }
  - Server logs hierarchy strategy at debug level (source param or auto-detected)
  - 502 response with descriptive error when native strategy or adb fails
duration: 15m
verification_result: passed
completed_at: 2026-03-19
blocker_discovered: false
---

# T01: Add source selection and native hierarchy strategy to server

**Added optional `?source=` parameter to hierarchy endpoint and implemented native adb uiautomator dump strategy with XML parser**

## What Happened

Augmented `HierarchyService.getHierarchy()` with an optional `source` parameter (`'maestro-cli' | 'device-server' | 'native'`). When provided, the method skips auto-detection and routes directly to the requested strategy via a new `fetchBySource()` dispatcher. When omitted, existing auto-detection behavior is fully preserved.

Added `fetchNativeHierarchy()` which runs `adb -s <serial> shell uiautomator dump /dev/tty` and parses the resulting XML. The parser is stack-based regex, handling both self-closing `<node .../>` and nested `<node>...</node>` elements. Bounds strings like `"[0,0][1080,2340]"` are parsed via the existing `parseAndroidBounds()` method. iOS native is stubbed with a clear error message.

Updated the Maestro plugin route to read `?source=` from the query string with a Fastify JSON Schema enum constraint (`['maestro-cli', 'device-server', 'native']`), and pass it through to `hierarchyService.getHierarchy()`.

Exported the `HierarchySource` type for downstream consumers (web API client in T02).

## Verification

- All 11 new tests pass covering: source routing (4 tests), XML parsing (4 tests), XML extraction (2 tests), iOS native error (1 test)
- TypeScript build clean (`npm run build` — zero errors)
- Full test suite: 311 tests pass across 33 files, zero regressions

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `npx vitest run server/maestro/__tests__/hierarchy-service.test.ts` | 0 | ✅ pass | 2.2s |
| 2 | `npm run build` | 0 | ✅ pass | 2.4s |
| 3 | `npm test` | 0 | ✅ pass | 9.1s |

## Diagnostics

- `GET /api/devices/:id/hierarchy?source=native` — returns JSON with `"source": "native"` and parsed hierarchy tree
- `GET /api/devices/:id/hierarchy?source=invalid` — returns 400 (Fastify schema validation rejects unknown values)
- `GET /api/devices/:id/hierarchy` (no source) — auto-detection unchanged, response includes `"source"` field showing which strategy was used
- Server debug log: `Fetching hierarchy { platform, deviceId, source: 'native' | 'auto' }`

## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `server/maestro/hierarchy-service.ts` — Added `HierarchySource` type export, `source` param on `getHierarchy()`, `fetchBySource()` dispatcher, `fetchNativeHierarchy()`, `extractUiautomatorXml()`, `parseUiautomatorXml()`, `parseNodeAttributes()` methods
- `server/maestro/plugin.ts` — Imported `HierarchySource`, added Fastify querystring schema with `source` enum, wired `source` param through to `getHierarchy()`
- `server/maestro/__tests__/hierarchy-service.test.ts` — New test file with 11 test cases covering source routing and native XML parsing
