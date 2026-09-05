# Results (CI): screen-graph Phase D — H_id identity, selector-carrying edges, honest O5

Phase D answers the C.4 review's REJECT (`2026-09-03-review-c4-findings.md`). It
adds a device-side screen **identity** hash `H_id` (keeping `H`/`H_text` for
diff/awaitChange), makes graph edges carry the acted element's selector, routes
`navigate-to` **only when the destination `H_id` is unambiguous**, and republishes
every success number on the **full 100-run denominator** (exclusions caused by a
config's own action are failures — the C.4 chosen-denominator defect, review
C4-H1/H2, is gone).

Every number below is **regenerated from the run artifact JSON**
(`bench-sg-2026-09-05T05-32-40-643Z.json`, one per record/step), not hand-typed.
The independent recompute in this doc reproduces the harness-emitted
`results-ci.md` in the same artifact to the digit.

## Run (HeiCg/argent, workflow `bench-open-vs-proprietary.yml`)

| Purpose | Run id | URL |
|---|---|---|
| **Matrix (FINAL — authoritative)** | **33947160117** | https://github.com/HeiCg/argent/actions/runs/33947160117 |

Branches: bench tree `feat/screen-graph-d` @ `139bec51a`; workflow
`feat/bench-ci-d` @ `77cd4b9a`. 7 configs × 20 tasks × **5 reps** = 100 task-runs
per config. Tokenizer: js-tiktoken `o200k_base` (primary), chars/4 (secondary).
Run finished 2026-09-05T06:53:30Z; `skipped: {}` (no run dropped from any
denominator).

## Pre-flight gate (full tree, destination presence required)

Quoted from run 33947160117 `logs/sg-preflight.log`:

```
PROBLEM needles: 0 — none
[preflight] GATE PASS: PROBLEM needles: 0
```

The navigating-task gate checks the needle against the FULL launch tree (visible
OR below-fold) AND requires presence on the destination dump, not only absence on
launch (review C-M2 closed). `settings-root nodes: 133` (full tree). One task,
`same-display-slider`, logs `ok (absent from launch; destination unreachable —
presence NOT verified)`: its destination could not be reached during pre-flight,
so presence is not asserted rather than falsely claimed. All other navigating
needles read `ok (absent from launch, present on destination)`. The preflight
fixture is committed (`preflight-launch-screens.json`, review C-M3 closed).

## Per-config — success (full 100 denominator), tokens/step, RTT

`success = ok / 100` for every config. A run is a **failure** unless its oracle
was met; a `locate-fail` that follows the config's own navigation is a failure,
not an exclusion (`isExcludedRun` is restricted to pre-action infra identical for
all configs, and no such run occurred this run). The **primary** interval is the
task-cluster bootstrap (n = 20 tasks — the 5 reps of a task are correlated, review
C4-H5); naive Wilson (n = 100) is a secondary column and reads too narrow where
failures cluster. `fail (L/A/O/T/N)` = locate / action / oracle / task / plain
oracle-unmet. `nsteps` counts non-launch steps (fewer for O5: its aborted
locate-fail runs stop early).

| Config | success | cluster 95% (n=20) | Wilson (n=100) | fail (L/A/O/T/N) | nsteps | tok/step o200k p50 | tok/step o200k p95 | tok/step chars/4 p50 | obs RTT ms/step p50 | RTT count/step p50 |
|---|---|---|---|---|---|---|---|---|---|---|
| B1 (argent proprietary) | 98 % (98/100) | [95, 100] | [93, 99] | 2 (2/0/0/0/0) | 155 | 657 | 4510 | 473 | 431 | 2 |
| B2 (open, no graph) | 99 % (99/100) | [97, 100] | [95, 100] | 1 (0/0/0/0/1) | 155 | 627 | 4510 | 447 | 93 | 2 |
| O1 (+ query/diff) | 98 % (98/100) | [95, 100] | [93, 99] | 2 (0/0/0/0/2) | 155 | 138 | 515 | 77 | 4 | 2 |
| O2 (+ outcomes) | 99 % (99/100) | [97, 100] | [95, 100] | 1 (0/0/0/0/1) | 155 | 54 | 515 | 33 | 3 | 2 |
| O3 (+ graph, cold) | 99 % (99/100) | [97, 100] | [95, 100] | 1 (0/0/0/0/1) | 155 | 598 | 4510 | 397 | 89 | 2 |
| O4 (graph, warm) | 97 % (97/100) | [92, 100] | [92, 99] | 3 (0/0/0/0/3) | 155 | 21 | 29 | 19 | 47 | 1 |
| O5 (+ navigate-to) | **62 % (62/100)** | **[41, 82]** | **[52, 71]** | 38 (37/0/0/0/1) | 145 | 21 | 29 | 19 | 84 | 1 |

