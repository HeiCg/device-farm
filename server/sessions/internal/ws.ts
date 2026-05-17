/**
 * Sessions WebSocket handler — Phase 34 Plan 34-02.
 *
 * Registers `GET /ws/sessions/:id?token=<bearer>` and dispatches each parsed
 * envelope into `actions.dispatch`. Pattern mirrors
 * `server/streaming/plugin.ts` (heartbeat lifecycle copied verbatim).
 *
 * Flow per connection:
 *   1. Read `?token=` query param; reject 1008 if absent or invalid.
 *   2. Load sessions row; assert `status='active' AND leaseUntil > now()
 *      AND ownerApiKeyId === apiKey.id`. Close 1008 on mismatch.
 *   3. Decorate socket with `{sessionId, deviceId, platform, actor, ...}`.
 *   4. Store socket in `sessionsModule.openSockets.set(sessionId, socket)`.
 *   5. Emit `{type:'event', kind:'connected', data:{heartbeatIntervalMs}}`.
 *   6. Heartbeat: 30s interval ping; pong-from-client marks alive; no pong
 *      within an interval → `socket.terminate()`.
 *   7. Per-message: JSON.parse → clientEnvelope.safeParse → dispatch →
 *      ack/error. Malformed JSON drops frame (no close); invalid envelope
 *      sends `{type:'error', code:'invalid_envelope'}` then closes 1003.
 *   8. ALS wrap so emit envelopes downstream carry the right actor.
 *   9. On close: clear heartbeat + delete from openSockets (do NOT mark
 *      session expired — that's explicit DELETE or sweeper's job).
 *
 * Rate-limit hook (`rateLimitOk`) is a stub returning `true` always until
 * Plan 34-04 wires the real sliding window.
 */
import { randomUUID } from 'node:crypto';
import { execFile as nodeExecFile } from 'node:child_process';
import { promisify } from 'node:util';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { readFile } from 'node:fs/promises';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type pino from 'pino';
import { tangoAdbService } from '@device-stream/android';

import * as schema from '../../db/schema.js';
import type { Database } from '../../db/index.js';
import type { AuthService } from '../../auth/index.js';
import { asyncLocalStorage } from '../../correlation/index.js';

import { clientEnvelope, type ServerEnvelope } from './protocol.js';
import { dispatch, ResolverError, type ActionContext } from './actions.js';
import type { SessionsModule } from './module.js';

const HEARTBEAT_INTERVAL_MS = 30_000;
const execFileAsync = promisify(nodeExecFile) as unknown as (
  cmd: string, args: string[],
) => Promise<{ stdout: string; stderr: string }>;

// ---------- Rate-limit (Plan 34-04 wired via sessionsModule.rateLimiter) ----------
//
// The Plan 34-02 stub `rateLimitOk` was replaced in Plan 34-04 — ws.ts now
// reads the sliding-window limiter off the SessionsModule instance so the
// instance is shared with the sweeper (which calls `clear(sessionId)` on
// expiry to prevent the per-session Map from leaking).

// ---------- Resolver injection point (Plan 34-03 swaps the body) ----------

/**
 * Stub resolver that throws `ResolverError` if invoked. The plugin
 * decorates `fastify.sessionsResolver` with this stub at Plan 34-02; Plan
 * 34-03 will overwrite the decorator value with a real MaestroAiResolver.
 * Tests inject their own resolver directly via the ActionContext bundle.
 */
export const STUB_RESOLVER = {
  async resolve(): Promise<never> {
    throw new ResolverError('NL resolver not yet wired — lands in Plan 34-03');
  },
};

// ---------- Minimal socket surface (matches @fastify/websocket SocketStream) ----------

interface MinimalSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  ping(): void;
  terminate(): void;
  on(event: 'message', cb: (raw: Buffer | string) => void): void;
  on(event: 'pong', cb: () => void): void;
  on(event: 'close', cb: () => void): void;
  on(event: 'error', cb: (err: unknown) => void): void;
}

interface DecoratedSocket extends MinimalSocket {
  __sessionContext?: {
    sessionId: string; deviceId: string; platform: 'android' | 'ios'; actor: string;
  };
}

// ---------- buildActionContext: gather deps from fastify decorators ----------

/**
 * Build the ActionContext for a connection. Reads the device row to populate
 * platform-specific `serial` / `udid` fields the dispatch primitives expect.
 *
 * The resolver is read from `fastify.sessionsResolver` so Plan 34-03 can
 * swap the implementation by re-decorating without touching this file.
 */
