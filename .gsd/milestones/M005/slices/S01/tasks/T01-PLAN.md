---
estimated_steps: 15
estimated_files: 4
skills_used: []
---

# T01: AppiumService + config + dependency checker

Create server/maestro/appium-service.ts with:
- AppiumService class managing WebDriver sessions per device
- createSession(platform, deviceId, udid): POST to Appium server /session with W3C capabilities
  - Android: { platformName: 'Android', 'appium:automationName': 'UiAutomator2', 'appium:udid': serial, 'appium:noReset': true, 'appium:autoLaunch': false }
  - iOS: { platformName: 'iOS', 'appium:automationName': 'XCUITest', 'appium:udid': udid, 'appium:noReset': true }
- getPageSource(sessionId): GET /session/:id/source → XML string
- closeSession(sessionId): DELETE /session/:id
- Session cache: Map<deviceId, { sessionId, createdAt, lastUsedAt }>
- getOrCreateSession(): reuse if exists and not expired, create otherwise
- TTL: auto-close sessions idle > 5 minutes (checked on each access)
- closeAllSessions(): cleanup on shutdown
- releaseDevice(deviceId): close session for a specific device (called when device becomes allocated)

Extend config schema with appium section (serverUrl, sessionTimeoutMs).
Add appium to dependency checker (check binary + list installed drivers).
Register AppiumService in maestro/plugin.ts as Fastify decorator.

## Inputs

- `server/maestro/hierarchy-service.ts`
- `server/config/schema.ts`
- `server/utils/dependency-checker.ts`

## Expected Output

- `server/maestro/appium-service.ts`

## Verification

npx tsc --noEmit && npm test
