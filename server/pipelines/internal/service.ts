/**
 * Pipelines service — REWRITTEN for Plan 25-03 bus-driven stage advancement.
 *
 * Key changes from pre-rewrite:
 *   - executeRun() Promise-chain DELETED (was lines 198-380)
 *   - Polling loop (3s setTimeout) DELETED (was lines 523-539)
 *   - triggerRun() now INSERTs run row + first stage + enqueues first stage's
 *     job(s); returns immediately. Stage advancement lives in subscribers.ts.
 *   - runningRuns Map<runId, AbortController> PRESERVED for in-process script
 *     stage cancellation (DEFERRED-25-C).
 *   - deletePipeline() EXTENDED with Pitfall 3 cascade — child schedules are
 *     unscheduled before pipelines row deletion to prevent orphan pgboss
 *     schedules.
 *   - advanceRunOrComplete() NEW — invoked by subscribers.ts on matrix-complete
 *     stage gate AND by service.startStage on script-stage completion.
 */

/**
 * Thrown by triggerRun() when the concurrency cap is reached and the trigger
 * is NOT from the schedule path (which re-enqueues via pg-boss instead).
 *
 * Callers (e.g. the azure-pr webhook path) should catch this and return an
 * appropriate response to the upstream caller (HTTP 503 + Retry-After so
 * Azure DevOps Service Hooks retries automatically).
 */
export class ConcurrencyDeferredError extends Error {
  readonly kind = 'concurrency-deferred' as const;
  constructor() {
    super('concurrency cap reached; retry later');
    this.name = 'ConcurrencyDeferredError';
  }
}
import { eq, desc, and, inArray } from 'drizzle-orm';
import type pino from 'pino';
import type { PgBoss } from 'pg-boss';
import type { Database } from '../../db/index.js';
import * as schema from '../../db/schema.js';
import { parsePipeline } from './parser.js';
import { PipelineExecutor } from './executor.js';
import type { PipelineBroadcaster, PipelineMessage } from './broadcaster.js';
import type { PipelineDef, StageDef } from './pipeline-schema.js';
import { interpolateVariables } from './variables.js';
import type { JobService } from '../../jobs/job-service.js';
import type { GitService } from './git-service.js';
import type { SecretsService } from './secrets.js';
import type { PipelinesEmitters } from '../events.js';
import { removePipelineSchedule, PIPELINE_SCHEDULED_EXECUTE_QUEUE_NAME } from '../queue.js';
import { runDeviceStreamScript } from './device-stream-executor.js';
import { runInternalCloneStage } from './internal-clone-executor.js';
import { runInternalReleaseStage } from './internal-release-executor.js';
import type { ConcurrencyGuard } from './concurrency-guard.js';
import type { Platform } from '../../types/index.js';

/**
 * Minimal pool surface used by pipeline stages (device-stream-script + internal-release).
 * Modeled on server/pool/pool-manager.ts. Kept as a structural interface so tests
 * can inject fakes without depending on the full PoolManager class.
 */
export interface PipelinePoolAdapter {
  allocate(platform: Platform, jobId: string): Promise<{ id: string; emulatorId: string; port: number | null; platform: Platform } | null>;
  release(deviceId: string): Promise<void>;
}

/**
 * PR-bot context attached to a run at triggerRun time. Sourced from
 * `config.azure_devops.pat` + the parsed `device-script` block account at PR
 * webhook handling time.
 *
 * `repoId` and `projectId` are the Azure DevOps repository/project UUIDs from
 * the webhook payload (`resource.repository.id` / `resource.repository.project.id`).
 * `suites` is the list of test-suite names from the parsed `device-script` block.
 * All three are stashed in `pipelineRuns.variables` at run-creation time so the
 * PR-commenter subscriber can reconstruct comment content without re-reading the
 * webhook envelope.
 */
export interface AzurePrRunContext {
  integrationId: string;
  pat: string;
  account: string;
  /** Azure DevOps repository UUID — sourced from webhook resource.repository.id. */
  repoId: string;
  /** Azure DevOps project UUID — sourced from webhook resource.repository.project.id. */
  projectId: string;
  /** Suite names from the parsed device-script block. */
  suites: string[];
}

/**
 * Per-run mutable state used by startStage / advanceRunOrComplete to thread
 * pipeline-definition + variables + clone dir without re-parsing the YAML
 * each call. Stored in-memory keyed by runId; cleaned up at terminal
 * advanceRunOrComplete.
 */
interface RunContext {
  pipeline: PipelineDef;
  variables: Record<string, string>;
  workDir: string;
  cloneDir: string | null;
  hasFailures: boolean;
  startedAt: number;
  /** Env vars exported by internal-clone / device-stream-script stages. */
  exportedEnv?: Record<string, string>;
  /**
   * Secret values exported by earlier stages (e.g. the internal-clone PASSWORD)
   * that must be masked in every subsequent stage's log lines. Seeded into each
   * newly created InterStageEnvParser's secretValues.
   */
  secretValues?: Set<string>;
  /** Device allocated for this run (used by device-stream-script + internal-release). */
  allocatedDevice?: { id: string; platform: Platform; emulatorId: string } | null;
  /**
   * PR-bot context (PAT + account + integrationId). Set when triggerRun is
   * invoked from the azure module's PR webhook path. Used by:
   *   - internal-clone: account → config.js USERNAMES lookup
   *   - source clone (this.gitService.clone): pat → patInline
   */
  azurePrContext?: AzurePrRunContext;
}

