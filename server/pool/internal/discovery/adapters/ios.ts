/**
 * Phase 36 / Plan 36-01 — iOS discovery adapter.
 *
 * Companion to android.ts — the ONLY legitimate caller of bare
 * `simctl list devices` per dep-cruiser rule 13 + the runtime grep-guard
 * spec at server/pool/__tests__/discovery-sole-caller.spec.ts.
 *
 * Uses `child_process.execFile` argv form (NEVER the shell-form variant)
 * so no shell-injection surface exists.
 *
 * Physical iOS device discovery is out of scope for Phase 36
 * (deferred — see 36-CONTEXT.md §Deferred Ideas).
 *
 * Runtime parsing: com.apple.CoreSimulator.SimRuntime.iOS-17-5 → "17.5".
 * State map: Booted → 'booted', Shutdown → 'shutdown', else 'offline'.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type pino from 'pino';
import type { PlatformAdapter, DiscoveredDevice } from '../types.js';

const execFileAsync = promisify(execFile);

function parseOsVersion(runtimeKey: string): string | null {
  const match = runtimeKey.match(/iOS-(\d+)-(\d+)/);
  if (!match) return null;
  return `${match[1]}.${match[2]}`;
}

function mapSimctlState(state: string): DiscoveredDevice['state'] {
  if (state === 'Booted') return 'booted';
  if (state === 'Shutdown') return 'shutdown';
  return 'offline';
}

interface SimctlDevice {
  udid: string;
  name: string;
  state: string;
  isAvailable?: boolean;
}

interface SimctlListOutput {
  devices?: Record<string, SimctlDevice[]>;
}

export function createIosAdapter(logger: pino.Logger): PlatformAdapter {
  const log = logger.child({ component: 'discovery-ios' });

  return {
    async listDevices(): Promise<DiscoveredDevice[]> {
      let stdout: string;
      try {
        const result = await execFileAsync(
          'xcrun',
          ['simctl', 'list', 'devices', '--json'],
          { timeout: 10_000 },
        );
        stdout = result.stdout;
      } catch (err) {
        log.warn({ err }, 'xcrun simctl list devices failed; returning empty device list');
        return [];
      }

      let parsed: SimctlListOutput;
      try {
        parsed = JSON.parse(stdout) as SimctlListOutput;
      } catch (err) {
        log.warn({ err }, 'failed to parse simctl JSON output; returning empty list');
        return [];
      }

      const devicesByRuntime = parsed.devices ?? {};
      const out: DiscoveredDevice[] = [];

      for (const [runtimeKey, sims] of Object.entries(devicesByRuntime)) {
        const osVersion = parseOsVersion(runtimeKey);
        // Skip non-iOS runtimes (tvOS / watchOS) — out of scope.
        if (osVersion === null) continue;

        for (const sim of sims) {
          if (sim.isAvailable === false) continue;
          out.push({
            id: sim.udid,
            name: sim.name,
            platform: 'ios',
            state: mapSimctlState(sim.state),
            deviceType: 'Simulator',
            osVersion,
            model: null,
          });
        }
      }

      return out;
    },
  };
}
