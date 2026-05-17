---
phase: 21-artifacts-module
plan: 00
subsystem: infra
tags: [pg-boss, event-bus, dep-cruiser, module-pattern, queue-names, zod, vitest]

# Dependency graph
requires:
  - phase: 20-pool-module-devices
    provides: Module pattern template (MODULE.md + index.ts barrel + events.ts + queue.ts + internal/module.ts + dep-cruiser rule) and QUEUE_NAMES registry to extend
  - phase: 19-reporting-migration-webhooks-dlq
    provides: On-demand queue + bus-subscriber pattern (webhook.deliver shape — retryLimit+retryBackoff via boss.createQueue, no schedule)
  - phase: 18-lifecycle-migration-node-cron-pg-boss
    provides: AGGREGATE_ID v5 derivation convention and throw-stub substrate pattern for resolvable dep-cruiser targets
  - phase: 16-pilot-module-hooks
    provides: MOD-02 dep-cruiser rule template + fixture/spec two-pass err+json pattern
provides:
  - RECORDING_UPLOAD queue-name constant added to QUEUE_NAMES (10 entries total, alphabetized)
  - server/artifacts/events.ts stub with ARTIFACTS_EVENT_NAMES + ARTIFACTS_AGGREGATE_ID placeholder + empty artifactsRegistry
  - server/artifacts/queue.ts stub with RECORDING_UPLOAD_QUEUE_NAME alias
  - server/artifacts/internal/module.ts throw-stub (resolvable dep-cruiser import target)
  - server/artifacts/MODULE.md placeholder (Purpose H2 only; full 9-section body in 21-06)
  - server/artifacts/index.ts barrel stub (1 internal/ re-export line — MOD-02 invariant)
  - server/artifacts/__tests__/events.spec.ts stub (1 test asserting EVENTS-03 shape)
  - .dependency-cruiser.cjs no-deep-imports-into-artifacts-internal rule (5th module rule; 6 forbidden rules total)
  - __fixtures__/dep-cruiser/bad-artifacts-deep-import.ts fixture triggering the new rule
  - server/hooks/__tests__/dep-cruiser.spec.ts extended with [MOD-02 artifacts extension] it-block (5 tests total green)