export class PipelineService {
  private readonly db: Database;
  private readonly logger: pino.Logger;
  private readonly executor: PipelineExecutor;
  private readonly broadcaster: PipelineBroadcaster;
  /**
   * In-process AbortController per running run (DEFERRED-25-C). Used by
   * cancelRun() for script-stage SIGTERM. Subscribers also read pipelineRuns.status
   * to short-circuit advancement when status='cancelled'.
   */
  private readonly runningRuns: Map<string, AbortController> = new Map();
  private readonly runContexts: Map<string, RunContext> = new Map();
  private readonly boss: PgBoss | undefined;
  private readonly emit: PipelinesEmitters | undefined;

  constructor(
    db: Database,
    logger: pino.Logger,
    broadcaster: PipelineBroadcaster,
    private readonly jobService?: JobService,
    private readonly gitService?: GitService,
    private readonly secretsService?: SecretsService,
    emit?: PipelinesEmitters,
    boss?: PgBoss,
    private readonly concurrencyGuard?: ConcurrencyGuard,
    private readonly pool?: PipelinePoolAdapter,
  ) {
    this.db = db;
    this.logger = logger.child({ component: 'pipeline-service' });
    this.executor = new PipelineExecutor(logger);
    this.broadcaster = broadcaster;
    this.emit = emit;
    this.boss = boss;
  }

  async createPipeline(yamlContent: string): Promise<{ id: string; name: string }> {
    const parsed = parsePipeline(yamlContent);
    if (!parsed.success) {
      throw new Error(`Invalid pipeline YAML: ${parsed.error}`);
    }

    const [row] = await this.db
      .insert(schema.pipelines)
      .values({
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        yamlContent,
      })
      .returning();

    this.logger.info({ pipelineId: row.id, name: row.name }, 'Pipeline created');
    return { id: row.id, name: row.name };
  }

  async updatePipeline(id: string, yamlContent: string): Promise<void> {
    const parsed = parsePipeline(yamlContent);
    if (!parsed.success) {
      throw new Error(`Invalid pipeline YAML: ${parsed.error}`);
    }

    await this.db
      .update(schema.pipelines)
      .set({ name: parsed.data.name, description: parsed.data.description ?? null, yamlContent, updatedAt: new Date() })
      .where(eq(schema.pipelines.id, id));
  }

  async getPipeline(id: string) {
    const [row] = await this.db
      .select()
      .from(schema.pipelines)
      .where(eq(schema.pipelines.id, id));
    return row ?? null;
  }

  async getPipelineByName(name: string) {
    const [row] = await this.db
      .select()
      .from(schema.pipelines)
      .where(eq(schema.pipelines.name, name));
    return row ?? null;
  }

  async listPipelines() {
    return this.db
      .select()
      .from(schema.pipelines)
      .orderBy(desc(schema.pipelines.updatedAt));
  }

  /**
   * Pitfall 3 cascade — unschedule each child pipelineSchedules row's pgboss
   * schedule BEFORE deleting the pipelines row. Without this, deleted
   * pipelines leave orphan pg-boss schedules that fire forever.
   */
  async deletePipeline(id: string): Promise<void> {
    if (this.boss) {
      const childSchedules = await this.db
        .select({ id: schema.pipelineSchedules.id })
        .from(schema.pipelineSchedules)
        .where(eq(schema.pipelineSchedules.pipelineId, id));

      for (const s of childSchedules) {
        try {
          await removePipelineSchedule({ boss: this.boss, scheduleId: s.id });
        } catch (err) {
          this.logger.warn({ err, scheduleId: s.id }, 'removePipelineSchedule failed during deletePipeline cascade');
        }
      }
    }

    await this.db.delete(schema.pipelineSchedules).where(eq(schema.pipelineSchedules.pipelineId, id));
    await this.db.delete(schema.pipelines).where(eq(schema.pipelines.id, id));
  }

  // ── Schedule CRUD ──────────────────────────────────────────

  async createSchedule(pipelineId: string, cronExpression: string, variables: Record<string, string> = {}, enabled = true): Promise<{ id: string }> {
    const [row] = await this.db
      .insert(schema.pipelineSchedules)
      .values({ pipelineId, cronExpression, enabled, variables })
      .returning();
    return { id: row.id };
  }

  async listSchedules(pipelineId: string) {
    return this.db
      .select()
      .from(schema.pipelineSchedules)
      .where(eq(schema.pipelineSchedules.pipelineId, pipelineId));
  }