- **B1 is a valid live agent.** It located every tap LIVE from the `describe` it
  paid for (657 o200k / 473 chars/4), `fallbacks 0` (the proprietary path ran).
  Its two failures are genuine locate-fails (`settings-network-internet` rep 1,
  `settings-battery-then-back` rep 0), counted as failures on the full
  denominator — 98/100.
- **O5 collapsed to 62/100.** All 38 failures are on the settings navigation
  tasks: 37 locate-fails + 1 plain oracle-unmet. This is the honest cost of
  routing only when `H_id` is unambiguous — see the O5 section. It is **inferior**
  to both baselines (H4).
- **O5's RTT count/step of 1 UNDERCOUNTS the known-target taps.** The JSON records
  `rttCount: 1` on all 55 known-target taps, but each paid more: the 40 diverged
  taps executed a `navigate-to` step (route length 1) then a fallback locate query
  then the tap (~3 round trips); the 15 no-route taps paid a fallback locate +
  tap (~2). The headline p50 of 1 is dominated by the 90 non-known-target steps
  (chrome + same-screen), where O5 does spend 1 RTT. Read O5's 1 RTT/step with
  that caveat (review C4-M4 persists in the recorded counter).
- O2's 33 chars/4 vs B2's 447 is the ~13× token reduction; O4/O5 spend 1 RTT/step
  vs 2 for the baselines on the steps that are not known-target taps.

## O5 navigate-to structure (structured records, ALL attempted known-target taps)

