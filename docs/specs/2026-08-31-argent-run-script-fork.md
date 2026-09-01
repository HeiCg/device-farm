# Spec: `run-script` tool in argent fork + fork-vs-upstream benchmark + upstream PR

Date: 2026-08-31 · Owner: heicg (GitHub: HeiCg) · Fork: https://github.com/HeiCg/argent
Upstream: software-mansion/argent @ main (base SHA b835de2326b2c396c010402b2a8f59613e23b462, v0.22.1)
Prior evidence: `device-stream/benchmarks/token-bench/results/RESULTS.md` (7 configs live, Android)

## Goal

Implement an agent-authored script tool (`run-script`) in the argent fork, idiomatic to
their codebase, working on **Android and iOS simulator**; benchmark fork vs upstream on
both platforms; organize results; open a **draft PR** upstream with the numbers.

Everything below is derived from two deep research passes over the argent source
(file:line refs verified at the base SHA). Implementors re-verify refs before editing.

---

## Part A — `run-script` tool (fork implementor)

Work in a fresh clone of the fork: `git clone git@github.com:HeiCg/argent.git` into the
session scratchpad, branch `feat/run-script` off `main`. Conventional commits
(`feat(tool-server): …`); commits ALLOWED in this clone (it's the fork), push at the end.

### A0. Design decisions (fixed — do not relitigate)

- **Script language: JavaScript** (async function body), NOT TypeScript. No transpiler
  dependency: their published package is esbuild-bundled with `engines.node >= 20.12`
  (no native type-stripping), and a prod transpiler dep is a likely rejection. Typing
  for authoring comes from documentation (skill + docs page carry the full `.d.ts` of
  the injected API; the tool description points there).
- **Execution: `node:vm`** context containing ONLY the injected `ui` facade, `console`
  (capped collector), and standard globals — no `require`, no `import`, no
  `process`/`fs`. This is an API boundary, not a security boundary; say so honestly in
  docs. The script is wrapped as `(async (ui, console) => { <body> })()`.
- **Feature flag `run-script`, default OFF** (entry in
  `packages/configuration-core/src/flags.ts` `FLAG_REGISTRY:31-71`). Opt-in via
  `argent enable run-script`. This is the RCE-objection mitigation: same class as
  agent-driven local execution the host already permits, but explicitly opt-in.
- **No telemetry of script content** — `Telemetry.md:7` promises "no tool inputs";
  only the generic per-tool success/error/duration events apply. Do not add fields.

### A1. Tool anatomy (follow the `shake` commit b1abdec file-set + `run-sequence` factory shape)

```
packages/tool-server/src/tools/run-script/
  index.ts     createRunScriptTool(registry): ToolDefinition  (factory, needs Registry)
  api.ts       buildUiFacade(env): the injected `ui` object
  runtime.ts   vm setup, console capture, timeout/abort plumbing, error rendering
  schema.ts    zod input schema
  types.ts
```

- `ToolDefinition` contract: `packages/registry/src/types.ts:182-265`. Required:
  `id: "run-script"`, `interaction.{startedMsg,completedMsg,failedMsg}` (all three —
  `test/interaction-messages.test.ts:20-27` fails otherwise), `description`,
  `zodSchema`, `outputHint`, `longRunning: true` (MCP fetch-timeout +
  idle-shutdown: `argent-mcp/src/mcp-server.ts:221`, `http.ts:805`),
  `featureFlag: "run-script"`, `capability` mirroring `run-sequence/index.ts:72-81`
  (apple simulator + android; NOT chromium in v1), `services: () => ({})` (lazy,
  `run-sequence/index.ts:161`), `execute(services, params, ctx)` honoring `ctx.signal`.
- Input schema: `{ udid: string, script: string, timeout_ms?: number (default 120000,
  max 600000) }`. `udid` MUST be top-level (auto-capture device lookup,
  `auto-capture.ts:119-129`). NO combinators at schema top level
  (`test/tool-input-schema-contract.test.ts:24-40`); any cross-field rule via
  `.refine()` + one description sentence.
- Registration: `packages/tool-server/src/utils/setup-registry.ts` (+import,
  +`registry.registerTool(createRunScriptTool(registry))`);
  `test/helpers/catalog.ts:6` `EXPECTED_TOOL_COUNT` 77 → 78.
- Failure codes in `packages/registry/src/failure-codes.ts`:
  `RUN_SCRIPT_SYNTAX_ERROR`, `RUN_SCRIPT_THREW`, `RUN_SCRIPT_TIMEOUT`,
  `RUN_SCRIPT_STEP_FAILED` (a facade call's underlying tool failed). Each with
  recovery guidance text in the argent style.
- Auto-capture: add `"run-script"` to BOTH sets in
  `packages/argent-mcp/src/auto-capture.ts` (`AUTO_SCREENSHOT_TOOLS:8-25`,
  `AUTO_DESCRIBE_TOOLS:66-79`) + a delay entry (mirror `run-sequence: 15000`,
  `:33-50`) + cover in `packages/argent-mcp/test/auto-capture.test.ts`. One capture at
  the end = same amortization as run-sequence.
- Description (SpiderShield CI scores ≥9.0 — `.github/workflows/tool-description-quality.yml`):
  action verb + scenario trigger + `Returns {...}` + `Fails if ...` + explicit
  disambiguation: vs `run-sequence` ("steps known in advance, no logic") and vs
  `flow-execute` ("replaying an authored .yaml flow") — run-script is for
  **exploratory multi-step interaction with conditionals, loops and waits, in one
  call**. State plainly that it executes agent-authored JavaScript locally in the
  tool-server process and is disabled unless the `run-script` flag is enabled.

### A2. The `ui` facade (api.ts) — built ONLY on existing engine pieces

Base plumbing: `invokeSubTool` (`tool-server/src/utils/sub-invoke.ts:21-46`) for
anything that is already a tool; `ui-tree-match.ts` for selectors
(`selectorSchema:59`, `findAll:426`, `isVisible:478`, `evaluateCondition:504`,
`selectorToFrame:650`, `treeFingerprint:546`, `fetchTree:721`);
`DescribeNode`/`getDescribeTapPoint` (`tools/describe/contract.ts:12-37,103-108`).
Selector type: `{ text?, identifier?, role? }` — document that `role` values differ
per platform (Android class-derived vs iOS AX*) and `text`/`identifier` are the
portable fields.

| method | behavior |
|---|---|
| `ui.describe(): Promise<DescribeNode>` | `fetchTree` for the udid (platform-dispatched exactly as `await-ui-element/index.ts:333-339` does) |
| `ui.find(sel)` / `ui.findAll(sel)` | over a fresh tree; `find` returns node or null |
| `ui.exists(sel)` / `ui.visible(sel)` | boolean, no throw — enables in-script branching |
| `ui.tap(sel)` | settle (two equal `treeFingerprint` reads, bounded ~2s) → `selectorToFrame` → `invokeSubTool("gesture-tap", center)` → post-verify: one re-describe confirming the screen fingerprint changed OR the target satisfied; throw `RUN_SCRIPT_STEP_FAILED` detail on no-effect (guards argent issue #547: iOS tap is fire-and-forget) |
| `ui.tapPoint(x,y)` | raw normalized tap (escape hatch, no verify) |
| `ui.fill(sel, text, {mode?})` | tap field → focus settle (~500ms + bounded poll, port of `flow-actions.ts:1487-1521`) → `keyboard {text}`; `mode:'paste'` uses the `paste` tool (recommended on iOS — issue #774 shift-state bug) |
| `ui.pressKey(key)` / `ui.button(name)` | `keyboard {key}` / `button` tool (per-platform button sets differ — surface the tool's own error) |
| `ui.swipe(from,to,opts)` | `gesture-swipe`, `momentum:false` default |
| `ui.scrollUntilVisible(sel, {maxScrolls=10, direction})` | port of the flow `scroll-to` loop (`flow-actions.ts:750-803`): swipe + fingerprint end-of-scroll detection |
| `ui.await(condition, sel, {timeoutMs, expectedText?, textMatch?})` | reuse `await-ui-element` via `invokeSubTool` (conditions exists/visible/hidden/text; keep their `cause: unmet|unreadable` semantics in errors) |
| `ui.awaitIdle(opts)` | `await-screen-idle` via sub-invoke |
| `ui.launchApp(bundleId)` / `ui.openUrl(url)` | sub-invoke |
| `ui.sleep(ms)` | `sleepOrAbort` (`utils/timing.ts:6-19`) wired to `ctx.signal` |

Every facade call: checks `ctx.signal.aborted` first; sub-tool failures rethrow with
the step name. NO screenshot method in v1 (auto-capture covers the end state; keeps
the surface lean).

### A3. runtime.ts

- Overall deadline = `timeout_ms`: `AbortController` chained to `ctx.signal`;
  `Promise.race` with the script; on timeout → `RUN_SCRIPT_TIMEOUT` (the facade's
  signal checks make in-flight sub-tools cancel).
- `console.log/warn/error` collected, combined cap 4000 chars tail-truncated.
- Syntax errors (vm compile) → `RUN_SCRIPT_SYNTAX_ERROR` with the vm's message.
- Thrown errors → `RUN_SCRIPT_THREW`: name + message + top 3 stack frames with the
  vm filename rendered as `<script>`.
- Result: `{ completed: true, logs, steps: <count of facade calls> }`; on failure the
  same shape with `completed:false` + failure detail. Text-rendered like other tools.

### A4. Docs/skill/knip gates

- `packages/skills/skills/argent-device-interact/SKILL.md`: add the run-script
  section, including the authoring reference — the full typed signature of `ui` (as a
  `.d.ts` block) and 2 worked examples (one with branching + await, one with
  scrollUntilVisible + fill). Note flag opt-in. Keep additions tight; skill CI scores
  description quality on new skills only, but keep the register consistent.
- `rules/argent.md`: one short mention in the interaction guidance.
- `packages/docs/docs/reference/tools.mdx:55` table: add the row.
- `knip --max-issues 0` on the unbuilt tree: no unused exports.

### A5. Tests (vitest, `packages/tool-server/test/run-script.test.ts` + registry stub per `run-sequence.test.ts:8-29`)

- schema: valid/invalid inputs; no top-level combinators (contract test picks this up).
- runtime: happy path (fake registry counts sub-invocations), branching script
  (`ui.exists` false path), syntax error, thrown error (frame cap, `<script>` name),
  timeout (fake sub-tool that never resolves → aborted), console cap, signal
  cancellation between steps.
- facade: tap settle + post-verify (fingerprint unchanged → STEP_FAILED), fill focus
  poll, scrollUntilVisible end-of-scroll stop, selector ranking delegated to
  `selectorToFrame` (spy).
- auto-capture membership test updated.
- Run: `tsc --build`, `npm run typecheck:tests`? (use their scripts), `npm test -w
  @argent/tool-server`, `npm test -w @argent/mcp`, knip. ALL green before push.

### A6. Push

Push `feat/run-script` to the fork (origin = HeiCg/argent). Do NOT open the PR (Part D
does, after benchmarks). Report the branch head SHA.

---

## Part B — benchmark extension (bench implementor; can start after Part A pushes)

Extend `device-stream/benchmarks/token-bench/` (device-farm repo, uncommitted tree).
New configs, same Layer-1 method, same counter (tiktoken o200k_base unless
ANTHROPIC_API_KEY appears):

| id | server | platform | flow |
|---|---|---|---|
| F1 | fork (feat/run-script), flag enabled | Android emulator-5554 | 1 orientation describe + 1 `run-script` call with the 10-step scenario as a JS script |
| F2 | fork | iOS simulator | same shape, iOS scenario |
| A1-ios | upstream argent defaults | iOS simulator | 10-step iOS scenario via tool-per-call |
| A4-ios | upstream `run-sequence` | iOS simulator | best-case amortization |

- Fork server runs from the fork clone build; upstream from the existing vendor clone.
  Never simultaneously against the same device.
- iOS scenario: **Settings app of the simulator** (analogous 10 steps: launch, orient,
  navigate a section, back, search if available or second navigation, toggle a switch,
  assert transition, home). CRITICAL environment facts (from research):
  - Boot the simulator via argent's `boot-device` tool, NEVER `simctl boot` (AX prefs
    must be written pre-boot or describe comes back blind). Sims available: iOS 26.4
    (`QA-iPhone17`, `QA-iPhoneSE`, both Shutdown). Xcode 26.4, Darwin 25.6 — argent
    issue #932 does not apply here.
  - `com.apple.*` is not flow-injectable, but describe (ax-service) +
    `await-ui-element` + coordinate taps work — and our `run-script` facade path uses
    describe+selector→coordinate, so Settings is fine for F2. If A4-ios (run-sequence)
    cannot express a needed step on Settings, record it as the limitation it is.
  - Text input on iOS: prefer `paste` (issue #774). Verify taps landed (issue #547) —
    the F2 script's `ui.tap` already post-verifies; for A1-ios add the describe checks
    the adapter table requires anyway.
  - simulator-server/ax-service binaries: already extracted from the published npm
    0.22.1 into the vendor clone; copy the same into the fork clone's
    `packages/argent/bin|assets` (they are gitignored there — verify; never commit
    binaries).
- Android: emulator `bench-api35` should be running (restart per
  `benchmarks/token-bench/run.md` if not; android-server instrumentation needed only
  for B/C configs, NOT for A/F configs — stop it during argent runs per run.md).
  Physical device ZF524RZBHD: never target.
- Update RESULTS.md: one table per platform, all configs, plus the cross-platform
  summary table. Keep zero-prose-conclusions rule. Add fork branch SHA alongside
  upstream SHA.
- Harness code additions live in `harness/` with the same fixture-tested pure-function
  discipline (`npx vitest run` green).

## Part C — results organization (same bench implementor, end of Part B)

Generate `results/SUMMARY.md` (this one MAY contain interpretation — it feeds the PR
body): side-by-side Android + iOS tables, the multipliers (fork run-script vs A1 and
vs A4 per platform), per-step cost profile, method one-paragraph, caveats (approximate
counter, single scenario, simulator/emulator only, C2-style miss-recovery number if
measured). Honest numbers; no rounding games.

## Part D — the PR (planner + user)

After Parts A-C: the planner (main session) drafts the PR body in Markdown
(motivation, design decisions incl. flag-off default and JS-not-TS rationale,
benchmark tables from SUMMARY.md, precedent citations: their PR #958 measurement
culture, run-sequence PR #396 moving decision loops server-side, test/CI gates all
green), user reviews, then `gh pr create --draft --repo software-mansion/argent
--head HeiCg:feat/run-script`. NOT done by implementors.

## Sequencing

Part A first (single implementor). Part B/C second (single implementor, needs A's
branch). Part D last (planner + user approval on the body).
