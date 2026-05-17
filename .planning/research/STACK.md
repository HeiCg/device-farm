# Stack Research — v3.0 Spec-Driven Architecture

**Domain:** Refactor additions for spec-driven + event-driven architecture on top of existing Device Farm stack (Fastify 5 + Drizzle + SvelteKit 5 + Go CLI).
**Researched:** 2026-04-16
**Confidence:** HIGH (all versions verified via `npm view` at research time; primary sources consulted for pg-boss, zod-openapi, fastify-type-provider-zod)

**Scope note:** This document covers ONLY the new pieces v3.0 introduces. Existing validated stack (Fastify 5, Drizzle 0.45, SvelteKit 5, Zod 4.3.6 already installed, Vitest, Cobra, Go, pino, pg) is out of scope and deliberately not re-researched.

---

## Recommended Stack

### Core Technologies (new)

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| **pg-boss** | 12.15.0 | Postgres-native durable job queue — replaces in-memory `JobQueue` + `node-cron` (for pipelines) | Single infra dependency (Postgres is already required); ACID + `FOR UPDATE SKIP LOCKED` gives exactly-once semantics; built-in cron via `schedule()`, retry backoff, dead-letter queues, pub/sub. Zero new operational surface area — no Redis, no broker to babysit. v12 native TS types. |
| **fastify-type-provider-zod** | 6.1.0 | Wire Zod schemas into Fastify request/response validation + type inference | Official-ish (maintained by Fastify core contributor `kibertoad`). Replaces manual `zod.parse()` per route with `.withTypeProvider<ZodTypeProvider>()`. Minimal deps (only `@fastify/error`). |
| **drizzle-zod** | 0.8.3 | Derive Zod row schemas from existing Drizzle table definitions | Schemas stay in sync with DB schema automatically (`createSelectSchema`, `createInsertSchema`). Prevents schema drift between Drizzle + Zod. Compatible with Drizzle ≥0.36 (we have 0.45). |
| **pino** (already) + **AsyncLocalStorage** (Node stdlib) | pino 10.3.1 | Correlation-ID bound child loggers per request | No new lib needed. `pino.child({ correlationId })` + Node's built-in `AsyncLocalStorage` gives request-scoped context propagation across awaits, including into pg-boss handlers. |

### Supporting Libraries (new)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| **zod-openapi** | 5.4.6 | Generate OpenAPI 3.1 from Zod schemas using native `.meta()` | If we want API docs + Go CLI codegen input. Pairs with `fastify-zod-openapi` below. Supports Zod v4 without monkey-patching (unlike `@asteasolutions/zod-to-openapi`). |
| **fastify-zod-openapi** | 5.6.1 | Fastify plugin bundling type provider + Swagger UI wiring | Preferred over plain `fastify-type-provider-zod` if we want both validation AND an OpenAPI spec file served at `/docs`. Depends on `@fastify/swagger` + `@fastify/swagger-ui`. |
| **zod-to-json-schema** | 3.25.2 | Standalone Zod → JSON Schema (only if not extracting from OpenAPI) | Not needed if we use `fastify-zod-openapi` — we can extract from the OpenAPI doc's `components.schemas`. Listed here only as a fallback. |
| **go-jsonschema** (omissis/go-jsonschema) | v0.23.0 | Go struct generator from JSON Schema | CLI-only tool (install via `brew install go-jsonschema`). Emits idiomatic Go with unmarshal + validation. More stable and Go-native than `quicktype` for structured schema input. |
| **pg** (peer of pg-boss) | ^8.20.0 | Postgres driver for pg-boss | Not a conflict: Drizzle uses `postgres` (porsager), pg-boss uses `pg`. Two connection pools is acceptable at our scale. |
| **Node `AsyncLocalStorage`** | built-in (Node 22+) | Request-scoped context for correlation IDs | No install. Used inside a tiny Fastify `onRequest` hook that sets `{ correlationId }` and a pino child logger on the store. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| **dependency-cruiser** | 17.3.10 | Enforce module-boundary import rules (only via `index.ts` barrel) | Heavier than `eslint-plugin-boundaries` but framework-agnostic, doesn't require ESLint v8/9 config churn, outputs graph visualizations for architecture docs. Rules live in `.dependency-cruiser.cjs`. Recommended over the ESLint plugin because we don't currently have an ESLint config. |
| **@pg-boss/dashboard** | (peer of pg-boss) | Optional web UI for queue monitoring — dev-only | Install if debugging queue state; not a runtime dep. |
| **pino-pretty** (already) | 13.1.3 | Dev-mode pretty logs | Already installed. No change. |

