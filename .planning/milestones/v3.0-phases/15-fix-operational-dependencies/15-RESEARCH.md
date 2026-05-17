# Phase 15: Foundations — Research

**Researched:** 2026-04-17
**Domain:** Fastify 5 plugin architecture, pg-boss v12, AsyncLocalStorage + correlation IDs, typed event bus over Node EventEmitter with Zod 4 discriminated unions, Drizzle ORM + drizzle-zod row decoders, Zod branded IDs, `eslint-plugin-local-rules`, ADR/Nygard, Nyquist baseline capture.
**Confidence:** HIGH for Fastify/Zod/Drizzle/pino/ALS/ADR; MEDIUM for pg-boss v12 specifics (v12 reshipped as ESM, public docs are thinner than v10/v11 in aggregators — verified against GitHub release notes and the pg-boss v12.15 docs page); LOW→MEDIUM for exact eslint-plugin-local-rules flat-config wiring (repo README only covers legacy `.eslintrc`; flat-config pattern backfilled from ESLint 9 docs).

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**ALS + Correlation IDs**
- ALS via `@fastify/request-context` (Fastify-idiomatic, lifecycle-managed)
- `correlation` plugin registers `onRequest` hook: reads `X-Correlation-Id` header or generates `crypto.randomUUID()`; echoes in response header; stored in ALS and bound to pino child logger
- Queue wrapper `queue.send(name, payload, opts)` reads correlationId from ALS and injects into `boss.send` job data; consumer registration helper wraps handlers to restore ALS from job data before execution (solves cross-queue ALS gotcha)
- Unscoped logs (queue workers, scheduled ticks): consumer restores correlationId from job data; scheduled-tick handlers that have no inbound ID generate a new UUID with `actor: "system"` or `"cron"` pino binding

**pg-boss Integration**
- pg-boss Fastify plugin registered AFTER `db`, BEFORE `telemetry`; uses default `pgboss` Postgres schema (isolated from app tables)
- Graceful shutdown via Fastify `onClose`: `boss.stop({graceful: true, timeout: 30_000})` — aligned with common K8s/container grace period
- Named queues registered colocated — each module's `queue.ts` registers its queues at module start; central `server/queue/names.ts` exports `QUEUE_NAMES` constants for type-safe references
- Default `retryLimit: 1` for handlers with physical side-effects (emulator boot, maestro spawn); exponential backoff; non-physical handlers (webhook, cleanup) can override upward in their `queue.ts`

**Event Bus + Events Table**
- Thin typed wrapper over Node `EventEmitter`; emit helpers `.parse()` payloads via Zod `discriminatedUnion` before dispatch; `bus.on<T>(type, handler)` narrows payload via TS overloads keyed on event-type string literal
- Envelope schema (`envelopeSchema`) is shared, `.passthrough()` by convention for v1; carries `{id, type, v: z.literal(1), correlationId, causationId, occurredAt, aggregateType, aggregateId, payload, actor}`
- Persistence to `events` table is opt-in per event: schema registry entry carries `persisted: true` flag; bus middleware persists only flagged events; registry typed so a flagged event without a persisted schema fails compile
- CausationId auto-propagated: subscriber runner wraps handlers to set `currentEventId` into ALS before invoking; nested emit helpers read it off ALS so callers never thread it manually
- Emit helpers REQUIRED for business events — custom lint rule rejects `bus.emit(...)` outside each module's `events.ts`; helpers constructed by `createEventHelpers({registry, bus})` factory exposed per module

**Guardrails + Baseline**
- Custom lint via `eslint-plugin-local-rules` with two rules: `no-imperative-event-names` (rejects event names that are not `noun.verbed` past-tense dotted) and `no-direct-bus-emit` (rejects `bus.emit(...)` outside allowed paths: `**/events.ts` and test files). Wired into existing `npm run lint`
- ADR directory at `docs/adr/` using `NNN-slug.md` with Nygard format (Status / Context / Decision / Consequences). ADR-001 documents v3.0 spec-driven architecture and the key decisions above
- Nyquist baseline: commit output to `.planning/nyquist-baseline.json`; `/gsd:execute-phase` flow references baseline for per-phase delta; success criterion `existing coverage delta ≤ −2pp` enforced against this baseline
- Branded ID types live centrally in `server/types/ids.ts` — `JobId`, `DeviceId`, `PipelineId`, `ArtifactId`, `RecordingId` exported as `z.string().uuid().brand<"...">()`

**Spikes (gated before Phase 15 completion)**
- drizzle-zod JSONB round-trip test on `jobs.metadata`
- pg-boss v12 auto-migration on fresh dev DB
- Branded ID compile-failure proof
- Mac Mini graceful-shutdown timing against 30s timeout

### Claude's Discretion
- Internal wiring of the typed bus (naming of helpers, internal narrowing mechanics) as long as public API (`bus.on`, `bus.emit`, `createEventHelpers`) matches decisions above
- ADR-001 prose tone, length, and section depth provided Nygard structure
- Exact ordering of Phase 15 plans (spikes first vs plumbing first) during planning

### Deferred Ideas (OUT OF SCOPE)
- OpenTelemetry / distributed tracing (v2 — OBS-01)
- Late-starting subscribers / event replay (ER-01, ER-02)
- Multi-node pg-boss (MT-01)
- `fastify-zod-openapi` codegen pipeline (Phase 17)
- Module-level `MODULE.md` conventions (Phase 16)
- Actor field population from auth context (Phase 26 / TRACE-10)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SPEC-04 | Row decoder Zod por tabela; `jobs.metadata` JSONB round-trip testado | §6 Drizzle `events` schema + row decoder; §7 JSONB round-trip spike |
| SPEC-05 | Eventos polimorficos via `z.discriminatedUnion("type", [...])` com narrowing automatico | §4 typed bus; §5 Zod envelope + discriminated union |
| SPEC-08 | Envelopes usam `.passthrough()`; so additive changes | §5 envelope schema (`.passthrough()`); Zod 4 uses `z.looseObject` as alias |
| SPEC-09 | Brand types `z.string().uuid().brand<"JobId">()` em `server/types/ids.ts` | §8 branded IDs with compile-fail proof |
| SPEC-10 | Envelope carrega `v: z.literal(1)`; union por versao preparada | §5 envelope includes `v: z.literal(1)` |
| EVENTS-01 | Typed bus wrapper sobre EventEmitter; `.on(type, handler)` narrows payload | §4 typed bus overloads |
| EVENTS-02 | Envelope `{id,type,v,correlationId,causationId,occurredAt,payload}` runtime | §5 shared envelope |
| EVENTS-03 | Nomes `noun.verbed` past-tense; lint impede imperativo | §10 `no-imperative-event-names` rule |
| EVENTS-04 | Payloads thin (IDs + delta) default; terminal excecao | §5 convention note; Phase 16 validates |
| EVENTS-05 | Regra "sync bus vs pg-boss" documentada em `docs/adr/` | §11 ADR-001 outline |
| EVENTS-08 | Emit helpers em `events.ts`; chamadas diretas a `bus.emit` proibidas por lint | §10 `no-direct-bus-emit` rule |
| QUEUE-01 | pg-boss plugin Fastify; schema `pgboss` isolado | §1 pg-boss v12 plugin shape |
| QUEUE-02 | Named queues criadas; payloads Zod-validados producer e consumer | §1 createQueue + wrapper; §3 ALS wrapper |
| QUEUE-04 | Retry policy por queue; `retryLimit: 1` para side-effect fisico | §1 retryLimit + retryBackoff |
| QUEUE-07 | Graceful shutdown via Fastify `onClose` | §14 Fastify onClose order + pg-boss `stop({graceful, timeout: 30_000})` |
| MOD-07 | Logger por modulo via `logger.child({module})`; correlationId automatico via pino binding + ALS | §9 pino mixin + ALS |
| MOD-10 | `docs/adr/` criado com ADR-001 | §11 ADR-001 outline |
| TRACE-01 | Fastify `onRequest` hook le/gera `X-Correlation-Id`; echo response header | §2 onRequest hook code |
| TRACE-02 | ALS propaga correlationId via `@fastify/request-context` | §2 request-context v6 API |
| TRACE-03 | Toda linha pino inclui `correlationId` via child logger request-scoped | §9 pino mixin |
| TRACE-04 | Envelope event inclui `correlationId` lido da ALS no emit | §5 emit helpers read ALS; §3 cross-queue wrapper |
| TRACE-05 | Wrapper `boss.send()` injeta correlationId; consumer restaura ALS | §3 pg-boss ALS wrapper |
| TRACE-07 | Tabela `events` via Drizzle migration; indexes | §6 Drizzle `events` schema |
| TRACE-08 | Bus middleware persiste so eventos `persisted: true` | §5 registry pattern |
| TRACE-09 | CausationId populado via ALS (`currentEventId`) | §5 subscriber wrapper |
| DEBT-03 | Nyquist validation roda em cada phase; baseline capturada antes Phase 16 | §12 Nyquist baseline mechanics (hand-compute via Vitest json-summary) |
</phase_requirements>

---

## Summary

Phase 15 is substrate-only: no domain refactor, but every new plugin / table / wrapper introduced becomes a *contract* every v3.0 phase must conform to. The research confirms all major choices are library-first, unsurprising, and well-documented:

