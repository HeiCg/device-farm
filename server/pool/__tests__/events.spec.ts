/**
 * Phase 20 / Plan 20-01 — Pool events registry + emit helpers spec (MOD-03).
 *
 * Phase 24 / Plan 24-01 EXTENSION — adds device.booted (5th entry) coverage:
 *   - registry count bumped 4 → 5
 *   - deviceBootedPayload accept/reject (android/ios/physical with null port)
 *   - poolRegistry['device.booted'] persisted:false + aggregateType:'pool'
 *   - makePoolEmitters returns 5 helpers including booted
 *
 * Proves:
 *   - POOL_EVENT_NAMES shape (EVENTS-03 past-tense dotted)
 *   - poolRegistry entries per TRACE-08 persistence policy
 *   - Payload schemas accept/reject valid/malformed inputs
 *   - makePoolEmitters returns correct typed envelope with ALS correlationId
 *   - POOL_AGGREGATE_ID matches v5 UUID derivation from 'pool'
 *
 * NO DB required — uses TypedBus directly + in-memory onEmit capture.
 *
 * Uses CANONICAL plain-object ALS store shape per 20-CONTEXT.md §Specifics
 * (NOT the legacy Map shape seen in Phase 15/18/19 specs).
 */
import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { v5 as uuidv5 } from 'uuid';
import { asyncLocalStorage } from '@fastify/request-context';

import { TypedBus } from '../../bus/bus.js';
import type { Envelope } from '../../events/envelope.js';
import {
  POOL_EVENT_NAMES,
  POOL_AGGREGATE_ID,
  poolRegistry,
  makePoolEmitters,
  deviceStateChangedPayload,
  deviceAllocatedPayload,
  deviceReleasedPayload,
  deviceHealthFailedPayload,
  deviceBootedPayload,
  // Phase 36 / Plan 36-00 — discovery + pairing payload schemas.
  deviceDiscoveredAddedPayload,
  deviceDiscoveredRemovedPayload,
  deviceDiscoveredChangedPayload,
  devicePairAttemptedPayload,
} from '../events.js';

const URL_NAMESPACE = '6ba7b811-9dad-11d1-80b4-00c04fd430c8';

