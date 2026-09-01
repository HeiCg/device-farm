# Spec: device-stream → argent fork port roadmap (P1-P3)

Date: 2026-08-31 · Fork: HeiCg/argent · Upstream base: a2ed83e0 (main)
Prior: PR #995 (`feat/run-script`, in review). Research: two deep passes recorded in
session; key facts inlined below — implementors re-verify refs.

## Ground rules (all phases)

- Each phase = its own branch off `main` in its own fresh clone of
  `git@github.com:HeiCg/argent.git` (separate scratchpad dirs — three implementors
  run in parallel; do NOT share a clone). Conventional commits; push branch at end;
  do NOT open PRs (planner does, after review).
- Device-stream code is owned by the user — porting is licensing-clean. Port style:
  argent-idiomatic re-implementation informed by our code, not file copying with
  alien conventions. Source of truth for the ported logic:
  `/Users/heicg/Desktop/projects/device-farm/device-stream/` (read-only; NEVER edit
  the device-farm repo).
- Known port-time bug fixes from our own audit (do not port these bugs):
  `clear()` presses `back` 50× (no-op — correct is `KEYCODE_DEL`); `changeTo`
  scans only tree roots instead of the flattened tree; `packageName` selector
  field is dead (no driver populates it — drop it); Android screenshot is JPEG
  (label mime correctly).
