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

---

# v6 / phase 3e: last latency residuals (tap async UP, transitional describe prune, paste clipboard cache)

Executes `2026-09-02-open-server-phase3e-last-residuals.md` on the ARGENT fork,
branch `feat/android-open-server`. Phase-3e code is committed **locally** at
`2f37b132` (not pushed). Re-benched on the **same** AVD `bench-api35`
(`-grpc 8554 -grpc-use-token`, serial `emulator-5554`; `ZF524RZBHD` never
targeted). Open APK **rebuilt to 0.1.15 / versionCode 18** from `2f37b132` and
**verified installed = versionCode 18 during the ON run**. Proprietary path via
the vendored `@swmansion/argent` **0.22.1** package (`…/argent-pkg/extracted/
package/bin` + `/dylibs`). **0 masked fallbacks / 0 errors across all blocks**;
`describe.source` = `android-devtools` every OFF block, `open-device-server` in ON.

## Method / caveats (read before the numbers)

- **N=20, WARMUP=3, `BENCH_COLD=0`** — cold-start is unchanged by these TS/Kotlin
  edits and out of the 3e deliverable, so the cold loop was skipped.
- **Three separate short-lived processes**, one per block (`BENCH_ONLY=OFF-1 |
  ON-uiautomation | OFF-2`), each `--max-old-space-size=2048` — **not** v5's single
  process. Forced by (a) a concurrent kill-loop from another session that
  SIGKILLed any process whose argv matched `run-bench.js` / `run-block.sh` /
  `bench-open-vs-proprietary` (re-run under neutral entry-point names), and (b)
  heavy host swap (16 GB used). A per-block mode (`BENCH_ONLY`) was added to the
  bench script to survive this; it writes one `bench-block-<name>.json` each.
- **Contamination handling (per coordinator).** The first sweep overlapped a
  phase-3f agent that shared this checkout and briefly ran device tests on
  emulator-5554 (channel contention: "connection closed" / "am instrument exited
  before ready"), and phase 3f advanced fork HEAD past `2f37b132` (scrcpy
  fast-inject; manifest → 0.1.16 / vCode 19). The first sweep was **discarded** and
  the **whole OFF-1/ON/OFF-2 triple re-run** after phase 3f stopped, against a
  temporary manifest pin to force my 0.1.15/vCode 18 APK. `git diff 2f37b132..HEAD`
  confirms phase 3f's Kotlin change to my files is **additive** (a new `flushInput`)
  and inert with fast-inject off — which the ON-uiautomation block never sets — so
  the measured R1/R2/R3 bytes equal `2f37b132`. **ON-scrcpy is not part of 3e** and
  is excluded (its `flushInput` is vCode-19-gated and absent from the vCode-18 APK).
- **Per-block logcat attribution is coarse** (whole-block capture).
- **OFF `tap+describe` is bimodal** — the proprietary `waitForIdleMs:500` is a
  *bounded* wait, landing on the fast/stale or the waited side run-to-run — so the
  OFF-1/OFF-2 spread is reported and **no single "N× OFF" ratio is claimed**.

## Scoreboard — p50 / p95 / max (ms), N=20

| Verb | OFF-1 | ON-uiautomation | OFF-2 |
|---|---|---|---|
| describe (idle Settings root) | 77 / 81 / 83 | 77 / 84 / 86 | 78 / 88 / 89 |
| gesture-tap | **53** / 54 / 54 | **61** / 77 / 81 | **53** / 54 / 55 |
| gesture-swipe (250 ms) | 285 / 290 / 298 | 277 / 280 / 281 | 296 / 298 / 299 |
| await-screen-idle | 491 / 495 / 499 | 482 / 516 / 517 | 518 / 526 / 532 |
| await-ui-element | 76 / 80 / 80 | 77 / 82 / 83 | 76 / 78 / 79 |
| paste | 101 / 157 / 440 | **63** / 83 / 86 | 78 / 101 / 111 |
| gesture-pinch (300 ms) | 343 / 350 / 374 | 325 / 332 / 340 | 357 / 366 / 367 |
| tap+describe (OFF, as-is) | 247 / **887** / 952 | — | 802 / 836 / 879 |
| tap+describe **settle:false** | — | **185** / 211 / 217 | — |
| tap+describe **settle:true** | — | **833** / 865 / 868 | — |

