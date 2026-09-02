# Ticket: Screen-graph Phase C — evaluation harness (cold/warm, tokens/step, RTT)

Design: `2026-09-02-screen-graph-architecture.md` §4; hypotheses H1–H4.
Depends on Phase A + B in the fork worktree `argent-sg` (feat/screen-graph).
Bench baseline script exists: `packages/tool-server/scripts/bench-open-vs-proprietary.ts`
(argent-p3; will be on feat/android-open-server after phase 3 lands —
rebase feat/screen-graph on it first). Emulator `bench-api35` only when
told free; never the physical device `ZF524RZBHD`.

## Configurations
B1 argent proprietary (flag off, vendored 0.22.1 binaries as in the baseline
bench); B2 open server, no graph; O1 open + query/diff observations (agent
asks `query`/`diff` instead of `describe`); O2 O1 + outcomes (no explicit
await/describe after actions when outcome says known/unchanged); O3 O2 +
screen graph cold (empty store); O4 = O3 re-run warm (store persisted from
O3); O5 O4 + `navigate-to` for tasks with a known target.

## Tasks (scripted, deterministic — no LLM in the loop for this phase)
Encode 10 Settings navigation/form tasks + 5 Chrome tasks as step lists
(the same tasks for every config; the "agent" is a scripted policy that
issues the observation calls each config allows and then the next action).
Each task ends with an assertion via `query` (element present) — success
= assertion true.

## Metrics per step and per task
tokens of every observation payload as the agent would see it (render
exactly what the tool returns; count with `js-tiktoken` o200k_base — add as
devDependency in tool-server if absent), RTTs to device, wall time, device
serialization time (from server `getInfo.traversals` delta and timing
fields), success. Report p50/p95 per config, cold vs warm ratio (O3 vs O4),
and per-hypothesis verdict: H1 O1 ≤ 0.5× B2 tokens on unchanged steps; H2
O2 removes ≥1 RTT/step; H3 O4 ≤ 0.2× O3 tokens on revisited screens; H4
success non-inferior.

## Output
`packages/tool-server/scripts/bench-screen-graph.ts` (opt-in), raw JSON
under `.bench-results/screen-graph/`, Markdown report at
`/Users/heicg/Desktop/projects/device-farm/docs/specs/2026-09-02-screen-graph-results.md`
(English, terse, numbers only), commit script locally.

## Acceptance
Report exists with all configs × tasks × ≥3 repetitions; hypotheses table;
emulator torn down.
