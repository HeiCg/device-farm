# Results v4: open-device-server phase 3c — remove hidden UiAutomator idle gates

Executes `2026-09-02-open-server-phase3c-idle-gates.md`: remove the implicit
`UiDevice` idle gates the phase-3b honest re-bench (`…-results-v3.md`) exposed as
the real cost behind the `gesture-pinch` (806 ms) and `tap+describe` (1394 ms)
regressions, collapse describe to one RPC with a comparator-matched idle cap, and
trim the nested serializer payload — then re-bench like-for-like.

Checkout: ARGENT FORK `argent-p3c-wt` (an isolated `git worktree` off
`feat/android-open-server @ 3113010b` — see **Deviations**), open server rebuilt to
**versionCode 16 / versionName 0.1.14**. Commit is local, not pushed.

## Root cause (confirmed on-device)

Decompiled uiautomator 2.3.0: several `UiDevice` getters call `waitForIdle()`
implicitly = `UiAutomation.waitForIdle(500 quiescence, 10 s cap)` —
`getDisplayRotation()` and `getCurrentPackageName()` do; `getDisplayWidth/Height`
do not. The open path hit these on **every gesture** (the `getScreenSize` peek that
converts normalized→pixel coordinates read `displayRotation`) and twice more in
`getInfo`, and the describe path waited `2000 ms` where the proprietary comparator
caps at `500`. The multi-pointer injector itself was already correct (one
MotionEvent/frame, real-clock pacing, ~22 events for a 300 ms pinch).

The on-device measurement run that preceded this ticket (temporary instrumentation,
separate checkout) isolated the split and is corroborated by v4's own
`waitedMs/captureMs` numbers below:

- **pinch**: per-event `injectInputEvent` is cheap (2-pointer MOVE p50 ~1 ms, DOWN
  p50 ~14 ms with occasional 400 ms stalls, sync UP p50 ~10 ms); a pinch driven
  straight through the blueprint API ran 312–329 ms wall for a 300 ms authored
  gesture (Σinject 29–50 ms). v3's 806/1029 ms `gesture-pinch` was therefore almost
  entirely the `getScreenSize`→`displayRotation`→implicit `waitForIdle` **absorbing
  the previous iteration's zoom-settle animation**, not injection.
- **tap+describe**: ~690 ms of the ~839 ms was `waitForIdle` on the in-flight
  navigation; serialization ~128 ms (97 ms of it on a transient non-active window);
  JSON build ~1 ms; an idle-screen describe was 11–83 ms.

## What changed since v3 (the five fixes)

- **F1 idle-free rotation/package reads.** New `util/DisplayReader.kt` reads real
  size **and** rotation from one platform `Display`
  (`DisplayManager.getDisplay(DEFAULT_DISPLAY)` → `getRealMetrics` + `display.rotation`),
  never a `UiDevice` getter. `InfoHandler.screenSize()`/`execute()` and
  `StateHandler.execute()` now read geometry from it and take the current package
  from `rootInActiveWindow.packageName` (captured before recycle; window-list
  fallback), never `uiDevice.currentPackageName`. Doc comments corrected in
  `InfoHandler.kt` and `blueprints/android-open-server.ts` (`getScreenSize`) to state
  the truth and the rule: *never call a `UiDevice` getter that triggers `waitForIdle`
  on a hot path*.
- **F2 describe = one RPC, comparator-matched cap.** The describe open path
  (`tools/describe/platforms/android/index.ts`) replaced the fake
  `Promise.all([getNestedAccessibilityTree, getInfo])` with a single
  `getNestedState({ waitTimeoutMs: 500 })` (the shape `open-server-describe.ts`
  already uses). The await-* poll paths keep their current (default) timeout. The
  server's `waitedMs/captureMs` now ride the describe **result metadata** (never the
  rendered text) so the idle-vs-capture split is measurable.
- **F3 client serialization documented.** `android-open-server-client.ts` already
  serialises all requests on one chain (the device server is single-thread per
  connection); the doc now states plainly that `Promise.all` over it does **not**
  overlap, so no caller may rely on parallelism. Confirmed no caller does.
