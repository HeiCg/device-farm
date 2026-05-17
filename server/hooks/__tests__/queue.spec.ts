/**
 * Phase 16 / Plan 16-01 — HOOK_RUN worker spec.
 *
 * DB-gated integration spec proving:
 *   [Invariant c]  — duplicate replay produces exactly 1 hook_runs row AND exactly 1
 *                    hook invocation (HookExecutor.executeOne spied to prove the
 *                    side-effect count). EVENTS-06 proof at the hooks module boundary.
 *   [EVENTS-09]    — bus→queue bridge pattern: a subscriber on a synthetic `test.trigger`
 *                    event translates into `queue.send('hook.run', ..., {singletonKey})`,
 *                    reaches the worker, and executes the hook exactly once end-to-end.
 *
 * Gated on TEST_DATABASE_URL — skipped with a console warning when no DB is configured.
 * The spec creates a throwaway pg-boss schema per file (pgboss_hooks_queue_spec) and
 * applies Drizzle migrations to the target DB via drizzle-kit push in CI (the spec
 * itself assumes hook_runs already exists).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import { correlationPlugin } from '../../correlation/index.js';
import busPlugin from '../../bus/plugin.js';
import queuePlugin from '../../queue/plugin.js';
import { QUEUE_NAMES } from '../../queue/names.js';
import { hookRuns } from '../../db/schema.js';
import { TypedBus } from '../../bus/bus.js';
import { HookExecutor } from '../hook-executor.js';
import { hooksRegistry, makeHookEmitters } from '../events.js';
import { testRegistry } from './fixtures/test-registry.js';
import { registerHookRunWorker } from '../queue.js';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const HAS_DB = typeof TEST_DATABASE_URL === 'string' && TEST_DATABASE_URL.length > 0;
const SCHEMA = 'pgboss_hooks_queue_spec';

if (!HAS_DB) {
  // eslint-disable-next-line no-console
  console.warn('[hooks/queue.spec] SKIPPED: set TEST_DATABASE_URL to run');
}

describe.skipIf(!HAS_DB)('hook.run queue worker (Phase 16-01)', () => {
  let app: FastifyInstance;
  let client: ReturnType<typeof postgres>;
  const cleanupOperationKeys: string[] = [];

  beforeAll(async () => {
    // Isolate pg-boss schema per spec to avoid cross-file contention.
    client = postgres(TEST_DATABASE_URL!);
    await client.unsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);

    const db = drizzle(client);

    const liveDbPlugin = fp(
      async (fastify: FastifyInstance) => {
        fastify.decorate('db', db as unknown as FastifyInstance['db']);
      },
      { name: 'db' },
    );

    app = Fastify({ logger: false });
    await app.register(makeStubConfigPlugin(TEST_DATABASE_URL!));
    await app.register(liveDbPlugin);
    await app.register(correlationPlugin);
    await app.register(busPlugin);
    await app.register(queuePlugin, { schema: SCHEMA });
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    // Clean up any leftover hook_runs rows we tracked — avoids test-to-test leakage
    // if re-run without DROP. pg-boss schema is dropped separately.
    if (cleanupOperationKeys.length > 0 && client) {
      for (const key of cleanupOperationKeys) {
        await client`DELETE FROM hook_runs WHERE operation_key = ${key}`.catch(() => { /* ignore */ });
      }
    }
    await client?.unsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`).catch(() => { /* ignore */ });
    await client?.end();
  });

  afterEach(async () => {
    if (cleanupOperationKeys.length > 0) {
      for (const key of cleanupOperationKeys) {
        await client`DELETE FROM hook_runs WHERE operation_key = ${key}`.catch(() => { /* ignore */ });
      }
      cleanupOperationKeys.length = 0;
    }
  });

  it('[Invariant c] duplicate replay produces exactly 1 hook_runs row and 1 hook invocation', async () => {
    const triggerEventId = randomUUID();
    const hookName = 'echo-idempotent';
    const operationKey = `${triggerEventId}:${hookName}`;
    cleanupOperationKeys.push(operationKey);

    const executor = new HookExecutor(app.log as never);
    executor.setHooks([{
      name: hookName,
      event: 'device.booted',
      command: 'echo IDEMPOTENT',
      platform: 'all',
      timeoutMs: 30_000,
      failOnError: false,
      enabled: true,
    }]);

    // Spy on the PRIVATE executeOne method (server/hooks/hook-executor.ts:147 — verified).
    // executor.execute() batches results; executeOne fires ONCE per physical shell exec.
    // Counting executeOne calls is the direct Invariant (c) proof: if a regression
    // re-executes the hook body on replay, this count exceeds 1 even when hook_runs
    // row count remains 1 (e.g. transaction rollback post-exec). See plan Task 1.3.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const execSpy = vi.spyOn(executor as any, 'executeOne');

    const hooksBus = new TypedBus(hooksRegistry);
    const emit = makeHookEmitters(hooksBus, () => { /* no-op onEmit */ });

    const workerId = await registerHookRunWorker({
      fastify: app,
      db: app.db as never,
      executor,
      emit,
      logger: app.log as never,
    });

    const payload = {
      triggerEventId,
      hookName,
      context: {
        deviceId: randomUUID(),
        emulatorId: 'emu-1',
        serial: 'emulator-5554',
        platform: 'android' as const,
        port: 5554,
        jobId: 'test-job',
      },
    };

    // Per pg-boss v12 singletonKey semantics (RESEARCH §Pitfall 1): the first send
    // returns a job id; the second returns null because the unique index
    // (name, singleton_key) WHERE state <= active blocks the duplicate.
    const job1 = await app.queue.send(QUEUE_NAMES.HOOK_RUN, payload, { singletonKey: operationKey, retryLimit: 1 });
    const job2 = await app.queue.send(QUEUE_NAMES.HOOK_RUN, payload, { singletonKey: operationKey, retryLimit: 1 });

    expect(job1).toBeTruthy();
    expect(job2).toBeNull();

    const db = drizzle(client);
    await vi.waitFor(async () => {
      const rows = await db.select().from(hookRuns).where(eq(hookRuns.operationKey, operationKey));
      expect(rows.length).toBe(1);
      expect(rows[0].status).toBe('completed');
    }, { timeout: 5_000 });

    expect(execSpy).toHaveBeenCalledTimes(1);

    await app.boss.offWork(QUEUE_NAMES.HOOK_RUN, { id: workerId });
  });

  it('[EVENTS-09] bus.on(test.trigger) handler enqueues hook.run via singletonKey', async () => {
    const triggerEventId = randomUUID();
    const hookName = 'bridge-hook';
    const operationKey = `${triggerEventId}:${hookName}`;
    cleanupOperationKeys.push(operationKey);

    const testBus = new TypedBus(testRegistry);

    const executor = new HookExecutor(app.log as never);
    executor.setHooks([{
      name: hookName,
      event: 'device.booted',
      command: 'echo BRIDGE',
      platform: 'all',
      timeoutMs: 30_000,
      failOnError: false,
      enabled: true,
    }]);

    const hooksBus = new TypedBus(hooksRegistry);
    const emit = makeHookEmitters(hooksBus, () => { /* no-op */ });

    const workerId = await registerHookRunWorker({
      fastify: app,
      db: app.db as never,
      executor,
      emit,
      logger: app.log as never,
    });

    // Bridge subscriber — the canonical EVENTS-09 pattern: a bus handler translates
    // an in-process event into a durable pg-boss job scoped by a stable singletonKey
    // derived from the triggering envelope's id.
    testBus.on('test.trigger', async () => {
      await app.queue.send(QUEUE_NAMES.HOOK_RUN, {
        triggerEventId,
        hookName,
        context: {
          deviceId: randomUUID(),
          emulatorId: 'emu-1',
          serial: 'emulator-5554',
          platform: 'android' as const,
          port: 5554,
        },
      }, { singletonKey: operationKey, retryLimit: 1 });
    });

    testBus.emit('test.trigger', { event: 'device.booted', deviceId: null, jobId: null });

    const db = drizzle(client);
    await vi.waitFor(async () => {
      const rows = await db.select().from(hookRuns).where(eq(hookRuns.operationKey, operationKey));
      expect(rows.length).toBe(1);
    }, { timeout: 5_000 });

    await app.boss.offWork(QUEUE_NAMES.HOOK_RUN, { id: workerId });
  });
});

// Local stub config plugin — queue plugin needs `fastify.config.database_url`.
// Duplicated from server/queue/__tests__/test-helpers.ts to avoid a deep import
// across module boundaries (the hooks module must not depend on queue/__tests__).
function makeStubConfigPlugin(databaseUrl: string) {
  return fp(async (fastify: FastifyInstance) => {
    fastify.decorate('config', { database_url: databaseUrl } as never);
  }, { name: 'config' });
}
