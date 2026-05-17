# S02: Hierarchy Source + UI Integration

**Goal:** Wire AppiumService into HierarchyService as 4th source and update inspector UI to show 4 source options with disabled state for unavailable sources.
**Demo:** After this: User selects 'appium' in SourceSelector dropdown. Hierarchy loads with element overlay. Disabled with tooltip when Appium not installed.

## Tasks
- [x] **T01: Wired Appium into HierarchyService with Android XML reuse + new iOS XCUITest parser + /api/appium/status** — Add 'appium' case to HierarchyService.fetchBySource() that:
1. Gets or creates Appium session via AppiumService
2. Calls getPageSource(sessionId) to get XML
3. Parses XML using existing parseUiautomatorXml (Android) or a new iOS XML parser
4. Returns HierarchyResult with source='appium'

The HierarchyService needs AppiumService injected. Update constructor and plugin wiring.

Also add /api/appium/status endpoint returning isAvailable + session count for the UI.
  - Estimate: 20min
  - Files: server/maestro/hierarchy-service.ts, server/maestro/plugin.ts
  - Verify: npx tsc --noEmit && npm test
- [x] **T02: SourceSelector shows 4 sources with Appium disabled state + install hint when unavailable** — Update SourceSelector.svelte to show 4 options. Add 'appium' with disabled state when Appium not available (check via /api/appium/status). Update HierarchySource type in web types. Show tooltip on disabled option explaining how to install Appium.
  - Estimate: 15min
  - Files: web/src/lib/components/inspector/SourceSelector.svelte, web/src/lib/api/types.ts, web/src/routes/devices/[id]/inspector/+page.svelte
  - Verify: npx svelte-check --threshold error && npm run web:build
