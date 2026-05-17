---
estimated_steps: 8
estimated_files: 2
skills_used: []
---

# T01: Test Cases API routes

Create server/api/test-case-routes.ts with Fastify route plugin. Routes:
- GET /api/test-cases (list with cursor pagination, filters: label, status, automation_status, priority, search)
- POST /api/test-cases (create with inline steps[] and labelIds[])
- GET /api/test-cases/:id (detail with steps, labels, recent execution count)
- PUT /api/test-cases/:id (update fields, replace steps via bulk upsert, update labels)
- DELETE /api/test-cases/:id (soft-delete: status → deprecated)
- PUT /api/test-cases/:id/steps (bulk upsert steps)

Zod validation schemas. Register in api/plugin.ts.

## Inputs

- `server/api/label-routes.ts`
- `server/api/routes.ts`
- `server/api/pagination.ts`

## Expected Output

- `server/api/test-case-routes.ts`

## Verification

npx tsc --noEmit && npm test
