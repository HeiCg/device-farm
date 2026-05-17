/**
 * Phase 36 / Plan 36-02 — Devices WS stream route (DISC-WS).
 *
 * Registers `GET WS /api/devices/stream`:
 *   - On connect: replays current devices from
 *     `fastify.poolModule.discoveryService.getSnapshot()` as synthetic
 *     `device.discovered.added` frames so late subscribers don't miss state.
 *   - Subscribes to `fastify.poolModule.bus` for
 *     `device.discovered.{added,removed,changed}` events and re-broadcasts
 *     as `wsEnvelopeSchema`-shaped frames.
 *   - On socket close: unsubscribes all 3 bus listeners.
 *
 * The subscriber wiring is extracted into `attachDevicesStreamSubscribers`
 * so it can be unit-tested without a Fastify boot.
 */
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import type { DiscoveredDevice } from '../pool/index.js';

interface MinimalBus {
  on(name: string, handler: (raw: unknown) => void): () => void;
}

interface MinimalSocket {
  readyState: number;
  send(data: string): void;
  on(event: string, handler: (...args: unknown[]) => void): void;
}

export interface DevicesStreamSubscribersDeps {
  socket: MinimalSocket;
  bus: MinimalBus;
  snapshot: () => DiscoveredDevice[];
}

const DISCOVERY_EVENTS = [
  'device.discovered.added',
  'device.discovered.removed',
  'device.discovered.changed',
] as const;

type DiscoveryEvent = typeof DISCOVERY_EVENTS[number];

function envelope(type: DiscoveryEvent, device: DiscoveredDevice): string {
  return JSON.stringify({
    v: 1,
    type,
    correlationId: randomUUID(),
    ts: new Date().toISOString(),
    payload: { type, device },
  });
}

/**
 * Wire a single WebSocket subscriber to the discovery event stream.
 *
 * Returns an unsubscribe function that removes every bus listener; safe to
 * call multiple times. The socket is checked for readyState===OPEN (1)
 * before every send so a closed socket cannot throw on send.
 */
export function attachDevicesStreamSubscribers(
  deps: DevicesStreamSubscribersDeps,
): () => void {
  const { socket, bus, snapshot } = deps;
  const OPEN = 1;

  const safeSend = (frame: string): void => {
    if (socket.readyState !== OPEN) return;
    try { socket.send(frame); } catch { /* ignore */ }
  };

  // 1. Replay current snapshot as synthetic added frames.
  if (socket.readyState === OPEN) {
    for (const device of snapshot()) {
      safeSend(envelope('device.discovered.added', device));
    }
  }

  // 2. Subscribe to the 3 discovery events.
  const unsubs: Array<() => void> = [];
  for (const eventName of DISCOVERY_EVENTS) {
    const unsub = bus.on(eventName, (raw: unknown) => {
      const payload = raw as { device?: DiscoveredDevice };
      if (!payload?.device) return;
      safeSend(envelope(eventName, payload.device));
    });
    unsubs.push(unsub);
  }

  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    for (const u of unsubs) {
      try { u(); } catch { /* ignore */ }
    }
  };
}

/**
 * Fastify route registration. Wires the WS route to
 * `attachDevicesStreamSubscribers` using `fastify.poolModule.bus` and
 * `fastify.poolModule.discoveryService.getSnapshot()`.
 */
export async function registerDevicesStreamRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get(
    '/api/devices/stream',
    { websocket: true },
    (socket, _req) => {
      const poolModule = (fastify as FastifyInstance & {
        poolModule?: {
          bus: MinimalBus;
          discoveryService: { getSnapshot: () => DiscoveredDevice[] };
        };
      }).poolModule;
      if (!poolModule) {
        try { (socket as unknown as WebSocket).close(1011, 'pool_module_unavailable'); } catch { /* ignore */ }
        return;
      }

      const unsub = attachDevicesStreamSubscribers({
        socket: socket as unknown as MinimalSocket,
        bus: poolModule.bus,
        snapshot: () => poolModule.discoveryService.getSnapshot(),
      });

      socket.on('close', () => unsub());
      socket.on('error', () => unsub());
    },
  );

  fastify.log.info('Devices stream WS route registered (GET /api/devices/stream)');
}
