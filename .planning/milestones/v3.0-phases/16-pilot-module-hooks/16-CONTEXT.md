# Phase 16: Pilot Module — hooks - Context

**Gathered:** 2026-04-17
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 16 ships the complete v3.0 module pattern on the smallest real module (`server/hooks/`). The pilot proves every pillar end-to-end: `MODULE.md` (LLM-first public contract), barrel `index.ts` (no deep imports), `events.ts` (Zod schemas + emit helpers + name constants), `queue.ts` (pg-boss `hook.run` worker wired through the bus→queue bridge), colocated `schemas.ts`, `__tests__/` dir (tests-as-spec), and a `createHooksModule(deps)` factory that the thin Fastify plugin wires. `dependency-cruiser` lands in CI with two rules that enforce the module boundary (no deep imports into `server/hooks/internal/**`, no `bus.emit()` outside `events.ts`). ADR-002 commits the repo-wide file-naming convention so later phases copy the pattern without re-deciding. Phase 16 does NOT touch pool/artifacts/jobs call paths — imperative `HookExecutor.execute()` stays for backward compat; external wiring onto real `device.*`/`job.*` events lands in their respective module phases. Nyquist delta ≤ −2pp vs the Phase 15 baseline.

</domain>

<decisions>
## Implementation Decisions

### Module Structure & File Naming (ADR-002)
- `server/hooks/internal/**` is the explicit scope for dep-cruiser's deep-import denylist — everything under `internal/` is module-private by convention; anything re-exported by `index.ts` is public
- `schemas.ts` is the source of truth for `HookDefinition`; TypeScript types derive via `z.infer<typeof hookDefinitionSchema>` (SPEC-03)
- MODULE.md uses LLM-first structure — tight sections (Purpose / Public API / Events Emitted / Events Consumed / Queue Produced / Queue Consumed / Invariants / Non-Goals / Dependencies), ≤5 lines each, runnable example stub at end (MOD-09 full enforcement lands Phase 27)
- ADR-002 (repo-wide file-naming) commits in this phase: kebab-case filenames, singular for concepts (`schemas.ts`), plural for collectors (`handlers.ts`, `subscribers.ts`), colocated `__tests__/` directories, Nygard format

### Event Design (EVENTS-06, EVENTS-09)
- Four events published by the module:
  - `hook.scheduled` — fired when a bus trigger causes a queue enqueue (thin payload, not persisted)
  - `hook.completed` — terminal, persisted, emitted after successful execFile
  - `hook.failed` — transient, not persisted — emitted per failed attempt before retry
  - `hook.failed.retryExhausted` — terminal, persisted, emitted after pg-boss exhausts retries
- Events consumed by Phase 16: a synthetic `test.trigger` demo event (stub) wired through the bus→queue bridge to exercise the pattern end-to-end. Real consumers of `device.booted`, `device.shutdown`, `job.starting`, `job.completed` are wired in their respective module phases (20, 21, 23) once those events exist
- Thin payloads per EVENTS-04: `hook.scheduled` carries `{hookName, event, deviceId?, jobId?}` (correlationId comes from envelope, not payload); terminal events extend with `{exitCode, durationMs, stderrTail}` (exception allowed for terminal)
- `persisted: true` only on terminal events (`hook.completed`, `hook.failed.retryExhausted`) per TRACE-08 business-events rule. `hook.scheduled` and `hook.failed` (per-attempt) stay ephemeral

### Queue Design (QUEUE-06) + Idempotency
- Queue name `hook.run` — extends `QUEUE_NAMES` registry in `server/queue/names.ts` with `HOOK_RUN: 'hook.run'`; matches dotted-convention charset `^[a-z][a-z0-9._-]*$`
- `singletonKey = ${triggerEventId}:${hookName}` — uses the triggering envelope's `eventId` (stable across replays) + hook definition name; guarantees replay of the same bus trigger re-enqueues no-op
- `retryLimit: 1` — shell `execFile` is a physical side-effect; exponential backoff from queue-plugin default
- **Idempotency proof table**: new `hook_runs` table with `operation_key TEXT PRIMARY KEY` + `hook_name`, `event_id`, `triggered_at`, `exit_code`, `duration_ms`, `status`. Handler opens a transaction, attempts `INSERT ... ON CONFLICT (operation_key) DO NOTHING RETURNING operation_key`, and if no row was returned treats the replay as a duplicate — logs + returns without invoking execFile. Test replays the same `boss.send` twice and asserts exactly one `hook_runs` row + one execFile call (EVENTS-06)

### Tests-as-Spec & Migration
- Four test files under `server/hooks/__tests__/` — describe-block tree mirrors MODULE.md Public API
  - `events.spec.ts` — emit helpers, envelope stamping, schema parse round-trips
  - `queue.spec.ts` — `hook.run` worker, idempotency replay, retry-exhaust terminal event
  - `hook-executor.spec.ts` — Public API of `HookExecutor` (setHooks / addHook / removeHook / getHooksForEvent / execute); describe tree matches MODULE.md sections verbatim
  - `module.spec.ts` — `createHooksModule(deps)` factory wiring, plugin decorator surface
