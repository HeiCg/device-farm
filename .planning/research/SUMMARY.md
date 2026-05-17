# Project Research Summary

**Project:** Device Farm v3.0 — Spec-Driven Architecture
**Domain:** Structural refactor of existing Fastify/Go/SvelteKit test execution platform — no new user features
**Researched:** 2026-04-16
**Confidence:** HIGH (all research grounded in direct codebase reads + verified library versions via npm view)

---

## Executive Summary

Device Farm v3.0 is a structural refactor, not a greenfield build. The existing system (Fastify 5 server with 12-15 plugins, Go CLI with Cobra, SvelteKit 5 web UI, PostgreSQL with Drizzle ORM) is production-capable but has accumulated architectural debt: async work is split across three incompatible mechanisms (in-memory JobQueue, node-cron, and fire-and-forget .catch() patterns), module boundaries leak through Fastify's decorator-as-service-locator pattern, data contracts between server, CLI, and web are maintained by hand and have already drifted (the deviceName/deviceId UUID bug in the CLI), and there is no correlation context threading async operations together. The refactor consolidates all of this behind five locked pillars: Zod at all boundaries, a typed in-process event bus per module, pg-boss as the single durable queue (replacing in-memory queues and node-cron), correlation IDs with an append-only events table, and module-first conventions (MODULE.md, barrel index.ts, events.ts, tests-as-spec).

The recommended approach is a sequential module-by-module migration with a strict rule that a module is either fully migrated or fully unmigrated on main. A pilot module (hooks) validates the complete pattern at low blast radius before touching the critical path. Foundations (event bus, correlation, pg-boss plugin, events table) land first because nothing else can be wired without them. The keystone module (jobs) is refactored only after every module it depends on is already migrated and emitting correct events. Contracts (OpenAPI generation, Go and web codegen) are stabilized in a dedicated phase before CLI and web consumers are refactored, ensuring those refactors consume generated types rather than manually synced structs.

