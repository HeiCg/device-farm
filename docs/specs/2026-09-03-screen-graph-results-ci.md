# Results (CI): screen-graph Phase D.1 — O5 routes (unique-selector edges, H_id-only keying)

Phase D.1 answers the D review: O5 routed 0/55 not because edges lacked selectors
(they carried them) but for two structural reasons the run's own store proved.
D.1 fixes both, and O5 now routes.

- **Fix A — unique selector.** Every root→sub edge had recorded
  `action.target = {id:"title"}`; `android:id/title` is shared by ~19 Settings
  rows, so replay tapped the wrong row and diverged. Now the recorder picks the
  key that is UNIQUE on the source tree (id if unique among visible nodes, else
  text/contentDescription, else a positional bucket) and stores it as `via`;
  replay resolves in that precedence, queries the device, filters to a whole-field
  EXACT match, and taps only when exactly ONE node remains — otherwise it DIVERGES
  with a reason instead of tapping `nodes[0]`.
- **Fix B — H_id-only keying.** The describe tier keyed nodes by the STRUCTURAL
  hash (`state.hash`) instead of the identity hash (`state.idHash`), minting
  pollutant duplicate nodes that made a navTarget resolve to two screens. Now the
  tier (and the open-server wiring) key by `H_id` only and carry
  resourceIds/structuralHash; a record without an idHash is skipped and counted
  (`recordSkippedNoIdHash`) rather than creating a structural-hash node.
- **Compose.** The matrix starts from an EMPTY store; every open-server config
  (B2/O1/O2 as well as O3/O4/O5) records selector edges off the agent's timed
  cost, so O5 runs LAST over a store the earlier configs populated. B1 has no open
  server in its loop and contributes no recordings — the six open configs traverse
  the identical task list, so O5's store is fully covered.

Every number below is **regenerated from the run artifact JSON**
(`bench-sg-2026-09-05T09-35-41-230Z.json`); the independent recompute reproduces
the harness-emitted `results-ci.md` in the same artifact to the digit.

## Run (HeiCg/argent, workflow `bench-open-vs-proprietary.yml`)

| Purpose | Run id | URL |
|---|---|---|
| **Matrix (FINAL — authoritative)** | **33958064084** | https://github.com/HeiCg/argent/actions/runs/33958064084 |

Branches: bench tree `feat/screen-graph-d` @ `757956c57`; workflow
`feat/bench-ci-d` @ `77cd4b9a`. 7 configs × 20 tasks × **5 reps** = 100 task-runs
per config. Tokenizer: js-tiktoken `o200k_base` (primary), chars/4 (secondary).
`skipped: {}` (no run dropped from any denominator).

## Pre-flight gate (full tree, destination presence required)

Quoted from run 33958064084 `logs/sg-preflight.log`:

```
PROBLEM needles: 0 — none
[preflight] GATE PASS: PROBLEM needles: 0
```

## Per-config — success (full 100 denominator), tokens/step, RTT

`success = ok / 100` for every config (exclusions-as-failures; `isExcludedRun` is
restricted to pre-action infra, and none occurred). The **primary** interval is
the task-cluster bootstrap (n = 20 tasks); naive Wilson (n = 100) is secondary.
`fail (L/A/O/T/N)` = locate / action / oracle / task / plain oracle-unmet.

| Config | success | cluster 95% (n=20) | Wilson (n=100) | fail (L/A/O/T/N) | nsteps | tok/step o200k p50 | tok/step o200k p95 | tok/step chars/4 p50 | obs RTT ms/step p50 | RTT count/step p50 |
|---|---|---|---|---|---|---|---|---|---|---|
| B1 (argent proprietary) | 98 % (98/100) | [94, 100] | [93, 99] | 2 (2/0/0/0/0) | 155 | 657 | 4161 | 473 | 503 | 2 |
| B2 (open, no graph) | 99 % (99/100) | [97, 100] | [95, 100] | 1 (0/0/0/0/1) | 155 | 627 | 4510 | 447 | 90 | 2 |
| O1 (+ query/diff) | 99 % (99/100) | [97, 100] | [95, 100] | 1 (0/0/0/0/1) | 155 | 138 | 515 | 77 | 4 | 2 |
| O2 (+ outcomes) | 99 % (99/100) | [97, 100] | [95, 100] | 1 (0/0/0/0/1) | 155 | 54 | 515 | 33 | 3 | 2 |
| O3 (+ graph, cold) | 97 % (97/100) | [92, 100] | [92, 99] | 3 (0/0/0/0/3) | 155 | 598 | 4510 | 397 | 87 | 2 |
| O4 (graph, warm) | 98 % (98/100) | [95, 100] | [93, 99] | 2 (0/0/0/0/2) | 155 | 22 | 110 | 20 | 44 | 1 |
| O5 (+ navigate-to) | **99 % (99/100)** | **[97, 100]** | **[95, 100]** | 1 (0/0/0/0/1) | 155 | 29 | 110 | 24 | 46 | 1 |

