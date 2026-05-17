---
phase: 16-pilot-module-hooks
plan: 00
subsystem: substrate
tags: [zod, typescript, event-registry, pg-boss, dependency-cruiser, adr, schemas]

# Dependency graph
requires:
  - phase: 15-fix-operational-dependencies
    provides: "TypedBus, createEventHelpers, EventRegistry types, QUEUE_NAMES registry + validator, envelopeSchema, no-direct-bus-emit ESLint rule, ADR-001 Pillar 5"
provides:
  - server/hooks/schemas.ts — single Zod source-of-truth for hookDefinitionSchema and HookDefinition = z.infer<typeof hookDefinitionSchema>
  - server/hooks/events.ts — hooksRegistry (4 entries), HOOK_EVENT_NAMES constants, makeHookEmitters factory, 4 payload schemas
  - server/hooks/__tests__/fixtures/test-registry.ts — synthetic test.trigger registry for bus→queue bridge exercises
  - QUEUE_NAMES.HOOK_RUN = 'hook.run' extension on server/queue/names.ts
  - docs/adr/002-file-naming.md — repo-wide kebab-case + reserved-filename governance
  - dependency-cruiser@^17.3.10 devDep installed (16-03 wires CI)
affects: [16-01, 16-02, 16-03, 16-04, 20-pool, 21-artifacts, 23-jobs]

# Tech tracking
tech-stack:
  added:
    - dependency-cruiser@^17.3.10 (devDep)
  patterns:
    - "Per-module EventRegistry + makeXEmitters factory returning {event: emit(aggId, payload)} helpers"
    - "Zod source-of-truth in schemas.ts; TypeScript types via z.infer<typeof schema> (SPEC-03)"
    - "Back-compat type re-exports from former declaration sites when symbols move to schemas.ts"
    - "persisted: true only on terminal events per TRACE-08"
    - "Synthetic test-fixture registries (under __tests__/fixtures/) for bridge tests until real cross-module events land"

key-files:
  created:
    - server/hooks/schemas.ts
    - server/hooks/events.ts
    - server/hooks/__tests__/fixtures/test-registry.ts
    - docs/adr/002-file-naming.md
  modified:
    - server/hooks/hook-executor.ts (HookEvent + HookDefinition delegated to schemas.ts via re-export)
    - server/hooks/plugin.ts (hookDefinitionSchema imported from ./schemas.js; local declaration removed; unused z + HookEvent imports pruned)
    - server/queue/names.ts (QUEUE_NAMES.HOOK_RUN added; doc comment extended)
    - docs/adr/README.md (ADR-002 row added to Index; "reserved for Phase 16" numbering note claimed)
    - package.json, package-lock.json (dependency-cruiser@^17.3.10 devDep)

key-decisions:
  - "HookEvent + HookDefinition re-exported from hook-executor.ts as back-compat shim — external consumers keep importing them from the old location without change"
  - "Unused z and HookEvent imports pruned from plugin.ts during the lift (scope-adjacent cleanup)"
  - "hookFailedPayload aliases hookCompletedPayload (same shape, different semantics — per-attempt vs terminal-success) rather than duplicating the Zod definition"
  - "ESLint /\\/events\\.ts$/ allowlist pattern already covers server/hooks/events.ts — confirmed no rule edit needed (RESEARCH Pitfall 4)"
  - "Typecheck baseline: 7 pre-existing top-level errors in unrelated modules (artifacts, bus, pipelines) — out-of-scope per deviation rule scope boundary; my changes add 0 new errors"

patterns-established:
  - "Per-module events.ts: 4-event registry with persisted:true on terminals only, makeEmitters factory wrapping createEventHelpers"
  - "Back-compat re-export pattern: when symbols move to schemas.ts, their former declaration site re-exports the types so external imports keep resolving"
  - "Test-fixture registries live under __tests__/fixtures/ and are NOT production code"

requirements-completed: [SPEC-01, SPEC-03, MOD-03, MOD-05, EVENTS-06, EVENTS-09]

# Metrics
duration: 8min
completed: 2026-04-17
---

# Phase 16 Plan 00: Pilot-Substrate Bootstrap Summary

**4-event hooks registry + schemas.ts source-of-truth (via z.infer) + QUEUE_NAMES.HOOK_RUN + ADR-002 file-naming + dependency-cruiser devDep — zero-runtime-change substrate that Wave 1+2 plans consume without re-deriving contracts**

## Performance

- **Duration:** 8 min
- **Started:** 2026-04-17T19:11:48Z
- **Completed:** 2026-04-17T19:20:11Z
- **Tasks:** 4
- **Files created:** 4
- **Files modified:** 5

