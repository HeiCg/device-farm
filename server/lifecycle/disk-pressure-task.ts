import { rm } from 'node:fs/promises';
import { sql, eq, asc } from 'drizzle-orm';
import type pino from 'pino';
import type { Database } from '../db/index.js';
import type { AppConfig } from '../config/schema.js';
import * as schema from '../db/schema.js';

export interface DiskPressureResult {
  deleted: number;
  freedBytes: number;
  currentUsageBytes: number;
  /**
   * Configured storage ceiling (bytes) — echoed back so downstream consumers
   * (Phase 18 lifecycle.disk.checked event payload) can express usage ratios
   * without re-reading config. Equal to config.storage.artifacts.max_storage_gb
   * * 1024^3.
   */
  maxBytes: number;
}

export interface DiskPressureDeps {
  rmFn?: (path: string, opts?: { force?: boolean }) => Promise<void>;
}

/**
 * Monitor total artifact disk usage. When over max_storage_gb, delete oldest
 * artifacts first until usage drops below the limit.
 */
export async function runDiskPressureTask(
  db: Database,
  config: AppConfig,
  logger: pino.Logger,
  deps: DiskPressureDeps = {},
): Promise<DiskPressureResult> {
  const log = logger.child ? logger.child({ task: 'disk-pressure' }) : logger;
  const { max_storage_gb } = config.storage.artifacts;
  const maxBytes = max_storage_gb * 1024 * 1024 * 1024;

  const rmFn = deps.rmFn ?? ((p: string, opts?: { force?: boolean }) => rm(p, { force: true }));

  // Get total usage via DB aggregation
  const [{ total }] = await db
    .select({ total: sql<number>`COALESCE(SUM(${schema.artifacts.fileSizeBytes}), 0)` })
    .from(schema.artifacts);

  let currentUsage = Number(total) || 0;

  if (currentUsage <= maxBytes) {
    log.info({ currentUsage, maxBytes }, 'Disk usage within limit');
    return { deleted: 0, freedBytes: 0, currentUsageBytes: currentUsage, maxBytes };
  }

  log.warn({ currentUsage, maxBytes }, 'Disk usage over limit, cleaning up');

  // Get oldest artifacts for deletion
  const oldest = await db
    .select()
    .from(schema.artifacts)
    .orderBy(asc(schema.artifacts.createdAt));

  let deleted = 0;
  let freedBytes = 0;

  for (const artifact of oldest) {
    if (currentUsage <= maxBytes) {
      break;
    }

    const fileSize = artifact.fileSizeBytes ?? 0;

    // Delete file from filesystem
    try {
      await rmFn(artifact.filePath, { force: true });
    } catch (err: any) {
      log.error(
        { artifactId: artifact.id, filePath: artifact.filePath, error: err.message },
        'Failed to delete artifact file during disk pressure cleanup',
      );
    }

    // Delete DB record
    try {
      await db.delete(schema.artifacts).where(eq(schema.artifacts.id, artifact.id));
    } catch (err: any) {
      log.error(
        { artifactId: artifact.id, error: err.message },
        'Failed to delete artifact DB record during disk pressure cleanup',
      );
      continue;
    }

    deleted++;
    freedBytes += fileSize;
    currentUsage -= fileSize;
  }

  log.info({ deleted, freedBytes, currentUsage }, 'Disk pressure cleanup complete');
  return { deleted, freedBytes, currentUsageBytes: currentUsage, maxBytes };
}
