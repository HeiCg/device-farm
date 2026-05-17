/**
 * Shared stub plugins for queue-plugin integration tests — Phase 15 Plan 05, Task 5.2.
 *
 * The queue plugin declares `dependencies: ['db', 'correlation']` — fastify-plugin
 * enforces that dependencies are registered as NAMED plugins, not just decorators.
 * These stubs provide the minimum surface each dependency needs so specs can mount
 * the queue plugin without dragging in the real config/db implementations.
 */
import fp from 'fastify-plugin';

/** Stub config plugin — queue plugin needs `fastify.config.database_url`. */
export function makeStubConfigPlugin(databaseUrl: string) {
  return fp(async (fastify) => {
    fastify.decorate('config', { database_url: databaseUrl } as never);
  }, { name: 'config' });
}

/** Stub db plugin — only its name matters for dependency resolution. */
export const stubDbPlugin = fp(async (fastify) => {
  fastify.decorate('db', {} as never);
}, { name: 'db' });
