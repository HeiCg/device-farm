# Phase 8: Fix Web Dashboard Data Contracts - Research

**Researched:** 2026-03-11
**Domain:** TypeScript type alignment (Svelte web client vs Fastify server API)
**Confidence:** HIGH

## Summary

Phase 8 fixes two data-contract mismatches between the server API and the web dashboard client. The server responses (from Phase 2) are the source of truth. All fixes are confined to the web client: specifically `web/src/lib/api/types.ts` (type definitions), `web/src/routes/+page.svelte` (dashboard consuming HealthResponse), and `web/src/routes/jobs/+page.svelte` (job list consuming PaginatedResponse).

The mismatches are fully characterized with exact line-level evidence from both server and client code. The HealthResponse type wraps `devices` inside a `pool` object and `queue` inside `queue.pending`, but the server returns them flat. The PaginatedResponse type uses `nextCursor` but the server returns `cursor`. Both are simple rename/restructure fixes.

**Primary recommendation:** Fix types.ts to match server shapes, then update the two consuming Svelte pages. Use `svelte-check` to verify no TypeScript errors remain.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Server API shapes are the source of truth -- do NOT change server code
- All fixes are in `web/src/lib/api/types.ts` and consuming components
- HealthResponse fix: Change to match server shape (flat `devices`, `queue` with platform keys `{ android: number, ios: number }`)
- PaginatedResponse fix: Rename `nextCursor` to `cursor`
- Update `+page.svelte` helper functions to use `h.devices` instead of `h.pool.devices` and `h.queue` instead of `h.queue.pending`
- Update any component reading `nextCursor` to read `cursor` instead

### Claude's Discretion
- Whether to add JSDoc comments on the fixed types referencing the server endpoint
- Test approach (if any tests reference these types)

### Deferred Ideas (OUT OF SCOPE)
None
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| UI-01 | Dashboard com jobs recentes e status do pool de devices | HealthResponse type fix enables pool cards to display correct device counts and queue depth from GET /api/health |
| UI-02 | Lista de jobs com filtros por status, plataforma, metadata e paginacao | PaginatedResponse cursor key fix enables Load More button to pass correct cursor for next page |
| API-01 | GET /api/jobs -- listar jobs com filtros (status, platform, metadata fields, paginacao) | Server pagination is already correct; fixing client PaginatedResponse type completes the contract |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| SvelteKit | 2.x | Web framework | Already in use (Phase 5) |
| Svelte | 5.x | UI framework with runes | Already in use ($state, $derived) |
| TypeScript | 5.x | Type safety | Already in use |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| svelte-check | installed | TypeScript validation | Verify type fixes compile correctly |

No new libraries needed. This phase modifies existing code only.

## Architecture Patterns

### Affected Files Map
```
web/src/lib/api/types.ts          # HealthResponse + PaginatedResponse type defs
web/src/routes/+page.svelte       # Dashboard consuming HealthResponse (pool cards)
web/src/routes/jobs/+page.svelte  # Job list consuming PaginatedResponse (Load More)
```

### Pattern: Server Response as Source of Truth

The server defines the canonical response shapes. The web client types MUST mirror them exactly.

**Server HealthResponse** (from `server/api/routes.ts:333-339`):
```typescript
// GET /api/health returns:
{
  status: 'ok',
  uptime: number,
  devices: Device[],                    // flat, NOT nested under pool
  queue: { android: number, ios: number } // platform keys directly, NOT pending wrapper
}
```

**Server PaginatedResponse** (from `server/api/pagination.ts:14-18`):
```typescript
// buildPaginatedResponse returns:
{
  data: T[],
  cursor: string | null,   // NOT nextCursor
  hasMore: boolean
}
```

### Current Client Types (BROKEN)

**HealthResponse** (`web/src/lib/api/types.ts:68-77`):
```typescript
// WRONG - expects pool.devices and queue.pending
export interface HealthResponse {
  status: string;
  uptime: number;
  pool: { devices: Device[] };            // server sends devices at top level
  queue: { pending: Record<string, number> }; // server sends { android: N, ios: N }
}
```

