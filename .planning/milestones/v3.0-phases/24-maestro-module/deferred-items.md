# Phase 24 Maestro Module — Deferred Items Catalog

**Phase closed:** 2026-05-08
**Inherited from:** Phase 15 (tsc errors), Phase 17 (test failures); carried forward unchanged.
**New deferrals from Phase 24:** 5 items targeting Phase 25 / 27+ / 30.

---

## Inherited (pre-existing, NOT introduced by Phase 24)

### DEFERRED-17-A: fastify-zod-openapi v5 `required`-emission bug (3 test files)

**Files failing:** `server/api/__tests__/routes.test.ts`, `server/artifacts/__tests__/artifact-routes.test.ts`, `server/auth/__tests__/auth-plugin.test.ts`

**Failure:** fastify-zod-openapi v5 emits `required` fields with array representation instead of object; validator-compiler rejects request bodies that previously validated. Root cause documented in Phase 17 VERIFICATION.md.

**Resolution planned:** Phase 27 API Aggregator (fastify-zod-openapi v6 upgrade or swap to `@fastify/zod`) and Phase 30 Test Migration Cleanup. Phase 24-05 sweep continues to exclude these 3 files from the green-suite check.

**Code marker:** Test files retain `.test.ts` suffix (not `.spec.ts`) as a side-marker that they are pre-existing exclusions.

**Impact on Phase 24:** None. Phase 24 adds zero new HTTP routes; does not touch fastify-zod-openapi surface.

### DEFERRED-15-A: Map-vs-RequestContext typecheck errors

**Files:** assorted — `server/bus/helpers.ts`, `server/queue/plugin.ts`, related subscribers.

**Failure:** TypeScript strict-mode errors related to the ALS store shape migration from Map to plain-object (Phase 15/20 pattern). Functional runtime unaffected (`readAls` helper is dual-shape tolerant).

**Resolution planned:** Phase 27+ (when the final ALS shape cleanup lands).

**Impact on Phase 24:** None. All Phase 24 specs use plain-object ALS shape; baseline tsc error count unchanged across Phases 15-24.

---

## New Phase 24 deferrals

### DEFERRED-24-A: Maestro test rewrite to tests-as-spec style

**Status:** Phase 24 Plan 24-05 performs only `.test.ts → .spec.ts` rename via `git mv` (MOD-04 naming). Body rewrite to match MODULE.md Public API + Invariants sections is Phase 30 scope.

**Files affected:** `server/maestro/__tests__/hierarchy-service.spec.ts`, `server/maestro/__tests__/appium-service.spec.ts`.

**Owner:** Phase 30 Test Migration Cleanup. Tests-as-spec rewrite has the test names mirror Public API surface entries + Invariants (e.g. `it('emits maestro.hierarchy.fetched after getHierarchy resolves')`); body unchanged here to preserve blame + keep Plan 24-05 in 35-min budget.

**Why not Phase 24?** Tests-as-spec rewrite is a tree-wide cleanup performed once across all v3.0 modules. Doing it module-by-module in close-out plans diffuses the pattern; Phase 30 lands the unified rewrite atop a stable module surface.

### DEFERRED-24-B: persistEnvelope 8TH SAMPLE POINT consolidation

**Status:** The 10-line `persistEnvelope` middleware in `server/maestro/internal/module.ts` is the 8th verbatim copy across:

- `server/hooks/internal/module.ts` (Phase 16)
- `server/lifecycle/internal/module.ts` (Phase 18)
- `server/reporting/internal/module.ts` (Phase 19)
- `server/pool/internal/module.ts` (Phase 20)
- `server/artifacts/internal/module.ts` (Phase 21)
- `server/streaming/internal/module.ts` (Phase 22)
- `server/jobs/internal/module.ts` (Phase 23)
- `server/maestro/internal/module.ts` (Phase 24 — THIS sample)

Pattern is locked-in (8 verbatim instances); consolidation requires touching 8 modules atomically + extracting to `server/bus/persist-envelope.ts`.

**Owner:** Phase 27+ API Aggregator. Replace 8 duplicates with imports.

**Why not Phase 24?** Phase 24 is module-migration scope; consolidation is a tree-wide refactor that's safer post-keystone. Each module extraction (16-24) had higher leverage than the consolidation itself. Phase 23 also documented this same trigger at the 7TH sample point under DEFERRED-22-E (carry-forward).