---

## Installation

```bash
# Core additions for v3.0
npm install pg-boss@12.15.0 pg@8.20.0 drizzle-zod@0.8.3 fastify-type-provider-zod@6.1.0

# If API docs + OpenAPI export desired (recommended for Go codegen path):
npm install zod-openapi@5.4.6 fastify-zod-openapi@5.6.1 @fastify/swagger @fastify/swagger-ui

# Dev
npm install -D dependency-cruiser@17.3.10 @types/pg

# Go CLI codegen (install globally on dev machine; not a runtime dep):
brew install go-jsonschema
```

**Version compatibility check:**
- `fastify-type-provider-zod@6.1.0` requires `fastify@^5.5.0` — we have `^5.8.2` ✓
- `fastify-type-provider-zod@6.1.0` requires `zod@>=4.1.5` — we have `^4.3.6` ✓
- `drizzle-zod@0.8.3` requires `drizzle-orm@>=0.36.0` — we have `^0.45.1` ✓
- `pg-boss@12.15.0` requires Node ≥22.12 and Postgres ≥13 — our Mac Mini target is Node 22+ ✓
- `zod-openapi@5.4.6` requires `zod@^4.0.0` ✓

---

## Detailed Answers to Research Questions

### 1. Queue: pg-boss (recommended) vs graphile-worker

**Recommendation: pg-boss 12.15.0.**

**Why pg-boss for this context:**
- **Concurrency model:** Per-queue `teamSize` (workers per queue) and `teamConcurrency` (parallel in-flight jobs per worker), plus `batchSize` for fetch bursts. Fits our "android queue + ios queue, one job at a time per device" model naturally — set `teamSize: poolSize, teamConcurrency: 1` or use one queue per device.
- **Retry/DLQ:** Built-in `retryLimit`, `retryDelay`, `retryBackoff` (exponential). Dead-letter routing via `deadLetter: 'failed-jobs'` option — jobs that exceed retries move to a named queue for inspection instead of being lost.
- **Cron:** `boss.schedule('pipeline-key', '*/5 * * * *', data, options)` — replaces our current `node-cron` usage in `server/pipelines/scheduler.ts`. Survives restarts because the schedule lives in Postgres.
- **Pub/sub:** `boss.publish(event, data)` → multiple queues subscribe. Useful for fan-out (one `test.completed` triggers webhook, reporting, cleanup as independently-retryable handlers).
- **Transactions:** `boss.insert([...jobs], { db: tx })` — enqueue inside Drizzle transactions, so job creation + DB changes commit atomically. Critical for idempotency.

**graphile-worker (0.16.6)** is a reasonable alternative:
- Stronger "crontab in code" story (`crontab.parse` at startup).
- Slightly lower latency on polling (LISTEN/NOTIFY + polling hybrid).
- But: smaller community, no first-class dead-letter support (you build it), no queue policies like `key_strict_fifo` that pg-boss added in v12.10, no official dashboard.

**pg-boss wins because:** we already have Postgres + we want DLQ + cron in the same tool + v12 is the most active Postgres-native queue in Node in 2026. graphile-worker's advantages (latency, simpler schema) don't matter for our workload (<50 jobs/day growing).

**v12 breaking changes to watch (from releases):**
- v11 introduced named queues (you must `createQueue('name')` before `send('name', data)`).
- v12 added `key_strict_fifo` policy and heartbeat API.
- Migrating from v10: schema migration required — pg-boss auto-migrates on `boss.start()`.

