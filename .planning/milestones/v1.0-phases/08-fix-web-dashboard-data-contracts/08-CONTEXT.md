# Phase 8: Fix Web Dashboard Data Contracts - Context

**Gathered:** 2026-03-11
**Status:** Ready for planning

<domain>
## Phase Boundary

Fix HealthResponse and PaginatedResponse TypeScript types in the web dashboard to match the actual server API response shapes. Server responses are correct (Phase 2) — all fixes go in the web client only. This closes cross-phase data-contract breaks identified in the v1.0 milestone audit.

</domain>

<decisions>
## Implementation Decisions

### Fix direction
- Server API shapes are the source of truth — do NOT change server code
- All fixes are in `web/src/lib/api/types.ts` and consuming components

### HealthResponse type fix
- Server returns: `{ status, uptime, devices: Device[], queue: { android: number, ios: number } }`
- Web currently expects: `{ pool: { devices: Device[] }, queue: { pending: Record<string, number> } }`
- Fix: Change HealthResponse to match server shape (flat `devices`, `queue` with platform keys)
- Update `+page.svelte` helper functions to use `h.devices` instead of `h.pool.devices` and `h.queue` instead of `h.queue.pending`

### PaginatedResponse cursor key fix
- Server returns: `{ data: T[], cursor: string | null, hasMore: boolean }`
- Web currently expects: `{ data: T[], nextCursor: string | null, hasMore: boolean }`
- Fix: Rename `nextCursor` to `cursor` in PaginatedResponse type
- Update any component reading `nextCursor` to read `cursor` instead

### Claude's Discretion
- Whether to add JSDoc comments on the fixed types referencing the server endpoint
- Test approach (if any tests reference these types)

</decisions>

<specifics>
## Specific Ideas

No specific requirements — fixes are mechanical, fully specified by the milestone audit evidence.

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `apiFetch<T>` generic client (`web/src/lib/api/client.ts`) — no changes needed, types flow through
- `getHealth()` (`web/src/lib/api/health.ts`) — no changes needed, just returns `HealthResponse`
- `listJobs()` (`web/src/lib/api/jobs.ts`) — no changes needed, returns `PaginatedResponse<Job>`

### Established Patterns
- Svelte 5 `$derived()` for computed values from health data (`+page.svelte:41-44`)
- Helper functions for type narrowing (`getDeviceCount`, `getIdleCount`, etc.)

### Integration Points
- `web/src/lib/api/types.ts` — single source of truth for client types (HealthResponse, PaginatedResponse)
- `web/src/routes/+page.svelte` — dashboard consuming HealthResponse (pool cards)
- `web/src/routes/jobs/+page.svelte` — job list consuming PaginatedResponse (Load More)
- `web/src/lib/components/shared/Pagination.svelte` — may reference nextCursor

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 08-fix-web-dashboard-data-contracts*
*Context gathered: 2026-03-11*
