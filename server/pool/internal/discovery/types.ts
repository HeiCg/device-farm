/**
 * Phase 36 / Plan 36-00 — Discovery module type contracts (stub).
 *
 * Bodies for `fingerprint`/`diff`/`sortDevices` land in Plan 36-01 (DISC-SVC);
 * the `PlatformAdapter` interface is implemented by:
 *   - server/pool/internal/discovery/adapters/android.ts (Plan 36-01)
 *   - server/pool/internal/discovery/adapters/ios.ts (Plan 36-01)
 *
 * The `DiscoveredDevice` type re-uses the Zod-validated payload schema from
 * server/pool/schemas.ts so changes propagate automatically.
 */
import type { z } from 'zod';
import type { discoveredDevicePayloadSchema } from '../../schemas.js';

export type DiscoveredDevice = z.infer<typeof discoveredDevicePayloadSchema>;

export interface DiscoveryDiff {
  /** IDs present in `next` but not in `prev`. */
  added: DiscoveredDevice[];
  /** IDs present in `prev` but not in `next`. */
  removed: DiscoveredDevice[];
  /** IDs in both with one or more field deltas (state/osVersion/model/name). */
  changed: DiscoveredDevice[];
}

/**
 * Platform-specific adapter — the only legitimate caller of bare
 * `adb devices` / `simctl list devices` per dep-cruiser rule 13
 * (`no-bare-adb-list-outside-discovery`). Per-device probes
 * (`adb -s <serial> get-state`, `xcrun simctl <udid>`) are unrestricted.
 */
export interface PlatformAdapter {
  listDevices(): Promise<DiscoveredDevice[]>;
}
