---
phase: 35-app-explorer
plan: 02
subsystem: explorations
tags: [explorations, claude-agent-sdk, mcp, sharp-phash, watchdog, bfs, agent-loop, vitest]

# Dependency graph
requires:
  - phase: 35-app-explorer
    provides: schema + module scaffold + Zod schemas + queue alias (35-00 substrate); REST + module factory + emitters + repo helpers (35-01)
  - phase: 34-session-api-mcp
    provides: device-stream MCP stdio server + session lease/release model
provides:
  - prompts/exploration.md (290-line agent system prompt — full BFS port from
    _reference/app-explorer/CLAUDE.md with revyl/app-explorer substitutions)
  - server/explorations/internal/prompts-loader.ts (cached fs read)
  - server/explorations/internal/similarity.ts (sharp-phash + grayscale RMSE
    crossover via isSameScreen; thresholds PHASH<8, RMSE<0.02)
  - server/explorations/internal/stuck-detector.ts (sliding-window pHash
    detector with default size 3)
  - server/explorations/internal/watchdog.ts (wall-clock setTimeout +
    tripBudget + cancel + exitReason; safe dispose)
  - server/explorations/internal/store.ts (Drizzle helpers — saveScreen
    upsert, saveTransition action-hash dedup, getUnexplored jsonb query,
    getScreenCount, getTransitionCount, markRunStarted/Finished,
    markElementExplored)
  - server/explorations/internal/agent-tools.ts (5 in-process MCP tools via
    @anthropic-ai/claude-agent-sdk tool() — explore_save_screen,
    explore_save_transition, explore_mark_element_explored,
    explore_get_unexplored, explore_finish)
  - server/explorations/internal/agent-runner.ts (runExploration(runId, deps)
    — Claude Agent SDK query() with in-process + external MCP server mix,
    tap-counter intercept, watchdog hooks, markRunStarted/Finished
    finalization, emit.started/finished/failed)
  - server/explorations/queue.ts extended — registerExplorationsRunWorker
    (policy:'stately' + retryLimit:0 + expireInSeconds:7200)
  - server/explorations/internal/module.ts extended — registerWorker(deps)
    method that boss.createQueue + boss.work on plugin onReady (defensive
    when boss is a test stub lacking createQueue/work)
  - server/explorations/plugin.ts extended — onReady hook wires the runner
    with artifact loader + server URL derived from fastify.config
  - 7 spec files replaced from skip-stubs to real bodies (prompts.spec [12],
    similarity.spec [12], stuck-detector.spec [11], watchdog.spec [11],
    agent-tools.spec [9], agent-runner.spec [4 DB-gated], budget.spec [4 mixed])
affects: [35-03-ws, 35-04-cli, 35-05-web, 35-06-phase-close]

# Tech tracking
tech-stack:
  added: []  # All deps shipped in 35-00
  patterns:
    - "Server-side budget cap enforcement (NOT trusted to agent): tapCounter
       increments inside agent-runner on every device_* tool_use; when
       tapCounter > budgetTaps → watchdog.tripBudget() → queryInstance.return()
       drives the SDK loop to exit gracefully."
    - "Stuck detection wired via tool-return-value carrier (RESEARCH Open
       Q#4 resolved): explore_save_screen detects pHash-match for 3rd
       consecutive call, returns {isDuplicate:true, stuckCount:N>=3}
       AND emits exploration.stuck. Agent prompt instructs the model to
       back out via device_key code:back + try a DIFFERENT element."
    - "Mixed in-process + external MCP server config in a single query()
       call: createSdkMcpServer({name:'exploration-state'}) for the 4
       explore_* tools, type:stdio entry for the external @device-stream/mcp
       Phase 34 server. allowedTools whitelist gates both sets."
    - "SDK injection point for tests: ExplorationRunnerDeps accepts
       optional {sdk: {query, createSdkMcpServer}} so unit tests stub
       the entire Claude Agent SDK with a synchronous async-generator mock
       (no API calls required for test runs)."
    - "Watchdog setTimeout: vi.useFakeTimers + vi.advanceTimersByTime
       deterministically verifies wall-clock cap without burning real seconds."
    - "Defensive module.registerWorker: test builds inject a boss stub
       with only .send (no createQueue/work); module logs a warning and
       skips worker registration instead of throwing. Keeps 35-01 routes
       test build loadable under the extended onReady hook."

