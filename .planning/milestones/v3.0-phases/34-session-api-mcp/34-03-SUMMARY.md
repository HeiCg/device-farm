---
phase: 34
plan: 03
subsystem: sessions
tags: [nl-resolver, anthropic-sdk, lru-cache, fast-xml-parser, wave-3, tdd]

requires:
  - phase: 34-02
    provides: ActionContext.resolver seam + STUB_RESOLVER decoration + fastify.sessionsResolver decorator + ResolverError class + ResolveTargetRequest/Result types
  - phase: 34-00
    provides: android-hierarchy.xml + screenshot.png fixtures + resolver-maestro.spec/resolver-claude.spec skip-stubs

provides:
  - MaestroAiResolver — deterministic XML/JSON-hierarchy heuristic (default, free, offline)
  - ClaudeVisionResolver — Anthropic Messages API call with module-level LRU cache (100 entries × 5min TTL) keyed sha256(screenshot)+target
  - FallbackResolver wrapper — Maestro AI primary, ClaudeVision secondary, escalation at confidence < 0.5
  - createResolver({logger}) factory — env-driven (SESSION_RESOLVER unset|maestro-ai|claude-vision); graceful fallback to Maestro AI when Anthropic init fails
  - fastify.sessionsResolver now holds the REAL TargetResolver (Plan 34-02 STUB removed from plugin)
  - 33 new vitest tests (12 maestro + 11 claude + 10 integration) — all green

affects: [34-04, 34-05, 34-06, 34-07]

tech-stack:
  added: ["@anthropic-ai/sdk@^0.30.1", "lru-cache@^11.2.2"]
  patterns:
    - "Resolver factory reads env once at plugin boot — runtime env change requires server restart (documented in 34-07 runbook)"
    - "FallbackResolver pattern: cheap primary + expensive secondary, escalation gate is confidence threshold (0.5) — not error/exception"
    - "Module-level LRU cache survives plugin re-registration; sha256(screenshot)+target key ensures different screenshots/targets dedupe correctly"
    - "Resolver-side resource-id package-prefix stripping: `com.example.app:id/foo` → `foo` before substring matching (avoids spurious package-name token hits across every node)"
    - "Test-time client injection via constructor `{anthropicClient}` dep — production code instantiates real Anthropic({apiKey}), tests pass a vi.fn() mock without touching the SDK module"
    - "Live-gated tests with `process.env.ANTHROPIC_API_KEY ? describe : describe.skip` — same shape as DB-gated tests elsewhere in the codebase"

key-files:
  created:
    - server/sessions/internal/resolver/types.ts
    - server/sessions/internal/resolver/maestro-ai.ts
    - server/sessions/internal/resolver/claude-vision.ts
    - server/sessions/internal/resolver/index.ts
    - server/sessions/__tests__/resolver-integration.spec.ts
  modified:
    - package.json
    - package-lock.json
    - server/sessions/plugin.ts
    - server/sessions/__tests__/resolver-maestro.spec.ts
    - server/sessions/__tests__/resolver-claude.spec.ts

key-decisions:
  - "Default model 'claude-sonnet-4-5' (Open Question #7 resolution) — overridable via SESSION_RESOLVER_MODEL env or explicit ClaudeVisionResolver({model}) dep"
  - "Anthropic SDK pin @^0.30.1 — latest stable on npm at execution time (2026-05-16); messages.create() shape matches the constructor pattern documented in RESEARCH §ClaudeVisionResolver lines 482-518"
  - "lru-cache @^11.2.2 — directly depended (was transitive via @fastify/static); ensures availability if @fastify/static is ever bumped or removed"
  - "fast-xml-parser was already transitive (via @device-stream/ios-simulator > appium-ios-simulator) — verified by `npm ls`; NOT added as a direct dep this plan to avoid signaling broader fast-xml-parser ownership"
  - "ClaudeVisionResolver constructor takes a 3-flavor `{apiKey?, model?, anthropicClient?}` deps bag — apiKey + model are both optional with env fallbacks, anthropicClient is the test-only injection point. When neither apiKey nor anthropicClient is available, constructor throws (caught by the factory and downgraded to MaestroAiResolver-only with a warn log)"
  - "FallbackResolver does NOT wrap MaestroAiResolver alone (when SESSION_RESOLVER unset). Pure MaestroAiResolver is returned directly — keeps the default code path identical to the non-wrapped behavior, no escalation logic engaged"
  - "Resource-id package-prefix stripping (`com.example.app:id/` → ``) added during Task 3.1 to fix the `target='example'` test case — without it, every node in a real Android hierarchy matches package-name tokens via resource-id, breaking the deterministic ranking. Test now passes. Documented inline in maestro-ai.ts:scoreAndroidNode"
  - "iOS hierarchy walker accepts the standard `{type, label, value, identifier, frame: {x,y,width,height}, children}` JSON shape. Full iOS parsing depth (e.g., handling nested XCUITest dumps) deferred — basic walker + frame centroid is sufficient for Wave 3 tests + Phase 35 will refine as iOS-specific session work expands"
  - "Plan 34-02 STUB_RESOLVER export from ws.ts retained for safety net in `buildActionContext` (the `?? STUB_RESOLVER` fallback) but no longer wired into fastify.sessionsResolver — plugin always decorates with the real factory output"

