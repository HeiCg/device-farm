/**
 * Phase 16 / Plan 16-02 — Hooks plugin (thin Fastify wrapper).
 *
 * Responsibilities:
 *   1. Load hook definitions from config (validated via hookDefinitionSchema.safeParse).
 *   2. Call createHooksModule({db, fastify, logger, hooks}) to build the module.
 *   3. Decorate:
 *        - fastify.hookExecutor — the HookExecutor class instance (back-compat surface
 *          consumed by server/index.ts onReady imperative device.booted loop).
 *        - fastify.hooksModule — the full HooksModule (the new barrel-friendly surface).
 *   4. Call module.registerBusSubscribers() to start the pg-boss worker + bus bridge.
 *   5. Register all existing HTTP routes (GET/POST/PUT/DELETE /api/hooks + POST /api/hooks/:name/test).
 *   6. Wire onClose → module.shutdown() (idempotent).
 *
 * Dependencies (pinned per RESEARCH §8):
 *   - config (for fastify.config.hooks)
 *   - event-bus (hooks module's onPersisted subscriber depends on the global bus plugin)
 *   - queue (hooks module enqueues hook.run jobs through fastify.queue)
 *   - pool-plugin (POST /api/hooks/:name/test reads fastify.pool.getDevice)
 */
import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type pino from 'pino';
import type { FastifyZodOpenApiTypeProvider, FastifyZodOpenApiSchema } from 'fastify-zod-openapi';

import { HookExecutor } from './hook-executor.js';
import { hookDefinitionSchema, hookSchema, hookConflictSchema } from './schemas.js';
import type { HookDefinition, HookEvent } from './schemas.js';
import { createHooksModule, type HooksModule } from './internal/module.js';

// Re-export for consumers that still import from plugin.ts (transitional).
export { hookDefinitionSchema };
export type { HookDefinition, HookEvent };

declare module 'fastify' {
  interface FastifyInstance {
    hookExecutor: HookExecutor;
    hooksModule: HooksModule;
  }
}

async function hooksPlugin(fastify: FastifyInstance): Promise<void> {
  // 1. Parse hooks from config (preserves existing behaviour from old plugin).
  const config = fastify.config as unknown as { hooks?: unknown[] };
  const parsedHooks: HookDefinition[] = Array.isArray(config.hooks)
    ? config.hooks
        .map((h) => hookDefinitionSchema.safeParse(h))
        .filter((r): r is { success: true; data: HookDefinition } => r.success)
        .map((r) => r.data)
    : [];

  // 2. Construct the module (factory owns HookExecutor + TypedBus + worker + subscribers).
  const module = createHooksModule({
    fastify,
    db: fastify.db,
    logger: fastify.log as unknown as pino.Logger,
    hooks: parsedHooks,
  });

  // 3. Decorate BOTH the legacy single-class surface AND the full module surface.
  fastify.decorate('hookExecutor', module.executor);
  fastify.decorate('hooksModule', module);

  // 4. Start worker + bus subscribers.
  await module.registerBusSubscribers();
  fastify.log.info({ count: parsedHooks.length }, 'Hooks module registered');

  // 5. HTTP routes (unchanged from old plugin — still operate on the same HookExecutor).
  const executor = module.executor;

  fastify.get('/api/hooks', async () => executor.getHooks());

  /**
   * Phase 17 Plan 17-01 — POST /api/hooks upgraded to withTypeProvider
   * (Zod request + response schemas via fastify-zod-openapi).
   * See RESEARCH §Pattern 2 for before/after diff of this exact route.
   */
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().route({
    method: 'POST',
    url: '/api/hooks',
    schema: {
      body: hookDefinitionSchema,
      response: {
        201: hookSchema,
        409: hookConflictSchema,
      },
    } satisfies FastifyZodOpenApiSchema,
    handler: async (request, reply) => {
      const existing = executor.getHooks().find(h => h.name === request.body.name);
      if (existing) {
        return reply.code(409).send({
          type: 'https://device-farm/errors/conflict',
          title: 'Hook name already exists',
          status: 409 as const,
          detail: `A hook named "${request.body.name}" already exists`,
        });
      }
      executor.addHook(request.body as HookDefinition);
      return reply.code(201).send(request.body);
    },
  });

  fastify.put<{ Params: { name: string } }>(
    '/api/hooks/:name',
    async (request: FastifyRequest<{ Params: { name: string } }>, reply: FastifyReply) => {
      const { name } = request.params;
      const parsed = hookDefinitionSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          type: 'https://device-farm/errors/validation',
          title: 'Validation Error',
          status: 400,
          detail: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '),
        });
      }
      const removed = executor.removeHook(name);
      if (!removed) {
        return reply.code(404).send({
          type: 'https://device-farm/errors/not-found',
          title: 'Hook not found',
          status: 404,
          detail: `No hook named "${name}" found`,
        });
      }
      executor.addHook(parsed.data as HookDefinition);
      return parsed.data;
    },
  );

  fastify.delete<{ Params: { name: string } }>(
    '/api/hooks/:name',
    async (request: FastifyRequest<{ Params: { name: string } }>, reply: FastifyReply) => {
      const { name } = request.params;
      const removed = executor.removeHook(name);
      if (!removed) {
        return reply.code(404).send({
          type: 'https://device-farm/errors/not-found',
          title: 'Hook not found',
          status: 404,
          detail: `No hook named "${name}" found`,
        });
      }
      return { status: 'deleted', name };
    },
  );

  fastify.post<{ Params: { name: string }; Body: { deviceId?: string; vars?: Record<string, unknown> } }>(
    '/api/hooks/:name/test',
    async (request: FastifyRequest<{ Params: { name: string }; Body: { deviceId?: string; vars?: Record<string, unknown> } }>, reply: FastifyReply) => {
      const { name } = request.params;
      const hook = executor.getHooks().find(h => h.name === name);
      if (!hook) {
        return reply.code(404).send({
          type: 'https://device-farm/errors/not-found',
          title: 'Hook not found',
          status: 404,
          detail: `No hook named "${name}" found`,
        });
      }
      const body = (request.body ?? {}) as { deviceId?: string; vars?: Record<string, unknown> };
      let context;
      if (body.deviceId) {
        const device = fastify.pool.getDevice(body.deviceId);
        if (!device) {
          return reply.code(404).send({
            type: 'https://device-farm/errors/not-found',
            title: 'Device not found',
            status: 404,
          });
        }
        context = {
          deviceId: device.id,
          emulatorId: device.emulatorId,
          serial: device.port != null ? `emulator-${device.port}` : device.emulatorId,
          platform: device.platform,
          port: device.port,
          jobId: 'test-run',
          vars: body.vars,
        };
      } else {
        context = {
          deviceId: 'test-device-id',
          emulatorId: 'test-emulator',
          serial: 'emulator-5554',
          platform: 'android' as const,
          port: 5554,
          jobId: 'test-run',
          vars: body.vars,
        };
      }
      const [result] = await executor.execute(hook.event, context);
      return result ?? { success: false, error: 'No hooks matched' };
    },
  );

  // 6. Wire shutdown.
  fastify.addHook('onClose', async () => {
    await module.shutdown();
  });
}

export default fp(hooksPlugin, {
  name: 'hooks-plugin',
  dependencies: ['config', 'event-bus', 'queue', 'pool-plugin'],
});
