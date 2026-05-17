/**
 * Phase 35 Plan 35-02 — similarity (pHash + grayscale RMSE crossover) spec.
 *
 * Uses the 3 PNG fixtures shipped in Plan 35-00:
 *   - screenshot-home.png      — anchor.
 *   - screenshot-home-dup.png  — perceptually identical to home (Hamming = 0).
 *   - screenshot-shop.png      — visually distinct (Hamming >> 8).
 */
import { describe, it, expect, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  computePhash,
  hammingDistance,
  grayscaleRmse,
  isSameScreen,
  PHASH_THRESHOLD,
  RMSE_THRESHOLD,
  type SimilarityCandidate,
} from '../internal/similarity.js';

const FIXTURE_DIR = resolve(
  process.cwd(),
  'server/explorations/__tests__/__fixtures__',
);

async function loadFixture(name: string): Promise<Buffer> {
  return readFile(resolve(FIXTURE_DIR, name));
}

describe('explorations/similarity', () => {
  describe('computePhash', () => {
    it('returns a 64-char binary string', async () => {
      const buf = await loadFixture('screenshot-home.png');
      const { phash } = await computePhash(buf);
      expect(phash).toMatch(/^[01]{64}$/);
    });

    it('is deterministic for identical input', async () => {
      const buf = await loadFixture('screenshot-home.png');
      const a = await computePhash(buf);
      const b = await computePhash(buf);
      expect(a.phash).toBe(b.phash);
    });
  });

  describe('hammingDistance', () => {
    it('returns 0 for identical pHashes', async () => {
      const buf = await loadFixture('screenshot-home.png');
      const { phash } = await computePhash(buf);
      expect(hammingDistance(phash, phash)).toBe(0);
    });

    it('returns < PHASH_THRESHOLD for the home/home-dup fixture pair', async () => {
      const [a, b] = await Promise.all([
        loadFixture('screenshot-home.png'),
        loadFixture('screenshot-home-dup.png'),
      ]);
      const phA = (await computePhash(a)).phash;
      const phB = (await computePhash(b)).phash;
      expect(hammingDistance(phA, phB)).toBeLessThan(PHASH_THRESHOLD);
    });

    it('returns >= PHASH_THRESHOLD for the home/shop visually-distinct pair', async () => {
      const [a, b] = await Promise.all([
        loadFixture('screenshot-home.png'),
        loadFixture('screenshot-shop.png'),
      ]);
      const phA = (await computePhash(a)).phash;
      const phB = (await computePhash(b)).phash;
      expect(hammingDistance(phA, phB)).toBeGreaterThanOrEqual(PHASH_THRESHOLD);
    });
  });

  describe('grayscaleRmse', () => {
    it('returns 0 for identical buffers', async () => {
      const buf = await loadFixture('screenshot-home.png');
      expect(await grayscaleRmse(buf, buf)).toBe(0);
    });

    it('returns < RMSE_THRESHOLD for home/home-dup', async () => {
      const [a, b] = await Promise.all([
        loadFixture('screenshot-home.png'),
        loadFixture('screenshot-home-dup.png'),
      ]);
      expect(await grayscaleRmse(a, b)).toBeLessThan(RMSE_THRESHOLD);
    });

    it('returns > RMSE_THRESHOLD for home/shop', async () => {
      const [a, b] = await Promise.all([
        loadFixture('screenshot-home.png'),
        loadFixture('screenshot-shop.png'),
      ]);
      expect(await grayscaleRmse(a, b)).toBeGreaterThan(RMSE_THRESHOLD);
    });
  });

  describe('isSameScreen', () => {
    it('matches a candidate when both pHash and RMSE pass thresholds', async () => {
      const newShot = await loadFixture('screenshot-home-dup.png');
      const homeBuf = await loadFixture('screenshot-home.png');
      const phHome = (await computePhash(homeBuf)).phash;
      const candidates: SimilarityCandidate[] = [
        { screenId: 'home', phash: phHome, screenshotArtifactId: 'art-home' },
      ];
      const loadArtifact = vi.fn(async (_id: string) => homeBuf);
      const result = await isSameScreen(newShot, candidates, loadArtifact);
      expect(result).not.toBeNull();
      expect(result!.screenId).toBe('home');
      expect(result!.rmse).toBeLessThan(RMSE_THRESHOLD);
    });

    it('returns null when the new shot is visually distinct from all candidates', async () => {
      const newShot = await loadFixture('screenshot-shop.png');
      const homeBuf = await loadFixture('screenshot-home.png');
      const phHome = (await computePhash(homeBuf)).phash;
      const candidates: SimilarityCandidate[] = [
        { screenId: 'home', phash: phHome, screenshotArtifactId: 'art-home' },
      ];
      const loadArtifact = vi.fn(async (_id: string) => homeBuf);
      const result = await isSameScreen(newShot, candidates, loadArtifact);
      // Hamming distance between shop & home is >> 8 so the candidate is
      // filtered out before RMSE — loader should not be called.
      expect(result).toBeNull();
      expect(loadArtifact).not.toHaveBeenCalled();
    });

    it('short-circuits with no candidates (loader never called)', async () => {
      const newShot = await loadFixture('screenshot-home.png');
      const loadArtifact = vi.fn(async (_id: string) => Buffer.alloc(0));
      const result = await isSameScreen(newShot, [], loadArtifact);
      expect(result).toBeNull();
      expect(loadArtifact).not.toHaveBeenCalled();
    });

    it('skips a candidate when pHash is close but RMSE crosses threshold', async () => {
      // Fabricate a candidate whose persisted pHash equals home's pHash, but
      // whose stored "screenshot" is actually the shop image (so RMSE fails).
      const homeBuf = await loadFixture('screenshot-home.png');
      const shopBuf = await loadFixture('screenshot-shop.png');
      const phHome = (await computePhash(homeBuf)).phash;
      const candidates: SimilarityCandidate[] = [
        { screenId: 'fake-home', phash: phHome, screenshotArtifactId: 'art-fake' },
      ];
      const loadArtifact = vi.fn(async (_id: string) => shopBuf);
      const result = await isSameScreen(homeBuf, candidates, loadArtifact);
      // pHash close (0), but RMSE between home & shop > 0.02 → no match.
      expect(result).toBeNull();
      expect(loadArtifact).toHaveBeenCalledTimes(1);
    });
  });

  describe('thresholds', () => {
    it('PHASH_THRESHOLD is 8', () => {
      expect(PHASH_THRESHOLD).toBe(8);
    });
    it('RMSE_THRESHOLD is 0.02', () => {
      expect(RMSE_THRESHOLD).toBeCloseTo(0.02);
    });
  });
});