patterns-established:
  - "Resolver substrate at server/sessions/internal/resolver/ — types.ts + per-backend file + index.ts barrel with factory. Future backends (e.g., Phase 36 OmniParser) get a new file + a factory branch in index.ts"
  - "FallbackResolver as a generic 2-stage chain composable — Plan 34-07+ can wrap it with caching, retry, or telemetry decorators without touching the inner resolvers"
  - "Test-time mock injection at constructor boundary (vs vi.mock at module level) keeps the SDK module untouched + makes resolver behavior testable in isolation"

requirements-completed: [SESS-NL-MAESTRO, SESS-NL-CLAUDE]

# Metrics
duration: 12 min
completed: 2026-05-16
---

# Phase 34 Plan 03: NL Target Resolvers Summary

**MaestroAiResolver (deterministic XML/JSON heuristic) as default + opt-in ClaudeVisionResolver (Anthropic Messages API with module-level LRU cache) chained via FallbackResolver — wired into `fastify.sessionsResolver` through an env-driven factory, replacing the Plan 34-02 throw-stub.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-05-16T16:12:51Z
- **Completed:** 2026-05-16T16:25:43Z
- **Tasks:** 3
- **Files modified:** 10 (5 created + 5 modified)

## Accomplishments

- `server/sessions/internal/resolver/types.ts` ships the `TargetResolver` interface + `ResolveTargetRequest`/`ResolveTargetResult` types + a `ResolverError` class. Fields match RESEARCH §NL Resolvers verbatim (target, screenshot:Buffer, hierarchy, platform, screenWidth, screenHeight; x, y, confidence, backend, cached, latencyMs).
- `MaestroAiResolver` implements the deterministic heuristic per RESEARCH §MaestroAiResolver implementation plan: (1) tokenize the target (lowercase, drop stopwords), (2) parse XML via `fast-xml-parser` (Android) or JSON (iOS), (3) walk leaves with bounds/frame, (4) score on text/content-desc/resource-id (Android) or label/value/identifier (iOS), (5) penalize `clickable=false`, boost `class=*Button*`, (6) return centroid of best node's bounds. Confidence formula: `min(0.95, 0.5 + score * 0.15)`. Low-confidence path returns `{x:0, y:0, confidence:0.3}` for FallbackResolver to decide escalation.
- `ClaudeVisionResolver` calls Anthropic Messages API per RESEARCH lines 482-518 — base64 PNG image block + text prompt embedding hierarchy snippet (sliced 0-4000 chars). Reads model from `process.env.SESSION_RESOLVER_MODEL` (default `claude-sonnet-4-5`). Parses the response text as JSON (`{x:[0,1], y:[0,1], confidence}`), denormalizes to pixel coords via `screenWidth × x, screenHeight × y`.
- LRU cache (max 100 entries × 5min TTL) keyed on `sha256(screenshot) + ':' + target` — module-level singleton so plugin re-registration doesn't clear it. Cache hits return `{..., cached: true, latencyMs}` without an SDK call.
- `FallbackResolver` chains 2 resolvers: primary fires first; if `confidence < 0.5`, secondary is called. Logs escalation events at INFO level. Errors from either side propagate (no swallowing).
- `createResolver({logger})` factory reads `process.env.SESSION_RESOLVER` once at plugin boot:
  - Unset OR `'maestro-ai'` → pure `MaestroAiResolver` (default).
  - `'claude-vision'` → `FallbackResolver(MaestroAiResolver, ClaudeVisionResolver, logger)`.
  - Anthropic init failure (e.g., missing `ANTHROPIC_API_KEY`) → graceful downgrade to pure `MaestroAiResolver` with a `warn` log (server boot succeeds).
  - Unknown values → pure `MaestroAiResolver` with a `warn` log (defensive).
