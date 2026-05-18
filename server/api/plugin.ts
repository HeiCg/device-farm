import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import { errorHandler } from './error-handler.js';
import { jobRoutes, deviceRoutes, healthRoute, configRoute } from './routes.js';
import { keyRoutes } from '../auth/index.js';
import { reportRoutes } from '../reporting/report-routes.js';
import { registerPipelinesQueueRoute } from './internal/pipelines-queue-route.js';
import { getQueueStatus } from '../pipelines/internal/queue-status.js';
import { DeviceState } from '../types/index.js';
import { registerPairingRoutes } from './pairing.js';
import { registerDevicesStreamRoutes } from './devices-stream.js';
import { isTokenAllowedPath, extractJobId } from '../auth/plugin.js';

export default fp(
  async (fastify: FastifyInstance) => {
    // Register multipart support for file uploads
    await fastify.register(multipart, {
      limits: {
        fileSize: 300_000_000, // 300MB per file (APKs can be large)
        files: 50,
        fields: 10,
      },
    });

    // Set RFC 7807 error handler for all routes
    fastify.setErrorHandler(errorHandler);

    const authEnabled = fastify.config.auth.enabled;

    // Health endpoint -- always public (outside protected scope)
    await fastify.register(healthRoute, { prefix: '/api' });

    // Protected scope -- apply bearer auth when enabled
    await fastify.register(async (scope) => {
      // Share-token onRequest hook: must run BEFORE bearer auth so that when
      // a valid ?t=<jwt> is present on an allowed viewer route, req.shareToken
      // is set and the bearer-auth hook below short-circuits to allow the
      // request through even when no Authorization header is present.
      if (fastify.reportTokenService) {
        const svc = fastify.reportTokenService;
        scope.addHook('onRequest', async (req) => {
          const pathname = req.url.split('?')[0];
          if (!isTokenAllowedPath(pathname)) return;

          const raw = (req.query as Record<string, unknown>).t;
          const t = typeof raw === 'string' ? raw : undefined;
          if (!t) return;

          const jobId = extractJobId(pathname);
          if (!jobId) return;

          const v = await svc.verify(t, jobId);
          if (v.ok) {
            req.shareToken = { jobId };
          }
          // Invalid/expired token: fall through; bearer auth will 401 if no header.
        });
      }

      if (authEnabled && scope.verifyBearerAuth) {
        // Wrap verifyBearerAuth to skip when req.shareToken is already set
        // (share-token hook ran first and validated successfully).
        const originalVerify = scope.verifyBearerAuth.bind(scope);
        scope.addHook('onRequest', async (req, reply) => {
          if (req.shareToken) return; // already authenticated via share token
          return originalVerify(req, reply);
        });
      }

      await scope.register(jobRoutes, { prefix: '/api' });
      await scope.register(deviceRoutes, { prefix: '/api' });
      await scope.register(configRoute, { prefix: '/api' });
      await scope.register(keyRoutes, { prefix: '/api' });
      await scope.register(reportRoutes, { prefix: '/api' });

      // Phase 36 / Plan 36-02 — pairing API + devices WS stream.
      // Routes attach directly to the scoped Fastify instance (no /api
      // prefix — the routes themselves declare the full path).
      await registerPairingRoutes(scope);
      await registerDevicesStreamRoutes(scope);

      // Pipeline queue status endpoint
      await registerPipelinesQueueRoute(scope, {
        getStatus: () => getQueueStatus({
          db: fastify.db,
          pool: {
            snapshot: () => {
              const devices = fastify.pool.getDevices();
              return {
                availableAndroid: devices.filter(
                  (d) => d.platform === 'android' && d.state === DeviceState.Idle,
                ).length,
                availableIos: devices.filter(
                  (d) => d.platform === 'ios' && d.state === DeviceState.Idle,
                ).length,
              };
            },
          },
          maxConcurrent: fastify.config.pipelines.max_concurrent_runs,
        }),
      });
    });

    fastify.log.info('API plugin registered');
  },
  { name: 'api', dependencies: ['config', 'db', 'pool-plugin', 'job-plugin', 'auth', 'reporting', 'maestro-plugin', 'hooks-plugin', 'lifecycle-plugin'] },
);
