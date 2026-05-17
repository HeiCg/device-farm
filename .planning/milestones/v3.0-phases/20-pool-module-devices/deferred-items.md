# Phase 20 — Deferred Items

Catalog of items explicitly NOT delivered by Phase 20. Two categories:
(A) Inherited exclusions from Phase 17/18/19 that continue to apply.
(B) Phase 20 intentional deferrals (scope-boundary decisions).

---

## A) Inherited Exclusions

These test files have pre-existing failures documented in Phase 18 Plan 18-04 SUMMARY.md + Phase 19 Plan 19-06 SUMMARY.md + Phase 19 deferred-items.md. Phase 20 inherits the same exclusion set — full-suite run uses `npx vitest run --exclude <file>` flags.

### A.1 — fastify-zod-openapi v5 `required` emission bug

Files affected:

- `server/api/__tests__/routes.test.ts`
- `server/api/__tests__/artifact-routes.test.ts`
- `server/auth/__tests__/auth-plugin.test.ts`

Symptom: `FST_ERR_SCH_VALIDATION_BUILD` on Fastify boot when multiple Zod schemas register across plugins; fastify-zod-openapi v5 incorrectly emits `required: []` for optional-only schemas — Ajv rejects the non-array shape at compile time.

Origin: Phase 17 Plan 17-01 upgrade of fastify-zod-openapi to v5 (Zod 4 support). Phase 17 Plan 17-01 left this pending.

Phase 20 action: none. Test exclusion continues verbatim per Phase 19 pattern. No attempted hotfix lands in Phase 20 scope.

Fix path: upstream library bug; hotfix options listed in Phase 19 deferred-items.md §Test suite follow-up (upstream patch / Ajv required-normalisation shim / pin back to v4). Out of scope for Phase 20.

### A.2 — `plugin-order.spec.ts` pool-plugin substring-match bug

File affected: `server/__tests__/plugin-order.spec.ts` (a single pre-existing failing `it`-block).

Symptom: the spec iterates `app.printPlugins()` text output and uses `.indexOf('pool-plugin')` substring matching. `'fastify-websocket'` appears early in the listing and contains the substring `'websocket'`; the positional compare `indexOf('websocket-plugin')` returns the earlier position inside `'fastify-websocket'`, not inside the true `'websocket-plugin'` entry. The Phase 17/18/19 additive assertions compound the issue.

Origin: Phase 17 Plan 17-07 added websocket→pool dep declaration but the assertion helper uses substring matching instead of whole-token matching. Phase 18 Plan 18-03 documented this first; Phase 19 continued inheritance.

Phase 20 action: Task 6.3 ADDS an assertion to the same file for the pool-plugin dependencies list (Phase 17/18/19 additive pattern). The file remains in the CI exclusion set. The new assertion is structural intent — will read green once the substring-match bug is fixed (Phase 27+).

Fix path: rewrite the existing substring-based `it`-block to use decorator-metadata inspection (read `__fastify.PluginMetadata?.dependencies` instead of parsing the print-plugins text). Deferred to Phase 27+ cleanup.

---

## B) Phase 20 Intentional Deferrals

These were actively considered during planning/research and consciously scoped OUT. Each cites the specific phase that OWNS the follow-up. Cross-check: each item below also appears in `server/pool/MODULE.md §Non-Goals` (Plan 20-05) — MODULE.md is the authoritative surface; this catalog mirrors it with phase-ownership annotation.

### B.1 — `device.booted` as a first-class bus event → Phase 24

Pool emits `device.state.changed {from: 'booting', to: 'idle'}` but NOT a dedicated `device.booted` event. Consumers wanting boot semantics filter on `payload.from === 'booting' && payload.to === 'idle'`.

Rationale: CONTEXT.md §Specifics + RESEARCH §Pitfall 4 both defer to Phase 24. If Phase 24 Maestro finds the filter pattern painful in hierarchy/device-info collection, it may add `device.booted` as a convenience alias — Phase 20 deliberately does not pre-empt.

Owner phase: 24 (Maestro Module).

### B.2 — `pool.shutdown()` migration into `module.shutdown` → Phase 23

Current `server/index.ts` graceful-shutdown flow calls `app.pool.shutdown()` imperatively AFTER `jobService.shutdown()` (waits for running jobs) but BEFORE `app.close()` (plugin onClose hooks). Moving `pool.shutdown()` into `module.shutdown()` would change the ordering — it would fire AFTER `jobService.shutdown` via reverse-plugin-registration order, which MAY be safe but is a timing-sensitive behaviour change.

Phase 20 action: `server/pool/internal/module.ts` `shutdown()` stops healthChecker + `offWork`s the reaper worker; `pool.shutdown()` STAYS imperative in `server/index.ts` with a `TODO(Phase 23 jobs keystone)` comment implicit in the preserved call-site.