describe('[Phase 20-01] pool events — shape & registry (MOD-03)', () => {
  it('POOL_EVENT_NAMES exports 9 dotted past-tense names (Phase 24-00 added BOOTED; Phase 36-00 added 4 discovery+pairing)', () => {
    expect(POOL_EVENT_NAMES.STATE_CHANGED).toBe('device.state.changed');
    expect(POOL_EVENT_NAMES.ALLOCATED).toBe('device.allocated');
    expect(POOL_EVENT_NAMES.RELEASED).toBe('device.released');
    expect(POOL_EVENT_NAMES.HEALTH_FAILED).toBe('device.health.failed');
    // Phase 24 Plan 24-00 added BOOTED constant (placeholder; registry entry
    // + payload schema + makePoolEmitters helper land in Plan 24-01).
    expect(POOL_EVENT_NAMES.BOOTED).toBe('device.booted');
    // Phase 36 Plan 36-00 — discovery + pairing audit names.
    expect(POOL_EVENT_NAMES.DISCOVERED_ADDED).toBe('device.discovered.added');
    expect(POOL_EVENT_NAMES.DISCOVERED_REMOVED).toBe('device.discovered.removed');
    expect(POOL_EVENT_NAMES.DISCOVERED_CHANGED).toBe('device.discovered.changed');
    expect(POOL_EVENT_NAMES.PAIR_ATTEMPTED).toBe('device.pair.attempted');
    expect(Object.keys(POOL_EVENT_NAMES)).toHaveLength(9);
    for (const v of Object.values(POOL_EVENT_NAMES)) {
      expect(v).toMatch(/^[a-z]+(\.[a-z-]+)+$/);
    }
  });

  it('[Invariant MOD-03] poolRegistry has 9 entries, all aggregateType=pool (Phase 24-01 added BOOTED; Phase 36-00 added 4)', () => {
    const entries = Object.entries(poolRegistry);
    expect(entries).toHaveLength(9);
    for (const [, entry] of entries) {
      expect(entry.aggregateType).toBe('pool');
    }
  });

  it('[TRACE-08] persistence policy — health.failed + discovery added/removed + pair.attempted PERSISTED; others NOT', () => {
    // Persisted (security/audit-relevant low-frequency events).
    expect(poolRegistry['device.health.failed'].persisted).toBe(true);
    expect(poolRegistry['device.discovered.added'].persisted).toBe(true);
    expect(poolRegistry['device.discovered.removed'].persisted).toBe(true);
    expect(poolRegistry['device.pair.attempted'].persisted).toBe(true);
    // Transient (high-frequency or derivable).
    expect(poolRegistry['device.state.changed'].persisted).toBe(false);
    expect(poolRegistry['device.allocated'].persisted).toBe(false);
    expect(poolRegistry['device.released'].persisted).toBe(false);
    expect(poolRegistry['device.booted'].persisted).toBe(false);
    expect(poolRegistry['device.discovered.changed'].persisted).toBe(false);
  });

  it('POOL_AGGREGATE_ID matches v5 UUID derivation from "pool" under URL namespace', () => {
    expect(POOL_AGGREGATE_ID).toBe(uuidv5('pool', URL_NAMESPACE));
    expect(POOL_AGGREGATE_ID).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('payload schemas accept valid + reject malformed samples', () => {
    const validUuid = randomUUID();

    // state.changed
    expect(deviceStateChangedPayload.safeParse({ deviceId: validUuid, from: 'booting', to: 'idle' }).success).toBe(true);
    expect(deviceStateChangedPayload.safeParse({ deviceId: 'not-a-uuid', from: 'booting', to: 'idle' }).success).toBe(false);
    expect(deviceStateChangedPayload.safeParse({ deviceId: validUuid, from: 'bogus', to: 'idle' }).success).toBe(false);

    // allocated
    expect(deviceAllocatedPayload.safeParse({ deviceId: validUuid, jobId: 'job-abc', platform: 'android' }).success).toBe(true);
    expect(deviceAllocatedPayload.safeParse({ deviceId: validUuid, jobId: 'job-abc', platform: 'windows' }).success).toBe(false);

    // released
    expect(deviceReleasedPayload.safeParse({ deviceId: validUuid, jobId: null, platform: 'ios' }).success).toBe(true);
    expect(deviceReleasedPayload.safeParse({ deviceId: validUuid, jobId: 'job-abc', platform: 'ios' }).success).toBe(true);
    expect(deviceReleasedPayload.safeParse({ deviceId: validUuid, jobId: 42, platform: 'ios' }).success).toBe(false);

    // health.failed
    expect(deviceHealthFailedPayload.safeParse({
      deviceId: validUuid, platform: 'android', reason: 'zombie',
      failureCount: 1, willReplace: true, lastError: 'segfault',
    }).success).toBe(true);
    expect(deviceHealthFailedPayload.safeParse({
      deviceId: validUuid, platform: 'android', reason: 'zombie',
      failureCount: -1, willReplace: true, lastError: null,
    }).success).toBe(false);
    expect(deviceHealthFailedPayload.safeParse({
      deviceId: validUuid, platform: 'android', reason: 'other-reason',
      failureCount: 0, willReplace: false, lastError: null,
    }).success).toBe(false);
  });
});

describe('[Phase 20-01] pool events — makePoolEmitters envelope (MOD-03 + TRACE-04)', () => {
  it('returns 9 emit helpers matching the 9 registered events (Phase 24-01 added booted; Phase 36-00 added 4)', () => {
    const bus = new TypedBus(poolRegistry);
    const emit = makePoolEmitters(bus);
    expect(typeof emit.stateChanged).toBe('function');
    expect(typeof emit.allocated).toBe('function');
    expect(typeof emit.released).toBe('function');
    expect(typeof emit.healthFailed).toBe('function');
    expect(typeof emit.booted).toBe('function');
    // Phase 36 / Plan 36-00.
    expect(typeof emit.discoveredAdded).toBe('function');
    expect(typeof emit.discoveredRemoved).toBe('function');
    expect(typeof emit.discoveredChanged).toBe('function');
    expect(typeof emit.pairAttempted).toBe('function');
  });

  it('emit.stateChanged stamps envelope with ALS correlationId + aggregateType=pool + aggregateId=deviceId', async () => {
    const bus = new TypedBus(poolRegistry);
    const captured: Envelope[] = [];
    const emit = makePoolEmitters(bus, (env) => captured.push(env));

    const cid = randomUUID();
    const deviceId = randomUUID();
    await asyncLocalStorage.run(
      { correlationId: cid, currentEventId: null, actor: 'test' } as never,
      async () => {
        const envelope = emit.stateChanged(deviceId, { deviceId, from: 'booting', to: 'idle' });
        expect(envelope.correlationId).toBe(cid);
        expect(envelope.type).toBe('device.state.changed');
        expect(envelope.aggregateType).toBe('pool');
        expect(envelope.aggregateId).toBe(deviceId);
        expect(envelope.v).toBe(1);
      },
    );

    expect(captured).toHaveLength(1);
    expect(captured[0].correlationId).toBe(cid);
  });

  it('emit.healthFailed stamps envelope with reason discriminator + willReplace flag', async () => {
    const bus = new TypedBus(poolRegistry);
    const emit = makePoolEmitters(bus);

    const cid = randomUUID();
    const deviceId = randomUUID();
    await asyncLocalStorage.run(
      { correlationId: cid, currentEventId: null, actor: 'health-checker' } as never,
      async () => {
        const envelope = emit.healthFailed(deviceId, {
          deviceId,
          platform: 'android',
          reason: 'zombie',
          failureCount: 0,
          willReplace: true,
          lastError: 'pid 12345 in uninterruptible sleep',
        });
        expect(envelope.actor).toBe('health-checker');
        expect(envelope.type).toBe('device.health.failed');
        expect(envelope.payload).toMatchObject({ reason: 'zombie', willReplace: true });
      },
    );
  });
});

describe('[Phase 24-01] pool events — device.booted (5th entry)', () => {
  it('poolRegistry has 9 entries (Phase 36 added 4 discovery+pairing) with BOOTED transient + aggregateType=pool', () => {
    expect(Object.keys(poolRegistry)).toHaveLength(9);
    expect(poolRegistry['device.booted'].persisted).toBe(false);
    expect(poolRegistry['device.booted'].aggregateType).toBe('pool');
  });

  it('deviceBootedPayload accepts android emulator + ios simulator + physical (null port)', () => {
    const android = deviceBootedPayload.safeParse({
      deviceId: '33333333-3333-4333-8333-333333333333',
      platform: 'android', emulatorId: 'emulator-5554', port: 5554,
    });
    const ios = deviceBootedPayload.safeParse({
      deviceId: '44444444-4444-4444-8444-444444444444',
      platform: 'ios', emulatorId: 'iPhone-15-Pro', port: null,
    });
    const physicalAndroid = deviceBootedPayload.safeParse({
      deviceId: '55555555-5555-4555-8555-555555555555',
      platform: 'android', emulatorId: 'physical-Pixel6', port: null,
    });
    expect(android.success).toBe(true);
    expect(ios.success).toBe(true);
    expect(physicalAndroid.success).toBe(true);
  });

  it('deviceBootedPayload rejects malformed samples', () => {
    // bad UUID
    expect(deviceBootedPayload.safeParse({
      deviceId: 'not-a-uuid', platform: 'android', emulatorId: 'emulator-5554', port: 5554,
    }).success).toBe(false);
    // bad platform
    expect(deviceBootedPayload.safeParse({
      deviceId: '33333333-3333-4333-8333-333333333333',
      platform: 'windows', emulatorId: 'emulator-5554', port: 5554,
    }).success).toBe(false);
    // non-int port
    expect(deviceBootedPayload.safeParse({
      deviceId: '33333333-3333-4333-8333-333333333333',
      platform: 'android', emulatorId: 'emulator-5554', port: 5554.5,
    }).success).toBe(false);
  });

  it('makePoolEmitters returns 9 helpers including booted (Phase 36 added 4 discovery+pairing)', () => {
    const bus = new TypedBus(poolRegistry);
    const emit = makePoolEmitters(bus);
    expect(Object.keys(emit)).toEqual([
      'stateChanged',
      'allocated',
      'released',
      'healthFailed',
      'booted',
      'discoveredAdded',
      'discoveredRemoved',
      'discoveredChanged',
      'pairAttempted',
    ]);
    expect(typeof emit.booted).toBe('function');
  });
});

describe('[Phase 36-00] pool events — discovery + pairing (entries 6-9)', () => {
  it('payload schemas accept valid + reject malformed samples', () => {
    const validDevice = {
      id: 'emulator-5554',
      name: 'Pixel_8_API_35',
      platform: 'android' as const,
      state: 'booted' as const,
      deviceType: 'Emulator' as const,
      osVersion: '15',
      model: 'Pixel 8',
    };

    // discovered.added / removed / changed all share discoveredDevicePayloadSchema shape.
    expect(deviceDiscoveredAddedPayload.safeParse({ device: validDevice }).success).toBe(true);
    expect(deviceDiscoveredRemovedPayload.safeParse({ device: validDevice }).success).toBe(true);
    expect(deviceDiscoveredChangedPayload.safeParse({ device: validDevice }).success).toBe(true);

    // Reject: bad platform.
    expect(deviceDiscoveredAddedPayload.safeParse({
      device: { ...validDevice, platform: 'windows' },
    }).success).toBe(false);
    // Reject: bad state.
    expect(deviceDiscoveredChangedPayload.safeParse({
      device: { ...validDevice, state: 'mystery' },
    }).success).toBe(false);
    // Reject: bad deviceType.
    expect(deviceDiscoveredRemovedPayload.safeParse({
      device: { ...validDevice, deviceType: 'Wear' },
    }).success).toBe(false);

    // pair.attempted
    const validUuid = randomUUID();
    expect(devicePairAttemptedPayload.safeParse({
      sessionId: validUuid,
      host: '192.168.1.50',
      port: 5555,
      outcome: 'success',
      actor: 'apikey:abc123',
    }).success).toBe(true);

    // Reject: outcome not in enum.
    expect(devicePairAttemptedPayload.safeParse({
      sessionId: validUuid, host: 'x', port: 5555, outcome: 'meh', actor: 'system',
    }).success).toBe(false);

    // Reject: port not positive int.
    expect(devicePairAttemptedPayload.safeParse({
      sessionId: validUuid, host: 'x', port: 0, outcome: 'success', actor: 'system',
    }).success).toBe(false);

    // Reject: sessionId not uuid.
    expect(devicePairAttemptedPayload.safeParse({
      sessionId: 'not-a-uuid', host: 'x', port: 5555, outcome: 'success', actor: 'system',
    }).success).toBe(false);
  });
});
