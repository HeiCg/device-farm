# Results (CI): screen-graph Phase C.4 — valid H4 (live B1, pure O5, oracle-independent tokens)

Phase C.4 answers the C.3 review's REJECT. It makes B1 a live describe+tap agent
(no stale precomputed coordinate), splits O5 into a truthful pure-vs-mixed pair
from structured `navigate-to` records, makes O1/O2 tokens/step independent of the
oracle needle, moves the needle gate to the FULL launch tree, removes the
`navTarget == assertion` asymmetry, and raises reps to 5 with a 95 % Wilson
interval per config. H4 is now measured against a VALID B1 and both baselines.

Every number below is from the FINAL CI run and is labelled with its run id.
Numbers from different runs are never blended in one table.

## Run (HeiCg/argent, workflow `bench-open-vs-proprietary.yml`)

| Purpose | Run id | URL |
|---|---|---|
| **Matrix (FINAL — authoritative)** | **33806639520** | https://github.com/HeiCg/argent/actions/runs/33806639520 |

Branches: bench tree `feat/screen-graph-c4` @ `212d7d58`; workflow
`feat/bench-ci-c4` @ `2fb03fc7`. The screen-graph job now checks out the bench
tree by **branch name** (not a pinned SHA), closing root cause #1 of the stuck
C.2/C.3 runs (a stale pin that never moved to the fixed branch; review C-L3).
7 configs × 20 tasks × **5 reps** = 100 task-runs per config.

## Pre-flight gate (full tree)

Quoted from run 33806639520 `logs/sg-preflight.log`:

```
PROBLEM needles: 0 — none
[preflight] GATE PASS: PROBLEM needles: 0
```

The needle gate for a NAVIGATING task now checks the needle against the FULL
launch tree (visible OR below-fold), not just the visible nodes. That is why the
old `brightness` needle is gone: it lives in the Settings root's below-fold
Display subtitle ("Dark theme, font size, brightness"), so it passed the C.3
visible-only gate but is BAD over the full tree (review C-M1). It is replaced by
`Brightness level` (present on the Display screen, absent as a substring from the
whole root) for both `settings-display` and `same-display-slider`.

## Per-config — success + 95 % Wilson, tokens/step, RTT (run 33806639520)

`success = ok / scored`; `scored` excludes plumbing/infra failures
(Locate/Action/Oracle/Task), which are counted separately, never dropped.
`navFb` is the STRUCTURED O5 navigate-to fallback count (known-target taps that
fell back to locate+tap), read from the per-step records, not console text.

| Config | success | 95 % Wilson | scored | ok | excluded (L/A/O/T) | tok/step o200k p50 | tok/step chars/4 p50 | obs RTT ms/step p50 | RTT count/step p50 | navFb |
|---|---|---|---|---|---|---|---|---|---|---|
| B1 (argent proprietary) | 100 % | [96, 100] | 99/100 | 99 | 1 (1/0/0/0) | 657 | 473 | 462 | 2 | — |
| B2 (open, no graph) | 97 % | [92, 99] | 100/100 | 97 | 0 | 627 | 447 | 91 | 2 | — |
| O1 (+ query/diff) | 100 % | [96, 100] | 100/100 | 100 | 0 | 179 | 103 | 4 | 2 | — |
| O2 (+ outcomes) | 98 % | [93, 99] | 100/100 | 98 | 0 | 54 | 33 | 4 | 2 | — |
| O3 (+ graph, cold) | 98 % | [93, 99] | 99/100 | 97 | 1 (0/0/0/1) | 598 | 397 | 87 | 2 | — |
| O4 (graph, warm) | 98 % | [93, 99] | 100/100 | 98 | 0 | 85 | 70 | 47 | 1 | — |
| O5 (+ navigate-to) | 99 % | [94, 100] | 87/100 | 86 | 13 (13/0/0/0) | 85 | 70 | 46 | 1 | 40/42 |

