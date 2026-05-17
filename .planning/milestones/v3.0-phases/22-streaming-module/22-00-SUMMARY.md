---
phase: 22-streaming-module
plan: 00
subsystem: infra
tags: [dep-cruiser, mod-02, zod, events-ts, streaming, websocket, jobs-events, placeholder-scaffolding]

requires:
  - phase: 21-artifacts-module
    provides: Phase 21 Plan 21-00 canonical 4-task Wave 0 substrate pattern (events.ts stub + internal/module.ts throw-stub + MODULE.md placeholder + index.ts 1-line barrel + events.spec.ts stub + jobs/events.ts bridgehead extension + .dependency-cruiser.cjs 5th rule + fixture + dep-cruiser.spec extension)
  - phase: 15-foundations
    provides: server/bus/types.ts EventRegistry shape (empty record satisfies `as const`) + server/jobs/events.ts bridgehead (STARTED+COMPLETED+MAESTRO_LOG_WRITTEN already landed in Phase 19/21)
  - phase: 17-contracts-pipeline-ops-hygiene
    provides: server/streaming/ws-schemas.ts base envelope (wsEnvelopeSchema stays loose until Plan 22-01 tightens to v:z.literal(1)+required correlationId)
provides:
  - server/streaming/events.ts stub (STREAMING_EVENT_NAMES with FRAME_DROPPED + STREAMING_AGGREGATE_ID placeholder + empty streamingRegistry)
  - server/streaming/internal/module.ts 4-line throw-stub (resolvable dep-cruiser target; real factory lands in Plan 22-02)
  - server/streaming/MODULE.md H1+H2-Purpose placeholder (full 9-section body lands in Plan 22-05)
  - server/streaming/index.ts MOD-02 strict 1-line barrel stub (full surface in Plan 22-05)
  - server/streaming/__tests__/events.spec.ts 1-test EVENTS-03 stub
  - server/jobs/events.ts extended to 6 JOB_EVENT_NAMES keys (added LOG/STEP/STATUS placeholders)
  - .dependency-cruiser.cjs 6th module rule no-deep-imports-into-streaming-internal
  - __fixtures__/dep-cruiser/bad-streaming-deep-import.ts fixture
  - server/hooks/__tests__/dep-cruiser.spec.ts 6th it-block [MOD-02 streaming extension]
affects: [Phase 22 Plan 22-01, Phase 22 Plan 22-02, Phase 22 Plan 22-03, Phase 22 Plan 22-04, Phase 22 Plan 22-05, Phase 22 Plan 22-06, Phase 23 Jobs Keystone]

tech-stack:
  added: []
  patterns:
    - Wave-0 substrate scaffolding (placeholder stubs unblock downstream waves without touching runtime — 5th repeat of Phase 18/19/20/21 pattern)
    - MOD-02 6th forbidden rule (dep-cruiser structurally enforces streaming/internal boundary before real internal/ content exists)
    - JOB_EVENT_NAMES bridgehead extension (placeholder-first pattern; schemas + registry + emit helpers deferred to Wave 1 per Phase 21 Plan 21-02 precedent)

key-files:
  created:
    - server/streaming/events.ts
    - server/streaming/internal/module.ts
    - server/streaming/MODULE.md
    - server/streaming/index.ts
    - server/streaming/__tests__/events.spec.ts
    - __fixtures__/dep-cruiser/bad-streaming-deep-import.ts
  modified:
    - server/jobs/events.ts (JOB_EVENT_NAMES extended from 3 to 6 keys; registry and makeJobsEmitters UNCHANGED)
    - .dependency-cruiser.cjs (added 6th forbidden rule; 7 total forbidden rules)
    - server/hooks/__tests__/dep-cruiser.spec.ts (added STREAMING_FIXTURE + 6th it-block; 6 tests total)

