/**
 * Phase 36 / Plan 36-02 — deviceStore tests (DISC-WS).
 *
 * Exercises the DeviceStore.applyFrame method which is the testable core
 * of the WS message handling (so we don't need a real socket / jsdom).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { DeviceStore } from '../devices.svelte.js';

function makeFrame(type: 'device.discovered.added' | 'device.discovered.removed' | 'device.discovered.changed', overrides: Record<string, unknown> = {}) {
  return {
    v: 1,
    type,
    correlationId: '00000000-0000-0000-0000-000000000000',
    ts: new Date().toISOString(),
    payload: {
      type,
      device: {
        id: 'serial-1',
        name: 'Pixel 9',
        platform: 'android',
        state: 'booted',
        deviceType: 'Physical',
        osVersion: '14',
        model: 'Pixel 9',
        ...overrides,
      },
    },
  };
}

let store: DeviceStore;

beforeEach(() => {
  store = new DeviceStore();
});

describe('[Phase 36-02] deviceStore', () => {
  it('applies device.discovered.added → devices grows by 1 with correct id', () => {
    store.applyFrame(makeFrame('device.discovered.added'));
    expect(store.devices).toHaveLength(1);
    expect(store.devices[0]!.id).toBe('serial-1');
  });

  it('applies device.discovered.removed → devices shrinks', () => {
    store.applyFrame(makeFrame('device.discovered.added'));
    store.applyFrame(makeFrame('device.discovered.added', { id: 'serial-2' }));
    store.applyFrame(makeFrame('device.discovered.removed'));
    expect(store.devices.map(d => d.id)).toEqual(['serial-2']);
  });

  it('applies device.discovered.changed → existing device updated by id (no duplicate)', () => {
    store.applyFrame(makeFrame('device.discovered.added'));
    store.applyFrame(makeFrame('device.discovered.changed', { state: 'offline' }));
    expect(store.devices).toHaveLength(1);
    expect(store.devices[0]!.state).toBe('offline');
  });

  it('changed for unknown device is a no-op (no insert)', () => {
    store.applyFrame(makeFrame('device.discovered.changed', { id: 'never-added' }));
    expect(store.devices).toHaveLength(0);
  });

  it('ignores frames with unknown payload.type', () => {
    store.applyFrame({
      v: 1,
      type: 'unknown.event',
      correlationId: '00000000-0000-0000-0000-000000000000',
      ts: new Date().toISOString(),
      payload: { type: 'unknown.event' },
    } as unknown as Parameters<typeof store.applyFrame>[0]);
    expect(store.devices).toHaveLength(0);
  });

  it('added is idempotent — re-adding same id updates in place', () => {
    store.applyFrame(makeFrame('device.discovered.added'));
    store.applyFrame(makeFrame('device.discovered.added', { state: 'offline' }));
    expect(store.devices).toHaveLength(1);
    expect(store.devices[0]!.state).toBe('offline');
  });
});
