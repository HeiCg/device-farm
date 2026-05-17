/**
 * Phase 24 / Plan 24-03 — Maestro routes (extracted from plugin.ts).
 *
 * 6 routes + 4 helpers + 1 device-resolution helper. Registered by
 * server/maestro/plugin.ts (Task 3.4) via `registerMaestroRoutes(fastify)`
 * inside the thin plugin body. Routes consume the back-compat decorators
 * `fastify.hierarchyService` / `fastify.appiumService` /
 * `fastify.deviceInfoCollector` (Phase 22/23 convention — preserve to
 * avoid scope creep across api/routes/*).
 *
 * MOD-02 boundary: this file lives at server/maestro/routes.ts (top-level
 * of the module, NOT under internal/). Its content is therefore a public
 * import surface from outside the module (server/api/* may register it
 * indirectly via the plugin), but in practice only plugin.ts calls
 * `registerMaestroRoutes()`.
 */
import type { FastifyInstance } from 'fastify';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { HierarchySource } from './internal/hierarchy-service.js';
import { createHttpError } from '../api/error-handler.js';

const execFileAsync = promisify(execFile);

export function registerMaestroRoutes(fastify: FastifyInstance): void {
  // --- Helper: resolve device or throw ---
  function resolveDevice(id: string) {
    const device = fastify.pool.getDevice(id);
    if (!device) throw createHttpError(404, `Device ${id} not found`, 'NOT_FOUND');
    if (device.state === 'offline' || device.state === 'error' || device.state === 'booting') {
      throw createHttpError(409, `Device ${id} is ${device.state} — not available`, 'DEVICE_NOT_READY');
    }
    return device;
  }

  // --- Routes ---

  /**
   * GET /api/devices/:id/hierarchy — Fetch live UI element tree.
   * Query: maxDepth (number) — limit tree depth
   *        source ('maestro-cli' | 'device-server' | 'native') — force a specific strategy
   */
  fastify.get<{ Params: { id: string }; Querystring: { maxDepth?: string; source?: HierarchySource } }>(
    '/api/devices/:id/hierarchy',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: {
            maxDepth: { type: 'string' },
            source: { type: 'string', enum: ['maestro-cli', 'device-server', 'native', 'appium'] },
          },
        },
      },
    },
    async (request) => {
      const device = resolveDevice(request.params.id);
      const { maxDepth: maxDepthStr, source } = request.query;

      try {
        const result = await fastify.hierarchyService.getHierarchy(
          device.platform,
          device.emulatorId,
          device.port,
          source,
        );

        if (maxDepthStr) {
          const maxDepth = parseInt(maxDepthStr, 10);
          if (!isNaN(maxDepth) && maxDepth > 0) {
            result.tree = pruneDepth(result.tree, maxDepth);
          }
        }

        return result;
      } catch (err: any) {
        throw createHttpError(502, `Hierarchy fetch failed: ${err.message}`, 'HIERARCHY_ERROR');
      }
    },
  );

  /**
   * GET /api/devices/:id/query — Search UI elements by text or id regex.
   * Query: text (string), id (string) — at least one required
   */
  fastify.get<{ Params: { id: string }; Querystring: { text?: string; id?: string } }>(
    '/api/devices/:id/query',
    async (request) => {
      const device = resolveDevice(request.params.id);
      const { text, id: elementId } = request.query as { text?: string; id?: string };

      if (!text && !elementId) {
        throw createHttpError(400, 'Either text or id query parameter required', 'VALIDATION_ERROR');
      }

      try {
        return await fastify.hierarchyService.queryElements(
          device.platform, device.emulatorId, device.port,
          { text, id: elementId },
        );
      } catch (err: any) {
        throw createHttpError(502, `Element query failed: ${err.message}`, 'QUERY_ERROR');
      }
    },
  );

  /**
   * GET /api/devices/:id/screenshot — On-demand JPEG screenshot.
   * Query: quality (1-100, default 80), scale (0.1-1, default 1)
   */
  fastify.get<{ Params: { id: string }; Querystring: { quality?: string; scale?: string } }>(
    '/api/devices/:id/screenshot',
    async (request, reply) => {
      const device = resolveDevice(request.params.id);
      const quality = Math.min(100, Math.max(1, parseInt((request.query as any).quality ?? '80', 10)));
      const scale = Math.min(1, Math.max(0.1, parseFloat((request.query as any).scale ?? '1')));

      try {
        const buf = await captureScreenshot(device.platform, device.emulatorId, device.port, quality, scale);
        reply.header('Content-Type', 'image/png');
        reply.header('Cache-Control', 'no-store');
        return reply.send(buf);
      } catch (err: any) {
        throw createHttpError(502, `Screenshot failed: ${err.message}`, 'SCREENSHOT_ERROR');
      }
    },
  );

  /**
   * GET /api/devices/:id/info — Rich device metadata (cached, collected on boot).
   */
  fastify.get<{ Params: { id: string } }>(
    '/api/devices/:id/info',
    async (request) => {
      const { id } = request.params;
      const device = fastify.pool.getDevice(id);
      if (!device) throw createHttpError(404, `Device ${id} not found`, 'NOT_FOUND');

      // Return whatever we have. Metadata may be null if device just booted.
      return { device, metadata: device.metadata ?? null };
    },
  );

  /**
   * POST /api/devices/:id/info/refresh — Force re-collect device metadata.
   */
  fastify.post<{ Params: { id: string } }>(
    '/api/devices/:id/info/refresh',
    async (request) => {
      const device = resolveDevice(request.params.id);

      const metadata = await fastify.deviceInfoCollector.collect(
        device.platform,
        device.emulatorId,
        device.port,
      );

      // Cache it
      const rawDevice = fastify.pool.getDeviceMap().get(device.id);
      if (rawDevice) rawDevice.metadata = metadata;

      return { deviceId: device.id, metadata };
    },
  );

  /**
   * GET /api/devices/:id/state — Combined screenshot + hierarchy + info in one call.
   * For Android with device-stream server running, this is a single round-trip (~200ms).
   * For iOS or without device-stream, fetches in parallel (~2-3s total).
   */
  fastify.get<{ Params: { id: string } }>(
    '/api/devices/:id/state',
    async (request) => {
      const device = resolveDevice(request.params.id);

      // Try device-stream android-server /state endpoint first (single round-trip)
      if (device.platform === 'android') {
        try {
          const resp = await fetch('http://localhost:9008/state', {
            method: 'POST',
            signal: AbortSignal.timeout(5000),
          });
          if (resp.ok) {
            const data = await resp.json() as any;
            return {
              deviceId: device.id,
              screenshot: data.screenshot, // base64 JPEG
              hierarchy: data.hierarchy,
              info: data.info,
              source: 'device-server',
            };
          }
        } catch {
          // Fall through to separate fetches
        }
      }

      // Parallel fetch: hierarchy + screenshot + info
      const [hierarchy, screenshot, metadata] = await Promise.allSettled([
        fastify.hierarchyService.getHierarchy(device.platform, device.emulatorId, device.port),
        captureScreenshot(device.platform, device.emulatorId, device.port, 80, 1)
          .then(buf => buf.toString('base64')),
        device.metadata
          ? Promise.resolve(device.metadata)
          : fastify.deviceInfoCollector.collect(device.platform, device.emulatorId, device.port),
      ]);

      return {
        deviceId: device.id,
        screenshot: hierarchy.status === 'fulfilled' ? undefined : null,
        screenshotBase64: screenshot.status === 'fulfilled' ? screenshot.value : null,
        hierarchy: hierarchy.status === 'fulfilled' ? hierarchy.value : null,
        info: metadata.status === 'fulfilled' ? metadata.value : null,
        source: 'parallel-fetch',
      };
    },
  );

  /**
   * GET /api/appium/status — Check Appium server availability and session count.
   */
  fastify.get('/api/appium/status', async () => {
    const available = await fastify.appiumService.isAvailable();
    return {
      available,
      sessionCount: fastify.appiumService.getSessionCount(),
      serverUrl: (fastify.config as any).appium?.server_url ?? 'http://localhost:4723',
    };
  });
}

