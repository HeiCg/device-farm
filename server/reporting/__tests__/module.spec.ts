/**
 * Phase 19 / Plan 19-03 — createReportingModule factory spec (MOD-06).
 *
 * Proves:
 *   - Factory returns the expected surface shape.
 *   - registerWorkersAndSubscribers creates DLQ queue BEFORE MAIN queue,
 *     registers two workers (main + DLQ), subscribes to 'job.completed'.
 *   - shutdown() is idempotent — two calls, offWork called exactly once per worker.
 *   - enqueueWebhookDelivery enqueues via fastify.queue.send with correct shape.
 *
 * Pure unit spec — no DB, no real pg-boss. Uses vi.fn() spies on a mock Fastify.
 */
import { afterEach, describe, it, expect, vi } from 'vitest';
import pino from 'pino';
import type { FastifyInstance } from 'fastify';

import { createReportingModule, type ReportingModule } from '../internal/module.js';
import { WEBHOOK_DELIVER_QUEUE_NAME, WEBHOOK_DELIVER_DLQ_QUEUE_NAME } from '../queue.js';
import { REPORTING_EVENT_NAMES } from '../events.js';

function makeMockFastify() {
  // Typed so `.mock.calls[i][j]` preserves argument positions for assertions.
  const createQueueSpy = vi.fn(async (_name: string, _opts?: unknown) => {});
  const workSpy = vi.fn(
    async (_name: string, _handler?: (data: unknown, jobId: string) => unknown) =>
      'worker-id-' + Math.random().toString(36).slice(2),
  );
  const sendSpy = vi.fn(
    async (_name: string, _data: unknown, _opts?: unknown) =>
      'job-id-' + Math.random().toString(36).slice(2),
  );
  const offWorkSpy = vi.fn(async (_id: string) => {});
  const onPersistedUnsub = vi.fn();
  const onPersistedSpy = vi.fn(
    (_type: string, _handler: (envelope: unknown) => unknown) => onPersistedUnsub,
  );

  const fastify = {
    boss: {
      createQueue: createQueueSpy,
      offWork: offWorkSpy,
    },
    queue: {
      send: sendSpy,
      work: workSpy,
    },
    onPersisted: onPersistedSpy,
    log: pino({ level: 'silent' }),
  } as unknown as FastifyInstance;

  return { fastify, createQueueSpy, workSpy, sendSpy, offWorkSpy, onPersistedSpy, onPersistedUnsub };
}

function makeDeps() {
  const mock = makeMockFastify();
  const deps = {
    fastify: mock.fastify,
    db: {
      // Drizzle-like stub: insert(table).values(row) → resolves
      insert: vi.fn(() => ({ values: vi.fn(async () => {}) })),
    } as never,
    config: {
      webhooks: { url: 'https://example.com/hook' },
    } as never,
    logger: pino({ level: 'silent' }),
  };
  return { mock, deps };
}

