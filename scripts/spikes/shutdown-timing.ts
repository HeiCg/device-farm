/**
 * Phase 15 Plan 05, Task 5.4 — graceful-shutdown timing spike.
 *
 * Measures how long `app.close()` takes when a pg-boss worker is mid-flight on a
 * realistic workload: 50 × 5-second-sleep jobs, graceful timeout 30s.
 *
 * Why a dedicated script instead of the vitest spec: vitest specs must stay sub-2s
 * to keep the suite fast. This script is deliberately heavy and is expected to run
 * interactively on the target machine (Mac Mini) with the result captured in
 * `.planning/phases/15-fix-operational-dependencies/spikes/shutdown-timing.md`.
 *
 * USAGE (from repo root):
 *   DATABASE_URL="postgresql://..." npx tsx scripts/spikes/shutdown-timing.ts
 *
 * OUTPUT: prints `close took <N>ms` to stdout. Operator records N in the
 * markdown file and adjusts the 30_000ms pg-boss timeout if N trends too close.
 *
 * The script isolates its pg-boss tables into the `pgboss_shutdown_spike` schema
 * so it does not collide with production `pgboss` state.
 */
import fp from 'fastify-plugin';
import Fastify from 'fastify';
import { correlationPlugin } from '../../server/correlation/index.js';
import { QUEUE_NAMES, queuePlugin } from '../../server/queue/index.js';

const DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('Set DATABASE_URL (or TEST_DATABASE_URL) before running this spike.');
  process.exit(1);
}

const SCHEMA = 'pgboss_shutdown_spike';
const JOB_COUNT = 50;
const JOB_SLEEP_MS = 5_000;
const PICKUP_GRACE_MS = 3_000;

const stubConfig = fp(async (fastify) => {
  fastify.decorate('config', { database_url: DATABASE_URL! } as never);
}, { name: 'config' });

const stubDb = fp(async (fastify) => {
  fastify.decorate('db', {} as never);
}, { name: 'db' });

async function main() {
  const app = Fastify({ logger: { level: 'info' } });
  await app.register(stubConfig);
  await app.register(stubDb);
  await app.register(correlationPlugin);
  await app.register(queuePlugin, { schema: SCHEMA });
  await app.ready();

  // Worker: each job sleeps JOB_SLEEP_MS so the shutdown path has something to drain.
  await app.queue.work(QUEUE_NAMES.DEMO, async () => {
    await new Promise((r) => setTimeout(r, JOB_SLEEP_MS));
  });

  app.log.info({ JOB_COUNT, JOB_SLEEP_MS }, 'enqueuing spike jobs...');
  for (let i = 0; i < JOB_COUNT; i++) {
    await app.queue.send(QUEUE_NAMES.DEMO, { i });
  }

  // Let workers pick up a batch before we start closing.
  await new Promise((r) => setTimeout(r, PICKUP_GRACE_MS));

  const start = Date.now();
  await app.close();
  const elapsed = Date.now() - start;
  // Capture the output — operator records this number in the spike markdown.
  console.log(`close took ${elapsed}ms`);
}

main().catch((err) => {
  console.error('spike failed:', err);
  process.exit(1);
});
