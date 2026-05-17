/**
 * Phase 36 / Plan 36-02 — mDNS browser tests (PAIR-WIRELESS).
 *
 * Mocks `bonjour-service` so we can drive `up` events synthetically and
 * `os.networkInterfaces` for cross-subnet rejection.
 */
import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import os from 'node:os';

// ---------- bonjour-service mock ----------
class MockBrowser extends EventEmitter {
  stopCalls = 0;
  start = vi.fn();
  stop = vi.fn(() => {
    this.stopCalls += 1;
  });
}
class MockBonjour {
  destroyCalls = 0;
  lastFindArgs: unknown = null;
  browser = new MockBrowser();
  find(args: unknown): MockBrowser {
    this.lastFindArgs = args;
    return this.browser;
  }
  destroy(): void {
    this.destroyCalls += 1;
  }
}
const bonjourInstances: MockBonjour[] = [];
class BonjourCtor {
  constructor() {
    const i = new MockBonjour();
    bonjourInstances.push(i);
    return i as unknown as BonjourCtor;
  }
}
vi.mock('bonjour-service', () => ({
  Bonjour: BonjourCtor,
}));

// Import AFTER mock so the module under test picks it up
import { browseForPairing, browseForConnect, isOnLocalSubnet } from '../../internal/wireless/mdns.js';

beforeEach(() => {
  bonjourInstances.length = 0;
  vi.spyOn(os, 'networkInterfaces').mockReturnValue({
    en0: [
      {
        address: '192.168.1.10',
        netmask: '255.255.255.0',
        family: 'IPv4',
        mac: 'aa:bb:cc:dd:ee:ff',
        internal: false,
        cidr: '192.168.1.10/24',
      },
    ],
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('[Phase 36-02] wireless mDNS browser', () => {
  it('browseForPairing fires onFound when service.name matches AND IP is local', () => {
    const onFound = vi.fn();
    const onError = vi.fn();
    const handle = browseForPairing('devicefarm-abcdef12', onFound, onError);
    const bonjour = bonjourInstances[0]!;
    bonjour.browser.emit('up', {
      name: 'devicefarm-abcdef12',
      port: 33861,
      addresses: ['192.168.1.42'],
    });
    expect(onFound).toHaveBeenCalledWith('192.168.1.42', 33861);
    expect(onError).not.toHaveBeenCalled();
    handle.stop();
  });

  it('browseForPairing ignores `up` events with non-matching instance name', () => {
    const onFound = vi.fn();
    const onError = vi.fn();
    browseForPairing('devicefarm-abcdef12', onFound, onError);
    const bonjour = bonjourInstances[0]!;
    bonjour.browser.emit('up', {
      name: 'somebody-else',
      port: 33861,
      addresses: ['192.168.1.42'],
    });
    expect(onFound).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it('browseForPairing calls onError with cross-subnet message when IP not local', () => {
    const onFound = vi.fn();
    const onError = vi.fn();
    browseForPairing('devicefarm-abcdef12', onFound, onError);
    const bonjour = bonjourInstances[0]!;
    bonjour.browser.emit('up', {
      name: 'devicefarm-abcdef12',
      port: 33861,
      addresses: ['10.99.99.42'],
    });
    expect(onFound).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledOnce();
    const err = onError.mock.calls[0]![0] as Error;
    expect(err.message).toMatch(/cross-subnet/i);
    expect(err.message).toContain('10.99.99.42');
  });

  it('stop() calls browser.stop() and bonjour.destroy() exactly once each', () => {
    const handle = browseForPairing('devicefarm-x', vi.fn(), vi.fn());
    const bonjour = bonjourInstances[0]!;
    handle.stop();
    expect(bonjour.browser.stopCalls).toBe(1);
    expect(bonjour.destroyCalls).toBe(1);
    // idempotent
    handle.stop();
    expect(bonjour.browser.stopCalls).toBe(1);
    expect(bonjour.destroyCalls).toBe(1);
  });

  it('browseForConnect requests the adb-tls-connect service type', () => {
    browseForConnect('adb-xyz', vi.fn(), vi.fn());
    const bonjour = bonjourInstances[0]!;
    expect(bonjour.lastFindArgs).toMatchObject({ type: 'adb-tls-connect', protocol: 'tcp' });
  });

  it('isOnLocalSubnet returns true when called directly for in-subnet IP', () => {
    expect(isOnLocalSubnet('192.168.1.99')).toBe(true);
  });
});