- **pg-boss v12** ships as pure ESM with named exports (breaking change from v11), supports `application_name` / `schema` isolation, and its `stop({graceful, timeout})` semantics already match the 30 s K8s-default window the context locks in. v12.15+ additionally guarantees pending maintenance work completes before `stop()` returns — aligns cleanly with Fastify's reverse-order `onClose`. **`createQueue(name, options)` must be called before `send` / `work` in v12** (v10→v11 introduced this; v12 keeps it).
- **`@fastify/request-context` v6** is the blessed Fastify-idiomatic wrapper over `AsyncLocalStorage`; it exposes the raw `asyncLocalStorage` export for code paths outside a request (queue workers) — this is the exact hook the cross-queue ALS wrapper needs.
- **Pino `mixin`** is how every log line auto-gets `correlationId` — the mixin reads ALS each call and appends fields to the log record. Zero threading required by module authors.
- **Zod 4** `discriminatedUnion` + `z.looseObject` (the v4 preferred spelling for `.passthrough()`) give the exact envelope-wraps-narrow-payload shape EVENTS-01/02 requires. Typed `.on<T>` narrowing is a standard TS trick: overloads keyed on string-literal event type.
- **Postgres JSONB** does NOT preserve key order or duplicate keys — the `jobs.metadata` round-trip spike must assert semantic equivalence (deep equal after canonicalisation), not literal string equality. This is documented Postgres behaviour, not a Drizzle bug.
- **Zod branded IDs** are a zero-runtime-cost phantom-type; mixing `JobId` and `DeviceId` fails at compile, proven via a `.ts` file with `@ts-expect-error` comments run under `tsc --noEmit`.
- **`eslint-plugin-local-rules`** is the smallest-possible plugin for in-repo rules; rules live in `./eslint-local-rules.js` with a `{ meta, create(context) }` shape. Flat-config wiring is a three-line config addition.
- **Nyquist baseline** — the GSD tool does not (yet) ship a `nyquist` command. Hand-compute the baseline via `vitest run --coverage --coverage.reporter=json-summary` then read `total.lines.pct` / `total.branches.pct` from the coverage summary and commit to `.planning/nyquist-baseline.json`. The `/gsd:execute-phase` flow can diff subsequent runs against this file.

**Primary recommendation:** run the four spikes IN PARALLEL as Wave 0 of the phase (each is independent, under an hour each, and de-risks commits that would otherwise gate plumbing). Plumbing plans (plugin reorder, event bus, queue wrapper, pino mixin, events table, ADR-001, lint rules) then fan out across Waves 1–2 once the spikes green. Nyquist baseline is the last commit before Phase 16 starts — NOT mixed into Phase 15 source changes.

---

## 1. pg-boss v12 Fastify Plugin Shape

**Confidence: MEDIUM-HIGH** (GitHub releases + unpkg docs + community TS examples; v12 docs thinner than v10/v11 in aggregators).

### Breaking changes from v10/v11 → v12 (must know)

| Area | v10/v11 | v12 |
|------|---------|-----|
| Export | CJS default export | **ESM only, named export** `{ PgBoss }` |
| Import | `import PgBoss from 'pg-boss'` | `import { PgBoss } from 'pg-boss'` |
| Node requirement | 18+ | **22.12+** (for `require(esm)`) |
| Static helpers | `PgBoss.states`, `PgBoss.policies` | Now top-level named exports: `import { states, policies, getConstructionPlans } from 'pg-boss'` |
| Queue naming | permissive | stricter: only letters, numbers, `-`, `_`, `.` |
| Queue lifecycle | `send()` auto-created queues in some paths | **`createQueue(name, options)` required before `send`/`work`** (carried from v11 — v12 keeps) |
| Automatic migration from ≤v10 | partial | **Not supported** — clean DB or manual migration |

Device Farm currently has no pg-boss install, so this is a fresh start. Node version: the repo uses `@types/node ^25` and runs on Mac Mini via `tsx watch` — confirm Node >= 22.12 in `doctor` during Phase 15.

### Plugin shape (`server/queue/plugin.ts`)

```typescript
// Source: pg-boss v12 README + fastify-plugin docs
// Verified against: v12.15 named export + createQueue-before-send requirement
import fp from 'fastify-plugin';
import { PgBoss } from 'pg-boss';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { asyncLocalStorage } from '@fastify/request-context';

declare module 'fastify' {
  interface FastifyInstance {
    boss: PgBoss;
    queue: {
      send: (name: string, data: unknown, opts?: Record<string, unknown>) => Promise<string | null>;
      work: <T>(name: string, handler: (data: T, jobId: string) => Promise<void>) => Promise<string>;
      schedule: (name: string, cron: string, data?: unknown, opts?: Record<string, unknown>) => Promise<void>;
    };
  }
}

export default fp(async function queuePlugin(fastify: FastifyInstance) {
  const boss = new PgBoss({
    connectionString: fastify.config.database_url,
    schema: 'pgboss',                          // isolated from app tables
    application_name: 'device-farm-server',    // shows in pg_stat_activity
  });

  // pg-boss emits 'error' for internal failures — attach before start()
  boss.on('error', (err) => fastify.log.error({ err }, 'pg-boss internal error'));

  await boss.start();   // runs auto-migration (creates `pgboss` schema + tables if missing)
  fastify.log.info('pg-boss started (schema=pgboss)');

  fastify.decorate('boss', boss);

  // Thin ALS-aware wrapper (see §3 for ALS details)
  fastify.decorate('queue', {
    async send(name, data, opts = {}) {
      const correlationId = fastify.requestContext.get('correlationId');
      const causationId   = fastify.requestContext.get('currentEventId') ?? null;
      return boss.send(name, { correlationId, causationId, payload: data }, opts);
    },
    async work(name, handler) {
      return boss.work(name, async ([job]) => {
        // restore ALS before running handler (cross-queue gotcha — see §3)
        await asyncLocalStorage.run(
          new Map([
            ['correlationId', job.data.correlationId ?? randomUUID()],
            ['currentEventId', job.data.causationId ?? null],
          ]),
          () => handler(job.data.payload as any, job.id),
        );
      });
    },
    async schedule(name, cron, data = {}, opts = {}) {
      return boss.schedule(name, cron, { correlationId: randomUUID(), payload: data }, opts);
    },
  });

  fastify.addHook('onClose', async () => {
    fastify.log.info('pg-boss: stopping (graceful, timeout=30s)...');
    await boss.stop({ graceful: true, timeout: 30_000, destroy: false });
    fastify.log.info('pg-boss: stopped');
  });
}, {
  name: 'queue',
  dependencies: ['db', 'correlation'],   // needs DB for connection, requestContext for wrapper
});
```

### Retry / singletonKey at send-time

```typescript
// retryLimit=1, retryBackoff=true, retryDelay seed=30s
await fastify.queue.send('job.execute', { jobId }, {
  singletonKey: jobId,                   // only 1 job per key in created/retry/active state
  retryLimit: 1,                         // side-effect queues default
  retryBackoff: true,                    // exponential (retryDelay * 2^(retryCount-1))
  retryDelay: 30,                        // seconds
  expireInHours: 1,
});
```

Per-queue defaults can be set on `createQueue(name, { retryLimit, retryBackoff, retryDelay, policy })`; callsite opts override.

### Auto-migration behaviour

- `boss.start()` runs idempotent DDL against the configured `schema` (default `pgboss`). If the schema doesn't exist, it's created; if it exists with an older version, in-place migration runs within the same call.
- Spike #2 (pg-boss auto-migration on fresh dev DB) verifies: drop `pgboss` schema → `boss.start()` → assert `pgboss.version` table reports latest migration; re-run `boss.start()` → assert no error and `pgboss.version` unchanged (idempotent).
- Schema isolation query (assert no app tables touched):
  ```sql
  SELECT table_schema, table_name
  FROM information_schema.tables
  WHERE table_schema = 'pgboss'
  ORDER BY table_name;
  -- Expect: archive, job, queue, schedule, subscription, version, ... (all under pgboss.)
  ```

### `singletonKey` semantics (v12)

- **Scope:** a singleton is per-queue. `singletonKey: 'abc'` prevents a second job with the same key from being **created/retry/active** on the same queue. Once the job completes, the key is free.
- **Use cases for Phase 15:** demonstrate `boss.send('demo', {}, {singletonKey: 'demo-X'})` to prove in the ALS integration test that re-send with same key returns the existing jobId.

### v12.15 pre-stop maintenance guarantee

Per v12.15 release note: "Ensure pending maintenance, Bam, and Timekeeper work completes before `Boss.stop()` returns." This means `stop({graceful: true, timeout: 30_000})` blocks until (a) active workers drain or timeout hits, AND (b) maintenance tick is quiescent. We rely on this — see §14.

---

## 2. `@fastify/request-context` v6 API

**Confidence: HIGH** (official Fastify org README read directly).

### Registration

```typescript
// server/correlation/plugin.ts
import fp from 'fastify-plugin';
import fastifyRequestContext from '@fastify/request-context';
import { randomUUID } from 'node:crypto';

export default fp(async function correlationPlugin(fastify) {
  // Plugin registration — opens ALS fiber at onRequest
  await fastify.register(fastifyRequestContext, {
    hook: 'onRequest',
    defaultStoreValues: {
      correlationId: null,
      currentEventId: null,
      actor: 'anonymous',
    },
  });

  // Our own onRequest AFTER request-context hook: read/generate header, store in ALS
  fastify.addHook('onRequest', async (req, reply) => {
    const incoming = req.headers['x-correlation-id'];
    const correlationId =
      (typeof incoming === 'string' && incoming.length > 0 && incoming.length < 128)
        ? incoming
        : randomUUID();
    req.requestContext.set('correlationId', correlationId);
    reply.header('x-correlation-id', correlationId);     // echo back
  });
}, { name: 'correlation', dependencies: [] });
```

### Get/set from anywhere

```typescript
// In a route handler
fastify.get('/jobs/:id', async (req) => {
  const cid = req.requestContext.get('correlationId');
  // ...
});

// In a service called from a route (no parameter threading needed)
import { requestContext } from '@fastify/request-context';
function deep() {
  return requestContext.get('correlationId');    // same value as route's req.requestContext.get
}

// Inside an event emit helper stamping an envelope
bus.emit('job.completed', { jobId });
// The emit helper internally calls requestContext.get('correlationId') to stamp envelope
```

### Exposed `asyncLocalStorage` (the key to §3 — cross-queue restore)

```typescript
import { asyncLocalStorage } from '@fastify/request-context';

// Used by queue worker wrapper to RESTORE ALS in a worker fiber
asyncLocalStorage.run(new Map([
  ['correlationId', cidFromJobData],
  ['currentEventId', causationIdFromJobData],
]), () => handler(job.data));
```

The store type is a `Map<string, unknown>`. `fastify.requestContext` is the same facade delegating to this ALS.

### Pino integration

