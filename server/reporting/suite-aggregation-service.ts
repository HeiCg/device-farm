export interface SuiteInput {
  flowName: string;
  status: 'passed' | 'failed' | 'skipped' | 'running';
  durationMs: number | null;
  finishedAt: Date | null;
}

export interface SuiteAggregate {
  flowName: string;
  totalRuns: number;
  passed: number;
  failed: number;
  passRate: number;
  avgDurationMs: number;
  lastRunAt: Date | null;
  lastStatus: SuiteInput['status'];
  trend: number[];
}

export function aggregateSuites(rows: SuiteInput[]): SuiteAggregate[] {
  const byFlow = new Map<string, SuiteInput[]>();
  for (const r of rows) {
    const list = byFlow.get(r.flowName);
    if (list) list.push(r);
    else byFlow.set(r.flowName, [r]);
  }

  const out: SuiteAggregate[] = [];
  for (const [flowName, list] of byFlow) {
    const sorted = [...list].sort((a, b) => (b.finishedAt?.getTime() ?? 0) - (a.finishedAt?.getTime() ?? 0));
    const passed = sorted.filter((r) => r.status === 'passed').length;
    const failed = sorted.filter((r) => r.status === 'failed').length;
    const totalRuns = sorted.length;
    const avg = Math.round(sorted.reduce((s, r) => s + (r.durationMs ?? 0), 0) / totalRuns);
    out.push({
      flowName,
      totalRuns,
      passed,
      failed,
      passRate: passed / totalRuns,
      avgDurationMs: avg,
      lastRunAt: sorted[0].finishedAt,
      lastStatus: sorted[0].status,
      trend: sorted.slice(0, 10).map((r) => (r.status === 'passed' ? 1 : 0)),
    });
  }
  return out;
}
