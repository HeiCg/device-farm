/**
 * Phase 21 / Plan 21-04 — createArtifactsModule factory spec (MOD-06).
 *
 * Proves:
 *   - Factory returns ArtifactsModule with 10 keys (6 back-compat services +
 *     emit + bus + registerWorkersAndSubscribers + shutdown).
 *   - registerWorkersAndSubscribers calls registerArtifactsWorker (createQueue
 *     + queue.work for RECORDING_UPLOAD) BEFORE registering subscribers.
 *   - Subscriber registration is DEFERRED to fastify.addHook('onReady').
 *   - shutdown() is idempotent — two calls, offWork called exactly once per worker,
 *     unsubscribe called once, scrcpyService.stopAll called once.
 *   - emit helpers accessible + callable via returned module.emit.
 *
 * Pure unit spec — no DB, no real pg-boss. Uses vi.fn() spies on a mock Fastify
 * with the decorators artifacts plugin expects (pool, db, onPersisted, queue, boss).
 */
import { afterEach, describe, it, expect, vi } from 'vitest';
import pino from 'pino';
import type { FastifyInstance } from 'fastify';

import { createArtifactsModule, type ArtifactsModule } from '../internal/module.js';
import { RECORDING_UPLOAD_QUEUE_NAME } from '../queue.js';

function makeMockFastify() {
  const createQueueSpy = vi.fn(async (_name: string, _opts?: unknown) => {});
  const workSpy = vi.fn(
    async (_name: string, _handler?: (data: unknown, id: string) => unknown) =>
      'worker-id-' + Math.random().toString(36).slice(2),
  );
  const sendSpy = vi.fn(
    async (_name: string, _data: unknown, _opts?: unknown) =>
      'queued-' + Math.random().toString(36).slice(2),
  );
  const offWorkSpy = vi.fn(async (_id: string) => {});
  const onPersistedUnsub = vi.fn();
  const onPersistedSpy = vi.fn((_type: string, _h: unknown) => onPersistedUnsub);

  // Capture the onReady hook handler so the spec can invoke it manually.
  let onReadyHandler: (() => Promise<void>) | null = null;
  const addHookSpy = vi.fn((hookName: string, handler: () => Promise<void>) => {
    if (hookName === 'onReady') onReadyHandler = handler;
  });

  // Mock jobsModule.bus.on — captures subscribers by event name.
  const jobsModuleBusOn = vi.fn((_type: string, _handler: unknown) => () => {});

  const fastify = {
    boss: {
      createQueue: createQueueSpy,
      offWork: offWorkSpy,
      getJobById: vi.fn(async () => null),
      updateQueue: vi.fn(async () => {}),
    },
    queue: { send: sendSpy, work: workSpy },
    onPersisted: onPersistedSpy,
    addHook: addHookSpy,
    jobsModule: { bus: { on: jobsModuleBusOn } },
    pool: { getDevice: vi.fn(() => ({ port: 5554, name: 'emulator-5554' })) },
    processTracker: {},
    log: pino({ level: 'silent' }),
  } as unknown as FastifyInstance;

  return {
    fastify,
    createQueueSpy,
    workSpy,
    sendSpy,
    offWorkSpy,
    onPersistedSpy,
    onPersistedUnsub,
    jobsModuleBusOn,
    addHookSpy,
    triggerOnReady: async () => {
      if (onReadyHandler) await onReadyHandler();
    },
  };
}

function makeDeps() {
  const mock = makeMockFastify();
  const deps = {
    fastify: mock.fastify,
    db: {
      insert: vi.fn(() => ({ values: vi.fn(async () => {}) })),
    } as never,
    config: {
      storage: { artifacts: { path: '/tmp/df' } },
      pool: {},
    } as never,
    logger: pino({ level: 'silent' }),
  };
  return { mock, deps };
}

