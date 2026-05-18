/**
 * Auth module — Fastify plugin (thin wirer + bearer-auth ALS-stamping callback).
 *
 * Phase 26 Plan 26-03 / TRACE-10 entry point #4: HTTP authenticated request.
 * The bearer-auth callback runs in the same fiber as the route handler
 * (Fastify onRequest hook), so writing to asyncLocalStorage here is visible
 * to all downstream emit calls inside the route handler.
 *
 * Mirrors Phase 24/25 plugin.ts thin-wirer template with auth-specific
 * substitutions. The module factory (createAuthModule) owns construction;
 * this plugin only wires Fastify decorators + bearer-auth + onClose.
 *
 * Phase 38 (Task 3.3): Share-token middleware added. When sharing.enabled,
 * a ReportTokenService is instantiated and decorated onto the Fastify instance.
 * A preHandler hook intercepts ?t=<jwt> on allowed viewer routes and marks the
 * request as share-token-authenticated so the bearer-auth check is skipped.
 */
import fp from 'fastify-plugin';
import bearerAuth from '@fastify/bearer-auth';
import { asyncLocalStorage } from '@fastify/request-context';

import { createAuthModule, type AuthModule } from './internal/module.js';
import type { AuthService, MatchedApiKey } from './internal/auth-service.js';
import { asApiKeyActor } from './internal/actor.js';
import {
  createReportTokenService,
  type ReportTokenService,
  isTokenAllowedPath,
  extractJobId,
} from './report-token.js';

// Re-export helpers so api/plugin.ts can import from a single auth source.
export { isTokenAllowedPath, extractJobId };

declare module 'fastify' {
  interface FastifyInstance {
    authModule: AuthModule;
    authService: AuthService;
    reportTokenService?: ReportTokenService;
  }
  interface FastifyRequest {
    apiKey?: MatchedApiKey;
    shareToken?: { jobId: string };
  }
}

export default fp(
  async (fastify) => {
    const authModule = createAuthModule({
      db: fastify.db,
      logger: fastify.log,
    });

    if (!fastify.hasDecorator('authService')) {
      fastify.decorate('authService', authModule.authService);
    }
    if (!fastify.hasDecorator('authModule')) {
      fastify.decorate('authModule', authModule);
    }

    const authEnabled = fastify.config.auth.enabled;

    // -----------------------------------------------------------------------
    // Share-token setup (Task 3.3)
    // -----------------------------------------------------------------------
    let reportTokenService: ReportTokenService | undefined;
    if (fastify.config.sharing?.enabled) {
      reportTokenService = createReportTokenService({
        secret: fastify.config.security.share_token_secret!,
      });
      if (!fastify.hasDecorator('reportTokenService')) {
        fastify.decorate('reportTokenService', reportTokenService);
      }
      fastify.log.info('Share-token service registered');
    }

    // -----------------------------------------------------------------------
    // Bearer-auth (existing, unchanged)
    // -----------------------------------------------------------------------
    if (authEnabled) {
      // bearer-auth v10 callback signature: (key, req) => Promise<boolean>.
      // On match we (a) decorate THIS request (Pitfall 1 — NOT decorateRequest
      // globally) with the matched apiKey row + (b) stamp ALS with the apikey
      // actor literal so downstream emits inherit it (TRACE-10 entry #4).
      await fastify.register(bearerAuth, {
        keys: new Set<string>(), // unused — custom auth fn handles validation
        addHook: false,
        auth: async (key, req) => {
          // Share-token already validated — bypass bearer check entirely.
          if ((req as { shareToken?: unknown }).shareToken) return true;

          const matched = await authModule.authService.validateKeyAndReturnRow(key);
          if (!matched) return false;

          (req as { apiKey?: MatchedApiKey }).apiKey = matched;

          const store = asyncLocalStorage.getStore();
          if (store) {
            if (store instanceof Map) {
              store.set('actor', asApiKeyActor(matched.id));
            } else if (typeof store === 'object') {
              (store as unknown as Record<string, unknown>).actor =
                asApiKeyActor(matched.id);
            }
          }
          return true;
        },
        errorResponse: (err: Error) => ({
          error: err.message || 'Unauthorized',
        }),
        contentType: 'application/problem+json',
      });
    }

    // Note: the share-token onRequest hook is registered in api/plugin.ts
    // (inside the protected scope) so it runs BEFORE the bearer-auth
    // onRequest hook and can set req.shareToken to bypass bearer-auth.

    // Phase 27+ may add cross-module subscribers (e.g., OIDC); no-op for now.
    await authModule.registerWorkersAndSubscribers();

    fastify.addHook('onClose', async () => {
      await authModule.shutdown();
    });

    fastify.log.info({ authEnabled }, 'Auth plugin registered');
  },
  { name: 'auth', dependencies: ['config', 'db', 'event-bus'] },
);
