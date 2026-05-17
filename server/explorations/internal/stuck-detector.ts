/**
 * Explorations stuck detector (Phase 35 Plan 35-02 / T-35.3).
 *
 * Sliding-window pHash detector — fires on the Nth consecutive same-screen
 * observation. Default window size 3 per brief.
 *
 * Wired by `agent-tools.ts explore_save_screen`: every save call observes
 * the new screenshot's pHash; when the window of recent pHashes all sit
 * within Hamming < PHASH_THRESHOLD of the anchor, the tool returns
 * `{isDuplicate:true, stuckCount:N}` AND the server emits
 * `exploration.stuck`. The agent prompt instructs the model to back out
 * on stuckCount >= window.
 */
import { hammingDistance, PHASH_THRESHOLD } from './similarity.js';

export interface StuckObservation {
  /** True when the sliding window is full AND every member is within Hamming threshold of the anchor. */
  stuck: boolean;
  /** Human-readable reason — set only when stuck=true. */
  reason?: string;
  /** Current window length (capped at the configured size). */
  consecutive: number;
}

/**
 * Maintains a sliding window of recent pHashes for a single exploration run.
 * Each call to observe() pushes a pHash (shifts off the oldest when full) and
 * reports whether the window is fully "close" (Hamming < PHASH_THRESHOLD of
 * the anchor at index 0).
 */
export class StuckDetector {
  private window: string[] = [];
  private readonly size: number;

  constructor(size = 3) {
    if (!Number.isInteger(size) || size < 2) {
      throw new Error(`StuckDetector window size must be an integer >= 2 (got ${size})`);
    }
    this.size = size;
  }

  /** Push a new pHash observation. Returns the current stuck status. */
  observe(phash: string): StuckObservation {
    this.window.push(phash);
    if (this.window.length > this.size) this.window.shift();
    if (this.window.length < this.size) {
      return { stuck: false, consecutive: this.window.length };
    }
    const anchor = this.window[0]!;
    const allClose = this.window.every((p) => hammingDistance(p, anchor) < PHASH_THRESHOLD);
    if (allClose) {
      return {
        stuck: true,
        reason: `${this.size} consecutive taps without screen change`,
        consecutive: this.window.length,
      };
    }
    return { stuck: false, consecutive: this.window.length };
  }

  /** Clear the window — used after a successful back-out + navigation. */
  reset(): void {
    this.window = [];
  }

  /** Exposed for tests / observability. */
  get currentSize(): number {
    return this.window.length;
  }
}
