/**
 * Session TTL sweeper — Phase 34 Plan 34-04.
 *
 * Periodically scans `sessions WHERE status='active' AND leaseUntil < now()`
 * and auto-releases each expired row:
 *   1. Broadcast `{type:'event', kind:'lease-expiring', data:{sessionId}}` to
 *      any open WS, then close it (1000).
 *   2. Release the pool device via `fastify.pool.release(deviceId)`.
 *   3. UPDATE sessions SET status='expired', releasedAt=now().
 *   4. Emit `session.expired` (persisted via the module's emit helper).
 *   5. Clear the rate-limiter entry for the sessionId (Map leak prevention,
 *      RESEARCH §Open Q #6).
 *
 * Order matters: broadcast → pool release → DB update → emit. Subscribers
 * see a consistent state (device is free + DB shows expired by the time the
 * `session.expired` event lands).
 *
 * Schedule strategy (Open Question #1 resolution):
 *   - PREFER `boss.schedule(SESSION_SWEEP, '<every-30s-cron>', ...)` — pg-boss
 *     v12 nominally accepts the 6-field cron (with seconds).
 *   - FALLBACK on rejection: `boss.schedule(SESSION_SWEEP, '* * * * *', ...)`
 *     (1 min) + `setInterval(sweepExpiredSessions, 30_000)` inside the plugin.
 *     The interval is cleared on plugin shutdown.
 *
 * The chosen strategy is recorded on the `SweeperHandle` so the plugin can
 * log it once at startup + the SUMMARY can document which path the runtime
 * picked.
 */
