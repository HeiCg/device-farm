---
phase: 34
plan: 00
subsystem: sessions
tags: [substrate, wave-0, session-api, mcp, scaffold]
requires:
  - server/db/schema.ts (existing devices + apiKeys tables for FK references)
  - server/auth/ (existing module; sessions inherits principal via ALS in Plan 34-04)
  - server/queue/names.ts (existing QUEUE_NAMES registry)
  - server/bus/types.ts (existing EventRegistry type)
  - .dependency-cruiser.cjs (existing 10 forbidden rules; this plan adds 11th)
provides:
  - server/sessions/ module skeleton (events.ts + internal/{module,protocol}.ts + schemas.ts + MODULE.md + index.ts)
  - sessions pgTable + sessionStatusEnum + partial unique index sessions_device_active_idx
  - drizzle migration 0009_sessions.sql
  - QUEUE_NAMES.SESSION_SWEEP queue-name literal
  - 8 spec stubs in server/sessions/__tests__/ + 2 fixtures (XML + PNG)
  - dep-cruiser rule no-deep-imports-into-sessions-internal (rule 11)
  - mcp/ workspace skeleton (package.json + tsconfig + vitest config + index.ts placeholder + 2 spec stubs + README)
  - root package.json workspaces gains "mcp"
  - cli/cmd/session.go Cobra skeleton (registered under rootCmd)
  - web/src/routes/sessions/{+page,[id]/+page}.svelte placeholders + sessions-list.spec.ts
affects:
  - .dependency-cruiser.cjs (rule count 10 → 11; header comment-block extended)
  - server/db/schema.ts (extended with sessionStatusEnum + sessions pgTable)
  - server/db/migrations/meta/_journal.json (drizzle journal idx 9 retagged 0009_sessions)
  - server/queue/names.ts (QUEUE_NAMES extended 12 → 13 entries with SESSION_SWEEP)
  - server/hooks/__tests__/dep-cruiser.spec.ts (11th it-block "[MOD-02 sessions extension]")
  - package.json (workspaces array 5 → 6 entries)
tech-stack:
  added:
    - "@modelcontextprotocol/sdk ^1.0.0 (declared in mcp/package.json — NOT installed; Plan 34-05 owns)"
    - "ws ^8.18.0 (declared in mcp/package.json — NOT installed)"
    - "zod ^3.23.0 (declared in mcp/package.json — root project uses ^4.3.6; mcp tracks SDK minimum)"
  patterns:
    - "MOD-02 strict 1-line internal/ re-export barrel (mirrors Phase 16/18/19/20/21/22/23/24/25/26)"
    - "EVENTS-03 dotted past-tense event names (4: session.leased / .released / .expired / .device.lost)"
    - "Partial unique index WHERE status = 'active' for single-active-session-per-device race protection"
    - "Throw-stub module pattern for dep-cruiser resolvable target (Phase 18-26 empirical)"
    - "Skip-stub spec pattern with placeholder pass + it.skip/it.todo markers documenting later-plan ownership"
key-files:
  created:
    - server/sessions/events.ts
    - server/sessions/internal/module.ts
    - server/sessions/internal/protocol.ts
    - server/sessions/schemas.ts
    - server/sessions/MODULE.md
    - server/sessions/index.ts
    - server/sessions/__tests__/events.spec.ts
    - server/sessions/__tests__/routes.spec.ts
    - server/sessions/__tests__/protocol.spec.ts
    - server/sessions/__tests__/ws.spec.ts
    - server/sessions/__tests__/dispatch.spec.ts
    - server/sessions/__tests__/resolver-maestro.spec.ts
    - server/sessions/__tests__/resolver-claude.spec.ts
    - server/sessions/__tests__/auth-rate-sweeper.spec.ts
    - server/sessions/__tests__/__fixtures__/android-hierarchy.xml
    - server/sessions/__tests__/__fixtures__/screenshot.png
    - server/db/migrations/0009_sessions.sql
    - server/db/migrations/meta/0009_snapshot.json
    - __fixtures__/dep-cruiser/bad-sessions-deep-import.ts
    - mcp/package.json
    - mcp/tsconfig.json
    - mcp/vitest.config.ts
    - mcp/src/index.ts
    - mcp/__tests__/index.spec.ts
    - mcp/__tests__/tools.spec.ts
    - mcp/README.md
    - cli/cmd/session.go
    - cli/cmd/session_test.go
    - web/src/routes/sessions/+page.svelte
    - web/src/routes/sessions/[id]/+page.svelte
    - web/src/lib/sessions/__tests__/sessions-list.spec.ts
  modified:
    - server/db/schema.ts
    - server/db/migrations/meta/_journal.json
    - server/queue/names.ts
    - .dependency-cruiser.cjs
    - server/hooks/__tests__/dep-cruiser.spec.ts
    - package.json