**PaginatedResponse** (`web/src/lib/api/types.ts:62-66`):
```typescript
// WRONG - expects nextCursor
export interface PaginatedResponse<T> {
  data: T[];
  nextCursor: string | null;  // server sends cursor
  hasMore: boolean;
}
```

### Required Fixes

**Fix 1: HealthResponse type** -- change to flat structure:
```typescript
export interface HealthResponse {
  status: string;
  uptime: number;
  devices: Device[];
  queue: { android: number; ios: number };
}
```

**Fix 2: PaginatedResponse type** -- rename key:
```typescript
export interface PaginatedResponse<T> {
  data: T[];
  cursor: string | null;
  hasMore: boolean;
}
```

**Fix 3: Dashboard helpers** (`web/src/routes/+page.svelte:27-39`) -- update property access:
- `h.pool.devices` -> `h.devices` (lines 28, 31, 34)
- `h.queue.pending` -> `h.queue` (line 38)
- `Object.values(h.queue.pending).reduce(...)` -> `h.queue.android + h.queue.ios` (line 38)

**Fix 4: Jobs page cursor** (`web/src/routes/jobs/+page.svelte:39`) -- update property access:
- `result.nextCursor` -> `result.cursor` (line 39)
- `nextCursor` local variable can be renamed or kept (only used internally)

### Anti-Patterns to Avoid
- **Changing server code:** Server shapes are correct. All fixes go in web client only.
- **Adding adapter/mapping layers:** The types should match directly. No transformation functions needed.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Type validation at runtime | Runtime type checking | TypeScript compile-time types + `svelte-check` | Types flow through `apiFetch<T>` generic -- compile-time is sufficient |
| Shared type package | Monorepo shared types | Mirror types manually | Project already uses manual mirroring pattern; shared package is out of scope |

## Common Pitfalls

### Pitfall 1: Missing a consumer of nextCursor
**What goes wrong:** Renaming `nextCursor` in the type but missing a component that reads it.
**Why it happens:** Multiple files may reference the old key.
**How to avoid:** After renaming, run `svelte-check` to catch all TypeScript errors. Also grep for `nextCursor` across the web directory.
**Warning signs:** TypeScript errors or undefined values at runtime.

### Pitfall 2: Queue depth reduction logic
**What goes wrong:** Keeping `Object.values(...).reduce()` pattern when queue is now `{ android: number, ios: number }` (not `Record<string, number>`).
**Why it happens:** Mechanical change -- easy to miss the reduction logic.
**How to avoid:** Change to explicit `h.queue.android + h.queue.ios` which is type-safe and clear.
**Warning signs:** Queue depth shows NaN or wrong value.

### Pitfall 3: Svelte reactivity with renamed properties
**What goes wrong:** Svelte 5 `$derived()` stops reacting because property path changed.
**Why it happens:** Not updating the derived computation to use new paths.
**How to avoid:** Update all helper functions that feed $derived values. There are exactly 4: `getDeviceCount`, `getIdleCount`, `getRunningCount`, `getQueueDepth`.

## Code Examples

### Fixed HealthResponse type
```typescript
// Source: server/api/routes.ts:333-339 (server shape)
export interface HealthResponse {
  status: string;
  uptime: number;
  devices: Device[];
  queue: { android: number; ios: number };
}
```

### Fixed PaginatedResponse type
```typescript
// Source: server/api/pagination.ts:14-18 (server shape)
export interface PaginatedResponse<T> {
  data: T[];
  cursor: string | null;
  hasMore: boolean;
}
```

