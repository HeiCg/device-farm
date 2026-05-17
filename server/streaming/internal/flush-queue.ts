/**
 * Phase 31 Plan 31-02 — Per-WS-connection batcher (SC2).
 *
 * Coalesces high-frequency outbound envelopes into a single outer wrapper
 * `{type:'batch', items: WsEnvelope[]}` on a 150ms timer OR when the buffer
 * reaches 64 entries (whichever fires first). Achieves the SC2 target of
 * fewer than 100 WS frames for a 10k-line job.
 *
 * The outer batch envelope is INTENTIONALLY NOT validated via
 * `wsEnvelopeSchema` (Pitfall 3 in 31-RESEARCH.md): batch is a transport-level
 * wrapper at a layer above the strict per-event envelope. INNER items are
 * already wsEnvelopeSchema-validated by the broadcaster before they reach
 * push() — the wrapper preserves their shape verbatim.
 *
 * `batchMode = false` (set when client connects with `?nobatch=1`) installs no
 * timer and sends each envelope unbatched — backwards-compat path for legacy
 * clients that don't yet unwrap the outer envelope.
 *
 * `close()` clears the timer and drains pending entries so no tail messages
 * are lost when a socket disconnects mid-buffer-window.
 *
 * The broadcaster already short-circuits to closed sockets via the subscribe
 * callback; this class additionally gates every send on `readyState === 1`
 * (OPEN) to harden against race conditions during socket teardown.
 */
import type { WsEnvelope } from './ws-schemas.js';

const FLUSH_INTERVAL_MS = 150;
// BUFFER_CAP raised from CONTEXT-decision 64 → 256 per Wave 1 deviation
// (31-02 Task 1, Rule 1 — Bug): the SC2 contract "10k lines → < 100 WS frames"
// is mathematically unsatisfiable with cap=64 (10000/64 = 157 forced flushes,
// since every cap-overflow flushes regardless of timer interleaving). 256 keeps
// the 10k-line worst case at 10000/256 = 40 forced flushes (well under 100)
// while preserving the per-flush size hint that bounds outer-envelope payload.
// Original "10k buffer pattern" from simvyn (CONTEXT §specifics) is the lineage;
// 64 was a planner mis-typing of the buffer cap. Documented in 31-02-SUMMARY.md.
const BUFFER_CAP = 256;

/**
 * Minimal WebSocket surface that FlushQueue depends on.
 *
 * Structurally compatible with the `ws` library `WebSocket` (used by
 * `@fastify/websocket`) — both expose `send(data: string): void` and a
 * `readyState: number` where `1 === OPEN`.
 */
export interface SocketLike {
  send(data: string): void;
  readyState: number;
}

export class FlushQueue {
  private buf: WsEnvelope[] = [];
  private timer: ReturnType<typeof setInterval> | null;

  constructor(
    private readonly socket: SocketLike,
    private readonly batchMode: boolean,
  ) {
    this.timer = batchMode ? setInterval(() => this.flush(), FLUSH_INTERVAL_MS) : null;
  }

  push(env: WsEnvelope): void {
    if (!this.batchMode) {
      this.sendOne(env);
      return;
    }
    this.buf.push(env);
    if (this.buf.length >= BUFFER_CAP) this.flush();
  }

  flush(): void {
    if (this.buf.length === 0) return;
    const items = this.buf;
    this.buf = [];
    this.sendRaw({ type: 'batch', items });
  }

  close(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.flush();
  }

  private sendOne(env: WsEnvelope): void {
    if (this.socket.readyState === 1) {
      this.socket.send(JSON.stringify(env));
    }
  }

  private sendRaw(payload: unknown): void {
    if (this.socket.readyState === 1) {
      this.socket.send(JSON.stringify(payload));
    }
  }
}
