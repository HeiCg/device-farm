/**
 * Pure helper for building the Device Farm URL embedded in Azure PR comments.
 *
 * URL-scope decision (Task 5.1):
 *   PR comments link to `/pipeline-runs/<id>` (a multi-job run page).
 *   Share tokens are scoped per-job (`job:<jobId>` JWT subject); applying a
 *   per-job token to a pipeline-run URL would be semantically wrong and would
 *   not grant access to the pipeline-run view. Therefore:
 *
 *   - When `pipelineRunId` is provided (and no `jobId`), the plain URL is
 *     returned regardless of whether a share token is supplied.
 *   - When `jobId` is provided and a `shareToken` is available, the token is
 *     appended as `?t=<jwt>` to give unauthenticated reviewer access.
 *
 * This function is intentionally free of I/O so it can be unit-tested without
 * mocking Fastify or the database.
 */

export interface BuildUrlOpts {
  /** Base URL without trailing slash (e.g. "https://df.example.com"). */
  baseUrl: string;
  /** Job ID — when present and shareToken is set, the URL embeds the token. */
  jobId: string | null;
  /** Pipeline-run ID — used as fallback when no jobId is available. */
  pipelineRunId: string | null;
  /**
   * JWT share token — only embedded when `jobId` is non-null.
   * Ignored for pipeline-run URLs (see decision comment above).
   */
  shareToken: string | null;
}

export function buildReportUrl(opts: BuildUrlOpts): string {
  const base = opts.baseUrl.replace(/\/$/, '');

  if (opts.jobId) {
    return opts.shareToken
      ? `${base}/jobs/${opts.jobId}?t=${opts.shareToken}`
      : `${base}/jobs/${opts.jobId}`;
  }

  if (opts.pipelineRunId) {
    // Share token is not applicable to pipeline-run-scoped URLs.
    return `${base}/pipeline-runs/${opts.pipelineRunId}`;
  }

  return base;
}