  async updateSchedule(id: string, updates: { cronExpression?: string; enabled?: boolean; variables?: Record<string, string> }): Promise<void> {
    await this.db
      .update(schema.pipelineSchedules)
      .set(updates)
      .where(eq(schema.pipelineSchedules.id, id));
  }

  async deleteSchedule(id: string): Promise<void> {
    await this.db
      .delete(schema.pipelineSchedules)
      .where(eq(schema.pipelineSchedules.id, id));
  }

  /**
   * Synchronously bootstraps a pipeline run:
   *   1. Loads + parses pipeline definition
   *   2. INSERTs pipeline_runs row (status='running')
   *   3. Emits pipeline.run.started
   *   4. Starts the first stage via startStage()
   *   5. Returns the runId
   *
   * Stage advancement now lives in subscribers.ts (job.completed handler).
   * For script stages, advancement happens inside startStage when the script
   * promise resolves (no job.completed fires for script stages).
   */
  async triggerRun(
    pipelineId: string,
    triggerType: 'api' | 'schedule' | 'manual' | 'azure-pr',
    variables: Record<string, string>,
    _deferPayload?: { scheduleId: string },
    azurePrContext?: AzurePrRunContext,
  ): Promise<string> {
    // Concurrency admission check — defer if running count >= cap.
    if (this.concurrencyGuard) {
      const ok = await this.concurrencyGuard.canAdmit();
      if (!ok) {
        this.logger.info({ pipelineId }, 'admission deferred: concurrency cap');
        if (this.boss && _deferPayload?.scheduleId) {
          // Schedule path: re-enqueue to the same queue with a 5 s delay.
          await this.boss.send(
            PIPELINE_SCHEDULED_EXECUTE_QUEUE_NAME,
            { pipelineId, scheduleId: _deferPayload.scheduleId, variables },
            { startAfter: 5 } as never,
          );
          return '';
        }
        // Non-schedule paths (azure-pr, api): throw so callers can signal the
        // upstream requester explicitly (e.g. HTTP 503 + Retry-After).
        throw new ConcurrencyDeferredError();
      }
    }

    const pipeline = await this.getPipeline(pipelineId);
    if (!pipeline) throw new Error(`Pipeline ${pipelineId} not found`);

    const parsed = parsePipeline(pipeline.yamlContent);
    if (!parsed.success) throw new Error(`Pipeline YAML invalid: ${parsed.error}`);

    // Stash PR-bot context fields (repoId, projectId, suites) in the variables
    // JSONB so the PR-commenter event subscriber can reconstruct comment
    // content from the run row without re-reading the webhook envelope.
    const persistedVariables: Record<string, unknown> = { ...variables };
    if (azurePrContext) {
      persistedVariables.__azureRepoId     = azurePrContext.repoId;
      persistedVariables.__azureProjectId  = azurePrContext.projectId;
      persistedVariables.__azureSuites     = azurePrContext.suites;
    }

    const [run] = await this.db
      .insert(schema.pipelineRuns)
      .values({
        pipelineId,
        triggerType,
        status: 'running',
        variables: persistedVariables,
        startedAt: new Date(),
        sourceBranch: variables.branch ?? null,
        sourceCommit: variables.commit_sha ?? null,
        azurePrId: variables.pr_number ?? null,
        azurePrUrl: variables.pr_url ?? null,
        azurePrIntegrationId: azurePrContext?.integrationId ?? null,
      })
      .returning();

    const mergedVars: Record<string, string> = {
      ...(parsed.data.variables ?? {}),
      ...variables,
      pipeline_id: run.id,
      run_id: run.id,
    };

    let workDir = process.cwd();
    let cloneDir: string | null = null;

    // Source clone (synchronous before first stage; failure terminates run).
    if (parsed.data.source && this.gitService) {
      try {
        const branch = interpolateVariables(parsed.data.source.branch, mergedVars);
        this.emitStageEvent(run.id, 'stage_log', { stage: '_source', line: `Cloning ${parsed.data.source.repo} @ ${branch}...` });

        const result = await this.gitService.clone({
          repo: parsed.data.source.repo,
          branch,
          patSecret: parsed.data.source.pat_secret,
          // PR-bot path: PAT is sourced from server config, not the YAML
          // template (template-builder.ts intentionally omits pat_secret).
          patInline: azurePrContext?.pat,
        });

        workDir = result.workDir;
        cloneDir = result.workDir;
        mergedVars.source_commit = result.commit;
        mergedVars.work_dir = workDir;

        await this.db
          .update(schema.pipelineRuns)
          .set({ sourceCommit: result.commit })
          .where(eq(schema.pipelineRuns.id, run.id));

        this.emitStageEvent(run.id, 'stage_log', { stage: '_source', line: `Cloned at ${result.commit.substring(0, 8)}` });
      } catch (err: any) {
        this.logger.error({ runId: run.id, error: err.message }, 'Source checkout failed');
        await this.db
          .update(schema.pipelineRuns)
          .set({ status: 'failed' as any, finishedAt: new Date(), errorMessage: `Source checkout failed: ${err.message}` })
          .where(eq(schema.pipelineRuns.id, run.id));
        this.emitStageEvent(run.id, 'run_end', { status: 'failed', error: err.message });
        this.broadcaster.cleanup(run.id);
        if (this.emit) {
          this.emit.runFailed(run.id, {
            runId: run.id,
            pipelineId,
            reason: `Source checkout failed: ${err.message}`,
            failedStageIndex: null,
          });
        }
        return run.id;
      }
    }

    // Stash run context for subscriber + script-stage advancement.
    const ctx: RunContext = {
      pipeline: parsed.data,
      variables: mergedVars,
      workDir,
      cloneDir,
      hasFailures: false,
      startedAt: Date.now(),
      azurePrContext,
    };
    this.runContexts.set(run.id, ctx);

    // AbortController for in-process script-stage cancellation.
    const abortController = new AbortController();
    this.runningRuns.set(run.id, abortController);

    if (this.emit) {
      this.emit.runStarted(run.id, { runId: run.id, pipelineId, triggerType });
    }

    // Kick off first stage. startStage handles maestro vs script + skipping.
    await this.startStage(run.id, 0).catch((err: any) => {
      this.logger.error({ runId: run.id, error: err.message }, 'startStage threw at index 0');
    });

    return run.id;
  }

