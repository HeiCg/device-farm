import { describe, it, expect } from 'vitest';
import { findTapTarget, withRetry } from '../argent-flow.js';

const TREE = `Source: uiautomator
ROOT  Screen (0.000, 0.000, 1.000, 1.000)
  ViewGroup "Search settings" id="search_action_bar" [clickable]  (0.039, 0.250, 0.922, 0.057)
    LinearLayout "Network & internet / Mobile, Wi‑Fi, hotspot" [clickable]  (0.000, 0.324, 1.000, 0.096)
    LinearLayout "Connected devices / Bluetooth" [clickable]  (0.000, 0.420, 1.000, 0.096)`;

describe('argent-flow — tree parsing', () => {
  it('finds the centre of a labelled row (case-insensitive, substring)', () => {
    const t = findTapTarget(TREE, 'Network & internet');
    expect(t).not.toBeNull();
    // centre x = 0 + 1.0/2 = 0.5 ; y = 0.324 + 0.096/2 = 0.372
    expect(t!.x).toBeCloseTo(0.5, 5);
    expect(t!.y).toBeCloseTo(0.372, 5);
  });

  it('prefers the smallest (most specific) match', () => {
    const t = findTapTarget(TREE, 'settings');
    // "Search settings" (area 0.922*0.057) is the only "settings" match here.
    expect(t).not.toBeNull();
    expect(t!.y).toBeCloseTo(0.25 + 0.057 / 2, 5);
  });

  it('returns null when the label is absent', () => {
    expect(findTapTarget(TREE, 'Bluetooth pairing wizard')).toBeNull();
  });

  it('withRetry returns the first truthy result and stops', async () => {
    let calls = 0;
    const r = await withRetry(async () => {
      calls++;
      return calls >= 2 ? 'ok' : null;
    }, 5, 1);
    expect(r).toBe('ok');
    expect(calls).toBe(2);
  });

  it('withRetry gives up after the attempt budget', async () => {
    let calls = 0;
    const r = await withRetry(async () => {
      calls++;
      return null;
    }, 3, 1);
    expect(r).toBeNull();
    expect(calls).toBe(3);
  });
});
