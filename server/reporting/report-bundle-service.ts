export interface ReportJob {
  id: string;
  status: string;
  platform: string;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  deviceId: string | null;
  metadata: unknown;
  maestroVersion?: string | null;
  osVersion?: string | null;
}

export interface ReportStep {
  id: string;
  jobId: string;
  stepIndex: number;
  flowName: string | null;
  command: string | null;
  status: 'running' | 'passed' | 'failed' | 'skipped';
  durationMs: number | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  error: string | null;
  screenshotPath: string | null;
}

export interface ReportArtifact {
  id: string;
  type: 'video' | 'screenshot' | 'memory' | 'log';
  fileName: string;
  mimeType: string;
  fileSizeBytes: number | null;
  videoStartedAt?: Date | null;
}

export interface ReportHistory {
  flowName: string | null;
  runs: Array<{ jobId: string; status: string; finishedAt: Date | null; durationMs: number | null }>;
  passRate: number;
  avgDurationMs: number;
}

export interface ReportBundle {
  job: ReportJob & {
    durationMs: number | null;
    summary: { total: number; passed: number; failed: number; skipped: number };
  };
  steps: Array<ReportStep & { videoOffsetMs: number | null }>;
  artifacts: Array<ReportArtifact & { downloadUrl: string }>;
  failureFocus: {
    stepId: string;
    flowName: string | null;
    command: string | null;
    error: string;
    screenshotPath: string | null;
    logTailLines: string[];
    videoOffsetMs: number | null;
  } | null;
  reportLinks: { junitXml: string; logsRaw: string };
  history: ReportHistory | null;
}

export interface BuildBundleInput {
  job: ReportJob;
  steps: ReportStep[];
  artifacts: ReportArtifact[];
  logTailLines: string[];
  history: ReportHistory | null;
}

export function buildReportBundle(input: BuildBundleInput): ReportBundle {
  const { job, steps, artifacts, logTailLines, history } = input;
  const video = artifacts.find((a) => a.type === 'video') ?? null;
  const videoStart = video?.videoStartedAt ?? null;

  const offset = (start: Date | null): number | null => {
    if (!start || !videoStart) return null;
    return start.getTime() - videoStart.getTime();
  };

  const summary = { total: steps.length, passed: 0, failed: 0, skipped: 0 };
  for (const s of steps) {
    if (s.status === 'passed') summary.passed++;
    else if (s.status === 'failed') summary.failed++;
    else if (s.status === 'skipped') summary.skipped++;
  }

  const failed = steps.find((s) => s.status === 'failed');
  const failureFocus = failed ? {
    stepId: failed.id,
    flowName: failed.flowName,
    command: failed.command,
    error: failed.error ?? 'Step failed',
    screenshotPath: failed.screenshotPath,
    logTailLines,
    videoOffsetMs: offset(failed.startedAt),
  } : null;

  const durationMs = job.startedAt && job.finishedAt
    ? job.finishedAt.getTime() - job.startedAt.getTime()
    : null;

  return {
    job: { ...job, durationMs, summary },
    steps: steps.map((s) => ({ ...s, videoOffsetMs: offset(s.startedAt) })),
    artifacts: artifacts.map((a) => ({
      ...a,
      downloadUrl: `/jobs/${job.id}/artifacts/${a.id}`,
    })),
    failureFocus,
    reportLinks: {
      junitXml: `/jobs/${job.id}/reports/junit.xml`,
      logsRaw:  `/jobs/${job.id}/logs`,
    },
    history,
  };
}