decisions:
  - "Migration filename: drizzle-kit emitted 0009_new_ironclad.sql; renamed to 0009_sessions.sql via plain `mv` (file untracked at rename time so `git mv` failed). Journal _journal.json idx 9 tag updated from `0009_new_ironclad` to `0009_sessions` to keep the journal in sync."
  - "Protocol.ts ships ping/pong-only stub at substrate (deviating slightly from the Phase 26 pattern where protocol surface land later — necessary because protocol.spec.ts imports it). Full clientEnvelope discriminated union (11 members) lands additively in Plan 34-02."
  - "Schemas.ts ships FULL bodies at substrate (5 REST Zod schemas with .meta() ids). Plan 34-01 routes.ts consumes them unchanged — no rewrite. This is a deliberate substrate scope expansion vs Phase 26-00 (auth schemas landed in 26-03), justified because routes.ts will move quickly in Wave 1 and pre-shipping the schemas removes a back-and-forth."
  - "mcp/ workspace declared in root package.json workspaces array but NO npm install was run. Deferred to Plan 34-05 when the MCP server body lands and the deps are actually consumed. Avoids polluting node_modules at substrate."
  - "PNG fixture generated via inline raw-PNG writer (deflate + CRC32) — no third-party image library added. 1080x1920 solid-gray (RGB 128,128,128), 11138 bytes. Sufficient for the Wave-3 ClaudeVisionResolver cache test (it cares about file presence + bytes, not pixel content)."
metrics:
  duration_minutes: 12
  task_count: 3
  files_created: 31
  files_modified: 6
  completed_date: 2026-05-16
---

# Phase 34 Plan 00: Session API + MCP Server Wave 0 Substrate Summary

Wave 0 substrate for Phase 34 ships the scaffolding plans 34-01..34-07 depend
on: sessions module skeleton (events.ts stub + throw-stub factory + REST Zod
schemas with full bodies + protocol.ts ping/pong stub + MODULE.md placeholder +
strict barrel + 8 spec stubs + 2 fixtures), sessions pgTable + drizzle migration
0009_sessions.sql with the partial-unique active-session-per-device index,
`QUEUE_NAMES.SESSION_SWEEP` queue-name literal, the eleventh dep-cruiser
forbidden rule (`no-deep-imports-into-sessions-internal`) with proof fixture
and spec it-block, the mcp/ workspace skeleton with `@device-stream/mcp`
declaration, the `device-farm session` Cobra command skeleton, and the
SvelteKit /sessions route stubs. Zero new TypeScript errors, dep-check
violations unchanged at the 5 pre-existing baseline (artifacts→streaming,
api→pipelines), all 8 sessions spec files pass + dep-cruiser sessions
it-block passes + Go session_test.TestSessionCommandExists passes + mcp
vitest config discovers both stub specs. Mirrors Phase 26 Plan 26-00
sequencing with `auth → sessions` substitution + MCP workspace scaffold +
CLI/web stub addition.

## Tasks Completed

