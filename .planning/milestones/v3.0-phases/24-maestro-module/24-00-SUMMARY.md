---
phase: 24-maestro-module
plan: 00
subsystem: infra
tags: [module-migration, maestro, dep-cruiser, events, substrate, mod-02]

# Dependency graph
requires:
  - phase: 22-streaming-module
    provides: no-queue module template, 6th persistEnvelope sample, cross-module subscriber onReady pattern
  - phase: 23-jobs-module-keystone
    provides: 7th dep-cruiser rule + 7th persistEnvelope sample (most recent template)
  - phase: 20-pool-module-devices
    provides: 4-event poolRegistry shape; this plan extends with 5th BOOTED placeholder
provides:
  - server/maestro/{events.ts, queue.ts, internal/module.ts, MODULE.md, index.ts} substrate stubs
  - server/maestro/__tests__/events.spec.ts EVENTS-03 stub (1 passing test)
  - server/pool/events.ts: 5th key BOOTED placeholder (registry stays at 4 entries)
  - .dependency-cruiser.cjs: 8th forbidden rule no-deep-imports-into-maestro-internal
  - __fixtures__/dep-cruiser/bad-maestro-deep-import.ts fixture
  - server/hooks/__tests__/dep-cruiser.spec.ts: 8th [MOD-02 maestro extension] it-block
affects: [24-01, 24-02, 24-03, 24-04, 24-05]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Substrate-first wave-0 plan (mirrors Phase 22 Plan 22-00 + Phase 23 Plan 23-00)"
    - "Pool-events placeholder-first split: constant in Wave 0, schema+registry+helper in Wave 1"
    - "Throw-stub pattern for resolvable internal/module.ts (7th repeat)"
    - "EVENTS-03 dotted past-tense regex extended to allow dashes in middle segment (maestro.device-info.collected)"

key-files:
  created:
    - server/maestro/events.ts
    - server/maestro/queue.ts
    - server/maestro/internal/module.ts
    - server/maestro/MODULE.md
    - server/maestro/index.ts
    - server/maestro/__tests__/events.spec.ts
    - __fixtures__/dep-cruiser/bad-maestro-deep-import.ts
  modified:
    - server/pool/events.ts
    - server/pool/__tests__/events.spec.ts
    - .dependency-cruiser.cjs
    - server/hooks/__tests__/dep-cruiser.spec.ts

key-decisions:
  - "POOL_EVENT_NAMES.BOOTED constant added to pool/events.ts in Wave 0; payload schema + 5th poolRegistry entry + makePoolEmitters helper deferred to Plan 24-01 per placeholder-first pattern"
  - "MAESTRO_AGGREGATE_ID seeded with bogus literal '00000000-0000-5000-8000-000000000024' as grep-flag so Plan 24-01 cannot land without replacing with real v5 UUID 'ceb331df-a288-5be5-b801-cbdfc4deec4a'"
  - "Pool events.spec EVENTS-03 regex broadened from /^[a-z]+(\\.[a-z]+)+$/ to /^[a-z]+(\\.[a-z-]+)+$/ to permit dash-separated middle segments — required so future maestro 'device-info' style names also pass the same shape rule"

patterns-established:
  - "Wave-0 substrate plan (10 files: 5 maestro stubs + 1 maestro spec stub + 1 pool placeholder + 3 dep-cruiser artifacts) + 0 runtime edits"
  - "Cross-module event registry placeholder (BOOTED in POOL_EVENT_NAMES) precedes registry body to keep Plan 24-01 wave-1 work isolated"

requirements-completed: [MOD-01, MOD-02, MOD-03, MOD-05]

# Metrics
duration: ~9min
completed: 2026-05-08
---

# Phase 24 Plan 00: Maestro Module Wave-0 Substrate Summary

**Created 7-file maestro module substrate stub set + 5th POOL_EVENT_NAMES.BOOTED placeholder + 8th dep-cruiser forbidden rule (no-deep-imports-into-maestro-internal); zero runtime edits; substrate ready for Plans 24-01..24-05.**

## Performance

- **Duration:** ~9 min
- **Started:** 2026-05-08T08:59:17Z
- **Completed:** 2026-05-08T09:08:05Z (approx)
- **Tasks:** 3
- **Files modified:** 10 (7 created + 3 edited)