- Argent CI gates (each alone fails a PR): `EXPECTED_TOOL_COUNT` in
  `test/helpers/catalog.ts`, 3 interaction formatters per tool, no top-level schema
  combinators, `knip --max-issues 0` (unbuilt tree), SpiderShield description gate —
  currently only **0.013 headroom** on the catalog average (their issue #804), so
  every new/changed description must score high (verb + scenario + Returns + Fails
  if + disambiguation); `tsc --build`, `typecheck:tests`, workspace tests.
- Conflict warning: upstream branch `origin/feat/ios-physical-devices` (95 commits,
  unmerged) touches gesture tools, describe, boot-device, list-devices, flow engine.
  Keep diffs surgical in those areas.

---

## P1 — `feat/rich-selectors`: selector grammar + not-found diagnostics

Target: `packages/tool-server/src/utils/ui-tree-match.ts` (selector engine used by
`await-ui-element`, flows, and #995's run-script) + `await-ui-element`.

1. **StringMatch**: today `text`/`identifier`/`role` are plain strings
   (substring/equality per field, `ui-tree-match.ts:137-140,187-189,205-207`).
   Extend each to `string | { equals?, contains?, regex?, caseInsensitive? }`
   (constraints AND-ed; `caseInsensitive` applies to all three). Plain-string
   behavior MUST stay byte-for-byte identical (it is the entire installed base).
   Schema: extend `selectorSchema` (`:30-64`) WITHOUT top-level combinators on any
   tool schema — nested object field is fine.
2. **`containsDescendant?: Selector`** (recursive) and **`index?: number`**
   (Nth match over pre-order flatten; today `selectorToFrame` picks by
   exact-field-count > area > reading-order, `:650-682` — `index` applies AFTER
   filtering, overriding the ranking only when given).
3. **Not-found diagnostics**: when `await-ui-element` ends `unmet` (and where flows
   report a selector miss), attach near-miss candidates — port our scorer: +2 exact
   field match, +1 case-insensitive/substring near-match, absent fields 0; top 10,
   rendered in the tree's line format; total addition capped ~2000 chars. Pure,
   exported, unit-tested. No extra device round-trip: use the last tree already
   fetched.
4. Update `await-ui-element` description (mind SpiderShield), the
   `argent-device-interact` SKILL.md selector docs, and run-script's `ui` typings
   note if the branch is meant to compose with #995 later (keep P1 standalone —
   no dependency on the run-script branch).
5. Tests: extend the ui-tree-match suite — every new StringMatch form,
   containsDescendant depth, index, near-miss scorer table, plain-string
   regression fixtures (snapshot behavior before refactor, assert identical).

## P2 — `feat/android-system-verbs`: set-location + uninstall-app + third-party install

Three small tools, argent-idiomatic (`ToolDefinition` + `dispatchByPlatform` +
capability + failure codes + docs row + skill mention each):

1. **`set-location`** — nothing exists in argent (verified: zero hits for geo/mock
   location). Android emulator: `adb emu geo fix <lon> <lat>` (our
   `drivers/android.ts` behavior); Android physical: not supported (capability
   `android: { emulator: true }` only); iOS simulator: `xcrun simctl location
   <udid> set <lat>,<lon>`. Schema `{ udid, latitude, longitude }`.
2. **`uninstall-app`** — standalone uninstall is absent (only a side effect inside
   `reinstall-app`; their issues #625/#675 flag the bad-path consequences).
   Android: `adb uninstall <pkg>`; iOS simulator: `simctl uninstall`. Reuse
   `reinstall-app`'s platform plumbing.
3. **`enable-third-party-install`** — Android-only: `appops set <pkg>
   REQUEST_INSTALL_PACKAGES allow` (our `enableInstallByThirdParty`). Capability
   android-only; description explains the sideload-testing scenario.

Each: 3 interaction formatters, failure codes, `EXPECTED_TOOL_COUNT` bump (from
whatever main has in THIS clone — do not assume 77), catalog test, docs
`tools.mdx` rows, per-tool vitest file. SpiderShield: three new descriptions must
each score ≥ 9 — follow the gesture-tap description shape exactly.

## P3 — `feat/android-open-server`: open-source persistent on-device server (flagship)

Port our Kotlin server (`device-stream/native-servers/android-device-server/`,
~1055 lines + the working-tree fixes: pruning fix in `NodeSerializer.kt` — always
recurse, emit-filter — and `waitForIdle` in `HierarchyHandler.kt`; both MUST come
along) into the fork as a new workspace package, following argent's own patterns:

1. **Package** `packages/android-device-server/`: Kotlin/Gradle sources committed
   in-repo (their helper APK precedent is closed-source — being open IS the
   selling point; their iOS runner branch already ships sources in-repo, so
   pattern precedent exists). `assets/manifest.json` version contract like
   `native-devtools-android` (packageName `com.argent.devicecontrol` or similar —
   NOT com.devicestream; instrumentationRunner; versionCode). Lazy local build
   via a `scripts/build.sh`; document Gradle requirement honestly (their helper
   uses raw javac/d8 — if a no-Gradle build of our server is feasible, prefer it;
   otherwise Gradle with committed wrapper).
2. **Port protocol conventions to theirs**: NO fixed :9008 — instrumentation
   prints `INSTRUMENTATION_STATUS: port=<n>`, host does `adb forward tcp:0
   tcp:<n>` (their established handshake); NDJSON framing via their
   `utils/ndjson-socket.ts`; blueprint modeled on
   `blueprints/android-devtools.ts:217-378` (URN, install gate — parameterize
   `utils/android-helper-install.ts` — spawn, ping gate, dispose/shutdown RPC,
   terminated event). Keep our method surface: tap, longPress, swipe, typeText,
   key, screenshot (quality/scale), getAccessibilityTree (maxElements +
   waitForIdle), getInfo, getState, waitForIdle, launchApp, batch.
3. **Consume it** behind feature flag `open-device-server` (default OFF):
   a. `describe` Android: when the flag is on and the server is up, use it as the
      hierarchy source (fixes their one-way helper→dump fallback and the ~40%
      dump flakiness we measured); keep `source:` labeling
      (`"open-device-server"`).
   b. New internal input path: when flag on, gesture-tap/swipe/keyboard MAY route
      through the server instead of the proprietary simulator-server binary —
      implement as an alternative backend selection inside the existing tools
      (NOT new tools), falling back to the current path when the flag is off or
      the server is unavailable. This gives argent a fully open-source Android
      control path for the first time.
4. **Per-device serialization**: single-in-flight per connection (their
   convention) + a device-keyed mutex util for cross-tool serialization (port of
   our DeviceMutexManager, with tests — ours has none; write them here).
5. Failure codes, flag entry, docs feature page, skill mention, knip, catalog (no
   new tool ids unless unavoidable — backend swap, not surface growth).
6. Tests: TS side fully (client framing/correlation/timeout/reconnect — port our
   10 rpc tests; install gate; blueprint lifecycle with fake socket). Kotlin: add
   the basic unit tests ours never had (NodeSerializer pruning, TreeCompressor
   emit-filter) if the build setup allows JVM-side tests cheaply; otherwise
   document the gap.
7. Live verification on emulator-5554 if it is running (boot AVD `bench-api35` if
   not — see token-bench run.md); physical device ZF524RZBHD: NEVER target.

## Out of scope (explicit)

- iOS physical device port (go-ios/WDA): PARKED — upstream has an in-flight
  XCUITest+usbmux branch; decision with the owner.
- grantPermissions port: their `settings-permissions` already exceeds ours.
- Flows YAML, profiler, streaming: excluded.
- Fixing the 12 audited bugs in device-farm itself: separate housekeeping spec.

## Reporting

Each implementor: branch head SHA, file list, gate outputs (real), deviations.
P3 additionally: proof of the describe path live (source label + tree size) and
whether the input rerouting works on the emulator.