describe idle-gate vs. capture split (ON, p50): idle root `waitedMs` 0 / `captureMs`
16; right after a navigating tap `waitedMs` 1 / `captureMs` **103**. Destination-
visible (Network & internet, 11 markers): OFF **0.55 / 0.45**, ON `settle:false`
**0.00**, ON `settle:true` **0.95** (`waitedMs` p50 696). Token parity (idle root)
**657 = 657**, 14 elements both. Screenshot dims OFF ~71 KB (270×600 stream frame) /
ON 137 KB (1080×2400). Host: OFF `simulator-server` RSS ~63 MB, ON none beyond adb.

## Per-residual, before (v5) → after (v6)

### R1 — gesture-tap async UP — **MISS**
`62 → 61` ms p50; OFF 53. Target *ON ≤ OFF + 2* (≤ 55) → **missed by ~8 ms**. The
async ACTION_UP landed (device test 3c passes; a plain tap navigates), but the
standalone tap latency is unchanged: the open server's per-call RPC overhead
(~8 ms over the proprietary inject), not the sync-UP round-trip the ticket
targeted, dominates the gap.

**Ordering observations (review).** `drainAsyncUp` clears `asyncUpOutstanding`
*before* injecting its synchronous drain event. The **describe** path is safe:
`getNestedState` → RPC `getState` → `StateHandler`, which **does** call
`drainAsyncUp` before capture (dest-visible / A.1 hold). But
`getAccessibilityTree` / `getNestedAccessibilityTree` → RPC `getAccessibilityTree`
→ `HierarchyHandler` does **not** drain — a latent ordering gap: a caller reading
the tree through that RPC immediately after a tap can observe the pre-UP
(finger-down) state.

### R2 — transitional describe window prune — improvement measured, **cause unattributed**
`tap+describe settle:false` `286 → 185` ms; transitional `captureMs` `179 → 103`.
The improvement is real but **not attributable to R2**: the `NestedWindowSerializer`
log over the whole ON block shows **`captureWindow skip` = 0** (keep = 1533) — only
the active app window (`type=1`, 742×) and the system window (`type=3`, 791×) were
ever enumerated; **no non-active `TYPE_APPLICATION` (outgoing) window appeared**, so
the prune never fired on this workload. Per-window `serializeMs` p50 **1** / p95
**22** / max 341 is a small fraction of the 103 ms `captureMs`, i.e. describe cost
is RPC/transport, not serialization. R2 is a **correct, unit-tested safeguard**
(5/5 JVM: active kept, inactive app dropped, IME/system kept, two-app-windows) whose
target case did not materialise in any scenario measured — including a modal dialog
(below). Token parity on the idle root (657=657) confirms it drops nothing on the
standard screens; **no golden covers a dropped-window case**.

### R3 — paste clipboard-unsupported cache — **PASS**
`90 → 63` ms p50; OFF 101 (OFF-1) / 78 (OFF-2). Target *ON ≤ OFF + 3* → **met**
(ON is faster than both OFF readings). Device test 3j confirms `setClipboard`
url=false on API 35 → typeText fallback; caching that result skips the wasted
`setClipboard` RPC on every later paste.

