import Fastify from 'fastify';
import configPlugin from './config/plugin.js';
import poolPlugin from './pool/plugin.js';
import dbPlugin from './db/plugin.js';
import authPlugin from './auth/plugin.js';
import sessionsPlugin from './sessions/plugin.js';
import explorationsPlugin from './explorations/plugin.js';
import jobPlugin from './jobs/plugin.js';
import apiPlugin from './api/plugin.js';
import staticPlugin from './api/static-plugin.js';
import websocketPlugin from './streaming/plugin.js';
import artifactPlugin from './artifacts/plugin.js';
import reportingPlugin from './reporting/plugin.js';
import lifecyclePlugin from './lifecycle/plugin.js';
import hooksPlugin from './hooks/plugin.js';
import maestroPlugin from './maestro/plugin.js';
import pipelinesPlugin from './pipelines/plugin.js';
import azurePlugin from './azure/plugin.js';
import preflightPlugin from './preflight/plugin.js';
import { githubPlugin } from './integrations/github/index.js';
import analysisPlugin from './analysis/plugin.js';
import { correlationPlugin } from './correlation/index.js';
import { busPlugin } from './bus/index.js';
import { queuePlugin } from './queue/index.js';
import { telemetryPlugin, alsMixin } from './telemetry/index.js';
import {
  fastifyZodOpenApiPlugin,
  fastifyZodOpenApiTransformers,
  validatorCompiler,
  serializerCompiler,
} from 'fastify-zod-openapi';
import fastifySwagger from '@fastify/swagger';
import { checkDependencies } from './utils/dependency-checker.js';
import { createDb } from './db/index.js';
import { DeviceState } from './types/index.js';
import * as schema from './db/schema.js';
import { randomUUID } from 'node:crypto';
import { asyncLocalStorage } from '@fastify/request-context';

const SHUTDOWN_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const SHUTDOWN_POLL_MS = 1000; // Poll every 1s for running jobs