- **F4 serializer payload trim.** `NodeSerializer.serializeNested` emits only true
  booleans and non-empty strings, and `enabled` **only when false** (its notable
  state, matching `uiautomator dump`). Host `nestedToParsed` already defaulted a
  missing boolean to false / missing `class` to "" / missing `enabled` to true, so
  the trimmed wire payload lowers to a byte-identical DescribeNode — proven by the
  golden tests (F14) staying green.
- **F5 bench fairness.** `gesture-pinch` now gets the same untimed per-iteration
  reset the other gestures get (an untimed pinch-out to minimum zoom + untimed
  `await-screen-idle`), and measures a consistent zoom-in. Swipe/pinch durations
  come from a shared `BENCH_GESTURE_PARAMS`; `main()` asserts every block ran
  identical `holdMs`/`durationMs` (`assertIdenticalGestureParams`).

### Removed implicit-idle call sites (fix-1 grep across the whole server)

| Site | Was | Now |
|---|---|---|
| `InfoHandler.screenSize()` (gesture hot path) | `uiDevice.displayRotation` | `DisplayReader` (Display) |
| `InfoHandler.execute()` | `uiDevice.currentPackageName`, `uiDevice.displayRotation` | `rootInActiveWindow.packageName`, `DisplayReader` |
| `StateHandler.execute()` (describe/await/state) | `uiDevice.currentPackageName`, `uiDevice.displayRotation` | `rootInActiveWindow.packageName` (captured pre-recycle; window-list fallback), `DisplayReader` |

**Reviewed and left (explicit, caller-controlled — not hidden getter gates):**
`uiDevice.waitForIdle(timeout)` in `StateHandler` / `HierarchyHandler` / `WaitHandler`
(the describe/await settle; describe now passes 500 via F2); `uiDevice.swipe(...)` in
`LongPressHandler` (a gesture, but `uiDevice.swipe` is not one of the implicit-idle
getters the ticket enumerates — `uiDevice.click` was, and was already replaced by
`MotionInjector` in phase 3b). Grep for `currentPackageName` / `displayRotation` /
`currentActivityName` / `uiDevice.click` / `UiObject2` / `.wait(` shows **no
remaining callers on tap/swipe/gesture/describe/state paths** (matches are comments).

## Environment

| Item | Value |
|---|---|
| Host | macOS (Darwin 25.6.0), Apple Silicon |
| Emulator | AVD `bench-api35`, Android 15 (API 35), arm64-v8a, 1080×2400 @ 420 dpi, `-no-window -no-audio -no-boot-anim -grpc 8554 -grpc-use-token` |
| Serial | `emulator-5554` (all adb calls `-s emulator-5554`); booted only after `emulator-5554` cleared |
| Physical device | `ZF524RZBHD` — **never targeted** (bench refuses any non-`emulator-` serial and this deny-serial; tests pin `OPEN_SERVER_DEVICE_SERIAL=emulator-5554`) |
| Proprietary binaries | vendored `@swmansion/argent` package (`bin/argent-android-devtools-0.1.0.apk`, `bin/darwin/simulator-server`, `dylibs/`) via the `ARGENT_*` env vars |
| Open server | Kotlin `@argent/android-device-server` rebuilt to versionCode 16 (`gradlew assembleDebug`, APK 1.22 MB); old server uninstalled before install |
| Token estimator | js-tiktoken `o200k_base` (primary) + chars/4 (secondary) |
| Path confirmation | `describe.source` = `android-devtools` every OFF block, `open-device-server` every ON block; **0 masked fallbacks**, 0 errors across 480 calls |

## Latency per verb — p50 / p95 / max (ms)

Blocks OFF-1 → ON → OFF-2, N=20 after 3 warm-ups, flag toggled per block. Every
tap/swipe/pinch iteration resets to a known state first (untimed). All cells
**0 errors, 0 fallbacks**.

