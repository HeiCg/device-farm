/**
 * Sessions module factory — MOD-06 (Phase 34 Plan 34-01).
 *
 * Replaces the Plan 34-00 throw-stub with the full factory body:
 *   - per-module TypedBus<SessionsRegistry>
 *   - persistEnvelope closure (11TH SAMPLE POINT — DEFERRED-26-B continues;
 *     Phase 27+ owns consolidation per the 25-A/26-B chain)
 *   - emit helpers via makeSessionsEmitters(bus, persistEnvelope)
 *   - leaseDevice — pool allocate + sessions INSERT (Drizzle txn) + 23505 → 409
 *   - releaseDevice — owner/admin auth check + pool release + status update
 *   - listSessions — SELECT + devices LEFT JOIN
 *   - openSockets — Map<sessionId, WebSocket> (populated by 34-02 WS handler)
 *   - shutdown — idempotent; closes any open sockets
 *
 * SHAPE mirrors Phase 23 jobs + Phase 26 auth factories verbatim.
 */
import { randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type pino from 'pino';

import { tangoAdbService } from '@device-stream/android';
import * as schema from '../../db/schema.js';
import { events as eventsTable } from '../../db/schema.js';
import { TypedBus } from '../../bus/bus.js';
import type { Envelope } from '../../events/envelope.js';
import type { Database } from '../../db/index.js';
import type { Actor } from '../../auth/index.js';

import {
  sessionsRegistry,
  makeSessionsEmitters,
  type SessionsRegistry,
  type SessionsEmitters,
} from '../events.js';
import {
  type LeaseRequest,
  type LeaseResponse,
  type ReleaseResponse,
  type ListResponse,
} from '../schemas.js';
import { createRateLimiter, type RateLimiter } from './rate-limit.js';

/**
 * Minimal WebSocket-like surface — 34-02 stores `@fastify/websocket` SocketStream
 * references in `openSockets`. We model only the methods the module needs
 * (send + close + ping) to avoid pulling the ws dep into this file.
 */
export interface SessionOpenSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface CreateSessionsModuleDeps {
  fastify: FastifyInstance;
  db: Database;
  /** Optional override — factory creates per-module bus if omitted (matches Phase 26). */
  bus?: TypedBus<SessionsRegistry>;
  logger: pino.Logger;
}

export interface SessionsModule {
  bus: TypedBus<SessionsRegistry>;
  emit: SessionsEmitters;
  /**
   * In-memory map of active WS connections keyed by sessionId.
   * Empty at Plan 34-01 substrate. Populated by Plan 34-02 WS upgrade handler;
   * iterated by Plan 34-04 sweeper to broadcast session.released on TTL expiry.
   */
  openSockets: Map<string, SessionOpenSocket>;
  /**
   * Sliding-window rate limiter shared with the WS handler (`ws.ts` reads
   * `sessionsModule.rateLimiter` per-message instead of the Plan 34-02 stub).
   * Plan 34-04 sweeper calls `clear(sessionId)` on expiry to prevent the
   * per-session timestamp Map from leaking on long-lived servers
   * (RESEARCH §Open Q #6 mitigation).
   */
  rateLimiter: RateLimiter;
  /**
   * Registers cross-module subscribers (e.g. `device.health.failed` → device-lost
   * broadcast + auto-expire). Idempotent — safe to call multiple times in tests.
   * Production wiring calls this once from `onReady` so all modules are registered.
   */
  registerSubscribers(): Promise<void>;
  leaseDevice(input: LeaseRequest, requesterActor: Actor, bearerToken: string): Promise<LeaseResponse>;
  releaseDevice(
    sessionId: string,
    requesterActor: Actor,
    isAdmin: boolean,
    reason?: 'explicit' | 'sweeper' | 'device-lost' | 'shutdown',
  ): Promise<ReleaseResponse>;
  listSessions(filter?: { status?: 'active' | 'released' | 'expired' }): Promise<ListResponse>;
  /**
   * Phase 37 Plan 37-04 — public dispatch API consumed by InputBroadcaster
   * (server/jobs/internal/input-broadcaster.ts).
   *
   * Validates the session is active (Pitfall 8 — race-safe at dispatch, not
   * pre-checked on the caller side which would race with the sweeper) and
   * forwards the action to whichever surface accepts it. Wave 1 implementation
   * is a thin shim that uses the existing openSockets map to push the action
   * as a synthetic server event when the session has an active WS, OR throws
   * a "session not active" error so the broadcaster surfaces it per-session.
   *
   * The dispatch surface is intentionally narrow (tap/key/text only) — stateful
   * actions like screenshot/installApp don't fan out cleanly.
   */
  dispatch(
    sessionId: string,
    action:
      | { type: 'tap'; touch: { x: number; y: number } }
      | { type: 'key'; event: { key: string; modifiers?: string[] } }
      | { type: 'text'; text: string },
  ): Promise<void>;
  shutdown(): Promise<void>;
}

// ---------- Module-specific error helpers ----------

/**
 * Throw an RFC 7807 problem+json error. The Fastify error-handler
 * (server/api/error-handler.ts) maps `.statusCode` to the HTTP code and uses
 * `.code` for the type URL. We additionally stash a `detail` string for the
 * `detail` field — error.message carries the same.
 */
function httpError(statusCode: number, code: string, detail: string): Error & {
  statusCode: number;
  code: string;
} {
  const err = new Error(detail) as Error & { statusCode: number; code: string };
  err.statusCode = statusCode;
  err.code = code;
  return err;
}

/**
 * Parse `apikey:<uuid>` actor → uuid. Returns null for system/cron/user actors
 * (the sessions.ownerApiKeyId column is FK to api_keys — only apikey actors
 * carry a row reference).
 */
export function extractKeyId(actor: Actor): string | null {
  if (actor.startsWith('apikey:')) return actor.slice('apikey:'.length);
  return null;
}

/**
 * 11TH SAMPLE POINT for persistEnvelope duplication (DEFERRED-26-B continues).
 *
 * Phase 16/18/19/20/21/22/23/24/25/26 each duplicated this ~10-line block.
 * Phase 27+ owns the consolidation. DO NOT consolidate here — mirror Phase 26
 * verbatim shape with sessionsRegistry substitution.
 */
function makePersistEnvelope(deps: {
  db: Database;
  bus: TypedBus<SessionsRegistry>;
  logger: pino.Logger;
}) {
  const ee = (deps.bus as unknown as { ee: import('node:events').EventEmitter }).ee;
  return function persistEnvelope(envelope: Envelope): void {
    ee.emit(`${envelope.type}.envelope`, envelope);

    const entry = sessionsRegistry[envelope.type as keyof SessionsRegistry];
    if (!entry || !entry.persisted) return;

    void (async () => {
      try {
        await deps.db.insert(eventsTable).values({
          id: envelope.id,
          eventType: envelope.type,
          eventVersion: envelope.v,
          correlationId: envelope.correlationId,
          causationId: envelope.causationId ?? undefined,
          aggregateType: envelope.aggregateType,
          aggregateId: envelope.aggregateId,
          payload: envelope.payload as unknown,
          occurredAt: new Date(envelope.occurredAt),
          actor: envelope.actor,
        });
      } catch (err) {
        deps.logger.error({ err, envelope }, 'Failed to persist sessions event');
      }
    })();
  };
}

export function createSessionsModule(deps: CreateSessionsModuleDeps): SessionsModule {
  const { fastify, db, logger } = deps;
  const log = logger.child({ module: 'sessions' });

  // ---------- Per-module typed bus + persistence ----------
  const bus = deps.bus ?? new TypedBus<SessionsRegistry>(sessionsRegistry);
  const persistEnvelope = makePersistEnvelope({ db, bus, logger: log });
  const emit = makeSessionsEmitters(bus, persistEnvelope);

  // ---------- WS connection registry (empty at 34-01; populated by 34-02) ----------
  const openSockets = new Map<string, SessionOpenSocket>();

  // ---------- Rate limiter (Plan 34-04) ----------
  // 30 actions per 10s per session (CONTEXT.md LOCKED defaults). Shared with
  // ws.ts via `sessionsModule.rateLimiter` so the WS handler doesn't import
  // module-level singletons of its own. Cleared on session expiry by sweeper.
  const rateLimiter = createRateLimiter();

  let stopped = false;
  let subscribersRegistered = false;

  // ---------- Build wsUrl (server-authoritative) ----------
  function buildWsUrl(sessionId: string, bearerToken: string): string {
    // Phase 34 config has no tls/publicHost field — current Wave 1 default
    // is plain ws on the configured server.host:port. Phase 36+ (TLS) will
    // extend the config schema; this helper centralizes the construction so
    // a single edit point exists.
    const port = fastify.config.server?.port ?? 3000;
    const rawHost = fastify.config.server?.host ?? '0.0.0.0';
    // 0.0.0.0 is a bind-only literal — substitute localhost for client-facing URL.
    const host = rawHost === '0.0.0.0' || rawHost === '::' ? `localhost:${port}` : `${rawHost}:${port}`;
    const scheme = 'ws';
    return `${scheme}://${host}/ws/sessions/${sessionId}?token=${encodeURIComponent(bearerToken)}`;
  }

  // ---------- device.health.failed subscriber (Plan 34-04) ----------
  // Converts a pool health-failure into a `device-lost` WS event + session
  // expiry. Uses module.releaseDevice (defined below via late binding through
  // the `module` reference) so the cleanup flow stays identical to explicit
  // release. TypedBus.on delivers the payload directly (see server/bus/bus.ts:46).
  async function handleDeviceHealthFailed(payload: unknown): Promise<void> {
    const p = payload as { deviceId?: string };
    if (!p || typeof p.deviceId !== 'string') return;
    const deviceId = p.deviceId;

    const rows = await db
      .select()
      .from(schema.sessions)
      .where(
        and(eq(schema.sessions.deviceId, deviceId), eq(schema.sessions.status, 'active')),
      )
      .limit(1);
    const session = rows[0];
    if (!session) return;

    // Broadcast device-lost to the open WS (if any) BEFORE state mutations
    // (consumers see consistent state).
    const socket = openSockets.get(session.id);
    if (socket) {
      try {
        socket.send(JSON.stringify({
          type: 'event', kind: 'device-lost', data: { deviceId },
        }));
        socket.close(1011, 'device-lost');
      } catch (err) {
        log.warn({ err, sessionId: session.id }, 'device-lost: WS broadcast failed');
      }
      openSockets.delete(session.id);
    }

    try {
      await fastify.pool.release(deviceId);
    } catch (err) {
      log.error({ err, deviceId }, 'device-lost: pool.release failed');
    }

    // Disconnect tangoAdbService counterpart to leaseDevice step 1b.
    const lostDev = fastify.pool.getDeviceMap().get(deviceId);
    if (lostDev && lostDev.platform === 'android') {
      const serial = lostDev.port == null ? lostDev.emulatorId : `emulator-${lostDev.port}`;
      void tangoAdbService.disconnect(serial).catch((err) =>
        log.warn({ err, deviceId, serial }, 'device-lost: tangoAdbService.disconnect failed'),
      );
    }

    const releasedAt = new Date();
    await db
      .update(schema.sessions)
      .set({ status: 'expired', releasedAt })
      .where(eq(schema.sessions.id, session.id));

    emit.deviceLost(session.id, {
      sessionId: session.id,
      deviceId,
      reason: 'device.health.failed',
    });

    rateLimiter.clear(session.id);
  }

  const module: SessionsModule = {
    bus,
    emit,
    openSockets,
    rateLimiter,

    registerSubscribers: async () => {
      if (subscribersRegistered) return;
      subscribersRegistered = true;
      // Cross-module pool bus may not exist in some test builds; guard.
      const poolBus = (fastify as FastifyInstance & {
        poolModule?: { bus: { on: (name: string, h: (p: unknown) => void | Promise<void>) => () => void } };
      }).poolModule?.bus;
      if (!poolBus) {
        log.warn('poolModule.bus not decorated; device.health.failed subscriber not wired');
        return;
      }
      poolBus.on('device.health.failed', async (payload) => {
        try {
          await handleDeviceHealthFailed(payload);
        } catch (err) {
          log.error({ err }, 'handleDeviceHealthFailed threw');
        }
      });
      log.info('device.health.failed subscriber wired');
    },

    leaseDevice: async (input, requesterActor, bearerToken) => {
      // 1. Allocate device via pool (mutex-protected; FIFO across idle devices).
      //    Pool returns null when no device of the requested platform is idle.
      //    Use a fresh UUID as the allocation tag — sessions are independent
      //    of jobs, but the pool tracks `currentJobId` per device. We treat
      //    sessionId-as-jobId so the pool's accounting stays consistent.
      const sessionId = randomUUID();
      const device = await fastify.pool.allocate(input.platform, sessionId);
      if (!device) {
        throw httpError(
          503,
          'no_device_available',
          `no idle ${input.platform} device available for lease`,
        );
      }

      try {
        // 1b. Connect the device-stream android service so dispatch can call
        //     tap/typeText/swipe/pressKey without "Device not connected" errors.
        //     iOS uses appium per-session, so no analog needed.
        if (input.platform === 'android') {
          const serial = device.port == null ? device.emulatorId : `emulator-${device.port}`;
          try {
            await tangoAdbService.connect(serial);
          } catch (connErr) {
            log.warn(
              { connErr, serial, deviceId: device.id },
              'tangoAdbService.connect failed during lease — dispatch actions will throw "Device not connected"',
            );
          }
        }

        // 2. INSERT sessions row inside a transaction. Postgres partial unique
        //    index `sessions_device_active_idx` (WHERE status='active') raises
        //    23505 if a concurrent lease already won this device. We catch +
        //    rethrow as RFC 7807 409 and release the pool device (no leak).
        const now = new Date();
        const leaseUntil = new Date(now.getTime() + input.ttlSeconds * 1000);
        const ownerApiKeyId = extractKeyId(requesterActor);
        const metadata = input.metadata ?? null;

        await db.transaction(async (tx) => {
          await tx.insert(schema.sessions).values({
            id: sessionId,
            deviceId: device.id,
            ownerApiKeyId,
            ownerActor: requesterActor,
            status: 'active',
            ttlSeconds: input.ttlSeconds,
            leaseUntil,
            createdAt: now,
            metadata,
          });
        });

        // 3. Emit session.leased (persisted via persistEnvelope middleware).
        emit.leased(sessionId, {
          sessionId,
          deviceId: device.id,
          deviceName: device.name,
          platform: input.platform,
          ttlSeconds: input.ttlSeconds,
          leaseUntil: leaseUntil.toISOString(),
          ownerActor: requesterActor,
          metadata,
        });

        // 4. Build response — wsUrl is server-authoritative (host derived from config).
        const response: LeaseResponse = {
          sessionId,
          deviceId: device.id,
          deviceName: device.name,
          platform: input.platform,
          wsUrl: buildWsUrl(sessionId, bearerToken),
          leaseUntil: leaseUntil.toISOString(),
          ttlSeconds: input.ttlSeconds,
        };
        log.info(
          { sessionId, deviceId: device.id, platform: input.platform, ttlSeconds: input.ttlSeconds },
          'Session leased',
        );
        return response;
      } catch (err) {
        // Roll back the pool allocation — otherwise the device stays Allocated forever.
        try {
          await fastify.pool.release(device.id);
        } catch (releaseErr) {
          log.error(
            { releaseErr, deviceId: device.id },
            'Failed to release pool device after lease failure',
          );
        }

        const e = err as { code?: string; message?: string };
        if (e.code === '23505' || e.message?.includes('sessions_device_active_idx')) {
          throw httpError(
            409,
            'device_already_leased',
            `device ${device.id} is already leased to an active session`,
          );
        }
        throw err;
      }
    },

    releaseDevice: async (sessionId, requesterActor, isAdmin, reason = 'explicit') => {
      // 1. Load active session row.
      const rows = await db
        .select()
        .from(schema.sessions)
        .where(and(eq(schema.sessions.id, sessionId), eq(schema.sessions.status, 'active')))
        .limit(1);

      if (rows.length === 0) {
        throw httpError(404, 'session_not_found', `no active session found with id ${sessionId}`);
      }
      const session = rows[0];

      // 2. Authorization — owner OR admin claim required.
      const isOwner = session.ownerActor === requesterActor;
      if (!isOwner && !isAdmin) {
        throw httpError(
          403,
          'forbidden',
          `requester ${requesterActor} is not the owner of session ${sessionId}`,
        );
      }

      // 3. Broadcast on any open WS (no-op at 34-01; populated by 34-02).
      const socket = openSockets.get(sessionId);
      if (socket) {
        try {
          socket.send(
            JSON.stringify({ type: 'event', kind: 'session-released', data: { reason } }),
          );
          socket.close(1000, 'session released');
        } catch (err) {
          log.warn({ err, sessionId }, 'Failed to broadcast/close session WS during release');
        }
        openSockets.delete(sessionId);
      }

      // 4. Release the pool device.
      try {
        await fastify.pool.release(session.deviceId);
      } catch (err) {
        // Don't block the DB update if pool release fails — the row reflects
        // the release intent; a Phase 27+ reconciler can resync if needed.
        log.error(
          { err, sessionId, deviceId: session.deviceId },
          'pool.release failed during session release — continuing with DB update',
        );
      }

      // 4b. Disconnect the device-stream android service. Counterpart to
      //     leaseDevice step 1b. Failure is logged but never blocks release.
      const dev = fastify.pool.getDeviceMap().get(session.deviceId);
      if (dev && dev.platform === 'android') {
        const serial = dev.port == null ? dev.emulatorId : `emulator-${dev.port}`;
        try {
          await tangoAdbService.disconnect(serial);
        } catch (err) {
          log.warn({ err, sessionId, serial }, 'tangoAdbService.disconnect failed during release');
        }
      }

      // 5. UPDATE sessions SET status='released', releasedAt=now().
      const releasedAt = new Date();
      await db
        .update(schema.sessions)
        .set({ status: 'released', releasedAt })
        .where(eq(schema.sessions.id, sessionId));

      // 6. Emit session.released (persisted).
      emit.released(sessionId, {
        sessionId,
        deviceId: session.deviceId,
        reason,
        releasedBy: requesterActor,
      });

      log.info({ sessionId, deviceId: session.deviceId, reason }, 'Session released');

      return {
        sessionId,
        released: true as const,
        releasedAt: releasedAt.toISOString(),
      };
    },

    listSessions: async (filter) => {
      // Drizzle LEFT JOIN sessions ⨯ devices → flatten to listResponseSchema shape.
      const baseQuery = db
        .select({
          sessionId: schema.sessions.id,
          deviceId: schema.sessions.deviceId,
          deviceName: schema.devices.name,
          devicePlatform: schema.devices.type,
          status: schema.sessions.status,
          leaseUntil: schema.sessions.leaseUntil,
          createdAt: schema.sessions.createdAt,
          ownerActor: schema.sessions.ownerActor,
          metadata: schema.sessions.metadata,
        })
        .from(schema.sessions)
        .leftJoin(schema.devices, eq(schema.sessions.deviceId, schema.devices.id))
        .orderBy(desc(schema.sessions.createdAt));

      const rows = filter?.status
        ? await baseQuery.where(eq(schema.sessions.status, filter.status))
        : await baseQuery;

      return {
        sessions: rows.map((r) => ({
          sessionId: r.sessionId,
          deviceId: r.deviceId,
          deviceName: r.deviceName ?? '(unknown)',
          // sessions row lacks an explicit platform column — derive from the
          // joined device row. Devices ALWAYS have a platform, but the LEFT
          // JOIN nominally permits null; fallback keeps the type narrow.
          platform: (r.devicePlatform ?? 'android') as 'android' | 'ios',
          status: r.status,
          leaseUntil: r.leaseUntil.toISOString(),
          createdAt: r.createdAt.toISOString(),
          ownerActor: r.ownerActor,
          metadata: r.metadata as Record<string, unknown> | null,
        })),
      };
    },

    dispatch: async (sessionId, action) => {
      // Phase 37 Plan 37-04 — race-safe dispatch (Pitfall 8). Validate that
      // the session is active in the DB; if it has dropped to expired/released
      // between the broadcaster snapshot and now, throw — broadcaster
      // surfaces this as `{ok:false, error}` per-session without rolling back
      // siblings (kittyfarm InputCoordinator.swift:10-11 parity).
      const rows = await db
        .select()
        .from(schema.sessions)
        .where(and(eq(schema.sessions.id, sessionId), eq(schema.sessions.status, 'active')))
        .limit(1);
      if (rows.length === 0) {
        throw new Error(`session ${sessionId} not found or not active`);
      }
      const session = rows[0];
      if (new Date(session.leaseUntil) < new Date()) {
        throw new Error(`session ${sessionId} lease expired`);
      }

      // Forward the action to the active WS socket as a server-initiated
      // event. The web client treats this as an inbound mirror event and
      // re-emits it locally (consistent with how /sessions/[id] currently
      // dispatches taps over WS).
      //
      // Wave 1 limitation: when no WS is open for the session, we can't
      // synthesize a meaningful tap on the device server-side without
      // building a full ActionContext (which requires per-device pool +
      // tangoAdb wiring). For Wave 1 we surface this as an error so the
      // broadcaster's result reports `ok:false` and the operator sees the
      // session is unreachable. Wave 2 may add a server-side dispatch path
      // that doesn't require an active WS.
      const socket = openSockets.get(sessionId);
      if (!socket) {
        throw new Error(`session ${sessionId} has no active WS connection`);
      }
      try {
        socket.send(
          JSON.stringify({
            type: 'event',
            kind: 'mirror-action' as const,
            data: action as unknown as Record<string, unknown>,
          }),
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`session ${sessionId}: WS send failed: ${msg}`);
      }
    },

    shutdown: async () => {
      if (stopped) return;
      stopped = true;
      // Close any open sockets (34-02 onwards will populate; no-op until then).
      for (const [sessionId, socket] of openSockets.entries()) {
        try {
          socket.close(1001, 'server shutdown');
        } catch (err) {
          log.warn({ err, sessionId }, 'Failed to close session socket during shutdown');
        }
      }
      openSockets.clear();
      const tracked = rateLimiter.size();
      log.info({ rateLimiterEntries: tracked }, 'Sessions module shutdown complete');
    },
  };

  return module;
}