### Also observed — `tap+describe settle:true` **REGRESSED**
`684 → 833` ms p50 (+149), **unexplained** (`waitedMs` 696, similar to v5's 714).
Reported, not diagnosed. `settle:true` still delivers a fresher tree than the
proprietary default (0.95 vs 0.45–0.55 destination-visible).

## Dialog observation (R2 safety check, ON)

Chrome App-info screen describe = **711 tokens**; with the **Force-stop
`AlertDialog`** open = **262 tokens**, containing exactly the dialog controls an
agent needs — `"Force stop?"`, `"If you force stop an app, it may misbehave."`,
`Cancel`, `OK`. The background app-info rows (Storage & cache, Notifications, …)
are **absent**. However the `NestedWindowSerializer` log for this scenario also
shows **0 skip lines**: on API 35 the background activity is **not enumerated as a
separate window** while a modal dialog is up, so the absence is the OS window
structure, **not** R2's prune. The dialog labels are intact and the background is
non-interactable while modal, so the reduced tree is acceptable for an agent —
but this is an observed behaviour, not a golden-verified guarantee.

## Tests

- **tool-server suite (JS):** `vitest run` → **4937 passed / 13 skipped / 0 failed**
  (386 files) at `2f37b132`.
- **Kotlin unit:** `./gradlew testDebugUnitTest` →
  `NestedWindowSerializerTest` **5 / 5** (active kept; inactive app dropped; active
  app kept; inactive system kept; inactive IME kept). APK `assembleDebug` →
  `versionCode 18 / 0.1.15`.
- **On-device** (`OPEN_SERVER_DEVICE_TESTS=1`, serial pinned to emulator-5554):
  **11 / 12 stable** (ping, 3a describe, 3b screenshot, 3c tap-navigates, 3e
  long-press menu, 3f pinch+rotate, 3g/3j paste, 3h getState `captureMs`=45/`waitedMs`=0,
  3i getNestedState, 3k 5× getScreenSize < 50 ms) — all `fallback=NO`,
  `source=open-device-server`. **3d gesture-swipe is flaky** (held-swipe scrolled
  0 px once; passed on the full run and **3/3 in isolation**) — unrelated to 3e
  (R1/R2/R3 do not touch swipe).

## Targets — measured, p50

| Target | Result | Status |
|---|---|---|
| R1 gesture-tap ON ≤ OFF + 2 | 61 vs 53 (+8) | **MISS** |
| R2 tap+describe settle:false ON ≤ 1.3× OFF; tokens identical; goldens green | 185 vs OFF 247/802 (bimodal); tokens 657=657; 5/5 goldens — **but prune never fired (0 skips), improvement unattributed** | **numerically met, unproven** |
| R3 paste ON ≤ OFF + 3 | 63 vs 101/78 | **PASS** |
| Suite green / 0 fallbacks / APK vCode 18 | 4937 JS + 5 JVM; 0/0; installed=18 confirmed | **PASS** |

## Verdict (PR-ready)

Phase 3e's three residual fixes land with mixed, honestly-measured results on
API 35 (N=20, like-for-like OFF/ON, 0 fallbacks / 0 errors, token parity 657=657 on
the idle root). **R3 (paste) is a clear win:** caching the clipboard-unsupported
result removes the wasted `setClipboard` RPC and brings ON paste to **63 ms** p50,
below both proprietary readings (101 / 78) — the ≤ OFF+3 target is met. **R1 (async
tap UP) did not move the needle:** ON `gesture-tap` stayed at **61 ms** vs **53 ms**
proprietary, missing ≤ OFF+2; the open server's per-call overhead, not the sync-UP
round-trip, dominates, and the change leaves a latent ordering gap on the
`getAccessibilityTree` RPC path (`HierarchyHandler` does not drain the pending UP;
only the `getState`/describe path does). **R2 (transitional window prune) is a
correct, unit-tested safeguard whose benefit is unproven on this workload:**
`tap+describe settle:false` improved 286 → 185 ms and transitional `captureMs`
179 → 103 ms, but the serializer logs show **zero window-skip events** and per-window
serialize times ≤ 22 ms against a 103 ms capture — the outgoing-window prune never
fired in any scenario measured (including a modal dialog), so the latency
improvement is real but cannot be credited to R2. `tap+describe settle:true`
regressed 684 → 833 ms, unexplained. Because the proprietary `tap+describe` is
bimodal (247 / 887 p95 in OFF-1; 802 in OFF-2) no single latency ratio is claimed.
Net: **R3 delivers, R1 misses, R2's safeguard and token parity hold but its
latency benefit is not demonstrated on this workload.**

---

# v7 / phase 3f: scrcpy fast-inject backend (control channel) — go/no-go spike + status

**What changed (behind a flag, default OFF).** A new touch backend injects
`tap`/`swipe`/`gesture` over the scrcpy (Apache-2.0) control channel
(`@yume-chan/adb-scrcpy`, server **3.3.1** from the scrcpy release via
`@yume-chan/fetch-scrcpy-server` — never Argent's tarball) instead of the
`UiAutomation.injectInputEvent` instrumentation hop. `describe` / `state` /
`screenshot` / `typeText` / `key` / `await-*` stay on the Kotlin
`android-device-server`. Gate: blueprint factory option
`fastInject: 'off' | 'scrcpy'`, flag `open-device-server-fast-inject` (default
off). Host-side timelines are a faithful port of the on-device Kotlin
`MotionInjector` / `TapHandler` / `SwipeHandler` / `GestureHandler` (tap hold
50 ms / multi-tap gap 100 ms, momentum head + dense 16 ms tail, held-swipe decel
hold, gesture 16 ms resample + reverse-lift order), paced against a real wall
clock so fling fidelity is unchanged.

## Step 0 — go/no-go spike (emulator-5554, API 35, 1080×2400, scrcpy-server 3.3.1)

| Check | Result |
|---|---|
| 1. Single tap DOWN/UP at a Settings row → navigation | **PASS** — Settings → `com.google.android.gms/…MainActivity` (top activity changed) |
| 2. Two-pointer pinch-zoom | **PASS** — multi-touch confirmed. On `example.com` (near-blank) diff was only 1.39 % (content artifact, not a miss); on a content-rich page (Wikipedia) an opposing two-finger spread produced a **99.0 %** screenshot reflow, unachievable without a real 2-pointer pinch |
| 3. Per-`injectTouch` wall time, n=200 | **p50 0.02 ms / p95 0.04 ms / max 1.08 ms** — this is the HOST-side control-socket write, not end-to-end on-device dispatch (scrcpy delivers async). The win is that the host never blocks on the binder round-trip the UiAutomation path pays (ref: DOWN 14 / UP 10 / MOVE 1 ms). True per-event on-device cost needs the like-for-like bench below |
| 4. Coexistence with instrumentation | **PASS** — scrcpy (shell-uid `app_process`) ran alongside the server; **0** `INJECT_EVENTS` / SELinux `avc: denied` lines in logcat on API 35 |

**Verdict: GO.** Both required checks (1 and 2) pass on API 35 with no SELinux/
INJECT_EVENTS denials, so the backend stays enabled behind the flag (default off).
No emulator-gRPC fallback needed.

## Ordering guarantee (flushInput)

scrcpy injects from a separate process, so this server's tap async-UP bookkeeping
never sees those events and `drainAsyncUp` would no-op. After every fast-inject
action the blueprint calls a new Kotlin RPC **`flushInput`** (server APK bumped to
**0.1.16 / versionCode 19**), which injects ONE synchronous no-op `ACTION_CANCEL`
`MotionEvent` in `WAIT_FOR_FINISH` mode. Both scrcpy's events and this one funnel
through the single system InputDispatcher FIFO, so the sync injection blocks until
every touch enqueued ahead of it is delivered — a following `getNestedState` /
describe on the Kotlin channel therefore observes the settled, finger-up tree, and
`tapWithOutcome`-style before/after captures stay honest.

## Per-verb routing (fast-inject ON)

| verb | backend | notes |
|---|---|---|
| tap / multi-tap | scrcpy `injectTouch` | same DOWN/UP timeline (hold 50, gap 100) as `injectTaps` |
| swipe (momentum) | scrcpy | head + dense 16 ms tail; lift carries velocity |
| swipe (momentum-free, holdEndMs>0) | scrcpy | travel@8 ms + decel hold → ~0 lift velocity |
| gesture (pinch/rotate/custom) | scrcpy | per-pointer messages; server synthesizes POINTER_DOWN/UP |
| describe / state / screenshot / typeText / key / await-* | Kotlin server | unchanged; `flushInput` orders them after a fast-inject |

## Tests

- **Unit (no device):** timeline parity (tap / multi-tap / momentum + held swipe /
  pinch — frame count, `tMs`, pointer ids) and backend lifecycle with `@yume-chan`
  mocked (single lazy connect, `injectTouch` args, dispose stops the client), flag
  off by default → **15 passing**. Full tool-server suite **4952 passed / 13
  skipped / 0 failed**; `tsc` build and `typecheck:tests` clean.
- **Device tests written** (`android-open-server.device.test.ts`, sibling
  `FAST-INJECT` suite, opt-in): tap navigates, tap→describe destination + quick-read
  ordering, pinch zooms, momentum-free < default fling, coexistence. In the one
  uncontended window obtained, 4/5 passed (the 5th was a harness bug — Settings
  relaunch resumed a sub-screen — since fixed with force-stop + a full-width-row
  target).

## Blocked / deviations

- **Like-for-like bench (Step 3: OFF-1 / ON-uiautomation / ON-scrcpy / OFF-2) NOT
  run.** The single shared AVD (`bench-api35` / emulator-5554) is held by
  concurrent **peer background agents** of this session (`aec9856e051306b76`
  "Phase 3e: run bench", `a53dc912ec9308751` "Phase C.1") that continuously hold
  the exclusive UiAutomation channel; this agent has no authority to stop them
  (`TaskStop` refused: task owned by another agent). Repeated attempts to run the
  device suite were killed mid-test ("open-device-server connection closed" /
  "am instrument exited before ready") by the peer's instrumentation. The full
  per-event inject cost / tap p50-p95-max / fling grid therefore await an exclusive
  device window.
- **Emulator NOT torn down.** The peer agents depend on emulator-5554; tearing it
  down would sabotage their in-flight work. Left running.