### Fixed dashboard helpers
```typescript
// Source: web/src/routes/+page.svelte (after fix)
function getDeviceCount(h: HealthResponse | null): number {
  return h ? h.devices.length : 0;
}
function getIdleCount(h: HealthResponse | null): number {
  return h ? h.devices.filter((d) => d.state === DeviceState.Idle).length : 0;
}
function getRunningCount(h: HealthResponse | null): number {
  return h ? h.devices.filter((d) => d.state === DeviceState.Running).length : 0;
}
function getQueueDepth(h: HealthResponse | null): number {
  if (!h) return 0;
  return h.queue.android + h.queue.ios;
}
```

### Fixed jobs page cursor reading
```typescript
// Source: web/src/routes/jobs/+page.svelte (after fix)
cursor = result.cursor;  // was: nextCursor = result.nextCursor
```

## State of the Art

No technology changes -- this is a mechanical fix of type mismatches introduced during Phase 5 development.

| Old (broken) | Fixed | Reason |
|--------------|-------|--------|
| `pool.devices` | `devices` | Server returns flat, not nested |
| `queue.pending` | `queue` | Server returns `{ android, ios }` directly |
| `nextCursor` | `cursor` | Server pagination module uses `cursor` key |

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | svelte-check (TypeScript validation) |
| Config file | `web/tsconfig.json` |
| Quick run command | `cd web && npx svelte-check --tsconfig ./tsconfig.json` |
| Full suite command | `cd web && npx svelte-check --tsconfig ./tsconfig.json` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| UI-01 | Pool cards show correct values from health endpoint | smoke (type check) | `cd web && npx svelte-check --tsconfig ./tsconfig.json` | N/A (type-level) |
| UI-02 | Load More fetches next page with correct cursor | smoke (type check) | `cd web && npx svelte-check --tsconfig ./tsconfig.json` | N/A (type-level) |
| API-01 | PaginatedResponse type matches server shape | smoke (type check) | `cd web && npx svelte-check --tsconfig ./tsconfig.json` | N/A (type-level) |

### Sampling Rate
- **Per task commit:** `cd web && npx svelte-check --tsconfig ./tsconfig.json`
- **Per wave merge:** Same as above (no separate test suite for web)
- **Phase gate:** svelte-check passes with 0 errors

### Wave 0 Gaps
None -- no new test files needed. Type correctness is verified by svelte-check. No unit tests exist for the web client (established project pattern), and this phase is mechanical type fixes only.

## Open Questions

1. **JSDoc comments on types (Claude's Discretion)**
   - What we know: Types currently have no JSDoc linking to server endpoints
   - Recommendation: Add brief JSDoc comments referencing the server endpoint (e.g., `/** Mirrors GET /api/health response */`) -- low cost, high value for future maintainability

2. **Local variable naming in jobs page**
   - What we know: `jobs/+page.svelte` uses a local `let nextCursor` variable (line 11) to store the cursor between loads
   - Recommendation: Rename local variable to `cursor` for consistency, though keeping `nextCursor` as a local variable name is also fine since it only matters that `result.cursor` is read correctly from the API response

## Sources

### Primary (HIGH confidence)
- `server/api/routes.ts:332-358` -- actual health route response shape
- `server/api/pagination.ts:14-18` -- PaginatedResponse server type definition
- `server/api/pagination.ts:103-122` -- buildPaginatedResponse returns `cursor` key
- `server/jobs/job-service.ts:656-661` -- getQueueDepth returns `{ android: number, ios: number }`
- `web/src/lib/api/types.ts:62-77` -- current (broken) client type definitions
- `web/src/routes/+page.svelte:27-44` -- current (broken) dashboard helper functions
- `web/src/routes/jobs/+page.svelte:39` -- current (broken) cursor reading
- `.planning/v1.0-MILESTONE-AUDIT.md` -- documented integration breaks

### Secondary (MEDIUM confidence)
- None needed -- all evidence is from primary source code

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new libraries, existing code only
- Architecture: HIGH -- exact line numbers and shapes verified from server source code
- Pitfalls: HIGH -- small, well-scoped changes with clear verification path

**Research date:** 2026-03-11
**Valid until:** Indefinite (server shapes are stable; this is a one-time fix)
