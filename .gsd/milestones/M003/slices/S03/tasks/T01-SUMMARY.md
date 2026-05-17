---
id: T01
parent: S03
milestone: M003
provides:
  - HookEvent, HookDefinition, HookResult client-side types
  - hooks API client module (5 endpoint wrappers)
key_files:
  - web/src/lib/api/types.ts
  - web/src/lib/api/hooks.ts
key_decisions:
  - Used encodeURIComponent for hook names in URL paths to handle special characters safely
patterns_established:
  - Hook API client follows same thin-wrapper pattern as devices.ts (apiFetch with typed generics)
observability_surfaces:
  - ApiError thrown on 400/404/409 with RFC 7807 fields (status, detail, type) for UI error display
duration: 10m
verification_result: passed
completed_at: 2026-03-19
blocker_discovered: false
---

# T01: Add hook types and API client

**Added HookEvent/HookDefinition/HookResult types and 5-function hooks API client mirroring server/hooks/plugin.ts endpoints**

## What Happened

Added three client-side TypeScript types to `web/src/lib/api/types.ts` — `HookEvent` (4-value string literal union), `HookDefinition` (7 fields matching server's interface exactly), and `HookResult` (9 fields including optional `error`). All fields verified against `server/hooks/hook-executor.ts`.

Created `web/src/lib/api/hooks.ts` with 5 exported async functions wrapping the server's hook API routes: `listHooks` (GET), `createHook` (POST), `updateHook` (PUT with oldName in URL), `deleteHook` (DELETE), and `testHook` (POST with optional deviceId body). Each function follows the existing `apiFetch` thin-wrapper pattern from `devices.ts`. Used `encodeURIComponent` on name path params for safety.

Also fixed observability gaps: added `## Observability / Diagnostics` section to S03-PLAN.md and `## Observability Impact` section to T01-PLAN.md.

## Verification

- `npm run web:build` — passed with zero errors, both SSR and client bundles built successfully
- `cd web && npm run check` — 14 errors found, all pre-existing in `Nav.svelte` and `+page.svelte` (unrelated to hooks types/client), zero errors in new/modified files
- Cross-referenced all 5 client functions against server routes in `server/hooks/plugin.ts` — methods, paths, and body shapes match exactly

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `npm run web:build` | 0 | ✅ pass | 3.8s |
| 2 | `cd web && npm run check` | 1 | ⚠️ partial (pre-existing errors only, none in hooks files) | 3.1s |

## Diagnostics

- **Type mismatches**: If server changes `HookDefinition` or `HookResult` fields, `npm run web:build` will fail with TypeScript errors in any component consuming these types.
- **API errors**: All functions throw `ApiError` (from `client.ts`) with `status`, `detail`, and `type` fields — callers can catch and display inline.
- **Network debugging**: All requests go to `/api/hooks*` — filterable in browser DevTools Network tab.

## Deviations

None.

## Known Issues

- `svelte-check` has 14 pre-existing errors in `Nav.svelte` and `+page.svelte` related to health response typing — unrelated to this task, tracked for resolution elsewhere.

## Files Created/Modified

- `web/src/lib/api/types.ts` — added `HookEvent`, `HookDefinition`, `HookResult` types at bottom of file
- `web/src/lib/api/hooks.ts` — new file with 5 exported API client functions for hooks CRUD + test
- `.gsd/milestones/M003/slices/S03/S03-PLAN.md` — added Observability / Diagnostics section
- `.gsd/milestones/M003/slices/S03/tasks/T01-PLAN.md` — added Observability Impact section
