# Results (CI): screen-graph Phase C.3 — honest needles, blocking pre-flight, O5 explained, H4 measured

Phase C.3 landed the destination-unique needles, made the pre-flight gate block
the matrix, killed the 30/60 O5 `locateFailed`, and — by dismissing Chrome's
first-run flow so example.com renders — made task success **discriminate between
configs** for the first time. H4 is now a number per config.

Every number below is from the FINAL CI run and is labelled with its run id.
Numbers from different runs are never blended in one table.

## Runs (HeiCg/argent, workflow `bench-open-vs-proprietary.yml`, `feat/bench-ci-c3`)

| Purpose | Run id | URL |
|---|---|---|
| Capture (dump launch+destination per task) | 33767073864 | https://github.com/HeiCg/argent/actions/runs/33767073864 |
| Matrix (first, exposed 2 bad needles) | 33779983434 | https://github.com/HeiCg/argent/actions/runs/33779983434 |
| **Matrix (FINAL — authoritative below)** | **33786304637** | https://github.com/HeiCg/argent/actions/runs/33786304637 |

Branches: bench tree `feat/screen-graph-c3` @ `a0f83004`; workflow
`feat/bench-ci-c3` @ `05a539ca`. The screen-graph job checks out the bench tree
at the pinned `a0f83004` (root cause #1 of the stuck 14: the job reads only what
it checks out, and the pin never moved to the branch that held the fixes).

## Pre-flight gate

Quoted from run 33786304637 `logs/sg-preflight.log`:

```
PROBLEM needles: 0 — none
[preflight] GATE PASS: PROBLEM needles: 0
```

