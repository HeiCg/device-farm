---
phase: 18-lifecycle-migration-node-cron-pg-boss
verified: 2026-04-20T20:05:00Z
status: passed
score: 22/22 must-haves verified
requirements_covered: [QUEUE-08]
---

# Phase 18: Lifecycle Migration (node-cron → pg-boss) Verification Report

**Phase Goal:** Migrate the lifecycle housekeeping module to `boss.schedule()`; establish the correlationId-carrying `boss.send()` wrapper that every future scheduled job will use.

**Verified:** 2026-04-20T20:05:00Z
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| #   | Truth (ROADMAP SC)                                                                                                                                                                                                                                                                    | Status     | Evidence |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | -------- |
| SC1 | `node-cron` no longer imported by `server/lifecycle/*`; compression/retention/disk-pressure run via named pg-boss schedules (`lifecycle.compress.daily` / `lifecycle.retention.daily` / `lifecycle.disk.hourly`) with `singletonKey` + `policy:'stately'` preventing overlapping fires | ✓ VERIFIED | `grep -rn 'node-cron\|async-mutex' server/lifecycle/ --include="*.ts"` returns 0 matches. `server/lifecycle/queue.ts` registers 3 queues via `fastify.boss.createQueue` (lines 100, 135, 170) with `policy:'stately'` (line 93) + 3 schedules with `singletonKey: <queue-name>` (lines 105, 140, 175). Test: `server/lifecycle/__tests__/queue.spec.ts` `[RESEARCH §Pitfall 1]` proves stately dedup (send twice → 2nd returns null). |
| SC2 | `boss.send()` wrapper injects correlationId from ALS; consumers restore ALS; integration test proves schedule-triggered work carries correlationId scheduler→worker                                                                                                                    | ✓ VERIFIED | `server/queue/plugin.ts:145-161` (send) reads ALS via `asyncLocalStorage.getStore()` and stamps envelope.correlationId. `server/queue/plugin.ts:163-195` (work) restores ALS via `asyncLocalStorage.run(store, handler)`. `server/queue/plugin.ts:197-213` (schedule) stamps `correlationId: null` → per-fire fresh UUID via work() fallback line 183. Integration proof: `server/lifecycle/__tests__/correlation.spec.ts` tagged `[QUEUE-08 SC2]` + `[QUEUE-08 SC2 + Option B]` — two schedules, two distinct UUIDs, `expect(firstA).not.toBe(firstB)`. |
| SC3 | Lifecycle module follows Phase 16 conventions (MODULE.md, barrel, events.ts, tests-as-spec); Nyquist passes; coverage delta ≤ −2pp                                                                                                                                                     | ✓ VERIFIED | `server/lifecycle/MODULE.md` (104 lines, 9 fixed H2 sections + Runnable Example). `server/lifecycle/index.ts` barrel with 1 `from './internal/` re-export. `server/lifecycle/events.ts` (MOD-03, 4 persisted events). `server/lifecycle/queue.ts` (QUEUE-06). `server/lifecycle/internal/module.ts` (MOD-06 factory). 3 task specs renamed `.test.ts → .spec.ts` (MOD-04 file-naming). Nyquist delta: +7.54pp (55.83% vs baseline 48.29%). `npm run dep-check` green (202 modules, 448 deps, 0 violations). |
| SC4 | Graceful shutdown drains in-flight schedule jobs within configured timeout without dropping work                                                                                                                                                                                       | ✓ VERIFIED | `server/lifecycle/internal/module.ts:127-139` — shutdown() has idempotent `stopped` flag + offWork per workerId. `server/lifecycle/plugin.ts:49-51` wires `onClose → module.shutdown()`. Test: `server/lifecycle/__tests__/graceful-shutdown.spec.ts` [SC4] asserts `elapsedMs < 10_000`; [SC4 idempotency] asserts double-close resolves; no-unhandled-rejections asserts empty array. SUMMARY reports measured 642ms actual. |

**Score:** 4/4 ROADMAP SCs verified end-to-end.

---