export async function buildApp() {
  const app = Fastify({
    pluginTimeout: 300_000, // 5 minutes — per-device timeouts handle individual boots
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      transport: process.env.DEVICE_FARM_ENV === 'development' || process.env.NODE_ENV !== 'production'
        ? { target: 'pino-pretty' }
        : undefined,
      // Phase 15 Plan 06: inject correlationId / causationId / actor onto every
      // log line from the active ALS store. Works for both request-fiber stores
      // (object-shape, from `@fastify/request-context`) and queue-worker-fiber
      // stores (object-shape, restored by the queue wrapper in plan 15-05).
      mixin: alsMixin,
    },
  });

  // 1. Register config plugin (loads and validates config.yaml)
  await app.register(configPlugin);

  // 2. Check runtime dependencies (non-plugin helper — must run after config, before db)
  //    NODE_ENV=contracts (build-openapi.ts) skips this so the script runs on a dev
  //    machine without the Android/iOS toolchain installed (Phase 17 Plan 17-01).
  if (process.env.NODE_ENV !== 'contracts') {
    await checkDependencies({
      android: app.config.pool.android,
      ios: app.config.pool.ios,
    });
  }

  // 3. Register correlation plugin (ALS fiber per request, X-Correlation-Id header round-trip).
  //    Registered BEFORE db so every subsequent plugin's logs carry correlationId via alsMixin.
  await app.register(correlationPlugin);

  // 4. Create DB connection + register DB plugin (decorates fastify.db)
  const { db, client: dbClient } = createDb(app.config.database_url);
  await app.register(dbPlugin, { db });

  // 5. Register event-bus plugin (deps: ['db', 'correlation']) — persistence middleware
  //    writes envelopes to `events` via fastify.db, so db MUST be registered first.
  //    (Supersedes RESEARCH §13 draft order; see 15-06-PLAN interfaces note.)
  await app.register(busPlugin);

  // 6. Register queue plugin (deps: ['db', 'correlation']) — pg-boss v12 starts against the
  //    `pgboss` schema on app.config.database_url. onClose fires BEFORE db.onClose per
  //    Fastify's reverse-registration shutdown order (QUEUE-07 graceful drain).
  await app.register(queuePlugin);

  // 7. Register telemetry plugin (deps: ['correlation']) — decorates fastify.telemetry
  //    seam for future metrics. The alsMixin itself is wired above at Fastify() construction.
  await app.register(telemetryPlugin);

  // 7a. Wire fastify-zod-openapi type provider.
  //     Step 1: install the Zod validator + serializer compilers at the root scope so
  //     EVERY route-declaring plugin downstream (hooks, api, reporting, pipelines, ...)
  //     compiles its Zod schemas through zod-openapi (not Ajv).
  //     Step 2: register the plugin to install the onRoute config symbol used by the
  //     @fastify/swagger transformers below.
  //     Per RESEARCH §Pattern 1, placement is between telemetry (step 7) and pool
  //     (step 8) so the substrate-first invariant (plugin-order.spec.ts) is preserved.
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(fastifyZodOpenApiPlugin);

  // 7b. Register @fastify/swagger — decorates app.swagger() with the OpenAPI 3.1 document
  //     that fastify-zod-openapi transformers populate from route-level Zod schemas.
  //     SPEC-06: server/openapi.json is the single-source-of-truth for CLI + web codegen.
  await app.register(fastifySwagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'Device Farm API',
        version: '3.0.0',
        description: 'Self-hosted test execution platform for Apple Silicon Macs',
      },
      servers: [{ url: 'http://localhost:3000' }],
    },
    ...fastifyZodOpenApiTransformers,
  });

  // 8. Register pool plugin (creates PoolManager, ProcessTracker, HealthChecker, platform drivers)
  await app.register(poolPlugin);

  // 9. Register auth plugin (creates AuthService, registers bearer-auth when enabled)
  await app.register(authPlugin);

  // 10. Register WebSocket plugin (creates JobBroadcaster, DevicePreviewManager, WS routes)
  //     Must register BEFORE sessions/explorations because sessions plugin declares
  //     websocket-plugin as a hard dependency (needs @fastify/websocket loaded
  //     before sessions registers its /ws/sessions/:id upgrade route).
  await app.register(websocketPlugin);

  // 10a. Register sessions plugin (Phase 34 — lease/release REST + sessions module factory).
  //      Deps: config, db, event-bus, pool-plugin, auth, websocket-plugin.
  await app.register(sessionsPlugin);

  // 10b. Register explorations plugin (Phase 35 — POST/GET/DELETE /api/explorations).
  //      Deps: config, db, event-bus, queue, auth. Registers AFTER sessions so
  //      the explorations POST handler can opportunistically call
  //      fastify.sessionsModule.leaseDevice when present (falls back to direct
  //      pool allocation otherwise).
  await app.register(explorationsPlugin);

  // 11. Register artifact plugin (creates ArtifactService, RecordingService, ScreenshotService, MemoryService)
  await app.register(artifactPlugin);

  // 12. Register reporting plugin (WebhookService, FlakyDetector, report routes)
  await app.register(reportingPlugin);

  // 13. Register job plugin (creates JobService, wires dispatch with Phase 3 services + webhookService)
  await app.register(jobPlugin);

  // 14. Register lifecycle plugin (cron: compression+retention daily, disk pressure hourly)
  await app.register(lifecyclePlugin);

  // 15. Register hooks plugin (lifecycle hooks for devices and tests)
  await app.register(hooksPlugin);

  // 16. Register Maestro integration plugin (hierarchy, screenshots, device info, query)
  await app.register(maestroPlugin);

  // 17. Register Pipelines plugin (pipeline CRUD, run orchestration, WebSocket streaming)
  await app.register(pipelinesPlugin);

  // 17a. Register Azure PR-bot plugin (depends on pipelines-plugin, config, db)
  //      No-ops when azure_devops is absent from config.yaml.
  await app.register(azurePlugin);

  // 17b. Register GitHub PR-bot plugin (Phase 37 Plan 37-03 Track C).
  //      Same dependency set as azurePlugin — no-ops when config.github absent.
  await app.register(githubPlugin);

  // 18. Register API plugin (routes, error handler, multipart -- last so it can access all decorations)
  await app.register(apiPlugin);

  // 18a. Register Preflight plugin (Phase 37 Plan 37-02 Track B).
  //      Mounts POST /api/preflight + GET /api/preflight/:id. Registered AFTER
  //      apiPlugin so @fastify/multipart is decorated on the root instance.
  //      preflight-plugin depends on: config, db.
  await app.register(preflightPlugin);

  // 18b. Register Analysis plugin (Phase 37 Plan 37-01 Track A).
  //      Mounts POST/GET /api/builds/:id/skeleton. Registered AFTER apiPlugin
  //      so @fastify/multipart is available for `req.file()`.
  //      analysis-plugin depends on: config, db, event-bus.
  await app.register(analysisPlugin);

  // 19. Register static SPA serving (after API so API routes take priority)
  await app.register(staticPlugin);

  // 20. Startup sequence: init pool (reaps orphans internally) -> start health checker + reaper
  app.addHook('onReady', async () => {
    // Phase 17 Plan 17-01: build-openapi.ts boots with NODE_ENV=contracts to enumerate
    // routes for `app.swagger()`. Skip every heavy side-effect here — pool init, device
    // hook-firing, DB sync, health checker, process reaper — none of which are needed
    // just to produce the OpenAPI document.
    if (process.env.NODE_ENV === 'contracts') {
      app.log.info('NODE_ENV=contracts — skipping initPool / device.booted hooks / DB device sync / health checker / reaper');
      return;
    }

    // Phase 26 / Plan 26-02 / TRACE-10: stamp actor:'system' on every event
    // emitted during boot. The fresh correlationId scopes a "boot session"
    // trace tree (Phase 27 events-trace endpoint can group all boot-time
    // events by this single correlationId). The `as never` cast matches the
    // narrow `RequestContext` typing on `asyncLocalStorage` (DEFERRED-15-A).
    await asyncLocalStorage.run(
      { correlationId: randomUUID(), actor: 'system' } as never,
      async () => {
        app.log.info('Starting device farm initialization...');

        // Init pool — internally reaps orphans first, then boots devices
        await app.pool.initPool();
        app.log.info('Device pool initialized');

        // Fire device.booted hooks for all devices that came up
        if (app.hasDecorator('hookExecutor')) {
          const devices = app.pool.getDevices();
          for (const d of devices) {
            if (d.state === 'idle') {
              const serial = d.platform === 'android' && d.port != null
                ? `emulator-${d.port}`
                : d.emulatorId;
              app.hookExecutor.execute('device.booted', {
                deviceId: d.id,
                emulatorId: d.emulatorId,
                serial,
                platform: d.platform,
                port: d.port,
              }).then((results) => {
                if (results.length > 0) {
                  app.log.info({ deviceId: d.id, hookCount: results.length }, 'device.booted hooks completed');
                }
              }).catch((err: any) => {
                app.log.error({ deviceId: d.id, error: err.message }, 'device.booted hook failed');
              });
            }
          }
        }

        // Sync devices to DB (FK constraint requires devices to exist for job dispatch)
        const poolDevices = app.pool.getDevices();
        for (const d of poolDevices) {
          await db.insert(schema.devices).values({
            id: d.id,
            type: d.platform,
            name: d.name,
            status: 'idle',
            emulatorId: d.emulatorId,
            port: d.port,
          }).onConflictDoUpdate({
            target: schema.devices.id,
            set: { status: 'idle', emulatorId: d.emulatorId, port: d.port },
          });
        }
        app.log.info({ count: poolDevices.length }, 'Devices synced to database');
      },
    );
  });

  // Graceful shutdown handler (Phase 15 Plan 06 reshape; Phase 20 Plan 03 update)
  //
  // Ordering contract:
  //   1. Imperative pool-owned work that doesn't have a plugin onClose yet
  //      (wait-for-running-jobs, jobService.shutdown, pool.shutdown) runs
  //      BEFORE `app.close()`. healthChecker.stop + process reaper are now
  //      owned by the pool plugin's onClose (Phase 20 Plan 03) so they
  //      fire via module.shutdown() inside `app.close()` below.
  //   2. `await app.close()` then fires plugin onClose hooks in REVERSE
  //      registration order. Because queue (#6) registered after db (#4),
  //      queue.onClose (pg-boss graceful drain) runs BEFORE db is torn down,
  //      which pg-boss v12 requires (it issues maintenance SQL during stop).
  //   3. `dbClient.end()` runs AFTER `app.close()` because the db plugin
  //      currently has no onClose hook. TODO(Phase 20+): move the
  //      `dbClient.end()` call into `server/db/plugin.ts` so the whole chain
  //      is plugin-owned.
  //   4. `process.exit(0)` only fires after all of the above resolves.
  let isShuttingDown = false;

  const shutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    app.log.info({ signal }, 'Graceful shutdown initiated');

    // (a) Stop accepting new connections
    app.log.info('Stopping new connections...');

    // (b) Wait for running jobs up to 5 minutes
    const deadline = Date.now() + SHUTDOWN_TIMEOUT_MS;
    app.log.info('Waiting for running jobs to complete (up to 5 minutes)...');

    while (Date.now() < deadline) {
      const devices = app.pool.getDevices();
      const runningDevices = devices.filter(d => d.state === DeviceState.Running);
      if (runningDevices.length === 0) {
        app.log.info('All jobs completed');
        break;
      }
      app.log.info({ runningCount: runningDevices.length }, 'Waiting for running jobs...');
      await new Promise(resolve => setTimeout(resolve, SHUTDOWN_POLL_MS));
    }

    // (c) After timeout, cancel remaining
    const remaining = app.pool.getDevices().filter(d => d.state === DeviceState.Running);
    if (remaining.length > 0) {
      app.log.warn({ count: remaining.length }, 'Timeout exceeded, cancelling remaining jobs');
    }

    // (d) Shutdown job service (cancel running jobs, clear queues)
    await app.jobService.shutdown();
    app.log.info('Job service shutdown complete');

    // (e) Shutdown pool (kills all emulator process groups)
    await app.pool.shutdown();
    app.log.info('Pool shutdown complete');

    // (f) Close Fastify — fires plugin onClose hooks in reverse registration order.
    //     pool-plugin.onClose runs module.shutdown() (stops healthChecker + offWork's reaper worker).
    //     queue.onClose (pg-boss graceful stop, timeout=30s) fires here, BEFORE
    //     we close the db client below.
    try {
      await app.close();
      app.log.info('Server closed');
    } catch (err: any) {
      app.log.error({ error: err.message }, 'Error during app.close()');
    }

    // (g) Close DB connection.
    //     NOTE: server/db/plugin.ts currently has no onClose hook, so the
    //     db client is torn down imperatively here. Phase 20+ will migrate
    //     this into the plugin's onClose so the whole chain is plugin-owned.
    try {
      await dbClient.end();
      app.log.info('Database connection closed');
    } catch (err: any) {
      app.log.error({ error: err.message }, 'Error closing database connection');
    }

    // (j) Exit 0 — all async work has resolved.
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  return app;
}

// Start server when run directly
const isDirectRun = process.argv[1]?.endsWith('index.ts') || process.argv[1]?.endsWith('index.js');
if (isDirectRun) {
  buildApp()
    .then(async (app) => {
      const address = await app.listen({
        port: app.config.server.port,
        host: app.config.server.host,
      });
      app.log.info(`Device Farm server listening on ${address}`);
    })
    .catch((err) => {
      console.error('Failed to start server:', err);
      process.exit(1);
    });
}
