/**
 * DeviceFarmClient — Phase 34 Plan 34-05.
 *
 * Single REST + WS client used by every MCP tool. Owns:
 *   1. REST round-trip to /api/sessions for lease/release/list
 *   2. Per-session WebSocket lifecycle (lazy-open, ack matching, timeout)
 *   3. Server-authoritative wsUrl cache (Blocker fix #2 from plan-checker)
 *
 * **WS URL caching contract (CRITICAL — do not weaken):**
 *   - `lease()` is the SOLE writer of `wsUrlBySession`.
 *   - `getOrOpenWs(sessionId)` reads ONLY from the cache; on miss → throws
 *     `Error('session not leased by this client')`. It MUST NOT GET
 *     `/api/sessions` to discover the URL.
 *   - `listSessions()` MUST NOT populate the cache (read-only).
 *   - `release(sessionId)` clears the cache entry.
 *
 * This enforces a single source of truth for WS URLs (the lease response) and
 * eliminates spurious list-style calls on every WS open.
 */
import WebSocket from 'ws';
import { randomUUID } from 'node:crypto';

export interface DeviceFarmClientOpts {
  baseUrl: string;
  token: string;
}

export interface LeaseRequestBody {
  platform: 'android' | 'ios';
  deviceQuery?: { deviceId?: string; name?: string };
  ttlSeconds?: number;
  metadata?: Record<string, unknown>;
}

export interface LeaseResponse {
  sessionId: string;
  deviceId: string;
  deviceName: string;
  platform: 'android' | 'ios';
  wsUrl: string;
  leaseUntil: string;
  ttlSeconds: number;
}

