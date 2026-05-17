# Phase 20: Pool Module (Devices) - Context

**Gathered:** 2026-04-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Refactor `server/pool/` to Phase 16 module conventions (MODULE.md + barrel + events.ts + queue.ts + tests-as-spec + factory `createPoolModule(deps)`) and make the pool the authoritative emitter of `device.*` events from within the state machine. Concrete deliverables:

1. `VALID_TRANSITIONS`-gated state changes (`Device.transition`) fire `device.state.changed` envelopes with `{deviceId, from, to, correlationId}`; `PoolManager.acquire` / `release` publish `device.allocated` and `device.released`; `HealthChecker` on-failure publishes `device.health.failed`.
2. `server/index.ts` stops starting `healthChecker` + the process reaper directly; `pool` owns both via `registerWorkersAndSubscribers` (or equivalent lifecycle hook called from the pool plugin body).
3. `websocket` plugin declares `pool` as a Fastify dependency; the device-preview handler reaches pool state only through the public barrel (`server/pool/index.ts`), not deep imports.
4. Pool module fully migrated: `server/pool/MODULE.md` (9 fixed H2 sections + runnable example), `server/pool/index.ts` barrel, `server/pool/events.ts` (Zod schemas + emit helpers + event-name constants + registry), `server/pool/queue.ts` (`device.boot` + `device.reap` queues via Phase 18 wrapper), `server/pool/internal/module.ts` factory, tests-as-spec `*.spec.ts` files; each state-machine invariant documented in MODULE.md has a matching test.
5. Nyquist delta ≤ −2pp vs Phase 15 baseline; `npm run dep-check` clean for pool/internal/*; downstream (`jobs`, `maestro`, `hooks`) consume `device.*` events via `fastify.bus.on(...)` — no deep imports of `server/pool/*` internals.

Phase 20 does NOT rewrite the Android/iOS drivers (they remain under `server/pool/android/` and `server/pool/ios/`); does NOT touch device-stream packaging (Phase 17 scope); does NOT refactor `jobs` or `artifacts` to consume the new events (that's Phase 21/23 scope — this phase only guarantees the events are published).

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion

All implementation choices at Claude's discretion — pure infrastructure phase. References:

- **Phase 16 (`server/hooks/`)** — canonical MOD-01..06 pattern (MODULE.md shape, barrel re-export via `internal/module.js`, events.ts Zod + emit helpers, factory).
- **Phase 18 (`server/lifecycle/`)** — reference for a module that (a) owns a scheduled/recurring concern (health check = lifecycle's compression/retention analogue), (b) emits via the same persistEnvelope pattern, (c) graceful-shuts via `onClose`.
- **Phase 19 (`server/reporting/`)** — reference for a module that subscribes to bus events AND emits terminal events (pattern for `device.health.failed`).
- **Phase 15 substrate**: `server/queue/plugin.ts` `send()` wrapper, `server/bus/helpers.ts`, `server/events/` persistence, `server/correlation/` ALS.
- **Phase 17 pipeline**: Zod→OpenAPI for any new routes (none strictly required; device preview WS uses existing ws-schemas).

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `server/hooks/` — MOD-01..06 canonical pattern; copy directory layout + MODULE.md section ordering.
- `server/lifecycle/` + `server/reporting/` — two prior module-migration references; `internal/module.ts` factory shape and thin-plugin wirer to mirror.
- `server/pool/pool-manager.ts` — current PoolManager class with `acquire` / `release` / `transition` call sites (lines ~39, 101, 181, 224, 238, 306 transition calls).
- `server/pool/device.ts` — Device class housing `transition(next)` → `VALID_TRANSITIONS` gate (server/types/index.ts).
- `server/pool/health-checker.ts` — polling loop currently `start(30000)` from `server/index.ts:210`; move ownership into pool lifecycle.
- `server/pool/process-tracker.ts` + `zombie-detector.ts` — reaper dependencies; reaper `setInterval` currently in `server/index.ts` around line 213; move into pool.
- `server/pool/plugin.ts` — existing thin plugin; extend to register module workers + subscribers + onClose.
- `server/queue/names.ts` — extend with `DEVICE_BOOT = 'device.boot'` + `DEVICE_REAP = 'device.reap'` constants (dot-separated per Phase 19 convention).
- `server/bus/` — `subscribe(name, handler)` helper; pool is primarily a PUBLISHER (downstream subscribes to `device.*`).
- `server/events/` — envelope + persistEnvelope middleware (duplicated in lifecycle + reporting per RESEARCH Open Question #1; pool is third sample → consolidate Phase 27+).
- `.dependency-cruiser.cjs` — extend forbidden rule for `server/pool/internal/*` mirroring hooks/lifecycle/reporting.

### Established Patterns
- Factory `createXModule(deps): XModule` returning `{ registerWorkersAndSubscribers, shutdown, events }`.
- Thin plugin wirer: build module → decorate fastify → register workers → `fastify.onClose(() => module.shutdown())`.
- Atomic per-task commits; SUMMARY.md per plan; PLAN.md frontmatter (wave, depends_on, files_modified, autonomous).
- Tests-as-spec: `*.spec.ts` co-located under `__tests__/`; DB-gated specs require `DATABASE_URL`.
- pg-boss canonical sequence: `createQueue → schedule|work → offWork`.
- Event envelope shape: `{ id, type, v, correlationId, causationId, occurredAt, actor, aggregateType, aggregateId, payload }`.
- Terminal events: `<domain>.<verb>.<terminal-reason>` (e.g., `device.health.failed`).
- `makeXEmitters(deps)` produces a proxy of emit helpers with persistEnvelope onEmit wiring.

### Integration Points
- `fastify.boss` / `fastify.bus` / `fastify.logContext` / `fastify.events` decorators available post-plugin-ready.
- `server/index.ts:210` (`app.healthChecker.start(30000)`) + line 213 (reaper `setInterval`) → move into `pool` plugin body or module `registerWorkersAndSubscribers`.
- `server/index.ts:246` (`app.healthChecker.stop()`) + line 249 (reaper stop) → pool `onClose`.
- `server/websocket/` device-preview handler currently imports from `server/pool/pool-manager.ts` deep path — rewire to `server/pool/index.ts` barrel and add `dependencies: ['pool-plugin']`.
- Downstream consumers (`server/jobs/`, `server/maestro/`, `server/hooks/`) that need device state react via `fastify.bus.on('device.state.changed'|'device.allocated'|'device.released'|'device.health.failed', ...)` — no deep imports.

</code_context>

<specifics>
## Specific Ideas

- Queue name constants (dot-separated, per Phase 19 canonical): `DEVICE_BOOT = 'device.boot'`, `DEVICE_REAP = 'device.reap'`.
- Event name constants (past-tense, dotted per EVENTS-03): `device.state.changed`, `device.allocated`, `device.released`, `device.health.failed`, `device.booted` (if emitted on boot completion for `maestro` Phase 24 consumer; otherwise defer).
- `aggregateType: 'pool'` + `aggregateId = deviceId` for all `device.*` envelopes.
- `actor` defaults to `'system'` for health-check + reaper emissions; populated from ALS where an HTTP request triggered allocation/release.
- Health-checker interval stays 30s (config-driven already); reaper stays 60s.
- Invariants to enumerate in MODULE.md (each with 1 test per MOD-08):
  - Only `VALID_TRANSITIONS`-allowed state changes succeed; disallowed throws.
  - Every successful transition emits exactly one `device.state.changed` envelope.
  - `acquire` is mutex-protected; concurrent requests for the same device serialize.
  - `health.failed` emission transitions device to `Error` (or `Offline` per driver).
  - Reaper never kills a process belonging to an allocated device.
- ALS store shape: use canonical plain-object form per Phase 19 (`{ correlationId, currentEventId, actor }`); new pool specs must NOT use legacy Map form.
- Nyquist: maintain delta ≤ −2pp vs Phase 15 baseline (same budget as Phase 16/18/19).
- Exclusion set: inherit Phase 18/19 exclusions (fastify-zod-openapi v5 `required` emission bug, pool-plugin-order substring-match bug) — document pre-existing failures in deferred-items if they re-surface.

</specifics>

<deferred>
## Deferred Ideas

- `device.booted` metadata consumer side (Maestro hierarchy / device-info subscriber) — Phase 24 scope.
- `device.*` webhook fan-out (reporting subscriber for device events) — downstream; current reporting subscribes only to `job.completed`.
- Android/iOS driver internal refactor (kebab-case, schema extraction) — out of scope; drivers stay as-is unless incidental to events wiring.
- `jobs` and `artifacts` consumer rewiring to read `device.*` from bus — Phase 21/23 scope.
- Consolidating duplicated `persistEnvelope` across hooks/lifecycle/reporting/pool (4th sample point reached in this phase) — Phase 27+.

</deferred>

---

*Phase: 20-pool-module-devices*
*Context gathered: 2026-04-21 via autonomous infrastructure skip*
*Pattern references: Phase 16 (hooks) canonical, Phase 18 (lifecycle) + Phase 19 (reporting) as reinforced precedents.*
