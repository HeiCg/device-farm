import fp from 'fastify-plugin';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default fp(
  async (fastify: FastifyInstance) => {
    const webBuildPath = path.resolve(__dirname, '../../web/build');

    if (!fs.existsSync(webBuildPath)) {
      if (process.env.NODE_ENV !== 'production') {
        fastify.log.warn(
          `Static SPA directory not found at ${webBuildPath} -- skipping static serving (run "npm run web:build" to generate)`,
        );
        return;
      }
      throw new Error(`Static SPA directory not found at ${webBuildPath}`);
    }

    const indexHtmlPath = path.join(webBuildPath, 'index.html');

    await fastify.register(fastifyStatic, {
      root: webBuildPath,
      prefix: '/',
      decorateReply: false,
      wildcard: true,
    });

    fastify.setNotFoundHandler((request, reply) => {
      if (request.method === 'GET' && !request.url.startsWith('/api/') && !request.url.startsWith('/ws/')) {
        // Read on every SPA fallback so rebuilds of web/build/ (with hashed
        // chunk filenames) are reflected without a server restart.
        return reply.type('text/html').send(fs.readFileSync(indexHtmlPath));
      }
      return reply.status(404).send({ error: 'Not Found' });
    });

    fastify.log.info('Static SPA plugin registered');
  },
  { name: 'static-spa', dependencies: ['api'] },
);
