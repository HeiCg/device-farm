---
estimated_steps: 6
estimated_files: 3
---

# T01: Add source selection and native hierarchy strategy to server

**Slice:** S01 — Hierarchy Viewer Canvas
**Milestone:** M003

## Description

The hierarchy endpoint currently auto-detects which strategy to use (device-server or maestro-cli). R033 requires the user to switch between three sources, so the server must accept a `?source=` query parameter to force a specific strategy. Additionally, the third "native" source (`adb shell uiautomator dump`) has no backend implementation yet.

This task augments `HierarchyService.getHierarchy()` to accept an optional `source` parameter, adds a native adb hierarchy strategy that parses uiautomator XML, and wires the query parameter through the Maestro plugin route. It also adds unit tests.

**Relevant skill:** `test` (for writing Vitest tests following the project's existing patterns in `server/*/__tests__/`)

## Steps

1. **Add `source` parameter to `getHierarchy()`** in `server/maestro/hierarchy-service.ts`:
   - Add optional parameter: `source?: 'maestro-cli' | 'device-server' | 'native'`
   - When `source` is provided, skip the auto-detection logic and jump directly to the matching strategy method
   - When `source` is omitted, keep the existing auto-detection behavior unchanged (backwards compatible)
   - Export a `HierarchySource` type: `'maestro-cli' | 'device-server' | 'native'`

2. **Add `fetchNativeHierarchy()` method** to `HierarchyService`:
   - For Android: run `adb -s <serial> shell uiautomator dump /dev/tty` (dumps XML to stdout)
   - Parse the XML output into `HierarchyNode[]` format matching the existing interface — recursive tree of `{ className, text, resourceId, bounds: [l,t,r,b], children, ... }`
   - The uiautomator XML format uses `<node>` elements with attributes: `class`, `text`, `resource-id`, `bounds="[left,top][right,bottom]"`, `content-desc`, `clickable`, `enabled`, `focused`
   - Parse bounds string `"[l,t][r,b]"` → `[l, t, r, b]` number array
   - For iOS: stub with `throw new Error('Native iOS hierarchy not yet implemented')` (idb support deferred)
   - Return `{ source: 'native', hierarchy: HierarchyNode[] }` matching the existing result shape

3. **Wire `?source=` query parameter** in `server/maestro/plugin.ts`:
   - On the `GET /api/devices/:id/hierarchy` route handler, read `request.query.source` (string, optional)
   - Validate it's one of `'maestro-cli' | 'device-server' | 'native'` or undefined
   - Pass it to `hierarchyService.getHierarchy(platform, deviceId, port, source)`

4. **Add Fastify route schema** for the source query parameter so Fastify validates it:
   - Add `querystring` schema with optional `source` enum: `['maestro-cli', 'device-server', 'native']`

5. **Write unit tests** in `server/maestro/__tests__/hierarchy-service.test.ts`:
   - Test: when `source='maestro-cli'` is passed, only the maestro-cli strategy is called (mock other strategies)
   - Test: when `source='device-server'` is passed, only the device-server strategy is called
   - Test: when `source='native'` is passed, the native strategy is called
   - Test: when `source` is omitted, auto-detection logic runs (existing behavior)
   - Test: native XML parser correctly converts uiautomator dump XML into HierarchyNode tree
   - Test: native XML parser correctly parses bounds string `"[0,0][1080,2340]"` → `[0, 0, 1080, 2340]`
   - Follow the existing test patterns: `vi.mock()` at module level, mock factories for dependencies (see `server/jobs/__tests__/job-service.test.ts` for pattern reference)

6. **Verify** both existing tests and new tests pass:
   - `npx vitest run server/maestro/__tests__/hierarchy-service.test.ts`
   - `npm run build` (TypeScript clean)

## Must-Haves

- [ ] `getHierarchy()` accepts optional `source` parameter and routes to correct strategy
- [ ] `fetchNativeHierarchy()` parses adb uiautomator dump XML into HierarchyNode tree
- [ ] Plugin route reads `?source=` from query string and passes through
- [ ] Bounds string `"[l,t][r,b]"` correctly parsed to `[l, t, r, b]` array
- [ ] Backwards compatible — omitting `source` preserves existing auto-detection behavior
- [ ] Unit tests cover source routing and XML parsing

## Verification

- `npx vitest run server/maestro/__tests__/hierarchy-service.test.ts` — all tests pass
- `npm run build` — zero TypeScript errors
- `npm test` — all existing 300+ tests still pass (no regressions)

## Observability Impact

- Signals added: server logs which hierarchy strategy was used (source param or auto-detected) at debug level
- How a future agent inspects this: `GET /api/devices/:id/hierarchy?source=native` → response body includes `"source": "native"`
- Failure state exposed: if native strategy fails, 502 response with error message describing the adb failure

## Inputs

- `server/maestro/hierarchy-service.ts` — existing HierarchyService with `getHierarchy()`, device-server and maestro-cli strategies, and `HierarchyNode` interface
- `server/maestro/plugin.ts` — existing Maestro plugin with hierarchy route at `GET /api/devices/:id/hierarchy`
- `server/types/index.ts` — `DeviceInfo` type with `platform` field
- `server/jobs/__tests__/job-service.test.ts` — reference for test patterns (vi.mock, mock factories)

## Expected Output

- `server/maestro/hierarchy-service.ts` — augmented with `source` param, `HierarchySource` type export, `fetchNativeHierarchy()` method
- `server/maestro/plugin.ts` — hierarchy route reads `?source=` query param
- `server/maestro/__tests__/hierarchy-service.test.ts` — new test file with 6+ test cases
