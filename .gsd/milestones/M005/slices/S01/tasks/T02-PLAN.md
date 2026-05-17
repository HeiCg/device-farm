---
estimated_steps: 8
estimated_files: 1
skills_used: []
---

# T02: AppiumService unit tests

Create server/maestro/__tests__/appium-service.test.ts with unit tests:
- Session creation calls POST /session with correct capabilities per platform
- Session reuse returns cached session when not expired
- TTL expiry closes old session and creates new one
- closeSession calls DELETE /session/:id
- closeAllSessions cleans up all sessions
- releaseDevice closes session for that device
- Handles server errors gracefully (connection refused, 500, timeout)

## Inputs

- `server/maestro/appium-service.ts`

## Expected Output

- `server/maestro/__tests__/appium-service.test.ts`

## Verification

npm test
