---
phase: 15-fix-operational-dependencies
plan: 09
subsystem: testing
tags: [nyquist, coverage, vitest, baseline, guardrails]

# Dependency graph
requires:
  - phase: 15-00
    provides: "@vitest/coverage-v8 wired via npm run test:coverage; coverage/coverage-summary.json produced with numeric totals"
provides:
  - ".planning/nyquist-baseline.json committed with end-of-Phase-15 coverage snapshot (lines/branches/functions/statements) + commit SHA"
  - "scripts/capture-nyquist.mjs — reproducible npm run nyquist:capture (reads coverage-summary.json, writes baseline JSON, records git HEAD via execFileSync)"
  - "scripts/check-nyquist.mjs — npm run nyquist:check gate that fails with exit 1 when lines delta < -2pp"
affects: [16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30]

# Tech tracking
tech-stack:
  added: []
  patterns: [nyquist baseline JSON pinned per-milestone, execFileSync argv-safe git SHA capture, -2pp lines-pct delta gate per phase]

key-files:
  created:
    - scripts/capture-nyquist.mjs
    - scripts/check-nyquist.mjs
    - .planning/nyquist-baseline.json
  modified:
    - package.json

key-decisions:
  - "Nyquist baseline captured as END-OF-PHASE-15 snapshot, not pre-Phase-15 v2.0 snapshot — plans 15-00..15-05 had already landed source changes; retroactive v2.0 baseline is unrecoverable. Documented via `note` field in the JSON and surfaced for the Phase 15 retrospective."
  - "Delta gate is `-2pp on coverage.lines` (not all four metrics) — lines is the canonical metric; branches/functions/statements recorded for trend analysis but do not gate CI. Matches RESEARCH §12 and success-criterion template."
  - "Capture script uses `execFileSync('git', ['rev-parse', 'HEAD'])` with argv array, never shell concat — mitigates RESEARCH §12 pitfall re: arbitrary SHA injection via env vars."
  - "check-nyquist.mjs stub created now (not deferred) so Phase 16 can wire it in as a verification gate without an extra trip back to Phase 15."

patterns-established:
  - "Nyquist baseline lives at .planning/nyquist-baseline.json (repo-root path, not phase-local) — one baseline per milestone, re-captured intentionally at milestone boundaries."
  - "capture-nyquist.mjs is idempotent — re-running produces the same coverage values and commit SHA with only `capturedAt` updated; safe to re-run in CI or locally."
  - "Baseline JSON keeps a `note` field for human-readable context on what snapshot this represents — future phases that re-capture must update or append to this field."

requirements-completed: [DEBT-03]

# Metrics
duration: 5min
completed: 2026-04-17
---

# Phase 15 Plan 09: Nyquist Baseline Capture Summary

**Committed `.planning/nyquist-baseline.json` (48.29% lines / 36% branches / 45.21% functions / 47.06% statements at commit 55ff8ac) plus reproducible `npm run nyquist:capture` + `npm run nyquist:check` scripts so every v3.0 phase can gate on a -2pp lines-coverage delta.**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-04-17T15:49:06Z
- **Completed:** 2026-04-17T15:51:56Z
- **Tasks:** 2
- **Files modified:** 1 (package.json); 3 created (scripts/capture-nyquist.mjs, scripts/check-nyquist.mjs, .planning/nyquist-baseline.json)

## Accomplishments
- Wrote `scripts/capture-nyquist.mjs` — reads `coverage/coverage-summary.json`, captures git HEAD via `execFileSync('git', ['rev-parse', 'HEAD'])` (argv-safe), writes `.planning/nyquist-baseline.json` with `capturedAt`/`commit`/`coverage.{lines,branches,functions,statements}` fields.
- Wrote `scripts/check-nyquist.mjs` — compares `coverage/coverage-summary.json` `total.lines.pct` against baseline, logs delta, exits non-zero if delta < -2pp. Verified with a no-op run (baseline 48.29 vs current 48.29 = 0.00pp, "OK: coverage within -2pp of baseline").
- Wired two top-level npm scripts: `nyquist:capture` (`npm run test:coverage && node scripts/capture-nyquist.mjs`) and `nyquist:check` (`node scripts/check-nyquist.mjs`).
- Ran `npm run test:coverage` → 55 files passed / 9 skipped, 452 tests passed / 21 skipped, fresh `coverage-summary.json` produced (no hard failures).
- Captured baseline at commit `55ff8ac` (the 9.1 commit immediately preceding the baseline commit itself):
  - `coverage.lines = 48.29`
  - `coverage.branches = 36`
  - `coverage.functions = 45.21`
  - `coverage.statements = 47.06`
