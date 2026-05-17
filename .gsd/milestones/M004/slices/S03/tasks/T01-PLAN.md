---
estimated_steps: 7
estimated_files: 2
skills_used: []
---

# T01: Test Suites API routes

Create server/api/test-suite-routes.ts with:
- GET /api/test-suites (list with case count)
- POST /api/test-suites (create with caseIds[])
- GET /api/test-suites/:id (detail with ordered cases + labels)
- PUT /api/test-suites/:id (update name/description, replace case list with ordering)
- DELETE /api/test-suites/:id

Zod validation. Register in api/plugin.ts.

## Inputs

- `server/api/test-case-routes.ts`

## Expected Output

- `server/api/test-suite-routes.ts`

## Verification

npx tsc --noEmit && npm test
