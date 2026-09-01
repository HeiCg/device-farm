import net from 'node:net';

/**
 * Newline-delimited JSON-RPC 2.0 client for `@device-stream/android-server`
 * (TCP on port 9008 since v1.2.0). One request per line, one `\n`-terminated
 * reply per request; the server processes requests serially, so this client
 * keeps a single reused connection and issues one request at a time (an
 * in-order queue), correlating replies by `id`. The socket reconnects lazily
 * on the next call after a close/error, and each request has its own timeout
 * that destroys the socket if the server never answers.
 */
export interface AndroidRpcOptions {
  /** Per-request timeout in ms; on expiry the socket is destroyed. Default 10s. */
  timeoutMs?: number;
}

interface JsonRpcResponse {
  jsonrpc?: string;
  id?: number | string | null;
  result?: unknown;
  error?: { code?: number; message?: string };
}

interface Pending {
  resolve: (result: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Parse the `androidServerUrl` session option into a host/port pair. Accepts
 * both a bare `host:port` and a legacy `http://host:port` URL (the scheme is
 * ignored — the transport is TCP JSON-RPC, not HTTP). Defaults to
 * `localhost:9008` when unset.
 *
 * @deprecated passing an `http://` scheme — the android-server speaks TCP
 * JSON-RPC, not HTTP. Pass `host:port` (scheme is stripped and ignored).
 */
export function parseAndroidServerEndpoint(url?: string): { host: string; port: number } {
  const DEFAULT = { host: 'localhost', port: 9008 };
  if (!url) return DEFAULT;

  let rest = url.trim();
  if (!rest) return DEFAULT;

  // Strip any scheme (e.g. `http://`, `tcp://`) — kept for backward compat.
  const schemeMatch = rest.match(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//);
  if (schemeMatch) rest = rest.slice(schemeMatch[0].length);

  // Drop any trailing path/query the legacy HTTP URL might have carried.
  rest = rest.split('/')[0]!.split('?')[0]!;

  const lastColon = rest.lastIndexOf(':');
  if (lastColon === -1) {
    return { host: rest || DEFAULT.host, port: DEFAULT.port };
  }
  const host = rest.slice(0, lastColon) || DEFAULT.host;
  const port = Number.parseInt(rest.slice(lastColon + 1), 10);
  return { host, port: Number.isFinite(port) ? port : DEFAULT.port };
}

export class AndroidRpcClient {
  private readonly host: string;
  private readonly port: number;
  private readonly timeoutMs: number;

  private socket: net.Socket | null = null;
  private connecting: Promise<net.Socket> | null = null;
  private buffer = '';
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  /** Serialises calls so only one request is in flight at a time. */
  private chain: Promise<unknown> = Promise.resolve();
  private closed = false;

  constructor(host: string, port: number, opts: AndroidRpcOptions = {}) {
    this.host = host;
    this.port = port;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
  }

  /** Invoke a JSON-RPC method; resolves with `result`, rejects on RPC error. */
  call(method: string, params?: Record<string, unknown>): Promise<unknown> {
    const run = (): Promise<unknown> => this.sendOne(method, params);
    const result = this.chain.then(run, run);
    // Keep the chain alive regardless of individual outcomes.
    this.chain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  close(): void {
    this.closed = true;
    this.rejectAll(new Error('android-rpc client closed'));
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
  }

  private async sendOne(method: string, params?: Record<string, unknown>): Promise<unknown> {
    if (this.closed) throw new Error('android-rpc client closed');
    const socket = await this.connect();
    const id = this.nextId++;
    const payload = JSON.stringify({ jsonrpc: '2.0', method, params: params ?? {}, id });

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        // A wedged request means the connection is suspect: destroy it so the
        // next call reconnects rather than reading a stale reply.
        this.destroySocket(new Error(`android-rpc ${method} timed out after ${this.timeoutMs}ms`));
        reject(new Error(`android-rpc ${method} timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);

      this.pending.set(id, { resolve, reject, timer });

      socket.write(payload + '\n', (err) => {
        if (err) {
          const p = this.pending.get(id);
          if (p) {
            clearTimeout(p.timer);
            this.pending.delete(id);
          }
          reject(err);
        }
      });
    });
  }

  private connect(): Promise<net.Socket> {
    if (this.socket && !this.socket.destroyed) return Promise.resolve(this.socket);
    if (this.connecting) return this.connecting;

    this.connecting = new Promise<net.Socket>((resolve, reject) => {
      const socket = net.createConnection({ host: this.host, port: this.port });
      socket.setNoDelay(true);

      const onConnectError = (err: Error): void => {
        this.connecting = null;
        reject(err);
      };

      socket.once('connect', () => {
        socket.removeListener('error', onConnectError);
        socket.on('error', (err) => this.destroySocket(err));
        socket.on('close', () => this.destroySocket(new Error('android-rpc connection closed')));
        socket.on('data', (chunk: Buffer) => this.onData(chunk));
        this.socket = socket;
        this.connecting = null;
        resolve(socket);
      });
      socket.once('error', onConnectError);
    });
    return this.connecting;
  }

  private onData(chunk: Buffer): void {
    this.buffer += chunk.toString('utf8');
    let idx: number;
    while ((idx = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 1);
      if (!line.trim()) continue;
      this.dispatch(line);
    }
  }

  private dispatch(line: string): void {
    let res: JsonRpcResponse;
    try {
      res = JSON.parse(line) as JsonRpcResponse;
    } catch {
      return; // ignore unparseable frames
    }
    const id = typeof res.id === 'number' ? res.id : undefined;
    if (id === undefined) return;
    const p = this.pending.get(id);
    if (!p) return;
    clearTimeout(p.timer);
    this.pending.delete(id);

    if (res.error) {
      p.reject(new Error(res.error.message ?? `android-rpc error ${res.error.code ?? ''}`.trim()));
    } else {
      p.resolve(res.result);
    }
  }

  private destroySocket(err: Error): void {
    const socket = this.socket;
    this.socket = null;
    this.buffer = '';
    if (socket) {
      socket.removeAllListeners();
      socket.destroy();
    }
    this.rejectAll(err);
  }

  private rejectAll(err: Error): void {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
  }
}