**Integration point:** New plugin `server/queue/plugin.ts` registered **after** `db` plugin, **before** `jobs` plugin. Updated order: config → deps → pool → db → **queue** → auth → websocket → artifacts → reporting → jobs → lifecycle → hooks → maestro → pipelines → api → static. `fastify.decorate('boss', boss)` exposes the instance.

**Do NOT add:**
- BullMQ / Bull — would add Redis as a second data store. Pure scope creep.
- Redis in any form — Postgres-only is a deliberate architectural constraint per PROJECT.md.
- Kafka / RabbitMQ — massive overkill for single-node Mac Mini.
- node-cron (existing dep) — pg-boss.schedule replaces it. Remove from `package.json` once pipelines scheduler is migrated.

---

### 2. Typed event bus: write it, don't import it

**Recommendation: ~50-line typed wrapper over Node's built-in `EventEmitter`.** Do NOT adopt a library.

**Why DIY wins here:**
- **Zero deps** for a core architectural primitive that every module touches.
- **Full control over sync vs async semantics.** We need **synchronous dispatch** (PROJECT.md pillar: "sincrono, para reacoes locais rapidas"). Libraries split awkwardly here:
  - `emittery@2.0.0` — async-first, fires on microtask. Wrong default for our use case.
  - `mitt@3.0.1` — 200 bytes, sync, great TS inference. Closest match but no `once`, no wildcard semantics we control.
  - `nanoevents@9.1.0` — tiny, sync, but no wildcards.
  - `eventemitter3@5.0.4` — drop-in EE replacement, sync. But we already have `EventEmitter` in stdlib, and their TS types are looser than what we can write.
  - `rxjs Subject` — overkill; brings Observable model we don't need.

**Typed wrapper pattern:**
```typescript
// server/shared/event-bus.ts
import { EventEmitter } from 'node:events';

export class TypedBus<Events extends Record<string, unknown>> {
  private readonly ee = new EventEmitter({ captureRejections: true });
  on<K extends keyof Events>(event: K, handler: (payload: Events[K]) => void | Promise<void>) {
    this.ee.on(event as string, handler);
    return () => this.ee.off(event as string, handler);
  }
  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    this.ee.emit(event as string, payload);
  }
}
```

Each module declares its event map in `events.ts`:
```typescript
// server/jobs/events.ts
import { z } from 'zod';
export const JobStartedEvent = z.object({ jobId: z.uuid(), deviceId: z.uuid(), at: z.iso.datetime() });
export type JobStartedEvent = z.infer<typeof JobStartedEvent>;
export type JobsEvents = { 'job.started': JobStartedEvent; /* ... */ };
```

**Trade-offs explicitly considered:**

| Option | TS Inference | Bundle | Sync | Ordering | Recommendation |
|--------|-------------|--------|------|----------|---------------|
| DIY EventEmitter wrapper | HIGH (we control) | 0 (stdlib) | Yes | FIFO | **WINNER** |
| mitt | HIGH | 200 B | Yes | FIFO | Viable alt if we want wildcards out of the box |
| emittery | HIGH | ~10 KB | **Async** (microtask) | FIFO after microtask | Wrong semantics for our sync-local pattern |
| nanoevents | MEDIUM | 144 B | Yes | FIFO | Functional but less ergonomic API |
| eventemitter3 | MEDIUM | 2 KB | Yes | FIFO | Pointless — EventEmitter already in Node |
| rxjs Subject | HIGH | Large | Yes (default) | FIFO | Overkill; introduces Observable mental model |

**Ordering guarantees:** Both stdlib `EventEmitter` and the typed wrapper fire listeners synchronously in registration order within a single `emit()` call. This is what we want for "module A emits job.started, module B reacts by logging, module C reacts by starting a recording" — all before `emit()` returns.

**Integration point:** `server/shared/event-bus.ts` (new file). Each module's `plugin.ts` creates its own `TypedBus<ModuleEvents>` and decorates Fastify with it (`fastify.decorate('jobsBus', bus)`). Cross-module subscription happens in the parent plugin's `onReady` hook.

**Do NOT add:**
- Any event-bus npm package — see table above.
- Redis pub/sub — we're single-node.
- Postgres NOTIFY/LISTEN for in-process events — pg-boss pub/sub is for cross-process-safe events only.

