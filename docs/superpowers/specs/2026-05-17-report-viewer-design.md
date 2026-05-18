# Report Viewer Redesign — Design Spec

**Date:** 2026-05-17
**Status:** Approved
**Scope:** `/jobs/[id]`, `/jobs` (sub-tabs), `server/jobs`, `server/reporting`, `server/auth` (new share token), `server/azure` (commenter update)

## Goal

Turn `/jobs/[id]` into a report viewer in the spirit of ReportPortal/Allure, closing four concrete UX gaps and adding share-link support for external reviewers (Azure DevOps PR comments).

The four gaps:

1. **Step timeline with screenshots.** Walking an execution step-by-step with the screenshot at that moment, the command, and the relevant log slice.
2. **Video synchronised to steps.** Clicking a step seeks the video to that moment; step markers on the video timeline.
3. **Failure analysis panel.** When a job fails, a prominent block surfaces the failing step, screenshot, error message, log tail, and a jump-to-video button.
4. **Report-tool visual.** The current layout is "tabs on top, content below" — replace with a master-detail report shell, sticky stats header, persistent status colour.

Plus:

- Sub-tabs in `/jobs`: List (existing) | Suites | History | Trends
- JUnit XML download (existing generator, surface a clear button)
- Shareable signed link for one job, used by the Azure DevOps PR commenter

## Non-goals

- Do NOT embed or surface Maestro's native HTML report (`--format html-detailed`). Only JUnit is generated.
- Do NOT build run-to-run diff comparison. History strip + suite pass-rate sparkline are the limit.
- Do NOT migrate `/pipelines` or `/sessions` to the new shell. Scope is `/jobs` only.
- Do NOT rewrite `RecordingService`, `ScreenshotService`, or `junit-generator.ts`. They work.
- Do NOT add SSO/OIDC for the share token. HMAC-signed JWT scoped to one job is enough.
- Do NOT build a full retention management UI. A single dropdown in `/settings` for 5/15/30 days suffices; the underlying `lifecycle/retention-task.ts` already exists.

## Architecture

Five isolated units:

```
┌─ Step Ingestion ────────────────────────────────────────┐
│  server/jobs/                                            │
│  - maestro-parser.ts: record wallclock ts on parse       │
│  - commands-json-loader.ts (NEW): read commands-*.json   │
│    from --test-output-dir post-terminal; upsert          │
│    started_at/ended_at when present (overrides wallclock)│
│  - job-executor.ts: pass --test-output-dir; record       │
│    video_started_at when recording starts                │
└──────────────────────────────────────────────────────────┘
                          │ writes
                          ▼
┌─ Schema delta (one migration) ──────────────────────────┐
│  job_steps  + started_at TIMESTAMP, + ended_at TIMESTAMP │
│  artifacts  + video_started_at TIMESTAMP (video only)    │
│  No new tables.                                          │
└──────────────────────────────────────────────────────────┘
                          │ reads
                          ▼
┌─ Report API ────────────────────────────────────────────┐
│  GET  /jobs/:id/report         → full bundle for viewer  │
│  POST /jobs/:id/share-token    → mint JWT for one job    │
│  GET  /jobs/:id (with ?t=jwt)  → public read via token   │
│  GET  /flows/:name/history     → sparkline + last N runs │
│  GET  /jobs?tab=suites|history|trends → aggregated views │
└──────────────────────────────────────────────────────────┘
                          │ consumed by
                          ▼
┌─ Web shell (web/src/routes/jobs) ───────────────────────┐
│  /jobs/+page.svelte             : ReportTabs              │
│  /jobs/[id]/+page.svelte (REWRITE):                       │
│    ReportShell                                            │
│      ├ ReportHeader   (stats, status, share, download)    │
│      ├ Pane.Left  : FlowStepTree                          │
│      ├ Pane.Center: StepDetail + FailureFocusPanel        │
│      └ Pane.Right : SyncVideoPlayer + HistoryStrip        │
└──────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─ Share Token (server/auth) ─────────────────────────────┐
│  report-token.ts (NEW)                                   │
│   - mint(jobId, ttlDays) → JWT (HS256)                   │
│   - verify(token, jobId) → { ok, expiresAt }             │
│  Preflight hook on /jobs/:id and /jobs/:id/report:       │
│   if ?t= present, validate; else require normal auth     │
│  Azure PR commenter uses mint() when posting comment     │
└──────────────────────────────────────────────────────────┘
```

