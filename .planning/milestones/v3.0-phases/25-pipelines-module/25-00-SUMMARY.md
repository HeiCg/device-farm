---
phase: 25
plan: 00
subsystem: pipelines-module
tags: [substrate, wave-0, mod-01, mod-02, mod-03, dep-cruiser, queue-names]
requires:
  - .dependency-cruiser.cjs
  - server/queue/names.ts
  - server/maestro/events.ts (template)
provides:
  - server/pipelines/events.ts (PIPELINE_EVENT_NAMES + empty registry)
  - server/pipelines/queue.ts (PIPELINE_SCHEDULED_EXECUTE_QUEUE_NAME alias)
  - server/pipelines/internal/module.ts (throw-stub)
  - server/pipelines/MODULE.md (Purpose-only placeholder)
  - server/pipelines/index.ts (MOD-02 strict 1-line barrel)
  - server/pipelines/__tests__/events.spec.ts (1-test EVENTS-03 stub)
  - dep-cruiser rule 9 no-deep-imports-into-pipelines-internal
  - QUEUE_NAMES.PIPELINE_SCHEDULED_EXECUTE='pipeline.scheduled.execute'
affects:
  - server/queue/names.ts (extended: 11 -> 12 entries)
  - server/queue/__tests__/names.spec.ts (extended: +1 assertion)
  - .dependency-cruiser.cjs (extended: 8 module rules -> 9 + bus-emit)
  - server/hooks/__tests__/dep-cruiser.spec.ts (extended: +1 it-block)
tech-stack:
  added: []
  patterns:
    - "Wave 0 substrate stub-then-body pattern (mirrors Phase 18-24)"
    - "MOD-02 strict 1-line internal/ re-export barrel"
    - "Throw-stub pattern for dep-cruiser resolvable target (8th repeat)"
    - "Two-pass err+json depcruise spec for fixture verification"
key-files:
  created:
    - server/pipelines/events.ts
    - server/pipelines/queue.ts
    - server/pipelines/internal/module.ts
    - server/pipelines/MODULE.md
    - server/pipelines/index.ts
    - server/pipelines/__tests__/events.spec.ts
    - __fixtures__/dep-cruiser/bad-pipelines-deep-import.ts
  modified:
    - server/queue/names.ts
    - server/queue/__tests__/names.spec.ts
    - .dependency-cruiser.cjs
    - server/hooks/__tests__/dep-cruiser.spec.ts
decisions:
  - "Wave 0 ships substrate ONLY: no runtime files in server/pipelines/ edited; no package.json edits"
  - "5 PIPELINE_EVENT_NAMES locked: run.started, stage.advanced, run.completed, run.failed, schedule.upserted"
  - "Throw-stub at server/pipelines/internal/module.ts gives dep-cruiser rule 9 a resolvable target (depcruise 17.x silently drops unresolvable imports)"
  - "QUEUE_NAMES gets ONE new entry: PIPELINE_SCHEDULED_EXECUTE (last node-cron migration target lands in 25-02)"
metrics:
  duration: ~12 minutes
  completed: 2026-05-08
  tasks: 3
  files_created: 7
  files_modified: 4
  tests_added: 11 (1 names + 1 events + 9 dep-cruiser regression confirmation)
---

# Phase 25 Plan 25-00: Pipelines Module Wave 0 Substrate Summary

Wave 0 substrate for Phase 25 Pipelines Module — ships scaffolding (events stub, queue alias, throw-stub, MODULE.md placeholder, MOD-02 barrel, dep-cruiser rule 9) that plans 25-01..25-05 depend on, WITHOUT touching any runtime file in `server/pipelines/` or editing `package.json`.

## Tasks Executed

### Task 0.1 — `f654779` — Extend `server/queue/names.ts` + spec

**Files modified:** `server/queue/names.ts`, `server/queue/__tests__/names.spec.ts`

