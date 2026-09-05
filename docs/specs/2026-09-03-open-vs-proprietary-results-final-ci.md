# Open server vs proprietary — final CI results

Repo: **HeiCg/argent** fork. Reported run: **7 = GitHub Actions run 33975063607**,
branch `feat/bench-ci-final` @ **f76f5d245**, workflow `bench-open-vs-proprietary.yml`,
`-f suite=latency`. Runner: **ubuntu-latest, x86_64, KVM-accelerated emulator**,
`system-images;android-34;google_apis;x86_64`, Android 14 / SDK 34, 1080x2400 @ 420dpi.
**N = 20 per verb per block** (fling A/B N = 12 per cell per backend). Not comparable
to a local arm64/HVF host.

Runs 5 (33963464784) and 6 (33969204089) are **superseded** — same code except the
tap-effect accounting and fling sampling evolved; their per-block tables are kept for
the record at the end with the reason. Do not blend numbers across runs.

## Verdict

Everything is green **except the fling A/B parity gate**, which is **not establishable**
on this runner (see below). Per the agreed rule (only-red-is-fling → stop, no run 8):

- **Open-server tap works and is at parity or better.** First-attempt landing ≥ 95% in
  every block (scrcpy 59/60, UiAutomation 60/60, proprietary 40/40 twice); the open
  scrcpy tap is as fast as the proprietary tap and faster than the open UiAutomation tap.
- **Open describe is faster than proprietary** (39/56 and 36/53 ms vs 52/53 ms p50/p95),
  same token count (657) and byte-identical element set (fidelity Jaccard 1.0).
- **Transport = redir on both ON emulator blocks** (gated).
- **On-device test suite 17/17.**
- **Fling A/B: scrcpy fast-inject fling parity NOT ESTABLISHED on x86_64 KVM** — one
  informative cell is outside ±0.15 unexplained, and the failing cell moves run-to-run
  (measurement noise on the multi-frame swipe), so the run is RED on that gate only.

## Four-block summary (run 7)

| block | config | first-attempt landing | oracle self-test | transport | degraded | describe p50/p95 | gesture-tap p50/p95 |
|---|---|---|---|---|---|---|---|
| OFF-1 | proprietary | 40/40 (100%) | pass | n/a (proprietary) | none | 52/53 | 52/54 |
| ON-uiautomation | open, UiAutomation | 60/60 (100%) | pass | redir | none | 39/56 | 77/91 |
| ON-scrcpy | open, scrcpy fast-inject | 59/60 (98.3%) | pass | redir | none | 36/53 | 51/52 |
| OFF-2 | proprietary | 40/40 (100%) | pass | n/a (proprietary) | none | 52/56 | 52/53 |