**Boundary table:**

| Unit | Does | Depends on |
|---|---|---|
| Step ingestion | Persists `started_at/ended_at` per step + `video_started_at` | Maestro stdout, `commands-*.json` |
| Schema delta | Adds nullable columns | drizzle migration |
| Report API | Serialises bundle; validates share token | DB, `report-token` |
| Web shell | Renders; no business logic | Report API |
| Share Token | Mints/verifies JWT scoped per job | config secret, `jose` (proposed) |

All share-token logic lives in `server/auth/report-token.ts`, NOT inside `server/azure/`. Azure only calls `tokenService.mint()`. That keeps the token reusable for future Slack/email integrations.

## Data model

### Schema delta (one migration)

```ts
// server/db/schema.ts
export const jobSteps = pgTable('job_steps', {
  // ... existing columns
  startedAt: timestamp('started_at'),          // NEW, nullable
  endedAt:   timestamp('ended_at'),            // NEW, nullable
});

export const artifacts = pgTable('artifacts', {
  // ... existing columns
  videoStartedAt: timestamp('video_started_at'), // NEW, nullable (video rows only)
});
```

All new columns nullable. Old runs remain valid; UI degrades to "sync unavailable" when timestamps are missing.

**Suites/History/Trends are not new tables** — they are aggregated reads over `jobs + job_steps`, grouped by `flow_name`.

### `GET /jobs/:id/report` response shape

```ts
{
  job: {
    id, status, platform, createdAt, startedAt, finishedAt,
    deviceId, durationMs,
    summary: { total, passed, failed, skipped }     // derived
  },
  steps: Array<{
    id, flowName, command, status,
    startedAt, endedAt, durationMs,                 // new
    error,
    screenshotPath,                                 // existing
    videoOffsetMs: number | null                    // derived: startedAt - video.videoStartedAt
  }>,
  artifacts: Array<{
    id, type, fileName, mimeType, sizeBytes,
    downloadUrl,                                    // /jobs/:id/artifacts/:artifactId
    videoStartedAt?: ISO                            // video only
  }>,
  failureFocus: null | {                            // derived: first failed step
    stepId, flowName, command, error,
    screenshotPath,
    logTailLines: string[],                         // last N lines up to failure
    videoOffsetMs: number | null
  },
  reportLinks: {
    junitXml: '/jobs/:id/reports/junit.xml',
    logsRaw:  '/jobs/:id/logs'
  },
  history: {                                        // last 10 runs of the same flow
    flowName: string | null,
    runs: Array<{ jobId, status, finishedAt, durationMs }>,
    passRate: number,
    avgDurationMs: number
  }
}
```

### `POST /jobs/:id/share-token`

Auth required.

```
request:  { ttlDays: 5 | 15 | 30 }
response: { token: '<jwt>', expiresAt: ISO, url: '/jobs/:id?t=<jwt>' }
```

JWT claims:

```ts
{
  sub: 'job:<uuid>',     // scope: this job only
  iat, exp,
  scope: 'read'          // read-only
}
```

HMAC-SHA256, secret from `config.security.share_token_secret`.

### `GET /jobs?tab=suites`

```ts
[
  {
    flowName: 'login.yaml',
    totalRuns: 47, passed: 42, failed: 5, passRate: 0.89,
    avgDurationMs: 12_300,
    lastRunAt: ISO, lastStatus: 'passed',
    trend: number[]    // last 10 outcomes encoded: [1,1,0,1,...]
  }
]
```

### `GET /jobs?tab=trends`

