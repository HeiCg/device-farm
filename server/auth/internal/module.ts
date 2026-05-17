/**
 * Auth module factory — MOD-06 (Phase 26 Plan 26-03).
 *
 * 10TH persistEnvelope sample point reached. DEFERRED-25-A consolidation
 * deferred to Phase 27+ (carry-forward as DEFERRED-26-B). DO NOT consolidate
 * here — mirror Phase 16/18/19/20/21/22/23/24/25 verbatim shape.
 *
 * Builds:
 *   - AuthService (with Phase 26 validateKeyAndReturnRow + revokeKeyAndReturnRow + grantAdminClaim)
 *   - per-module TypedBus<AuthRegistry>
 *   - persistEnvelope closure (10TH SAMPLE POINT — projects envelope.actor onto events.actor TRACE-10)
 *   - emit helpers via makeAuthEmitters
 *   - registerWorkersAndSubscribers (no-op stub — Phase 27+ may add OIDC subscribers per DEFERRED-26-C)
 *   - shutdown (idempotent via stopped flag)
 */
import type { FastifyBaseLogger } from 'fastify';

import { TypedBus } from '../../bus/bus.js';
import type { Envelope } from '../../events/envelope.js';
import { events as eventsTable } from '../../db/schema.js';
import type { Database } from '../../db/index.js';
import {
  authRegistry,
  makeAuthEmitters,
  type AuthRegistry,
  type AuthEmitters,
} from '../events.js';
import { AuthService } from './auth-service.js';

export interface CreateAuthModuleDeps {
  db: Database;
  /** Optional override — factory creates per-module bus if omitted. */
  bus?: TypedBus<AuthRegistry>;
  logger: FastifyBaseLogger;
}

export interface AuthModule {
  authService: AuthService;
  bus: TypedBus<AuthRegistry>;
  emit: AuthEmitters;
  registerWorkersAndSubscribers(): Promise<void>;
  shutdown(): Promise<void>;
}

export function createAuthModule(deps: CreateAuthModuleDeps): AuthModule {
  if (!deps?.db) {
    throw new Error('createAuthModule: db dependency is required');
  }
  const { db, logger } = deps;
  const log = logger.child({ module: 'auth' });

  // Per-module bus (separate from the global app.bus — events surface narrow).
  const moduleBus = deps.bus ?? new TypedBus<AuthRegistry>(authRegistry);

  const authService = new AuthService(db);

  // --- 10TH persistEnvelope sample point — DEFERRED-26-B (carry-forward of -25-A) ---
  // Phase 16/18/19/20/21/22/23/24/25 each duplicated this ~10-line block. Phase
  // 27+ owns the consolidation. Mirror Phase 25 verbatim shape.
  function persistEnvelope(envelope: Envelope): void {
    const ee = (moduleBus as unknown as { ee: import('node:events').EventEmitter }).ee;
    ee.emit(`${envelope.type}.envelope`, envelope);

    const entry = authRegistry[envelope.type as keyof AuthRegistry];
    if (!entry || !entry.persisted) return;

    void (async () => {
      try {
        await db.insert(eventsTable).values({
          id: envelope.id,
          eventType: envelope.type,
          eventVersion: envelope.v,
          correlationId: envelope.correlationId,
          causationId: envelope.causationId ?? undefined,
          aggregateType: envelope.aggregateType,
          aggregateId: envelope.aggregateId,
          payload: envelope.payload as unknown,
          occurredAt: new Date(envelope.occurredAt),
          actor: envelope.actor, // TRACE-10 projection from ALS via createEventHelpers
        });
      } catch (err) {
        log.error({ err, envelope }, 'Failed to persist auth event');
      }
    })();
  }

  const emit = makeAuthEmitters(moduleBus, persistEnvelope);

  // --- Lifecycle ---
  let stopped = false;

  async function registerWorkersAndSubscribers(): Promise<void> {
    // Phase 26 has no cross-module subscribers + no queue workers. Phase 27+
    // may add (e.g., react to user.* events when OIDC arrives —
    // DEFERRED-26-C).
  }

  async function shutdown(): Promise<void> {
    if (stopped) return;
    stopped = true;
    log.info('auth module shutdown complete');
  }

  return {
    authService,
    bus: moduleBus,
    emit,
    registerWorkersAndSubscribers,
    shutdown,
  };
}
