# S01: Appium Session Manager

**Goal:** Manage Appium WebDriver sessions per device with create/reuse/close lifecycle, dependency validation, and config schema extension.
**Demo:** After this: AppiumService creates a session for an Android device, fetches hierarchy XML via getPageSource, reuses session on subsequent calls, and closes on timeout.

## Tasks
- [x] **T01: AppiumService with session lifecycle + config + dependency checker + plugin registration** — Create server/maestro/appium-service.ts with:
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
  - Estimate: 30min
  - Files: server/maestro/appium-service.ts, server/config/schema.ts, server/utils/dependency-checker.ts, server/maestro/plugin.ts
  - Verify: npx tsc --noEmit && npm test
- [x] **T02: 14 AppiumService unit tests covering session lifecycle, TTL, page source, cleanup** — Create server/maestro/__tests__/appium-service.test.ts with unit tests:
- Session creation calls POST /session with correct capabilities per platform
- Session reuse returns cached session when not expired
- TTL expiry closes old session and creates new one
- closeSession calls DELETE /session/:id
- closeAllSessions cleans up all sessions
- releaseDevice closes session for that device
- Handles server errors gracefully (connection refused, 500, timeout)
  - Estimate: 20min
  - Files: server/maestro/__tests__/appium-service.test.ts
  - Verify: npm test
