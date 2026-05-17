/**
 * Phase 36 / Plan 36-01 — Discovery fingerprint + diff spec.
 *
 * Verifies the pure-function helpers that underpin the DeviceDiscoveryService
 * dedup loop (poller.ts). See VALIDATION.md §Per-Task Verification Map.
 */
import { describe, it, expect } from 'vitest';
import { fingerprint, diff, sortDevices } from '../internal/discovery/fingerprint.js';
import type { DiscoveredDevice } from '../internal/discovery/types.js';
import { discoveredDevicePayloadSchema } from '../schemas.js';

function dev(overrides: Partial<DiscoveredDevice> = {}): DiscoveredDevice {
  return {
    id: 'emulator-5554',
    name: 'android-1',
    platform: 'android',
    state: 'booted',
    deviceType: 'Emulator',
    osVersion: '15',
    model: null,
    ...overrides,
  };
}

describe('[Phase 36-01] discovery fingerprint + diff', () => {
  describe('fingerprint', () => {
    it('fingerprint of empty array equals "[]"', () => {
      expect(fingerprint([])).toBe('[]');
    });

    it('fingerprint reorders input deterministically (same string regardless of input order)', () => {
      const a = dev({ id: 'A', name: 'a', platform: 'android' });
      const b = dev({ id: 'B', name: 'b', platform: 'android' });
      const fp1 = fingerprint([a, b]);
      const fp2 = fingerprint([b, a]);
      expect(fp1).toBe(fp2);
    });

    it('fingerprint changes when a device transitions booted → offline', () => {
      const before = dev({ id: 'A', state: 'booted' });
      const after = dev({ id: 'A', state: 'offline' });
      expect(fingerprint([before])).not.toBe(fingerprint([after]));
    });

    it('valid fixtures satisfy discoveredDevicePayloadSchema', () => {
      const a = dev({ id: 'A', name: 'one' });
      const parsed = discoveredDevicePayloadSchema.safeParse(a);
      expect(parsed.success).toBe(true);
    });
  });

  describe('sortDevices', () => {
    it('sortDevices puts booted before shutdown', () => {
      const sd = dev({ id: 'A', name: 'a', state: 'shutdown' });
      const bo = dev({ id: 'B', name: 'b', state: 'booted' });
      const sorted = sortDevices([sd, bo]);
      expect(sorted[0].state).toBe('booted');
      expect(sorted[1].state).toBe('shutdown');
    });

    it('sortDevices ties broken by platform then name', () => {
      const iosB = dev({ id: 'X', name: 'b', platform: 'ios', state: 'booted', deviceType: 'Simulator' });
      const andA = dev({ id: 'Y', name: 'a', platform: 'android', state: 'booted', deviceType: 'Emulator' });
      const andB = dev({ id: 'Z', name: 'b', platform: 'android', state: 'booted', deviceType: 'Emulator' });
      const sorted = sortDevices([iosB, andB, andA]);
      // android before ios (alpha), then a before b within android
      expect(sorted[0].id).toBe('Y');
      expect(sorted[1].id).toBe('Z');
      expect(sorted[2].id).toBe('X');
    });
  });

  describe('diff', () => {
    it('diff classifies new IDs as added', () => {
      const a = dev({ id: 'A' });
      const b = dev({ id: 'B' });
      const result = diff([], [a, b]);
      expect(result.added).toHaveLength(2);
      expect(result.removed).toHaveLength(0);
      expect(result.changed).toHaveLength(0);
    });

    it('diff classifies missing IDs as removed', () => {
      const a = dev({ id: 'A' });
      const b = dev({ id: 'B' });
      const result = diff([a, b], [b]);
      expect(result.added).toHaveLength(0);
      expect(result.removed).toHaveLength(1);
      expect(result.removed[0].id).toBe('A');
      expect(result.changed).toHaveLength(0);
    });

    it('diff classifies same ID with different state as changed', () => {
      const before = dev({ id: 'A', state: 'booted' });
      const after = dev({ id: 'A', state: 'offline' });
      const result = diff([before], [after]);
      expect(result.added).toHaveLength(0);
      expect(result.removed).toHaveLength(0);
      expect(result.changed).toHaveLength(1);
      expect(result.changed[0].state).toBe('offline');
    });

    it('diff returns empty arrays when prev and next are identical', () => {
      const a = dev({ id: 'A' });
      const b = dev({ id: 'B' });
      const result = diff([a, b], [a, b]);
      expect(result.added).toEqual([]);
      expect(result.removed).toEqual([]);
      expect(result.changed).toEqual([]);
    });
  });
});