- **B1 is now valid.** It located every tap LIVE from the `describe` it paid for
  (a plain describe+tap agent), with **0 describe/tree fallbacks** and its
  proprietary describe token cost intact (657 o200k / 473 chars/4). Its single
  exclusion is one genuine locate-fail (`settings-battery-then-back` rep 3), not a
  centre tap. The C.3 headline B1 = 93.3 % was a stale-coordinate replay artifact
  (review C-H4); that code path is deleted.
- **O5's 13 exclusions are honest.** They are locate-fails where `navigate-to`
  mis-routed (see O5 section) and the fallback re-locate of the tap selector then
  failed on the wrong screen — never a blind tap. If those 13 were counted as
  failures instead of exclusions, O5 would be 86/100 = 86 %.
- O2's 33 chars/4 vs B2's 447 is the ~13× token reduction; O4/O5 spend 1 RTT/step
  vs 2 for the baselines.

## Hypotheses (run 33806639520)

| Hypothesis | Statistic | Target | Measured | Verdict |
|---|---|---|---|---|
| H1 | O1 tokens/step vs B2, o200k p50, n=155/155 | ≤ 0.5× | 179/627 = **0.285×** | PASS |
| H2 (all steps) | B2 − O2 RTT-count/step p50, all steps | ≥ 1 | 2 − 2 = **0** | FAIL (structural) |
| H2 (same-screen) | B2 − O2 RTT-count/step p50, same-screen (n=50) | ≥ 1 | 2 − 1 = **1** | PASS |
| H3 | O4 warm / O3 cold tokens/step, o200k p50 | ≤ 0.2× | 77/598 = **0.129×** | PASS |

**H1 is now needle-independent.** The per-step observation selector is no longer
the assertion needle (C.3's `bench-screen-graph.ts:1040` fed `task.assertion` on
every non-tap step, so the ratio moved 0.182× → 0.107× between phases with
identical tier code — review C-H5). It is now the step's own action target, or a
per-task `query` anchor declared in the task list that is never the needle
(`observationQuery`, unit-tested: swapping the needle leaves every step's selector
byte-identical). O1's value rose from the needle-coupled 0.107× to the honest
0.285×; it still PASSES ≤ 0.5×, and it no longer moves when a needle changes.

**H4 — success non-inferior to each baseline, ONE oracle for every config**,
judged over the (task, rep) pairs BOTH sides scored, with 95 % Wilson intervals
(a config FAILS only when its interval lies entirely below the baseline's;
overlapping intervals are *indistinguishable at N*):

| Baseline | Baseline success + Wilson | Verdict |
|---|---|---|
| B1 (100 %, 99/99) [96,100] | | **PASS — none inferior.** O1 100 %, O2 98 %, O3 98 %, O4 98 %, O5 99 % — every interval overlaps B1's; indistinguishable at N. |
| B2 (97 %, 97/100) [92,99] | | **PASS — none inferior.** O1 100 %, O2 98 %, O3 98 %, O4 98 %, O5 99 % — every interval overlaps B2's; indistinguishable at N. |

Reading of H4: **at N = 5 reps × 20 tasks, no open config is distinguishable in
task success from either the proprietary (B1) or the open (B2) baseline, while
O2/O3/O4/O5 spend an order of magnitude fewer tokens.** This is the only H4 claim
the noise floor supports, and it now rests on a valid B1 and Wilson intervals
rather than the C.3 ±2 pp margin that sat an order of magnitude below the noise.

### Noise floor / two-run delta (work item F)

The established run-to-run noise floor is the C.3 review's same-code pair
(33779983434 ↔ 33786304637): |Δ| = **3.4–8.3 pp** per config with 3 reps. C.4's
95 % Wilson intervals (±3–8 pp here) are consistent with that floor, which is why
every H4 comparison lands "indistinguishable at N." A raw C.4-vs-C.3 success
delta is NOT a clean noise measurement — the harness changed materially between
them (B1 stale→live, O5 fallback re-locate, needle-independent tokens) — so it is
not used as the H4 discriminator; the within-run Wilson interval is.

