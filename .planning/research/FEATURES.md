# Feature Research — v3.0 Spec-Driven Architecture Refactor

**Project:** Device Farm
**Domain:** Spec-driven + event-driven refactor of existing production TS monolith (Fastify server + Go CLI + SvelteKit web)
**Researched:** 2026-04-16
**Overall Confidence:** MEDIUM-HIGH

Patterns/conventions to standardize in v3.0. Existing user features are NOT re-researched. "Features" here = architectural patterns.

---

## 1. SPEC — Zod Schema Patterns (prefix `SPEC-*`)

### Table Stakes

| Pattern | Why Expected | Complexity | Notes / Dependencies |
|---|---|---|---|
| **Schemas colocated with their module** (`server/<module>/schemas.ts` or split across `events.ts` / `api.ts` / `db.ts`) | Modular monolith; each module owns its contract. Keeps module self-contained and LLM-readable. | SIMPLE | Aligns with pillar 5. Avoid a giant `/schemas` folder — implicit god module. |
| **`.parse()` at trust boundaries only, `.safeParse()` when feeding an error channel** | Throwing on untrusted input is correct only where a framework-level handler catches it. | SIMPLE | Rule: Fastify routes `parse`; WS decoders `safeParse` + close-with-reason; row decoders `safeParse` + log. |
| **`z.infer<typeof X>` as THE source of TS types at boundaries** | No hand-written `interface Job {...}` that drifts from the schema. Pillar 1. | SIMPLE | Ban re-declaring boundary types. |
| **Row decoder per DB table** (`decodeJobRow(row): Job`) — Zod parses Drizzle output | JSONB columns (Device Farm's generic `metadata`) bypass Drizzle typing. | MEDIUM | Drizzle `$inferSelect` is compile-time only; Zod adds runtime guarantee for JSONB. |
| **Discriminated unions for polymorphic events** (`z.discriminatedUnion("type", [...])`) | Event bus carries heterogeneous events. | SIMPLE | Unblocks typed `bus.on(type, handler)` with payload narrowing. |
| **Config YAML validated on boot, fail-fast** | Already in codebase. Document as canonical. | SIMPLE | Already shipped. |

### Differentiators

| Pattern | Value | Complexity | Notes |
|---|---|---|---|
| **Schema-to-OpenAPI generation** (`fastify-zod-openapi`) | Free API docs. OpenAPI drives CLI + web client codegen. | MEDIUM | Verify Zod v4 compat. |
| **JSON Schema export for WS contract** | Web + Go CLI consume shared contract. Go cannot import Zod. | MEDIUM | Generate `.json` at build; Go codegen structs. |
| **Additive-only evolution** + `.passthrough()` on envelope | Subscribers don't break when a new optional field added. | SIMPLE | New fields MUST be optional; never rename/remove — deprecate + v2 discriminator. |
| **Event schema version field `v: z.literal(1)` in envelope** | Version-gate handlers. Enables migrations without big-bang. | SIMPLE | `z.discriminatedUnion("v", [v1, v2])`. |
| **Brand types for IDs** (`z.string().uuid().brand<"JobId">()`) | Prevents `deviceId` assigned to `jobId`. Catches v2.0 CLI deviceName UUID carry-over. | SIMPLE | Directly addresses tech debt. |

### Anti-Features

| Pattern | Why Tempting | Why Don't | Alternative |
|---|---|---|---|
| **Global `/schemas` package** | "Single source of truth." | God module; every import couples modules. | Colocate per module; re-export from barrel. |
| **`.strict()` everywhere on events** | "Validate everything." | Breaks additive evolution. | `.passthrough()` on events; `.strict()` on API requests only. |
| **Runtime-transforming schemas in hot path** (`.transform(...)` with side effects) | Looks clever. | Hides side effects behind validation call. | Transforms = type coercion only; business logic in module functions. |
| **Zod everywhere including internal args** | "Type safety all the way down." | Redundant; TS already checks. | Parse at boundary once; TS types thereafter. |
| **Generating Zod schemas from Drizzle** for all tables | DRY. | Couples domain to DB shape; JSONB doesn't round-trip cleanly. | Hand-write decoders; Zod schema is domain model. |

---

## 2. EVENTS — Bus & Queue Patterns (prefix `EVENTS-*`)

### Table Stakes

| Pattern | Why Expected | Complexity | Notes / Dependencies |
|---|---|---|---|
| **Past-tense, dotted namespace** (`job.completed`, `device.allocated`) | Industry standard (Bogard, DDD). Events are facts; commands imperative. | SIMPLE | Imperatives reserved for commands / queue jobs (`job.run`). |
| **Event envelope** `{ id, type, v, correlationId, causationId, occurredAt, payload }` | Enables tracing across bus + queue + WS + logs. | SIMPLE | Depends on AsyncLocalStorage correlation. |
| **Thin event payloads by default** (ID + minimal delta) | Avoids stale-snapshot bugs. | SIMPLE | Fat exception: terminal events (`job.completed`) carry final snapshot. |
| **Sync bus for in-module reactions; pg-boss for cross-module or retriable** | DDD "domain events sync / integration events async". | MEDIUM | If handler retries, survives crash, talks to external → queue. If cache invalidation / WS broadcast → bus. |
| **Typed bus API** (payload narrowing via discriminated union) | `EventEmitter` is stringly typed. LLM-friendly requires type-enforced contracts. | MEDIUM | Thin wrapper over `EventEmitter`; payload type inferred from event name. |
| **Idempotent subscribers** (tolerate duplicate delivery) | At-least-once is the only honest guarantee. | MEDIUM | Keys on event ID + operation ID. Especially for webhook + recording upload. |
| **pg-boss `singletonKey`** for job-scoped queue work | Only one Maestro execution per `jobId`. | SIMPLE | Direct fit. |
| **Dead-letter handling** (pg-boss max retries → `job.failed.retryexhausted`) | Silent failure is the worst failure. | MEDIUM | Emit terminal failure event; persist to `events` table; surface in UI. |

### Differentiators

| Pattern | Value | Complexity | Notes |
|---|---|---|---|
| **Orchestrated saga for job lifecycle** (queued → allocated → running → completed → recording → webhook → cleanup) | Explicit state machine easier for LLMs. Matches `VALID_TRANSITIONS`. | MEDIUM-RISKY | Depends on events table + correlation. Choreography tempting but hard to debug. |
| **Event replay from `events` table** for projections | Cheap analytics without full event sourcing. | MEDIUM | Opt-in per subscriber. |
| **Emit-helper pattern** (`jobEvents.completed(jobId, summary)` not `bus.emit(...)`) | Co-locates producers with schema. | SIMPLE | Helpers live in `events.ts`. |
| **pg-boss cron schedules declarative** (`queue.ts` exports schedule map) | Replaces node-cron. | SIMPLE | `boss.schedule(name, cron, data, options)`. |
| **Bus → queue bridge pattern** | Decouples modules — executor consumes queue, not bus. | MEDIUM | Canonical shape for the refactor. |

### Anti-Features

| Pattern | Why Tempting | Why Don't | Alternative |
|---|---|---|---|
| **Full event sourcing** | "Perfect audit." | Over-engineered single-node. Kills query ergonomics. | Current-state + append-only events for audit. |
| **One giant untyped `EventBus.emit(name, payload)`** | Simpler surface. | Loses narrowing; LLMs can't autocomplete. | Typed map-based bus with discriminated union. |
| **Choreographed sagas for job lifecycle** | "Decoupled!" | Recording fails → nobody knows which job. | Orchestrated saga OR correlation-traced choreography. |
| **Synchronous bus for webhook delivery** | "It's just HTTP." | Blocks device allocation; flaky receivers cascade. | pg-boss with retries. |
| **Emitting events before commit** | "Atomic!" | Subscriber fires, tx rolls back → phantom event. | `tx.afterCommit` OR outbox pattern. |
| **Fat events to avoid re-fetch** | "One less DB call." | Stale snapshot; schema churn. | Thin + versioned-fetch if race matters. |
| **Per-event custom queue** | "Isolation!" | Queue explosion. | Named queues for major work-types. |

---

## 3. MODULES — LLM-First Conventions (prefix `MOD-*`)

### Table Stakes

| Pattern | Why Expected | Complexity | Notes |
|---|---|---|---|
| **Every module has `MODULE.md`** — Purpose / Public API / Events Emitted / Events Consumed / Queue Produced / Queue Consumed / Invariants / Non-Goals / Dependencies | LLMs do RAG; consistent headers = deterministic retrieval. | SIMPLE | Template identical across modules. |
| **Barrel `index.ts` exports ONLY public surface** | Enforces boundary; single import line = entire API. | SIMPLE | Lint: no deep imports banned. |
| **`events.ts` = schemas + typed emit helpers + event-name constants** | One file, one concept. LLM reads entire event contract at once. | SIMPLE | No business logic. |
| **Tests-as-spec** (`describe('when job.completed is emitted', ...)`) | Describe blocks = spec. Reads like BDD. | SIMPLE | Files by behavior: `events.spec.ts`, `saga.spec.ts`. |
| **Consistent file naming** (kebab-case, singular concepts, plural collections) | Locks convention once. | SIMPLE | Match existing (`job-service.ts`). |
| **Module factory** `createJobsModule(deps): JobsModule` returning `{ emit, on, service }` | Explicit dependency graph. Plugin wires: `fastify.decorate('jobs', createJobsModule({ db, bus, boss, logger }))`. | MEDIUM | Cleaner than pure decorator — deps are typed inputs. |

### Differentiators

| Pattern | Value | Complexity | Notes |
|---|---|---|---|
| **Runnable example in MODULE.md** | LLM copies example when integrating. | SIMPLE | Keep examples tested. |
| **Explicit `invariants` section** | LLMs follow invariants when editing. Matches `VALID_TRANSITIONS`. | SIMPLE | One test per invariant. |
| **`events.ts` exports typed `JobEvents` union** | Downstream modules narrow cross-module events. | SIMPLE | `export type JobEvents = z.infer<typeof JobEventEnvelope>`. |
| **Module-scoped logger** (`logger.child({ module: 'jobs' })`) | Searchable structured logs. | SIMPLE | pino child. |
| **ADR index at `docs/adr/`** (`ADR-NNN-slug.md`) | Captures "why". 2026 practice. | SIMPLE | Start with v3.0 as ADR-001. |
| **Factory + Fastify decorator hybrid** | Plugin encapsulation + decoupled construction. Tests instantiate without Fastify. | MEDIUM | Fixes `api` plugin missing `lifecycle-plugin` dep. |

### Anti-Features

| Pattern | Why Tempting | Why Don't | Alternative |
|---|---|---|---|
| **Barrel re-exports everything** (`export * from './internal/...'`) | "Use barrel for everything." | Internal helpers leak → de-facto public. | Explicit named exports. CI asserts no `export *`. |
| **MODULE.md duplicating code comments** | "More docs = better." | Drifts from code. | MODULE.md = contract + intent; JSDoc = public API. |
| **Deep nested directories** (`jobs/application/use-cases/...`) | Clean Architecture aesthetic. | LLMs walk trees they don't need. | Flat: `jobs/{MODULE.md, index.ts, events.ts, schemas.ts, service.ts, saga.ts, __tests__/}`. |
| **Decorator DI with reflection** (NestJS `@Injectable`) | Trendy. | Runtime magic LLMs can't trace. | Explicit factories. |
| **Tests mirror source files 1:1** | IDE convention. | Tests-as-spec want behavior-grouped. | Organize by behavior slice. |
| **`events.ts` imports bus and auto-emits** | DRY. | Couples schema to runtime. | Separate: pure schemas + helpers taking bus param; wiring in factory. |

---

## 4. QUEUE — pg-boss Integration Patterns (prefix `QUEUE-*`)

### Table Stakes

| Pattern | Why Expected | Complexity | Notes |
|---|---|---|---|
| **One named queue per durable work-type** (`job.execute`, `webhook.deliver`, `recording.upload`, `cleanup.run`, `pipeline.trigger`) | pg-boss idiom; retry/concurrency tunable per work-type. | SIMPLE | Config: `retryLimit`, `retryBackoff`, `teamSize`. |
| **Queue payload Zod-validated at producer + consumer** | Producer/consumer may be separate modules. | SIMPLE | Often 1:1 with event schema. |
| **`singletonKey` per business entity** (jobId, webhookId) | Prevents duplicate execution. | SIMPLE | pg-boss native. |
| **Exponential backoff + max retries + DLQ event** | Retriable work must fail loudly. | MEDIUM | `boss.onComplete` → terminal failure event. |
| **`queue.ts` per module** registers handlers + produces jobs | Colocates queue logic with owner. | SIMPLE | `server/jobs/queue.ts`, `server/recording/queue.ts`. |
| **Graceful shutdown** (pg-boss stop on SIGTERM) | Required for rolling restarts. | MEDIUM | Fastify `onClose` hook. |
| **Replace node-cron with `boss.schedule()`** | Pillar 3. | SIMPLE | Pipelines plugin currently uses node-cron. |

### Differentiators

| Pattern | Value | Complexity | Notes |
|---|---|---|---|
| **Bus-to-queue bridge at module boundary** | Fast sync handlers + durable async work separated. | SIMPLE | 3-5 lines; lives in module wiring. |
| **Cron-as-queue-job** | Uniform model: everything is a queue job. | SIMPLE | `boss.schedule('cleanup.run', '0 3 * * *')` same consumer as manual. |
| **Throttled queue with `singletonMinutes`** for cleanup | Prevents cleanup storm on restart. | SIMPLE | pg-boss native. |
| **Correlation ID flows through queue payload** | End-to-end trace: HTTP → bus → queue → log → events table. | SIMPLE | Wrap `boss.send()` to inject from ALS. |

### Anti-Features

| Pattern | Why Tempting | Why Don't | Alternative |
|---|---|---|---|
| **BullMQ / Redis queue** | More features, dashboards. | Adds Redis. | pg-boss (locked). |
| **In-memory queue alongside pg-boss** | "Why pay for Postgres if 10ms?" | Two failure modes. | Bus for immediate sync; pg-boss for retriable. |
| **One worker process per queue** | Distributed instinct. | Single-node Mac Mini. | Single process, multiple handlers. |
| **Handlers reading DB without idempotency key** | "Just re-fetch." | Retries double-charge. | Key side effects on `jobId + step`. |
| **pg-boss for WS broadcast fan-out** | "Queue it." | Local to process; Postgres round-trip noise. | Sync bus → WS plugin. |

---

## 5. TRACE — Correlation & Business Events (prefix `TRACE-*`)

### Table Stakes

| Pattern | Why Expected | Complexity | Notes |
|---|---|---|---|
| **`X-Correlation-Id` header ingress**; generated if absent | Industry standard. CI can pass its own ID. | SIMPLE | Fastify `onRequest` hook. |
| **AsyncLocalStorage for correlation propagation** | No `ctx` threading. | SIMPLE | `@fastify/request-context`. |
| **Correlation ID in every log line** (pino child per request) | Required to correlate logs with events. | SIMPLE | `log.child({ correlationId })`. |
| **Correlation ID in event envelope + pg-boss payload** | Bridges sync bus + async queue. | SIMPLE | Producer reads ALS at emit; consumer restores before handler. |
| **Correlation ID in WebSocket messages** | Web UI deep-links to log. | SIMPLE | WS envelope schema. |
| **Append-only `events` table** (`id, correlation_id, causation_id, type, v, payload_json, occurred_at, actor`) | Pillar 4. Audit + replay. | MEDIUM | Drizzle schema. Indexes on correlation_id, type, occurred_at. |
| **"Business event" rule**: domain-meaningful state changes only (`job.queued/completed/failed`, `recording.uploaded`, `webhook.delivered`, `device.error`) | Without rule, table bloats. | SIMPLE | If stakeholder asks "did this happen?" → persist. Transient (WS frame, log line) → bus only. |

### Differentiators

| Pattern | Value | Complexity | Notes |
|---|---|---|---|
| **Causation ID** (ID of event that caused this) | Tree-reconstruction of event chains. | SIMPLE | Emitter reads current event from ALS. |
| **Actor field** (userId/apiKeyId/"system"/"cron") on business events | Audit + debugging. | SIMPLE | From Fastify auth context via ALS. |
| **Replay API** — `GET /api/events?correlationId=X` returns causation tree | UI shows job timeline. | MEDIUM | Depends on events table. |
| **Opt-in subscription via events table polling** | Late-starting module rebuilds from history. | MEDIUM | Module stores `last_processed_event_id`. |
| **Typed "business event" registry** — only registered events persist | Prevents accidental transient persistence. | MEDIUM | `events.ts` declares `persisted: true`; bus middleware checks. |

### Anti-Features

| Pattern | Why Tempting | Why Don't | Alternative |
|---|---|---|---|
| **Persist every bus event to events table** | "Complete audit!" | Table bloat; signal drowns. | Explicit `persisted: true` flag. |
| **Correlation ID via parameter threading** | "Explicit beats implicit." | Pollutes every signature. | AsyncLocalStorage. |
| **OpenTelemetry distributed tracing** | Best practice multi-service. | Single-node; no trace consumer. | Structured logs + events table. Revisit if multi-node. |
| **Compound correlation IDs** (`req:saga:step`) | "All context." | Parsing burden; log tools split on whitespace. | Separate structured fields. |
| **Keep events forever** | "Append-only." | Terabyte-scale = slow queries. | Retention: business events 90d, archive. |
| **Synchronous write to events table inside bus.emit** | Simple. | Blocks emitter; couples bus to DB. | `tx.afterCommit` or outbox dispatcher. Single-node can write-sync in same tx — document. |

---

## Feature Dependencies

```
SPEC-* (Zod schemas)
    └──required by──> EVENTS-* (envelope needs schemas)
                          └──required by──> QUEUE-* (queue payloads = event schemas)
                                                └──required by──> TRACE-* (correlation ID lives in envelope)

MOD-* (MODULE.md, barrel, events.ts, factory)
    └──requires──> SPEC-* (events.ts holds schemas)
    └──requires──> EVENTS-* (events.ts exports helpers)

TRACE-ALS
    └──enables──> correlation-in-bus, correlation-in-queue, correlation-in-logs

Orchestrated-saga (differentiator)
    └──requires──> TRACE-events-table
    └──requires──> QUEUE-singletonKey

Bus-to-queue bridge
    └──requires──> sync bus + pg-boss + correlation propagation
```

**Pilot module must implement SPEC + EVENTS + MOD + TRACE table-stakes simultaneously** before being canonical. Correlation ID propagation is foundational — land AsyncLocalStorage + Fastify hook + pg-boss wrapper FIRST.

Tech debt integration: module factory fixes `api` plugin missing `lifecycle-plugin` dep; brand types catch CLI deviceName UUID/name confusion.

---

## Complexity / Risk Tiers

| Tier | Patterns |
|---|---|
| **SIMPLE** | Colocated schemas, past-tense naming, barrel rules, thin payloads, event envelope, X-Correlation-Id, AsyncLocalStorage, singletonKey, named queues, MODULE.md template, tests-as-spec |
| **MEDIUM** | Row decoders, discriminated-union events, typed bus wrapper, idempotent handlers, DLQ events, events table schema, bus-to-queue bridge, module factory, graceful shutdown |
| **RISKY** | Orchestrated saga, event replay, JSON Schema export for Go CLI, opt-in historical replay, outbox pattern |

---

## Key Implications for REQUIREMENTS.md

Suggested REQ-ID groupings:

- **SPEC-01..08** — Zod rules (colocated, parse/safeParse, z.infer, row decoders, discriminated unions, additive evolution, branded IDs, version field)
- **EVENTS-01..10** — Bus patterns (naming, envelope, thin payloads, sync-vs-async rule, typed API, idempotency, emit helpers, saga, bridge, DLQ)
- **QUEUE-01..07** — pg-boss (named queues, Zod payloads, singletonKey, retry/backoff, per-module queue.ts, cron-as-queue, shutdown)
- **MOD-01..08** — Module artifacts (MODULE.md, barrel, events.ts, tests-as-spec, naming, factory, flat layout, ADR)
- **TRACE-01..08** — Correlation + events (header, ALS, logs, bus, queue, WS, events table, business/transient rule, retention)

Out of Scope (Anti-Features):
- Global `/schemas` package
- Full event sourcing
- BullMQ/Redis queue
- OpenTelemetry distributed tracing
- Choreographed sagas for job lifecycle
- Emit before commit / dual-write
- Persist all bus events
- `export *` from barrels
- Deep nested module directories / Clean Architecture layering
- Decorator DI with reflection

---

## Open Questions (for phase research)

- pg-boss v10+ `singletonKey` replace-vs-discard when schedule overrides (validate in pilot).
- Go CLI consuming JSON Schema from Zod vs Go-native contract file (CLI phase).
- Saga orchestrator state storage: pg-boss job state vs dedicated `sagas` table (revisit after pilot).
- ADR format / numbering convention.

---

## Sources

Zod: zod.dev/api, zod.dev/basics, Leapcell monorepo sharing, colinhacks/zod discussion #1663.
Events: Jimmy Bogard (message naming), Mathias Verraes (fat events), Hookdeck (thin events), codesimple (fat vs thin), event-driven.io (versioning).
pg-boss: README, npm, DeepWiki scheduling, LogSnag TypeScript, issue #548 singletonKey.
Idempotency: Gunnar Morling, Brandur Stripe-like.
Correlation: Node.js AsyncLocalStorage, @fastify/request-context, Dash0 contextual logging.
Architecture: Microsoft DDD domain events, Three Dots Labs sync vs async, IntuitionLabs event sourcing vs queue, mgce/modular-monolith-nodejs.
LLM-first: HuggingFace 2026 agentic trends, Addy Osmani 2026 LLM workflow.
