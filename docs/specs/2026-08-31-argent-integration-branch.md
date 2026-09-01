# Spec: fork integration branch + full-fork benchmark config

Date: 2026-08-31 · Fork: HeiCg/argent

## Part 1 — `integration/device-stream` branch

Merge, in order, onto a new branch off `main` (a2ed83e0):
1. `feat/run-script` @ ced349b
2. `feat/rich-selectors` @ ef8e2d6
3. `feat/android-system-verbs` @ b086e16
4. `feat/android-open-server` @ 9eceb91

Use real `git merge` (no squash) so the branch stays re-derivable from the four PR
branches. Expected conflict zones (all mechanical): `test/helpers/catalog.ts`
`EXPECTED_TOOL_COUNT` (final = main's count +1 run-script +3 verbs = 81),
`setup-registry.ts` imports/registrations, `failure-codes.ts` blocks,
`configuration-core/src/flags.ts` (two new flags), `docs/reference/tools.mdx` rows,
`argent-device-interact/SKILL.md` sections, `auto-capture.ts` sets.

Semantic integration points (verify, small commits on the integration branch if
needed — do NOT rewrite the four source branches):
- run-script's `ui` facade should now benefit from rich selectors automatically if
  it delegates to `ui-tree-match` matchers — verify `ui.tap({text: {contains:
  'Batt', caseInsensitive: true}})` type-checks and works; if the facade's selector
  type is narrower, widen it on the integration branch.
- run-script + open-device-server: with the flag on, facade taps route through the
  open server (they go via invokeSubTool → gesture-tap, which P3 rerouted — should
  be free; verify).
- Both feature flags (`run-script`, `open-device-server`) stay default OFF.

Gates on the merged result (all green before push): `tsc --build`,
typecheck:tests, tool-server + mcp + registry + configuration-core suites, knip,
`test:scripts`. Then push `integration/device-stream`.

## Part 2 — benchmark config FX (after Part 1 pushes)

Extend `device-stream/benchmarks/token-bench/` (device-farm repo, no commits):
- **FX** (Android + iOS): integration branch, flags `run-script` AND
  `open-device-server` enabled (open server affects Android only), same 10-step
  scenarios as F1/F2, one orientation describe + one run-script call — but the
  script may now use rich selectors (e.g. `contains`/`caseInsensitive`) where the
  scenario labels allow; keep the step semantics identical to F1/F2 for
  comparability.
- Record: fixed context (the richer await-ui-element description and 3 new tools
  change `tools/list` — measure, don't assume), flowAdded, billedCached/Uncached,
  round-trips; plus Android describe source label proving the open server was the
  hierarchy backend, and the measured describe size vs the uiautomator-path number.
- Update RESULTS.md (FX rows in both platform tables) + SUMMARY.md (fork-integrated
  vs upstream multipliers). Same honesty rules; tiktoken fallback counter.
- Emulator: boot AVD `bench-api35` if not running; physical ZF524RZBHD never.
  iOS: boot via argent boot-device (AX prefs), same caveats as F2 (#547 tap
  verification, paste for text).
