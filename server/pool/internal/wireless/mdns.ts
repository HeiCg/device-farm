/**
 * Phase 36 / Plan 36-02 — mDNS pairing/connect helpers (PAIR-WIRELESS).
 *
 * - `browseForPairing` watches `_adb-tls-pairing._tcp` for the QR-encoded
 *   instance name and fires `onFound(host, port)` on the first match.
 * - `browseForConnect` watches `_adb-tls-connect._tcp` for the guid returned
 *   by adb pair (so the wizard can wait for the device to re-advertise).
 * - `isOnLocalSubnet` returns true when the resolved IP shares a subnet
 *   (per-iface netmask) with any non-internal host IPv4 interface
 *   (cross-subnet pair → reject — Pitfall 3).
 *
 * Uses bonjour-service (installed Plan 36-00 Task 1).
 */
import os from 'node:os';
import { Bonjour } from 'bonjour-service';

export interface BrowserHandle {
  stop(): void;
}

interface MdnsService {
  name?: string;
  port?: number;
  addresses?: string[];
  txt?: Record<string, string>;
}

/** dotted-quad → unsigned 32-bit int (or null on parse failure). */
function ipToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let result = 0;
  for (const part of parts) {
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    result = (result * 256) + n;
  }
  // Convert to unsigned 32-bit
  return result >>> 0;
}

function sameSubnet(ipA: string, ipB: string, netmask: string): boolean {
  const a = ipToInt(ipA);
  const b = ipToInt(ipB);
  const m = ipToInt(netmask);
  if (a === null || b === null || m === null) return false;
  return ((a & m) >>> 0) === ((b & m) >>> 0);
}

/**
 * Returns true when `ip` shares a subnet (per-iface netmask) with any
 * non-internal IPv4 host interface. Used to reject cross-VLAN pair
 * attempts before any shell-out.
 */
export function isOnLocalSubnet(ip: string): boolean {
  const ifaces = os.networkInterfaces();
  for (const list of Object.values(ifaces)) {
    if (!list) continue;
    for (const iface of list) {
      if (iface.family !== 'IPv4') continue;
      if (iface.internal) continue;
      if (sameSubnet(ip, iface.address, iface.netmask)) return true;
    }
  }
  return false;
}

function pickIPv4(service: MdnsService): string | null {
  const addrs = service.addresses ?? [];
  for (const addr of addrs) {
    // Skip IPv6 addresses (contain ':')
    if (typeof addr === 'string' && !addr.includes(':')) return addr;
  }
  return null;
}

/**
 * Browse for the `_adb-tls-pairing._tcp` service matching `expectedInstance`.
 * Fires onFound(host, port) on a match with a resolvable local IPv4.
 * Fires onError with a cross-subnet message when the IP is outside any
 * non-internal interface's subnet (Pitfall 3 — cross-VLAN rejection).
 */
export function browseForPairing(
  expectedInstance: string,
  onFound: (host: string, port: number) => void,
  onError: (err: Error) => void,
): BrowserHandle {
  const bonjour = new Bonjour();
  const browser = bonjour.find({ type: 'adb-tls-pairing', protocol: 'tcp' });

  const handleUp = (service: MdnsService): void => {
    if (service.name !== expectedInstance) return;
    const ip = pickIPv4(service);
    if (!ip) {
      // Pitfall 1 — addresses may not be resolved yet; allow caller to
      // retry on the next `up` event. Drop quietly.
      return;
    }
    if (!isOnLocalSubnet(ip)) {
      onError(new Error(`Cross-subnet pairing attempt rejected: ${ip}`));
      return;
    }
    onFound(ip, typeof service.port === 'number' ? service.port : 0);
  };

  browser.on('up', handleUp as (s: unknown) => void);
  browser.on('error', (err: Error) => onError(err));

  let stopped = false;
  return {
    stop(): void {
      if (stopped) return;
      stopped = true;
      try { browser.stop(); } catch { /* ignore */ }
      try { bonjour.destroy(); } catch { /* ignore */ }
    },
  };
}

/**
 * Browse for the `_adb-tls-connect._tcp` service matching `expectedGuid`.
 * Match is by service.name suffix or by `guid` key in txt records.
 */
export function browseForConnect(
  expectedGuid: string,
  onFound: (host: string, port: number) => void,
  onError: (err: Error) => void,
): BrowserHandle {
  const bonjour = new Bonjour();
  const browser = bonjour.find({ type: 'adb-tls-connect', protocol: 'tcp' });

  const handleUp = (service: MdnsService): void => {
    const txtGuid = service.txt && typeof service.txt === 'object'
      ? (service.txt as Record<string, string>).guid
      : undefined;
    const nameMatches = service.name?.includes(expectedGuid) ?? false;
    if (!nameMatches && txtGuid !== expectedGuid) return;

    const ip = pickIPv4(service);
    if (!ip) return;
    if (!isOnLocalSubnet(ip)) {
      onError(new Error(`Cross-subnet connect attempt rejected: ${ip}`));
      return;
    }
    onFound(ip, typeof service.port === 'number' ? service.port : 0);
  };

  browser.on('up', handleUp as (s: unknown) => void);
  browser.on('error', (err: Error) => onError(err));

  let stopped = false;
  return {
    stop(): void {
      if (stopped) return;
      stopped = true;
      try { browser.stop(); } catch { /* ignore */ }
      try { bonjour.destroy(); } catch { /* ignore */ }
    },
  };
}