### Required Artifacts (Plan must_haves)

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `server/queue/names.ts` | QUEUE_NAMES extended with 3 lifecycle entries | ✓ VERIFIED | `QUEUE_NAMES` has 5 entries: DEMO, HOOK_RUN, LIFECYCLE_COMPRESS_DAILY (`lifecycle.compress.daily`), LIFECYCLE_DISK_HOURLY (`lifecycle.disk.hourly`), LIFECYCLE_RETENTION_DAILY (`lifecycle.retention.daily`). All pass `isValidQueueName`. |
| `server/queue/plugin.ts` | schedule() passes `correlationId: null`; JobEnvelope widened to `string \| null` | ✓ VERIFIED | `JobEnvelope.correlationId: string \| null` (line 77). `schedule()` body at lines 197-213 constructs envelope with `correlationId: null, causationId: null, actor: 'cron', payload: data`. work() fallback at line 183: `data.correlationId ?? randomUUID()`. |
| `server/queue/__tests__/plugin.spec.ts` | Phase 18-00 describe block proving Option B | ✓ VERIFIED | Contains `describe.skipIf(!HAS_DB)('queue.schedule per-fire correlationId (Phase 18-00)')` with 2 tests: `toBeNull()` on schedule data.correlationId + ALS injection for send(). |
| `server/lifecycle/schemas.ts` | Zod payload + 3 result schemas | ✓ VERIFIED | Exports `lifecycleJobPayloadSchema`, `compressionResultSchema`, `retentionResultSchema`, `diskPressureResultSchema` + 4 derived TS types. `kind: z.enum(['compression','retention','disk-pressure'])`, `triggeredAt: z.string().datetime()`. |
| `server/lifecycle/events.ts` | 4 persisted events, aggregateType:'lifecycle' | ✓ VERIFIED | `lifecycleRegistry` has 4 entries all `persisted: true`, `aggregateType: 'lifecycle'`. `LIFECYCLE_EVENT_NAMES` = `{COMPRESSION_COMPLETED, RETENTION_COMPLETED, DISK_CHECKED, TASK_FAILED}`. `makeLifecycleEmitters` factory delegates to `createEventHelpers`. Bonus: `LIFECYCLE_AGGREGATE_ID` (UUID-v5) exported for envelope.aggregateId validity per Zod strict UUID. |
| `server/lifecycle/__tests__/events.spec.ts` | Unit proofs MOD-03 + TRACE-04 + TRACE-08 + SPEC-03 | ✓ VERIFIED | Contains 4 describe blocks tagged `[MOD-03, TRACE-08]`, `[MOD-03]`, `[TRACE-04]`, `[SPEC-03]`. ALS Map-shape pattern present (`asyncLocalStorage.run(new Map([['correlationId', correlationId]])`). Ran locally: 9/9 passed in 5ms. |
| `server/lifecycle/queue.ts` | registerLifecycleSchedulesAndWorkers factory | ✓ VERIFIED | Exports `LIFECYCLE_COMPRESS_DAILY_QUEUE_NAME`/`_RETENTION_DAILY_`/`_DISK_HOURLY_` + `COMPRESS_CRON='0 3 * * *'` / `RETENTION_CRON='0 3 * * *'` / `DISK_CRON='0 * * * *'`. Factory performs 3× createQueue → schedule → work (exactly 3 of each). Returns `{workerIds: [compress, retention, disk]}`. Each handler: try/catch → emit success OR emit `taskFailed` + re-throw. |
| `server/lifecycle/stats.ts` | LifecycleStats interface extracted | ✓ VERIFIED | Exports `LifecycleStats { lastCompressionRun, lastRetentionRun, lastDiskCheck }` — 3 nullable fields. |
| `server/lifecycle/__tests__/queue.spec.ts` | DB-gated: 3 schedules, correlationId=null, stately dedup | ✓ VERIFIED | `describe.skipIf(!HAS_DB)` + SCHEMA `'pgboss_lifecycle_queue_spec'`. 3 it-blocks: worker-ids (length 3, distinct), getSchedules (crons + `toBeNull()` on all 3 correlationIds + actor='cron'), dedup via `singletonKey` (`toBeNull()` on second send). |
| `server/lifecycle/__tests__/correlation.spec.ts` | DB-gated QUEUE-08 SC2 per-fire proof | ✓ VERIFIED | `describe.skipIf(!HAS_DB)` + SCHEMA `'pgboss_lifecycle_correlation_spec'`. Registers 2 test schedules at `* * * * * *` + `cronMonitorIntervalSeconds: 1` (queue plugin opt added for this purpose). Test 1: UUID regex match on first captured correlationId. Test 2: `expect(firstA).not.toBe(firstB)` proves Option B. |
| `server/lifecycle/internal/module.ts` | createLifecycleModule factory (MOD-06) | ✓ VERIFIED | Exports `CreateLifecycleModuleDeps`, `LifecycleModule`, `createLifecycleModule`. Factory: `logger.child({module:'lifecycle'})` → `new TypedBus(lifecycleRegistry)` → `makePersistEnvelope` middleware (insert into eventsTable when persisted) → `makeLifecycleEmitters(bus, persistEnvelope)`. Shutdown idempotent via `stopped` flag + offWork per id. |
| `server/lifecycle/plugin.ts` | Thin factory-wirer | ✓ VERIFIED | `dependencies: ['config', 'db', 'queue', 'event-bus']` (line 58). `name: 'lifecycle-plugin'` (line 57 — unchanged for back-compat with api/plugin.ts:dependencies). Calls createLifecycleModule → decorates lifecycleStats + lifecycleModule → registerSchedulesAndWorkers → onClose → shutdown. NO node-cron, NO async-mutex, NO cron.schedule, NO Mutex references. |
| `server/lifecycle/lifecycle-plugin.ts` | DELETED | ✓ VERIFIED | `ls` returns "No such file or directory". `server/index.ts:12` imports from `'./lifecycle/plugin.js'` (not `'./lifecycle/lifecycle-plugin.js'`). |
| `server/index.ts` | Import updated to new plugin path | ✓ VERIFIED | Line 12: `import lifecyclePlugin from './lifecycle/plugin.js';` |
| `server/lifecycle/__tests__/module.spec.ts` | Factory unit proofs (no DB) | ✓ VERIFIED | 4 it-blocks: `[MOD-06]` factory shape, stats 3-nulls, shutdown idempotency, shutdown offWork-per-id. `vi.mock('../queue.js', ...)` returns 3 fake worker ids. Ran locally: 4/4 passed in 3ms. |
| `server/lifecycle/__tests__/graceful-shutdown.spec.ts` | DB-gated SC4 drain proof | ✓ VERIFIED | `describe.skipIf(!HAS_DB)` + SCHEMA `'pgboss_lifecycle_shutdown_spec'`. 3 tests: `[SC4]` elapsedMs < 10_000, `[SC4 idempotency]` double-close resolves, no-unhandled-rejections. Uses real drizzle DB for persistEnvelope. |
| `server/__tests__/plugin-order.spec.ts` | Extended with lifecycle-plugin ordering | ✓ VERIFIED | Lines 68-76 add 3 assertions: `indexOf('queue') < indexOf('lifecycle-plugin')`, `indexOf('event-bus') < indexOf('lifecycle-plugin')`, `indexOf('db') < indexOf('lifecycle-plugin')`. Comments reference Phase 18 / Plan 18-03. |
| `.dependency-cruiser.cjs` | `no-deep-imports-into-lifecycle-internal` rule | ✓ VERIFIED | Lines 32-45 declare the rule with `from: {pathNot: '^server/lifecycle/'}` + `to: {path: '^server/lifecycle/internal/'}`, severity:'error'. `npm run dep-check` exits 0. |
| `__fixtures__/dep-cruiser/bad-lifecycle-deep-import.ts` | Fixture for rule test | ✓ VERIFIED | Imports `createLifecycleModule` from `'../../server/lifecycle/internal/module.js'` with `@ts-expect-error` guard; exports `_proof` symbol to prevent tree-shake. |
| `server/hooks/__tests__/dep-cruiser.spec.ts` | Extended with lifecycle rule assertion | ✓ VERIFIED | Line 89: `it('[MOD-02 lifecycle extension] deep import into server/lifecycle/internal/* from outside server/lifecycle/ fails', ...)`. |
| `server/lifecycle/MODULE.md` | 9 fixed H2 sections + runnable example | ✓ VERIFIED | All 9 sections in canonical order: Purpose / Public API / Events Emitted / Events Consumed / Queue Produced / Queue Consumed / Invariants / Non-Goals / Dependencies. Invariants (a)-(e) each cite a spec file. All 4 events + 3 queues + both crons documented. H3 Runnable Example with TypeScript fence. 104 lines, 836 words. |
| `server/lifecycle/index.ts` | Public barrel (MOD-02) | ✓ VERIFIED | Re-exports: `lifecyclePlugin` (default-as-named), `createLifecycleModule` + types, `LifecycleStats`, 4 schemas + 4 derived types, events surface (`lifecycleRegistry`, `LIFECYCLE_EVENT_NAMES`, `LIFECYCLE_AGGREGATE_ID`, `makeLifecycleEmitters`, 4 payloads + 3 types), 3 queue names + 3 crons + factory + 2 types. Exactly ONE `from './internal/` re-export line. No leaked task-body internals. |

