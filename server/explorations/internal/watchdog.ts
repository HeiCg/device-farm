/**
 * Explorations watchdog (Phase 35 Plan 35-02 / T-35.3).
 *
 * Wall-clock budget enforcement + external cancel signal for a single run.
 *
 *   - Constructor schedules a setTimeout for `budgetSeconds` wall-clock.
 *   - `tripBudget()` records a budget-cap trip from outside (tap/screen counters).
 *   - `cancel()` records an external cancel.
 *   - `shouldStop()` returns true after any of the above.
 *   - `exitReason()` returns the recorded reason (or 'complete' when none).
 *   - `dispose()` clears the timer (safe to call multiple times / after timer fires).
 *
 * The agent runner polls `shouldStop()` between async-iterator yields and
 * calls `q.return()` to break the SDK loop when true.
 */
export type WatchdogExitReason = 'complete' | 'budget' | 'time' | 'cancelled';

export interface WatchdogOptions {
  runId: string;
  budgetSeconds: number;
  onTrigger: (reason: WatchdogExitReason) => void;
}

export class Watchdog {
  private timer: NodeJS.Timeout | null = null;
  private exit: WatchdogExitReason | null = null;
  private readonly runId: string;
  private readonly budgetSeconds: number;
  private readonly onTrigger: (reason: WatchdogExitReason) => void;

  constructor(opts: WatchdogOptions) {
    if (!Number.isFinite(opts.budgetSeconds) || opts.budgetSeconds <= 0) {
      throw new Error(`Watchdog budgetSeconds must be > 0 (got ${opts.budgetSeconds})`);
    }
    this.runId = opts.runId;
    this.budgetSeconds = opts.budgetSeconds;
    this.onTrigger = opts.onTrigger;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.exit !== null) return;
      this.exit = 'time';
      this.onTrigger('time');
    }, this.budgetSeconds * 1000);
  }

  /** Has any stop condition been recorded? */
  shouldStop(): boolean {
    return this.exit !== null;
  }

  /** Reason recorded so far ('complete' if none). */
  exitReason(): WatchdogExitReason {
    return this.exit ?? 'complete';
  }

  /** Record a budget-cap trip (taps / screens). No-op if already stopped. */
  tripBudget(): void {
    if (this.exit !== null) return;
    this.exit = 'budget';
    this.onTrigger('budget');
  }

  /** Record an external cancel (DELETE /api/explorations/:id). No-op if already stopped. */
  cancel(): void {
    if (this.exit !== null) return;
    this.exit = 'cancelled';
    this.onTrigger('cancelled');
  }

  /** Clear the timer. Safe to call multiple times / after the timer fires. */
  dispose(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /** Test helper — read the runId without exposing the constructor option. */
  get id(): string {
    return this.runId;
  }
}