// --- Screenshot helpers (file-scope; not exported) ---

async function captureScreenshot(
  platform: string,
  emulatorId: string,
  port: number | null,
  quality: number,
  scale: number,
): Promise<Buffer> {
  if (platform === 'android') {
    return captureAndroidScreenshot(port, quality, scale, emulatorId);
  }
  return captureIosScreenshot(emulatorId);
}

async function captureAndroidScreenshot(
  port: number | null,
  quality: number,
  scale: number,
  emulatorId?: string,
): Promise<Buffer> {
  // Try device-stream android-server (fast, ~50-100ms)
  try {
    const url = `http://localhost:9008/screenshot?quality=${quality}&scale=${scale}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (resp.ok) {
      return Buffer.from(await resp.arrayBuffer());
    }
  } catch {
    // Fall through
  }

  // Fallback: adb screencap
  // For emulators with a known port, always use emulator-{port} convention.
  // For physical devices (no port), use emulatorId as ADB serial directly.
  const serial = port != null ? `emulator-${port}` : (emulatorId ?? 'emulator-5554');
  const { stdout } = await execFileAsync(
    'adb', ['-s', serial, 'exec-out', 'screencap', '-p'],
    { encoding: 'buffer' as any, maxBuffer: 20_000_000, timeout: 10_000 },
  );
  return stdout as any as Buffer;
}

async function captureIosScreenshot(udid: string): Promise<Buffer> {
  // Try WDA /screenshot
  try {
    const resp = await fetch('http://localhost:8100/screenshot', {
      signal: AbortSignal.timeout(5000),
    });
    if (resp.ok) {
      const data = await resp.json() as any;
      if (data.value) return Buffer.from(data.value, 'base64');
    }
  } catch {
    // Fall through
  }

  // Fallback: xcrun simctl io screenshot
  const tmpPath = join(tmpdir(), `df-screenshot-${Date.now()}.png`);
  await execFileAsync('xcrun', ['simctl', 'io', udid, 'screenshot', tmpPath], { timeout: 10_000 });
  const buf = await readFile(tmpPath);
  await unlink(tmpPath).catch(() => {});
  return buf;
}

// --- Tree utility ---

function pruneDepth(nodes: any[], maxDepth: number, depth = 0): any[] {
  if (depth >= maxDepth) return nodes.map(n => ({ ...n, children: [] }));
  return nodes.map(n => ({
    ...n,
    children: pruneDepth(n.children ?? [], maxDepth, depth + 1),
  }));
}
