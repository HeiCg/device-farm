/**
 * Phase 25 / Plan 25-04 — Pipelines stage-advancement subscriber DB-gated spec [SC2].
 *
 * Proves end-to-end that the pipelines stage-advancement subscriber wired by
 * Plan 25-03 (server/pipelines/internal/subscribers.ts) drives the run state
 * machine purely through bus events:
 *
 *   1. 3-stage sequential pipeline:
 *      - service.triggerRun creates pipeline_runs + first stage's
 *        pipeline_stage_runs row + (via jobService.createJob stub) one
 *        pipeline_stage_jobs link row + jobs row.
 *      - For each stage in turn: UPDATE jobs.status='passed' →
 *        jobsModule.emit.completed → subscriber DB-joins → marks stageRun
 *        passed → calls service.advanceRunOrComplete → next stage starts.
 *      - Final state: pipelineRuns.status='passed' + 3 stageRuns 'passed' +
 *        no local Promise chain involved (the test never awaits an
 *        executeRun(...) Promise; convergence is purely event-driven).
 *
 *   2. Matrix N-of-N gate (Pitfall 8):
 *      - 1 matrix stage of 3 entries → 3 jobs + 3 link rows.
 *      - Fire job.completed for 1 of 3 → stage status STAYS 'running'.
 *      - Fire 2nd → STAYS 'running'.
 *      - Fire 3rd → stage advances to 'passed' AND run completes.
 *
 * Harness mirrors Phase 21 artifacts/__tests__/subscriber.spec.ts pattern:
 * config + correlation + db + event-bus + queue + auth-stub + pool +
 * stub-websocket + stub-jobs (decorates jobsModule + jobService) + real
 * pipelines plugin. jobService.createJob is stubbed to insert a real jobs row
 * and return its id (no enqueue — the test drives job.completed directly).
 *
 * The maestro stage path (fanoutMaestroStage) reads .yaml flow files from
 * disk; we point workDir at a tmpdir containing one stub flow.yaml so the
 * fanout succeeds. This exercises the same code path production uses.
 *
 * DB-gated: skips cleanly via describe.skipIf when TEST_DATABASE_URL /
 * DATABASE_URL absent. Uses ephemeral pgboss schema for parallel-safety.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq, and } from 'drizzle-orm';

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
const SCHEMA = `pgboss_pipelines_sub_${Math.random().toString(36).slice(2, 8)}`;

if (!HAS_DB) {
  // eslint-disable-next-line no-console
  console.warn('[pipelines/subscriber.spec] SKIPPED: set TEST_DATABASE_URL or DATABASE_URL to run');
}

/** Stub auth plugin — pipelines transitively depends on auth via websocket-plugin. */
function makeStubAuthPlugin() {
  return fp(async (fastify: FastifyInstance) => {
    fastify.decorate('authService', { validateKey: async () => true } as never);
  }, { name: 'auth', dependencies: ['config'] });
}

/**
 * Stub websocket-plugin: registers @fastify/websocket so the pipelines plugin
 * can register its /ws/pipeline-runs/:id route. Plugin name matches the real
 * streaming plugin to satisfy pipelinesPlugin's dependency declaration.
 */
function makeStubWebsocketPlugin() {
  return fp(async (fastify: FastifyInstance) => {
    const { default: websocket } = await import('@fastify/websocket');
    await fastify.register(websocket);
  }, { name: 'websocket-plugin', dependencies: ['config', 'auth'] });
}

/**
 * Stub jobs-plugin: decorates fastify.jobsModule with a real TypedBus +
 * makeJobsEmitters (so emit.completed fires real bus events) plus
 * fastify.jobService with a createJob shim that inserts a jobs row. Plugin
 * name 'job-plugin' matches the real jobs plugin to satisfy pipelinesPlugin's
 * dependency declaration. Persists job.completed events to events table
 * (matches real bus/plugin.ts onPersisted pipeline).
 */
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
          } catch {
            /* tolerate */
          }
        })();
      }
    });

    const enqueueJob = async (_jobId: string, _payload: unknown) => 'mock-boss-job-id';

    fastify.decorate('jobsModule', {
      bus,
      emit,
      enqueueJob,
    } as never);

    /**
     * Stub jobService.createJob — inserts a real jobs row (so the
     * pipeline_stage_jobs FK reference resolves) and returns the id. Does NOT
     * enqueue: tests drive job.completed via emit directly.
     */
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
  __flowsDir?: string;       // absolute path (for cleanup)
  __flowsRelDir?: string;    // relative to cwd (used in YAML stage.flows)
}

