/**
 * Phase 36 / Plan 36-01 — Android discovery adapter.
 *
 * SOLE legitimate caller of bare `adb devices` per dep-cruiser rule 13
 * (`no-bare-adb-list-outside-discovery`) and the runtime grep-guard spec
 * at server/pool/__tests__/discovery-sole-caller.spec.ts.
 *
 * Per-device probes (`adb -s <serial> ...`) are unrestricted and remain in
 * the existing driver call-sites — only the bare list-all call is centralised
 * here. See 36-RESEARCH.md §Platform adapter shape.
 *
 * Security: shells out via `child_process.execFile` argv form (NEVER the
 * shell-form variant) so no shell-injection surface exists.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type pino from 'pino';
import type { PlatformAdapter, DiscoveredDevice } from '../types.js';

const execFileAsync = promisify(execFile);

/**
 * Module-level caches for per-device static properties (model, OS version).
 * These rarely change for a given serial across the lifetime of the daemon,
 * so caching avoids re-running `adb -s X shell getprop ...` on every 5s tick
 * (Pitfall 4 — per-device probes are slow; cache aggressively).
 */
const modelCache = new Map<string, string | null>();
const osCache = new Map<string, string | null>();

/**
 * Map an `adb devices` status word to a DiscoveredDevice state:
 *   - device       → booted   (online + authorised)
 *   - unauthorized → unauthorized (USB debugging not yet allowed on device)
 *   - everything   → offline  (offline/no permissions/etc.)
 */
function mapAdbStatus(status: string): DiscoveredDevice['state'] {
  if (status === 'device') return 'booted';
  if (status === 'unauthorized') return 'unauthorized';
  return 'offline';
}

async function getEmulatorAvdName(serial: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('adb', [
      '-s', serial, 'emu', 'avd', 'name',
    ], { timeout: 5_000 });
    const name = stdout.trim().split('\n')[0]?.trim();
    return name && name.length > 0 ? name : null;
  } catch {
    return null;
  }
}

async function getProp(serial: string, prop: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('adb', [
      '-s', serial, 'shell', 'getprop', prop,
    ], { timeout: 5_000 });
    const value = stdout.trim();
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

export function createAndroidAdapter(logger: pino.Logger): PlatformAdapter {
  const log = logger.child({ component: 'discovery-android' });

  return {
    async listDevices(): Promise<DiscoveredDevice[]> {
      let stdout: string;
      try {
        const result = await execFileAsync('adb', ['devices'], { timeout: 10_000 });
        stdout = result.stdout;
      } catch (err) {
        log.warn({ err }, 'adb devices failed; returning empty device list');
        return [];
      }

      const lines = stdout.split('\n');
      const out: DiscoveredDevice[] = [];

      for (let i = 0; i < lines.length; i++) {
        const raw = lines[i];
        const line = raw.trim();
        // Skip header, empty lines, and daemon diagnostic lines (start with '*').
        if (!line) continue;
        if (i === 0 && line.toLowerCase().startsWith('list of devices')) continue;
        if (line.startsWith('*')) continue;

        const parts = line.split('\t');
        if (parts.length < 2) continue;

        const serial = parts[0].trim();
        const status = parts[1].trim().split(/\s+/)[0];
        if (!serial) continue;

        const state = mapAdbStatus(status);
        const isEmulator = serial.startsWith('emulator-');

        if (isEmulator) {
          const avdName = await getEmulatorAvdName(serial);
          out.push({
            id: serial,
            name: avdName ?? serial,
            platform: 'android',
            state,
            deviceType: 'Emulator',
            // Emulators don't expose stable model/osVersion via this code path —
            // metadata enrichment happens in the device-info-collector lane.
            osVersion: null,
            model: null,
          });
          continue;
        }

        // Physical device — probe model + osVersion (cached). Only probe when
        // the device is authorised (booted); offline/unauthorised devices
        // don't accept shell commands.
        let model: string | null = null;
        let osVersion: string | null = null;
        if (state === 'booted') {
          if (modelCache.has(serial)) {
            model = modelCache.get(serial) ?? null;
          } else {
            model = await getProp(serial, 'ro.product.model');
            modelCache.set(serial, model);
          }
          if (osCache.has(serial)) {
            osVersion = osCache.get(serial) ?? null;
          } else {
            osVersion = await getProp(serial, 'ro.build.version.release');
            osCache.set(serial, osVersion);
          }
        }

        const friendlyName = model ? `physical-${model.replace(/\s+/g, '-')}` : `physical-${serial}`;

        out.push({
          id: serial,
          name: friendlyName,
          platform: 'android',
          state,
          deviceType: 'Physical',
          osVersion,
          model,
        });
      }

      return out;
    },
  };
}
