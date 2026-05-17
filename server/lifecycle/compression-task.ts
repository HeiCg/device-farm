import { spawn, type ChildProcess } from 'node:child_process';
import { rename, stat } from 'node:fs/promises';
import type { Stats } from 'node:fs';
import { and, eq, lt, sql } from 'drizzle-orm';
import type pino from 'pino';
import type { Database } from '../db/index.js';
import type { AppConfig } from '../config/schema.js';
import * as schema from '../db/schema.js';

export interface CompressionResult {
  compressed: number;
  savedBytes: number;
}

export interface CompressionDeps {
  spawnFn?: typeof spawn;
  statFn?: (path: string) => Promise<Stats>;
  renameFn?: typeof rename;
}

/**
 * Find and re-encode old video artifacts that haven't been compressed yet.
 *
 * Selects videos where compressed=false AND createdAt < (now - compress_after_days),
 * re-encodes each with ffmpeg (slow preset, CRF 35, 720p max, no audio),
 * then updates the DB record.
 */
export async function runCompressionTask(
  db: Database,
  config: AppConfig,
  logger: pino.Logger,
  deps: CompressionDeps = {},
): Promise<CompressionResult> {
  const log = logger.child ? logger.child({ task: 'compression' }) : logger;
  const { compress_after_days } = config.storage.artifacts;

  const spawnFn = deps.spawnFn ?? spawn;
  const statFn = deps.statFn ?? ((p: string) => stat(p));
  const renameFn = deps.renameFn ?? rename;

  // Find old uncompressed video artifacts
  const cutoff = new Date(Date.now() - compress_after_days * 24 * 60 * 60 * 1000);

  const oldVideos = await db
    .select()
    .from(schema.artifacts)
    .where(
      and(
        eq(schema.artifacts.type, 'video'),
        eq(schema.artifacts.compressed, false),
        lt(schema.artifacts.createdAt, cutoff),
      ),
    );

  if (oldVideos.length === 0) {
    log.info('No videos need compression');
    return { compressed: 0, savedBytes: 0 };
  }

  log.info({ count: oldVideos.length }, 'Found videos to compress');

  let compressed = 0;
  let savedBytes = 0;

  for (const artifact of oldVideos) {
    const tempPath = `${artifact.filePath}.tmp.mp4`;

    try {
      // Spawn ffmpeg for re-encoding
      const exitCode = await new Promise<number>((resolve, reject) => {
        const proc: ChildProcess = spawnFn('ffmpeg', [
          '-y',
          '-i', artifact.filePath,
          '-c:v', 'libx264',
          '-preset', 'slow',
          '-crf', '35',
          '-vf', 'scale=-2:720',
          '-an',
          tempPath,
        ]);

        let stderrOutput = '';
        proc.stderr?.on('data', (data: Buffer) => {
          stderrOutput += data.toString();
        });

        proc.on('close', (code) => resolve(code ?? 1));
        proc.on('error', reject);
      });

      if (exitCode !== 0) {
        log.error({ artifactId: artifact.id, filePath: artifact.filePath }, 'ffmpeg compression failed');
        continue;
      }

      // Rename temp file to original
      await renameFn(tempPath, artifact.filePath);

      // Get new file size
      const newStats = await statFn(artifact.filePath);
      const newSize = newStats.size;
      const originalSize = artifact.fileSizeBytes ?? 0;
      const saved = originalSize - newSize;

      // Update DB record
      await db
        .update(schema.artifacts)
        .set({
          compressed: true,
          compressedAt: new Date(),
          fileSizeBytes: newSize,
        })
        .where(eq(schema.artifacts.id, artifact.id));

      compressed++;
      savedBytes += Math.max(0, saved);

      log.info(
        { artifactId: artifact.id, originalSize, newSize, saved },
        'Video compressed successfully',
      );
    } catch (err: any) {
      log.error(
        { artifactId: artifact.id, error: err.message },
        'Error compressing video',
      );
    }
  }

  log.info({ compressed, savedBytes }, 'Compression task complete');
  return { compressed, savedBytes };
}