**Score:** 22/22 artifacts VERIFIED (exists + substantive + wired).

---

### Key Link Verification

| From | To | Via | Status | Details |
| ---- | -- | --- | ------ | ------- |
| `server/queue/plugin.ts schedule()` | `server/queue/plugin.ts work()` | envelope.correlationId === null → work() generates fresh UUID | ✓ WIRED | schedule() line 207 passes `correlationId: null`; work() line 183 fallback `data.correlationId ?? randomUUID()` — proven by correlation.spec.ts Test 2 distinct-UUIDs. |
| `server/lifecycle/* → server/queue/names.ts` | Import LIFECYCLE_* constants | queue.ts:27 imports from `'../queue/names.js'` | ✓ WIRED | queue.ts lines 46-48 alias the 3 constants from `QUEUE_NAMES.LIFECYCLE_*`. |
| `server/lifecycle/events.ts → server/lifecycle/schemas.ts` | compressionCompletedPayload extends shape of compressionResultSchema | events.ts:38-42 imports 3 result schemas; `.extend({ durationMs })` | ✓ WIRED | `compressionCompletedPayload = compressionResultSchema.extend({durationMs: z.number().int().nonnegative()})` and 2 siblings. |
| `server/lifecycle/events.ts → server/bus/helpers.ts` | createEventHelpers | events.ts:33 imports createEventHelpers; makeLifecycleEmitters line 113 invokes it | ✓ WIRED | Factory delegation: `const emit = createEventHelpers(bus, onEmit)` returns typed emitters. |
| `server/lifecycle/queue.ts → queue substrate` | Uses fastify.queue.schedule / .work / boss.createQueue | Exactly 3 of each in queue.ts | ✓ WIRED | grep count: 3× `fastify.boss.createQueue`, 3× `fastify.queue.schedule(`, 3× `fastify.queue.work`. |
| `server/lifecycle/queue.ts worker handlers → task bodies` | runCompressionTask / runRetentionTask / runDiskPressureTask | queue.ts:31-33 imports; handlers call each | ✓ WIRED | Each worker handler wraps a `runXTask(db, config, log)` call in try/catch with emit + re-throw. |
| `server/lifecycle/queue.ts worker handlers → emit helpers` | emit.compressionCompleted / retentionCompleted / diskChecked / taskFailed | Injected via deps | ✓ WIRED | grep matches for all 4 emit.* calls inside queue.ts (on success per task + taskFailed in all 3 catches). |
| `server/lifecycle/plugin.ts → internal/module.ts` | createLifecycleModule | plugin.ts:26 imports; line 37 calls factory | ✓ WIRED | Plugin decorates both `lifecycleStats` + `lifecycleModule` from factory return; wires onClose → shutdown. |
| `server/index.ts → server/lifecycle/plugin.js` | Replaces old lifecycle-plugin.js | index.ts:12 `from './lifecycle/plugin.js'` | ✓ WIRED | No residual `lifecycle-plugin.js` import anywhere (old file deleted). |
| `server/lifecycle/internal/module.ts shutdown() → server/queue/plugin.ts boss.offWork` | Iterates workerIds from registerLifecycle | module.ts lines 127-139 | ✓ WIRED | `for (const id of workerIds) await deps.fastify.boss.offWork(id)` with try/catch + idempotent stopped flag. |
| `server/lifecycle/index.ts → server/lifecycle/internal/module.ts` | ONE allowed internal/ re-export (MOD-02) | index.ts:25 single statement with inline `type` modifier | ✓ WIRED | Exactly one `from './internal/` line — inline-type pattern (stricter than hooks pilot's 2 lines). |
| `server/lifecycle/MODULE.md Invariants → spec files` | Each invariant maps to a test file | All 5 invariants (a)-(e) cite `__tests__/*.spec.ts` | ✓ WIRED | (a) → queue.spec.ts, (b) → correlation.spec.ts, (c) → graceful-shutdown.spec.ts, (d) → module.spec.ts, (e) → graceful-shutdown.spec.ts. |

---

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
| ----------- | -------------- | ----------- | ------ | -------- |
| **QUEUE-08** | 18-00, 18-01, 18-02, 18-03, 18-04 | "node-cron removido de pipelines-plugin e lifecycle-plugin; substituído por boss.schedule(); correlationId injetado em todo boss.send() via wrapper lendo da AsyncLocalStorage" | ✓ SATISFIED (lifecycle half) | Lifecycle half closed: `grep -rn 'node-cron\|async-mutex' server/lifecycle/` returns 0 matches. `boss.schedule()` wrapper at `server/queue/plugin.ts:197-213` stamps null correlationId → per-fire UUID. `boss.send()` wrapper at `server/queue/plugin.ts:146-161` injects correlationId from ALS. Integration proof: `correlation.spec.ts` [QUEUE-08 SC2]. REQUIREMENTS.md line 167 already marks QUEUE-08 as Complete. **Pipelines half** (server/pipelines/scheduler.ts still imports node-cron + package.json dep removal) is explicitly deferred to Phase 25 per MODULE.md Non-Goals + Phase 18 CONTEXT planning preamble. |

No orphaned requirements. REQUIREMENTS.md maps Phase 18 → only QUEUE-08, and it is declared in every plan's `requirements` array.

---

### Anti-Patterns Scanned

| File | Pattern | Finding | Severity | Impact |
| ---- | ------- | ------- | -------- | ------ |
| `server/lifecycle/**/*.ts` | `node-cron`, `async-mutex` | 0 matches | — | None — SC1 cleanly satisfied. |
| `server/lifecycle/plugin.ts` | `cron.schedule`, `new Mutex` | 0 matches | — | None. |
| `server/lifecycle/**/*.ts` | TODO / FIXME / placeholder / "coming soon" | 0 matches | — | No deferred placeholders inside lifecycle module code. |
| `server/lifecycle/queue.ts` worker handlers | Empty `return null` / stub body | 0 matches | — | Each handler runs task + emits. |
| `server/lifecycle/internal/module.ts` shutdown() | Missing idempotency | Guarded via `stopped` flag at line 128 | — | Correct. |

---

### Human Verification (Optional — post-deploy)

The following cannot be verified programmatically but are already flagged in the VALIDATION.md manual-only table:

| Test | Expected | Why Human |
| ---- | -------- | --------- |
| Cron wall-clock timing across DST + clock-skew | Schedules fire at configured wall-clock times over multi-day windows | pg-boss owns timing; requires multi-day observation in production |

---

### Gaps Summary

**None.** All 22 plan-frontmatter must_haves verified, all 12 key links wired, all 4 ROADMAP success criteria satisfied with test-file citations, QUEUE-08 (lifecycle half) closed.

---

### Pre-existing Issues (OUT OF SCOPE per instructions — documented in deferred-items.md, NOT Phase 18 regressions)

Verified reproducible on HEAD before Phase 18 changes — explicitly flagged as not-phase-18 in user prompt:

1. **6 typecheck errors from Phase 15** — Map vs RequestContext divergence in `server/bus/helpers.ts`, `server/bus/plugin.ts`, `server/events/__tests__/emit-helpers.spec.ts` (×2), `server/hooks/__tests__/events.spec.ts`, `server/pipelines/schema.ts`. Phase 18 adds zero new typecheck errors (Plan 18-04 SUMMARY verified HEAD~1 + grep `lifecycle/index` tsc.out → empty).
2. **31 test failures from Phase 17** — `fastify-zod-openapi` v5 `required` emission bug, affecting `server/api/__tests__/routes.test.ts` (17), `server/api/__tests__/artifact-routes.test.ts` (5), `server/auth/__tests__/auth-plugin.test.ts` (8), `server/__tests__/plugin-order.spec.ts` (1 — the Plan 17-07 indexOf-substring quirk). All reproduce on HEAD~3.
3. **`scripts/__tests__/check-generated.spec.ts` hang** — Same fastify-zod-openapi root cause; workaround `CONTRACTS_CHECK_SPEC=skip` already documented in deferred-items.md.

A standalone hotfix plan (17-09 or early Phase 19 wave) is recommended before those regressions compound downstream.

---

## Conclusion

**Phase 18 goal ACHIEVED.** Lifecycle module migrated from node-cron + async-mutex to pg-boss schedules with `policy:'stately'` + `singletonKey` overlap protection and per-fire correlationId traceability via the Option B substrate fix in `server/queue/plugin.ts`. All plans (18-00 through 18-04) shipped with 30 green specs across 8 files under `server/lifecycle/__tests__/`. MOD-01 (MODULE.md), MOD-02 (barrel + dep-cruiser), MOD-03 (events.ts), MOD-06 (factory), QUEUE-06 (queue.ts), and MOD-04 file-naming all aligned with Phase 16 canonical pattern. Nyquist delta +7.54pp (55.83% vs baseline 48.29%).

QUEUE-08 requirement closed for the lifecycle half; pipelines half explicitly deferred to Phase 25 per roadmap scope boundary.

---

_Verified: 2026-04-20T20:05:00Z_
_Verifier: Claude (gsd-verifier)_
