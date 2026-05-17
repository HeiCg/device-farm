/**
 * WebhookService — single-attempt HTTP webhook delivery.
 *
 * Phase 19 (Plan 19-02) refactor: the old `deliver(url, payload)` in-process
 * retry loop is DELETED. pg-boss now owns retry policy via the
 * `webhook.deliver` queue (`retryLimit:5`, `retryBackoff:true`) plus the
 * `webhook.deliver.dlq` dead-letter queue (plan 19-03). This class only
 * exposes `deliverOnce` — a single attempt that throws on 5xx or network
 * error so the pg-boss worker can count the attempt; resolves on 2xx
 * (success) or 4xx (non-retryable per RESEARCH §Pitfall 7 — retrying a
 * malformed request doesn't help).
 */
import { createHmac } from 'node:crypto';
import type pino from 'pino';

export interface WebhookConfig {
  secret?: string;
  timeout_ms?: number;
  /**
   * @deprecated Phase 19 — pg-boss queue owns retries.
   *   `webhook.deliver` queue ships with `retryLimit:5 + retryBackoff:true`.
   *   This field is accepted by the constructor for back-compat with
   *   existing config loading but is NOT read by any method.
   *   Remove in Phase 27+ when config schema is canonicalised.
   */
  max_retries?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;

export class WebhookService {
  private readonly logger: pino.Logger;
  private readonly secret?: string;
  private readonly timeoutMs: number;
  /**
   * @deprecated Phase 19 — pg-boss queue owns retries. Kept for constructor
   * back-compat only; no method reads it.
   */
  private readonly maxRetries: number;

  constructor(logger: pino.Logger, config?: WebhookConfig) {
    this.logger = logger.child({ component: 'webhook-service' });
    this.secret = config?.secret;
    this.timeoutMs = config?.timeout_ms ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = config?.max_retries ?? 0; // stored, never read
  }

  /**
   * Single-attempt HTTP POST. Throws on 5xx or network error so pg-boss's
   * worker can count the attempt + retry; resolves on 2xx (success) or 4xx
   * (non-retryable client error — retrying won't help).
   *
   * Retries are OWNED by the `webhook.deliver` pg-boss queue (plan 19-03).
   * This method never loops. Errors are RE-THROWN RAW — pg-boss serialises
   * to `job.output` and the DLQ worker extracts the message for the terminal
   * `webhook.failed.retryExhausted` event payload.
   *
   * @see RESEARCH §Pattern 1 + §Pitfall 6 (raw re-throw) + §Pitfall 7 (4xx non-retry)
   */
  async deliverOnce(url: string, payload: object): Promise<void> {
    const body = JSON.stringify(payload);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.secret) {
      const signature = createHmac('sha256', this.secret).update(body).digest('hex');
      headers['X-Signature-256'] = `sha256=${signature}`;
    }

    const resp = await fetch(url, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (resp.ok) {
      this.logger.info({ url, status: resp.status }, 'Webhook delivered');
      return;
    }

    if (resp.status >= 400 && resp.status < 500) {
      // Non-retryable per RESEARCH §Pitfall 7 — a 4xx means "your request is
      // wrong"; retrying doesn't help. Log + resolve so pg-boss marks success
      // (we treat 4xx as "final state reached, not a transient error").
      this.logger.warn(
        { url, status: resp.status },
        'Webhook rejected with client error (4xx) — not retryable',
      );
      return;
    }

    // 5xx → throw raw. pg-boss counts the attempt; retries OR routes to DLQ
    // after retryLimit exhaustion. The `HTTP ${status}` substring is part of
    // the contract — tests assert on it, and the DLQ terminal event payload
    // surfaces it via `lastError`.
    throw new Error(`Webhook delivery failed: HTTP ${resp.status}`);
  }
}