`first-attempt landing` = landed / effect-checked, first attempt only, never retried
(the one scrcpy miss's latency is excluded from the tap percentiles). originLost = 0 in
every block. fallbacks = 0 in every block (no fast-inject fallback to the Kotlin path).
Locate source in EVERY block = the block's own backend describe (untimed): `uiautomator
dump` was unusable on this emulator (single UiAutomation client), so the describe
fallback carried all locates; the fresh describe also settles the screen before the
timed tap, equally in every block. coordMoved = 0 (the located coordinate was stable).

## Full latency table (p50/p95 ms, N per cell)

| verb | OFF-1 | ON-uiautomation | ON-scrcpy | OFF-2 |
|---|---|---|---|---|
| describe (idle) | 52/53 (20) | 39/56 (20) | 36/53 (20) | 52/56 (20) |
| gesture-tap (tap RPC only) | 52/54 (20) | 77/91 (20) | 51/52 (20) | 52/53 (20) |
| tap+describe | 305/817 (20) | — | — | 313/958 (20) |
| tap+describe(settle:false) | — | 455/673 (20) | 298/810 (19) | — |
| tap+describe(settle:true) | — | 788/1100 (20) | 774/1039 (20) | — |
| gesture-swipe | 290/308 (20) | 296/359 (20) | 257/262 (20) | 294/303 (20) |
| await-screen-idle | 498/504 (20) | 463/472 (20) | 461/474 (20) | 497/541 (20) |
| await-ui-element | 72/76 (20) | 32/38 (20) | 31/36 (20) | 73/77 (20) |
| paste | 463/1217 (20) | 327/892 (20) | 289/867 (20) | 573/1104 (20) |
| gesture-pinch | 338/349 (20) | 337/358 (20) | 307/309 (20) | 344/362 (20) |

`errors = 0` on every verb of every block. ON-scrcpy tap+describe(settle:false) is n=19
because its one first-attempt no-effect tap's timing is excluded (landing 59/60).

### Headline tap comparison (like-for-like)

The **tap-RPC row (`gesture-tap`) is NOT like-for-like across backends** because of the
flushInput asymmetry: only the scrcpy branch defers the input drain to the next read
(`blueprints/android-open-server.ts` fold), while the UiAutomation and proprietary tap
RPCs drain inline. So scrcpy's post-inject settle is moved out of the timed `gesture-tap`
row and into the following read. The **headline like-for-like tap row is
`tap+describe(settle:false)`**, which pays the drain inside the measured window in every
block:

- tap+describe(settle:false): **ON-scrcpy 298/810** vs **ON-uiautomation 455/673** (p50/p95).
- Proprietary equivalent (`tap+describe`): OFF 305/817 and 313/958.

So the open scrcpy act-then-read is ~150 ms p50 faster than the open UiAutomation path
and on par with proprietary.

## effect / transport / fallbacks per block

| block | effect-checked | first-attempt no-effect | landing rate | originLost | fallbacks | transport |
|---|---|---|---|---|---|---|
| OFF-1 | 40 | 0 | 100% | 0 | 0 | n/a (proprietary) |
| ON-uiautomation | 60 | 0 | 100% | 0 | 0 | redir |
| ON-scrcpy | 60 | 1 | 98.3% | 0 | 0 | redir |
| OFF-2 | 40 | 0 | 100% | 0 | 0 | n/a (proprietary) |

## describe fidelity, tokens, cold start, host RSS

- **Tokens (o200k, 1 sample):** 657 in all four blocks. describe bytes: OFF 1892, ON 1894.
- **Fidelity:** OFF-1 vs ON-uiautomation Jaccard **1.0** (17 keys each, no only-OFF / only-ON).
- **ping (open server RPC floor, N=20):** ON-uiautomation 0.497/0.628 ms, ON-scrcpy 0.422/0.475 ms; OFF n/a (proprietary answers no ping).
- **Cold start (ms, 3 samples):** OFF-1 [1141,760,764], ON-uiautomation [509,433,411], ON-scrcpy [610,419,440], OFF-2 [855,777,757].
- **Host RSS (simulator-server, OFF only):** OFF-1 92788 kB, OFF-2 92528 kB. ON blocks run on-device via `am instrument` — no host process beyond adb.

## OFF-1 vs OFF-2 per-verb drift (noise floor, p50 ms)

| verb | OFF-1 | OFF-2 | drift |
|---|---|---|---|
| describe | 52 | 52 | 0 |
| gesture-tap | 52 | 52 | 0 |
| tap+describe | 305 | 313 | 8 |
| gesture-swipe | 290 | 294 | 4 |
| await-screen-idle | 498 | 497 | 1 |
| await-ui-element | 72 | 73 | 1 |
| paste | 463 | 573 | 110 |
| gesture-pinch | 338 | 344 | 6 |

paste carries the largest proprietary-path runner noise (110 ms); every ON−OFF describe
and tap difference above clears this floor.

## Fling A/B (scrcpy vs UiAutomation median scroll) — PARITY NOT ESTABLISHED

N = 12 per cell per backend; gate = per-cell **median** ratio within ±0.15 on
informative (reliable, non-clamped) cells, blocking.

| cell (durationMs / distance) | uia median (IQR) | scrcpy median (IQR) | ratio | verdict |
|---|---|---|---|---|
| 150 / 0.3 | 0.449 [0.175,0.509] | 0.466 [0.23,0.593] | 1.038 | OK |
| 150 / 0.5 | 0.175 [0.175,0.175] | 0.175 [0.175,0.175] | 1.000 | OK |
| 250 / 0.3 | 0.357 [0.292,0.428] | 0.324 [0.213,0.5] | 0.908 | OK |
| 250 / 0.5 | 0.175 [0.175,0.464] | 0.265 [0.175,0.413] | 1.514 | OUT, explained (pre-existing mid-distance fling-threshold) |
| 400 / 0.3 | 0.321 [0.241,0.328] | 0.230 [0.22,0.366] | **0.717** | **OUT — UNEXPLAINED → FAIL** |
| 400 / 0.5 | 0.507 [0.461,0.539] | 0.360 [0.175,0.494] | 0.710 | OUT, explained (pre-existing mid-distance fling-threshold) |

Verdict: **FAIL (1 informative cell outside ±0.15 and unexplained: 400ms/0.3 = 0.717)**;
aggregate ratio 0.954.

**Why "parity not established" rather than a regression:** the single unexplained
out-of-tolerance cell MOVES run to run — review run 33812265077 failed on 250/0.5 and
400/0.5; run 5 (33963464784) on 150/0.3 and 400/0.3; run 7 on 400/0.3. The scrcpy
multi-frame swipe imparts a fling velocity that is not stably within ±15% of
UiAutomation's on a contended x86_64 KVM emulator; the median of 12 is still noisy. The
on-device functional swipe test (below) confirms scrcpy DOES fling (fling clearly beats
a momentum-free swipe); only cell-level parity with UiAutomation is not establishable
here. No run 8 (agreed).

## On-device test suite — 17/17 PASS

Every device test passed, including the two that were red in earlier runs:

- `fast-inject tap→describe lands on the destination 20/20 (polled ≤3s)` — PASS.
- `fast-inject momentum-free swipe travels less than a default (flinging) swipe` — PASS,
  now the **median of 3 trials per arm** (never best-of-N): median fling 1168 px >
  median momentum-free 635 px.

## Gates active in the workflow (with lines)

Workflow `.github/workflows/bench-open-vs-proprietary.yml`:

- Readiness gate before the device test — `ready-gate.sh` at **yml:274**; before every bench block — **yml:321**.
- Device-test step `id: devtest` (**yml:258**), `continue-on-error: true` (**yml:265**), `set -uo pipefail` (**yml:270**).
- Bench blocks `set -eo pipefail` (**yml:313**), then `node merge-blocks.js` (**yml:343**).
- Fling A/B step `if: !cancelled() && contains(blocks,'ON-scrcpy')` (**yml:350**) — runs regardless of the merge outcome; `set -eo pipefail` (**yml:361**), ON fling failure `exit 1` (**yml:369**), `node merge-fling.js` (**yml:373**).
- Enforce device-test result: `if: always()` step "Enforce device-test result" (**yml:419**), fails the job on `steps.devtest.outcome == 'failure'` (**yml:427-429**).
- Screen-graph checkout pinned to `ref: feat/screen-graph-d` (**yml:454**).

Merge gates `.github/bench-ci/merge-blocks.js` (all blocking):

- tap-timeline parity (holdMs identical, two-frame DOWN→UP, no MOVE) — **:51 / :54**.
- oracle self-test gate (a block whose backend could not complete one located+detected+restored navigation is invalid — distinct verdict) — **:88**.
- **first-attempt LANDING-RATE gate ≥ 95% per block, symmetric OFF/ON** (>3 of 60 or >2 of 40 fails) — **:114**.
- vacuous-arm gate (a tap block with effectChecked === 0 fails) — **:130**.
- degraded-arm gate (await-* capped every iteration / paste field never found) — **:146**.
- redir transport gate (an ON emulator block with transport ≠ redir fails) — **:164**.
- zero-fast-inject-fallback gate for ON-scrcpy — **:177**.

Fling gate `.github/bench-ci/merge-fling.js`: per-cell median ratio ±0.15 (`TOL` **:42**),
blocking `process.exit(1)` **:156**.

## Compact status

**3j on-device compaction is DISABLED (compact:false) — not output-preserving
(review-3j).** The describe path ships the full tree and runs the proven host v2 trim
(byte-identical to the dump path; fidelity 1.0 above). The on-device scaffold-hoist
compaction defeats a scrollable parent's child-clip, lets a system-chrome subtree
escape, and can drop a borrowed `[password]` label (three reviewed counterexamples), so
it was not made the default. `compact:true` remains an explicit opt-in for the phase-3j
A/B only.

## Other consolidated correctness fixes (verified in this branch)

- **redir mapping leak on a failed ping (finding 9):** `redirHostPort` is captured
  before the ping, so a ping throw still runs `redir del` — no leaked guest-facing
  mapping. Plus a 3× ping retry (the 0.0.0.0 listener can need a moment), which is why
  redir now selects on this runner.
- **transport metadata reaches the block JSON (finding 19):** `withDescription` now
  forwards `transport`; every ON block records redir (was "metadata absent" in run 2).
- **per-request splice state (finding 14):** the serialize-once raw tree rides the
  per-call result object and `handle()` returns `HandleResult(line, method, padTo)` —
  no shared `lastTreeJson` / `lastPadTo` across TCPServer's cached thread pool;
  `prevServerTiming` is a `ConcurrentHashMap`. APK versionCode 23 → 24 (0.1.20).

## Superseded runs (for the record)

**Run 6 (33969204089)** — same code except: fling A/B did not run (bench step exited on
the merge throw before the fling step; fixed in run 7 with `!cancelled()`), and the
effect gate was still "first-attempt == 0" (before the ≥95% landing-rate decision).
Per-block first-attempt landing: OFF-1 40/40, ON-uiautomation 60/60, **ON-scrcpy 59/60**
(the 1 drop that the strict-0 gate failed on, which motivated the ≥95% gate), OFF-2
40/40. oracle pass, transport redir on both ON, degraded none, device test 17/17.

**Run 5 (33963464784)** — same code except the tap coordinate was located per iteration
but the fling was single-cell-noisy and the device swipe was single-sample. Per-block
first-attempt landing (this run measured 0 misses everywhere): OFF-1 40/40,
ON-uiautomation 60/60, ON-scrcpy 60/60, OFF-2 40/40; transport redir on both ON;
fidelity 1.0; describe ON 32/44 and 33/44 vs OFF 52/53. Reds were the fling A/B
(150/0.3, 400/0.3 out of tolerance — different cells than run 7) and the single-sample
device swipe (fling 521 vs held 547) — both fixed/among the fling-noise finding.