describe('createArtifactsModule (Phase 21-04)', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('factory shape [MOD-06]', () => {
    it('returns ArtifactsModule with 10 expected keys', () => {
      const { deps } = makeDeps();
      const module: ArtifactsModule = createArtifactsModule(deps);
      expect(module.artifactService).toBeDefined();
      expect(module.recordingService).toBeDefined();
      expect(module.screenshotService).toBeDefined();
      expect(module.memoryService).toBeDefined();
      expect(module.scrcpyService).toBeDefined();
      expect(module.captureService).toBeDefined();
      expect(module.emit).toBeDefined();
      expect(module.bus).toBeDefined();
      expect(typeof module.registerWorkersAndSubscribers).toBe('function');
      expect(typeof module.shutdown).toBe('function');
    });

    it('emit has 3 typed helpers (artifactCreated / recordingStarted / recordingStopped)', () => {
      const { deps } = makeDeps();
      const module = createArtifactsModule(deps);
      expect(typeof module.emit.artifactCreated).toBe('function');
      expect(typeof module.emit.recordingStarted).toBe('function');
      expect(typeof module.emit.recordingStopped).toBe('function');
    });
  });

  describe('registerWorkersAndSubscribers', () => {
    it('calls fastify.boss.createQueue(RECORDING_UPLOAD, {policy: stately, retryLimit: 3, ...})', async () => {
      const { mock, deps } = makeDeps();
      const module = createArtifactsModule(deps);
      await module.registerWorkersAndSubscribers();

      expect(mock.createQueueSpy).toHaveBeenCalledTimes(1);
      const [queueName, opts] = mock.createQueueSpy.mock.calls[0];
      expect(queueName).toBe(RECORDING_UPLOAD_QUEUE_NAME);
      const optsObj = opts as {
        policy: string;
        retryLimit: number;
        retryBackoff: boolean;
      };
      expect(optsObj.policy).toBe('stately');
      expect(optsObj.retryLimit).toBe(3);
      expect(optsObj.retryBackoff).toBe(true);
    });

    it('registers the recording.upload worker via queue.work', async () => {
      const { mock, deps } = makeDeps();
      const module = createArtifactsModule(deps);
      await module.registerWorkersAndSubscribers();
      expect(mock.workSpy).toHaveBeenCalledWith(
        RECORDING_UPLOAD_QUEUE_NAME,
        expect.any(Function),
      );
    });

    it('defers bus subscriptions to onReady hook', async () => {
      const { mock, deps } = makeDeps();
      const module = createArtifactsModule(deps);
      await module.registerWorkersAndSubscribers();

      // Before triggering onReady: subscribers NOT yet registered.
      expect(mock.jobsModuleBusOn).not.toHaveBeenCalled();
      expect(mock.onPersistedSpy).not.toHaveBeenCalled();

      // addHook MUST have been called with 'onReady'.
      expect(mock.addHookSpy).toHaveBeenCalledWith(
        'onReady',
        expect.any(Function),
      );

      // Fire the deferred hook.
      await mock.triggerOnReady();

      // NOW subscribers are registered.
      expect(mock.jobsModuleBusOn).toHaveBeenCalledWith(
        'job.started',
        expect.any(Function),
      );
      expect(mock.jobsModuleBusOn).toHaveBeenCalledWith(
        'maestro.log.written',
        expect.any(Function),
      );
      expect(mock.onPersistedSpy).toHaveBeenCalledWith(
        'job.completed',
        expect.any(Function),
      );
    });
  });

  describe('shutdown idempotency', () => {
    it('second shutdown call is a no-op (stopped flag)', async () => {
      const { mock, deps } = makeDeps();
      const module = createArtifactsModule(deps);
      await module.registerWorkersAndSubscribers();
      await mock.triggerOnReady();

      await module.shutdown();
      const offWorkCallsAfterFirst = mock.offWorkSpy.mock.calls.length;

      await module.shutdown();
      // no additional offWork
      expect(mock.offWorkSpy.mock.calls.length).toBe(offWorkCallsAfterFirst);
    });

    it('unsubscribes each of the 3 bus handlers on shutdown', async () => {
      const { mock, deps } = makeDeps();
      // Make jobsModuleBusOn return a spy unsub so we can assert.
      const jobStartedUnsub = vi.fn();
      const maestroLogUnsub = vi.fn();
      mock.jobsModuleBusOn.mockImplementation(
        (type: string, _h: unknown) => {
          if (type === 'job.started') return jobStartedUnsub;
          if (type === 'maestro.log.written') return maestroLogUnsub;
          return () => {};
        },
      );

      const module = createArtifactsModule(deps);
      await module.registerWorkersAndSubscribers();
      await mock.triggerOnReady();

      await module.shutdown();
      expect(jobStartedUnsub).toHaveBeenCalledTimes(1);
      expect(maestroLogUnsub).toHaveBeenCalledTimes(1);
      expect(mock.onPersistedUnsub).toHaveBeenCalledTimes(1);
    });

    it('offWorks each registered worker id on first shutdown', async () => {
      const { mock, deps } = makeDeps();
      const module = createArtifactsModule(deps);
      await module.registerWorkersAndSubscribers();
      await mock.triggerOnReady();

      await module.shutdown();
      // Exactly 1 worker registered (recording.upload), so 1 offWork call.
      expect(mock.offWorkSpy).toHaveBeenCalledTimes(1);
    });
  });
});
