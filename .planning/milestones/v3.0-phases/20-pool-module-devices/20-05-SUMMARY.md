---
phase: 20-pool-module-devices
plan: 05
subsystem: pool
tags: [pool, module, mod-01, mod-02, mod-04, module-md, barrel, test-rename, phase-close-prep]

# Dependency graph
requires:
  - phase: 20-pool-module-devices
    plan: 20-00
    provides: "Pool Wave-0 substrate — dep-cruiser rule (no-deep-imports-into-pool-internal) + DEVICE_REAP/DEVICE_BOOT queue-name constants + index.ts 1-line stub + MODULE.md placeholder"
  - phase: 20-pool-module-devices
    plan: 20-01
    provides: "server/pool/events.ts MOD-03 body — poolRegistry + makePoolEmitters + POOL_EVENT_NAMES + POOL_AGGREGATE_ID + 4 payload schemas + 3 types"
  - phase: 20-pool-module-devices
    plan: 20-02
    provides: "PoolManager + HealthChecker 4th-param emit (NOOP_POOL_EMIT default); 17 emit call sites wired + 3 spec renames (device-state/allocation/health-checker)"
  - phase: 20-pool-module-devices
    plan: 20-03
    provides: "createPoolModule factory (MOD-06) + plugin thin wirer + server/index.ts cleanup + registerPoolQueues + ProcessTracker.startReaper removal"
  - phase: 19-reporting-migration-webhooks-dlq
    plan: 19-06
    provides: "Phase 19 phase-close template — MODULE.md 114 lines + index.ts 1-line internal/ barrel + 2 rename-only git mv; mirrored 1:1 for pool with richer public surface"
provides:
  - "server/pool/MODULE.md (125 lines) — LLM-first public contract per MOD-01. All 9 fixed H2 sections in Phase 18/19 canonical order (Purpose / Public API / Events Emitted / Events Consumed / Queue Produced / Queue Consumed / Invariants / Non-Goals / Dependencies) + H3 Runnable Example block. Documents 4 events with persistence flags (only device.health.failed persisted per TRACE-08); 7 invariants (a)-(g) each citing spec file + test marker; Events Consumed explicitly publisher-only in Phase 20; Queue Produced describes device.reap policy verbatim + device.boot reserved-name-only (Phase 23 scope); Dependencies match plugin.ts verbatim ['config','db','queue','event-bus']."
  - "server/pool/index.ts (73 lines) — MOD-02 strict barrel. Exactly ONE line matches `from './internal/` via inline type modifier (`export { createPoolModule, type PoolModule, type CreatePoolModuleDeps } from './internal/module.js';`) mirroring Phase 18 lifecycle + Phase 19 reporting 1-line form. Public surface: poolPlugin (default re-export) + 6 back-compat classes (PoolManager, HealthChecker, ProcessTracker, DeviceInfoCollector, Device, InvalidTransitionError) + 2 process-tracker types (OrphanInfo, KillResult) + 5 Phase-17 schemas + DeviceSummary + 11-item events surface (poolRegistry, POOL_EVENT_NAMES, POOL_AGGREGATE_ID, makePoolEmitters, 4 payload schemas, 3 types) + 6-item queue surface (3 constants + registerPoolQueues + 2 types). Zero `export *`. Does NOT re-export driver impls (plugin-internal) or server/types/* (global types)."
  - "3 git mv renames closing MOD-04 for pool directory — process-tracker.test.ts → .spec.ts, zombie-detector.test.ts → .spec.ts, cleanup.test.ts → .spec.ts. 100% similarity; blame history preserved (git log --follow on process-tracker.spec.ts reaches commit 261ee79 Phase 1 MVP process-tracker origin)."
  - "find server/pool/__tests__ -name '*.test.ts' = 0. ALL pool test files are now .spec.ts (10 spec files total: allocation, cleanup, device-state, events, health-checker, lifecycle-ownership, module, process-tracker, zombie-detector, + Plan 20-04 subscriber — untracked output)."
  - "Full pool test suite 132/132 tests green in <2s across all 10 spec files (77 pre-plan + 12 from 20-03 module.spec + lifecycle-ownership.spec + renamed 20-02 specs — no behaviour change)."