| Verb | OFF-1 (prop) | **ON (open)** | OFF-2 (prop) | verdict (like-for-like) |
|---|---|---|---|---|
| describe (Settings root) | 77 / 87 / 571 | 80 / 89 / 90 | 77 / 81 / 81 | ≈ equal |
| gesture-tap | 54 / 54 / 56 | **62 / 78 / 80** | 54 / 56 / 62 | ON slower **+8 ms** (real 50 ms hold + UiAutomation inject) |
| tap+describe | 145 / 347 / 664 | **689 / 727 / 1014** | 139 / 347 / 681 | **ON ~4.85×** — idle-gate-bound, see split below |
| gesture-swipe (250 ms) | 298 / 301 / 302 | **278 / 281 / 288** | 296 / 302 / 303 | ON slightly faster |
| await-screen-idle | 515 / 524 / 804 | 478 / 526 / 527 | 515 / 528 / 650 | ≈ equal (ON p50 lower) |
| await-ui-element | 76 / 80 / 81 | 76 / 82 / 86 | 76 / 82 / 84 | **≈ equal** (was +7 ms in v3) |
| paste | 82 / 100 / 141 | 89 / 110 / 137 | 80 / 110 / 141 | ON slower ~+7 ms (clipboard attempt then type) |
| gesture-pinch (300 ms) | 355 / 362 / 365 | **329 / 341 / 345** | 356 / 365 / 384 | **ON faster (0.93×)** — was 806 ms in v3 |

Screenshot has no latency row (different frame sizes): OFF 270×600 / 69 KB stream
frame vs ON 1080×2400 / 135 KB full capture — dims only, as in v3.

**Drift.** OFF-1 vs OFF-2 p50 within ±3 ms on every verb except `tap+describe`
(145 vs 139 p50, but a navigation-dependent verb; its p95 341/347 brackets tightly).

## describe idle-gate vs. capture split (waitedMs / captureMs, p50)

Surfaced from `StateHandler` through the describe result metadata (open path only;
the proprietary path reports no split — `n=0`).

| Scenario | waitedMs p50 | captureMs p50 | n |
|---|---|---|---|
| describe, idle Settings root | **0** | **15** | 10 |
| describe right after a tap (tap+describe) | **519** | **12** | 10 |

This is the headline correction to v3's diagnosis. v3 attributed `tap+describe`'s ~2×
to "full-tree serialization + host trim ~2× the compressed dump." With the single
RPC (F2) and the payload trim (F4), **serialization is now 12 ms** — it is *not* the
residual. The residual is the **idle gate**: after a tap into a navigating screen the
open describe waits out the in-flight animation up to its 500 ms cap (measured
waited p50 519 ms ≈ cap + overhead), while the proprietary `android-devtools`
`getHierarchy` reads immediately without an idle wait (~142 ms) — so the open path
trades ~500 ms for a settled tree. Pruning would not help (capture is already
12 ms). On an idle screen the two are ≈ equal (ON 80 vs OFF 77) because waited ≈ 0.

## describe output size — Settings root

| Metric | OFF (android-devtools) | ON (open-device-server) |
|---|---|---|
| bytes | 1892 | 1894 |
| tokens — o200k_base | **657** | **657** |
| tokens — chars/4 | 473 | 473 |
| rendered elements | 14 | 14 |

Token-identical on o200k_base (657/657) after the payload trim (F4).

## Fidelity — Settings root

| Metric | Value |
|---|---|
| raw Jaccard OFF vs ON (`resource-id \| text`) | **1.000** |
| labels/ids only in OFF / only in ON | 0 / 0 |

## Cold start / host process

Cold spawn→first-describe (3/block): OFF-1 [982,769,785], ON [884,751,767], OFF-2
[827,754,729] — ON cold start not worse. Host RSS: OFF keeps a **~62 MB
`simulator-server`** per device (63504 / 63232 KB); ON has **0 host process** beyond
adb (runs on-device via `am instrument`) — the open path's structural advantage,
unchanged.

## Targets — measured, like-for-like, p50

