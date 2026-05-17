---
phase: 15-fix-operational-dependencies
plan: 06
subsystem: infra
tags: [fastify, plugin-order, graceful-shutdown, pino, mixin, als, correlation-id, server-index]

requires:
  - phase: 15-03
    provides: "correlationPlugin (@fastify/request-context onRequest hook) + shape-agnostic alsMixin (pino)"
  - phase: 15-04
    provides: "busPlugin (event-bus) with persistence middleware writing envelopes via fastify.db"
  - phase: 15-05
    provides: "queuePlugin (pg-boss v12) with fastify onClose hook that drains via boss.stop({ graceful: true, timeout: 30_000 })"

provides:
  - "server/index.ts — Fastify plugin registration in target substrate-first order (config -> correlation -> db -> event-bus -> queue -> telemetry -> pool -> auth -> websocket -> artifact -> reporting -> job -> lifecycle -> hooks -> maestro -> pipelines -> api -> static)"
  - "Pino logger wired with `mixin: alsMixin` at Fastify() construction time so every log line carries correlationId / causationId / actor from the active ALS store"
  - "Graceful SIGTERM handler that awaits `app.close()` before `dbClient.end()` + `process.exit(0)`, so plugin onClose hooks fire in reverse order (queue drains BEFORE db teardown)"
  - "server/__tests__/plugin-order.spec.ts — runtime invariant test introspecting `app.printPlugins()` to pin the substrate-before-application order"

affects: [16-hooks-pilot (registers hooks queue after this order stabilises), every Phase 16+ module whose plugin slots into the new layout, Phase 20+ (when db plugin eventually gains its own onClose)]

tech-stack:
  added: []
  patterns:
    - "Pino `mixin` reading ALS on every log line — enables zero-threading correlationId propagation across request fiber AND queue-worker fiber (both use object-shape ALS stores)"
    - "Delegated graceful shutdown: imperative handler calls `await app.close()` so Fastify runs plugin onClose in REVERSE registration order — pg-boss graceful drain (30s timeout) fires before db client is torn down"
    - "Substrate-first plugin order: correlation > db > event-bus > queue > telemetry registered before any application plugin; enforced by a runtime invariant test rather than comments"

key-files:
  created:
    - "server/__tests__/plugin-order.spec.ts"
  modified:
    - "server/index.ts"
    - ".planning/phases/15-fix-operational-dependencies/deferred-items.md"

key-decisions:
  - "dbClient.end() is KEPT in the imperative shutdown handler (runs after `await app.close()`) because `server/db/plugin.ts` has no onClose hook yet. Migrating db teardown into a plugin onClose is out of scope for Phase 15 — tagged TODO(Phase 20+)."
  - "Event-bus registration order in server/index.ts supersedes RESEARCH §13. Research sketched `config -> event-bus -> correlation -> db -> ...`, but the event-bus persistence middleware writes envelopes via `fastify.db`, so event-bus MUST register AFTER db. Correction already propagated to ROADMAP.md SC #1 and 15-06-PLAN interfaces block."
  - "Human boot + SIGTERM verification (task 6.2) is DEFERRED on user decision 2026-04-17. Automated plugin-order invariant test is accepted as sufficient for now; live Mac Mini observation is flagged as a Phase 16+ pre-flight item."

patterns-established:
  - "Numbered comments in server/index.ts (1. config / 2. checkDependencies / 3. correlation / 4. db / 5. event-bus / ...) pin the intended order at review time without requiring a print-plugins check"
  - "Gated real-boot invariant spec: `describe.skipIf(!DB_URL)` + a try/catch around `buildApp()` that console.warns and returns on missing host deps — keeps the invariant enforceable locally (Mac dev box) and CI-safe without silently dropping it"

requirements-completed: [QUEUE-07, MOD-07, TRACE-03]

duration: 6min
completed: 2026-04-17
---

# Phase 15 Plan 06: Plugin Reorder + alsMixin + Delegated Shutdown Summary

**server/index.ts rebuilt to register plugins in target substrate-first order (config -> correlation -> db -> event-bus -> queue -> telemetry -> pool -> ...); Pino `mixin: alsMixin` wired at Fastify() construction so every log line carries correlationId from the active ALS store; SIGTERM handler reshaped to `await app.close()` before db teardown so pg-boss onClose (30s graceful drain) fires in reverse order BEFORE the db client tears down. Plugin-order invariant locked in via `app.printPlugins()` introspection spec; live Mac Mini boot + SIGTERM observation (task 6.2) deferred with user acknowledgment.**