  async cancelRun(runId: string): Promise<void> {
    const controller = this.runningRuns.get(runId);
    if (controller) {
      controller.abort();
    }
    // Synchronous DB write — subscribers read pipelineRuns.status before
    // advancing, so this acts as the cancellation gate for matrix-complete
    // job.completed events.
    await this.db
      .update(schema.pipelineRuns)
      .set({ status: 'cancelled', finishedAt: new Date() })
      .where(eq(schema.pipelineRuns.id, runId));
  }

  async getByName(name: string): Promise<{ id: string; name: string } | null> {
    const [row] = await this.db
      .select()
      .from(schema.pipelines)
      .where(eq(schema.pipelines.name, name))
      .limit(1);
    return row ? { id: row.id, name: row.name } : null;
  }

  async attachPrMetadata(runId: string, meta: {
    prId: string; prUrl: string; sourceBranch: string; sourceCommit: string; integrationId: string;
  }): Promise<void> {
    await this.db
      .update(schema.pipelineRuns)
      .set({
        azurePrId: meta.prId,
        azurePrUrl: meta.prUrl,
        sourceBranch: meta.sourceBranch,
        sourceCommit: meta.sourceCommit,
        azurePrIntegrationId: meta.integrationId,
      })
      .where(eq(schema.pipelineRuns.id, runId));
  }

  async cancelRunsByPrId(prId: string, reason: string): Promise<number> {
    const activeRuns = await this.db
      .select({ id: schema.pipelineRuns.id })
      .from(schema.pipelineRuns)
      .where(
        and(
          eq(schema.pipelineRuns.azurePrId, prId),
          inArray(schema.pipelineRuns.status, ['pending', 'running']),
        ),
      );

    for (const r of activeRuns) {
      const ctrl = this.runningRuns.get(r.id);
      if (ctrl) ctrl.abort();
      await this.db
        .update(schema.pipelineRuns)
        .set({ status: 'cancelled', errorMessage: reason, finishedAt: new Date() })
        .where(eq(schema.pipelineRuns.id, r.id));
    }

    return activeRuns.length;
  }

  async getRun(runId: string) {
    const [run] = await this.db
      .select()
      .from(schema.pipelineRuns)
      .where(eq(schema.pipelineRuns.id, runId));

    if (!run) return null;

    const stages = await this.db
      .select()
      .from(schema.pipelineStageRuns)
      .where(eq(schema.pipelineStageRuns.runId, runId));

    return { ...run, stages };
  }

  async listRuns(pipelineId?: string) {
    if (pipelineId) {
      return this.db
        .select()
        .from(schema.pipelineRuns)
        .where(eq(schema.pipelineRuns.pipelineId, pipelineId))
        .orderBy(desc(schema.pipelineRuns.startedAt))
        .limit(50);
    }
    return this.db
      .select()
      .from(schema.pipelineRuns)
      .orderBy(desc(schema.pipelineRuns.startedAt))
      .limit(50);
  }

