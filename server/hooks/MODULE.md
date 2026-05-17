# Hooks Module

## Purpose

Run user-defined shell commands at device and test lifecycle points. Each registered `HookDefinition` is triggered by a specific `HookEvent` (`device.booted`, `device.shutdown`, `test.before`, `test.after`) and executed inside a timeout with `{{variable}}` template interpolation. Durable retry-safe execution flows through the `hook.run` pg-boss queue; idempotency is guaranteed by the `hook_runs.operation_key` primary-key claim.

## Public API

Exports from `server/hooks/index.ts` (the ONLY legitimate import surface outside this module — enforced by `dependency-cruiser`):

- `hooksPlugin` — Fastify plugin (thin wrapper around `createHooksModule`).
- `createHooksModule(deps): HooksModule` — factory returning `{executor, emit, bus, registerBusSubscribers, shutdown}`.
- `HookExecutor` class — imperative surface: `setHooks`, `addHook`, `removeHook`, `getHooks`, `getHooksForEvent`, `execute(event, context)`.
- `hookDefinitionSchema` + `HookDefinition` + `HookEvent` types — Zod source-of-truth (SPEC-03).
- `hooksRegistry`, `HOOK_EVENT_NAMES`, `makeHookEmitters` — per-module event registry + typed emit helpers.
- `HOOK_RUN_QUEUE_NAME`, `hookRunPayloadSchema`, `registerHookRunWorker` — queue contract.

HTTP routes (registered by the plugin): `GET|POST /api/hooks`, `PUT|DELETE /api/hooks/:name`, `POST /api/hooks/:name/test`.

## Events Emitted

- `hook.scheduled` — thin, NOT persisted. Fired after a bus trigger enqueues a `hook.run` job.
- `hook.completed` — terminal, persisted. Fired after a successful hook execution.
- `hook.failed` — transient, NOT persisted. Fired per failed attempt before pg-boss retries.
- `hook.failed.retryExhausted` — terminal, persisted. Fired after pg-boss exhausts the configured retries.

All four events carry aggregate `'hook'`. Terminal payloads extend `{exitCode, durationMs, stderrTail}`.

## Events Consumed

Phase 16 scope:
- `test.trigger` (test-fixture event, declared in `__tests__/fixtures/test-registry.ts`) — exercises the bus→queue bridge pattern.

Deferred to later phases:
- `device.booted` / `device.shutdown` (Phase 20 pool module)
- `job.starting` / `job.completed` (Phase 23 jobs keystone + Phase 21 artifacts)

## Queue Produced

- `hook.run` (from `server/hooks/queue.ts`)
  - `singletonKey: ${triggerEventId}:${hookName}` — stable across replays.
  - `retryLimit: 1` — hook commands are physical side-effects.
  - Payload shape: `{triggerEventId: uuid, hookName: string, context: HookContext}` (validated by `hookRunPayloadSchema`).

## Queue Consumed

None. The hooks module only produces. Its own `hook.run` queue is consumed by the worker registered in `registerHookRunWorker` (self-loop: producer and consumer live in the same module).

## Invariants

Every invariant below has exactly one test (MOD-08):

- **(a) Sequential per-event execution** — `HookExecutor.execute(event, ctx)` runs hooks in registration order, awaiting each before starting the next. Test: `__tests__/hook-executor.spec.ts` (`[Invariant a]`).
- **(b) `failOnError: false` never throws** — A failing hook with `failOnError: false` returns a `HookResult` with `success: false` but does not propagate. Test: `__tests__/hook-executor.spec.ts` (`[Invariant b]`).
- **(c) Idempotent replay** — Replaying a bus trigger with identical `(triggerEventId, hookName)` produces exactly 1 `hook_runs` row and exactly 1 hook invocation. Test: `__tests__/queue.spec.ts` (`[Invariant c]`).
- **(d) `enabled: false` never runs** — Hooks with `enabled: false` are filtered out at the executor level. Test: `__tests__/hook-executor.spec.ts` (`[Invariant d]`).
- **(e) Platform filter excludes** — Hooks with `platform: 'android'` do not run against iOS contexts (and vice versa); `platform: 'all'` always matches. Test: `__tests__/hook-executor.spec.ts` (`[Invariant e]`).

## Non-Goals

- **Concurrent hook execution.** Sequential-per-event is the invariant; parallelism at the hook level is not supported.
- **Cross-module coupling.** The module does not subscribe to real `device.*` / `job.*` events in Phase 16; those subscriptions land with Phases 20/21/23.
- **DLQ endpoint.** Dead-letter queue surfacing is Phase 19 (QUEUE-05); `hook.failed.retryExhausted` events will feed that pipeline without code change here.
- **Actor population from auth context.** `envelope.actor` carries `'system'` or `'anonymous'` until Phase 26 (TRACE-10) wires the auth ALS context.

## Dependencies

- `config` — reads `fastify.config.hooks` to preload `HookDefinition[]`.
- `event-bus` — consumes `fastify.onPersisted` for bus subscriptions; reuses `TypedBus` + `createEventHelpers` primitives.
- `queue` — produces `hook.run` jobs via `fastify.queue.send`; worker registered via `fastify.queue.work`.
- `pool-plugin` — `POST /api/hooks/:name/test` reads `fastify.pool.getDevice(body.deviceId)`.
- `db` (transitive via `event-bus` and `queue`) — writes `hook_runs` rows and `events` rows (terminal events only).

---

### Runnable Example

```typescript
// Inside a Fastify plugin that has already registered event-bus + queue + hooks:
import { HOOK_RUN_QUEUE_NAME } from 'server/hooks/index.js';

// Enqueue a hook.run job directly (bypassing the bus) — example of the queue contract:
const jobId = await app.queue.send(HOOK_RUN_QUEUE_NAME, {
  triggerEventId: envelope.id,
  hookName: 'post-boot-smoke-test',
  context: { deviceId, emulatorId, serial, platform: 'android', port: 5554 },
}, { singletonKey: `${envelope.id}:post-boot-smoke-test`, retryLimit: 1 });

// Listen for the terminal hook.completed event (requires the hooks module's private bus —
// access via app.hooksModule.bus.on for now; Phase 27+ may consolidate into a global bus):
app.hooksModule.bus.on('hook.completed', (payload) => {
  app.log.info({ hookName: payload.hookName, durationMs: payload.durationMs }, 'Hook ran');
});
```

Phase 27 (MOD-09) will add CI-level typechecking of this example snippet. For Phase 16, reviewer spot-checks the block.
