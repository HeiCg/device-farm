/**
 * Phase 18 / Plan 18-01 — Lifecycle module event registry + emit helpers (MOD-03).
 *
 * Declares the 4 operational-telemetry events the lifecycle module publishes:
 *   - lifecycle.compression.completed   (terminal, persisted)
 *   - lifecycle.retention.completed     (terminal, persisted)
 *   - lifecycle.disk.checked            (terminal, persisted)
 *   - lifecycle.task.failed             (terminal, persisted)
 *
 * All 4 are `persisted: true` per TRACE-08 (terminal operational events —
 * observable in Phase 27's GET /api/events?correlationId=… trace-tree).
 * aggregateType: 'lifecycle' on every entry (singleton aggregate — the module).
 *
 * NOTE on aggregateId: the envelope schema (server/events/envelope.ts) requires
 * `aggregateId: z.string().uuid()`. The lifecycle module is a singleton aggregate
 * ("there is one lifecycle module"), so callers pass the fixed nil-adjacent UUID
 * `LIFECYCLE_AGGREGATE_ID` exported below. This preserves singleton semantics
 * while satisfying envelope validation (deviation from plan 18-01 RESEARCH which
 * suggested a bare string literal 'lifecycle' — would have failed envelopeSchema.parse).
 *
 * `createEventHelpers` (Phase 15 substrate) wraps TypedBus.emit + envelope
 * stamping (ALS-sourced correlationId) + optional onEmit side-channel
 * (used by the module factory in plan 18-03 to forward to bus persistence
 * middleware for the `events` table).
 *
 * This file is allowlisted by eslint-local-rules/no-direct-bus-emit.js
 * (pattern /\/events\.ts$/) and by the .dependency-cruiser.cjs rule
 * `no-direct-bus-emit-outside-events-ts`. All `bus.emit(...)` call sites
 * in the lifecycle module MUST route through these helpers.
 */
import { z } from 'zod';

import { createEventHelpers } from '../bus/helpers.js';
import type { TypedBus } from '../bus/bus.js';
import type { EventRegistry } from '../bus/types.js';
import type { Envelope } from '../events/envelope.js';

import {
  compressionResultSchema,
  retentionResultSchema,
  diskPressureResultSchema,
} from './schemas.js';

/** Event-name constants. Use these anywhere the literal string is referenced. */
export const LIFECYCLE_EVENT_NAMES = {
  COMPRESSION_COMPLETED: 'lifecycle.compression.completed',
  RETENTION_COMPLETED:   'lifecycle.retention.completed',
  DISK_CHECKED:          'lifecycle.disk.checked',
  TASK_FAILED:           'lifecycle.task.failed',
} as const;

export type LifecycleEventName = typeof LIFECYCLE_EVENT_NAMES[keyof typeof LIFECYCLE_EVENT_NAMES];

/**
 * Fixed singleton UUID for the lifecycle aggregate. The lifecycle module is a
 * singleton (one module per server) so every event shares one aggregateId.
 * Envelope schema requires a valid UUID (Zod 4's strict UUID regex rejects the
 * nil UUID with custom suffix) — this is a stable v5 UUID derived from the
 * string 'lifecycle' under the URL namespace (RFC 4122 §4.3). Any consumer
 * wanting to group events by module can equivalently filter
 * `aggregateType === 'lifecycle'`.
 */
export const LIFECYCLE_AGGREGATE_ID = 'a9c1a64b-f0c7-54fb-8153-d48ca3f6e97e' as const;

// ---------- Payload schemas ----------
// Terminal telemetry payloads extend the task-result schemas (from schemas.ts)
// with `durationMs` — the wall-clock time the task took. Stamped by the worker
// handler (plan 18-02) using `Date.now() - started`.

export const compressionCompletedPayload = compressionResultSchema.extend({
  durationMs: z.number().int().nonnegative(),
});

export const retentionCompletedPayload = retentionResultSchema.extend({
  durationMs: z.number().int().nonnegative(),
});

export const diskCheckedPayload = diskPressureResultSchema.extend({
  durationMs: z.number().int().nonnegative(),
});

export const taskFailedPayload = z.object({
  task: z.enum(['compression', 'retention', 'disk-pressure']),
  error: z.string(),
  durationMs: z.number().int().nonnegative(),
});

// ---------- Registry ----------

export const lifecycleRegistry = {
  [LIFECYCLE_EVENT_NAMES.COMPRESSION_COMPLETED]: { schema: compressionCompletedPayload, persisted: true, aggregateType: 'lifecycle' },
  [LIFECYCLE_EVENT_NAMES.RETENTION_COMPLETED]:   { schema: retentionCompletedPayload,   persisted: true, aggregateType: 'lifecycle' },
  [LIFECYCLE_EVENT_NAMES.DISK_CHECKED]:          { schema: diskCheckedPayload,          persisted: true, aggregateType: 'lifecycle' },
  [LIFECYCLE_EVENT_NAMES.TASK_FAILED]:           { schema: taskFailedPayload,           persisted: true, aggregateType: 'lifecycle' },
} as const satisfies EventRegistry;

export type LifecycleRegistry = typeof lifecycleRegistry;

// ---------- Emit helpers factory ----------

/**
 * Called by the lifecycle-module factory (plan 18-03) to construct the 4 typed
 * emit helpers. The factory passes its own `persistEnvelope`-equivalent via
 * `onEmit` so persisted events land in the `events` table per TRACE-08.
 *
 * Returns an object with per-event helpers so callers read like:
 *   emit.compressionCompleted(LIFECYCLE_AGGREGATE_ID, { compressed, savedBytes, durationMs });
 */
export function makeLifecycleEmitters(
  bus: TypedBus<LifecycleRegistry>,
  onEmit?: (envelope: Envelope) => void,
) {
  const emit = createEventHelpers(bus, onEmit);
  return {
    compressionCompleted: emit(LIFECYCLE_EVENT_NAMES.COMPRESSION_COMPLETED),
    retentionCompleted:   emit(LIFECYCLE_EVENT_NAMES.RETENTION_COMPLETED),
    diskChecked:          emit(LIFECYCLE_EVENT_NAMES.DISK_CHECKED),
    taskFailed:           emit(LIFECYCLE_EVENT_NAMES.TASK_FAILED),
  };
}

export type LifecycleEmitters = ReturnType<typeof makeLifecycleEmitters>;
