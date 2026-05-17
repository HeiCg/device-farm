import { eq, sql } from 'drizzle-orm';
import type { Database } from '../../db/index.js';
import * as schema from '../../db/schema.js';

export interface ConcurrencyGuardOpts {
  db: Database;
  cap: number;
}

export interface ConcurrencyGuard {
  canAdmit(): Promise<boolean>;
}

export function createConcurrencyGuard(opts: ConcurrencyGuardOpts): ConcurrencyGuard {
  return {
    async canAdmit(): Promise<boolean> {
      const rows = await opts.db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.pipelineRuns)
        .where(eq(schema.pipelineRuns.status, 'running'));
      const active = rows[0]?.count ?? 0;
      return active < opts.cap;
    },
  };
}