Counted over all **55** attempted known-target taps (before any exclusion, review
C4-H3), classified from each step's `nav` record (`{attempted, reached,
completedSteps, totalSteps, error, fromVia}`):

| Outcome | Count | `nav` signature |
|---|---|---|
| **routed** (reached, target present) | **0** | reached=true, misland=false |
| **mis-landed** (reached, target absent) | **0** | reached=true, misland=true |
| **diverged-after-tap** | **40** | reached=false, totalSteps=1, completedSteps=0 |
| **no-route** | **15** | reached=false, totalSteps=0, error `ambiguous target: 2 screens index this selector` |
| **fallbacks** | **55/55** | `navFallback=true` on every known-target tap |

- **O5-pure coverage: 0 of 55 known-target taps ROUTED.** `fromVia` was `exact`
  on all 55 (the live root `H_id` matched the stored node every time), so the
  from-side localization is not the failure — the route itself is.
- **Mis-lands: 0** — at or under the ≤ 2 acceptance bar. But **coverage 0/55 is
  far below the ≥ 30 acceptance bar**, so O5 routing does NOT pass acceptance.
  Per the ticket, this is reported with the store evidence and no harness
  workaround (see the graph-store diagnosis below).

| O5 row | success | tok/step o200k p50 | RTT count/step p50 | N |
|---|---|---|---|---|
| **O5-mixed** (all runs, the published O5) | 62/100 = 62 % · cluster [41, 82] · Wilson [52, 71] | 21 | 1 | 100 runs |
| **O5-pure** (runs whose every known-target tap routed) | 0/0 — **no run routed every known-target tap** | — | — | 0 runs |

Of the 100 O5 runs, 50 contain ≥ 1 known-target tap; because 0 taps routed, **0**
runs qualify as pure. O5-pure carries no information this run.

## Hypotheses (run 33947160117)

| Hypothesis | Statistic | Target | Measured | Verdict |
|---|---|---|---|---|
| H1 | O1 tokens/step vs B2, o200k p50, n=155/155 | ≤ 0.5× | 138/627 = **0.220×** | **PASS** |
| H2 (all steps) | B2 − O2 RTT-count/step p50, all steps, n=155 | ≥ 1 | 2 − 2 = **0** | **FAIL** (structural) |
| H2 (same-screen) | B2 − O2 RTT-count/step p50, same-screen, n=50/50 | ≥ 1 | 2 − 1 = **1** | **PASS** |
| H3 | O4 warm / O3 cold tokens/step, o200k p50, n=153/155 | ≤ 0.2× | 21/598 = **0.035×** | **PASS** |

**H2 (all-steps) is structurally 0, not a regression.** The navigation tasks
change the screen every step, so O2's "skip the read when the outcome reports no
change" has nothing to act on there; the saving is real only on the SAME-SCREEN
tasks (n = 50), where an unchanged step costs O2 1 RTT vs B2's 2.

**H4 — success non-inferior to each baseline, ONE oracle for every config**, on
the FULL 100-run denominator (exclusions-as-failures), judged by the **paired**
task-cluster bootstrap of `Δ = config − baseline` (no shared-pair intersection —
the C.4 intersection removed the runs O5 destroyed from the baseline too, review
C4-H2). A config is INFERIOR when its point estimate is more than 5 pp (the noise
floor) below the baseline. Bootstrap: 20 000 resamples over the 20 tasks.

| Baseline | Baseline success (cluster / Wilson) | Paired Δ verdict (O1..O5) |
|---|---|---|
| B1 (98 %, 98/100) cluster [95,100] · Wilson [93,99] | | **FAIL — one O-config inferior.** O1 +0 pp [−4, +4] · O2 +1 pp [−2, +4] · O3 +1 pp [−2, +4] · O4 −1 pp [−7, +4] — all non-inferior; **O5 −36 pp [−57, −16] — INFERIOR** |
| B2 (99 %, 99/100) cluster [97,100] · Wilson [95,100] | | **FAIL — one O-config inferior.** O1 −1 pp [−3, 0] · O2 +0 pp [−3, +3] · O3 +0 pp [−3, +3] · O4 −2 pp [−6, 0] — all non-inferior; **O5 −37 pp [−59, −17] — INFERIOR** |

Reading of H4: **O1–O4 are indistinguishable in task success from both the
proprietary (B1) and the open (B2) baseline while O2/O4 spend an order of
magnitude fewer tokens; O5 is inferior to both by ~36 pp**, its CI lying entirely
below zero. O5's `navigate-to` did not clear the bar this run.

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
- O4 warm (revisited-screen) tokens/step o200k p50: **21** (n = 153)
- warm/cold ratio: **0.035×** (≤ 0.2× target, H3 PASS)

## Per-task success matrix (run 33947160117)

`Y` oracle met · `N` oracle unmet · `L` locate-failed (aborted). `L` and `N` BOTH
count as failures on the full denominator.

| Task | B1 | B2 | O1 | O2 | O3 | O4 | O5 |
|---|---|---|---|---|---|---|---|
| settings-network | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY |
| settings-connected | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | LLLLL |
| settings-apps | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | LLLLL |
| settings-notifications | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | LLLLL |
| settings-battery | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | LLLLL |
| settings-storage | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | LLLLL |
| settings-sound | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | LLLLL |
| settings-display | YYYYY | NYYYY | YYYNY | YYYYY | YYYYY | YYNYY | YLYLN |
| settings-network-internet | YLYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY |
| settings-battery-then-back | LYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | LLLLL |
| chrome-open-page | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY |
| chrome-heading-word | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY |
| chrome-example-word | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY |
| chrome-scroll-body | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY |
| chrome-scroll-doc | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY |
| same-settings-search | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY |
| same-sound-noop | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY |
| same-chrome-noop | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY |
| same-display-slider | YYYYY | YYYYY | YYNYY | YYYNY | YYNYY | NYYNY | YYYYY |
| same-apps-noop | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY | YYYYY |

O5's seven `LLLLL` rows (`settings-connected`, `-apps`, `-notifications`,
`-battery`, `-storage`, `-sound`, `-battery-then-back`) are the collapse: the tap
selector could not be re-located after a diverged route left the source screen.
`settings-network` and `settings-network-internet` pass because their needle
happens to be present on the sibling screen the route lands on. `settings-display`
and `same-display-slider` stay mildly flaky across ALL configs (the Display screen
is reached by swipe-then-tap and the fling offset is not deterministic) — task
reliability, not a config effect.

## H_id — screen identity hash (device side, `ScreenHash.kt` + host twin)

`H_id` is a new hash for **node keys and routing**, distinct from `H`
(diff/awaitChange) and `H_text` (state). Design (`ScreenHash.identity` in
`packages/android-device-server/.../ScreenHash.kt`, host twin `identityHash` in
`packages/tool-server/src/utils/screen-hash.ts`):

- window package;
- the texts of **identity nodes** — collapsing-toolbar / action-bar / dialog
  titles and a `title` under a toolbar (`isIdentityTitle`, `isToolbarContainer`),
  with volatile text dropped (`isVolatileText`: time, %, dates, counters);
- the **resource-id multiset of non-scrollable subtrees**, order-free (so scroll
  and focus do not move it), system rids excluded (`statusBarBackground`,
  `navigationBarBackground`);
- for scrollable containers: `class#resourceId` ONLY — never the child sequence,
  never bounds;
