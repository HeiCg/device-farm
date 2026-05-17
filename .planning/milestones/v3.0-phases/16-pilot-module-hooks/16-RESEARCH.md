# Phase 16: Pilot Module — hooks — Research

**Researched:** 2026-04-17
**Domain:** Module-pattern pilot on `server/hooks/` — dep-cruiser guard, per-module event registry, bus→queue bridge, idempotency, tests-as-spec, ADR-002
**Confidence:** HIGH (all load-bearing APIs verified against local `node_modules/` source or Phase 15 code; pg-boss v12 `send()` null-on-duplicate-singletonKey verified from dist source)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Module structure & file naming (ADR-002):**
- `server/hooks/internal/**` is the explicit scope for dep-cruiser's deep-import denylist — everything under `internal/` is module-private by convention; anything re-exported by `index.ts` is public
- `schemas.ts` is the source of truth for `HookDefinition`; TypeScript types derive via `z.infer<typeof hookDefinitionSchema>` (SPEC-03)
- MODULE.md uses LLM-first structure — tight sections (Purpose / Public API / Events Emitted / Events Consumed / Queue Produced / Queue Consumed / Invariants / Non-Goals / Dependencies), ≤5 lines each, runnable example stub at end (MOD-09 full enforcement lands Phase 27)
- ADR-002 (repo-wide file-naming) commits in this phase: kebab-case filenames, singular for concepts (`schemas.ts`), plural for collectors (`handlers.ts`, `subscribers.ts`), colocated `__tests__/` directories, Nygard format

**Event design (EVENTS-06, EVENTS-09):**
- Four events published by the module:
  - `hook.scheduled` — fired when a bus trigger causes a queue enqueue (thin payload, not persisted)
  - `hook.completed` — terminal, persisted, emitted after successful execFile
  - `hook.failed` — transient, not persisted — emitted per failed attempt before retry
  - `hook.failed.retryExhausted` — terminal, persisted, emitted after pg-boss exhausts retries
- Events consumed by Phase 16: synthetic `test.trigger` demo event (stub) wired through bus→queue bridge. Real `device.*` / `job.*` consumers land Phase 20/21/23
- Thin payloads per EVENTS-04; terminal events extend with `{exitCode, durationMs, stderrTail}`
- `persisted: true` only on `hook.completed` + `hook.failed.retryExhausted` per TRACE-08

**Queue design (QUEUE-06) + idempotency:**
- Queue name `hook.run` — extends `QUEUE_NAMES` with `HOOK_RUN: 'hook.run'`
- `singletonKey = ${triggerEventId}:${hookName}`
- `retryLimit: 1`
- New `hook_runs` table with `operation_key TEXT PRIMARY KEY` + `hook_name`, `event_id`, `triggered_at`, `exit_code`, `duration_ms`, `status`; `INSERT ... ON CONFLICT DO NOTHING RETURNING operation_key`; no row returned = replay; skip execFile

**Tests-as-spec & migration:**
- 4 test files under `server/hooks/__tests__/`: `events.spec.ts`, `queue.spec.ts`, `hook-executor.spec.ts`, `module.spec.ts`
- 5 invariants (1 test each): (a) sequential per-event execution, (b) `failOnError: false` never throws, (c) idempotent replay, (d) `enabled: false` never runs, (e) platform filter excludes
- Factory `createHooksModule(deps: {db, bus, boss, logger, config}) → {executor, registerBusSubscribers(), shutdown()}`
- `HookExecutor.execute()` imperative API stays untouched for back-compat

### Claude's Discretion
- Exact shape of the `operationKey` derivation helper, the `hook_runs` table's non-PK columns, and whether to use Drizzle `.onConflictDoNothing()` vs raw SQL
- MODULE.md prose tone/length inside section caps
- Order of plans (ADR-002 first vs schema/queue/events first)
- Whether `registerBusSubscribers()` returns disposables or the factory's `shutdown()` owns teardown

### Deferred Ideas (OUT OF SCOPE)
- Wiring hooks onto real `device.booted` / `device.shutdown` / `job.starting` / `job.completed` — Phase 20/21/23
- MODULE.md runnable-example typecheck-in-CI — Phase 27 (MOD-09)
- Deleting `HookExecutor.execute()` imperative API — deferred until all call sites migrate
- DLQ endpoint — Phase 19 (QUEUE-05)
- Actor from auth context — Phase 26 (TRACE-10)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SPEC-01 | Schemas Zod colocated per module | §2 `schemas.ts` lift of existing `hookDefinitionSchema` from `server/hooks/plugin.ts:11`; §3 event payload schemas |
| SPEC-02 | Fastify routes use `.parse()`; decoders use `.safeParse()` with structured error | §2 — routes already use `.safeParse()` in existing plugin (lines 57, 89 of plugin.ts); keep that shape |
| SPEC-03 | TS types derive via `z.infer<...>` | §2 — `export type HookDefinition = z.infer<typeof hookDefinitionSchema>` replaces hand-written interface at `hook-executor.ts:30` |
| EVENTS-06 | Subscribers idempotent; `eventId + operationKey`; tested | §5 — `hook_runs.operation_key = ${triggerEventId}:${hookName}`; `ON CONFLICT DO NOTHING RETURNING` |
| EVENTS-09 | Bridge bus→queue documented as pattern | §4 — concrete `bus.on('test.trigger', envelope => boss.send('hook.run', {...}, {singletonKey}))` |
| MOD-01 | MODULE.md with fixed sections | §9 skeleton + LLM-first tight-section convention |
| MOD-02 | index.ts barrel + dependency-cruiser deep-import enforcement | §1 `.dependency-cruiser.cjs` two rules; §8 `index.ts` barrel surface |
| MOD-03 | events.ts with Zod schemas + emit helpers + constants | §3 `createEventHelpers(bus, persistEnvelope)` on `hooksRegistry` |
| MOD-05 | File naming kebab-case, singular/plural, ADR-002 | §9 ADR-002 skeleton; confirmed repo convention in CLAUDE.md |
| MOD-06 | Factory `createXModule(deps)` + thin plugin wrap | §10 `createHooksModule` signature + plugin refactor |
| MOD-08 | Invariants section + 1 test per invariant | §7 Vitest structure; 5 invariants locked in CONTEXT.md |
| QUEUE-06 | Module has colocated `queue.ts` | §4 `server/hooks/queue.ts` with `HOOK_RUN` name + worker registration |
</phase_requirements>

## Summary

Phase 16 is a refactor-and-substrate-extend pilot on the smallest real module. Every load-bearing API already exists in the Phase 15 substrate:
- `TypedBus<R>` + `createEventHelpers(bus, onEmit)` accept an arbitrary `EventRegistry` — `demoRegistry` was fixture-only, and the helpers generalize without code changes (§3).
- pg-boss v12 `send()` returns `null` when a duplicate `singletonKey` is rejected by the unique index on `(name, singleton_key)` where `state <= active` for the `singleton` / `stately` / `exclusive` policies, verified in `node_modules/pg-boss/dist/manager.js:509` and `node_modules/pg-boss/dist/migrationStore.js:109-113` (§4, §11).
- Drizzle `onConflictDoNothing({target: col}).returning()` emits `ON CONFLICT (col) DO NOTHING RETURNING ...` and returns `[]` on conflict-skipped insert; returns `[row]` on fresh insert. This is the cleanest idempotency primitive — one round trip, transactional (§5, §11).
- `dependency-cruiser` v17.3.10 supports module-boundary `forbidden` rules with `from.pathNot` / `to.path` regex pairs; works natively with TypeScript ESM `.js` specifiers via `tsConfig` + `enhancedResolveOptions` (§1).

The work is sequencing + concrete code, not discovery. The research focuses on code-shape specifics the planner will translate directly into tasks.

