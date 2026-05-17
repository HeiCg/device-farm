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
 */
import fp from 'fastify-plugin';
import bearerAuth from '@fastify/bearer-auth';
import { asyncLocalStorage } from '@fastify/request-context';

import { createAuthModule, type AuthModule } from './internal/module.js';
import type { AuthService, MatchedApiKey } from './internal/auth-service.js';
import { asApiKeyActor } from './internal/actor.js';

declare module 'fastify' {
  interface FastifyInstance {
    authModule: AuthModule;
    authService: AuthService;
  }
  interface FastifyRequest {
    apiKey?: MatchedApiKey;
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

    if (authEnabled) {
      // bearer-auth v10 callback signature: (key, req) => Promise<boolean>.
      // On match we (a) decorate THIS request (Pitfall 1 — NOT decorateRequest
      // globally) with the matched apiKey row + (b) stamp ALS with the apikey
      // actor literal so downstream emits inherit it (TRACE-10 entry #4).
      await fastify.register(bearerAuth, {
        keys: new Set<string>(), // unused — custom auth fn handles validation
        addHook: false,
        auth: async (key, req) => {
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

    // Phase 27+ may add cross-module subscribers (e.g., OIDC); no-op for now.
    await authModule.registerWorkersAndSubscribers();

    fastify.addHook('onClose', async () => {
      await authModule.shutdown();
    });

    fastify.log.info({ authEnabled }, 'Auth plugin registered');
  },
  { name: 'auth', dependencies: ['config', 'db', 'event-bus'] },
);