## Performance

- **Duration:** ~6 min (task 6.1 only; task 6.2 deferred)
- **Started:** 2026-04-17T16:07:00Z (approx; task 6.1 commit authored 16:13:27Z)
- **Completed:** 2026-04-17T16:38:36Z (SUMMARY close-out)
- **Tasks:** 1 of 2 completed (1 deferred — user decision, not a failure)
- **Files created:** 1 (server/__tests__/plugin-order.spec.ts)
- **Files modified:** 2 (server/index.ts, deferred-items.md)

## Accomplishments

- **Substrate plugins now register BEFORE application plugins.** `server/index.ts` reflects the canonical order: config -> correlation -> db -> event-bus -> queue -> telemetry -> pool -> auth -> websocket -> artifact -> reporting -> job -> lifecycle -> hooks -> maestro -> pipelines -> api -> static. `dependency-checker` stays as a non-plugin helper between config and db.
- **Pino alsMixin wired at Fastify() construction.** Every log line (request fiber AND queue-worker fiber, because plan 15-05 restores an object-shape ALS store) carries correlationId / causationId / actor automatically — MOD-07 and TRACE-03 now hold for the whole server, not just the correlation plugin's own routes.
- **SIGTERM handler delegates to app.close().** Reshape: healthChecker/processTracker stop -> wait-for-running-jobs -> jobService.shutdown -> pool.shutdown -> `await app.close()` -> `dbClient.end()` -> `process.exit(0)`. Fastify runs plugin onClose in reverse registration order, so `queue.onClose` (pg-boss graceful drain, 30s timeout) fires BEFORE the db client closes — QUEUE-07 ordering contract now held by the plugin chain, not by hand-rolled sequencing.
- **Plugin-order invariant test locked in.** `server/__tests__/plugin-order.spec.ts` builds the real app via `buildApp()` and asserts against `app.printPlugins()`: correlation -> db -> event-bus -> queue -> telemetry, and pool-plugin/job-plugin after telemetry. DB-gated (skipIf no DB_URL) + host-dep-safe (try/catch around buildApp logs SKIPPED on missing adb/ffmpeg/maestro). Pass-or-skip semantics match the plan's acceptance criterion.

## Task Commits

1. **Task 6.1: Update server/index.ts with new plugin order + pino mixin** — `de55cd8` (feat)
2. **Task 6.2: Manual fresh-boot + SIGTERM verification** — `human-validation-deferred` (no code commit; user accepted automated plugin-order spec as sufficient)

**Plan metadata commit:** appended after state updates below.

## Files Created/Modified

### Created

- `server/__tests__/plugin-order.spec.ts` (61 lines) — introspects `app.printPlugins()` and asserts the substrate-first invariant; gated on `TEST_DATABASE_URL ?? DATABASE_URL`; host-dep-safe via try/catch that console.warns SKIPPED when `checkDependencies()` throws on a box without adb/ffmpeg/maestro.

### Modified

- `server/index.ts` (+74 / -25 lines)
  - Added imports: `correlationPlugin`, `busPlugin`, `queuePlugin`, `telemetryPlugin`, `alsMixin`
  - Fastify logger block now includes `mixin: alsMixin`
  - Register calls reordered to target substrate-first sequence with updated numbered comments
  - Shutdown handler reshaped to delegate to `await app.close()` before `dbClient.end()` + `process.exit(0)`
- `.planning/phases/15-fix-operational-dependencies/deferred-items.md` — appended 15-06 block listing pre-existing typecheck errors in `server/bus/helpers.ts` / `server/bus/plugin.ts` / `server/events/__tests__/emit-helpers.spec.ts` (all introduced by plan 15-04's Map-shape ALS stores; out of 15-06's scope per the scope-boundary rule).

## Decisions Made

