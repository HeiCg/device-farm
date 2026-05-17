/**
 * Phase 16 / Plan 16-00 — Synthetic `test.trigger` event registry for bridge tests.
 *
 * CONTEXT: Real `device.booted` / `device.shutdown` / `job.starting` / `job.completed`
 * bus events land in Phases 20/21/23 when those modules refactor. Until then, the
 * bus→queue bridge pattern (EVENTS-09) is exercised via this synthetic `test.trigger`
 * event declared ONLY in test code. Production hooks subscribers are idle until real
 * events land.
 *
 * Usage: queue.spec.ts composes a TypedBus over this registry + the onPersisted
 * wrapper, emits `test.trigger`, and asserts the bridge handler enqueues a
 * hook.run queue job with the correct singletonKey.
 */
import { z } from 'zod';

import type { EventRegistry } from '../../../bus/types.js';

export const testTriggerPayload = z.object({
  event: z.enum(['device.booted', 'device.shutdown', 'test.before', 'test.after']),
  deviceId: z.string().uuid().nullable(),
  jobId: z.string().uuid().nullable(),
});

export const testRegistry = {
  'test.trigger': {
    schema: testTriggerPayload,
    persisted: false,       // synthetic — never goes to events table
    aggregateType: 'test',
  },
} as const satisfies EventRegistry;

export type TestRegistry = typeof testRegistry;
