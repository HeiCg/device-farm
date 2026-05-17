# Pipeline Engine — Design Spec

**Date:** 2026-04-16
**Status:** Approved
**Author:** Claude + heicg

## Overview

Transform Device Farm from a test executor into a full CI/CD pipeline platform for mobile testing. Pipelines are YAML-defined workflows with scripted stages (Bash/Python), Maestro test stages, matrix expansion, conditional execution, scheduled runs, and Azure DevOps integration.

## Goals

1. **Scriptable jobs** — Define test pipelines as YAML with setup/test/teardown stages using Python or Bash
2. **Scheduled execution** — Cron-based scheduling for nightly and release builds (scheduler lives in Device Farm)
3. **Azure DevOps integration** — Azure triggers pipelines via API; Device Farm comments results on PRs
4. **Git source checkout** — Clone QA test repos from Azure DevOps Repos before execution

## Non-Goals

- Replacing Azure Pipelines for build/compile (Device Farm handles test execution only)
- GitHub/GitLab/Bitbucket integration (Azure DevOps only for v1, extensible later)
- Container-based isolation for script stages (scripts run on the host Mac)

---

## 1. Pipeline Definition (YAML)

```yaml
name: "PR Validation"
description: "Validate QA automation on PR branches"

# How the pipeline is triggered
trigger:
  - api                       # POST /api/pipelines/:id/run
  - schedule: "0 2 * * *"    # Cron expression

# Where tests come from
source:
  provider: azure_devops
  repo: "https://dev.azure.com/org/project/_git/qa-tests"
  branch: "{{branch}}"
  pat_secret: "azure_pat"     # Reference to stored secret

# Global variables available in all stages
variables:
  APP_ID: com.argonav
  ENVIRONMENT: staging

# Stages execute sequentially by default
stages:
  - name: setup
    script: |
      pip install -r requirements.txt
      python scripts/prepare_env.py --env {{ENVIRONMENT}}
    timeout: 300

  - name: install-apk
    script: |
      curl -o app.apk "{{apk_url}}"
      adb -s {{device_serial}} install -r app.apk
    when: success

  - name: test
    type: maestro
    platform: android
    flows: "maestro-flows/"
    env:
      APP_ID: "{{APP_ID}}"
    matrix:
      - name: "pixel-7"
        device_profile: pixel_7
      - name: "pixel-fold"
        device_profile: pixel_fold
    timeout: 1800

  - name: collect-logs
    script: python scripts/collect_logs.py --output {{artifacts_dir}}
    when: always

  - name: notify-failure
    script: python scripts/alert_slack.py --channel qa-alerts
    when: failure

# What to do with the result
notify:
  azure_devops:
    comment: true
  webhook:
    url: "https://hooks.slack.com/..."
```

### Stage Types

| Type | Description |
|---|---|
| `script` (default) | Execute bash/python on the Device Farm host |
| `maestro` | Create Device Farm job(s), wait for completion |

### Conditional Execution (`when`)

| Value | Behavior |
|---|---|
| `success` | Only run if all previous stages passed (default) |
| `failure` | Only run if any previous stage failed |
| `always` | Always run regardless of previous results |

### Matrix

Expands a `maestro` stage into N parallel job executions. Each matrix entry creates a separate Device Farm job. The stage passes only if **all** matrix jobs pass.

### Template Variables

| Variable | Source |
|---|---|
| `{{branch}}`, `{{commit_sha}}`, `{{pr_number}}`, `{{pr_url}}` | Injected by API trigger |
| `{{apk_url}}`, custom vars | Injected by API trigger |
| `{{device_serial}}`, `{{device_port}}` | Populated when device is allocated |
| `{{artifacts_dir}}` | Artifacts directory for the pipeline run |
| `{{pipeline_id}}`, `{{run_id}}` | Current pipeline and run IDs |

---

## 2. Pipeline Engine (Server-side)

### Entity Hierarchy

```
Pipeline (definition) → PipelineRun (instance) → StageRun (per stage)
                                                    └→ JobRun (per matrix entry, if type=maestro)
```

### Database Schema

**`pipelines`**
- `id` UUID PK
- `name` text UNIQUE
- `description` text
- `yaml_content` text
- `created_at`, `updated_at` timestamps

**`pipeline_secrets`**
- `id` UUID PK
- `name` text UNIQUE
- `encrypted_value` text (AES-256-GCM, key from env var)
- `created_at` timestamp