- Invariants (1 test each, MOD-08): (a) hooks execute sequentially per event, (b) `failOnError: false` never throws, (c) idempotent replay produces exactly 1 side-effect, (d) `enabled: false` hook never runs, (e) `platform` filter excludes wrong-platform hooks
- Factory shape: `createHooksModule(deps: {db, bus, boss, logger, config}) → {executor, registerBusSubscribers(), shutdown()}`. The Fastify plugin becomes a thin wrapper: construct factory → decorate `fastify.hookExecutor` → call `registerBusSubscribers()` → register `onClose` hook that calls `module.shutdown()`
- Migration stance: `HookExecutor.execute()` (imperative API) stays — no external callers exist today (hooks are only triggered via API routes + the legacy in-process call sites will migrate in Phases 20/21/23 when real `device.*`/`job.*` events land). No deprecation needed this phase; bus→queue is the new path, imperative path is untouched

### Claude's Discretion
- Exact shape of the `operationKey` derivation helper, the `hook_runs` table's non-PK columns, and whether to use Drizzle `.onConflictDoNothing()` vs raw SQL — at Claude's discretion as long as replay correctness holds
- MODULE.md prose tone/length inside the section caps
- Order of plans (ADR-002 first vs schema/queue/events first) at planner discretion
- Whether `registerBusSubscribers()` returns disposables or the factory's `shutdown()` owns teardown

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `server/bus/` already exports `TypedBus`, `createEventHelpers`, `EventRegistry` types — hooks builds its own per-module registry on top (Phase 15 substrate)
- `server/queue/plugin.ts` + `server/queue/names.ts` provide `fastify.boss` decorator + `QUEUE_NAMES` extension point + name validator — hooks queue wiring is additive
- `server/bus/plugin.ts` decorates `fastify.onPersisted(type, handler)` with ALS causation threading — hooks subscribers use this for free (TRACE-09)
- `server/types/ids.ts` exports branded ID types — `hook_runs.event_id` column types as `JobId`/`DeviceId`-compatible UUIDs (SPEC-09)
- Existing `HookExecutor` class (`server/hooks/hook-executor.ts`) is already well-structured — HookDefinition/HookContext/HookResult types lift cleanly into `schemas.ts`; `execute()` method stays as imperative surface
- `eslint-local-rules/` already has `no-imperative-event-names` + `no-direct-bus-emit` — events.ts is the allowlisted emit site; dep-cruiser adds the deep-import side
- `.planning/nyquist-baseline.json` exists from Phase 15 Plan 15-09 — delta gate reads from here

### Established Patterns
- Plugin substrate-first registration order in `server/index.ts` (config → correlation → db → event-bus → queue → telemetry → pool → …); hooks-plugin is registered between lifecycle and maestro
- Fastify factory-in-plugin pattern already proven (`server/correlation/` + `server/telemetry/` both expose module primitives via barrel and thin-plugin wrap)
- Emit helpers + `persisted: true` registry entries drive automatic persistence to `events` table (Phase 15 Plan 15-04)
- pg-boss wrapper `queue.send` serializes correlationId from ALS; `queue.work` restores it (Phase 15 Plan 15-05) — consumer handlers get correlationId via pino alsMixin without threading

### Integration Points
- `server/index.ts` plugin registration — hooks-plugin dependency array changes from `['config', 'pool-plugin']` to `['config', 'event-bus', 'queue', 'pool']` reflecting the substrate dependency
- `server/db/schema.ts` — add `hook_runs` table (Drizzle migration); indexes on `hook_name`, `event_id`, `triggered_at`
- `server/queue/names.ts` — extend `QUEUE_NAMES` with `HOOK_RUN: 'hook.run'`
- `docs/adr/` — new file `002-file-naming.md` (Nygard format)
- `.dependency-cruiser.cjs` — new config file (doesn't exist yet); CI pipeline addition for `npm run dep-check`
- `package.json` — add `dependency-cruiser` dev dep + `dep-check` script

</code_context>

<specifics>
## Specific Ideas

- `hook_runs.operation_key` uses TEXT PRIMARY KEY (not a composite UNIQUE index) so ON CONFLICT DO NOTHING is one-line and visible
- Terminal-event payload trims stderr to last 1 KB (consistent with existing HookResult's 10 KB cap inside the module's internal storage)
- ADR-002 explicitly calls out that `__tests__/` is preferred over `.test.ts` sibling files — mirrors existing codebase convention (server/db/__tests__/, etc.)
- The synthetic `test.trigger` demo event for Phase 16 can reuse the pattern of `demoRegistry` (Phase 15) — gets retired in Phase 20/21/23 when real events wire in

</specifics>

<deferred>
## Deferred Ideas

- Wiring hooks onto real `device.booted` / `device.shutdown` / `job.starting` / `job.completed` bus events — lands in Phase 20 (pool), Phase 21 (artifacts), Phase 23 (jobs) when those events start emitting
- MODULE.md runnable-example typecheck-in-CI enforcement — Phase 27 (MOD-09)
- Deleting `HookExecutor.execute()` imperative API — deferred until all external call sites have migrated to the bus-triggered flow
- DLQ endpoint (`GET /api/queue/dlq`) — Phase 19 (QUEUE-05)
- Actor field populated from auth context — Phase 26 (TRACE-10)

</deferred>
