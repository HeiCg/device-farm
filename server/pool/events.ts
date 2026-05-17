/**
 * Phase 20 / Plan 20-01 — Pool module event registry + emit helpers (MOD-03).
 *
 * Declares the 4 device-lifecycle events that every downstream module
 * (jobs, artifacts, maestro, hooks, streaming — Phases 21+) will subscribe
 * to via `fastify.bus.on` or `fastify.onPersisted`:
 *
 *   - device.state.changed   (high-freq, NOT persisted) — fires on every
 *     VALID_TRANSITIONS-allowed transition from PoolManager call sites +
 *     HealthChecker recovery paths
 *   - device.allocated       (NOT persisted) — thin allocator signal
 *   - device.released        (NOT persisted) — thin release signal
 *   - device.health.failed   (PERSISTED — TRACE-08 operational telemetry) —
 *     HealthChecker probe-failure; carries `reason` discriminator +
 *     failure count + replacement flag
 *
 * Persistence policy per TRACE-08:
 *   - state.changed / allocated / released: NOT persisted (high-frequency;
 *     derivable from state.changed; events-table bloat unacceptable)
 *   - health.failed: PERSISTED (low-frequency operational telemetry;
 *     Phase 27 trace-tree + Phase 23 jobs keystone both consume)
 *
 * aggregateType: 'pool' on all 4 entries (singleton — the pool module).
 * aggregateId: deviceId (per-device) for ALL 4 events. POOL_AGGREGATE_ID
 * (v5 UUID from 'pool') is reserved for future pool-wide telemetry
 * (e.g. pool.initialized) but NOT used by the 4 events above — they always
 * carry a specific deviceId.
 *
 * `createEventHelpers` (Phase 15 substrate at server/bus/helpers.ts) wraps
 * TypedBus.emit + envelope stamping (ALS-sourced correlationId) + optional
 * onEmit side-channel (used by the module factory in plan 20-03 to forward
 * to bus persistence middleware).
 *
 * This file is allowlisted by eslint-local-rules/no-direct-bus-emit.js
 * (pattern /\/events\.ts$/) and by the .dependency-cruiser.cjs rule
 * `no-direct-bus-emit-outside-events-ts`. All `bus.emit(...)` call sites
 * in the pool module MUST route through these helpers.
 */
import { z } from 'zod';

import { createEventHelpers } from '../bus/helpers.js';
import type { TypedBus } from '../bus/bus.js';
import type { EventRegistry } from '../bus/types.js';
import type { Envelope } from '../events/envelope.js';
import {
  deviceStateSchema,
  platformSchema,
  discoveredDevicePayloadSchema,
} from './schemas.js';

/** Event-name constants (EVENTS-03 past-tense dotted). */
export const POOL_EVENT_NAMES = {
  STATE_CHANGED: 'device.state.changed',
  ALLOCATED:     'device.allocated',
  RELEASED:      'device.released',
  HEALTH_FAILED: 'device.health.failed',
  /**
   * Phase 24 / Plan 24-01 — added with full body (payload schema + registry
   * entry + booted helper inside makePoolEmitters). Plan 24-02 wires 4
   * emit-sites in pool-manager.ts at Booting→Idle transitions.
   */
  BOOTED:        'device.booted',
  /**
   * Phase 36 / Plan 36-00 — discovery events emitted by the DeviceDiscoveryService
   * (server/pool/internal/discovery/poller.ts, body lands in Plan 36-01). Wave 0
   * registers the names + payload schemas + emit helpers; subscribers in
   * server/api/devices-stream.ts (Plan 36-02) and the web devices store rely on
   * these being present at the type level before their bodies are written.
   *
   * Persistence policy (TRACE-08):
   *   - added / removed: PERSISTED (low-frequency, security-relevant — operator
   *     wants an audit trail of "what physical device joined / left the lab").
   *   - changed: NOT persisted (high-frequency state flap; derivable from added).
   */
  DISCOVERED_ADDED:   'device.discovered.added',
  DISCOVERED_REMOVED: 'device.discovered.removed',
  DISCOVERED_CHANGED: 'device.discovered.changed',
  /**
   * Phase 36 / Plan 36-00 — wireless-pairing audit event emitted by the
   * pairing service (server/pool/internal/wireless/session.ts body lands in
   * Plan 36-02). PERSISTED — every pair attempt is operationally relevant
   * (security: a failed auth indicates someone scanned a stale QR; success
   * indicates a new physical device joined the lab).
   */
  PAIR_ATTEMPTED:     'device.pair.attempted',
} as const;

export type PoolEventName = typeof POOL_EVENT_NAMES[keyof typeof POOL_EVENT_NAMES];

