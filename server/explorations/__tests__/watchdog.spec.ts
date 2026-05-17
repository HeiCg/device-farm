/**
 * Phase 35 Plan 35-02 — watchdog (wall-clock + cancel + budget) spec.
 *
 * Uses vi.useFakeTimers() to fast-forward without burning real wall-clock.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { Watchdog } from '../internal/watchdog.js';

describe('explorations/watchdog', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('constructor schedules a setTimeout for budgetSeconds wall-clock', () => {
    const onTrigger = vi.fn();
    const w = new Watchdog({ runId: 'r1', budgetSeconds: 30, onTrigger });
    expect(w.shouldStop()).toBe(false);
    expect(w.exitReason()).toBe('complete');
    // Just before the cap — no trigger.
    vi.advanceTimersByTime(29_999);
    expect(onTrigger).not.toHaveBeenCalled();
    // Cross the cap.
    vi.advanceTimersByTime(2);
    expect(onTrigger).toHaveBeenCalledWith('time');
    expect(w.shouldStop()).toBe(true);
    expect(w.exitReason()).toBe('time');
    w.dispose();
  });

  it('cancel() short-circuits — subsequent timer fire is a no-op', () => {
    const onTrigger = vi.fn();
    const w = new Watchdog({ runId: 'r2', budgetSeconds: 60, onTrigger });
    w.cancel();
    expect(onTrigger).toHaveBeenCalledWith('cancelled');
    expect(w.exitReason()).toBe('cancelled');
    // Advance past the timer — should NOT fire onTrigger('time').
    vi.advanceTimersByTime(120_000);
    expect(onTrigger).toHaveBeenCalledTimes(1);
    w.dispose();
  });

  it('tripBudget() fires once + makes exitReason() return budget', () => {
    const onTrigger = vi.fn();
    const w = new Watchdog({ runId: 'r3', budgetSeconds: 60, onTrigger });
    w.tripBudget();
    expect(onTrigger).toHaveBeenCalledWith('budget');
    expect(w.exitReason()).toBe('budget');
    // Calling tripBudget again is a no-op.
    w.tripBudget();
    expect(onTrigger).toHaveBeenCalledTimes(1);
    w.dispose();
  });

  it('dispose() clears the timer (no trigger fires after dispose)', () => {
    const onTrigger = vi.fn();
    const w = new Watchdog({ runId: 'r4', budgetSeconds: 5, onTrigger });
    w.dispose();
    vi.advanceTimersByTime(10_000);
    expect(onTrigger).not.toHaveBeenCalled();
  });

  it('dispose() is safe to call multiple times', () => {
    const onTrigger = vi.fn();
    const w = new Watchdog({ runId: 'r5', budgetSeconds: 5, onTrigger });
    w.dispose();
    expect(() => w.dispose()).not.toThrow();
    expect(() => w.dispose()).not.toThrow();
  });

  it('dispose() after natural fire is a no-op (timer already cleared)', () => {
    const onTrigger = vi.fn();
    const w = new Watchdog({ runId: 'r6', budgetSeconds: 1, onTrigger });
    vi.advanceTimersByTime(1_500);
    expect(onTrigger).toHaveBeenCalledWith('time');
    expect(() => w.dispose()).not.toThrow();
  });

  it('rejects invalid budgetSeconds', () => {
    const onTrigger = vi.fn();
    expect(
      () => new Watchdog({ runId: 'x', budgetSeconds: 0, onTrigger }),
    ).toThrow();
    expect(
      () => new Watchdog({ runId: 'x', budgetSeconds: -5, onTrigger }),
    ).toThrow();
    expect(
      () =>
        new Watchdog({
          runId: 'x',
          budgetSeconds: Number.NaN,
          onTrigger,
        }),
    ).toThrow();
  });

  it('after tripBudget, the natural timer cannot overwrite the exit reason', () => {
    const onTrigger = vi.fn();
    const w = new Watchdog({ runId: 'r7', budgetSeconds: 5, onTrigger });
    w.tripBudget();
    vi.advanceTimersByTime(10_000); // natural timer fires — but exit already set
    expect(w.exitReason()).toBe('budget');
    // onTrigger may be called for 'time' or not — implementation no-ops the
    // second trigger. Either way exitReason stays at 'budget'.
    w.dispose();
  });

  it('exposes runId via .id getter', () => {
    const onTrigger = vi.fn();
    const w = new Watchdog({ runId: 'run-xyz', budgetSeconds: 30, onTrigger });
    expect(w.id).toBe('run-xyz');
    w.dispose();
  });
});
