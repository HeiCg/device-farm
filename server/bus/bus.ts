/**
 * Phase 15 / Plan 15-04 / Task 4.1 — TypedBus over Node EventEmitter.
 *
 * Thin wrapper that provides:
 *   - Compile-time narrowing: `on<T>(type, handler)` infers payload type from
 *     the literal event-type string keyed in the registry.
 *   - Runtime safety: `emit<T>(type, payload)` looks up the registry entry
 *     and `.parse()`s the payload, so a wrongly-typed cast or a corrupt
 *     producer surfaces as a ZodError instead of silently polluting the bus.
 *   - Registered-only emit: unknown types throw.
 *
 * Public API matches the decision in 15-CONTEXT.md: `bus.on`, `bus.emit`,
 * plus an unsubscribe function returned by `on`. Everything else (persistence,
 * causation, emit helpers) sits in adjacent files and treats this class as
 * their underlying transport.
 *
 * NOTE: The internal `EventEmitter` is intentionally kept accessible via
 * `(bus as any).ee` for the bus plugin (plan 15-04 Task 4.3) to attach the
 * side-channel `<type>.envelope` listener. Public surface stays `on` / `emit`
 * only — the side-channel is an implementation detail of the plugin.
 */
import { EventEmitter } from 'node:events';

import type { EventRegistry, PayloadOf } from './types.js';

export class TypedBus<R extends EventRegistry> {
  // Internal emitter; accessed by the plugin via `(bus as any).ee` for the
  // side-channel envelope emits. Not exposed as a public API.
  private readonly ee = new EventEmitter();

  constructor(public readonly registry: R) {
    this.ee.setMaxListeners(50);
  }

  /**
   * Subscribe to an event. Handler payload type narrows off the registry.
   * Returns an unsubscribe function.
   */
  on<T extends keyof R & string>(
    type: T,
    handler: (payload: PayloadOf<R, T>) => void | Promise<void>,
  ): () => void {
    const wrapped = (payload: unknown) => {
      void handler(payload as PayloadOf<R, T>);
    };
    this.ee.on(type, wrapped);
    return () => this.ee.off(type, wrapped);
  }

  /**
   * Emit an event. Runtime-validates the payload against the registry schema;
   * throws on unknown types or ZodError on invalid payloads.
   */
  emit<T extends keyof R & string>(type: T, payload: PayloadOf<R, T>): void {
    const entry = this.registry[type];
    if (!entry) throw new Error(`Unknown event type: ${String(type)}`);
    const parsed = entry.schema.parse(payload);
    this.ee.emit(type, parsed);
  }
}
