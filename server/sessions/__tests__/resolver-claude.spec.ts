/**
 * ClaudeVisionResolver mocked Anthropic spec — Phase 34 Plan 34-03.
 *
 * Uses a vi.fn() mock injected via the resolver's `anthropicClient` dep
 * (no `vi.mock` of the SDK — direct injection keeps the test focused).
 * Verifies:
 *   - Coordinate denormalization (model returns [0,1] → resolver returns pixels)
 *   - LRU cache hit on identical (sha256(screenshot) + target)
 *   - Cache key sensitivity (different screenshot bytes → different entries)
 *   - Cache key sensitivity (different target → different entries)
 *   - Confidence <0.5 is returned unchanged (FallbackResolver decides escalation)
 *   - Malformed JSON throws ResolverError
 *   - {x:null, y:null} model response → confidence 0
 *   - Model env override (SESSION_RESOLVER_MODEL)
 *   - Live test gated on ANTHROPIC_API_KEY (CI default skip)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  ClaudeVisionResolver,
  _claudeVisionCacheForTests,
  type AnthropicMessagesClient,
} from '../internal/resolver/claude-vision.js';
import { ResolverError } from '../internal/resolver/types.js';
import type { ResolveTargetRequest } from '../internal/resolver/types.js';

function makeMockClient(
  responseText: string,
): AnthropicMessagesClient & { _create: ReturnType<typeof vi.fn> } {
  const create = vi.fn().mockResolvedValue({
    content: [{ type: 'text', text: responseText }],
  });
  return {
    _create: create,
    messages: { create },
  };
}

function req(overrides: Partial<ResolveTargetRequest> = {}): ResolveTargetRequest {
  return {
    target: 'Sign In',
    screenshot: Buffer.from('fake-png-bytes-1'),
    hierarchy: '<hierarchy/>',
    platform: 'android',
    screenWidth: 1080,
    screenHeight: 1920,
    ...overrides,
  };
}

describe('ClaudeVisionResolver — mocked Anthropic SDK', () => {
  beforeEach(() => {
    // Clear module-level LRU cache between tests so they're independent.
    _claudeVisionCacheForTests().clear();
  });

  it('denormalizes (0.5, 0.5) model response to (540, 960) on 1080x1920 screen', async () => {
    const client = makeMockClient('{"x":0.5,"y":0.5,"confidence":0.9}');
    const resolver = new ClaudeVisionResolver({ anthropicClient: client });
    const result = await resolver.resolve(req());
    expect(result.x).toBe(540);
    expect(result.y).toBe(960);
    expect(result.confidence).toBe(0.9);
    expect(result.backend).toBe('claude-vision');
    expect(result.cached).toBe(false);
    expect(client._create).toHaveBeenCalledTimes(1);
  });

  it('returns cache hit on identical (screenshot, target) — SDK called once', async () => {
    const client = makeMockClient('{"x":0.25,"y":0.75,"confidence":0.8}');
    const resolver = new ClaudeVisionResolver({ anthropicClient: client });

    const first = await resolver.resolve(req());
    const second = await resolver.resolve(req());

    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(second.x).toBe(first.x);
    expect(second.y).toBe(first.y);
    expect(second.confidence).toBe(first.confidence);
    expect(client._create).toHaveBeenCalledTimes(1);
  });

  it('different screenshot bytes → different cache entry (SDK called twice)', async () => {
    const client = makeMockClient('{"x":0.5,"y":0.5,"confidence":0.7}');
    const resolver = new ClaudeVisionResolver({ anthropicClient: client });

    await resolver.resolve(req({ screenshot: Buffer.from('AAAA') }));
    await resolver.resolve(req({ screenshot: Buffer.from('BBBB') }));

    expect(client._create).toHaveBeenCalledTimes(2);
  });

  it('different target → different cache entry (SDK called twice)', async () => {
    const client = makeMockClient('{"x":0.5,"y":0.5,"confidence":0.7}');
    const resolver = new ClaudeVisionResolver({ anthropicClient: client });

    await resolver.resolve(req({ target: 'Sign In' }));
    await resolver.resolve(req({ target: 'Sign Up' }));

    expect(client._create).toHaveBeenCalledTimes(2);
  });

  it('returns low-confidence result unchanged (FallbackResolver owns escalation logic)', async () => {
    const client = makeMockClient('{"x":0.1,"y":0.1,"confidence":0.3}');
    const resolver = new ClaudeVisionResolver({ anthropicClient: client });
    const result = await resolver.resolve(req());
    expect(result.confidence).toBe(0.3);
    expect(result.x).toBe(108);
    expect(result.y).toBe(192);
  });

  it('throws ResolverError on malformed JSON', async () => {
    const client = makeMockClient('not json at all!!');
    const resolver = new ClaudeVisionResolver({ anthropicClient: client });
    await expect(resolver.resolve(req())).rejects.toThrow(ResolverError);
  });

  it('returns confidence 0 when model says {x:null, y:null, confidence:0}', async () => {
    const client = makeMockClient('{"x":null,"y":null,"confidence":0}');
    const resolver = new ClaudeVisionResolver({ anthropicClient: client });
    const result = await resolver.resolve(req());
    expect(result.confidence).toBe(0);
    expect(result.x).toBe(0);
    expect(result.y).toBe(0);
    expect(result.backend).toBe('claude-vision');
  });

  it('reads model from explicit deps (overrides env)', async () => {
    const client = makeMockClient('{"x":0.5,"y":0.5,"confidence":0.9}');
    const resolver = new ClaudeVisionResolver({
      anthropicClient: client,
      model: 'claude-opus-4-7',
    });
    await resolver.resolve(req());
    const callArgs = client._create.mock.calls[0][0] as { model: string };
    expect(callArgs.model).toBe('claude-opus-4-7');
  });

  it('reads model from SESSION_RESOLVER_MODEL env when no explicit dep', async () => {
    const original = process.env.SESSION_RESOLVER_MODEL;
    process.env.SESSION_RESOLVER_MODEL = 'env-model-id';
    try {
      const client = makeMockClient('{"x":0.5,"y":0.5,"confidence":0.9}');
      const resolver = new ClaudeVisionResolver({ anthropicClient: client });
      await resolver.resolve(req());
      const callArgs = client._create.mock.calls[0][0] as { model: string };
      expect(callArgs.model).toBe('env-model-id');
    } finally {
      if (original === undefined) delete process.env.SESSION_RESOLVER_MODEL;
      else process.env.SESSION_RESOLVER_MODEL = original;
    }
  });

  it('throws on construction when no apiKey and no anthropicClient injected', () => {
    const original = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      expect(() => new ClaudeVisionResolver()).toThrow(/ANTHROPIC_API_KEY not set/);
    } finally {
      if (original !== undefined) process.env.ANTHROPIC_API_KEY = original;
    }
  });

  it('builds prompt with image + text content blocks (image block has base64 data)', async () => {
    const client = makeMockClient('{"x":0.5,"y":0.5,"confidence":0.9}');
    const resolver = new ClaudeVisionResolver({ anthropicClient: client });
    await resolver.resolve(req({ screenshot: Buffer.from('PNGDATA') }));
    const callArgs = client._create.mock.calls[0][0] as {
      messages: Array<{ content: Array<{ type: string; source?: { data: string } }> }>;
    };
    const blocks = callArgs.messages[0].content;
    const imageBlock = blocks.find((b) => b.type === 'image');
    const textBlock = blocks.find((b) => b.type === 'text');
    expect(imageBlock).toBeDefined();
    expect(imageBlock?.source?.data).toBe(Buffer.from('PNGDATA').toString('base64'));
    expect(textBlock).toBeDefined();
  });
});

// Live test gated on env var — skipped in CI by default, matches the
// DB-gated pattern used elsewhere in the codebase. Run locally with:
//   ANTHROPIC_API_KEY=sk-ant-... npx vitest run server/sessions/__tests__/resolver-claude.spec.ts
const liveDescribe = process.env.ANTHROPIC_API_KEY ? describe : describe.skip;
liveDescribe('ClaudeVisionResolver — LIVE (gated on ANTHROPIC_API_KEY)', () => {
  it('round-trips a real Anthropic call without throwing', async () => {
    const resolver = new ClaudeVisionResolver();
    // 1x1 transparent PNG (smallest possible) — model will return null coords
    // but the call shape itself must succeed.
    const tinyPng = Buffer.from(
      '89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C4890000000A49444154789C6300010000000500010D0A2DB40000000049454E44AE426082',
      'hex',
    );
    const result = await resolver.resolve({
      target: 'a Sign In button',
      screenshot: tinyPng,
      hierarchy: '<hierarchy/>',
      platform: 'android',
      screenWidth: 1080,
      screenHeight: 1920,
    });
    expect(result.backend).toBe('claude-vision');
    expect(typeof result.confidence).toBe('number');
  }, 30_000);
});
