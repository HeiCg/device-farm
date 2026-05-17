/**
 * MaestroAiResolver XML heuristic spec — Phase 34 Plan 34-03.
 *
 * Loads the `android-hierarchy.xml` fixture (shipped by Plan 34-00 substrate)
 * and proves the deterministic resolver:
 *   - Resolves visible buttons to their bounds centroid
 *   - Matches via text=, content-desc=, resource-id= attributes
 *   - Is case-insensitive (token tokenization lowercases)
 *   - Returns low-confidence (0.3) for unknown targets
 *   - Penalizes non-clickable nodes
 *   - Reports latency and backend correctly
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { MaestroAiResolver } from '../internal/resolver/maestro-ai.js';
import type { ResolveTargetRequest } from '../internal/resolver/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('MaestroAiResolver — Android XML heuristic', () => {
  let hierarchy: string;
  const resolver = new MaestroAiResolver();

  beforeAll(() => {
    hierarchy = readFileSync(
      join(__dirname, '__fixtures__/android-hierarchy.xml'),
      'utf8',
    );
  });

  function req(target: string, overrides: Partial<ResolveTargetRequest> = {}): ResolveTargetRequest {
    return {
      target,
      screenshot: Buffer.from([]),
      hierarchy,
      platform: 'android',
      screenWidth: 1080,
      screenHeight: 1920,
      ...overrides,
    };
  }

  it('resolves `Sign In` → centroid of bounds [120,800][600,920] = (360, 860) with confidence >= 0.5', async () => {
    const result = await resolver.resolve(req('Sign In'));
    // Stopword 'In' is filtered out — only 'sign' remains as a token.
    // 'sign' matches text='Sign In' and resource-id='com.example.app:id/sign_in_btn'
    // → 2 token hits → score 2, plus 0.5 button boost → 2.5
    expect(result.x).toBe(360);
    expect(result.y).toBe(860);
    expect(result.confidence).toBeGreaterThanOrEqual(0.5);
    expect(result.backend).toBe('maestro-ai');
    expect(result.cached).toBe(false);
  });

  it('is case-insensitive — `sign in` resolves to the same coordinates as `Sign In`', async () => {
    const lower = await resolver.resolve(req('sign in'));
    const mixed = await resolver.resolve(req('SIGN IN'));
    expect(lower.x).toBe(360);
    expect(lower.y).toBe(860);
    expect(mixed.x).toBe(360);
    expect(mixed.y).toBe(860);
  });

  it('resolves `Settings` via content-desc → centroid of [800,100][1000,200] = (900, 150)', async () => {
    const result = await resolver.resolve(req('Settings'));
    expect(result.x).toBe(900);
    expect(result.y).toBe(150);
    expect(result.confidence).toBeGreaterThanOrEqual(0.5);
    expect(result.backend).toBe('maestro-ai');
  });

  it('returns low-confidence (0.3) for unknown targets', async () => {
    const result = await resolver.resolve(req('nonexistent widget xyz'));
    expect(result.confidence).toBe(0.3);
    expect(result.x).toBe(0);
    expect(result.y).toBe(0);
    expect(result.backend).toBe('maestro-ai');
  });

  it('returns confidence 0 for empty target (all stopwords)', async () => {
    const result = await resolver.resolve(req(''));
    expect(result.confidence).toBe(0);
  });

  it('does NOT pick the non-clickable Example App TextView for `Example`', async () => {
    // The toolbar title 'Example App' has clickable=false — the penalty (-2)
    // should drop its score below threshold so we return low-confidence
    // (not centroid 420, 150).
    const result = await resolver.resolve(req('Example'));
    // Only one node mentions 'example' (the title TextView), and it has
    // clickable=false → score 1 - 2 = -1 → no candidate above threshold.
    expect(result.confidence).toBe(0.3);
  });

  it('latencyMs is populated and finishes under 100ms for fixture XML', async () => {
    const result = await resolver.resolve(req('Sign In'));
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.latencyMs).toBeLessThan(100);
  });

  it('backend is always `maestro-ai` regardless of confidence', async () => {
    const high = await resolver.resolve(req('Sign In'));
    const low = await resolver.resolve(req('zzz nothing'));
    expect(high.backend).toBe('maestro-ai');
    expect(low.backend).toBe('maestro-ai');
  });

  it('resolves `Forgot` (forgot-password TextView, clickable=true) to centroid', async () => {
    // Forgot password? at [120,960][600,1020] → (360, 990), clickable=true
    const result = await resolver.resolve(req('Forgot'));
    expect(result.x).toBe(360);
    expect(result.y).toBe(990);
    expect(result.confidence).toBeGreaterThanOrEqual(0.5);
  });

  it('resolves `Search` bottom-nav TextView', async () => {
    // Search at [360,1700][720,1920] → (540, 1810), clickable=true
    const result = await resolver.resolve(req('Search'));
    expect(result.x).toBe(540);
    expect(result.y).toBe(1810);
  });
});

describe('MaestroAiResolver — iOS JSON heuristic', () => {
  const resolver = new MaestroAiResolver();

  const iosHierarchy = JSON.stringify({
    type: 'Application',
    children: [
      {
        type: 'Button',
        label: 'Sign In',
        identifier: 'sign-in-button',
        frame: { x: 100, y: 400, width: 200, height: 50 },
      },
      {
        type: 'TextField',
        label: 'Email',
        identifier: 'email-field',
        frame: { x: 50, y: 200, width: 300, height: 40 },
      },
    ],
  });

  function req(target: string): ResolveTargetRequest {
    return {
      target,
      screenshot: Buffer.from([]),
      hierarchy: iosHierarchy,
      platform: 'ios',
      screenWidth: 390,
      screenHeight: 844,
    };
  }

  it('resolves Sign In on iOS — centroid (200, 425) from frame {x:100, y:400, w:200, h:50}', async () => {
    const result = await resolver.resolve(req('Sign In'));
    expect(result.x).toBe(200);
    expect(result.y).toBe(425);
    expect(result.confidence).toBeGreaterThanOrEqual(0.5);
    expect(result.backend).toBe('maestro-ai');
  });

  it('returns low-confidence for malformed iOS JSON', async () => {
    const result = await resolver.resolve({
      target: 'anything',
      screenshot: Buffer.from([]),
      hierarchy: 'not-json-{',
      platform: 'ios',
      screenWidth: 390,
      screenHeight: 844,
    });
    expect(result.confidence).toBe(0.3);
  });
});