**`pipeline_schedules`**
- `id` UUID PK
- `pipeline_id` FK → pipelines
- `cron_expression` text
- `enabled` boolean
- `variables` JSONB
- `last_run_at`, `next_run_at` timestamps

**`pipeline_runs`**
- `id` UUID PK
- `pipeline_id` FK → pipelines
- `trigger_type` enum: api | schedule | manual
- `status` enum: pending | running | passed | failed | cancelled
- `variables` JSONB (resolved variables)
- `started_at`, `finished_at` timestamps
- `source_branch`, `source_commit` text nullable
- `azure_pr_id`, `azure_pr_url` text nullable

**`pipeline_stage_runs`**
- `id` UUID PK
- `run_id` FK → pipeline_runs
- `stage_name` text
- `stage_index` integer
- `type` enum: script | maestro
- `status` enum: pending | running | passed | failed | skipped
- `started_at`, `finished_at` timestamps
- `logs` text (stdout/stderr, capped at 1MB)
- `error_message` text nullable

**`pipeline_stage_jobs`**
- `id` UUID PK
- `stage_run_id` FK → pipeline_stage_runs
- `job_id` FK → jobs
- `matrix_name` text nullable

### Execution Flow

```
1. Trigger (API / schedule / manual)
2. Create PipelineRun (status: pending)
3. Source checkout (git clone → temp dir)
4. For each stage (sequential):
   ├─ Evaluate `when` condition
   │  └─ Skip if not met → status: skipped
   ├─ If type=script:
   │  ├─ Resolve {{variables}} in script
   │  ├─ Spawn process (cwd = checkout dir)
   │  ├─ Stream stdout/stderr → stage logs + WebSocket
   │  └─ exitCode 0 = passed, else = failed
   ├─ If type=maestro:
   │  ├─ Expand matrix → N jobs
   │  ├─ Submit via JobService.createJob()
   │  ├─ Wait for all to complete
   │  └─ All passed = passed, any failed = failed
   └─ Update stage + run status
5. Notify (Azure DevOps comment, webhook)
6. Cleanup (temp dirs)
```

### Script Sandboxing

- Timeout per stage (default 300s, max 3600s)
- Isolated working directory (checkout temp dir)
- Controlled env vars (pipeline vars + `DEVICE_FARM_*` + PATH)
- Log output capped at 1MB per stage
- No network restrictions (scripts need ADB, emulator access)

### Scheduler

Fastify plugin (`server/pipelines/scheduler-plugin.ts`):
- On boot: read all enabled `pipeline_schedules`
- Use `node-cron` to register schedules
- Evaluate every minute which schedules to fire
- Create PipelineRun with `trigger_type: schedule`
- Update `last_run_at` and `next_run_at`
- UI changes (enable/disable, change cron) reflect immediately in memory

### Cancellation

- `DELETE /api/pipeline-runs/:id` cancels the run
- Running `maestro` stages: cancel jobs via `JobService.cancelJob()`
- Running `script` stages: SIGTERM → 5s → SIGKILL

---

## 3. Azure DevOps Integration

### Inbound: Azure triggers execution

Azure Pipeline calls Device Farm API:

```
POST /api/pipelines/:nameOrId/run
Authorization: Bearer <api-key>
Body: {
  "variables": {
    "branch": "refs/heads/feature/new-login",
    "commit_sha": "abc123",
    "pr_number": "42",
    "pr_url": "https://dev.azure.com/org/project/_git/qa-tests/pullrequest/42",
    "apk_url": "https://artifacts.dev.azure.com/..."
  }
}
Response: { "run_id": "...", "status": "pending", "url": "http://device-farm:3000/pipeline-runs/..." }
```

### Outbound: Comment on PR

When a PipelineRun finishes and has `azure_pr_id` + `notify.azure_devops.comment: true`:

1. Call Azure DevOps REST API:
```
POST https://dev.azure.com/{org}/{project}/_apis/git/repositories/{repo}/pullRequests/{prId}/threads?api-version=7.1
```

2. Comment body (markdown):
```markdown
## Device Farm — PR Validation

**Status:** Passed (6/7 steps)
**Duration:** 2m 34s
**Branch:** feature/new-login

[View full results](http://device-farm:3000/pipeline-runs/abc123)
```

3. Authentication via PAT stored in `pipeline_secrets`

### Configuration

```yaml
# config.yaml
integrations:
  azure_devops:
    organization: "myorg"
    project: "myproject"
    pat_secret: "azure_pat"
```

### Complete PR Flow

