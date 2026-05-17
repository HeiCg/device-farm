/**
 * Phase 37 Plan 37-05 — webhook payload builder.
 *
 * Extends the v3 webhook envelope with 3 optional Phase 37 fields per
 * SPEC-08 (additive only — existing consumers see the same body shape,
 * with the new fields appearing as null when no associated data exists).
 *
 *   - preflight     — fetched from preflightModule.repo when
 *                     job.metadata.preflightRunId is set
 *   - analysis      — fetched from analysisModule.repo by jobId
 *   - parallelDeploy — read from job.metadata.parallelDeploy verbatim
 *
 * The builder is dependency-injected so reporting can degrade gracefully
 * when the analysis/preflight plugins are absent (config-driven opt-in).
 * Pure function — no Fastify, no DB clients, no side effects beyond the
 * repo lookups passed in.
 */

// ---------- Repo shapes (structural, kept loose to avoid cross-module type leakage) ----------

export interface AnalysisRowLike {
  id: string;
  payload: {
    stats?: { candidate_screens?: number };
    deep_link_entries?: Array<{ scheme: string; is_oauth_callback: boolean }>;
  };
}

export interface PreflightRowLike {
  id: string;
  status: string;
  rulesVersion: string;
  blockers: unknown;
  warnings: unknown;
}

export interface AnalysisModuleLike {
  repo: {
    getByJobId: (jobId: string) => Promise<AnalysisRowLike | null>;
  };
}

export interface PreflightModuleLike {
  repo: {
    getById: (id: string) => Promise<PreflightRowLike | null>;
  };
}

export interface WebhookPayloadDeps {
  analysisModule: AnalysisModuleLike | null;
  preflightModule: PreflightModuleLike | null;
}

// ---------- Job + payload types ----------

export interface JobLike {
  id: string;
  status: string;
  platform: 'android' | 'ios';
  metadata: Record<string, unknown> | null;
}

export interface PreflightSummary {
  pass: boolean;
  rulesVersion: string;
  blockers: Array<{ rule_id: string; severity: 'blocker'; message: string }>;
  warnings: Array<{ rule_id: string; severity: 'warning'; message: string }>;
}

export interface AnalysisSummary {
  analysisId: string;
  candidateScreensCount: number;
  deepLinks: Array<{ scheme: string; is_oauth_callback: boolean }>;
}

export interface ParallelDeploySummary {
  deviceCount: number;
  devices: Array<{
    deviceId: string;
    status: 'passed' | 'failed';
    durationMs?: number;
    error?: string;
  }>;
}

export interface WebhookPayloadV3 {
  /** Always present — the v3 event name. */
  event: string;
  /** Always present — minimal job shape (id + status + platform). */
  job: { id: string; status: string; platform: 'android' | 'ios' };
  /** Always present — ISO 8601 timestamp. */
  timestamp: string;

  // ---------- Phase 37 additions (all optional / nullable, SPEC-08 additive) ----------
  preflight?: PreflightSummary | null;
  analysis?: AnalysisSummary | null;
  parallelDeploy?: ParallelDeploySummary | null;
}

// ---------- Builder ----------

/**
 * Build the v3 webhook payload extended with Phase 37 optional fields.
 * All fields are populated best-effort — a repo throwing for analysis
 * does NOT block the preflight lookup or vice versa; failed lookups
 * surface as null fields and are logged by the caller if desired.
 */
export async function buildWebhookPayload(
  deps: WebhookPayloadDeps,
  job: JobLike,
  event: string,
): Promise<WebhookPayloadV3> {
  // Track A: analysis (cross-module lookup; jobId is the build identifier in v3.0).
  let analysis: AnalysisSummary | null = null;
  if (deps.analysisModule) {
    try {
      const row = await deps.analysisModule.repo.getByJobId(job.id);
      if (row) {
        const screens = row.payload.stats?.candidate_screens ?? 0;
        const deepLinks = row.payload.deep_link_entries ?? [];
        analysis = {
          analysisId: row.id,
          candidateScreensCount: screens,
          deepLinks: deepLinks.map((d) => ({
            scheme: d.scheme,
            is_oauth_callback: d.is_oauth_callback,
          })),
        };
      }
    } catch {
      analysis = null;
    }
  }

  // Track B: preflight (via job.metadata.preflightRunId).
  let preflight: PreflightSummary | null = null;
  const preflightRunId = readPreflightRunId(job.metadata);
  if (preflightRunId && deps.preflightModule) {
    try {
      const row = await deps.preflightModule.repo.getById(preflightRunId);
      if (row) {
        preflight = {
          pass: row.status !== 'blocked',
          rulesVersion: row.rulesVersion,
          blockers: Array.isArray(row.blockers)
            ? (row.blockers as PreflightSummary['blockers'])
            : [],
          warnings: Array.isArray(row.warnings)
            ? (row.warnings as PreflightSummary['warnings'])
            : [],
        };
      }
    } catch {
      preflight = null;
    }
  }

  // Track D: parallel deploy (read verbatim from job metadata).
  const parallelDeploy = readParallelDeploy(job.metadata);

  return {
    event,
    job: { id: job.id, status: job.status, platform: job.platform },
    timestamp: new Date().toISOString(),
    preflight,
    analysis,
    parallelDeploy,
  };
}

// ---------- helpers ----------

function readPreflightRunId(metadata: Record<string, unknown> | null): string | null {
  if (!metadata) return null;
  const raw = (metadata as { preflightRunId?: unknown }).preflightRunId;
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
}

function readParallelDeploy(
  metadata: Record<string, unknown> | null,
): ParallelDeploySummary | null {
  if (!metadata) return null;
  const raw = (metadata as { parallelDeploy?: unknown }).parallelDeploy;
  if (!raw || typeof raw !== 'object') return null;
  const cand = raw as Partial<ParallelDeploySummary>;
  if (typeof cand.deviceCount !== 'number' || !Array.isArray(cand.devices)) {
    return null;
  }
  return {
    deviceCount: cand.deviceCount,
    devices: cand.devices.map((d) => ({
      deviceId: String(d.deviceId),
      status: d.status === 'failed' ? 'failed' : 'passed',
      ...(typeof d.durationMs === 'number' ? { durationMs: d.durationMs } : {}),
      ...(typeof d.error === 'string' ? { error: d.error } : {}),
    })),
  };
}
