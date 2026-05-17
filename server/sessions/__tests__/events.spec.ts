/**
 * Sessions events spec — Phase 34 Plan 34-01 full body.
 *
 * Proves:
 *   - EVENTS-03 dotted past-tense + uniqueness on 4 event names.
 *   - registry shape (4 entries, all persisted, all aggregateType='session').
 *   - per-event payload roundtrip (valid sample passes, missing field fails).
 *   - actorSchema enforcement (passing 'anonymous' to ownerActor field rejects).
 *   - emitter shape (4 functions returned).
 *   - TRACE-10 ALS-stamped envelope on emit (correlationId + actor inherited).
 *
 * NO DB required — uses TypedBus directly + in-memory onEmit capture (mirrors
 * server/auth/__tests__/events.spec.ts pattern).
 */
import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { asyncLocalStorage } from '@fastify/request-context';

import { TypedBus } from '../../bus/bus.js';
import type { Envelope } from '../../events/envelope.js';
import {
  SESSION_EVENT_NAMES,
  SESSIONS_AGGREGATE_TYPE,
  sessionsRegistry,
  sessionLeasedPayloadSchema,
  sessionReleasedPayloadSchema,
  sessionExpiredPayloadSchema,
  sessionDeviceLostPayloadSchema,
  makeSessionsEmitters,
} from '../events.js';

describe('Phase 34 — sessions events (EVENTS-03 shape)', () => {
  it('SESSION_EVENT_NAMES has 4 dotted past-tense entries with no duplicates', () => {
    const values = Object.values(SESSION_EVENT_NAMES);
    expect(values).toHaveLength(4);
    expect(new Set(values).size).toBe(4);
    expect(values).toEqual([
      'session.leased',
      'session.released',
      'session.expired',
      'session.device.lost',
    ]);
    for (const name of values) {
      expect(name).toMatch(/^session\.[a-z]+(\.[a-z]+)*$/);
    }
  });

  it('SESSIONS_AGGREGATE_TYPE is `session`', () => {
    expect(SESSIONS_AGGREGATE_TYPE).toBe('session');
  });

  it('sessionsRegistry has 4 entries — ALL persisted, ALL aggregateType=session', () => {
    const entries = Object.entries(sessionsRegistry);
    expect(entries).toHaveLength(4);
    for (const [, def] of entries) {
      expect(def.persisted).toBe(true);
      expect(def.aggregateType).toBe('session');
    }
    const persistedCount = Object.values(sessionsRegistry).filter((e) => e.persisted).length;
    expect(persistedCount).toBe(4);
  });
});

describe('Phase 34 — sessions payload schemas + actorSchema enforcement (TRACE-10)', () => {
  it('sessionLeasedPayloadSchema accepts valid payload with apikey ownerActor', () => {
    const valid = {
      sessionId: randomUUID(),
      deviceId: randomUUID(),
      deviceName: 'pixel-7-pro',
      platform: 'android' as const,
      ttlSeconds: 600,
      leaseUntil: new Date(Date.now() + 600_000).toISOString(),
      ownerActor: 'apikey:requester-id',
      metadata: { foo: 'bar' },
    };
    expect(sessionLeasedPayloadSchema.safeParse(valid).success).toBe(true);
    // metadata: null is also allowed
    expect(sessionLeasedPayloadSchema.safeParse({ ...valid, metadata: null }).success).toBe(true);
  });

  it('sessionLeasedPayloadSchema REJECTS ownerActor:anonymous (TRACE-10 invariant)', () => {
    const invalid = {
      sessionId: randomUUID(),
      deviceId: randomUUID(),
      deviceName: 'pixel-7-pro',
      platform: 'android' as const,
      ttlSeconds: 600,
      leaseUntil: new Date().toISOString(),
      ownerActor: 'anonymous',
      metadata: null,
    };
    expect(sessionLeasedPayloadSchema.safeParse(invalid).success).toBe(false);
  });

  it('sessionLeasedPayloadSchema REJECTS missing sessionId + bad uuid + bad leaseUntil', () => {
    const base = {
      deviceId: randomUUID(),
      deviceName: 'x',
      platform: 'android' as const,
      ttlSeconds: 600,
      leaseUntil: new Date().toISOString(),
      ownerActor: 'system',
      metadata: null,
    };
    // missing sessionId
    expect(sessionLeasedPayloadSchema.safeParse(base).success).toBe(false);
    // bad uuid
    expect(sessionLeasedPayloadSchema.safeParse({ ...base, sessionId: 'not-a-uuid' }).success).toBe(false);
    // bad datetime
    expect(sessionLeasedPayloadSchema.safeParse({
      ...base, sessionId: randomUUID(), leaseUntil: 'not-an-iso-datetime',
    }).success).toBe(false);
  });

  it('sessionReleasedPayloadSchema accepts all reason values + rejects bad reason + anonymous', () => {
    const base = {
      sessionId: randomUUID(),
      deviceId: randomUUID(),
      releasedBy: 'apikey:requester-id',
    };
    for (const reason of ['explicit', 'sweeper', 'device-lost', 'shutdown'] as const) {
      expect(sessionReleasedPayloadSchema.safeParse({ ...base, reason }).success).toBe(true);
    }
    // bad reason
    expect(sessionReleasedPayloadSchema.safeParse({ ...base, reason: 'other' }).success).toBe(false);
    // anonymous releasedBy
    expect(sessionReleasedPayloadSchema.safeParse({
      ...base, reason: 'explicit', releasedBy: 'anonymous',
    }).success).toBe(false);
  });

  it('sessionExpiredPayloadSchema + sessionDeviceLostPayloadSchema roundtrip valid + reject malformed', () => {
    const expValid = {
      sessionId: randomUUID(),
      deviceId: randomUUID(),
      leaseUntil: new Date().toISOString(),
    };
    expect(sessionExpiredPayloadSchema.safeParse(expValid).success).toBe(true);
    expect(sessionExpiredPayloadSchema.safeParse({ ...expValid, sessionId: 'bad' }).success).toBe(false);

    const dlValid = {
      sessionId: randomUUID(),
      deviceId: randomUUID(),
      reason: 'device crashed during health check',
    };
    expect(sessionDeviceLostPayloadSchema.safeParse(dlValid).success).toBe(true);
    expect(sessionDeviceLostPayloadSchema.safeParse({ ...dlValid, deviceId: 'bad' }).success).toBe(false);
  });
});

