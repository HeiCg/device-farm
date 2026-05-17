import { eq } from 'drizzle-orm';
import type pino from 'pino';
import type { Database } from '../../db/index.js';
import * as schema from '../../db/schema.js';

export interface OrphanRecoveryDeps {
  db: Database;
  retryRun(origin: { runId: string; prId: string }): Promise<string>;
  commentRetry(prId: string, runId: string, message: string): Promise<void>;
  logger: pino.Logger;
}

export async function recoverOrphans(deps: OrphanRecoveryDeps): Promise<void> {
  const log = deps.logger.child({ component: 'orphan-recovery' });
  const orphans = await deps.db
    .select()
    .from(schema.pipelineRuns)
    .where(eq(schema.pipelineRuns.status, 'running'));

  if (orphans.length === 0) {
    log.info('no running orphans on boot');
    return;
  }

  log.info({ count: orphans.length }, 'recovering running orphans');

  for (const run of orphans) {
    await deps.db
      .update(schema.pipelineRuns)
      .set({
        status: 'cancelled',
        errorMessage: 'orphan: server restart',
        finishedAt: new Date(),
      })
      .where(eq(schema.pipelineRuns.id, run.id));

    if (!run.azurePrId) {
      log.info({ runId: run.id }, 'orphan cancelled (no PR association)');
      continue;
    }

    const vars = (run.variables ?? {}) as Record<string, unknown>;
    if (vars.retry_of) {
      log.warn({ runId: run.id, retryOf: vars.retry_of }, 'already a retry; not looping');
      await deps.commentRetry(run.azurePrId, run.id, 'cancelled-restart-loop');
      continue;
    }

    try {
      const newRunId = await deps.retryRun({ runId: run.id, prId: run.azurePrId });
      await deps.commentRetry(run.azurePrId, newRunId, `restarted (was ${run.id})`);
    } catch (err) {
      log.error({ runId: run.id, err }, 'failed to re-enqueue orphan retry');
    }
  }
}