---

### 3. Zod ecosystem for boundary validation

**Zod version: stay on `zod@4.3.6` (currently installed).**

- **v3 vs v4 migration:** Already done in this project (package.json shows `^4.3.6`). Zod v4 brought faster parsing (~3x), reorganized imports (`z.string().email()` still works; some methods moved to standalone like `z.iso.datetime()`), and introduced the `.meta()` API that `zod-openapi` uses instead of monkey-patching.
- **Breaking changes relevant to us:** `.record(v)` now requires a key schema → `.record(z.string(), v)`; `preprocess`/`effects` chain ordering. If existing schemas were written pre-v4, spot-check the config schema during Phase 1.

**Recommended Zod stack for v3.0:**

| Concern | Library | Pattern |
|---------|---------|---------|
| API request/response validation | `fastify-type-provider-zod@6.1.0` | `.withTypeProvider<ZodTypeProvider>().route({ schema: { body: Zod, response: { 200: Zod } } })` |
| OpenAPI doc generation | `zod-openapi@5.4.6` + `fastify-zod-openapi@5.6.1` | `.meta({ id, description })` on schemas; serve spec at `/docs/openapi.json` |
| Drizzle row decoders | `drizzle-zod@0.8.3` | `createSelectSchema(jobs)`, `createInsertSchema(jobs)` in `server/db/schemas.ts` |
| WebSocket messages | Hand-rolled `MessageSchema.parse()` | No lib needed — just `discriminatedUnion('type', [...])` on an event schema registry per channel |
| Config YAML | Already done with Zod — no change | Stays in `server/config/schema.ts` |
| Event bus payloads | Zod schemas in each module's `events.ts` | `const Event = z.object(...); type Event = z.infer<typeof Event>;` |

**Pick one of these two for Fastify validation:**
- If we want validation only → `fastify-type-provider-zod` (minimal, 1 peer dep).
- If we want validation + OpenAPI + Swagger UI → `fastify-zod-openapi` (bundles it; adds `@fastify/swagger` + `@fastify/swagger-ui`).

**Recommendation:** Go with `fastify-zod-openapi@5.6.1` because the OpenAPI spec is also what feeds our **Go CLI codegen** (see §4). One tool serving two needs.

**Do NOT add:**
- `@asteasolutions/zod-to-openapi` (8.5.0) — predates Zod v4's native `.meta()` API and requires a separate "registry" pattern. `zod-openapi` by samchungy is the modern Zod-v4-native choice.
- `valibot`, `arktype`, `io-ts` — we've committed to Zod, don't dilute.
- `ajv` / `joi` — Zod replaces them.
- Hand-rolled `request.body as Foo` casts — every API boundary must `parse()`.

**Integration points:**
- `server/api/plugin.ts` — switch Fastify instance type via `.withTypeProvider<ZodTypeProvider>()` at registration.
- `server/db/schemas.ts` (new) — barrel of `drizzle-zod` derived schemas, imported by services for row decoders.
- Each module's `events.ts` — Zod schemas for all bus events.

---

### 4. Zod → Go codegen for CLI contract sync

**Honest answer: hybrid approach. Generate for DTOs that change often; stay manual for stable core types.**

**The open question examined honestly:**

The CLI currently has hand-rolled structs matching server JSON. Every time the server API changes, a human edits both sides. Manual drift is the observed pain (e.g., `Job.DeviceName` mismatch noted in v2.0 tech debt).

**Three realistic options:**

| Approach | Maintenance Cost | Quality | Recommendation |
|----------|-----------------|---------|---------------|
| **Stay manual** | HIGH — every API change is 2 edits, drift surfaces as runtime bugs (exactly the v2.0 `deviceName` bug) | Perfect when in sync | Reject — this is the status quo that caused the tech debt |
| **`quicktype` from JSON Schema** | LOW once set up, but struct naming is wonky, enum handling mediocre | MEDIUM — output needs post-processing | Only if `go-jsonschema` fails |
| **`go-jsonschema` (omissis) from JSON Schema** | LOW — stable CLI, idiomatic Go, active maintenance (v0.23.0 March 2026) | HIGH — Go-native tool, produces unmarshal + validation | **WINNER** |

