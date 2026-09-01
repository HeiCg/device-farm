# Spec: Token benchmark — tool-per-call vs agent-authored typed script

Date: 2026-08-31 · Owner: heicg · Depends on: `docs/specs/2026-08-31-dsl-token-efficiency.md` (all 5 WS landed, uncommitted)

## Goal

Produce a **reproducible, fair** measurement of the context-token cost of completing
the same 10-step mobile UI flow under three interaction models:

- **A. argent** (software-mansion/argent) MCP tool-per-call, default configuration
- **B. device-stream atomic tools** (`dsl_tap`, `dsl_describe`, …) — controls for
  "MCP tool-per-call" generically, so argent isn't compared against a different
  architecture AND a different implementation at once
- **C. `dsl_run_script`** — one round-trip, agent-authored typed TS script

Output feeds the RFC we will open on argent ("agent-authored typed automation
scripts"), so **fairness > flattering numbers**. Every argent default that helps
them (progressive tool loading, screenshot downscale 0.25, `run-sequence`) must be
represented. If the honest result is smaller than our earlier ~3-6× estimate, that
is the number we publish.

## Non-goals

- No task-success evaluation (assume all three complete the flow; they drive the
  same verbs).
- No wall-clock/latency claims (mention round-trip counts only).
- No modification of argent source. Clone read-only, pinned to a commit SHA
  recorded in the results.

## Method — two layers

### Layer 1 (required): mechanical payload capture

No LLM in the loop. A harness acts as an MCP **client**, drives each server through
the scenario, and records every byte that would enter a model's context:

1. `tools/list` response (fixed context), per server/configuration.
2. Static always-in-context artifacts: argent's `rules/argent.md`
   (`alwaysApply: true`), its 16 skill frontmatters, MCP `instructions`; our side
   has none today beyond tool defs — record that asymmetry explicitly, plus the
   `.d.ts` surface the script agent needs (model C's "documentation cost":
   `dist/index.d.ts` + `dist/types.d.ts` of `@device-stream/dsl`).
3. Every `tools/call` **result** payload, verbatim JSONL
   (`{step, tool, requestBytes, resultBytes, resultTokens, contentTypes}`).
   Image blocks: count real base64 bytes AND the Anthropic image-token formula
   (width×height/750 after any client-side handling — record dimensions; do not
   silently assume the client downscales).

Token counting: primary = Anthropic `POST /v1/messages/count_tokens`
(claude-sonnet-5) when `ANTHROPIC_API_KEY` is set; fallback = `js-tiktoken`
`o200k_base` with a printed disclaimer. Every table states which counter produced it.

Derived metrics, computed by the harness (pure functions, unit-tested):

- `fixed`: fixed context per configuration.
- `perStep[]` and `flowAdded`: tokens appended to the transcript by tool results.
- `billedUncached` = Σ over turns t of (fixed + Σ_{i≤t} added_i) — the quadratic
  transcript model; `billedCached` = fixed + Σ added_i (perfect prompt caching).
  Report both; the RFC quotes `billedCached` as primary (it favors argent —
  deliberate conservatism) with `billedUncached` as the no-caching bound.
- Round-trip count.

### Layer 2 (optional, gated): agent-in-the-loop

Only if the user later asks: N=5 real Claude runs per model via the Agent SDK,
reading actual `usage` fields. Out of scope for this spec's implementation; the
harness must merely not preclude it (keep scenario definition data-driven).

## Configurations measured (minimum set)

| id | server | notes |
|----|--------|-------|
| A1 | argent, defaults | auto-describe + auto-screenshot on; fixed context = `alwaysLoad` subset (14 tools) + rule + frontmatters + instructions |
| A2 | argent, all 77 tools in context | the no-progressive-loading client bound |
| A3 | argent, `disable-auto-screenshot` | their cheapest legitimate per-step mode |
| A4 | argent `run-sequence` | the 10 steps as one sequence call — argent's own best amortization; include even though the tool's description forbids dependent steps (note the caveat in the report) |
| B1 | device-stream atomic tools | 18 `dsl_*` tools; a `dsl_describe` before each context-dependent step, mirroring what an agent must do since our tools don't auto-describe (do NOT let B1 skip describes — that would be the strawman in reverse) |
| C1 | `dsl_run_script` | fixed context includes the `.d.ts` surface (~2.1k tok); flow = 1 call; include 1 initial `dsl_describe` for orientation |
| C2 | `dsl_run_script`, cold | same as C1 plus one selector-miss recovery: script fails once with the WS1 diagnostic error, agent "re-submits" a corrected script — models the realistic non-happy path (2 round-trips) |

## Scenario — the 10-step flow

Target: **Android Settings app** (`com.android.settings`) on the repo-standard
emulator (API 35, x86_64) — universal, no APK to pin, dense screens (good describe
stress). Steps (data-driven file `scenario.json`, one logical verb each):

1. launch Settings
2. describe/orient (models A get this free via auto-describe on launch; B pays a
   `dsl_describe`; C reads it inside the script)
3. tap "Network & internet"
4. assert "Internet" visible (A: `await-ui-element`; B: `dsl_describe` + check;
   C: `awaitUntil().toAppear()`)
5. back
6. tap search, type "battery"
7. tap first result
8. assert battery screen element visible
9. toggle a switch (e.g. Battery Saver) and assert state change
   (C: `awaitUntil().changeTo()` — one poll; A/B: interact + re-describe)
10. back to root, assert home screen

If a step's exact label differs on the emulator image, the implementor adjusts
labels in `scenario.json` (never in code) and records the final scenario used.
Both stacks must execute the **same logical steps**; the per-model expansion into
tool calls is defined in a per-model adapter table checked into the harness and
printed in the report (so a reviewer can audit fairness).

Also capture once per stack, same screen (Settings root list):
`describe`/`dsl_describe` raw size — replaces the extrapolated "Android describe
6-10 KB" number with a measured one.

## Deliverables

New directory `device-stream/benchmarks/token-bench/` (own `package.json` if deps
needed — `@modelcontextprotocol/sdk` client, `js-tiktoken`; do not pollute
workspace roots without need):

1. `harness/` — MCP stdio client + capture + metrics (pure metric fns unit-tested
   with fixture payloads; no device needed for tests).
2. `scenario.json` + per-model adapter tables.
3. `run.md` — exact reproduction steps: clone argent at pinned SHA, build, env
   vars (`DEVICE_STREAM_SERIAL`, `DEVICE_STREAM_PLATFORM=android`), emulator
   requirements, commands per configuration.
4. `results/` — raw JSONL per configuration + generated `RESULTS.md` with the
   comparison table (fixed / per-step / flowAdded / billedCached / billedUncached /
   round-trips per configuration) and the measured describe sizes.
5. If no emulator is reachable (`adb devices` empty): everything above minus
   `results/` — harness dry-run-tested against recorded fixture payloads, and the
   report clearly marked "pending live run".

## Constraints

- Argent cloned to the scratchpad or `benchmarks/token-bench/.vendor/` (gitignored),
  never into the workspace tree; pin + record SHA. A prior clone exists in this
  session's scratchpad — reuse if intact.
- Argent runs untouched: its own `npm install`/build, its real `argent-mcp` stdio
  adapter (auto-capture lives there — measuring the tool-server directly would
  miss it and understate their cost; that would be unfair in OUR favor, reject it).
- Our MCP: current working tree (WS1-WS5 landed). Build dsl (`npm run build -w
  @device-stream/dsl`) before running.
- Device access serialization: run configurations sequentially, never two servers
  driving the emulator at once.
- No commits. New files only under `device-stream/benchmarks/token-bench/` and
  nothing else.
- Harness code: TypeScript, ES2022, matching repo conventions; tests with vitest.

## Acceptance

- `npx vitest run` green for the harness metric/adapters tests (fixture-driven,
  device-free).
- With an emulator up: one command per configuration produces its JSONL +
  regenerates `RESULTS.md`; numbers for A1-A4/B1/C1-C2 all present, token counter
  identified, argent SHA + emulator image recorded.
- The per-model adapter table in the report makes every fairness choice visible
  (which model paid which describes, image token accounting, caching model).
- Report contains zero prose conclusions — numbers and method only. The RFC
  narrative is a separate later document.