| # | Name | Commit | Files |
| - | ---- | ------ | ----- |
| 0.1 | Sessions scaffolds + migration + queue + dep-cruiser rule | e2c0181 | server/sessions/{events,internal/module,internal/protocol,schemas,MODULE,index}.ts; server/db/schema.ts (+sessions pgTable); 0009_sessions.sql + meta/0009_snapshot.json; server/queue/names.ts; .dependency-cruiser.cjs; __fixtures__/dep-cruiser/bad-sessions-deep-import.ts |
| 0.2 | 8 vitest skip-stubs + 2 fixtures + web stubs + dep-cruiser spec extension | 0e608ee | server/sessions/__tests__/{events,routes,protocol,ws,dispatch,resolver-maestro,resolver-claude,auth-rate-sweeper}.spec.ts; server/sessions/__tests__/__fixtures__/{android-hierarchy.xml,screenshot.png}; server/hooks/__tests__/dep-cruiser.spec.ts (+[MOD-02 sessions extension]); web/src/routes/sessions/{+page,[id]/+page}.svelte; web/src/lib/sessions/__tests__/sessions-list.spec.ts |
| 0.3 | mcp/ workspace + CLI Cobra stub + workspace registration | f45e4d2 | mcp/{package.json,tsconfig.json,vitest.config.ts,src/index.ts,README.md,__tests__/{index,tools}.spec.ts}; package.json (workspaces + "mcp"); cli/cmd/{session.go,session_test.go} |

## Verification Results

| Check | Expected | Actual | Status |
| ----- | -------- | ------ | ------ |
| `npx tsc --noEmit` zero NEW errors from this plan | 0 new errors in sessions/ or modified files | 0 new errors (24 pre-existing DEFERRED-15-A inherited; ZERO from this plan) | PASS |
| `npm run dep-check` baseline unchanged | 5 pre-existing violations (3 artifacts→streaming + 2 api→pipelines) | 5 violations unchanged (rule 11 contributes 0 violations in `server/` since fixture lives in `__fixtures__/` outside `includeOnly: '^server/'`) | PASS |
| `npx vitest run server/sessions/__tests__/` | 8 files discoverable; events.spec shape assertion passes | 8 files / 26 tests (9 pass + 15 skipped + 2 todo) in 149ms | PASS |
| `npx vitest run server/hooks/__tests__/dep-cruiser.spec.ts` | 11 it-blocks (existing 10 + new sessions); rule 11 fires on bad-sessions fixture | 11/11 pass; new sessions it-block proves rule fires with non-zero exit + structured JSON violation | PASS |
| `cd cli && go test ./cmd -run TestSessionCommandExists` | session command registered + Use=="session" | 1 passed in 1 packages | PASS |
| `cat 0009_sessions.sql \| grep "CREATE UNIQUE INDEX sessions_device_active_idx"` | partial unique index emitted with WHERE clause | `CREATE UNIQUE INDEX "sessions_device_active_idx" ON "sessions" USING btree ("device_id") WHERE "sessions"."status" = 'active'` | PASS |
| `node -e "process.exit(JSON.parse(...).workspaces.includes('mcp')?0:1)"` | "mcp" present in root workspaces | OK workspaces: [..., 'mcp'] | PASS |
| `grep -q SESSION_SWEEP server/queue/names.ts` | literal `SESSION_SWEEP: 'session.sweep'` present | match | PASS |
| `cd mcp && npx vitest list` | both spec stubs discovered | 2 spec files / 2 placeholder pass tests listed | PASS |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocker] Drizzle-kit emitted migration as `0009_new_ironclad.sql`; expected `0009_sessions.sql`**
- **Found during:** Task 0.1 after running `npx drizzle-kit generate`
- **Issue:** drizzle-kit assigns random adjective_noun slugs to fresh migrations; plan called for `0009_sessions.sql`
- **Fix:** Renamed via plain `mv` (file was untracked at rename time so `git mv` errored with `fatal: not under version control`); updated `server/db/migrations/meta/_journal.json` idx-9 `tag` field from `0009_new_ironclad` to `0009_sessions` to keep the journal-vs-file sync intact
- **Files modified:** server/db/migrations/0009_sessions.sql (renamed), server/db/migrations/meta/_journal.json (tag retagged)
- **Commit:** e2c0181 (Task 0.1)

