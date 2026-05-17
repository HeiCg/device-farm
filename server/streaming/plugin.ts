/**
 * Phase 22 / Plan 22-02 — Streaming module Fastify plugin (thin wirer, MOD-02/MOD-06).
 *
 * Replaces the Phase 3 `websocket-plugin.ts` monolith. Plugin NAME remains
 * `'websocket-plugin'` for back-compat:
 *   - server/jobs/plugin.ts declares dependency on 'websocket-plugin'
 *   - server/pipelines/plugin.ts declares dependency on 'websocket-plugin'
 *   - server/__tests__/plugin-order.spec.ts has 3+ positional assertions naming 'websocket-plugin'
 *
 * Renaming would be scope creep (5+ cross-module file changes). Phase 23+ can
 * unify names if desired.
 *
 * Dependencies array extended from Phase 17 shape `['config', 'auth', 'pool-plugin']`
 * to the Phase 22 5-entry shape `['config', 'auth', 'pool-plugin', 'event-bus', 'db']`:
 *   - event-bus: createStreamingModule reads fastify.jobsModule.bus in onReady hook
 *   - db: persistEnvelope middleware writes to events table (short-circuits for
 *     persisted:false events but dep declared for future-proof per RESEARCH §Plugin Dependencies)
 *
 * Plugin body is a thin wirer: calls createStreamingModule, decorates 3 surfaces,
 * registers @fastify/websocket + 2 WS routes, defers subscriber registration to
 * onReady (Pitfall 2 — fastify.jobsModule not decorated until step 13), wires
 * shutdown into onClose.
 */
import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import type pino from 'pino';
import websocket from '@fastify/websocket';
import { WebSocket } from 'ws';
import { tangoAdbService } from '@device-stream/android';

import { createStreamingModule, type StreamingModule } from './internal/module.js';
import type { JobBroadcaster } from './internal/job-broadcaster.js';
import type { DevicePreviewManager } from './internal/device-preview.js';
import { FlushQueue, type SocketLike } from './internal/flush-queue.js';

declare module 'fastify' {
  interface FastifyInstance {
    jobBroadcaster: JobBroadcaster;
    devicePreview: DevicePreviewManager;
    streamingModule: StreamingModule;
  }
}

const HEARTBEAT_INTERVAL_MS = 30_000;