## Accomplishments
- 5 maestro substrate stubs (events.ts/queue.ts/internal/module.ts/MODULE.md/index.ts) per MOD-01..MOD-06 conventions
- POOL_EVENT_NAMES extended from 4 to 5 keys; poolRegistry deliberately stays at 4 entries (Plan 24-01 fills 5th)
- 8th dep-cruiser forbidden rule + fixture + spec extension (8/8 [MOD-02 *] it-blocks pass)
- Maestro events.spec.ts stub (1 passing test for EVENTS-03 dotted past-tense shape with 2 keys)
- Zero runtime edits — server/maestro/{plugin,hierarchy-service,appium-service}.ts and server/pool/{pool-manager,index,MODULE.md}.ts and server/index.ts all untouched per Wave 0 invariant

## Task Commits

Each task was committed atomically:

1. **Task 0.1: Create maestro substrate stubs** - `fadfc27` (feat)
2. **Task 0.2: Extend pool/events.ts with BOOTED placeholder + maestro events.spec stub** - `d1498ba` (feat)
3. **Task 0.3: Add 8th dep-cruiser rule + fixture + spec extension** - `95d96ca` (feat)

## Files Created/Modified

### Created (7)
- `server/maestro/events.ts` — MAESTRO_EVENT_NAMES (2 keys: HIERARCHY_FETCHED, DEVICE_INFO_COLLECTED) + MAESTRO_AGGREGATE_ID placeholder + empty maestroRegistry stub
- `server/maestro/queue.ts` — comment-only no-queue marker (1 line; mirrors Phase 22 streaming convention)
- `server/maestro/internal/module.ts` — 11-line throw-stub for dep-cruiser rule resolvability (7th repeat of Phase 18-23 pattern)
- `server/maestro/MODULE.md` — Purpose-only placeholder (full 9-section body lands in Plan 24-05)
- `server/maestro/index.ts` — 1-line MOD-02 strict barrel re-export (Plan 24-05 expands)
- `server/maestro/__tests__/events.spec.ts` — 1-test stub asserting EVENTS-03 dotted past-tense shape (2 keys, unique, regex `/^maestro\\.[a-z-]+\\.[a-z]+$/`)
- `__fixtures__/dep-cruiser/bad-maestro-deep-import.ts` — fixture imports throw-stub via @ts-expect-error to fire the 8th rule

### Modified (3)
- `server/pool/events.ts` — added 5th key `BOOTED: 'device.booted'` to POOL_EVENT_NAMES (constant only; registry, schema, helper deferred to Plan 24-01)
- `server/pool/__tests__/events.spec.ts` — bumped count assertion 4→5; added BOOTED equality + broadened regex to permit `[a-z-]+` middle segments
- `.dependency-cruiser.cjs` — appended rule 8 `no-deep-imports-into-maestro-internal` mirroring rules 5/6/7; updated header comment 8→9 rules
- `server/hooks/__tests__/dep-cruiser.spec.ts` — added MAESTRO_FIXTURE constant + 8th `[MOD-02 maestro extension]` it-block (two-pass err+json pattern)

## Decisions Made
- POOL_EVENT_NAMES.BOOTED added in Wave 0 as constant only; `deviceBootedPayload` schema + 5th poolRegistry entry + `booted` helper deferred to Plan 24-01 (matches Phase 22 Plan 22-00 placeholder-first pattern). Comment marker `// Plan 24-01:` placed above the BOOTED line so the next plan can grep the insertion point.
- MAESTRO_AGGREGATE_ID seeded with grep-flagged bogus literal `'00000000-0000-5000-8000-000000000024'` to force Plan 24-01 replacement with real v5 UUID `ceb331df-a288-5be5-b801-cbdfc4deec4a`.
- Pool events.spec EVENTS-03 regex broadened from `/^[a-z]+(\\.[a-z]+)+$/` to `/^[a-z]+(\\.[a-z-]+)+$/` to permit dash-separated middle segments — needed because `maestro.device-info.collected` will use a hyphen and the same shape rule applies module-wide.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Updated existing pool/events.spec count assertion 4→5**
- **Found during:** Task 0.2 (extending POOL_EVENT_NAMES with BOOTED)
- **Issue:** The Phase 20 test at line 42 of `server/pool/__tests__/events.spec.ts` asserts `expect(Object.keys(POOL_EVENT_NAMES)).toHaveLength(4)`. Adding BOOTED as the 5th key breaks this assertion. Plan acceptance criteria say "ALL existing 8 tests STILL passing" — but the count assertion is for POOL_EVENT_NAMES not poolRegistry, so it MUST shift to 5 (registry stays at 4 because schema+entry land in Plan 24-01). Plan author noted this in 24-RESEARCH §Pitfall 6 ("Plan 24-01 MUST include a task that updates pool/events.spec.ts assertions") but the same shift logically belongs in the wave-0 task that introduces the breaking change.
- **Fix:** Updated the test to assert 5 keys with new BOOTED equality check + broadened the past-tense regex from `/^[a-z]+(\\.[a-z]+)+$/` to `/^[a-z]+(\\.[a-z-]+)+$/` so the new `device.booted` (and future `maestro.device-info.collected`) match.
- **Files modified:** `server/pool/__tests__/events.spec.ts`
- **Verification:** `npx vitest run server/pool/__tests__/events.spec.ts` shows 8/8 pass.
- **Committed in:** `d1498ba` (Task 0.2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 3 blocking)
**Impact on plan:** Necessary to keep substrate green. Plan author had pre-acknowledged this exact shift in 24-RESEARCH §Pitfall 6; the only judgment call was placing it in 24-00 Task 0.2 (where the breaking constant addition lives) rather than deferring to 24-01. No scope creep.

