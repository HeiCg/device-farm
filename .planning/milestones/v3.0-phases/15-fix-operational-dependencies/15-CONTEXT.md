# Phase 15: Foundations - Context

**Gathered:** 2026-04-17
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 15 ships the spec/event/queue substrate every subsequent v3.0 phase depends on: Fastify plugin reordering (config → event-bus → correlation → dependency-checker → db → queue → telemetry → …), `events` Postgres table + row decoders, AsyncLocalStorage-backed correlation IDs, pg-boss integrated with graceful shutdown, typed in-process event bus with envelope schema, ADR index seeded with ADR-001, lint guardrails for event naming/direct-emit, and Nyquist baseline captured at the commit that precedes Phase 16. Phase 15 does NOT migrate any existing module off imperative calls — that starts in Phase 16 (pilot).

</domain>

<decisions>
## Implementation Decisions

### ALS + Correlation IDs
- ALS via `@fastify/request-context` (Fastify-idiomatic, lifecycle-managed)
- `correlation` plugin registers `onRequest` hook: reads `X-Correlation-Id` header or generates `crypto.randomUUID()`; echoes in response header; stored in ALS and bound to pino child logger
- Queue wrapper `queue.send(name, payload, opts)` reads correlationId from ALS and injects into `boss.send` job data; consumer registration helper wraps handlers to restore ALS from job data before execution (solves cross-queue ALS gotcha)
- Unscoped logs (queue workers, scheduled ticks): consumer restores correlationId from job data; scheduled-tick handlers that have no inbound ID generate a new UUID with `actor: "system"` or `"cron"` pino binding

### pg-boss Integration
- pg-boss Fastify plugin registered AFTER `db`, BEFORE `telemetry`; uses default `pgboss` Postgres schema (isolated from app tables)
- Graceful shutdown via Fastify `onClose`: `boss.stop({graceful: true, timeout: 30_000})` — aligned with common K8s/container grace period
- Named queues registered colocated — each module's `queue.ts` registers its queues at module start; central `server/queue/names.ts` exports `QUEUE_NAMES` constants for type-safe references
- Default `retryLimit: 1` for handlers with physical side-effects (emulator boot, maestro spawn); exponential backoff; non-physical handlers (webhook, cleanup) can override upward in their `queue.ts`

### Event Bus + Events Table
- Thin typed wrapper over Node `EventEmitter`; emit helpers `.parse()` payloads via Zod `discriminatedUnion` before dispatch; `bus.on<T>(type, handler)` narrows payload via TS overloads keyed on event-type string literal
- Envelope schema (`envelopeSchema`) is shared, `.passthrough()` by convention for v1; carries `{id, type, v: z.literal(1), correlationId, causationId, occurredAt, aggregateType, aggregateId, payload, actor}`
- Persistence to `events` table is opt-in per event: schema registry entry carries `persisted: true` flag; bus middleware persists only flagged events; registry typed so a flagged event without a persisted schema fails compile
- CausationId auto-propagated: subscriber runner wraps handlers to set `currentEventId` into ALS before invoking; nested emit helpers read it off ALS so callers never thread it manually
- Emit helpers REQUIRED for business events — custom lint rule rejects `bus.emit(...)` outside each module's `events.ts`; helpers constructed by `createEventHelpers({registry, bus})` factory exposed per module

### Guardrails + Baseline
- Custom lint via `eslint-plugin-local-rules` with two rules: `no-imperative-event-names` (rejects event names that are not `noun.verbed` past-tense dotted) and `no-direct-bus-emit` (rejects `bus.emit(...)` outside allowed paths: `**/events.ts` and test files). Wired into existing `npm run lint`
- ADR directory at `docs/adr/` using `NNN-slug.md` with Nygard format (Status / Context / Decision / Consequences). ADR-001 documents v3.0 spec-driven architecture and the key decisions above. Future ADRs (file naming, sync-vs-queue rules) follow same format
- Nyquist baseline: run existing GSD Nyquist tooling, commit output to `.planning/nyquist-baseline.json`; `/gsd:execute-phase` flow references baseline for per-phase delta; success criterion `existing coverage delta ≤ −2pp` enforced against this baseline
- Branded ID types live centrally in `server/types/ids.ts` — `JobId`, `DeviceId`, `PipelineId`, `ArtifactId`, `RecordingId` exported as `z.string().uuid().brand<"...">()`. Every module imports from `server/types/ids.ts` rather than redeclaring

