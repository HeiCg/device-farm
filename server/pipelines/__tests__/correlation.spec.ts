/**
 * Phase 25 / Plan 25-04 — Pipelines correlation DB-gated spec [TRACE-04 / TRACE-09].
 *
 * Proves a single ALS correlationId threads end-to-end through a multi-stage
 * pipeline run:
 *
 *   asyncLocalStorage.run({correlationId: cid}, () => service.triggerRun(...))
 *   ⤷ pipeline.run.started envelope carries correlationId === cid
 *   ⤷ for each stage: job.completed emit (wrapped in another ALS run with same
 *     cid) → subscriber → pipeline.stage.advanced envelope carries cid
 *   ⤷ final stage advance → pipeline.run.completed envelope + persisted row
 *     in events table both carry cid
 *
 * Captures envelopes via the persistEnvelope side-channel `${type}.envelope`
 * ee.emit (Phase 22 streaming envelope.spec pattern). The pipelinesModule's
 * persistEnvelope (module.ts:88-113) emits `${envelope.type}.envelope` BEFORE
 * the persisted-flag short-circuit — so transient events (run.started,
 * stage.advanced) are observable without DB queries.
 *
 * Harness mirrors subscriber.spec verbatim. The 3-stage pipeline definition
 * uses sequential maestro stages with NO matrix block (avoiding the
 * pre-existing pipeline-schema.ts:17 z.record(z.unknown()) Zod v4 incompat
 * documented in 25-03-SUMMARY).
 *
 * Phase 21 reference: server/artifacts/__tests__/correlation.spec.ts.
 * Phase 22 reference: server/streaming/__tests__/correlation.spec.ts.
 * Phase 24 reference: server/maestro/__tests__/correlation.spec.ts.
 *
 * DB-gated: skips cleanly via describe.skipIf when TEST_DATABASE_URL /
 * DATABASE_URL absent.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq, and } from 'drizzle-orm';
import { asyncLocalStorage } from '@fastify/request-context';

import {
  fastifyZodOpenApiPlugin,
  validatorCompiler,
  serializerCompiler,
} from 'fastify-zod-openapi';

import correlationPlugin from '../../correlation/plugin.js';
import eventBusPlugin from '../../bus/plugin.js';
import queuePlugin from '../../queue/plugin.js';
import poolPlugin from '../../pool/plugin.js';
import pipelinesPlugin from '../plugin.js';
import { TypedBus } from '../../bus/bus.js';
import { jobsRegistry, makeJobsEmitters, type JobsRegistry } from '../../jobs/events.js';
import * as schema from '../../db/schema.js';
import type { Envelope } from '../../events/envelope.js';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const HAS_DB = typeof TEST_DATABASE_URL === 'string' && TEST_DATABASE_URL.length > 0;
const SCHEMA = `pgboss_pipelines_corr_${Math.random().toString(36).slice(2, 8)}`;

if (!HAS_DB) {
  // eslint-disable-next-line no-console
  console.warn('[pipelines/correlation.spec] SKIPPED: set TEST_DATABASE_URL or DATABASE_URL to run');
}

function makeStubAuthPlugin() {
  return fp(async (fastify: FastifyInstance) => {
    fastify.decorate('authService', { validateKey: async () => true } as never);
  }, { name: 'auth', dependencies: ['config'] });
}

function makeStubWebsocketPlugin() {
  return fp(async (fastify: FastifyInstance) => {
    const { default: websocket } = await import('@fastify/websocket');
    await fastify.register(websocket);
  }, { name: 'websocket-plugin', dependencies: ['config', 'auth'] });
}

function makeStubJobsPlugin() {
  return fp(async (fastify: FastifyInstance) => {
    const bus = new TypedBus(jobsRegistry);
    const ee = (bus as unknown as { ee: import('node:events').EventEmitter }).ee;
    const emit = makeJobsEmitters(bus, (env: Envelope) => {
      ee.emit(`${env.type}.envelope`, env);
      const entry = jobsRegistry[env.type as keyof JobsRegistry];
      if (entry?.persisted) {
        void (async () => {
          try {
            await fastify.db.insert(schema.events).values({
              id: env.id,
              eventType: env.type,
              eventVersion: env.v,
              correlationId: env.correlationId,
              causationId: env.causationId ?? undefined,
              aggregateType: env.aggregateType,
              aggregateId: env.aggregateId,
              payload: env.payload as unknown,
              occurredAt: new Date(env.occurredAt),
              actor: env.actor,
            });
          } catch { /* tolerate */ }
        })();
      }
    });
    fastify.decorate('jobsModule', {
      bus,
      emit,
      enqueueJob: async () => 'mock-boss-job-id',
    } as never);
    fastify.decorate('jobService', {
      createJob: async (opts: { platform: 'android' | 'ios'; metadata: Record<string, unknown> }) => {
        const [row] = await fastify.db.insert(schema.jobs).values({
          platform: opts.platform,
          status: 'queued',
          metadata: opts.metadata ?? {},
        }).returning();
        return { id: row.id, status: row.status, platform: row.platform };
      },
    } as never);
  }, { name: 'job-plugin', dependencies: ['db', 'event-bus'] });
}

