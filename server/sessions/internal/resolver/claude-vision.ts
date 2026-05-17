/**
 * ClaudeVisionResolver — Anthropic Messages API call with LRU cache.
 *
 * Phase 34 Plan 34-03 — opt-in resolver (SESSION_RESOLVER=claude-vision).
 * Slow + paid but handles cases the deterministic MaestroAiResolver misses
 * (icons-only screens, dynamic content, free-form descriptions).
 *
 * Flow:
 *   1. Compute cache key: `sha256(screenshot) + ':' + target`. Cache hit?
 *      Return cached result with `cached:true` + refreshed `latencyMs`.
 *   2. Call client.messages.create({model, messages:[image+text]}).
 *      Model reads from `process.env.SESSION_RESOLVER_MODEL` (default
 *      `claude-sonnet-4-5` per Open Question #7).
 *   3. Parse the single text block as JSON, expecting
 *      `{x, y, confidence}` with x/y NORMALIZED to [0,1] (center of element).
 *   4. Denormalize to pixel coords using `req.screenWidth × x` and
 *      `req.screenHeight × y`. Cache the result.
 *
 * Cache:
 *   - Module-level singleton (NOT per-instance) so re-creating the resolver
 *     across plugin re-registrations doesn't lose the cache.
 *   - LRU 100 entries, 5-minute TTL.
 *
 * Test injection:
 *   - The constructor accepts `{anthropicClient}` so vitest can swap in a
 *     `vi.fn()` mock without touching the real SDK. When unset, the
 *     constructor instantiates a real `Anthropic({apiKey})` — and throws if
 *     no key is available.
 */
import Anthropic from '@anthropic-ai/sdk';
import { LRUCache } from 'lru-cache';
import { createHash } from 'node:crypto';

import type {
  ResolveTargetRequest,
  ResolveTargetResult,
  TargetResolver,
} from './types.js';
import { ResolverError } from './types.js';

const DEFAULT_MODEL = 'claude-sonnet-4-5';
const CACHE_MAX_ENTRIES = 100;
const CACHE_TTL_MS = 5 * 60 * 1000;

// Module-level singleton — survives plugin re-decoration during a server
// process lifetime. Plan 34-07 runbook documents that a server restart clears
// the cache (and is required for env-var changes).
const cache = new LRUCache<string, ResolveTargetResult>({
  max: CACHE_MAX_ENTRIES,
  ttl: CACHE_TTL_MS,
});

// Minimal client shape the resolver actually consumes — lets us narrow the
// generic Anthropic type to just the surface area we touch + makes mock
// injection in tests straightforward (no need to construct a full SDK shell).
export interface AnthropicMessagesClient {
  messages: {
    create(params: unknown): Promise<{
      content: Array<{ type: string; text?: string } & Record<string, unknown>>;
    }>;
  };
}

export interface ClaudeVisionResolverDeps {
  /** Override or supply when ANTHROPIC_API_KEY isn't set in env. */
  apiKey?: string;
  /** Override the model id (env wins by default — explicit deps trump env). */
  model?: string;
  /** Inject a mocked client for unit tests; production code omits this. */
  anthropicClient?: AnthropicMessagesClient;
}

export class ClaudeVisionResolver implements TargetResolver {
  private readonly client: AnthropicMessagesClient;
  private readonly model: string;

  constructor(deps: ClaudeVisionResolverDeps = {}) {
    if (deps.anthropicClient) {
      this.client = deps.anthropicClient;
    } else {
      const apiKey = deps.apiKey ?? process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        throw new Error(
          'ClaudeVisionResolver: ANTHROPIC_API_KEY not set (and no anthropicClient injected)',
        );
      }
      // Real SDK construction — narrowed to our minimal client surface.
      this.client = new Anthropic({ apiKey }) as unknown as AnthropicMessagesClient;
    }
    this.model = deps.model ?? process.env.SESSION_RESOLVER_MODEL ?? DEFAULT_MODEL;
  }

  async resolve(req: ResolveTargetRequest): Promise<ResolveTargetResult> {
    const t0 = Date.now();
    const sha = createHash('sha256').update(req.screenshot).digest('hex');
    const key = `${sha}:${req.target}`;
    const hit = cache.get(key);
    if (hit) {
      return { ...hit, cached: true, latencyMs: Date.now() - t0 };
    }

    const prompt = buildPrompt(req);
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 256,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/png',
              data: req.screenshot.toString('base64'),
            },
          },
          { type: 'text', text: prompt },
        ],
      }],
    });

    const textBlock = response.content.find((c) => c.type === 'text');
    if (!textBlock || typeof textBlock.text !== 'string') {
      throw new ResolverError('Anthropic returned no text block', { confidence: 0 });
    }

    let parsed: { x: number | null; y: number | null; confidence: number };
    try {
      parsed = JSON.parse(textBlock.text);
    } catch {
      throw new ResolverError(`malformed JSON from model: ${textBlock.text}`, {
        confidence: 0,
      });
    }

    const result: ResolveTargetResult = {
      x: parsed.x == null ? 0 : Math.floor(parsed.x * req.screenWidth),
      y: parsed.y == null ? 0 : Math.floor(parsed.y * req.screenHeight),
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0,
      backend: 'claude-vision',
      cached: false,
      latencyMs: Date.now() - t0,
    };
    cache.set(key, result);
    return result;
  }
}

function buildPrompt(req: ResolveTargetRequest): string {
  return [
    `You are a UI element locator for a ${req.platform} device.`,
    `Given a mobile screenshot (${req.screenWidth}x${req.screenHeight}px, origin top-left)`,
    `and a target description, return ONLY JSON:`,
    `{"x": <0-1 normalized>, "y": <0-1 normalized>, "confidence": <0-1>}`,
    `Coordinates are the CENTER of the element. If not found, return`,
    `{"x": null, "y": null, "confidence": 0}.`,
    ``,
    `Hierarchy hint (use to disambiguate when image is ambiguous):`,
    req.hierarchy.slice(0, 4000),
    ``,
    `Target: ${req.target}`,
  ].join('\n');
}

// Test-only helpers for cache introspection — keep the cache encapsulated
// in production code but expose it for vitest assertions.
export function _claudeVisionCacheForTests(): {
  size: number;
  clear(): void;
  has(key: string): boolean;
} {
  return {
    get size() { return cache.size; },
    clear() { cache.clear(); },
    has(key: string) { return cache.has(key); },
  };
}
