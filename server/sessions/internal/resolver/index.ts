/**
 * Resolver factory + FallbackResolver — Phase 34 Plan 34-03.
 *
 * Reads `process.env.SESSION_RESOLVER` once at construction time:
 *   - unset OR `'maestro-ai'`: pure MaestroAiResolver (default).
 *   - `'claude-vision'`: FallbackResolver wrapping Maestro AI as primary +
 *     ClaudeVision as secondary. Maestro fires first; if `confidence < 0.5`
 *     the wrapper escalates to ClaudeVision. This keeps the cheap
 *     deterministic heuristic in front of every request.
 *
 * Why a factory (not module-level singleton):
 *   The plugin needs a fastify.log to log escalation events. Each plugin
 *   onReady call constructs a fresh resolver bound to that logger. The
 *   ClaudeVisionResolver's LRU cache is module-level so it survives
 *   across factory invocations (no behavioral difference, no allocation
 *   thrash).
 *
 * Runtime env-change semantics:
 *   Changing SESSION_RESOLVER requires a server restart — documented in
 *   the Plan 34-07 runbook. The factory reads the env exactly once, when
 *   the plugin boots.
 *
 * Error fallback:
 *   If `SESSION_RESOLVER=claude-vision` but `ANTHROPIC_API_KEY` is unset,
 *   the ClaudeVisionResolver constructor throws. The factory catches that
 *   and downgrades to pure MaestroAiResolver with a `warn` log — keeps
 *   the WS handler functional rather than hard-failing the plugin boot.
 */
import type pino from 'pino';

import { MaestroAiResolver } from './maestro-ai.js';
import { ClaudeVisionResolver } from './claude-vision.js';
import type {
  ResolveTargetRequest,
  ResolveTargetResult,
  TargetResolver,
} from './types.js';

export interface CreateResolverDeps {
  logger: pino.Logger;
}

/**
 * Chains a primary resolver (cheap) + a secondary resolver (expensive,
 * fallback). Escalates to secondary only when primary returns
 * `confidence < 0.5`. Throws from either are propagated.
 */
export class FallbackResolver implements TargetResolver {
  constructor(
    private readonly primary: TargetResolver,
    private readonly secondary: TargetResolver,
    private readonly logger: pino.Logger,
  ) {}

  async resolve(req: ResolveTargetRequest): Promise<ResolveTargetResult> {
    const first = await this.primary.resolve(req);
    if (first.confidence >= 0.5) return first;
    this.logger.info(
      {
        target: req.target,
        firstConfidence: first.confidence,
        firstBackend: first.backend,
      },
      'resolver: escalating to secondary',
    );
    return this.secondary.resolve(req);
  }
}

export function createResolver(deps: CreateResolverDeps): TargetResolver {
  const flavor = process.env.SESSION_RESOLVER ?? 'maestro-ai';
  const log = deps.logger.child({ module: 'sessions.resolver' });

  if (flavor === 'claude-vision') {
    try {
      const primary = new MaestroAiResolver();
      const secondary = new ClaudeVisionResolver();
      log.info(
        { flavor },
        'resolver: chained Maestro AI (primary) + Claude Vision (secondary)',
      );
      return new FallbackResolver(primary, secondary, log);
    } catch (err) {
      log.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'resolver: SESSION_RESOLVER=claude-vision but Anthropic init failed; falling back to maestro-ai only',
      );
      return new MaestroAiResolver();
    }
  }

  if (flavor !== 'maestro-ai') {
    log.warn(
      { flavor },
      `resolver: unknown SESSION_RESOLVER value '${flavor}'; using maestro-ai default`,
    );
  } else {
    log.info({ flavor }, 'resolver: using deterministic Maestro AI heuristic');
  }
  return new MaestroAiResolver();
}

// Public re-exports — callers in the WS dispatch path only need these names.
export type { TargetResolver, ResolveTargetRequest, ResolveTargetResult } from './types.js';
export { ResolverError } from './types.js';
export { MaestroAiResolver } from './maestro-ai.js';
export { ClaudeVisionResolver } from './claude-vision.js';
