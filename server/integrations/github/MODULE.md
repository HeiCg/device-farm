# integrations/github

Phase 37 Plan 37-00 Track C scaffold (Wave 0). GitHub App webhook receiver + PR commenter — mirrors `server/azure/` for the GitHub provider.

## Purpose

GitHub App webhook receiver + PR commenter — mirrors `server/azure/` for the GitHub provider. Receives `pull_request.*` and `push` events at `POST /api/github/webhooks`, verifies the HMAC signature via `@octokit/webhooks-methods.verify`, dispatches to the pipeline runner, and posts/edits a comment on the PR with job status, screenshots, and links.

Authentication uses the GitHub App pattern (not personal access tokens) — installation tokens are auto-refreshed by `@octokit/auth-app` per Pitfall 4 of 37-RESEARCH.md.

Wave 0 ships only scaffolding — `createGithubModule` returns `null`. Wave 1 (Plan 37-03) wires the real webhook handler, commenter, and pipeline-bus subscriber (mirroring `server/azure/plugin.ts:39-141`).

## Public API

Exports from `server/integrations/github/index.ts`:

| Symbol | Source | Purpose |
|--------|--------|---------|
| `createGithubModule` | `./internal/module.js` | MOD-06 factory; constructs GitHub App + commenter + handler |
| `GithubModule` (type) | `./internal/module.js` | Factory return type — Wave 0: `null`; Wave 1: `{handler, commenter, app}` |
| `githubPlugin` | `./plugin.js` | Default Fastify plugin |

Fastify decorators exposed by the plugin:

- `fastify.githubModule: GithubModule | null`

## Events Emitted

None directly. The GitHub plugin is a consumer/effect — it subscribes to pipeline events and emits HTTP requests (PR comments) as side effects.

Wave 1 may add `github.comment.posted` (TRACE event) for audit; deferred.

## Events Consumed

| Event | Producer | Handler |
|-------|----------|---------|
| `pipeline.run.started` | pipelines | upsert PR comment with status:'running' |
| `pipeline.run.completed` | pipelines | upsert PR comment with status derived from payload.status |
| `pipeline.run.failed` | pipelines | upsert PR comment with status:'failed' or 'cancelled' |

Subscribers register in `onReady` (mirror `server/azure/plugin.ts:39`) so `fastify.pipelinesModule.bus` is decorated by the time we subscribe (Pitfall 5).

## Queue Produced

None. Comment posting is best-effort fire-and-forget inside the bus subscriber (errors logged, never re-thrown — mirrors Azure pattern).

## Queue Consumed

None.

## Invariants

1. **HMAC verification before parse** — webhook handler MUST call `verify(rawBody, signature, secret)` using `@octokit/webhooks-methods` before any JSON access. Raw body capture uses `addContentTypeParser('application/json', { parseAs: 'buffer' })` per Pitfall 1.
2. **Per-installation token refresh** — installation tokens are fetched per webhook delivery (NOT cached across requests). `@octokit/auth-app` handles refresh; never persist tokens to DB.
3. **Comment upsert by db ref** — `pipeline_runs.github_pr_comment_id` is the source of truth for "is there a comment to PATCH". `null` ⇒ POST new comment + persist id; non-null ⇒ PATCH existing.
4. **Per-installation isolation** — every webhook handler reads `github_installation_id` from the payload and routes to the matching octokit instance. Cross-installation comment edit is impossible by construction.

## Non-Goals

- **GitLab MR support** — separate provider; mirror this pattern in `server/integrations/gitlab/` when scheduled.
- **GitHub Actions integration** — this module is for App-based webhooks. GHA runners that call our API use the normal `device-farm run` CLI path.
- **PR description parsing** — Azure has `parsePrDescription` for `device-script` blocks. GitHub Wave 1 ships comment-trigger only (`/device-farm run`); description-block parsing is DEFERRED-37-E.
- **Repository-level config files** — `device-farm.yml` in the PR repo is DEFERRED-37-F (requires repo read scope on installation).

## Dependencies

Plugin metadata (`server/integrations/github/plugin.ts`):

```javascript
dependencies: ['config', 'db', 'pipelines-plugin']
```

- `config` — `fastify.config.github` (`app_id`, `private_key`, `webhook_secret`, `installations[]`).
- `db` — `fastify.db` for `pipeline_runs.github_*` columns read/write.
- `pipelines-plugin` — `fastify.pipelinesModule.bus` for subscribing to run lifecycle events; `fastify.pipelineService` for `triggerRun`.

### Runnable Example

```typescript
// Wave 1 will accept GitHub webhook deliveries:
// curl -X POST http://localhost:3000/api/github/webhooks \
//   -H 'x-github-event: pull_request' \
//   -H 'x-hub-signature-256: sha256=<HMAC>' \
//   -H 'content-type: application/json' \
//   --data @pr-opened.json
//
// On valid signature + pull_request.opened event, the handler will:
//   1. Look up the installation in config
//   2. Trigger a pipeline run with PR context
//   3. The pipeline event bus subscriber posts/updates the PR comment as runs progress

// (No exported runnable surface in Wave 0 — only the module + plugin scaffolds.)
```

Wave 1 (Plan 37-03): plugin registered after `azurePlugin`; HMAC-verified webhook ingress + idempotent commenter ship. See `docs/runbooks/github-integration.md` for App provisioning.

### Phase 37 deferrals

- **GitLab MR integration** — mirror of Azure/GitHub path for GitLab merge requests. `DEFERRED-37-B`, target v3.1.
- **OAuth (PAT) fallback** — GitHub App chosen for production. PAT path tracked as `DEFERRED-37-H` (v3.1 if requested).
- **Per-installation OAuth flow** — out of scope; App-level auth covers the v3.0 use cases.
