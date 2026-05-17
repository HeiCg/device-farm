/**
 * Phase 24 / Plan 24-01 — Maestro module event registry + emit helpers (MOD-03).
 *
 * Declares 2 transient events emitted by the maestro module:
 *
 *   - maestro.hierarchy.fetched      (NOT persisted — high-freq UI route trigger)
 *   - maestro.device-info.collected  (NOT persisted — fires on every device.booted)
 *
 * Both transient per TRACE-08 (high-frequency derivable signals; events-table bloat
 * unacceptable; logs/metrics carry the same observability).
 *
 * aggregateType: 'maestro' on both entries.
 * aggregateId: deviceId per emission (per-device events).
 * MAESTRO_AGGREGATE_ID below is reserved for future module-wide telemetry
 * (currently unused by these 2 events — they always carry a specific deviceId).
 *
 * `createEventHelpers` (Phase 15 substrate at server/bus/helpers.ts) wraps
 * TypedBus.emit + envelope stamping (ALS-sourced correlationId) + optional
 * onEmit side-channel (used by createMaestroModule in Plan 24-03 to forward
 * to bus persistence middleware — both entries persisted:false short-circuit).
 *
 * This file is allowlisted by eslint-local-rules/no-direct-bus-emit.js
 * (pattern /\/events\.ts$/) and by the .dependency-cruiser.cjs rule
 * `no-direct-bus-emit-outside-events-ts`. All `bus.emit(...)` call sites
 * in the maestro module MUST route through these helpers.
 */
import { z } from 'zod';

import { createEventHelpers } from '../bus/helpers.js';
import type { TypedBus } from '../bus/bus.js';
import type { EventRegistry } from '../bus/types.js';
import type { Envelope } from '../events/envelope.js';

/** Event-name constants (EVENTS-03 past-tense dotted). */
export const MAESTRO_EVENT_NAMES = {
  HIERARCHY_FETCHED:     'maestro.hierarchy.fetched',
  DEVICE_INFO_COLLECTED: 'maestro.device-info.collected',
} as const;
export type MaestroEventName = typeof MAESTRO_EVENT_NAMES[keyof typeof MAESTRO_EVENT_NAMES];

/**
 * Stable v5 UUID derived from 'maestro' under the URL namespace (RFC 4122 §4.3).
 * Reserved for future module-wide telemetry; currently unused (per-device events
 * carry deviceId as aggregateId). Spec re-derives at test time and asserts match.
 *
 * Computed via: uuidv5('maestro', '6ba7b811-9dad-11d1-80b4-00c04fd430c8')
 */
export const MAESTRO_AGGREGATE_ID = 'ceb331df-a288-5be5-b801-cbdfc4deec4a' as const;

// ---------- Payload schemas ----------

/**
 * Fires from HierarchyService.getHierarchy() in maestro routes (Plan 24-03 wiring).
 * Thin payload per EVENTS-04 — element tree itself NOT in event payload.
 */
export const maestroHierarchyFetchedPayload = z.object({
  deviceId: z.string().uuid(),
  source: z.enum(['maestro-cli', 'device-server', 'native', 'appium']),
  elementCount: z.number().int().nonnegative(),
  fetchTimeMs: z.number().nonnegative(),
});

/**
 * Fires from maestro subscriber on device.booted bus event (Plan 24-03 wiring).
 * deviceInfoCollector.collect() returns metadata; this event signals the cache update.
 */
export const maestroDeviceInfoCollectedPayload = z.object({
  deviceId: z.string().uuid(),
  osVersion: z.string().nullable(),
  model: z.string().nullable(),
});

// ---------- Registry ----------
//
// Per TRACE-08 persistence policy: BOTH events transient.
//   hierarchy.fetched      — high-freq UI trigger, derivable from logs
//   device-info.collected  — high-freq boot-time, derivable from device.metadata cache state

export const maestroRegistry = {
  [MAESTRO_EVENT_NAMES.HIERARCHY_FETCHED]:     { schema: maestroHierarchyFetchedPayload,    persisted: false, aggregateType: 'maestro' },
  [MAESTRO_EVENT_NAMES.DEVICE_INFO_COLLECTED]: { schema: maestroDeviceInfoCollectedPayload, persisted: false, aggregateType: 'maestro' },
} as const satisfies EventRegistry;
export type MaestroRegistry = typeof maestroRegistry;

// ---------- Emit helpers factory ----------

/**
 * Called by createMaestroModule (Plan 24-03) to construct the 2 typed emit helpers.
 * The factory passes its own persistEnvelope-equivalent via onEmit; both entries
 * persisted:false short-circuit before db.insert.
 *
 * Callers read like:
 *   emit.hierarchyFetched(deviceId, { deviceId, source: 'device-server', elementCount: 142, fetchTimeMs: 87.3 });
 *   emit.deviceInfoCollected(deviceId, { deviceId, osVersion: '14', model: 'Pixel 6' });
 */
export function makeMaestroEmitters(
  bus: TypedBus<MaestroRegistry>,
  onEmit?: (envelope: Envelope) => void,
) {
  const emit = createEventHelpers(bus, onEmit);
  return {
    hierarchyFetched:    emit(MAESTRO_EVENT_NAMES.HIERARCHY_FETCHED),
    deviceInfoCollected: emit(MAESTRO_EVENT_NAMES.DEVICE_INFO_COLLECTED),
  };
}
export type MaestroEmitters = ReturnType<typeof makeMaestroEmitters>;