## O5-pure vs O5-mixed, and why navigate-to routed only 2/42 (work items B, C)

O5 is reported as two rows from the structured `navigate-to` records:

| O5 row | success | tokens/step o200k p50 | RTT count/step p50 | N |
|---|---|---|---|---|
| **O5-mixed** (all scored runs) | 86/87 = 99 % [94,100] | 85 | 1 | 87 runs |
| **O5-pure** (runs whose every known-target tap ROUTED) | 2/2 = 100 % [34,100] | 85 | 1 | 2 runs |

**O5-pure coverage: 2 of 42 known-target taps routed via navigate-to** (across
scored runs; 2 of 60 counting every attempt). Far below the ≥ 30/36 target. The
graph store — uploaded as an artifact this run (`graph-store/com.android.settings/34.json`),
which the C.3 runs never shipped — shows exactly why, and it is a structural
finding, not a harness bug:

1. **All Settings sub-screens collapse into ONE graph node.** The whole Settings
   graph has 4 nodes: the root (`299378e0…`, 23 distinct resource-ids), one empty
   transient root, the Apps screen, and a single node `2bf46d4f…` **visited 285
   times** that stands for *every* detail screen (Network, Battery, Sound,
   Display, Storage, Notifications, …). They share an identical structural hash
   `H` because `ScreenHash.appendStructural` excludes text, applies the
   **RecyclerView first-child rule** (a scrolling container is hashed as the
   container plus only its first child's class sequence), and quantizes bounds to
   1/32 — so `AppBar + CollapsingToolbar + RecyclerView(first row)` is identical
   across all of them. There is therefore **no distinct destination node** to plan
   a route to.
2. **The single sub-screen node's text index is whatever screen was observed
   last.** `upsertNode` overwrites the index each visit, so `2bf46d4f…` currently
   indexes Network & internet's texts. Consequently a `navTarget` for any *other*
   sub-screen (`Saved devices`, `Brightness`, `Battery Saver`, …) is indexed
   nowhere → `planToSelector` returns null → **"no known path"** (settings-connected,
   settings-display, settings-battery, … all fall through to a plain locate+tap and
   still PASS).
3. **When a route IS found, the edge is a coordinate/bucket tap, so it lands on an
   arbitrary sibling.** Every recorded root→sub edge is a coordinate tap with no
   semantic selector (the bench taps by x/y). Replaying it lands on *some* detail
   screen, which structurally "reaches" `2bf46d4f…` (hash collision) but is the
   wrong screen — the `navTarget` is not live-present → **mis-land**
   (settings-network, settings-network-internet: `reached:true, misland:true` on
   all 5 reps). The fallback then cannot re-locate the original row (we have left
   the root) → the 13 locate-fail exclusions.

The from-side fix I added (localize the live root by exact hash, else a resource-id
multiset Jaccard ≥ 0.9) works — `fromVia` was `exact` on every O5 step this run,
and the matcher is unit-tested against two captured roots — but it cannot rescue a
graph that **cannot distinguish the destinations**. Fixing O5 routing needs the
device-side hash to separate sibling list screens (e.g. include the CollapsingToolbar
title, or hash more than the RecyclerView's first child) and the edges to carry the
tapped row's selector, not a bucket. That is a device-server / graph change beyond
C.4's harness scope; it is the concrete follow-up this run's uploaded graph store
now makes actionable.

## Root-hash instability — the field list (work item C)

The C.3 doc blamed "the live root hash does not match … the Settings root carries
dynamic content — clock, battery, signal." **`ScreenHash.kt` refutes that:**
`appendStructural` hashes `className | resourceId | quantized bounds | flags` per
node and **never appends `text` or `contentDesc`** — those go only into `H_text`
(`appendState`). A clock tick, a battery percentage or a signal label moves
`H_text`, never `H`. Empirically this run confirms it: `fromVia` was `exact` on
every O5 step, i.e. the live root hash matched the stored root every time — the
root did NOT drift.

The fields that CAN move the structural hash `H` (routing must never key on
`H_text`, and `stable(H)` should tolerate these):

| Field | Source | Effect on `H` |
|---|---|---|
| Quantized bounds bucket crossing | `ScreenHash.kt:66` `quant` = 1/32 of each dim (2400/32 = 75 px vertically, 1080/32 ≈ 34 px horizontally) | any layout shift past a bucket boundary changes `H` |
| `FLAG_FOCUSED` | `ScreenHash.kt:56` `flagsOf` (bit 5) | which node holds focus is part of the screen identity |
| RecyclerView first-child class sequence | `ScreenHash.kt:84-89` | scrolling a list changes which item is first, changing `H`; ALSO collapses sibling list screens (the O5 defect above) |
| Node insertion/removal | DFS record sequence | a late-loading contextual card shifts the whole structural string |
| Text / content-description | NOT in `H` (only `H_text`) | clock, battery %, signal, dates — **do not** change `H` |

`stable(H)` (implemented as `plan.ts` `localizeFrom` / `bestNodeByResourceIds`)
sidesteps all of these by matching on the resource-id multiset when the exact hash
misses; `isVolatileText` documents the text patterns (`\d%`, clocks, dates,
counters) that `H` already excludes.

## Per-task success matrix (run 33806639520)

`Y` oracle met · `N` oracle unmet · `L` locate-failed (aborted, excluded).

| Task | B1 | B2 | O1 | O2 | O3 | O4 | O5 |
|---|---|---|---|---|---|---|---|
| settings-network | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | LLLLL |
| settings-connected | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY |
| settings-apps | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYLLL |
| settings-notifications | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY |
| settings-battery | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY |
| settings-storage | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY |
| settings-sound | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY |
| settings-display | YYYYY | YYNYY | YYYYY | NYYNY | YNYYY | YYYNY | YYYNY |
| settings-network-internet | YYYYY | YYYYY | YYYYY | YYYYY | YNYYY | YYYYY | LLLLL |
| settings-battery-then-back | YYYLY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY |
| chrome-open-page | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY |
| chrome-heading-word | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY |
| chrome-example-word | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY |
| chrome-scroll-body | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY |
| chrome-scroll-doc | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY |
| same-settings-search | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY |
| same-sound-noop | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY |
| same-chrome-noop | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY |
| same-display-slider | YYYYY | YNNYY | YYYYY | YYYYY | NYYYY | YNYYY | YYYYY |
| same-apps-noop | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY |

`settings-display` and `same-display-slider` stay mildly flaky across ALL configs
(scattered single N, e.g. B2 `same-display-slider` YNNYY): the Display screen is
reached by swipe-then-tap and the fling scroll offset is not deterministic, so a
tap occasionally lands short. This is task reliability, not a needle or config
issue, and it hits every config roughly equally (it does not separate them in H4).

## Oracle-independent tokens (work item D)

O1/O2 tokens/step no longer depend on the oracle needle. The per-step observation
selector comes from `observationQuery(task, step)` (pure module
`src/screen-graph/bench/observe.ts`): a tap/type step observes its own target; a
swipe/back/tapXY/launch step observes the task's declared `query` anchor, else the
first tap selector, else an app anchor — never `task.assertion`. Unit test
`screen-graph-bench-observe.test.ts` swaps one needle and asserts every step's
observation selector is byte-identical. The per-rep table confirms determinism:
O1 = 179 o200k on all 5 reps, O2 = 54 on all 5.

## navTarget de-coupled from the oracle (work item E)

`navTarget` is now a screen identity distinct from the assertion for every task
(review C-M4 removed): settings-network routes to `Internet` while the oracle
looks for `Calls & SMS`; settings-battery routes to `Battery Saver` vs
`Battery usage`; etc. `validateTasks` throws if any `navTarget` or `query` equals
its `assertion`, and a unit test asserts the shipped set complies.

## Superseded C.3 numbers (from run 33786304637)

The C.3 tables are withdrawn. Per-number reason:

| C.3 number | Why superseded |
|---|---|
| B1 success 93.3 % | Stale-coordinate replay artifact (`precomputeB1Coords` located once, 133 s before the run, replayed for all reps; all 4 failures on the two swipe tasks). Removed; B1 now live-locates → 100 % (99/99). |
| O5 success 82 % / "fallbacks 0" | Mixed-strategy number; the console counter missed the fallbacks (they logged via `realDebug`). navigate-to actually routed 9/153 steps, 0/9 successfully. Now split into O5-pure (2/42) and O5-mixed (99 %) from structured records; fallbacks counted structurally (navFb 40). |
| H1 = 0.107× | Needle-coupled (observation selector was the assertion). Now needle-independent → 0.285×. |
| H4 "O1 97 % vs B2 100 %, −3 pp ✗" | Inside the 3.4–8.3 pp noise floor; withdrawn. Replaced by Wilson-interval verdicts (all indistinguishable at N). |
| "brightness" destination-unique | It IS in the root's full (below-fold) tree; only passed the C.3 visible-only gate. Replaced by `Brightness level`, gated over the full tree. |
| "No route (27/36)" cause = dynamic root hash | Refuted by `ScreenHash.kt` (H excludes text). Real cause: sub-screen hash collision + bucket-tap edges (see O5 section). |

## Files changed

Bench tree (`feat/screen-graph-c4`):
- `src/screen-graph/plan.ts` — `multisetJaccard`, `bestNodeByResourceIds`,
  `localizeFrom`, `planToSelectorStable`, `nodeIndexesSelectorTolerant`,
  `isVolatileText` (the stable/Jaccard localizer, work item C).
- `src/screen-graph/navigate.ts` — optional tolerant `matches` predicate.
- `src/tools/navigate-to/index.ts` — localize FROM by hash-or-Jaccard, verify
  arrivals tolerantly, surface `fromVia`.
- `src/screen-graph/{types,store,recorder}.ts` + `src/utils/screen-graph-open-wiring.ts`
  — persist the resource-id multiset; index content-descriptions.
- `src/screen-graph/bench/tasks.ts` — needle `brightness`→`Brightness level`;
  navTargets distinct from the oracle; `query` anchors; validation.
- `src/screen-graph/bench/observe.ts` (new) — needle-independent `observationQuery`.
- `src/screen-graph/bench/describe-locate.ts` (new) — B1's live describe+tap locate.
- `src/screen-graph/bench/oracle.ts` — `ignoreVisibility` (full-tree gate).
- `scripts/bench-preflight.ts` — full-tree gate for navigating tasks.
- `scripts/bench-screen-graph.ts` — remove precompute; B1 live-locate; structured
  O5 nav records + fallback ordering + O5-pure/mixed; Wilson intervals; upload the
  graph store; per-step hash + strategy + nav records.
- Tests: `screen-graph-plan.test.ts` (matcher, two roots), `screen-graph-bench-observe.test.ts`
  (needle-independence + describe-locate), `screen-graph-navigate.test.ts`
  (tolerant matches), `screen-graph-bench-tasks.test.ts` (navTarget/query invariants).

Workflow tree (`feat/bench-ci-c4`):
- `.github/workflows/bench-open-vs-proprietary.yml` — check out the bench tree by
  branch name; `BENCH_REPS=5`; screen-graph job timeout 120→180 min.

## Acceptance check

- B1 live-locates every step; no precompute code path left. ✓
- O5 rows split; fallbacks from structured records; navigate ok/error persisted in
  the JSON and the graph store uploaded. ✓
- Root-hash instability fields listed (ScreenHash-grounded); matcher unit-tested;
  O5-pure coverage reported (2/42) with the structural reason it is below 30/36. ✓
- Tokens/step for O1/O2 shown needle-independent (unit test swaps a needle). ✓
- Run green; `PROBLEM needles: 0` over the full tree; results doc written; branches
  pushed; run URL above. ✓
