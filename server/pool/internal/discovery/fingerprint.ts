/**
 * Phase 36 / Plan 36-01 — Discovery fingerprint + diff helpers.
 *
 * Pure functions consumed by the DeviceDiscoveryService poll loop
 * (poller.ts). Pattern mirrors simvyn `packages/core/src/device-manager.ts`
 * lines 18-33.
 *
 *   - `sortDevices`  — deterministic order: booted first, then platform
 *                      alpha, then name alpha. Guarantees stable
 *                      fingerprints across poll ticks regardless of
 *                      adapter-reported order.
 *   - `fingerprint`  — stable string over the sorted snapshot. Used by
 *                      the poller to short-circuit emission when nothing
 *                      changed.
 *   - `diff`         — classifies device-set deltas as added / removed /
 *                      changed. O(n) via two Maps keyed by device id.
 */
import type { DiscoveredDevice, DiscoveryDiff } from './types.js';

/**
 * Stable sort: booted-first, then platform alpha, then name alpha.
 * Returns a new array; does not mutate input.
 */
export function sortDevices(devices: DiscoveredDevice[]): DiscoveredDevice[] {
  return [...devices].sort((a, b) => {
    // 1. booted before non-booted
    const aBooted = a.state === 'booted' ? 0 : 1;
    const bBooted = b.state === 'booted' ? 0 : 1;
    if (aBooted !== bBooted) return aBooted - bBooted;

    // 2. platform alpha (android before ios)
    if (a.platform !== b.platform) {
      return a.platform < b.platform ? -1 : 1;
    }

    // 3. name alpha
    if (a.name !== b.name) {
      return a.name < b.name ? -1 : 1;
    }

    // 4. id alpha as final tiebreaker (so the sort is total)
    if (a.id !== b.id) {
      return a.id < b.id ? -1 : 1;
    }
    return 0;
  });
}

/**
 * Stable string fingerprint of a device snapshot. Two snapshots with the
 * same set of (id, state) pairs produce the same string regardless of
 * input order. Snapshots with any state delta produce different strings.
 *
 * Internally sorts via `sortDevices` so order in the input does not
 * matter — the poller can short-circuit emission whenever this returns
 * the same value as the previous tick.
 */
export function fingerprint(devices: DiscoveredDevice[]): string {
  const sorted = sortDevices(devices);
  return JSON.stringify(sorted.map((d) => `${d.id}:${d.state}`));
}

/**
 * Classify deltas between two device snapshots.
 *   - added:   ids present in `next` but not in `prev`.
 *   - removed: ids present in `prev` but not in `next`.
 *   - changed: ids in both with ANY field delta (state/name/osVersion/model/deviceType/platform).
 *
 * O(n + m) via two id-keyed Maps. Returns `next` snapshots for added +
 * changed, `prev` snapshots for removed.
 */
export function diff(
  prev: DiscoveredDevice[],
  next: DiscoveredDevice[],
): DiscoveryDiff {
  const prevById = new Map<string, DiscoveredDevice>();
  for (const d of prev) prevById.set(d.id, d);

  const nextById = new Map<string, DiscoveredDevice>();
  for (const d of next) nextById.set(d.id, d);

  const added: DiscoveredDevice[] = [];
  const changed: DiscoveredDevice[] = [];
  const removed: DiscoveredDevice[] = [];

  for (const [id, nextDev] of nextById) {
    const prevDev = prevById.get(id);
    if (!prevDev) {
      added.push(nextDev);
    } else if (!devicesEqual(prevDev, nextDev)) {
      changed.push(nextDev);
    }
  }

  for (const [id, prevDev] of prevById) {
    if (!nextById.has(id)) {
      removed.push(prevDev);
    }
  }

  return { added, removed, changed };
}

function devicesEqual(a: DiscoveredDevice, b: DiscoveredDevice): boolean {
  return (
    a.id === b.id &&
    a.name === b.name &&
    a.platform === b.platform &&
    a.state === b.state &&
    a.deviceType === b.deviceType &&
    a.osVersion === b.osVersion &&
    a.model === b.model
  );
}
