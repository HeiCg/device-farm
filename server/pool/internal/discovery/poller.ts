/**
 * Phase 36 / Plan 36-01 — DeviceDiscoveryService factory.
 *
 *   - setInterval poll loop (default 5_000 ms) with async-mutex guard
 *     against overlapping ticks (slow adapter MUST NOT cause a second
 *     tick to enter before the first returns)
 *   - first `pollOnce()` runs immediately on `start()` (no leading wait)
 *   - fingerprint short-circuit: when the new snapshot hashes identical
 *     to the previous tick's, no emit fires (high-frequency state flap
 *     is the common case for idle pools)
 *   - emits via PoolEmitters (discoveredAdded/Removed/Changed); each
 *     event keyed by the discovered device id (serial/UDID/emulator
 *     name — discovery operates BEFORE pool admission so it has no UUID)
 *
 * Subscribers (server/pool/internal/module.ts) bridge `discovered.added`
 * → `pool.adoptDiscoveredDevice` and `discovered.removed` →
 * `pool.handleDiscoveryRemoval` so physical devices flow into the
 * pool's state machine automatically.
 */
import { Mutex } from 'async-mutex';
import { v5 as uuidv5 } from 'uuid';
import type pino from 'pino';
import type { PoolEmitters } from '../../events.js';
import { fingerprint, diff, sortDevices } from './fingerprint.js';
import type { DiscoveredDevice, PlatformAdapter } from './types.js';

/**
 * RFC 4122 URL namespace. Used with uuidv5 to derive a stable UUID per
 * discovered device id (serial / UDID / emulator-port). The envelope
 * schema requires `aggregateId` to be a UUID, but discovery operates
 * BEFORE pool admission so devices have no pool-managed UUID yet.
 *
 * Deriving uuidv5('discovery:<id>', URL_NS) is deterministic + collision-
 * resistant, mirrors the pattern used for POOL_AGGREGATE_ID +
 * REPORTING_AGGREGATE_ID + ARTIFACTS_AGGREGATE_ID elsewhere in the
 * codebase, and means subscribers can still correlate
 * device.discovered.* events with the eventual pool device.id via
 * the discovered.added payload's `device.id` field.
 */
const DISCOVERY_NAMESPACE = '6ba7b811-9dad-11d1-80b4-00c04fd430c8';

function aggregateIdFor(discoveredId: string): string {
  return uuidv5(`discovery:${discoveredId}`, DISCOVERY_NAMESPACE);
}

export interface PollerDeps {
  adapters: PlatformAdapter[];
  emit: PoolEmitters;
  logger: pino.Logger;
  /** Default 5000 ms per RESEARCH.md §DeviceDiscoveryService Design. */
  intervalMs?: number;
}

export interface DeviceDiscoveryService {
  start(): void;
  stop(): void;
  pollOnce(): Promise<void>;
  getSnapshot(): DiscoveredDevice[];
}

export function createDeviceDiscoveryService(deps: PollerDeps): DeviceDiscoveryService {
  const log = deps.logger.child({ component: 'discovery-poller' });
  const mutex = new Mutex();
  const intervalMs = deps.intervalMs ?? 5_000;

  let prev: DiscoveredDevice[] = [];
  let lastFp = '';
  let timer: NodeJS.Timeout | null = null;

  async function pollOnce(): Promise<void> {
    // Drop overlapping ticks: a slow adapter should NEVER cause two
    // poll loops to interleave (Pitfall 3 — overlapping ticks emit
    // duplicate diffs).
    if (mutex.isLocked()) {
      log.debug('pollOnce skipped — previous tick still in flight');
      return;
    }
    await mutex.runExclusive(async () => {
      const lists = await Promise.all(
        deps.adapters.map((a) =>
          a.listDevices().catch((err) => {
            log.warn({ err }, 'discovery adapter listDevices failed');
            return [] as DiscoveredDevice[];
          }),
        ),
      );

      const next = sortDevices(lists.flat());
      const fp = fingerprint(next);
      if (fp === lastFp) return;

      const d = diff(prev, next);
      for (const dev of d.added) {
        deps.emit.discoveredAdded(aggregateIdFor(dev.id), { device: dev });
      }
      for (const dev of d.removed) {
        deps.emit.discoveredRemoved(aggregateIdFor(dev.id), { device: dev });
      }
      for (const dev of d.changed) {
        deps.emit.discoveredChanged(aggregateIdFor(dev.id), { device: dev });
      }

      prev = next;
      lastFp = fp;
    });
  }

  function start(): void {
    if (timer) return;
    // Fire the first tick immediately so subscribers receive added events
    // for any devices present at boot (no 5s warm-up gap).
    void pollOnce();
    timer = setInterval(() => {
      void pollOnce();
    }, intervalMs);
  }

  function stop(): void {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  function getSnapshot(): DiscoveredDevice[] {
    return prev.slice();
  }

  return { start, stop, pollOnce, getSnapshot };
}
