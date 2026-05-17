---
estimated_steps: 1
estimated_files: 2
skills_used: []
---

# T02: Labels API routes + validation

Create server/api/label-routes.ts with Fastify route plugin. Routes: GET /api/labels (filter by ?category=), POST /api/labels (create), PUT /api/labels/:id (update), DELETE /api/labels/:id (delete). Zod validation schemas in the same file. RFC 7807 error responses. Register in server/api/plugin.ts.

## Inputs

- `server/api/routes.ts`
- `server/hooks/plugin.ts`

## Expected Output

- `server/api/label-routes.ts`

## Verification

npx tsc --noEmit && npm test
