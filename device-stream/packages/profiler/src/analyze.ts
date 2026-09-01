import type { BottleneckReport, RankedFunction, RankedHang, RawProfile } from './types';

export interface AnalyzeOptions {
  /** Keep only the top-N hottest functions (default 15). */
  topN?: number;
  /** Keep only the top-N longest hangs (default 10). */
  topHangs?: number;
}

/**
 * Collapse a normalized profile into a ranked bottleneck report: hottest
 * functions by self time (with % of total), longest hangs with their innermost
 * frame, and a one-line summary. Pure — the device backends feed it a
 * {@link RawProfile}; this never touches a device.
 */
export function analyzeProfile(raw: RawProfile, opts: AnalyzeOptions = {}): BottleneckReport {
  const topN = opts.topN ?? 15;
  const topHangs = opts.topHangs ?? 10;

  // Aggregate self time per function (merging duplicate samples of the same fn).
  const byFn = new Map<string, RankedFunction>();
  for (const s of raw.samples) {
    const key = `${s.function}@${s.file ?? ''}:${s.line ?? ''}`;
    const existing = byFn.get(key);
    if (existing) existing.selfMs += s.selfMs;
    else byFn.set(key, { function: s.function, file: s.file, line: s.line, selfMs: s.selfMs, selfPct: 0 });
  }

  const totalSelf = [...byFn.values()].reduce((acc, f) => acc + f.selfMs, 0);
  const ranked = [...byFn.values()]
    .filter((f) => f.selfMs > 0)
    .sort((a, b) => b.selfMs - a.selfMs)
    .map((f) => ({ ...f, selfPct: totalSelf > 0 ? Math.round((f.selfMs / totalSelf) * 100) : 0 }))
    .slice(0, topN);

  const hangs: RankedHang[] = (raw.hangs ?? [])
    .slice()
    .sort((a, b) => b.durationMs - a.durationMs)
    .slice(0, topHangs)
    .map((h) => ({ startMs: h.startMs, durationMs: h.durationMs, topFrame: h.stack[0] ?? '(unknown)' }));

  return {
    kind: raw.kind,
    durationMs: raw.durationMs,
    topFunctions: ranked,
    hangs,
    summary: buildSummary(raw, ranked, hangs),
  };
}

function buildSummary(raw: RawProfile, ranked: RankedFunction[], hangs: RankedHang[]): string {
  if (ranked.length === 0) {
    return `${raw.kind} profile over ${raw.durationMs}ms: no CPU samples captured.`;
  }
  const worst = ranked[0];
  const where = worst.file ? ` (${worst.file}:${worst.line ?? '?'})` : '';
  const parts = [
    `${raw.kind} profile over ${raw.durationMs}ms:`,
    `hottest is ${worst.function}${where} at ${worst.selfMs}ms (${worst.selfPct}% of CPU).`,
  ];
  if (hangs.length > 0) {
    parts.push(`${hangs.length} hang(s), worst ${hangs[0].durationMs}ms in ${hangs[0].topFrame}.`);
  }
  return parts.join(' ');
}