- Inserted `PIPELINE_SCHEDULED_EXECUTE: 'pipeline.scheduled.execute'` alphabetically between `LIFECYCLE_RETENTION_DAILY` and `RECORDING_UPLOAD`.
- Extended JSDoc on `QUEUE_NAMES` with Phase 25 paragraph documenting the entry as the last node-cron migration target (boss.schedule + per-schedule `key` parameter, NOT singletonKey).
- Added `Phase 25 — PIPELINE_SCHEDULED_EXECUTE entry exists + valid` test asserting both the value and pg-boss validity.
- Result: 12 entries (was 11). All 7 names.spec assertions green.

### Task 0.2 — `55f396e` — Pipelines Wave 0 substrate stubs

**Files created:**

- `server/pipelines/events.ts` — 5 PIPELINE_EVENT_NAMES (`run.started`, `stage.advanced`, `run.completed`, `run.failed`, `schedule.upserted`) + `PipelineEventName` type + `PIPELINE_RUN_AGGREGATE_TYPE` + `PIPELINE_SCHEDULE_AGGREGATE_TYPE` + empty `pipelinesRegistry = {} as const satisfies EventRegistry`.
- `server/pipelines/queue.ts` — alias-only stub: `PIPELINE_SCHEDULED_EXECUTE_QUEUE_NAME = QUEUE_NAMES.PIPELINE_SCHEDULED_EXECUTE`.
- `server/pipelines/internal/module.ts` — throw-stub `createPipelinesModule(): never` body throws `Plan 25-03 not yet executed`. 8th repeat of the empirical Phase 18-24 pattern (depcruise needs a resolvable import target to fire rule 9 against).
- `server/pipelines/MODULE.md` — Purpose-only placeholder (full 9-section body lands in 25-05).
- `server/pipelines/index.ts` — MOD-02 strict 1-line barrel: `export { createPipelinesModule, type PipelinesModule } from './internal/module.js';`.
- `server/pipelines/__tests__/events.spec.ts` — 1-test EVENTS-03 shape stub asserting 5 keys, exact dotted past-tense values, uniqueness.

Verification: 1/1 events.spec test passes; tsc produces ZERO new errors in any of these files.

### Task 0.3 — `8ddebfe` — Dep-cruiser rule 9 + fixture + spec extension

**Files modified:** `.dependency-cruiser.cjs`, `server/hooks/__tests__/dep-cruiser.spec.ts`. **Created:** `__fixtures__/dep-cruiser/bad-pipelines-deep-import.ts`.

- Extended `.dependency-cruiser.cjs` header comment: now declares **9 forbidden module rules + 1 bus-emit guard** (was 8 + 1).
- Inserted rule 9 `no-deep-imports-into-pipelines-internal` after rule 8 (maestro), mirroring rule 8 verbatim with `maestro` → `pipelines`. Severity error, `pathNot: '^server/pipelines/'`, `path: '^server/pipelines/internal/'`.
- Validated config loads via `node -e "require('./.dependency-cruiser.cjs')"` (exits 0).
- Created fixture firing rule 9 via `@ts-expect-error` import from `server/pipelines/internal/module.js`.
- Extended `dep-cruiser.spec.ts` with `[MOD-02 pipelines extension]` it-block following the two-pass err+json pattern matching all 8 prior fixtures.

Verification: 9/9 dep-cruiser.spec it-blocks pass; `npm run dep-check` violation count UNCHANGED (3 pre-existing artifacts→streaming violations; rule 9 contributes 0 NEW because fixture lives in `__fixtures__/` outside `includeOnly: '^server/'`).

## Verification Results

| Check | Command | Result |
|-------|---------|--------|
| Names spec | `npx vitest run server/queue/__tests__/names.spec.ts` | 7/7 pass |
| Events spec | `npx vitest run server/pipelines/__tests__/events.spec.ts` | 1/1 pass |
| Dep-cruiser spec | `npx vitest run server/hooks/__tests__/dep-cruiser.spec.ts` | 9/9 pass |
| Combined | All three above in one invocation | 17/17 pass |
| Typecheck | `npx tsc --noEmit` | 10 pre-existing errors in 8 files (none in any of the new/edited files); ZERO NEW errors |
| Dep-check | `npm run dep-check` | 3 violations (all pre-existing artifacts→streaming/internal/types.ts); baseline UNCHANGED |
| Config validity | `node -e "require('./.dependency-cruiser.cjs')"` | exit 0 |