key-files:
  created:
    - "prompts/exploration.md (290 lines — full BFS spec ported from
       _reference/app-explorer/CLAUDE.md with substitutions)"
    - "server/explorations/internal/prompts-loader.ts (cached fs read)"
    - "server/explorations/internal/similarity.ts (~110 lines — pHash +
       RMSE crossover via isSameScreen)"
    - "server/explorations/internal/stuck-detector.ts (~75 lines —
       sliding-window pHash detector)"
    - "server/explorations/internal/watchdog.ts (~90 lines — wall-clock +
       cancel + budget watchdog)"
    - "server/explorations/internal/store.ts (~290 lines — Drizzle helpers
       for agent loop)"
    - "server/explorations/internal/agent-tools.ts (~310 lines — 5 MCP tools)"
    - "server/explorations/internal/agent-runner.ts (~290 lines — the loop)"
  modified:
    - "server/explorations/queue.ts (replaced 35-00 alias-only stub with full
       registerExplorationsRunWorker — policy:'stately' + retryLimit:0)"
    - "server/explorations/internal/module.ts (added registerWorker(deps);
       defensive against test-stub boss; tracks workerId for shutdown.offWork)"
    - "server/explorations/plugin.ts (added onReady hook calling
       module.registerWorker with artifact loader + serverUrl)"
    - "server/explorations/__tests__/prompts.spec.ts (replaced stub: 12 tests)"
    - "server/explorations/__tests__/similarity.spec.ts (replaced stub: 12)"
    - "server/explorations/__tests__/stuck-detector.spec.ts (replaced stub: 11)"
    - "server/explorations/__tests__/watchdog.spec.ts (replaced stub: 11)"
    - "server/explorations/__tests__/agent-tools.spec.ts (replaced stub: 9)"
    - "server/explorations/__tests__/agent-runner.spec.ts (replaced stub: 4
       DB-gated, mocked SDK)"
    - "server/explorations/__tests__/budget.spec.ts (replaced stub: 4 mixed
       — 1 in-memory cap, 2 watchdog fake-timer, 1 DB-gated budget trip)"

