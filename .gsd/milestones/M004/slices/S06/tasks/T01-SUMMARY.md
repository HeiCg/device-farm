---
id: T01
parent: S06
milestone: M004
provides: []
requires: []
affects: []
key_files: ["web/src/lib/components/layout/Nav.svelte", "web/src/lib/components/layout/MobileNav.svelte", "web/src/routes/+page.svelte", "server/api/test-case-routes.ts"]
key_decisions: ["Nav sidebar has 7 items: Dashboard, Jobs, Devices, Test Cases, Test Suites, Executions, Settings (supersedes D011)", "Mobile nav has 6 items (dropped Test Suites to fit mobile width, kept Tests and Runs)", "Stats endpoint returns total, byStatus, byAutomation, automatedPercent, recentPassRate from last 10 executions"]
patterns_established: []
drill_down_paths: []
observability_surfaces: []
duration: ""
verification_result: "svelte-check 0 errors. Web build clean. 311/311 tests pass."
completed_at: 2026-03-26T21:44:12.967Z
blocker_discovered: false
---

# T01: Nav sidebar updated (7 items) + dashboard Test Coverage stats widget + /test-cases/stats API

> Nav sidebar updated (7 items) + dashboard Test Coverage stats widget + /test-cases/stats API

## What Happened
---
id: T01
parent: S06
milestone: M004
key_files:
  - web/src/lib/components/layout/Nav.svelte
  - web/src/lib/components/layout/MobileNav.svelte
  - web/src/routes/+page.svelte
  - server/api/test-case-routes.ts
key_decisions:
  - Nav sidebar has 7 items: Dashboard, Jobs, Devices, Test Cases, Test Suites, Executions, Settings (supersedes D011)
  - Mobile nav has 6 items (dropped Test Suites to fit mobile width, kept Tests and Runs)
  - Stats endpoint returns total, byStatus, byAutomation, automatedPercent, recentPassRate from last 10 executions
duration: ""
verification_result: passed
completed_at: 2026-03-26T21:44:12.968Z
blocker_discovered: false
---

# T01: Nav sidebar updated (7 items) + dashboard Test Coverage stats widget + /test-cases/stats API

**Nav sidebar updated (7 items) + dashboard Test Coverage stats widget + /test-cases/stats API**

## What Happened

Updated sidebar nav with 3 new TCM items (Test Cases, Test Suites, Executions) and mobile nav with 2 (Tests, Runs). Added GET /test-cases/stats endpoint returning aggregate counts by status, automation status, automated percentage, and recent pass rate. Dashboard now shows a Test Coverage widget with total cases, automated %, pass rate, and automation breakdown.

## Verification

svelte-check 0 errors. Web build clean. 311/311 tests pass.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `npx svelte-check --threshold error` | 0 | ✅ pass | 4000ms |
| 2 | `npm run web:build` | 0 | ✅ pass | 4000ms |
| 3 | `npm test` | 0 | ✅ pass — 311/311 | 8400ms |


## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `web/src/lib/components/layout/Nav.svelte`
- `web/src/lib/components/layout/MobileNav.svelte`
- `web/src/routes/+page.svelte`
- `server/api/test-case-routes.ts`


## Deviations
None.

## Known Issues
None.
