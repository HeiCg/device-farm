# Azure DevOps PR-Bot for device-farm — Design

**Date:** 2026-05-15
**Status:** Draft (awaiting review)
**Scope:** MVP only — Scenario 1 (QA Automation repo PRs trigger device-farm runs)

## Purpose

Allow QA Automation engineers to validate new Maestro test scripts on real
emulators by opening a Pull Request in their Azure DevOps repo. The device-farm
detects the PR, parses an instruction block from the description, allocates a
device, runs a canonical pre-setup (login + APK install + permissions + code
capture), executes the requested Maestro suites, and reports back into the PR.

Scenario 2 (dev mobile repo PRs running fixed suites) is **out of scope** and
will be a follow-up.

## Non-Goals

- Form-based UI ("Jenkins-style") for creating jobs manually. Configuration
  lives in `config.yaml` for the MVP.
- Multi-device matrix runs (one device per run; matrix is a follow-up).
- Custom pre-setup scripts per repo. The pre-setup is a single canonical
  device-stream-script the user authors once; the device-farm just runs it
  with the right env.
- Resuming a mid-flight stage after server restart (we re-run the whole run,
  not the failed stage). Stage-level checkpointing is a follow-up.
- Webhook signature verification beyond Basic Auth (Azure Service Hooks
  support Basic Auth natively; HMAC is not required for the MVP).

## End-to-end Flow

```
[QA opens/updates PR → main, non-draft]
            ↓
[Azure DevOps Service Hook → POST /api/azure/pr-events] (Basic Auth)
            ↓
[device-farm: match repo (config.yaml), fetch PR, parse description]
            │
            ├─ no ```device-script block → 200 + no-op
            ├─ active run for this PR    → cancel it (cancel-on-new-push)
            └─ create pipeline_run
            ↓
[Pipeline run with 4 stage groups:]
   1. clone        → GitService clones repo @ PR head commit; resolves
                     `account` → password via config.js in the cloned repo
   2. pre-setup    → device-stream-script (canonical, authored by user)
                     allocates device, opens URL, logs in, generates
                     installation, exports env vars (e.g. INSTALLATION_CODE)
                     via `##device-farm[setvariable name=K]V` stdout markers
   3. test         → Maestro: N sequential executions, one per suite name
                     in the comma-separated `suite:` list. Independent —
                     a failed suite does NOT skip subsequent suites.
   4. teardown     → releases device, cleans workspace (when: always)
            ↓
[Update single PR comment: status emoji + link to run in device-farm UI]
```

## PR Description Block

QAs add a fenced code block to the PR description:

````
```device-script
url: https://....../link
account: name_1
platform: ios
suite: SmokeTests, LoginTests
```
````

**Schema (Zod):**

```ts
const prBlockSchema = z.object({
  url: z.string().url(),
  account: z.string().min(1).max(128),
  platform: z.enum(['android', 'ios']),
  suite: z.string()
    .min(1)
    .transform(s => s.split(',').map(x => x.trim()).filter(Boolean))
    .pipe(z.array(z.string().min(1)).min(1)),
});
```

**Parse rules:**

- Regex `/```device-script\n([\s\S]*?)\n```/` (multiline, dotAll-equivalent).
- 0 matches → no-op (200 OK, no run created).
- ≥2 matches → comment "found N device-script blocks, expected 1" + 200.
- 1 match, YAML parse fail → comment with parser error + 200.
- 1 match, Zod fail → comment with structured field errors + 200.

## Configuration (`config.yaml`)

```yaml
azure_devops:
  pat: ${AZURE_DEVOPS_PAT}              # used for clone + PR API + comment
  webhook_basic_auth:
    username: device-farm
    password: ${WEBHOOK_PASSWORD}
  pr_integrations:
    - id: trampo-automation
      repo_url: https://dev.azure.com/org/proj/_git/repo
      target_branch: main               # only fires when PR targets this
