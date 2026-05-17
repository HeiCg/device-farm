/**
 * Phase 35 Plan 35-05 — Exploration WebSocket client.
 *
 * Opens `GET /api/explorations/:id/events?token=<bearer>` and dispatches
 * the 6-variant discriminated union (see server/explorations/ws-schemas.ts)
 * into typed Svelte-side callbacks. Performs the camelCase →
 * snake_case shape translation at the boundary so the rest of
 * `web/explorations/` stays verbatim-ported from the React reference.
 *
 * Frame variants → handler mapping:
 *   - screen-discovered → onScreenDiscovered(Screen)
 *   - transition        → onTransition(Transition)
 *   - tool-call         → onToolCall({name,args,durationMs})
 *   - stuck             → onStuck({screen_id, consecutive})
 *   - finished          → onFinished({reason, stats})
 *   - error             → onError(message)
 *
 * Returns a teardown closure that closes the socket. Safe to call
 * multiple times.
 */
import type { Screen, Transition } from './atlas-types.js';

export interface OpenWsOpts {
  runId: string;
  /** Base URL — typically `window.location.origin`. http(s):// → ws(s)://. */
  baseUrl: string;
  /** Bearer token. Inherited from Phase 22/35-03 ?token=<bearer> auth. */
  token?: string;
  onScreenDiscovered: (screen: Screen) => void;
  onTransition: (t: Transition) => void;
  onToolCall?: (data: {
    name: string;
    args: Record<string, unknown>;
    durationMs: number;
  }) => void;
  onStuck?: (data: { screen_id: string; consecutive: number }) => void;
  onFinished?: (data: {
    reason: 'complete' | 'budget' | 'stuck' | 'login_required' | 'cancelled';
    stats: {
      screensDiscovered: number;
      transitionsTotal: number;
      tapsTaken: number;
      durationMs: number;
    };
  }) => void;
  onError?: (message: string) => void;
  /** Optional — invoked when the socket opens. Test/observability hook. */
  onOpen?: () => void;
  /** Optional — invoked when the socket closes. Test/observability hook. */
  onClose?: (code: number, reason: string) => void;
}

export interface ExplorationWsClient {
  close: () => void;
}

export function openExplorationWs(opts: OpenWsOpts): ExplorationWsClient {
  const url = new URL(
    `${opts.baseUrl.replace(/^http/, 'ws')}/api/explorations/${encodeURIComponent(opts.runId)}/events`,
  );
  if (opts.token) url.searchParams.set('token', opts.token);

  const ws = new WebSocket(url.toString());
  let closed = false;

  ws.addEventListener('open', () => {
    opts.onOpen?.();
  });

  ws.addEventListener('message', (evt) => {
    try {
      const frame = JSON.parse(typeof evt.data === 'string' ? evt.data : String(evt.data));
      dispatchFrame(frame, opts);
    } catch (err) {
      // Malformed frame — log + drop. Mirrors the broadcaster's
      // safeParse → warn-log behavior on the server side.
      // eslint-disable-next-line no-console
      console.warn('[exploration-ws] frame decode failed', err);
    }
  });

  ws.addEventListener('error', () => {
    opts.onError?.('websocket transport error');
  });

  ws.addEventListener('close', (evt) => {
    opts.onClose?.(evt.code, evt.reason);
  });

  function close(): void {
    if (closed) return;
    closed = true;
    try {
      ws.close();
    } catch {
      /* noop */
    }
  }

  return { close };
}

/**
 * Pure-function frame dispatcher — exported for unit-testing the
 * camelCase→snake_case shape translation without needing a real
 * WebSocket. The dispatchFrame function is intentionally narrow: it
 * does the type-discriminator branch + the property-rename, nothing
 * more.
 */
export function dispatchFrame(frame: unknown, handlers: OpenWsOpts): void {
  if (!frame || typeof frame !== 'object') return;
  const f = frame as { type?: string; data?: Record<string, unknown> };
  if (typeof f.type !== 'string') return;
  const data = f.data ?? {};

  switch (f.type) {
    case 'screen-discovered': {
      const s: Screen = {
        screen_id: String(data.screenId ?? ''),
        title: String(data.title ?? ''),
        screenshot_artifact_id: String(data.screenshotArtifactId ?? ''),
        elements: [],
        notes: null,
        bfs_depth: typeof data.bfsDepth === 'number' ? data.bfsDepth : 0,
      };
      handlers.onScreenDiscovered(s);
      break;
    }
    case 'transition': {
      const t: Transition = {
        from_screen_id: String(data.fromScreenId ?? ''),
        to_screen_id: String(data.toScreenId ?? ''),
        action:
          data.action && typeof data.action === 'object'
            ? (data.action as Record<string, unknown>)
            : {},
        is_back_edge: Boolean(data.isBackEdge),
        // bfs_order isn't on the WS frame (the broadcaster doesn't
        // know it); the server-side row gets it via GET later.
        // Use 0 as a placeholder so layoutGraph keeps working.
        bfs_order: 0,
      };
      handlers.onTransition(t);
      break;
    }
    case 'tool-call': {
      handlers.onToolCall?.({
        name: String(data.name ?? ''),
        args:
          data.args && typeof data.args === 'object'
            ? (data.args as Record<string, unknown>)
            : {},
        durationMs: typeof data.durationMs === 'number' ? data.durationMs : 0,
      });
      break;
    }
    case 'stuck': {
      handlers.onStuck?.({
        screen_id: String(data.screenId ?? ''),
        consecutive: typeof data.consecutive === 'number' ? data.consecutive : 1,
      });
      break;
    }
    case 'finished': {
      const reason = String(data.reason ?? 'complete') as
        | 'complete'
        | 'budget'
        | 'stuck'
        | 'login_required'
        | 'cancelled';
      const stats =
        data.stats && typeof data.stats === 'object'
          ? (data.stats as Record<string, number>)
          : {};
      handlers.onFinished?.({
        reason,
        stats: {
          screensDiscovered: Number(stats.screensDiscovered ?? 0),
          transitionsTotal: Number(stats.transitionsTotal ?? 0),
          tapsTaken: Number(stats.tapsTaken ?? 0),
          durationMs: Number(stats.durationMs ?? 0),
        },
      });
      break;
    }
    case 'error': {
      handlers.onError?.(String(data.message ?? 'unknown error'));
      break;
    }
    default:
      // Unknown discriminator — drop silently. The server-side strict
      // schema would have caught this; client-side resilience.
      break;
  }
}