- no bounds, no focus flags.

`getState`/`getNestedState` return `H_id` alongside `H`/`H_text`; the host graph
keys nodes by `H_id`.

### H_id unit tests — pass

Run in worktree `feat/screen-graph-d` @ `139bec51a`:

```
vitest run screen-graph-screen-hash.test.ts screen-hash.test.ts screen-graph-edge-selector.test.ts
Test Files  3 passed (3)
     Tests  30 passed (30)
```

Identity tests (`screen-graph-screen-hash.test.ts`, `describe "H_id — screen
identity (design D §1)"` and `"H_id predicates"`):

- `(a) merges the two homepage roots 77a189ce and 299378e0 into ONE H_id`
- `(b) gives Network / Battery / Sound / Display / Apps five DISTINCT H_id`
- `(b') the detail screens collapse under H but SEPARATE under H_id`
- `(c) the same sub-screen scrolled keeps the SAME H_id`
- `a sub-screen H_id differs from the homepage H_id`
- `focus and the scroll flag never move H_id`
- `treats collapsing_toolbar / action-bar / dialog ids as identity titles`
- `does NOT treat a bare list title, a search hint, or homepage_title as identity`
- `marks toolbar/app_bar containers`

Edge-selector tests (`screen-graph-edge-selector.test.ts`, phase D §2/§3):

- `store.observe records the selector on the edge`
- `a later observation refreshes the selector; weight is per (from, selector)`
- `plan carries the edge selector onto each PlanStep`
- `keys the node/edge by the identity hash and stores H as a diagnostic`
- `resolves by resource-id first, tapping the LIVE centre`
- `falls through resource-id → text → contentDescription`
- `DIVERGES when a selector was recorded but nothing resolves (edge not taken)`
- `uses the bucket centre only when the edge carries NO selector`

## Edges carry the acted element's selector (phase D §2)

Every edge records the tapped node's `{text?, contentDescription?, resourceId?,
className, indexInParent, boundsBucket}` plus outcome. Planning prefers edges with
a selector; replay resolves it on the live tree (resource-id → text →
contentDescription) and taps the LIVE centre; the bounds bucket is used only when
no selector exists. An edge whose selector cannot be resolved is **not taken** (it
diverges). Weight stays `1/(successes+1)` per `(from H_id, selector)` pair.

## navigate-to correctness (phase D §3) — why O5 routed 0/55

`navigate-to` now routes **only when the destination `H_id` is unambiguous** and
verifies arrival by `H_id` equality. This is what produced the two outcomes above:

- **15 no-route** — `ambiguous target: 2 screens index this selector`. The
  destination selector resolves to two `H_id` nodes, so the router refuses rather
  than guess. Correct, but it means no route is offered.
- **40 diverged-after-tap** — a unique route of length 1 was planned and its edge
  tapped, but the arrival `H_id` did not equal the target, so the route diverged
  and fell back. The stored edges are still the C.4 bucket/coordinate edges for
  most root→sub transitions; replaying one lands on an arbitrary sibling whose
  `H_id` no longer collapses onto the target (H_id now SEPARATES the siblings that
  `H` merged), so arrival verification correctly rejects it.

The net effect: `H_id` fixed the **collision** (siblings are now distinct nodes,
proven by test (b)/(b')), which in turn exposed that the **existing edges do not
carry a resolvable selector to the right sibling** — so unambiguous routing has
almost nothing valid to route on yet. The follow-up is to re-record the graph with
selector-carrying edges (the machinery landed and is unit-tested) so the router
has resolvable edges between the now-distinct `H_id` nodes; this run's store
predates that. No harness workaround was applied.

## Root-hash instability — the field list

Routing keys on `H_id`, which is immune to all of these; the list documents what
moves the **structural `H`** (so `stable(H)` / any `H`-based match must tolerate
them). Fields and their `H_id` treatment:

| Field moving `H` | Source | In `H_id`? |
|---|---|---|
| Quantized bounds bucket crossing | `quant` = 1/32 of each dim (`ScreenHash.kt` `quant`; host `quant`) | **No** — `H_id` carries no bounds |
| `FLAG_FOCUSED` (bit 5) | `flagsOf` | **No** — `H_id` carries no flags |
| Scrolling-container first-child class sequence | recycler rule (`appendStructural` / `isScrollingContainer`) | **No** — `H_id` stores `class#resourceId` only, never child sequence |
| Node insertion/removal / DFS order | structural DFS string | **No** — `H_id` uses an order-free resource-id multiset |
| Text / contentDescription | only in `H_text`; identity titles in `H_id` | Only identity-node titles, with volatile text dropped |

