import { inArray } from 'drizzle-orm';
import type { Database } from '../../db/index.js';
import * as schema from '../../db/schema.js';

export interface PoolSnapshotProvider {
  snapshot(): { availableAndroid: number; availableIos: number };
}

export interface QueueStatusOpts {
  db: Database;
  pool: PoolSnapshotProvider;
  maxConcurrent: number;
}

export interface QueueRunningEntry {
  runId: string;
  trigger: string;
  pr: string | null;
  startedAt: Date | null;
}

export interface QueuePendingEntry {
  runId: string;
  trigger: string;
  pr: string | null;
  queuedAt: Date | null;
  position: number;
}

export interface QueueStatus {
  running: QueueRunningEntry[];
  pending: QueuePendingEntry[];
  capacity: {
    max_concurrent: number;
    active: number;
    available_devices_android: number;
    available_devices_ios: number;
  };
}

export async function getQueueStatus(opts: QueueStatusOpts): Promise<QueueStatus> {
  const rows = await opts.db
    .select()
    .from(schema.pipelineRuns)
    .where(inArray(schema.pipelineRuns.status, ['pending', 'running']))
    .orderBy(schema.pipelineRuns.startedAt);

  const running: QueueRunningEntry[] = [];
  const pending: QueuePendingEntry[] = [];

  for (const r of rows) {
    if (r.status === 'running') {
      running.push({
        runId: r.id,
        trigger: r.triggerType,
        pr: r.azurePrId ?? null,
        startedAt: r.startedAt,
      });
    } else {
      pending.push({
        runId: r.id,
        trigger: r.triggerType,
        pr: r.azurePrId ?? null,
        queuedAt: r.startedAt ?? (r as any).createdAt ?? null,
        position: pending.length + 1,
      });
    }
  }

  const snap = opts.pool.snapshot();
  return {
    running,
    pending,
    capacity: {
      max_concurrent: opts.maxConcurrent,
      active: running.length,
      available_devices_android: snap.availableAndroid,
      available_devices_ios: snap.availableIos,
    },
  };
}