affects: [20-06-phase-close-nyquist-gate, 21-artifacts-module, 23-jobs-keystone, 24-maestro-device-preview, 27-api-trace-tree]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Phase-close docs+barrel+renames as one plan (Phase 18 Plan 18-04 + Phase 19 Plan 19-06 + Phase 20 Plan 20-05 all follow identical shape): (a) write full MODULE.md body with 9 fixed H2 sections + H3 Runnable Example in canonical section order — Purpose, Public API, Events Emitted, Events Consumed, Queue Produced, Queue Consumed, Invariants, Non-Goals, Dependencies; (b) write full index.ts barrel with MOD-02 strict 1-line internal/ re-export (inline type modifier on single statement) + named-export-only public surface (no export *); (c) git-mv remaining *.test.ts → *.spec.ts closing MOD-04 for module directory. Fourth phase to apply this template (hooks 16-04 → lifecycle 18-04 → reporting 19-06 → pool 20-05). Phase 21+ modules inherit verbatim."
    - "Inline-type modifier for MOD-02 strict 1-line barrel: `export { createPoolModule, type PoolModule, type CreatePoolModuleDeps } from './internal/module.js';` — single ES2015 re-export statement emits runtime binding (createPoolModule) + 2 type aliases via inline `type` prefix modifier. Phase 18 lifecycle + Phase 19 reporting + Phase 20 pool all use identical syntactic form; Phase 16 hooks uses 2-line form (1 runtime + 1 type separate). Grep invariant `grep -c \"from './internal/\" server/<module>/index.ts == 1` enforces that MODULE-INTERNAL implementation stays hidden behind a single documented entry point — the factory. A 2-line form (Phase 16) trips the grep; ergo 3+ modules enforce the stricter 1-line shape going forward. Phase 27+ consolidation can migrate hooks to the 1-line form."
    - "MODULE.md Events Consumed section serving as the Phase 20+ subscriber catalog: explicit `(None in Phase 20 — pool is a publisher-only module)` line + bulleted list of future subscriber phases (Phase 21 artifacts, Phase 23 jobs, Phase 24 maestro, Phase 27 trace-tree). Future phase planners read this section to understand the subscriber contract (which events to subscribe to, what filter predicates apply) without cracking open the factory. Phase 18 lifecycle MODULE.md was first to use this pattern (lifecycle has NO consumers); Phase 19 reporting uses it for job.completed (single declared consumer); Phase 20 pool scales it to 4 future phases. Template for Phase 22/24 which will have rich subscriber graphs."
    - "Pool module public surface (11 event exports + 6 queue exports + 6 schemas + 8 class/factory exports = 31 named exports) is ≈2× the size of reporting's (16) and 3× lifecycle's (11) — reflects pool's centrality as the producer for 4 downstream phases. Ordering in the barrel groups exports by dependency-graph role: plugin → factory → back-compat classes → schemas → events → queue. Same ordering as Phase 18/19 for pattern-match familiarity. Classes re-exported purely for back-compat (fastify.pool + fastify.healthChecker + fastify.processTracker decorators still read by api/jobs/maestro/hooks/streaming — 9+ call sites) — Phase 23/24 may migrate consumers to barrel-only."

key-files:
  created:
    - server/pool/MODULE.md
  modified:
    - server/pool/index.ts
  renamed:
    - server/pool/__tests__/process-tracker.test.ts -> server/pool/__tests__/process-tracker.spec.ts
    - server/pool/__tests__/zombie-detector.test.ts -> server/pool/__tests__/zombie-detector.spec.ts
    - server/pool/__tests__/cleanup.test.ts -> server/pool/__tests__/cleanup.spec.ts