**Primary recommendation:** Sequence plans as: (1) ADR-002 + schemas/events lift (smallest surface, no runtime change), (2) `hook_runs` Drizzle migration + queue.ts worker with idempotency, (3) factory `createHooksModule` + plugin thin-wrap + bus→queue bridge, (4) `dependency-cruiser` config + CI wiring, (5) MODULE.md + tests-as-spec. Plans 1-2 can ship in parallel; 3 depends on 1+2; 4 can ship anytime after `internal/` directory exists; 5 requires 1-3 for the describe-tree-mirrors-MODULE.md contract.

## Standard Stack

### Core (already installed — verified in `package.json`)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `dependency-cruiser` | `^17.3.10` **(NEW — add as devDep)** | Module-boundary enforcement (MOD-02) | Regex-based `forbidden` rules, native TS ESM, CI-friendly exit codes. Latest stable per GitHub releases (2026-03-26). |
| `drizzle-orm` | `^0.45.1` | `hook_runs` table + `ON CONFLICT DO NOTHING RETURNING` | Already in use; `.onConflictDoNothing({target: ...}).returning()` is the canonical idempotency primitive (verified in `node_modules/drizzle-orm/pg-core/query-builders/insert.d.ts:138-141`) |
| `zod` | `^4.3.6` | `schemas.ts` source-of-truth for HookDefinition (SPEC-03) | Already canonical; `.default(...)` preserves defaults in `z.infer<...>` output type (verified: `z.object({platform: z.enum([...]).default('all')})` + `.parse({})` yields `{platform: 'all'}`) |
| `pg-boss` | `^12.15.0` | `hook.run` queue with singletonKey idempotency | Already in use; `singletonKey` with queue policy `singleton` (or default `standard`) produces null-on-duplicate behavior verified in `node_modules/pg-boss/dist/manager.js:509` |
| `vitest` | `^4.0.18` | tests-as-spec describe trees mirroring MODULE.md | Already in use; `describe.skipIf(!HAS_DB)` + `vi.waitFor(fn, {timeout})` both used extensively in Phase 15 queue specs |
| `@fastify/request-context` | `^6.2.1` | ALS correlationId + currentEventId threading | Already wired; subscribers inherit via bus plugin's `onPersisted` — nothing new to install |

**Installation:**
```bash
npm install --save-dev dependency-cruiser@^17.3.10
```

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `dependency-cruiser` | ESLint `no-restricted-imports` | ESLint rule is per-file pattern; `dependency-cruiser` analyses the full import graph and supports `from.pathNot` / `to.path` module-scope patterns natively. ESLint can't easily express "anything outside `server/hooks/` can't import `server/hooks/internal/**`" as a single rule. Stick with dep-cruiser. |
| Drizzle `.onConflictDoNothing({target}).returning()` | Raw SQL via `sql\`INSERT ... ON CONFLICT DO NOTHING RETURNING *\`` | Raw SQL is fine but loses type inference and duplicates the column list. Drizzle version is 1 line shorter and fully typed (§5). Use Drizzle. |
| pg-boss `singletonKey` | Application-level dedupe via `hook_runs` lookup before `boss.send` | The `singletonKey` check is atomic at the queue boundary; application-level dedupe has a TOCTOU window between the lookup and the send. Use singletonKey for at-most-one-enqueue AND use `hook_runs.operation_key` for at-most-one-execution. Both layers are needed: singletonKey prevents queue bloat on rapid replays; operation_key catches any race where two workers grab a job (pg-boss supports `localConcurrency > 1`). |

## Architecture Patterns

### Recommended `server/hooks/` Structure

```
server/hooks/
├── MODULE.md                      # LLM-first public contract (MOD-01)
├── index.ts                       # Barrel — only public API (MOD-02)
├── schemas.ts                     # Zod source-of-truth (SPEC-01, SPEC-03)
├── events.ts                      # 4-event registry + emit helpers (MOD-03)
├── queue.ts                       # HOOK_RUN worker + bus→queue bridge (QUEUE-06)
├── plugin.ts                      # Thin Fastify wrapper (MOD-06)
├── internal/                      # dep-cruiser denylist scope
│   ├── hook-executor.ts           # moved from server/hooks/hook-executor.ts
│   ├── idempotency.ts             # `hook_runs` insert + operation_key derivation
│   ├── subscribers.ts             # bus.on('test.trigger', ...) wire-up
│   └── module.ts                  # `createHooksModule(deps)` factory
└── __tests__/
    ├── events.spec.ts             # emit helpers + envelope stamping
    ├── queue.spec.ts              # HOOK_RUN worker + idempotency replay
    ├── hook-executor.spec.ts      # Public API (describe tree mirrors MODULE.md)
    └── module.spec.ts             # Factory + plugin decorator surface
```

**Rationale:** Everything re-exported by `index.ts` is public; everything under `internal/` is module-private. The dep-cruiser rule denies imports from outside `server/hooks/**` to `server/hooks/internal/**`. `plugin.ts` is at the module root (not in `internal/`) because Fastify's registration loader `server/index.ts` imports it directly — that's a legitimate external consumer.

### Pattern 1: Per-Module EventRegistry

**What:** Each module declares its own `EventRegistry` literal + `TypedBus<ownRegistry>` constructed inside the factory.
**When to use:** Every module from Phase 16 onward (this is the whole pilot).
**Example:**
```typescript
// server/hooks/events.ts
// Source: Phase 15 Plan 15-04 pattern (server/events/registry.ts + server/bus/helpers.ts)
import { z } from 'zod';
import type { EventRegistry } from '../bus/types.js';
import { TypedBus } from '../bus/index.js';
import { createEventHelpers } from '../bus/index.js';

export const hookScheduledPayload = z.object({
  hookName: z.string(),
  event: z.string(),
  deviceId: z.string().uuid().nullable(),
  jobId: z.string().uuid().nullable(),
});
export const hookCompletedPayload = hookScheduledPayload.extend({
  exitCode: z.number().int(),
  durationMs: z.number().int().nonnegative(),
  stderrTail: z.string(),
});
export const hookFailedPayload = hookCompletedPayload;  // same shape; different semantics
export const hookFailedRetryExhaustedPayload = hookCompletedPayload.extend({
  attempts: z.number().int().positive(),
});

export const hooksRegistry = {
  'hook.scheduled':              { schema: hookScheduledPayload,            persisted: false, aggregateType: 'hook' },
  'hook.completed':              { schema: hookCompletedPayload,            persisted: true,  aggregateType: 'hook' },
  'hook.failed':                 { schema: hookFailedPayload,               persisted: false, aggregateType: 'hook' },
  'hook.failed.retryExhausted':  { schema: hookFailedRetryExhaustedPayload, persisted: true,  aggregateType: 'hook' },
} as const satisfies EventRegistry;

export type HooksRegistry = typeof hooksRegistry;

// The factory constructs the bus; events.ts exports a *factory* for the helpers
// so the thin plugin can wire app.db → persistEnvelope without re-implementing
// the bus-plugin persistence middleware.
export function makeHookEmitters(bus: TypedBus<HooksRegistry>, onEmit?: (env: import('../events/envelope.js').Envelope) => void) {
  const emit = createEventHelpers(bus, onEmit);
  return {
    scheduled: emit('hook.scheduled'),
    completed: emit('hook.completed'),
    failed:    emit('hook.failed'),
    retryExhausted: emit('hook.failed.retryExhausted'),
  };
}
```

### Pattern 2: bus→queue Bridge

