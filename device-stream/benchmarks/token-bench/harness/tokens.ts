/**
 * Token counting for the benchmark.
 *
 * Primary counter: Anthropic `POST /v1/messages/count_tokens` (model
 * claude-sonnet-5) when `ANTHROPIC_API_KEY` is set — the authoritative number.
 * Fallback: `js-tiktoken` with the `o200k_base` encoding, which is NOT Claude's
 * tokenizer and only approximates it; every table built on the fallback carries
 * a printed disclaimer (see `counterDisclaimer`).
 *
 * `countText` is async because the Anthropic path is a network call. The tiktoken
 * path is synchronous under the hood but presented through the same interface so
 * callers don't branch on which counter is active.
 */
import { Tiktoken } from 'js-tiktoken/lite';
import o200k_base from 'js-tiktoken/ranks/o200k_base';

export type CounterKind = 'anthropic-count_tokens' | 'js-tiktoken/o200k_base';

export interface TokenCounter {
  readonly kind: CounterKind;
  /** Model name that produced the count (for the Anthropic path). */
  readonly model?: string;
  /** True when this is the approximate fallback, not Claude's own tokenizer. */
  readonly isApproximate: boolean;
  countText(text: string): Promise<number>;
}

const FALLBACK_MODEL = 'claude-sonnet-5';

/** One-line disclaimer to print in any report/table built on the fallback counter. */
export function counterDisclaimer(counter: TokenCounter): string | null {
  if (!counter.isApproximate) return null;
  return (
    'Token counts produced by js-tiktoken (o200k_base), an APPROXIMATION — not ' +
    "Claude's tokenizer. Set ANTHROPIC_API_KEY to recount via the Anthropic " +
    'count_tokens API (claude-sonnet-5) for authoritative numbers.'
  );
}

class TiktokenCounter implements TokenCounter {
  readonly kind = 'js-tiktoken/o200k_base' as const;
  readonly isApproximate = true;
  private enc = new Tiktoken(o200k_base);
  async countText(text: string): Promise<number> {
    if (text.length === 0) return 0;
    return this.enc.encode(text).length;
  }
}

class AnthropicCounter implements TokenCounter {
  readonly kind = 'anthropic-count_tokens' as const;
  readonly isApproximate = false;
  readonly model = FALLBACK_MODEL;
  constructor(
    private apiKey: string,
    private model2 = FALLBACK_MODEL,
  ) {}
  async countText(text: string): Promise<number> {
    if (text.length === 0) return 0;
    const res = await fetch('https://api.anthropic.com/v1/messages/count_tokens', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.model2,
        messages: [{ role: 'user', content: text }],
      }),
    });
    if (!res.ok) {
      throw new Error(`count_tokens failed: ${res.status} ${await res.text()}`);
    }
    const json = (await res.json()) as { input_tokens: number };
    return json.input_tokens;
  }
}

/**
 * Pick the counter from the environment: Anthropic when a key is present,
 * tiktoken otherwise. `env` is injectable so tests pin the fallback.
 */
export function resolveCounter(env: NodeJS.ProcessEnv = process.env): TokenCounter {
  const key = env.ANTHROPIC_API_KEY;
  if (key && key.trim().length > 0) return new AnthropicCounter(key.trim());
  return new TiktokenCounter();
}

/** Deterministic fallback counter, for tests and offline dry-runs. */
export function tiktokenCounter(): TokenCounter {
  return new TiktokenCounter();
}