```ts
{
  byDay:  Array<{ date: 'YYYY-MM-DD', passed: int, failed: int, total: int }>,
  byFlow: Array<{ flowName, passed, failed }>,
  windowDays: 7 | 30
}
```

### `GET /jobs?tab=history`

Paginated, ordered by `created_at desc`, filters `flowName | status | dateRange`. Reuses the existing `listJobs` with extra filters.

### Settings additions

```yaml
# config.yaml
storage:
  artifacts:
    retention_days: 30   # existing; UI now validates 5 | 15 | 30
security:
  share_token_secret: "<hex>"          # NEW; required when sharing.enabled
sharing:
  enabled: false                       # NEW; opt-in
  default_ttl_days: 30                 # NEW; UI offers 5 | 15 | 30
ui:
  use_report_shell: false              # NEW; rollout flag, flip after smoke
```

`/settings` UI: dropdown "Retention (days)" with presets 5 / 15 / 30, hitting `PATCH /admin/config`.

## UI components & layout

### Desktop layout (≥1280px)

```
┌─ ReportHeader (sticky top) ─────────────────────────────────────────────┐
│ ● PASSED  job-a1b2c3d4   android · pixel_7 · 2m 14s · 2026-05-17 14:32 │
│ 32 passed · 3 failed · 1 skipped         [Share ▾] [Download ▾] [⋯]    │
└─────────────────────────────────────────────────────────────────────────┘

┌─ FlowStepTree ──┐ ┌─ StepDetail (active step) ─────┐ ┌─ Right Pane ───┐
│ ▾ login.yaml ✓ │ │ ● FAILED  tapOn("Submit")       │ │ ┌───SyncVideo──┐│
│   ✓ launchApp  │ │ login.yaml · step 5/8           │ │ │ ▶ 1:24/2:14 ││
│   ✓ tapOn(Em.) │ │ Started 14:32:47 · 1.2s         │ │ │ [▮▮▮━━━━━━] ││
│   ✗ tapOn(Sub) │ │                                 │ │ │ markers:    ││
│   • assertVis  │ │ ┌─────────────────────────────┐ │ │ │ │ │ ┃ │ │ │ ││
│   • takeScreen │ │ │   [screenshot at failure]   │ │ │ └─────────────┘│
│ ▸ checkout.yaml│ │ │                             │ │ │                │
│ ▸ logout.yaml ✓│ │ └─────────────────────────────┘ │ │ ┌─History──────┐│
│                │ │                                 │ │ │ login.yaml   ││
│                │ │ ⚠ FAILURE                       │ │ │ pass: 89%    ││
│                │ │ Element not found:              │ │ │ ▁▂▆█▅▆█▆▇█  ││
│                │ │ Cannot find element matching... │ │ │ avg 12.3s    ││
│                │ │                                 │ │ │              ││
│                │ │ [▶ Jump to video at 1:24]       │ │ │ last 10 runs:││
│                │ │                                 │ │ │ ✓✓✓✗✓✓✓✗✓✓  ││
│                │ │ ── Log tail (last 30 lines) ──  │ │ │              ││
│                │ │ 14:32:46 tap (320,540)          │ │ └──────────────┘│
│                │ │ 14:32:47 ERROR no match...      │ │                │
└────────────────┘ └─────────────────────────────────┘ └────────────────┘
   240px              flexible                           360px
```

### Responsive

- `≥1280px`: 3 panes side by side
- `768–1279px`: tree collapses to top accordion; right pane becomes "Video + History" tab
- `<768px`: fully stacked vertically; simplified sticky header

### Component map