- Default store can be a function of request: `defaultStoreValues: (req) => ({ log: req.log.child({ ... }) })` — but we don't need this pattern. We use Pino `mixin` (see §9) which reads ALS directly.
- Pino can read from `requestContext.get()` in its `mixin` callback because the `mixin` fires inside the request's ALS fiber — ALS propagation is how this works at the Node level.

---

## 3. pg-boss ALS Cross-Queue Gotcha (TRACE-05)

**Confidence: HIGH** (known `AsyncLocalStorage` + worker-pool pattern; concrete code in §1 + §2).

### The problem

1. Request arrives → `onRequest` writes `correlationId` into ALS.
2. Handler calls `boss.send('job.execute', payload)` — pg-boss writes a row to `pgboss.job` and returns.
3. Some milliseconds/minutes later, pg-boss's internal polling worker (a DIFFERENT async context, started by `boss.start()` long before this request) dequeues the row and calls our handler.
4. The worker's async context has NO ALS store — `requestContext.get('correlationId')` returns `null`.

This is NOT a Fastify bug — it's the fundamental nature of ALS (tied to async context chain, which crosses process boundaries only via serialization).

### The pattern (already sketched in §1)

**Producer side — `queue.send` wrapper:**
```typescript
// Before boss.send, read ALS and serialize into job.data
const correlationId = requestContext.get('correlationId');
const causationId   = requestContext.get('currentEventId') ?? null;
await boss.send(name, { correlationId, causationId, payload: userData }, opts);
```

**Consumer side — `queue.work` wrapper:**
```typescript
// When the worker fiber runs, restore ALS BEFORE invoking user handler
await boss.work(name, async ([job]) => {
  const store = new Map<string, unknown>([
    ['correlationId', job.data.correlationId ?? randomUUID()],
    ['currentEventId', job.data.causationId ?? null],
    ['actor', job.data.actor ?? 'cron'],
  ]);
  await asyncLocalStorage.run(store, async () => {
    await userHandler(job.data.payload);
  });
});
```

### Scheduled-tick case (no inbound correlationId)

Schedules (`boss.schedule('lifecycle-compress-daily', '0 3 * * *')`) have no triggering request. The wrapper generates a fresh UUID at schedule-fire time and tags `actor: 'cron'`. Per-run correlation still works (every fire gets a new UUID), just not a caller-origin trace.

### Integration test pattern (Success Criterion #3)

```typescript
// spike / integration test
it('correlationId crosses request -> boss.send -> worker handler', async () => {
  const captured: string[] = [];
  await fastify.queue.work('demo', async () => {
    captured.push(requestContext.get('correlationId') as string);
  });

  const res = await fastify.inject({
    method: 'POST', url: '/demo',
    headers: { 'x-correlation-id': 'test-cid-123' },
  });
  expect(res.headers['x-correlation-id']).toBe('test-cid-123');

  // wait for worker to drain (or assert via poll with 5s timeout)
  await vi.waitFor(() => expect(captured).toHaveLength(1), { timeout: 5000 });
  expect(captured[0]).toBe('test-cid-123');
});
```

---

## 4. Typed Event Bus over EventEmitter with Zod Narrowing

**Confidence: HIGH** (canonical TS pattern; `keyof` + indexed access + overloads).

### Approach

- **Single source of truth:** a *registry* — an object mapping string-literal event-type to `{ schema: ZodType, persisted: boolean }`.
- **TS narrowing** happens via conditional types + overloads; we don't need `strict-event-emitter-types` for the core pattern (though it's a valid alternative).

### Code (TS 5.9 — device-farm's current compiler)

```typescript
// server/bus/types.ts
import type { z } from 'zod';

export interface EventRegistryEntry<S extends z.ZodType> {
  readonly schema: S;
  readonly persisted: boolean;
}

export type EventRegistry = {
  readonly [type: string]: EventRegistryEntry<z.ZodType>;
};

// Helper: given registry R and type T, infer the payload type
export type PayloadOf<R extends EventRegistry, T extends keyof R & string> =
  z.infer<R[T]['schema']>;

// server/bus/bus.ts
import { EventEmitter } from 'node:events';

export class TypedBus<R extends EventRegistry> {
  private readonly ee = new EventEmitter();

  constructor(private readonly registry: R) {
    this.ee.setMaxListeners(50);
  }

  on<T extends keyof R & string>(
    type: T,
    handler: (payload: PayloadOf<R, T>) => void | Promise<void>,
  ): () => void {
    const wrapped = (payload: unknown) => handler(payload as PayloadOf<R, T>);
    this.ee.on(type, wrapped);
    return () => this.ee.off(type, wrapped);
  }

  emit<T extends keyof R & string>(type: T, payload: PayloadOf<R, T>): void {
    // runtime parse (trust-boundary; cheap for in-process, guards subscriber invariants)
    const entry = this.registry[type];
    if (!entry) throw new Error(`Unknown event type: ${type}`);
    const parsed = entry.schema.parse(payload);
    this.ee.emit(type, parsed);
  }
}
```

### Usage narrows automatically

```typescript
// Caller code — TS infers payload type from event-type string literal
bus.on('job.completed', (payload) => {
  //    ^^^^^^^^^^^^^  literal narrows the generic T
  //                          ^^^^^^^  typed as { jobId: JobId, durationMs: number }
  payload.jobId;   // OK
  payload.xyz;     // ERROR: Property 'xyz' does not exist
});

bus.emit('job.completed', { jobId: 'wrong' });
//                                ^^^^^^^ ERROR: string not assignable to JobId
```

### Emit-helpers factory (per-module API surface)

```typescript
// server/bus/helpers.ts
export function createEventHelpers<R extends EventRegistry>(bus: TypedBus<R>, registry: R) {
  return <T extends keyof R & string>(type: T) =>
    (payload: PayloadOf<R, T>) => bus.emit(type, payload);
}

// server/jobs/events.ts
export const jobEvents = {
  completed: createEventHelpers(bus, jobRegistry)('job.completed'),
  started:   createEventHelpers(bus, jobRegistry)('job.started'),
};
// Usage at call site:
jobEvents.completed({ jobId, durationMs: 42 });
```

---

## 5. Zod 4 Envelope + Discriminated Union Pattern

