import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { registerPipelinesQueueRoute } from '../internal/pipelines-queue-route.js';

describe('GET /api/pipelines/queue', () => {
  it('returns queue snapshot as JSON', async () => {
    const app = Fastify({ logger: false });
    const fakeStatus = {
      running: [{ runId: 'a', trigger: 'azure-pr', pr: '1', startedAt: null }],
      pending: [],
      capacity: { max_concurrent: 2, active: 1, available_devices_android: 0, available_devices_ios: 1 },
    };
    await registerPipelinesQueueRoute(app, { getStatus: async () => fakeStatus });

    const res = await app.inject({ method: 'GET', url: '/api/pipelines/queue' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(fakeStatus);
  });
});