## Acceptance Criteria

- [x] `grep -c "PIPELINE_SCHEDULED_EXECUTE: 'pipeline.scheduled.execute'" server/queue/names.ts` = 1
- [x] QUEUE_NAMES literal entries count = 12 (was 11)
- [x] All 6 substrate files exist with correct stub content
- [x] `grep -c "## Purpose" server/pipelines/MODULE.md` = 1
- [x] `server/pipelines/index.ts` matches MOD-02 strict 1-line regex exactly
- [x] dep-cruiser rule `no-deep-imports-into-pipelines-internal` appears 2x (header + body)
- [x] Fixture imports `server/pipelines/internal/module` via `@ts-expect-error`
- [x] `[MOD-02 pipelines extension]` it-block present in dep-cruiser.spec
- [x] `npm run dep-check` baseline UNCHANGED
- [x] `npx tsc --noEmit` produces ZERO new errors

## Plans Unblocked

- **25-01** — events.ts full body (5 payload schemas + persistence flags + makePipelinesEmitters); queue.ts full body (registerPipelineScheduledExecuteQueue + Worker helpers).
- **25-02** — scheduler.ts boss.schedule migration (drops node-cron usage; uses `PIPELINE_SCHEDULED_EXECUTE_QUEUE_NAME`).
- **25-03** — `internal/module.ts` real `createPipelinesModule` body (replaces throw-stub); `executor`/`service` rewrite; `routes.ts` move under `internal/`; `node-cron` + `@types/node-cron` dropped from package.json.
- **25-04** — DB-gated subscriber.spec (3-stage pipeline via bus); correlation.spec; lifecycle-ownership.spec.
- **25-05** — MODULE.md full body; `.test.ts → .spec.ts` renames; plugin-order.spec extension; phase close-out.

## Confirmation: NO Runtime Files Edited

- `server/pipelines/scheduler.ts` — UNCHANGED (still uses node-cron; migration is 25-02 work).
- `server/pipelines/executor.ts` — UNCHANGED (Promise chain stays until 25-03).
- `server/pipelines/service.ts` — UNCHANGED (refactor in 25-03).
- `server/pipelines/plugin.ts` — UNCHANGED (thin rewrite in 25-03).
- `server/pipelines/routes.ts` — UNCHANGED.
- `package.json` — UNCHANGED (node-cron still listed; drop in 25-03).
- `server/index.ts` — UNCHANGED.

## Deviations from Plan

None — plan executed exactly as written. Each task's `read_first` files were inspected; existing patterns (Phase 24 maestro events stub, fixture, dep-cruiser it-block) were mirrored verbatim with `s/maestro/pipelines/`. The QUEUE_NAMES JSDoc extension landed at the existing block (no regeneration). Numeric renumbering of dep-cruiser rules preserved: bus-emit guard moved from rule 9 → rule 10 in the header comment (the rule itself is below all module rules, no behavior change).

## Self-Check: PASSED

All claimed files exist:
- FOUND: server/pipelines/events.ts
- FOUND: server/pipelines/queue.ts
- FOUND: server/pipelines/internal/module.ts
- FOUND: server/pipelines/MODULE.md
- FOUND: server/pipelines/index.ts
- FOUND: server/pipelines/__tests__/events.spec.ts
- FOUND: __fixtures__/dep-cruiser/bad-pipelines-deep-import.ts

All claimed commits exist on HEAD branch:
- FOUND: f654779 (Task 0.1 — QUEUE_NAMES extension)
- FOUND: 55f396e (Task 0.2 — pipelines substrate stubs)
- FOUND: 8ddebfe (Task 0.3 — dep-cruiser rule 9 + fixture + spec)