**Confidence: HIGH** (Zod 4 docs; `looseObject` is Zod 4's alias for `.passthrough()`).

### Envelope schema (shared; `.passthrough()` for additive forward-compat)

```typescript
// server/events/envelope.ts
import { z } from 'zod';

// Branded aggregate IDs come from server/types/ids.ts (see §8)
import { JobIdSchema, DeviceIdSchema } from '../types/ids.js';

// Per-event payload schemas (examples)
const JobCompletedPayload = z.object({
  jobId: JobIdSchema,
  durationMs: z.number().int().nonnegative(),
  status: z.enum(['passed', 'failed', 'timeout']),
});

const DeviceAllocatedPayload = z.object({
  deviceId: DeviceIdSchema,
  jobId: JobIdSchema,
});

// Discriminated union per-event (Zod 4 preferred spelling)
export const EventPayload = z.discriminatedUnion('type', [
  z.object({ type: z.literal('job.completed'),    payload: JobCompletedPayload }),
  z.object({ type: z.literal('device.allocated'), payload: DeviceAllocatedPayload }),
]);

// Envelope wraps each event
export const envelopeSchema = z.looseObject({   // Zod 4 preferred spelling for .passthrough()
  id: z.string().uuid(),                       // unique event id
  type: z.string(),                            // dotted past-tense (lint-enforced)
  v: z.literal(1),                             // schema version — SPEC-10
  correlationId: z.string().uuid(),
  causationId: z.string().uuid().nullable(),
  occurredAt: z.string().datetime(),           // ISO 8601
  aggregateType: z.string(),                   // 'job', 'device', 'recording', ...
  aggregateId: z.string().uuid(),
  actor: z.string(),                           // userId / apiKeyId / 'system' / 'cron'
  payload: z.unknown(),                        // validated by per-type schema in registry
});

export type Envelope = z.infer<typeof envelopeSchema>;
```

**Zod 4 `.passthrough()` vs `z.looseObject`:** both work; `z.looseObject({...})` is the v4 preferred factory. We use `looseObject` (= `.passthrough()`) so v1 envelopes that pick up a `v=1`-compatible extra field on an older consumer don't throw. Additive-only rule in ADR-001.

### Emit helpers stamp envelope from registry

```typescript
// Helpers called from module events.ts
function makeEmit<R extends EventRegistry, T extends keyof R & string>(type: T) {
  return (aggregateId: string, payload: PayloadOf<R, T>, opts?: { actor?: string }) => {
    const envelope: Envelope = {
      id: randomUUID(),
      type,
      v: 1,
      correlationId: requestContext.get('correlationId') ?? randomUUID(),
      causationId: requestContext.get('currentEventId') ?? null,
      occurredAt: new Date().toISOString(),
      aggregateType: type.split('.')[0],
      aggregateId,
      actor: opts?.actor ?? requestContext.get('actor') ?? 'anonymous',
      payload,
    };
    bus.emit(type, envelope);
    if (registry[type].persisted) persistEnvelope(envelope);   // §6 events table
  };
}
```

### Subscriber wrapper sets `currentEventId` (causation chain)

```typescript
// Wrap each subscriber so any emit INSIDE it gets envelope.id as causationId
bus.on('job.completed', async (envelope) => {
  await asyncLocalStorage.run(
    new Map([...asyncLocalStorage.getStore()!, ['currentEventId', envelope.id]]),
    async () => userHandler(envelope.payload),
  );
});
```

---

## 6. Drizzle ORM — `events` Append-Only Table

**Confidence: HIGH** (existing schema patterns in `server/db/schema.ts` + Drizzle pg-core docs).

### Schema DSL snippet

```typescript
// Add to server/db/schema.ts (alongside existing 8 tables)
export const events = pgTable('events', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  eventType: varchar('event_type', { length: 128 }).notNull(),
  eventVersion: integer('event_version').notNull().default(1),
  correlationId: uuid('correlation_id').notNull(),
  causationId: uuid('causation_id'),
  aggregateType: varchar('aggregate_type', { length: 64 }).notNull(),
  aggregateId: uuid('aggregate_id').notNull(),
  payload: jsonb('payload').notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  actor: varchar('actor', { length: 255 }).notNull().default('system'),
}, (table) => [
  index('events_correlation_id_idx').on(table.correlationId),
  index('events_event_type_idx').on(table.eventType),
  index('events_occurred_at_idx').on(table.occurredAt),
  index('events_aggregate_idx').on(table.aggregateType, table.aggregateId),
]);
```

### Migration: `drizzle-kit push` vs `generate` — **recommended: generate**

- The repo uses BOTH: `drizzle-kit push` for dev iteration, `drizzle-kit generate` for committed migrations.
- **Events table should be `generate`-d** (reviewable SQL migration file committed to repo). Rationale:
  1. Indexes on a potentially-high-volume append-only table need to be explicit in history.
  2. Any future column change is best landed as an explicit migration (the table is load-bearing for TRACE-11 in Phase 27).
  3. `push` is fine for dev, but a `generate`-d migration at Phase 15 commit lets ops replay the schema forward cleanly on staging / prod-like envs.

### Row decoder (drizzle-zod + hand-typed for JSONB payload)

```typescript
// server/events/decoder.ts
import { createSelectSchema } from 'drizzle-zod';
import { events } from '../db/schema.js';
import { envelopeSchema, type Envelope } from './envelope.js';

// Auto-generated select schema (decodes DB row to app shape)
const eventRowSchema = createSelectSchema(events);

// Re-project row -> Envelope (rename snake_case columns to camelCase envelope)
export function decodeEventRow(row: unknown): Envelope {
  const parsed = eventRowSchema.parse(row);
  return envelopeSchema.parse({
    id: parsed.id,
    type: parsed.eventType,
    v: parsed.eventVersion,
    correlationId: parsed.correlationId,
    causationId: parsed.causationId,
    occurredAt: parsed.occurredAt.toISOString(),
    aggregateType: parsed.aggregateType,
    aggregateId: parsed.aggregateId,
    actor: parsed.actor,
    payload: parsed.payload,
  });
}
```

**Note on drizzle-zod + Zod 4 compatibility:** there was a known compat regression on Zod 3.24 / v4 transition (drizzle-orm issues #4049, #4249). Device-farm is on `drizzle-orm ^0.45.1` + `zod ^4.3.6`; verify the installed `drizzle-zod` sub-export works (it ships as `drizzle-orm/zod` in beta; stable `drizzle-zod` is separate dep). **Wave 0 task: `npm view drizzle-zod` then install the Zod-4-compatible version, fail the spike if the output schema doesn't parse a real row.**

---

## 7. drizzle-zod JSONB Round-Trip Spike (SPEC-04)

**Confidence: HIGH** (Postgres JSONB semantics documented).

### The Postgres truth

> "jsonb does not preserve white space, does not preserve the order of object keys, and does not keep duplicate object keys. If duplicate keys are specified in the input, only the last value is kept." — Postgres 18 docs, §8.14

- `jsonb` (what `jobs.metadata` uses) **does NOT preserve key order** — it's a parsed binary representation.
- `json` preserves insertion order and duplicates (we do NOT use `json`; `jsonb` is correct for metadata queries).
- **Therefore** the "no key-order drift" assertion from CONTEXT is interpreted as *semantic equivalence*, not *byte equivalence*.

### Test pattern (Vitest + existing DB fixture)

```typescript
// server/db/__tests__/jsonb-roundtrip.spec.ts
import { describe, it, expect } from 'vitest';
import { jobs } from '../schema.js';
import { createDb } from '../index.js';
import { eq } from 'drizzle-orm';

describe('jobs.metadata JSONB round-trip (SPEC-04)', () => {
  it('preserves semantic equivalence across INSERT -> SELECT', async () => {
    const { db, client } = createDb(process.env.TEST_DATABASE_URL!);
    const input = {
      b: 2,
      a: 1,
      nested: { c: [1, 2, 3], d: { deep: true } },
      arr: [{ x: 1 }, { y: 2 }],
      unicode: 'café',
      nullField: null,
    };
    const [row] = await db.insert(jobs)
      .values({ platform: 'android', metadata: input })
      .returning();

    const fetched = await db.select().from(jobs).where(eq(jobs.id, row.id));
    expect(fetched[0].metadata).toEqual(input);    // deep equal (Vitest)
    // Note: Object.keys order is NOT guaranteed — don't assert JSON.stringify equality
    expect(Object.keys(fetched[0].metadata as object).sort())
      .toEqual(Object.keys(input).sort());

    await client.end();
  });

  it('discards duplicate keys (Postgres jsonb semantic)', async () => {
    // Can't craft "duplicate keys" from JS object (keys are unique in JS)
    // But prove the driver/Postgres behave per spec — this is documentation-as-test
    const input = JSON.parse('{"a": 1, "a": 2}');    // JSON.parse also dedupes
    expect(input).toEqual({ a: 2 });                  // last-wins (matches Postgres)
  });
});
```

### Gotcha: array element order

Arrays ARE order-preserving in `jsonb`. Only object-key order is not. Test above uses deep-equal which handles both correctly.

---

## 8. Zod Branded ID Types — Compile-Failure Proof (SPEC-09)

**Confidence: HIGH** (Zod 4 official `.brand<>()` + TS structural nominal trick).

### Central `server/types/ids.ts`

```typescript
// server/types/ids.ts
import { z } from 'zod';

export const JobIdSchema       = z.string().uuid().brand<'JobId'>();
export const DeviceIdSchema    = z.string().uuid().brand<'DeviceId'>();
export const PipelineIdSchema  = z.string().uuid().brand<'PipelineId'>();
export const ArtifactIdSchema  = z.string().uuid().brand<'ArtifactId'>();
export const RecordingIdSchema = z.string().uuid().brand<'RecordingId'>();

export type JobId       = z.infer<typeof JobIdSchema>;
export type DeviceId    = z.infer<typeof DeviceIdSchema>;
export type PipelineId  = z.infer<typeof PipelineIdSchema>;
export type ArtifactId  = z.infer<typeof ArtifactIdSchema>;
export type RecordingId = z.infer<typeof RecordingIdSchema>;

// Constructors (validate at trust-boundary only — DB decoder, API boundary)
export const toJobId       = (v: string): JobId       => JobIdSchema.parse(v);
export const toDeviceId    = (v: string): DeviceId    => DeviceIdSchema.parse(v);
// ...etc
```

### Compile-failure proof (lives in a test file, run in CI)

```typescript
// server/types/__tests__/ids.compile.ts
// This file is NEVER imported at runtime — it exists to prove TS rejects misuse.
// Run with: tsc --noEmit (part of `npm run build` or a dedicated `typecheck` script)
import type { JobId, DeviceId } from '../ids.js';

declare function consumeJobId(id: JobId): void;
declare function consumeDeviceId(id: DeviceId): void;

const a: JobId    = 'abc' as JobId;      // legal cast
const b: DeviceId = 'xyz' as DeviceId;

consumeJobId(a);       // OK
consumeDeviceId(b);    // OK

// @ts-expect-error — DeviceId is not assignable to JobId
consumeJobId(b);

// @ts-expect-error — raw string is not assignable to DeviceId
consumeDeviceId('xyz');
```

`@ts-expect-error` makes TS fail compilation if the next line does NOT have an error. CI step: `tsc --noEmit` on the whole `server/` tree catches both positive (wrong type fails) and negative (mis-labelled error) cases.

### Pragmatic note

Branded types are **compile-time only** — at runtime a `JobId` is just a `string`. We only `.parse()` at the boundary (DB row decoder, API request parser, WS frame decoder). After that, branded type flows freely.

---

## 9. Pino + ALS Mixin for correlationId (MOD-07, TRACE-03)

**Confidence: HIGH** (widely-used Pino pattern + official `mixin` API).

### Wiring

```typescript
// server/index.ts — replace the existing logger literal
import { asyncLocalStorage } from '@fastify/request-context';

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? 'info',
    transport: /* unchanged */,
    mixin() {
      // Called for every log() invocation; merges result into log record
      const store = asyncLocalStorage.getStore();
      if (!store) return {};
      const out: Record<string, unknown> = {};
      const cid = store.get?.('correlationId');
      const cause = store.get?.('currentEventId');
      const actor = store.get?.('actor');
      if (cid) out.correlationId = cid;
      if (cause) out.causationId = cause;
      if (actor) out.actor = actor;
      return out;
    },
  },
});
```

### Module-level child logger (MOD-07)

```typescript
// Inside each module factory
const moduleLogger = fastify.log.child({ module: 'jobs' });
// Every log line now has:
//   { level, time, msg, module: 'jobs', correlationId: '...', causationId: '...', actor: '...' }
```

### Interaction with `@fastify/request-context`

- `request-context` installs an `onRequest` hook that opens an ALS fiber with the default store.
- Fastify's per-request logger (`req.log`) inherits from the top-level logger so its `mixin` runs inside the same fiber, and correlationId is captured.
- For queue workers: the §3 wrapper calls `asyncLocalStorage.run(newStore, ...)`, and `mixin` inside that fiber sees the restored store. No extra wiring needed.

### Caveat: background tasks that don't go through a request or worker

Things like `setInterval` callbacks (e.g. health checker polling) won't have a store. `mixin` returns `{}` cleanly — log lines simply omit `correlationId`. For those we add `actor: 'system'` bindings explicitly when creating their child logger.

---

## 10. Custom ESLint Rules (`eslint-plugin-local-rules`)

**Confidence: HIGH** for plugin wiring (official README); MEDIUM for flat-config specifics (backfilled from ESLint 9 docs — the repo currently doesn't have an ESLint config, so Phase 15 adds one).

### Setup

1. `npm i -D eslint eslint-plugin-local-rules @typescript-eslint/parser @typescript-eslint/eslint-plugin`
2. Create `./eslint-local-rules.js` (CommonJS is fine; or `eslint-local-rules/index.js` if you prefer a directory).

### Rule 1 — `no-imperative-event-names`

Rejects string literals that look like event names but aren't past-tense dotted.

```javascript
// eslint-local-rules/no-imperative-event-names.js
const DOTTED_PAST_TENSE = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/;
// Simpler heuristic than tagging past tense: reject imperatives in last segment
const IMPERATIVE_LAST = /\.(create|update|delete|run|start|stop|send|build|queue)$/;

module.exports = {
  meta: {
    type: 'problem',
    docs: { description: 'event names must be noun.verbed past-tense dotted' },
    schema: [],
    messages: {
      imperative: 'Event name "{{name}}" uses imperative verb. Use past tense (e.g. "job.completed", "device.booted").',
      malformed:  'Event name "{{name}}" is not noun.verbed dotted (expect /^[a-z]+(\\.[a-z]+)+$/).',
    },
  },
  create(context) {
    // Only inspect calls to bus.emit / createEventHelpers(...)(...) / registry keys
    return {
      'CallExpression[callee.property.name="emit"] Literal'(node) {
        if (typeof node.value !== 'string') return;
        if (!DOTTED_PAST_TENSE.test(node.value)) {
          context.report({ node, messageId: 'malformed', data: { name: node.value } });
        } else if (IMPERATIVE_LAST.test(node.value)) {
          context.report({ node, messageId: 'imperative', data: { name: node.value } });
        }
      },
    };
  },
};
```

### Rule 2 — `no-direct-bus-emit`

Rejects `bus.emit(...)` calls outside allowlisted paths.

```javascript
// eslint-local-rules/no-direct-bus-emit.js
const ALLOW = [
  /\/events\.ts$/,
  /\.(spec|test)\.ts$/,
  /\/__tests__\//,
];

module.exports = {
  meta: {
    type: 'problem',
    docs: { description: 'bus.emit() may only be called from events.ts or tests' },
    schema: [],
    messages: {
      forbidden: 'bus.emit() is forbidden here. Use emit helpers from the module events.ts.',
    },
  },
  create(context) {
    const filename = context.getFilename();
    const allowed = ALLOW.some((re) => re.test(filename));
    if (allowed) return {};

    return {
      'CallExpression[callee.object.name="bus"][callee.property.name="emit"]'(node) {
        context.report({ node, messageId: 'forbidden' });
      },
      // Also catch fastify.bus.emit
      'CallExpression[callee.object.property.name="bus"][callee.property.name="emit"]'(node) {
        context.report({ node, messageId: 'forbidden' });
      },
    };
  },
};
```

### Index

```javascript
// eslint-local-rules/index.js
module.exports = {
  'no-imperative-event-names': require('./no-imperative-event-names.js'),
  'no-direct-bus-emit': require('./no-direct-bus-emit.js'),
};
```

### Flat-config wiring (ESLint 9) — `eslint.config.js`

```javascript
// eslint.config.js
import localRules from 'eslint-plugin-local-rules';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';

export default [
  {
    files: ['server/**/*.ts'],
    languageOptions: { parser: tsParser, parserOptions: { project: './tsconfig.json' } },
    plugins: { '@typescript-eslint': tsPlugin, 'local-rules': localRules },
    rules: {
      'local-rules/no-imperative-event-names': 'error',
      'local-rules/no-direct-bus-emit': 'error',
    },
  },
];
```

Then add `"lint": "eslint server/"` to `package.json` scripts.

### Tests for the rules (RuleTester)

```javascript
// eslint-local-rules/__tests__/no-direct-bus-emit.test.js
const { RuleTester } = require('eslint');
const rule = require('../no-direct-bus-emit.js');

new RuleTester().run('no-direct-bus-emit', rule, {
  valid: [
    { code: `bus.emit('job.completed', {})`, filename: 'server/jobs/events.ts' },
    { code: `bus.emit('job.completed', {})`, filename: 'server/jobs/__tests__/x.test.ts' },
  ],
  invalid: [
    { code: `bus.emit('job.completed', {})`, filename: 'server/jobs/service.ts',
      errors: [{ messageId: 'forbidden' }] },
  ],
});
```

---

## 11. ADR-001 Content Outline (MOD-10, EVENTS-05)

**Confidence: HIGH** (Nygard format is canonical; content pulled from PROJECT.md + CONTEXT.md).

### File: `docs/adr/001-spec-driven-architecture.md`

```markdown
# ADR-001: Spec-Driven + Event-Driven Architecture for Device Farm v3.0

## Status
Accepted — 2026-04-17

## Context
Device Farm v2.0 shipped a working single-node test platform, but its server codebase resists LLM comprehension and module-scale refactoring:

- Cross-module imperative calls (`jobService.executeJob` reaches directly into `recordingService`, `webhookService`, `broadcaster`).
- Queue semantics split across in-memory Promise chains and `node-cron` timers — no single place captures "what runs async, what retries, what survives a crash."
- No correlation IDs: a QA report of "test N failed" requires manual log correlation across 5 log sources.
- No typed event vocabulary: adding a subscriber requires reading imperative call sites.
- Zod validation exists only at Fastify route boundaries; DB rows, WebSocket frames, and config files are loosely typed.

Volume is small (<50 jobs/day) but adoption will grow, and the investment in LLM-assisted code maintenance (Claude Code, Copilot) is load-bearing for the 1-person team.

## Decision
Adopt a spec-driven + event-driven architecture with five pillars:

1. **Zod at every trust boundary** — API request/response, WebSocket frames, events, DB row decoders, config YAML. TS types inferred via `z.infer`.
2. **In-process typed event bus per module** — `bus.on<T>(type, handler)` narrows payload via Zod discriminated union. Synchronous; for same-request cache invalidation + WS broadcast.
3. **pg-boss as the single durable queue** — replaces in-memory queues and `node-cron`. Rule: *sync bus = same request / cache / WS broadcast; pg-boss queue = anything that retries, survives crash, or calls external*.
4. **Correlation IDs + append-only `events` table** — `AsyncLocalStorage` via `@fastify/request-context` stamps every log line and every envelope; business events flagged `persisted: true` land in `events` table for causal-tree trace (`GET /api/events?correlationId=X`).
5. **LLM-first modules** — each `server/<module>/` has `MODULE.md` + barrel `index.ts` + `events.ts` + factory `createXModule(deps)` + tests-as-spec.

## Consequences

### Positive
- LLM agents can reason about one module at a time by reading `MODULE.md` (contract) + `events.ts` (vocabulary) + `__tests__/*.spec.ts` (behaviour).
- Event-driven seams make module extraction reversible: if a subscriber goes wrong, unplug it.
- `events` table + `correlationId` give free causal tracing without OpenTelemetry operational weight.
- pg-boss removes ad-hoc Promise-chain error handling.

### Negative / Costs
- One-time refactor cost: 16 phases (15->30).
- Runtime parse overhead at trust boundaries — acceptable (<1 ms for typical payloads).
- Zod+drizzle-zod version compatibility requires occasional attention.
- Developers must internalise the sync-bus-vs-queue rule; lint rules (`no-direct-bus-emit`, `no-imperative-event-names`) enforce it mechanically.

### Constraints locked here (apply to every subsequent phase)
- Events use `noun.verbed` past-tense dotted names.
- Envelopes use `.passthrough()` (`z.looseObject`) — additive changes only within a schema version.
- Envelope field `v: z.literal(1)`; a v2 envelope is a new schema in a discriminated union, not a mutation.
- Queue jobs with physical side effects default to `retryLimit: 1` and `singletonKey`.
- Graceful shutdown drains queue workers within 30 s.
- `fastify-zod-openapi` + `go-jsonschema` + `openapi-typescript` codegen (Phase 17) becomes the source-of-truth pipeline for CLI + web types.

### Out of scope
- OpenTelemetry distributed tracing (deferred to v2; single-node doesn't need it).
- Event sourcing (only business events are persisted; current-state tables stay authoritative).
- Multi-node pg-boss / multi-tenant / SSO (deferred).
```

---

## 12. Nyquist Baseline Mechanics (DEBT-03)

**Confidence: MEDIUM-HIGH** — GSD tool **does not** currently expose a `nyquist` sub-command (`gsd-tools nyquist ...` returns `Error: Unknown command: nyquist`). Commands currently exposed: `state, resolve-model, find-phase, commit, verify-summary, verify, frontmatter, template, generate-slug, current-timestamp, list-todos, verify-path-exists, config-ensure-section, init`. Hand-compute is the path forward.

### What `.planning/nyquist-baseline.json` captures

The baseline is a snapshot of quantitative signals at the commit PRECEDING any Phase 15 source change:
- Test coverage: `lines.pct`, `branches.pct`, `functions.pct`, `statements.pct` (overall + per-directory if possible).
- Test file count.
- Source file count (TS in `server/`).
- Commit SHA and timestamp.

### Hand-compute procedure

1. Add coverage reporter configuration:
   ```typescript
   // vitest.config.ts (create if missing; repo currently has no config)
   import { defineConfig } from 'vitest/config';
   export default defineConfig({
     test: {
       coverage: {
         provider: 'v8',
         reporter: ['text', 'json-summary'],
         reportsDirectory: './coverage',
         include: ['server/**/*.ts'],
         exclude: ['server/**/__tests__/**', 'server/**/*.d.ts'],
       },
     },
   });
   ```
2. Install provider: `npm i -D @vitest/coverage-v8`.
3. Run baseline snapshot BEFORE any Phase 15 source change:
   ```bash
   git checkout -b chore/nyquist-baseline
   npm test -- --coverage
   # coverage/coverage-summary.json now exists with total.lines.pct etc.
   ```
4. Generate `.planning/nyquist-baseline.json`:
   ```javascript
   // scripts/capture-nyquist.mjs
   import { readFileSync, writeFileSync } from 'node:fs';
   import { execFileSync } from 'node:child_process';
   const summary = JSON.parse(readFileSync('coverage/coverage-summary.json', 'utf8'));
   const sha = execFileSync('git', ['rev-parse', 'HEAD']).toString().trim();
   const baseline = {
     capturedAt: new Date().toISOString(),
     commit: sha,
     coverage: {
       lines:      summary.total.lines.pct,
       branches:   summary.total.branches.pct,
       functions:  summary.total.functions.pct,
       statements: summary.total.statements.pct,
     },
   };
   writeFileSync('.planning/nyquist-baseline.json', JSON.stringify(baseline, null, 2));
   ```
   (Use `execFileSync` with argv array — never shell-concat.)
5. Commit AS A SEPARATE COMMIT, with message `chore: capture nyquist baseline before v3.0 substrate`. This commit is the "before" reference for every future phase's `coverage delta <= -2pp` check.

### Per-phase delta check

```bash
# In /gsd:execute-phase or a git pre-push hook
npm test -- --coverage
CURRENT_LINES=$(jq '.total.lines.pct' coverage/coverage-summary.json)
BASELINE_LINES=$(jq '.coverage.lines' .planning/nyquist-baseline.json)
DELTA=$(echo "$CURRENT_LINES - $BASELINE_LINES" | bc)
if (( $(echo "$DELTA < -2" | bc -l) )); then
  echo "Coverage regressed $DELTA pp below baseline ($BASELINE_LINES -> $CURRENT_LINES)"
  exit 1