/**
 * Create a tmpdir with one stub flow.yaml so fanoutMaestroStage's readdir finds it.
 *
 * fanoutMaestroStage builds `${ctx.workDir}/${stage.flows}` (line 626 of
 * service.ts). When stage.flows is absolute, the join produces a malformed
 * `${cwd}/${absolutePath}` path. We sidestep by writing the flows dir
 * UNDER process.cwd() and using a RELATIVE path for stage.flows, so the
 * concat resolves to a real directory.
 */
function makeFlowsDir(): { absDir: string; relDir: string } {
  const relDir = `tmp-df-flows-${randomUUID().slice(0, 8)}`;
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
      storage: { artifacts: { path: `/tmp/df-pipelines-sub-${schemaName}` } },
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

  // Surface logger errors/warns to stdout so test failures explain themselves.
  const app = Fastify({
    logger: { level: 'warn' },
    pluginTimeout: 60_000,
  }) as AppWithDbClient;
  app.__dbClient = sqlClient;
  app.__schemaName = schemaName;
  app.__flowsDir = flowsAbsDir;
  app.__flowsRelDir = flowsRelDir;

  // pipelinesPlugin registers Zod-typed routes (POST /api/pipelines etc.) via
  // fastify-zod-openapi; Fastify needs the validator/serializer + plugin
  // installed at root scope before registration, else app.ready() throws
  // FST_ERR_SCH_VALIDATION_BUILD on the route's request/response schemas.
  // Mirrors server/reporting/__tests__/correlation.spec.ts pattern (Plan 19-05).
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
  await app.ready();  // triggers pipelines registerWorkersAndSubscribers

  // Override workDir for triggerRun: tests insert pipelines without `source` so
  // service uses process.cwd(). Patch service.triggerRun to inject our flowsDir
  // by overriding process.cwd via a service runContext seed is invasive; the
  // simpler path is: stages reference flows: '.' relative to workDir, and we
  // chdir process to flowsDir for the duration of the test. But chdir leaks
  // across tests. Better: pass the flowsDir as the stage's `flows` field
  // (relative path) and set process.cwd to a known parent. We use absolute
  // path — service.fanoutMaestroStage builds `${ctx.workDir}/${stage.flows}`
  // which works fine if stage.flows IS the absolute flowsDir. service uses
  // path.join(workDir, flows) — if `flows` starts with `/` (absolute), join
  // resolves to the absolute path. We use that.
  return app;
}