| Target | Result | Status |
|---|---|---|
| gesture-pinch ON ≤ 1.1× OFF (~340 vs 340) | ON 329 vs OFF ~355 = **0.93×** | **PASS** |
| tap+describe ON ≤ 1.2× OFF (~800 vs 700) | ON 689 vs OFF ~142 = **4.85×**; residual is the idle gate (waited 519 @ 500 cap), **not** serialization (capture 12) | **MISS — reported with numbers, not prunable** |
| gesture-tap ON ≤ OFF + 5 ms | ON 62 vs OFF 54 = **+8 ms** | **MARGINAL MISS (+3 over)** |
| describe tokens identical (o200k) both screens; goldens green | 657 = 657, Jaccard 1.0; golden tests green | **PASS** |
| 0 fallbacks; suite green; APK builds | 0/0 over 480 calls; 4930 passed; APK 0.1.14 built | **PASS** |

The two misses are both **honest, isolated costs**, not masked fallbacks:

- **gesture-tap +8 ms** is the real 50 ms press hold (enforced on both backends
  since phase-3b F1) plus UiAutomation's per-event injection, which the proprietary
  native input channel does not pay. 3 ms over the +5 ms target.
- **tap+describe 4.85×** is the idle gate, now measured cleanly (waited 519 vs
  capture 12). The open describe settles the post-tap screen (up to the 500 ms
  comparator cap); the proprietary describe reads immediately. Lowering the cap
  further or reading without waiting would close the gap but change the
  settled-vs-immediate tradeoff — out of this ticket's scope. Serialization, the
  cost this ticket could and did attack (F4), is now negligible.

Everything v3 flagged as a real regression improved markedly: **gesture-pinch
806→329 ms** (now beats OFF), **tap+describe 1394→689 ms** (serialization
12 ms), **await-ui-element** back to ≈ equal, `gesture-swipe` / `await-screen-idle`
now slightly faster on ON.

## Tests

- **tool-server suite:** `vitest run` → **4930 passed / 13 skipped / 0 failed**
  (386 files). New/updated: `open-server-await-getstate` (describe issues exactly one
  `getNestedState({ waitTimeoutMs: 500 })`, never the two-call path; waited/capture
  surface as metadata, not rendered), `open-server-tree` (serializer-omitted flags
  parse as false / omitted `enabled` = enabled / `enabled:false` = disabled; trimmed
  ≡ verbose DescribeNode), `bench-gesture-parity` (parity assertion present + throws
  on drift), and the golden trim tests unchanged and green.
- **type-check:** `tsc --noEmit` (package) and `typecheck:scripts` both clean.
- **device test:** `OPEN_SERVER_DEVICE_TESTS=1 … vitest run …android-open-server.device.test.ts`
  → **12/12 passed**, `fallback=NO` on every verb. Includes the new
  **3k getScreenSize during a running fling**: 5 consecutive calls = **[7, 6, 2, 2, 2] ms**
  (worst 7 ms < 50) — direct proof the idle gate is gone (before F1 this stalled
  hundreds of ms on the fling). `3h getState` on idle: `waitedMs=0, captureMs=27`
  (with screenshot).
- **APK:** `gradlew assembleDebug` → BUILD SUCCESSFUL, `argent-device-control-0.1.14.apk`
  (versionCode 16, 1.22 MB).

## Deviations from the ticket

1. **Isolated worktree.** A concurrent agent held the ticket's checkout with live
   uncommitted `TEMP-INSTRUMENTATION` (a `0.1.13-inj` / vCode 15 build, timing logs in
   `StateHandler`/`MotionInjector`/etc.) and was mid-measurement on the AVD. To avoid
   corrupting its run and mixing its diff into mine, all work was done in a `git
   worktree` off the clean base `3113010b` on branch `feat/android-open-server-p3c`.
   `feat/android-open-server` itself was occupied (git forbids the same branch in two
   worktrees), so the local commit lands on the sibling branch and fast-forwards /
   cherry-picks cleanly onto `feat/android-open-server` once that checkout is clean.
