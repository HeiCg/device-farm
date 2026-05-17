import { mkdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import type pino from 'pino';
import type { Database } from '../db/index.js';
import type { AppConfig } from '../config/schema.js';
import type { ArtifactType } from '../streaming/internal/types.js';
import * as schema from '../db/schema.js';

declare module 'fastify' {
  interface FastifyInstance {
    artifactService: ArtifactService;
  }
}

export interface CreateArtifactOpts {
  jobId: string;
  recordingId?: string;  // Phase 21 / Plan 21-01 — SC3 idempotency key (video artifacts only)
  type: ArtifactType;
  filePath: string;
  fileName: string;
  mimeType: string;
  fileSizeBytes?: number;
}

export class ArtifactService {
  private readonly db: Database;
  private readonly basePath: string;
  private readonly logger: pino.Logger;

  constructor(db: Database, config: AppConfig, logger: pino.Logger) {
    this.db = db;
    this.basePath = config.storage.artifacts.path;
    this.logger = logger.child({ component: 'artifact-service' });
  }

  /**
   * Ensure the artifact directory for a job exists.
   * Returns the absolute path to the job's artifact directory.
   */
  async ensureJobDir(jobId: string): Promise<string> {
    const dir = join(this.basePath, jobId);
    await mkdir(dir, { recursive: true });
    return dir;
  }

  /**
   * Get the full path for an artifact file within a job's directory.
   */
  getArtifactPath(jobId: string, filename: string): string {
    return join(this.basePath, jobId, filename);
  }

  /**
   * Create an artifact record in the database.
   */
  async createArtifact(opts: CreateArtifactOpts): Promise<{ id: string }> {
    const [result] = await this.db.insert(schema.artifacts).values({
      jobId: opts.jobId,
      recordingId: opts.recordingId,  // Phase 21 / Plan 21-01 — optional pass-through
      type: opts.type,
      filePath: opts.filePath,
      fileName: opts.fileName,
      mimeType: opts.mimeType,
      fileSizeBytes: opts.fileSizeBytes,
    }).returning({ id: schema.artifacts.id });

    this.logger.info(
      { artifactId: result.id, jobId: opts.jobId, type: opts.type, fileName: opts.fileName, recordingId: opts.recordingId ?? null },
      'Artifact record created',
    );

    return result;
  }

  /**
   * Phase 21 / Plan 21-01 — SC3 DB-LAYER idempotency.
   *
   * Atomic insert via `.onConflictDoNothing({target: schema.artifacts.recordingId})`.
   * Returns `{id}` on INSERT success; returns `null` when a row with same
   * recordingId already exists (conflict skipped silently — no error thrown).
   *
   * Combined with SC3's queue-LAYER idempotency (plan 21-03: policy:'stately' +
   * singletonKey: recordingId), replaying `recording.upload` with same recordingId
   * → queue drops the enqueue OR worker fires but this method returns null.
   *
   * Phase 16 Plan 16-01 proved this pattern atomic (single round-trip, no
   * TOCTOU between parallel workers) for `hook_runs`.
   */
  async createArtifactIdempotent(
    opts: CreateArtifactOpts & { recordingId: string },
  ): Promise<{ id: string } | null> {
    const rows = await this.db.insert(schema.artifacts).values({
      jobId: opts.jobId,
      recordingId: opts.recordingId,
      type: opts.type,
      filePath: opts.filePath,
      fileName: opts.fileName,
      mimeType: opts.mimeType,
      fileSizeBytes: opts.fileSizeBytes,
    })
      .onConflictDoNothing({ target: schema.artifacts.recordingId })
      .returning({ id: schema.artifacts.id });

    if (rows.length === 0) {
      this.logger.warn(
        { jobId: opts.jobId, recordingId: opts.recordingId, type: opts.type, fileName: opts.fileName },
        'Artifact insert skipped — recordingId already exists (SC3 idempotency)',
      );
      return null;
    }

    this.logger.info(
      { artifactId: rows[0].id, jobId: opts.jobId, recordingId: opts.recordingId, type: opts.type, fileName: opts.fileName },
      'Artifact record created (idempotent insert)',
    );
    return rows[0];
  }

  /**
   * List all artifacts for a job, ordered by creation time.
   */
  async listByJob(jobId: string): Promise<typeof schema.artifacts.$inferSelect[]> {
    return this.db
      .select()
      .from(schema.artifacts)
      .where(eq(schema.artifacts.jobId, jobId))
      .orderBy(schema.artifacts.createdAt);
  }

  /**
   * Get a single artifact by ID, or null if not found.
   */
  async getById(id: string): Promise<typeof schema.artifacts.$inferSelect | null> {
    const rows = await this.db
      .select()
      .from(schema.artifacts)
      .where(eq(schema.artifacts.id, id))
      .limit(1);

    return rows[0] ?? null;
  }

  /**
   * Delete all artifacts for a job (DB records + files on disk).
   */
  async deleteByJob(jobId: string): Promise<void> {
    // Delete files from disk
    const dir = join(this.basePath, jobId);
    try {
      await rm(dir, { recursive: true, force: true });
    } catch (err: any) {
      this.logger.error({ jobId, error: err.message }, 'Failed to delete artifact files');
    }

    // Delete DB records
    await this.db.delete(schema.artifacts).where(eq(schema.artifacts.jobId, jobId));

    this.logger.info({ jobId }, 'All artifacts deleted for job');
  }

  /**
   * Get file size in bytes for a given path, or undefined if file doesn't exist.
   */
  async getFileSize(filePath: string): Promise<number | undefined> {
    try {
      const s = await stat(filePath);
      return s.size;
    } catch {
      return undefined;
    }
  }
}
