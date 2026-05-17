/**
 * Phase 23 Plan 23-05 — Jobs admin routes (drain procedure).
 *
 * RESOLVES PITFALL 1: pg-boss v12 has NO `paused` flag on updateQueue.
 * Drain mechanism: boss.offWork(name, {wait:false}) stops THIS server's
 * worker(s) for the named queue; in-flight workers complete; admission
 * check on enqueueJob blocks new work. system_state row persists across
 * server restarts so drain state survives restart (plugin onReady reads
 * it via honorDrainOnBoot and re-calls offWork).
 *
 * Auth: [requireAuth, requireAdmin] chain — any-valid-key gate followed by
 * admin-claim assertion (DEFERRED-23-A resolved by Phase 26 Plan 26-03).
 * requireAdmin imported via server/auth barrel (MOD-02 compliant).
 *
 * RESEARCH §Code Examples §3 + §Pattern 6.
 */
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type {
  FastifyZodOpenApiTypeProvider,
  FastifyZodOpenApiSchema,
} from 'fastify-zod-openapi';
import type pino from 'pino';
import * as schema from '../../db/schema.js';
import { QUEUE_NAMES } from '../../queue/names.js';
import { JOB_EXECUTE_QUEUE_NAME } from '../queue.js';
import type { JobsModule } from './module.js';
import { requireAdmin } from '../../auth/index.js';

// ---------- Schemas ----------

const drainQuerySchema = z.object({
  timeout: z.coerce.number().int().min(1).max(1800).default(300),
});

const drainResponseDrainedSchema = z.object({
  drained: z.literal(true),
  in_flight: z.literal(0),
  drained_at: z.string().datetime(),
});

const drainResponseTimeoutSchema = z.object({
  drained: z.literal(false),
  in_flight: z.number().int().nonnegative(),
  timeout: z.literal(true),
});

const drainResponseSchema = z
  .discriminatedUnion('drained', [
    drainResponseDrainedSchema,
    drainResponseTimeoutSchema,
  ])
  .meta({ id: 'DrainResponse' });

const resumeResponseSchema = z
  .object({ resumed: z.literal(true) })
  .meta({ id: 'DrainResumeResponse' });

// ---------- Public API ----------

export interface RegisterJobsAdminRoutesDeps {
  fastify: FastifyInstance;
  jobsModule: JobsModule;
  logger: pino.Logger;
}

/**
 * Registers POST /admin/drain + POST /admin/drain/resume routes.
 *
 * Both routes chain [requireAuth, requireAdmin] preHandlers — Phase 26 Plan
 * 26-03 resolved DEFERRED-23-A. requireAuth proves the bearer is a valid API
 * key (any key); requireAdmin asserts request.apiKey.claims.admin === true.
 */