```

`pat` and `webhook_basic_auth.password` resolve from environment variables to
avoid committing credentials. Zod validates the YAML at boot (`server/config/schema.ts`).

## Webhook Endpoint

`POST /api/azure/pr-events`

**Auth:** `Authorization: Basic <base64(user:pwd)>` matching
`config.azure_devops.webhook_basic_auth`. 401 on mismatch.

**Accepted event types:**
- `git.pullrequest.created`
- `git.pullrequest.updated`

Other event types → 200 + ignore.

**Filters (all must pass; otherwise 200 + ignore, no DB record):**
- `resource.isDraft === false`
- `resource.targetRefName === 'refs/heads/' + integration.target_branch`
- `resource.repository.url` matches one entry in `config.pr_integrations[].repo_url`
- `resource.status === 'active'` (skip completed/abandoned)

## Pipeline Template (hardcoded)

The template is constructed in code at run-creation time, not stored in YAML.
A new module `server/pipelines/internal/pr-template-builder.ts` builds:

```ts
function buildPrPipelineStages(prBlock, repoIntegration, prMeta): Stage[] {
  return [
    {
      name: 'clone',
      type: 'internal-clone',                    // NEW stage type, server-internal
      repo_url: repoIntegration.repo_url,
      ref: prMeta.sourceRefName,                 // PR head branch
      commit: prMeta.lastMergeSourceCommit,
      resolve_account_from: 'config.js',
      account: prBlock.account,                  // used by clone stage to set PASSWORD env
    },
    {
      name: 'pre-setup',
      type: 'device-stream-script',              // NEW stage type
      script_path: '.device-farm/pre-setup.js',  // relative to workspace
      platform: prBlock.platform,
      timeout: 600,
      env: {
        URL: prBlock.url,
        ACCOUNT: prBlock.account,
        PLATFORM: prBlock.platform,
        // PASSWORD added by clone stage via inter-stage env passing
      },
    },
    ...prBlock.suite.map((s, i) => ({
      name: `test-${s}`,
      type: 'maestro' as const,
      flows: `Tests/${s}/**/*.yaml`,             // glob convention; user can adjust
      platform: prBlock.platform,
      timeout: 1800,
      when: 'always' as const,                   // run all suites independently
      env: {},                                   // inherits exported env from pre-setup
    })),
    {
      name: 'teardown',
      type: 'internal-release',                  // NEW stage type, server-internal
      when: 'always',
    },
  ];
}
```

Suites run sequentially on the same device (no device re-allocation between
suites). Independence means a failed suite does NOT mark subsequent suites
as skipped — the `when: always` ensures they still execute.

## Schema Extensions

### `pipeline-schema.ts`

```ts
// triggerSchema: add azure-pr (DB persistence; not used in MVP since template
// is hardcoded — but reserved for future "create pipeline from YAML with
// azure-pr trigger" if needed)
export const triggerSchema = z.union([
  z.literal('api').transform(() => ({ type: 'api' as const })),
  z.object({ schedule: z.string() }).transform(...),
  z.object({
    azure_pr: z.object({ repo_id: z.string() }),
  }).transform(v => ({ type: 'azure-pr' as const, repoId: v.azure_pr.repo_id })),
]);

// stageSchema: extend type union
export const stageSchema = z.object({
  ...
  type: z.enum([
    'script',
    'maestro',
    'device-stream-script',     // NEW
    'internal-clone',           // NEW (server-internal, not user-authored)
    'internal-release',         // NEW (server-internal)
  ]).default('script'),
  script_path: z.string().optional(),   // NEW: device-stream-script entry point
  ...
});
```

### Database

**New column** (migration `0006_pipeline_runs_azure_pr_comment.sql`):

```sql
ALTER TABLE pipeline_runs ADD COLUMN azure_pr_comment_id text;
ALTER TABLE pipeline_runs ADD COLUMN azure_pr_integration_id text;
CREATE INDEX pipeline_runs_pr_id_idx ON pipeline_runs (azure_pr_id) WHERE azure_pr_id IS NOT NULL;
```

`azure_pr_comment_id` stores the comment thread ID so subsequent runs PATCH
the same thread. `azure_pr_integration_id` stores which `pr_integrations[].id`
the run belongs to (for routing + observability).

### Configuration

`server/config/schema.ts` adds:

```ts
azure_devops: z.object({
  pat: z.string().min(1),
  webhook_basic_auth: z.object({
    username: z.string().min(1),
    password: z.string().min(1),
  }),
  pr_integrations: z.array(z.object({
    id: z.string().min(1),
    repo_url: z.string().url(),
    target_branch: z.string().default('main'),
  })).default([]),
}).optional(),
```

## Inter-Stage Environment Variables

Stage stdout is parsed line-by-line. Lines matching:

```
##device-farm[setvariable name=KEY]VALUE
```

are extracted, the marker is removed from the persisted/broadcast log, and
`{KEY: VALUE}` is added to an in-memory `Map<runId, Map<string,string>>`
maintained by the executor for that run.

Before running the next stage, the executor merges:
```
finalEnv = { ...stage.env, ...exportedEnv }
```

so an exporting stage's outputs become the next stage's inputs (with the next
stage's explicit `env:` still overriding if there's a collision — explicit
wins).

This map is **process-local** and lost on server restart, which is acceptable
because orphan runs are cancelled at boot anyway.

## Cancel-on-New-Push

When a webhook arrives for a PR with an in-flight run:

1. `SELECT id FROM pipeline_runs WHERE azure_pr_id=X AND status IN ('pending','running')`
2. For each row: call `runningRuns.get(runId)?.abort()` (the `Map<runId, AbortController>`
   already present in `pipelines/internal/service.ts` from Phase 25 DEFERRED-25-C).
3. Mark each row `status='cancelled'` with a reason.
4. Wait up to 5s for the abort to release devices; then proceed with the new run.

If multiple webhooks fire rapidly (e.g. force-push + edit), an in-memory
debounce of 2s per `pr_id` collapses them.

## Server-Internal Stage Types

### `internal-clone`

Runs in the server process (no spawn). Responsibilities:
1. `GitService.clone(repo_url, ref, commit)` → returns workspace path.
2. Reads `config.js` from the workspace, runs it through a safe extractor
   (regex or `vm.runInNewContext` with no globals) to obtain a `USERNAMES`
   object: `{ [account]: { password: string } }`.
3. If `prBlock.account` is missing from `USERNAMES` → stage fails with
   `unknown account 'X'`.
4. Emits `##device-farm[setvariable name=PASSWORD]<value>` so subsequent
   stages inherit. Also exports `WORKSPACE_DIR`.