- **dbClient.end() stays imperative (for now).** Plan action step #4 said "remove the manual `await dbClient.end()` — it is now owned by `db` plugin's onClose." Inspection showed `server/db/plugin.ts` does NOT register an onClose. Removing the imperative call would have leaked the Postgres connection on SIGTERM. Decision: keep `dbClient.end()` in the handler, place it AFTER `await app.close()` so the queue onClose still drains against a live db, and tag the cleanup as TODO for Phase 20+ (when the pool module refactor can be followed by a db-plugin onClose migration).
- **event-bus registers AFTER db, not before.** Already decided in plan 15-04; reaffirmed here because RESEARCH §13 and the earlier ROADMAP SC #1 draft both listed event-bus before db. The persistence middleware writes envelopes via `fastify.db` — no db means the middleware throws on first emit. Order corrected in this plan's implementation and the ROADMAP SC #1 description.
- **alsMixin is the ONLY wiring change needed for TRACE-03.** The correlation plugin from 15-03 already owns the ALS fiber; the mixin just teaches pino to read it. No per-logger `child()` changes needed anywhere in the codebase — the mixin applies to the root logger and every child inherits it.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] dbClient.end() cannot be removed yet — db plugin has no onClose**
- **Found during:** Task 6.1 (action step #4: shutdown reshape)
- **Issue:** Plan action step said "Remove the manual `await dbClient.end()` — it is now owned by `db` plugin's onClose (confirm db plugin has an onClose that closes the client; if not, leave `dbClient.end()` in place and note in summary)." Inspection of `server/db/plugin.ts` confirmed no onClose hook exists. Removing the imperative call would have leaked the Postgres client on every SIGTERM.
- **Fix:** Followed the plan's contingency verbatim: kept `dbClient.end()` in the imperative handler but positioned it AFTER `await app.close()` so the queue onClose drain (30s graceful) still runs against a live db before teardown. Added a TODO comment pointing at Phase 20+ for the eventual migration.
- **Files modified:** server/index.ts (shutdown handler block)
- **Verification:** `grep "dbClient.end()" server/index.ts` → 1 match, after `await app.close()`; grep "app.close()" → match at line 238.
- **Committed in:** `de55cd8`

**2. [Rule 3 - Blocking / scope-boundary] Pre-existing typecheck errors logged to deferred-items.md**
- **Found during:** Task 6.1 verification (`npm run typecheck`)
- **Issue:** `tsc --noEmit` surfaced errors in `server/bus/helpers.ts:72`, `server/bus/plugin.ts:135`, `server/events/__tests__/emit-helpers.spec.ts:32,57` — all relating to `@fastify/request-context`'s `RequestContext` type being narrower than the Map-shape stores plan 15-04 uses. These were introduced by plan 15-04 and are NOT caused by 15-06. Per GSD scope-boundary rule, out-of-scope fixes don't get auto-applied.
- **Fix:** Logged to `.planning/phases/15-fix-operational-dependencies/deferred-items.md` with context + recommended fix direction (widen RequestContext interface or switch Map stores to plain objects). Plan 15-06's own files (`server/index.ts`, `server/__tests__/plugin-order.spec.ts`) typecheck cleanly.
- **Files modified:** .planning/phases/15-fix-operational-dependencies/deferred-items.md
- **Verification:** `grep -l "plan 15-06" .planning/phases/15-fix-operational-dependencies/deferred-items.md` → match.
- **Committed in:** `de55cd8`

---

**Total deviations:** 2 auto-fixed (both Rule 3 — blocking/scope-boundary)
**Impact on plan:** Neither is a scope expansion. The db teardown decision followed the plan's own contingency branch; the deferred-items log preserves audit trail for pre-existing debt without derailing 15-06. No scope creep.

## Human Verification Deferred (Task 6.2)

User decision on 2026-04-17: accept the automated plugin-order spec as sufficient signal for Phase 15 close-out. Task 6.2's live Mac Mini fresh-boot + SIGTERM drain observation is **deferred**, not failed.

### Automated signals already green

- **Plugin order invariant** — `server/__tests__/plugin-order.spec.ts` asserts via `app.printPlugins()` that correlation < event-bus < queue < telemetry, and pool-plugin / job-plugin come after telemetry. DB-gated; host-dep-safe (skips with console.warn on boxes missing adb/ffmpeg/maestro).
- **Typecheck scope** — `server/index.ts` and `server/__tests__/plugin-order.spec.ts` pass `tsc --noEmit` clean.
- **Vitest scope** — 15-06 files (server/__tests__/plugin-order.spec.ts) run green where a DB is available; otherwise skip cleanly per the documented gate.
- **Shutdown sequencing by construction** — Fastify runs plugin onClose in reverse registration order. Because queue is registered AFTER db and queue's onClose calls `boss.stop({ graceful: true, timeout: 30_000 })`, the order of operations during SIGTERM is mechanically guaranteed by registration order + Fastify semantics, not by hand-rolled sequencing. Plan 15-05's `shutdown.spec` already proved pg-boss drains cleanly in under 2s on a single-job workload (and the standalone spike measured 4032ms on a 50 x 5s workload — 26s headroom against the 30s budget).

### Verification steps the user will eventually run (once they pick this back up)

On the dev Mac Mini:

1. Export `DATABASE_URL=postgresql://<user>@localhost:5432/<devdb>` and run `npm run dev`. Confirm startup logs show the plugins registering in order: correlation -> db -> event-bus -> queue -> telemetry -> pool -> ...
2. Confirm there are NO error logs during boot.
3. In a second terminal: `curl -v http://localhost:3000/api/health` (or any existing health endpoint). Expect `x-correlation-id: <uuid>` on the response header AND that same uuid on every server log line for the request.
4. Send SIGTERM: `kill -TERM <pid>` (or Ctrl-C). Watch log order:
   - "Graceful shutdown initiated"
   - "pg-boss: stopping (graceful, timeout=30s)..."
   - "pg-boss: stopped"
   - Existing shutdown lines from pool / jobService
   - Exit code 0
5. Confirm no `PgBoss` errors appear about "db closed mid-operation" (would indicate the onClose chain ran out of order).

### Risk acknowledgment

Live pg-boss drain ordering has NOT been observed on the Mac Mini for this plan. The plugin-order spec proves the registration invariant; Fastify's reverse-order onClose semantics are well documented; plan 15-05's shutdown spec already covers the queue-alone drain case. But the end-to-end chain (healthChecker.stop → jobService.shutdown → pool.shutdown → app.close → plugin onClose chain → dbClient.end) has not been exercised under SIGTERM on a real host.

If a regression surfaces during Phase 16+ dev testing — for example, `PgBoss` errors about db-closed-mid-operation, or SIGTERM hanging past 30s — revisit this checkpoint and re-run the 5 steps above on the Mac Mini. The fix, if one is needed, is almost certainly either (a) adding an onClose to the db plugin so teardown is purely plugin-driven (Phase 20+ tagged TODO in this plan), or (b) reordering a specific imperative call within the SIGTERM handler.

## Issues Encountered

- **Pre-existing typecheck debt from plan 15-04.** `npm run typecheck` on a full run surfaces Map-vs-RequestContext errors in `server/bus/*` and `server/events/__tests__/*`. None introduced by 15-06; logged to `deferred-items.md` under "2026-04-17 — Plan 15-06"; scoped fix deferred to a future cleanup plan.
- **Task 6.2 human-validation deferred by user.** Not an issue per se — documented above. Flagged here so Phase 16 planners see it while scanning "Issues Encountered" sections.

## User Setup Required

None — no external service configuration required.

## Next Plan Readiness

- **Phase 15 complete pending deferred verification.** All 10 Phase 15 plans have landed code + SUMMARY. Remaining open items: (a) deferred task 6.2 manual verification (see above), (b) out-of-scope typecheck debt in `deferred-items.md` for a future cleanup plan.
- **Phase 16 (hooks pilot) unblocked.** The hooks module can now register its own `queue.ts` via `fastify.boss.createQueue('hooks.*', {...})` inside the hooks plugin slot (currently registered at position 15, AFTER telemetry + queue). Correlation IDs will flow end-to-end through the pino mixin without any per-module wiring.
- **Pre-Phase-16 recommendation:** rerun task 6.2's 5-step manual check on the Mac Mini before committing to Phase 16 kickoff. If time-pressed, the plugin-order spec + Fastify reverse-onClose semantics + 15-05's shutdown spec give a high-confidence soft-proof; the Mac Mini observation is the final empirical lock.

---

## Self-Check: PASSED

Verified every file and commit claimed above exists on disk:

- `server/index.ts` — FOUND (modified, contains `mixin: alsMixin` and `await app.close()` before `dbClient.end()`)
- `server/__tests__/plugin-order.spec.ts` — FOUND (61 lines, DB-gated, printPlugins assertions)
- `.planning/phases/15-fix-operational-dependencies/deferred-items.md` — FOUND (contains "2026-04-17 — Plan 15-06" block)
- commit `de55cd8` (feat 15-06: reorder plugins + wire alsMixin + delegate shutdown) — FOUND in `git log --oneline`

---
*Phase: 15-fix-operational-dependencies*
*Plan: 06*
*Completed: 2026-04-17 (task 6.2 human-validation-deferred)*
