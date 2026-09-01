import { describe, it, expect, afterEach } from 'vitest';
import net from 'node:net';
import { AndroidRpcClient, parseAndroidServerEndpoint } from '../src/drivers/android-rpc';

/**
 * A fake newline-delimited JSON-RPC server. `respond` receives each parsed
 * request and returns either a raw string to write (for framing tests) or an
 * object merged into a `{jsonrpc,id,...}` reply. Returning `undefined` sends
 * nothing (to exercise timeouts).
 */
function startFakeServer(
  respond: (req: { method: string; params: unknown; id: number }, socket: net.Socket) => string | object | undefined,
): Promise<{ port: number; close: () => Promise<void>; server: net.Server }> {
  const server = net.createServer((socket) => {
    let buf = '';
    socket.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      let idx: number;
      while ((idx = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        if (!line.trim()) continue;
        const req = JSON.parse(line);
        const out = respond(req, socket);
        if (out === undefined) continue;
        if (typeof out === 'string') {
          socket.write(out);
        } else {
          socket.write(JSON.stringify({ jsonrpc: '2.0', id: req.id, ...out }) + '\n');
        }
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as net.AddressInfo;
      resolve({
        port: addr.port,
        server,
        close: () =>
          new Promise<void>((r) => {
            server.close(() => r());
          }),
      });
    });
  });
}

const clients: AndroidRpcClient[] = [];
const servers: Array<{ close: () => Promise<void> }> = [];
function track<T extends AndroidRpcClient>(c: T): T {
  clients.push(c);
  return c;
}

afterEach(async () => {
  for (const c of clients.splice(0)) c.close();
  for (const s of servers.splice(0)) await s.close();
});

describe('parseAndroidServerEndpoint', () => {
  it('defaults to localhost:9008 when unset or empty', () => {
    expect(parseAndroidServerEndpoint()).toEqual({ host: 'localhost', port: 9008 });
    expect(parseAndroidServerEndpoint('')).toEqual({ host: 'localhost', port: 9008 });
    expect(parseAndroidServerEndpoint('   ')).toEqual({ host: 'localhost', port: 9008 });
  });

  it('parses a bare host:port', () => {
    expect(parseAndroidServerEndpoint('10.0.0.5:9100')).toEqual({ host: '10.0.0.5', port: 9100 });
  });

  it('ignores a legacy http:// scheme and any path/query', () => {
    expect(parseAndroidServerEndpoint('http://localhost:9008')).toEqual({ host: 'localhost', port: 9008 });
    expect(parseAndroidServerEndpoint('http://host:9008/hierarchy?maxElements=5')).toEqual({
      host: 'host',
      port: 9008,
    });
  });

  it('falls back to the default port when host has no port', () => {
    expect(parseAndroidServerEndpoint('myhost')).toEqual({ host: 'myhost', port: 9008 });
  });
});

describe('AndroidRpcClient', () => {
  it('correlates replies by id and returns result', async () => {
    const srv = await startFakeServer((req) => ({ result: { echo: req.method, got: req.params } }));
    servers.push(srv);
    const client = track(new AndroidRpcClient('127.0.0.1', srv.port));

    const res = await client.call('tap', { x: 1, y: 2 });
    expect(res).toEqual({ echo: 'tap', got: { x: 1, y: 2 } });
  });

  it('handles many sequential requests over one connection', async () => {
    const srv = await startFakeServer((req) => ({ result: (req.params as { n: number }).n * 10 }));
    servers.push(srv);
    const client = track(new AndroidRpcClient('127.0.0.1', srv.port));

    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => client.call('m', { n: i })),
    );
    expect(results).toEqual(Array.from({ length: 20 }, (_, i) => i * 10));
  });

  it('reassembles replies split across TCP chunks', async () => {
    const srv = await startFakeServer((req, socket) => {
      const full = JSON.stringify({ jsonrpc: '2.0', id: req.id, result: 'ok' }) + '\n';
      // Deliberately fragment the reply mid-JSON, then flush the rest.
      socket.write(full.slice(0, 5));
      setTimeout(() => socket.write(full.slice(5)), 15);
      return undefined;
    });
    servers.push(srv);
    const client = track(new AndroidRpcClient('127.0.0.1', srv.port));

    expect(await client.call('getInfo')).toBe('ok');
  });

  it('maps a JSON-RPC error reply to a thrown Error carrying error.message', async () => {
    const srv = await startFakeServer(() => ({ error: { code: -32603, message: 'boom on device' } }));
    servers.push(srv);
    const client = track(new AndroidRpcClient('127.0.0.1', srv.port));

    await expect(client.call('tap', { x: 0, y: 0 })).rejects.toThrow('boom on device');
  });

  it('times out and rejects when the server never replies', async () => {
    const srv = await startFakeServer(() => undefined); // silence
    servers.push(srv);
    const client = track(new AndroidRpcClient('127.0.0.1', srv.port, { timeoutMs: 60 }));

    await expect(client.call('getAccessibilityTree')).rejects.toThrow(/timed out/);
  });

  it('reconnects for a new call after the connection drops', async () => {
    let hits = 0;
    const srv = await startFakeServer((req, socket) => {
      hits++;
      if (hits === 1) {
        // Kill the connection instead of answering the first request.
        socket.destroy();
        return undefined;
      }
      return { result: 'recovered' };
    });
    servers.push(srv);
    const client = track(new AndroidRpcClient('127.0.0.1', srv.port, { timeoutMs: 500 }));

    await expect(client.call('first')).rejects.toBeTruthy();
    expect(await client.call('second')).toBe('recovered');
  });
});
