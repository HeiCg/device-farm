/**
 * Phase 36 / Plan 36-01 — DeviceDiscoveryService poller spec.
 *
 * Asserts the 5s poll loop's invariants:
 *   - first pollOnce runs immediately on start()
 *   - overlapping ticks dropped by mutex.isLocked() guard
 *   - fingerprint short-circuit suppresses re-emission of unchanged snapshots
 *   - added/removed/changed events fire keyed by device id
 *   - stop() then start() re-arms the interval cleanly
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import pino from 'pino';
import { createDeviceDiscoveryService } from '../internal/discovery/poller.js';
import type { PlatformAdapter, DiscoveredDevice } from '../internal/discovery/types.js';
import type { PoolEmitters } from '../events.js';
import type { Envelope } from '../../events/envelope.js';

function dev(overrides: Partial<DiscoveredDevice> = {}): DiscoveredDevice {
  return {
    id: 'A',
    name: 'a',
    platform: 'android',
    state: 'booted',
    deviceType: 'Physical',
    osVersion: null,
    model: null,
    ...overrides,
  };
}

function makeEmit(): PoolEmitters & {
  __calls: { added: unknown[][]; removed: unknown[][]; changed: unknown[][] };
} {
  const calls = { added: [] as unknown[][], removed: [] as unknown[][], changed: [] as unknown[][] };
  const env = {} as Envelope;
  return {
    stateChanged:      () => env,
    allocated:         () => env,
    released:          () => env,
    healthFailed:      () => env,
    booted:            () => env,
    discoveredAdded:   ((id: string, payload: unknown) => { calls.added.push([id, payload]); return env; }) as unknown as PoolEmitters['discoveredAdded'],
    discoveredRemoved: ((id: string, payload: unknown) => { calls.removed.push([id, payload]); return env; }) as unknown as PoolEmitters['discoveredRemoved'],
    discoveredChanged: ((id: string, payload: unknown) => { calls.changed.push([id, payload]); return env; }) as unknown as PoolEmitters['discoveredChanged'],
    pairAttempted:     () => env,
    __calls: calls,
  };
}

class FakeAdapter implements PlatformAdapter {
  public delay = 0;
  constructor(private snapshots: DiscoveredDevice[][]) {}
  async listDevices(): Promise<DiscoveredDevice[]> {
    if (this.delay > 0) await new Promise((r) => setTimeout(r, this.delay));
    const head = this.snapshots.shift();
    return head ?? [];
  }
}

const silentLogger = pino({ level: 'silent' });

describe('[Phase 36-01] DeviceDiscoveryService poller', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('pollOnce emits discoveredAdded for each new device on first tick', async () => {
    const adapter = new FakeAdapter([[dev({ id: 'A' }), dev({ id: 'B' })]]);
    const emit = makeEmit();
    const svc = createDeviceDiscoveryService({ adapters: [adapter], emit, logger: silentLogger });
    await svc.pollOnce();
    expect(emit.__calls.added).toHaveLength(2);
    expect(emit.__calls.removed).toHaveLength(0);
    expect(emit.__calls.changed).toHaveLength(0);
  });

  it('pollOnce emits nothing when fingerprint matches previous tick', async () => {
    const snapshot = [dev({ id: 'A' })];
    const adapter = new FakeAdapter([snapshot, [...snapshot]]);
    const emit = makeEmit();
    const svc = createDeviceDiscoveryService({ adapters: [adapter], emit, logger: silentLogger });
    await svc.pollOnce();
    await svc.pollOnce();
    expect(emit.__calls.added).toHaveLength(1); // first tick only
    expect(emit.__calls.removed).toHaveLength(0);
    expect(emit.__calls.changed).toHaveLength(0);
  });

  it('pollOnce emits discoveredRemoved when adapter drops a device', async () => {
    const adapter = new FakeAdapter([[dev({ id: 'A' }), dev({ id: 'B' })], [dev({ id: 'A' })]]);
    const emit = makeEmit();
    const svc = createDeviceDiscoveryService({ adapters: [adapter], emit, logger: silentLogger });
    await svc.pollOnce();
    await svc.pollOnce();
    expect(emit.__calls.removed).toHaveLength(1);
    expect((emit.__calls.removed[0][1] as { device: DiscoveredDevice }).device.id).toBe('B');
  });

  it('pollOnce emits discoveredChanged when device state transitions booted → offline', async () => {
    const adapter = new FakeAdapter([
      [dev({ id: 'A', state: 'booted' })],
      [dev({ id: 'A', state: 'offline' })],
    ]);
    const emit = makeEmit();
    const svc = createDeviceDiscoveryService({ adapters: [adapter], emit, logger: silentLogger });
    await svc.pollOnce();
    await svc.pollOnce();
    expect(emit.__calls.changed).toHaveLength(1);
    expect((emit.__calls.changed[0][1] as { device: DiscoveredDevice }).device.state).toBe('offline');
  });

  it('start() runs first pollOnce immediately (no setInterval wait)', async () => {
    const adapter = new FakeAdapter([[dev({ id: 'A' })]]);
    const emit = makeEmit();
    const svc = createDeviceDiscoveryService({
      adapters: [adapter],
      emit,
      logger: silentLogger,
      intervalMs: 60_000, // long interval — proves immediate fire is not from setInterval
    });
    svc.start();
    // microtask drain — the first poll is fire-and-forget; await a tick
    await new Promise((r) => setTimeout(r, 20));
    expect(emit.__calls.added).toHaveLength(1);
    svc.stop();
  });

  it('concurrent pollOnce drops the second invocation (mutex.isLocked)', async () => {
    const adapter = new FakeAdapter([[dev({ id: 'A' })], [dev({ id: 'B' })]]);
    adapter.delay = 30; // make first tick slow
    const emit = makeEmit();
    const svc = createDeviceDiscoveryService({ adapters: [adapter], emit, logger: silentLogger });
    const p1 = svc.pollOnce();
    // Fire p2 while p1 is still in flight — should be dropped (no emit added).
    const p2 = svc.pollOnce();
    await Promise.all([p1, p2]);
    expect(emit.__calls.added).toHaveLength(1);
    expect((emit.__calls.added[0][1] as { device: DiscoveredDevice }).device.id).toBe('A');
  });

  it('stop() then start() re-arms the interval', async () => {
    const adapter = new FakeAdapter([[dev({ id: 'A' })], [dev({ id: 'B' })]]);
    const emit = makeEmit();
    const svc = createDeviceDiscoveryService({
      adapters: [adapter],
      emit,
      logger: silentLogger,
      intervalMs: 60_000,
    });
    svc.start();
    await new Promise((r) => setTimeout(r, 20));
    svc.stop();
    svc.start();
    await new Promise((r) => setTimeout(r, 20));
    // Re-armed service runs immediate first-poll on the SECOND start —
    // proves stop+start cycle didn't leak the interval handle.
    expect(emit.__calls.added.length + emit.__calls.removed.length + emit.__calls.changed.length)
      .toBeGreaterThanOrEqual(2);
    svc.stop();
  });

  it('getSnapshot() returns the latest emitted snapshot', async () => {
    const adapter = new FakeAdapter([[dev({ id: 'A' }), dev({ id: 'B' })]]);
    const emit = makeEmit();
    const svc = createDeviceDiscoveryService({ adapters: [adapter], emit, logger: silentLogger });
    expect(svc.getSnapshot()).toEqual([]);
    await svc.pollOnce();
    const snap = svc.getSnapshot();
    expect(snap).toHaveLength(2);
    // Returns a copy — mutating must not affect internal state.
    snap.pop();
    expect(svc.getSnapshot()).toHaveLength(2);
  });

  it('adapter failure is swallowed; poll yields empty list without crashing', async () => {
    const adapter: PlatformAdapter = {
      async listDevices() {
        throw new Error('adb not installed');
      },
    };
    const emit = makeEmit();
    const svc = createDeviceDiscoveryService({ adapters: [adapter], emit, logger: silentLogger });
    await svc.pollOnce();
    expect(emit.__calls.added).toHaveLength(0);
  });
});
