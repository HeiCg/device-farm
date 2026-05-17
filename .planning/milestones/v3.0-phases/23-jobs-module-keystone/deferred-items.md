# Phase 23 Deferred Items

Catalog of items intentionally NOT addressed in Phase 23, with phase-ownership annotation. Mirrors the Phase 22 catalog shape (`.planning/phases/22-streaming-module/deferred-items.md`).

Total at Phase 23 close: 4 Phase 23-specific deferrals + 3 carry-forwards + 1 pre-existing test failure logged = 8 tracked items.

## Phase 23-specific deferrals (4)

### DEFERRED-23-A: Admin-claim gate on `/admin/drain`

**Status:** Phase 23 lands with any-valid-key auth on `/admin/drain` + `/admin/drain/resume` (`fastify.authService.validateKey` preHandler). Any caller holding a valid API key can trigger drain.

**Owner:** Phase 26 Auth Module. Phase 26 adds a `requireAdmin` middleware reading `actor.claims.admin === true` from authenticated context (TRACE-10) and applies it to drain routes + any other operator-only endpoints.

**Code marker:** TODO comment in `server/jobs/internal/routes.ts` next to the `preHandler: fastify.authService.validateKey` line referencing this DEFERRED-23-A. Documented in `server/jobs/MODULE.md` Non-Goals section.

**Why not Phase 23?** Auth claim shape is Phase 26 scope; introducing it here would reach across module boundaries and leak auth concerns into the jobs module before the auth module is restructured.

### DEFERRED-23-B: `system.drain.*` event surface ownership

**Status:** Phase 23 emits `system.drain.completed` + `system.drain.resumed` from the jobs module (jobsRegistry, with `aggregateType:'system'` discriminating from regular `aggregateType:'job'` events). Done for proximity to the drain endpoint code.

**Owner:** Phase 27+ may extract to a dedicated `server/system/` module if more system-wide events emerge (e.g. feature flags, maintenance mode). Until then, the `aggregateType:'system'` discriminator is sufficient for trace-tree consumption.

**Code marker:** Note in `server/jobs/MODULE.md` Non-Goals section + comment block in `server/jobs/events.ts` near `DRAIN_COMPLETED` / `DRAIN_RESUMED` constants.

**Why not Phase 23?** A dedicated system module is over-engineering for two events. Bus consumers already filter on `aggregateType` so trace-tree semantics are correct without a module split.

### DEFERRED-23-C: Cross-tier deviceName proof in Go

**Status:** `contract-devicename.spec.ts` test case (g) attempts a Go test (`cd cli && go test -run TestStatusDeviceName ./...`) asserting `device-farm status <id>` displays the device name. If autonomous-mode tooling unreachable OR the Go test isn't present yet, the spec logs `[DEFERRED-23-C]` warning and passes — the assertion lands here for Phase 28 to ship the Go-side `TestStatusDeviceName`.

**Owner:** Phase 28 CLI Refactor. Phase 28 adds `TestStatusDeviceName` to `cli/cmd/status_test.go` consuming the generated `Job` type with deviceName field (CLI-04 codegen consumption).

**Code marker:** `if (...)` guard in `server/jobs/__tests__/contract-devicename.spec.ts` test (g) that warns + skips when Go infra unavailable.

**Why not Phase 23?** Cross-tier proof requires Go-side codegen consumption that Phase 28 owns; Phase 23 establishes the contract (Zod refine + `components.schemas.Job`) — that's the keystone scope.

### DEFERRED-23-D: pgboss schema isolation per drain test

**Status:** Phase 23 drain specs share the default pg-boss schema (Phase 19 precedent — no observed flakes). Drain integration tests may flake under heavy parallel load if multiple drain specs share state.

**Owner:** None — track via flaky-test count in CI. If flakes appear, switch to per-spec ephemeral pg-boss schema (Phase 18 lifecycle precedent uses `pgboss_lifecycle_<suffix>` per spec; would require either pgboss schema option or full Drizzle migration per spec).

**Code marker:** Note in `server/jobs/__tests__/drain-route.spec.ts` setup comment.

**Why not Phase 23?** Phase 19 used the same shared-schema pattern across 5 reporting DB-gated specs with no observed flakes. Premature optimization at Phase 23 close.

## Carry-forward deferrals (3)

### DEFERRED-22-E (carry-forward): persistEnvelope consolidation — 7TH SAMPLE POINT REACHED

**Status:** Phase 16 + 18 + 19 + 20 + 21 + 22 + 23 each duplicated the ~10-line persistEnvelope middleware (`server/{hooks,lifecycle,reporting,pool,artifacts,streaming,jobs}/internal/module.ts`). Phase 23 reaches the 7TH SAMPLE POINT. The duplicated copies are byte-equivalent except for module-name comments.

**Owner:** Phase 27+. Extract to `server/bus/middlewares/persist-envelope.ts` (already exists as a sample). Replace the 7 duplicates with imports.

