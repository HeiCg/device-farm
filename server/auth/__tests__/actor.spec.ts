/**
 * Auth module — actorSchema spec (Plan 26-00 substrate proof in Plan 26-01).
 *
 * Validates the TRACE-10 actor regex from server/auth/internal/actor.ts
 * accepts the 4 documented forms (user/apikey/system/cron[:queue]) and
 * rejects the Phase 26 anti-pattern `'anonymous'` literal.
 *
 * Why this spec lives in Plan 26-01 (not 26-00): the actorSchema body shipped
 * at substrate level in 26-00 so 26-02 grep-guards could import it; this
 * spec proves the regex is correct as a precondition for 26-02 wiring.
 */
import { describe, it, expect } from 'vitest';

import {
  actorSchema,
  asApiKeyActor,
  asUserActor,
  SYSTEM_ACTOR,
  CRON_ACTOR,
} from '../internal/actor.js';

describe('Phase 26 — actorSchema regex (TRACE-10 substrate)', () => {
  const accepted = [
    'apikey:abc-123-def',
    'user:xyz789',
    'system',
    'cron',
    'cron:job-execute',
    'cron:webhook-deliver',
    'apikey:550e8400-e29b-41d4-a716-446655440000',
    'user:abc-1',
  ];
  for (const a of accepted) {
    it(`accepts "${a}"`, () => {
      expect(actorSchema.safeParse(a).success).toBe(true);
    });
  }

  const rejected = [
    'anonymous',         // Phase 26 anti-pattern
    'apikey:UPPERCASE',  // regex is lowercase-only
    'apikey:',           // empty id segment
    '',                  // empty string
    'foo:bar',           // unknown actor type prefix
    'user',              // user requires :id suffix
    'apikey',            // apikey requires :id suffix
    'cron:UPPERCASE',    // cron suffix lowercase only
    'system:something',  // system has no suffix variant
  ];
  for (const a of rejected) {
    it(`REJECTS "${a}"`, () => {
      expect(actorSchema.safeParse(a).success).toBe(false);
    });
  }
});

describe('Phase 26 — actor helpers (TRACE-10 producers)', () => {
  it('asApiKeyActor formats apikey:{id}', () => {
    expect(asApiKeyActor('id-1')).toBe('apikey:id-1');
    // Round-trip: helper output is itself a valid Actor
    expect(actorSchema.safeParse(asApiKeyActor('abc-123-def')).success).toBe(true);
  });

  it('asUserActor formats user:{id}', () => {
    expect(asUserActor('u-1')).toBe('user:u-1');
    expect(actorSchema.safeParse(asUserActor('user-99')).success).toBe(true);
  });

  it('SYSTEM_ACTOR === "system" + CRON_ACTOR === "cron" const literals', () => {
    expect(SYSTEM_ACTOR).toBe('system');
    expect(CRON_ACTOR).toBe('cron');
    // Round-trip both through the schema
    expect(actorSchema.safeParse(SYSTEM_ACTOR).success).toBe(true);
    expect(actorSchema.safeParse(CRON_ACTOR).success).toBe(true);
  });
});