## Accomplishments
- Single Zod source-of-truth for `HookDefinition` (`server/hooks/schemas.ts`) — hand-written interface deleted, type now derives via `z.infer<typeof hookDefinitionSchema>` (SPEC-03)
- Per-module 4-event registry + `HOOK_EVENT_NAMES` constants + `makeHookEmitters(bus, onEmit)` factory in `server/hooks/events.ts` (MOD-03)
- `test.trigger` synthetic fixture registry for bus→queue bridge exercises in later plans (EVENTS-09 prep)
- `QUEUE_NAMES.HOOK_RUN = 'hook.run'` extension (QUEUE-06 prep for 16-01 worker)
- ADR-002 Accepted: repo-wide kebab-case file-naming + reserved module filenames + colocated `__tests__/` convention (MOD-05)
- `dependency-cruiser@^17.3.10` devDep installed (16-03 wires `.dependency-cruiser.cjs` and CI)

## Task Commits

Each task committed atomically:

1. **Task 0.1: Install dependency-cruiser + extend QUEUE_NAMES with HOOK_RUN** — `1df6211` (chore)
2. **Task 0.2: Lift hookDefinitionSchema into schemas.ts + z.infer HookDefinition** — `25c4813` (refactor)
3. **Task 0.3: Create events.ts + test-registry fixture** — `462af7c` (feat)
4. **Task 0.4: Commit ADR-002 + update docs/adr/README.md Index** — `bf35b83` (docs)

**Plan metadata:** (pending final docs commit)

## Files Created/Modified

### Created
- `server/hooks/schemas.ts` — Zod source-of-truth: `hookDefinitionSchema` + `type HookDefinition = z.infer<...>` + `HookEvent` string-union type
- `server/hooks/events.ts` — `HOOK_EVENT_NAMES` constants, 4 payload Zod schemas, `hooksRegistry` (persisted on terminals only), `makeHookEmitters(bus, onEmit)` factory
- `server/hooks/__tests__/fixtures/test-registry.ts` — synthetic `test.trigger` event registry; `testTriggerPayload` Zod schema; used only by Phase 16 bridge-idempotency tests
- `docs/adr/002-file-naming.md` — Nygard-format ADR (525 words) with Status/Context/Decision/Consequences; covers casing, singular/plural rule, reserved filenames, test co-location, internal/ scope

### Modified
- `server/hooks/hook-executor.ts` — removed hand-written `HookEvent` type alias and `HookDefinition` interface; added type-import + re-export of both from `./schemas.js` (back-compat for existing consumers)
- `server/hooks/plugin.ts` — removed local `hookDefinitionSchema` declaration and `z` import; added `import { hookDefinitionSchema } from './schemas.js'`; added `export { hookDefinitionSchema } from './schemas.js'` for back-compat; pruned unused `HookEvent` import
- `server/queue/names.ts` — added `HOOK_RUN: 'hook.run'` to `QUEUE_NAMES`; extended doc comment with Phase 16 note
- `docs/adr/README.md` — added ADR-002 row to Index table; removed "002 reserved for Phase 16" numbering note (now claimed)
- `package.json`, `package-lock.json` — added `dependency-cruiser@^17.3.10` to devDependencies (resolved version: `17.3.10`)

## Decisions Made

- **HookEvent + HookDefinition re-exported from hook-executor.ts** — existing external imports of these types (e.g., `server/api/`, `server/jobs/`, `server/index.ts` plugin registrations) keep working without any call-site updates. The re-export shim costs 1 line and buys zero refactor noise in out-of-scope files.
- **Pruned unused `z` and `HookEvent` imports from plugin.ts during the lift** — the edit replacement made them unreferenced; leaving them would trip `@typescript-eslint/no-unused-vars`. Scope-adjacent cleanup, not a deviation.
- **`hookFailedPayload` aliases `hookCompletedPayload`** — same shape, different semantics (per-attempt failure before retry vs terminal retry-exhausted). Avoids duplicating the Zod definition. `hookFailedRetryExhaustedPayload` extends with `attempts`.
- **`persisted: true` only on `hook.completed` + `hook.failed.retryExhausted`** — matches TRACE-08 business/terminal-events rule exactly (CONTEXT §Event Design).
- **ESLint allowlist `/\\/events\\.ts$/` already covers `server/hooks/events.ts`** — confirmed by reading `eslint-local-rules/no-direct-bus-emit.js` line 28; no rule edit needed (RESEARCH Pitfall 4).
- **Typecheck baseline: 7 pre-existing top-level errors** — in `server/artifacts/recording-service.ts`, `server/bus/helpers.ts`, `server/bus/plugin.ts`, `server/events/__tests__/emit-helpers.spec.ts`, `server/pipelines/schema.ts`. All pre-date Phase 16 (stashed-diff comparison confirms). Out-of-scope per deviation-rule scope boundary — logged here, not fixed.