- **O5 recovered from 62/100 (D) to 99/100.** Its single failure is one flaky
  `same-display-slider` rep, not a routing failure.
- **O5 RTT count/step p50 is 1** over all 155 steps (dominated by the
  chrome/same-screen steps). On the ROUTED known-target taps the honest count is
  2 (a `navigate-to` step + arrival verification) — see the O5-pure row.
- O2's 33 chars/4 vs B2's 447 is the ~13× token reduction; O4/O5 median 1 RTT/step
  on the steps that are not known-target taps.

## O5 navigate-to structure (structured records, ALL attempted known-target taps)

Counted over all **60** attempted known-target taps (before any exclusion),
classified from each step's `nav` record:

| Outcome | Count |
|---|---|
| **routed** (reached, target present) | **45** |
| **mis-landed** (reached, target absent) | **0** |
| **diverged-after-tap** | **0** |
| **no-route** | **15** |
| **fallbacks** | **15/60** |

No-route split: **ambiguous-target 15, no-known-path 0**. Diverged split:
selector-ambiguous-on-live-tree 0, selector-unresolved-on-live-tree 0,
hash-mismatch 0. Records skipped for a missing H_id (`recordSkippedNoIdHash`):
**0** (no structural-hash node was ever created — Fix B).

- **O5-pure coverage: 45 of 60 known-target taps ROUTED via navigate-to.** This
  is ≥ 30 — the coverage acceptance bar is **met** (it was 0/55 in D).
- **Mis-lands: 0** — at or under the ≤ 2 bar (arrival is verified by `H_id`, and
  Fix A never taps a non-unique row, so a wrong-screen landing cannot occur).
- The **15 no-routes are all the one navTarget `Internet`** (settings-network,
  1 tap/rep × 5, and settings-network-internet, 2 taps/rep × 5 = 15). In the store
  the Network & internet screen has TWO distinct `H_id` nodes (a residual `H_id`
  variant of one screen), so `Internet` is indexed by two nodes and the router
  correctly REFUSES to route (ambiguous) and falls back to locate+tap — both tasks
  still PASS. This is a device-side `H_id`-stability follow-up, not a Fix A/B
  regression: the store carries **0 pollutant nodes and 0 structural-hash-keyed
  nodes**, and every other navTarget is indexed by exactly one node.

| O5 row | success | tok/step o200k p50 | RTT count/step p50 | N |
|---|---|---|---|---|
| **O5-mixed** (all runs, the published O5) | 99/100 = 99 % · cluster [97, 100] · Wilson [95, 100] | 29 | 1 | 100 runs |
| **O5-pure** (runs whose every known-target tap routed) | 40/40 = 100 % [91, 100] | 29 | 2 | 40 runs |

## Hypotheses (run 33958064084)

| Hypothesis | Statistic | Target | Measured | Verdict |
|---|---|---|---|---|
| H1 | O1 tokens/step vs B2, o200k p50, n=155/155 | ≤ 0.5× | 138/627 = **0.220×** | **PASS** |
| H2 (all steps) | B2 − O2 RTT-count/step p50, all steps | ≥ 1 | 2 − 2 = **0** | **FAIL** (structural) |
| H2 (same-screen) | B2 − O2 RTT-count/step p50, same-screen n=50/50 | ≥ 1 | 2 − 1 = **1** | **PASS** |
| H3 | O4 warm / O3 cold tokens/step, o200k p50, n=153/155 | ≤ 0.2× | 22/598 = **0.037×** | **PASS** |

