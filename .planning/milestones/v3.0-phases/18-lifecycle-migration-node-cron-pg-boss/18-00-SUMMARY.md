---
phase: 18-lifecycle-migration-node-cron-pg-boss
plan: 00
subsystem: queue
tags: [pg-boss, zod, dependency-cruiser, correlation-id, lifecycle, substrate]

# Dependency graph
requires:
  - phase: 15-foundations
    provides: pg-boss queue plugin (server/queue/plugin.ts), QUEUE_NAMES registry, correlation plugin + ALS infrastructure
  - phase: 16-pilot-module-hooks
    provides: module pattern (internal/ directory + barrel index.ts, dep-cruiser MOD-02 rule, schemas.ts Zod source-of-truth convention)
provides:
  - QUEUE_NAMES extended with 3 lifecycle queue names (LIFECYCLE_COMPRESS_DAILY, LIFECYCLE_RETENTION_DAILY, LIFECYCLE_DISK_HOURLY)
  - queue.schedule Option B per-fire correlationId fix (JobEnvelope widened to string | null; envelope stored with correlationId:null; queue.work generates fresh UUID each fire)
  - server/lifecycle/schemas.ts — Zod source-of-truth for lifecycle queue payload + task result shapes
  - .dependency-cruiser.cjs extended with no-deep-imports-into-lifecycle-internal rule
  - __fixtures__/dep-cruiser/bad-lifecycle-deep-import.ts + paired spec assertion
affects: [18-01-events, 18-02-queue-worker, 18-03-module-factory, 18-04-plugin-swap, phase-20+ any module that schedules recurring jobs]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Phase 18 Option B per-fire correlationId — scheduled queue envelopes store correlationId:null, queue.work generates fresh UUID on each dispatched fire for trace-isolation (vs. inheriting ONE id stamped at registration)"
    - "schemas.ts as Zod source-of-truth (SPEC-01/03) — module's queue payload + result shapes live in a single parse-at-boundary file, events.ts + queue.ts + worker handler import from here; existing TS interfaces in task files preserved as back-compat surface"
    - "Dep-cruiser denylist rule paired with fixture + spec — when rule target directory doesn't yet exist (module pattern rolls out across multiple plans), commit a 4-line stub at server/<module>/internal/module.ts so depcruise can resolve the fixture's import and fire the rule; later plan overwrites the stub"

key-files:
  created:
    - server/lifecycle/schemas.ts
    - server/lifecycle/internal/module.ts
    - __fixtures__/dep-cruiser/bad-lifecycle-deep-import.ts
  modified:
    - server/queue/names.ts
    - server/queue/plugin.ts
    - server/queue/__tests__/plugin.spec.ts
    - .dependency-cruiser.cjs
    - server/hooks/__tests__/dep-cruiser.spec.ts

key-decisions:
  - "queue.schedule fix uses Option B (envelope.correlationId:null + queue.work fallback) instead of wrapping each fire (which would require pg-boss-side hooks). One-line change inside schedule() body; queue.work's existing `data.correlationId ?? randomUUID()` fallback (line 159) does the per-fire UUID generation without any new code path"
  - "JobEnvelope.correlationId widened from `string` to `string | null` (explicit type widening, not a `null as never` cast) — cleanest representation of the two distinct call contexts: queue.send injects a string from ALS, queue.schedule stores null so queue.work generates per-fire"
  - "server/lifecycle/internal/module.ts committed as a 4-line stub so the dep-cruiser spec can resolve the fixture's import target TODAY, before plan 18-03 creates the real createLifecycleModule factory. Without the stub depcruise emits '1 module, 0 dependencies cruised' and the rule does not fire — empirically verified during task execution. Plan 18-03 overwrites this stub"
  - "Dep-cruiser describe block renamed from 'dependency-cruiser: no-deep-imports-into-hooks-internal' to 'dependency-cruiser: deep-import denylist rules' (pluralized) to accommodate both rules in the same describe without duplicating beforeEach/imports"

patterns-established:
  - "TDD for substrate fixes — Task 0.2 committed RED test first (1c92e59) then GREEN fix (7522316). Test would have passed with either old or new behaviour without the per-fire assertion; the explicit null check locks the invariant against regression"
  - "Plan 18 schemas.ts coexists with existing task-file interfaces — CompressionResult (back-compat consumer surface) + CompressionResultParsed (Zod-derived, used at boundary) live side-by-side until plan 18-03 swaps consumers; no breaking change to existing 3 task files"

requirements-completed: [QUEUE-08]

# Metrics
duration: 11min
completed: 2026-04-20
---

# Phase 18 Plan 00: Substrate (QUEUE_NAMES + per-fire correlationId + lifecycle schemas + dep-cruiser rule) Summary

