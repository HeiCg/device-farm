/**
 * Pipelines scheduler — boss.schedule-backed (Phase 25 Plan 25-02).
 *
 * REPLACES the node-cron implementation. ZERO node-cron imports remain.
 * Per-pipelineSchedules row maps to ONE pg-boss schedule, disambiguated by
 * the row's UUID via the `key` parameter (NOT singletonKey, NOT pipelineId
 * — see RESEARCH §Pattern 1). Plugin.ts back-compat shim (overloaded ctor)
 * retained until Plan 25-03 rewires it.
 */
import { eq } from 'drizzle-orm';
import type pino from 'pino';
import type { PgBoss } from 'pg-boss';
import type { Database } from '../../db/index.js';
import * as schema from '../../db/schema.js';
import {
  PIPELINE_SCHEDULED_EXECUTE_QUEUE_NAME,
  upsertPipelineSchedule,
  removePipelineSchedule,
} from '../queue.js';

export interface PipelineSchedulerDeps {
  db: Database;
  logger: pino.Logger;
  boss: PgBoss;
  /** Plugin.ts back-compat until 25-03; unused. */
  pipelineService?: unknown;
}

type BossScheduleRow = { name: string; key?: string; cron: string; data?: { pipelineId?: string } };

export class PipelineScheduler {
  private readonly db: Database;
  private readonly logger: pino.Logger;
  private readonly boss: PgBoss | undefined;

  constructor(deps: PipelineSchedulerDeps);
  constructor(db: Database, logger: pino.Logger, pipelineService?: unknown);
  constructor(arg1: Database | PipelineSchedulerDeps, arg2?: pino.Logger, _arg3?: unknown) {
    if (arg2 === undefined && typeof arg1 === 'object' && arg1 !== null && 'logger' in arg1) {
      const deps = arg1 as PipelineSchedulerDeps;
      this.db = deps.db;
      this.logger = deps.logger.child({ component: 'pipeline-scheduler' });
      this.boss = deps.boss;
    } else {
      this.db = arg1 as Database;
      this.logger = (arg2 as pino.Logger).child({ component: 'pipeline-scheduler' });
      this.boss = undefined;
    }
  }

  private requireBoss(): PgBoss {
    if (!this.boss) throw new Error('PipelineScheduler: boss not provided (legacy ctor; 25-03 rewires plugin.ts).');
    return this.boss;
  }

  /** Idempotent reconcile: upsert all enabled rows; unschedule orphan pgboss keys. */
  async reconcileSchedules(): Promise<void> {
    const boss = this.requireBoss();
    const rows = await this.db.select().from(schema.pipelineSchedules)
      .where(eq(schema.pipelineSchedules.enabled, true));

    for (const row of rows) {
      await upsertPipelineSchedule({
        boss, scheduleId: row.id, pipelineId: row.pipelineId,
        cronExpression: row.cronExpression,
        variables: (row.variables as Record<string, string>) ?? {},
      });
    }

    const bossSchedules = (await boss.getSchedules()) as unknown as BossScheduleRow[];
    const appKeys = new Set(rows.map((r) => r.id));
    for (const s of bossSchedules) {
      if (s.name === PIPELINE_SCHEDULED_EXECUTE_QUEUE_NAME && s.key && !appKeys.has(s.key)) {
        this.logger.warn({ key: s.key }, 'Orphan pgboss schedule — unscheduling');
        await boss.unschedule(PIPELINE_SCHEDULED_EXECUTE_QUEUE_NAME, s.key);
      }
    }
    this.logger.info({ count: rows.length }, 'Pipeline scheduler reconciled');
  }

  /** Add/update schedule. Throws on invalid cron (BEHAVIOUR CHANGE from node-cron silent skip). */
  async addSchedule(scheduleId: string): Promise<void> {
    const boss = this.requireBoss();
    const [row] = await this.db.select().from(schema.pipelineSchedules)
      .where(eq(schema.pipelineSchedules.id, scheduleId));

    if (!row || !row.enabled) {
      await removePipelineSchedule({ boss, scheduleId });
      return;
    }
    await upsertPipelineSchedule({
      boss, scheduleId: row.id, pipelineId: row.pipelineId,
      cronExpression: row.cronExpression,
      variables: (row.variables as Record<string, string>) ?? {},
    });
  }

  /** Remove schedule (routes DELETE + service.deletePipeline cascade — Pitfall 3). */
  async removeSchedule(scheduleId: string): Promise<void> {
    const boss = this.requireBoss();
    await removePipelineSchedule({ boss, scheduleId });
  }

  /** Inspection — reads pg-boss source of truth. */
  async getActiveSchedules(): Promise<Array<{ id: string; pipelineId: string; cron: string }>> {
    const boss = this.requireBoss();
    const bossSchedules = (await boss.getSchedules()) as unknown as BossScheduleRow[];
    return bossSchedules
      .filter((s) => s.name === PIPELINE_SCHEDULED_EXECUTE_QUEUE_NAME && s.key)
      .map((s) => ({ id: s.key as string, pipelineId: s.data?.pipelineId ?? 'unknown', cron: s.cron }));
  }

  /** No-op — schedules persist; worker offWork'd by module shutdown (25-03). */
  stop(): void {
    this.logger.debug('PipelineScheduler.stop — no-op');
  }

  /** Back-compat alias for plugin.ts onReady; delegates to reconcileSchedules. Removed in 25-03. */
  async start(): Promise<void> {
    if (!this.boss) {
      this.logger.warn('PipelineScheduler.start — legacy ctor (no boss); skipping reconcile.');
      return;
    }
    await this.reconcileSchedules();
  }
}