```
web/src/lib/components/reports/        # NEW namespace
├── ReportShell.svelte             3-pane layout + sticky header
├── ReportHeader.svelte            stats + status + actions
├── FlowStepTree.svelte            flow → step hierarchy, click = setActiveStep
├── StepDetail.svelte              screenshot + command + metadata
├── FailureFocusPanel.svelte       red block: error + log tail + jump
├── SyncVideoPlayer.svelte         wraps VideoPlayer, exposes seekTo(ms), markers
├── HistoryStrip.svelte            pass-rate + sparkline + last 10 outcomes
├── ShareLinkDialog.svelte         mint token, copy URL
└── DownloadMenu.svelte            JUnit / raw logs / video

web/src/lib/components/jobs/        # REUSE (existing)
├── VideoPlayer.svelte             unchanged; SyncVideoPlayer wraps it
├── LogViewer.svelte               reused inside StepDetail (log tail)
├── StatusBadge.svelte             used in header + tree
└── MetricsPanel.svelte            removed from shell; optional inside header

web/src/routes/jobs/+page.svelte   # MODIFIED
└── adds <ReportTabs> with List | Suites | History | Trends

web/src/routes/jobs/[id]/+page.svelte  # REWRITE
└── reduced to: <ReportShell {bundle} />
```

### Interaction model

- Single `$state` `activeStepId` in `ReportShell` controls which step the centre pane displays.
- Click a step in the tree → `activeStepId = step.id`.
- "Jump to video at X" inside `FailureFocusPanel` → calls `videoPlayerRef.seekTo(step.videoOffsetMs)`.
- Live mode (`job.status === 'running'`): tree + log stream via existing WebSocket; centre shows the most recent `running` step; right pane hides the video and renders `DevicePreview` instead.

### Reuse explicit

- `DevicePreview`, `VideoPlayer`, `LogViewer`, `StatusBadge`, `Pagination` — unchanged
- `StepList.svelte` (current) is **replaced** by `FlowStepTree.svelte` (hierarchical flow→step layout)
- `DebugArtifacts.svelte` (current) is **absorbed** into `StepDetail` (each step renders its own `--debug-output` screenshot)
- `MaestroOptionsPanel.svelte` (current) moves into a collapsible "Configuration" inside `ReportHeader`

### `/jobs` sub-tabs

```
┌──────────────────────────────────────────────────────────┐
│ Jobs                                                     │
│ [ List ] [ Suites ] [ History ] [ Trends ]               │
├──────────────────────────────────────────────────────────┤
│  (active tab content)                                    │
└──────────────────────────────────────────────────────────┘
```

- `List` = current page untouched (`JobCard` grid)
- `Suites` = table grouped by `flow_name` with sparkline of the `trend` array
- `History` = chronological table with filters
- `Trends` = pass/fail charts per day and per flow

### Visual style

- Tailwind + existing tokens (`bg-background`, `text-on-surface`, `border-outline-variant/10`) — design system unchanged
- Status colours: passed → primary green; failed → tertiary red; running → primary; skipped → outline-variant
- Sparklines: inline SVG with 10 rectangles (no external dependency)
- Trend charts: lib choice deferred to the plan (chart.js if already bundled, else manual SVG)

## Error handling

| Scenario | Behaviour |
|---|---|
| `commands-*.json` missing or malformed | Loader logs WARN, falls back to parser wallclock. Steps still get timestamps (less precise). UI unaffected. |
| Step missing `started_at`/`ended_at` (old run) | UI hides "Started HH:MM:SS" line and disables "Jump to video" (grey button, tooltip "Sync unavailable for this run") |
| `video_started_at` missing | `videoOffsetMs = null` for every step. Video plays without markers. Tree and StepDetail still work. |
| Screenshot file missing on disk | `<img>` shows grey placeholder with broken_image icon. Layout intact. |
| `failureFocus.logTailLines` empty | Panel still renders (error + screenshot); log tail section disappears. |
| JUnit XML row exists but file missing | `DownloadMenu` shows the button disabled with "Unavailable" |
| Share token expired | 403 with "This link has expired. Request a new one from the team." Does not leak which job. |
| Share token signature invalid | 401, same page, same message (no validity oracle) |
| Retention deletes artifact while reviewer opens via share link | Page loads, shows "Video and screenshots were removed by the N-day retention policy" — does not break |
| `/jobs?tab=suites` empty | Empty state "No runs in the last 24h" + CTA "View all" |
| WebSocket drops in live mode | Auto-reconnect (existing `createJobStream`); yellow "Reconnecting…" banner |

## Testing strategy