## Superseded C.4 numbers (from run 33806639520)

The C.4 tables in the prior version of this doc are withdrawn. Two changes drive
every supersession: (1) this is a **new run** (33947160117); (2) phase D changed
the accounting to the full-100 denominator and re-recorded routing under
unambiguous-only `navigate-to`.

| C.4 published number | Why superseded |
|---|---|
| Per-config success on a `scored` denominator (B1 100 % of 99, O5 99 % of 87) | The denominator was chosen by the outcome (review C4-H1/H2). Phase D fixes it at 100 for every config; new values: B1 98, B2 99, O1 98, O2 99, O3 99, O4 97, O5 62. |
| O5 success 99 % [94,100] / 86-87 | The 13 post-navigation locate-fails were excluded, not failed. Under exclusions-as-failures and unambiguous routing, O5 is **62/100 = 62 %** this run. |
| navFb `40/42` (over scored steps) | Counted after the exclusion skip (review C4-H3). Now counted over ALL 55 attempts: 40 diverged, 15 no-route, 55/55 fallbacks. |
| O5-pure `2/42` routed | Under unambiguous-only routing + `H_id`-verified arrival, **0/55** routed this run. |
| navMisland `0` published as fact / mislands `10` | This run genuinely has **0 mis-lands** (arrival verification by `H_id` rejects the wrong sibling before it can count as a mis-land); the C4-H3 accounting bug is not the reason here. |
| H4 "PASS — none inferior" | Circular for O5 (shared-pair intersection, C4-H2). Phase D's paired cluster bootstrap on the full denominator shows **O5 inferior** (−36 pp vs B1, −37 pp vs B2); O1–O4 non-inferior. |
| H1 = 0.285× | Run-dependent; this run measures O1/B2 = 138/627 = **0.220×** (still PASS, still needle-independent). |
| "the from-side Jaccard fix works" | `fromVia` was `exact` 55/55, so the Jaccard path never ran (review C4-M1); withdrawn again. The from-side is not O5's failure — the edges are. |
| "the root did NOT drift" | Two root hashes for one screen (77a189ce / 299378e0) IS drift under `H` (review C4-M2). `H_id` now merges them (test (a)); the `H`-based claim is withdrawn. |

## Acceptance check (ticket §4)

| Criterion | Status |
|---|---|
| O5-pure covers ≥ 30 known-target taps | **FAIL — 0/55 routed** (store evidence above; reported, no workaround) |
| mis-land count reported and ≤ 2 | **PASS — 0 mis-lands** |
| O5 success within the cluster-bootstrap interval of B1 | **FAIL — O5 62 % [41,82] vs B1 98 % [95,100]; −36 pp, CI entirely below 0** |
| results doc regenerated from JSON | **PASS** (this doc; reproduces the artifact `results-ci.md`) |
| H1–H4 restated with corrected accounting | **PASS** (H1/H2/H3 PASS/FAIL/PASS; H4 O1–O4 non-inferior, O5 inferior) |
| `H_id` unit tests pass | **PASS** (30/30) |
| branches pushed; run URL in the report | **PASS** (`feat/screen-graph-d` @ 139bec51a, `feat/bench-ci-d` @ 77cd4b9a; run 33947160117) |

O5 routing did not reach acceptance. Per the ticket, the store evidence is
reported and no harness workaround was applied: `H_id` correctly separated the
siblings `H` had collapsed, which exposed that the existing bucket/coordinate
edges cannot resolve to the right sibling under unambiguous-only routing. The
selector-carrying-edge machinery is landed and unit-tested; a re-recorded graph is
the concrete next step.