**What:** A `bus.on(type, envelope)` subscriber enqueues a durable pg-boss job with a stable `singletonKey` derived from the envelope's immutable `id`.
**When to use:** Every time a synchronous bus event needs to trigger work that retries, calls external, or survives crash (EVENTS-05, ADR-001 Pillar 3).
**Example:**
```typescript
// server/hooks/internal/subscribers.ts
// Uses onPersisted (envelope-aware) so we can derive singletonKey from envelope.id
// and so correlationId/causationId auto-propagate via the plugin's ALS wrapper.
export function wireBusToQueue(deps: {
  bus: import('../../bus/index.js').TypedBus<any>;
  onPersisted: import('fastify').FastifyInstance['onPersisted'];
  boss: import('pg-boss').PgBoss;
  hookExecutor: HookExecutor;   // to read registered hooks
  logger: pino.Logger;
}): () => void {
  // test.trigger is a synthetic demo event for Phase 16 — real device.*/job.* subs land in later phases.
  const unsubscribe = deps.onPersisted('test.trigger', async (envelope) => {
    const hooks = deps.hookExecutor.getHooksForEvent(envelope.payload.event as HookEvent);
    for (const hook of hooks) {
      // queue.send (plan 15-05 wrapper) reads correlationId/causationId from ALS automatically
      await deps.boss.send(
        QUEUE_NAMES.HOOK_RUN,
        { triggerEventId: envelope.id, hookName: hook.name, context: envelope.payload },
        { singletonKey: `${envelope.id}:${hook.name}`, retryLimit: 1 },
      );
      // emit hook.scheduled AFTER the send succeeds — EVENTS-04 thin payload
      deps.scheduled(envelope.aggregateId, { hookName: hook.name, event: envelope.payload.event, deviceId: null, jobId: null });
    }
  });
  return unsubscribe;
}
```

**Note on `app.queue.send` vs raw `boss.send`:** The Phase 15 queue wrapper (`app.queue.send`) injects correlationId/causationId/actor into `job.data` for ALS restoration on the worker. The bridge MUST use `app.queue.send` (not raw `boss.send`) so TRACE-05 still holds for hook workers. `boss.send` is used above only for API illustration of `singletonKey`; real code uses `deps.queue.send(name, payload, {singletonKey})`.

### Pattern 3: Idempotent Worker

**What:** Worker attempts `INSERT ... ON CONFLICT (operation_key) DO NOTHING RETURNING operation_key` inside a transaction; if zero rows returned, the replay is a duplicate — log + return.
**When to use:** Every pg-boss consumer whose handler has a physical side-effect (EVENTS-06).
**Example:**
```typescript
// server/hooks/queue.ts
// Source verified against drizzle-orm/pg-core/query-builders/insert.d.ts:138
export function registerHookRunWorker(deps: {
  boss: PgBoss;
  db: DrizzleDb;
  hookExecutor: HookExecutor;
  emit: ReturnType<typeof makeHookEmitters>;
  logger: pino.Logger;
}) {
  return deps.boss.work<HookRunPayload>(QUEUE_NAMES.HOOK_RUN, async (jobs) => {
    const job = Array.isArray(jobs) ? jobs[0] : jobs;
    const { triggerEventId, hookName, context } = job.data;
    const operationKey = `${triggerEventId}:${hookName}`;

    const started = Date.now();

    // Step 1 — claim the operation_key row atomically.
    // onConflictDoNothing + returning returns [] if the conflict skipped the insert
    // (verified: drizzle-team/drizzle-orm#2474 expected behavior).
    const [claim] = await deps.db
      .insert(hookRuns)
      .values({
        operationKey,
        hookName,
        eventId: triggerEventId,
        status: 'running',
      })
      .onConflictDoNothing({ target: hookRuns.operationKey })
      .returning({ operationKey: hookRuns.operationKey });

    if (!claim) {
      deps.logger.info({ operationKey }, 'Duplicate replay — skipping execFile');
      return;  // Invariant (c): exactly 1 visible side-effect per operation_key
    }

    // Step 2 — run the actual hook.
    try {
      const hook = deps.hookExecutor.getHooks().find(h => h.name === hookName);
      if (!hook) throw new Error(`Unknown hook: ${hookName}`);
      const [result] = await deps.hookExecutor.execute(hook.event, context);

      await deps.db.update(hookRuns).set({
        status: result.success ? 'completed' : 'failed',
        exitCode: result.exitCode,
        durationMs: result.durationMs,
      }).where(eq(hookRuns.operationKey, operationKey));

      // Emit terminal event. onPersisted subscribers see causationId=envelope.id (ALS thread).
      if (result.success) {
        deps.emit.completed(triggerEventId, {
          hookName, event: hook.event, deviceId: null, jobId: null,
          exitCode: result.exitCode ?? 0,
          durationMs: result.durationMs,
          stderrTail: result.stderr.slice(-1024),
        });
      } else {
        // Per-attempt failure — not the terminal retryExhausted (pg-boss decides that).
        deps.emit.failed(triggerEventId, { /* ... */ });
        throw new Error(result.error);  // triggers pg-boss retry path
      }
    } catch (err) {
      // update row to failed; pg-boss will retry until retryLimit then emit retryExhausted
      await deps.db.update(hookRuns).set({ status: 'failed', durationMs: Date.now() - started })
        .where(eq(hookRuns.operationKey, operationKey));
      throw err;  // propagate so pg-boss counts the attempt
    }
  });
}
```

**Critical sequence:** insert-claim happens BEFORE execFile. If we ran execFile first then recorded, a worker crash mid-execFile would re-run on retry without a duplicate signal. The insert-claim pattern guarantees: the row exists iff the side-effect started.

### Anti-Patterns to Avoid

