# S06: Navigation + Dashboard Integration

**Goal:** Update navigation sidebar with TCM items and add test case stats widget to dashboard.
**Demo:** After this: Sidebar shows Test Cases, Test Suites, Executions nav items. Dashboard shows test case stats widget.

## Tasks
- [x] **T01: Nav sidebar updated (7 items) + dashboard Test Coverage stats widget + /test-cases/stats API** — Update web/src/lib/components/layout/Header.svelte (or equivalent nav component) to add Test Cases, Test Suites, Executions nav items. Supersedes D011. Add /api/test-cases/stats endpoint returning total, by-status, by-automation, and recent execution pass rate. Add stats widget to dashboard page.
  - Estimate: 25min
  - Files: web/src/lib/components/layout/Header.svelte, web/src/routes/+page.svelte, server/api/test-case-routes.ts
  - Verify: npx svelte-check --threshold error && npm run web:build && npm test