fi
```

---

## 13. Plugin Registration Reordering

**Confidence: HIGH** (read directly from `server/index.ts`).

### Current order (as of 2026-04-17)

```
1. config
2. (dependency-checker as a function call, NOT a plugin)
3. pool
4. db
5. auth
6. websocket
7. artifacts
8. reporting
9. jobs
10. lifecycle
11. hooks
12. maestro
13. pipelines
14. api
15. static
```

### Target order (Phase 15)

Insert `event-bus` / `correlation` / `queue` / `telemetry` at the positions dictated by downstream consumers. Several existing plugins (artifacts, reporting, jobs, lifecycle, hooks, pipelines) will want to emit events and enqueue work AFTER Phase 16+ — but Phase 15 only creates the substrate; it does not touch their internals. Plugin order (Phase 15 substrate in **bold**):

```
 1. config
 2. dependency-checker (function call — keep as is)
 3. **event-bus**           (new — no deps)
 4. **correlation**         (new — no deps; wraps @fastify/request-context)
 5. db
 6. **queue** (pg-boss)     (new — deps: ['db', 'correlation'])
 7. **telemetry**           (new — deps: ['correlation']; ties pino mixin + metrics hooks for later)
 8. pool                    (unchanged role — moves down by 3)
 9. auth
10. websocket
11. artifacts
12. reporting
13. jobs
14. lifecycle
15. hooks
16. maestro
17. pipelines
18. api
19. static
```

### Rationale for position choices

- `event-bus` (3) and `correlation` (4) have no runtime deps — they sit between config and db so early plugins (db connection logging) get correlationId too.
- `queue` (6) needs `db` (connection) AND `correlation` (ALS wrapper in `queue.send`) — hence after both.
- `telemetry` (7) wraps the pino mixin binding for logs but is a logical mount for future metrics decorators; depends on `correlation`.
- `pool` (8) moves from position 3 to 8. Verify downstream: `pool` needs `config` — it does NOT depend on `db`, `auth`, etc. Moving it down is safe.
- Everything from `auth` (9) onward is unchanged in relative order.

### `dependencies: [...]` declarations for new plugins

```typescript
export default fp(eventBusPlugin,  { name: 'event-bus',   dependencies: [] });
export default fp(correlationPlugin, { name: 'correlation', dependencies: [] });
export default fp(queuePlugin,     { name: 'queue',       dependencies: ['db', 'correlation'] });
export default fp(telemetryPlugin, { name: 'telemetry',   dependencies: ['correlation'] });
```

### Plan note: do NOT migrate existing plugins in Phase 15

Per CONTEXT.md, Phase 15 is substrate only. Don't wire `jobs` / `reporting` etc. to emit events in Phase 15 — that's Phase 16+. Just verify the app boots with the new plugins registered.

---

## 14. Graceful Shutdown Interaction (QUEUE-07)

**Confidence: HIGH** (Fastify docs + pg-boss v12.15 changelog).

### Fastify `onClose` runs plugins in REVERSE registration order

Given the target order from §13, Fastify will close in reverse (static -> api -> pipelines -> ... -> queue -> db -> correlation -> event-bus). This means **`queue.onClose` fires BEFORE `db.onClose`** — exactly what we need.

### Current shutdown code in `server/index.ts` calls `process.exit(0)` BEFORE `app.close()`'s onClose chain completes

Line 187 calls `app.jobService.shutdown()` and line 191 `app.pool.shutdown()` ahead of `app.close()` (line 203) — but those manual calls happen outside the Fastify plugin close chain. Phase 15 should:

1. Keep the SIGTERM handler but make it purely call `app.close()` and let plugins tear themselves down via their own `onClose` hooks.
2. Each substrate plugin's `onClose`:
   - `queue.onClose`: `await boss.stop({graceful: true, timeout: 30_000, destroy: false})`
   - `telemetry.onClose`: flush pino transport (pino handles this automatically)
   - `correlation.onClose`: no-op (ALS is global, no resource)
   - `event-bus.onClose`: `ee.removeAllListeners()` (best-effort)

### Concrete SIGTERM reshape

```typescript
// server/index.ts — Phase 15 replaces the existing shutdown fn
const shutdown = async (signal: string) => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  app.log.info({ signal }, 'Graceful shutdown initiated');

  // Existing Phase 15 PRE-close tasks (non-plugin):
  app.healthChecker.stop();
  app.processTracker.stop();
  // ... wait-for-running-jobs loop (existing) ...
  await app.jobService.shutdown();
  await app.pool.shutdown();

  // Fastify close — fires plugin onClose hooks in reverse order:
  //   static -> api -> pipelines -> maestro -> hooks -> lifecycle -> jobs -> reporting
  //   -> artifacts -> websocket -> auth -> pool -> telemetry -> queue -> db
  //   -> correlation -> event-bus -> config
  //
  // Critical: queue.onClose (pg-boss stop) runs BEFORE db.onClose (pool.end)
  await app.close();
  app.log.info('All plugins closed');

  process.exit(0);
};
```

### Why this works

- `boss.stop({graceful: true, timeout: 30_000})` blocks until active workers drain OR 30 s, then resolves.
- `db.onClose` runs next (reverse order), closes `postgres.js` pool cleanly — safe because pg-boss no longer holds its own DB pool (it was closed by `boss.stop()`).
- v12.15 guarantees pending pg-boss maintenance completes before `stop()` returns, so we don't hit "db closed mid-maintenance" races.

### Spike #4 — Mac Mini drain timing

Measure on the dev machine:

```typescript
// scripts/spikes/shutdown-timing.ts
import { buildApp } from '../../server/index.js';
const app = await buildApp();
// Enqueue 50 jobs that sleep 5s each in-handler
for (let i = 0; i < 50; i++) await app.queue.send('demo.slow', { i });

