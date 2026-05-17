/**
 * Phase 22 / Plan 22-02 — Streaming module spec (MOD-06 + shutdown idempotency).
 *
 * Proves factory shape + subscriber deferral behavior + shutdown idempotency.
 * No DB; uses plain mocks for Fastify + jobsModule.
 *
 * For end-to-end subscriber proofs (SC1 + SC2 bus→envelope→WS path), see
 * Plan 22-03 subscriber.spec + correlation.spec (DB-gated).
 */
import { describe, it, expect, vi } from 'vitest';
import pino from 'pino';

import { createStreamingModule } from '../internal/module.js';
import { JobBroadcaster } from '../internal/job-broadcaster.js';
import { DevicePreviewManager } from '../internal/device-preview.js';
import { TypedBus } from '../../bus/bus.js';

function makeDeps() {
  const fastify = {
    jobsModule: {
      bus: {
        on: vi.fn(() => vi.fn()), // returns unsubscribe fn
        emit: vi.fn(),
      },
    },
  } as unknown as Parameters<typeof createStreamingModule>[0]['fastify'];

  const db = {
    insert: vi.fn(() => ({ values: vi.fn(async () => ({})) })),
  } as unknown as Parameters<typeof createStreamingModule>[0]['db'];

  const config = {} as unknown as Parameters<typeof createStreamingModule>[0]['config'];

  const logger = pino({ level: 'silent' });

  return { fastify, db, config, logger };
}

describe('[Phase 22-02] createStreamingModule factory (MOD-06)', () => {
  it('returns 6-key shape', () => {
    const module = createStreamingModule(makeDeps());
    expect(Object.keys(module).sort()).toEqual(
      ['bus', 'devicePreview', 'emit', 'jobBroadcaster', 'registerSubscribers', 'shutdown'].sort(),
    );
  });

  it('constructs JobBroadcaster instance', () => {
    const module = createStreamingModule(makeDeps());
    expect(module.jobBroadcaster).toBeInstanceOf(JobBroadcaster);
  });

  it('constructs DevicePreviewManager instance', () => {
    const module = createStreamingModule(makeDeps());
    expect(module.devicePreview).toBeInstanceOf(DevicePreviewManager);
  });

  it('constructs TypedBus<StreamingRegistry>', () => {
    const module = createStreamingModule(makeDeps());
    expect(module.bus).toBeInstanceOf(TypedBus);
  });

  it('emit has frameDropped helper', () => {
    const module = createStreamingModule(makeDeps());
    expect(typeof module.emit.frameDropped).toBe('function');
  });
});

describe('[Phase 22-02] registerSubscribers (deferred to onReady)', () => {
  it('subscribes to job.log / job.step / job.status on fastify.jobsModule.bus', async () => {
    const deps = makeDeps();
    const module = createStreamingModule(deps);

    await module.registerSubscribers();

    const onFn = (
      deps.fastify as unknown as { jobsModule: { bus: { on: ReturnType<typeof vi.fn> } } }
    ).jobsModule.bus.on;
    const calls = onFn.mock.calls.map((c) => c[0]);
    expect(calls).toEqual(expect.arrayContaining(['job.log', 'job.step', 'job.status']));
    expect(calls).toHaveLength(3);
  });

  it('gracefully skips subscription if fastify.jobsModule is missing', async () => {
    const deps = makeDeps();
    (deps.fastify as unknown as { jobsModule?: unknown }).jobsModule = undefined;
    const module = createStreamingModule(deps);

    await expect(module.registerSubscribers()).resolves.not.toThrow();
  });
});

describe('[Phase 22-02] shutdown idempotency', () => {
  it('unsubscribes 3 bus handlers after registerSubscribers', async () => {
    const unsubLog = vi.fn();
    const unsubStep = vi.fn();
    const unsubStatus = vi.fn();
    const onFn = vi
      .fn()
      .mockReturnValueOnce(unsubLog)
      .mockReturnValueOnce(unsubStep)
      .mockReturnValueOnce(unsubStatus);

    const deps = makeDeps();
    (deps.fastify as unknown as { jobsModule: { bus: { on: unknown } } }).jobsModule.bus.on = onFn;

    const module = createStreamingModule(deps);
    await module.registerSubscribers();
    await module.shutdown();

    expect(unsubLog).toHaveBeenCalledTimes(1);
    expect(unsubStep).toHaveBeenCalledTimes(1);
    expect(unsubStatus).toHaveBeenCalledTimes(1);
  });

  it('double-call shutdown does not throw and does not re-unsub', async () => {
    const unsubLog = vi.fn();
    const unsubStep = vi.fn();
    const unsubStatus = vi.fn();
    const onFn = vi
      .fn()
      .mockReturnValueOnce(unsubLog)
      .mockReturnValueOnce(unsubStep)
      .mockReturnValueOnce(unsubStatus);

    const deps = makeDeps();
    (deps.fastify as unknown as { jobsModule: { bus: { on: unknown } } }).jobsModule.bus.on = onFn;

    const module = createStreamingModule(deps);
    await module.registerSubscribers();
    await module.shutdown();
    await expect(module.shutdown()).resolves.not.toThrow();

    // Each unsub fn called exactly once (first shutdown); second shutdown is a no-op.
    expect(unsubLog).toHaveBeenCalledTimes(1);
    expect(unsubStep).toHaveBeenCalledTimes(1);
    expect(unsubStatus).toHaveBeenCalledTimes(1);
  });

  it('shutdown without prior registerSubscribers is a no-op', async () => {
    const module = createStreamingModule(makeDeps());
    await expect(module.shutdown()).resolves.not.toThrow();
  });
});
