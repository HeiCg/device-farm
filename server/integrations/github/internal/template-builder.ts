/**
 * Phase 37 Plan 37-03 Track C — Markdown PR comment template.
 *
 * Mirrors server/azure/internal/template-builder.ts signature shape but
 * extends with screenshot rendering. Per Pitfall 5 in 37-RESEARCH.md, caps
 * inline screenshots at 5; remainder folded behind <details>. Comments
 * over the visible inline-image budget are silently stripped by GitHub's
 * markdown renderer / image proxy when the URL count or total size is
 * excessive.
 */

export type RunStatus = 'running' | 'passed' | 'failed' | 'cancelled';

const EMOJI: Record<RunStatus, string> = {
  running: '⏳',
  passed: '✅',
  failed: '❌',
  cancelled: '⚠️',
};

export interface RenderCommentOpts {
  status: RunStatus;
  jobId: string;
  deviceLabel: string;
  duration?: string;
  /** Signed URLs (TTL ≥ 7 days per Pitfall 5 / Anti-Pattern in research). */
  screenshotsSignedUrls: string[];
  dashboardUrl: string;
  logsUrl?: string;
  videoUrl?: string;
}

/** Hard cap per Pitfall 5 — GitHub strips images when count/size exceeds limit. */
const INLINE_SCREENSHOT_CAP = 5;

export function renderComment(opts: RenderCommentOpts): string {
  const emoji = EMOJI[opts.status];
  const all = opts.screenshotsSignedUrls;
  const inline = all.slice(0, INLINE_SCREENSHOT_CAP);
  const overflow = all.length - inline.length;

  const inlineMd = inline.map((u, i) => `![shot${i}](${u})`).join('\n');
  const screenshotsBlock = overflow > 0
    ? `<details><summary>Screenshots (${all.length} total — ${INLINE_SCREENSHOT_CAP} shown)</summary>\n\n${inlineMd}\n\n[View all ${all.length} on dashboard](${opts.dashboardUrl})\n</details>`
    : inlineMd;

  return [
    `### 📱 Device Farm — Job #${opts.jobId}`,
    '',
    `| Status | Device | Duration |`,
    `|---|---|---|`,
    `| ${emoji} ${opts.status} | ${opts.deviceLabel} | ${opts.duration ?? '—'} |`,
    '',
    screenshotsBlock,
    '',
    `[Open job ↗](${opts.dashboardUrl}) · [Logs](${opts.logsUrl ?? opts.dashboardUrl}) · [Video](${opts.videoUrl ?? opts.dashboardUrl})`,
  ].join('\n');
}