- **Imperative `new HookExecutor(fastify.log as any)` inside the plugin:** Phase 15 established the factory pattern (`server/correlation`, `server/telemetry` use it). Phase 16 plugin MUST read `const hooks = createHooksModule({db, bus, boss, logger, config})` — the `logger as any` cast at current `server/hooks/plugin.ts:28` is a known smell that gets cleaned up.
- **Emitting bus events from inside the worker handler via `bus.emit` directly:** Would bypass the envelope / causationId / persistence middleware AND trip the `no-direct-bus-emit` lint rule. Always go through `emit.completed(aggregateId, payload)` helpers.
- **Deriving `operationKey` from anything that changes across retries:** e.g. `Date.now()` or `randomUUID()`. MUST be `${triggerEventId}:${hookName}` where `triggerEventId` is the bus envelope's immutable `id`. Any other derivation breaks replay-idempotency.
- **Making `singletonKey` the *only* idempotency layer:** pg-boss's unique index is per `(name, singleton_key)` WHERE `state <= active` — once a job moves to `completed` / `failed`, the index no longer blocks a re-send with the same key. The `hook_runs.operation_key` PK is the durable second layer.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Module-boundary enforcement | Custom ESLint rule walking the import graph | `dependency-cruiser` v17 | Already a mature graph analyser; ESLint rules can't easily express "X can't import Y unless caller path matches Z" across multiple files atomically |
| Idempotency table lookup-then-insert | `const existing = await db.select()...; if (!existing) await db.insert(...)` | `db.insert(...).onConflictDoNothing({target}).returning()` | TOCTOU: two workers both see "not existing" then both insert. Single-round-trip INSERT-ON-CONFLICT is atomic in Postgres |
| Bus→queue subscriber lifecycle | Manual `unsubscribe[]` arrays | Factory returns `shutdown()` that cleans up | Factory pattern already established; `createHooksModule` owns teardown |
| Zod → TS `HookDefinition` hand-sync | Hand-written `interface HookDefinition { ... }` at `hook-executor.ts:30` | `export type HookDefinition = z.infer<typeof hookDefinitionSchema>` | Currently duplicated — the interface at `hook-executor.ts:30` and the Zod schema at `plugin.ts:11` are parallel sources of truth. SPEC-03 demands one. |
| Testing describe-tree-matches-MODULE.md | Manual reviewer checklist | Manual reviewer checklist (recommendation: document, don't automate) | §7 — automating this is over-engineered for a one-module-per-phase pace. ADR-002 documents the convention; reviewers enforce. |

**Key insight:** Every "hand-roll temptation" for this phase has a proven alternative already in the codebase or standard library. The phase is prescriptive, not exploratory.

## Common Pitfalls

### Pitfall 1: pg-boss `singletonKey` silently returns `null`, not throws
**What goes wrong:** Second `boss.send(name, payload, {singletonKey: X})` while first is active returns `null`. Caller expecting a job ID sees `null` and may log an error or throw.
**Why it happens:** Verified in `node_modules/pg-boss/dist/manager.js:509` — `send()` returns `null` if `rows.length === 0` after `INSERT ... ON CONFLICT DO NOTHING`. Consistent with pg-boss GitHub issues #522, #548.
**How to avoid:** Treat `null` return from `queue.send(HOOK_RUN, ...)` as SUCCESS (duplicate detected at queue boundary). Log at DEBUG level. Emit `hook.scheduled` only on non-null return, OR emit always (the `hook_runs` operation_key layer catches it on the worker side).
**Warning signs:** Test the replay path explicitly — call `queue.send` twice with the same singletonKey in the spec and assert the second returns `null` (not a new jobId). This is the proof of QUEUE-06 correctness.

### Pitfall 2: Drizzle `onConflictDoNothing().returning()` returns `[]` on conflict (design, not bug)
**What goes wrong:** Worker reads `const [row] = await db.insert(...).onConflictDoNothing({target}).returning()`; `row` is `undefined`. Treating this as an error path fires a false alarm on replay.
**Why it happens:** Confirmed design per drizzle-team/drizzle-orm#2474 — when Postgres's `ON CONFLICT DO NOTHING` skips the insert, `RETURNING` has no row to return. Empty array is correct.
**How to avoid:** Always destructure-with-fallback: `if (!row) { /* replay path */ return; }`. This IS the idempotency signal — not an error.

### Pitfall 3: Dep-cruiser TypeScript ESM `.js` specifiers need `tsConfig` + `enhancedResolveOptions`
**What goes wrong:** Default dep-cruiser resolver sees `import { x } from './foo.js'` and looks for a literal `foo.js`; in TS NodeNext, the real file is `foo.ts`. Without config, dep-cruiser reports spurious "unresolvable" dependencies.
**Why it happens:** TypeScript ESM requires `.js` in import specifiers even though the source is `.ts` — dep-cruiser needs to be told via `tsConfig: { fileName: 'tsconfig.json' }` and `enhancedResolveOptions.conditionNames: ['import', 'node', 'default']`.
**How to avoid:** Copy the config block in §1 verbatim. Run `npx depcruise --validate server/` once; if it complains about `.js` resolution, the block is missing `enhancedResolveOptions`.

### Pitfall 4: `eslint-local-rules` `no-direct-bus-emit` allowlist already covers `server/hooks/events.ts`
**What goes wrong:** Emits from `server/hooks/events.ts` would falsely trip the rule.
**Why it happens:** The rule at `eslint-local-rules/no-direct-bus-emit.js:28` allowlists `/\/events\.ts$/` — a regex matching ANY path ending in `events.ts`. `server/hooks/events.ts` matches.
**How to avoid:** No action needed — the existing allowlist pattern works. Confirmed via code review. Only caveat: helper FILES inside `server/hooks/internal/` that call `emit.completed(...)` indirectly via returned functions are fine (the rule scans for `bus.emit` / `fastify.bus.emit` / `app.bus.emit` literal call expressions, not helper invocations).

### Pitfall 5: Zod 4 `.default(...)` preserves defaults through `z.infer` — verified
**What goes wrong:** Worry that lifting `hookDefinitionSchema` from `plugin.ts:11` (with its `.default('all')` / `.default(30_000)` / `.default(false)` / `.default(true)` calls) to `schemas.ts` + `type HookDefinition = z.infer<...>` would produce a type with `platform?: 'android' | 'ios' | 'all'` (optional), breaking downstream code that reads `hook.platform`.
**Why it happens:** Not a real pitfall — Zod 4 `z.infer` returns the OUTPUT type (post-parse), where defaults have been applied. Input type (pre-parse) has them optional; `z.infer` gives output.
**How to avoid:** Verified locally: `z.object({platform: z.enum(['android','ios','all']).default('all')}).parse({})` yields `{platform: 'all'}`. `z.infer` type has `platform: 'android' | 'ios' | 'all'` (required). No breakage. Lift with confidence.

### Pitfall 6: Plugin dependency order — keep `pool-plugin` in hooks deps
**What goes wrong:** Updating hooks-plugin deps from `['config', 'pool-plugin']` to `['config', 'event-bus', 'queue']` breaks `/api/hooks/:name/test` which reads `fastify.pool.getDevice(body.deviceId)` (see `server/hooks/plugin.ts:157`).
**Why it happens:** `pool-plugin` decorates `fastify.pool`; plugin-order invariant (`server/__tests__/plugin-order.spec.ts`) doesn't enforce hooks→pool, but the runtime dependency exists.
**How to avoid:** Target deps array: `['config', 'event-bus', 'queue', 'pool-plugin']`. Confirmed: the plugin-order spec at `server/__tests__/plugin-order.spec.ts:50` asserts `pool-plugin > telemetry` (hooks also registers after pool in server/index.ts at position 15). The 4-dep array keeps existing behaviour.

### Pitfall 7: ALS-worker-to-emit round trip — envelope vs payload subscriber shape
**What goes wrong:** The queue worker needs to know the bus `envelope.id` to construct `operationKey = ${triggerEventId}:${hookName}`. But pg-boss workers receive payload, not bus envelopes.
**Why it happens:** `boss.send(...)` carries arbitrary JSON — we decide what to include. The Phase 15 queue wrapper stamps correlationId/causationId/actor at the JSON boundary, but NOT the bus `envelope.id`. That's a Phase 16 addition to the job payload shape.
**How to avoid:** When constructing the bridge subscriber (§4 snippet), the payload schema for `hook.run` queue jobs MUST include `triggerEventId: envelope.id`. Validated at both producer (bridge) and consumer (worker) via Zod per QUEUE-02. See the `HookRunPayload` schema sketch in §5.

### Pitfall 8: pg-boss queue policy default is `standard` — singletonKey still works
**What goes wrong:** Worry that singletonKey requires a specific `policy` on `createQueue`.
**Why it happens:** Confused by pg-boss docs on `key_strict_fifo` which DOES require singletonKey.
**How to avoid:** Verified in `node_modules/pg-boss/dist/migrationStore.js:104` — the unique index `job_i4` (on `(name, singleton_on, COALESCE(singleton_key, ''))`) applies to EVERY policy except when `state = 'cancelled'`. Default `standard` policy honors singletonKey just fine. `createQueue(QUEUE_NAMES.HOOK_RUN, { retryLimit: 1, retryBackoff: true })` is sufficient — no explicit `policy: 'singleton'` needed. (Setting `policy: 'singleton'` would ADDITIONALLY block multiple queued jobs with NO key — we don't need that, the key is enough.)

## Code Examples

### §1 `.dependency-cruiser.cjs` — the two locked rules

```javascript
// /.dependency-cruiser.cjs
// Source: https://github.com/sverweij/dependency-cruiser v17.3.10 rules-reference.md
module.exports = {
  forbidden: [
    {
      name: 'no-deep-imports-into-hooks-internal',
      comment: 'Nothing outside server/hooks/** may reach into server/hooks/internal/**. ' +
               'Public API comes from server/hooks/index.ts barrel. Phase 16 ADR-002 + MOD-02.',
      severity: 'error',
      from: {
        pathNot: '^server/hooks/',
      },
      to: {
        path: '^server/hooks/internal/',
      },
    },
    {
      name: 'no-direct-bus-emit-outside-events-ts',
      comment: 'Runtime equivalent of the eslint-local-rules/no-direct-bus-emit rule. ' +
               'Kept here as a belt-and-suspenders graph-level guard. ' +
               'Allow: any events.ts, any spec file, bus internals.',
      severity: 'error',
      from: {
        pathNot: '(events\\.ts$|\\.spec\\.ts$|\\.test\\.ts$|server/bus/(bus|helpers|plugin)\\.ts$)',
      },
      to: {
        path: 'server/bus/bus\\.ts$',
        // Matches imports OF the TypedBus class. Not precise enough on its own —
        // the actual bus.emit() call-site guard is the ESLint rule. This dep-cruiser
        // rule adds coarse-grained "don't import the bus class from random places"
        // to catch a would-be bus-emitter before it even compiles.
      },
    },
  ],
  options: {
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    moduleSystems: ['es6', 'cjs'],
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'node', 'default'],
      mainFields: ['module', 'main', 'types'],
    },
    includeOnly: '^server/',
    doNotFollow: { path: 'node_modules' },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
```

**CI wiring (npm script):**
```json
// package.json add:
"scripts": {
  "dep-check": "depcruise --config .dependency-cruiser.cjs server/"
}
```

**Validation expectation:** On the current repo (before any `internal/` directory exists), `npm run dep-check` MUST exit 0. The rule only bites once `server/hooks/internal/` is created — its first violation (caused deliberately by a test-fixture deep-import) proves the rule fires.

**Fixture-based proof:** Recommend a `server/hooks/__tests__/dep-cruiser.fixture.ts` that IMPORTS from `server/hooks/internal/hook-executor.ts` directly, then a CI step that runs `npx depcruise --config .dependency-cruiser.cjs server/hooks/__tests__/dep-cruiser.fixture.ts` and asserts non-zero exit. (Alternative: a `dep-check:fixture-must-fail` script that grep's the output for `no-deep-imports-into-hooks-internal`.) This proves the rule is both installed AND firing correctly.

### §2 Drizzle `hook_runs` migration — schema + indexes

```typescript
// server/db/schema.ts — append AFTER the events table (lines 415-431):
export const hookRuns = pgTable('hook_runs', {
  operationKey: text('operation_key').primaryKey(),
  hookName: varchar('hook_name', { length: 255 }).notNull(),
  eventId: uuid('event_id').notNull(),
  triggeredAt: timestamp('triggered_at', { withTimezone: true }).notNull().defaultNow(),
  status: varchar('status', { length: 32 }).notNull().default('running'),  // running | completed | failed
  exitCode: integer('exit_code'),
  durationMs: integer('duration_ms'),
}, (table) => [
  index('hook_runs_hook_name_idx').on(table.hookName),
  index('hook_runs_event_id_idx').on(table.eventId),
  index('hook_runs_triggered_at_idx').on(table.triggeredAt),
]);
```

**Migration command (same as Phase 15 plan 15-01):**
```bash
npx drizzle-kit generate  # produces server/db/migrations/0001_add_hook_runs.sql
npx drizzle-kit push      # applies to dev DB (idempotent)
```

**Ordering:** `hook_runs` has no FK to `events` (the `event_id` column stores the bus envelope id, which may not yet be persisted when the hook runs). No FK, no ordering issue. Migration file number is `0001` (the existing one is `0000_add_events_table.sql`).

**Gotcha — TEXT PRIMARY KEY with drizzle-kit:** Verified with existing table `test_case_labels` (primary key on composite). `text('operation_key').primaryKey()` emits `"operation_key" text PRIMARY KEY NOT NULL` — PostgreSQL implicitly adds NOT NULL to PKs. No special handling needed. ON CONFLICT clause uses the column name: `onConflictDoNothing({target: hookRuns.operationKey})` → `ON CONFLICT (operation_key) DO NOTHING`.

### §3 `createEventHelpers` scales from Phase 15 demoRegistry to hooksRegistry

Phase 15 code review confirms the helper is **already generic**:

```typescript
// server/bus/helpers.ts:79-82 (verbatim from existing code):
export function createEventHelpers<R extends EventRegistry>(
  bus: TypedBus<R>,
  onEmit?: (envelope: Envelope) => void,
) {
  return <T extends keyof R & string>(type: T) =>
    (aggregateId: string, payload: PayloadOf<R, T>, opts: EmitOpts = {}): Envelope => { /* ... */ };
}
```

The factory accepts ANY registry. Phase 16 uses it unchanged:

```typescript
// In createHooksModule factory:
const hooksBus = new TypedBus(hooksRegistry);
const emit = createEventHelpers(hooksBus, persistEnvelope);  // persistEnvelope passed by factory, same middleware
```

**`fastify.emit` type question (open in prompt §3):** Recommend **do NOT widen `fastify.emit`'s type to a union**. The plugin.ts decorator from Phase 15 pinned `fastify.emit` to `DemoRegistry`; the demoRegistry is scheduled for retirement (RESEARCH Phase 15 Plan 15-04 comment: "DO NOT add real domain events here"). Phase 16 pattern:

- `fastify.hooksModule` decorator exposes `{executor, emit, registerBusSubscribers, shutdown}`.
- `fastify.emit` stays typed to `DemoRegistry` (deprecated, removed in Phase 20+ when `demoRegistry` goes).
- Real consumers call `fastify.hooksModule.emit.completed(...)` — no union widening, no breaking change to Phase 15 callers.

This matches ADR-001 Pillar 5: "factory `createXModule(deps)` consumed by a thin Fastify plugin that only wires (`fastify.decorate('x', createXModule({db, bus, boss, logger}))`)".

### §4 bus→queue bridge — concrete with ALS threading

The correlation-id threading is free because:
1. `onPersisted` handler runs inside the bus plugin's ALS wrapper (`server/bus/plugin.ts:120-141`) — `currentEventId` is in ALS when the handler fires.
2. `queue.send(...)` (Phase 15 wrapper, `server/queue/plugin.ts:122-137`) reads `correlationId` + `currentEventId` + `actor` from ALS and stuffs them into `job.data`.
3. `queue.work(...)` restores them on the worker fiber (`server/queue/plugin.ts:153-168`).

So the bridge handler does NOT need to manually read/pass correlation IDs:

```typescript
// server/hooks/internal/subscribers.ts — ONE-LINE ALS note:
const unsubscribe = fastify.onPersisted('test.trigger', async (envelope) => {
  // correlationId/causationId/actor already in ALS via onPersisted wrapper.
  // fastify.queue.send() will auto-inject them into pg-boss job.data.
  await fastify.queue.send(QUEUE_NAMES.HOOK_RUN, {
    triggerEventId: envelope.id,          // immutable — singletonKey uses this
    hookName,
    context: envelope.payload,
  }, { singletonKey: `${envelope.id}:${hookName}`, retryLimit: 1 });
  // Emit hook.scheduled AFTER send; envelope.id becomes causationId on this emit via ALS.
  fastify.hooksModule.emit.scheduled(envelope.aggregateId, { hookName, event: ..., deviceId: null, jobId: null });
});
// Factory's shutdown() calls unsubscribe.
```

### §5 Idempotency handler — full Drizzle snippet

Already shown in Pattern 3 above. Drizzle signatures verified in `node_modules/drizzle-orm/pg-core/query-builders/insert.d.ts:138-141`:
```typescript
onConflictDoNothing(config?: {
  target?: IndexColumn | IndexColumn[];
  where?: SQL;
}): PgInsertWithout<this, TDynamic, 'onConflictDoNothing' | 'onConflictDoUpdate'>;
```
`.returning()` on this returns `[]` on conflict-skipped inserts (confirmed behavior — see drizzle-team/drizzle-orm#2474).

**Transaction note:** The snippet in §Pattern 3 does NOT use `db.transaction(async tx => ...)`. Reason: `INSERT ... ON CONFLICT DO NOTHING RETURNING` + the subsequent `UPDATE` don't need ACID bundling — if the worker crashes between insert and update, pg-boss retries; on retry, the insert conflicts (no-op), the row stays in `status: 'running'`, the update still fires. No dirty state. If stricter audit semantics are wanted later (never leave `status: 'running'` dangling), wrap in a transaction — but not required for this phase.

### §6 ESLint rule allowlist — no change needed

Verified in `eslint-local-rules/no-direct-bus-emit.js:28`:
```javascript
const ALLOW = [
  /\/events\.ts$/,          // <-- this matches server/hooks/events.ts
  /\.(spec|test)\.ts$/,
  /\/bus\/bus\.ts$/,
  /\/bus\/helpers\.ts$/,
  /\/bus\/plugin\.ts$/,
];
```

`server/hooks/events.ts` matches `/\/events\.ts$/` exactly. No rule edit for Phase 16. The existing pair (no-imperative + no-direct) already covers the new module surface.

### §7 Vitest structure — tests-as-spec

**Automation of "describe tree matches MODULE.md Public API":** Recommend **manual reviewer gate**, not automation. Rationale:
- Parsing MODULE.md → extracting Public API → extracting describe-block structure from spec files adds 2 tools (MD parser + AST walker) and maintenance burden for marginal value.
- Phase 16 is one module; reviewer eyes catch divergence trivially. When pattern scales (Phase 20+), revisit.
- ADR-002 documents the convention; future `/gsd:verify-work` prompt can include "describe tree mirrors MODULE.md Public API section" as a checklist item.

**Coverage delta check (hooks-scoped):** The existing `scripts/check-nyquist.mjs` reads `coverage/coverage-summary.json` and diffs `total.lines.pct` against baseline. It does NOT support per-path slicing. However, `coverage/coverage-summary.json` (produced by `@vitest/coverage-v8`) contains per-file entries keyed by path. For Phase 16's "hooks/ delta ≤ −2pp" check, two options:

- **Option A (simple):** Reuse the existing global check. The total-line delta captures any regression. Since Phase 16 only adds new code under `server/hooks/`, the global delta naturally reflects the hooks delta.
- **Option B (precise):** Extend `check-nyquist.mjs` with a `--scope server/hooks/` flag that filters `coverage-summary.json` keys by prefix and averages. Defer to Phase 20 when multiple modules are refactored in parallel.

Recommend Option A for Phase 16 — it's what the existing tooling supports; overhead not justified for a single-module phase.

**Vitest test skeleton — all 4 files:**
```typescript
// server/hooks/__tests__/hook-executor.spec.ts
// describe tree mirrors MODULE.md Public API sections verbatim.
describe('HookExecutor', () => {
  describe('setHooks / addHook / removeHook', () => { /* CRUD */ });
  describe('getHooksForEvent', () => {
    it('[Invariant e] excludes wrong-platform hooks', () => { /* ... */ });
    it('[Invariant d] excludes enabled: false hooks', () => { /* ... */ });
  });
  describe('execute', () => {
    it('[Invariant a] runs hooks sequentially per event', async () => { /* ... */ });
    it('[Invariant b] failOnError: false never throws', async () => { /* ... */ });
  });
});

// server/hooks/__tests__/queue.spec.ts — DB-gated via TEST_DATABASE_URL
describe.skipIf(!HAS_DB)('hook.run queue worker', () => {
  it('[Invariant c] duplicate replay produces exactly 1 execFile call', async () => {
    // Send twice with same singletonKey; assert hook_runs has 1 row; assert execFileSpy called once.
  });
  it('emits hook.failed.retryExhausted after pg-boss exhausts retries', async () => { /* ... */ });
});

// server/hooks/__tests__/events.spec.ts
describe('hook emit helpers', () => {
  it('stamps envelope with correlationId from ALS', () => { /* uses createEventHelpers */ });
  it('marks hook.completed as persisted', () => { /* asserts registry entry */ });
});

// server/hooks/__tests__/module.spec.ts
describe('createHooksModule factory', () => {
  it('returns {executor, registerBusSubscribers, shutdown}', () => { /* ... */ });
  it('shutdown() disposes bus subscribers + worker', async () => { /* ... */ });
});
```

### §8 Plugin dependency array update

Current (at `server/hooks/plugin.ts:192-195`):
```typescript
export default fp(hooksPlugin, {
  name: 'hooks-plugin',
  dependencies: ['config', 'pool-plugin'],
});
```

Target:
```typescript
export default fp(hooksPlugin, {
  name: 'hooks-plugin',
  dependencies: ['config', 'event-bus', 'queue', 'pool-plugin'],
});
```

**Verification:** Plugin names verified via grep:
- `server/bus/plugin.ts:150` → `{ name: 'event-bus', dependencies: ['db', 'correlation'] }`
- `server/queue/plugin.ts:202` → `{ name: 'queue', dependencies: ['db', 'correlation'] }`
- `server/pool/plugin.ts:47` → `{ name: 'pool-plugin', dependencies: ['config'] }`

Registration order in `server/index.ts` is `config → correlation → db → event-bus → queue → telemetry → pool → ... → hooks (#15) → maestro → ...` — all four hooks-plugin deps register before hooks. Invariant spec `server/__tests__/plugin-order.spec.ts` doesn't explicitly assert this order but the fastify-plugin dependency resolver will throw at boot if deps are missing/misordered. Expected: spec remains green after the change.

### §9 ADR-002 skeleton

**Recommend committing at `docs/adr/002-file-naming.md` (ADR README reserves 002 per `docs/adr/README.md:20`). Format:**

```markdown
# ADR-002: Repo-wide File-Naming Convention

## Status
Accepted — 2026-04-17. Supersedes nothing; establishes convention referenced by ADR-001 Pillar 5.

## Context
ADR-001 locked the v3.0 module shape (`MODULE.md`, `index.ts` barrel, `events.ts`, `queue.ts`, `schemas.ts`, factory `createXModule(deps)`). As Phase 16 pilots the pattern on `server/hooks/` and Phases 20–30 replicate it across every server module, the file-naming rule MUST be locked now — otherwise each module adopts its own spelling (`hookDefinition.ts` vs `hook-definition.ts` vs `HookDefinition.ts`) and LLM agents can't read the tree without walking every directory.

The rule needs to cover: casing (kebab vs camel vs Pascal), singular vs plural, co-location of tests, reserved module filenames, and `.spec.ts` vs sibling-folder conventions.

## Decision

### Casing
- **Filenames** are `kebab-case`: `hook-executor.ts`, not `hookExecutor.ts` or `HookExecutor.ts`.
- **Exports from inside** filenames use whatever TS convention applies (Pascal for classes/types, camel for values).

### Singular vs Plural
- **Singular for concepts** (one thing the file describes): `schemas.ts`, `envelope.ts`, `hook-executor.ts`.
  - Exception: `schemas.ts` is plural by historical convention (the file hosts multiple Zod schemas). This is the ONLY plural "concept" file. Everything else follows singular-for-concepts.
- **Plural for collectors** (the file aggregates multiple instances of a thing): `handlers.ts`, `subscribers.ts`, `migrations/`.

### Reserved Module Filenames
Within any `server/<module>/` directory, the following filenames have reserved meaning:
- `index.ts` — barrel. Exports only the public API. Deep imports into the module from outside `server/<module>/` forbidden by `dependency-cruiser`.
- `MODULE.md` — LLM-first contract. Fixed sections per MOD-01.
- `events.ts` — Zod schemas + emit helpers + event-name constants. The ONLY legitimate caller of `bus.emit(...)` (enforced by ESLint `no-direct-bus-emit`).
- `queue.ts` — pg-boss queue(s) the module produces or consumes.
- `schemas.ts` — Zod source of truth for the module's public types.
- `plugin.ts` — Fastify plugin thin wrapper (factory output + decorate + onClose).

### Test Co-location
- **Colocated `__tests__/` directories**, not sibling `.test.ts` / `.spec.ts` files: `server/hooks/__tests__/hook-executor.spec.ts`, not `server/hooks/hook-executor.spec.ts`.
- Extension is `.spec.ts` (matches existing `server/bus/__tests__/`, `server/queue/__tests__/`, etc.).
- Test files may aggregate by behavior (e.g., `events.spec.ts` covers the module's event emission surface) — they don't need 1:1 correspondence with source files (MOD-04, enforced Phase 30).

### Module-Private Code
- Code the module doesn't re-export from `index.ts` lives under `server/<module>/internal/`.
- The `internal/` directory name is the `dependency-cruiser` denylist scope (Phase 16 onward).

## Consequences

### Positive
- LLM agents can navigate the tree by filename alone (`MODULE.md` always the contract, `events.ts` always the emit surface, etc.).
- Deep-import violations fail CI before review.
- Refactors don't require directory-walks to find "where does this module define its events?"

### Negative
- One-time rename cost per existing module during its refactor phase (the old `hooks-plugin` becomes `hooks/plugin.ts` — naming constant; internal file `hook-executor.ts` moves to `internal/hook-executor.ts`).
- `schemas.ts` is the one plural-named concept file; deviates from the "singular for concepts" rule. Accepted cost for historical clarity.

### Out of Scope
- Directory structure BEYOND the reserved filenames — modules may create `helpers/`, `adapters/`, etc. under `internal/` at their discretion.
- Typescript symbol naming (class vs interface vs type casing) — governed by TS convention + existing `@typescript-eslint` config.

### References
- ADR-001: v3.0 Spec-Driven + Event-Driven Architecture (Pillar 5 — LLM-first modules)
- MOD-01 through MOD-06 in `.planning/REQUIREMENTS.md`
```

### §10 Factory signature + plugin thin-wrap

```typescript
// server/hooks/internal/module.ts
export interface HooksModule {
  executor: HookExecutor;
  emit: ReturnType<typeof makeHookEmitters>;
  registerBusSubscribers: () => () => void;  // returns unsubscribe
  shutdown: () => Promise<void>;
}

export function createHooksModule(deps: {
  db: DrizzleDb;
  bus: TypedBus<HooksRegistry>;          // caller provides — usually constructed inside factory
  boss: PgBoss;
  logger: pino.Logger;
  config: HooksConfig;
  onPersisted: FastifyInstance['onPersisted'];
  queueSend: FastifyInstance['queue']['send'];  // ALS-aware wrapper from Phase 15
  persistEnvelope: (env: Envelope) => void;     // from bus plugin
}): HooksModule {
  const logger = deps.logger.child({ module: 'hooks' });  // MOD-07
  const executor = new HookExecutor(logger);
  if (deps.config.hooks) {
    executor.setHooks(deps.config.hooks);
  }
  const emit = makeHookEmitters(deps.bus, deps.persistEnvelope);
  let unsubscribeBus: (() => void) | null = null;
  let workerStopId: string | null = null;  // returned by boss.work()

  return {
    executor, emit,
    registerBusSubscribers: () => {
      unsubscribeBus = deps.onPersisted('test.trigger', /* ... */);
      return unsubscribeBus;
    },
    shutdown: async () => {
      if (unsubscribeBus) unsubscribeBus();
      if (workerStopId) await deps.boss.offWork(workerStopId);
    },
  };
}
```

**Child-logger pattern confirmed viable:** `new HookExecutor(logger)` calls `this.logger = logger.child({component: 'hook-executor'})` at `hook-executor.ts:75`. Passing `deps.logger` (already a pino child via `logger.child({module: 'hooks'})`) into `HookExecutor` produces a grandchild binding `{module: 'hooks', component: 'hook-executor'}`. pino binding merging is well-defined; no fallback to `fastify.log` required.

**Plugin thin-wrap target:**
```typescript
// server/hooks/plugin.ts (NEW shape)
async function hooksPlugin(fastify: FastifyInstance) {
  const bus = new TypedBus(hooksRegistry);
  // Reuse the persistence middleware from the main bus plugin via onPersisted indirection.
  // fastify.emit (from Phase 15) remains DemoRegistry-typed; we don't touch it.
  const module = createHooksModule({
    db: fastify.db,
    bus,
    boss: fastify.boss,
    logger: fastify.log as unknown as pino.Logger,
    config: fastify.config,
    onPersisted: fastify.onPersisted,
    queueSend: fastify.queue.send,
    persistEnvelope: /* pulled from bus plugin or re-implemented */,
  });
  fastify.decorate('hooksModule', module);
  registerHookRunWorker({ boss: fastify.boss, db: fastify.db, hookExecutor: module.executor, emit: module.emit, logger: fastify.log });
  module.registerBusSubscribers();
  // Routes (GET/POST/PUT/DELETE /api/hooks, POST /api/hooks/:name/test) — unchanged from current plugin.ts
  // ... route definitions here ...
  fastify.addHook('onClose', () => module.shutdown());
}
```

**`persistEnvelope` sharing open question:** Two options:
- (a) Export `persistEnvelope` from `server/bus/plugin.ts` as a factory-helper returning a function that closes over `fastify.db`. Requires a Phase 15 surface addition.
- (b) Have hooksModule's factory construct its own persistEnvelope from `deps.db` — duplicates 10 lines of code from bus/plugin.ts but keeps Phase 15 surface closed.

Recommend **(b)** — keep Phase 15 frozen; duplicate 10 lines; Phase 27+ can consolidate if a generic "per-module bus factory" helper proves useful across 3+ modules.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `HookExecutor` constructed imperatively in plugin with `fastify.log as any` cast | `createHooksModule({db, bus, boss, logger, config})` factory; plugin thin-wraps | Phase 16 | MOD-06 compliance; `logger as any` smell eliminated |
| Zod schema in `plugin.ts` + parallel `interface` in `hook-executor.ts` | Single source of truth in `schemas.ts`; types derive via `z.infer<...>` | Phase 16 | SPEC-03 compliance; one place to update when schema evolves |
| Imperative `hookExecutor.execute('device.booted', ctx)` call at `server/index.ts:127-139` | Co-exists with bus→queue bridge (imperative path unchanged for Phase 16) | Phase 20+ migration | Back-compat preserved; imperative API deleted when external callers migrate |
| No `dependency-cruiser` in CI | `.dependency-cruiser.cjs` + `npm run dep-check` step | Phase 16 | MOD-02 compliance; deep-import violations fail CI |
| ESLint-only guardrails for bus.emit | ESLint + dep-cruiser (belt-and-suspenders) | Phase 16 | Second layer catches would-be violations before compile |

**Deprecated/outdated:**
- `demoRegistry` (from Phase 15 Plan 15-04) remains ONLY until the last module phase migrates. It's actively used by plan 15-04's specs; deleting it pre-Phase-30 would break those specs. Phase 16 doesn't touch it.

## Open Questions

1. **`persistEnvelope` code sharing between bus/plugin.ts and hooks/plugin.ts**
   - What we know: Phase 15 bus/plugin.ts has the persist middleware inlined (lines 80-112 of `server/bus/plugin.ts`); it fires-and-forgets a `db.insert(eventsTable).values(...)` with error logging.
   - What's unclear: Whether to export the helper or duplicate 10 lines.
   - Recommendation: Duplicate. Revisit at Phase 27 when 3+ modules exercise the pattern.

2. **`queue.ts` vs `internal/queue.ts` file location**
   - What we know: CONTEXT.md says `queue.ts` colocated at module root (QUEUE-06 + MOD-05 + ADR-002 reserved filename). The actual WORKER-REGISTRATION logic is module-private though.
   - What's unclear: Does the queue.ts at module root just export `QUEUE_NAMES.HOOK_RUN` constant + schema, with the worker registration living in `internal/queue-worker.ts`?
   - Recommendation: **`server/hooks/queue.ts` hosts: (a) payload Zod schema for HOOK_RUN jobs, (b) the `QUEUE_NAMES.HOOK_RUN` re-export for barrel convenience, (c) `registerHookRunWorker(deps)` factory.** It's all "queue contract." The worker handler itself (the long function) is `internal/hook-run-handler.ts` — queue.ts just wires. This matches QUEUE-06 spirit (colocated queue contracts) while keeping the handler body module-private.

3. **Synthetic `test.trigger` event — where is it registered?**
   - What we know: CONTEXT.md calls out a `test.trigger` demo event for Phase 16 bridge exercise. It must be in SOME registry.
   - What's unclear: Is it in the hooks registry (weird — hooks doesn't publish it) or in a new tests-only registry?
   - Recommendation: **Register `test.trigger` inside `server/hooks/__tests__/fixtures/test-registry.ts`** — test-only, not in production code. The bridge subscriber wires against it ONLY during tests; in production, the bridge is idle until real `device.*`/`job.*` events wire in Phase 20+. This avoids polluting the hooks registry with a fixture event.

4. **Coverage delta — global or hooks-scoped?**
   - What we know: `scripts/check-nyquist.mjs` currently checks global lines delta only.
   - What's unclear: Phase 16 success criterion says "coverage delta on `hooks/` ≤ −2pp." Does this mean hooks-scoped or global?
   - Recommendation: Treat as GLOBAL delta for this phase (matches existing tooling). If reviewer pushes back, extend `check-nyquist.mjs` with a `--scope` flag — estimated 20 lines of code, trivial.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.0.18 (workspace-wide) |
| Config file | `vitest.config.ts` — confirmed present at repo root via `npm test` script invocation |
| Coverage provider | `@vitest/coverage-v8` 4.1.4 |
| Quick run command | `npx vitest run server/hooks/` |
| Full suite command | `npm test` (runs all server specs) |
| Coverage command | `npm run test:coverage` |
| Nyquist check | `npm run nyquist:check` (requires `test:coverage` output) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| SPEC-01 | `schemas.ts` is single Zod source of truth for HookDefinition | unit | `npx vitest run server/hooks/__tests__/events.spec.ts -t "hookDefinitionSchema"` | ❌ Wave 0 |
| SPEC-02 | Routes use `.parse()` / `.safeParse()` with structured errors | integration | Existing routes preserved; `npx vitest run server/hooks/__tests__/hook-executor.spec.ts` covers CRUD path via `app.inject()` | ❌ Wave 0 |
| SPEC-03 | TS types derive via `z.infer<...>` | compile | `tsc --noEmit` passes AFTER `type HookDefinition = z.infer<typeof hookDefinitionSchema>` replaces the hand-written interface | existing (typecheck script) |
| EVENTS-06 | Idempotent replay — same `eventId + operationKey` yields 1 side-effect | integration (DB) | `npx vitest run server/hooks/__tests__/queue.spec.ts -t "duplicate replay"` — requires `TEST_DATABASE_URL` | ❌ Wave 0 |
| EVENTS-09 | bus→queue bridge pattern | integration (DB) | `npx vitest run server/hooks/__tests__/queue.spec.ts -t "bus.on.*test.trigger.*boss.send"` | ❌ Wave 0 |
| MOD-01 | MODULE.md has fixed sections | manual-only | Reviewer checklist: all 9 sections present | ❌ Wave 0 |
| MOD-02 | `index.ts` barrel + dep-cruiser rule | integration | `npm run dep-check` exit 0 on clean tree; manual fixture proves rule fires on violation | ❌ Wave 0 |
| MOD-03 | `events.ts` has Zod schemas + emit helpers + name constants | unit | `npx vitest run server/hooks/__tests__/events.spec.ts` | ❌ Wave 0 |
| MOD-05 | File naming follows ADR-002 | manual-only | ADR-002 committed; reviewer confirms module follows convention | ❌ Wave 0 |
| MOD-06 | Factory + thin plugin wrap | integration | `npx vitest run server/hooks/__tests__/module.spec.ts` — asserts factory return shape + plugin decorator | ❌ Wave 0 |
| MOD-08 | 5 invariants, 1 test each | unit/integration mix | 5 tests across `hook-executor.spec.ts` + `queue.spec.ts`, tagged `[Invariant a]`..`[Invariant e]` | ❌ Wave 0 |
| QUEUE-06 | `queue.ts` colocated | integration (DB) | `npx vitest run server/hooks/__tests__/queue.spec.ts` — imports from `server/hooks/queue.ts` asserts `HOOK_RUN` registered | ❌ Wave 0 |

**Note:** "Existing" rows use existing tooling (`npm run typecheck`, `npm run dep-check` after config lands). "Wave 0" rows need new spec files in `server/hooks/__tests__/`.

### Sampling Rate

- **Per task commit:** `npx vitest run server/hooks/` — fast feedback loop (< 10s on laptop)
- **Per wave merge:** `npm test` + `npm run lint` + `npm run dep-check` + `npm run typecheck`
- **Phase gate:** `npm run nyquist:capture` → review delta vs baseline (must stay within −2pp of 48.29% lines); `npm test` all green; `npm run dep-check` all green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `server/hooks/__tests__/events.spec.ts` — covers SPEC-01, MOD-03 (NEW)
- [ ] `server/hooks/__tests__/queue.spec.ts` — covers EVENTS-06, EVENTS-09, QUEUE-06, Invariant (c) (NEW, DB-gated)
- [ ] `server/hooks/__tests__/hook-executor.spec.ts` — covers Invariants (a), (b), (d), (e); describe tree mirrors MODULE.md Public API (NEW)
- [ ] `server/hooks/__tests__/module.spec.ts` — covers MOD-06 factory + thin plugin (NEW)
- [ ] `server/hooks/__tests__/fixtures/test-registry.ts` — synthetic `test.trigger` demo-event registry for bridge tests (NEW)
- [ ] `.dependency-cruiser.cjs` at repo root (NEW)
- [ ] `package.json` `dep-check` script (NEW)
- [ ] `dependency-cruiser` devDependency install (NEW)
- [ ] `server/db/migrations/0001_add_hook_runs.sql` — generated via `npx drizzle-kit generate` after schema.ts update (NEW)
- [ ] `docs/adr/002-file-naming.md` (NEW)

No framework install needed — Vitest, drizzle-kit, ESLint, TypeScript all already wired.

## Sources

### Primary (HIGH confidence — verified against local source)

- `node_modules/pg-boss/dist/manager.js:509` — `send()` returns `null` when `rows.length === 0` after `ON CONFLICT DO NOTHING` (singletonKey duplicate-send behavior)
- `node_modules/pg-boss/dist/migrationStore.js:104-113` — unique index `job_i4` on `(name, singleton_on, COALESCE(singleton_key, ''))` applies to all policies
- `node_modules/pg-boss/dist/types.d.ts:141-151` — `JobOptions.singletonKey` type
- `node_modules/drizzle-orm/pg-core/query-builders/insert.d.ts:138-141` — `onConflictDoNothing({target})` signature
- `server/bus/helpers.ts:79-114` — `createEventHelpers` is already generic over `EventRegistry`
- `server/bus/plugin.ts:74-150` — bus plugin persistEnvelope + onPersisted ALS wrapper
- `server/queue/plugin.ts:122-170` — queue wrapper ALS serialization + restore
- `server/correlation/plugin.ts:22-56` — request-context store shape (object, not Map)
- `server/hooks/hook-executor.ts:30-45` — existing `HookDefinition` interface (to be replaced by `z.infer`)
- `server/hooks/plugin.ts:11-19` — existing `hookDefinitionSchema` (to be lifted to `schemas.ts`)
- `eslint-local-rules/no-direct-bus-emit.js:27-33` — existing allowlist (matches `events.ts`)
- `server/__tests__/plugin-order.spec.ts` — plugin-order invariant (unchanged by this phase)
- `docs/adr/README.md:20` — ADR-002 slot reserved for Phase 16 file-naming
- `package.json` — current dev dependencies and scripts

### Secondary (MEDIUM confidence — official docs, cross-verified)

- dependency-cruiser v17 rules-reference and options-reference (GitHub main branch, fetched 2026-04-17) — forbidden rule shape + `enhancedResolveOptions` for TS ESM
- Drizzle ORM docs (`orm.drizzle.team/docs/insert`) — `.onConflictDoNothing()` behavior
- GitHub issue drizzle-team/drizzle-orm#2474 — confirms empty array return on conflict-skipped `.returning()`
- pg-boss GitHub issues #522 / #548 — singletonKey duplicate-send semantics

### Tertiary (LOW confidence)

None. Every critical claim verified against local source or official docs.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all versions in local `package.json`; dependency-cruiser install command trivial
- Architecture: HIGH — all load-bearing APIs (TypedBus, createEventHelpers, queue.send wrapper, onPersisted) verified in local code; Phase 15 patterns directly applicable
- Pitfalls: HIGH — pg-boss `null` return verified in dist source; Drizzle `[]` return verified via GitHub issue; Zod 4 `.default()` verified via local Node REPL check
- Validation Architecture: HIGH — all tooling already in `package.json` / `scripts/`

**Research date:** 2026-04-17
**Valid until:** 2026-05-17 (30 days — stack is stable; Phase 15 locked all substrate pieces)
