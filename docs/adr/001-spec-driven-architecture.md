# ADR-001: Spec-Driven + Event-Driven Architecture for Device Farm v3.0

## Status

Accepted — 2026-04-17

## Context

Device Farm v2.0 shipped a working single-node test execution platform on Apple Silicon Mac Minis: Android emulators and iOS simulators managed by a Fastify server, Maestro flows executed against them, MP4 recordings captured, and logs streamed live over WebSocket to both a Go CLI and a SvelteKit dashboard.

The platform works. Customers run tests on it every day.

What does not work is the codebase's relationship with the humans (and LLM assistants) who have to evolve it. The server is organised as a set of Fastify plugins that share long-lived services via decorators (`fastify.jobService`, `fastify.pool`, `fastify.artifacts`), but the code inside those services is a web of cross-module imperative calls.

`jobService.executeJob` reaches directly into `recordingService`, `webhookService`, and `JobBroadcaster`; a plugin rename or a new subscriber requires hunting call sites across ten files. Queue semantics are split across in-memory Promise chains for job execution and `node-cron` timers for lifecycle housekeeping — there is no single place in the tree that captures "what runs asynchronously, what retries, what survives a crash, what calls external systems."

There are no correlation IDs: a QA report of "test N failed yesterday at 14:03" requires manual correlation across five log sources (Fastify request logs, pino job logs, Maestro stdout, ffmpeg stderr, webhook delivery logs). There is no typed event vocabulary to read — adding a subscriber means reading imperative call sites and reverse-engineering what each site is trying to say.

Zod validation exists only at Fastify route boundaries. `.catch(() => {})` Promise-chain error swallowing appears in several places. DB rows, WebSocket frames, and `config.yaml` are only loosely typed by TypeScript interfaces that drift from reality every time a column is added or a message variant is introduced.

The team is one engineer plus LLM assistants (Claude Code, GitHub Copilot). Volume today is modest (<50 jobs/day) but adoption is growing, and the assumption that LLM-assisted maintenance must remain economically viable for a one-person operator is load-bearing.

That assumption pushes the design toward readable module contracts, narrow public APIs, typed event vocabularies, and tests that read as specifications — so an LLM agent can reason about a single module without walking the tree.

v3.0 is therefore a 100% architectural refactor: no new end-user features, sixteen phases (15–30), modules rewritten one at a time behind stable public contracts. The v2.0 tech debt that would otherwise block this work — operational dependencies (`@device-stream/*` resolved via `file:../device-stream`), CLI `deviceName` mislabelling, Nyquist validation never executed — is absorbed into the relevant phases rather than left for a separate cleanup milestone.

## Decision

Adopt a spec-driven + event-driven architecture organised around five locked pillars. Each pillar is non-negotiable for the duration of the v3.0 milestone; deviations require a superseding ADR.

### Pillar 1 — Zod at every trust boundary

Zod 4 becomes the single source of truth for every shape that crosses a trust boundary: Fastify API request/response bodies, WebSocket frames, event envelopes and payloads, Postgres row decoders (`decodeJobRow(row): Job`), and `config.yaml`.

TypeScript types are never hand-written at boundaries — they are derived via `z.infer<typeof X>`. A lint-reviewed convention prevents re-declaring boundary types.

Branded ID types live centrally in `server/types/ids.ts`. `JobId`, `DeviceId`, `PipelineId`, `ArtifactId`, and `RecordingId` are each declared as `z.string().uuid().brand<"JobId">()` and exported from one file; passing a `DeviceId` where a `JobId` is expected fails at compile time (compile-fail proof lives in a dedicated `*.compile.ts` fixture).

Zod sits at boundaries only; internal function arguments continue to rely on TS checking, since runtime parsing on hot in-process calls has unjustifiable cost.

### Pillar 2 — In-process typed event bus per module

Each module owns an `events.ts` file containing its Zod event schemas, its emit helpers (e.g. `jobEvents.completed(jobId, summary)`), and its string-literal event-name constants.

A thin typed wrapper over Node's `EventEmitter` — `bus.on<T>(type, handler)` — narrows the payload type via the module's event registry. The bus is synchronous and exists for same-request work: cache invalidation, WebSocket broadcast, in-memory index updates, composition of derived state.

Event names follow `noun.verbed` past-tense dotted form (`job.completed`, `device.allocated`, `recording.stopped`). The `no-imperative-event-names` ESLint rule rejects names that don't match the pattern.