  /**
   * Start (or skip) the stage at `stageIndex`. Behaviour split:
   *   - If when-condition fails → INSERT skipped row, recurse to advance.
   *   - If type='maestro' → INSERT pipeline_stage_runs row + fanout matrix
   *     job(s) + INSERT pipeline_stage_jobs link rows. Returns; subscriber
   *     advances on N-of-N job.completed gate.
   *   - If type='script' → INSERT pipeline_stage_runs row + spawn bash via
   *     executor.executeScript. On script completion, calls
   *     advanceRunOrComplete directly (script stages don't fire job.completed).
   */
  async startStage(runId: string, stageIndex: number): Promise<void> {
    const ctx = this.runContexts.get(runId);
    if (!ctx) {
      this.logger.warn({ runId, stageIndex }, 'startStage: no run context');
      return;
    }

    const stages = ctx.pipeline.stages;
    if (stageIndex >= stages.length) {
      // No more stages — finalize.
      await this.finalizeRun(runId);
      return;
    }

    const stage = stages[stageIndex];

    // when-condition gate
    if (!this.executor.evaluateCondition(stage.when ?? 'success', ctx.hasFailures)) {
      await this.insertSkippedStage(runId, stage.name, stageIndex, stage.type ?? 'script');
      this.emitStageEvent(runId, 'stage_end', { stage: stage.name, index: stageIndex, status: 'skipped' });
      // Skipped stages do NOT change hasFailures. Advance to next.
      await this.startStage(runId, stageIndex + 1);
      return;
    }

    const [stageRun] = await this.db
      .insert(schema.pipelineStageRuns)
      .values({
        runId,
        stageName: stage.name,
        stageIndex,
        type: (stage.type ?? 'script') as any,
        status: 'running',
        startedAt: new Date(),
      })
      .returning();

    this.emitStageEvent(runId, 'stage_start', { stage: stage.name, index: stageIndex });

    if (stage.type === 'maestro') {
      if (!this.jobService) {
        await this.updateStageRecord(stageRun.id, 'failed', null, 'JobService not available for maestro stages');
        ctx.hasFailures = true;
        this.emitStageEvent(runId, 'stage_end', { stage: stage.name, index: stageIndex, status: 'failed' });
        await this.startStage(runId, stageIndex + 1);
        return;
      }

      try {
        await this.fanoutMaestroStage(runId, stageRun.id, stage, ctx);
        // Subscriber takes over on N-of-N job.completed gate.
      } catch (err: any) {
        this.logger.error({ runId, error: err.message }, 'Maestro stage fanout failed');
        await this.updateStageRecord(stageRun.id, 'failed', null, `Fanout failed: ${err.message}`);
        ctx.hasFailures = true;
        this.emitStageEvent(runId, 'stage_end', { stage: stage.name, index: stageIndex, status: 'failed' });
        await this.startStage(runId, stageIndex + 1);
      }
      return;
    }

    // internal-clone stage
    if (stage.type === 'internal-clone') {
      try {
        if (!ctx.workDir) throw new Error('internal-clone: no workspace dir on run context');
        const account = ctx.azurePrContext?.account ?? '';
        const r = await runInternalCloneStage({
          workDir: ctx.workDir,
          account,
          onExport: (k, v, o) => {
            ctx.exportedEnv = { ...(ctx.exportedEnv ?? {}), [k]: v };
            if (o?.secret) (ctx.secretValues ??= new Set<string>()).add(v);
          },
          logger: this.logger,
        });
        if (!r.ok) throw new Error(r.error ?? 'internal-clone failed');
        await this.updateStageRecord(stageRun.id, 'passed', null);
        this.emitStageEvent(runId, 'stage_end', { stage: stage.name, index: stageIndex, status: 'passed' });
      } catch (err: any) {
        this.logger.error({ runId, error: err.message }, 'internal-clone stage failed');
        await this.updateStageRecord(stageRun.id, 'failed', null, err.message);
        ctx.hasFailures = true;
        this.emitStageEvent(runId, 'stage_end', { stage: stage.name, index: stageIndex, status: 'failed' });
      }
      await this.startStage(runId, stageIndex + 1);
      return;
    }

    // device-stream-script stage
    if (stage.type === 'device-stream-script') {
      try {
        if (!ctx.workDir) throw new Error('device-stream-script: no workspace dir');

        // Allocate a device for this run if one is not already pinned. The
        // device is reused by subsequent internal-release; maestro stages
        // still allocate independently via the jobs service today (see
        // fanoutMaestroStage).
        const platform = (stage.platform ?? 'android') as Platform;
        if (!ctx.allocatedDevice) {
          if (!this.pool) {
            throw new Error('device-stream-script: pool adapter not configured on PipelineService');
          }
          const dev = await this.pool.allocate(platform, `pipeline-run-${runId}`);
          if (!dev) {
            throw new Error(`device-stream-script: no idle ${platform} device available`);
          }
          // Synthesize an adb serial mirroring jobs/internal/executor.ts behaviour.
          const serial = dev.port != null ? `emulator-${dev.port}` : dev.emulatorId;
          ctx.allocatedDevice = { id: dev.id, platform: dev.platform, emulatorId: serial };
          this.emitStageEvent(runId, 'stage_log', {
            stage: stage.name,
            line: `Allocated ${platform} device ${dev.id} (${serial})`,
          });
        }

        const env = {
          ...(ctx.exportedEnv ?? {}),
          ...(stage.env ?? {}),
          DEVICE_SERIAL: ctx.allocatedDevice.emulatorId,
          DEVICE_PLATFORM: ctx.allocatedDevice.platform,
        };
        const r = await runDeviceStreamScript({
          workspaceDir: ctx.workDir,
          scriptPath: stage.script_path!,
          env,
          timeoutSec: stage.timeout,
          onLog: (line) => this.emitStageEvent(runId, 'stage_log', { stage: stage.name, line }),
          onExport: (k, v, o) => {
            ctx.exportedEnv = { ...(ctx.exportedEnv ?? {}), [k]: v };
            if (o?.secret) (ctx.secretValues ??= new Set<string>()).add(v);
          },
          secretValues: ctx.secretValues ? [...ctx.secretValues] : undefined,
          logger: this.logger,
        });
        if (!r.ok) throw new Error(r.error ?? 'device-stream-script failed');
        await this.updateStageRecord(stageRun.id, 'passed', null);
        this.emitStageEvent(runId, 'stage_end', { stage: stage.name, index: stageIndex, status: 'passed' });
      } catch (err: any) {
        this.logger.error({ runId, error: err.message }, 'device-stream-script stage failed');
        await this.updateStageRecord(stageRun.id, 'failed', null, err.message);
        ctx.hasFailures = true;
        this.emitStageEvent(runId, 'stage_end', { stage: stage.name, index: stageIndex, status: 'failed' });
      }
      await this.startStage(runId, stageIndex + 1);
      return;
    }

    // internal-release stage
    if (stage.type === 'internal-release') {
      const poolAdapter: { release(deviceId: string): Promise<void> } = this.pool
        ? { release: (id) => this.pool!.release(id) }
        : { release: async () => { /* no pool configured (test/dev) — noop */ } };
      await runInternalReleaseStage({
        device: ctx.allocatedDevice ? { id: ctx.allocatedDevice.id } : null,
        workDir: ctx.workDir ?? null,
        pool: poolAdapter,
        logger: this.logger,
      });
      // Mark the device as released on context so finalizeRun's cleanup path
      // does not double-release (and so subsequent observability tooling
      // sees the device-allocation lifecycle terminated cleanly).
      ctx.allocatedDevice = null;
      await this.updateStageRecord(stageRun.id, 'passed', null);
      this.emitStageEvent(runId, 'stage_end', { stage: stage.name, index: stageIndex, status: 'passed' });
      await this.startStage(runId, stageIndex + 1);
      return;
    }

    // Script stage — runs in-process; advance directly on completion.
    if (!stage.script) {
      await this.updateStageRecord(stageRun.id, 'failed', null, 'Script stage has no script defined');
      ctx.hasFailures = true;
      this.emitStageEvent(runId, 'stage_end', { stage: stage.name, index: stageIndex, status: 'failed' });
      await this.startStage(runId, stageIndex + 1);
      return;
    }

    const abortController = this.runningRuns.get(runId);
    const result = await this.executor.executeScript({
      script: stage.script,
      workDir: ctx.workDir,
      variables: ctx.variables,
      timeoutMs: (stage.timeout ?? 300) * 1000,
      onLog: (line) => {
        this.emitStageEvent(runId, 'stage_log', { stage: stage.name, line });
      },
      signal: abortController?.signal,
    });

    await this.updateStageRecord(stageRun.id, result.status, result.logs, result.error);
    this.emitStageEvent(runId, 'stage_end', {
      stage: stage.name,
      index: stageIndex,
      status: result.status,
      durationMs: result.durationMs,
    });
    if (this.emit) {
      this.emit.stageAdvanced(runId, {
        runId,
        stageIndex,
        stageName: stage.name,
        status: result.status,
      });
    }

    if (result.status === 'failed') {
      ctx.hasFailures = true;
    }

    // Check cancellation before advancing.
    const [runRow] = await this.db
      .select({ status: schema.pipelineRuns.status })
      .from(schema.pipelineRuns)
      .where(eq(schema.pipelineRuns.id, runId));
    if (runRow?.status === 'cancelled') {
      await this.finalizeRun(runId);
      return;
    }

    await this.startStage(runId, stageIndex + 1);
  }