async function buildActionContext(
  fastify: FastifyInstance,
  sessionCtx: { sessionId: string; deviceId: string; platform: 'android' | 'ios'; actor: string },
): Promise<ActionContext> {
  // Look up device for serial/udid + screen dimensions
  const rows = await fastify.db
    .select()
    .from(schema.devices)
    .where(eq(schema.devices.id, sessionCtx.deviceId))
    .limit(1);
  const device = rows[0];
  if (!device) throw new Error(`buildActionContext: device ${sessionCtx.deviceId} not found`);

  const serial = sessionCtx.platform === 'android'
    ? (device.port == null ? device.emulatorId : `emulator-${device.port}`)
    : undefined;
  const udid = sessionCtx.platform === 'ios' ? device.emulatorId : undefined;

  // Adapter for ScreenshotService → captureOnce(deviceId, platform) → artifact descriptor.
  // This bridges the rich production ScreenshotService.capture(platform, deviceId, outputPath)
  // signature to the lean dispatch interface; the real artifact registration / persistence
  // lands in Plan 34-03+ when the resolver pulls bytes back. For Wave 2 the adapter shells
  // through ScreenshotService.capture into a temp path and returns a synthesized descriptor
  // so the WS path can return ack.result without coupling to ArtifactService writes.
  const screenshotService = {
    async captureOnce(deviceId: string, platform: 'android' | 'ios') {
      const tmpPath = `/tmp/device-farm/sessions/${sessionCtx.sessionId}-${Date.now()}.png`;
      // ScreenshotService.capture passes deviceId straight to `adb -s`.
      // For android we need the adb serial (`emulator-${port}`) not the UUID.
      // For ios the deviceId IS the udid which simctl wants.
      const adbTarget = platform === 'android'
        ? (device.port == null ? device.emulatorId : `emulator-${device.port}`)
        : deviceId;
      await fastify.screenshotService.capture(platform, adbTarget, tmpPath);
      // Width/height are best-effort placeholders for Wave 2 — Plan 34-03 will
      // probe the device for the real dimensions when the resolver needs them.
      return { id: randomUUID(), url: `file://${tmpPath}`, width: 1080, height: 1920 };
    },
  };

  const recordingService = {
    async startRecording(deviceId: string, platform: 'android' | 'ios') {
      const outPath = `/tmp/device-farm/sessions/${sessionCtx.sessionId}-rec.mp4`;
      const recSerial = platform === 'android'
        ? (device.port == null ? device.emulatorId : `emulator-${device.port}`)
        : deviceId;
      await fastify.recordingService.startRecording(
        sessionCtx.sessionId, outPath, platform, recSerial, {},
      );
    },
    async stopRecording(_deviceId: string, _platform: 'android' | 'ios') {
      await fastify.recordingService.stopRecording(sessionCtx.sessionId);
    },
  };

  const hierarchyService = {
    async getHierarchy(deviceId: string, platform: 'android' | 'ios') {
      const result = await fastify.hierarchyService.getHierarchy(
        platform, deviceId, device.port ?? null,
      );
      // Return the raw tree serialized — resolver consumers parse this back.
      return JSON.stringify(result.tree);
    },
  };

  const artifactService = {
    async resolveArtifactPath(artifactId: string): Promise<string> {
      const artifact = await fastify.artifactService.getById(artifactId);
      if (!artifact) throw new Error(`artifact ${artifactId} not found`);
      return artifact.filePath;
    },
  };

  // jobExecutor surface — actions.ts only uses installApk. We delegate to
  // adb directly here because there is no fastify.jobExecutor decorator
  // (executor is instantiated per-job in the worker). Functionally identical
  // to JobExecutor.installApk.
  const jobExecutor = {
    async installApk(adbSerial: string, apkPath: string): Promise<void> {
      await execFileAsync('adb', ['-s', adbSerial, 'install', '-r', '-t', apkPath]);
    },
  };

  const fetchScreenshotBytes = async (url: string): Promise<Buffer> => {
    if (url.startsWith('file://')) return readFile(url.slice('file://'.length));
    return new Promise((resolve, reject) => {
      const lib = url.startsWith('https:') ? httpsRequest : httpRequest;
      lib(url, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      }).on('error', reject).end();
    });
  };

  const resolver = ((fastify as unknown as { sessionsResolver?: typeof STUB_RESOLVER })
    .sessionsResolver) ?? STUB_RESOLVER;

  return {
    session: { ...sessionCtx, serial, udid },
    androidDevice: tangoAdbService,
    iosExecFileAsync: execFileAsync,
    adbExecFileAsync: execFileAsync,
    screenshotService,
    recordingService,
    hierarchyService,
    artifactService,
    jobExecutor,
    resolver,
    fetchScreenshotBytes,
  };
}

