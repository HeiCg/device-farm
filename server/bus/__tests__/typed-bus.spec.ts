/**
 * Phase 15 / Plan 15-04 / Task 4.1 — TypedBus unit tests.
 *
 * Exercises the typed in-process event bus over Node EventEmitter:
 *   - Registered emit → subscribed handler receives payload.
 *   - Unregistered emit → throws.
 *   - Emit with schema-invalid payload → throws ZodError at runtime.
 *   - `bus.on` returns an unsubscribe function; after unsub no delivery.
 *
 * Fixture: `demoRegistry` from server/events/registry.ts (fixture-only;
 * no real module events are registered in Phase 15 — pilot starts Phase 16).
 */
import { describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';

import { TypedBus } from '../bus.js';
import { demoRegistry } from '../../events/registry.js';

describe('TypedBus', () => {
  it('delivers a registered event payload to a subscribed handler', () => {
    const bus = new TypedBus(demoRegistry);
    const handler = vi.fn();
    bus.on('demo.happened', handler);

    bus.emit('demo.happened', { value: 7 });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ value: 7 });
  });

  it('throws when emitting an unregistered event type', () => {
    const bus = new TypedBus(demoRegistry);
    expect(() =>
      // cast forces the test past TS narrowing to exercise the runtime guard
      (bus.emit as (t: string, p: unknown) => void)('not.registered', { value: 1 }),
    ).toThrow(/Unknown event type/);
  });

  it('throws ZodError when emitted payload fails the registry schema', () => {
    const bus = new TypedBus(demoRegistry);
    expect(() =>
      // value must be an integer; `3.14` is not an integer
      (bus.emit as (t: string, p: unknown) => void)('demo.happened', { value: 3.14 }),
    ).toThrow(ZodError);
  });

  it('returns an unsubscribe function that stops further delivery', () => {
    const bus = new TypedBus(demoRegistry);
    const handler = vi.fn();
    const off = bus.on('demo.happened', handler);

    bus.emit('demo.happened', { value: 1 });
    off();
    bus.emit('demo.happened', { value: 2 });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ value: 1 });
  });
});
