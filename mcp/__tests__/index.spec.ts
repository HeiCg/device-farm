/**
 * @device-stream/mcp child-process smoke spec — Phase 34 Plan 34-05.
 *
 * Spawns the built `dist/index.js` over stdio, drives the JSON-RPC handshake
 * end-to-end:
 *   1. initialize → assert serverInfo.name === 'device-stream'
 *   2. tools/list → assert 12 tools with the expected names
 *
 * The MCP server is given a mock device-farm HTTP server URL via
 * DEVICE_FARM_URL so it can boot without a real backend.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SERVER_BIN = join(__dirname, '..', 'dist', 'index.js');

describe('@device-stream/mcp smoke (Plan 34-05)', () => {
  let mockServer: Server;
  let mockPort = 0;

  beforeAll(async () => {
    mockServer = createServer((req, res) => {
      if (req.url === '/api/devices' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ devices: [] }));
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise<void>((resolve) => mockServer.listen(0, '127.0.0.1', resolve));
    const addr = mockServer.address();
    if (addr && typeof addr === 'object') mockPort = addr.port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => mockServer.close(() => resolve()));
  });

  function spawnServer(): ChildProcess {
    return spawn('node', [SERVER_BIN], {
      env: {
        ...process.env,
        DEVICE_FARM_URL: `http://127.0.0.1:${mockPort}`,
        DEVICE_FARM_TOKEN: 'test-token',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  }

  /**
   * Drive a single JSON-RPC request/response over the child's stdio.
   * Buffers stdout and emits the first matching id.
   */
  async function rpc(child: ChildProcess, request: Record<string, unknown>, timeoutMs = 8000): Promise<Record<string, unknown>> {
    const id = request.id;
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      let buf = '';
      const onData = (chunk: Buffer): void => {
        buf += chunk.toString();
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const frame = JSON.parse(line) as Record<string, unknown>;
            if (frame.id === id) {
              child.stdout?.off('data', onData);
              clearTimeout(timer);
              resolve(frame);
              return;
            }
          } catch {
            // ignore non-json log lines
          }
        }
      };
      const timer = setTimeout(() => {
        child.stdout?.off('data', onData);
        reject(new Error(`rpc timeout waiting for id=${String(id)}`));
      }, timeoutMs);
      child.stdout?.on('data', onData);
      child.stdin?.write(JSON.stringify(request) + '\n');
    });
  }

  it('responds to initialize with serverInfo.name === "device-stream"', async () => {
    const child = spawnServer();
    try {
      const response = await rpc(child, {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'vitest-smoke', version: '0.0.0' },
        },
      });
      expect(response.result).toBeDefined();
      const result = response.result as { serverInfo: { name: string; version: string } };
      expect(result.serverInfo.name).toBe('device-stream');
      expect(result.serverInfo.version).toBe('0.1.0');
    } finally {
      child.kill('SIGTERM');
    }
  }, 15_000);

  it('tools/list returns exactly 12 tools with the expected names', async () => {
    const child = spawnServer();
    try {
      // Always initialize first — the SDK rejects other methods before handshake.
      await rpc(child, {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'vitest-smoke', version: '0.0.0' },
        },
      });
      // initialized notification (no id; SDK requires it before tool calls).
      child.stdin?.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

      const response = await rpc(child, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
      const result = response.result as { tools: Array<{ name: string; description?: string }> };
      expect(result.tools).toHaveLength(12);
      const names = result.tools.map((t) => t.name).sort();
      expect(names).toEqual(
        [
          'device_install',
          'device_key',
          'device_launch',
          'device_lease',
          'device_list',
          'device_release',
          'device_screenshot',
          'device_swipe',
          'device_tap',
          'device_tap_by_description',
          'device_type',
          'device_uninstall',
        ].sort(),
      );
    } finally {
      child.kill('SIGTERM');
    }
  }, 15_000);
});
