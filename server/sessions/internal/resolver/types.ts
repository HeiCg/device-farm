/**
 * NL target resolver type surface — Phase 34 Plan 34-03.
 *
 * The `TargetResolver` interface is the seam plugged into the WS dispatch
 * path via `fastify.sessionsResolver`. Plan 34-02 ships a STUB_RESOLVER that
 * throws on invocation; this file replaces the stub-side types and adds the
 * concrete resolver implementations (`MaestroAiResolver`, `ClaudeVisionResolver`)
 * in sibling files.
 *
 * Field semantics:
 *   - `screenshot`: raw PNG bytes (NOT base64). ClaudeVisionResolver encodes
 *     to base64 internally when calling the Anthropic Messages API.
 *   - `hierarchy`: Android uiautomator XML dump (string) OR iOS hierarchy JSON
 *     (string). The MaestroAiResolver branches on `platform` to parse accordingly.
 *   - `screenWidth`/`screenHeight`: device-reported screen dimensions used by
 *     ClaudeVisionResolver to denormalize the model's [0,1]-normalized response
 *     back to pixel coordinates.
 *
 * Confidence semantics:
 *   - `>= 0.5`: dispatch path accepts and recurses into a synthetic tap.
 *   - `< 0.5`: WS handler maps to `{type:'error', code:'resolver_failed'}`
 *     (the FallbackResolver in `index.ts` may escalate to ClaudeVision first
 *     before letting the low-confidence value bubble out).
 *
 * Backend semantics:
 *   - `'maestro-ai'`: deterministic XML/JSON heuristic — fast, free, offline.
 *   - `'claude-vision'`: Anthropic Messages API call — slow, paid, requires
 *     network + ANTHROPIC_API_KEY env var.
 */

export interface ResolveTargetRequest {
  target: string;
  screenshot: Buffer;
  hierarchy: string;
  platform: 'android' | 'ios';
  screenWidth: number;
  screenHeight: number;
}

export interface ResolveTargetResult {
  x: number;
  y: number;
  confidence: number;
  backend: 'maestro-ai' | 'claude-vision';
  cached: boolean;
  latencyMs: number;
}

export interface TargetResolver {
  resolve(req: ResolveTargetRequest): Promise<ResolveTargetResult>;
}

/**
 * Thrown by resolvers on unrecoverable failure (malformed model JSON, missing
 * API key at runtime, etc.). The WS handler maps this to `{type:'error',
 * code:'resolver_failed'}` already (see ws.ts) — same surface as the
 * actions.ts `ResolverError` so callers don't need to discriminate.
 *
 * Note: this is a SECOND `ResolverError` class living next to the one in
 * `actions.ts`. They're functionally identical; the WS handler `instanceof`
 * check covers the actions.ts variant. Plan 34-04+ may consolidate, but for
 * now we re-throw with the actions.ts variant when bubbling up to dispatch
 * (see FallbackResolver in `index.ts`).
 */
export class ResolverError extends Error {
  readonly result: Partial<ResolveTargetResult>;
  constructor(message: string, result: Partial<ResolveTargetResult> = {}) {
    super(message);
    this.name = 'ResolverError';
    this.result = result;
  }
}
