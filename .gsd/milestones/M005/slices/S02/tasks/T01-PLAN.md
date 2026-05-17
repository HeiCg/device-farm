---
estimated_steps: 7
estimated_files: 2
skills_used: []
---

# T01: Wire Appium into HierarchyService + status endpoint

Add 'appium' case to HierarchyService.fetchBySource() that:
1. Gets or creates Appium session via AppiumService
2. Calls getPageSource(sessionId) to get XML
3. Parses XML using existing parseUiautomatorXml (Android) or a new iOS XML parser
4. Returns HierarchyResult with source='appium'

The HierarchyService needs AppiumService injected. Update constructor and plugin wiring.

Also add /api/appium/status endpoint returning isAvailable + session count for the UI.

## Inputs

- `server/maestro/appium-service.ts`

## Expected Output

- `server/maestro/hierarchy-service.ts`
- `server/maestro/plugin.ts`

## Verification

npx tsc --noEmit && npm test