- **`commands-json-loader.ts`** (Vitest unit): fixtures of real `commands-*.json` captured from a smoke run + malformed file + missing file. Assert DB updates via drizzle mock.
- **`maestro-parser.ts` wallclock** (Vitest unit): inject `clock()` callback, feed hard-coded lines, assert `command → ts` map populated at the right points.
- **`report-token.ts`** (Vitest unit): mint/verify happy path; expired; wrong job sub; tampered signature; secret rotation invalidates old tokens.
- **`/jobs/:id/report` route** (Vitest integration with DB fixture): job with failure; job without failure; job without artifacts; old job without new timestamps; history cursor.
- **`/jobs/:id?t=` middleware** (Vitest integration): valid token bypasses auth; invalid token falls through to auth; valid token for different job returns 403.
- **UI components** (Vitest + @testing-library/svelte):
  - `FlowStepTree`: hierarchy render; active state; click handler
  - `FailureFocusPanel`: with error; without `logTailLines`; "Jump to video" disabled when `videoOffsetMs=null`
  - `SyncVideoPlayer`: `seekTo(ms)` sets `video.currentTime = ms/1000`
  - `HistoryStrip`: sparkline of 10 outcomes
  - `ShareLinkDialog`: calls mint, copies URL, shows expiry
- **Manual E2E smoke**: run a real job with intentional failure → open UI → validate timeline filled, video sync, jump works, share link opens in incognito.

### Out-of-scope tests

- No visual regression (no Percy/Chromatic — too much overhead)
- No 1000-step performance test (Maestro rarely exceeds 50–100 steps per job)
- No fuzz tests for `commands-*.json` parser (fixture coverage suffices)

## Rollout

Phase ordering for the implementation plan:

1. **Schema + ingestion** — migration + wallclock parser + `commands-json-loader`. No UI change. Verify in production that timestamps populate. Reversible (nullable columns).
2. **Report API** — `/jobs/:id/report`, `/jobs?tab=suites|history|trends`. Smoke via curl/insomnia. No UI change.
3. **Share token** — `report-token` service + middleware + `POST /jobs/:id/share-token`. No UI yet. Validate via curl.
4. **UI shell** — `ReportShell` replaces `/jobs/[id]/+page.svelte`. Sub-tabs in `/jobs`. This is the visible change. Behind feature flag `config.ui.useReportShell` (default `false` on first deploy, flip to `true` after smoke).
5. **Azure PR commenter uses share token** — minimal change in `server/azure/plugin.ts`. PR comment URL switches to `?t=<jwt>`.
6. **Settings UI for retention** — dropdown 5/15/30 in `/settings`, `PATCH /admin/config`.

### Rollback

- Migration is additive (`ADD COLUMN`) — no rollback needed when feature disabled.
- Feature flag `useReportShell=false` reverts UI to the current state in seconds.
- Token middleware is opt-in via `?t=`; disabling means stop minting new tokens, live tokens expire naturally.

### Security

- JWT secret required at boot when `sharing.enabled=true`; server refuses to start otherwise.
- HS256 with `exp` claim; `iat` optional (debug only).
- No refresh tokens. Lost link → request a new one.
- Rate limit on `POST /jobs/:id/share-token`: 10/min per user.
- `?t=` read from query string only, never cookie; front never persists to localStorage.
- CSRF n/a (read-only GET with bounded scope).
- Log tail and error message rendered via Svelte `{value}` (auto-escape); never `{@html}`.

### Observability

Existing pino metrics cover most paths. Add:

- `report.token.minted` / `report.token.verified` / `report.token.rejected{reason}`
- `report.commandsJson.loaded` / `report.commandsJson.failed`
- `report.view.opened{authed|shareToken}`

## Open questions for the plan

- JWT lib: `jose` (zero-dep, modern) vs `jsonwebtoken` (classic) — preference for `jose`.
- Trends chart lib: confirm whether `chart.js` is already bundled or go manual SVG.
- Sparkline in `HistoryStrip`: manual inline SVG (assumed here).