- Added a `note` field to the baseline JSON making the "end-of-Phase-15, not pre-Phase-15" framing explicit so later readers don't misinterpret the reference point.
- DEBT-03 satisfied: Phase 16+ plans can now include `npm run nyquist:check` in their verification block.

## Task Commits

Each task was committed atomically:

1. **Task 9.1: Write capture script + npm script** - `55ff8ac` (chore)
2. **Task 9.2: Capture baseline AT THE CORRECT COMMIT and commit JSON** - `067fc92` (chore)

**Plan metadata:** committed in final docs commit (`docs(15-09): complete nyquist baseline plan`).

## Files Created/Modified
- `scripts/capture-nyquist.mjs` - Created. Idempotent baseline generator. Uses `execFileSync` argv array (never shell concat) for git SHA.
- `scripts/check-nyquist.mjs` - Created. -2pp lines-coverage delta gate, exit non-zero on regression.
- `.planning/nyquist-baseline.json` - Created. End-of-Phase-15 coverage snapshot with `capturedAt`, `commit`, `coverage.*`, and `note` fields. Serves as the reference point for every v3.0 phase's coverage delta check.
- `package.json` - Added `nyquist:capture` and `nyquist:check` npm scripts alongside existing `test:coverage`.

## Decisions Made
- **Snapshot timing:** Captured at end-of-Phase-15 (commit `55ff8ac`) rather than pre-Phase-15. Rationale: plans 15-00 through 15-05 had already landed substrate source changes — a pre-Phase-15 v2.0 baseline is not recoverable without reverting. Documented transparently in the JSON `note` field and called out in the Phase 15 retrospective.
- **Delta metric:** `coverage.lines` is the gate (per RESEARCH §12 and success-criterion template). Other metrics are recorded for trend analysis.
- **Script idempotency:** `capture-nyquist.mjs` rewrites the full JSON every run (not a patch-in-place) so running twice produces the same shape with only `capturedAt` updated. Note: running the script now would overwrite the custom `note` field; phases that intentionally refresh the baseline will need to re-apply the note or update the script to preserve custom fields.

## Deviations from Plan

None — plan executed exactly as written. Both acceptance-criteria blocks passed on first run. Baseline JSON patched manually to include the `note` field per plan Task 9.2 step 5 (explicit plan instruction, not a deviation).

## Issues Encountered
- None. Test suite ran clean: 55 files passed / 9 skipped (DB-gated tests with no local Postgres — expected per plan 15-01 context), 452 tests passed / 21 skipped. No hard failures that would have compromised the coverage numbers.

## User Setup Required

None — all changes are file-level and work via the newly-added npm scripts.

## Next Phase Readiness

**Phase 16 kickoff recommendations:**
1. Add `npm run nyquist:check` as a step in Phase 16's verification gate (alongside `npm run test:coverage`).
2. If Phase 16 lands new test coverage, treat positive deltas as "raise the floor" only if the phase explicitly intends to recalibrate — otherwise leave the baseline alone so subsequent phases retain a stable reference.
3. If a Phase 16+ plan legitimately needs to re-capture (e.g., substrate expansion shifts the coverage denominator), run `npm run nyquist:capture` AS AN ISOLATED COMMIT with a rationale in the commit body, and refresh the `note` field.

**Concerns:** None blocking. The `note` field is preserved manually today; a minor follow-up (not in this plan's scope) could teach `capture-nyquist.mjs` to merge a user-maintained `note` field from the existing baseline when re-capturing.

---
*Phase: 15-fix-operational-dependencies*
*Completed: 2026-04-17*

## Self-Check: PASSED

- File FOUND: scripts/capture-nyquist.mjs
- File FOUND: scripts/check-nyquist.mjs
- File FOUND: .planning/nyquist-baseline.json
- File FOUND: .planning/phases/15-fix-operational-dependencies/15-09-SUMMARY.md
- Commit FOUND: 55ff8ac (Task 9.1)
- Commit FOUND: 067fc92 (Task 9.2)