## Issues Encountered
- `npm run dep-check` exits non-zero with 3 pre-existing `no-deep-imports-into-streaming-internal` violations from `server/artifacts/{memory-service,artifact-service}.ts` + `__tests__/artifact-service.spec.ts`. These are inherited from Phase 22 close and explicitly tagged as "pre-existing artifacts→streaming/internal expected-known" in 24-VALIDATION.md. Phase 24 added 0 new violations (verified). The plan acceptance criterion "exits 0" is interpreted as "no new violations from this plan" per the validation contract.

## User Setup Required
None — no external service configuration required.

## Next Phase Readiness

**Plan 24-01 entry points:**
- `server/maestro/events.ts`: replace empty `maestroRegistry` with 2 entries (`maestroHierarchyFetchedPayload` + `maestroDeviceInfoCollectedPayload`); replace placeholder UUID with `ceb331df-a288-5be5-b801-cbdfc4deec4a`; add `makeMaestroEmitters` helper returning `{hierarchyFetched, deviceInfoCollected}`.
- `server/pool/events.ts`: locate the `// Plan 24-01:` comment marker; add `deviceBootedPayload` schema (deviceId, platform, emulatorId, port:nullable); add 5th `poolRegistry` entry (persisted:false, aggregateType:'pool'); extend `makePoolEmitters` to return `booted` helper.
- `server/maestro/__tests__/events.spec.ts`: extend stub to 5+ tests (registry shape, persistence flags, payload accept/reject, helpers count, MAESTRO_AGGREGATE_ID v5 re-derivation).
- `server/pool/__tests__/events.spec.ts`: extend registry assertion 4→5 (only after registry actually has 5 entries).

**Plan 24-02 entry points:**
- `server/pool/pool-manager.ts`: add `this.emit.booted(...)` AFTER each successful `transition(DeviceState.Idle)` at lines 62 (addDevice), 126 (initPool inner loop), 207 (detectPhysicalDevices), 366 (replaceDevice).
- `server/pool/__tests__/subscriber.spec.ts`: extend with 1 test asserting device.booted fires alongside state.changed.

**Plan 24-03 entry points:**
- `git mv server/maestro/{hierarchy-service,appium-service}.ts server/maestro/internal/`
- `git mv server/pool/device-info-collector.ts server/maestro/internal/`
- `server/maestro/internal/module.ts`: replace throw-stub with `createMaestroModule(deps)` factory body (8th persistEnvelope sample point).
- `server/maestro/internal/subscribers.ts`: NEW — onReady-deferred `device.booted` handler.
- `server/maestro/plugin.ts`: replace 354-line current body with thin wirer; delete imperative onReady metadata loop at lines 55-72.
- `server/pool/index.ts`: remove `DeviceInfoCollector` re-export (line 33).
- `server/pool/MODULE.md`: update line 18 doc note.

No blockers. Substrate green; Plans 24-01..24-05 unblocked.

## Self-Check: PASSED

All 7 created files exist on disk and all 3 task commits exist in git history (fadfc27, d1498ba, 95d96ca). dep-cruiser baseline unchanged (3 pre-existing violations; 0 new). Pool events.spec 8/8 pass; maestro events.spec 1/1 pass; dep-cruiser.spec 8/8 pass.

---
*Phase: 24-maestro-module*
*Completed: 2026-05-08*
