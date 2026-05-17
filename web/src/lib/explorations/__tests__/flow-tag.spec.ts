/**
 * Phase 35 Plan 35-05 — getFlowTag spec.
 *
 * Locks the regex inference ported from
 * `_reference/app-explorer/frontend/src/components/JourneyPanel.tsx:15-58`.
 */
import { describe, it, expect } from 'vitest';

import { getFlowTag } from '../flow-tag.js';
import type { ScreenMap, Screen } from '../atlas-types.js';

function screen(id: string, title: string): Screen {
  return {
    screen_id: id,
    title,
    screenshot_artifact_id: '00000000-0000-0000-0000-000000000000',
    elements: [],
    notes: null,
    bfs_depth: 0,
  };
}

function build(screens: Screen[]): ScreenMap {
  return {
    run_id: '00000000-0000-0000-0000-000000000001',
    app_name: 'test',
    platform: 'android',
    screens,
    transitions: [],
  };
}

describe('getFlowTag', () => {
  it('infers `auth` from a Sign In end-screen', () => {
    const map = build([screen('s1', 'Home'), screen('s2', 'Sign In')]);
    expect(getFlowTag(['s1', 's2'], map).label).toBe('auth');
  });

  it('infers `checkout` from a Checkout end-screen', () => {
    const map = build([screen('s1', 'Home'), screen('s2', 'Checkout')]);
    expect(getFlowTag(['s1', 's2'], map).label).toBe('checkout');
  });

  it('infers `payment` from a Wallet end-screen', () => {
    const map = build([screen('s1', 'Home'), screen('s2', 'Wallet')]);
    expect(getFlowTag(['s1', 's2'], map).label).toBe('payment');
  });

  it('infers `settings` from a Settings end-screen', () => {
    const map = build([screen('s1', 'Home'), screen('s2', 'Settings')]);
    expect(getFlowTag(['s1', 's2'], map).label).toBe('settings');
  });

  it('infers `danger` from an Active Ride end-screen (priority over book)', () => {
    const map = build([screen('s1', 'Home'), screen('s2', 'Active Ride')]);
    expect(getFlowTag(['s1', 's2'], map).label).toBe('danger');
  });

  it('falls back to `navigate` when no rule matches', () => {
    const map = build([screen('s1', 'Home'), screen('s2', 'Mystery')]);
    expect(getFlowTag(['s1', 's2'], map).label).toBe('navigate');
  });

  it('matches anywhere in the path when end-screen has no signal', () => {
    const map = build([
      screen('s1', 'Home'),
      screen('s2', 'Help Center'),
      screen('s3', 'Mystery'),
    ]);
    expect(getFlowTag(['s1', 's2', 's3'], map).label).toBe('support');
  });

  it('returns a Tailwind color class string', () => {
    const map = build([screen('s1', 'Sign In')]);
    const tag = getFlowTag(['s1'], map);
    expect(tag.color).toContain('text-');
    expect(tag.color).toContain('bg-');
  });

  it('returns navigate for an empty path', () => {
    const map = build([screen('s1', 'Home')]);
    expect(getFlowTag([], map).label).toBe('navigate');
  });
});