The password never reaches logs (the marker is masked at parse time when
the variable name is in a configurable secret-set: `['PASSWORD', 'PAT', 'TOKEN']`).

### `internal-release`

Runs in the server process. Responsibilities:
1. Transitions the device through `allocated → cleanup → idle` via the pool
   manager (reusing existing state-machine logic).
2. `rm -rf` the workspace.
3. Never fails (best-effort).

## Pre-setup Runtime (`device-stream-script`)

Stage executor for `device-stream-script` (new file
`server/pipelines/internal/device-stream-executor.ts`):

```ts
async function executeDeviceStreamScript(stage, ctx) {
  // 1. Allocate device (reuse maestro-stage allocator)
  const device = await ctx.pool.allocate({ platform: stage.platform });
  ctx.lockDevice(device);  // pinned for subsequent stages in this run

  // 2. Spawn node child process
  const proc = spawn(
    'node',
    [path.join(ctx.workspaceDir, stage.script_path)],
    {
      env: {
        ...process.env,                           // minimal inherited env
        ...stage.env,
        ...ctx.exportedEnv,                       // from previous stages
        DEVICE_SERIAL: device.emulatorId,
        DEVICE_PLATFORM: device.type,
        WORKSPACE_DIR: ctx.workspaceDir,
      },
      cwd: ctx.workspaceDir,
    }
  );

  // 3. Stream stdout/stderr → WS broadcast + DB log buffer + env marker parser
  const lineParser = createLineParser({
    onMarker: (k, v) => ctx.setExported(k, v),
    onLine: (line) => ctx.broadcast(stage.id, line),
  });
  proc.stdout.on('data', lineParser);
  proc.stderr.on('data', lineParser);

  // 4. Await exit; timeout enforces stage.timeout
  return awaitExit(proc, stage.timeout * 1000);
}
```

The script is plain Node — no special library injected by device-farm. The
script imports the `device-stream` npm package itself and uses
`DEVICE_SERIAL` to attach. This keeps coupling minimal and allows the script
to evolve independently of device-farm.

## PR Comment Rendering

Single comment per PR, updated in place. Markdown:

```markdown
### Device Farm — <emoji>

**Status:** <passed|failed|cancelled|running>
**Run:** [#<runId>](https://<device-farm-host>/pipeline-runs/<runId>)
**Commit:** `<short-sha>`
**Suites:** <suite1, suite2, ...>
```

Emoji map: ✅ passed · ❌ failed · ⚠️ cancelled · ⏳ running.

Implementation: `server/pipelines/internal/azure-pr-commenter.ts` exposes
`upsertComment(prId, runId, content)`:
1. If `pipeline_runs.azure_pr_comment_id` is null for the latest run on this
   PR → `POST /pullRequests/{id}/threads` (Azure DevOps REST).
2. Else → `PATCH /pullRequests/{id}/threads/{threadId}/comments/{commentId}`.

