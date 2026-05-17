# Phase 24: Maestro Module - Context

**Gathered:** 2026-05-08
**Status:** Ready for planning
**Type:** Infrastructure phase (auto-skip discuss per autonomous workflow)

<domain>
## Phase Boundary

Restructure `server/maestro/` into the canonical `MODULE.md + barrel index.ts + events.ts + internal/ + tests-as-spec + createMaestroModule(deps)` shape. Move device-metadata refresh from any imperative onReady wiring in `server/index.ts` (or route-level ad-hoc calls) onto a `device.booted` bus subscription. Three existing services — `HierarchyService` (server/maestro/hierarchy-service.ts), `AppiumService` (server/maestro/appium-service.ts), and `DeviceInfoCollector` (currently in server/pool/device-info-collector.ts) — relocate behind the maestro barrel. The `pool` module gains a `device.booted` event addition (currently absent — verified by `grep -E "device.booted|deviceBooted" server/pool/events.ts` returning empty).

In scope:
- New `server/maestro/internal/` shape; barrel + factory + thin plugin.
- 2 new events in maestrоRegistry: `maestro.hierarchy.fetched`, `maestro.device-info.collected` (both transient/derivable per TRACE-08).
- Pool module extension: add `device.booted` event to existing 4-event poolRegistry → 5 events total. Pool plugin emits `device.booted` from existing state machine (allocated→running transition, or wherever boot completion is signalled).
- DeviceInfoCollector relocated from server/pool/ to server/maestro/internal/ (it's a maestro concern, not a pool concern; pool currently owns it for historical reasons).
- Subscriber wiring: maestro subscribes to `device.booted` via `fastify.addHook('onReady', ...)` per Pitfall 5 from Phase 23 (cross-module bus subscriptions defer to onReady).
- 8th dep-cruiser rule `no-deep-imports-into-maestro-internal`.
- plugin-order.spec additive block.
- `.test.ts → .spec.ts` renames (2 files).

Out of scope:
- Route-file refactors (api/routes/*.ts) — only ensure no route file reaches into maestro/internal/. Route handlers may still call maestro decorators (`fastify.maestroModule.fetchHierarchy(...)`) — that is the public surface.
- Maestro test extraction beyond rename — actual test rewrite waits for Phase 30 Test Migration Cleanup.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices follow the locked Phase 16-23 template:
- MODULE.md: 9 H2 sections in canonical order + Runnable Example.
- index.ts barrel: MOD-02 strict 1-line internal/ re-export with inline `type` modifier.
- internal/: holds `module.ts` (factory), `hierarchy-service.ts` + `appium-service.ts` + `device-info-collector.ts` (relocated), `subscribers.ts`.
- events.ts: 2 events, both transient (persisted:false per TRACE-08 — high-frequency, derivable from logs); aggregateType:'maestro'.
- queue.ts: omitted or comment-only (maestro owns no pg-boss queues — same shape as Phase 22 streaming).
- plugin.ts: thin Fastify plugin; dependencies array determined by what services need (likely `['config','db','event-bus','pool-plugin']`).
- Pool extension: add `device.booted` to POOL_EVENT_NAMES + poolRegistry as transient event (similar shape to existing device.allocated). Emit from pool's state machine where the booting→idle transition is signalled (server/pool/internal/ or server/pool/pool-manager.ts).
- DeviceInfoCollector relocation: `git mv server/pool/device-info-collector.ts server/maestro/internal/device-info-collector.ts` to preserve blame; update imports in pool/ and elsewhere.
- 8th dep-cruiser rule: `no-deep-imports-into-maestro-internal` + fixture file.
- Tests-as-spec: existing `appium-service.test.ts` + `hierarchy-service.test.ts` → `.spec.ts` rename; new specs for events, module factory, subscriber chain (DB-gated for the device.booted → fetch round-trip), correlation, lifecycle-ownership grep-guards.
- Nyquist gate: -2pp budget.

### Wave Structure
Mirror Phase 22/23 substrate-first pattern (5-6 plans):
- 24-00: Wave-0 substrate (events placeholder, queue.ts comment-only, internal/module.ts throw-stub, MODULE.md placeholder, index.ts barrel, dep-cruiser 8th rule, fixture, events.spec EVENTS-03 stub, pool/events.ts extension with device.booted entry).
- 24-01: events body — 2 maestro events + payload schemas + emitters + pool device.booted body.
- 24-02: pool emit wiring — pool state machine emits device.booted from boot-completion site; pool subscriber.spec extends.
- 24-03: createMaestroModule factory + DeviceInfoCollector relocation via git mv + subscriber wiring + thin plugin replacement.
- 24-04: DB-gated subscriber.spec + correlation.spec + lifecycle-ownership.spec.
- 24-05: phase close — MODULE.md body + barrel + .test→.spec renames + plugin-order.spec extension + deferred-items + Nyquist.

</decisions>

<code_context>
## Existing Code Insights

### Current maestro module state (pre-migration)
- `server/maestro/hierarchy-service.ts` (29KB) — fetches Maestro app hierarchy from devices.
- `server/maestro/appium-service.ts` (7.2KB) — Appium driver wrapper.
- `server/maestro/plugin.ts` (12.5KB) — current Fastify plugin; replace with thin form.
- `server/maestro/__tests__/hierarchy-service.test.ts` + `appium-service.test.ts` — rename to `.spec.ts` (MOD-04).
- NO `MODULE.md`, NO `index.ts` barrel, NO `internal/` subdirectory, NO `events.ts`.

### Cross-module relocation
- `server/pool/device-info-collector.ts` exists in pool but conceptually belongs in maestro (it collects device metadata via Maestro API). `git mv` preserves blame.

### Pool extension required
- `server/pool/events.ts` carries 4 events (state.changed, allocated, released, health.failed). NEEDS `device.booted` added — verified absent by grep. This unblocks maestro's subscription path AND was an open Phase 20 deferred item per Phase 23 Pitfall 4.

### Reference implementations
- Phase 21 artifacts (closest analog — module subscribing to upstream events).
- Phase 22 streaming (no-queue module template).
- Phase 23 jobs (most recent + most fluent factory + cross-module subscription pattern).
- Phase 20 pool (events.ts shape — adding 5th event).

### Conventions enforced (Phase 16-23 templated)
- MOD-01..09; TRACE-06/-08; EVENTS-03; Nyquist gate; dep-cruiser N-th rule; plugin-order.spec extension.
- Cross-module subscribers defer to `fastify.addHook('onReady', ...)`.
- `.test.ts → .spec.ts` rename via `git mv` 100% similarity.

</code_context>

<specifics>
## Specific Ideas

- Pool module gets a 5-event registry after this phase (4 → 5), not a brand-new event surface.
- Maestro is a "no-queue" module like streaming — the `Queue Produced` and `Queue Consumed` MODULE.md sections say "None".
- DeviceInfoCollector's relocation makes Phase 24 also a pool simplification (one less file in pool/ root), but pool's MODULE.md / dependencies array don't change — only its file count.
- Phase 24 is the smallest module migration so far (3 services, 2 events, 1 cross-module pool extension) — expect 5-6 plans, ~50min total per Phase 22/23 tempo.

</specifics>

<deferred>
## Deferred Ideas

- **DEFERRED-24-A: Maestro test rewrite to tests-as-spec style** — Phase 30 Test Migration Cleanup owns the actual rewrite of hierarchy-service.spec.ts + appium-service.spec.ts beyond the .test→.spec rename. Behavior matches Phase 22 deferral pattern.
- **DEFERRED-24-B: persistEnvelope 8th sample point** — maestro module factory will repeat the 10-line persistEnvelope block (8th copy after hooks/lifecycle/reporting/pool/artifacts/streaming/jobs). Phase 27+ extracts to shared helper.
- **DEFERRED-24-C: Appium driver lifecycle ownership** — AppiumService currently spawns/tears down drivers on demand; Phase 24 keeps that surface intact. A future phase may move Appium driver lifecycle behind queue-managed sessions.

</deferred>