export default fp(
  async (fastify: FastifyInstance) => {
    // Step 1 — Register @fastify/websocket plugin (adds socket upgrade handling).
    await fastify.register(websocket);

    // Step 2 — Construct module via factory (MOD-06).
    const module = createStreamingModule({
      fastify,
      db: fastify.db,
      config: fastify.config,
      logger: fastify.log as unknown as pino.Logger,
    });

    // Step 3 — Decorate Fastify with 3 surfaces (jobBroadcaster + devicePreview are
    // back-compat; streamingModule is the new MOD-06 surface).
    fastify.decorate('jobBroadcaster', module.jobBroadcaster);
    fastify.decorate('devicePreview', module.devicePreview);
    fastify.decorate('streamingModule', module);

    // Step 4 — Track heartbeat intervals for onClose cleanup.
    const heartbeatIntervals = new Set<ReturnType<typeof setInterval>>();

    // Step 5 — WebSocket route for job event streaming.
    // Subscribes to module.jobBroadcaster; envelopes flow through a per-socket
    // FlushQueue that batches outbound frames on a 150ms timer + buffer-cap
    // (Phase 31 SC2). Clients can opt out via `?nobatch=1` query string for
    // backwards-compat with the pre-31 flat envelope stream.
    fastify.get<{ Params: { id: string }; Querystring: { nobatch?: string; token?: string } }>(
      '/ws/jobs/:id',
      { websocket: true },
      (socket, req) => {
        (async () => {
          // Auth check — reject unauthenticated connections when auth enabled.
          if (fastify.config.auth.enabled && fastify.hasDecorator('authService')) {
            const token = (req.query as Record<string, string>).token;
            if (!token || !(await fastify.authService.validateKey(token))) {
              socket.close(1008, 'Policy violation');
              return;
            }
          }

          const jobId = req.params.id;
          const batchMode = !(req.query as { nobatch?: string }).nobatch;
          const queue = new FlushQueue(socket as unknown as SocketLike, batchMode);

          // Ping/pong heartbeat — detect stale connections.
          let isAlive = true;
          socket.on('pong', () => {
            isAlive = true;
          });

          const heartbeat = setInterval(() => {
            if (!isAlive) {
              socket.terminate();
              return;
            }
            isAlive = false;
            socket.ping();
          }, HEARTBEAT_INTERVAL_MS);

          heartbeatIntervals.add(heartbeat);

          // Subscribe to broadcaster — replays enveloped history then streams live.
          // After Phase 22 broadcaster emits WsEnvelope (not JobMessage); envelope
          // carries correlationId + v + ts + payload already. Phase 31 routes the
          // envelope through FlushQueue.push() which either coalesces it into a
          // batch (batchMode=true) or sends it raw (batchMode=false).
          const unsub = module.jobBroadcaster.subscribe(jobId, (envelope) => {
            if (socket.readyState === WebSocket.OPEN) {
              queue.push(envelope);
            }
          });

          socket.on('close', () => {
            unsub();
            queue.close();
            clearInterval(heartbeat);
            heartbeatIntervals.delete(heartbeat);
          });

          socket.on('error', () => {
            unsub();
            queue.close();
            clearInterval(heartbeat);
            heartbeatIntervals.delete(heartbeat);
          });
        })().catch(() => socket.close(1011, 'Internal error'));
      },
    );

    // Step 6 — WebSocket route for device preview streaming.
    // Device preview frames stay as binary base64 (out of scope per CONTEXT §Deferred Ideas).
    fastify.get<{ Params: { id: string } }>(
      '/ws/devices/:id/preview',
      { websocket: true },
      (socket, req) => {
        (async () => {
          if (fastify.config.auth.enabled && fastify.hasDecorator('authService')) {
            const token = (req.query as Record<string, string>).token;
            if (!token || !(await fastify.authService.validateKey(token))) {
              socket.close(1008, 'Policy violation');
              return;
            }
          }

          const deviceId = req.params.id;

          // scrcpy-based preview: ScrcpyService.startStream pipes H.264 packets
          // (and an initial metadata frame) directly to this WebSocket. The
          // frontend decodes via WebCodecs VideoDecoder → canvas.
          const device = fastify.pool.getDeviceMap().get(deviceId);
          if (!device || device.platform !== 'android') {
            socket.close(1003, 'Device not previewable');
            return;
          }
          const serial = device.port === null
            ? device.emulatorId
            : `emulator-${device.port}`;

          let streamStarted = false;
          try {
            await tangoAdbService.connect(serial);
            const adb = await tangoAdbService.getDevice(serial);
            await fastify.scrcpyService.startStream(adb, serial, socket);
            streamStarted = true;
          } catch (err: any) {
            fastify.log.error({ deviceId, serial, err: err.message }, 'scrcpy startStream failed');
            if (socket.readyState === WebSocket.OPEN) {
              socket.send(JSON.stringify({ type: 'error', message: err.message }));
              socket.close(1011, 'scrcpy_failed');
            }
            return;
          }

          const unsub = (): void => {
            if (streamStarted) {
              void fastify.scrcpyService.stopStream(serial).catch((err: any) =>
                fastify.log.warn({ serial, err: err?.message }, 'scrcpy stopStream errored'),
              );
            }
          };

          let isAlive = true;
          socket.on('pong', () => {
            isAlive = true;
          });

          const heartbeat = setInterval(() => {
            if (!isAlive) {
              socket.terminate();
              return;
            }
            isAlive = false;
            socket.ping();
          }, HEARTBEAT_INTERVAL_MS);

          heartbeatIntervals.add(heartbeat);

          socket.on('close', () => {
            unsub();
            clearInterval(heartbeat);
            heartbeatIntervals.delete(heartbeat);
          });

          socket.on('error', () => {
            unsub();
            clearInterval(heartbeat);
            heartbeatIntervals.delete(heartbeat);
          });
        })().catch(() => socket.close(1011, 'Internal error'));
      },
    );

    // Step 7 — Defer subscriber registration to onReady (Pitfall 2).
    fastify.addHook('onReady', async () => {
      await module.registerSubscribers();
    });

    // Step 8 — Cleanup on server close.
    fastify.addHook('onClose', async () => {
      for (const interval of heartbeatIntervals) {
        clearInterval(interval);
      }
      heartbeatIntervals.clear();
      await module.shutdown();
    });

    fastify.log.info('Streaming plugin (websocket-plugin) registered with 5-entry deps');
  },
  // Plugin NAME stays 'websocket-plugin' per RESEARCH §Plugin Name Question.
  // Dependencies extended Phase 22 to 5 entries (adds event-bus + db) matching
  // Phase 21 artifacts shape.
  { name: 'websocket-plugin', dependencies: ['config', 'auth', 'pool-plugin', 'event-bus', 'db'] },
);