### Spikes (gated before Phase 15 completion)
- drizzle-zod JSONB round-trip test on `jobs.metadata` — writes nested object, reads back, asserts no key-order drift; committed as an integration test file under `server/db/__tests__/`
- pg-boss v12 auto-migration on fresh dev DB — CI smoke step validates `pgboss` schema isolation and idempotent start on re-run
- Branded ID compile-failure proof — `.d.ts` or dedicated `tsd` test that demonstrates `JobId` cannot be passed where `DeviceId` is expected
- Mac Mini graceful-shutdown timing — measure worst-case drain against the 30s timeout on the dev machine; document if the timeout needs retune

### Claude's Discretion
- Internal wiring of the typed bus (naming of helpers, internal narrowing mechanics) is at Claude's discretion as long as the public API (`bus.on`, `bus.emit`, `createEventHelpers`) matches decisions above
- ADR-001 prose tone, length, and section depth are at Claude's discretion provided Nygard structure
- Exact ordering of Phase 15 plans (spikes first vs plumbing first) at Claude's discretion during planning

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- Fastify plugin infrastructure exists (`server/index.ts` registers 12 plugins with explicit `dependencies: [...]` ordering) — new plugins (event-bus, correlation, queue, telemetry) slot in without rewriting the registration contract
- Zod 4 already a dependency; patterns for Zod-validated config exist under `server/config/`
- Drizzle ORM + drizzle-kit push/generate already in use; adding `events` table follows existing schema conventions in `server/db/schema.ts`
- pino logger is in place; `logger.child({...})` pattern can be extended with ALS-sourced `correlationId` via pino `mixin`

### Established Patterns
- Dependency-ordered Fastify plugin registration with `fastify-plugin` + `dependencies: [...]` arrays
- Zod at config boundary; runtime validation with structured errors
- `async-mutex` for concurrency control on device allocation (unrelated but establishes "library-first" pattern)
- Per-plugin decorators (`fastify.pool`, `fastify.db`, `fastify.jobService`) — new substrate will expose `fastify.bus`, `fastify.queue`, `fastify.requestContext`

### Integration Points
- `server/index.ts` plugin registration — new plugins must slot in BEFORE existing consumers (especially `jobs`, `lifecycle`, `reporting`)
- `server/db/schema.ts` — add `events` table alongside existing 8 tables
- `server/types/` — central `ids.ts` joins existing branded types
- `docs/adr/` — new directory (does not currently exist)
- `.planning/nyquist-baseline.json` — new file (does not currently exist)

</code_context>

<specifics>
## Specific Ideas

- Use `@fastify/request-context` rather than raw AsyncLocalStorage for ergonomics + Fastify lifecycle guarantees
- Match graceful shutdown to the 30s K8s-default grace window so later container deployment does not need to retune
- Keep `events` envelope `.passthrough()` for v1 — only additive changes allowed; discriminated union per `v` gets added later when v2 ships
- Pino mixin pulls `correlationId` from ALS every log line, so module authors never thread it manually
- Lint rule uses allowlist paths (`**/events.ts`, `**/*.spec.ts`, `**/*.test.ts`) rather than a denylist to minimize false negatives

</specifics>

<deferred>
## Deferred Ideas

- OpenTelemetry / distributed tracing — out of scope per PROJECT.md (v2 requirement OBS-01)
- Late-starting subscribers / event replay (ER-01, ER-02) — deferred
- Multi-node pg-boss (MT-01) — deferred
- `fastify-zod-openapi` codegen pipeline — belongs to Phase 17, not 15
- Module-level `MODULE.md` conventions — enforced starting Phase 16 pilot
- Actor field population from auth context — belongs to Phase 26 (TRACE-10)

</deferred>