## Deviations from Plan

None - plan executed exactly as written.

### Scope-adjacent cleanup (not a deviation)

The plan's Task 0.2 action block removed `export const hookDefinitionSchema = z.object({...})` from plugin.ts, which also made `import { z } from 'zod'` and `type HookEvent` unused imports. Both imports were pruned as part of the same edit — this is local cleanup forced by the planned removal, not unplanned scope creep. Documented here for transparency; no Rule applies.

## Verification Results

**`npx tsc --noEmit`** — exits with 7 pre-existing errors (baseline: 7 before changes). Zero new errors in `server/hooks/`. Confirmed via git-stash diff that my 4 tasks add zero net typecheck regressions.

**`npm run lint`** — exits 0. The new `server/hooks/events.ts` is covered by existing `/\\/events\\.ts$/` allowlist in `eslint-local-rules/no-direct-bus-emit.js`. No lint regressions.

**`npm ls dependency-cruiser`** — `device-farm@0.1.0 /Users/heicg/Desktop/projects/device-farm\n└── dependency-cruiser@17.3.10`

**`grep "hookDefinitionSchema" server/hooks/*.ts`** — declared ONLY in `server/hooks/schemas.ts` (lines 7 in comment, 16 declaration, 26 in `z.infer<...>`); `server/hooks/plugin.ts` imports and re-exports only. No duplicate declarations anywhere in the tree.

**`grep "z.object({ name: z.string().min(1).max(255), event:" server/`** — zero matches (the distinctive pattern confirms the old plugin.ts declaration is gone and no copy lives anywhere else).

**Registry cardinality:** `persisted: true` on 2 entries (completed + retryExhausted), `persisted: false` on 2 entries (scheduled + failed), `aggregateType: 'hook'` on all 4 — matches TRACE-08 + CONTEXT §Event Design.

**ADR-002:** all 4 H2 sections (Status, Context, Decision, Consequences) present; Status line reads `Accepted — 2026-04-17`; word count 525 ≥ 300 required; README Index contains `| 002 | Repo-wide File-Naming Convention                  | Accepted | 2026-04-17 |` row; the "002 reserved for the Phase 16 file-naming ADR" numbering line is removed (slot claimed).

**Zod 4 `.default(...)` through `z.infer`** — verified by RESEARCH §Pitfall 5; no runtime behavior change observed. `HookDefinition` output type has all fields required (`platform: 'android' | 'ios' | 'all'`, etc.) just like the hand-written interface it replaced.

## Issues Encountered

None. The plan was prescriptive; all acceptance criteria passed first try.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

### Ready for 16-01 (queue worker + bus→queue bridge)
- `QUEUE_NAMES.HOOK_RUN` constant available: `import { QUEUE_NAMES } from '../queue/names.js'; QUEUE_NAMES.HOOK_RUN`
- `hooksRegistry` ready to construct `TypedBus<HooksRegistry>`: `import { hooksRegistry, makeHookEmitters } from './events.js'`
- `testRegistry` ready for `queue.spec.ts` bridge-idempotency exercises

### Ready for 16-02 (factory + plugin thin-wrap)
- `createHooksModule(deps)` can lift `hookDefinitionSchema` validation surface unchanged from `plugin.ts`
- `makeHookEmitters` factory signature matches Phase 15 `createEventHelpers` convention — factory wires `onEmit` to bus plugin's persistence middleware

### Ready for 16-03 (dependency-cruiser config + CI)
- `dependency-cruiser@17.3.10` resolved in `node_modules/`
- `dep-check` script deferred to 16-03 Task 3.1 per plan directive (this plan did NOT add it)

### Ready for 16-04 (MODULE.md + tests-as-spec)
- `HOOK_EVENT_NAMES` string-union type available for MODULE.md "Events Emitted" section
- ADR-002 locks naming convention referenced by MODULE.md skeleton

### Open items carried from Phase 15 (unchanged)
- Mac Mini graceful-shutdown live observation deferred (Plan 15-06 task 6.2) — no impact on 16-00

## Self-Check: PASSED

- All 4 created files present on disk
- All 5 modified files present on disk
- All 4 per-task commits (1df6211, 25c4813, 462af7c, bf35b83) in `git log`
- Typecheck baseline maintained (7 pre-existing errors, 0 new in hooks/)
- Lint clean
- dependency-cruiser@17.3.10 installed

---
*Phase: 16-pilot-module-hooks*
*Completed: 2026-04-17*
