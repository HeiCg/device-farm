/**
 * Pure derived-metric functions for the benchmark. No IO, no clock, no token
 * counting — they operate on already-counted `CallRecord`s so they are fully
 * deterministic and unit-tested against fixtures.
 *
 * Transcript model
 * ----------------
 * Each tool round-trip appends `added_i = requestTokens_i + resultTokens_i` to
 * the transcript (the assistant's tool_use args + the tool_result). A turn is one
 * round-trip. With T turns and a per-configuration `fixed` prefix:
 *
 *   billedCached   = fixed + Σ_i added_i            (prompt caching: prefix billed once)
 *   billedUncached = Σ_{t=1..T} (fixed + Σ_{i≤t} added_i)   (no caching: re-send each turn)
 *
 * `billedUncached` is the quadratic upper bound; `billedCached` is the lower
 * bound the RFC quotes as primary (it favors the tool-per-call servers).
 */
import type { CallRecord, ConfigMetrics } from './types.js';

/** Added transcript tokens for one call: request args + result. */
export function callAdded(c: CallRecord): number {
  return c.requestTokens + c.resultTokens;
}

/**
 * Fold the flat call list into per-logical-step added tokens. Auto-capture calls
 * (auto-screenshot/auto-describe) fold into the step of the agent call that
 * triggered them, since that is the transcript growth that step actually caused.
 */
export function perStepAdded(calls: CallRecord[], stepCount: number): number[] {
  const perStep = new Array<number>(stepCount).fill(0);
  for (const c of calls) {
    const idx = c.step - 1;
    if (idx < 0 || idx >= stepCount) {
      throw new RangeError(`call.step ${c.step} out of range 1..${stepCount}`);
    }
    perStep[idx] += callAdded(c);
  }
  return perStep;
}

/** Σ of per-step added tokens = total tokens the flow appends to the transcript. */
export function flowAdded(perStep: number[]): number {
  return perStep.reduce((a, b) => a + b, 0);
}

/** fixed + Σ added — the perfect-prompt-caching bound. */
export function billedCached(fixed: number, added: number[]): number {
  return fixed + added.reduce((a, b) => a + b, 0);
}

/**
 * Σ_{t=1..T} (fixed + Σ_{i≤t} added_i) — the no-caching quadratic transcript cost.
 * `added` is the per-round-trip (per-turn) added tokens, in call order.
 */
export function billedUncached(fixed: number, added: number[]): number {
  let running = 0;
  let total = 0;
  for (const a of added) {
    running += a;
    total += fixed + running;
  }
  return total;
}

/**
 * Compute the full metric set for one configuration.
 *
 * `stepCount` groups added tokens for the `perStep[]` view; `added` for the
 * billing curves is per-round-trip (one entry per call, in order) so the
 * quadratic model reflects the true number of turns, not the number of logical
 * steps.
 */
export function computeMetrics(
  configId: string,
  fixed: number,
  calls: CallRecord[],
  stepCount: number,
): ConfigMetrics {
  const perStep = perStepAdded(calls, stepCount);
  const perCall = calls.map(callAdded);
  return {
    configId,
    fixed,
    perStep,
    flowAdded: flowAdded(perStep),
    billedCached: billedCached(fixed, perCall),
    billedUncached: billedUncached(fixed, perCall),
    roundTrips: calls.length,
  };
}
