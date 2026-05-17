/**
 * WS envelope protocol spec — Phase 34 Plan 34-02.
 *
 * Full body covering both the 11-variant client envelope and the 4-variant
 * server envelope discriminated unions defined in
 * `server/sessions/internal/protocol.ts`.
 */
import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';

import {
  clientEnvelope,
  serverEnvelope,
  KEY_CODES,
  ERROR_CODES,
  EVENT_KINDS,
  type ClientEnvelope,
} from '../internal/protocol.js';

const newId = () => randomUUID();

// ---------- 11 client variants ----------

const clientFixtures: ClientEnvelope[] = [
  { id: newId(), type: 'tap', x: 540, y: 960 },
  { id: newId(), type: 'tapByDescription', target: 'Sign In button' },
  { id: newId(), type: 'type', text: 'hello world' },
  { id: newId(), type: 'swipe', x1: 100, y1: 200, x2: 100, y2: 800, durationMs: 500 },
  { id: newId(), type: 'key', code: 'home' },
  { id: newId(), type: 'screenshot' },
  { id: newId(), type: 'screenRecord', start: true },
  { id: newId(), type: 'installApp', artifactId: newId() },
  { id: newId(), type: 'launchApp', bundleId: 'com.example.app' },
  { id: newId(), type: 'uninstallApp', bundleId: 'com.example.app' },
  { id: newId(), type: 'ping' },
];

describe('clientEnvelope discriminated union (Plan 34-02)', () => {
  it('exposes exactly 11 client variants in the documented order', () => {
    const types = clientFixtures.map((v) => v.type);
    expect(types).toEqual([
      'tap',
      'tapByDescription',
      'type',
      'swipe',
      'key',
      'screenshot',
      'screenRecord',
      'installApp',
      'launchApp',
      'uninstallApp',
      'ping',
    ]);
    // Make sure the test grew alongside the schema — if we add a 12th the
    // discriminator option count below should bump.
    expect((clientEnvelope as unknown as { options: unknown[] }).options).toHaveLength(11);
  });

  it.each(clientFixtures)('parses %o roundtrip via JSON.stringify+parse', (fixture) => {
    const json = JSON.stringify(fixture);
    const parsed = clientEnvelope.safeParse(JSON.parse(json));
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      // Default-applied fields (e.g. swipe.durationMs) make the parsed object a
      // superset — assert each fixture key is present.
      for (const [k, v] of Object.entries(fixture)) {
        expect((parsed.data as Record<string, unknown>)[k]).toEqual(v);
      }
    }
  });

  it('rejects a client envelope with a missing id', () => {
    const r = clientEnvelope.safeParse({ type: 'tap', x: 10, y: 20 });
    expect(r.success).toBe(false);
  });

  it('rejects a client envelope whose id is not a uuid', () => {
    const r = clientEnvelope.safeParse({ id: 'not-a-uuid', type: 'tap', x: 10, y: 20 });
    expect(r.success).toBe(false);
  });

  it('rejects an unknown `type` field with a discriminator error', () => {
    const r = clientEnvelope.safeParse({ id: newId(), type: 'bogus' });
    expect(r.success).toBe(false);
    if (!r.success) {
      // Zod v4 surfaces discriminator failures as `invalid_value` or `invalid_union`
      // (the v3 `invalid_union_discriminator` code was removed; we just assert
      // that one of the issues was raised against the discriminator field).
      const codes = r.error.issues.map((i) => i.code);
      const includesDiscriminatorIssue = codes.some(
        (c) => c === 'invalid_value' || c === 'invalid_union',
      );
      expect(includesDiscriminatorIssue).toBe(true);
    }
  });

  it('rejects `type` with text exceeding 4096 chars', () => {
    const r = clientEnvelope.safeParse({ id: newId(), type: 'type', text: 'x'.repeat(4097) });
    expect(r.success).toBe(false);
  });

  it('rejects negative tap coords', () => {
    const r = clientEnvelope.safeParse({ id: newId(), type: 'tap', x: -1, y: 10 });
    expect(r.success).toBe(false);
  });

  it('rejects `key` codes outside the 8-member enum', () => {
    const r = clientEnvelope.safeParse({ id: newId(), type: 'key', code: 'eject' });
    expect(r.success).toBe(false);
  });

  it('accepts every `key` code in the documented 8-member enum', () => {
    for (const code of KEY_CODES) {
      const r = clientEnvelope.safeParse({ id: newId(), type: 'key', code });
      expect(r.success).toBe(true);
    }
  });

  it('applies default durationMs=500 on swipe when omitted', () => {
    const r = clientEnvelope.safeParse({
      id: newId(),
      type: 'swipe',
      x1: 0, y1: 0, x2: 10, y2: 10,
    });
    expect(r.success).toBe(true);
    if (r.success && r.data.type === 'swipe') {
      expect(r.data.durationMs).toBe(500);
    }
  });

  it('narrows TypeScript discriminated union via `if (envelope.type === "tap")`', () => {
    const envelope: ClientEnvelope = { id: newId(), type: 'tap', x: 1, y: 2 };
    if (envelope.type === 'tap') {
      // TS narrowing — compile-time proof that x is number, no `any`.
      const sum: number = envelope.x + envelope.y;
      expect(sum).toBe(3);
    } else {
      throw new Error('narrowing failed at runtime');
    }
  });
});

// ---------- 4 server variants ----------

describe('serverEnvelope discriminated union (Plan 34-02)', () => {
  it('exposes exactly 4 server variants (ack, error, event, pong)', () => {
    expect((serverEnvelope as unknown as { options: unknown[] }).options).toHaveLength(4);
  });

  it('ack carries forMsgId echo + durationMs + optional result', () => {
    const env = { type: 'ack' as const, forMsgId: newId(), durationMs: 42, result: { ok: true } };
    const r = serverEnvelope.safeParse(env);
    expect(r.success).toBe(true);
  });

  it('error allows forMsgId to be omitted (invalid_envelope path lacks an id)', () => {
    const r = serverEnvelope.safeParse({ type: 'error', code: 'invalid_envelope', message: 'oops' });
    expect(r.success).toBe(true);
  });

  it('event has no forMsgId field (server-initiated)', () => {
    const r = serverEnvelope.safeParse({ type: 'event', kind: 'connected', data: { heartbeatIntervalMs: 30000 } });
    expect(r.success).toBe(true);
  });

  it('pong echoes forMsgId of the originating ping', () => {
    const forMsgId = newId();
    const r = serverEnvelope.safeParse({ type: 'pong', forMsgId });
    expect(r.success).toBe(true);
    if (r.success && r.data.type === 'pong') expect(r.data.forMsgId).toBe(forMsgId);
  });

  it('rejects an error envelope with an unknown code', () => {
    const r = serverEnvelope.safeParse({ type: 'error', code: 'totally_bogus_code', message: '!' });
    expect(r.success).toBe(false);
  });

  it('rejects an event envelope with an unknown kind', () => {
    const r = serverEnvelope.safeParse({ type: 'event', kind: 'mystery-kind' });
    expect(r.success).toBe(false);
  });

  it('exposes ERROR_CODES and EVENT_KINDS as readonly tuples (RESEARCH §Error Codes)', () => {
    expect(ERROR_CODES).toEqual([
      'rate_limited',
      'invalid_envelope',
      'session_expired',
      'session_not_found',
      'resolver_failed',
      'device_error',
      'unauthorized',
      'invalid_state',
    ]);
    expect(EVENT_KINDS).toEqual([
      'connected',
      'device-lost',
      'lease-expiring',
      'app-crashed',
      'session-released',
    ]);
  });
});
