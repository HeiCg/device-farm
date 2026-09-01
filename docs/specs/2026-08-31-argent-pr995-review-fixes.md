# Spec: PR #995 review fixes (CodeRabbit findings)

Date: 2026-08-31 · Fork clone: scratchpad/argent-fork, branch `feat/run-script` @ 70a9fc5
PR: https://github.com/software-mansion/argent/pull/995 (draft)

All six findings verified legitimate. Fix all on the same branch, conventional
commits, push (CodeRabbit re-reviews automatically). Keep every existing CI gate
green (EXPECTED_TOOL_COUNT unchanged, formatters, schema contract, knip,
SpiderShield ≥9 if descriptions change).

## F1 (Critical) + F3 (Major): child-process isolation replaces node:vm

Replace the vm execution in `runtime.ts` with a **child Node process**:

- Spawn `node <runner.js>` (a small self-contained runner shipped in the tool's dir;
  mind the esbuild bundling in `packages/argent/scripts/bundle-tools.cjs` — the
  runner must survive bundling: either embed its source as a string and write it to
  a temp file at spawn, or verify the bundler copies it as an asset; pick whichever
  their bundler supports cleanly and prove it via the pack script).
- The script body runs inside the child (plain `AsyncFunction` there is fine — the
  child IS the boundary). `ui` facade inside the child is a stub that forwards each
  call as one JSON line over stdio to the parent; the parent executes the real
  facade (unchanged `api.ts`) and replies. Correlate by id. `console` capture stays
  in the child, capped at write time (also fixes F6), shipped back in the final
  result message.
- Timeout/cancel: parent kills the child on deadline or `ctx.signal` abort —
  `SIGKILL` after a short grace. This now covers synchronous `while(true)` loops
  (F3). Keep the four failure codes; `RUN_SCRIPT_TIMEOUT` message notes the process
  was terminated.
- Child env: minimal (`env: {}` plus what Node needs), cwd = a temp dir, no argv
  passthrough. Document honestly: process isolation, not a jail — but constructor
  escapes now reach a throwaway child with no facade internals, no tool-server
  state, no auth token.
- Update the PR-body claim later (Part "after push" below) and the skill/docs text:
  "runs in a separate disposable Node process; `ui` calls cross an IPC boundary".
- Tests: adapt existing runtime tests (happy, branch, syntax, threw, timeout — now
  asserting child kill —, console cap, signal cancel); add: sync infinite loop
  killed at deadline; constructor-escape probe (`ui.describe.constructor("return
  process")()`) shows no tool-server state (assert it cannot read a sentinel the
  parent holds); stdout flood capped.

## F2 (Major): secret-aware capture skip

- Parent-side facade (`api.ts`): when any `ui.fill`/`keyboard`/`paste` text matches
  the secret-placeholder pattern (reuse the exact matcher from
  `packages/tool-server/src/utils/secrets.ts` / the `containsSecretPlaceholder`
  logic argent-mcp uses), set `secretsUsed: true` on the run result.
- Tool result: include `secretsUsed` in the structured/text output.
- `argent-mcp` auto-capture: skip screenshot AND describe when the tool result
  carries `secretsUsed: true` (keep `run-script` in both sets otherwise — the
  amortization is the feature). If auto-capture currently has no access to result
  content, wire the minimal hook; keep it generic (any tool result could set it).
- Regression test per CodeRabbit: a script that constructs `"{{se" + "cret:X}}"`
  dynamically and passes it through `ui.fill` → capture skipped.

## F4 (Minor): test env isolation

Clear/restore `ARGENT_AUTO_SCREENSHOT_DELAY_MS` around the run-script delay
assertion in `packages/argent-mcp/test/auto-capture.test.ts` (or move it into the
already-scoped describe block).

## F5 (Minor): docs feature page

Add `packages/docs/docs/features/run-script.mdx` (or the naming convention the
sibling feature pages use — copy their structure): what it is, the flag opt-in, the
`ui` API summary, one example, the isolation model, when to use vs run-sequence /
flow-execute. Keep the reference table row consistent. English, terse, no invented
claims.

## F6 (Minor): log cap at record time

Covered by F1's child-side capped console (cap on push, not at the end). If any
parent-side log path remains, cap it there too.

## After push

Report back: new head SHA, how the runner survives the esbuild bundle (evidence:
run their pack script), test/gate outputs, and the exact wording changes needed in
the PR body + skill ("node:vm" → child process) so the planner updates the PR
description. Do NOT edit the PR body yourself; do NOT reply to CodeRabbit comments.
