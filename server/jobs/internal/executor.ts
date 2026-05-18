/**
 * Phase 23 Plan 23-04 — Pure execution loop extracted from job-service.ts.
 *
 * This is the worker handler invoked by pg-boss for the `job.execute`
 * queue. The saga shape (chained subscribers) means executor.ts DOES NOT:
 *   - Call .catch(() => {}) — every error path emits job.failed
 *   - Call broadcaster.cleanup — emit job.cleanup.requested instead (subscriber owns)
 *   - Call artifactService.createArtifact — emit maestro.log.written instead
 *   - Call recordingService.stopRecording — emit job.recording.requested (subscriber owns)
 *   - Update jobs.status='allocated' — pool→jobs subscriber writes via device.allocated
 *
 * Executor DOES:
 *   - Read job row via repo.findJobById
 *   - Read job files (jobFiles table) and write them to flow dir
 *   - Allocate device via fastify.pool.allocate (pool emits device.allocated)
 *   - Update jobs.status='running' + emit job.running
 *   - Run JobExecutor (existing class wrapping Maestro CLI)
 *   - Wire log/step/status emits to bridgehead events (Phase 22 unchanged)
 *   - Write maestro.log file + emit maestro.log.written (Phase 21 unchanged)
 *   - Emit job.completed with terminal status (Phase 19 unchanged shape)
 *   - On any throw: emit job.failed with {step, reason}; do NOT re-throw
 */
