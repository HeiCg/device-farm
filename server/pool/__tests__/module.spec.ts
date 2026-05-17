/**
 * Phase 20 / Plan 20-03 — createPoolModule factory spec (MOD-06).
 *
 * Proves factory shape + registerWorkersAndSubscribers wiring +
 * idempotent shutdown. No DB — uses vi.fn() mocks for fastify.boss /
 * fastify.queue. Matches Phase 19 reporting module.spec.ts pattern.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { pino } from 'pino';

import { createPoolModule } from '../internal/module.js';
import { PoolManager } from '../pool-manager.js';
import { HealthChecker } from '../health-checker.js';
import { ProcessTracker } from '../process-tracker.js';
import { TypedBus } from '../../bus/bus.js';
import { DEVICE_REAP_QUEUE_NAME } from '../queue.js';
import { POOL_EVENT_NAMES } from '../events.js';

const silentLogger = pino({ level: 'silent' });

function makeMockFastify(): any {
  return {
    boss: {
      createQueue: vi.fn().mockResolvedValue(undefined),
      offWork:     vi.fn().mockResolvedValue(undefined),
    },
    queue: {
      schedule: vi.fn().mockResolvedValue(undefined),
      work:     vi.fn().mockImplementation(async (_name: string) => `worker-${Math.random()}`),
      send:     vi.fn().mockResolvedValue('mock-job-id'),
    },
    log: silentLogger,
  };
}

function makeMockConfig(): any {
  return { pool: { android: { enabled: false, max_instances: 0 }, ios: { enabled: false, max_instances: 0 } } };
}

function makeMockDb(): any {
  return { insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue(undefined) })) };
}

describe('[Phase 20-03] createPoolModule factory (MOD-06)', () => {
  let processTracker: ProcessTracker;

  beforeEach(() => {
    processTracker = new ProcessTracker(silentLogger);
    vi.spyOn(processTracker, 'reapOrphans').mockResolvedValue(undefined);
  });

  it('returns exactly 9 keys: pool, allocateMany, healthChecker, emit, bus, discoveryService, pairingService, registerWorkersAndSubscribers, shutdown', () => {
    // Phase 36 / Plan 36-01 — added `discoveryService` (DeviceDiscoveryService).
    // Phase 36 / Plan 36-02 — added `pairingService` (PairingService).
    // Phase 37 / Plan 37-04 — added `allocateMany` (batch-allocation for parallel-deploy).
    const module = createPoolModule({
      fastify: makeMockFastify(), db: makeMockDb(), config: makeMockConfig(), logger: silentLogger, processTracker,
    });
    expect(Object.keys(module).sort()).toEqual(
      ['allocateMany', 'bus', 'discoveryService', 'emit', 'healthChecker', 'pairingService', 'pool', 'registerWorkersAndSubscribers', 'shutdown'].sort(),
    );
  });

  it('pool is PoolManager instance; healthChecker is HealthChecker instance; bus is TypedBus instance', () => {
    const module = createPoolModule({
      fastify: makeMockFastify(), db: makeMockDb(), config: makeMockConfig(), logger: silentLogger, processTracker,
    });
    expect(module.pool).toBeInstanceOf(PoolManager);
    expect(module.healthChecker).toBeInstanceOf(HealthChecker);
    expect(module.bus).toBeInstanceOf(TypedBus);
  });

  it('emit has 9 methods matching POOL_EVENT_NAMES (Phase 20 base 4 + Phase 24 booted + Phase 36 discovery×3 + pair×1)', () => {
    // Phase 36 / Plan 36-00 extended POOL_EVENT_NAMES additively from 5 → 9
    // entries: 3 discovery + 1 pairing audit. emit gains the corresponding
    // helpers (discoveredAdded/Removed/Changed + pairAttempted).
    const module = createPoolModule({
      fastify: makeMockFastify(), db: makeMockDb(), config: makeMockConfig(), logger: silentLogger, processTracker,
    });
    expect(typeof module.emit.stateChanged).toBe('function');
    expect(typeof module.emit.allocated).toBe('function');
    expect(typeof module.emit.released).toBe('function');
    expect(typeof module.emit.healthFailed).toBe('function');
    expect(typeof module.emit.booted).toBe('function');
    expect(typeof module.emit.discoveredAdded).toBe('function');
    expect(typeof module.emit.discoveredRemoved).toBe('function');
    expect(typeof module.emit.discoveredChanged).toBe('function');
    expect(typeof module.emit.pairAttempted).toBe('function');
    expect(Object.keys(POOL_EVENT_NAMES)).toHaveLength(9);
  });

  it('registerWorkersAndSubscribers → healthChecker.start(30000) + createQueue + schedule + work', async () => {
    const fastify = makeMockFastify();
    const module = createPoolModule({
      fastify, db: makeMockDb(), config: makeMockConfig(), logger: silentLogger, processTracker,
    });
    const startSpy = vi.spyOn(module.healthChecker, 'start');

    await module.registerWorkersAndSubscribers();

    expect(startSpy).toHaveBeenCalledWith(30_000);
    expect(fastify.boss.createQueue).toHaveBeenCalledWith(
      DEVICE_REAP_QUEUE_NAME,
      expect.objectContaining({ policy: 'stately', retryLimit: 1 }),
    );
    expect(fastify.queue.schedule).toHaveBeenCalledWith(
      DEVICE_REAP_QUEUE_NAME,
      '* * * * *',
      expect.anything(),
      expect.objectContaining({ singletonKey: DEVICE_REAP_QUEUE_NAME }),
    );
    expect(fastify.queue.work).toHaveBeenCalledWith(DEVICE_REAP_QUEUE_NAME, expect.any(Function));

    // Cleanup: stop healthChecker interval so test doesn't leak timers.
    module.healthChecker.stop();
  });

  it('[Invariant MOD-08 (g)] shutdown is idempotent — second call is no-op', async () => {
    const fastify = makeMockFastify();
    const module = createPoolModule({
      fastify, db: makeMockDb(), config: makeMockConfig(), logger: silentLogger, processTracker,
    });
    await module.registerWorkersAndSubscribers();

    const stopSpy = vi.spyOn(module.healthChecker, 'stop');
    await module.shutdown();
    const firstCallCount = fastify.boss.offWork.mock.calls.length;
    const firstStopCount = stopSpy.mock.calls.length;

    await module.shutdown();

    expect(fastify.boss.offWork.mock.calls.length).toBe(firstCallCount);  // no additional offWork
    expect(stopSpy.mock.calls.length).toBe(firstStopCount);                 // no additional stop
  });

  it('shutdown calls healthChecker.stop() + offWork per registered worker id', async () => {
    const fastify = makeMockFastify();
    fastify.queue.work.mockResolvedValueOnce('worker-reap-id');
    const module = createPoolModule({
      fastify, db: makeMockDb(), config: makeMockConfig(), logger: silentLogger, processTracker,
    });
    const stopSpy = vi.spyOn(module.healthChecker, 'stop');
    await module.registerWorkersAndSubscribers();

    await module.shutdown();

    expect(stopSpy).toHaveBeenCalledTimes(1);
    expect(fastify.boss.offWork).toHaveBeenCalledWith('worker-reap-id');
  });

  it('shutdown does NOT call pool.shutdown() — deferred per RESEARCH §Open Question 1', async () => {
    const fastify = makeMockFastify();
    const module = createPoolModule({
      fastify, db: makeMockDb(), config: makeMockConfig(), logger: silentLogger, processTracker,
    });
    const poolShutdownSpy = vi.spyOn(module.pool, 'shutdown');
    await module.registerWorkersAndSubscribers();
    await module.shutdown();
    expect(poolShutdownSpy).not.toHaveBeenCalled();
  });
});