**Phase 18 substrate scaffold — three lifecycle queue names registered, QUEUE-08 per-fire correlationId bug fixed in queue.schedule (Option B), Zod schemas.ts source-of-truth landed, dep-cruiser MOD-02 rule extended to lifecycle/internal with fixture + spec assertion.**

## Performance

- **Duration:** 11 min
- **Started:** 2026-04-20T21:56:39Z
- **Completed:** 2026-04-20T22:07:44Z
- **Tasks:** 4 (1 TDD)
- **Files modified:** 5 modified + 3 created = 8 files

## Accomplishments

- `QUEUE_NAMES` now exports 5 entries (added `LIFECYCLE_COMPRESS_DAILY`, `LIFECYCLE_RETENTION_DAILY`, `LIFECYCLE_DISK_HOURLY` — all match `^[a-z][a-z0-9._-]*$` enforced by `isValidQueueName`); dot-separation matches codebase convention (same as `hook.run`)
- QUEUE-08 closed: `queue.schedule` stores envelope with `correlationId: null`; `queue.work`'s existing `data.correlationId ?? randomUUID()` fallback now generates a fresh UUID on every dispatched fire, giving per-fire trace isolation (previously every scheduled fire inherited ONE id stamped at registration — RESEARCH §Pitfall 3)
- SPEC-01/03 foundation: `server/lifecycle/schemas.ts` exports `lifecycleJobPayloadSchema` (kind enum + triggeredAt ISO datetime) plus three Zod result schemas (compression/retention/diskPressure) + four inferred TS types
- MOD-02 extended: `.dependency-cruiser.cjs` has 3 forbidden rules (was 2); new `no-deep-imports-into-lifecycle-internal` mirrors the hooks rule; fixture `__fixtures__/dep-cruiser/bad-lifecycle-deep-import.ts` + paired spec block (`[MOD-02 lifecycle extension]`) lock the rule structurally; `npm run dep-check` passes (193 modules, 399 deps, 0 violations)

## Task Commits

Each task was committed atomically:

1. **Task 0.1: Extend QUEUE_NAMES with three lifecycle queue name constants** — `8b51430` (feat)
2. **Task 0.2: Fix per-fire correlationId in queue.schedule (TDD)**
   - RED: `1c92e59` (test — failing spec proves UUID-at-registration bug)
   - GREEN: `7522316` (feat — Option B fix: envelope.correlationId:null + JobEnvelope type widened)
3. **Task 0.3: Create server/lifecycle/schemas.ts** — `1f389e9` (feat)
4. **Task 0.4: Extend .dependency-cruiser.cjs with lifecycle/internal denylist + fixture + spec** — `9f41f7c` (feat)

## Files Created/Modified

### Created

- `server/lifecycle/schemas.ts` (54 lines) — Zod source-of-truth: `lifecycleJobPayloadSchema`, `compressionResultSchema`, `retentionResultSchema`, `diskPressureResultSchema` + 4 inferred types
- `server/lifecycle/internal/module.ts` (4 lines) — stub so dep-cruiser can resolve fixture's import; plan 18-03 overwrites with real `createLifecycleModule`
- `__fixtures__/dep-cruiser/bad-lifecycle-deep-import.ts` (20 lines) — intentionally invalid fixture importing from `server/lifecycle/internal/module.js`

### Modified

- `server/queue/names.ts` — `QUEUE_NAMES` extended with 3 entries; doc comment updated to record Phase 18 addition
- `server/queue/plugin.ts` — `JobEnvelope.correlationId` widened from `string` to `string | null`; `schedule()` body stores `correlationId: null` (was `randomUUID()`); schedule interface doc comment updated with Option B rationale
- `server/queue/__tests__/plugin.spec.ts` — added `describe('queue.schedule per-fire correlationId (Phase 18-00)')` block with 2 tests (null-envelope + ALS-preserved)
- `.dependency-cruiser.cjs` — added `no-deep-imports-into-lifecycle-internal` forbidden rule (2nd in array); file header updated to "Three forbidden rules"
- `server/hooks/__tests__/dep-cruiser.spec.ts` — describe renamed to "deep-import denylist rules"; added 2nd it-block `[MOD-02 lifecycle extension]`

## Diffs

### `server/queue/names.ts`

```diff
-export const QUEUE_NAMES = {
-  DEMO: 'demo',
-  HOOK_RUN: 'hook.run',
-} as const;
+export const QUEUE_NAMES = {
+  DEMO: 'demo',
+  HOOK_RUN: 'hook.run',
+  LIFECYCLE_COMPRESS_DAILY:  'lifecycle.compress.daily',
+  LIFECYCLE_DISK_HOURLY:     'lifecycle.disk.hourly',
+  LIFECYCLE_RETENTION_DAILY: 'lifecycle.retention.daily',
+} as const;
```

