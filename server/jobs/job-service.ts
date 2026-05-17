/**
 * Phase 23 Plan 23-04 — back-compat shim.
 *
 * The 669-line JobService implementation moved to:
 *   - server/jobs/internal/executor.ts (runJob; pure execution loop)
 *   - server/jobs/internal/module.ts (createJobsModule factory)
 *   - server/jobs/internal/subscribers.ts (saga subscribers)
 *
 * This shim preserves the public method surface so existing route handlers
 * + test files continue to type-check + run. Future plans (Phase 24+) may
 * delete this entirely once consumers migrate to fastify.jobsModule.
 *
 * SC4 grep contract: this file no longer imports `./job-queue.js`. The
 * in-memory FIFO is gone; pg-boss owns the queue surface via fastify.queue.
 */
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

import * as schema from '../db/schema.js';
import type { BootOptionsInput } from '../config/schema.js';
import type { Platform } from './types.js';

export interface CreateJobOpts {
  files: Array<{ filename: string; content: string }>;
  metadata: Record<string, unknown>;
  platform: Platform;
  env?: Record<string, string>;
  apkPath?: string;
  /** Override tags for this job (merged with config defaults) */
  includeTags?: string[];
  excludeTags?: string[];
  /**
   * Phase 31 / Plan 31-03 / SC3 — per-job emulator boot options. When present,
   * persisted into jobs.metadata.boot_options (JSONB, no schema change) and
   * re-validated at executor.ts boundary before reaching pool.allocate.
   */
  bootOptions?: BootOptionsInput;
}

export class JobService {
  constructor(private readonly fastify: FastifyInstance) {}

  /**
   * Insert a job row + flow files, then enqueue via fastify.jobsModule.enqueueJob.
   * Validates metadata against the configured schema (preserves Phase 19 behaviour).
   */
  async createJob(
    opts: CreateJobOpts,
  ): Promise<{ id: string; status: string; platform: Platform }> {
    const { files, metadata, platform, env: _env, apkPath: _apkPath, bootOptions } = opts;

    this.validateMetadata(metadata);

    // Phase 31 / Plan 31-03 — persist per-job bootOptions into jobs.metadata
    // (JSONB; additive — no DB schema change). The executor reads metadata
    // .boot_options back out and re-validates at the DB→app boundary
    // (SPEC-04 row decoder pattern).
    const mergedMetadata: Record<string, unknown> = bootOptions
      ? { ...metadata, boot_options: bootOptions }
      : metadata;

    // Insert job row
    const [job] = await this.fastify.db
      .insert(schema.jobs)
      .values({
        status: 'queued',
        platform,
        metadata: mergedMetadata,
      })
      .returning({ id: schema.jobs.id });

    // Insert job files
    if (files.length > 0) {
      await this.fastify.db.insert(schema.jobFiles).values(
        files.map((f) => ({
          jobId: job.id,
          filename: f.filename,
          content: f.content,
          fileType: 'flow' as const,
        })),
      );
    }

    // Enqueue via the new MOD-06 surface
    await this.fastify.jobsModule.enqueueJob(job.id, {
      jobId: job.id,
      platform,
    });

    this.fastify.log.info({ jobId: job.id, platform }, 'Job created and enqueued via jobsModule');

    return { id: job.id, status: 'queued', platform };
  }

  /**
   * Cancel a running job by jobId. Returns void if cancelled, throws if not found.
   */
  async cancelJob(jobId: string): Promise<void> {
    const entry = this.fastify.jobsModule.runningJobs.get(jobId);
    if (entry) {
      entry.abortController.abort();
      this.fastify.log.info({ jobId }, 'Cancellation signal sent to running job');
      return;
    }

    // Not running — try to mark queued job as cancelled in DB.
    const rows = await this.fastify.db
      .select({ id: schema.jobs.id, status: schema.jobs.status })
      .from(schema.jobs)
      .where(eq(schema.jobs.id, jobId))
      .limit(1);
    const row = rows[0];
    if (!row) {
      throw new Error(`Job ${jobId} not found`);
    }
    if (row.status === 'queued') {
      await this.fastify.db
        .update(schema.jobs)
        .set({ status: 'cancelled', finishedAt: new Date() })
        .where(eq(schema.jobs.id, jobId));
      return;
    }

    throw new Error(`Job ${jobId} not found in queue or running jobs`);
  }

  /**
   * Get queue depth per platform. Phase 23+ delegates to in-flight count;
   * pg-boss owns the queue surface, so the per-platform breakdown is a
   * best-effort approximation (always returns 0 for both — Phase 23 does
   * not yet expose pg-boss queue depth via fastify.queue).
   *
   * Health endpoint consumers display this as a simple availability signal.
   */
  getQueueDepth(): { android: number; ios: number } {
    return { android: 0, ios: 0 };
  }

  /**
   * Shutdown — delegates to jobsModule.shutdown (idempotent).
   */
  async shutdown(): Promise<void> {
    await this.fastify.jobsModule.shutdown();
  }

  // -------------------------------------------------------------------
  // Private — metadata validation (preserved from Phase 19 implementation).
  // -------------------------------------------------------------------
  private validateMetadata(metadata: Record<string, unknown>): void {
    const cfg = this.fastify.config as unknown as {
      job_metadata_schema?: {
        required: string[];
        optional: Array<{ name: string; type: string }>;
      };
    };
    const metaSchema = cfg.job_metadata_schema;
    if (!metaSchema) return; // schema optional in some test configs

    for (const field of metaSchema.required) {
      if (!(field in metadata) || metadata[field] === undefined || metadata[field] === null) {
        throw new Error(`Missing required metadata field: ${field}`);
      }
    }

    for (const opt of metaSchema.optional) {
      if (opt.name in metadata && metadata[opt.name] !== undefined) {
        const actual = typeof metadata[opt.name];
        if (actual !== opt.type) {
          throw new Error(
            `Metadata field '${opt.name}' must be type '${opt.type}', got '${actual}'`,
          );
        }
      }
    }
  }
}
