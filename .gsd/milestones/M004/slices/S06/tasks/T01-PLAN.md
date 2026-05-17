---
estimated_steps: 1
estimated_files: 3
skills_used: []
---

# T01: Nav update + dashboard stats widget

Update web/src/lib/components/layout/Header.svelte (or equivalent nav component) to add Test Cases, Test Suites, Executions nav items. Supersedes D011. Add /api/test-cases/stats endpoint returning total, by-status, by-automation, and recent execution pass rate. Add stats widget to dashboard page.

## Inputs

- `web/src/lib/components/layout/Header.svelte`
- `web/src/routes/+page.svelte`

## Expected Output

- `web/src/lib/components/layout/Header.svelte`
- `web/src/routes/+page.svelte`
- `server/api/test-case-routes.ts`

## Verification

npx svelte-check --threshold error && npm run web:build && npm test