/**
 * Fixed singleton UUID for pool-wide telemetry events (reserved — per-device
 * events carry deviceId as aggregateId). Stable v5 UUID derived from the
 * string 'pool' under the URL namespace (RFC 4122 §4.3). Matches the
 * derivation pattern Phase 18 established with LIFECYCLE_AGGREGATE_ID
 * + Phase 19 REPORTING_AGGREGATE_ID.
 *
 * Value computed via `uuidv5('pool', '6ba7b811-9dad-11d1-80b4-00c04fd430c8')`.
 * Spec `events.spec.ts` re-derives at test time and asserts exact match —
 * this hardcoded literal is a single source of truth grep-friendly symbol.
 */
export const POOL_AGGREGATE_ID = '2a120cd5-4bd3-5f65-a9e5-870ec709e44a' as const;

// ---------- Payload schemas ----------

/**
 * Fires on every VALID_TRANSITIONS-gated state change. Emitted by PoolManager
 * (allocate/release/markRunning/addDevice/initPool/replaceDevice) and by
 * HealthChecker (restart/replaceZombieDevice paths). Per RESEARCH §Pattern 2,
 * emit AFTER `device.transition()` succeeds.
 */
export const deviceStateChangedPayload = z.object({
  deviceId: z.string().uuid(),
  from: deviceStateSchema,
  to: deviceStateSchema,
});

/**
 * Fires from PoolManager.allocate() inside allocateMutex, AFTER
 * `device.allocate(jobId)` succeeds. Thin payload per EVENTS-04.
 */
export const deviceAllocatedPayload = z.object({
  deviceId: z.string().uuid(),
  jobId: z.string(),
  platform: platformSchema,
});

/**
 * Fires from PoolManager.release() after `device.release()` returns.
 * jobId captured BEFORE release() clears currentJobId, so consumers who
 * want to link the release to its originating job can. If the device was
 * never allocated (edge case), jobId is null.
 */
export const deviceReleasedPayload = z.object({
  deviceId: z.string().uuid(),
  jobId: z.string().nullable(),
  platform: platformSchema,
});

/**
 * Fires on EVERY failed health probe, regardless of whether the device's
 * state actually changes (RESEARCH §Pitfall 2 — state transitions are
 * conditional on current state; health.failed is unconditional).
 *
 * `reason` discriminates the failure path:
 *   - 'unhealthy'    — regular probe returned false (Running → Error path)
 *   - 'zombie'       — isDeviceZombie() returned true (replaceZombieDevice path)
 *   - 'max-retries'  — failureCount > MAX_RETRIES (Error → Offline path)
 *   - 'timeout'      — driver.isHealthy() threw (wrapped withTimeout reject)
 *
 * `willReplace` indicates whether HealthChecker will trigger a replacement
 * boot (zombie path) or mark the device terminal (max-retries / unhealthy
 * without zombie → backoff).
 *
 * `lastError` is the error message caught (if any); null on clean unhealthy
 * response with no thrown exception.
 */
export const deviceHealthFailedPayload = z.object({
  deviceId: z.string().uuid(),
  platform: platformSchema,
  reason: z.enum(['unhealthy', 'zombie', 'max-retries', 'timeout']),
  failureCount: z.number().int().nonnegative(),
  willReplace: z.boolean(),
  lastError: z.string().nullable(),
});

/**
 * Fires from PoolManager state-machine sites at Booting→Idle transition
 * (Phase 24 / Plan 24-02 wires 4 emission sites: addDevice, initPool inner
 * loop, adoptDiscoveredDevice (Phase 36 — replaces detectPhysicalDevices),
 * replaceDevice). Per RESEARCH §Pitfall 1
 * (Phase 20 inheritance) — emit AFTER mutation success.
 *
 * Thin payload per EVENTS-04; subscribers re-fetch via pool.getDevice(deviceId)
 * if they need extra fields (matches device.allocated shape).
 *
 * `port` nullable: physical Android devices have no emulator port.
 *
 * Persistence: transient (derivable from device.state.changed Booting→Idle).
 */
export const deviceBootedPayload = z.object({
  deviceId: z.string().uuid(),
  platform: platformSchema,
  emulatorId: z.string(),
  port: z.number().int().nullable(),
});

/**
 * Phase 36 / Plan 36-00 — discovery diff payloads.
 *
 * Each carries the full DiscoveredDevice snapshot (id, name, platform, state,
 * deviceType, osVersion, model). Discovery aggregateId is the device's
 * discovered id (serial / udid / emulator name) — distinct from the pool's
 * UUID-based deviceId because discovery operates before pool admission.
 *
 * Subscribers (e.g. server/api/devices-stream.ts in Plan 36-02 and the web
 * deviceStore in Plan 36-03) re-broadcast as WS frames; persisted variants
 * (added / removed) land in the `events` table for audit.
 */
export const deviceDiscoveredAddedPayload = z.object({
  device: discoveredDevicePayloadSchema,
});

export const deviceDiscoveredRemovedPayload = z.object({
  device: discoveredDevicePayloadSchema,
});

export const deviceDiscoveredChangedPayload = z.object({
  device: discoveredDevicePayloadSchema,
});