### DEFERRED-24-C: Appium driver queue-managed lifecycle

**Status:** `AppiumService` currently spawns/tears down drivers on demand inside HTTP routes. A future phase may move Appium driver lifecycle behind a pg-boss queue with explicit ownership transfer + driver pooling. Phase 24 retains the on-demand surface verbatim.

**Files affected:** `server/maestro/internal/appium-service.ts`.

**Owner:** No specific phase committed — opportunistic improvement once driver lifecycle stabilization becomes a bottleneck.

**Why not Phase 24?** Appium usage is low-volume today; on-demand spawn/teardown is sufficient. Adding a queue layer pre-emptively complicates the driver state machine + introduces a new failure surface.

### DEFERRED-24-D: Cross-module `causationId` thread on subscriber-side re-emit

**Status:** The maestro subscriber on `device.booted` receives a payload (not envelope). The re-emit on `maestro.device-info.collected` carries its own correlationId from ALS but does NOT explicitly set `causationId = pool-envelope.id` because the original envelope is opaque to the handler.

For trace-tree consumers (Phase 27 `GET /api/events?correlationId=…`), this means:

- The `correlationId` chain holds end-to-end (ALS restores correlationId on subscriber callback; emit picks it up).
- The `causationId` link from `device.booted` → `maestro.device-info.collected` is missing because both events share the same correlationId but neither has the other's id as `causationId`.

This is acceptable because both events are NOT persisted (`device.booted` and `maestro.device-info.collected` both transient per TRACE-08); trace-tree depth on transient events is decorative. If either becomes persisted in a future phase, the gap matters.

**Files affected:** `server/maestro/internal/subscribers.ts`, `server/bus/helpers.ts` (envelope-aware emit helpers).

**Owner:** Phase 27+ envelope-aware emit helpers. Either (a) introduce `emit.X(payload, { causationId })` opt-in API or (b) thread the source envelope through ALS as a sibling to correlationId.

**Why not Phase 24?** The gap only matters once both events become persisted; current TRACE-08 policy keeps both transient. Phase 27 owns trace-tree refinements + envelope-aware emit helpers as a unit.

### DEFERRED-24-E: `hookExecutor.execute('device.booted', ...)` loop in `server/index.ts:167-191`

**Status:** Retained per Phase 24 scope; future hooks→bus migration may consolidate.

**Why retained:** The `app.hookExecutor.execute('device.booted', ...)` loop at `server/index.ts:167-191` fires user-defined shell hooks — a DIFFERENT surface from the bus-driven metadata refresh that Phase 24 introduces. RESEARCH §Anti-Patterns explicitly preserves this loop:

- `hookExecutor` is the user-facing hook trigger system (executes external shell scripts on lifecycle events for operator-customizable workflows).
- The bus subscription Phase 24 introduces is the internal metadata-refresh substrate (DeviceInfoCollector wiring).

These are NOT redundant. `lifecycle-ownership.spec` test (e) asserts the loop is still present (guard against accidental deletion).

**Files affected:** `server/index.ts:167-191`, `server/hooks/schemas.ts:14`.

**Owner:** Phase 27+ if/when the hooks system migrates to consume bus events directly (e.g. `hookExecutor` becomes a bus subscriber that filters by event-name allowlist). Until then, both surfaces co-exist.

---

Total: 5 Phase 24-specific deferrals + 2 carry-forwards = 7 tracked items at Phase 24 close.

Phase 25 Pipelines Module unblocked. Phase 27+ owns DEFERRED-24-B persistEnvelope consolidation + DEFERRED-24-D causationId thread + DEFERRED-24-E hooks→bus migration. Phase 30 Test Migration Cleanup owns DEFERRED-24-A test rewrite.

Note: the legacy `DEFERRED-24-D: Pre-existing ReDoS warnings in hierarchy-service.ts` entry that was created during Plan 24-03 verification is superseded by this catalog. The ReDoS warnings (4 `new RegExp(...)` callsites in `server/maestro/internal/hierarchy-service.ts`) are pre-existing (predate Phase 24 — Plan 24-03 only `git mv`'d the file 100% intact) and remain out-of-scope per the original Plan 24-03 scope boundary; they are tracked as a maintenance item under Phase 25 maestro hardening or Phase 30 test migration cleanup.