  /**
   * Called by subscribers.ts after the N-of-N matrix gate satisfies. Reads
   * the runContext for next-stage lookup, advances or finalizes.
   *
   * Also called internally by script-stage completion path (via startStage
   * recursion) — kept for symmetry with subscriber-driven flow.
   */
  async advanceRunOrComplete(runId: string, completedStageIndex: number, stageStatus: 'passed' | 'failed'): Promise<void> {
    const ctx = this.runContexts.get(runId);
    if (!ctx) {
      // No in-memory context — likely a process restart mid-run. Best-effort:
      // finalize from DB state.
      this.logger.warn({ runId, completedStageIndex }, 'advanceRunOrComplete: no run context; finalizing');
      await this.finalizeRunFromDb(runId);
      return;
    }

    if (stageStatus === 'failed') ctx.hasFailures = true;

    // Cancellation check.
    const [runRow] = await this.db
      .select({ status: schema.pipelineRuns.status })
      .from(schema.pipelineRuns)
      .where(eq(schema.pipelineRuns.id, runId));
    if (runRow?.status === 'cancelled') {
      await this.finalizeRun(runId);
      return;
    }

    const nextIndex = completedStageIndex + 1;
    if (nextIndex >= ctx.pipeline.stages.length) {
      await this.finalizeRun(runId);
      return;
    }

    await this.startStage(runId, nextIndex);
  }

