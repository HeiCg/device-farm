/**
 * Phase 16 / Plan 16-02 — createHooksModule factory spec.
 *
 * Asserts MOD-06 factory shape + shutdown idempotency. Does NOT require a database —
 * stubs fastify.boss (offWork), fastify.queue (send, work), fastify.onPersisted, and
 * fastify.db. The queue.spec.ts (plan 16-01) is the integration proof; this spec is
 * the unit-level contract check.
 */
import { describe, it, expect, vi } from 'vitest';
import type pino from 'pino';

import { createHooksModule } from '../internal/module.js';

function makeStubFastify() {
  const offWork = vi.fn().mockResolvedValue(undefined);
  const send = vi.fn().mockResolvedValue('fake-job-id');
  const work = vi.fn().mockResolvedValue('fake-worker-id');
  const createQueue = vi.fn().mockResolvedValue(undefined);
  const onPersisted = vi.fn().mockReturnValue(() => {});
  const logger = {
    child: vi.fn().mockReturnThis(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as unknown as pino.Logger;
  return {
    fastify: {
      boss: { offWork, createQueue },
      queue: { send, work },
      onPersisted,
      log: logger,
      db: {
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            onConflictDoNothing: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    offWork,
    send,
    work,
    onPersisted,
    logger,
  };
}

describe('createHooksModule (Phase 16-02)', () => {
  it('[MOD-06] returns {executor, emit, bus, registerBusSubscribers, shutdown}', () => {
    const { fastify, logger } = makeStubFastify();
    const m = createHooksModule({ fastify, db: fastify.db, logger });
    expect(m).toHaveProperty('executor');
    expect(m).toHaveProperty('emit');
    expect(m).toHaveProperty('bus');
    expect(typeof m.registerBusSubscribers).toBe('function');
    expect(typeof m.shutdown).toBe('function');
  });

  it('loads hooks from deps.hooks into the executor', () => {
    const { fastify, logger } = makeStubFastify();
    const m = createHooksModule({
      fastify,
      db: fastify.db,
      logger,
      hooks: [
        {
          name: 'h1',
          event: 'device.booted',
          command: 'echo',
          platform: 'all',
          timeoutMs: 30_000,
          failOnError: false,
          enabled: true,
        },
      ],
    });
    expect(m.executor.getHooks()).toHaveLength(1);
    expect(m.executor.getHooks()[0].name).toBe('h1');
  });

  it('shutdown() is idempotent — calling twice does not throw', async () => {
    const { fastify, logger } = makeStubFastify();
    const m = createHooksModule({ fastify, db: fastify.db, logger });
    await expect(m.shutdown()).resolves.toBeUndefined();
    await expect(m.shutdown()).resolves.toBeUndefined();
  });

  it('shutdown() calls boss.offWork(workerId) after registerBusSubscribers()', async () => {
    const { fastify, offWork, logger } = makeStubFastify();
    const m = createHooksModule({ fastify, db: fastify.db, logger });
    await m.registerBusSubscribers();
    await m.shutdown();
    expect(offWork).toHaveBeenCalledTimes(1);
    expect(offWork).toHaveBeenCalledWith('fake-worker-id');
  });
});