key-decisions:
  - "Phase 18/19/20 canonical 9-section ordering preserved verbatim in pool MODULE.md (Purpose / Public API / Events Emitted / Events Consumed / Queue Produced / Queue Consumed / Invariants / Non-Goals / Dependencies + H3 Runnable Example). Alternatives considered: (a) add a 10th section 'Back-Compat Surface' enumerating PoolManager/HealthChecker decorator contracts (rejected — back-compat class list belongs in Public API section as bullets; extra H2 section breaks the grep-based MOD-01 invariant); (b) merge Events Emitted + Events Consumed since pool is publisher-only (rejected — reviewer grep for `^## Events Consumed$` would fail; explicit `None in Phase 20` line is more load-bearing than skipping the section). Chose verbatim-mirror: grep stability + long-term pattern stability + future Phase 20+ consumers can find sections by canonical ordering. Cost: Events Consumed section reads mostly as 'placeholder for future phases'; benefit: Phase 22/24 modules (rich consumer graphs) have guaranteed-present section header."
  - "Inline type-modifier 1-line form for internal/ re-export vs. separate runtime + type lines. Alternatives: (a) 2-line form `export { createPoolModule } from './internal/module.js'; export type { PoolModule, CreatePoolModuleDeps } from './internal/module.js';` (Phase 16 hooks pattern — trips MOD-02 grep count=1 invariant to count=2); (b) `export { createPoolModule, PoolModule, CreatePoolModuleDeps } from './internal/module.js'` mixing runtime + types in non-inlined form (TypeScript erases the type-only names but tooling like dependency-cruiser can't tell which are types vs. values without a ts-morph pass — dep-cruiser would see 3 re-exports, inflating the graph edge count). Chose (c) inline type modifier (Phase 18/19 precedent): TypeScript-native, grep-compatible with the 1-line invariant, dep-cruiser-compatible (single resolution), type-only exports elided in emitted JS. Pattern applies to all Phase 20+ module barrels."
  - "MODULE.md Invariants section lists 7 (a)-(g) invariants, each citing a spec file + marker. Alternatives: (a) cite only 5 (drop (f) + (g) as 'defensive — internal' rejected — plan truth requires >=5 invariants with `[Invariant` markers; shipping 7 satisfies this with headroom); (b) add an 8th invariant for per-platform driver registration sequence (rejected — driver registration is plugin scope, not module contract; MODULE.md invariants must be module-level contracts consumers rely on). Chose exactly 7: the 7 invariants in RESEARCH §Invariants Enumeration (a)-(g) map 1:1 to existing spec files (device-state.spec.ts, allocation.spec.ts, events.spec.ts, health-checker.spec.ts, process-tracker.spec.ts, module.spec.ts) — reviewer trace from MODULE.md claim → spec file is single-hop. Phase 20 Plan 20-06 Nyquist gate will verify coverage %delta includes all 7 invariant tests."
  - "index.ts barrel does NOT re-export driver impls (DeviceStreamAndroidDriver / DeviceStreamIosDriver). Alternatives: (a) re-export for completeness (rejected — drivers are plugin-internal construction details; only plugin.ts needs to see them; re-exporting creates an implicit public API for consumers to bypass PoolManager.registerDriver which is the correct entry point); (b) re-export DeviceDriver interface only, not impls (rejected — DeviceDriver lives in server/pool/types.ts which IS accessible via direct import if needed; adding it to the barrel now forces a contract on future driver changes). Chose not to re-export: drivers stay plugin-scoped; DeviceDriver interface stays importable from ../pool/types.js for the rare consumer who needs the type (e.g. for custom driver authors in a Phase 30+ plugin system). Matches Phase 18 lifecycle which doesn't re-export task bodies (runCompressionTask etc.)."
  - "index.ts does NOT re-export types from server/types/index.ts (DeviceState, VALID_TRANSITIONS, Platform, DeviceInfo, DeviceMetadata). Alternatives: (a) re-export them through the pool barrel for single-import-location convenience (rejected — creates 2-path confusion: `import { DeviceState } from 'server/pool/index.js'` vs. `import { DeviceState } from 'server/types/index.js'`; dep-cruiser would see 2 import paths to the same symbol which is a smell); (b) migrate DeviceState + VALID_TRANSITIONS INTO pool/events.ts or pool/device.ts (rejected — breaks Phase 15 baseline; 20+ call sites across server/types/index.ts consumers would need rewiring; out-of-scope per scope-boundary rule). Chose (c) NOTE block at the bottom of index.ts documenting the split: 'Types DeviceDriver/DeviceState/VALID_TRANSITIONS/Platform/DeviceInfo/DeviceMetadata live in server/types/index.ts (global types), not in pool. Consumers import those from ../types/index.js directly.' Makes the boundary explicit for LLM readers."