  /**
   * Finalize the run: write terminal status, emit completion event, cleanup
   * broadcaster + clone dir, drop in-memory state.
   */
  private async finalizeRun(runId: string): Promise<void> {
    const ctx = this.runContexts.get(runId);
    const abort = this.runningRuns.get(runId);
    this.runningRuns.delete(runId);
    this.runContexts.delete(runId);

    const [currentRun] = await this.db
      .select({ status: schema.pipelineRuns.status, pipelineId: schema.pipelineRuns.pipelineId })
      .from(schema.pipelineRuns)
      .where(eq(schema.pipelineRuns.id, runId));

    let finalStatus: 'passed' | 'failed' | 'cancelled';
    if (currentRun?.status === 'cancelled') {
      finalStatus = 'cancelled';
    } else if (abort?.signal.aborted) {
      finalStatus = 'cancelled';
    } else if (ctx?.hasFailures) {
      finalStatus = 'failed';
    } else {
      finalStatus = 'passed';
    }

    await this.db
      .update(schema.pipelineRuns)
      .set({ status: finalStatus as any, finishedAt: new Date() })
      .where(eq(schema.pipelineRuns.id, runId));

    this.emitStageEvent(runId, 'run_end', { status: finalStatus });

    if (this.emit && currentRun) {
      const durationMs = ctx ? Date.now() - ctx.startedAt : 0;
      if (finalStatus === 'passed') {
        this.emit.runCompleted(runId, {
          runId,
          pipelineId: currentRun.pipelineId,
          status: 'passed',
          durationMs,
        });
      } else if (finalStatus === 'cancelled') {
        this.emit.runFailed(runId, {
          runId,
          pipelineId: currentRun.pipelineId,
          reason: 'cancelled',
          failedStageIndex: null,
        });
      } else {
        this.emit.runFailed(runId, {
          runId,
          pipelineId: currentRun.pipelineId,
          reason: 'one or more stages failed',
          failedStageIndex: null,
        });
      }
    }

    // Azure DevOps PR comment (best-effort).
    if (ctx && ctx.pipeline.notify?.azure_devops?.comment && ctx.variables.pr_number && ctx.variables.pr_url) {
      this.postAzurePrComment(runId, finalStatus, ctx.pipeline, ctx.variables).catch((err) => {
        this.logger.error({ runId, error: err.message }, 'Failed to post Azure DevOps PR comment');
      });
    }

    this.broadcaster.cleanup(runId);

    // Safety net: if internal-release didn't run (e.g. pipeline lacks the
    // stage, or it was skipped after a prior failure), release the device
    // here so it doesn't leak in 'allocated' state.
    if (ctx?.allocatedDevice && this.pool) {
      const deviceId = ctx.allocatedDevice.id;
      this.pool.release(deviceId).catch((err: any) => {
        this.logger.error({ runId, deviceId, error: err.message }, 'Failed to release allocated device in finalizeRun');
      });
    }

    if (ctx?.cloneDir && this.gitService) {
      this.gitService.cleanup(ctx.cloneDir).catch((err) => {
        this.logger.error({ runId, error: err.message }, 'Failed to cleanup clone dir');
      });
    }
  }

  /**
   * Restart-safety path — finalizeRun without in-memory context. Reads stage
   * statuses from DB to derive run terminal status.
   */
  private async finalizeRunFromDb(runId: string): Promise<void> {
    const stages = await this.db
      .select({ status: schema.pipelineStageRuns.status })
      .from(schema.pipelineStageRuns)
      .where(eq(schema.pipelineStageRuns.runId, runId));

    const anyFailed = stages.some((s) => s.status === 'failed');
    const finalStatus = anyFailed ? 'failed' : 'passed';

    await this.db
      .update(schema.pipelineRuns)
      .set({ status: finalStatus as any, finishedAt: new Date() })
      .where(eq(schema.pipelineRuns.id, runId));

    this.emitStageEvent(runId, 'run_end', { status: finalStatus });
    this.broadcaster.cleanup(runId);
  }