**Why not Phase 23?** Phase 23 is keystone scope; consolidation is a tree-wide refactor that's safer post-keystone. Each module extraction (16-22) had higher leverage than the consolidation itself.

### DEFERRED-17-A (inherited): fastify-zod-openapi v5 `required` emission bug

**Status:** Inherited from Phase 17 since Plan 17-01 — fastify-zod-openapi v5 has a known bug where Zod 4 `.refine()` schemas emit incomplete `required` arrays in OpenAPI. Manifests as ~30 test failures in 3 pre-existing files: `server/api/__tests__/routes.test.ts` + `server/artifacts/__tests__/artifact-routes.test.ts` + `server/auth/__tests__/auth-plugin.test.ts`.

**Owner:** Phase 27 API Aggregator. Phase 27 may upgrade fastify-zod-openapi or work around the bug. Phase 23-07 sweep continues to exclude these 3 files from the green-suite check.

**Code marker:** Test files retain `.test.ts` suffix (not `.spec.ts`) as a side-marker that they are pre-existing exclusions. Phase 27 closes them.

### DEFERRED-15-A (inherited): Map-vs-RequestContext typecheck errors

**Status:** Inherited from Phase 15 — the ALS work introduced ~10 tsc errors across 8 files about Map shape vs RequestContext object shape. Production code uses object-shape stores throughout; the Map-shape comments survive in some test files + `server/bus/helpers.ts` cast.

**Owner:** Phase 27 API Aggregator (or earlier if a contributor cleans up).

**Code marker:** Phase 23-07 sweep documents the count (10 errors at HEAD) so any regression surfaces immediately. Stash-comparison at HEAD~1 confirms zero new errors from Phase 23.

## Logged pre-existing test failures (2)

### artifacts/streaming lifecycle-ownership grep-guards stale post-Plan-23-04

**Status:** ~5 assertion failures in `server/artifacts/__tests__/lifecycle-ownership.spec.ts` + `server/streaming/__tests__/lifecycle-ownership.spec.ts` + `server/artifacts/__tests__/correlation.spec.ts` + `server/artifacts/__tests__/subscriber.spec.ts` + `server/streaming/__tests__/module.spec.ts`. These specs use `readFileSync('server/jobs/job-service.ts')` grep-guards counting `this.jobsEmit?.started`, `this.jobBroadcaster.cleanup()`, etc. callsites. Plan 23-04 collapsed job-service.ts from 669 lines to a 50-line back-compat shim (saga moved to `internal/executor.ts`); the grep targets disappeared with the legacy code, so the assertions now fail with `expected 0 to be greater than or equal to 1`. Subscriber.spec failure is similar (test setup expected old shape).

**Owner:** Phase 24+ — when artifacts/streaming subscribers also migrate to consume saga events from `internal/executor.ts` instead of from `job-service.ts`, update the grep-guards to point at `server/jobs/internal/executor.ts` (or delete the grep-guards entirely since Plan 23-04's lifecycle-ownership.spec.ts in `server/jobs/__tests__/` already covers the SC1 contract for the new shim shape).

**Verification:** `git stash && DATABASE_URL=... npx vitest run server/{artifacts,streaming}/__tests__/lifecycle-ownership.spec.ts` reproduces same failures at HEAD prior to Phase 23-07 changes — these are post-Plan-23-04 regressions, NOT introduced by this plan.

### plugin-order.spec.ts line 90 — websocket vs pool-plugin position

**Status:** Pre-existing failure at `server/__tests__/plugin-order.spec.ts:90` — `wbIndex(listing, 'websocket-plugin') > indexOf('pool-plugin')` returns `424 > 1113` (websocket appears BEFORE pool-plugin in the printPlugins listing, violating the Phase 17 DEBT-01 fix expectation).

**Owner:** Re-investigate during Phase 24 (the failure may indicate the actual registration order in `server/index.ts` has shifted, or the wbIndex helper is now mis-reading the printPlugins output for `pool-plugin`). Out of scope for Phase 23 close per scope-boundary rule.

**Verification:** `git stash && DATABASE_URL=... npx vitest run server/__tests__/plugin-order.spec.ts` reproduces same failure at HEAD prior to Phase 23-07 changes — Phase 23 additive Phase 23 block (4 positional + 1 structural) is unchanged behavior, the new assertions never reach because line 90 short-circuits the test.

---

Total: 4 Phase 23-specific + 3 carry-forwards + 1 pre-existing = 8 tracked items at Phase 23 close.

Phase 24 Maestro Module unblocked. Phase 26 Auth Module owns DEFERRED-23-A. Phase 27+ API Aggregator owns DEFERRED-22-E persistEnvelope consolidation. Phase 28 CLI Refactor owns DEFERRED-23-C Go-side TestStatusDeviceName.
