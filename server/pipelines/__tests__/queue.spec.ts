/**
 * Phase 25 / Plan 25-01 — pipelines queue helpers spec (mock-based).
 *
 * Proves:
 *   - pipelineScheduledExecutePayloadSchema accepts valid + rejects malformed.
 *   - registerPipelineScheduledExecuteQueue calls boss.createQueue with
 *     {policy:'standard', retryLimit:0}.
 *   - registerPipelineScheduledExecuteWorker calls boss.work; the inner worker
 *     parses payload via Zod BEFORE invoking the user's handler. Malformed
 *     payload throws (NOT silently skipped).
 *   - upsertPipelineSchedule calls boss.schedule(name, cron, data,
 *     {key: scheduleId, tz:'UTC'}) — exact `key` parameter (NOT singletonKey).
 *   - removePipelineSchedule calls boss.unschedule(name, scheduleId) with
 *     positional args (Pitfall 1: pg-boss v12 signature is positional, NOT
 *     object form).
 *
 * NO DB required — boss is mocked end-to-end. DB-gated idempotency proof
 * (boss.schedule overwrites prior schedule when same key is reused) lands
 * in Plan 25-02 against a real boss instance.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import postgres from 'postgres';

import { correlationPlugin } from '../../correlation/index.js';
import queuePlugin from '../../queue/plugin.js';
import {
  PIPELINE_SCHEDULED_EXECUTE_QUEUE_NAME,
  pipelineScheduledExecutePayloadSchema,
  registerPipelineScheduledExecuteQueue,
  registerPipelineScheduledExecuteWorker,
  upsertPipelineSchedule,
  removePipelineSchedule,
} from '../queue.js';

function makeBossMock() {
  return {
    createQueue: vi.fn().mockResolvedValue(undefined),
    work: vi.fn().mockResolvedValue('worker-1'),
    schedule: vi.fn().mockResolvedValue(undefined),
    unschedule: vi.fn().mockResolvedValue(undefined),
  };
}

describe('Phase 25 — pipelines queue helpers', () => {
  it('payload schema accepts valid + rejects malformed', () => {
    const valid = {
      pipelineId: '11111111-1111-4111-8111-111111111111',
      scheduleId: '22222222-2222-4222-8222-222222222222',
      variables: { foo: 'bar' },
    };
    expect(() => pipelineScheduledExecutePayloadSchema.parse(valid)).not.toThrow();
    // Missing scheduleId
    expect(() =>
      pipelineScheduledExecutePayloadSchema.parse({
        pipelineId: '11111111-1111-4111-8111-111111111111',
        variables: {},
      }),
    ).toThrow();
    // variables not Record<string,string>
    expect(() =>
      pipelineScheduledExecutePayloadSchema.parse({
        pipelineId: '11111111-1111-4111-8111-111111111111',
        scheduleId: '22222222-2222-4222-8222-222222222222',
        variables: { num: 42 },
      }),
    ).toThrow();
  });

  it('registerPipelineScheduledExecuteQueue calls createQueue with policy:standard retryLimit:0', async () => {
    const boss = makeBossMock();
    await registerPipelineScheduledExecuteQueue(boss as never);
    expect(boss.createQueue).toHaveBeenCalledTimes(1);
    expect(boss.createQueue).toHaveBeenCalledWith(
      PIPELINE_SCHEDULED_EXECUTE_QUEUE_NAME,
      expect.objectContaining({ policy: 'standard', retryLimit: 0 }),
    );
  });

  it('registerPipelineScheduledExecuteWorker parses payload before calling handler (malformed throws)', async () => {
    const boss = makeBossMock();
    const handler = vi.fn().mockResolvedValue(undefined);
    const workerId = await registerPipelineScheduledExecuteWorker(boss as never, handler);

    expect(workerId).toBe('worker-1');
    expect(boss.work).toHaveBeenCalledTimes(1);
    expect(boss.work).toHaveBeenCalledWith(
      PIPELINE_SCHEDULED_EXECUTE_QUEUE_NAME,
      expect.any(Function),
    );

    // Capture inner worker function and exercise it.
    const innerWorker = boss.work.mock.calls[0][1] as (
      jobs: Array<{ id: string; data: unknown }>,
    ) => Promise<void>;

    // Valid payload → handler invoked with parsed object.
    await innerWorker([
      {
        id: 'job-1',
        data: {
          pipelineId: '11111111-1111-4111-8111-111111111111',
          scheduleId: '22222222-2222-4222-8222-222222222222',
          variables: { env: 'prod' },
        },
      },
    ]);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(
      {
        pipelineId: '11111111-1111-4111-8111-111111111111',
        scheduleId: '22222222-2222-4222-8222-222222222222',
        variables: { env: 'prod' },
      },
      'job-1',
    );

    // Malformed → throws (does NOT silently skip).
    await expect(
      innerWorker([{ id: 'job-2', data: { foo: 'bar' } }]),
    ).rejects.toThrow();
  });

  it('upsertPipelineSchedule calls boss.schedule with key:scheduleId (NOT singletonKey)', async () => {
    const boss = makeBossMock();
    await upsertPipelineSchedule({
      boss: boss as never,
      scheduleId: 'schedule-uuid-1',
      pipelineId: 'pipeline-uuid-1',
      cronExpression: '0 2 * * *',
      variables: { env: 'prod' },
    });
    expect(boss.schedule).toHaveBeenCalledTimes(1);
    expect(boss.schedule).toHaveBeenCalledWith(
      PIPELINE_SCHEDULED_EXECUTE_QUEUE_NAME,
      '0 2 * * *',
      expect.objectContaining({
        pipelineId: 'pipeline-uuid-1',
        scheduleId: 'schedule-uuid-1',
        variables: { env: 'prod' },
      }),
      expect.objectContaining({ key: 'schedule-uuid-1', tz: 'UTC' }),
    );

    // Critical: the per-schedule disambiguator is `key`, NOT singletonKey.
    const optsArg = boss.schedule.mock.calls[0][3] as Record<string, unknown>;
    expect(optsArg).not.toHaveProperty('singletonKey');
    expect(optsArg.key).toBe('schedule-uuid-1');
  });

  it('removePipelineSchedule calls boss.unschedule with positional args (NOT object form per Pitfall 1)', async () => {
    const boss = makeBossMock();
    await removePipelineSchedule({
      boss: boss as never,
      scheduleId: 'schedule-uuid-1',
    });
    expect(boss.unschedule).toHaveBeenCalledTimes(1);
    expect(boss.unschedule).toHaveBeenCalledWith(
      PIPELINE_SCHEDULED_EXECUTE_QUEUE_NAME,
      'schedule-uuid-1',
    );
    // Positional — exactly 2 args; NOT a single object.
    expect(boss.unschedule.mock.calls[0]).toHaveLength(2);
    expect(typeof boss.unschedule.mock.calls[0][1]).toBe('string');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 25 Plan 25-02 — DB-gated proofs (SC1 + Pitfall 3)
// ─────────────────────────────────────────────────────────────────────────────
//
// Plan 25-01's mock-based tests prove call-shape; these prove RUNTIME semantics
// against a real pg-boss instance:
//   (a) idempotent upsert — calling upsertPipelineSchedule twice with the same
//       scheduleId keeps EXACTLY 1 row in pgboss.schedule (latest cron wins);
//   (b) Pitfall 3 — removePipelineSchedule actually deletes the row (proves
//       the API call is not a silent no-op due to misformed args).
//
// Gated on TEST_DATABASE_URL / DATABASE_URL. Skips cleanly when unset.
// Isolated pg-boss schema (pgboss_pipelines_queue_spec) so parallel runs do
// not collide with the lifecycle / reporting / jobs DB-gated specs.
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const HAS_DB = typeof TEST_DATABASE_URL === 'string' && TEST_DATABASE_URL.length > 0;
const SCHEMA = 'pgboss_pipelines_queue_spec';

if (!HAS_DB) {
  // eslint-disable-next-line no-console
  console.warn('[pipelines/queue.spec] SKIPPED: set TEST_DATABASE_URL or DATABASE_URL to run');
}

const stubConfigPlugin = (databaseUrl: string) =>
  fp(async (fastify: FastifyInstance) => {
    fastify.decorate('config', { database_url: databaseUrl } as never);
  }, { name: 'config' });

const stubDbPlugin = fp(async (fastify: FastifyInstance) => {
  fastify.decorate('db', {} as never);
}, { name: 'db' });

describe.skipIf(!HAS_DB)('Phase 25 — pipelines queue DB-gated proofs (SC1)', () => {
  let app: FastifyInstance;
  let client: ReturnType<typeof postgres>;

  beforeAll(async () => {
    client = postgres(TEST_DATABASE_URL!);
    await client.unsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);

    app = Fastify({ logger: false });
    await app.register(stubConfigPlugin(TEST_DATABASE_URL!));
    await app.register(stubDbPlugin);
    await app.register(correlationPlugin);
    await app.register(queuePlugin, { schema: SCHEMA });
    await app.ready();

    // Pitfall 2: queue must exist BEFORE boss.schedule() — register here.
    await registerPipelineScheduledExecuteQueue(app.boss);
  }, 30_000);

  afterAll(async () => {
    await app?.close();
    await client?.unsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`).catch(() => {
      /* ignore */
    });
    await client?.end();
  }, 30_000);

  it('SC1 idempotent upsert — calling upsertPipelineSchedule twice with same scheduleId yields 1 row with latest cron', async () => {
    const scheduleId = '11111111-1111-4111-8111-111111111111';
    const pipelineId = '22222222-2222-4222-8222-222222222222';

    await upsertPipelineSchedule({
      boss: app.boss,
      scheduleId,
      pipelineId,
      cronExpression: '0 2 * * *',
      variables: { env: 'first' },
    });

    await upsertPipelineSchedule({
      boss: app.boss,
      scheduleId,
      pipelineId,
      cronExpression: '0 3 * * *', // different cron — should overwrite
      variables: { env: 'second' },
    });

    const schedules = await app.boss.getSchedules();
    const matching = (schedules as Array<{ name: string; key?: string; cron: string }>).filter(
      (s) => s.name === PIPELINE_SCHEDULED_EXECUTE_QUEUE_NAME && s.key === scheduleId,
    );
    expect(matching.length).toBe(1);
    expect(matching[0].cron).toBe('0 3 * * *'); // latest wins
  }, 30_000);

  it('SC1 + Pitfall 3 unschedule on delete — removePipelineSchedule actually removes the pgboss row', async () => {
    const scheduleId = '33333333-3333-4333-8333-333333333333';
    const pipelineId = '44444444-4444-4444-8444-444444444444';

    await upsertPipelineSchedule({
      boss: app.boss,
      scheduleId,
      pipelineId,
      cronExpression: '0 4 * * *',
      variables: {},
    });

    const before = (await app.boss.getSchedules()) as Array<{ name: string; key?: string }>;
    expect(before.some((s) => s.name === PIPELINE_SCHEDULED_EXECUTE_QUEUE_NAME && s.key === scheduleId)).toBe(true);

    await removePipelineSchedule({ boss: app.boss, scheduleId });

    const after = (await app.boss.getSchedules()) as Array<{ name: string; key?: string }>;
    expect(after.some((s) => s.name === PIPELINE_SCHEDULED_EXECUTE_QUEUE_NAME && s.key === scheduleId)).toBe(false);
  }, 30_000);
});
