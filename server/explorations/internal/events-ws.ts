/**
 * Explorations WS route — GET /api/explorations/:id/events (Phase 35 Plan 35-03).
 *
 * Streams live BFS progress to subscribers. Each connection:
 *   1. Auth gate (?token=<bearer>) — when fastify.config.auth.enabled.
 *      Mirrors the Phase 22 streaming WS auth pattern (server/streaming/
 *      plugin.ts:79). WebSocket upgrade cannot carry an Authorization
 *      header through browsers, so the bearer rides on the query string.
 *      Closed with 1008 (policy violation) on failure.
 *   2. Run-existence check — SELECT FROM explorations WHERE id=:id.
 *      Closed with 1003 (unsupported data) on miss; tests treat 4404 as
 *      semantic "not found" but we use a standards-conformant close code.
 *   3. Subscribe via broadcaster — replays last <=200 frames immediately
 *      (history), then streams live until disconnect.
 *   4. On socket close → unsubscribe (lets the broadcaster GC the run
 *      state once terminal + last subscriber gone).
 */
import type { FastifyInstance } from 'fastify';
import type pino from 'pino';
import { eq } from 'drizzle-orm';
import type { WebSocket } from 'ws';

import { explorations as explorationsTable } from '../../db/schema.js';

export interface RegisterExplorationEventsWsDeps {
  fastify: FastifyInstance;
  logger?: pino.Logger;
}

export async function registerExplorationEventsWs(
  deps: RegisterExplorationEventsWsDeps,
): Promise<void> {
  const { fastify } = deps;
  const log = (deps.logger ?? (fastify.log as unknown as pino.Logger)).child({
    module: 'explorations.events-ws',
  });

  fastify.get<{ Params: { id: string }; Querystring: { token?: string } }>(
    '/api/explorations/:id/events',
    { websocket: true },
    (socket, req) => {
      (async () => {
        const runId = req.params.id;
        const token = (req.query as { token?: string }).token;

        // 1. Auth gate.
        if (fastify.config.auth.enabled && fastify.hasDecorator('authService')) {
          const authService = (fastify as FastifyInstance & {
            authService?: { validateKey: (k: string) => Promise<boolean> };
          }).authService;
          if (!token || !(await authService?.validateKey(token))) {
            log.warn({ runId }, 'unauthorized exploration events ws connection rejected');
            socket.close(1008, 'unauthorized');
            return;
          }
        }

        // 2. Verify run exists.
        const rows = await fastify.db
          .select({ id: explorationsTable.id })
          .from(explorationsTable)
          .where(eq(explorationsTable.id, runId))
          .limit(1);
        if (rows.length === 0) {
          log.info({ runId }, 'exploration events ws connection: run not found');
          socket.close(1003, 'not_found');
          return;
        }

        // 3. Subscribe (replays history immediately).
        const broadcaster = fastify.explorationsModule.broadcaster;
        broadcaster.subscribe(runId, socket as unknown as WebSocket);

        // 4. Unsubscribe on close/error.
        const onClose = (): void => {
          broadcaster.unsubscribe(runId, socket as unknown as WebSocket);
        };
        socket.on('close', onClose);
        socket.on('error', (err: unknown) => {
          log.warn({ err, runId }, 'exploration events ws socket error');
          onClose();
        });
      })().catch((err: unknown) => {
        log.error({ err }, 'exploration events ws connection setup failed');
        try {
          socket.close(1011, 'internal_error');
        } catch {
          /* swallow */
        }
      });
    },
  );

  log.info('Explorations events WS route registered (GET /api/explorations/:id/events)');
}
