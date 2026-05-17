/**
 * Explorations similarity detection (Phase 35 Plan 35-02 / T-35.3).
 *
 * Inline pHash + grayscale RMSE crossover for screen-equivalence detection.
 *
 *   1. `computePhash(buf)` — sharp-phash 64-char binary string.
 *   2. `hammingDistance(a, b)` — sharp-phash/distance over the binary strings.
 *   3. `grayscaleRmse(a, b)` — sharp resize to 64×64 grayscale + per-pixel
 *      RMSE (0..1).
 *   4. `isSameScreen(newShot, candidates, loadArtifact)` — filter candidates
 *      by Hamming < PHASH_THRESHOLD, then verify with RMSE < RMSE_THRESHOLD.
 *
 * Thresholds are conservative defaults from the brief; phase-close gated
 * suite (DEVICE_FARM_E2E) may retune.
 */
import sharp from 'sharp';
// `sharp-phash` ships CommonJS — types live at index.d.ts / distance.d.ts.
// NodeNext resolution requires the .js extension on the /distance subpath
// (no `exports` field in sharp-phash's package.json). The default-export
// callable-shape doesn't survive TS NodeNext resolution cleanly; treat the
// import as a callable via local interop type.
import sharpPhashImport from 'sharp-phash';
import sharpPhashDistanceImport from 'sharp-phash/distance.js';

const sharpPhash = sharpPhashImport as unknown as (buf: Buffer) => Promise<string>;
const sharpPhashDistance = sharpPhashDistanceImport as unknown as (a: string, b: string) => number;

/** Maximum Hamming distance considered "perceptually identical" (brief §T-35.3). */
export const PHASH_THRESHOLD = 8;

/** Maximum grayscale-RMSE considered "pixel-identical at 64×64" (brief §T-35.3). */
export const RMSE_THRESHOLD = 0.02;

/**
 * Perceptual hash of a screenshot. Returns the 64-char "0"/"1" string emitted
 * by sharp-phash. Persisted as `varchar(64)` per Plan 35-00 schema decision.
 */
export async function computePhash(buf: Buffer): Promise<{ phash: string }> {
  const phash = await sharpPhash(buf);
  return { phash };
}

/** Hamming distance between two 64-char pHash strings. Delegates to sharp-phash/distance. */
export function hammingDistance(a: string, b: string): number {
  return sharpPhashDistance(a, b);
}

/**
 * Per-pixel grayscale RMSE between two screenshots after resizing to 64×64.
 * Returns a value in [0..1].
 *
 * Uses `fit: 'fill'` so each image is forced to exactly 64×64 (no padding /
 * cropping), guaranteeing both pixel buffers are the same length.
 */
export async function grayscaleRmse(bufA: Buffer, bufB: Buffer): Promise<number> {
  const [pixA, pixB] = await Promise.all([
    sharp(bufA).resize(64, 64, { fit: 'fill' }).grayscale().raw().toBuffer(),
    sharp(bufB).resize(64, 64, { fit: 'fill' }).grayscale().raw().toBuffer(),
  ]);
  const n = Math.min(pixA.length, pixB.length);
  let sumSq = 0;
  for (let i = 0; i < n; i++) {
    const d = (pixA[i]! - pixB[i]!) / 255;
    sumSq += d * d;
  }
  return Math.sqrt(sumSq / n);
}

export interface SimilarityCandidate {
  screenId: string;
  phash: string;
  screenshotArtifactId: string;
}

/**
 * pHash + RMSE crossover lookup.
 *
 *   1. Compute the new screenshot's pHash.
 *   2. Filter candidates whose persisted pHash is within Hamming < PHASH_THRESHOLD.
 *      If none match, short-circuit and return null (loader never called).
 *   3. For each close candidate, load its screenshot buffer via `loadArtifact`,
 *      compute grayscale RMSE, return the first one with RMSE < RMSE_THRESHOLD.
 *
 * Returns null when no candidate clears both thresholds.
 */
export async function isSameScreen(
  newShot: Buffer,
  candidates: SimilarityCandidate[],
  loadArtifact: (id: string) => Promise<Buffer>,
): Promise<{ screenId: string; rmse: number } | null> {
  const { phash } = await computePhash(newShot);
  const close = candidates.filter((c) => hammingDistance(phash, c.phash) < PHASH_THRESHOLD);
  if (close.length === 0) return null;
  for (const c of close) {
    const candidateBuf = await loadArtifact(c.screenshotArtifactId);
    const rmse = await grayscaleRmse(newShot, candidateBuf);
    if (rmse < RMSE_THRESHOLD) {
      return { screenId: c.screenId, rmse };
    }
  }
  return null;
}