key-decisions:
  - "STREAMING_AGGREGATE_ID ships as obviously-bogus placeholder UUID '00000000-0000-5000-8000-000000000022' — Plan 22-01 replaces with real v5 = 'fff0592e-b92c-5221-a40a-d10a141f0158' derived from uuidv5('streaming', URL_NAMESPACE)"
  - "streamingRegistry ships as empty {} as const — Plan 22-01 lands the full 1-entry registry with Zod schema + persisted:false + aggregateType:'streaming'"
  - "JOB_EVENT_NAMES gains 3 placeholder string-only keys (LOG/STEP/STATUS) — jobsRegistry and makeJobsEmitters stay at 3 entries until Plan 22-01 extends them (Phase 21 Plan 21-02 precedent)"
  - "server/streaming/index.ts ships as strict MOD-02 1-line internal/ re-export matching Phase 18/19/20/21 form (Phase 22-05 expands with back-compat classes + envelope + emitters but keeps internal/ re-exports at ONE)"
  - "No queue scaffolding for streaming module (explicit deviation from Phase 16-21 template per CONTEXT §Decisions; WebSocket fan-out is in-process only; MODULE.md §Queue Produced/Consumed will state 'None')"
  - "All top-level streaming/ runtime files (job-broadcaster.ts, device-preview.ts, types.ts, ws-schemas.ts, websocket-plugin.ts, adapters/) stay at current locations; git mv under internal/ happens in Plan 22-02 Wave 2"

patterns-established:
  - "Wave-0 substrate 5th repeat: placeholder-first enables downstream Waves (22-01 events body, 22-02 factory + git mv, 22-03 DB proofs, 22-04 lifecycle guard, 22-05 close-out) to run without serialising on shape-definition churn"
  - "MOD-02 6th rule + fixture + spec extension trilogy establishes structural boundary before any real internal/ code exists (depcruise 17.x silently drops unresolvable imports — throw-stub + fixture give rule a resolvable target)"
  - "JOB_EVENT_NAMES bridgehead extension is string-only in Wave 0 — TypeScript compiles because new keys are unused constants; registry/emitters extension is Wave 1 scope"

requirements-completed: [TRACE-06, MOD-01, MOD-02, MOD-03, MOD-05]

duration: 22min
completed: 2026-04-22
---

# Phase 22-streaming-module Plan 00: Streaming Module Wave 0 Substrate Summary

**Wave 0 substrate for Phase 22 Streaming Module — 6 new stub files (events.ts, internal/module.ts, MODULE.md, index.ts, events.spec.ts, bad-streaming-deep-import.ts fixture) + 3 file extensions (JOB_EVENT_NAMES 6 keys, .dependency-cruiser.cjs 6th rule, dep-cruiser.spec 6th it-block) unblock plans 22-01..22-06 without touching any runtime file in server/streaming/.**

## Performance

- **Duration:** 22 min
- **Started:** 2026-04-22T22:06:00Z
- **Completed:** 2026-04-22T22:28:52Z
- **Tasks:** 9
- **Files modified:** 9 (6 created + 3 extended)

## Accomplishments

- `server/streaming/events.ts` stub with STREAMING_EVENT_NAMES (FRAME_DROPPED='ws.frame.dropped'), STREAMING_AGGREGATE_ID placeholder UUID, empty streamingRegistry satisfying EventRegistry shape
- `server/streaming/internal/module.ts` 4-line `createStreamingModule(): never` throw-stub gives dep-cruiser a resolvable target
- `server/streaming/MODULE.md` H1 + H2-Purpose placeholder references TRACE-06 and no-queue deviation
- `server/streaming/index.ts` strict MOD-02 1-line `from './internal/module.js'` barrel stub
- `server/streaming/__tests__/events.spec.ts` single-test EVENTS-03 shape assertion (passes in 112ms, no DB)
- `server/jobs/events.ts` JOB_EVENT_NAMES extended from 3 to 6 keys (added LOG/STEP/STATUS placeholders; registry and emitters unchanged — schemas lands in Plan 22-01)
- `.dependency-cruiser.cjs` 6th forbidden rule no-deep-imports-into-streaming-internal (7 total: 6 module rules + no-direct-bus-emit)
- `__fixtures__/dep-cruiser/bad-streaming-deep-import.ts` fixture that fires the new rule (verified via direct depcruise CLI)
- `server/hooks/__tests__/dep-cruiser.spec.ts` 6th it-block [MOD-02 streaming extension] (6/6 tests green, two-pass err+json pattern)

