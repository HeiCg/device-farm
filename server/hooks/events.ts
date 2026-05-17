/**
 * Phase 16 / Plan 16-00 — Hooks module event registry + emit helpers (MOD-03, EVENTS-06).
 *
 * Declares the 4 events the hooks module publishes:
 *   - hook.scheduled             (thin, NOT persisted; fired when a bus trigger enqueues a hook.run job)
 *   - hook.completed             (terminal, persisted; fired after a successful execFile)
 *   - hook.failed                (transient, NOT persisted; per-attempt failure before retry)
 *   - hook.failed.retryExhausted (terminal, persisted; after pg-boss exhausts retries)
 *
 * `persisted: true` only on terminal events per TRACE-08. `aggregateType: 'hook'` on all.
 * `createEventHelpers` (phase 15 substrate) wraps `TypedBus.emit` + envelope stamping +
 * optional `onEmit` side-channel (used by plugin to forward to bus persistence middleware).
 *
 * This file is allowlisted by eslint-local-rules/no-direct-bus-emit.js (/\/events\.ts$/).
 * All `bus.emit(...)` call sites in the hooks module MUST route through these helpers.
 */
import { z } from 'zod';

import { createEventHelpers } from '../bus/helpers.js';
import type { TypedBus } from '../bus/bus.js';
import type { EventRegistry } from '../bus/types.js';
import type { Envelope } from '../events/envelope.js';

/** Event-name constants. Use these anywhere the literal string is referenced. */
export const HOOK_EVENT_NAMES = {
  SCHEDULED: 'hook.scheduled',
  COMPLETED: 'hook.completed',
  FAILED: 'hook.failed',
  FAILED_RETRY_EXHAUSTED: 'hook.failed.retryExhausted',
} as const;

export type HookEventName = typeof HOOK_EVENT_NAMES[keyof typeof HOOK_EVENT_NAMES];

// ---------- Payload schemas ----------

export const hookScheduledPayload = z.object({
  hookName: z.string().min(1),
  event: z.string().min(1),         // HookEvent string (device.booted | device.shutdown | test.before | test.after | test.trigger fixture)
  deviceId: z.string().uuid().nullable(),
  jobId: z.string().uuid().nullable(),
});

export const hookCompletedPayload = hookScheduledPayload.extend({
  exitCode: z.number().int(),
  durationMs: z.number().int().nonnegative(),
  stderrTail: z.string(),           // last ≤1KB of stderr
});

export const hookFailedPayload = hookCompletedPayload;   // same shape; different semantics (per-attempt vs terminal-success)

export const hookFailedRetryExhaustedPayload = hookCompletedPayload.extend({
  attempts: z.number().int().positive(),
});

// ---------- Registry ----------

export const hooksRegistry = {
  [HOOK_EVENT_NAMES.SCHEDULED]:              { schema: hookScheduledPayload,            persisted: false, aggregateType: 'hook' },
  [HOOK_EVENT_NAMES.COMPLETED]:              { schema: hookCompletedPayload,            persisted: true,  aggregateType: 'hook' },
  [HOOK_EVENT_NAMES.FAILED]:                 { schema: hookFailedPayload,               persisted: false, aggregateType: 'hook' },
  [HOOK_EVENT_NAMES.FAILED_RETRY_EXHAUSTED]: { schema: hookFailedRetryExhaustedPayload, persisted: true,  aggregateType: 'hook' },
} as const satisfies EventRegistry;

export type HooksRegistry = typeof hooksRegistry;

// ---------- Emit helpers factory ----------

/**
 * Called by the hooks-module factory to construct the 4 typed emit helpers.
 * The factory passes its own `persistEnvelope`-equivalent via `onEmit` so
 * persisted events land in the `events` table per TRACE-08.
 *
 * Returns an object with per-event helpers so callers read like:
 *   emit.completed(aggregateId, { hookName, event, ..., exitCode, durationMs, stderrTail });
 */
export function makeHookEmitters(
  bus: TypedBus<HooksRegistry>,
  onEmit?: (envelope: Envelope) => void,
) {
  const emit = createEventHelpers(bus, onEmit);
  return {
    scheduled:       emit('hook.scheduled'),
    completed:       emit('hook.completed'),
    failed:          emit('hook.failed'),
    retryExhausted:  emit('hook.failed.retryExhausted'),
  };
}

export type HookEmitters = ReturnType<typeof makeHookEmitters>;
