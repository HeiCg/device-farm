/**
 * Phase 36 / Plan 36-02 — Pairing API routes (PAIR-WIRELESS).
 *
 *   - POST /api/devices/pair/start   → start a 60s pairing session, returns
 *     `{ sessionId, qrDataUrl, pin, instance, ttlSeconds }`.
 *   - POST /api/devices/pair/cancel  → body `{ sessionId }`, returns 204.
 *   - WS   /api/devices/pair/stream  → query `?sessionId=<id>`, pushes
 *     state-transition envelopes (awaiting-scan → pairing → connecting →
 *     done | expired | error).
 */
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import type { PairingService, PairingSession } from '../pool/index.js';

interface PoolModuleShape {
  pairingService: PairingService;
}

function envelopeFor(session: PairingSession): string {
  return JSON.stringify({
    v: 1,
    type: `pair.${session.state}`,
    correlationId: randomUUID(),
    ts: new Date().toISOString(),
    payload: {
      type: session.state,
      sessionId: session.id,
      instance: session.instance,
      pin: session.pin,
      expiresAt: session.expiresAt,
    },
  });
}

export async function registerPairingRoutes(fastify: FastifyInstance): Promise<void> {
  const getPool = (): PoolModuleShape | null => {
    return (fastify as FastifyInstance & { poolModule?: PoolModuleShape }).poolModule ?? null;
  };

  // POST /api/devices/pair/start
  fastify.post('/api/devices/pair/start', async (_request, reply) => {
    const pool = getPool();
    if (!pool) {
      return reply.code(503).send({ error: 'pool_module_unavailable' });
    }
    const session = await pool.pairingService.start();
    return reply.code(200).send({
      sessionId: session.id,
      qrDataUrl: session.qrDataUrl,
      pin: session.pin,
      instance: session.instance,
      ttlSeconds: 60,
    });
  });

  // POST /api/devices/pair/cancel
  fastify.post<{ Body: { sessionId: string } }>(
    '/api/devices/pair/cancel',
    async (request, reply) => {
      const pool = getPool();
      if (!pool) {
        return reply.code(503).send({ error: 'pool_module_unavailable' });
      }
      const { sessionId } = (request.body ?? {}) as { sessionId?: string };
      if (!sessionId) {
        return reply.code(400).send({ error: 'sessionId required' });
      }
      pool.pairingService.cancel(sessionId);
      return reply.code(204).send();
    },
  );

  // WS /api/devices/pair/stream?sessionId=<id>
  fastify.get<{ Querystring: { sessionId?: string } }>(
    '/api/devices/pair/stream',
    { websocket: true },
    (socket, request) => {
      const pool = getPool();
      if (!pool) {
        try { (socket as unknown as WebSocket).close(1011, 'pool_module_unavailable'); } catch { /* ignore */ }
        return;
      }
      const sessionId = (request.query as { sessionId?: string }).sessionId;
      if (!sessionId) {
        try { (socket as unknown as WebSocket).close(1008, 'sessionId required'); } catch { /* ignore */ }
        return;
      }
      const session = pool.pairingService.get(sessionId);
      if (!session) {
        try { (socket as unknown as WebSocket).close(1008, 'unknown session'); } catch { /* ignore */ }
        return;
      }

      const send = (s: PairingSession): void => {
        if ((socket as unknown as WebSocket).readyState !== 1) return;
        try { socket.send(envelopeFor(s)); } catch { /* ignore */ }
      };

      // Initial state frame.
      send(session);

      const unsub = session.on('state-change', (s) => send(s));

      socket.on('close', () => unsub());
      socket.on('error', () => unsub());
    },
  );

  fastify.log.info('Pairing routes registered (POST pair/start, POST pair/cancel, WS pair/stream)');
}