### `server/queue/plugin.ts` — JobEnvelope widening

```diff
 interface JobEnvelope {
-  correlationId: string;
+  correlationId: string | null;
   causationId: string | null;
   actor: string;
   payload: unknown;
 }
```

### `server/queue/plugin.ts` — schedule() body

```diff
 async schedule(name, cron, data = {}, opts = {}) {
   if (!isValidQueueName(name)) {
     throw new Error(`Invalid queue name: ${name}`);
   }
-  // Schedules fire without an inbound request — generate a fresh correlationId
-  // + tag `actor='cron'` so logs from scheduled ticks still have a correlation.
+  // Phase 18 / QUEUE-08 — Option B per-fire correlationId:
+  // Store the envelope with correlationId:null so that queue.work generates
+  // a fresh randomUUID() on every dispatched fire.
   const envelope: JobEnvelope = {
-    correlationId: randomUUID(),
+    correlationId: null,
     causationId: null,
     actor: 'cron',
     payload: data,
   };
   await boss.schedule(name, cron, envelope as never, opts);
 },
```

### `.dependency-cruiser.cjs`

```diff
 module.exports = {
   forbidden: [
     { name: 'no-deep-imports-into-hooks-internal', /* ... */ },
+    {
+      name: 'no-deep-imports-into-lifecycle-internal',
+      severity: 'error',
+      from: { pathNot: '^server/lifecycle/' },
+      to:   { path:    '^server/lifecycle/internal/' },
+    },
     { name: 'no-direct-bus-emit-outside-events-ts', /* ... */ },
   ],
   /* ... */
 };
```

## Verification Results

### `npx vitest run server/queue/__tests__/ server/hooks/__tests__/dep-cruiser.spec.ts`

```
Test Files  8 passed (8)
     Tests  21 passed (21)
  Duration  2.49s
```

Includes:
- `plugin.spec.ts` — 5 passed (3 pre-existing shape tests + 2 new Phase 18-00 tests)
- `als.spec.ts` — 1 passed (ALS → job.data still works)
- `als-crossqueue.spec.ts` — 1 passed (full request → queue → worker ALS restore still works)
- `names.spec.ts` — 6 passed (QUEUE_NAMES registry + charset invariant)
- `retry-policy.spec.ts`, `migration.spec.ts`, `shutdown.spec.ts` — pre-existing, all green
- `dep-cruiser.spec.ts` — 2 passed (hooks rule + NEW lifecycle rule)

### `npm run dep-check`

```
✔ no dependency violations found (193 modules, 399 dependencies cruised)
```

(Was 178 modules in plan 16-03. +15 modules includes `server/lifecycle/internal/module.ts` stub + Phase 17 vendored files + any minor drift.)

### `server/lifecycle/schemas.ts` — exported symbols

```
lifecycleJobPayloadSchema     (Zod object, kind enum + triggeredAt ISO)
compressionResultSchema       (Zod object, compressed + savedBytes)
retentionResultSchema         (Zod object, deleted + freedBytes)
diskPressureResultSchema      (Zod object, currentUsageBytes + maxBytes + deleted + freedBytes)
LifecycleJobPayload           (z.infer type)
CompressionResultParsed       (z.infer type)
RetentionResultParsed         (z.infer type)
DiskPressureResultParsed      (z.infer type)
```

Schema smoke-test verified valid input accepted and invalid input rejected (invalid enum + non-ISO datetime + negative numbers).

## Decisions Made

