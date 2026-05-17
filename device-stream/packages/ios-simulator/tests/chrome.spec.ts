import { describe, it, expect } from 'vitest';
import { chromeIdForDeviceType } from '../src/chrome.js';

describe('chromeIdForDeviceType', () => {
  it('maps iPhone 17 Pro to its chromeIdentifier from profile.plist', () => {
    const id = chromeIdForDeviceType('iPhone 17 Pro', {
      readProfilePlist: () => ({ chromeIdentifier: 'iPhone17,1' } as any),
    });
    expect(id).toBe('iPhone17,1');
  });

  it('returns null for unknown device types', () => {
    const id = chromeIdForDeviceType('PotatoPhone', {
      readProfilePlist: () => null,
    });
    expect(id).toBeNull();
  });

  it('returns null when plist has no chromeIdentifier', () => {
    const id = chromeIdForDeviceType('iPhone 8', {
      readProfilePlist: () => ({} as any),
    });
    expect(id).toBeNull();
  });
});