interface AppWithDbClient extends FastifyInstance {
  __dbClient?: ReturnType<typeof postgres>;
  __schemaName?: string;
  __flowsDir?: string;
  __flowsRelDir?: string;
}

function makeFlowsDir(): { absDir: string; relDir: string } {
  const relDir = `tmp-df-corr-flows-${randomUUID().slice(0, 8)}`;
  const absDir = join(process.cwd(), relDir);
  mkdirSync(absDir, { recursive: true });
  writeFileSync(join(absDir, 'flow.yaml'), 'appId: com.example.test\n---\n- launchApp\n', 'utf-8');
  return { absDir, relDir };
}

async function buildStack(): Promise<AppWithDbClient> {
  const schemaName = `${SCHEMA}_${Math.random().toString(36).slice(2, 6)}`;
  const sqlClient = postgres(TEST_DATABASE_URL!);
  await sqlClient.unsafe(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
  const db = drizzle(sqlClient);
  const { absDir: flowsAbsDir, relDir: flowsRelDir } = makeFlowsDir();

  const stubConfigPlugin = fp(async (fastify: FastifyInstance) => {
    fastify.decorate('config', {
      database_url: TEST_DATABASE_URL!,
      auth: { enabled: false },
      storage: { artifacts: { path: `/tmp/df-pipelines-corr-${schemaName}` } },
      pool: {
        max_devices: 10,
        android: { enabled: false, max_instances: 0 },
        ios: { enabled: false, max_instances: 0 },
      },
      jobs: { timeout_minutes: 30 },
    } as never);
  }, { name: 'config' });

  const liveDbPlugin = fp(async (fastify: FastifyInstance) => {
    fastify.decorate('db', db as unknown as FastifyInstance['db']);
  }, { name: 'db', dependencies: ['config'] });

  const app = Fastify({ logger: false, pluginTimeout: 60_000 }) as AppWithDbClient;
  app.__dbClient = sqlClient;
  app.__schemaName = schemaName;
  app.__flowsDir = flowsAbsDir;
  app.__flowsRelDir = flowsRelDir;

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(fastifyZodOpenApiPlugin);

  await app.register(stubConfigPlugin);
  await app.register(correlationPlugin);
  await app.register(liveDbPlugin);
  await app.register(eventBusPlugin);
  await app.register(queuePlugin, { schema: schemaName });
  await app.register(makeStubAuthPlugin());
  await app.register(poolPlugin);
  await app.register(makeStubWebsocketPlugin());
  await app.register(makeStubJobsPlugin());
  await app.register(pipelinesPlugin);
  await app.ready();

  return app;
}

describe.skipIf(!HAS_DB)('[Phase 25-04 TRACE-04 / TRACE-09] pipelines correlationId thread (DB-gated)', () => {
  let app: AppWithDbClient | null = null;

  beforeAll(async () => {
    app = await buildStack();
  }, 60_000);

  afterAll(async () => {
    if (app) {
      const sqlClient = app.__dbClient;
      const schemaName = app.__schemaName;
      const flowsDir = app.__flowsDir;
      try { await app.close(); } catch { /* ignore */ }
      if (sqlClient && schemaName) {
        await sqlClient.unsafe(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`).catch(() => { /* ignore */ });
      }
      if (sqlClient) await sqlClient.end().catch(() => { /* ignore */ });
      if (flowsDir) {
        try { rmSync(flowsDir, { recursive: true, force: true }); } catch { /* ignore */ }
      }
      app = null;
    }
  }, 30_000);

  beforeEach(async () => {
    const a = app!;
    const testJobs = await a.db.select({ jobId: schema.pipelineStageJobs.jobId })
      .from(schema.pipelineStageJobs);
    await a.db.delete(schema.pipelineStageJobs);
    await a.db.delete(schema.pipelineStageRuns);
    await a.db.delete(schema.pipelineRuns);
    await a.db.delete(schema.pipelineSchedules);
    await a.db.delete(schema.pipelines);
    for (const { jobId } of testJobs) {
      await a.db.delete(schema.jobFiles).where(eq(schema.jobFiles.jobId, jobId));
      await a.db.delete(schema.jobs).where(eq(schema.jobs.id, jobId)).catch(() => { /* tolerate */ });
    }
    await a.db.delete(schema.events).where(eq(schema.events.aggregateType, 'pipeline-run'));
  });

  /** Capture every pipelines envelope via the persistEnvelope side-channel. */
  function capturePipelinesEnvelopes(a: AppWithDbClient): Envelope[] {
    const captured: Envelope[] = [];
    const ee = (a.pipelinesModule.bus as unknown as {
      ee: { on: (n: string, h: (e: Envelope) => void) => void };
    }).ee;
    ee.on('pipeline.run.started.envelope', (env: Envelope) => captured.push(env));
    ee.on('pipeline.stage.advanced.envelope', (env: Envelope) => captured.push(env));
    ee.on('pipeline.run.completed.envelope', (env: Envelope) => captured.push(env));
    ee.on('pipeline.run.failed.envelope', (env: Envelope) => captured.push(env));
    return captured;
  }

  async function insertSequentialMaestroPipeline(name: string, stageNames: string[]): Promise<string> {
    const a = app!;
    const stagesYaml = stageNames.map((n) => (
      `  - name: ${n}\n    type: maestro\n    platform: android\n    flows: ${a.__flowsRelDir!}`
    )).join('\n');
    const yamlContent = `name: "${name}"\nstages:\n${stagesYaml}\n`;
    const [row] = await a.db.insert(schema.pipelines).values({ name, yamlContent }).returning();
    return row.id;
  }

  async function waitForCondition(check: () => Promise<boolean>, timeoutMs = 5000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (await check()) return;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`waitForCondition timed out after ${timeoutMs}ms`);
  }

  // ------------------------------------------------------------------
  // Test 1: single correlationId threads through 3-stage run
  // ------------------------------------------------------------------
  it('[TRACE-04] single correlationId threads through 3-stage run + every emitted pipelines envelope', async () => {
    const a = app!;
    const cid = randomUUID();
    const captured = capturePipelinesEnvelopes(a);

    const pipelineId = await insertSequentialMaestroPipeline(
      'corr-test-3-stage',
      ['stage1', 'stage2', 'stage3'],
    );

    // triggerRun runs INSIDE the ALS frame so the runStarted envelope picks
    // up correlationId=cid via createEventHelpers/readAls (server/bus/helpers.ts).
    // PLAIN-OBJECT ALS store shape per Phase 20 canonical (NOT legacy Map).
    let runId: string;
    await asyncLocalStorage.run(
      { correlationId: cid, currentEventId: null, actor: 'pipelines-correlation-spec' } as never,
      async () => {
        runId = await a.pipelinesModule.service.triggerRun(pipelineId, 'manual', {});
      },
    );

    // Walk through each stage: mark its job passed + fire job.completed inside
    // the same ALS frame so subsequent stage.advanced + run.completed envelopes
    // (emitted from the subscriber's handler) inherit cid.
    for (let stageIdx = 0; stageIdx < 3; stageIdx += 1) {
      // Wait for stage stageRun to exist with status='running'.
      await waitForCondition(async () => {
        const rows = await a.db.select().from(schema.pipelineStageRuns)
          .where(and(
            eq(schema.pipelineStageRuns.runId, runId!),
            eq(schema.pipelineStageRuns.stageIndex, stageIdx),
          ));
        return rows[0]?.status === 'running';
      });

      const [stageRun] = await a.db.select().from(schema.pipelineStageRuns)
        .where(and(
          eq(schema.pipelineStageRuns.runId, runId!),
          eq(schema.pipelineStageRuns.stageIndex, stageIdx),
        ));
      const [stageJob] = await a.db.select().from(schema.pipelineStageJobs)
        .where(eq(schema.pipelineStageJobs.stageRunId, stageRun.id));

      await a.db.update(schema.jobs).set({ status: 'passed' })
        .where(eq(schema.jobs.id, stageJob.jobId));

      // Emit job.completed INSIDE asyncLocalStorage.run so the subscriber's
      // re-emit (pipeline.stage.advanced) inherits cid.
      await asyncLocalStorage.run(
        { correlationId: cid, currentEventId: null, actor: 'pipelines-correlation-spec' } as never,
        async () => {
          a.jobsModule.emit.completed(stageJob.jobId, {
            jobId: stageJob.jobId,
            status: 'passed',
            platform: 'android',
          });
          // Wait inside the ALS frame so subscriber + advanceRunOrComplete +
          // any nested startStage emits run with cid in scope.
          await waitForCondition(async () => {
            const [updated] = await a.db.select().from(schema.pipelineStageRuns)
              .where(eq(schema.pipelineStageRuns.id, stageRun.id));
            return updated?.status === 'passed';
          });
        },
      );
    }

    // Wait for run finalization.
    await waitForCondition(async () => {
      const [r] = await a.db.select().from(schema.pipelineRuns)
        .where(eq(schema.pipelineRuns.id, runId!));
      return r?.status === 'passed';
    });

    // Assert: every captured pipelines envelope shares cid.
    expect(captured.length, 'must capture multiple envelopes (run.started + 3 stage.advanced + run.completed)').toBeGreaterThanOrEqual(5);
    const distinctCids = new Set(captured.map((e) => e.correlationId));
    expect(
      distinctCids,
      `every pipelines envelope must share correlationId=${cid}; got: ${[...distinctCids].join(', ')}`,
    ).toEqual(new Set([cid]));

    // Specific envelope types we expect:
    const types = captured.map((e) => e.type);
    expect(types).toContain('pipeline.run.started');
    expect(types.filter((t) => t === 'pipeline.stage.advanced').length).toBeGreaterThanOrEqual(3);
    expect(types).toContain('pipeline.run.completed');

    // Persisted: pipeline.run.completed in events table carries cid (TRACE-08).
    await waitForCondition(async () => {
      const rows = await a.db.select().from(schema.events).where(and(
        eq(schema.events.eventType, 'pipeline.run.completed'),
        eq(schema.events.aggregateId, runId!),
      ));
      return rows.length >= 1 && rows[0].correlationId === cid;
    });

    const [completedRow] = await a.db.select().from(schema.events).where(and(
      eq(schema.events.eventType, 'pipeline.run.completed'),
      eq(schema.events.aggregateId, runId!),
    ));
    expect(completedRow.correlationId).toBe(cid);
  }, 30_000);
});