Emit helpers in each module's `events.ts` are the only legitimate callers of `bus.emit(...)`. The `no-direct-bus-emit` ESLint rule rejects direct `bus.emit(...)` calls anywhere else, with an allowlist for `**/events.ts` files and test files.

Event payloads default to thin (IDs + minimal delta) with a documented exception for terminal events that must carry enough context to be actionable standalone.

### Pillar 3 — pg-boss v12 as the single durable queue

pg-boss v12 replaces every in-memory queue and every `node-cron` schedule in the server.

v2's `JobQueue` (in-memory) is removed in Phase 23 (Jobs Module Keystone); v2's `node-cron` schedules (lifecycle housekeeping, pipelines scheduler) are migrated in Phase 18 (Lifecycle Migration) and Phase 25 (Pipelines Module).

The operational rule that partitions bus and queue is documented here verbatim and enforced by code review — this is EVENTS-05:

> **sync bus = same request / cache / WS broadcast; pg-boss queue = anything that retries, survives crash, or calls external**

Named queues live in per-module `queue.ts` files (`server/jobs/queue.ts`, `server/webhook/queue.ts`) and register through a central `server/queue/names.ts` constants module for type-safe references.

Handlers whose work has physical side effects (spawning an emulator, launching Maestro, running `adb install`) default to `retryLimit: 1` with a `singletonKey` keyed on the aggregate id — a re-enqueue cannot boot a second emulator for the same jobId. Non-physical handlers (webhook delivery, cleanup) may override `retryLimit` upward in their `queue.ts`.

Producer and consumer payloads are Zod-validated at the queue boundary in both directions.

### Pillar 4 — Correlation IDs + append-only `events` table

An `AsyncLocalStorage`-backed correlation ID flows through every request and every queue job.

A `correlation` Fastify plugin (built on `@fastify/request-context` v6) reads `X-Correlation-Id` from the request header or generates a fresh `crypto.randomUUID()`, echoes it in the response header, and binds it to a pino child logger so every log line for the request carries `correlationId`.

The queue wrapper `queue.send(name, payload, opts)` serialises the active correlation id into `boss.send`'s `data`. The consumer registration helper restores ALS via `asyncLocalStorage.run(objectStore)` before invoking the handler, so scheduled and queue-triggered work carry the same id as the request that enqueued them.

Business events flagged `persisted: true` in their registry entry land in a new append-only `events` Postgres table — columns `id, event_type, event_version, correlation_id, causation_id, aggregate_type, aggregate_id, payload jsonb, occurred_at, actor`, indexed on `correlation_id / event_type / occurred_at`.

A subscriber runner wraps handlers to set `currentEventId` into ALS before invocation; nested emit helpers read it off ALS and auto-populate `causationId`, so callers never thread it manually.

`GET /api/events?correlationId=X` (Phase 27 API Aggregator & Events API) returns a causal tree — a user pastes a correlation id from a log line and sees the full request → saga → webhook-DLQ chain without any OpenTelemetry operational weight.

### Pillar 5 — LLM-first modules

Each `server/<module>/` directory has a fixed shape:

- `MODULE.md` — Purpose / Public API / Events Emitted / Events Consumed / Queue Produced / Queue Consumed / Invariants / Non-Goals / Dependencies.
- `index.ts` — a barrel that exports only the public API; no deep imports allowed from outside.
- `events.ts` — Zod schemas, emit helpers, and event-name constants.
- `queue.ts` — queues the module produces or consumes.
- `schemas.ts` — request/response shapes.
- Factory `createXModule(deps): XModule` consumed by a thin Fastify plugin that only wires (`fastify.decorate('x', createXModule({db, bus, boss, logger}))`).

Tests are written as specifications. `describe` blocks mirror the `MODULE.md` Public API and Invariants sections; files are named `events.spec.ts` and `saga.spec.ts` rather than 1:1 with source files.

`dependency-cruiser` enforces the no-deep-imports rule in CI.

This convention is established in Phase 16 on the `hooks` pilot module — the smallest real module that exercises all five pillars — and then replicated in every subsequent module refactor.

## Consequences

### Positive

