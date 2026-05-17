---
phase: 15-fix-operational-dependencies
plan: 02
subsystem: types
tags: [zod, typescript, branded-types, uuid, compile-time-proof]

# Dependency graph
requires:
  - phase: 15-fix-operational-dependencies
    provides: plan 15-00 ships tsconfig includes for .compile.ts + .spec.ts; pinned Node 22.12 + Zod 4
provides:
  - Central branded-ID module at server/types/ids.ts
  - Five branded UUID schemas: JobIdSchema, DeviceIdSchema, PipelineIdSchema, ArtifactIdSchema, RecordingIdSchema
  - Five inferred type aliases: JobId, DeviceId, PipelineId, ArtifactId, RecordingId
  - Five trust-boundary constructors: toJobId, toDeviceId, toPipelineId, toArtifactId, toRecordingId
  - Compile-fail proof (ids.compile.ts) with @ts-expect-error directives that regress the typecheck if brand protection breaks
  - Parameterised runtime spec (ids.spec.ts) with 15 passing tests (5 ids x 3 cases each)
affects: [15-01 events table decoder, 15-04 event envelope, 15-05 queue wrapper, 16 pilot module, 23 jobs refactor, 28 CLI consumer]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Zod 4 .brand<>() for nominal typing of UUID strings"
    - ".parse()-at-boundary constructors (to{Aggregate}Id) for trust-boundary validation"
    - "@ts-expect-error compile-fail proofs as CI-enforced typecheck gates"

key-files:
  created:
    - server/types/ids.ts
    - server/types/__tests__/ids.spec.ts
    - server/types/__tests__/ids.compile.ts
  modified: []

key-decisions:
  - "Branded IDs live in ONE file (server/types/ids.ts); verified by grep: z.string().uuid().brand appears only there"
  - "Compile-fail proof uses three @ts-expect-error directives (DeviceId to JobId slot, raw string to DeviceId slot, raw string to JobId slot) — TS would fail the build if any directive landed on a non-error line"
  - "Runtime parse still enforces UUID format via Zod z.string().uuid(); branded types are compile-time only, runtime is a plain string"

patterns-established:
  - "Central branded-ID source: every v3.0 module imports JobId/DeviceId/etc from ../types/ids.js"
  - "Parameterised it.each spec pattern for cross-schema behavioural equivalence"
  - "SPEC-09 compile-fail proof pattern: type-only import + declare-function sinks + @ts-expect-error directives"

requirements-completed: [SPEC-09]

# Metrics
duration: 3min
completed: 2026-04-17
---

# Phase 15 Plan 02: Central Branded ID Types Summary

**Central `server/types/ids.ts` exports 5 Zod-branded UUID schemas + constructors; compile-fail proof guards brand nominal typing at `tsc --noEmit` time.**

## Performance

- **Duration:** 3 min
- **Started:** 2026-04-17T14:59:14Z
- **Completed:** 2026-04-17T15:03:09Z
- **Tasks:** 2 / 2
- **Files created:** 3
- **Files modified:** 0

## Accomplishments

- Shipped single source-of-truth for branded aggregate IDs (SPEC-09) — future v3.0 modules import `JobId`/`DeviceId`/`PipelineId`/`ArtifactId`/`RecordingId` from one file
- Established compile-time nominal typing guarantee via `z.string().uuid().brand<'...'>()` + `@ts-expect-error` proof (if brand protection regresses, `tsc --noEmit` fails loudly)
- Verified runtime `.parse()` round-trip on fixture UUID `550e8400-e29b-41d4-a716-446655440000` and rejection of raw `'not-a-uuid'` (15 parameterised tests green)

## Task Commits

Each task committed atomically with TDD ordering:

1. **Task 2.1 (RED)** — failing spec stub — `9304203` (test)
2. **Task 2.1 (GREEN)** — ids.ts module with 5 schemas + 5 types + 5 constructors — `f0656a0` (feat)
3. **Task 2.2** — compile-fail proof with 3 `@ts-expect-error` directives — `3c73f40` (test)

**Plan metadata:** (final commit pending at orchestrator close)

## Files Created/Modified

- `server/types/ids.ts` — five branded UUID schemas, five inferred type aliases, five `to{Id}` constructors. Exactly 15 exports, no others.
- `server/types/__tests__/ids.spec.ts` — parameterised `it.each` table covering 5 ids × 3 runtime assertions (parse valid, reject invalid with `ZodError`, constructor mirrors schema).
- `server/types/__tests__/ids.compile.ts` — never imported at runtime. Proves TS rejects `DeviceId` → `JobId`, raw string → `DeviceId`, raw string → `JobId`. Three `@ts-expect-error` directives verified: tsc produces no errors inside `ids.*` files when targeted (confirmed via `npx tsc --noEmit` file-scoped filter).

