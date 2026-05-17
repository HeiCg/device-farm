# S01: Appium Session Manager — UAT

**Milestone:** M005
**Written:** 2026-03-26T21:55:26.399Z

## UAT: S01 — Appium Session Manager\n\n### Prerequisites\n- Appium installed: `npm install -g appium`\n- UiAutomator2 driver: `appium driver install uiautomator2`\n- XCUITest driver: `appium driver install xcuitest`\n- Appium server running: `appium`\n\n### Test 1: Session Creation\n1. Start the Device Farm server\n2. Call GET /api/devices/:id/hierarchy?source=appium\n3. AppiumService creates a session (check server logs)\n4. Hierarchy XML returned\n\n### Test 2: Session Reuse\n1. Call hierarchy?source=appium again for same device\n2. Logs show 'Reusing Appium session' (no new session creation)\n\n### Test 3: Session Cleanup\n1. Stop the server\n2. Logs show 'All Appium sessions closed'\n\n### Test 4: Graceful Degradation\n1. Stop Appium server\n2. Call hierarchy?source=appium\n3. Error returned (502) with descriptive message\n4. Other sources (maestro-cli, native) still work
