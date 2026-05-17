/**
 * Phase 36 / Plan 36-01 — Discovery emit-wiring spec.
 *
 * Asserts the poller routes through PoolEmitters.discovered* helpers and
 * that each payload satisfies discoveredDevicePayloadSchema (the same
 * Zod schema used by the bus persistEnvelope middleware).
 */
import { describe, it, expect } from 'vitest';
import pino from 'pino';
import { TypedBus } from '../../bus/bus.js';
import { createDeviceDiscoveryService } from '../internal/discovery/poller.js';
import {
  poolRegistry,
  makePoolEmitters,
  type PoolRegistry,
} from '../events.js';
import { discoveredDevicePayloadSchema } from '../schemas.js';
import type { PlatformAdapter, DiscoveredDevice } from '../internal/discovery/types.js';

function dev(overrides: Partial<DiscoveredDevice> = {}): DiscoveredDevice {
  return {
    id: 'A',
    name: 'a',
    platform: 'android',
    state: 'booted',
    deviceType: 'Physical',
    osVersion: '15',
    model: 'Pixel 8',
    ...overrides,
  };
}

class FakeAdapter implements PlatformAdapter {
  constructor(private snapshots: DiscoveredDevice[][]) {}
  async listDevices(): Promise<DiscoveredDevice[]> {
    return this.snapshots.shift() ?? [];
  }
}

const silentLogger = pino({ level: 'silent' });

describe('[Phase 36-01] DeviceDiscoveryService emit wiring', () => {
  it('discoveredAdded subscriber receives `{ device }` payload with full DiscoveredDevice shape', async () => {
    const bus = new TypedBus<PoolRegistry>(poolRegistry);
    const emit = makePoolEmitters(bus);
    const received: unknown[] = [];
    bus.on('device.discovered.added', (p: unknown) => { received.push(p); });

    const adapter = new FakeAdapter([[dev({ id: 'A' })]]);
    const svc = createDeviceDiscoveryService({ adapters: [adapter], emit, logger: silentLogger });
    await svc.pollOnce();

    expect(received).toHaveLength(1);
    const payload = received[0] as { device: DiscoveredDevice };
    expect(payload.device.id).toBe('A');
    expect(payload.device.name).toBe('a');
    expect(payload.device.platform).toBe('android');
    expect(payload.device.state).toBe('booted');
    expect(payload.device.deviceType).toBe('Physical');
  });

  it('payload satisfies discoveredDevicePayloadSchema (Zod safeParse)', async () => {
    const bus = new TypedBus<PoolRegistry>(poolRegistry);
    const emit = makePoolEmitters(bus);
    const received: unknown[] = [];
    bus.on('device.discovered.added', (p: unknown) => { received.push(p); });

    const adapter = new FakeAdapter([[dev({ id: 'A', osVersion: '15', model: 'Pixel 8' })]]);
    const svc = createDeviceDiscoveryService({ adapters: [adapter], emit, logger: silentLogger });
    await svc.pollOnce();

    const payload = received[0] as { device: unknown };
    const parsed = discoveredDevicePayloadSchema.safeParse(payload.device);
    expect(parsed.success).toBe(true);
  });

  it('Bus subscribers see added event before changed event in same poll cycle (per-device ordering)', async () => {
    const bus = new TypedBus<PoolRegistry>(poolRegistry);
    const emit = makePoolEmitters(bus);
    const order: string[] = [];
    bus.on('device.discovered.added',   () => { order.push('added'); });
    bus.on('device.discovered.changed', () => { order.push('changed'); });

    const adapter = new FakeAdapter([
      [dev({ id: 'A', state: 'booted' })],
      [dev({ id: 'A', state: 'offline' })],
    ]);
    const svc = createDeviceDiscoveryService({ adapters: [adapter], emit, logger: silentLogger });
    await svc.pollOnce();
    await svc.pollOnce();

    expect(order).toEqual(['added', 'changed']);
  });

  it('discoveredRemoved fires on subsequent poll missing the device', async () => {
    const bus = new TypedBus<PoolRegistry>(poolRegistry);
    const emit = makePoolEmitters(bus);
    const removed: unknown[] = [];
    bus.on('device.discovered.removed', (p: unknown) => { removed.push(p); });

    const adapter = new FakeAdapter([[dev({ id: 'A' })], []]);
    const svc = createDeviceDiscoveryService({ adapters: [adapter], emit, logger: silentLogger });
    await svc.pollOnce();
    await svc.pollOnce();

    expect(removed).toHaveLength(1);
    const payload = removed[0] as { device: DiscoveredDevice };
    expect(payload.device.id).toBe('A');
  });
});