- **Option B over Option A for the queue.schedule fix** — Wrapping each fire with an interceptor would require pg-boss-side hooks not exposed in v12. Option B (envelope.correlationId:null + queue.work fallback) is a one-line change that leverages the existing fallback path at plugin.ts:159.
- **Widen `JobEnvelope.correlationId` to `string | null` explicitly** rather than `null as never` cast — cleanest type representation; both call sites (`queue.send` injects string from ALS, `queue.schedule` stores null) are now type-accurate.
- **Ship stub `server/lifecycle/internal/module.ts` in this plan** — Dep-cruiser needs to resolve the fixture import target to fire the rule (empirically verified: without the stub depcruise emits "1 module, 0 dependencies cruised" and the rule silently does not match). Plan 18-03 overwrites this stub with the real `createLifecycleModule` factory; no back-compat contract broken because the symbol is a never-returning placeholder.
- **Rename dep-cruiser describe block** from singular "no-deep-imports-into-hooks-internal" to plural "deep-import denylist rules" — accommodates both rules in one describe without duplicating beforeEach/imports.
- **Keep task-file interfaces intact** — `CompressionResult`, `RetentionResult`, `DiskPressureResult` in the three `server/lifecycle/*-task.ts` files left untouched; schemas.ts adds `*ResultParsed` Zod-derived types as the parse-at-boundary counterparts. Plan 18-03 migrates consumers; this plan does not touch runtime lifecycle code.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Created `server/lifecycle/internal/module.ts` stub to unblock dep-cruiser spec**
- **Found during:** Task 0.4 (dep-cruiser spec run)
- **Issue:** The plan's primary path assumed depcruise would match the forbidden rule by import-string regex alone, without needing the target file to exist. Empirical check: depcruise emitted `1 module, 0 dependencies cruised` because its resolver silently dropped the unresolvable import — the rule never fired and the test failed.
- **Fix:** Created `server/lifecycle/internal/module.ts` as a 4-line stub (the plan explicitly anticipated this fallback and documented the file contents).
- **Files modified:** `server/lifecycle/internal/module.ts` (new file)
- **Verification:** After creation, both dep-cruiser tests pass (hooks rule + lifecycle rule); `npm run dep-check` exits 0 on the committed tree (the stub file is inside `server/lifecycle/` so the `from: { pathNot: '^server/lifecycle/' }` clause exempts it).
- **Committed in:** `9f41f7c` (Task 0.4 commit)
- **Note:** This was a planned fallback, not a surprise — the plan's Step 4 explicitly documented both the primary "no-stub" path and the fallback "create stub" path and said "IF depcruise errors with MODULE_NOT_FOUND-class fatal that prevents the rule from firing (empirical behaviour — verify during execution), fallback: create a minimal stub".

---

**Total deviations:** 1 auto-fixed (1 blocking, pre-authorized by plan's fallback path)
**Impact on plan:** Zero scope creep. The stub is pre-authorized by the plan and will be overwritten by plan 18-03.

## Issues Encountered

None — plan's fallback path handled the dep-cruiser resolution behaviour cleanly. No additional debugging required.

## User Setup Required

None — no external service configuration required. The per-fire correlationId fix is transparent to all existing callers (schedules that were already running will emit fresh UUIDs on their next fire, which is strictly better trace hygiene than the previous inherited-UUID behaviour).

## Next Phase Readiness

All four Wave 0 substrate pieces in place for plans 18-01..18-04:
- Plan 18-01 (events.ts) can import `compressionResultSchema`, `retentionResultSchema`, `diskPressureResultSchema` from `server/lifecycle/schemas.ts` and extend them with `durationMs` for event payloads.
- Plan 18-02 (queue.ts / worker) can import `QUEUE_NAMES.LIFECYCLE_COMPRESS_DAILY` / `LIFECYCLE_RETENTION_DAILY` / `LIFECYCLE_DISK_HOURLY` + `lifecycleJobPayloadSchema` from schemas.ts.
- Plan 18-03 (module factory) can create `server/lifecycle/internal/*` without regression risk — dep-cruiser rule already enforces the deep-import boundary. Plan 18-03 must overwrite the stub `server/lifecycle/internal/module.ts` with the real `createLifecycleModule(deps): LifecycleModule` factory.
- Plan 18-04 (plugin swap) can replace `node-cron` with three `queue.schedule(QUEUE_NAMES.LIFECYCLE_*, cron, {kind, triggeredAt})` calls that now benefit from per-fire correlationId isolation.

No Phase 18 runtime code (`server/lifecycle/lifecycle-plugin.ts`, `compression-task.ts`, `retention-task.ts`, `disk-pressure-task.ts`) touched in this plan — old node-cron plugin keeps running until 18-03 swaps.

---
*Phase: 18-lifecycle-migration-node-cron-pg-boss*
*Completed: 2026-04-20*

## Self-Check: PASSED

All claimed files exist:
- `server/queue/names.ts` (modified) — FOUND
- `server/queue/plugin.ts` (modified) — FOUND
- `server/queue/__tests__/plugin.spec.ts` (modified) — FOUND
- `server/lifecycle/schemas.ts` (created) — FOUND
- `server/lifecycle/internal/module.ts` (created) — FOUND
- `__fixtures__/dep-cruiser/bad-lifecycle-deep-import.ts` (created) — FOUND
- `.dependency-cruiser.cjs` (modified) — FOUND
- `server/hooks/__tests__/dep-cruiser.spec.ts` (modified) — FOUND

All task commits present in git log:
- 8b51430 (Task 0.1) — FOUND
- 1c92e59 (Task 0.2 RED) — FOUND
- 7522316 (Task 0.2 GREEN) — FOUND
- 1f389e9 (Task 0.3) — FOUND
- 9f41f7c (Task 0.4) — FOUND