import { and, eq, lt, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type pino from 'pino';

import * as schema from '../../db/schema.js';
import { QUEUE_NAMES } from '../../queue/names.js';
import type { SessionsModule } from './module.js';

// pg-boss 6-field cron with seconds (every 30 seconds). Defined as a code
// constant rather than inline so the literal stays out of JSDoc bodies above
// (the inner slash inside a JSDoc literal trips some transformer setups).
const EVERY_30S_CRON = '*/30 * * * * *';
const ONE_MINUTE_CRON = '* * * * *';

export interface SessionSweeperDeps {
  fastify: FastifyInstance;
  sessionsModule: SessionsModule;
  logger: pino.Logger;
}

export interface SweeperHandle {
  /** Set when the fallback strategy is active; null on the 6-field cron path. */
  intervalHandle: NodeJS.Timeout | null;
  /** Which path the runtime picked at startup (for logging / SUMMARY). */
  strategy: 'cron-30s' | 'cron-1m-plus-interval';
}

/**
 * Core worker — find expired active sessions and process each through the
 * broadcast → release → expire pipeline. Returns the number of rows handled.
 *
 * Exported for direct invocation from the plugin's setInterval fallback
 * (when 6-field cron is rejected) and from tests (no Fastify scheduling
 * needed for the per-row behaviour assertions).
 */
export async function sweepExpiredSessions(deps: SessionSweeperDeps): Promise<number> {
  const { fastify, sessionsModule, logger } = deps;

  const expired = await fastify.db
    .select()
    .from(schema.sessions)
    .where(and(eq(schema.sessions.status, 'active'), lt(schema.sessions.leaseUntil, sql`now()`)));

  if (expired.length === 0) return 0;

  for (const session of expired) {
    const socket = sessionsModule.openSockets.get(session.id);
    if (socket) {
      try {
        socket.send(JSON.stringify({
          type: 'event',
          kind: 'lease-expiring',
          data: { sessionId: session.id },
        }));
        socket.close(1000, 'lease-expired');
      } catch (err) {
        logger.warn({ err, sessionId: session.id }, 'sweep: failed to broadcast lease-expiring');
      }
      sessionsModule.openSockets.delete(session.id);
    }

    try {
      await fastify.pool.release(session.deviceId);
    } catch (err) {
      // Critical-but-non-blocking: log so an unrelease leak is visible. The
      // DB update still runs — a Phase 27+ reconciler can resync if needed.
      logger.error(
        { err, sessionId: session.id, deviceId: session.deviceId },
        'sweep: pool.release failed',
      );
    }

    const releasedAt = new Date();
    await fastify.db
      .update(schema.sessions)
      .set({ status: 'expired', releasedAt })
      .where(eq(schema.sessions.id, session.id));

    try {
      await sessionsModule.emit.expired(session.id, {
        sessionId: session.id,
        deviceId: session.deviceId,
        leaseUntil: session.leaseUntil.toISOString(),
      });
    } catch (err) {
      logger.error({ err, sessionId: session.id }, 'sweep: emit.expired failed');
    }

    // RESEARCH §Open Q #6 mitigation — release the per-session rate-limiter
    // Map entry so long-lived servers don't accumulate dead sessionId keys.
    sessionsModule.rateLimiter.clear(session.id);
  }

  return expired.length;
}

/**
 * Register the pg-boss schedule + worker for SESSION_SWEEP.
 *
 * Strategy resolution (Open Question #1 — 30s granularity on pg-boss):
 *   1. Try `boss.schedule(SESSION_SWEEP, '<every-30s-cron>', ...)` — the
 *      6-field cron expression with seconds.
 *   2. On rejection, fall back to:
 *      - `boss.schedule(SESSION_SWEEP, '* * * * *', ...)` (1-minute), AND
 *      - `setInterval(() => sweepExpiredSessions(deps), 30_000)` inside the
 *        plugin so the effective tick rate stays at 30s.
 *
 * Always registers `boss.work(SESSION_SWEEP, ...)` so dispatched cron jobs
 * actually invoke the worker.
 */
export async function registerSessionSweeper(
  deps: SessionSweeperDeps,
): Promise<SweeperHandle> {
  const { fastify, logger } = deps;
  const handle: SweeperHandle = { intervalHandle: null, strategy: 'cron-30s' };

  // Pg-boss v12 requires createQueue BEFORE schedule (Phase 18 RESEARCH).
  // boss.createQueue may already exist on previous boots — it is idempotent.
  try {
    await fastify.boss.createQueue(QUEUE_NAMES.SESSION_SWEEP, {
      retryLimit: 1, retryBackoff: true, retryDelay: 30,
    } as never);
  } catch (err) {
    // Some pg-boss versions throw "Queue already exists" — non-fatal.
    logger.debug({ err: String(err) }, 'session sweeper: createQueue noop (already exists?)');
  }

  try {
    await fastify.boss.schedule(QUEUE_NAMES.SESSION_SWEEP, EVERY_30S_CRON, {}, { tz: 'UTC' });
    handle.strategy = 'cron-30s';
    logger.info({ schedule: 'cron-30s' }, 'session sweeper: pg-boss 6-field cron accepted');
  } catch (err) {
    logger.warn(
      { err: String(err) },
      'session sweeper: 6-field cron rejected, falling back to cron-1m + 30s interval',
    );
    await fastify.boss.schedule(QUEUE_NAMES.SESSION_SWEEP, ONE_MINUTE_CRON, {}, { tz: 'UTC' });
    handle.intervalHandle = setInterval(() => {
      sweepExpiredSessions(deps).catch((tickErr) =>
        logger.error({ err: tickErr }, 'sweep interval tick failed'),
      );
    }, 30_000);
    // Don't keep the event loop alive solely for the interval (graceful exit).
    if (typeof handle.intervalHandle.unref === 'function') handle.intervalHandle.unref();
    handle.strategy = 'cron-1m-plus-interval';
  }

  await fastify.boss.work(QUEUE_NAMES.SESSION_SWEEP, async () => {
    try {
      await sweepExpiredSessions(deps);
    } catch (err) {
      logger.error({ err }, 'sweep worker tick failed');
    }
  });

  return handle;
}
