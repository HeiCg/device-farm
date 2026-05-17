import { isNotNull, desc } from 'drizzle-orm';
import type pino from 'pino';
import type { Database } from '../db/index.js';
import * as schema from '../db/schema.js';

export interface FlakyFlow {
  flowName: string;
  totalRuns: number;
  passCount: number;
  failCount: number;
  passRate: number;
}

const FLAKY_MIN_RATE = 0.2;
const FLAKY_MAX_RATE = 0.8;

export class FlakyDetector {
  private readonly db: Database;
  private readonly logger: pino.Logger;

  constructor(db: Database, logger: pino.Logger) {
    this.db = db;
    this.logger = logger.child({ component: 'flaky-detector' });
  }

  /**
   * Get flows with unstable pass/fail history.
   * A flow is "flaky" if its pass rate over the last `windowSize` runs
   * is strictly between FLAKY_MIN_RATE (20%) and FLAKY_MAX_RATE (80%).
   */
  async getFlaky(windowSize = 10): Promise<FlakyFlow[]> {
    // Query all steps with non-null flowName, ordered by startedAt DESC
    const rows = await this.db
      .select({
        flowName: schema.jobSteps.flowName,
        status: schema.jobSteps.status,
      })
      .from(schema.jobSteps)
      .where(isNotNull(schema.jobSteps.flowName))
      .orderBy(desc(schema.jobSteps.startedAt));

    // Group by flowName, take last windowSize per flow
    const flowMap = new Map<string, string[]>();
    for (const row of rows) {
      if (!row.flowName) continue;
      const statuses = flowMap.get(row.flowName) ?? [];
      if (statuses.length < windowSize) {
        statuses.push(row.status);
        flowMap.set(row.flowName, statuses);
      }
    }

    // Compute pass rate and filter flaky flows
    const flaky: FlakyFlow[] = [];
    for (const [flowName, statuses] of flowMap) {
      const totalRuns = statuses.length;
      const passCount = statuses.filter((s) => s === 'passed').length;
      const failCount = totalRuns - passCount;
      const passRate = totalRuns > 0 ? passCount / totalRuns : 0;

      if (passRate > FLAKY_MIN_RATE && passRate < FLAKY_MAX_RATE) {
        flaky.push({ flowName, totalRuns, passCount, failCount, passRate });
      }
    }

    this.logger.info({ flakyCount: flaky.length, windowSize }, 'Flaky detection complete');
    return flaky;
  }
}