// ---------- Server envelope helpers ----------

function sendEnv(socket: MinimalSocket, env: ServerEnvelope): void {
  socket.send(JSON.stringify(env));
}

// ---------- Registration entrypoint ----------

export interface RegisterSessionWebSocketDeps {
  fastify: FastifyInstance;
  sessionsModule: SessionsModule;
  authService: AuthService;
  db: Database;
  logger: pino.Logger;
}

export async function registerSessionWebSocket(deps: RegisterSessionWebSocketDeps): Promise<void> {
  const { fastify, sessionsModule, authService, db, logger } = deps;
  const log = logger.child({ module: 'sessions.ws' });

  fastify.get<{ Params: { id: string }; Querystring: { token?: string } }>(
    '/ws/sessions/:id',
    { websocket: true },
    (rawSocket, request) => {
      // Cast: @fastify/websocket SocketStream is a WebSocket-like object.
      const socket = rawSocket as unknown as DecoratedSocket;
      const sessionId = (request.params as { id: string }).id;
      const token = (request.query as { token?: string }).token;

      // CRITICAL: register the 'message' listener BEFORE any await. Without
      // this, frames sent by the client during auth/db lookups are dropped
      // (Node EventEmitter discards events with no listener — see Bug 8 in
      // .planning/memory/v3-boot-bugs.md). Buffer frames until the real
      // handler is ready, then drain.
      const pendingFrames: Buffer[] = [];
      let realHandler: ((raw: Buffer | string) => void) | null = null;
      socket.on('message', (raw: Buffer | string) => {
        if (realHandler) {
          realHandler(raw);
        } else {
          // Buffer until the async setup wires the real handler.
          pendingFrames.push(typeof raw === 'string' ? Buffer.from(raw) : raw);
        }
      });

      // Wrap the whole connection setup so we can return + reject early
      // cleanly without nested .catch noise.
      void (async () => {
        // ----- 1. Auth gate -----
        if (!token) {
          sendEnv(socket, { type: 'error', code: 'unauthorized', message: 'missing token' });
          socket.close(1008, 'unauthorized');
          return;
        }
        const matched = await authService.validateKeyAndReturnRow(token);
        if (!matched) {
          sendEnv(socket, { type: 'error', code: 'unauthorized', message: 'invalid token' });
          socket.close(1008, 'unauthorized');
          return;
        }

        // ----- 2. Session lookup + lease/owner check -----
        const rows = await db
          .select()
          .from(schema.sessions)
          .where(eq(schema.sessions.id, sessionId))
          .limit(1);
        const session = rows[0];
        if (!session) {
          sendEnv(socket, { type: 'error', code: 'session_not_found', message: 'no such session' });
          socket.close(1008, 'session_not_found');
          return;
        }
        if (session.status !== 'active' || new Date(session.leaseUntil) < new Date()) {
          sendEnv(socket, { type: 'error', code: 'session_not_found', message: 'session not active' });
          socket.close(1008, 'session_not_found');
          return;
        }
        if (session.ownerApiKeyId !== matched.id) {
          sendEnv(socket, { type: 'error', code: 'unauthorized', message: 'not session owner' });
          socket.close(1008, 'unauthorized');
          return;
        }

        // ----- 3. Look up device + build action context -----
        const deviceRow = await db
          .select()
          .from(schema.devices)
          .where(eq(schema.devices.id, session.deviceId))
          .limit(1);
        const device = deviceRow[0];
        if (!device) {
          sendEnv(socket, { type: 'error', code: 'device_error', message: 'device row missing' });
          socket.close(1011, 'device_error');
          return;
        }

        const sessionCtx = {
          sessionId,
          deviceId: session.deviceId,
          platform: device.type as 'android' | 'ios',
          actor: `apikey:${matched.id}`,
        };
        socket.__sessionContext = sessionCtx;

        let ctx: ActionContext;
        try {
          ctx = await buildActionContext(fastify, sessionCtx);
        } catch (err) {
          log.error({ err, sessionId }, 'buildActionContext failed');
          sendEnv(socket, { type: 'error', code: 'device_error', message: 'failed to build action context' });
          socket.close(1011, 'device_error');
          return;
        }

        // ----- 4. Track socket in openSockets map -----
        sessionsModule.openSockets.set(sessionId, {
          send: (data: string) => socket.send(data),
          close: (code, reason) => socket.close(code, reason),
        });

        // ----- 5. Heartbeat lifecycle (verbatim from streaming/plugin.ts) -----
        let alive = true;
        const heartbeat = setInterval(() => {
          if (!alive) { socket.terminate(); clearInterval(heartbeat); return; }
          alive = false;
          socket.ping();
        }, HEARTBEAT_INTERVAL_MS);
        socket.on('pong', () => { alive = true; });

        // ----- 6. Emit 'connected' event -----
        sendEnv(socket, {
          type: 'event',
          kind: 'connected',
          data: { heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS },
        });

        // ----- 7. Per-message handler — install real handler + drain buffer -----
        const handleMessage = (raw: Buffer | string): void => {
          const start = Date.now();
          const text = typeof raw === 'string' ? raw : raw.toString('utf8');

          // 7a. JSON.parse — malformed frame is dropped (log warn, no close).
          let json: unknown;
          try {
            json = JSON.parse(text);
          } catch {
            log.warn({ sessionId }, 'WS frame: invalid JSON, dropped');
            return;
          }

          // 7b. Schema parse — invalid envelope → error reply + 1003 close.
          const parsed = clientEnvelope.safeParse(json);
          if (!parsed.success) {
            const maybeId = typeof (json as { id?: unknown })?.id === 'string'
              ? ((json as { id: string }).id as string)
              : undefined;
            const errEnv: ServerEnvelope = {
              type: 'error',
              code: 'invalid_envelope',
              message: parsed.error.issues[0]?.message ?? 'envelope schema parse failed',
              ...(maybeId && /^[0-9a-f-]{36}$/i.test(maybeId) ? { forMsgId: maybeId } : {}),
            };
            sendEnv(socket, errEnv);
            socket.close(1003, 'invalid_envelope');
            return;
          }

          const envelope = parsed.data;

          // 7c. ALS wrap → emit envelopes downstream carry the right actor.
          // `as never` cast follows the project's canonical pattern (see
          // server/reporting/__tests__/correlation.spec.ts:127) — RequestContextData
          // is module-augmented by correlation/plugin.ts but the @fastify/request-context
          // type signature uses an opaque RequestContext alias here.
          void asyncLocalStorage.run(
            { correlationId: randomUUID(), actor: ctx.session.actor, currentEventId: null } as never,
            async () => {
              // 7d. Rate-limit check (real sliding-window from sessionsModule).
              //     Overflow returns an error envelope but keeps the socket
              //     open — agents back off rather than reconnect.
              if (!sessionsModule.rateLimiter.check(sessionId, Date.now())) {
                sendEnv(socket, {
                  type: 'error', forMsgId: envelope.id,
                  code: 'rate_limited', message: '30 actions / 10s exceeded',
                });
                return;
              }

              // 7e. Dispatch + ack/pong/error.
              try {
                const result = await dispatch(envelope, ctx);
                if (envelope.type === 'ping') {
                  sendEnv(socket, { type: 'pong', forMsgId: envelope.id });
                } else {
                  sendEnv(socket, {
                    type: 'ack', forMsgId: envelope.id,
                    durationMs: Date.now() - start,
                    ...(result === null || result === undefined ? {} : { result }),
                  });
                }
              } catch (err) {
                const code = err instanceof ResolverError ? 'resolver_failed' : 'device_error';
                const message = err instanceof Error ? err.message : String(err);
                sendEnv(socket, {
                  type: 'error', forMsgId: envelope.id, code, message,
                });
              }
            },
          );
        };

        // Install the real handler and drain frames buffered during setup.
        realHandler = handleMessage;
        for (const buffered of pendingFrames) {
          handleMessage(buffered);
        }
        pendingFrames.length = 0;

        // ----- 8. Cleanup -----
        socket.on('close', () => {
          clearInterval(heartbeat);
          sessionsModule.openSockets.delete(sessionId);
          // Release the per-session rate-limit Map entry promptly so a
          // long-running server doesn't accumulate dead sessionId keys.
          sessionsModule.rateLimiter.clear(sessionId);
        });
        socket.on('error', (err) => {
          log.warn({ err, sessionId }, 'WS socket error');
          clearInterval(heartbeat);
          sessionsModule.openSockets.delete(sessionId);
          sessionsModule.rateLimiter.clear(sessionId);
        });
      })().catch((err) => {
        log.error({ err, sessionId }, 'WS handler setup failed');
        try { socket.close(1011, 'internal_error'); } catch { /* already closed */ }
      });
    },
  );

  log.info('Sessions WebSocket route registered (GET /ws/sessions/:id)');
}