describe('createReportingModule (Phase 19-03)', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('factory shape [MOD-06]', () => {
    it('returns ReportingModule with expected keys', () => {
      const { deps } = makeDeps();
      const module: ReportingModule = createReportingModule(deps);
      expect(module.webhookService).toBeDefined();
      expect(module.flakyDetector).toBeDefined();
      expect(module.emit).toBeDefined();
      expect(module.bus).toBeDefined();
      expect(typeof module.registerWorkersAndSubscribers).toBe('function');
      expect(typeof module.enqueueWebhookDelivery).toBe('function');
      expect(typeof module.shutdown).toBe('function');
    });
  });

  describe('registerWorkersAndSubscribers', () => {
    it('creates DLQ queue BEFORE main queue (FK ordering — RESEARCH §Pitfall 2)', async () => {
      const { mock, deps } = makeDeps();
      const module = createReportingModule(deps);
      await module.registerWorkersAndSubscribers();

      // createQueue called exactly twice in order: DLQ first, main second.
      expect(mock.createQueueSpy).toHaveBeenCalledTimes(2);
      expect(mock.createQueueSpy.mock.calls[0][0]).toBe(WEBHOOK_DELIVER_DLQ_QUEUE_NAME);
      expect(mock.createQueueSpy.mock.calls[1][0]).toBe(WEBHOOK_DELIVER_QUEUE_NAME);
    });

    it('main queue is created with retryLimit:5 + retryBackoff:true + deadLetter + policy:standard', async () => {
      const { mock, deps } = makeDeps();
      const module = createReportingModule(deps);
      await module.registerWorkersAndSubscribers();

      const mainCall = mock.createQueueSpy.mock.calls[1];
      expect(mainCall[0]).toBe(WEBHOOK_DELIVER_QUEUE_NAME);
      const opts = mainCall[1] as Record<string, unknown>;
      expect(opts.retryLimit).toBe(5);
      expect(opts.retryBackoff).toBe(true);
      expect(opts.deadLetter).toBe(WEBHOOK_DELIVER_DLQ_QUEUE_NAME);
      expect(opts.policy).toBe('standard');  // RESEARCH §Pitfall 9 — webhooks NOT stately
    });

    it('DLQ queue is created with retryLimit:0 + retryBackoff:false + policy:standard', async () => {
      const { mock, deps } = makeDeps();
      const module = createReportingModule(deps);
      await module.registerWorkersAndSubscribers();

      const dlqCall = mock.createQueueSpy.mock.calls[0];
      expect(dlqCall[0]).toBe(WEBHOOK_DELIVER_DLQ_QUEUE_NAME);
      const opts = dlqCall[1] as Record<string, unknown>;
      expect(opts.retryLimit).toBe(0);
      expect(opts.retryBackoff).toBe(false);
      expect(opts.policy).toBe('standard');
    });

    it('registers 2 workers (main + DLQ)', async () => {
      const { mock, deps } = makeDeps();
      const module = createReportingModule(deps);
      await module.registerWorkersAndSubscribers();

      expect(mock.workSpy).toHaveBeenCalledTimes(2);
      // Order: main first, DLQ second (mirrors RESEARCH §Example 1).
      expect(mock.workSpy.mock.calls[0][0]).toBe(WEBHOOK_DELIVER_QUEUE_NAME);
      expect(mock.workSpy.mock.calls[1][0]).toBe(WEBHOOK_DELIVER_DLQ_QUEUE_NAME);
    });

    it("subscribes to 'job.completed' bus event", async () => {
      const { mock, deps } = makeDeps();
      const module = createReportingModule(deps);
      await module.registerWorkersAndSubscribers();

      expect(mock.onPersistedSpy).toHaveBeenCalledTimes(1);
      expect(mock.onPersistedSpy.mock.calls[0][0]).toBe('job.completed');
    });
  });

  describe('enqueueWebhookDelivery', () => {
    it('sends via fastify.queue.send with WEBHOOK_DELIVER name and {url, payload} shape', async () => {
      const { mock, deps } = makeDeps();
      const module = createReportingModule(deps);

      const url = 'https://example.com/hook';
      const payload = { event: 'job.completed', foo: 'bar' };
      await module.enqueueWebhookDelivery(url, payload, { jobId: 'abc-123' });

      expect(mock.sendSpy).toHaveBeenCalledTimes(1);
      expect(mock.sendSpy.mock.calls[0][0]).toBe(WEBHOOK_DELIVER_QUEUE_NAME);
      expect(mock.sendSpy.mock.calls[0][1]).toEqual({ url, payload });
    });

    it('emits webhook.scheduled side-event', async () => {
      const { deps } = makeDeps();
      const module = createReportingModule(deps);

      const captured: unknown[] = [];
      module.bus.on(REPORTING_EVENT_NAMES.SCHEDULED, (p) => {
        captured.push(p);
      });

      await module.enqueueWebhookDelivery(
        'https://ex.com/hook',
        { event: 'x' },
        { jobId: null },
      );

      // emit.scheduled fires synchronously after the async fastify.queue.send resolves.
      expect(captured.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('shutdown [MOD-06 idempotency]', () => {
    it('first call unsubscribes bus + offWorks each worker id', async () => {
      const { mock, deps } = makeDeps();
      const module = createReportingModule(deps);
      await module.registerWorkersAndSubscribers();

      await module.shutdown();

      expect(mock.onPersistedUnsub).toHaveBeenCalledTimes(1);  // bus unsubscribe
      expect(mock.offWorkSpy).toHaveBeenCalledTimes(2);        // main + DLQ
    });

    it('second call is a no-op (idempotent)', async () => {
      const { mock, deps } = makeDeps();
      const module = createReportingModule(deps);
      await module.registerWorkersAndSubscribers();

      await module.shutdown();
      const offWorkCountAfterFirst = mock.offWorkSpy.mock.calls.length;
      const unsubCountAfterFirst = mock.onPersistedUnsub.mock.calls.length;

      await module.shutdown();  // second call

      expect(mock.offWorkSpy.mock.calls.length).toBe(offWorkCountAfterFirst);   // no additional calls
      expect(mock.onPersistedUnsub.mock.calls.length).toBe(unsubCountAfterFirst);
    });
  });
});