import { writeFile, stat, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type pino from 'pino';

import * as schema from '../../db/schema.js';
import { bootOptionsSchema } from '../../config/schema.js';
import { JobExecutor } from '../job-executor.js';
import type { JobsModule } from './module.js';
import { findJobById } from './repo.js';
import {
  runParallelDeploy,
  type InstallAndLaunch,
  type ParallelDeployJobInput,
} from './build-once-deploy-n.js';
import { mapStepsForPersistence } from './step-mapper.js';
import { loadCommandTimestamps } from './commands-json-loader.js';

/**
 * Phase 37 Plan 37-04 — type guard for parallel-deploy job metadata.
 *
 * The executor branches on this predicate at the top of `runJob` so the
 * single-device path is unchanged for non-parallel jobs (zero-regression
 * for Phase 23 saga). Exported for direct test coverage (parallel-deploy.spec.ts).
 *
 * Contract: returns true iff metadata has shape `{mode:'parallel-deploy',
 * parallelism: number, ...}`. Any other shape (single mode, missing
 * parallelism, null) returns false → existing single-device path runs.
 */
export function isParallelDeployJob(
  metadata: unknown,
): metadata is { mode: 'parallel-deploy'; parallelism: number; broadcastInput?: boolean } {
  if (!metadata || typeof metadata !== 'object') return false;
  const m = metadata as { mode?: unknown; parallelism?: unknown };
  return m.mode === 'parallel-deploy' && typeof m.parallelism === 'number' && m.parallelism > 0;
}

const TEMP_BASE = '/tmp/device-farm/jobs';
const LOG_BASE = '/tmp/device-farm/logs';

export interface RunJobDeps {
  fastify: FastifyInstance;
  jobsModule: JobsModule;
  logger: pino.Logger;
}

export interface RunningJobEntry {
  abortController: AbortController;
  deviceId: string;
}

/**
 * Worker handler invoked by pg-boss for `job.execute`. Wired by
 * registerJobsExecuteWorker in createJobsModule.
 *
 * NEVER throws — pg-boss retryLimit:0 means a throw would mark the job
 * 'failed' in pg-boss without retry, but the saga error path emits
 * job.failed (persisted) which subscribers handle. We swallow errors at
 * the top level after emitting job.failed so the worker handler returns
 * cleanly and pg-boss does not log unexpected errors.
 */
export async function runJob(
  jobId: string,
  deps: RunJobDeps,
  runningJobs: Map<string, RunningJobEntry>,
): Promise<void> {
  const { fastify, jobsModule, logger } = deps;
  const log = logger.child({ jobId, module: 'jobs.executor' });

  const abortController = new AbortController();
  let deviceId: string | null = null;

  try {
    // ---------- Phase 0: lookup job row ----------
    const row = await findJobById(fastify.db, jobId);
    if (!row) {
      jobsModule.emit.failed(jobId, { jobId, step: 'allocate', reason: 'job row not found' });
      return;
    }

    // ---------- Phase 37 Plan 37-04 — parallel-deploy branch ----------
    // When job.metadata.mode === 'parallel-deploy', dispatch to
    // runParallelDeploy (kittyfarm BuildPlayRunner.swift port) and SKIP the
    // single-device allocate/run path below. The cap check (Pitfall 9) was
    // enforced at the route layer BEFORE enqueueing; this branch trusts the
    // metadata. runParallelDeploy uses Promise.allSettled so per-device
    // failures don't roll back successful sends.
    if (isParallelDeployJob(row.metadata)) {
      const poolModule = (fastify as FastifyInstance & {
        poolModule?: { allocateMany: import('../../pool/index.js').PoolModule['allocateMany'] };
      }).poolModule;
      if (!poolModule || typeof poolModule.allocateMany !== 'function') {
        jobsModule.emit.failed(jobId, {
          jobId,
          step: 'allocate',
          reason: 'parallel-deploy requested but poolModule.allocateMany is not available',
        });
        return;
      }

      // Read flow files (same shape as single-device path) — Maestro flow
      // content goes into runParallelDeploy.maestroFlow as a multi-document
      // string built from concatenated files. APK path lookup is metadata-
      // sourced; production wiring stores APK paths on jobs.metadata.apk_path.
      const fileRows = await fastify.db
        .select({
          filename: schema.jobFiles.filename,
          content: schema.jobFiles.content,
        })
        .from(schema.jobFiles)
        .where(eq(schema.jobFiles.jobId, jobId));
      const flowContent = fileRows.map((f) => f.content).join('\n---\n');
      const artifactPath =
        (row.metadata as { apk_path?: unknown } | null)?.apk_path;
      if (typeof artifactPath !== 'string') {
        jobsModule.emit.failed(jobId, {
          jobId,
          step: 'allocate',
          reason: 'parallel-deploy requires jobs.metadata.apk_path (artifact upload)',
        });
        return;
      }

      // installAndLaunch primitive — production wiring delegates to
      // JobExecutor.installApk + executor.execute. Wave 1 ships a minimal
      // implementation that invokes the same JobExecutor.execute path used
      // by the single-device branch, scoped to one device.
      const timeoutMinutes =
        (fastify.config as unknown as { jobs?: { timeout_minutes?: number } })
          .jobs?.timeout_minutes ?? 30;
      const executor = new JobExecutor(log as pino.Logger, timeoutMinutes);

      const installAndLaunch: InstallAndLaunch = async (device, artifact, flow, env) => {
        const adbSerial = device.port != null ? `emulator-${device.port}` : device.id;
        const subJobId = `${jobId}-${device.id}`;
        const flowDir = await executor.writeFlowFiles(
          subJobId,
          [{ filename: 'flow.yaml', content: flow }],
        );
        const outputDir = join(flowDir, 'output');
        await mkdir(outputDir, { recursive: true });
        await executor.execute({
          jobId: subJobId,
          flowDir,
          outputDir,
          deviceId: adbSerial,
          platform: device.platform,
          signal: abortController.signal,
          entryFile: 'flow.yaml',
          env,
          apkPath: artifact,
          callbacks: {
            onStdoutLine: () => undefined,
            onFlowStart: () => undefined,
            onFlowResult: () => undefined,
            onCommandStatus: () => undefined,
            onSummary: () => undefined,
          },
        } as Parameters<typeof executor.execute>[0]);
      };

      const parallelInput: ParallelDeployJobInput = {
        jobId,
        platform: row.platform,
        parallelism: row.metadata.parallelism,
        artifactPath,
        maestroFlow: flowContent,
      };

      try {
        const result = await runParallelDeploy(
          { pool: poolModule, installAndLaunch, logger: log as pino.Logger },
          parallelInput,
        );
        // Aggregate result into job.completed summary so the existing
        // subscriber chain (terminal-status update, cleanup, webhook) fires
        // exactly as for single-device jobs. Status is 'passed' iff EVERY
        // device passed.
        const allPassed = result.devices.every((d) => d.status === 'passed');
        jobsModule.emit.completed(jobId, {
          jobId,
          status: allPassed ? ('passed' as const) : ('failed' as const),
          platform: row.platform,
          summary: { devices: result.devices, deviceCount: result.deviceCount } as unknown as Record<string, unknown>,
        });
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        jobsModule.emit.failed(jobId, { jobId, step: 'allocate', reason });
      }
      return;
    }

    // ---------- Phase 1: allocate device ----------
    // pool.allocate emits device.allocated which jobs subscriber catches and
    // writes jobs.status='allocated'. The subscriber chain re-emits job.allocated.
    //
    // Phase 31 / Plan 31-03 / SC3 — per-job emulator boot options. Read
    // `boot_options` back out of jobs.metadata (JSONB; written by
    // JobService.createJob) and re-validate at the DB→app boundary
    // (SPEC-04 row decoder pattern) before plumbing to pool.allocate.
    // When absent or invalid, pass `undefined` so the pre-booted device's
    // documented defaults apply.
    const rawBootOptions = (row.metadata as { boot_options?: unknown } | null)?.boot_options;
    let bootOptions: ReturnType<typeof bootOptionsSchema.parse> | undefined;
    if (rawBootOptions !== undefined && rawBootOptions !== null) {
      try {
        bootOptions = bootOptionsSchema.parse(rawBootOptions);
      } catch (err) {
        log.warn({ err, rawBootOptions }, 'Invalid boot_options in jobs.metadata — ignoring');
      }
    }
    const device = await fastify.pool.allocate(row.platform, jobId, bootOptions);
    if (!device) {
      jobsModule.emit.failed(jobId, { jobId, step: 'allocate', reason: 'no devices available' });
      return;
    }
    deviceId = device.id;

    // Track in-flight for drain getInFlightCount + cancellation.
    runningJobs.set(jobId, { abortController, deviceId });

    // ---------- Phase 2: status='running' + emit job.running ----------
    fastify.pool.markRunning(deviceId);
    await fastify.db
      .update(schema.jobs)
      .set({ status: 'running' as never, startedAt: new Date() })
      .where(eq(schema.jobs.id, jobId));
    jobsModule.emit.running(jobId, { jobId, deviceId, platform: row.platform });

    // ---------- Phase 3: emit job.started for artifacts subscriber ----------
    // Phase 21 contract — DO NOT delete. Artifacts subscriber starts recording +
    // memory sampling on this event.
    jobsModule.emit.started(jobId, { jobId, deviceId, platform: row.platform });

    // ---------- Phase 4: read flow files + run Maestro ----------
    // Resolve ADB serial for Maestro (mirrors current job-service.ts behaviour).
    const deviceInfo = fastify.pool.getDevice(deviceId);
    const adbSerial = deviceInfo?.port != null
      ? `emulator-${deviceInfo.port}`
      : deviceId;

    // Fetch flow files written to jobFiles by the JobService shim (back-compat).
    const fileRows = await fastify.db
      .select({
        filename: schema.jobFiles.filename,
        content: schema.jobFiles.content,
      })
      .from(schema.jobFiles)
      .where(eq(schema.jobFiles.jobId, jobId));

    const files = fileRows.map((f) => ({ filename: f.filename, content: f.content }));

    const timeoutMinutes =
      (fastify.config as unknown as { jobs?: { timeout_minutes?: number } }).jobs?.timeout_minutes ?? 30;
    const executor = new JobExecutor(log as pino.Logger, timeoutMinutes);
    const flowDir = await executor.writeFlowFiles(jobId, files);
    const outputDir = join(flowDir, 'output');
    await mkdir(outputDir, { recursive: true });

    jobsModule.emit.status(jobId, {
      jobId,
      data: { status: 'running' },
    });

    const result = await executor.execute({
      jobId,
      flowDir,
      outputDir,
      deviceId: adbSerial,
      platform: row.platform,
      signal: abortController.signal,
      entryFile: files[0]?.filename,
      callbacks: {
        onStdoutLine: (line: string) =>
          jobsModule.emit.log(jobId, { jobId, data: { line, stream: 'stdout' } }),
        onFlowStart: (flowName: string) =>
          jobsModule.emit.step(jobId, { jobId, data: { flowName, status: 'running' } }),
        onFlowResult: (flowName: string, status: string, durationMs: number) =>
          jobsModule.emit.step(jobId, { jobId, data: { flowName, status, durationMs } }),
        onCommandStatus: (command: string, status: string) =>
          jobsModule.emit.log(jobId, {
            jobId,
            data: { line: `${command} ${status}`, stream: 'stdout' },
          }),
        onSummary: () => {
          /* no-op */
        },
      },
    });

    // ---------- Phase 5: write maestro.log + emit maestro.log.written ----------
    // Phase 21 contract — artifacts subscriber creates the log artifact row.
    try {
      const logPath = `${LOG_BASE}/${jobId}/maestro.log`;
      await mkdir(`${LOG_BASE}/${jobId}`, { recursive: true });
      await writeFile(logPath, result.rawOutput, 'utf-8');
      const fileSize = await getFileSizeSafe(logPath);
      jobsModule.emit.maestroLogWritten(jobId, {
        jobId,
        filePath: logPath,
        fileName: 'maestro.log',
        mimeType: 'text/plain',
        fileSizeBytes: fileSize ?? null,
      });
    } catch (err) {
      log.error({ err }, 'Failed to write maestro.log (non-fatal)');
    }

    // ---------- Phase 6: emit job.completed ----------
    // jobs subscriber on bus.on('job.completed', ...) writes terminal status,
    // emits job.cleanup.requested (-> streaming cleanup). Pool releases device
    // either via existing release() callsite or via job.failed path.
    jobsModule.emit.status(jobId, {
      jobId,
      data: { status: result.status },
    });
    jobsModule.emit.completed(jobId, {
      jobId,
      status: result.status,
      platform: row.platform,
      summary: result.summary as unknown as Record<string, unknown> | undefined,
    });

    // Persist steps + result-summary (preserves existing job-service.ts behavior).
    try {
      // Merge maestroVersion + osVersion into existing metadata (JSONB).
      // Spread existing metadata first so we never clobber pre-existing keys
      // (e.g. boot_options, mode, apk_path written at job creation time).
      const existingMetadata = (row.metadata as Record<string, unknown> | null) ?? {};
      const mergedMetadata: Record<string, unknown> = {
        ...existingMetadata,
        ...(result.maestroVersion != null && { maestroVersion: result.maestroVersion }),
        ...(result.osVersion != null && { osVersion: result.osVersion }),
      };

      await fastify.db
        .update(schema.jobs)
        .set({
          resultSummary: result.summary as never,
          maestroOutput: result.rawOutput,
          metadata: mergedMetadata,
        })
        .where(eq(schema.jobs.id, jobId));
      if (result.steps.length > 0) {
        const baseTs = result.commandTimestamps ?? new Map();
        // Maestro's commands-*.json (when present) has higher fidelity timestamps
        // than our stdout wallclock. Merge it in as overrides.
        const overrides = await loadCommandTimestamps(outputDir);
        for (const [cmd, ts] of overrides) {
          baseTs.set(cmd, ts);
        }
        const rows = mapStepsForPersistence(jobId, result.steps, baseTs);
        await fastify.db.insert(schema.jobSteps).values(rows as never);
      }
    } catch (err) {
      log.warn({ err }, 'Failed to persist job step results (non-fatal)');
    }

    // ---------- Phase 7: cleanup temp dir (preserve current behavior) ----------
    try {
      await executor.cleanupTempDir(jobId);
    } catch (err) {
      log.warn({ err }, 'Temp dir cleanup failed');
    }

    // Release device — pool subscriber on job.failed handles error path; happy
    // path releases here (matches pre-Phase-23 behaviour).
    try {
      await fastify.pool.release(deviceId);
    } catch (err) {
      log.warn({ err, deviceId }, 'Device release failed');
    }
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : String(err);
    const step = inferStep(err);
    log.error({ err }, 'Saga step failed — emitting job.failed');
    jobsModule.emit.failed(jobId, { jobId, step, reason });
    // jobs subscriber on bus.on('job.failed', ...) emits job.cleanup.requested
    // pool subscriber on bus.on('job.failed', ...) releases device
    // NO RE-THROW — pg-boss retryLimit:0; let worker complete clean.
  } finally {
    runningJobs.delete(jobId);
  }
}

/**
 * Heuristic to map a thrown error to a saga step for the failed payload.
 * Default to 'run' (most common throw site).
 */
function inferStep(
  err: unknown,
): 'allocate' | 'run' | 'complete' | 'recording' | 'webhook' | 'cleanup' {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    if (msg.includes('no devices') || msg.includes('allocate')) return 'allocate';
    if (msg.includes('recording')) return 'recording';
    if (msg.includes('webhook')) return 'webhook';
    if (msg.includes('cleanup')) return 'cleanup';
  }
  return 'run';
}

async function getFileSizeSafe(filePath: string): Promise<number | undefined> {
  try {
    const s = await stat(filePath);
    return s.size;
  } catch {
    return undefined;
  }
}