interface PendingResolver {
  resolve(value: unknown): void;
  reject(err: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

interface WsEntry {
  socket: WebSocket;
  pending: Map<string, PendingResolver>;
  wsUrl: string;
}

const ACTION_TIMEOUT_MS = 30_000;

export class DeviceFarmClient {
  /** sessionId → wsUrl. Populated ONLY by lease(). Read by getOrOpenWs. */
  private wsUrlBySession = new Map<string, string>();
  /** sessionId → open WS + pending acks. */
  private wsBySession = new Map<string, WsEntry>();

  // Public so tools (e.g., device_screenshot) can read the bearer token for
  // artifact downloads. Treat as effectively read-only from outside.
  public readonly opts: Readonly<DeviceFarmClientOpts>;

  constructor(opts: DeviceFarmClientOpts) {
    this.opts = Object.freeze({ ...opts });
  }

  /** POST /api/sessions — leases a device, stores the returned wsUrl. */
  async lease(body: LeaseRequestBody): Promise<LeaseResponse> {
    const res = await fetch(`${this.opts.baseUrl}/api/sessions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.opts.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`lease failed ${res.status}: ${text}`);
    }
    const ref = (await res.json()) as LeaseResponse;
    // CRITICAL: cache the wsUrl from the lease response BEFORE returning.
    // This is the single source of truth for getOrOpenWs.
    this.wsUrlBySession.set(ref.sessionId, ref.wsUrl);
    return ref;
  }

  /** DELETE /api/sessions/:id — releases the lease and clears caches. */
  async release(sessionId: string): Promise<unknown> {
    const res = await fetch(`${this.opts.baseUrl}/api/sessions/${sessionId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${this.opts.token}` },
    });
    // Clear caches eagerly regardless of HTTP outcome — the user expressed
    // intent to release; we don't want a stale wsUrl to mislead the next call.
    this.wsUrlBySession.delete(sessionId);
    const existing = this.wsBySession.get(sessionId);
    if (existing) {
      // Reject any in-flight pending sends; they'll never ack.
      for (const [, p] of existing.pending) {
        clearTimeout(p.timer);
        p.reject(new Error('session released'));
      }
      existing.pending.clear();
      try {
        existing.socket.close(1000, 'session released');
      } catch {
        /* socket may already be closing */
      }
      this.wsBySession.delete(sessionId);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`release failed ${res.status}: ${text}`);
    }
    return res.json().catch(() => ({}));
  }

  /**
   * GET /api/sessions — list active sessions.
   * READ-ONLY: DOES NOT populate wsUrlBySession (only lease() may).
   */
  async listSessions(): Promise<unknown> {
    const res = await fetch(`${this.opts.baseUrl}/api/sessions`, {
      headers: { Authorization: `Bearer ${this.opts.token}` },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`listSessions failed ${res.status}: ${text}`);
    }
    return res.json();
  }

  /** GET /api/devices — list pool devices. */
  async listDevices(): Promise<unknown> {
    const res = await fetch(`${this.opts.baseUrl}/api/devices`, {
      headers: { Authorization: `Bearer ${this.opts.token}` },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`listDevices failed ${res.status}: ${text}`);
    }
    return res.json();
  }

  /**
   * Send a WS action envelope and await ack/error matching `forMsgId`.
   *
   * Lazy-opens the per-session WS via `getOrOpenWs(sessionId)`. If the
   * sessionId was never returned by this client's `lease()`, throws
   * `Error('session not leased by this client')` SYNCHRONOUSLY (before any
   * network I/O). Times out after 30s with `Error('action timeout (id=...)')`.
   */
  async sendAction(sessionId: string, partial: { type: string; id?: string; [k: string]: unknown }): Promise<unknown> {
    const id = partial.id ?? randomUUID();
    const envelope = { ...partial, id };
    const entry = await this.getOrOpenWs(sessionId);
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (entry.pending.delete(id)) {
          reject(new Error(`action timeout (id=${id})`));
        }
      }, ACTION_TIMEOUT_MS);
      entry.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
        timer,
      });
      try {
        entry.socket.send(JSON.stringify(envelope));
      } catch (err) {
        clearTimeout(timer);
        entry.pending.delete(id);
        reject(err as Error);
      }
    });
  }

  /**
   * Lazy-open the per-session WS. Reads ONLY from the wsUrl cache populated
   * by lease(). On cache miss throws synchronously — never issues a discovery
   * GET to /api/sessions.
   */
  private async getOrOpenWs(sessionId: string): Promise<WsEntry> {
    const existing = this.wsBySession.get(sessionId);
    if (existing && existing.socket.readyState === WebSocket.OPEN) return existing;

    // CACHE LOOKUP — single source of truth.
    const wsUrl = this.wsUrlBySession.get(sessionId);
    if (!wsUrl) {
      throw new Error('session not leased by this client');
    }

    const socket = new WebSocket(wsUrl);
    const pending = new Map<string, PendingResolver>();
    const entry: WsEntry = { socket, pending, wsUrl };

    socket.on('message', (raw) => {
      let frame: { type?: string; forMsgId?: string; result?: unknown; code?: string; message?: string };
      try {
        frame = JSON.parse(raw.toString());
      } catch {
        return; // malformed frame from server — ignore
      }
      if (!frame.forMsgId) return; // events have no forMsgId; ignore for ack-matching
      const resolver = pending.get(frame.forMsgId);
      if (!resolver) return;
      pending.delete(frame.forMsgId);
      if (frame.type === 'ack' || frame.type === 'pong') {
        resolver.resolve(frame.result ?? null);
      } else if (frame.type === 'error') {
        resolver.reject(new Error(`${frame.code ?? 'error'}: ${frame.message ?? 'unknown'}`));
      } else {
        // Unknown frame type addressed to a pending id — surface as error
        resolver.reject(new Error(`unexpected frame type ${frame.type ?? 'unknown'}`));
      }
    });

    socket.on('close', () => {
      // Reject all pending resolvers — they will never ack.
      for (const [, p] of pending) {
        clearTimeout(p.timer);
        p.reject(new Error('socket closed before ack'));
      }
      pending.clear();
      // Drop the cached entry so the next sendAction reopens.
      if (this.wsBySession.get(sessionId) === entry) {
        this.wsBySession.delete(sessionId);
      }
    });

    await new Promise<void>((res, rej) => {
      socket.once('open', () => res());
      socket.once('error', (err) => rej(err));
    });
    this.wsBySession.set(sessionId, entry);
    return entry;
  }

  /** Close all sockets and clear caches. Idempotent. */
  async closeAll(): Promise<void> {
    for (const [, entry] of this.wsBySession) {
      for (const [, p] of entry.pending) {
        clearTimeout(p.timer);
        p.reject(new Error('client shutting down'));
      }
      entry.pending.clear();
      try {
        entry.socket.close(1000, 'client shutdown');
      } catch {
        /* ignore */
      }
    }
    this.wsBySession.clear();
    this.wsUrlBySession.clear();
  }
}