The first comment is posted at run-start (status=running) and patched on each
state transition.

## Queue Resilience (mac-mini reboots / server crashes)

The `pipelines` module already uses **pg-boss**, which is a Postgres-backed
persistent queue. `pending` jobs (received but not yet picked up by a worker)
survive a restart for free — when the server comes back, the worker reconnects
and processes them in order. **No code is needed for the `pending` case.**

For `running` orphans (worker was mid-execution when the process died), there
is no way to resume mid-stage because subprocess state, allocated devices, and
workspace dirs are all lost. We auto-retry instead.

Plugin `pipelines-plugin.ts` adds an `onReady` step:

```ts
fastify.addHook('onReady', async () => {
  const runningOrphans = await db
    .select()
    .from(pipelineRuns)
    .where(eq(pipelineRuns.status, 'running'));

  for (const run of runningOrphans) {
    // 1. Mark old run cancelled
    await db.update(pipelineRuns)
      .set({
        status: 'cancelled',
        errorMessage: 'orphan: server restart',
        finishedAt: new Date(),
      })
      .where(eq(pipelineRuns.id, run.id));

    // 2. Auto-retry: re-enqueue ONE new run with same origin, but only if
    //    the previous run was not itself an auto-retry (cap of 1 to prevent
    //    crash-loops). Track via metadata.retry_of.
    if (run.azurePrId && !run.metadata?.retry_of) {
      const newRunId = await service.createRun({
        triggerType: 'azure-pr',
        prId: run.azurePrId,
        prUrl: run.azurePrUrl,
        sourceBranch: run.sourceBranch,
        sourceCommit: run.sourceCommit,
        metadata: { retry_of: run.id, retry_reason: 'server-restart' },
      });
      await commenter.upsertComment(
        run.azurePrId,
        newRunId,
        `restarted (was ${run.id})`,
      );
    } else if (run.azurePrId) {
      // Already an auto-retry — don't loop; tell the human.
      await commenter.upsertComment(
        run.azurePrId,
        run.id,
        'cancelled-restart-loop',
      );
    }
  }

  // Devices: pool boot-up health-check already transitions allocated → idle
  // for any device whose currentJobId no longer maps to a running job.
});
```

The `metadata.retry_of` field is a new JSONB shape on `pipelineRuns.variables`
(or a dedicated `metadata` column — TBD during implementation; can reuse
`variables`).

## Concurrency Limit

Hard cap on simultaneously running pipeline runs, enforced at queue admission:

```yaml
# config.yaml
pipelines:
  max_concurrent_runs: 2     # MVP: same as device pool size
```

The worker checks `SELECT count(*) FROM pipeline_runs WHERE status='running'`
before pulling a job. If at the cap, the job stays in the pg-boss queue
(NACK + delay 5s).

