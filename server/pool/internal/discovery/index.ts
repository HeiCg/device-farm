/**
 * Phase 36 / Plan 36-00 — Discovery internal barrel.
 *
 * Re-exports the discovery surface for consumers INSIDE server/pool/internal/
 * (specifically server/pool/internal/module.ts in Plan 36-01). External
 * consumers must go through server/pool/index.ts per MOD-02 (dep-cruiser
 * rule 4 `no-deep-imports-into-pool-internal`).
 */
export {
  createDeviceDiscoveryService,
  type DeviceDiscoveryService,
  type PollerDeps,
} from './poller.js';
export { createAndroidAdapter } from './adapters/android.js';
export { createIosAdapter } from './adapters/ios.js';
export type { DiscoveredDevice, DiscoveryDiff, PlatformAdapter } from './types.js';