affects: [21-01, 21-02, 21-03, 21-04, 21-05, 21-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Wave-0 substrate pattern: ship queue-name + events.ts + queue.ts + internal/module.ts throw-stub + MODULE.md placeholder + index.ts barrel + spec stub + dep-cruiser rule + fixture + spec extension in one atomic plan"
    - "On-demand queue constant extraction ahead of factory body (matches Phase 16 hook.run + Phase 19 webhook.deliver — no boss.schedule call)"
    - "4-line throw-stub pattern for dep-cruiser resolvable target (4th repeat: hooks → lifecycle → reporting → pool → artifacts)"

key-files:
  created:
    - server/artifacts/events.ts
    - server/artifacts/queue.ts
    - server/artifacts/internal/module.ts
    - server/artifacts/MODULE.md
    - server/artifacts/index.ts
    - server/artifacts/__tests__/events.spec.ts
    - __fixtures__/dep-cruiser/bad-artifacts-deep-import.ts
  modified:
    - server/queue/names.ts
    - .dependency-cruiser.cjs
    - server/hooks/__tests__/dep-cruiser.spec.ts

key-decisions:
  - "ARTIFACTS_AGGREGATE_ID placeholder '00000000-0000-5000-8000-000000000021' landed here; Plan 21-02 replaces with real v5('artifacts', URL_NAMESPACE) derivation + test assertion (Phase 18/19/20 empirical sequencing — compute real UUID when payload schemas land, not in substrate)"
  - "artifactsRegistry stub ships as empty {} object — Plan 21-02 replaces with full 3-event registry incl. payload schemas + TRACE-08 persistence flags without unused-import cascade"
  - "Throw-stub at internal/module.ts is REQUIRED (not optional) for dep-cruiser rule to fire — depcruise 17.x silently drops unresolvable imports per Phase 18/19/20 empirical (plan 21-00 is the 4th repeat of the same finding)"
  - "RECORDING_UPLOAD doc-comment ships with full context (policy:'stately', retryLimit:3, singletonKey:recordingId for SC3 idempotency) so future consumers land on the same semantics without re-deriving"

patterns-established:
  - "Phase 21 mirrors Phase 20 Plan 20-00 task-by-task (4 tasks, same ordering): QUEUE_NAMES extension → events.ts+spec stub → queue/module/MODULE/index stubs → dep-cruiser rule+fixture+spec"
  - "Wave-0 substrate lands ALL scaffolding stubs in one atomic plan so plans 21-01..21-06 can run in their own waves without serialising on shape-definition churn"

requirements-completed: [SC2, MOD-01, MOD-02, MOD-03, MOD-05, QUEUE-06]

# Metrics
duration: 21min
completed: 2026-04-22
---

# Phase 21 Plan 00: Artifacts Module Wave-0 Substrate Summary

**Wave-0 scaffolding for Phase 21 Artifacts Module: RECORDING_UPLOAD queue-name + artifacts/{events.ts, queue.ts, internal/module.ts, MODULE.md, index.ts, __tests__/events.spec.ts} stubs + 5th dep-cruiser module rule — zero runtime service files touched.**

## Performance

- **Duration:** 21 min
- **Started:** 2026-04-22T16:32:29Z
- **Completed:** 2026-04-22T16:53:33Z
- **Tasks:** 4
- **Files created:** 7
- **Files modified:** 3

## Accomplishments

- QUEUE_NAMES extended from 9 → 10 entries with `RECORDING_UPLOAD: 'recording.upload'` alphabetized between LIFECYCLE_RETENTION_DAILY and WEBHOOK_DELIVER; passes `isValidQueueName` charset regex; doc-comment documents policy:'stately' + retryLimit:3 + singletonKey:recordingId semantics for downstream consumers.
- `server/artifacts/events.ts` stub ships ARTIFACTS_EVENT_NAMES (3 dotted past-tense keys per EVENTS-03) + ARTIFACTS_AGGREGATE_ID placeholder UUID + empty `artifactsRegistry` placeholder; matching spec stub (1 test) proves EVENTS-03 shape — plan 21-02 will replace with real v5 UUID + payload schemas + registry body + makeArtifactsEmitters factory.
- `server/artifacts/queue.ts` stub exports `RECORDING_UPLOAD_QUEUE_NAME` only; factory body `registerArtifactsWorker` lands in Plan 21-03.
- `server/artifacts/internal/module.ts` ships 4-line throw-stub (throws "Plan 21-04 not yet executed") satisfying the REQUIRED Phase 18/19/20 empirical pattern — dep-cruiser 17.x silently drops unresolvable imports, so rule cannot fire without a real resolvable target file.
- `server/artifacts/MODULE.md` placeholder with single `## Purpose` H2 section satisfies MOD-01 file-existence check across plans 21-01..21-05; full 9-section body lands in 21-06.
- `server/artifacts/index.ts` barrel stub exports exactly ONE re-export from internal/module.js — MOD-02 strict 1-line internal/ re-export invariant (matches Phase 18 lifecycle, stricter than Phase 16 hooks 2-line form).
- `.dependency-cruiser.cjs` gains 5th module rule `no-deep-imports-into-artifacts-internal` (6 forbidden rules total: hooks + lifecycle + reporting + pool + artifacts + direct-bus-emit); header comment bumped from "Five forbidden rules" to "Six forbidden rules" with Phase 21 ownership annotation.
- `__fixtures__/dep-cruiser/bad-artifacts-deep-import.ts` fixture imports from `server/artifacts/internal/module.js` via `@ts-expect-error` — fires the new rule when depcruise runs against it.
- `server/hooks/__tests__/dep-cruiser.spec.ts` extended with 5th `it('[MOD-02 artifacts extension] …')` block (two-pass err-reporter + json-reporter pattern preserved); all 5 it-blocks green.
- Committed-codebase `npm run dep-check` reports same 1 pre-existing violation (server/jobs/plugin.ts → server/bus/bus.ts; Phase 23 scope, documented in STATE.md `Accumulated Context`) — ZERO new artifacts-rule violations on production code because `server/artifacts/internal/` only contains the in-module throw-stub.

## Task Commits

Each task was committed atomically:

1. **Task 0.1: Extend QUEUE_NAMES with RECORDING_UPLOAD** — `eddfe0a` (feat)
2. **Task 0.2: Create events.ts + events.spec.ts stubs** — `6c0dcd5` (feat)
3. **Task 0.3: Create queue.ts + internal/module.ts + MODULE.md + index.ts stubs** — `812ecb9` (feat)
4. **Task 0.4: Add dep-cruiser rule + fixture + spec extension** — `b6502d2` (feat)

## Files Created/Modified

### Created
- `server/artifacts/events.ts` (47 lines) — ARTIFACTS_EVENT_NAMES + ARTIFACTS_AGGREGATE_ID placeholder + empty artifactsRegistry
- `server/artifacts/queue.ts` (20 lines) — RECORDING_UPLOAD_QUEUE_NAME alias
- `server/artifacts/internal/module.ts` (10 lines) — throw-stub
- `server/artifacts/MODULE.md` (7 lines) — Purpose-only placeholder
- `server/artifacts/index.ts` (23 lines) — barrel with 1 internal/ re-export
- `server/artifacts/__tests__/events.spec.ts` (22 lines) — 1 EVENTS-03 shape test
- `__fixtures__/dep-cruiser/bad-artifacts-deep-import.ts` (16 lines) — rule-trigger fixture

### Modified
- `server/queue/names.ts` (+5 lines) — RECORDING_UPLOAD entry + doc-comment extension
- `.dependency-cruiser.cjs` (+18 lines) — 5th module rule + header comment bump from 5→6 rules
- `server/hooks/__tests__/dep-cruiser.spec.ts` (+63 lines) — [MOD-02 artifacts extension] it-block + ARTIFACTS_FIXTURE constant

## Decisions Made

- **ARTIFACTS_AGGREGATE_ID placeholder pattern:** Shipped as `'00000000-0000-5000-8000-000000000021'` (v5-shape matching previous phases' placeholder form). Plan 21-02 will replace with real `uuidv5('artifacts', '6ba7b811-9dad-11d1-80b4-00c04fd430c8')` derivation + test-time assertion that runtime literal matches re-derived UUID (matches Phase 18/19/20 verification pattern — prevents stale plan literals from drifting).
- **Empty `artifactsRegistry = {} as const`:** Intentional empty stub. Plan 21-02 will overwrite with full typed registry `{...} as const satisfies EventRegistry`. Empty shape here prevents unused-import warning cascade in the spec stub while leaving the binding name stable across 21-00 → 21-02 transition.
- **ONE re-export in index.ts:** MOD-02 strict 1-line internal/ re-export invariant enforced even at stub stage (`export { createArtifactsModule } from './internal/module.js';`). Matches Phase 18 lifecycle precedent; stricter than Phase 16 hooks 2-line form. Keeps the barrel structurally identical to the final Plan 21-06 shape — 21-06 adds additional named re-exports but never widens the internal/ re-export count.
- **Doc-comment in names.ts:** Added full Phase 21 context (on-demand queue, policy:'stately', retryLimit:3, singletonKey:recordingId for SC3) so downstream plans (21-03 factory, 21-04 subscribers) land on the same semantic contract without re-deriving from RESEARCH.md.

## Deviations from Plan

None - plan executed exactly as written. All 4 tasks matched precedent from Phase 20 Plan 20-00 task-by-task; verify scripts passed on first attempt; typecheck reported identical 8 pre-existing errors across 6 files (Phase 15 Map-vs-RequestContext drift + working-tree artifacts service edits + pipelines/schema.ts arity — all documented in STATE.md and untouched by this plan).

## Issues Encountered

None. The only pre-existing issue surfaced by verification was:
- `npm run dep-check` reports 1 pre-existing violation `server/jobs/plugin.ts → server/bus/bus.ts` (from plan 19-01 jobs module bridgehead) — out of scope per scope-boundary rule; documented in STATE.md as Phase 23 Jobs Module Keystone.

## User Setup Required

None - pure-code Wave-0 substrate with no external services, environment variables, or dashboard configuration.

## Next Phase Readiness

All Phase 21 downstream plans unblocked:
- **Plan 21-01** (DB migration + idempotent insert): substrate stable; can extend schema + ArtifactService.
- **Plan 21-02** (events body + `job.started` bridgehead extension): will overwrite `events.ts` stub with real v5 UUID + payload schemas + typed registry + makeArtifactsEmitters factory + extend spec with emit-envelope assertions.
- **Plan 21-03** (queue worker): will overwrite `queue.ts` stub with `registerArtifactsWorker(deps)` factory using the 2-step on-demand sequence documented in the stub doc-comment.
- **Plan 21-04** (factory + subscribers + `job-service.ts` imperative-call deletion): will overwrite `internal/module.ts` throw-stub with real `createArtifactsModule(deps)` — the MOD-02 rule added in this plan enforces the boundary structurally from the moment real body lands.
- **Plan 21-05** (DB-gated proofs): substrate stable.
- **Plan 21-06** (MODULE.md body + barrel expansion + renames + Nyquist): will replace MODULE.md placeholder with 9-section canonical body and widen index.ts barrel with event/queue/schema/plugin surfaces.

Plan 21-00 achieves parity with Phase 20 Plan 20-00 structure — Wave-0 substrate lands cleanly in ~21 min (vs Phase 20-00's 7 min; Phase 21-00 slightly longer due to fuller doc-comment context on new constants and MODULE.md placeholder wording).

## Self-Check: PASSED

Files verified on disk:
- FOUND: server/artifacts/events.ts
- FOUND: server/artifacts/queue.ts
- FOUND: server/artifacts/internal/module.ts
- FOUND: server/artifacts/MODULE.md
- FOUND: server/artifacts/index.ts
- FOUND: server/artifacts/__tests__/events.spec.ts
- FOUND: __fixtures__/dep-cruiser/bad-artifacts-deep-import.ts

Commits verified via `git log --oneline`:
- FOUND: eddfe0a (Task 0.1 — QUEUE_NAMES extension)
- FOUND: 6c0dcd5 (Task 0.2 — events.ts + events.spec.ts stubs)
- FOUND: 812ecb9 (Task 0.3 — queue/module/MODULE/index stubs)
- FOUND: b6502d2 (Task 0.4 — dep-cruiser rule + fixture + spec extension)

Runtime verification:
- QUEUE_NAMES.length === 10 (was 9 after Phase 20)
- `npx vitest run server/artifacts/__tests__/events.spec.ts` → 1/1 pass
- `npx vitest run server/hooks/__tests__/dep-cruiser.spec.ts` → 5/5 pass (hooks + lifecycle + reporting + pool + artifacts)
- `npx vitest run server/queue/__tests__/names.spec.ts` → 6/6 pass
- `npx tsc --noEmit` → 8 pre-existing errors in 6 files (identical to pre-plan HEAD; zero new errors)
- `npm run dep-check` → 1 pre-existing violation (jobs/plugin.ts → bus/bus.ts; Phase 23 scope); zero new artifacts-rule violations

---
*Phase: 21-artifacts-module*
*Completed: 2026-04-22*
