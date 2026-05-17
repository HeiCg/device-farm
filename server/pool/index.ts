/**
 * Phase 20 / Plan 20-05 — Pool module public barrel (MOD-02).
 *
 * This is the ONLY import surface for consumers outside `server/pool/`.
 * `dependency-cruiser` rule `no-deep-imports-into-pool-internal` (added
 * to `.dependency-cruiser.cjs` in Phase 20 Plan 20-00) enforces the boundary
 * structurally — imports into `server/pool/internal/**` from outside
 * the module fail CI.
 *
 * Exports in this file are PUBLIC and subject to semver-ish stability.
 * Anything under `./internal/` is module-private and may change without notice.
 *
 * The ONLY allowed internal/ re-export line is the factory entry point per
 * MOD-06. Runtime + types exported from a single statement (inline `type`
 * modifier) so plan 20-05 verify script sees exactly ONE internal/ re-export
 * line (MOD-02 structural invariant). Matches Phase 18 lifecycle + Phase 19
 * reporting 1-line form, stricter than Phase 16 hooks' 2-line form.
 */

// Fastify plugin (default export — matches Phase 15 substrate convention).
export { default as poolPlugin } from './plugin.js';

// Factory surface (the v3.0 canonical way to instantiate the module). MOD-06.
// ONE internal/ re-export line — MOD-02 structural invariant.
export { createPoolModule, type PoolModule, type CreatePoolModuleDeps } from './internal/module.js';

// Phase 36 / Plan 36-02 — public re-exports for API-layer consumers
// (server/api/pairing.ts + server/api/devices-stream.ts). Keeps the
// MOD-02 boundary intact: API reaches discovery/wireless via the public
// barrel rather than deep-imports into internal/.
export type {
  PairingService,
  PairingSession,
  PairingSessionState,
} from './internal/wireless/index.js';
export type {
  DiscoveredDevice,
  DeviceDiscoveryService,
} from './internal/discovery/index.js';

// Back-compat class surfaces (preserved for existing consumers — PoolManager
// decorator on fastify is still read by api/jobs/maestro/hooks/streaming).
export { PoolManager } from './pool-manager.js';
export { HealthChecker } from './health-checker.js';
export { ProcessTracker } from './process-tracker.js';
export type { OrphanInfo, KillResult } from './process-tracker.js';
// Phase 24 / Plan 24-03 — DeviceInfoCollector relocated to server/maestro/internal/.
// (Maestro concern — consumers reach it via fastify.maestroModule.deviceInfoCollector
// decorator or via the maestro module barrel. Pool no longer re-exports it.)
export { Device, InvalidTransitionError } from './device.js';

// Schemas + derived TS types (Phase 17 SPEC-06 unchanged; Phase 36 adds discovery primitives).
export {
  deviceStateSchema,
  platformSchema,
  deviceMetadataSchema,
  deviceSummarySchema,
  deviceListSchema,
  // Phase 36 / Plan 36-00 — discovery primitives.
  discoveredDeviceStateSchema,
  discoveredDeviceTypeSchema,
  discoveredDevicePayloadSchema,
} from './schemas.js';
export type { DeviceSummary, DiscoveredDevicePayload } from './schemas.js';

// Events surface (MOD-03 — Plan 20-01; Phase 24 adds booted; Phase 36 adds discovery + pairing).
export {
  poolRegistry,
  POOL_EVENT_NAMES,
  POOL_AGGREGATE_ID,
  makePoolEmitters,
  deviceStateChangedPayload,
  deviceAllocatedPayload,
  deviceReleasedPayload,
  deviceHealthFailedPayload,
  deviceBootedPayload,
  // Phase 36 / Plan 36-00 — discovery + pairing payload schemas.
  deviceDiscoveredAddedPayload,
  deviceDiscoveredRemovedPayload,
  deviceDiscoveredChangedPayload,
  devicePairAttemptedPayload,
} from './events.js';
export type { PoolRegistry, PoolEmitters, PoolEventName } from './events.js';

// Queue surface (QUEUE-06 — Plan 20-03).
export {
  DEVICE_REAP_QUEUE_NAME,
  DEVICE_BOOT_QUEUE_NAME,
  REAP_CRON,
  registerPoolQueues,
} from './queue.js';
export type {
  RegisterPoolQueuesDeps,
  PoolQueueRegistration,
} from './queue.js';

// NOTE: Types `DeviceDriver` / `DeviceState` / `VALID_TRANSITIONS` / `Platform`
// / `DeviceInfo` / `DeviceMetadata` live in `server/types/index.ts` (global types),
// not in pool. Consumers import those from `../types/index.js` directly.