describe('Phase 34 — makeSessionsEmitters factory + ALS stamping (TRACE-04 + TRACE-10)', () => {
  it('makeSessionsEmitters returns exactly 4 typed helpers', () => {
    const bus = new TypedBus(sessionsRegistry);
    const emit = makeSessionsEmitters(bus);
    expect(Object.keys(emit).sort()).toEqual(['deviceLost', 'expired', 'leased', 'released']);
    expect(typeof emit.leased).toBe('function');
    expect(typeof emit.released).toBe('function');
    expect(typeof emit.expired).toBe('function');
    expect(typeof emit.deviceLost).toBe('function');
  });

  it('emit.leased stamps envelope with ALS correlationId + actor + aggregateType=session', async () => {
    const bus = new TypedBus(sessionsRegistry);
    const captured: Envelope[] = [];
    const emit = makeSessionsEmitters(bus, (env) => captured.push(env));

    const cid = randomUUID();
    const sessionId = randomUUID();
    const deviceId = randomUUID();
    const requesterActor = 'apikey:requester-xyz';

    await asyncLocalStorage.run(
      { correlationId: cid, currentEventId: null, actor: requesterActor } as never,
      async () => {
        const envelope = emit.leased(sessionId, {
          sessionId,
          deviceId,
          deviceName: 'pixel-7-pro',
          platform: 'android',
          ttlSeconds: 600,
          leaseUntil: new Date(Date.now() + 600_000).toISOString(),
          ownerActor: requesterActor,
          metadata: null,
        });
        expect(envelope.correlationId).toBe(cid);
        expect(envelope.actor).toBe(requesterActor);
        expect(envelope.aggregateType).toBe('session');
        expect(envelope.aggregateId).toBe(sessionId);
        expect(envelope.type).toBe('session.leased');
        expect(envelope.v).toBe(1);
      },
    );

    expect(captured).toHaveLength(1);
    expect(captured[0].correlationId).toBe(cid);
    expect(captured[0].actor).toBe(requesterActor);
  });

  it('emit.released falls back to system actor when ALS empty', async () => {
    const bus = new TypedBus(sessionsRegistry);
    const captured: Envelope[] = [];
    const emit = makeSessionsEmitters(bus, (env) => captured.push(env));

    const sessionId = randomUUID();
    const deviceId = randomUUID();

    // No ALS run — createEventHelpers defaults to 'system'.
    const envelope = emit.released(sessionId, {
      sessionId,
      deviceId,
      reason: 'shutdown',
      releasedBy: 'system',
    });
    expect(envelope.actor).toBe('system');
    expect(envelope.aggregateType).toBe('session');
    expect(envelope.aggregateId).toBe(sessionId);
    expect(envelope.type).toBe('session.released');
    expect(captured).toHaveLength(1);
  });
});
