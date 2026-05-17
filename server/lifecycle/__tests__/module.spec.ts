/**
 * Phase 18 / Plan 18-03 — createLifecycleModule factory spec (MOD-06 shape + shutdown idempotency).
 *
 * Asserts MOD-06 factory shape + shutdown idempotency. Does NOT require a database —
 * stubs fastify.boss (offWork, createQueue), fastify.queue (schedule, work), fastify.db,
 * and mocks ../queue.js so the factory's registerSchedulesAndWorkers invocation returns
 * a fixed worker-id list without actually touching pg-boss.
 *
 * The DB-gated integration proofs (registration actually succeeds against pg-boss, schedules
 * fire, correlationId propagates) live in queue.spec.ts + correlation.spec.ts + graceful-shutdown.spec.ts.
 * This spec is the unit-level contract check — fast, no DB.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type pino from 'pino';

// Mock the queue module BEFORE importing the factory so registerLifecycleSchedulesAndWorkers
// returns a fixed 3-worker-id list.
vi.mock('../queue.js', () => ({
  registerLifecycleSchedulesAndWorkers: vi.fn().mockResolvedValue({
    workerIds: ['worker-compress', 'worker-retention', 'worker-disk'],
  }),
}));

import { createLifecycleModule } from '../internal/module.js';

function makeStubFastify() {
  const offWork = vi.fn().mockResolvedValue(undefined);
  const createQueue = vi.fn().mockResolvedValue(undefined);
  const send = vi.fn().mockResolvedValue('fake-job-id');
  const work = vi.fn().mockResolvedValue('fake-worker-id');
  const schedule = vi.fn().mockResolvedValue(undefined);
  const logger = {
    child: vi.fn().mockReturnThis(),
    info:  vi.fn(),
    warn:  vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as unknown as pino.Logger;

  const fastify = {
    boss: { offWork, createQueue },
    queue: { send, work, schedule },
    log:  logger,
    db:   {
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockResolvedValue(undefined),
      }),
    } as never,
    config: { storage: { artifacts: {} } } as never,
  };

  return { fastify, offWork, logger };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createLifecycleModule (Phase 18-03)', () => {
  it('[MOD-06] returns {stats, emit, bus, registerSchedulesAndWorkers, shutdown}', () => {
    const { fastify, logger } = makeStubFastify();
    const m = createLifecycleModule({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fastify: fastify as any,
      db: fastify.db,
      config: fastify.config,
      logger,
    });
    expect(m).toHaveProperty('stats');
    expect(m).toHaveProperty('emit');
    expect(m).toHaveProperty('bus');
    expect(typeof m.registerSchedulesAndWorkers).toBe('function');
    expect(typeof m.shutdown).toBe('function');
  });

  it('stats initialised with 3 nulls matching LifecycleStats interface', () => {
    const { fastify, logger } = makeStubFastify();
    const m = createLifecycleModule({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fastify: fastify as any,
      db: fastify.db,
      config: fastify.config,
      logger,
    });
    expect(m.stats.lastCompressionRun).toBeNull();
    expect(m.stats.lastRetentionRun).toBeNull();
    expect(m.stats.lastDiskCheck).toBeNull();
  });

  it('shutdown() is idempotent — calling twice does not throw', async () => {
    const { fastify, logger } = makeStubFastify();
    const m = createLifecycleModule({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fastify: fastify as any,
      db: fastify.db,
      config: fastify.config,
      logger,
    });
    await expect(m.shutdown()).resolves.toBeUndefined();
    await expect(m.shutdown()).resolves.toBeUndefined();
  });

  it('shutdown() calls boss.offWork for each registered worker id', async () => {
    const { fastify, offWork, logger } = makeStubFastify();
    const m = createLifecycleModule({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fastify: fastify as any,
      db: fastify.db,
      config: fastify.config,
      logger,
    });
    await m.registerSchedulesAndWorkers();
    await m.shutdown();
    expect(offWork).toHaveBeenCalledTimes(3);
    expect(offWork).toHaveBeenCalledWith('worker-compress');
    expect(offWork).toHaveBeenCalledWith('worker-retention');
    expect(offWork).toHaveBeenCalledWith('worker-disk');
  });
});
