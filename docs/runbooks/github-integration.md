# GitHub PR Integration Runbook

Phase 37 Plan 37-03 Track C — provisioning + troubleshooting for the GitHub App PR-bot.

The plugin lives at `server/integrations/github/` and mirrors `server/azure/` 1:1 — swapping basic-auth for HMAC verification and PAT for GitHub App installation tokens.

## Prerequisites

- Server reachable on a public HTTPS URL (or local + an ngrok-style tunnel for development).
- A GitHub organisation or user account that can install GitHub Apps on a repository.
- `config.yaml` writable by the operator.

## 1. Create the GitHub App

1. Visit https://github.com/settings/apps/new (personal account) or `https://github.com/organizations/<ORG>/settings/apps/new` (org).
2. Set the following:
   - **GitHub App name:** `device-farm-<env>` (must be globally unique).
   - **Homepage URL:** your server URL.
   - **Webhook URL:** `https://<server-host>/api/github/webhooks` — this is the exact path the plugin listens on (`server/integrations/github/routes.ts`).
   - **Webhook secret:** generate a 32+ character random string and save it — you'll need it for `config.yaml`.
   - **Repository permissions:**
     - `Pull requests` — Read & write (post + edit comments)
     - `Contents` — Read-only (clone PR head for the pipeline)
     - `Metadata` — Read-only (automatic)
   - **Subscribe to events:** `Pull request`
   - **Where can this app be installed?** Any account, or Only on this account (your choice).
3. Click **Create GitHub App** and capture the **App ID** at the top of the settings page.

## 2. Generate the App Private Key

1. On the App settings page, scroll to **Private keys** → **Generate a private key**.
2. A `.pem` file downloads; store it securely (e.g. `~/.device-farm/github-app.pem`, mode `0600`).
3. The PEM content (between `-----BEGIN PRIVATE KEY-----` and `-----END PRIVATE KEY-----`, inclusive) goes into `config.yaml`.

## 3. Install the App on a Repository

1. On the App settings page, click **Install App** in the left nav.
2. Select your account → choose a repository (or All repositories).
3. After installation, the browser lands on `https://github.com/settings/installations/<INSTALLATION_ID>` — capture the numeric `<INSTALLATION_ID>`.

## 4. Configure `config.yaml`

```yaml
github:
  app_id: 1234567                                                   # from step 1
  private_key: "<PASTE THE FULL CONTENTS OF YOUR .pem FILE HERE>"    # from step 2
  webhook_secret: "<the-secret-you-saved-in-step-1>"
  pr_integrations:
    - repo_owner: "octo"
      repo_name: "demo"
      installation_id: 7654321                                       # from step 3
      pipeline_name: "demo-pr"                                       # must match an existing Device Farm pipeline
```

When pasting the PEM, preserve all newlines from the `.pem` file. YAML block-literals (`|`) work well:

```yaml
github:
  private_key: |
    [paste the BEGIN PRIVATE KEY through END PRIVATE KEY block from your downloaded .pem file]
```

> **Security:** never commit the PEM contents to git. Reference an environment variable in production (e.g. `${GITHUB_APP_PRIVATE_KEY}`) via your config loader's interpolation.

When `github` is absent from `config.yaml`, the plugin disables itself silently (factory returns `null`).

## 5. Restart the Server

```bash
npm run dev   # or `node dist/server/index.js` in production
```

Look for these log lines on boot:

```
GitHub PR-bot plugin registered
GitHub PR-bot commenter wired to pipeline event bus
```

If you see `github plugin: module is null (config.github absent)`, the YAML did not parse — re-check indentation.

## 6. End-to-End Smoke Test

In a sandbox repository where the App is installed:

```bash
gh pr create --title "df: smoke test" --body "Testing Device Farm GitHub integration"
```

Expected behavior:

1. GitHub delivers `pull_request.opened` to `https://<server>/api/github/webhooks`.
2. The route verifies the `x-hub-signature-256` HMAC, parses the event, dispatches to the pipeline runner.
3. `pipeline.run.started` fires on the event bus → the commenter posts a comment on the PR.
4. As the run progresses, `pipeline.run.completed` (or `failed`) fires → the commenter PATCHes the same comment with the final status + screenshots.

