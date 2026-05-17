import { rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { lt, eq, asc } from 'drizzle-orm';
import type pino from 'pino';
import type { Database } from '../db/index.js';
import type { AppConfig } from '../config/schema.js';
import * as schema from '../db/schema.js';

export interface RetentionResult {
  deleted: number;
  freedBytes: number;
}

export interface RetentionDeps {
  rmFn?: (path: string, opts?: { force?: boolean }) => Promise<void>;
}

/**
 * Delete artifacts older than retention_days from filesystem and DB.
 * Ordered by createdAt ASC so oldest are removed first.
 * After removing all artifacts for a job, also cleans up the empty job directory.
 */
export async function runRetentionTask(
  db: Database,
  config: AppConfig,
  logger: pino.Logger,
  deps: RetentionDeps = {},
): Promise<RetentionResult> {
  const log = logger.child ? logger.child({ task: 'retention' }) : logger;
  const { retention_days } = config.storage.artifacts;

  const rmFn = deps.rmFn ?? ((p: string, opts?: { force?: boolean }) => rm(p, { force: true }));

  const cutoff = new Date(Date.now() - retention_days * 24 * 60 * 60 * 1000);

  // Find expired artifacts, oldest first
  const expired = await db
    .select()
    .from(schema.artifacts)
    .where(lt(schema.artifacts.createdAt, cutoff))
    .orderBy(asc(schema.artifacts.createdAt));

  if (expired.length === 0) {
    log.info('No expired artifacts to delete');
    return { deleted: 0, freedBytes: 0 };
  }

  log.info({ count: expired.length }, 'Found expired artifacts to delete');

  let deleted = 0;
  let freedBytes = 0;
  const jobDirs = new Set<string>();

  for (const artifact of expired) {
    // Track job directories for cleanup
    jobDirs.add(dirname(artifact.filePath));

    // Delete file from filesystem
    try {
      await rmFn(artifact.filePath, { force: true });
    } catch (err: any) {
      log.error(
        { artifactId: artifact.id, filePath: artifact.filePath, error: err.message },
        'Failed to delete artifact file',
      );
    }

    // Delete DB record
    try {
      await db.delete(schema.artifacts).where(eq(schema.artifacts.id, artifact.id));
    } catch (err: any) {
      log.error(
        { artifactId: artifact.id, error: err.message },
        'Failed to delete artifact DB record',
      );
      continue;
    }

    deleted++;
    freedBytes += artifact.fileSizeBytes ?? 0;
  }

  // Attempt to clean up empty job directories
  for (const dir of jobDirs) {
    try {
      await rmFn(dir, { force: true });
    } catch {
      // Directory may not be empty if it has other artifacts -- ignore
    }
  }

  log.info({ deleted, freedBytes }, 'Retention task complete');
  return { deleted, freedBytes };
}
