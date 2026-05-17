/**
 * Pipelines stage-advancement subscriber (Phase 25 Plan 25-03).
 *
 * Subscribes to jobsModule.bus 'job.completed'. On each fire:
 *   1. DB-join from payload.jobId → pipeline_stage_jobs → pipeline_stage_runs → pipeline_runs.
 *      Skip if jobId is not part of any pipeline (no-op).
 *      ROUTING PRIMITIVE: payload.jobId, NOT envelope.correlationId (Pitfall 4 —
 *      sibling requests share correlationId; would cause spurious advances).
 *   2. Matrix N-of-N gate (Pitfall 8): if any pipeline_stage_jobs row for this
 *      stageRunId has a non-terminal jobs.status, return early. Stage advances
 *      only when ALL matrix entries are terminal.
 *   3. Aggregate stage status: every passed → 'passed'; otherwise → 'failed'.
 *      UPDATE pipeline_stage_runs row + emit pipeline.stage.advanced.
 *   4. Read pipelineRuns.status — if 'cancelled' (DEFERRED-25-C), emit run.failed
 *      reason='cancelled'. Otherwise call service.advanceRunOrComplete(runId).
 *
 * MOD-06 (factory-injected deps) + EVENTS-09 (cross-module bus subscriber —
 * subscribes to ANOTHER module's bus via injected jobsModule reference).
 */
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type pino from 'pino';
import * as schema from '../../db/schema.js';
import type { JobsModule } from '../../jobs/index.js';
import type { PipelinesModule } from './module.js';

const TERMINAL_STATUSES = ['passed', 'failed', 'cancelled', 'timeout'];

export interface WireSubscriberDeps {
  fastify: FastifyInstance;
  pipelinesModule: PipelinesModule;
  jobsModule: JobsModule;
  logger: pino.Logger;
}

export function wirePipelinesStageAdvancementSubscriber(
  deps: WireSubscriberDeps,
): () => void {
  const { fastify, pipelinesModule, jobsModule, logger } = deps;
  const log = logger.child({ subscriber: 'pipelines.stage-advancement' });

  // jobsModule.bus is the cross-module bus reference; jobs emits job.completed
  // with payload {jobId, status, platform, summary?}. We use payload.jobId to join.
  const unsub = jobsModule.bus.on('job.completed', async (payload) => {
    try {
      // Step 1: DB join from jobId → stageRunId → runId
      // Pitfall 4: routing primitive is payload.jobId — NEVER envelope.correlationId
      // (sibling requests share correlationId; would cause spurious advances).
      const [match] = await fastify.db
        .select({
          stageRunId: schema.pipelineStageRuns.id,
          runId: schema.pipelineStageRuns.runId,
          stageIndex: schema.pipelineStageRuns.stageIndex,
          stageName: schema.pipelineStageRuns.stageName,
        })
        .from(schema.pipelineStageJobs)
        .innerJoin(
          schema.pipelineStageRuns,
          eq(schema.pipelineStageJobs.stageRunId, schema.pipelineStageRuns.id),
        )
        .where(eq(schema.pipelineStageJobs.jobId, payload.jobId));

      if (!match) return; // not a pipeline-stage job — no-op

      // Step 2: Matrix N-of-N gate (Pitfall 8)
      // Query ALL link rows for this stageRunId; if any underlying job is still
      // non-terminal, wait for the next job.completed fire to retry the gate.
      const matrixState = await fastify.db
        .select({
          jobId: schema.pipelineStageJobs.jobId,
          jobStatus: schema.jobs.status,
        })
        .from(schema.pipelineStageJobs)
        .innerJoin(schema.jobs, eq(schema.pipelineStageJobs.jobId, schema.jobs.id))
        .where(eq(schema.pipelineStageJobs.stageRunId, match.stageRunId));

      const allTerminal = matrixState.every((j) => TERMINAL_STATUSES.includes(j.jobStatus));
      if (!allTerminal) return; // wait for remaining matrix entries

      // Step 3: Aggregate + persist stage status
      const stageStatus: 'passed' | 'failed' = matrixState.every((j) => j.jobStatus === 'passed')
        ? 'passed'
        : 'failed';

      await fastify.db
        .update(schema.pipelineStageRuns)
        .set({ status: stageStatus as never, finishedAt: new Date() })
        .where(eq(schema.pipelineStageRuns.id, match.stageRunId));

      pipelinesModule.emit.stageAdvanced(match.runId, {
        runId: match.runId,
        stageIndex: match.stageIndex,
        stageName: match.stageName,
        status: stageStatus,
      });

      // Step 4: Read run cancellation flag → advance OR mark cancelled
      const [runRow] = await fastify.db
        .select({
          status: schema.pipelineRuns.status,
          pipelineId: schema.pipelineRuns.pipelineId,
        })
        .from(schema.pipelineRuns)
        .where(eq(schema.pipelineRuns.id, match.runId));

      if (runRow?.status === 'cancelled') {
        pipelinesModule.emit.runFailed(match.runId, {
          runId: match.runId,
          pipelineId: runRow.pipelineId,
          reason: 'cancelled',
          failedStageIndex: match.stageIndex,
        });
        return;
      }

      await pipelinesModule.service.advanceRunOrComplete(
        match.runId,
        match.stageIndex,
        stageStatus,
      );
    } catch (err) {
      log.error(
        { err, jobId: payload.jobId },
        'Stage advancement handler failed',
      );
      // Do NOT re-throw — bus handlers should not crash the bus.
    }
  });

  log.info('Pipelines stage-advancement subscriber wired (job.completed)');
  return unsub;
}