2. **captureMs semantics.** `StateHandler.captureMs` now measures **post-idle**
   capture only (screenshot + tree + info), so `waitedMs` + `captureMs` is a clean
   split; v3's `captureMs` included the wait. No consumer depended on the old value.
3. **ADT-branch `Promise.all` left as-is** (`index.ts` android-devtools path,
   `getHierarchy` + `getScreenSize`): it targets a different service (`AndroidDevtoolsApi`)
   with no single combined RPC, so it is not the same fake-single-RPC pattern — left
   and noted, as the ticket permits. `flow-android-tree.ts` has the same benign
   fake-parallel `getAccessibilityTree` + `getInfo` on the open client; correctness is
   fine (client serialises), out of this ticket's describe scope — noted for a future
   fold into `getState`.
4. **`describe(after-tap)`** was already the `tap+describe` verb, so no new verb was
   added (per the ticket's "if not already").

## Reproduction

```
emulator -avd bench-api35 -no-window -no-audio -no-boot-anim -grpc 8554 -grpc-use-token
bash packages/android-device-server/scripts/build.sh            # open APK, vCode 16
adb -s emulator-5554 uninstall com.argent.devicecontrol         # before installing ours
ARGENT_SIMULATOR_SERVER_DIR=<pkg>/bin \
ARGENT_NATIVE_DEVTOOLS_ANDROID_BIN_DIR=<pkg>/bin \
ARGENT_NATIVE_DEVTOOLS_DIR=<pkg>/dylibs \
ANDROID_HOME=$HOME/Library/Android/sdk BENCH_SERIAL=emulator-5554 node run-bench.js
OPEN_SERVER_DEVICE_TESTS=1 OPEN_SERVER_DEVICE_SERIAL=emulator-5554 \
  npx vitest run packages/tool-server/test/blueprints/android-open-server.device.test.ts
```

The emulator was torn down at the end of the run.

---

# v5 / phase 3d: describe idle-policy parity (tap+describe)

Executes `2026-09-02-open-server-phase3d-describe-idle-policy.md` on the ARGENT
fork, branch `feat/android-open-server @ 9d0a9ccf` (phase 3c). Commit is local, not
pushed. Re-benched on the **same** AVD `bench-api35` (`-grpc 8554 -grpc-use-token`,
serial `emulator-5554`; `ZF524RZBHD` never targeted), N=20, WARMUP=3, blocks
OFF-1 → ON → OFF-2. Open server rebuilt to **0.1.14 / versionCode 16** from the
committed Kotlin (unchanged — the APK was absent in this fresh checkout, rebuilt
identical). Proprietary path via the downloaded vendored binaries. **0 masked
fallbacks / 0 errors across all blocks**; `describe.source` = `android-devtools`
every OFF block, `open-device-server` every ON block.

## What changed (TS-only)

- **`tools/describe/platforms/android/index.ts`** — open branch now defaults to an
  **immediate** read (`getNestedState({ waitTimeoutMs: 0 })`), matching the
  proprietary `android-devtools` `getHierarchy` policy. New `settle?: boolean |
  number` maps to the idle-quiescence window via `settleToWaitTimeoutMs`
  (absent/`false`/0/negative/NaN → 0; `true` → 500; positive number → floor). The
  settled read stays available explicitly. `waitedMs`/`captureMs` still ride the
  result metadata.
- **`tools/describe/index.ts`** — describe tool schema gains `settle` (one-sentence
  doc), threaded to `describeAndroid`.
- **`bench-open-vs-proprietary.ts`** — tap+describe runs both `settle:false`
  (like-for-like) and `settle:true` (our policy) for ON, OFF as-is; new
  destination-visible staleness probe (derives a nav target + destination-only
  markers live, then measures the post-tap destination-visible rate per policy).
- **`open-server-await-getstate.test.ts`** — updated for the new default; added
  settle-policy coverage.
- **`argent-device-interact/SKILL.md`** — states the default matches the
  proprietary path and documents `settle`.
- `await-ui-element` / `await-screen-idle` left untouched (item 4).
- **No Kotlin / APK change.** Verified empirically that `uiDevice.waitForIdle(0)`
  returns immediately: the ON `settle:false` describe reports **`waitedMs` p50 = 0**
  on a freshly-navigated screen (a 0 window short-circuits the idle loop).

## tap+describe triple — p50 / p95 / max (ms), N=20

| Config | tap+describe | note |
|---|---|---|
| OFF-1 (prop, as-is) | **129 / 701 / 704** | bimodal: mostly fast+stale, a ~700 ms tail when it waits out the settle |
| OFF-2 (prop, as-is) | **148 / 677 / 733** | same shape (drift within block) |
| **ON settle:false** (like-for-like) | **286 / 348 / 398** | idle gate gone (`waitedMs` 0); tighter tail |
| **ON settle:true** (our policy) | **684 / 736 / 846** | enforced ~500 ms quiescence (`waitedMs` p50 714) |

### describe idle-gate vs. capture split after a navigating tap (open path, p50)

| Scenario | waitedMs | captureMs | n |
|---|---|---|---|
| ON, idle Settings root | 0 | 18 | 10 |
| ON, right after a tap, `settle:false` (default) | **0** | **179** | 10 |

The idle gate the v4 miss was made of (waited 519 @ the old 500 cap) is **gone** —
`waitedMs` is now 0. The residual in `settle:false` tap+describe is the open path's
nested **multi-window serialization of the transitional tree** (capture ~179 ms
mid-animation, vs ~18 ms on a settled/idle screen and vs the proprietary
`getHierarchy` ~76 ms): reading mid-navigation, the accessibility tree transiently
carries the outgoing + incoming windows, which the nested serializer walks in full.

## Destination-visible (staleness) rates — N=20

After a navigating tap into **"Network & internet"** (nav target + 11
destination-only markers derived live from the device under each flag), does the
*immediate* describe already contain the destination screen's content?

| Policy | destination-visible | rate | `waitedMs` p50 |
|---|---|---|---|
| **OFF** (prop `getHierarchy`, `waitForIdleMs:500`) | 5/20 (OFF-1), 3/20 (OFF-2) | **0.25 / 0.15** | n/a (no split) |
| **ON `settle:false`** (immediate) | 0/20 | **0.00** | 0 |
| **ON `settle:true`** (settled) | 20/20 | **1.00** | 714 |

**Answer to item 2 — what `android-devtools.ts:335 waitForIdleMs:500` does in the
bench path.** It is a **capped/bounded idle wait, not an enforced quiescence**. The
tell is OFF's bimodal latency (p50 129 / p95 ~700) paired with a 15–25 %
destination-visible rate: on most runs the bounded wait expires before this
navigation settles → a fast, **stale** pre-settle tree (75–85 %); on a minority it
waits out the settle → the ~700 ms tail, a fresh tree (15–25 %). So the proprietary
default sits on the *immediate* side of the policy axis — same family as ON
`settle:false` (strict immediate, 0 % fresh) — and well short of ON `settle:true`
(enforced quiescence, 100 % fresh). The two backends differ in **policy**, and the
settled read is the strictly superior product feature (100 % fresh vs the
proprietary 15–25 %), now available explicitly.

## Other verbs (p50 / p95 / max, ms) — unchanged from v4, sanity check

| Verb | OFF-1 | ON | OFF-2 |
|---|---|---|---|
| describe (idle Settings root) | 79 / 86 / 87 | 77 / 81 / 89 | 76 / 78 / 80 |
| gesture-tap | 53 / 54 / 55 | 60 / 65 / 72 | 53 / 55 / 63 |
| gesture-swipe (250 ms) | 296 / 302 / 306 | 277 / 282 / 288 | 298 / 302 / 305 |
| await-screen-idle | 514 / 523 / 528 | 508 / 526 / 1067 | 512 / 525 / 525 |
| await-ui-element | 76 / 80 / 80 | 76 / 80 / 83 | 76 / 85 / 88 |
| paste | 82 / 99 / 101 | 90 / 121 / 166 | 77 / 102 / 103 |
| gesture-pinch (300 ms) | 356 / 379 / 383 | 327 / 344 / 347 | 354 / 360 / 369 |

Idle-root describe ≈ equal (77 vs 79/76). Token parity holds: **657 / 657**
(o200k_base), raw Jaccard **1.000**, 14 elements both. Screenshot dims unchanged
(OFF 270×600 / 69 KB vs ON 1080×2400 / 135 KB). Host RSS: OFF ~62 MB
`simulator-server`, ON 0 host process.

## Targets — measured, p50

| Target | Result | Status |
|---|---|---|
| tap+describe ON(settle:false) ≤ 1.2× OFF | 286 vs ~138 = **~2.07×** | **MISS — reported** |
| ON(settle:true) reported with staleness benefit | 100 % destination-visible (vs OFF 15–25 %, settle:false 0 %); no latency target | **PASS** |
| Token parity / goldens / fallbacks unchanged; suite green; APK unchanged | 657=657, Jaccard 1.0; 0/0 fallbacks/errors; 4934 passed / 13 skipped / 0 failed; APK 0.1.14 vCode 16 (rebuilt identical) | **PASS** |

The 1.2× miss is **honest and isolated, not a masked fallback**: the idle gate this
ticket removed *is* removed (`waitedMs` 0). What remains is the open path's nested
serialization of the **transitional** multi-window tree captured mid-animation
(~179 ms vs the proprietary `getHierarchy` ~76 ms) — a serialization cost on a
busy in-flight screen, outside this ticket's idle-policy scope. Crucially the
comparison is now **policy-matched**: OFF and ON `settle:false` are both immediate
(stale) reads, so the residual is a like-for-like serialization delta, and the
settled read (ON `settle:true`) delivers a strictly fresher tree than the
proprietary default (100 % vs 15–25 %).

## Tests

- **tool-server suite:** `vitest run` → **4934 passed / 13 skipped / 0 failed**
  (386 files). `open-server-await-getstate` updated: default describe now issues one
  `getNestedState({ waitTimeoutMs: 0 })` (never the two-call path); `settle:false`→0,
  `settle:true`→500, `settle:<n>`→n; `settleToWaitTimeoutMs` edge cases
  (absent/false/0/negative/NaN → 0, true → 500, positive → floor).
- **type-check:** `tsc --noEmit` (package `tsconfig.json`) and `typecheck:tests`
  (`tsconfig.test.json`) both clean; the bench script transpiles clean.
- **device (bench):** N=20, 0 fallbacks / 0 errors / 0 masked fallbacks over the
  three blocks; `describe.source` correct per block.

## Deviations

1. **No worktree.** Unlike v4, the ticket's checkout was clean and idle (no
   concurrent agent), so work + the local commit land directly on
   `feat/android-open-server @ 9d0a9ccf`.
2. **`BENCH_COLD=0`.** Cold-start is unchanged by this TS idle-policy change and is
   out of the v5 deliverable (tap+describe triple + staleness), so the cold-spawn
   loop was skipped to shorten the run.
3. **APK rebuilt (identical).** The 0.1.14 / vCode 16 APK was absent in this fresh
   checkout; rebuilt from the committed Kotlin (same versionCode) — so "APK
   unchanged" holds. No Kotlin edit; `waitForIdle(0)`-returns-immediately verified
   empirically (`waitedMs` 0).
4. **await-* fallback reads immediately.** `describeAndroid`'s new default is
   immediate, so the await-* tools' *rare* `describeAndroid` fallback now reads
   immediately per-poll instead of the phase-3c 500 ms settle. Their primary path
   (`describeAndroidViaOpenState`, `getNestedState()` 2000 ms) and poll timeouts are
   untouched (item 4); a per-tick immediate read is the correct behaviour for a
   poll loop.
5. **Staleness target derived live** ("Network & internet", 11 markers) rather than
   hardcoded, so the probe is robust across API levels / Settings layouts.
