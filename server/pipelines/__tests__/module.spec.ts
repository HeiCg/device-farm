/**
 * Phase 25 / Plan 25-03 — createPipelinesModule factory tests (MOD-06).
 *
 * 5 no-DB tests proving:
 *   - 9-key return shape: scheduler/service/broadcaster/secretsService/
 *     gitService/emit/bus/registerWorkersAndSubscribers/shutdown
 *   - shutdown is idempotent (double-call no-throw, single offWork call)
 *   - registerWorkersAndSubscribers calls boss.createQueue BEFORE boss.work (Pitfall 2)
 *   - subscriber wiring is deferred to onReady (Pitfall 5) — handler
 *     captured by addHook is NOT called immediately
 *   - emit object has 5 keys (runStarted/stageAdvanced/runCompleted/runFailed/scheduleUpserted)
 *
 * Mocks: db + boss + logger + jobsModule + fastify (all via vi.fn).
 */
import { describe, it, expect, vi } from 'vitest';
import { createPipelinesModule } from '../internal/module.js';

function makeMockDeps() {
  const callOrder: string[] = [];
  const onReadyHandlers: Array<() => Promise<void>> = [];

  const boss: any = {
    createQueue: vi.fn(async () => {
      callOrder.push('createQueue');
    }),
    work: vi.fn(async () => {
      callOrder.push('work');
      return 'mock-worker-id';
    }),
    schedule: vi.fn(async () => {}),
    unschedule: vi.fn(async () => {}),
    getSchedules: vi.fn(async () => []),
    offWork: vi.fn(async () => {}),
    send: vi.fn(async () => 'mock-job-id'),
  };

  const db: any = {
    insert: vi.fn(() => ({
      values: vi.fn(async () => {}),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(async () => {}),
      })),
    })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(async () => []),
        innerJoin: vi.fn(() => ({
          where: vi.fn(async () => []),
        })),
      })),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(async () => {}),
    })),
  };

  const logger: any = {
    child: vi.fn(() => logger),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  };

  const jobsBusOn = vi.fn(() => () => {}); // returns unsubscribe fn
  const jobsModule: any = {
    bus: { on: jobsBusOn },
    emit: {},
    enqueueJob: vi.fn(),
  };

  const fastify: any = {
    db,
    boss,
    log: logger,
    jobsModule,
    jobService: undefined,
    addHook: vi.fn((event: string, handler: () => Promise<void>) => {
      if (event === 'onReady') onReadyHandlers.push(handler);
    }),
    decorate: vi.fn(),
    register: vi.fn(),
  };

  return { fastify, db, boss, logger, jobsModule, callOrder, onReadyHandlers, jobsBusOn };
}

describe('createPipelinesModule (Plan 25-03)', () => {
  it('returns 9-key shape', () => {
    const deps = makeMockDeps();
    const module = createPipelinesModule(deps);
    expect(Object.keys(module).sort()).toEqual(
      [
        'broadcaster',
        'bus',
        'emit',
        'gitService',
        'registerWorkersAndSubscribers',
        'scheduler',
        'secretsService',
        'service',
        'shutdown',
      ].sort(),
    );
  });

  it('emit object has 5 keys (PipelinesEmitters)', () => {
    const deps = makeMockDeps();
    const module = createPipelinesModule(deps);
    expect(Object.keys(module.emit).sort()).toEqual(
      ['runCompleted', 'runFailed', 'runStarted', 'scheduleUpserted', 'stageAdvanced'].sort(),
    );
    for (const fn of Object.values(module.emit)) {
      expect(typeof fn).toBe('function');
    }
  });

  it('registerWorkersAndSubscribers calls boss.createQueue BEFORE boss.work (Pitfall 2)', async () => {
    const deps = makeMockDeps();
    const module = createPipelinesModule(deps);
    await module.registerWorkersAndSubscribers();
    expect(deps.callOrder.indexOf('createQueue')).toBeLessThan(
      deps.callOrder.indexOf('work'),
    );
    expect(deps.boss.createQueue).toHaveBeenCalledTimes(1);
    expect(deps.boss.work).toHaveBeenCalledTimes(1);
  });

  it('subscriber wiring is deferred to onReady (Pitfall 5)', async () => {
    const deps = makeMockDeps();
    const module = createPipelinesModule(deps);
    await module.registerWorkersAndSubscribers();
    // jobsModule.bus.on must NOT have been called yet (deferred to onReady).
    expect(deps.jobsBusOn).not.toHaveBeenCalled();
    expect(deps.fastify.addHook).toHaveBeenCalledWith('onReady', expect.any(Function));
    // Now run the captured onReady handler.
    expect(deps.onReadyHandlers.length).toBeGreaterThan(0);
    for (const h of deps.onReadyHandlers) await h();
    // After onReady fires, jobsModule.bus.on('job.completed', ...) is called.
    expect(deps.jobsBusOn).toHaveBeenCalledWith('job.completed', expect.any(Function));
  });

  it('shutdown is idempotent — double-call no-throw + single offWork call', async () => {
    const deps = makeMockDeps();
    const module = createPipelinesModule(deps);
    await module.registerWorkersAndSubscribers();
    await expect(module.shutdown()).resolves.toBeUndefined();
    await expect(module.shutdown()).resolves.toBeUndefined();
    // offWork called ONCE despite double shutdown (stopped flag).
    expect(deps.boss.offWork).toHaveBeenCalledTimes(1);
  });
});