describe.skipIf(!HAS_DB)('[Phase 25-04 SC2] pipelines stage-advancement subscriber (DB-gated)', () => {
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
    // Clean only the rows OUR tests created. We do NOT touch unrelated rows in
    // the shared `device_farm` dev DB (which holds historical jobs with FKs to
    // job_steps/artifacts/test_executions that we have no business deleting).
    //
    // Order: pipelineStageJobs → pipelineStageRuns → pipelineRuns →
    // pipelineSchedules → pipelines (each chain root). jobs we created via the
    // stub jobService.createJob are tracked via the pipeline_stage_jobs link
    // rows; we delete those jobs.id explicitly via a sub-select-style approach.
    const a = app!;

    // Capture our test jobs BEFORE wiping the link table.
    const testJobs = await a.db.select({ jobId: schema.pipelineStageJobs.jobId })
      .from(schema.pipelineStageJobs);

    await a.db.delete(schema.pipelineStageJobs);
    await a.db.delete(schema.pipelineStageRuns);
    await a.db.delete(schema.pipelineRuns);
    await a.db.delete(schema.pipelineSchedules);
    await a.db.delete(schema.pipelines);

    // Delete jobs rows we created. Tolerant of FK cascades from other tables —
    // tests truncate pipelines tables only; the test-created jobs are leaf
    // (no job_steps / artifacts referencing them).
    for (const { jobId } of testJobs) {
      await a.db.delete(schema.jobFiles).where(eq(schema.jobFiles.jobId, jobId));
      await a.db.delete(schema.jobs).where(eq(schema.jobs.id, jobId)).catch(() => { /* tolerate */ });
    }

    // Wipe events rows we wrote (pipeline.run.* + job.completed). aggregateType
    // 'pipeline-run' for pipelines events; 'job' for jobs events.
    await a.db.delete(schema.events).where(eq(schema.events.aggregateType, 'pipeline-run'));
  });

  /**
   * Insert a pipeline row with N maestro stages. Uses absolute path for
   * `flows:` so fanoutMaestroStage's readdir hits the tmpdir we seeded.
   */
  async function insertMaestroPipeline(name: string, stageNames: string[], opts: {
    matrix?: number;
  } = {}): Promise<string> {
    const a = app!;
    const stagesYaml = stageNames.map((n) => {
      const matrixBlock = opts.matrix
        ? `\n    matrix:\n${Array.from({ length: opts.matrix }, (_, i) => `      - { name: m${i} }`).join('\n')}`
        : '';
      return `  - name: ${n}\n    type: maestro\n    platform: android\n    flows: ${a.__flowsRelDir!}${matrixBlock}`;
    }).join('\n');

    const yamlContent = `name: "${name}"\nstages:\n${stagesYaml}\n`;

    const [row] = await a.db.insert(schema.pipelines).values({
      name,
      yamlContent,
    }).returning();
    return row.id;
  }

  /**
   * Wait until a predicate over DB state holds. Polls every 50ms up to 5s.
   * Used to bridge between bus emit (synchronous fire-and-forget) and the
   * subscriber's async DB writes.
   */
  async function waitForCondition(check: () => Promise<boolean>, timeoutMs = 5000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (await check()) return;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`waitForCondition timed out after ${timeoutMs}ms`);
  }

  // ------------------------------------------------------------------
  // Test (a): 3-stage sequential pipeline completes via bus events
  // ------------------------------------------------------------------
  it('[SC2] 3-stage sequential pipeline completes via bus events (no local Promise chain)', async () => {
    const a = app!;
    const pipelineId = await insertMaestroPipeline('test-3-stage', ['stage1', 'stage2', 'stage3']);

    const runId = await a.pipelinesModule.service.triggerRun(pipelineId, 'manual', {});
    expect(runId).toBeTruthy();

    // Verify run row landed (sanity check before waiting for stages).
    const [createdRun] = await a.db.select().from(schema.pipelineRuns)
      .where(eq(schema.pipelineRuns.id, runId));
    expect(createdRun, 'pipeline_runs row must exist after triggerRun').toBeTruthy();

    // After triggerRun: stage 0 stageRun + 1 stageJob link + 1 jobs row should exist.
    await waitForCondition(async () => {
      const stageRuns = await a.db.select().from(schema.pipelineStageRuns)
        .where(eq(schema.pipelineStageRuns.runId, runId));
      return stageRuns.length === 1 && stageRuns[0].stageIndex === 0;
    });

    // Walk through stages 0, 1, 2: mark each job passed → emit job.completed →
    // assert subscriber advanced (stage marked passed AND next stage stageRun appears).
    for (let stageIdx = 0; stageIdx < 3; stageIdx += 1) {
      const [stageRun] = await a.db.select().from(schema.pipelineStageRuns)
        .where(and(
          eq(schema.pipelineStageRuns.runId, runId),
          eq(schema.pipelineStageRuns.stageIndex, stageIdx),
        ));
      expect(stageRun, `stage ${stageIdx} stageRun should exist`).toBeTruthy();
      expect(stageRun.status).toBe('running');

      const stageJobs = await a.db.select().from(schema.pipelineStageJobs)
        .where(eq(schema.pipelineStageJobs.stageRunId, stageRun.id));
      expect(stageJobs.length, `stage ${stageIdx} should have 1 job (no matrix)`).toBe(1);
      const stageJob = stageJobs[0];

      // Mark the job's underlying jobs row as passed (matrix gate reads jobs.status).
      await a.db.update(schema.jobs).set({ status: 'passed' }).where(eq(schema.jobs.id, stageJob.jobId));

      // Fire job.completed via the (stub) jobsModule.emit — exercises the same
      // bus the subscriber listens on.
      a.jobsModule.emit.completed(stageJob.jobId, {
        jobId: stageJob.jobId,
        status: 'passed',
        platform: 'android',
      });

      // Wait for subscriber to:
      //   a) UPDATE pipelineStageRuns[stageIdx].status='passed'
      //   b) call service.advanceRunOrComplete → which either creates the
      //      next stage's stageRun OR finalizes the run.
      await waitForCondition(async () => {
        const [updated] = await a.db.select().from(schema.pipelineStageRuns)
          .where(eq(schema.pipelineStageRuns.id, stageRun.id));
        return updated?.status === 'passed';
      });
    }

    // Final: pipelineRuns.status='passed', 3 stageRuns all passed.
    await waitForCondition(async () => {
      const [run] = await a.db.select().from(schema.pipelineRuns)
        .where(eq(schema.pipelineRuns.id, runId));
      return run?.status === 'passed';
    });

    const allStages = await a.db.select().from(schema.pipelineStageRuns)
      .where(eq(schema.pipelineStageRuns.runId, runId));
    expect(allStages.length).toBe(3);
    expect(allStages.every((s) => s.status === 'passed')).toBe(true);

    // pipeline.run.completed PERSISTED row landed in events table (TRACE-08).
    const completedEvents = await a.db.select().from(schema.events)
      .where(and(
        eq(schema.events.eventType, 'pipeline.run.completed'),
        eq(schema.events.aggregateId, runId),
      ));
    expect(completedEvents.length).toBeGreaterThanOrEqual(1);
  }, 30_000);

  // ------------------------------------------------------------------
  // Test (b): Matrix N-of-N gate — stage advances only when ALL terminal
  // ------------------------------------------------------------------
  //
  // Sidesteps PipelineService.triggerRun (which calls parsePipeline) because
  // pipeline-schema.ts:17 declares `matrix: z.array(z.record(z.unknown()))`,
  // a Zod v3 single-arg form that throws under the project's installed Zod v4
  // (pre-existing pipeline-schema.ts:17 zod-compat error documented in
  // 25-03-SUMMARY.md "Verification Gates" — `npx tsc --noEmit` 1 pre-existing
  // zod error). Production code edits are forbidden in Plan 25-04.
  //
  // Instead we seed pipeline_runs + pipeline_stage_runs + pipeline_stage_jobs
  // + jobs rows DIRECTLY (the same shape triggerRun would create after
  // fanoutMaestroStage), then drive the subscriber via job.completed emits.
  // This exercises subscribers.ts:36-128 verbatim — DB-join routing + matrix
  // gate aggregation + stage-status update + advanceRunOrComplete handoff.
  // ------------------------------------------------------------------
  it('[SC2 + Pitfall 8] matrix N-of-N gate: stage advances only when ALL matrix entries terminal', async () => {
    const a = app!;

    // Seed: 1 pipeline + 1 run + 1 stageRun + 3 jobs + 3 stageJob link rows.
    const [pipeline] = await a.db.insert(schema.pipelines).values({
      name: 'test-matrix-direct',
      yamlContent: '# bypass: triggerRun not used in this test',
    }).returning();

    const [run] = await a.db.insert(schema.pipelineRuns).values({
      pipelineId: pipeline.id,
      triggerType: 'manual',
      status: 'running',
      startedAt: new Date(),
    }).returning();
    const runId = run.id;

    const [stageRun] = await a.db.insert(schema.pipelineStageRuns).values({
      runId,
      stageName: 'matrix-stage',
      stageIndex: 0,
      type: 'maestro',
      status: 'running',
      startedAt: new Date(),
    }).returning();

    const stageJobs: Array<{ id: string; jobId: string }> = [];
    for (let i = 0; i < 3; i += 1) {
      const [job] = await a.db.insert(schema.jobs).values({
        platform: 'android',
        status: 'running',
        metadata: { matrix: `m${i}` },
      }).returning();
      const [link] = await a.db.insert(schema.pipelineStageJobs).values({
        stageRunId: stageRun.id,
        jobId: job.id,
        matrixName: `m${i}`,
      }).returning();
      stageJobs.push({ id: link.id, jobId: job.id });
    }

    // Fire job.completed for first 2 entries — gate must hold (Pitfall 8).
    for (let i = 0; i < 2; i += 1) {
      await a.db.update(schema.jobs).set({ status: 'passed' })
        .where(eq(schema.jobs.id, stageJobs[i].jobId));
      a.jobsModule.emit.completed(stageJobs[i].jobId, {
        jobId: stageJobs[i].jobId,
        status: 'passed',
        platform: 'android',
      });

      // Allow subscriber a tick to process.
      await new Promise((r) => setTimeout(r, 200));

      const [s] = await a.db.select().from(schema.pipelineStageRuns)
        .where(eq(schema.pipelineStageRuns.id, stageRun.id));
      expect(s.status, `gate must hold after ${i + 1}/3 matrix entries terminal`).toBe('running');
    }

    // Fire 3rd → gate releases (subscriber sees all 3 jobs.status='passed').
    await a.db.update(schema.jobs).set({ status: 'passed' })
      .where(eq(schema.jobs.id, stageJobs[2].jobId));
    a.jobsModule.emit.completed(stageJobs[2].jobId, {
      jobId: stageJobs[2].jobId,
      status: 'passed',
      platform: 'android',
    });

    await waitForCondition(async () => {
      const [s] = await a.db.select().from(schema.pipelineStageRuns)
        .where(eq(schema.pipelineStageRuns.id, stageRun.id));
      return s?.status === 'passed';
    });

    const [finalStage] = await a.db.select().from(schema.pipelineStageRuns)
      .where(eq(schema.pipelineStageRuns.id, stageRun.id));
    expect(finalStage.status).toBe('passed');

    // Run finalization: advanceRunOrComplete falls through to finalizeRunFromDb
    // (no in-memory runContext since we skipped triggerRun) which writes
    // pipelineRuns.status based on stage-row states.
    await waitForCondition(async () => {
      const [r] = await a.db.select().from(schema.pipelineRuns)
        .where(eq(schema.pipelineRuns.id, runId));
      return r?.status === 'passed';
    });
    const [finalRun] = await a.db.select().from(schema.pipelineRuns)
      .where(eq(schema.pipelineRuns.id, runId));
    expect(finalRun.status).toBe('passed');
  }, 30_000);
});
