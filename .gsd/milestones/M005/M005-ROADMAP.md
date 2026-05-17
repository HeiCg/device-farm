# M005: 

## Vision
Add Appium as a 4th hierarchy source in the Device Inspector. Supports Android emulator/physical devices via UiAutomator2 driver and iOS simulators via XCUITest driver. Appium sessions are managed per-device with create/reuse/close lifecycle.

## Slice Overview
| ID | Slice | Risk | Depends | Done | After this |
|----|-------|------|---------|------|------------|
| S01 | Appium Session Manager | high | — | ✅ | AppiumService creates a session for an Android device, fetches hierarchy XML via getPageSource, reuses session on subsequent calls, and closes on timeout. |
| S02 | Hierarchy Source + UI Integration | low | S01 | ✅ | User selects 'appium' in SourceSelector dropdown. Hierarchy loads with element overlay. Disabled with tooltip when Appium not installed. |