The pre-flight is a pure gate now: `preflightVerdict(needleEval) -> {ok, problems}`
(BAD or MISSING ⇒ not ok), and `bench-preflight.ts` exits 1 when `!ok`. The
workflow's pre-flight and matrix `run:` blocks are prefixed with
`set -euo pipefail` (so the script's exit code is no longer masked by `tee`), and
neither carries `continue-on-error`, so a failing pre-flight stops the matrix
step in the same job. Unit test `preflightVerdict — the matrix gate` covers
ok / BAD / MISSING / mixed / empty in
`packages/tool-server/test/screen-graph-bench-preflight.test.ts`.

## Two root-cause fixes

1. **Pre-flight never blocked (C.2 "needle fix" was invisible).** Two bugs:
   the pinned checkout meant the job read a tree with none of the changes, and
   `bench-preflight.ts` always `process.exit(0)` even with PROBLEM needles > 0.
   Fixed at `packages/tool-server/scripts/bench-preflight.ts:main` (exit from the
   pure verdict) and the workflow re-pin + `set -euo pipefail`.
2. **Chrome first-run flow hid example.com.** A fresh emulator shows
   "Welcome to Chrome / Turn on sync?" the first time Chrome opens, so the launch
   screen was the FRE, not the page — every chrome task read N for every config
   (run 33742435496: 6 chrome tasks NNN across B1..O5), which flattened success
   and made H4 unmeasurable. Dismissed once up front over the open server, which
   survives the per-task `am force-stop` (never `pm clear`), so B1 sees it too:
   `packages/tool-server/scripts/bench-screen-graph.ts:prepareChromeOnce`. The
   pre-flight does its own dismissal before the example.com dump. After the fix
   all six chrome-related tasks read Y for every config (run 33786304637).

## Per-config — tokens/step, RTT, success (run 33786304637)

`success = ok / scored`; `scored` excludes plumbing/infra failures
(Locate/Action/Oracle/Task). `fallbacks` counts describe/tree fallbacks — for B1
any fallback would invalidate its metrics.

| Config | n steps | tok/step p50 (o200k) | tok/step p50 (chars/4) | RTT ms/step p50 | RTT count/step p50 | success | scored | excluded (L/A/O/T) | fallbacks |
|---|---|---|---|---|---|---|---|---|---|
| B1 (argent proprietary) | 93 | 657 | 473 | 668 | 2 | 93% | 60/60 | 0 (0/0/0/0) | 0 |
| B2 (open, no graph) | 93 | 627 | 447 | 94 | 2 | 100% | 60/60 | 0 (0/0/0/0) | 0 |
| O1 (+ query/diff) | 93 | 67 | 43 | 4 | 2 | 97% | 60/60 | 0 (0/0/0/0) | 0 |
| O2 (+ outcomes) | 93 | 54 | 32 | 4 | 2 | 98% | 60/60 | 0 (0/0/0/0) | 0 |
| O3 (+ graph, cold) | 93 | 598 | 397 | 90 | 2 | 100% | 60/60 | 0 (0/0/0/0) | 0 |
| O4 (graph, warm) | 93 | 85 | 69 | 50 | 1 | 100% | 60/60 | 0 (0/0/0/0) | 0 |
| O5 (+ navigate-to) | 93 | 85 | 70 | 48 | 1 | 82% | 60/60 | 0 (0/0/0/0) | 0 |

B1 exercised the proprietary path with **0 fallbacks and 0 exclusions**, so its
success is valid for H4 (tap targets located, not centre taps). B1's off-metric
plumbing was 236 642 ms (the up-front coordinate precompute + per-task oracle
instrumentation switch).

## Hypotheses (run 33786304637)

| Hypothesis | Statistic | Target | Measured | Verdict |
|---|---|---|---|---|
| H1 | O1 tokens/step vs B2, unchanged steps (o200k p50) | ≤ 0.5× | 0.107× | PASS |
| H2 (all steps) | O2 RTT-count/step removed vs B2, all steps | ≥ 1 | 0 | FAIL |
| H2 (same-screen) | O2 RTT-count/step removed vs B2, same-screen steps (n=30) | ≥ 1 | 1 | PASS |
| H3 | O4 tokens/step vs O3, revisited (o200k p50) | ≤ 0.2× | 0.129× | PASS |

**H4 — success non-inferior (±2 pp) to each baseline, ONE oracle for every
config**, over the (task, rep) pairs both sides scored:

| Baseline | Baseline success | Verdict (intersection) |
|---|---|---|
| B1 (93%, 60/60) | | **FAIL** — O1 97%, O2 98%, O3 100%, O4 100% all non-inferior; **O5 82% vs 93% ✗** |
| B2 (100%, 60/60) | | **FAIL** — O2 98%, O3 100%, O4 100% non-inferior; **O1 97% vs 100% ✗ (−3 pp)**, **O5 82% vs 100% ✗** |

Reading of H4: the query/diff/outcome/graph configs (O2, O3, O4) reach the same
task success as BOTH the proprietary and the open baselines while spending an
order of magnitude fewer tokens (O2 32 vs B2 447 chars/4). O1 is a marginal
−3 pp under B2. **O5 is the one clearly-inferior config**, and it is inferior for
a navigate-to reason explained below, not a locate-fail.

## O5 `locateFailed`: cause, fix, and count after the change

**Before (run 33742435496): `locateFailed` 30/60** — the 10 settings navigation
tasks × 3 reps. Cause, confirmed: `runAction` called `navigate-to` with
`target: toBenchTarget(sel)` = `{ text }`, but the tool's schema requires
`target: { screen | selector }`. `{ text }` failed the tool's zod `.refine`, so
`navigate-to` **threw on every O5 known-target step**; because `located` was not
computed for O5, each throw was recorded as a locate-fail — deterministically
those exact 30.

**Fix** (`packages/tool-server/scripts/bench-screen-graph.ts`):
- pass the selector under `selector`: `target: { selector: toBenchTarget(sel) }`;
- route to the task's `navTarget` (a destination-unique EXACT text), not the tap
  selector — `planToSelector` matches a screen's index by exact text, and the tap
  selector is on the CURRENT screen (0 steps, never enters the sub-screen);
- compute `located` for O5 tap steps too, and require `reached`; a no-route /
  divergence / throw falls back to a plain locate+tap on the SAME open backend
  (O5's own recovery, never a switch to another config), so a routing miss is an
  honest tap, not a spurious locate-fail;
- await screen idle after a successful navigate before the oracle reads.

**After (run 33786304637): `locateFailed` 0/60** (O5 `excluded 0 (0/0/0/0)`).

**O5's remaining cost (why 82%, not a locate-fail).** With the shape fixed,
`navigate-to` behaves in one of two ways per known-target step (matrix log
`navigate-to did not reach … falling back to locate+tap`, 27 lines in run
33786304637):
- **No route (27/36 known-target taps): falls back to locate+tap → task passes.**
  `planToSelector` returns null because the live root hash does not match the
  node O3 recorded (the Settings root carries dynamic content — clock, battery,
  signal — so its structural hash is not stable run-to-run).
- **Reached but mis-landed (the rest): assertion reads N.** For settings-network,
  settings-sound and settings-network-internet, `navigate-to` reported `reached`
  on a KNOWN screen, but the destination-unique needle was not live-visible there
  — the graph's stored route tapped by a stale bucket and left us on a different
  or scrolled screen. These are the 9 O5 misses in run 33786304637
  (settings-network NNN, settings-sound NNN, settings-network-internet NNN).

Which tasks land in each bucket **varies run-to-run** with the graph hashing
(run 33779983434 mis-landed settings-apps instead). This is a genuine cost of the
navigate-to strategy on dynamic Settings screens, reported as O5's cost — no
exclusion, no silent fallback to another config. O5's tokens (85 o200k / 70
chars/4) and RTT-count (1/step) are the navigate/graph-lookup win; its success is
the price of relying on a replayed route over a non-deterministic host graph.

## Needle table (task, old needle, new needle, justification)

All new needles come from capture run 33767073864 (`capture.json` +
`sg-preflight.log`); none is guessed.

| Task | Old needle | New needle | Justification (source: capture 33767073864) |
|---|---|---|---|
| settings-network | `Internet` | `Calls & SMS` | On the Network & internet screen, absent from the root ("Internet" matched the root's "Network & internet"). |
| settings-connected | `Bluetooth` | `Pair new device` | On the Connected devices screen, absent from the root ("Bluetooth" matched the root's "Bluetooth, pairing"). |
| settings-apps | `app` | `Special app access` | On the Apps screen, absent from the root ("app" matched the root's "Apps"). |
| settings-notifications | `notification` | `App notifications` | On the Notifications screen, absent from the root. |
| settings-battery | `battery` | `Battery usage` | On the Battery screen, absent from the root. |
| settings-storage | `storage` | `Free up space` | On the Storage screen, absent from the root. |
| settings-sound | `volume` | `Media volume` | On the Sound & vibration screen, absent from the root ("volume" matched "Volume, haptics, Do Not Disturb"). |
| settings-battery-then-back | `Network & internet` | `Battery usage` (task RESTRUCTURED) | A Battery→back→root round-trip ENDS on its launch screen, so no needle can be present-on-destination yet absent-on-launch. Reopen Battery after the back: root is still revisited (warm graph), and the task ends on the Battery screen where "Battery usage" is destination-unique. |
| settings-display | `brightness` (kept) | `brightness` | Already destination-unique (below-fold on the unscrolled root, so not visible). navTarget changed "Display" → "Brightness level" so O5 routes into the screen instead of 0-step matching the root's "Display". |
| settings-network-internet | `SIMs` (kept) | `SIMs` | Already destination-unique. navTarget "Internet" → "SIMs". |
| same-sound-noop | `volume` | `Media volume` | Sound & vibration screen; same as settings-sound. |
| same-apps-noop | `app` | `Special app access` | Apps screen; same as settings-apps. |
| same-settings-search | `Bluetooth` | `Clear text` | Content-description of the search field's clear (X) button — appears only after text is typed, sits at the top of the field (never under the keyboard), absent from the root. (The intermediate "Settings Services" footer read N in run 33779983434: the soft keyboard covers it; search RESULT rows do not surface as queryable nodes.) |
| chrome-scroll-body | `permission` (kept) | `permission` | On example.com's body ("…without needing permission"). |
| chrome-scroll-doc | `documentation` (kept) | `documentation` | On example.com's body ("…for use in documentation examples…"). |
| same-chrome-noop | `Example Domain` (kept) | `Example Domain` | On example.com. |

The last three needed no change once the FRE was dismissed. The pre-flight's
`navigatesAwayFromLaunch` was refined so a task "leaves" its launch screen only
via a real navigation step (a non-`sameScreen` tap, or `back`): swipes and
`sameScreen` no-op taps do not. example.com is one short page (launch and
destination node sets are identical in the capture), so chrome-scroll-body/doc
and same-chrome-noop are launch-destination tasks whose needle must be PRESENT
(not absent) — the old "any non-launch step ⇒ navigates" rule mis-flagged them.

## Per-task success matrix (run 33786304637)

`Y` oracle met · `N` oracle unmet · `L` locate-failed (none this run).

| Task | B1 | B2 | O1 | O2 | O3 | O4 | O5 |
|---|---|---|---|---|---|---|---|
| settings-network | YYY | YYY | YYY | YYY | YYY | YYY | NNN |
| settings-connected | YYY | YYY | YYY | YYY | YYY | YYY | YYY |
| settings-apps | YYY | YYY | YYY | YYY | YYY | YYY | YYY |
| settings-notifications | YYY | YYY | YYY | YYY | YYY | YYY | YYY |
| settings-battery | YYY | YYY | YYY | YYY | YYY | YYY | YYY |
| settings-storage | YYY | YYY | YYY | YYY | YYY | YYY | YYY |
| settings-sound | YYY | YYY | YYY | YYY | YYY | YYY | NNN |
| settings-display | NYY | YYY | YYY | YYY | YYY | YYY | YNY |
| settings-network-internet | YYY | YYY | YYY | YYY | YYY | YYY | NNN |
| settings-battery-then-back | YYY | YYY | YYY | NYY | YYY | YYY | YYY |
| chrome-open-page | YYY | YYY | YYY | YYY | YYY | YYY | YYY |
| chrome-heading-word | YYY | YYY | YYY | YYY | YYY | YYY | YYY |
| chrome-example-word | YYY | YYY | YYY | YYY | YYY | YYY | YYY |
| chrome-scroll-body | YYY | YYY | YYY | YYY | YYY | YYY | YYY |
| chrome-scroll-doc | YYY | YYY | YYY | YYY | YYY | YYY | YYY |
| same-settings-search | YYY | YYY | YYY | YYY | YYY | YYY | YYY |
| same-sound-noop | YYY | YYY | YYY | YYY | YYY | YYY | YYY |
| same-chrome-noop | YYY | YYY | YYY | YYY | YYY | YYY | YYY |
| same-display-slider | NNN | YYY | YNN | YYY | YYY | YYY | YYN |
| same-apps-noop | YYY | YYY | YYY | YYY | YYY | YYY | YYY |

## H2 detail — RTT count/step (run 33786304637)

| Config | RTT/step p50 (all) | mean (all) | p50 (same-screen) | mean (same-screen) | same-screen n |
|---|---|---|---|---|---|
| B1 | 2 | 2 | 2 | 2 | 30 |
| B2 | 2 | 2 | 2 | 2 | 30 |
| O1 | 2 | 2 | 2 | 2 | 30 |
| O2 | 2 | 1.70 | 1 | 1.2 | 30 |
| O3 | 2 | 1.71 | 1 | 1.2 | 30 |
| O4 | 1 | 1.03 | 1 | 1.1 | 30 |
| O5 | 1 | 1.00 | 1 | 1.0 | 30 |

## Cold vs warm (run 33786304637)

- O3 cold (novel-screen) tokens/step p50: 598 (n=93)
- O4 warm (known-screen) tokens/step p50: 77 (n=90)
- cold/warm ratio (O4 warm / O3 cold): 0.129× (H3 PASS)

## Caveats / known limitations (not in the C.3 scope)

- **same-display-slider** stays flaky (B1 NNN, O1 YNN, O5 YYN in run 33786304637):
  the Display screen is reached by swipe-then-tap, and a missed "Display" tap
  lands the following no-op taps on the root's search bar. Pre-existing (also
  flaky in run 33742435496); its needle "brightness" is destination-unique, so it
  is a task-reliability issue, not a needle issue.
- **B1 proprietary-path divergence** on "brightness" (settings-display,
  same-display-slider): B1 read (none) where B2 matched "Brightness". Same
  divergence seen before C.3; surfaced here only because those tasks reach the
  Display screen at all.
- **settings-network-internet** asserts "SIMs", which is present on the Network &
  internet screen (1 level) as well as the Internet screen (2 levels), so it does
  not prove the second tap reached the Internet sub-screen. It was already "ok"
  in the existing pre-flight (out of the 14 C.3 targeted) and is left unchanged.
- **Settings search result rows** never surface as queryable nodes over the open
  server, so same-settings-search verifies "the search field received text" (the
  clear button) rather than a specific result.

## Files changed

Bench tree (`feat/screen-graph-c3`):
- `packages/tool-server/src/screen-graph/bench/preflight.ts` (new) — pure
  `preflightVerdict` / `isProblemVerdict`.
- `packages/tool-server/scripts/bench-preflight.ts` — exit from the verdict,
  `BENCH_CAPTURE` mode, Chrome FRE dismissal, refined `navigatesAwayFromLaunch`.
- `packages/tool-server/scripts/bench-screen-graph.ts` — O5 navigate-to fix
  (`runAction`, `runTask`), `prepareChromeOnce`, chrome launch settle.
- `packages/tool-server/src/screen-graph/bench/tasks.ts` — destination-unique
  needles + navTargets, settings-battery-then-back restructure.
- `packages/tool-server/test/screen-graph-bench-preflight.test.ts` —
  `preflightVerdict` unit tests.

Workflow tree (`feat/bench-ci-c3`):
- `.github/workflows/bench-open-vs-proprietary.yml` — re-pin checkout, `sg_mode`
  input, `set -euo pipefail` on both run blocks.
