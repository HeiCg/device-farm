import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import type { Database } from './index.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: Database;
  }
}

interface DbPluginOptions {
  db: Database;
}

export default fp(
  async (fastify: FastifyInstance, options: DbPluginOptions) => {
    fastify.decorate('db', options.db);
    fastify.log.info('DB plugin registered');
  },
  { name: 'db', dependencies: ['config'] },
);