key-decisions:
  - "PHASH_THRESHOLD = 8 (brief default — held). Real fixtures confirm
     Hamming(home, home-dup)=0, Hamming(home, shop)=29 — well-separated."
  - "RMSE_THRESHOLD = 0.02 (brief default — held). Real fixtures confirm
     RMSE(home, home-dup)=0.0000, RMSE(home, shop)=0.0431 — crossover clear."
  - "StuckDetector default window size = 3 (brief). Configurable via
     constructor for custom budgets — 2 (aggressive) or 5 (lenient) tested."
  - "Stuck signal carried in explore_save_screen RETURN VALUE (structuredContent)
     instead of intercepting the device-stream MCP forwarding layer
     (RESEARCH Open Q#4 — simpler hook point since we already pHash there)."
  - "Server-side budget caps enforced server-side via tapCounter interception
     inside agent-runner.ts iteration loop (NOT trusted to the agent prompt).
     Three caps: budgetTaps (tap counter > limit → tripBudget),
     budgetScreens (save_screen returns budget_exceeded),
     budgetSeconds (Watchdog setTimeout)."
  - "Watchdog → agent termination wire: onTrigger calls
     queryInstance.return() to break the SDK async generator. The runner
     also checks watchdog.shouldStop() between iterations as belt-and-braces."
  - "explore_finish is a SIGNAL (returns finishRequested:true), not a
     terminal write. The agent-runner finalizes after the query() resolves,
     consulting the last finishRequested record. Keeps the in-process MCP
     tools side-effect free relative to terminal status."
  - "Test SDK injection point: ExplorationRunnerDeps.sdk = {query?, createSdkMcpServer?}
     opt-in. Mock generator yields synthetic SDKMessage shapes; tests
     assert on emit invocations and DB row terminal state. No real
     network calls required."
  - "Defensive shape narrowing in module.registerWorker: when fastify.boss
     is a test stub lacking createQueue/work, log warning + skip worker
     registration instead of throwing. Preserves 35-01 routes test
     compatibility after the plugin onReady extension."
  - "TS NodeNext + CJS-default-export interop quirk: sharp-phash +
     sharp-phash/distance.js need .js subpath extension + callable-type
     cast at the import boundary."

patterns-established:
  - "Agent runner pattern: load row → markRunStarted → emit.started → build
     shared per-run state (StuckDetector + tapCounter + bfsOrderCounter +
     Watchdog) → createSdkMcpServer in-process + external stdio entry →
     query() with allowedTools whitelist → iterate generator counting taps
     + emitting toolCall → finalize with markRunFinished + emit.finished or
     emit.failed → watchdog.dispose in finally."
  - "Per-run shared state via plain mutable objects (`{value: N}` counters)
     threaded into both agent-tools AgentToolDeps and the runner loop —
     each side updates and observes the same state."

requirements-completed: [EXP-AGENT, EXP-LOOP]

# Metrics
duration: 37 min
completed: 2026-05-16
---

# Phase 35 Plan 35-02: Agent Runner + Loop/Stuck Detection + Inline pHash Summary

**Claude Agent SDK-driven BFS exploration runs end-to-end (mock-tested) — 5 in-process MCP tools mixed with the external @device-stream/mcp server, inline pHash + grayscale RMSE for screen equivalence, sliding-window stuck detector, server-side budget caps for taps/screens/seconds, all wired through a single query() call with allowedTools whitelist.**

## Performance

- **Duration:** ~37 min
- **Started:** 2026-05-16T20:10:57Z
- **Completed:** 2026-05-16T20:47:29Z
- **Tasks:** 3 (2.1 prompt+loader, 2.2 similarity+stuck+watchdog, 2.3 store+tools+runner+queue+specs)
- **Files created:** 8 production modules + 290-line prompts/exploration.md
- **Files modified:** 10 (3 production + 7 specs)

## Accomplishments

- **EXP-AGENT closed:** `runExploration(runId, deps)` invokes Claude Agent SDK
  `query()` with mixed in-process (`exploration-state`) + external stdio
  (`device-stream`) MCP server config. allowedTools whitelist gates 12 tools
  (7 device_* + 5 explore_*). maxTurns derives from budgetTaps × 3. On tool-use
  iteration the runner counts device_* taps + emits `exploration.tool.called`
  envelopes. SDK injection point (`deps.sdk`) lets unit tests stub the entire
  SDK with synthetic generators.
- **EXP-LOOP closed:** pHash via `sharp-phash` (Hamming) + grayscale RMSE via
  `sharp` crossover (`isSameScreen`) — thresholds PHASH<8 + RMSE<0.02 verified
  with real PNG fixtures (Hamming 0/0/29, RMSE 0/0/0.043). StuckDetector
  sliding window of 3 close pHashes fires the `exploration.stuck` event AND
  carries `stuckCount` back through the tool return so the agent can react.
- **Budget caps enforced server-side:** budgetTaps via tapCounter intercept in
  the iteration loop → watchdog.tripBudget → q.return() → loop breaks +
  exit reason='budget'. budgetScreens via explore_save_screen pre-check
  returning `{error:'budget_exceeded'}`. budgetSeconds via Watchdog setTimeout.
- **prompts/exploration.md ported verbatim from reference repo (290 lines)** with
  locked substitutions (revyl device → device_*, app-explorer screen →
  explore_save_screen). Stop Conditions + Budget Awareness sections added.
  Verified by spec: substitution applied (no `revyl`/`app-explorer screen`
  substrings remain), `## Algorithm` + `## Rules` + `## Stop Conditions`
  sections present, > 5000 chars, second load returns cached identical
  reference.
- **agent-runner SDK-mocked spec proves the integration contract:** query()
  invoked with correct mcpServers config (both keys present), allowedTools
  whitelist includes both device_* and explore_* names, maxTurns = budgetTaps
  × 3, systemPrompt content from prompts/exploration.md. On generator
  completion: emit.started + emit.finished fire, DB row status='complete'.
  On generator throw: emit.failed fires, DB row status='failed' with
  errorMessage.
- **Pg-boss exploration.run queue worker registered on plugin onReady** —
  policy:'stately' + retryLimit:0 + expireInSeconds:7200. Worker handler
  invokes `runExploration(payload.runId, deps)`. Module's registerWorker is
  defensive when boss is a test stub lacking createQueue/work — logs warning
  + skips registration (preserves 35-01 routes spec compatibility).
- **101/101 explorations tests green** (3 spec stubs replaced + 4 new specs
  bodies; 0 stubs remaining for Plan 35-02 surface). No new tsc errors in
  `server/explorations/**`. dep-check baseline 5 violations preserved.

## Task Commits

Each task was committed atomically:

1. **Task 2.1: prompts/exploration.md full port + prompts-loader + spec** — `3cd5e98` (feat)
2. **Task 2.2: similarity + stuck-detector + watchdog + 3 specs** — `b0110dc` (feat)
3. **Task 2.3: store + agent-tools + agent-runner + queue worker + 3 specs** — `fc3c2dd` (feat)
4. **Follow-up fix: zero TS errors in explorations module** — `e7cbc03` (fix)

**Plan metadata commit:** pending (added after this SUMMARY)

## Files Created/Modified

**Created (8):**
- `prompts/exploration.md` — 290-line agent system prompt
- `server/explorations/internal/prompts-loader.ts` — cached fs read
- `server/explorations/internal/similarity.ts` — pHash + RMSE crossover
- `server/explorations/internal/stuck-detector.ts` — sliding-window detector
- `server/explorations/internal/watchdog.ts` — wall-clock + cancel + budget
- `server/explorations/internal/store.ts` — Drizzle helpers for agent loop
- `server/explorations/internal/agent-tools.ts` — 5 in-process MCP tools
- `server/explorations/internal/agent-runner.ts` — the loop

**Modified (10):**
- `server/explorations/queue.ts` — added registerExplorationsRunWorker body
- `server/explorations/internal/module.ts` — added registerWorker + defensive guard
- `server/explorations/plugin.ts` — onReady hook for worker registration
- `server/explorations/__tests__/prompts.spec.ts` — 12 real tests (replaced stub)
- `server/explorations/__tests__/similarity.spec.ts` — 12 real tests (replaced stub)
- `server/explorations/__tests__/stuck-detector.spec.ts` — 11 real tests (replaced stub)
- `server/explorations/__tests__/watchdog.spec.ts` — 11 real tests (replaced stub)
- `server/explorations/__tests__/agent-tools.spec.ts` — 9 real tests (replaced stub)
- `server/explorations/__tests__/agent-runner.spec.ts` — 4 DB-gated mocked-SDK tests (replaced stub)
- `server/explorations/__tests__/budget.spec.ts` — 4 mixed tests (replaced stub)

## Decisions Made

See `key-decisions` in frontmatter. Highlights:

- **PHASH_THRESHOLD 8 / RMSE_THRESHOLD 0.02** held to brief defaults — fixture
  verification confirms wide crossover margins (Hamming 0/29; RMSE 0.000/0.043).
- **Stuck signal via tool return value (RESEARCH Open Q#4 resolved)**: simpler
  hook point inside explore_save_screen since pHashing already happens there;
  the agent acts on it AND the server emits the WS event in parallel.
- **Server-side budget enforcement (not agent-trusted)**: tapCounter intercept
  + watchdog.tripBudget → query.return() — agent prompt instructs the model
  to call explore_finish on budget signals, but the runtime would terminate
  anyway if it didn't.
- **explore_finish is a SIGNAL, not a terminal write**: the runner finalizes
  status after query() resolves, consulting the last finishRequested record.
  Keeps in-process MCP tools side-effect free relative to terminal status.
- **SDK injection point** for tests: avoids real Anthropic API calls in unit
  tests; mock generators yield synthetic SDKMessage shapes; the contract test
  asserts on query() args + emit invocations.
- **Defensive module.registerWorker** when boss is a test stub lacking
  createQueue/work — logs warning + skips registration. Preserves Plan 35-01
  routes spec compatibility after the plugin onReady extension.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Test boss stub lacks createQueue/work after plugin onReady extension**
- **Found during:** Task 2.3 (full explorations suite run after wiring registerWorker)
- **Issue:** Plan 35-01 routes.spec injects a `boss` stub with only `.send()`.
  After Plan 35-02 added plugin onReady → `module.registerWorker` →
  `boss.createQueue`, all 12 routes tests failed at app.ready() with
  "boss.createQueue is not a function".
- **Fix:** Made `module.registerWorker` defensive — when `boss.createQueue` or
  `boss.work` is not a function, log a warning + return early instead of
  throwing. Production builds always have a real pg-boss; tests are unaffected
  by skipping worker registration.
- **Files modified:** `server/explorations/internal/module.ts`
- **Verification:** All 12 routes.spec tests pass; explorations full suite 101/101.
- **Committed in:** `fc3c2dd` (Task 2.3 commit)

**2. [Rule 3 - Blocking] sharp-phash NodeNext interop — callable-type loss**
- **Found during:** Final tsc check
- **Issue:** Under TS NodeNext + `esModuleInterop:true`, the CJS-default-export
  shape of `sharp-phash` (and `sharp-phash/distance`) does not surface as a
  callable function at the TS type level — tsc reports "This expression is not
  callable". Runtime works fine.
- **Fix:** Added explicit callable-type casts at the import boundary
  (`as unknown as (buf: Buffer) => Promise<string>`). Subpath import also
  needs `.js` extension since `sharp-phash` lacks `exports` field.
- **Files modified:** `server/explorations/internal/similarity.ts`
- **Verification:** `npx tsc --noEmit | grep server/explorations` returns empty.
- **Committed in:** `e7cbc03` (follow-up fix commit)

**3. [Rule 3 - Blocking] PgBoss + Job pg-boss imports**
- **Found during:** Final tsc check
- **Issue:** `import type PgBoss from 'pg-boss'` is wrong under NodeNext —
  pg-boss exports `{PgBoss, Job}` named, not default. Plan pseudocode used
  default import; tsc reports "Module has no default export".
- **Fix:** Switched to `import type { PgBoss, Job } from 'pg-boss'`. Module's
  internal `import('pg-boss').default` corrected to `import('pg-boss').PgBoss`.
  Added explicit `Job<ExplorationRunPayload>[]` type to worker handler arg.
- **Files modified:** `server/explorations/queue.ts`, `server/explorations/internal/module.ts`
- **Verification:** tsc clean.
- **Committed in:** `e7cbc03` (follow-up fix commit)

**4. [Rule 1 - Bug] startedBy must be actor literal string, not object**
- **Found during:** Final tsc check
- **Issue:** Plan implied `startedBy: actorSchema` accepts an object shape, but
  `actorSchema` is `z.string().regex(/^(user:|apikey:|cron|system).../)` —
  expects a string literal like `apikey:<id>` or `system`. Original
  agent-runner emitted `{type:'system', label:...}` which would fail Zod parse
  at envelope time.
- **Fix:** Use `run.ownerActor` directly when it matches the regex, fall back
  to literal `'system'`. Matches Phase 26 / 34 actor convention.
- **Files modified:** `server/explorations/internal/agent-runner.ts`
- **Verification:** tsc clean; emit.started's payload schema validates at runtime.
- **Committed in:** `e7cbc03` (follow-up fix commit)

**5. [Rule 1 - Bug] returnFn iterator-protocol shape required by for-await loop**
- **Found during:** Task 2.3 (initial budget.spec DB-gated test failure)
- **Issue:** Mock `returnFn = vi.fn()` returns `undefined`. When the runner
  catches the tripBudget event and calls `queryInstance.return()`, the
  for-await loop expects `{value, done: true}` (iterator protocol).
  `undefined` throws "Iterator result undefined is not an object", which the
  runner's try/catch then treats as a failure path. The test asserted return
  was called 1 time but the assertion ran before the path executed cleanly
  (return is called 3 times in error-path teardown).
- **Fix:** Mock returnFn as `vi.fn(async () => ({value: undefined, done: true}))`
  so the for-await loop exits normally → finalReason='budget' → emit.finished
  fires with reason='budget' → DB row marked 'failed' (correct terminal state).
- **Files modified:** `server/explorations/__tests__/budget.spec.ts`
- **Verification:** budget.spec 4/4 tests pass; assertions match agent-runner
  budget-path contract.
- **Committed in:** `fc3c2dd` (Task 2.3 commit)

---

**Total deviations:** 5 auto-fixed (3 Rule 3 - Blocking, 2 Rule 1 - Bug)
**Impact on plan:** All 5 essential to ship correctly. No scope creep — corrections only.

## Issues Encountered

- **Pre-existing failures in adjacent modules** (sessions/routes, sessions/ws,
  sessions/auth-rate-sweeper, jobs/drain-route — 10 baseline failures, varies
  ±1 between runs due to test ordering). Verified pre-existing via
  `git stash + run + pop`. Out of Phase 35 scope.
- **5 pre-existing dep-cruiser violations** (artifacts→streaming + api→pipelines).
  No new violations introduced.

## Authentication Gates

None — agent-runner unit tests use mocked SDK; no Anthropic API key
required for the Plan 35-02 surface. The Phase-close gated E2E suite
(DEVICE_FARM_E2E) will require ANTHROPIC_API_KEY — deferred to Plan 35-06.

## User Setup Required

None — no external service configuration required for Plan 35-02.
The Anthropic API key requirement surfaces at the agent runner runtime
under `DEVICE_FARM_E2E=true` only (Plan 35-06).

## Deferred Items

- **Sample APK E2E gated test** — full agent loop against a real APK + real
  Anthropic API + real Maestro/Phase 34 session. Gated by `DEVICE_FARM_E2E`
  environment flag. Deferred to Plan 35-06 phase-close gate.
- **agent-runner.spec.ts spec stub kept for non-DB envs** — when
  TEST_DATABASE_URL is unset the spec describes.skip; the 4 tests
  themselves require a real Postgres for the run-row INSERT + status
  assertions.

## Mock SDK Harness Shape (for 35-03+ reuse)

The reusable mocked-SDK pattern from `agent-runner.spec.ts`:

```typescript
const queryFn = vi.fn(() => {
  const gen = (async function* () {
    yield {
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', name: 'device_screenshot', input: {sessionId: 's'} },
          // ... more tool_use blocks
        ],
      },
    };
  })();
  // Return value must satisfy iterator protocol — {value, done:true}.
  return Object.assign(gen, {
    return: vi.fn(async () => ({ value: undefined, done: true })),
  });
});
const createServerFn = vi.fn(() => ({ name: 'exploration-state', tools: [] }));

await runExploration(runId, {
  ...deps,
  sdk: { query: queryFn, createSdkMcpServer: createServerFn },
  externalMcpConfig: { type: 'stdio', command: 'echo', args: [], env: {} },
});
```

Phase 35-03 WS broadcaster can subscribe to `fastify.explorationsModule.bus`
on the started/finished/failed/stuck/screen.discovered/transition/toolCall
events emitted during the iteration. The mock SDK doesn't fire real
Anthropic API traffic but does drive emit.* exactly as the production runner.

## Next Phase Readiness

- **Plan 35-03 (WS event stream) unblocked**: subscribe to
  `fastify.explorationsModule.bus` for all 7 event types; the runner emits
  them in the contract documented in events.ts (TRACE-08 split: 4
  persisted, 3 transient).
- **Plan 35-04 (CLI)** unchanged; CLI hits POST /api/explorations from 35-01.
- **Plan 35-05 (web UI)** unchanged; UI hits GET /api/explorations/:id from 35-01.
- **Plan 35-06 (phase close)** receives the DEVICE_FARM_E2E gated test as a
  follow-up: run a real APK through the loop with real ANTHROPIC_API_KEY +
  Phase 34 session leases. Smoke-test the full integration.
- **EXP-AGENT + EXP-LOOP requirements fully closed** at the spec layer.

## Self-Check: PASSED

Verified files exist on disk:
- `prompts/exploration.md` ✓ (290 lines, > 5000 chars)
- `server/explorations/internal/prompts-loader.ts` ✓
- `server/explorations/internal/similarity.ts` ✓
- `server/explorations/internal/stuck-detector.ts` ✓
- `server/explorations/internal/watchdog.ts` ✓
- `server/explorations/internal/store.ts` ✓
- `server/explorations/internal/agent-tools.ts` ✓
- `server/explorations/internal/agent-runner.ts` ✓
- `server/explorations/__tests__/prompts.spec.ts` ✓ (replaced stub)
- `server/explorations/__tests__/similarity.spec.ts` ✓ (replaced stub)
- `server/explorations/__tests__/stuck-detector.spec.ts` ✓ (replaced stub)
- `server/explorations/__tests__/watchdog.spec.ts` ✓ (replaced stub)
- `server/explorations/__tests__/agent-tools.spec.ts` ✓ (replaced stub)
- `server/explorations/__tests__/agent-runner.spec.ts` ✓ (replaced stub)
- `server/explorations/__tests__/budget.spec.ts` ✓ (replaced stub)

Verified commits exist:
- `3cd5e98` Task 2.1 ✓ (prompt + loader + spec)
- `b0110dc` Task 2.2 ✓ (similarity + stuck + watchdog + 3 specs)
- `fc3c2dd` Task 2.3 ✓ (store + agent-tools + runner + queue worker + 3 specs)
- `e7cbc03` Follow-up fix ✓ (zero tsc errors)

Verified test suites green:
- 101/101 server/explorations tests pass (with TEST_DATABASE_URL set)
- 0 new tsc errors in server/explorations/**
- dep-check baseline 5 violations preserved (no new explorations entries)
- All 7 Plan 35-02 spec files real bodies (no skip-stubs remaining)

---
*Phase: 35-app-explorer*
*Completed: 2026-05-16*