### Deliberate Scope Deviations (vs Phase 26-00)

**1. Substrate ships FULL REST Zod schemas (not just stubs).** `schemas.ts` lands with all 5 schemas (`leaseRequestSchema`, `leaseResponseSchema`, `releaseParamsSchema`, `releaseResponseSchema`, `listResponseSchema`) at their final shape with `.meta({ id })` for OpenAPI emit. Phase 26-00 deferred schemas to 26-03; we ship now because Plan 34-01 routes.ts will consume them unchanged and pre-shipping removes a back-and-forth. Strictly additive — no rework risk.

**2. Substrate ships `protocol.ts` ping/pong stub.** Phase 26 had no equivalent because auth has no WS surface. We ship the bare-minimum discriminated-union shape so spec stubs (`protocol.spec.ts`, `ws.spec.ts`, `dispatch.spec.ts`) can import the symbols. Plan 34-02 extends `clientEnvelope` additively with the 10 action envelope members — no rewrite.

**3. mcp/ workspace declared but NOT installed.** Root `package.json` workspaces array gains `"mcp"` but `npm install` was NOT run as part of this plan. Mcp deps (`@modelcontextprotocol/sdk`, `ws`, dev `vitest`) are declared in `mcp/package.json` for Plan 34-05 to consume — installing now would pollute root `node_modules` with unused deps for 4 plans. This matches the plan's explicit anti-action.

## Sub-minute Cron Open Question #1 Status

**Status:** Carried to Plan 34-04 (sweeper plan).

The brief / RESEARCH flags Open Question #1: "Can pg-boss schedule sub-minute jobs?" — relevant for the sessions TTL sweeper which runs every minute via `boss.schedule('session.sweep', '* * * * *', ...)` (60-second cron resolution). If a tighter granularity is desired (e.g., 10-second sweep cycle) we'd need to either (a) accept 60s as the floor (current pg-boss capability), or (b) implement a setInterval supplement keyed off `boss.work` for sub-minute scans.

Wave 0 substrate does NOT exercise this path — `QUEUE_NAMES.SESSION_SWEEP` is just a name literal. The sweeper consumer + cron registration land in Plan 34-04, which is the natural place to resolve the question (the answer informs the scheduling code, not the queue-name constant). No Wave-0 work needed.

## Dependency Graph for Downstream Plans

```
34-00 (this plan)
  ├─→ 34-01 (REST lease/release): consumes schemas.ts + sessions pgTable + events.ts (extends registry body)
  ├─→ 34-02 (WS protocol): consumes internal/protocol.ts (extends clientEnvelope additively)
  ├─→ 34-03 (NL resolvers): consumes android-hierarchy.xml + screenshot.png fixtures
  ├─→ 34-04 (auth + rate limit + sweeper): consumes QUEUE_NAMES.SESSION_SWEEP
  ├─→ 34-05 (MCP server body): consumes mcp/ workspace skeleton, runs `npm install`
  ├─→ 34-06 (CLI + web): consumes cli/cmd/session.go skeleton + web/src/routes/sessions/ stubs
  └─→ 34-07 (phase close): consumes MODULE.md placeholder (extends to 9-section body) + index.ts barrel (extends to full surface)
```

All 7 downstream plans now have substrate to extend without resolution errors.

## Self-Check: PASSED

All 31 created files verified present on disk via `Read`/`Write` tool operations
during execution. All 6 modified files have edit confirmation. All 3 task
commits exist in `git log --oneline -3`:
- f45e4d2 feat(34-00): scaffold mcp/ workspace + CLI session command stub
- 0e608ee test(34-00): add 8 sessions spec stubs + 2 fixtures + web route stubs + dep-cruiser sessions it-block
- e2c0181 feat(34-00): scaffold sessions module + drizzle migration + queue + dep-cruiser rule