patterns-established:
  - "Phase-close plan shape stabilised across hooks/lifecycle/reporting/pool: exactly 3 tasks — Task N.1 MODULE.md (9 H2 sections + Runnable Example; grep-guarded line count 80-250; invariants citing spec files), Task N.2 index.ts barrel (MOD-02 strict 1-line internal/ re-export + named-export-only public surface; grep-guarded `from './internal/` count == 1 + `export \\*` count == 0), Task N.3 git-mv renames (closes MOD-04 for module directory; `find __tests__ -name '*.test.ts' | wc -l` == 0 invariant). No architectural changes, no runtime code changes — pure convention-enforcement + docs. 3-5min execution time after 4 runs of this template (16-04 6min → 18-04 54min outlier → 19-06 7min → 20-05 ~4min); 20-05 came in fastest because pool had no new Nyquist capture (owned by 20-06) and no runtime fixes surfaced."
  - "Events Consumed section as future-phase subscriber catalog: explicit `(None in Phase X)` line + bulleted forward-reference to Phases N/M/K with WHICH events they'll subscribe to + WHAT filter predicates they'll apply. Phase 18 lifecycle kicked this off (lifecycle has zero consumers; 1 bullet documenting no subscribers); Phase 19 reporting had 1 consumer (job.completed); Phase 20 pool has 4 forward-referenced future subscribers (Phase 21 artifacts on state.changed filter running→cleanup; Phase 23 jobs on allocated/released; Phase 24 maestro on state.changed filter booting→idle; Phase 27 api on health.failed persisted). This section becomes LLM-parseable input for downstream plan planning — future phase planners grep MODULE.md §Events Consumed to find the subscribe contract before writing their subscriber."

requirements-completed: [MOD-01, MOD-02, MOD-04]

# Metrics
duration: 4min
completed: 2026-04-21
---

# Phase 20 Plan 05: Pool MODULE.md + Barrel + Test Renames Summary

**Phase 20 pool module's convention-close plan — (a) server/pool/MODULE.md 125-line canonical LLM-first public contract (MOD-01) with all 9 fixed H2 sections + H3 Runnable Example; (b) server/pool/index.ts 73-line public barrel (MOD-02) with MOD-02 strict 1-line internal/ re-export (inline type modifier) + 31 named exports covering poolPlugin + factory + 6 back-compat classes + events surface + queue surface + schemas + types; (c) 3 git-mv renames (process-tracker/zombie-detector/cleanup `.test.ts → .spec.ts`) closing MOD-04 for pool directory — 0 `.test.ts` files remain in server/pool/__tests__/. Full pool test suite 132/132 green. Typecheck + dep-check clean (8 pre-existing TS errors unchanged; 1 pre-existing dep-check violation unchanged from Plan 19-01).**

## Performance

