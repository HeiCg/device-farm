---
phase: 02-job-execution-and-api
plan: 03
subsystem: api
tags: [rfc7807, pagination, cursor, zod, validation, fastify, drizzle]

requires:
  - phase: 02-job-execution-and-api/01
    provides: job types, DB schema with jobs table
provides:
  - RFC 7807 error handler for Fastify
  - Cursor-based pagination helpers (encode/decode/buildWhere)
  - Metadata JSONB filter builder
  - Zod validation schemas for list and create endpoints
affects: [02-04-api-routes]

tech-stack:
  added: []
  patterns: [RFC 7807 Problem Details, keyset cursor pagination, base64url cursors, limit+1 hasMore pattern]

key-files:
  created:
    - server/api/error-handler.ts
    - server/api/pagination.ts
    - server/api/validation.ts
    - server/api/__tests__/error-handler.test.ts
    - server/api/__tests__/pagination.test.ts
  modified: []

key-decisions:
  - "Cursor payload uses compact keys (c, i) to minimize base64 length"
  - "buildMetadataFilters returns descriptors, buildMetadataSQL converts to Drizzle SQL -- separation enables testing without DB"
  - "Validation errors detected by code FST_ERR_VALIDATION or presence of validation array on error"

patterns-established:
  - "RFC 7807 error pattern: all API errors use application/problem+json with type URL, title, status, detail, instance"
  - "Cursor pagination pattern: fetch limit+1, pop extra to detect hasMore, encode last visible item as cursor"
  - "Metadata filter pattern: extract metadata.* query params, build JSONB ->> SQL conditions"

requirements-completed: [API-01]

duration: 2min
completed: 2026-03-10
---

# Phase 2 Plan 3: API Utilities Summary

**RFC 7807 error handler, base64url cursor pagination, metadata JSONB filter builder, and Zod validation schemas for job API**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-10T14:19:47Z
- **Completed:** 2026-03-10T14:21:57Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- RFC 7807 error handler with code-to-status mapping (QUEUE_FULL->429, NOT_FOUND->404, FST_ERR_VALIDATION->400) and createHttpError helper
- Cursor-based pagination with base64url encode/decode, Drizzle keyset WHERE clause builder, and limit+1 hasMore detection
- Metadata dot-notation filter builder for JSONB query conditions
- Zod validation schemas with coercion and defaults for listJobs and createJob endpoints
- 29 total tests covering all utilities

## Task Commits

Each task was committed atomically:

1. **Task 1: RFC 7807 error handler and HTTP error helpers** - `41c187b` (feat)
2. **Task 2: Cursor pagination, metadata filters, and validation schemas** - `b8a1766` (feat)

_Both tasks followed TDD: RED (failing tests) -> GREEN (implementation) -> verified_

## Files Created/Modified
- `server/api/error-handler.ts` - RFC 7807 Fastify error handler with ProblemDetail interface, code mapping, createHttpError helper
- `server/api/pagination.ts` - encodeCursor/decodeCursor (base64url), buildCursorWhere (Drizzle SQL), buildMetadataFilters, buildMetadataSQL, buildPaginatedResponse
- `server/api/validation.ts` - Zod schemas: listJobsQuerySchema (cursor, limit, status, platform), createJobSchema (platform)
- `server/api/__tests__/error-handler.test.ts` - 9 tests for error handler and createHttpError
- `server/api/__tests__/pagination.test.ts` - 20 tests for cursor, metadata filters, pagination response, and validation schemas

## Decisions Made
- Cursor payload uses compact keys (c, i) to minimize base64 length
- buildMetadataFilters returns plain descriptors (testable without DB), buildMetadataSQL converts to Drizzle SQL (separate concern)
- Validation errors detected by code FST_ERR_VALIDATION or presence of validation array on error

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Error handler ready for `server.setErrorHandler(errorHandler)` in API routes plan (02-04)
- Pagination helpers ready for job listing endpoint
- Validation schemas ready for request validation in route handlers
- All exports match the interfaces expected by Plan 04

---
*Phase: 02-job-execution-and-api*
*Completed: 2026-03-10*
