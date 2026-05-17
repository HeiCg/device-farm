/**
 * Sliding-window rate limiter — Phase 34 Plan 34-04.
 *
 * Replaces the always-true stub from Plan 34-02 (`rateLimitOk` in ws.ts).
 *
 * Design (verbatim from RESEARCH §Rate limit):
 *   - Per-session timestamp array `Map<sessionId, number[]>`.
 *   - `check(sessionId, now)`:
 *     1. Prune entries older than `windowMs`.
 *     2. If length >= `max` → return false (deny).
 *     3. Otherwise push `now` + return true (allow).
 *   - `clear(sessionId)`: drop entry (called from sweeper + WS close).
 *
 * Defaults are 30 actions / 10 seconds per session (CONTEXT.md LOCKED).
 * Conservative — agents that hit it should batch via Maestro flows rather
 * than tight per-tap loops. The WS handler returns `{type:'error',
 * code:'rate_limited'}` on overflow and does NOT close the socket (agents
 * back off instead of reconnecting).
 *
 * Memory profile: each `number[]` peaks at `max` entries; long-lived map
 * entries are cleared by the sweeper on session expiry (RESEARCH Open Q #6
 * mitigation).
 */

export interface RateLimiter {
  /** Returns true when the action is allowed; false when over the limit. */
  check(sessionId: string, now: number): boolean;
  /** Drops the per-session timestamp array. Called on session close / expiry. */
  clear(sessionId: string): void;
  /** Returns the number of tracked sessions (telemetry / shutdown logging). */
  size(): number;
}

export interface CreateRateLimiterOptions {
  /** Sliding-window width in milliseconds. Default: 10_000 (10 seconds). */
  windowMs?: number;
  /** Max actions permitted within the window. Default: 30. */
  max?: number;
}

export function createRateLimiter(opts: CreateRateLimiterOptions = {}): RateLimiter {
  const windowMs = opts.windowMs ?? 10_000;
  const max = opts.max ?? 30;
  const windows = new Map<string, number[]>();

  return {
    check(sessionId: string, now: number): boolean {
      let win = windows.get(sessionId);
      if (!win) {
        win = [];
        windows.set(sessionId, win);
      }
      const cutoff = now - windowMs;
      // Prune expired entries — O(n) per call but n <= max so bounded.
      while (win.length > 0 && win[0] < cutoff) win.shift();
      if (win.length >= max) return false;
      win.push(now);
      return true;
    },

    clear(sessionId: string): void {
      windows.delete(sessionId);
    },

    size(): number {
      return windows.size;
    },
  };
}
