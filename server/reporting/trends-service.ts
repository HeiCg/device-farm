export interface TrendInput {
  flowName: string;
  status: string;
  finishedAt: Date | null;
}

export interface TrendsOutput {
  byDay:  Array<{ date: string; passed: number; failed: number; total: number }>;
  byFlow: Array<{ flowName: string; passed: number; failed: number }>;
  windowDays: number;
}

export function computeTrends(rows: TrendInput[], windowDays: number): TrendsOutput {
  const dayMap = new Map<string, { passed: number; failed: number; total: number }>();
  const flowMap = new Map<string, { passed: number; failed: number }>();

  for (const r of rows) {
    if (!r.finishedAt) continue;
    const day = r.finishedAt.toISOString().slice(0, 10);
    const d = dayMap.get(day) ?? { passed: 0, failed: 0, total: 0 };
    d.total++;
    if (r.status === 'passed') d.passed++;
    else if (r.status === 'failed') d.failed++;
    dayMap.set(day, d);

    const f = flowMap.get(r.flowName) ?? { passed: 0, failed: 0 };
    if (r.status === 'passed') f.passed++;
    else if (r.status === 'failed') f.failed++;
    flowMap.set(r.flowName, f);
  }

  return {
    byDay:  [...dayMap.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, v]) => ({ date, ...v })),
    byFlow: [...flowMap.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([flowName, v]) => ({ flowName, ...v })),
    windowDays,
  };
}