```
1. Dev creates PR in Azure DevOps
2. Azure Pipeline trigger → POST /api/pipelines/pr-validation/run
3. Device Farm:
   a. Clone QA repo at PR branch
   b. Execute setup scripts
   c. Run Maestro tests (create jobs)
   d. Execute teardown scripts
   e. Comment result on PR via Azure API
4. Azure Pipeline can poll GET /api/pipeline-runs/:id/status or fire-and-forget
```

---

## 4. API Endpoints

### Pipeline CRUD

| Method | Path | Description |
|---|---|---|
| `POST /api/pipelines` | Create pipeline (YAML body) |
| `GET /api/pipelines` | List pipelines |
| `GET /api/pipelines/:id` | Get pipeline detail |
| `PUT /api/pipelines/:id` | Update pipeline YAML |
| `DELETE /api/pipelines/:id` | Delete pipeline |

### Pipeline Runs

| Method | Path | Description |
|---|---|---|
| `POST /api/pipelines/:id/run` | Trigger a run with variables |
| `GET /api/pipeline-runs` | List runs (filterable) |
| `GET /api/pipeline-runs/:id` | Run detail with stages |
| `GET /api/pipeline-runs/:id/status` | Simplified status (for polling) |
| `DELETE /api/pipeline-runs/:id` | Cancel a run |

### Schedules

| Method | Path | Description |
|---|---|---|
| `GET /api/pipelines/:id/schedules` | List schedules |
| `POST /api/pipelines/:id/schedules` | Create schedule |
| `PUT /api/pipeline-schedules/:id` | Update (cron, enabled, vars) |
| `DELETE /api/pipeline-schedules/:id` | Delete schedule |

### Secrets

| Method | Path | Description |
|---|---|---|
| `GET /api/secrets` | List secrets (name + created_at only) |
| `POST /api/secrets` | Create secret |
| `DELETE /api/secrets/:name` | Delete secret |

### Integrations

| Method | Path | Description |
|---|---|---|
| `GET /api/integrations/azure` | Get config (org, project, masked PAT) |
| `PUT /api/integrations/azure` | Update config |
| `POST /api/integrations/azure/test` | Test connection |

### WebSocket

```
GET /ws/pipeline-runs/:id
```

Message types: `stage_start`, `stage_log`, `stage_end`, `job_created`, `run_end`
Replay buffer: last 200 messages on connect.

---

## 5. Web UI

### New Pages

- **Pipelines list** (`/pipelines`) — Table: name, last run status, next schedule, actions
- **Pipeline detail** (`/pipelines/:id`) — YAML editor, schedules, run history
- **Pipeline Run detail** (`/pipeline-runs/:id`) — Visual timeline of stages, expandable logs (WebSocket), matrix sub-items, links to Device Farm jobs

### Settings Additions

- **Settings → Integrations** — Azure DevOps: org, project, PAT (masked), "Test Connection" button
- **Settings → Secrets** — List, create, delete secrets

---

## 6. CLI Commands

```bash
device-farm pipelines list
device-farm pipelines create <file.yaml>
device-farm pipelines update <name> <file.yaml>
device-farm pipelines validate <file.yaml>
device-farm pipelines run <name> --var key=value [--var ...]
device-farm pipelines runs <name>
device-farm pipelines logs <run-id> [--follow]
```

---

## 7. Implementation Phases

### Phase 1 — Pipeline Core (MVP)
- DB schema (pipelines, runs, stage_runs, secrets)
- Pipeline YAML parser + Zod validator
- Pipeline executor: sequential stages, `script` type, `when` conditions
- Variable interpolation
- API: CRUD pipelines, trigger run, get status
- WebSocket log streaming

### Phase 2 — Maestro Integration + Matrix
- Stage type `maestro`: create jobs via JobService
- Matrix expansion (parallel jobs per device config)
- `pipeline_stage_jobs` table linking stages to jobs
- Run waits for all jobs to complete

### Phase 3 — Git Source + Azure DevOps
- Git clone/checkout service (Azure DevOps Repos with PAT)
- `source:` block → clone to temp dir before stages
- Azure DevOps PR comment (outbound API)
- Integrations config in UI
- Secrets management (encrypted in DB with AES-256-GCM)

### Phase 4 — Scheduler + UI
- Scheduler plugin (node-cron)
- Schedule CRUD API
- Web UI: Pipelines list, detail (YAML editor), run history, run timeline
- Web UI: Settings → Integrations, Secrets

### Phase 5 — CLI + Polish
- CLI commands (list, create, update, validate, run, logs)
- Run cancellation
- Robust error handling (retry, partial failure)
- Additional notifications (generic webhook templates)
