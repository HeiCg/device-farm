# S02: Hierarchy Source + UI Integration — UAT

**Milestone:** M005
**Written:** 2026-03-26T21:59:50.242Z

## UAT: S02 — Hierarchy Source + UI Integration\n\n### Prerequisites\n- Appium running: `appium`\n- UiAutomator2 driver installed\n- Device connected/emulator running\n\n### Test 1: Source Selector\n1. Open /devices/:id/inspector\n2. SourceSelector shows 4 options: Maestro Driver, Device Server, ADB/idb, Appium\n3. If Appium not running: Appium option shows '(not running)' and is disabled, install hint visible\n\n### Test 2: Appium Hierarchy (Android)\n1. Start Appium server\n2. Refresh inspector page\n3. Select 'Appium' source\n4. Hierarchy loads with element overlay on screenshot\n5. Elements are clickable, properties panel works\n\n### Test 3: Appium Hierarchy (iOS)\n1. iOS simulator running\n2. XCUITest driver installed\n3. Select 'Appium' source\n4. Hierarchy loads with iOS element types (XCUIElementTypeButton, etc.)\n\n### Test 4: Session Reuse\n1. Switch to another source, then back to Appium\n2. Second load is faster (session reused — check server logs)