## 7. Ad-Hoc Runs from the CLI

Operators can associate a one-shot run with a PR without triggering via webhook:

```bash
device-farm run --github-pr 42 --github-repo octo/demo --platform android flow.yaml
```

When `--github-repo` is omitted, the CLI auto-detects from `git remote get-url origin` (supports both SSH and HTTPS forms).

## Troubleshooting

### 401 Invalid signature on every webhook

- The `webhook_secret` in `config.yaml` does not match the value set on the GitHub App settings page. Open the App settings → **Webhook secret** → set both sides to the same string and restart the server.
- (Pitfall 1 from research) If you've added a custom JSON parser somewhere above the route, the raw bytes GitHub signed may have been destroyed before HMAC verify runs. The plugin's route uses a **scoped** `addContentTypeParser('application/json', { parseAs: 'buffer' }, ...)` so it only affects `/api/github/webhooks` — confirm no upstream global parser pre-empts it.

### 400 Missing required headers

- GitHub did not send `x-hub-signature-256`, `x-github-event`, or `x-github-delivery`. This usually means the webhook URL in the App settings is misconfigured (e.g. pointing at the wrong path) or you ran a manual `curl` without setting the headers.

### Webhook accepted (200) but no comment posted

- Check the response body: `{ "kind": "ignored", "reason": "..." }` tells you why:
  - `event-not-handled` — only `pull_request` triggers a run (push/issues/etc. are ignored).
  - `action-<X>-not-handled` — only `opened`, `synchronize`, and `reopened` actions trigger.
  - `parse-failed` — body did not match the expected `pull_request` schema. Likely a GitHub-side API change; re-check `pull_request` event reference.
- If outcome is `{ "kind": "triggered", "runId": "..." }` but no comment appears, look for `github commenter: upsert failed` in the server logs.

### Comments stop updating after exactly 1 hour

- (Pitfall 4) Installation tokens expire 1h after issuance. `@octokit/auth-app` should auto-refresh transparently — if you see 401s in the commenter logs after exactly 1h, you may be holding a stale Octokit instance across event boundaries. The plugin fetches a fresh octokit per webhook delivery via `getOctokitForInstallation(installationId)` — verify no caching layer was introduced.

### Screenshots disappear from PR comments

- (Pitfall 5) GitHub strips inline images when the count or total size is excessive. The template caps inline images at 5; remainder folds behind `<details>` with a "View all on dashboard" link. Confirm screenshots are reaching the commenter by checking signed-URL count in logs.

### `device-farm run --github-pr` fails with "could not auto-detect from git remote"

- Either provide `--github-repo owner/name` explicitly, or `cd` into a checkout whose `origin` remote points to a `github.com` URL.

## Architecture Notes

- Per **Anti-Pattern** in research, this plugin stores `github_installation_id` (not `github_integration_id`) — GitHub Apps are provisioned per-installation, so each install gets a unique numeric id.
- Comment idempotency: `pipeline_runs.github_pr_comment_id` is the source of truth. `null` ⇒ POST + persist; non-null ⇒ PATCH.
- The plugin runs in addition to (not in place of) `server/azure/`. Both can be configured simultaneously.

## Files

- `server/integrations/github/plugin.ts` — Fastify plugin with onReady bus subscriber
- `server/integrations/github/routes.ts` — `POST /api/github/webhooks` with raw-body parser + HMAC verify
- `server/integrations/github/internal/app-auth.ts` — `@octokit/app` wrapper
- `server/integrations/github/internal/webhook-handler.ts` — event dispatcher
- `server/integrations/github/internal/commenter.ts` — POST/PATCH upsert
- `server/integrations/github/internal/template-builder.ts` — markdown comment template (5-screenshot cap)
- `server/integrations/github/internal/pr-run-service.ts` — pipeline-run trigger + db column write
- `cli/cmd/run.go` — `--github-pr` + `--github-repo` flags
- `examples/.github/workflows/device-farm-pr.yml` — sample GHA workflow for the manual-trigger variant