**Recommended pipeline:**
```
Zod schemas  →  zod-openapi  →  OpenAPI 3.1 JSON  →  jq (extract components.schemas)  →  go-jsonschema  →  cli/internal/types/generated.go
```

A Makefile target in `cli/` runs this; the generated file has a header `// Code generated by go-jsonschema; DO NOT EDIT.` and is committed (so CI without Node can still build the Go CLI).

**Gotchas to flag in roadmap:**
- **Discriminated unions** in Zod → JSON Schema `oneOf` → Go doesn't have sum types. `go-jsonschema` emits interfaces + type-switches, but output ergonomics are mediocre. Mitigate by keeping WebSocket message types manually mapped in Go; generate only request/response DTOs.
- **Recursive schemas** — Zod handles with `z.lazy()`, JSON Schema uses `$ref`, `go-jsonschema` handles correctly but verify.
- **Optional vs nullable** — Zod `.optional()` → `*string` in Go; Zod `.nullable()` → `sql.NullString`-ish. Decide convention early.
- **Date/time** — Zod `z.iso.datetime()` → string in JSON Schema format `date-time` → `time.Time` via `go-jsonschema` semantic type.

**Scope guidance for roadmap:** Don't try to generate the entire Go client in Phase 1. Start by generating **one** DTO (e.g., `JobStatus`) end-to-end, validate the pipeline, then expand. Keep the CLI's command/flag layer (Cobra) fully manual — only generate the wire types.

**Do NOT add:**
- tRPC — JS-to-JS, doesn't help Go CLI.
- `openapi-generator` (Java-based) for Go — enormous runtime (requires JDK), templates are generic, output often doesn't compile cleanly. Use only if we later add a second non-Go client.
- Protobuf / gRPC — would require rewriting the HTTP layer; out of scope for refactor.
- Custom codegen script unless `go-jsonschema` proves inadequate after a spike.

---

### 5. Typed pino logger with correlation IDs

**Recommendation: Node's built-in `AsyncLocalStorage` + `pino.child()`. No new library.**

**Pattern:**
```typescript
// server/shared/logger-context.ts
import { AsyncLocalStorage } from 'node:async_hooks';
import type pino from 'pino';

export const logContext = new AsyncLocalStorage<{ log: pino.Logger; correlationId: string }>();

// In a Fastify onRequest hook:
app.addHook('onRequest', (req, _reply, done) => {
  const correlationId = (req.headers['x-correlation-id'] as string) ?? crypto.randomUUID();
  const log = app.log.child({ correlationId, reqId: req.id });
  logContext.run({ log, correlationId }, () => { req.log = log; done(); });
});
```

Inside handlers and services:
```typescript
const { log } = logContext.getStore() ?? { log: app.log };
log.info({ jobId }, 'job dispatched');
```

