/**
 * Resolver factory + FallbackResolver integration spec — Phase 34 Plan 34-03.
 *
 * Proves:
 *   1. createResolver({logger}) honors SESSION_RESOLVER env (unset, 'maestro-ai',
 *      'claude-vision', unknown values).
 *   2. FallbackResolver tries primary first; escalates only when
 *      confidence < 0.5.
 *   3. FallbackResolver propagates errors from either side.
 *
 * Logger uses a stub pino-shaped object — no real pino needed.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { createResolver, FallbackResolver } from '../internal/resolver/index.js';
import type {
  ResolveTargetRequest,
  ResolveTargetResult,
  TargetResolver,
} from '../internal/resolver/types.js';
import { MaestroAiResolver } from '../internal/resolver/maestro-ai.js';
import { ClaudeVisionResolver } from '../internal/resolver/claude-vision.js';

function stubLogger() {
  const calls: Array<{ level: string; obj: unknown; msg: string }> = [];
  const log = {
    _calls: calls,
    info: (obj: unknown, msg?: string) =>
      calls.push({ level: 'info', obj, msg: msg ?? String(obj) }),
    warn: (obj: unknown, msg?: string) =>
      calls.push({ level: 'warn', obj, msg: msg ?? String(obj) }),
    error: (obj: unknown, msg?: string) =>
      calls.push({ level: 'error', obj, msg: msg ?? String(obj) }),
    debug: () => {},
    trace: () => {},
    fatal: () => {},
    child: () => log,
  };
  return log as unknown as Parameters<typeof createResolver>[0]['logger'] & {
    _calls: typeof calls;
  };
}

function req(overrides: Partial<ResolveTargetRequest> = {}): ResolveTargetRequest {
  return {
    target: 'Sign In',
    screenshot: Buffer.from('ABC'),
    hierarchy: '<hierarchy/>',
    platform: 'android',
    screenWidth: 1080,
    screenHeight: 1920,
    ...overrides,
  };
}

function fixedResolver(result: Partial<ResolveTargetResult>): TargetResolver {
  return {
    async resolve(): Promise<ResolveTargetResult> {
      return {
        x: 0,
        y: 0,
        confidence: 0,
        backend: 'maestro-ai',
        cached: false,
        latencyMs: 1,
        ...result,
      };
    },
  };
}

describe('createResolver factory', () => {
  const originalResolverEnv = process.env.SESSION_RESOLVER;
  const originalApiKey = process.env.ANTHROPIC_API_KEY;

  beforeEach(() => {
    if (originalResolverEnv === undefined) delete process.env.SESSION_RESOLVER;
    else process.env.SESSION_RESOLVER = originalResolverEnv;
    if (originalApiKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalApiKey;
  });

  it('returns a MaestroAiResolver when SESSION_RESOLVER is unset', () => {
    delete process.env.SESSION_RESOLVER;
    const resolver = createResolver({ logger: stubLogger() });
    expect(resolver).toBeInstanceOf(MaestroAiResolver);
  });

  it('returns a MaestroAiResolver when SESSION_RESOLVER=maestro-ai', () => {
    process.env.SESSION_RESOLVER = 'maestro-ai';
    const resolver = createResolver({ logger: stubLogger() });
    expect(resolver).toBeInstanceOf(MaestroAiResolver);
  });

  it('returns a FallbackResolver when SESSION_RESOLVER=claude-vision (with key set)', () => {
    process.env.SESSION_RESOLVER = 'claude-vision';
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    const resolver = createResolver({ logger: stubLogger() });
    expect(resolver).toBeInstanceOf(FallbackResolver);
  });

  it('falls back to MaestroAiResolver + warn when claude-vision requested but no API key', () => {
    process.env.SESSION_RESOLVER = 'claude-vision';
    delete process.env.ANTHROPIC_API_KEY;
    const logger = stubLogger();
    const resolver = createResolver({ logger });
    expect(resolver).toBeInstanceOf(MaestroAiResolver);
    const calls = (logger as unknown as { _calls: Array<{ level: string; msg: string }> })._calls;
    expect(calls.some((c) => c.level === 'warn' && /Anthropic init failed/.test(c.msg))).toBe(true);
  });

  it('returns MaestroAiResolver + warn for unknown SESSION_RESOLVER value', () => {
    process.env.SESSION_RESOLVER = 'gpt-fantasy';
    const logger = stubLogger();
    const resolver = createResolver({ logger });
    expect(resolver).toBeInstanceOf(MaestroAiResolver);
    const calls = (logger as unknown as { _calls: Array<{ level: string; msg: string }> })._calls;
    expect(calls.some((c) => c.level === 'warn')).toBe(true);
  });
});

describe('FallbackResolver', () => {
  it('returns primary result without calling secondary when confidence >= 0.5', async () => {
    const primary = fixedResolver({ confidence: 0.8, x: 100, y: 200, backend: 'maestro-ai' });
    const secondarySpy = vi.fn().mockResolvedValue({
      x: 999, y: 999, confidence: 0.99,
      backend: 'claude-vision', cached: false, latencyMs: 0,
    });
    const secondary: TargetResolver = { resolve: secondarySpy };
    const fallback = new FallbackResolver(primary, secondary, stubLogger());

    const result = await fallback.resolve(req());
    expect(result.x).toBe(100);
    expect(result.backend).toBe('maestro-ai');
    expect(secondarySpy).not.toHaveBeenCalled();
  });

  it('escalates to secondary when primary confidence < 0.5', async () => {
    const primary = fixedResolver({ confidence: 0.3, x: 0, y: 0, backend: 'maestro-ai' });
    const secondarySpy = vi.fn().mockResolvedValue({
      x: 540, y: 960, confidence: 0.95,
      backend: 'claude-vision', cached: false, latencyMs: 50,
    });
    const secondary: TargetResolver = { resolve: secondarySpy };
    const logger = stubLogger();
    const fallback = new FallbackResolver(primary, secondary, logger);

    const result = await fallback.resolve(req());
    expect(result.backend).toBe('claude-vision');
    expect(result.x).toBe(540);
    expect(secondarySpy).toHaveBeenCalledTimes(1);
    const calls = (logger as unknown as { _calls: Array<{ msg: string }> })._calls;
    expect(calls.some((c) => /escalating to secondary/.test(c.msg))).toBe(true);
  });

  it('propagates errors thrown from secondary resolver', async () => {
    const primary = fixedResolver({ confidence: 0.2 });
    const secondary: TargetResolver = {
      async resolve(): Promise<never> {
        throw new Error('Anthropic 500');
      },
    };
    const fallback = new FallbackResolver(primary, secondary, stubLogger());
    await expect(fallback.resolve(req())).rejects.toThrow('Anthropic 500');
  });

  it('propagates errors thrown from primary resolver (no secondary call)', async () => {
    const primary: TargetResolver = {
      async resolve(): Promise<never> {
        throw new Error('Maestro parse fail');
      },
    };
    const secondarySpy = vi.fn();
    const secondary: TargetResolver = { resolve: secondarySpy };
    const fallback = new FallbackResolver(primary, secondary, stubLogger());
    await expect(fallback.resolve(req())).rejects.toThrow('Maestro parse fail');
    expect(secondarySpy).not.toHaveBeenCalled();
  });
});

describe('Smoke: createResolver wires through MaestroAiResolver default for android fixture', () => {
  it('resolves Sign In on a fresh default resolver instance', async () => {
    delete process.env.SESSION_RESOLVER;
    const resolver = createResolver({ logger: stubLogger() });
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, join } = await import('node:path');
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const hierarchy = readFileSync(
      join(__dirname, '__fixtures__/android-hierarchy.xml'),
      'utf8',
    );
    const result = await resolver.resolve({
      target: 'Sign In',
      screenshot: Buffer.from([]),
      hierarchy,
      platform: 'android',
      screenWidth: 1080,
      screenHeight: 1920,
    });
    expect(result.backend).toBe('maestro-ai');
    expect(result.x).toBe(360);
    expect(result.y).toBe(860);
    expect(result.confidence).toBeGreaterThanOrEqual(0.5);
  });
});

// Reference imports to silence "unused" warnings for type-only situations.
void ClaudeVisionResolver;
