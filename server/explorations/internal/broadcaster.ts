/**
 * ExplorationsBroadcaster — per-run in-memory broadcaster (Phase 35 Plan 35-03).
 *
 * Ports the Phase 22 streaming JobBroadcaster pattern (ring buffer + EE fan-out
 * + cleanup) and adds:
 *   - Heartbeat ping every 30s per run (keeps idle WS connections alive
 *     through middleboxes; mirrors Phase 22 plugin-level heartbeat but moved
 *     into the broadcaster so the WS route stays thin).
 *   - Zod safeParse on publish — malformed outbound frames are dropped and
 *     structured-logged (NEVER thrown). The agent runner is a trusted
 *     producer but defensive validation catches drift between event
 *     payload schemas and the WS envelope schema (catches contract
 *     regressions in tests and at runtime).
 *   - Discriminated-union WsExplorationFrame (typed `data` payload), unlike
 *     the streaming JobBroadcaster which carries opaque `WsEnvelope.payload`.
 *
 * Invariants (asserted by ws-broadcaster.spec):
 *   - Ring buffer caps at exactly 200 frames per run (not 199, not 201).
 *   - subscribe() replays full history immediately, in order.
 *   - publish() fans out to all current subscribers synchronously.
 *   - cleanup() clears heartbeat, closes sockets, removes the run state.
 *   - Malformed frame: log + drop; no throw, no broken connection.
 */
import type { WebSocket } from 'ws';
import type pino from 'pino';

import {
  wsExplorationFrameSchema,
  type WsExplorationFrame,
} from '../ws-schemas.js';

export const RING_BUFFER_SIZE = 200;
export const HEARTBEAT_INTERVAL_MS = 30_000;

interface RunState {
  history: WsExplorationFrame[];
  subscribers: Set<WebSocket>;
  heartbeat: NodeJS.Timeout | null;
  /**
   * True once a `finished` or `error` frame has been published. Drives the
   * cleanup-on-last-unsubscribe heuristic in `unsubscribe()`.
   */
  terminal: boolean;
}

/**
 * `ws.OPEN` is `1` in the standard `ws` package. We hard-code the literal
 * instead of importing the enum to keep this module free of a hard `ws`
 * runtime dependency (only the `WebSocket` type is needed). The numeric
 * value is part of the WHATWG WebSocket API spec.
 */
const WS_OPEN = 1;

export class ExplorationsBroadcaster {
  private readonly runs = new Map<string, RunState>();

  constructor(private readonly logger: pino.Logger) {}

  /**
   * Validate + buffer + fan-out a frame for the given run. Malformed frames
   * are logged + dropped; never throws.
   */
  publish(runId: string, frame: WsExplorationFrame): void {
    const parsed = wsExplorationFrameSchema.safeParse(frame);
    if (!parsed.success) {
      this.logger.warn(
        { runId, errors: parsed.error.issues },
        'explorations.broadcaster: malformed frame dropped',
      );
      return;
    }
    const data = parsed.data;

    const state = this.ensureState(runId);
    state.history.push(data);
    if (state.history.length > RING_BUFFER_SIZE) {
      state.history.shift();
    }
    if (data.type === 'finished' || data.type === 'error') {
      state.terminal = true;
    }

    const json = JSON.stringify(data);
    for (const ws of state.subscribers) {
      if (ws.readyState === WS_OPEN) {
        try {
          ws.send(json);
        } catch (err) {
          this.logger.warn(
            { err, runId },
            'explorations.broadcaster: ws.send failed',
          );
        }
      }
    }
  }

  /**
   * Subscribe a socket. Replays buffered history (in emission order) before
   * returning. After this returns, future `publish` calls fan out to this
   * socket until `unsubscribe` (or socket close).
   */
  subscribe(runId: string, ws: WebSocket): void {
    const state = this.ensureState(runId);
    state.subscribers.add(ws);
    for (const frame of state.history) {
      if (ws.readyState !== WS_OPEN) break;
      try {
        ws.send(JSON.stringify(frame));
      } catch (err) {
        this.logger.warn(
          { err, runId },
          'explorations.broadcaster: history replay send failed',
        );
      }
    }
  }

  /**
   * Remove a socket. If this was the last subscriber AND the run is
   * terminal, cleans up the run state. Non-terminal runs keep their state
   * alive (so a reconnecting client can replay history) until explicit
   * `cleanup(runId)` is called.
   */
  unsubscribe(runId: string, ws: WebSocket): void {
    const state = this.runs.get(runId);
    if (!state) return;
    state.subscribers.delete(ws);
    if (state.subscribers.size === 0 && state.terminal) {
      this.cleanup(runId);
    }
  }

  /**
   * Force-cleanup a run. Clears heartbeat, closes any remaining sockets,
   * removes the run state from the map. Safe to call multiple times.
   */
  cleanup(runId: string): void {
    const state = this.runs.get(runId);
    if (!state) return;
    if (state.heartbeat) clearInterval(state.heartbeat);
    for (const ws of state.subscribers) {
      try {
        ws.close();
      } catch {
        /* swallow — close on already-closed socket is harmless */
      }
    }
    this.runs.delete(runId);
  }

  /**
   * Tear down all runs. Called from explorations module shutdown.
   */
  shutdown(): void {
    for (const runId of Array.from(this.runs.keys())) {
      this.cleanup(runId);
    }
  }

  /**
   * Internal — for tests. Returns the current history size for a run
   * (0 if the run is unknown).
   */
  getHistorySize(runId: string): number {
    return this.runs.get(runId)?.history.length ?? 0;
  }

  /**
   * Internal — for tests. Returns the current subscriber count for a run
   * (0 if the run is unknown).
   */
  getSubscriberCount(runId: string): number {
    return this.runs.get(runId)?.subscribers.size ?? 0;
  }

  /**
   * Internal — for tests. Returns the current run count (size of the runs map).
   */
  getRunCount(): number {
    return this.runs.size;
  }

  private ensureState(runId: string): RunState {
    let state = this.runs.get(runId);
    if (!state) {
      state = {
        history: [],
        subscribers: new Set(),
        heartbeat: setInterval(() => this.heartbeat(runId), HEARTBEAT_INTERVAL_MS),
        terminal: false,
      };
      // Don't keep the process alive purely on the broadcaster's heartbeat.
      state.heartbeat?.unref?.();
      this.runs.set(runId, state);
    }
    return state;
  }

  private heartbeat(runId: string): void {
    const state = this.runs.get(runId);
    if (!state) return;
    for (const ws of state.subscribers) {
      if (ws.readyState === WS_OPEN) {
        try {
          ws.ping();
        } catch {
          /* swallow — ping on already-closing socket is harmless */
        }
      }
    }
  }
}
