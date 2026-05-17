/**
 * Auth module — factory shape spec (Plan 26-03).
 *
 * No DB. Mock-based. Proves MOD-06 createAuthModule shape + 2-emitter surface
 * + persistEnvelope onEmit hook invocation (10TH SAMPLE POINT smoke check).
 *
 * Mirror of Phase 25 pipelines/__tests__/module.spec.ts shape (no DB-gated proof
 * here — that lands in Plan 26-04 subscriber.spec / als-actor.spec).
 */
import { describe, it, expect, vi } from 'vitest';
import { createAuthModule } from '../internal/module.js';

function mkLogger() {
  const log = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    child: () => log,
  };
  return log as never;
}

function mkDb() {
  return {
    insert: vi.fn(() => ({ values: vi.fn(() => Promise.resolve(undefined)) })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({ where: vi.fn(() => Promise.resolve([])) })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({ where: vi.fn(() => Promise.resolve(undefined)) })),
    })),
  } as never;
}

describe('Phase 26 — createAuthModule factory (MOD-06)', () => {
  it('returns expected shape {authService, bus, emit, registerWorkersAndSubscribers, shutdown}', () => {
    const m = createAuthModule({ db: mkDb(), logger: mkLogger() });
    expect(m.authService).toBeDefined();
    expect(m.bus).toBeDefined();
    expect(m.emit).toBeDefined();
    expect(typeof m.registerWorkersAndSubscribers).toBe('function');
    expect(typeof m.shutdown).toBe('function');
  });

  it('emit has 2 functions: keyCreated, keyRevoked', () => {
    const m = createAuthModule({ db: mkDb(), logger: mkLogger() });
    expect(typeof m.emit.keyCreated).toBe('function');
    expect(typeof m.emit.keyRevoked).toBe('function');
  });

  it('shutdown is idempotent (call twice, no throw)', async () => {
    const m = createAuthModule({ db: mkDb(), logger: mkLogger() });
    await m.shutdown();
    await m.shutdown();
    await m.shutdown();
    // No throw = pass
  });

  it('bus is a TypedBus instance (per-module .on accessor)', () => {
    const m = createAuthModule({ db: mkDb(), logger: mkLogger() });
    expect(m.bus).toBeDefined();
    expect(typeof (m.bus as { on?: unknown }).on).toBe('function');
  });

  it('factory throws clear error when db is missing', () => {
    expect(() =>
      createAuthModule({ db: null as never, logger: mkLogger() }),
    ).toThrow(/db.*required/i);
  });

  it('registerWorkersAndSubscribers does not throw on call', async () => {
    const m = createAuthModule({ db: mkDb(), logger: mkLogger() });
    await expect(m.registerWorkersAndSubscribers()).resolves.toBeUndefined();
  });

  it('emit.keyCreated invokes persistEnvelope (DB insert) when called', async () => {
    const db = mkDb();
    const m = createAuthModule({ db, logger: mkLogger() });
    const id = '550e8400-e29b-41d4-a716-446655440001';
    m.emit.keyCreated(id, {
      keyId: id,
      keyName: 'test',
      prefix: 'abcd1234',
      createdBy: 'system',
    });
    // Allow async fire-and-forget persistEnvelope to enqueue
    await new Promise((r) => setImmediate(r));
    expect((db as { insert: ReturnType<typeof vi.fn> }).insert).toHaveBeenCalled();
  });

  it('emit.keyRevoked invokes persistEnvelope (DB insert) when called', async () => {
    const db = mkDb();
    const m = createAuthModule({ db, logger: mkLogger() });
    const id = '550e8400-e29b-41d4-a716-446655440002';
    m.emit.keyRevoked(id, {
      keyId: id,
      keyName: 'test-revoked',
      revokedBy: 'system',
    });
    await new Promise((r) => setImmediate(r));
    expect((db as { insert: ReturnType<typeof vi.fn> }).insert).toHaveBeenCalled();
  });
});