**Why no library:**
- `pino-http` solves HTTP-side but Fastify already integrates pino natively (`app.log`).
- `cls-hooked` is deprecated; `AsyncLocalStorage` is the native replacement (stable since Node 16, we're on 22+).
- `pino`'s `child()` is the canonical way to add bindings — no library adds value.

**Propagating into pg-boss handlers:** When calling `boss.send('queue', data)`, include `correlationId` in the job payload. In the handler, wrap the body in `logContext.run({ log: app.log.child({ correlationId: data.correlationId }) }, async () => { ... })`. This re-establishes context in the queue worker microtask.

**Integration point:** `server/shared/logger-context.ts` (new), wired in `server/api/plugin.ts` as an `onRequest` hook registered before routes.

**Do NOT add:**
- `pino-http` — Fastify has pino built in.
- `cls-hooked` — deprecated, slower, leaky under certain promise chains.
- OpenTelemetry SDK right now — correlation IDs are enough for v3.0. OTel is a future v4 concern when we need distributed traces.

---

### 6. TypeScript module-boundary enforcement

**Recommendation: `dependency-cruiser@17.3.10`.**

**Why over ESLint plugins:**
- We currently have no ESLint config in `package.json`. Adding ESLint just for boundary rules is overkill and pulls in a plugin dependency chain.
- `dependency-cruiser` runs as a separate step (`npx depcruise server --config .dependency-cruiser.cjs`), is framework-agnostic, and produces visualizations (Graphviz DOT output) useful for architecture docs — a real benefit for the "LLM-first modules" pillar.
- Can be run in CI without impacting IDE performance.

**Rules to enforce (conceptual):**
```javascript
// .dependency-cruiser.cjs
module.exports = {
  forbidden: [
    { name: 'no-cross-module-deep-imports',
      from: { path: '^server/([^/]+)/' },
      to:   { path: '^server/(?!\\1/|shared/|types/).+/(?!index\\.js$)', pathNot: '\\.test\\.' } },
    { name: 'only-plugin-imports-across-modules',
      from: { path: '^server/([^/]+)/(?!plugin)' },
      to:   { path: '^server/(?!\\1/|shared/)' } },
  ],
};
```
Translation: inside `server/jobs/`, you can only import from `server/pool/index.ts` (the barrel) — not from `server/pool/internals/something.ts`. The only file allowed to wire cross-module is `plugin.ts`.

**Why not `eslint-plugin-boundaries`:**
- Requires ESLint v6+ config — we'd need to add ESLint + config + plugin (3 deps minimum).
- The "element types" model (`helpers`, `components`, `pages`) is frontend-flavored and doesn't map cleanly onto Fastify plugin-per-module.
- No graph visualization.

**Why not tsconfig paths:**
- `paths` can restrict imports to aliased paths, but doesn't enforce "only barrel entry" — developers can still `import { x } from '@jobs/internal/service'` if we allow `@jobs/*`. Granular path aliases become unmaintainable.

**Why not Nx:**
- Nx is a monorepo tool. We're not a monorepo; we're a single Node app with sibling Go CLI and Svelte UI folders. Nx is the wrong scale.

**Integration point:** `.dependency-cruiser.cjs` at project root, `npm run lint:boundaries` script, wired into CI.

**Do NOT add:**
- ESLint + plugin-boundaries — unnecessary surface area.
- Nx / Turborepo — wrong scale.
- Barrel-file auto-generators (`barrelsby`) — we want humans to curate `index.ts` as the public contract.

---

### 7. Svelte side: minimal additions

**Recommendation: Zero new runtime libraries. Share Zod schemas via a workspace/folder import.**

**What the refactor needs on the web side:**
1. **Shared Zod schemas** — export from `server/` or a new `shared/` folder, import in `web/src/lib/schemas/`. Svelte apps run in browser; Zod v4 works client-side without issue (ESM-friendly, tree-shakes).
2. **Typed WebSocket client** — wrap `WebSocket` with schema parsing on each `onmessage`:
   ```typescript
   // web/src/lib/ws/typed-socket.ts
   const Msg = z.discriminatedUnion('type', [StepMsg, LogMsg, CompleteMsg]);
   ws.onmessage = (e) => { const msg = Msg.parse(JSON.parse(e.data)); /* dispatch */ };
   ```
3. **Typed API client** — use the OpenAPI spec generated by `zod-openapi` to drive a typed fetch client, OR hand-roll one backed by the same shared schemas.

**End-to-end type safety libs considered:**

| Lib | Fit | Verdict |
|-----|-----|---------|
| **tRPC** | HIGH if full-stack TS, but requires rewriting API as procedures | Reject — we have an existing Go CLI consuming the HTTP API. Can't break REST contract. |
| **openapi-fetch + openapi-typescript** | Consumes our generated OpenAPI, zero runtime overhead | **Recommended if we want auto-generated web client.** Adds `openapi-typescript` (dev) + `openapi-fetch` (~1kb runtime). Same OpenAPI spec drives Go codegen AND web client — one source of truth. |
| **@hey-api/openapi-ts** | OpenAPI → TS client with Zod runtime | Overlaps with our Zod — we'd have duplicate validators. |
| **hono/client** | Only for Hono backends — we use Fastify | Wrong framework |
| **ts-rest** | Contract-first TS, can emit OpenAPI | Competes with Zod-first approach |

**Recommended web additions:**
```bash
# In web/:
npm install -D openapi-typescript@7
npm install openapi-fetch
```
This gives type-safe REST from the generated OpenAPI spec. WebSocket messages are handled separately by importing shared Zod schemas from `server/` (or from a `shared/` directory — the sharing mechanism is an architecture decision to make early).

**Do NOT add:**
- tRPC — breaks Go CLI's HTTP contract.
- GraphQL — massive scope creep; REST stays.
- SvelteKit-specific form libraries (sveltekit-superforms) beyond what already exists — not a v3.0 goal.
- Separate validation libs on the web (yup, valibot) — Zod schemas are shared.

**Integration point:** `shared/schemas/` (new folder at project root) imported by both `server/` and `web/`. If cross-folder imports become awkward with current tsconfig, move to a workspace setup — but defer that decision to Phase 1 spike.

---

## Alternatives Considered (Comprehensive)

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| pg-boss | graphile-worker | If you need absolute lowest polling latency AND don't need DLQ out of the box |
| pg-boss | BullMQ + Redis | Never — violates Postgres-only constraint |
| DIY typed EventEmitter | mitt | If team prefers ultra-minimal external lib over 50 lines of internal code |
| DIY typed EventEmitter | emittery | Only if we later need async-first semantics (we don't) |
| fastify-zod-openapi | fastify-type-provider-zod alone | If we decide NOT to generate OpenAPI docs (skips Swagger UI deps) |
| zod-openapi (samchungy) | @asteasolutions/zod-to-openapi | If locked to Zod v3 — we're not |
| go-jsonschema | quicktype-core | If we outgrow go-jsonschema's JSON Schema subset support |
| dependency-cruiser | eslint-plugin-boundaries | If an ESLint config already exists project-wide (we have none) |
| AsyncLocalStorage + pino.child | OpenTelemetry Node SDK | When we need distributed tracing (post-v3.0) |
| openapi-fetch (web) | tRPC | If we drop the Go CLI (not happening) |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| **Redis / BullMQ / any broker** | Violates Postgres-only architectural constraint; adds ops burden on Mac Mini | pg-boss |
| **node-cron** (existing dep) | In-process, lost on restart, no retry | pg-boss `schedule()` + remove from package.json |
| **cls-hooked** | Deprecated, buggy in modern Node | `AsyncLocalStorage` (stdlib) |
| **pino-http** | Redundant with Fastify's built-in pino integration | `app.log` + child loggers |
| **@asteasolutions/zod-to-openapi** | Pre-Zod-v4 API, requires registry pattern | `zod-openapi` (samchungy) |
| **ts-json-schema-generator, typescript-json-schema** | TypeScript-AST based; we have Zod as source of truth | `zod-openapi` → extract `components.schemas` |
| **openapi-generator-cli** for Go | Java dependency, template-heavy, output often messy | `go-jsonschema` |
| **tRPC** | Breaks Go CLI HTTP contract | REST + OpenAPI + openapi-fetch |
| **eventemitter3, emittery, rxjs Subject** for module bus | Bring deps for 50 lines of code we control better | DIY typed `EventEmitter` wrapper |
| **Nx, Turborepo, Lerna** | Wrong scale — we're not a monorepo | `dependency-cruiser` for boundary rules |
| **ESLint + eslint-plugin-boundaries** | Requires full ESLint setup we don't have | `dependency-cruiser` |
| **Yup, Joi, Ajv, class-validator** | We committed to Zod | Zod everywhere |
| **`as Type` casts at boundaries** | The bug class this refactor exists to eliminate | `.parse()` everywhere |
| **OpenAPI 3.0** | Generates `nullable: true` nonsense, less expressive | OpenAPI 3.1 (zod-openapi default) |

---

## Stack Patterns by Variant

**If OpenAPI generation proves brittle:**
- Drop `fastify-zod-openapi`, keep `fastify-type-provider-zod` alone.
- Skip Go codegen — stay manual on CLI DTOs; revisit in v3.1.
- Cost: no auto-doc, no web codegen; accept manual sync for now.

**If pg-boss dashboard is wanted:**
- Add `@pg-boss/dashboard` dev-only.
- Mount behind an auth guard in dev builds only.

**If web team pushes back on openapi-fetch:**
- Fallback: hand-rolled `fetch` wrapper that imports shared Zod schemas directly.
- Still type-safe, just more code to maintain.

---

## Version Compatibility Matrix

| Package | Version | Compatible With | Notes |
|---------|---------|-----------------|-------|
| pg-boss | 12.15.0 | Node ≥22.12, Postgres ≥13 | Requires `pg@^8.20.0` (not `postgres`) — two drivers coexist |
| fastify-type-provider-zod | 6.1.0 | fastify ≥5.5.0, zod ≥4.1.5 | ✓ Compatible with our fastify 5.8.2 + zod 4.3.6 |
| fastify-zod-openapi | 5.6.1 | fastify 5, zod ≥3.25.74 or ≥4, @fastify/swagger ≥9, @fastify/swagger-ui ≥5 | Bundles zod-openapi internally |
| drizzle-zod | 0.8.3 | drizzle-orm ≥0.36, zod ≥3.25 or ≥4 | ✓ Compatible with our 0.45.1 |
| zod-openapi | 5.4.6 | zod ≥4.0.0 | OpenAPI 3.1 output |
| go-jsonschema | 0.23.0 | Go 1.22+ | CLI tool, not a library |
| dependency-cruiser | 17.3.10 | Node ≥20 | TypeScript support built-in |

**Connection pool consideration:** pg-boss uses `pg@^8.20.0`, Drizzle uses `postgres@^3.4.8` (porsager). These are different drivers that cannot share a pool. Two pools = two sets of open connections to Postgres. At our scale (<100 jobs/day) this is fine, but document it in the operational runbook.

---

## Sources

- **`npm view` (2026-04-16)** for pg-boss@12.15.0, zod@4.3.6, fastify-type-provider-zod@6.1.0, drizzle-zod@0.8.3, zod-openapi@5.4.6, fastify-zod-openapi@5.6.1, emittery@2.0.0, mitt@3.0.1, nanoevents@9.1.0, eventemitter3@5.0.4, graphile-worker@0.16.6, dependency-cruiser@17.3.10 — **HIGH confidence** on all version numbers, peer deps, engine requirements
- https://github.com/timgit/pg-boss — Postgres ≥13, Node ≥22.12 confirmed; v12 feature list (heartbeat, key_strict_fifo, priority filtering) — HIGH
- https://github.com/samchungy/zod-openapi — Zod v4 native, OpenAPI 3.1, `fastify-zod-openapi` integration path — HIGH
- https://github.com/asteasolutions/zod-to-openapi — v8 supports Zod v4 but requires registry pattern (contrast for recommendation) — MEDIUM
- https://github.com/omissis/go-jsonschema — v0.23.0 March 2026, mature tool, brew-installable — HIGH
- https://github.com/glideapps/quicktype — Go support confirmed, output quality caveats flagged — MEDIUM
- https://github.com/sindresorhus/emittery — async-first semantics confirmed (microtask-deferred) — HIGH
- https://github.com/developit/mitt — 200 B, sync FIFO, TS inference pattern — HIGH
- Existing `package.json` and `server/index.ts` — integration points and current dependencies — HIGH (direct read)
- `.planning/PROJECT.md` v3.0 milestone pillars — architectural constraints (Postgres-only, sync event bus) — HIGH (direct read)

**Uncertainties flagged:**
- pg-boss v10 → v12 migration step — release notes visible but no full v10→v12 migration guide. Verify with `boss.start()` schema migration on a dev DB before Phase 1 lands.
- Exact behavior of `drizzle-zod` with JSONB columns (used heavily in `jobs.metadata`) — spike this in Phase 1.
- `go-jsonschema` handling of Zod discriminated unions through JSON Schema `oneOf` — spike before committing to full CLI codegen pipeline.

---
*Stack research for: v3.0 Spec-Driven Architecture refactor of Device Farm*
*Researched: 2026-04-16*
