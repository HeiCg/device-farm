import { rm } from 'node:fs/promises';
import type pino from 'pino';

export interface InternalReleaseStageOpts {
  device: { id: string } | null;
  workDir: string | null;
  pool: { release(deviceId: string): Promise<void> };
  logger: pino.Logger;
}

export async function runInternalReleaseStage(
  opts: InternalReleaseStageOpts,
): Promise<{ ok: true }> {
  const log = opts.logger.child({ component: 'internal-release' });
  if (opts.device) {
    try {
      await opts.pool.release(opts.device.id);
    } catch (err) {
      log.error({ err }, 'device release failed (continuing)');
    }
  }
  if (opts.workDir) {
    await rm(opts.workDir, { recursive: true, force: true }).catch((err) => {
      log.warn({ err }, 'workspace cleanup failed (continuing)');
    });
  }
  return { ok: true };
}