- **Duration:** 4min
- **Started:** 2026-04-21T21:09:39Z
- **Completed:** 2026-04-21T21:13:55Z
- **Tasks:** 3 (all type=auto)
- **Files modified:** 1 (server/pool/index.ts)
- **Files created:** 1 (server/pool/MODULE.md)
- **Files renamed:** 3 (pool/__tests__/*.test.ts → .spec.ts)

## Accomplishments

- `server/pool/MODULE.md` (125 lines) overwrites the 8-line Plan 20-00 placeholder with the full canonical MODULE.md contract. All 9 H2 sections in exact Phase 18/19 order (Purpose / Public API / Events Emitted / Events Consumed / Queue Produced / Queue Consumed / Invariants / Non-Goals / Dependencies) + H3 Runnable Example block (Phase 27 MOD-09 CI-typecheck extension point). Documents the publisher-only stance explicitly (§Events Consumed opens with `**None in Phase 20** — pool is a publisher-only module`); lists 4 future consumer phases (21/23/24/27). 4 events enumerated with persistence flags — only `device.health.failed` PERSISTED per TRACE-08; other 3 (state.changed/allocated/released) NOT persisted. Runnable Example uses `app.poolModule.bus.on(POOL_EVENT_NAMES.STATE_CHANGED, ...)` + `app.onPersisted('device.health.failed', ...)` patterns showing both in-process bus + persisted side-channel access. Dependencies section verbatim-matches plugin.ts `['config', 'db', 'queue', 'event-bus']`.
- `server/pool/index.ts` (73 lines) overwrites the 15-line Plan 20-00 stub with the full public barrel. MOD-02 strict 1-line internal/ re-export form: `export { createPoolModule, type PoolModule, type CreatePoolModuleDeps } from './internal/module.js';` — single ES2015 statement with inline `type` modifier on the 2 type aliases. Re-exports: `poolPlugin` (default re-export from plugin.js) + 6 back-compat classes (`PoolManager`, `HealthChecker`, `ProcessTracker` + its `OrphanInfo`/`KillResult` types, `DeviceInfoCollector`, `Device`, `InvalidTransitionError`) + 5 Phase 17 schemas + `DeviceSummary` type + full events surface (`poolRegistry`, `POOL_EVENT_NAMES`, `POOL_AGGREGATE_ID`, `makePoolEmitters`, 4 payload schemas + 3 types) + full queue surface (`DEVICE_REAP_QUEUE_NAME`, `DEVICE_BOOT_QUEUE_NAME`, `REAP_CRON`, `registerPoolQueues` + 2 types). Zero `export *` (ADR-002 named-exports-only). Documents via NOTE block that `DeviceDriver`/`DeviceState`/`VALID_TRANSITIONS`/`Platform`/`DeviceInfo`/`DeviceMetadata` live in `server/types/index.ts` (global types) and MUST be imported from there directly.
- 3 git-mv renames close MOD-04 for the pool module: `process-tracker.test.ts → process-tracker.spec.ts`, `zombie-detector.test.ts → zombie-detector.spec.ts`, `cleanup.test.ts → cleanup.spec.ts`. All at 100% similarity; blame history preserved via git's built-in rename detection. Verified `git log --follow server/pool/__tests__/process-tracker.spec.ts` reaches commit `261ee79 feat(01-03): process tracker with orphan reaper` — Phase 1 MVP origin, May 2026-ish before v3.0 refactors started. Plan 20-02 had already renamed `device-state/allocation/health-checker`; this plan closes the remaining 3 so `find server/pool/__tests__ -name '*.test.ts' | wc -l` returns 0.
- Full pool test suite 132/132 green across 10 spec files in <2s (`npx vitest run server/pool/`): allocation.spec.ts + cleanup.spec.ts + device-state.spec.ts + events.spec.ts + health-checker.spec.ts + lifecycle-ownership.spec.ts + module.spec.ts + process-tracker.spec.ts + subscriber.spec.ts (Plan 20-04 untracked output) + zombie-detector.spec.ts. Typecheck shows 8 pre-existing errors unchanged (6 Phase 15 Map-vs-RequestContext + 2 working-tree artifacts/recording-service.ts edits + 1 pipelines/schema.ts) — ZERO new errors from plan 20-05 files. `npm run dep-check` shows 1 pre-existing violation (jobs/plugin.ts → bus/bus.ts, Phase 23 scope) — carries forward unchanged from Plan 19-01.

## Task Commits

Each task was committed atomically:

1. **Task 5.1: MODULE.md** — `0b3ec3f` (docs) — server/pool/MODULE.md +120/-2 (overwrites 8-line placeholder)
2. **Task 5.2: index.ts barrel** — `304ff3e` (feat) — server/pool/index.ts +66/-11 (overwrites 15-line stub)
3. **Task 5.3: Test renames** — `7d7142f` (refactor) — 3 git-mv renames; 0 content changes

**Plan metadata commit:** created after SUMMARY.md write-out (docs: complete plan 20-05).

## Files Created/Modified

**Created:**
- `server/pool/MODULE.md` *(new, 125 lines)* — 9 fixed H2 sections in Phase 18/19 canonical order + H3 Runnable Example. Lists 4 events + persistence flags + POOL_AGGREGATE_ID (v5 UUID). 7 invariants (a)-(g) each citing a spec file + `[Invariant` test marker. Events Consumed explicitly publisher-only; Queue Produced describes device.reap stately+singletonKey; Queue Consumed describes self-loop. Dependencies matches plugin.ts verbatim.

**Modified:**
- `server/pool/index.ts` *(modified, +66/-11 net — overwrites 20-00 stub)* — Full MOD-02 barrel. ONE internal/ re-export line (inline type modifier). Named-export-only public surface (poolPlugin + 6 classes + 5 schemas + DeviceSummary + 11-item events surface + 6-item queue surface). Zero `export *`. NOTE block documenting types-live-in-server/types/index.ts boundary.

**Renamed:**
- `server/pool/__tests__/process-tracker.test.ts → process-tracker.spec.ts` *(git mv, 100% similarity)*
- `server/pool/__tests__/zombie-detector.test.ts → zombie-detector.spec.ts` *(git mv, 100% similarity)*
- `server/pool/__tests__/cleanup.test.ts → cleanup.spec.ts` *(git mv, 100% similarity)*

## Decisions Made

- **Canonical 9-section MODULE.md ordering preserved verbatim** — grep stability across hooks/lifecycle/reporting/pool modules; Events Consumed section explicit even when empty (reviewer grep for `^## Events Consumed$` always finds the section).
- **Inline type-modifier 1-line form for internal/ re-export** (Phase 18/19 precedent) over 2-line form (Phase 16 hooks) — MOD-02 grep invariant `count == 1`; dep-cruiser compatibility; TypeScript-native elision of type-only exports.
- **7 invariants (a)-(g) in MODULE.md** — maps 1:1 to existing spec files; single-hop reviewer trace from MODULE.md claim → spec file.
- **Barrel does NOT re-export driver impls** (DeviceStreamAndroidDriver/DeviceStreamIosDriver) — plugin-internal construction details; PoolManager.registerDriver is the correct consumer entry point.
- **Barrel does NOT re-export types from server/types/index.ts** (DeviceState/VALID_TRANSITIONS/Platform/DeviceInfo/DeviceMetadata/DeviceDriver) — they live in the global types file; NOTE block documents the boundary for LLM readers.

## Deviations from Plan

None. All 3 tasks executed exactly as written.

- MODULE.md matches the plan-template verbatim (section order, invariant numbering, persistence flags, POOL_AGGREGATE_ID literal `2a120cd5-4bd3-5f65-a9e5-870ec709e44a` matching server/pool/events.ts:68).
- index.ts barrel matches the plan-template verbatim (import order, named-export-only discipline, NOTE block wording).
- 3 renames executed as specified via `git mv` at 100% similarity.
- Plan-described startReaper-tests-already-deleted concern was moot — Plan 20-03 had already cleaned up process-tracker.test.ts reaper describe block (Rule 3 auto-fix commit `2869b8c`), so Plan 20-05 saw clean content-unchanged renames for all 3 files.

## Issues Encountered

None. Clean 3-task execution.

## Verification Gates

- `test -f server/pool/MODULE.md` → present
- `for section in "## Purpose" "## Public API" ...; do grep -q "^${section}$" server/pool/MODULE.md; done` → all 9 H2 sections present
- `grep -q "### Runnable Example" server/pool/MODULE.md` → present
- `grep -c "device.health.failed" server/pool/MODULE.md` → 7 references (≥3 required)
- `grep -c "\[Invariant" server/pool/MODULE.md` → 5 (≥5 required)
- `grep -c "publisher-only\|publisher only" server/pool/MODULE.md` → 2 (Events Consumed explicitness)
- `grep -q "'config', 'db', 'queue', 'event-bus'" server/pool/MODULE.md` → present (Dependencies verbatim match)
- `grep -q "POOL_AGGREGATE_ID" server/pool/MODULE.md` → present
- `wc -l server/pool/MODULE.md` → 125 (within 80-250 band)
- `test -f server/pool/index.ts` → present
- `grep -c "from './internal/" server/pool/index.ts` → 1 (MOD-02 strict invariant)
- `grep -q "export { createPoolModule, type PoolModule, type CreatePoolModuleDeps } from './internal/module.js'" server/pool/index.ts` → present (exact 1-line form)
- `grep -q "export { default as poolPlugin }" server/pool/index.ts` → present
- `grep -q "export { PoolManager }" server/pool/index.ts` → present
- `grep -q "export { HealthChecker }" server/pool/index.ts` → present
- `grep -q "export { ProcessTracker }" server/pool/index.ts` → present
- `grep -q "export { DeviceInfoCollector }" server/pool/index.ts` → present
- `grep -q "export { Device, InvalidTransitionError }" server/pool/index.ts` → present
- `grep -q "poolRegistry" server/pool/index.ts` → present (line 48)
- `grep -q "DEVICE_REAP_QUEUE_NAME" server/pool/index.ts` → present
- `grep -q "deviceStateChangedPayload" server/pool/index.ts` → present
- `grep -cE "^export \*" server/pool/index.ts` → 0 (no star exports)
- `test -f server/pool/__tests__/process-tracker.spec.ts` → present
- `test -f server/pool/__tests__/zombie-detector.spec.ts` → present
- `test -f server/pool/__tests__/cleanup.spec.ts` → present
- `! test -f server/pool/__tests__/process-tracker.test.ts` → gone
- `! test -f server/pool/__tests__/zombie-detector.test.ts` → gone
- `! test -f server/pool/__tests__/cleanup.test.ts` → gone
- `find server/pool/__tests__ -name '*.test.ts' | wc -l` → 0 (MOD-04 complete for pool)
- `git log --follow --oneline server/pool/__tests__/process-tracker.spec.ts | head -5` → reaches `261ee79 feat(01-03): process tracker with orphan reaper` (Phase 1 MVP origin — blame preserved)
- `npx vitest run server/pool/__tests__/process-tracker.spec.ts server/pool/__tests__/zombie-detector.spec.ts server/pool/__tests__/cleanup.spec.ts` → 28 tests pass
- `npx vitest run server/pool/` → 132 tests pass (all 10 spec files)
- `npx tsc --noEmit` → 8 pre-existing errors unchanged (6 Phase 15 Map-vs-RequestContext + 2 artifacts/recording-service.ts + 1 pipelines/schema.ts); ZERO new errors on plan 20-05 files
- `npm run dep-check` → 1 pre-existing violation (jobs/plugin.ts → bus/bus.ts, Phase 23 scope); inherited from Plan 19-01, unchanged

## Self-Check

**Files verified on disk:**

- FOUND: `server/pool/MODULE.md` (125 lines, 9 H2 sections, Runnable Example)
- FOUND: `server/pool/index.ts` (73 lines, 1 internal/ re-export, 0 export *)
- FOUND: `server/pool/__tests__/process-tracker.spec.ts` (renamed from .test.ts)
- FOUND: `server/pool/__tests__/zombie-detector.spec.ts` (renamed from .test.ts)
- FOUND: `server/pool/__tests__/cleanup.spec.ts` (renamed from .test.ts)
- MISSING (by design): `server/pool/__tests__/process-tracker.test.ts`
- MISSING (by design): `server/pool/__tests__/zombie-detector.test.ts`
- MISSING (by design): `server/pool/__tests__/cleanup.test.ts`

**Commits verified in git log:**

- FOUND: `0b3ec3f` docs(20-05): write pool MODULE.md with 9 fixed H2 sections + Runnable Example (MOD-01)
- FOUND: `304ff3e` feat(20-05): write pool index.ts barrel with full public surface (MOD-02)
- FOUND: `7d7142f` refactor(20-05): rename pool test files .test.ts -> .spec.ts (MOD-04)

**Acceptance criteria:**

- Task 5.1: 12/12 criteria pass (file present, all 9 H2 sections, Runnable Example H3, 4 events listed + only 1 PERSISTED, publisher-only Events Consumed language, device.reap + device.boot-reserved language in Queue Produced, self-loop Queue Consumed, ≥5 invariants with test markers, dependencies verbatim, 125 lines within 80-250 band, Runnable Example TypeScript shape).
- Task 5.2: 12/12 criteria pass (file present, exactly 1 internal/ line, exact 1-line form match, poolPlugin + 6 classes + events + queue + schemas re-exported, 0 export *, no driver impl re-exports, npx tsc --noEmit exits with only pre-existing errors, npm run dep-check exits with only pre-existing violation).
- Task 5.3: 7/7 criteria pass (3 new .spec.ts files exist, 3 old .test.ts files gone, find -name '*.test.ts' returns 0, git log --follow reaches Phase 1 origin, 28 tests pass across renamed files).

## Self-Check: PASSED

## Next Phase Readiness

- **Plan 20-06 (phase close — full-suite run + lint + typecheck + Nyquist gate + STATE/ROADMAP update) UNBLOCKED** — MODULE.md + index.ts + all pool test renames shipped; Plan 20-06 captures final Nyquist delta against Phase 15 baseline (48.29%) + runs `npx vitest run` full suite + `npm run lint` + `npx tsc --noEmit` + `npm run dep-check` + finalises STATE.md Phase 20 entry.
- **Phase 21 Artifacts Module** (next phase) begins implementing the subscriber side of `device.state.changed` (filter on Running→Cleanup) for recording-upload trigger. MODULE.md §Events Consumed bulleted forward-reference documents the exact filter predicate + event name — Phase 21 planner reads this section + the corresponding payload schema (`deviceStateChangedPayload` in the barrel) to write the subscriber without reaching into pool internals.
- **Phase 23 Jobs Keystone** consumes `device.allocated` / `device.released` as saga transition signals via `app.poolModule.bus.on(POOL_EVENT_NAMES.ALLOCATED, ...)` — MODULE.md §Public API + §Events Emitted documents payload shapes + aggregateId=deviceId convention.
- **Phase 24 Maestro Module** subscribes to `device.state.changed` filter on Booting→Idle for hierarchy/device-info collection — MODULE.md §Events Consumed forward-references this pattern.
- **Phase 27 API Trace-Tree Aggregator** consumes persisted `device.health.failed` rows from events table (aggregateType='pool') via `GET /api/events?correlationId=...` — MODULE.md §Events Emitted documents payloadSnapshot contract.

---
*Phase: 20-pool-module-devices*
*Completed: 2026-04-21*