/**
 * Phase 36 / Plan 36-00 — wireless pairing audit payload.
 *
 * `sessionId` correlates the attempt to a pairing session (server/pool/internal/
 * wireless/session.ts in Plan 36-02). `outcome` discriminates the failure
 * path for operator triage:
 *   - success      — adb pair returned ok=true + adb connect succeeded
 *   - auth-fail    — adb pair stderr matched "failed to authenticate"
 *   - timeout      — adb pair exceeded 30s
 *   - cross-subnet — mDNS resolved to an IP outside the host /24 (rejected
 *                    pre-pair per network hygiene)
 *   - unknown      — any other error (logged with rawStderr by the service)
 *
 * `actor` is the ALS-stamped actor (Phase 26 substrate — usually apikey:* for
 * operator-driven pairing, system for boot-time auto-pair attempts).
 */
export const devicePairAttemptedPayload = z.object({
  sessionId: z.string().uuid(),
  host: z.string(),
  port: z.number().int().positive(),
  outcome: z.enum(['success', 'auth-fail', 'timeout', 'cross-subnet', 'unknown']),
  actor: z.string(),
});

// ---------- Registry ----------
//
// Per TRACE-08 persistence policy:
//   state.changed / allocated / released / booted — NOT persisted (high-freq;
//     derivable from state.changed alone if needed)
//   health.failed — PERSISTED (operational telemetry; Phase 27 trace-tree)

export const poolRegistry = {
  [POOL_EVENT_NAMES.STATE_CHANGED]:     { schema: deviceStateChangedPayload,     persisted: false, aggregateType: 'pool' },
  [POOL_EVENT_NAMES.ALLOCATED]:         { schema: deviceAllocatedPayload,        persisted: false, aggregateType: 'pool' },
  [POOL_EVENT_NAMES.RELEASED]:          { schema: deviceReleasedPayload,         persisted: false, aggregateType: 'pool' },
  [POOL_EVENT_NAMES.HEALTH_FAILED]:     { schema: deviceHealthFailedPayload,     persisted: true,  aggregateType: 'pool' },
  [POOL_EVENT_NAMES.BOOTED]:            { schema: deviceBootedPayload,           persisted: false, aggregateType: 'pool' }, // Phase 24 / Plan 24-01
  // Phase 36 / Plan 36-00 — discovery + pairing audit events.
  [POOL_EVENT_NAMES.DISCOVERED_ADDED]:  { schema: deviceDiscoveredAddedPayload,  persisted: true,  aggregateType: 'pool' },
  [POOL_EVENT_NAMES.DISCOVERED_REMOVED]:{ schema: deviceDiscoveredRemovedPayload,persisted: true,  aggregateType: 'pool' },
  [POOL_EVENT_NAMES.DISCOVERED_CHANGED]:{ schema: deviceDiscoveredChangedPayload,persisted: false, aggregateType: 'pool' },
  [POOL_EVENT_NAMES.PAIR_ATTEMPTED]:    { schema: devicePairAttemptedPayload,    persisted: true,  aggregateType: 'pool' },
} as const satisfies EventRegistry;

export type PoolRegistry = typeof poolRegistry;

// ---------- Emit helpers factory ----------

/**
 * Called by createPoolModule (plan 20-03) to construct the 4 typed emit
 * helpers. The factory passes its own `persistEnvelope`-equivalent via
 * `onEmit` so persisted events (health.failed) land in the `events` table
 * per TRACE-08.
 *
 * Callers read like:
 *   emit.stateChanged(deviceId, { deviceId, from: 'booting', to: 'idle' });
 *   emit.allocated(deviceId, { deviceId, jobId, platform: 'android' });
 *   emit.healthFailed(deviceId, { deviceId, platform, reason: 'unhealthy', failureCount: 2, willReplace: false, lastError: null });
 */
export function makePoolEmitters(
  bus: TypedBus<PoolRegistry>,
  onEmit?: (envelope: Envelope) => void,
) {
  const emit = createEventHelpers(bus, onEmit);
  return {
    stateChanged:       emit(POOL_EVENT_NAMES.STATE_CHANGED),
    allocated:          emit(POOL_EVENT_NAMES.ALLOCATED),
    released:           emit(POOL_EVENT_NAMES.RELEASED),
    healthFailed:       emit(POOL_EVENT_NAMES.HEALTH_FAILED),
    booted:             emit(POOL_EVENT_NAMES.BOOTED), // Phase 24 / Plan 24-01
    // Phase 36 / Plan 36-00 — discovery + pairing helpers.
    discoveredAdded:    emit(POOL_EVENT_NAMES.DISCOVERED_ADDED),
    discoveredRemoved:  emit(POOL_EVENT_NAMES.DISCOVERED_REMOVED),
    discoveredChanged:  emit(POOL_EVENT_NAMES.DISCOVERED_CHANGED),
    pairAttempted:      emit(POOL_EVENT_NAMES.PAIR_ATTEMPTED),
  };
}

export type PoolEmitters = ReturnType<typeof makePoolEmitters>;