## Decisions Made

- **Used `z.string().uuid().brand<'JobId'>()` per RESEARCH §8 verbatim.** No `.transform()` chain (Zod-4 brand-drop-on-transform gotcha avoided).
- **Runtime spec uses `it.each` parameterised row** `[name, schema, toFn]` rather than 5 copies of the same three tests. Keeps the suite at 15 tests while staying single-source.
- **Compile-fail proof file is `.ts` not `.d.ts`** so it participates in the regular `tsconfig.json include` (`server/**/*.compile.ts`) set up in plan 15-00. `@ts-expect-error` directives fire on runtime-shaped TS code, not declaration files.
- **No barrel re-export added to `server/types/index.ts`.** Plan called for a single source file; downstream modules import from `../types/ids.js` directly (matches the dependency-graph intent).

## Deviations from Plan

### Auto-fixed Issues

None.

### Scope-boundary items observed (NOT fixed — deferred)

- `npm run typecheck` (whole-tree) reports 3 pre-existing errors that are NOT caused by this plan:
  - `server/artifacts/recording-service.ts:169,177` — `RecordingResult.errors` missing (from uncommitted WIP in `server/artifacts/recording-service.ts`, touched by commit `1f8feaa`)
  - `server/pipelines/schema.ts:17` — `z.record(z.unknown())` argument-count mismatch under Zod 4 (pre-existing from commit `b07f0aa`, before Phase 15 started)
- These are out-of-scope per the deviation Scope Boundary rule; already tracked in `.planning/phases/15-fix-operational-dependencies/deferred-items.md` (plan 15-03's entry covers them).
- **Targeted verification executed:** `npx tsc --noEmit` with `ids.*` filter produces zero errors, and a synthetic tampered copy of `ids.compile.ts` was confirmed to trigger `TS2578: Unused '@ts-expect-error' directive` — proving the guardrail works.

---

**Total deviations:** 0 auto-fixed
**Impact on plan:** None. Plan-scoped `npx vitest run server/types/__tests__/ids.spec.ts` exits 0 with 15 passing tests. Plan-scoped typecheck (targeted to `ids.*`) is clean.

## Issues Encountered

- **Initial `git add` pulled in an untracked `server/db/__tests__/events-schema.spec.ts` left behind from a parallel 15-01 exploration.** Caught via `git show --name-status`; fixed with `git reset --soft HEAD~1` + `git restore --staged` + recommit. Final 15-02 commits contain only the three intended files.

## User Setup Required

None — no external service configuration needed.

## Verification

- `npx vitest run server/types/__tests__/ids.spec.ts` → 15 passing, 0 failing
- `grep -c "@ts-expect-error" server/types/__tests__/ids.compile.ts` → 3 (matches acceptance criterion exactly)
- `grep -c "brand<'" server/types/ids.ts` (regex for 5 distinct brand tags) → 5 matches
- Count of `export ` lines in `server/types/ids.ts` → 15 (5 schemas + 5 type aliases + 5 constructors)
- `rg "z\\.string\\(\\)\\.uuid\\(\\)\\.brand" server/` → only one file matches (`server/types/ids.ts`) — satisfies the "brands only declared centrally" verification clause

## Next Plan Readiness

- **15-01 (events table Drizzle schema)** — can import `JobId`/`DeviceId`/`PipelineId` for event-envelope row decoders.
- **15-04 (event envelope)** — can type `aggregateId` field as `JobId | DeviceId | PipelineId | ArtifactId | RecordingId`.
- **15-05 (queue wrapper)** — can type per-queue job payloads with the specific aggregate ID brand.
- All downstream plans use `import { JobId, ... } from '../types/ids.js'`; no further duplicate `z.string().uuid().brand<>()` declarations allowed (enforced implicitly by this plan's grep-based verification).

## Self-Check: PASSED

All claimed files and commits verified on disk:
- `server/types/ids.ts` — present
- `server/types/__tests__/ids.spec.ts` — present
- `server/types/__tests__/ids.compile.ts` — present
- `.planning/phases/15-fix-operational-dependencies/15-02-SUMMARY.md` — present
- Commit `9304203` (test spec, RED) — present in git log
- Commit `f0656a0` (feat ids.ts, GREEN) — present in git log
- Commit `3c73f40` (compile-fail proof) — present in git log

---
*Phase: 15-fix-operational-dependencies*
*Plan: 02*
*Completed: 2026-04-17*