**H4 — success non-inferior to each baseline, ONE oracle for every config**, on
the FULL 100-run denominator, paired task-cluster bootstrap of `Δ = config −
baseline` (inferior when the point estimate is more than 5 pp below the baseline;
20 000 resamples):

| Baseline | Baseline success (cluster / Wilson) | Paired Δ verdict (O1..O5) |
|---|---|---|
| B1 (98 %, 98/100) [94,100] / [93,99] | | **PASS — none inferior.** O1 +1 [−3,6] · O2 +1 [−3,6] · O3 −1 [−7,5] · O4 +0 [−4,5] · **O5 +1 [−3,6]** |
| B2 (99 %, 99/100) [97,100] / [95,100] | | **PASS — none inferior.** O1 +0 [−3,3] · O2 +0 [−3,3] · O3 −2 [−6,0] · O4 −1 [−3,0] · **O5 +0 [−3,3]** |

Reading of H4: **every open config, O5 included, is indistinguishable in task
success from both the proprietary (B1) and the open (B2) baseline, while O2/O4/O5
spend an order of magnitude fewer tokens.** O5 is now non-inferior against a valid
B1 — the D verdict (O5 −36 pp, inferior) is reversed by the routing fix.

### H2 detail — RTT count/step, all steps vs same-screen only

| Config | RTT/step p50 (all) | RTT/step p50 (same-screen, n=50) |
|---|---|---|
| B1 | 2 | 2 |
| B2 | 2 | 2 |
| O1 | 2 | 2 |
| O2 | 2 | 1 |
| O3 | 2 | 1 |
| O4 | 1 | 1 |
| O5 | 1 | 1 |

## Cold vs warm (O3 vs O4)

- O3 cold (novel-screen) tokens/step o200k p50: **598** (n = 155)
- O4 warm (revisited-screen) tokens/step o200k p50: **22** (n = 153)
- warm/cold ratio: **0.037×** (≤ 0.2× target, H3 PASS)

## Per-task success matrix (run 33958064084)

`Y` oracle met · `N` oracle unmet · `L` locate-failed (aborted). `L` and `N` both
count as failures on the full denominator.

| Task | B1 | B2 | O1 | O2 | O3 | O4 | O5 |
|---|---|---|---|---|---|---|---|
| settings-network | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY |
| settings-connected | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY |
| settings-apps | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY |
| settings-notifications | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY |
| settings-battery | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY |
| settings-storage | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY |
| settings-sound | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY |
| settings-display | YYYYY | YYYYN | YYYYY | YYYYY | YYNYY | NYYYY | YYYYY |
| settings-network-internet | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY |
| settings-battery-then-back | YLYYL | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY |
| chrome-open-page | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY |
| chrome-heading-word | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY |
| chrome-example-word | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY |
| chrome-scroll-body | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY |
| chrome-scroll-doc | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY |
| same-settings-search | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY |
| same-sound-noop | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY |
| same-chrome-noop | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY |
| same-display-slider | YYYYY | YYYYY | YYYNY | YNYYY | NNYYY | YYYNY | YNYYY |
| same-apps-noop | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY |

O5's settings navigation rows are now all `Y` (routed or fallback). The scattered
single `N` on `settings-display` / `same-display-slider` is the fling-offset
flakiness that hits every config roughly equally (it does not separate them in H4).

## Fixes verified on the run's own store

- **0 pollutant nodes** and **0 nodes keyed by a structural hash** in the uploaded
  `graph-store/com.android.settings/34.json` (11 nodes); `recordSkippedNoIdHash`
  = 0. Fix B eliminated the describe-tier structural-hash keying at the source.
- **0 diverged, 0 mis-landed** over 60 known-target taps; 45 routed. Fix A's
  unique-selector resolution replaces the D run's 40 diverged + 10-would-be
  mislands.
- The `H_id` unit tests and the new store-level regression pass (run in the
  worktree before push):

