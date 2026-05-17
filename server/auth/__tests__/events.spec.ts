/**
 * Auth module — events shape spec (Plan 26-01 full body).
 *
 * Proves EVENTS-03 (dot-separated past-tense), TRACE-08 (BOTH persisted),
 * AUTH_AGGREGATE_ID v5 derivation, payload schema validation including
 * actorSchema type-narrowing on createdBy/revokedBy fields, and ALS
 * stamping via makeAuthEmitters factory.
 *
 * NO DB required — uses TypedBus directly + in-memory onEmit capture.
 * Uses CANONICAL plain-object ALS store shape per Phase 20+ convention.
 */
import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { v5 as uuidv5 } from 'uuid';
import { asyncLocalStorage } from '@fastify/request-context';

import { TypedBus } from '../../bus/bus.js';
import type { Envelope } from '../../events/envelope.js';
import {
  AUTH_EVENT_NAMES,
  AUTH_AGGREGATE_ID,
  AUTH_AGGREGATE_TYPE,
  authRegistry,
  authKeyCreatedPayloadSchema,
  authKeyRevokedPayloadSchema,
  makeAuthEmitters,
} from '../events.js';

const URL_NAMESPACE = '6ba7b811-9dad-11d1-80b4-00c04fd430c8';

describe('Phase 26 — auth events (EVENTS-03 shape)', () => {
  it('AUTH_EVENT_NAMES has 2 dot-separated past-tense names with no duplicates', () => {
    const values = Object.values(AUTH_EVENT_NAMES);
    expect(values.length).toBe(2);
    expect(new Set(values).size).toBe(2); // all unique
    // Phase 26 spec: noun.verbed (past tense) dotted
    expect(values).toEqual([
      'auth.key.created',
      'auth.key.revoked',
    ]);
    for (const name of values) {
      expect(name).toMatch(/^[a-z][a-z0-9._-]*\.[a-z][a-z0-9._-]*\.[a-z][a-z0-9._-]*$/);
    }
  });

  it('authRegistry has 2 entries with aggregateType=auth on both', () => {
    const entries = Object.entries(authRegistry);
    expect(entries.length).toBe(2);
    for (const [, def] of entries) {
      expect(def.aggregateType).toBe(AUTH_AGGREGATE_TYPE);
      expect(def.aggregateType).toBe('auth');
    }
  });

  it('[TRACE-08] BOTH registry entries persisted: true (security audit, counter-maestro)', () => {
    // Both auth.key.* events must carry `persisted: true` for the audit trail.
    expect(authRegistry['auth.key.created'].persisted).toBe(true);
    expect(authRegistry['auth.key.revoked'].persisted).toBe(true);
    // Confirm count of `persisted: true` entries == 2 (no transient slipped in)
    const persistedCount = Object.values(authRegistry).filter((e) => e.persisted).length;
    expect(persistedCount).toBe(2);
  });

  it('AUTH_AGGREGATE_ID re-derives from uuidv5(auth, URL_NAMESPACE) — single source of truth', () => {
    const recomputed = uuidv5('auth', URL_NAMESPACE);
    expect(AUTH_AGGREGATE_ID).toBe(recomputed);
    // Must be a v5 UUID
    expect(AUTH_AGGREGATE_ID).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});

describe('Phase 26 — auth payload schemas + actorSchema enforcement (TRACE-10)', () => {
  it('authKeyCreatedPayloadSchema accepts valid payload with apikey actor', () => {
    const valid = {
      keyId: randomUUID(),
      keyName: 'test-key',
      prefix: 'abc12345',
      createdBy: 'apikey:requester-id',
    };
    expect(authKeyCreatedPayloadSchema.safeParse(valid).success).toBe(true);
  });

  it('authKeyCreatedPayloadSchema accepts system + user actor forms', () => {
    const base = {
      keyId: randomUUID(),
      keyName: 'k',
      prefix: 'abcdef12',
    };
    expect(authKeyCreatedPayloadSchema.safeParse({ ...base, createdBy: 'system' }).success).toBe(true);
    expect(authKeyCreatedPayloadSchema.safeParse({ ...base, createdBy: 'user:abc-123' }).success).toBe(true);
    expect(authKeyCreatedPayloadSchema.safeParse({ ...base, createdBy: 'cron' }).success).toBe(true);
  });

  it('authKeyCreatedPayloadSchema REJECTS createdBy:anonymous (actorSchema blocks Phase 26 anti-pattern)', () => {
    const invalid = {
      keyId: randomUUID(),
      keyName: 'x',
      prefix: 'p1234567',
      createdBy: 'anonymous',
    };
    expect(authKeyCreatedPayloadSchema.safeParse(invalid).success).toBe(false);
  });

  it('authKeyCreatedPayloadSchema REJECTS missing keyId/keyName + bad uuid', () => {
    expect(authKeyCreatedPayloadSchema.safeParse({
      keyName: 'x', prefix: 'p1234567', createdBy: 'system',
    }).success).toBe(false);
    expect(authKeyCreatedPayloadSchema.safeParse({
      keyId: 'not-a-uuid', keyName: 'x', prefix: 'p1234567', createdBy: 'system',
    }).success).toBe(false);
    expect(authKeyCreatedPayloadSchema.safeParse({
      keyId: randomUUID(), keyName: '', prefix: 'p1234567', createdBy: 'system',
    }).success).toBe(false);
  });

  it('authKeyRevokedPayloadSchema accepts revocationReason undefined OR present', () => {
    const base = {
      keyId: randomUUID(),
      keyName: 'old-key',
      revokedBy: 'apikey:revoker-id',
    };
    // undefined / absent
    expect(authKeyRevokedPayloadSchema.safeParse(base).success).toBe(true);
    // present
    expect(authKeyRevokedPayloadSchema.safeParse({ ...base, revocationReason: 'compromised' }).success).toBe(true);
    expect(authKeyRevokedPayloadSchema.safeParse({ ...base, revocationReason: 'rotation' }).success).toBe(true);
  });

  it('authKeyRevokedPayloadSchema REJECTS keyId not-a-uuid + revokedBy:anonymous', () => {
    expect(authKeyRevokedPayloadSchema.safeParse({
      keyId: 'not-a-uuid',
      keyName: 'x',
      revokedBy: 'system',
    }).success).toBe(false);
    expect(authKeyRevokedPayloadSchema.safeParse({
      keyId: randomUUID(),
      keyName: 'x',
      revokedBy: 'anonymous',
    }).success).toBe(false);
  });
});

describe('Phase 26 — makeAuthEmitters factory + ALS stamping (TRACE-04 + TRACE-10)', () => {
  it('makeAuthEmitters returns exactly 2 typed helpers (keyCreated, keyRevoked)', () => {
    const bus = new TypedBus(authRegistry);
    const emit = makeAuthEmitters(bus);
    expect(Object.keys(emit)).toEqual(['keyCreated', 'keyRevoked']);
    expect(typeof emit.keyCreated).toBe('function');
    expect(typeof emit.keyRevoked).toBe('function');
  });

  it('emit.keyCreated stamps envelope with ALS correlationId + actor + aggregateType=auth + aggregateId=keyId', async () => {
    const bus = new TypedBus(authRegistry);
    const captured: Envelope[] = [];
    const emit = makeAuthEmitters(bus, (env) => captured.push(env));

    const cid = randomUUID();
    const keyId = randomUUID();
    const requesterActor = 'apikey:requester-xyz';

    await asyncLocalStorage.run(
      { correlationId: cid, currentEventId: null, actor: requesterActor } as never,
      async () => {
        const envelope = emit.keyCreated(keyId, {
          keyId,
          keyName: 'test-key',
          prefix: 'abc12345',
          createdBy: requesterActor,
        });
        expect(envelope.correlationId).toBe(cid);
        expect(envelope.actor).toBe(requesterActor);
        expect(envelope.aggregateType).toBe('auth');
        expect(envelope.aggregateId).toBe(keyId);
        expect(envelope.type).toBe('auth.key.created');
        expect(envelope.v).toBe(1);
      },
    );

    expect(captured).toHaveLength(1);
    expect(captured[0].correlationId).toBe(cid);
    expect(captured[0].actor).toBe(requesterActor);
  });

  it('emit.keyRevoked round-trips revocationReason field + stamps system actor from ALS', async () => {
    const bus = new TypedBus(authRegistry);
    const captured: Envelope[] = [];
    const emit = makeAuthEmitters(bus, (env) => captured.push(env));

    const cid = randomUUID();
    const keyId = randomUUID();

    await asyncLocalStorage.run(
      { correlationId: cid, currentEventId: null, actor: 'system' } as never,
      async () => {
        const envelope = emit.keyRevoked(keyId, {
          keyId,
          keyName: 'old-key',
          revokedBy: 'system',
          revocationReason: 'compromised',
        });
        expect(envelope.actor).toBe('system');
        expect(envelope.aggregateType).toBe('auth');
        expect(envelope.aggregateId).toBe(keyId);
        expect(envelope.type).toBe('auth.key.revoked');
        expect((envelope.payload as { revocationReason?: string }).revocationReason).toBe('compromised');
      },
    );

    expect(captured).toHaveLength(1);
    expect((captured[0].payload as { revocationReason?: string }).revocationReason).toBe('compromised');
  });
});
