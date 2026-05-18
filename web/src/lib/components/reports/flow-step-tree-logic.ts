import type { ReportStepLite } from '$lib/api/types.js';

export function groupStepsByFlow(steps: ReportStepLite[]): Array<[string, ReportStepLite[]]> {
  const map = new Map<string, ReportStepLite[]>();
  for (const s of steps) {
    const key = s.flowName ?? '(no flow)';
    const list = map.get(key);
    if (list) list.push(s);
    else map.set(key, [s]);
  }
  return [...map.entries()];
}

export function formatDuration(ms: number | null): string {
  if (ms == null) return '';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
