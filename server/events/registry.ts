/**
 * Phase 15 / Plan 15-04 — demo event registry (fixture only).
 *
 * The substrate shipped in Plan 15-04 (TypedBus + emit helpers + bus plugin
 * with persistence/causation middleware) needs at least one registered event
 * type to exercise. Until Phase 16 (hooks pilot) wires real module events,
 * this demo registry is the only registered set of events.
 *
 * DO NOT add real domain events here. Every downstream module ships its own
 * `server/<module>/events.ts` that constructs its own registry and builds a
 * `TypedBus<ownRegistry>`. The `demoRegistry` lives exclusively to back the
 * plan 15-04 specs.
 *
 * The `as const satisfies EventRegistry` combo:
 *   - `satisfies EventRegistry` proves this object conforms to the registry
 *     shape (each entry has schema / persisted / aggregateType).
 *   - `as const` preserves the literal keys so `keyof typeof demoRegistry`
 *     is `'demo.happened' | 'demo.thinned'` (not `string`), which is what
 *     TypedBus uses for narrowing.
 */
import { z } from 'zod';

import type { EventRegistry } from '../bus/types.js';

export const demoRegistry = {
  'demo.happened': {
    schema: z.object({ value: z.number().int() }),
    persisted: true,
    aggregateType: 'demo',
  },
  'demo.thinned': {
    schema: z.object({ id: z.string().uuid() }),
    persisted: false,
    aggregateType: 'demo',
  },
} as const satisfies EventRegistry;

export type DemoRegistry = typeof demoRegistry;