## Task Commits

Each task committed atomically:

1. **Task 0.1: streaming/events.ts stub** — `c3e3a61` (feat)
2. **Task 0.2: streaming/internal/module.ts throw-stub** — `6f63bc1` (feat)
3. **Task 0.3: streaming/MODULE.md placeholder** — `8ff8371` (docs)
4. **Task 0.4: streaming/index.ts barrel stub** — `b830a91` (feat)
5. **Task 0.5: streaming/__tests__/events.spec.ts stub** — `14585d3` (test)
6. **Task 0.6: JOB_EVENT_NAMES LOG/STEP/STATUS placeholders** — `a519bf4` (feat)
7. **Task 0.7: .dependency-cruiser.cjs 6th rule** — `a9c9693` (feat)
8. **Task 0.8: bad-streaming-deep-import.ts fixture** — `176b009` (test)
9. **Task 0.9: dep-cruiser.spec 6th it-block** — `b110479` (test)

## Files Created/Modified

**Created (6):**
- `server/streaming/events.ts` — STREAMING_EVENT_NAMES + STREAMING_AGGREGATE_ID placeholder + empty streamingRegistry
- `server/streaming/internal/module.ts` — createStreamingModule throw-stub (Plan 22-02 replaces)
- `server/streaming/MODULE.md` — H1 + H2 Purpose placeholder (Plan 22-05 expands to 9 sections)
- `server/streaming/index.ts` — MOD-02 strict 1-line barrel stub
- `server/streaming/__tests__/events.spec.ts` — 1-test EVENTS-03 stub
- `__fixtures__/dep-cruiser/bad-streaming-deep-import.ts` — dep-cruiser fixture firing 6th rule

**Modified (3):**
- `server/jobs/events.ts` — JOB_EVENT_NAMES extended from 3 to 6 keys (LOG/STEP/STATUS placeholders; registry/emitters UNCHANGED)
- `.dependency-cruiser.cjs` — Added no-deep-imports-into-streaming-internal (rule 6; 7 total forbidden rules)
- `server/hooks/__tests__/dep-cruiser.spec.ts` — Added STREAMING_FIXTURE constant + 6th it-block (5 existing preserved)

## Decisions Made

- **Placeholder UUID for STREAMING_AGGREGATE_ID:** shipped as obviously-bogus `'00000000-0000-5000-8000-000000000022'` per plan spec; Plan 22-01 re-derives offline and spec asserts match — fails loudly if placeholder remains
- **Empty streamingRegistry:** `{} as const` satisfies EventRegistry's empty-record shape without requiring Zod schema imports (Plan 22-01 adds imports + full registry)
- **No queue scaffolding:** CONTEXT §Decisions explicit deviation from Phase 16-21 template; streaming module owns no queue; server/queue/names.ts NOT touched in any Phase 22 plan
- **No file moves in Wave 0:** all top-level streaming/ runtime files stay at current locations; `git mv` under internal/ happens in Plan 22-02 Wave 2 atomic work
- **MOD-02 1-line comment workaround:** original comment text referenced the exact string `from './internal/module.js'` inside backticks, which would have tripped the MOD-02 grep-count == 1 invariant. Rephrased comment to preserve intent without the literal string — Plan 22-05 verify script grep stays clean

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] MOD-02 invariant grep collision in index.ts comment**
- **Found during:** Task 0.4 (index.ts barrel stub verification)
- **Issue:** Original comment text from plan included the string `from './internal/module.js'` inside backticks in a file-header doc-comment, which matched the acceptance-criteria grep `grep -c "from './internal/module" == 1`. grep counted 2 matches (comment + actual export line), failing the MOD-02 strict 1-line invariant.
- **Fix:** Rephrased the file-header comment to say "ONE re-export line from the internal factory" instead of literally quoting the path string. Semantic meaning preserved; grep now counts 1.
- **Files modified:** server/streaming/index.ts
- **Verification:** `grep -c "from './internal/module" server/streaming/index.ts` == 1
- **Committed in:** b830a91 (Task 0.4 commit)