  /**
   * Submits matrix jobs for a maestro stage. Inserts pipeline_stage_jobs link
   * rows so subscribers.ts can join from job.completed → stageRunId → runId.
   * NO polling — subscriber takes over.
   */
  private async fanoutMaestroStage(
    runId: string,
    stageRunId: string,
    stage: StageDef,
    ctx: RunContext,
  ): Promise<void> {
    const platform = stage.platform ?? 'android';
    const flowsDir = stage.flows ? `${ctx.workDir}/${stage.flows}` : ctx.workDir;

    const { readdir, readFile } = await import('node:fs/promises');
    const { join } = await import('node:path');

    let flowFiles: Array<{ filename: string; content: string }> = [];
    const entries = await readdir(flowsDir, { recursive: true });
    for (const entry of entries) {
      const entryStr = String(entry);
      if (entryStr.endsWith('.yaml') || entryStr.endsWith('.yml')) {
        const content = await readFile(join(flowsDir, entryStr), 'utf-8');
        flowFiles.push({ filename: entryStr, content });
      }
    }

    if (flowFiles.length === 0) {
      throw new Error(`No .yaml/.yml flow files found in ${flowsDir}`);
    }

    // Build env from stage config + pipeline variables
    const env: Record<string, string> = {};
    if (stage.env) {
      for (const [k, v] of Object.entries(stage.env)) {
        env[k] = interpolateVariables(String(v), ctx.variables);
      }
    }

    const matrixEntries = stage.matrix && stage.matrix.length > 0
      ? stage.matrix
      : [{ name: 'default' }];

    const metadata: Record<string, unknown> = {
      pipeline_id: ctx.variables.pipeline_id,
      run_id: ctx.variables.run_id,
      stage: stage.name,
    };

    for (const entry of matrixEntries) {
      const matrixName = (entry as any).name ?? 'default';
      const job = await this.jobService!.createJob({
        files: flowFiles,
        metadata: { ...metadata, matrix: matrixName },
        platform: platform as any,
        env,
      });

      this.emitStageEvent(runId, 'job_created', {
        stage: stage.name,
        jobId: job.id,
        matrix: matrixName,
      });

      // Insert pipeline_stage_jobs link row — KEY for subscribers.ts routing.
      await this.db.insert(schema.pipelineStageJobs).values({
        stageRunId,
        jobId: job.id,
        matrixName,
      });
    }
  }

  private async insertSkippedStage(runId: string, stageName: string, stageIndex: number, type: string) {
    await this.db.insert(schema.pipelineStageRuns).values({
      runId,
      stageName,
      stageIndex,
      type: type as any,
      status: 'skipped',
      startedAt: new Date(),
      finishedAt: new Date(),
    });
  }

  private async updateStageRecord(stageRunId: string, status: string, logs: string | null, error?: string) {
    await this.db
      .update(schema.pipelineStageRuns)
      .set({
        status: status as any,
        finishedAt: new Date(),
        logs: logs ? logs.substring(0, 1_000_000) : null,
        errorMessage: error ?? null,
      })
      .where(eq(schema.pipelineStageRuns.id, stageRunId));
  }

  private emitStageEvent(runId: string, type: PipelineMessage['type'], data: Record<string, unknown>) {
    this.broadcaster.emit(runId, {
      type,
      data,
      timestamp: new Date().toISOString(),
    });
  }

  private async postAzurePrComment(
    runId: string,
    status: string,
    pipeline: PipelineDef,
    variables: Record<string, string>,
  ): Promise<void> {
    const prUrl = variables.pr_url;
    if (!prUrl || !pipeline.source?.pat_secret) return;

    const pat = await this.secretsService?.get(pipeline.source.pat_secret);
    if (!pat) {
      this.logger.warn({ runId }, 'PAT secret not found, skipping PR comment');
      return;
    }

    const match = prUrl.match(/dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/([^/]+)\/pullrequest\/(\d+)/);
    if (!match) {
      const prNumber = variables.pr_number;
      const repoUrl = pipeline.source?.repo;
      if (!prNumber || !repoUrl) {
        this.logger.warn({ runId, prUrl }, 'Could not parse Azure DevOps PR URL');
        return;
      }
      const repoMatch = repoUrl.match(/dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/([^/]+)/);
      if (!repoMatch) return;

      await this.postComment(pat, repoMatch[1], repoMatch[2], repoMatch[3], prNumber, runId, status);
      return;
    }

    await this.postComment(pat, match[1], match[2], match[3], match[4], runId, status);
  }

  private async postComment(
    pat: string,
    org: string,
    project: string,
    repo: string,
    prId: string,
    runId: string,
    status: string,
  ): Promise<void> {
    const statusEmoji = status === 'passed' ? 'Passed' : 'Failed';
    const body = `## Device Farm — Pipeline Result\n\n**Status:** ${statusEmoji}\n**Run ID:** ${runId}\n\n[View full results](${process.env.DEVICE_FARM_URL ?? 'http://localhost:3000'}/pipeline-runs/${runId})`;

    const url = `https://dev.azure.com/${org}/${project}/_apis/git/repositories/${repo}/pullRequests/${prId}/threads?api-version=7.1`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${Buffer.from(`:${pat}`).toString('base64')}`,
      },
      body: JSON.stringify({
        comments: [{ parentCommentId: 0, content: body, commentType: 1 }],
        status: 1,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Azure DevOps API returned ${response.status}: ${text.substring(0, 200)}`);
    }

    this.logger.info({ runId, org, project, prId }, 'Posted PR comment to Azure DevOps');
  }
}
