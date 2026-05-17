/**
 * Phase 23 Plan 23-04 — module.spec mock-based factory tests (no DB).
 *
 * Asserts createJobsModule shape + drain admission + idempotent shutdown.
 * DB-gated subscriber/correlation/idempotency proofs live in Plans 23-04
 * (idempotency.spec extension) + 23-06 (subscriber.spec, correlation.spec).
 */
import { describe, it, expect, vi } from 'vitest';
import { createJobsModule } from '../internal/module.js';

interface MockLogger {
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
  debug: ReturnType<typeof vi.fn>;
  child: () => MockLogger;
}

function makeMockLogger(): MockLogger {
  const log: MockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: () => log,
  };
  return log;
}

function makeMockFastify(opts: { drainRow?: unknown[] } = {}) {
  const drainRow = opts.drainRow ?? [];

  const dbSelectMock = vi.fn(() => ({
    from: () => ({
      where: () => ({
        limit: vi.fn().mockResolvedValue(drainRow),
      }),
    }),
  }));
  const dbInsertMock = vi.fn(() => ({
    values: vi.fn().mockResolvedValue(undefined),
  }));
  const dbUpdateMock = vi.fn(() => ({
    set: () => ({ where: vi.fn().mockResolvedValue(undefined) }),
  }));
  const db = {
    select: dbSelectMock,
    insert: dbInsertMock,
    update: dbUpdateMock,
  };

  const boss = {
    createQueue: vi.fn().mockResolvedValue(undefined),
    work: vi.fn().mockResolvedValue('worker-1'),
    offWork: vi.fn().mockResolvedValue(undefined),
  };
  const queue = {
    send: vi.fn().mockResolvedValue('boss-job-id-1'),
  };

  const poolModule = {
    bus: { on: vi.fn().mockReturnValue(() => undefined) },
  };

  // Plan 23-05 — registerJobsAdminRoutes uses fastify.withTypeProvider().route()
  // and depends on fastify.authService for the requireAuth helper.
  const routeMock = vi.fn();
  const withTypeProviderMock = vi.fn(() => ({ route: routeMock }));
  const authService = {
    validateKey: vi.fn().mockResolvedValue(true),
  };

  const fastify = {
    db,
    boss,
    queue,
    config: {},
    log: makeMockLogger(),
    addHook: vi.fn(),
    poolModule,
    withTypeProvider: withTypeProviderMock,
    authService,
  };

  return { fastify, db, boss, queue, poolModule, dbSelectMock, routeMock };
}

function createModule(fastify: ReturnType<typeof makeMockFastify>['fastify']) {
  return createJobsModule({
    fastify: fastify as never,
    db: (fastify as { db: unknown }).db as never,
    config: {} as never,
    logger: makeMockLogger() as never,
  });
}

describe('createJobsModule [MOD-06 / EVENTS-10]', () => {
  it('returns module with all 7 public keys', () => {
    const { fastify } = makeMockFastify();
    const m = createModule(fastify);
    expect(m).toBeDefined();
    expect(typeof m.emit).toBe('object');
    expect(m.bus).toBeDefined();
    expect(m.runningJobs).toBeInstanceOf(Map);
    expect(typeof m.getInFlightCount).toBe('function');
    expect(typeof m.enqueueJob).toBe('function');
    expect(typeof m.registerWorkerAndSubscribers).toBe('function');
    expect(typeof m.shutdown).toBe('function');
  });

  it('getInFlightCount reflects runningJobs Map size', () => {
    const { fastify } = makeMockFastify();
    const m = createModule(fastify);
    expect(m.getInFlightCount()).toBe(0);
    m.runningJobs.set('job-1', {
      abortController: new AbortController(),
      deviceId: 'dev-1',
    });
    expect(m.getInFlightCount()).toBe(1);
  });

  it('enqueueJob with empty system_state forwards to fastify.queue.send with singletonKey', async () => {
    const { fastify, queue } = makeMockFastify();
    const m = createModule(fastify);
    const id = await m.enqueueJob('job-99', { jobId: 'job-99', platform: 'android' });
    expect(id).toBe('boss-job-id-1');
    expect(queue.send).toHaveBeenCalledWith(
      'job.execute',
      { jobId: 'job-99', platform: 'android' },
      { singletonKey: 'job-99' },
    );
  });

  it('enqueueJob throws 503 when system_state has drain_requested_at row', async () => {
    const { fastify } = makeMockFastify({
      drainRow: [{ key: 'drain_requested_at', value: { iso: '2026-05-08' } }],
    });
    const m = createModule(fastify);
    await expect(
      m.enqueueJob('job-99', { jobId: 'job-99', platform: 'android' }),
    ).rejects.toMatchObject({
      message: 'system_draining',
      statusCode: 503,
      code: 'DRAINING',
    });
  });

  it('shutdown is idempotent (second call no-op)', async () => {
    const { fastify, boss } = makeMockFastify();
    const m = createModule(fastify);
    // Simulate a registered worker.
    await m.registerWorkerAndSubscribers();
    await m.shutdown();
    await m.shutdown();
    // boss.offWork called once (idempotent flag prevents second call).
    expect(boss.offWork).toHaveBeenCalledTimes(1);
  });

  it('registerWorkerAndSubscribers invokes boss.createQueue + boss.work + addHook(onReady)', async () => {
    const { fastify, boss } = makeMockFastify();
    const m = createModule(fastify);
    await m.registerWorkerAndSubscribers();
    expect(boss.createQueue).toHaveBeenCalledWith('job.execute', expect.objectContaining({ retryLimit: 0 }));
    expect(boss.work).toHaveBeenCalledTimes(1);
    expect(fastify.addHook).toHaveBeenCalledWith('onReady', expect.any(Function));
  });
});
