import fp from 'fastify-plugin';
import { loadConfig } from './loader.js';
import { type AppConfig } from './schema.js';

declare module 'fastify' {
  interface FastifyInstance {
    config: AppConfig;
  }
}

export default fp(async (fastify) => {
  const config = loadConfig();
  fastify.decorate('config', config);
}, { name: 'config' });

export { type AppConfig };