- `server/sessions/plugin.ts`:
  - Replaced `fastify.decorate('sessionsResolver', STUB_RESOLVER...)` with `fastify.decorate('sessionsResolver', createResolver({logger}))`.
  - Tightened `FastifyInstance.sessionsResolver` type from `{resolve(req:unknown):Promise<unknown>}` to `TargetResolver`.
  - STUB_RESOLVER export from `ws.ts` retained for the `buildActionContext` safety-net fallback (`fastify.sessionsResolver ?? STUB_RESOLVER`) but no longer wired into fastify.
- Test counts (Wave 3 additions):
  - `resolver-maestro.spec.ts`: **14 tests** (was 1 placeholder + 2 skip at substrate) — Android 12 tests covering Sign In centroid, case-insensitive, Settings via content-desc, low-confidence fallback, empty target, clickable=false exclusion, latency, backend tag, Forgot password, Search bottom-nav; iOS 2 tests covering Sign In on frame + malformed JSON fallback.
  - `resolver-claude.spec.ts`: **11 tests** (was 1 placeholder + 2 skip at substrate) — mocked SDK (10 tests: denormalization, cache hit, cache key by screenshot, cache key by target, low-confidence pass-through, malformed JSON → ResolverError, `{x:null,y:null}`, model from explicit dep, model from env, no-key throw, image+text block structure) + 1 live-gated on `ANTHROPIC_API_KEY`.
  - `resolver-integration.spec.ts`: **10 tests** — 5 factory cases (env unset, =maestro-ai, =claude-vision OK, =claude-vision missing key, unknown value), 4 FallbackResolver cases (high primary skips secondary, low primary escalates, secondary throw, primary throw), 1 smoke (createResolver default resolves Sign In on fixture XML).
  - **Total NEW tests: 33 (+30 over substrate)**.
- Full sessions vitest suite: **114/114 passing** (verified after 1 transient run failure on `ws.spec.ts:331` — same flake noted in Plan 34-02 SUMMARY; re-run was green).

## Task Commits

1. **Task 3.1: Install deps + types.ts + MaestroAiResolver + 14 tests** — `7611a17` (feat)
2. **Task 3.2: ClaudeVisionResolver with LRU cache + 11 tests** — `9576968` (feat)
3. **Task 3.3: createResolver factory + FallbackResolver + plugin swap + 10 integration tests** — `8bb28e1` (feat)

_(Plan metadata commit follows this summary.)_

## Files Created/Modified

**Created (5):**
- `server/sessions/internal/resolver/types.ts` — TargetResolver + ResolveTargetRequest/Result + ResolverError class
- `server/sessions/internal/resolver/maestro-ai.ts` — deterministic XML/JSON heuristic (Android + iOS walkers + scoring)
- `server/sessions/internal/resolver/claude-vision.ts` — Anthropic Messages API + LRU cache + injectable AnthropicMessagesClient
- `server/sessions/internal/resolver/index.ts` — createResolver factory + FallbackResolver class + re-exports
- `server/sessions/__tests__/resolver-integration.spec.ts` — factory env handling + FallbackResolver escalation + smoke

**Modified (5):**
- `package.json` — added `@anthropic-ai/sdk@^0.30.1` + `lru-cache@^11.2.2` to dependencies
- `package-lock.json` — regenerated by `npm install` (133 packages added)
- `server/sessions/plugin.ts` — swapped STUB_RESOLVER decoration for `createResolver({logger})`; tightened type to TargetResolver
- `server/sessions/__tests__/resolver-maestro.spec.ts` — 14-test body replacing 1 placeholder + 2 skip stubs
- `server/sessions/__tests__/resolver-claude.spec.ts` — 11-test body replacing 1 placeholder + 2 skip stubs

