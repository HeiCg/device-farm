/**
 * Phase 37 Plan 37-04 Wave 1 Track D — InputBroadcaster.
 *
 * Direct port of kittyfarm/Input/InputCoordinator.swift (45 LOC Swift) to
 * TypeScript via Promise.allSettled — matches Swift `withTaskGroup(of:)`
 * semantics 1:1.
 *
 * Critical invariants (Pattern 4 in 37-RESEARCH.md):
 *   1. A single failing dispatch must NOT cancel sends to other sessions
 *      (kittyfarm pattern: `error: <name>` + continue — InputCoordinator.swift:10-11).
 *   2. Per-session results preserve order matching input sessionIds.
 *   3. Session existence is validated by the dispatcher (Pitfall 8 — race-safe
 *      at dispatch, NOT pre-checked here — that would race with sweeper).
 *
 * The broadcaster is intentionally dispatcher-agnostic: it takes a
 * `SessionDispatcher` contract (single `dispatch(sessionId, action)` method)
 * so unit tests can inject a mock without spinning up the Sessions module.
 * Production wiring provides the SessionsModule (which implements
 * SessionDispatcher via `actions.dispatch` + ActionContext) as the dispatcher.
 */
import type pino from 'pino';

// ---------- Public types ----------

/**
 * Normalized touch coordinates (0..1 range, origin top-left).
 *
 * The broadcaster passes these straight through to the per-session
 * dispatcher; the dispatcher converts to absolute pixels using the device's
 * screen dimensions (so the same broadcast can hit phones of different
 * resolutions accurately).
 */
export interface NormalizedTouch {
  x: number; // 0..1
  y: number; // 0..1
}

/** Key event for the `key` action variant — mirrors KEY_CODES enum in sessions/protocol.ts. */
export interface KeyEvent {
  key: string;
  modifiers?: string[];
}

/**
 * Discriminated union of actions the broadcaster can fan out. Intentionally
 * narrower than `ClientEnvelope` (sessions/protocol.ts) — the broadcaster
 * deliberately does NOT support stateful actions (screenshot, screenRecord,
 * installApp) because fan-out semantics are unclear for those (e.g. which
 * device's screenshot do you return?). Only stateless input events.
 */
export type BroadcastAction =
  | { type: 'tap'; touch: NormalizedTouch }
  | { type: 'key'; event: KeyEvent }
  | { type: 'text'; text: string };

/**
 * Per-session result returned by `broadcast()`. Preserves input order.
 * On failure, `error` carries the dispatcher's error message (kittyfarm
 * surfaces session display name; here we surface the session id since
 * the broadcaster doesn't load session metadata).
 */
export interface BroadcastResult {
  sessionId: string;
  ok: boolean;
  error?: string;
}

/**
 * Minimal dispatcher contract — implemented by SessionsModule in production,
 * mocked in tests. The dispatcher MUST validate session existence (Pitfall 8)
 * and throw if the session is missing/expired so the broadcaster surfaces
 * the failure as `{ok:false, error:...}` without rolling back successful sends.
 */
export interface SessionDispatcher {
  dispatch(sessionId: string, action: BroadcastAction): Promise<void>;
}

export interface InputBroadcaster {
  /**
   * Fan out `action` to every sessionId via Promise.allSettled. Returns
   * one BroadcastResult per input sessionId in the same order. A failing
   * dispatch surfaces as `{ok:false, error}` and does NOT cancel the other
   * sends (kittyfarm InputCoordinator.swift:10-11 parity).
   */
  broadcast(sessionIds: string[], action: BroadcastAction): Promise<BroadcastResult[]>;
}

export interface InputBroadcasterDeps {
  dispatcher: SessionDispatcher;
  logger: pino.Logger;
}

// ---------- Factory ----------

export function createInputBroadcaster(deps: InputBroadcasterDeps): InputBroadcaster {
  const log = deps.logger.child({ component: 'input-broadcaster' });

  return {
    async broadcast(sessionIds, action) {
      // Snapshot sessionIds eagerly so a concurrent mutation of the caller's
      // array doesn't change the indices we report results at. NOT a mutex
      // around the dispatcher — racy disposes surface as per-session errors
      // (kittyfarm pattern + Pitfall 8: dispatch-side validation).
      const ids = [...sessionIds];

      // Promise.allSettled is the TS translation of Swift `withTaskGroup(of:)`:
      // every task runs in parallel; failures do NOT cancel siblings.
      const settled = await Promise.allSettled(
        ids.map((id) => deps.dispatcher.dispatch(id, action)),
      );

      const results: BroadcastResult[] = settled.map((r, i) => {
        if (r.status === 'fulfilled') {
          return { sessionId: ids[i], ok: true };
        }
        const message = r.reason instanceof Error ? r.reason.message : String(r.reason);
        // Log at debug so the bulk failure is observable but doesn't spam
        // production logs (consumers see the per-session error in the result).
        log.debug({ sessionId: ids[i], error: message, actionType: action.type }, 'broadcast: per-session dispatch failed');
        return { sessionId: ids[i], ok: false, error: message };
      });

      return results;
    },
  };
}