```
vitest run screen-graph-edge-selector screen-graph-store-migration
  screen-graph-screen-hash screen-hash screen-graph-plan screen-graph-navigate …
Test Files  28 passed (28)
     Tests  282 passed | 2 skipped
```

The store-level test loads this run's predecessor store (33947160117) plus the
captured root tree and asserts an H_id-only rebuild drops the structural-keyed
pollutants (each navTarget then resolves to ≤ 1 node) and that every root→sub row
edge resolves to exactly one row while a container-tap edge correctly refuses.

## Acceptance check (ticket §4 + D.1)

| Criterion | Status |
|---|---|
| O5-pure covers ≥ 30 known-target taps | **PASS — 45/60 routed** |
| mis-land count reported and ≤ 2 | **PASS — 0 mis-lands** |
| O5 success within the cluster interval of B1 | **PASS — O5 99 % [97,100] vs B1 98 % [94,100]; Δ +1 pp [−3,6]** |
| results doc regenerated from JSON | **PASS** (this doc; reproduces the artifact `results-ci.md`) |
| H1–H4 restated | **PASS** (H1/H2/H3 PASS/FAIL/PASS; H4 all non-inferior incl. O5) |
| `H_id` + store-migration unit tests pass | **PASS** (282 pass / 2 pre-existing skips) |
| branches pushed; run URL reported | **PASS** (`feat/screen-graph-d` @ 757956c57; run 33958064084) |

## Superseded D numbers (from run 33947160117)

The D tables are withdrawn. Per-number reason:

| D number | Why superseded |
|---|---|
| O5 success 62 % (62/100) | D's `navigate-to` could not resolve any route: replay tapped the shared `{id:"title"}` and diverged. Fix A resolves the unique row; O5 is now **99/100**. |
| O5-pure coverage 0/55 routed | D routed 0 (40 diverged + 15 ambiguous). D.1 routes **45/60** — coverage bar met. |
| O5 diverged-after-tap 40 | The diverged taps were `{id:"title"}` replays landing on the wrong sibling. Fix A: **0 diverged**. |
| O5 no-route 15 (all "ambiguous target") | D's ambiguity came from pollutant duplicate nodes (Fix B target). D.1 has 0 pollutants; the 15 residual ambiguous no-routes are the single `Internet` navTarget indexed by two real `H_id` nodes for one screen — a separate, minor `H_id`-stability follow-up, and both tasks still pass via fallback. |
| H4 "O5 inferior −36 pp [−57,−16] vs B1" | Measured on a broken router. With routing fixed O5 is **+1 pp [−3,6] vs B1** — non-inferior. |
| per-config success B1 98 / … / O5 62 | Same run superseded; D.1 values: B1 98, B2 99, O1 99, O2 99, O3 97, O4 98, O5 99. |

## Files changed (bench tree `feat/screen-graph-d` @ 757956c57)

- `src/screen-graph/types.ts` — `EdgeSelector.via` (the unique key chosen at record time).
- `src/utils/open-server-input.ts` — `tappedSelectorFromTree` computes source-tree uniqueness and sets `via`; record gate uses the shared recording predicate.
- `src/utils/screen-graph-open-wiring.ts` — record-only mode (`ARGENT_SG_RECORD`), H_id-only keying with `recordSkippedNoIdHash`, edge target folded from `via`.
- `src/tools/describe/platforms/android/tiered.ts` — key by `state.idHash` (Fix B root cause), carry resourceIds/structuralHash, skip+count when idHash absent.
- `src/tools/navigate-to/index.ts` — `resolveTapPoint` resolves via-first, exact-filters the live query, taps only on a unique match else diverges with a reason (`selector ambiguous/unresolved on live tree`), surfaced as `divergeReason`.
- `scripts/bench-screen-graph.ts` — fresh store per run, all-open-config recording, O5 last, no-route/diverged reason split, O5-pure coverage over 60 taps, `skippedNoIdHash` in the report and JSON.
- Tests: `screen-graph-edge-selector.test.ts` (ambiguous-id → unique-text, diverge reasons); new `screen-graph-store-migration.test.ts` (H_id-only rebuild + unique edge resolution on the run 33947160117 store).