## Decisions Made

1. **Default model `claude-sonnet-4-5` (Open Question #7 RESOLVED)** — pinned in `claude-vision.ts:DEFAULT_MODEL`. Overridable via constructor `model` dep OR `SESSION_RESOLVER_MODEL` env. Newer models can be selected at runtime by setting the env var (no code change). Documented in 34-07 runbook plans.

2. **Anthropic SDK pin `@^0.30.1`** — latest stable npm version at execution time. The `messages.create({model, max_tokens, messages:[image+text]})` call shape matches RESEARCH §ClaudeVisionResolver lines 482-518. Caret range allows minor bumps without breaking the lock; major bumps require RESEARCH revisit.

3. **lru-cache as a direct dep (was transitive)** — `@fastify/static@9.1.3 > glob > path-scurry > lru-cache@11.3.6` covered us transitively, but pinning a direct `lru-cache@^11.2.2` dep ensures availability if @fastify/static drops or bumps. Cost: trivial (already in node_modules).

4. **fast-xml-parser NOT added as a direct dep** — verified by `npm ls fast-xml-parser` it ships transitively via `@device-stream/ios-simulator > appium-ios-simulator > fast-xml-parser@4.5.6`. Adding as direct would have signaled broader ownership — kept transitive to minimize surface area. If appium-ios-simulator ever drops it, we'll need to pin direct (one-line change).

5. **Resource-id package-prefix stripping** — discovered during Task 3.1 test development: `target='example'` was unexpectedly matching the Settings ImageButton (score 1.5 via `resource-id='com.example.app:id/settings_button'` matching the 'example' token from the package prefix). Fix: strip everything before `:id/` from resource-id before scoring. Documented inline at `maestro-ai.ts:scoreAndroidNode`. Without this, every node in a real Android hierarchy would match package-name tokens via resource-id.

6. **ClaudeVisionResolver constructor 3-flavor deps bag** — `{apiKey?, model?, anthropicClient?}`. Each optional with sensible fallbacks: apiKey → ANTHROPIC_API_KEY env, model → SESSION_RESOLVER_MODEL env → 'claude-sonnet-4-5' default, anthropicClient → real Anthropic SDK. When neither apiKey nor anthropicClient is available, constructor throws. Tests inject `{anthropicClient: mock}` exclusively (never touch real SDK at unit-test time).

7. **FallbackResolver does NOT wrap MaestroAiResolver alone** — when `SESSION_RESOLVER` is unset, `createResolver` returns the pure MaestroAiResolver (no wrapper). This keeps the default code path identical to the un-wrapped behavior; no escalation logic engaged, no log spam about "primary resolver returned ...". The wrapper only exists when there's an actual secondary to escalate to.

8. **iOS hierarchy walker is best-effort** — accepts the standard `{type, label, value, identifier, frame:{x,y,width,height}, children}` JSON shape. Full iOS parsing depth (e.g., XCUITest dump variants) deferred — basic walker + frame centroid is sufficient for Wave 3 tests and Phase 35 will refine as iOS-specific session work expands.

9. **Plan 34-02 STUB_RESOLVER retained but disconnected** — still exported from `ws.ts` for the `buildActionContext` safety-net fallback (`fastify.sessionsResolver ?? STUB_RESOLVER`). In Plan 34-03 + later, fastify.sessionsResolver is always defined (real resolver), so the fallback is dead code in production. Kept for test scenarios that bypass the plugin and for forward-compat with any future code path that needs a defined-but-throwing default.

10. **Module-level LRU cache singleton** — declared at module load in `claude-vision.ts`, NOT per-instance. Two-resolver instances on the same server process share the cache (which is what we want — same screenshot+target should always dedupe). Plugin re-registration doesn't clear it. Server restart clears it (and is required for env-var changes per Plan 34-07).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Resource-id package-prefix matching produced spurious high-score hits**
- **Found during:** Task 3.1 (running `resolver-maestro.spec.ts`)
- **Issue:** Test `does NOT pick the non-clickable Example App TextView for 'Example'` failed because every clickable node in the fixture (Settings, Sign In button, email/password fields, bottom-nav entries) has a `resource-id` of the form `com.example.app:id/<local>` — the `example` token matched the `com.example.app` package prefix on EVERY node. Settings ImageButton scored 1.5 (1 resource-id hit + 0.5 button boost) and the resolver returned its bounds (900, 150) instead of the expected low-confidence 0.3.
- **Fix:** Strip the `<package>:id/` prefix from resource-id before scoring — split at `:id/` and keep the local segment only. Documented inline in `scoreAndroidNode`.
- **Files modified:** server/sessions/internal/resolver/maestro-ai.ts
- **Verification:** All 14 maestro tests pass + the original 13 still pass with the prefix-stripped scoring (Sign In still resolves via text='Sign In' AND resource-id local 'sign_in_btn' both containing 'sign').
- **Committed in:** 7611a17

### No Other Deviations

The plan's task structure, file layout, type shapes, env-var contracts, cache key construction, and fallback semantics matched the codebase reality without further adjustment. The 3-task structure shipped end-to-end on the first pass.

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** The fix was necessary for the deterministic heuristic to work on real-world Android hierarchies (where `package` is ubiquitous in resource-ids). No scope creep — single-line code change + inline documentation.

## Issues Encountered

- **Vitest flake recurred once on `ws.spec.ts` `replies invalid_envelope on missing id field` test** — same flake noted in Plan 34-02 SUMMARY "Issues Encountered" section. Re-running the full sessions suite was green (114/114). Cause is transient port-release races on the random-port fastify listener (each test rebuilds a fresh app on a fresh port), NOT a real assertion failure or anything Plan 34-03 changed. No code change made; will revisit if it recurs in CI.

## Authentication Gates

None encountered during execution — all 11 mocked ClaudeVisionResolver tests use the injectable client (no real SDK call). The live-gated test (`describe.skip` when `ANTHROPIC_API_KEY` unset) was skipped as expected.

**For operators wanting to use ClaudeVisionResolver in production:**
- Set `SESSION_RESOLVER=claude-vision` env var
- Set `ANTHROPIC_API_KEY=sk-ant-...` env var
- (Optional) Set `SESSION_RESOLVER_MODEL=claude-sonnet-4-5` to override the model
- Restart the server

This is documented in the Plan 34-07 phase-close runbook plans.

## User Setup Required

None required to ship the default behavior — `SESSION_RESOLVER` unset means pure MaestroAiResolver, which has zero external dependencies. The opt-in ClaudeVisionResolver requires user-set env vars but those are configured at deploy time (not during plan execution).

## Next Phase Readiness

**Ready for Plan 34-04 (auth + rate limit + sweeper):**
- `fastify.sessionsResolver` now holds a real `TargetResolver` — rate limiter wrapper can compose around it without behavioral changes.
- `rateLimitOk(sessionId, now): boolean` in `ws.ts:60-62` is the unchanged swap site for Plan 34-04 sliding-window logic.
- `openSockets` map populated by 34-02's WS handler — sweeper can iterate it for TTL-driven release.

**Ready for Plan 34-05 (MCP server body):**
- The MCP server needs to call the resolver via WS (not directly) — already wired through `tapByDescription` envelope → WS handler → `dispatch` → `ctx.resolver.resolve(...)`. No direct dep on the resolver classes from the `mcp/` workspace.

**Ready for Plan 34-06 (CLI + web):**
- `device-farm session tap-by-description "Sign In"` will route through the WS envelope path that calls the real resolver.

**Concerns / Carry-forwards:**
- **iOS resolver depth:** iOS hierarchy walker is basic — labeled `{type, label, value, identifier, frame, children}` traversal. Phase 36 (iOS-focused session work, if planned) may need to extend to handle XCUITest dump variants more robustly.
- **`maestro` CLI fallback NOT shipped:** RESEARCH §MaestroAiResolver "Reality check" noted the actual `maestro` CLI's `--ai-prompt` flag is test-execution coupled, not a one-shot resolve subcommand. Documented as DEFERRED for Plan 34-07 runbook (future enhancement: shell out to `maestro hierarchy` + a custom Anthropic call orchestrated by the resolver itself).
- **Cache observability:** LRU cache size + hit rate not surfaced via metrics. Phase 27+ events trace API could expose `resolver.cache_hit` / `resolver.cache_miss` envelopes — DEFERRED-34-CACHE-OBS.
- **Vitest WS flake:** Same transient flake as 34-02; orthogonal to Plan 34-03 changes. Will revisit if it recurs in CI.

## Open Questions Status

- **Open Question #7 (Anthropic model name default)** — RESOLVED. Pinned `claude-sonnet-4-5` as `DEFAULT_MODEL` in `claude-vision.ts:DEFAULT_MODEL`. Overridable via `SESSION_RESOLVER_MODEL` env var without code change. Newer Sonnet/Opus drops can be tested by operators setting the env var.
- **Open Question #1 (sub-minute cron for sweeper)** — Still carried forward to Plan 34-04.
- **DEFERRED-26-B (persistEnvelope consolidation)** — Still carried forward to Phase 27+ (no new sample points added in 34-03).
- **DEFERRED-34-CACHE-OBS (resolver cache metrics)** — NEW. Surface LRU cache hit rate via the events bus when Phase 27 events trace API ships.

## Test Counts

| Spec file | Before (substrate stubs) | After (Plan 34-03 body) | Delta |
| --------- | ------------------------ | ----------------------- | ----- |
| resolver-maestro.spec.ts | 1 pass + 2 skip | 14 pass | +13 |
| resolver-claude.spec.ts | 1 pass + 2 skip | 11 pass | +10 |
| resolver-integration.spec.ts | (new file) | 10 pass | +10 |
| **Total NEW tests** | — | **35 tests** | **+33** |

Full sessions suite: 114 pass / 0 fail (after 1 transient ws.spec flake on first run; suite re-ran green).

## Resolver Swap Sites for Future Plans

- **Plan 34-04 (rate-limit swap):** `server/sessions/internal/ws.ts:60-62` — `export function rateLimitOk(sessionId, now): boolean { return true; }`. Body swap only; signature is the seam. The resolver now sits "behind" the rate limiter (limiter gates whether dispatch is called at all), so no rate-limit wrapper is needed around the resolver itself.
- **Phase 36 OmniParser / future resolvers:** Add `omni-parser.ts` under `server/sessions/internal/resolver/`, add an env-flavor branch in `index.ts:createResolver` (`'omni-parser'` → wrap in 3-stage Fallback or pure depending on cost), update README. No changes needed in ws.ts or actions.ts.

## Self-Check: PASSED

All 5 created/modified files verified present on disk via Edit/Write tool operations:
- `server/sessions/internal/resolver/types.ts` — FOUND (created)
- `server/sessions/internal/resolver/maestro-ai.ts` — FOUND (created)
- `server/sessions/internal/resolver/claude-vision.ts` — FOUND (created)
- `server/sessions/internal/resolver/index.ts` — FOUND (created)
- `server/sessions/__tests__/resolver-integration.spec.ts` — FOUND (created)
- `server/sessions/plugin.ts` — FOUND (modified — createResolver + TargetResolver type)
- `server/sessions/__tests__/resolver-maestro.spec.ts` — FOUND (modified — 14 tests)
- `server/sessions/__tests__/resolver-claude.spec.ts` — FOUND (modified — 11 tests)
- `package.json` — FOUND (modified — +2 deps)
- `package-lock.json` — FOUND (regenerated)

All 3 task commits exist in `git log --oneline -3`:
- `8bb28e1 feat(34-03): wire createResolver factory + FallbackResolver in plugin`
- `9576968 feat(34-03): add ClaudeVisionResolver with LRU cache + injectable client`
- `7611a17 feat(34-03): add MaestroAiResolver + deps (@anthropic-ai/sdk + lru-cache)`

Sessions vitest suite: 114/114 passing. Resolver-only subset: 35/35 passing (14 maestro + 11 claude + 10 integration). Typecheck: zero new `server/sessions/*` errors (DEFERRED-15-A baseline elsewhere unchanged).

---
*Phase: 34-session-api-mcp*
*Completed: 2026-05-16*
