import type { FastifyInstance } from 'fastify';
import type { QueueStatus } from '../../pipelines/internal/queue-status.js';

export interface PipelinesQueueRouteDeps {
  getStatus(): Promise<QueueStatus>;
}

export async function registerPipelinesQueueRoute(
  app: FastifyInstance,
  deps: PipelinesQueueRouteDeps,
): Promise<void> {
  app.get('/api/pipelines/queue', async () => deps.getStatus());
}