- LLM agents can reason about one module at a time by reading `MODULE.md` (contract) + `events.ts` (vocabulary) + `__tests__/*.spec.ts` (behaviour). The need to walk the tree to understand "what emits this?" or "who subscribes to that?" disappears.
- Event-driven seams make module extraction reversible: if a new subscriber misbehaves, unplug it. Imperative cross-module calls in v2 offered no such lever — they had to be unwound.
- `events` table + `correlationId` deliver free causal tracing without OpenTelemetry's operational weight. A single SQL query by `correlation_id` reconstructs an entire job lifecycle.
- pg-boss as the durable queue eliminates `.catch(() => {})` Promise-chain error handling — failures become observable queue retries and dead-letter rows, not silent swallowed exceptions.
- Branded ID types catch `deviceId` vs `jobId` mix-ups at compile time instead of production (the v2 tech-debt item DEBT-02, visible as a blank `DeviceName` in the CLI, is structurally prevented going forward).
- Codegen pipeline (Zod → OpenAPI 3.1 → Go + TS types, Phase 17 Contracts Pipeline & Ops Hygiene) means CLI and web types cannot drift from server contracts; a breaking schema change surfaces as a TS build failure, not a UI misrender.

### Negative / Costs

- One-time refactor cost: sixteen phases (Phase 15 Foundations through Phase 30 Test Migration Cleanup). Each phase is scoped to one module or one substrate concern to keep PR sizes reviewable, but the total engineering effort is material for a one-person team.
- Runtime parse overhead at trust boundaries — measured at <1 ms for typical payloads; acceptable for the workload (<50 jobs/day) but an operator should be aware on the hot path.
- Zod 4, drizzle-zod, and Drizzle ORM ^0.45.1 version management requires ongoing attention — the stack has already wasted a day on compatibility drift once (Plan 15-01 resolved it).
- Developers (and LLMs) must internalise the sync-bus-vs-queue rule (Pillar 3 / EVENTS-05). The `no-direct-bus-emit` and `no-imperative-event-names` lint rules enforce the mechanical parts, but the judgement call "does this handler retry, survive crash, or call external?" stays with the human.
- A migration period exists where some modules have been refactored and others have not. Hybrid state must be explicitly tracked (`.planning/migration-status.md`) and minimised — Phase 30 Test Migration Cleanup is the final gate.

### Constraints locked here (apply to every subsequent phase)

- Events use `noun.verbed` past-tense dotted names — enforced by the `no-imperative-event-names` ESLint rule.
- `bus.emit(...)` is called only from per-module `events.ts` helpers — enforced by the `no-direct-bus-emit` ESLint rule (allowlist: `**/events.ts`, `**/*.spec.ts`, `**/*.test.ts`).
- Envelope schemas use `.passthrough()` / `z.looseObject` — additive-only changes within a schema version.
- Envelope field `v: z.literal(1)`; a v2 envelope is a new schema in a discriminated union, not a mutation of the existing schema.
- Queue jobs with physical side effects default to `retryLimit: 1` and a `singletonKey` keyed on the aggregate id.
- Graceful shutdown drains queue workers within 30 seconds (measured on Mac Mini; spike in Plan 15-05 recorded 4032 ms on an MBP M4 Max proxy — rerun on actual hardware before Phase 16 kickoff).
- Node 22.12+ is required (pg-boss v12 baseline); pinned in `.nvmrc` and `engines.node`.
- `fastify-zod-openapi` + `go-jsonschema` + `openapi-typescript` codegen (Phase 17 Contracts Pipeline & Ops Hygiene) becomes the source-of-truth pipeline for CLI and web types.
- ADRs are append-only (`docs/adr/NNN-slug.md`, Michael Nygard format). Supersede rather than edit; new decisions get new numbers.

### Out of scope

- **OpenTelemetry distributed tracing.** Structured logs + `events` table + `correlationId` cover the single-node causal-trace use case. OpenTelemetry is deferred to a future multi-node milestone where it earns its operational weight.
- **Full event sourcing.** Only business events marked `persisted: true` land in the `events` table; current-state Postgres tables (`jobs`, `devices`, `artifacts`) stay authoritative. Deriving state exclusively from events is over-engineered for this problem shape.
- **Multi-node pg-boss / horizontal worker scale-out.** Device Farm runs on a single Mac Mini; multi-node is a v2-class milestone.
- **SSO (OAuth Azure AD, GitHub).** API keys remain the auth model for v3.0.
- **Late-starting subscribers / event replay** with `last_processed_event_id` tracking. Deferred.