export async function registerJobsAdminRoutes(
  deps: RegisterJobsAdminRoutesDeps,
): Promise<void> {
  const { fastify, jobsModule, logger } = deps;
  const log = logger.child({ module: 'jobs.routes' });

  /**
   * Auth gate — extracts Bearer token from Authorization header (or
   * X-API-Key header) and validates via authService.validateKey. Chained
   * BEFORE requireAdmin on both drain endpoints (Phase 26 Plan 26-03).
   */
  const requireAuth = async (
    req: { headers: Record<string, string | undefined> },
    reply: { code: (n: number) => { send: (b: unknown) => void } },
  ): Promise<void> => {
    const authHeader = req.headers.authorization ?? req.headers['x-api-key'];
    const key = authHeader?.startsWith('Bearer ')
      ? authHeader.slice(7)
      : authHeader;
    if (!key) {
      reply.code(401).send({ error: 'unauthorized' });
      return;
    }
    const ok = await fastify.authService?.validateKey(key);
    if (!ok) {
      reply.code(401).send({ error: 'unauthorized' });
      return;
    }
  };

  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().route({
    method: 'POST',
    url: '/admin/drain',
    preHandler: [requireAuth as never, requireAdmin as never],
    schema: {
      querystring: drainQuerySchema,
      response: { 200: drainResponseSchema },
    } satisfies FastifyZodOpenApiSchema,
    handler: async (req, reply) => {
      const start = Date.now();
      const query = req.query as z.infer<typeof drainQuerySchema>;
      const timeoutMs = query.timeout * 1000;

      // 1. Persist drain intent (idempotent upsert) — restart-safe.
      // Plugin onReady (honorDrainOnBoot) reads this row at boot and re-calls
      // offWork so a process restart doesn't accidentally resume processing.
      const nowIso = new Date().toISOString();
      await fastify.db
        .insert(schema.systemState)
        .values({
          key: 'drain_requested_at',
          value: { iso: nowIso },
        })
        .onConflictDoUpdate({
          target: schema.systemState.key,
          set: { value: { iso: nowIso }, updatedAt: new Date() },
        });

      // 2. Stop fetchers — workers complete current handler, refuse new work.
      // wait:false so we own the long-poll below; offWork by name removes ALL
      // workers for that queue from this PgBoss instance (pg-boss/manager.js:354).
      // Single-node deployment means no other server can pick up the queued
      // jobs either (CONTEXT §Drain Procedure).
      await fastify.boss
        .offWork(JOB_EXECUTE_QUEUE_NAME, { wait: false })
        .catch((err) => {
          log.warn({ err }, 'offWork(JOB_EXECUTE) errored — likely already stopped');
        });
      await fastify.boss
        .offWork(QUEUE_NAMES.RECORDING_UPLOAD, { wait: false })
        .catch((err) => {
          log.warn({ err }, 'offWork(RECORDING_UPLOAD) errored — likely already stopped');
        });

      // 3. Long-poll until in-flight = 0 OR timeout. Sleep 1s between checks.
      while (Date.now() - start < timeoutMs) {
        const inFlight = jobsModule.getInFlightCount();
        if (inFlight === 0) {
          const drainedAt = new Date().toISOString();
          const durationMs = Date.now() - start;
          // aggregateId must be a UUID (events table contract). system.drain.*
          // events are singletons-per-occurrence — fresh UUID per drain.
          jobsModule.emit.drainCompleted(randomUUID(), {
            drainedAt,
            durationMs,
          });
          log.info({ drainedAt, durationMs }, 'Drain completed (in-flight=0)');
          return reply.send({
            drained: true as const,
            in_flight: 0 as const,
            drained_at: drainedAt,
          });
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      // 4. Timeout — return current count. Operator may force-restart server
      // (drain row persists; plugin honors it on boot).
      const finalInFlight = jobsModule.getInFlightCount();
      log.warn({ finalInFlight, timeoutMs }, 'Drain timed out — in-flight still non-zero');
      return reply.send({
        drained: false as const,
        in_flight: finalInFlight,
        timeout: true as const,
      });
    },
  });

  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().route({
    method: 'POST',
    url: '/admin/drain/resume',
    preHandler: [requireAuth as never, requireAdmin as never],
    schema: { response: { 200: resumeResponseSchema } } satisfies FastifyZodOpenApiSchema,
    handler: async (_req, reply) => {
      // 1. Clear DB flag (idempotent — DELETE WHERE no-op if already absent).
      await fastify.db
        .delete(schema.systemState)
        .where(eq(schema.systemState.key, 'drain_requested_at'));

      // 2. Re-register workers — offWork removed them; this brings them back.
      // Use registerWorkerOnly (NOT registerWorkerAndSubscribers): the latter
      // calls Fastify addHook('onReady') which throws FST_ERR_INSTANCE_ALREADY_LISTENING
      // after fastify.ready(). The bus subscribers + admin routes were already
      // wired during plugin boot — only the pg-boss worker needs re-registration.
      await jobsModule.registerWorkerOnly();
      const am = (fastify as { artifactsModule?: { registerWorkersAndSubscribers?: () => Promise<void> } })
        .artifactsModule;
      if (am?.registerWorkersAndSubscribers) {
        await am.registerWorkersAndSubscribers().catch((err) => {
          log.warn({ err }, 'artifactsModule re-register failed during resume — likely already listening; safe to ignore if subscribers were already wired');
        });
      }

      // 3. Emit + ack.
      const resumedAt = new Date().toISOString();
      // aggregateId must be a UUID — fresh UUID per resume occurrence.
      jobsModule.emit.drainResumed(randomUUID(), { resumedAt });
      log.info({ resumedAt }, 'Drain resumed (workers re-registered)');

      return reply.send({ resumed: true as const });
    },
  });
}

/**
 * Restart safety helper — called by createJobsModule.registerWorkerAndSubscribers
 * during plugin boot (via fastify.addHook('onReady', ...)). If the
 * system_state.drain_requested_at row exists, immediately offWork the worker
 * so a process restart while drained does NOT accidentally resume processing.
 *
 * Idempotent: reads the single row + calls offWork (which is a no-op when no
 * worker is currently registered — pg-boss/manager.js:359).
 */
export async function honorDrainOnBoot(
  fastify: FastifyInstance,
  log: pino.Logger,
): Promise<void> {
  const rows = await fastify.db
    .select()
    .from(schema.systemState)
    .where(eq(schema.systemState.key, 'drain_requested_at'))
    .limit(1);
  if (rows.length > 0) {
    log.warn(
      { drain_row: rows[0] },
      'Boot detected drain_requested_at — calling offWork immediately to stay drained',
    );
    await fastify.boss
      .offWork(JOB_EXECUTE_QUEUE_NAME, { wait: false })
      .catch(() => undefined);
    await fastify.boss
      .offWork(QUEUE_NAMES.RECORDING_UPLOAD, { wait: false })
      .catch(() => undefined);
  }
}