---

**Total deviations:** 1 auto-fixed (1 bug per scope boundary — plan-text transcription issue, not an architectural change)
**Impact on plan:** Cosmetic comment rephrase preserving MOD-02 strict invariant. No scope creep. All downstream plan-22 tasks unchanged.

## Issues Encountered

- **`npx depcruise` blocked by RTK:** RTK's npx rewrite routed `npx depcruise ...` to `npm run depcruise` which is a missing script. Worked around by invoking `./node_modules/.bin/depcruise` directly for ad-hoc fixture verification. The vitest spec (Task 0.9) uses `spawnSync('npx', [...])` which works because vitest's subprocess environment bypasses the interactive RTK hook. 6/6 tests passed.
- **Pre-existing dep-check violation preserved:** `server/jobs/plugin.ts → server/bus/bus.ts` (Phase 23 scope) remains the only dep-check violation — documented in STATE.md Phase 21 close-out, unchanged by this plan.
- **Pre-existing TypeScript baseline preserved:** 8 pre-existing TS errors across 6 files (6 Phase-15 Map-vs-RequestContext + 2 working-tree artifacts edits) unchanged; 0 new errors from Plan 22-00.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

**Plan 22-01 (Wave 1) unblocked:**
- events.ts stub ready to overwrite with full body (Zod wsFrameDroppedPayload + real v5 UUID + streamingRegistry entry + makeStreamingEmitters)
- JOB_EVENT_NAMES 3 placeholder keys (LOG/STEP/STATUS) ready to grow payload schemas + jobsRegistry entries + makeJobsEmitters return shape
- events.spec.ts ready to extend from 1 to 6-8 tests

**Plan 22-02 (Wave 2) unblocked:**
- internal/module.ts throw-stub ready to overwrite with real createStreamingModule factory body
- dep-cruiser MOD-02 rule already in place — structurally enforces boundary the moment Plan 22-02 creates real internal/ content
- git mv of job-broadcaster/device-preview/types/ws-schemas/websocket-plugin under internal/ is an atomic task in Plan 22-02

**Plan 22-05 (Wave 5) unblocked:**
- MODULE.md placeholder ready to extend to full 9-section body
- index.ts 1-line barrel ready to expand with back-compat exports (still 1 internal/ re-export line)

## Self-Check: PASSED

All created files verified to exist:
- `server/streaming/events.ts` FOUND
- `server/streaming/internal/module.ts` FOUND
- `server/streaming/MODULE.md` FOUND
- `server/streaming/index.ts` FOUND
- `server/streaming/__tests__/events.spec.ts` FOUND
- `__fixtures__/dep-cruiser/bad-streaming-deep-import.ts` FOUND

All commits verified to exist in git log:
- `c3e3a61` FOUND (Task 0.1)
- `6f63bc1` FOUND (Task 0.2)
- `8ff8371` FOUND (Task 0.3)
- `b830a91` FOUND (Task 0.4)
- `14585d3` FOUND (Task 0.5)
- `a519bf4` FOUND (Task 0.6)
- `a9c9693` FOUND (Task 0.7)
- `176b009` FOUND (Task 0.8)
- `b110479` FOUND (Task 0.9)

---
*Phase: 22-streaming-module*
*Completed: 2026-04-22*