Rationale: today, concurrency is bounded implicitly by the device pool ("no
device available" → fail). With this cap, runs queue cleanly instead of
failing on resource contention, and the queue endpoint shows position
accurately.

## Admin Queue Endpoint

`GET /api/pipelines/queue` returns the current state:

```json
{
  "running": [
    { "runId": "...", "trigger": "azure-pr", "pr": 123, "startedAt": "...", "stage": "test-SmokeTests" }
  ],
  "pending": [
    { "runId": "...", "trigger": "azure-pr", "pr": 124, "queuedAt": "...", "position": 1 }
  ],
  "capacity": { "max_concurrent": 2, "active": 1, "available_devices_android": 1, "available_devices_ios": 0 }
}
```

Implementation is a single Drizzle query plus a join into the pool. UI lives
at `/pipelines/queue` (new SvelteKit route, auto-refresh via WS subscription
to `pipeline.run.started` / `.completed`).

## Setup Helper Script

A standalone CLI helper to bootstrap a fresh mac-mini with sensible defaults.

**Location:** `scripts/setup-mac-mini.ts` (run via `npx tsx scripts/setup-mac-mini.ts`).

**What it does:**
1. **Memory probe**
   - `sysctl hw.memsize` → total RAM
   - `vm_stat` → free pages
2. **Suggest device count**
   - Reserve 4 GB for macOS + device-farm server itself
   - Each Android emulator (API 35 with 4 GB partition) needs ~3.5 GB resident
   - `suggested = floor((total - 4) / 4)` capped at 4 (mac-mini m2 typical max)
3. **Probe dependencies** (reuses `device-farm doctor` logic)
   - Java, adb, emulator, avdmanager, maestro all present?
4. **Write a starter `config.yaml`**
   - Fills `pool.android.max_devices = <suggested>`
   - Fills `pipelines.max_concurrent_runs = <suggested>`
   - Leaves placeholders for `azure_devops.pat` etc with comments
5. **Prints next-step instructions** (set env vars, create PAT in Azure, etc)

Idempotent: if `config.yaml` already exists, prints a diff of suggested
changes instead of overwriting.

Example output:

```
$ npx tsx scripts/setup-mac-mini.ts
✓ macOS arm64 / 16 GB RAM detected
✓ Java 24.0.2, adb 1.0.41, emulator 35.5.10, maestro 1.40 installed
✓ Suggesting max_devices = 3 (16 GB - 4 GB reserved / 4 GB per emulator)
✓ Suggesting max_concurrent_runs = 3
→ Wrote config.yaml.suggested. Diff against current:
    pool.android.max_devices:     2 → 3
    pipelines.max_concurrent_runs: missing → 3
→ Next steps:
    1. export AZURE_DEVOPS_PAT=<your-pat>
    2. export WEBHOOK_PASSWORD=<random-secret>
    3. Review config.yaml.suggested, then `mv config.yaml.suggested config.yaml`
    4. Register Azure Service Hook → https://<your-host>/api/azure/pr-events
```

## Module Structure

```
server/pipelines/internal/
├─ pr-template-builder.ts        (NEW) builds 4-stage template from prBlock
├─ device-stream-executor.ts     (NEW) executes type='device-stream-script'
├─ internal-clone-executor.ts    (NEW) clone + config.js resolution
├─ internal-release-executor.ts  (NEW) device release + workspace cleanup
├─ inter-stage-env.ts            (NEW) stdout marker parser + env map
├─ azure-pr-commenter.ts         (NEW) upsertComment via Azure REST
├─ azure-pr-parser.ts            (NEW) extract device-script block + Zod
└─ service.ts                    (EXTEND) cancel-on-new-push hook

server/api/
├─ azure-pr-events-route.ts      (NEW) POST /api/azure/pr-events
└─ pipelines-queue-route.ts      (NEW) GET  /api/pipelines/queue

scripts/
└─ setup-mac-mini.ts             (NEW) auto-detect RAM, suggest device count
```

## Test Plan

Unit tests:
- `azure-pr-parser.spec.ts` — 0/1/2 blocks, valid/invalid YAML, Zod fields
- `inter-stage-env.spec.ts` — marker extraction, masking secrets, merge order
- `pr-template-builder.spec.ts` — 1 suite, N suites, platform routing
- `azure-pr-commenter.spec.ts` — POST first time, PATCH subsequent (HTTP mocked)

Integration tests:
- `webhook-end-to-end.spec.ts` — Azure webhook → run created → stages execute
  with mocked pool/Maestro/Azure → comment posted
- `cancel-on-new-push.spec.ts` — second webhook cancels first run
- `orphan-recovery.spec.ts` — running rows on boot → cancelled

E2E manual:
- Real Azure DevOps PR in a test repo → real mac-mini run → comment appears

## Open Questions (resolve before/during implementation)

1. **Suite glob convention:** `Tests/<suite>/**/*.yaml` is an assumption.
   If repos use a different layout, expose it as a per-integration setting
   (`suite_glob_template`).
2. **`config.js` safe parsing:** `vm.runInNewContext` is a sandbox but not
   bulletproof. If `config.js` does anything more than export a flat object,
   we may need a stricter format (e.g. `config.json`).
3. **`device-stream` package surface:** the pre-setup script will import
   from where? The vendored tgz in `vendor/device-stream/`? An npm install?
   This is a question for the script author (the user), not the device-farm.

## Implementation Order (suggested)

1. Schema extensions + migration (1 PR)
2. Setup helper script `scripts/setup-mac-mini.ts` (1 PR — independent, can ship early)
3. Webhook endpoint + parser + Zod (1 PR, mocked downstream)
4. Pipeline-template builder + internal-clone executor (1 PR)
5. device-stream-script executor + inter-stage env (1 PR)
6. Cancel-on-new-push + orphan auto-retry + concurrency limit (1 PR)
7. Azure PR commenter (POST + PATCH) (1 PR)
8. Admin queue endpoint + UI route (1 PR)
9. End-to-end integration test + manual run on mac-mini (1 PR)

Each PR is independently mergeable and shippable behind a feature flag in
`config.azure_devops` (absent config = feature off entirely).
