# Spec: DSL token-efficiency fixes (pre-Argent-RFC hardening)

Date: 2026-08-31 · Branch base: `fix/ci-failures` · Owner: heicg

## Goal

Fix the four token-cost defects found in the `@device-stream/dsl` + MCP surface, and add
an agent-authored script tool, so we can run a clean token benchmark against
software-mansion/argent and open an RFC there ("agent-authored typed automation
scripts"). Every workstream is independent and dispatchable to a separate implementor.

Line refs below were verified on 2026-08-31 against the working tree; re-verify before
editing (some files are untracked/new: `packages/dsl/src/flow.ts`,
`packages/dsl/src/selectors/describe.ts`, `mcp/src/dsl/`).

Token heuristic used everywhere: 4 chars ≈ 1 token.

---

## WS1 — Diagnostic `ElementNotFoundError` (biggest cheap win)

**Problem.** `ElementNotFoundError` (`device-stream/packages/dsl/src/types.ts:127-132`)
renders only `Element {"text":"Sign in"} not found within 5000ms`. `findElement`
(`device-stream/packages/dsl/src/selectors/matcher.ts:63-67`) discards all diagnostic
state. Every selector miss therefore costs the agent an extra `dsl_describe` round-trip
(~1.5-2.5k tokens on Android) to self-correct.

**Contract.**

1. `ElementNotFoundError` gains an optional structured payload:
   ```ts
   interface ElementNotFoundDiagnostics {
     candidates: string[];   // rendered lines of top near-miss elements, ≤ 10
     screen?: string;        // pruned describe of current screen, cap 2000 chars
     matchedCount?: number;  // elements that matched everything except `index`
   }
   ```
2. Near-miss ranking (implemented in `matcher.ts`, pure function, exported for tests):
   score each element in the tree against the selector — +2 per selector field that
   matches, +1 for a case-insensitive/substring "almost" on a `StringMatch` field,
   0 excluded fields don't count. Take top 10 with score > 0, render each with the
   same line format `renderDescription` uses (`selectors/describe.ts:51-66`).
3. `message` becomes (hard cap 2500 chars total):
   ```
   Element <selector JSON> not found within <timeout>ms.
   Near matches:
     <line 1>
     ...
   ```
   If `matchedCount > 0` and selector has `index`: append
   `N elements matched the selector but index <i> is out of range.`
4. The screen dump (`screen`) is attached only when there are zero near-misses
   (otherwise candidates suffice), and always pruned via the existing
   `describeElements` pipeline, capped at 2000 chars with a trailing
   `…(<n> more lines)` marker.
5. Wiring: every throw site that currently constructs `ElementNotFoundError`
   (`session.ts` waits, `matcher.ts` findElement path, `awaitUntil` timeouts in
   `session.ts:203-237`, `scrollUntilVisible` in `session.ts:105-122`) passes the last
   tree it polled — no extra device round-trip may be added to build diagnostics.
6. MCP: `guarded()` in `mcp/src/dsl/registry.ts:41-54` must keep the full (already
   capped) message in the tool error text.

**Tests** (extend `device-stream/packages/dsl/tests/`):
- near-miss scorer: exact-field, substring, excluded-field, tie ordering, top-10 cap.
- error message: with candidates / without (screen fallback) / index-out-of-range.
- total message length never exceeds 2500 chars given a 500-element synthetic tree.
- no additional driver call is made when building diagnostics (spy on driver).

**Acceptance.** A failing `ds.get({ text: 'Sign In' })` against a tree containing
`"Sign in"` produces an error whose message contains the `Sign in` candidate line;
message ≤ 2500 chars; all existing tests pass (`npx vitest run` in the dsl package).

---

## WS2 — Android describe parity (visibility + pruning)

**Problem.** `device-stream/packages/dsl/src/drivers/android.ts:105-106` fetches
`/hierarchy?maxElements=200` and maps a **flat** tree; `toUIElement`
(`android.ts:166-182`) never sets `visible`. The two strong pruning heuristics in
`describeElements` (`selectors/describe.ts:34-36`) — drop invisible subtrees, drop
anonymous childless containers — are no-ops on Android. Result: Android describe is
6-10 KB (~1.5-2.5k tokens) vs iOS 1.5-4 KB.

**Contract.**

1. `toUIElement` sets `visible`: an element is visible iff its bounds have non-zero
   area AND intersect the display bounds (device display size is already known to the
   driver; if not, treat the root/max bounds as display). If the android-server payload
   carries a `visible`/`displayed` field, prefer it — check
   `device-stream/native-servers/android-device-server/` JSON-RPC response shape first
   and use whatever is authoritative.
2. Preserve hierarchy if the server provides parent/child links; if the endpoint is
   genuinely flat, reconstruct containment from bounds nesting **only** for the purpose
   of the "anonymous container" pruning heuristic (a pure helper, tested in isolation).
   Do not change the public `UIElement` shape beyond populating existing optional
   fields.
3. `describeElements` prunes Android trees the same way it prunes iOS: invisible
   elements dropped, anonymous containers (no id/text/contentDescription) dropped.
4. Do not change the `maxElements=200` cap in this workstream.

**Tests.**
- fixture: synthetic flat Android tree (~120 nodes, ~30% invisible/offscreen, ~30%
  anonymous containers) → describe output drops ≥ 40% of lines vs today.
- visibility rule unit tests (zero area, offscreen, partial intersect).
- iOS describe output unchanged (existing fixtures still pass byte-for-byte).

**Acceptance.** Describe on the fixture shrinks ≥ 40%; `visible` populated for every
Android element; `npx vitest run` green in the dsl package.

---

## WS3 — `dsl_screenshot` context-safety

**Problem.** `mcp/src/dsl/registry.ts:148-151` base64-encodes a PNG requested at
`quality=80&scale=1` (`android.ts:101`) — native resolution, 270-800 KB of base64,
67k-200k tokens if the client treats it as text. Argent uses scale 0.25 (~260 tokens).

**Contract.**

1. Default capture scale becomes **0.25** end-to-end (driver request param where the
   backend supports it — android-server `scale` query param; for iOS backends that
   can't downscale at capture time, downscale in-process before returning; add
   `sharp` only if the repo already depends on it, otherwise use whatever image
   utility already exists — if none exists, capture-side scaling for Android +
   documented full-res fallback for iOS is acceptable, but the MCP layer must then
   enforce the size cap below by refusing, not by returning the blob).
2. Tool schema gains optional `scale` (0.05–1, default 0.25).
3. MCP result must be an **image content block** (`{ type: 'image', data, mimeType }`),
   never text — verify the current code path and fix if it emits text.
4. Hard cap: if the encoded payload exceeds 1 MB, return an `isError` text result
   telling the agent to lower `scale`, instead of the blob.

**Tests** (mcp package, extend `mcp/__tests__/`):
- default request carries scale 0.25 to the driver.
- explicit `scale: 1` honored; > cap returns the error text, no blob.
- result content type is `image`.

**Acceptance.** Default screenshot payload for a 1080×2400 frame ≤ ~25 KB base64;
`npx vitest run` green in mcp package.

---

## WS4 — Selector schema dedup in `tools/list`

**Problem.** The ~1.6 KB `selector` JSON Schema (with the `stringMatch` `anyOf`
repeated 5×) is inlined into 5 tools by zod-to-json-schema
(`mcp/src/dsl/schemas.ts:22-31`): ~8 KB of the 14.3 KB DSL tools payload (56%) is
duplication ≈ 1.6k wasted fixed-context tokens.

**Contract.**

1. Collapse the duplication. Two acceptable routes — implementor picks after checking
   what the MCP SDK + zod-to-json-schema version in `mcp/package.json` support:
   a. `$defs`/`$ref`: emit the selector schema once per tool under `$defs` and `$ref`
      it internally (per-tool `$defs` is safe for all clients; cross-tool `$ref` is
      NOT — MCP clients treat each `inputSchema` as standalone, so do not share
      definitions across tools).
   b. Schema slimming: flatten `stringMatch` from a 5-way `anyOf` into a single
      object shape `{ equals?, contains?, regex?, caseInsensitive? }` with the
      "exactly one of equals|contains|regex" rule enforced at runtime by zod and
      stated in one sentence in the description.
   Route (b) is preferred if it changes no runtime behavior, because it also shrinks
   the intra-tool footprint that (a) cannot remove.
2. No behavior change: every selector accepted today must still be accepted, every
   rejection still rejected (snapshot the zod parse results for a table of ~15
   selector fixtures before refactoring).
3. Add a tiny script `mcp/scripts/measure-tools-payload.ts` printing the serialized
   `tools/list` byte size for the DSL tool family (this becomes benchmark tooling).

**Tests.** Fixture table of valid/invalid selectors parses identically before/after;
payload measurement asserted ≥ 35% smaller for the 5 selector-bearing tools.

**Acceptance.** DSL `tools/list` payload ≤ ~9.5 KB (from 14.3 KB); `npx vitest run`
green in mcp package.

> **RESOLVED 2026-08-31 (planner decision).** Premise refuted during implementation:
> `zod-to-json-schema` (as invoked by the MCP SDK) already emits intra-tool `$ref`s
> for the reused `stringMatch` — the real wire baseline is 9,578 B total DSL / 5,043 B
> for the 5 selector tools, not 14.3 KB. Max parse-preserving reduction measured at
> ~6-9%; route (b) would break two live contracts (bare-string selectors; AND-combined
> `{equals, contains}`). Decision: **35% target dropped; zero behavior change kept.**
> Delivered instead: `mcp/scripts/measure-tools-payload.ts` (benchmark tooling) +
> 17-fixture parse-identity lock (20 tests). Future fixed-context recovery, if wanted,
> should come from trimming the 14 legacy `mcp/src/tools/` (out of scope here).

---

## WS5 — `dsl_run_script` MCP tool (agent-authored typed scripts)

**Problem.** The script model exists only in lifecycle hooks
(`server/hooks/internal/script-runner.ts`); the MCP exposes 18 atomic tools. The
benchmark (and the Argent RFC) needs a first-class "agent writes a typed script,
one round-trip" tool.

**Contract.**

1. New tool `dsl_run_script` in `mcp/src/dsl/`:
   ```
   input: { script: string, timeoutMs?: number (default 120_000, max 600_000) }
   ```
   `script` is a TypeScript body executed with `ds` (connected DSL session), `vars`
   (empty object for now) and standard globals in scope — same prelude contract as
   the hook script-runner. Reuse/extract the runner: lift the prelude + tsx execution
   out of `server/hooks/internal/script-runner.ts` into a shared module the hook
   runner and the MCP tool both import (do NOT duplicate it; do NOT break the hook
   runner's public behavior — its tests must stay green).
2. Session: reuse the lazy memoized session from `mcp/src/dsl/register.ts:60-63`
   (env-var configured, single device). The script runner must serialize against the
   atomic tools via the existing per-device mutex (`DeviceMutexManager` from
   `@device-stream/core`) so a script and a stray `dsl_tap` can't interleave.
3. Output caps (the hook runner has none — `script-runner.ts:50-53,96-108`):
   - stdout+stderr combined capped at 4000 chars, tail-truncated with
     `…(truncated, <n> chars total)`.
   - on throw: error name + message (which after WS1 already carries diagnostics,
     itself capped) + the **top 3 stack frames only**, with the temp `.mts` path
     rewritten to `<script>` so the agent never sees `.df-hook-tmp/` paths.
   - result shape: text content `ok` + captured stdout on success; `isError` with
     the capped error rendering on failure.
4. Security posture: this executes arbitrary TS with repo-local node — same trust
   level as the existing hook runner and the existing `dsl_*` tools (local dev tool).
   No new sandboxing required, but the tool description must state it runs local code.
5. Tool description ≤ 600 chars, pointing the agent at the `.d.ts` surface (the
   description is fixed context; keep it lean — that's the whole thesis).

**Tests** (mcp package):
- happy path: 3-step script returns `ok` + stdout.
- throw inside script: error text capped, no `.df-hook-tmp` path leaked, top-3 frames.
- stdout flood (100 KB print): result ≤ ~4.2 KB.
- timeout kills the child and reports it.
- hook-runner test suite untouched and green after the extraction.

**Acceptance.** From a live MCP session with env vars set, `dsl_run_script` executes
`await ds.describe()`-style scripts in one round-trip with capped output; all mcp +
server hook tests green.

---

## Sequencing & dispatch

- WS1, WS2, WS3, WS4 are mutually independent → 4 parallel implementors.
- WS5 depends on nothing above functionally, but its error-rendering test references
  WS1's message format loosely — write its assertions against caps, not exact WS1
  wording, so it can also run in parallel.
- Each implementor: run only its package's test suite (`device-stream/packages/dsl`
  or `mcp`, plus `server` hook tests for WS5) — full-repo CI is currently on branch
  `fix/ci-failures`, don't chase unrelated red.
- No commits: leave changes in the working tree for review.

## Out of scope (explicitly)

- Removing/merging the 14 legacy `mcp/src/tools/` (separate decision).
- Raising the Android `maxElements` cap or nested-hierarchy server changes.
- The benchmark harness itself and the Argent RFC text (next phase, after review).
