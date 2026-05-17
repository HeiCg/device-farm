/**
 * Phase 15 / Plan 15-04 / Task 4.2 — createEventHelpers tests.
 *
 * Helpers MUST stamp envelopes from ALS without the caller threading any IDs.
 * These tests drive both ALS-present and ALS-absent code paths.
 *
 * Per plan directive: tests run WITHOUT a real Fastify instance; we use the
 * raw `asyncLocalStorage` exported from `@fastify/request-context` and wrap
 * the body in `asyncLocalStorage.run(new Map([...]), ...)` (research §3 +
 * research pitfall #8).
 */
import { describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { asyncLocalStorage } from '@fastify/request-context';

import { TypedBus } from '../../bus/bus.js';
import { createEventHelpers } from '../../bus/helpers.js';
import { demoRegistry } from '../registry.js';

function makeBus() {
  return new TypedBus(demoRegistry);
}

describe('createEventHelpers', () => {
  it('stamps envelope.correlationId from ALS inside a request fiber', () => {
    const bus = makeBus();
    const emit = createEventHelpers(bus);
    const cid = randomUUID();
    const aggId = randomUUID();

    let captured: { correlationId: string } | null = null;
    asyncLocalStorage.run(new Map([['correlationId', cid]]), () => {
      captured = emit('demo.happened')(aggId, { value: 1 });
    });

    expect(captured).not.toBeNull();
    expect(captured!.correlationId).toBe(cid);
  });

  it('falls back to a fresh UUID when invoked outside any ALS fiber', () => {
    const bus = makeBus();
    const emit = createEventHelpers(bus);
    const env = emit('demo.happened')(randomUUID(), { value: 1 });

    // Must be a valid UUID and NOT a hard-coded sentinel
    expect(env.correlationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it('defaults actor to ALS "actor" key when present, else "anonymous"', () => {
    const bus = makeBus();
    const emit = createEventHelpers(bus);
    const aggId = randomUUID();

    let fromAls: string | null = null;
    asyncLocalStorage.run(new Map([['actor', 'user-42']]), () => {
      fromAls = emit('demo.happened')(aggId, { value: 1 }).actor;
    });
    expect(fromAls).toBe('user-42');

    const defaultActor = emit('demo.happened')(aggId, { value: 1 }).actor;
    expect(defaultActor).toBe('anonymous');
  });

  it('generates a fresh envelope.id per call', () => {
    const bus = makeBus();
    const emit = createEventHelpers(bus);
    const aggId = randomUUID();

    const a = emit('demo.happened')(aggId, { value: 1 });
    const b = emit('demo.happened')(aggId, { value: 2 });

    expect(a.id).not.toBe(b.id);
    expect(a.id).toMatch(/^[0-9a-f]{8}-/i);
  });

  it('stamps envelope.occurredAt close to Date.now()', () => {
    const bus = makeBus();
    const emit = createEventHelpers(bus);
    const before = Date.now();
    const env = emit('demo.happened')(randomUUID(), { value: 1 });
    const after = Date.now();
    const t = Date.parse(env.occurredAt);
    expect(t).toBeGreaterThanOrEqual(before - 5);
    expect(t).toBeLessThanOrEqual(after + 5);
  });

  it('derives aggregateType from the registry entry (falls back to type.split(".")[0])', () => {
    const bus = makeBus();
    const emit = createEventHelpers(bus);
    // Registry entry declares aggregateType: 'demo' explicitly
    const env = emit('demo.happened')(randomUUID(), { value: 1 });
    expect(env.aggregateType).toBe('demo');
  });

  it('invokes the onEmit hook with the stamped envelope', () => {
    const bus = makeBus();
    const hook = vi.fn();
    const emit = createEventHelpers(bus, hook);
    const aggId = randomUUID();

    const env = emit('demo.happened')(aggId, { value: 9 });

    expect(hook).toHaveBeenCalledTimes(1);
    expect(hook).toHaveBeenCalledWith(env);
  });
});
