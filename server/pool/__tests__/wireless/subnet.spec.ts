/**
 * Phase 36 / Plan 36-02 — Local subnet guard tests (PAIR-WIRELESS).
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import { isOnLocalSubnet } from '../../internal/wireless/mdns.js';

beforeEach(() => {
  vi.spyOn(os, 'networkInterfaces').mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('[Phase 36-02] wireless subnet guard', () => {
  it('returns true for IP in same /24 as a non-internal IPv4 interface', () => {
    vi.spyOn(os, 'networkInterfaces').mockReturnValue({
      en0: [{
        address: '192.168.1.10',
        netmask: '255.255.255.0',
        family: 'IPv4',
        mac: 'aa:bb:cc:dd:ee:ff',
        internal: false,
        cidr: '192.168.1.10/24',
      }],
    });
    expect(isOnLocalSubnet('192.168.1.250')).toBe(true);
  });

  it('returns false for cross-subnet IP', () => {
    vi.spyOn(os, 'networkInterfaces').mockReturnValue({
      en0: [{
        address: '192.168.1.10',
        netmask: '255.255.255.0',
        family: 'IPv4',
        mac: 'aa:bb:cc:dd:ee:ff',
        internal: false,
        cidr: '192.168.1.10/24',
      }],
    });
    expect(isOnLocalSubnet('10.5.5.5')).toBe(false);
  });

  it('returns false when only internal interfaces are present', () => {
    vi.spyOn(os, 'networkInterfaces').mockReturnValue({
      lo0: [{
        address: '127.0.0.1',
        netmask: '255.0.0.0',
        family: 'IPv4',
        mac: '00:00:00:00:00:00',
        internal: true,
        cidr: '127.0.0.1/8',
      }],
    });
    expect(isOnLocalSubnet('192.168.1.5')).toBe(false);
  });

  it('respects /16 netmask correctly', () => {
    vi.spyOn(os, 'networkInterfaces').mockReturnValue({
      en0: [{
        address: '172.16.5.10',
        netmask: '255.255.0.0',
        family: 'IPv4',
        mac: 'aa:bb:cc:dd:ee:ff',
        internal: false,
        cidr: '172.16.5.10/16',
      }],
    });
    expect(isOnLocalSubnet('172.16.250.99')).toBe(true);
    expect(isOnLocalSubnet('172.17.0.1')).toBe(false);
  });
});