const start = Date.now();
await app.close();
console.log(`close took ${Date.now() - start}ms`);
// Expect < 30_000ms if workers drain within limit;
// if > 30_000ms consistently, bump timeout or reduce per-queue concurrency
```

Record results in `.planning/phases/15-.../spikes/shutdown-timing.md` — decide whether to retune the 30 s number.

---

## 15. Spike Implementation Strategy

**Confidence: HIGH**.

### Spike inventory

| # | Spike | Can run | Recommended harness | Lives in |
|---|-------|---------|---------------------|----------|
| 1 | drizzle-zod JSONB round-trip on `jobs.metadata` | parallel | Vitest integration test (needs real Postgres) | `server/db/__tests__/jsonb-roundtrip.spec.ts` |
| 2 | pg-boss v12 auto-migration on fresh dev DB | parallel | Vitest integration test (needs real Postgres) | `server/queue/__tests__/migration.spec.ts` |
| 3 | Branded ID compile-fail proof | parallel (no DB) | `tsc --noEmit` on a compile-check file | `server/types/__tests__/ids.compile.ts` |
| 4 | Mac Mini graceful-shutdown timing | sequential (needs #2 done) | standalone tsx script, log to markdown | `scripts/spikes/shutdown-timing.ts` plus `.planning/.../spikes/shutdown-timing.md` |

### Parallel-safe ordering

```
Wave 0 (parallel):  #1 [JSONB], #2 [pg-boss migration], #3 [branded IDs]
Wave 1 (serial):    #4 [shutdown timing] — requires #2 green
```

### Why Vitest over standalone for #1 / #2

- They need to assert against live Postgres behaviour — Vitest already has the runner + mocking patterns the repo uses.
- Committing them as tests means regression protection after Phase 15 (a future drizzle-zod bump that regresses JSONB parsing fails CI).
- For `pg-boss` migration idempotence: two sequential `boss.start()` calls in one test file prove idempotency — cleaner as a test than a standalone script.

### #4 is a one-time measurement

It's a data-gathering spike, not a regression guard. Keep it as a script + a markdown write-up. Don't ship as a CI test — shutdown timing will vary across CI runners and is only meaningful on the Mac Mini target.

### DB availability for spikes

- Spikes #1 and #2 need a real Postgres. The repo already runs PostgreSQL via `createDb(app.config.database_url)`.
- Add `TEST_DATABASE_URL` env var (can point to a throwaway DB like `devicefarm_test`) and a `beforeAll` hook that creates a clean schema.
- Use `DROP SCHEMA CASCADE` helpers from `vitest.setup.ts` for isolation.

---

## 16. Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cross-request context propagation | Custom `Map<request, data>` or threaded `ctx` param | `@fastify/request-context` + `asyncLocalStorage` export | Node's `async_hooks` is battle-tested; the Fastify plugin handles lifecycle cleanup and exposes the raw ALS for off-request paths. |
| Background queue with retry/DLQ | `setTimeout`-based reschedule, in-memory retry counters | **pg-boss v12** | Durable across restarts, has `singletonKey`, `retryBackoff`, `onComplete` hook, and a published v12.15 guarantee that stop() drains maintenance. |
| Typed events over EventEmitter | Hand-rolled `strict-event-emitter-types` | Thin custom wrapper with overloaded `on<T>` + Zod parse-on-emit | We own the registry type; Zod validates runtime payloads. `strict-event-emitter-types` gives us only compile-time safety — we want both. |
| Runtime schema validation at boundaries | `typeof` / manual checks / custom parsers | **Zod 4** (`discriminatedUnion`, `looseObject`, `.brand<>`) | Zod is already a dep; v4 fixes most v3 DX issues; brand types give nominal typing for free. |
| DB row decoder types | Hand-typed interface matching columns | **drizzle-zod** `createSelectSchema` | Single source of truth: schema DSL -> Zod schema -> TS type. |
| Custom lint rules | Grep-based CI scripts, pre-commit greps | **eslint-plugin-local-rules** | Integrates with `npm run lint`, gets editor-inline feedback, uses AST (not regex — fewer false positives). |
| Correlation-ID log tagging | Pass `correlationId` through every fn signature | Pino `mixin` reading from ALS | Zero code churn at call sites; every log line gets it. |
| Scheduled jobs | `node-cron` (already a dep) | **pg-boss `schedule`** (Phase 18+ migrates) | pg-boss schedules survive restart, support `singletonKey`, and don't fight timezone DST like raw `node-cron`. |

---

## Common Pitfalls

### Pitfall 1: Emitting before `boss.start()`

**What goes wrong:** `boss.send('foo', {})` throws `PgBossNotStartedError` if called before `await boss.start()` completes.
**Prevention:** `queue` plugin's registration `await`s `boss.start()` before decorating — no handler code runs until `await app.register(queuePlugin)` finishes. Verify in an integration test that mounts the plugin.

### Pitfall 2: Assuming ALS propagates into `boss.work` handlers

**What goes wrong:** described at length in §3. Without the wrapper, worker-scoped log lines have no `correlationId`.
**Prevention:** route ALL worker registration through `fastify.queue.work(name, handler)` — never call `boss.work` directly. Lint-rule candidate for Phase 16+.

### Pitfall 3: JSONB key-order assertion fails

**What goes wrong:** a test asserts `JSON.stringify(row.metadata) === JSON.stringify(input)` and fails because Postgres rewrote key order.
**Prevention:** always use `expect(row.metadata).toEqual(input)` (deep equal). See §7.

### Pitfall 4: Zod 4 brand chaining loses brand

**What goes wrong:** `z.string().brand<'JobId'>().transform(v => v.toLowerCase())` may drop the brand on the output type.
**Prevention:** keep brand as the LAST call in the chain; validate-then-brand at the boundary, don't transform branded values.

### Pitfall 5: `drizzle-kit push` overwrites JSONB defaults unnecessarily

**What goes wrong:** drizzle-kit considers JSONB default key order significant, churns migrations even when no real change.
**Prevention:** for `events` table, don't set a JSONB default. `payload` is `notNull` — every row supplies it.

### Pitfall 6: pg-boss stricter queue-name charset in v12

**What goes wrong:** queue name with `/`, `:`, space, or uppercase fails `createQueue`.
**Prevention:** centralise names in `server/queue/names.ts` as constants matching `/^[a-z][a-z0-9._-]*$/`. Examples: `job.execute`, `webhook.deliver`, `recording.upload`, `cleanup.run`, `pipeline.trigger`, `lifecycle-compress-daily`.

### Pitfall 7: Pino `mixin` called thousands of times — don't do expensive work

**What goes wrong:** adding a DB query or crypto call in `mixin` blocks every log line.
**Prevention:** `mixin` only reads ALS `Map.get` calls — ~100 ns. Keep it that way.

### Pitfall 8: `fastify-plugin` caches module state — `vi.mock` ordering matters in tests

**What goes wrong:** Vitest auto-hoists `vi.mock` but not always in the right order for a plugin that depends on ALS context.
**Prevention:** in tests that exercise the queue wrapper, wrap test bodies in `asyncLocalStorage.run(new Map(), async () => { ... })` to simulate request scope.

---

## Code Examples (cross-referenced)

All verified patterns appear inline in §1 through §14. Consolidated pointer table:

| Pattern | Section |
|---------|---------|
| pg-boss Fastify plugin | §1 |
| `onRequest` hook with `X-Correlation-Id` | §2 |
| Cross-queue ALS wrapper | §3 |
| Typed bus with `on<T>` narrowing | §4 |
| Envelope + discriminated union + emit helper | §5 |
| `events` Drizzle table + row decoder | §6 |
| JSONB round-trip spike | §7 |
| Branded IDs + `@ts-expect-error` proof | §8 |
| Pino `mixin` reading ALS | §9 |
| Lint rules + flat config | §10 |
| Nyquist baseline capture script | §12 |
| Shutdown reshape | §14 |

---

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| `require('pg-boss')` default export | **v12 named export** `import { PgBoss } from 'pg-boss'` | Migration required — one line per file |
| Zod `.passthrough()` | Zod 4 `z.looseObject({...})` (alias) | Both work; prefer `looseObject` in new code |
| `c8` as Vitest coverage provider | `@vitest/coverage-v8` (bundled) | `c8` package unmaintained since v0.33.0 (~3 yrs) |
| Raw `AsyncLocalStorage` | `@fastify/request-context` v6 | Ergonomic wrapper; exposes raw ALS when needed |
| `typed-emitter` or `strict-event-emitter-types` | Thin in-repo wrapper with Zod-on-emit | We own schema registry; library-free ≤ 80 LOC |

Deprecated / avoid:
- `pg-boss` `onComplete` handler (deprecated in v11 in favor of bus events or checking job state directly).
- `drizzle-kit push` on schemas with JSONB defaults (diff-churn bug in beta.2; we avoid defaulting JSONB).
- `c8` standalone (use `@vitest/coverage-v8` instead).

---

## Open Questions

1. **drizzle-zod version pin for Zod 4**
   - What we know: drizzle-orm is on `^0.45.1` (stable); Zod is `^4.3.6`. Stable `drizzle-zod` had compat issues with Zod `>=3.24`.
   - What's unclear: whether the current `drizzle-zod` npm stable publishes Zod-4-compatible schemas, or whether we need `drizzle-orm@beta` + `drizzle-orm/zod`.
   - Recommendation: resolve during Wave 0 Spike #1 — if `createSelectSchema(events)` throws on Zod 4, fall back to hand-typed Zod row schema (it's only ~10 columns for `events`).

2. **ADR numbering — reserve ADR-002 for file-naming?**
   - What we know: CONTEXT.md says ADR-002 is file-naming (MOD-05 in Phase 16).
   - Recommendation: leave ADR-002 gap in Phase 15; Phase 16 authors it.

3. **Metrics instrumentation in `telemetry` plugin — scope now or defer?**
   - What we know: pillars list telemetry as "substrate"; CONTEXT defers Prometheus (OBS-03) to v2.
   - Recommendation: `telemetry` plugin in Phase 15 is a stub that installs the Pino mixin and decorates `fastify.telemetry` with `noop` helpers. Phase 19+ plug real metrics in if needed.

4. **Node 22.12 requirement for pg-boss v12**
   - What we know: pg-boss v12 requires Node 22.12+.
   - Recommendation: add Node-version check to `device-farm doctor` in Phase 15; ensure CI runners and Mac Mini are 22.12+. Document in ADR-001 Constraints section.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | **Vitest 4.0.18** (already installed) |
| Config file | `vitest.config.ts` (create in Phase 15 — none exists yet) |
| Quick run command | `npx vitest run <file>` |
| Full suite command | `npm test` (runs `vitest run`) |
| Coverage command | `npm test -- --coverage` (needs `@vitest/coverage-v8` install in Phase 15) |

### Phase Requirements -> Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SPEC-04 | drizzle-zod row decoder for `events`; JSONB round-trip on `jobs.metadata` | integration | `npx vitest run server/db/__tests__/jsonb-roundtrip.spec.ts` | ❌ Wave 0 |
| SPEC-05 | `z.discriminatedUnion('type', [...])` narrows subscriber payload | unit | `npx vitest run server/events/__tests__/envelope.spec.ts` | ❌ Wave 0 |
| SPEC-08 | Envelope accepts additive unknown fields (`.passthrough()` / `looseObject`) | unit | `npx vitest run server/events/__tests__/envelope.spec.ts -t "passthrough"` | ❌ Wave 0 |
| SPEC-09 | Branded IDs reject mixing at compile | typecheck | `npx tsc --noEmit -p tsconfig.json` (fails if `@ts-expect-error` comments are wrong) | ❌ Wave 0 |
| SPEC-10 | Envelope carries `v: 1` | unit | `npx vitest run server/events/__tests__/envelope.spec.ts -t "version literal"` | ❌ Wave 0 |
| EVENTS-01 | `bus.on<T>` narrows via registry | unit + typecheck | `npx vitest run server/bus/__tests__/typed-bus.spec.ts` + `tsc --noEmit` | ❌ Wave 0 |
| EVENTS-02 | Envelope shape at runtime | unit | `npx vitest run server/events/__tests__/envelope.spec.ts -t "envelope shape"` | ❌ Wave 0 |
| EVENTS-03 | Imperative event names fail lint | lint | `npx eslint eslint-local-rules/__tests__/fixtures/bad-name.ts --exit-on-error` (expects rule fires) | ❌ Wave 0 |
| EVENTS-04 | Thin payload convention (documented in ADR-001) | docs/manual | **manual-only** — reviewed in Phase 16 pilot; no automated runtime check in Phase 15 | N/A |
| EVENTS-05 | sync-vs-queue rule documented | docs | `test -f docs/adr/001-spec-driven-architecture.md && grep -q "sync bus = same request" docs/adr/001-spec-driven-architecture.md` | ❌ Wave 0 |
| EVENTS-08 | Direct `bus.emit` outside `events.ts` fails lint | lint | RuleTester test: `npx vitest run eslint-local-rules/__tests__/no-direct-bus-emit.test.js` | ❌ Wave 0 |
| QUEUE-01 | pg-boss plugin registers; `pgboss` schema isolated | integration | `npx vitest run server/queue/__tests__/migration.spec.ts` | ❌ Wave 0 |
| QUEUE-02 | Named queues accept only valid charset; Zod-validated payloads | integration | `npx vitest run server/queue/__tests__/names.spec.ts` | ❌ Wave 0 |
| QUEUE-04 | `retryLimit: 1` applied per callsite | unit | `npx vitest run server/queue/__tests__/retry-policy.spec.ts` | ❌ Wave 0 |
| QUEUE-07 | `boss.stop({graceful, timeout: 30_000})` fires on Fastify onClose | integration | `npx vitest run server/queue/__tests__/shutdown.spec.ts` | ❌ Wave 0 |
| MOD-07 | Pino child logger has `correlationId` binding via ALS mixin | integration | `npx vitest run server/telemetry/__tests__/pino-mixin.spec.ts` | ❌ Wave 0 |
| MOD-10 | `docs/adr/001-spec-driven-architecture.md` exists | fs | `test -f docs/adr/001-spec-driven-architecture.md` | ❌ Wave 0 |
| TRACE-01 | `onRequest` reads/generates `X-Correlation-Id`; echoes in response | integration | `npx vitest run server/correlation/__tests__/onrequest.spec.ts` | ❌ Wave 0 |
| TRACE-02 | `requestContext.get('correlationId')` works in downstream service | integration | `npx vitest run server/correlation/__tests__/als.spec.ts` | ❌ Wave 0 |
| TRACE-03 | Every pino log line inside a request has `correlationId` | integration (capture stdout) | `npx vitest run server/telemetry/__tests__/pino-mixin.spec.ts -t "log carries correlationId"` | ❌ Wave 0 |
| TRACE-04 | Envelope auto-reads correlationId from ALS on emit | unit | `npx vitest run server/events/__tests__/emit-helpers.spec.ts` | ❌ Wave 0 |
| TRACE-05 | `queue.send` -> `queue.work` round-trip preserves correlationId | integration | `npx vitest run server/queue/__tests__/als-crossqueue.spec.ts` | ❌ Wave 0 |
| TRACE-07 | `events` table exists with correct indexes | integration (introspect) | `npx vitest run server/db/__tests__/events-schema.spec.ts` | ❌ Wave 0 |
| TRACE-08 | Only `persisted: true` events land in `events` table | integration | `npx vitest run server/events/__tests__/persistence.spec.ts` | ❌ Wave 0 |
| TRACE-09 | Subscriber-triggered emit has `causationId` = parent `envelope.id` | integration | `npx vitest run server/events/__tests__/causation.spec.ts` | ❌ Wave 0 |
| DEBT-03 | Nyquist baseline committed to `.planning/nyquist-baseline.json` | fs + shape | `test -f .planning/nyquist-baseline.json && jq -e '.coverage.lines' .planning/nyquist-baseline.json` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `npx vitest run <file-touched>` (single file, <30 s)
- **Per wave merge:** `npm test` (full suite, target <5 min on Mac Mini)
- **Phase gate:** `npm test -- --coverage` green + `.planning/nyquist-baseline.json` exists + all phase-req files present; gsd verifier runs before `/gsd:verify-work`.

### Runtime Invariants and Their Tests

| Invariant | Assertion pattern |
|-----------|-------------------|
| `correlation_id` present on every `events` row after a business event fires | `SELECT COUNT(*) FROM events WHERE correlation_id IS NULL` = 0 — integration test inserts an event via bus, queries. |
| pg-boss auto-migration runs on empty DB | Drop `pgboss` schema -> `boss.start()` -> query `information_schema.tables WHERE table_schema = 'pgboss'` returns >=5 rows. Re-run `boss.start()` -> assert idempotent (same result). |
| Lint rule rejects imperative event names | RuleTester `invalid` array contains `"job.create"` -> fires `messageId: 'imperative'`. |
| 30 s graceful stop | integration test: enqueue N slow jobs, trigger `app.close()`, assert `Date.now() - start < 30_500`; for no-in-flight case assert `< 1_000`. |
| `currentEventId` in ALS propagates as `causationId` on nested emit | emit `A`, subscribe to `A` and emit `B` inside handler -> assert `B.causationId === A.id`. |

### Wave 0 Gaps (files to create before Wave 1 plumbing)

- [ ] `vitest.config.ts` (enable coverage reporter)
- [ ] `server/db/__tests__/jsonb-roundtrip.spec.ts` (SPEC-04 spike)
- [ ] `server/queue/__tests__/migration.spec.ts` (pg-boss spike)
- [ ] `server/types/__tests__/ids.compile.ts` (branded-ID compile-fail proof)
- [ ] `server/queue/__tests__/shutdown.spec.ts` (QUEUE-07 drain timing)
- [ ] `server/correlation/__tests__/onrequest.spec.ts` (TRACE-01/02)
- [ ] `server/correlation/__tests__/als.spec.ts` (ALS integration)
- [ ] `server/telemetry/__tests__/pino-mixin.spec.ts` (MOD-07 / TRACE-03)
- [ ] `server/events/__tests__/envelope.spec.ts` (SPEC-05/08/10, EVENTS-02)
- [ ] `server/events/__tests__/emit-helpers.spec.ts` (TRACE-04)
- [ ] `server/events/__tests__/persistence.spec.ts` (TRACE-08)
- [ ] `server/events/__tests__/causation.spec.ts` (TRACE-09)
- [ ] `server/bus/__tests__/typed-bus.spec.ts` (EVENTS-01)
- [ ] `server/queue/__tests__/names.spec.ts` (QUEUE-02 charset)
- [ ] `server/queue/__tests__/retry-policy.spec.ts` (QUEUE-04)
- [ ] `server/queue/__tests__/als-crossqueue.spec.ts` (TRACE-05)
- [ ] `server/db/__tests__/events-schema.spec.ts` (TRACE-07)
- [ ] `eslint-local-rules/__tests__/no-direct-bus-emit.test.js` (EVENTS-08)
- [ ] `eslint-local-rules/__tests__/no-imperative-event-names.test.js` (EVENTS-03)
- [ ] `vitest.setup.ts` (shared DB reset, ALS reset between tests)
- [ ] Framework install: `npm i -D @vitest/coverage-v8 eslint eslint-plugin-local-rules @typescript-eslint/parser @typescript-eslint/eslint-plugin`

*(None of these test files currently exist — Phase 15 creates them all in Wave 0.)*

---

## Sources

### Primary (HIGH confidence)
- [Fastify request-context README (official)](https://github.com/fastify/fastify-request-context/blob/main/README.md) — full v6 API, ALS export
- [Zod API docs — discriminated unions / brand](https://zod.dev/api) — v4 syntax
- [Drizzle ORM Postgres column types](https://orm.drizzle.team/docs/column-types/pg) — jsonb, timestamp, uuid
- [Drizzle ORM drizzle-zod docs](https://orm.drizzle.team/docs/zod) — createSelectSchema
- [PostgreSQL jsonb docs (§8.14)](https://www.postgresql.org/docs/current/datatype-json.html) — authoritative on key-order/duplicate key behavior
- [pg-boss v12.0.0 release notes](https://github.com/timgit/pg-boss/releases/tag/12.0.0) — ESM named-export breaking change
- [pg-boss v12.x releases](https://github.com/timgit/pg-boss/releases) — v12.15 pre-stop maintenance guarantee
- [pg-boss issue #421: graceful stop](https://github.com/timgit/pg-boss/issues/421) — `{graceful, timeout}` semantics
- [Nygard ADR template](https://github.com/joelparkerhenderson/architecture-decision-record/blob/main/locales/en/templates/decision-record-template-by-michael-nygard/index.md) — format
- [Vitest Coverage guide](https://vitest.dev/guide/coverage) — v8 provider, json-summary
- [eslint-plugin-local-rules README](https://github.com/cletusw/eslint-plugin-local-rules/blob/master/README.md) — rule shape
- [ESLint Custom Rules docs](https://eslint.org/docs/latest/extend/custom-rules) — meta/create, RuleTester

### Secondary (MEDIUM confidence, verified against primary)
- [unpkg pg-boss@12.15.0 docs](https://app.unpkg.com/pg-boss@12.15.0/files/docs/readme.md) — API surface summary (cross-checked with primary)
- [LogSnag pg-boss TS deep dive](https://logsnag.com/blog/deep-dive-into-background-jobs-with-pg-boss-and-typescript) — retry/backoff example shapes
- [LogRocket: Pino + AsyncLocalStorage](https://blog.logrocket.com/logging-with-pino-and-asynclocalstorage-in-node-js/) — mixin pattern
- [Fastify graceful shutdown discussion #5140](https://github.com/fastify/fastify/discussions/5140) — onClose reverse order
- [Medium: eslint-plugin-local-rules tutorial](https://medium.com/@ignatovich.dm/creating-and-using-custom-local-eslint-rules-with-eslint-plugin-local-rules-428d510db78f) — flat-config pattern

### Tertiary (LOW confidence — flagged for spike validation)
- drizzle-zod + Zod 4 compatibility: ambiguous across [issue #4249](https://github.com/drizzle-team/drizzle-orm/issues/4249) and [issue #4049](https://github.com/drizzle-team/drizzle-orm/issues/4049); **validate in Wave 0 Spike #1**.

---

## Metadata

**Confidence breakdown:**
- Standard stack (pg-boss v12, @fastify/request-context, Zod 4, Drizzle, Pino, Vitest): **HIGH** — all primary-source verified.
- Architecture (plugin order, ALS wrapper, envelope + bus): **HIGH** — derived from canonical TS patterns + CONTEXT.md locked decisions.
- Pitfalls (JSONB key order, v12 ESM rename, queue name charset, Zod brand chaining): **HIGH** — each backed by primary source.
- eslint-plugin-local-rules flat-config wiring: **MEDIUM** — README only documents legacy `.eslintrc`; ESLint 9 pattern backfilled from official docs.
- drizzle-zod + Zod 4 compat: **LOW** — mixed signals in GitHub issues; spike will resolve.
- Nyquist tooling: **MEDIUM** — confirmed GSD CLI has no `nyquist` sub-command; hand-compute script designed.

**Research date:** 2026-04-17
**Valid until:** 2026-05-17 (30 days — stable libraries; revisit if pg-boss v13 ships, drizzle-orm v1 GA, or Zod 5 lands)