The dominant risk is scope bleed: because all five pillars are interdependent, the refactor naturally wants to be big-bang. The research identified nine BLOCKER pitfalls and fourteen MAJOR pitfalls. The top prevention strategy for every BLOCKER is the same — complete one module at a time, enforce module boundaries via dependency-cruiser, apply a coverage-baseline gate per phase, and maintain a migration status tracker. pg-boss introduces a second Postgres driver (pg alongside Drizzle's postgres/porsager), which is manageable at the current scale but requires explicit pool sizing. The live in-memory job queue requires a documented drain procedure before cutover to prevent job loss on deploy.

---

## Key Findings

### Recommended Stack

The existing stack (Fastify 5.8.2, Drizzle 0.45, SvelteKit 5, Zod 4.3.6, Vitest, pino, Cobra) is not changed. v3.0 adds four new libraries and one dev tool on top of it.

**Core new additions:**
- **pg-boss 12.15.0**: Postgres-native durable queue. Replaces the in-memory JobQueue (lost on crash) and both node-cron usages (pipelines scheduler, lifecycle). Chosen over graphile-worker for built-in DLQ, cron, pub/sub, and first-class TS types; chosen over BullMQ/Redis because Postgres-only is an explicit architectural constraint. Requires pg@^8.20.0 as a peer — creates a second Postgres driver alongside Drizzle's postgres (porsager). Two pools at fewer than 100 jobs/day is fine; size Drizzle to max 8 and pg-boss to max 4.
- **fastify-zod-openapi 5.6.1** (bundles fastify-type-provider-zod + zod-openapi): Wires Zod into Fastify request/response validation and generates OpenAPI 3.1 spec. The spec drives both Go CLI codegen and web client codegen — one source of truth for all three consumers.
- **drizzle-zod 0.8.3**: Derives Zod schemas from Drizzle table definitions (createSelectSchema, createInsertSchema). JSONB columns (jobs.metadata) require a manual override with a hand-written JobMetadataSchema — drizzle-zod cannot infer JSONB structure. Spike this in Phase 1.
- **DIY TypedBus (~50 lines)**: Typed wrapper over Node's built-in EventEmitter. Zero deps. Synchronous dispatch. Each module declares its event map in events.ts. No npm library — researched alternatives (emittery, mitt, eventemitter3, rxjs Subject) all have wrong semantics or add deps for code we control better.
- **Node AsyncLocalStorage (stdlib)**: Propagates correlationId through request async contexts. Requires explicit payload-based correlation propagation into pg-boss workers (ALS does not cross async chain boundaries at the pg-boss polling loop).

**Supporting tools:**
- **dependency-cruiser 17.3.10**: Enforces module boundary rules (no deep imports; only barrel index.ts). No ESLint config required; produces graph visualizations.
- **go-jsonschema 0.23.0** (brew install CLI tool): Generates idiomatic Go structs from JSON Schema extracted from the OpenAPI spec. Replaces hand-maintained cli/internal/client/types.go.
- **openapi-typescript + openapi-fetch** (web): Type-safe web client generated from the same OpenAPI spec.

### Expected Features (Architectural Patterns)

Features in this refactor are conventions and patterns, not user-visible capabilities.

**Must-have (table stakes):**
- Zod schemas colocated with their module (server/module/schemas.ts); z.infer as the only source of TS types at boundaries
- .parse() at trust boundaries only; .safeParse() when feeding an error channel; no hand-rolled interface Job that drifts from schemas
- Discriminated union schemas for polymorphic events; additive-only event evolution (.passthrough() on envelopes; .strict() on API request bodies)
- Branded ID types (z.string().uuid().brand<"JobId">()) — directly addresses the v2.0 CLI deviceName/deviceId bug
- Past-tense dotted event names (job.completed, device.allocated); event envelope with id, type, v, correlationId, causationId, occurredAt, payload
- Thin event payloads; fat only for terminal events (job.completed carries final summary)
- Synchronous bus for fast in-module reactions; pg-boss for cross-module retriable or scheduled work
- Per-module queue.ts registering workers and producing jobs; named queues per durable work-type; singletonKey: jobId on execution queues
- X-Correlation-Id header ingress; ALS propagation; correlationId in every log line, bus event, and pg-boss payload
- Append-only events table for business-level state transitions only (not per-line Maestro stdout)
- Every module has MODULE.md, barrel index.ts, events.ts, flat directory layout, tests-as-spec

**Should-have (differentiators):**
- OpenAPI 3.1 generation from Zod at build time → Go codegen → web codegen (single contract)
- Causation ID + actor field on business events (causation tree reconstruction in UI)
- Bus-to-queue bridge pattern (sync event triggers durable work enqueue in wiring layer)
- Module factory pattern createModule(deps) — explicit typed dependency graph; modules testable without Fastify
- DLQ observability endpoint + web UI page; ADR index starting with v3.0 as ADR-001

**Defer to v4+:**
- Full event sourcing; OpenTelemetry distributed tracing; choreographed sagas; global /schemas package; per-event custom pg-boss queues; Redis/BullMQ in any form; persisting all bus events to the events table

### Architecture Approach

The existing plugin-registration spine is the correct shape. v3.0 inserts three new foundational plugins at the top (event-bus, correlation, and queue after db) and refactors each existing plugin into a proper module. The job execution pipeline changes from a monolithic executeJob() function with inline side effects to a pub/sub model: jobs publishes job.started and job.completed; artifacts, streaming, reporting, hooks, and pipelines subscribe and respond via their own queue workers. The in-memory JobBroadcaster ring buffer is preserved for WebSocket replay — it becomes a bus subscriber rather than receiving direct calls from job-service. Crash recovery is handled by pg-boss redelivery.

**Major components (post-refactor):**
1. **Foundations layer** (event-bus, correlation, queue, telemetry): Three new plugins; telemetry is the only writer to the events append-only table.
2. **Device and execution core** (pool, jobs): Most critical modules; refactored late. Pool emits device.* events; jobs publishes job.* events and consumes device.released.
3. **Reaction modules** (artifacts, streaming, reporting, hooks): Pure event subscribers that react to job.* and device.* events and enqueue their own durable work.
4. **Scheduling** (lifecycle, pipelines): Both migrate from node-cron to boss.schedule(). Pipeline scheduler registers/unregisters named schedules on CRUD operations.
5. **Contract layer** (api, generated OpenAPI, codegen targets): api becomes a thin route aggregator; cli/internal/client/generated.go and web/src/lib/api/generated-types.ts are committed to the repo.
6. **Cross-cutting** (db extended with events table, correlation context, dependency-cruiser config).

**Plugin registration order (v3.0 target):**
config → event-bus → correlation → dependency-checker → db → queue → telemetry → auth → pool → websocket → artifacts → reporting → hooks → maestro → jobs → pipelines → lifecycle → api → static

**Tech debt fixed as part of refactor:**
- job-plugin vs jobs-plugin name mismatch in pipelines deps (trivial fix during name normalization)
- websocket-plugin missing pool dep declaration (fixed when streaming module migrates)
- lifecycle → api undeclared dep (fixed when lifecycle migrates)
- dependency-checker promoted from function call to proper plugin
- deviceName fix: server joins devices table and returns both deviceId and deviceName in job response; Zod output schema enforces shape; codegen propagates to Go and web

### Critical Pitfalls

**BLOCKER pitfalls (9 identified — all must be addressed with phase success criteria):**

1. **Big-bang scope bleed**: Interdependent pillars want a global rewrite. Prevention: a module is in exactly one of {refactored, unrefactored} on main; every phase touches exactly one server/module/ folder plus wiring. Phase 1 PR touching more than 3 top-level folders is a scope failure.

2. **Wrong pilot module**: Too critical (pool, auth, jobs) risks the system; too trivial (reporting alone) leaves the pattern unvalidated. Pilot must be non-critical, exercise all pillars, and have small blast radius. Both architecture and pitfalls research converge on hooks as the pilot.

3. **Live in-memory queue drain on deploy**: Jobs in the current JobQueue vanish on process restart during pg-boss cutover. Requires a documented drain procedure: stop accepting new submissions, wait for queue empty, then deploy. An /admin/drain endpoint is the implementation.

4. **pg-boss retry doubles real-world side effects**: Retrying a handler that already booted an emulator, started recording, or installed an APK causes port conflicts, duplicate MP4s, and mutex deadlocks. Prevention: singletonKey: jobId on execution queues; retryLimit: 0 or 1 for device-touching handlers; step journal in events table for resumption.

5. **Two Postgres drivers exhaust connection pool**: Drizzle (postgres/porsager) and pg-boss (pg@8) both hold pools. Must be explicitly sized: Drizzle max 8, pg-boss max 4. Config-driven. Document the two-pool reality in the queue module's MODULE.md.

6. **ALS context lost at pg-boss worker boundary**: Workers run in a different async chain. Every job schema must include correlationId: z.uuid() required; every worker must restore context via logContext.run() before executing the handler.

7. **Test coverage lost during refactor**: Tests coupled to fastify.jobService and job-queue.ts internals will break when internals move. Porting rule: every deleted test needs a replacement or explicit justification. Coverage baseline gate: no phase may drop coverage more than 2pp; aggregate drop across milestone max 5%.

8. **Wrong module boundaries**: Target 10-14 modules total. Boundary criterion: a module has its own events, its own DB tables/JSONB shapes, its own Fastify plugin slot, and can be understood by reading only its folder. If the answer to "why does this module exist" is organizational rather than behavioral, merge it.

9. **Half-migrated hybrid state in main**: Partial migrations create seams where bugs accumulate. Track migration state in .planning/migration-status.md with binary module states.

**Top 5 MAJOR pitfalls:**

1. **Zod parse in hot paths**: 50-200 bus events per second during Maestro runs. Parse only at trust boundaries; bus emissions within the producing module use TypeScript types only.

2. **Response schema omitted on API routes**: Developers add request validation and skip response schemas. Route-registration helper must refuse routes without a 200-response schema; CI must diff the generated OpenAPI spec between commits.

3. **drizzle-zod + JSONB round-trip**: createSelectSchema types JSONB as z.unknown(). Manual schema override required for jobs.metadata and similar columns. Spike required in Phase 1.

4. **Listener errors swallowed or blocking event loop**: TypedBus wrapper must wrap each listener in try/catch, log and continue; document that listeners do metadata work only; test that listener A throwing does not prevent listener B from running.

5. **DLQ accumulates silently**: Any DLQ item at this job volume deserves immediate investigation. DLQ depth metric, /admin/dlq endpoint, and web UI page are success criteria of the pg-boss phase, not follow-ups.

---

## Implications for Roadmap

The architecture research provides an explicit 16-phase build order. Use this sequence with the rationale below.

### Phase 1: Foundations
**Rationale:** event-bus, correlation, queue (pg-boss), telemetry plugin, and the events DB table are prerequisites for all subsequent module migrations. Adds zero user-visible change.
**Delivers:** New plugin slots in registration order; events table schema committed; AsyncLocalStorage hook wired; pg-boss started with explicit pool sizing (Drizzle max 8, pg-boss max 4); TypedBus in server/shared/; dependency-cruiser.cjs with initial boundary rules; boss.stop() in Fastify onClose.
**Avoids:** Pitfalls 4, 5, 6. Pitfall 6 (ALS boundary) enforcement test ships with this phase.
**Research flag — spike required before marking complete:** drizzle-zod JSONB behavior on jobs.metadata; pg-boss auto-migration timing on dev DB; Postgres version requirement confirmed (PG 13+ required for pg-boss 12).

### Phase 2: Pilot Module — hooks
**Rationale:** Proves the complete MODULE.md + barrel + events.ts + pg-boss queue + tests-as-spec pattern at lowest blast radius. All subsequent modules copy from this reference.
**Delivers:** server/hooks/ fully refactored; MODULE.md template established; tests-as-spec for hook-executor contract; hook workers in pg-boss; hook.executed and hook.failed published to bus.
**Avoids:** Pitfall 2 (wrong pilot); pitfall 1 (scope gate — only server/hooks/ and wiring touched).
**Success criterion:** Coverage delta is at most -2pp; only hooks folder is modified.

### Phase 3: Build and Ops Hygiene / Contracts
**Rationale:** Before refactoring any module that CLI and web consume, the contract pipeline must exist. OpenAPI generation, Go codegen, and web codegen must be buildable. The file:../device-stream sibling-repo coupling must be resolved. Plugin name mismatches must be fixed.
**Delivers:** npm run openapi:generate emitting contracts/openapi.json; cli/internal/client/generated.go generated and committed; web/src/lib/api/generated-types.ts generated and committed; CI freshness check (git diff --exit-code on generated files); plugin name normalization (job-plugin to jobs, etc.); websocket declaring pool as dep; @device-stream/* published as private packages.
**Avoids:** Pitfall 11 (OpenAPI diff CI catches missing response schemas).
**Research flag:** Spike go-jsonschema with a discriminated union schema before locking the full codegen pipeline design.

### Phase 4: lifecycle Migration
**Rationale:** Simplest queue migration. lifecycle uses node-cron for daily/hourly housekeeping. Migrating to boss.schedule() validates the pg-boss cron API with zero user-visible impact.
**Delivers:** node-cron removed from lifecycle; three lifecycle schedules via boss.schedule() with singletonKey + singletonSeconds; lifecycle-plugin added to api declared deps (tech debt fix).
**Avoids:** Pitfall 19 (cron overlap — singletonKey prevents back-to-back firing after a hang); pitfall 21 (graceful shutdown — boss.stop already wired from Phase 1).

### Phase 5: reporting Migration
**Rationale:** Webhook delivery is the most visible fire-and-forget antipattern with real production consequences. Migrating to pg-boss validates the full retry/DLQ path in a production-meaningful but isolated module.
**Delivers:** webhook-deliver queue with retryLimit 5, retryBackoff, and DLQ consumer; /admin/dlq endpoint; DLQ depth metric; WebhookService.deliverOnce() (single-attempt); reporting subscribes to job.completed bus event.
**Avoids:** Pitfall 22 (DLQ observability as success criterion, not follow-up).

### Phase 6: pool (Devices) Module
**Rationale:** Pool must be migrated before jobs because jobs subscribes to device.released to trigger re-dispatch. Pool is the largest-risk module refactor in the sequence.
**Delivers:** Pool emits device.booted, device.shutdown, device.health.failed, device.state.changed, device.allocated, device.released; health checker and reaper move from server/index.ts onReady into pool's onReady; websocket declared dep of pool fixed.
**Avoids:** Pitfall 15 (event ordering — pool state transitions remain atomic through direct state-machine calls, not bus events).

### Phase 7: artifacts Module
**Delivers:** Recording, screenshot, and memory artifact creation triggered by bus events (job.started, job.completed); job-service no longer calls artifact functions directly.

### Phase 8: streaming Module
**Delivers:** Streaming subscribes to job.log and job.step bus events and translates to WebSocket fan-out. JobBroadcaster ring buffer preserved; only the fill path changes from direct calls to bus subscriptions.

### Phase 9: jobs Module (Keystone)
**Rationale:** The highest-risk phase. Refactored last among server modules because it depends on pool, artifacts, streaming, reporting, and hooks all being correct event emitters first. All .catch(() => {}) antipatterns are removed here.
**Delivers:** executeJob publishes to bus instead of calling dependencies imperatively; job-auto-link moved to pg-boss queue; in-memory JobQueue removed; drain procedure executed during deploy; deviceName fix in job response (Zod output schema enforces shape; codegen propagates to Go and web).
**Avoids:** Pitfall 3 (drain procedure documented and rehearsed); pitfall 4 (singletonKey: jobId, retryLimit: 0 for device-touching handler).

### Phase 10: maestro Module
**Delivers:** Maestro metadata collection subscribes to device.booted; extracted from route files; server/index.ts onReady further simplified.

### Phase 11: pipelines Module
**Delivers:** Pipeline scheduler migrated from node-cron to boss.schedule() with idempotent upsert on CRUD; pipeline-schedule-trigger worker registered; pipelines subscribes to job.completed for stage advancement.
**Avoids:** Pitfall 19 (schedule fire overlap — singletonKey).

### Phase 12: auth Module
**Delivers:** Auth routes validated with Zod response schemas; auth.key.created and auth.key.revoked published to bus. Late in sequence: security-sensitive, low ROI for core refactor goals.

### Phase 13: api Module and Route Aggregation
**Delivers:** api becomes thin aggregator; every module exposes its own routes via its barrel; fastify-zod-openapi fully wired; api declared deps aligned with all migrated modules.

### Phase 14: CLI (Go) Refactor
**Rationale:** After server-side schemas are stable and committed generated types exist, CLI switches to consuming generated Go types.
**Delivers:** CLI commands consume generated types from cli/internal/client/generated.go; hand-written structs removed where covered by codegen; deviceName now correct in generated types.
**Research flag:** go-jsonschema discriminated union handling may require manual Go overrides for WS message types; validate scope before planning this phase.

### Phase 15: Web (SvelteKit) Refactor
**Delivers:** SvelteKit API client consumes generated-types.ts; WS message handling uses shared Zod schemas; route-local schemas aligned with server OpenAPI.

### Phase 16: Test Migration Cleanup (Incremental)
**Rationale:** Tests-as-spec rewrites happen incrementally during phases 2-13. This phase is a cleanup pass to verify the aggregate coverage baseline and add cross-module integration tests.
**Delivers:** Cross-module job-lifecycle integration test; OpenAPI contract roundtrip CI test; coverage baseline confirmed across all modules.

### Phase Ordering Rationale

- Foundations before everything: bus and queue are prerequisites for all module wiring.
- Pilot before large modules: the MODULE.md + barrel + events.ts pattern must be proven cheaply before replicating at scale.
- Contracts (Phase 3) before CLI and web refactors: generated types must exist before consumers can refactor against them.
- Pool (Phase 6) before jobs (Phase 9): jobs subscribes to pool events; pool must emit before jobs can react.
- Jobs last among server modules: it is the dependency sink; all upstream modules must be stable before jobs changes.
- CLI and web are leaf consumers of the contract; they refactor once server-side schemas are stable.

### Research Flags

Phases requiring deeper investigation or spikes before planning is locked:
- **Phase 1:** drizzle-zod JSONB round-trip spike; pg-boss auto-migration timing and schema isolation on dev DB.
- **Phase 3:** go-jsonschema discriminated union output spike; @device-stream/* packaging and registry strategy design.
- **Phase 6:** Pre-phase review of VALID_TRANSITIONS against new event emission points; highest-risk single module.
- **Phase 9:** Pre-phase runbook review of in-memory queue drain procedure and retryLimit policy per queue type.

Phases with well-established patterns (skip additional research):
- **Phase 4:** node-cron to boss.schedule() is a canonical pg-boss use case; fully documented.
- **Phase 5:** Webhook queue with retry/DLQ is a canonical pg-boss pattern; fully researched.
- **Phase 12:** Zod route schema addition to auth; no architectural novelty.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All versions verified via npm view 2026-04-16; compatibility matrices confirmed against installed versions; two-driver Postgres concern flagged and manageable |
| Features (patterns) | HIGH | Grounded in direct codebase read of job-service.ts, plugin chain, and scheduler; patterns validated against upstream docs |
| Architecture | HIGH | Full read of server/index.ts, server/jobs/job-service.ts, server/db/schema.ts, all scheduler and lifecycle plugins; module decomposition cross-checked against current plugin list |
| Pitfalls | HIGH for integration pitfalls (direct codebase observation); MEDIUM for pg-boss v10-to-v12 migration specifics and drizzle-zod JSONB (need Phase 1 spike) |

**Overall confidence:** HIGH with two targeted spikes required before Phase 1 is marked complete.

### Gaps to Address

- **drizzle-zod + JSONB**: createSelectSchema behavior on jobs.metadata is confirmed theoretically unreliable but not yet spiked against the actual DB. Phase 1 spike creates a round-trip test and documents the override pattern.
- **pg-boss auto-migration timing**: No published v10-to-v12 full migration guide. For greenfield install (no existing pgboss schema), risk is lower, but boss.start() must be spiked to confirm migration duration and that drizzle.config.ts schemaFilter correctly excludes the pgboss schema.
- **go-jsonschema + discriminated unions**: Tool handles JSON Schema oneOf but Go has no sum types. WS message types will likely require manual Go mapping. Spike before Phase 3 design is locked.
- **@device-stream/* packaging**: file:../device-stream peer dep requires a sibling repo checked out. Private registry setup and auth token management not yet designed. Flag for Phase 3 planning.
- **Graceful shutdown duration**: Mac Mini-hosted tests run up to 10 minutes. Supervisor KillTimeout must match. Current value unknown. Must be discovered and configured as part of Phase 1 (boss.stop({ graceful: true, timeout })).

---

## Sources

### Primary (HIGH confidence)
- npm view (2026-04-16): pg-boss@12.15.0, fastify-type-provider-zod@6.1.0, drizzle-zod@0.8.3, zod-openapi@5.4.6, fastify-zod-openapi@5.6.1, dependency-cruiser@17.3.10, emittery@2.0.0, mitt@3.0.1, eventemitter3@5.0.4, graphile-worker@0.16.6
- server/index.ts — plugin registration order (direct read)
- server/jobs/job-service.ts — current job pipeline (direct read)
- server/db/schema.ts — 25 existing tables (direct read)
- server/hooks/plugin.ts, server/pipelines/scheduler.ts, server/lifecycle/lifecycle-plugin.ts — cron usage patterns (direct read)
- .planning/PROJECT.md — v3.0 milestone scope and five locked pillars
- github.com/timgit/pg-boss — queue API, schedule API, DLQ behavior, v12 features
- github.com/samchungy/zod-openapi — Zod v4 native OpenAPI 3.1 generation
- github.com/omissis/go-jsonschema — v0.23.0, Go struct generation from JSON Schema

### Secondary (MEDIUM confidence)
- Jimmy Bogard — past-tense event naming convention (domain events)
- Mathias Verraes — fat vs thin event payloads
- Node.js AsyncLocalStorage docs — propagation semantics across async chains
- Microsoft DDD domain events patterns — sync vs async event guidelines
- LogSnag pg-boss scheduled jobs deep-dive — cron scheduling patterns

### Tertiary (LOW confidence — needs validation)
- pg-boss v10-to-v12 migration behavior: release notes visible; no complete migration guide; treat as MEDIUM until spiked on dev DB
- go-jsonschema discriminated union output: tool handles oneOf confirmed; Go ergonomics not tested against our specific schemas
- drizzle-zod JSONB override syntax confirmed in docs; actual round-trip behavior against Postgres JSONB not tested

---
*Research completed: 2026-04-16*
*Ready for roadmap: yes*