Rationale: RESEARCH §Open Question 1 documents the timing analysis. Phase 23 Jobs Module Keystone rewrites the shutdown drain procedure + saga, making it the natural place to revisit.

Owner phase: 23 (Jobs Module Keystone).

### B.3 — Hot-plug device detection → Future phase (not yet chartered)

`PoolManager.detectPhysicalDevices()` is a one-shot scan called inside `initPool()`. Adding a device AFTER `initPool` (user plugs in during session) is NOT detected.

Rationale: RESEARCH §Pitfall 7 notes this is OUT OF SCOPE for Phase 20 — existing behaviour preserved. Adding `device.detected` event + adb-watch loop could fit a future phase.

Owner phase: unchartered.

### B.4 — `device.*` webhook fan-out → Future (v4.0 or later)

Reporting module (Phase 19) subscribes ONLY to `job.completed` and enqueues webhook delivery. `device.*` events (state.changed, allocated, released, health.failed) are not fanned out to webhooks.

Rationale: scope — Phase 19 established the webhook pipeline for job events; device-event webhooks are a product-scope decision. Deliberately not included in v3.0 milestone.

Owner phase: v4.0 or later.

### B.5 — `persistEnvelope` middleware consolidation → Phase 27+

Phase 20 is the 5th sample point of the 10-line `persistEnvelope` duplicate (bus-plugin substrate + hooks + lifecycle + reporting + pool). Phase 15/19 RESEARCH Open Question #1 flagged this as a consolidation trigger AT 3+ samples. Phase 20 deliberately does NOT consolidate — keeping the duplicate lets the consolidation PR (which will refactor 4 module factories atomically) catch all 4 call sites together without diff entanglement from Phase 20's feature work. A 6th driver added in Phase 27+ (artifacts factory) would be the logical consolidation trigger.

Owner phase: 27+ (API Aggregator & Events API) — bundled with the trace-tree endpoint that consumes persisted events.

### B.6 — Rewiring existing deep imports (`jobs`, `maestro`, `hooks` → `pool/*` internals) → Phase 21/23/24

Phase 20 establishes the `server/pool/index.ts` barrel + `no-deep-imports-into-pool-internal` dep-cruiser rule. EXISTING consumers that deep-import (e.g. `server/jobs/plugin.ts`, `server/maestro/plugin.ts`, `server/hooks/plugin.ts`) continue to work — the dep-cruiser rule scopes to `pool/internal/*` specifically, NOT all of `server/pool/*`. Converting those imports to barrel imports is scope-bounded to the phase that owns each consumer module.

Rationale: CONTEXT.md §Deferred Ideas + RESEARCH §Summary both explicitly defer. Phase 20 would risk cascading regressions across 4+ consumer modules.

Owner phases: 21 (artifacts consumer rewiring), 23 (jobs keystone consumer rewiring), 24 (maestro consumer rewiring).

### B.7 — `device.boot` pg-boss queue registration → Phase 23

`QUEUE_NAMES.DEVICE_BOOT = 'device.boot'` is exported by Phase 20 (Plan 20-00), but the queue is NOT registered via `createQueue` in Phase 20. Registering a queue without a consumer would trap `boss.send(DEVICE_BOOT, ...)` calls. Grep-verified: zero `queue.send.*DEVICE_BOOT` references in the committed pool module.

Rationale: RESEARCH §Queue Semantics decision matrix — forward-compat name constant only, Phase 23 jobs keystone owns the on-demand-boot consumer.

Owner phase: 23 (Jobs Module Keystone).

### B.8 — Android/iOS driver internal refactor → Unchartered

Pool's `android/` + `ios/` sub-directories contain driver implementations with hand-written kebab-case file naming + minimal Zod coverage. Not converted to MOD-04 convention in Phase 20 (MOD-04 file-naming applied only to `server/pool/__tests__/` — drivers have no `__tests__/` of their own to rename).

Rationale: CONTEXT.md §Deferred Ideas — drivers stay as-is unless incidental to events wiring. Phase 20 deliberately keeps the driver internals untouched.

Owner phase: unchartered (driver-layer cleanup could fit Phase 30 test migration or a dedicated driver-quality phase).

---

*Deferred-items.md created 2026-04-21 at Phase 20 close. Inherits Phase 19 exclusion set verbatim (A.1 + A.2); Phase 20 adds 8 intentional deferrals (B.1–B.8) matching `server/pool/MODULE.md §Non-Goals` with phase-ownership annotation. Each Section B item maps 1:1 to a bullet in MODULE.md — reviewer cross-check is a single grep.*
