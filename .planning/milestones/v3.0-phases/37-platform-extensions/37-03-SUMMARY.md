---
phase: 37-platform-extensions
plan: 03
subsystem: integrations
tags: [github, octokit, webhooks, hmac, fastify-plugin, pipeline-bus, cli, golang]

# Dependency graph
requires:
  - phase: 26-azure-pr-bot
    provides: server/azure/ plugin shape — mirrored 1:1 with vendor-specific internals swapped
  - phase: 37-platform-extensions
    provides: 37-00 Wave 0 scaffold (stub module, MOD-02 barrel, pipeline_runs.github_pr_* columns, @octokit packages)
provides:
  - server/integrations/github/ — full Track C plugin (auth + webhook + commenter + template + run service + plugin + routes)
  - POST /api/github/webhooks — HMAC-verified ingress with raw-body parser
  - device-farm run --github-pr <num> [--github-repo owner/name] — CLI flag with git-remote auto-detect
  - docs/runbooks/github-integration.md — provisioning + troubleshooting runbook
  - examples/.github/workflows/device-farm-pr.yml — alt manual-notify GHA workflow
affects: [37-05-PLAN]

# Tech tracking
tech-stack:
  added:
    - "no new runtime deps (octokit packages already added in 37-00 Wave 0)"
  patterns:
    - "Scoped addContentTypeParser('application/json', { parseAs: 'buffer' }) — captures raw bytes for HMAC verify without colliding with the global JSON parser used by /api/jobs"
    - "GitHub App per-call Octokit fetch via getOctokitForInstallation(installationId) — never cached across event boundaries (Pitfall 4: install tokens expire in 1h)"
    - "Idempotent comment upsert via pipeline_runs.github_pr_comment_id — null ⇒ POST + persist id; non-null ⇒ PATCH (mirrors azurePrCommentId pattern)"
    - "Plugin onReady-deferred bus subscriber — guarantees fastify.pipelinesModule.bus is decorated before subscription (mirror of server/azure/plugin.ts:39-141)"
    - "triggerType='manual' + github_pr_* column write — avoids extending pipeline_trigger_type enum (no DB migration, minimal blast radius on shared service code)"

key-files:
  created:
    - server/integrations/github/internal/app-auth.ts
    - server/integrations/github/internal/template-builder.ts
    - server/integrations/github/internal/commenter.ts
    - server/integrations/github/internal/webhook-handler.ts
    - server/integrations/github/internal/pr-run-service.ts
    - docs/runbooks/github-integration.md
    - examples/.github/workflows/device-farm-pr.yml
  modified:
    - server/integrations/github/internal/module.ts (Wave 0 stub → real factory)
    - server/integrations/github/plugin.ts (Wave 0 stub → full mirror of azure/plugin.ts)
    - server/integrations/github/routes.ts (Wave 0 stub → POST /api/github/webhooks with HMAC verify)
    - server/integrations/github/__tests__/{routes,webhook-handler,commenter}.spec.ts (it.todo → real tests)
    - server/integrations/github/__tests__/template-builder.spec.ts (new spec, NOT in 37-00 stub list)
    - server/config/schema.ts (added optional `github` block)
    - server/index.ts (registered githubPlugin after azurePlugin)
    - cli/cmd/run.go (--github-pr, --github-repo flags + git-remote auto-detect)
    - cli/cmd/run_test.go (4 new tests covering flag resolution + multipart emission)

key-decisions:
  - "Used scoped addContentTypeParser via app.register(async scope => …) so the buffer parser only attaches to /api/github/webhooks — global JSON parsing for /api/jobs etc. is unaffected (Pitfall 1)"
  - "Mapped 'github-pr' onto existing triggerType='manual' instead of extending the pipeline_trigger_type enum — keeps Track C inside its file_modified scope, no DB migration needed; github context discriminated via the pipeline_runs.github_pr_* columns + variables JSONB tags"
  - "CLI metadata path: --github-pr emits github_pr_id/owner/name via the existing multipart `metadata` field rather than adding three new top-level fields — server can introspect at job creation time without API contract churn"
  - "PEM private_key in runbook stored as `<PASTE THE FULL CONTENTS OF YOUR .pem FILE HERE>` placeholder string + env-var interpolation note — avoids tripping secret scanners and follows the project's no-hardcoded-credentials convention"
  - "examples/.github/workflows/device-farm-pr.yml passes every github.event.* value through env: blocks (DELIVERY_ID, GITHUB_EVENT_PATH) — workflow-injection-safe per project security policy"

patterns-established:
  - "Vendor plugin mirror pattern: server/integrations/github/ ↔ server/azure/ — identical plugin.ts skeleton (factory + decorator + routes register + onReady bus subscribe), swap auth (basic-auth → HMAC) + client (PAT-axios → @octokit/app) + columns (azure_pr_* → github_pr_*)"
  - "Webhook-handler test fixtures: hand-rolled minimal pull_request body covering installation.id + pull_request.{number,html_url,head.{sha,ref},base.ref} + repository.{name,owner.login} — passthrough zod schema absorbs everything else"

requirements-completed: [EXT-GITHUB-PR]

# Metrics
duration: 21min
completed: 2026-05-17
---

# Phase 37 Plan 3: GitHub PR Integration Summary

**GitHub App webhook ingress + idempotent PR commenter end-to-end — HMAC-verified POST /api/github/webhooks via raw-body parser (Pitfall 1), per-installation Octokit fetch (Pitfall 4), 5-screenshot inline cap with details fold (Pitfall 5), CLI --github-pr flag with git-remote auto-detect, and a 7-step runbook covering setup + 4 troubleshooting failure modes.**

## Performance

- **Duration:** 21 min
- **Started:** 2026-05-17T01:26:08Z
- **Completed:** 2026-05-17T01:47:30Z
- **Tasks:** 2
- **Files created:** 7
- **Files modified:** 11

## Accomplishments

- GitHub plugin shape mirrors `server/azure/` 1:1 — same factory + decorator + onReady-deferred bus subscriber skeleton, just with the auth surface swapped (basic-auth → HMAC) and the client swapped (PAT-axios → @octokit/app installation tokens)
- HMAC verification uses `@octokit/webhooks-methods.verify` (constant-time compare); raw body captured pre-JSON-parse via scoped `addContentTypeParser` so the bytes GitHub signed match exactly (Pitfall 1 closed and asserted by the whitespace-variant test)
- Commenter upsert is idempotent: looks up `pipeline_runs.github_pr_comment_id` by (installation_id, pr_number); null ⇒ `POST /repos/{owner}/{repo}/issues/{issue_number}/comments` + persist returned id; non-null ⇒ `PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}`
- Template caps inline screenshots at 5; overflow folded behind `<details>` with a dashboard link (Pitfall 5)
- CLI `--github-pr` + `--github-repo` flags ship; when repo flag is empty, auto-detects from `git remote get-url origin` (regex covers both SSH and HTTPS GitHub remote forms)
- 24 tests total green across 4 spec files + 1 Go test file: template-builder (4), commenter (3), webhook-handler (7), routes (5), Go (5)
- Runbook documents the full provisioning flow (App create → key generation → install → config.yaml → smoke test) plus troubleshooting for the four most common failure modes
- Example GHA workflow ships with env-quoted github.event.* values so an attacker-controlled PR title can't inject shell

### File-Count Comparison: server/azure vs server/integrations/github

| Surface | `server/azure/` | `server/integrations/github/` |
| --- | --- | --- |
| `plugin.ts` | 148 LOC | 121 LOC (no parse-error comment fallback yet) |
| `routes.ts` | 39 LOC | 84 LOC (raw-body parser inflates by ~30 LOC) |
| `internal/module.ts` | 141 LOC | 104 LOC (no inline upsertPipeline + cancelRunsByPrId callbacks — github runs are one-shot per PR action) |
| `internal/webhook-handler.ts` | 108 LOC | 122 LOC |
| `internal/{pr,}commenter.ts` | 74 LOC | 105 LOC (includes screenshot block + emoji map inline) |
| `internal/template-builder.ts` | 57 LOC (yaml builder) | 58 LOC (markdown comment) |
| `internal/pr-run-service.ts` | 106 LOC | 112 LOC |
| `internal/azure-client.ts` | 105 LOC | n/a — Octokit subsumes it |
| `internal/pr-parser.ts` | 49 LOC | n/a — github description parsing deferred to follow-up |
| `__tests__/` | 7 specs | 4 specs |

The github side is slightly larger per file because raw-body capture + emoji rendering + screenshot folding all live inline; the azure side outsourced YAML rendering to `yaml.stringify` and PR-description parsing to a dedicated parser. **Net delta:** github ships in 7 internal files vs azure's 9; the missing two (`azure-client.ts`, `pr-parser.ts`) are intentionally absent — Octokit replaces the first, and PR-description parsing is a deferred feature.

### Sample Signed Bodies (Used in routes.spec.ts)

```
# Compact
{"key":"value","n":1}

# Sparse (whitespace-different but JSON-equivalent)
{ "key": "value", "n": 1 }
```

Each is signed with HMAC-SHA256 over its EXACT bytes; cross-pairing produces a 401. The test asserts both forms pass standalone AND that a sig computed over compact fails when applied to sparse — proving the raw-body parser preserved bytes correctly (Pitfall 1 regression guard).

### Runbook Coverage

- **7 steps** (App create → key gen → install → config.yaml → restart → smoke test → CLI ad-hoc)
- **5 troubleshooting sections** covering: 401 sig mismatch (Pitfall 1), 400 headers, 200-with-ignored (event/action filter), 401-after-1h (Pitfall 4 install token TTL), screenshots disappearing (Pitfall 5), CLI auto-detect failure

### Sandbox Verification Notes (Deferred to 37-05)

End-to-end "`gh pr create` posts a real comment" verification requires a public HTTPS endpoint + a real GitHub App + a sandbox repo. Per the plan, this manual smoke test is deferred to plan 37-05 (the close-out). Wave 1 confirms the algorithmic correctness via:

1. Forged signature → 401 (routes.spec.ts)
2. Valid signature → handler dispatches with correct (owner, repo, pr_number, installation_id) (routes.spec.ts + webhook-handler.spec.ts)
3. Commenter POST vs PATCH branches based on lookupCommentId result (commenter.spec.ts)
4. Template caps + emoji map (template-builder.spec.ts)
5. Raw-body preservation across whitespace variants (routes.spec.ts — Pitfall 1 regression guard)

### Token Logging Audit

```bash
$ grep -nE '\.(info|warn|error|debug|trace).*token' server/integrations/github/internal/*.ts
# (empty — only matches in comment lines)
$ grep -nE 'installation.?token|access.?token' server/integrations/github/**/*.ts
# (empty — token material never named in code paths)
```

`@octokit/auth-app` handles install-token caching + refresh transparently; our wrapper does not surface the token in any log line, error, or return value beyond the opaque Octokit instance.

## Task Commits

1. **Task 1: GitHub plugin internals — auth + webhook + commenter + template** — `0750538` (feat)
2. **Task 2: Plugin wiring + HMAC route + CLI flags + runbook** — `2f4d028` (feat)

## Files Created/Modified

### Server — new files
- `server/integrations/github/internal/app-auth.ts` — @octokit/app wrapper, per-call installation Octokit
- `server/integrations/github/internal/template-builder.ts` — markdown template with INLINE_SCREENSHOT_CAP=5
- `server/integrations/github/internal/commenter.ts` — POST/PATCH idempotent upsert
- `server/integrations/github/internal/webhook-handler.ts` — pull_request event dispatcher with zod passthrough schema
- `server/integrations/github/internal/pr-run-service.ts` — pipeline trigger + github_pr_* column write

### Server — modified
- `server/integrations/github/internal/module.ts` — factory returns null when config absent; full module otherwise
- `server/integrations/github/plugin.ts` — replaces Wave 0 stub; registers routes + onReady bus subscriber
- `server/integrations/github/routes.ts` — POST /api/github/webhooks with raw-body parser + HMAC verify
- `server/integrations/github/__tests__/*.spec.ts` — 4 spec files, 19 tests
- `server/config/schema.ts` — optional `github` config block (app_id, private_key, webhook_secret, pr_integrations[])
- `server/index.ts` — registered `githubPlugin` after `azurePlugin`

### CLI
- `cli/cmd/run.go` — --github-pr + --github-repo flags + resolveGithubRepo helper + githubRemoteRe regex
- `cli/cmd/run_test.go` — 4 new tests covering flag resolution, regex coverage, multipart emission

### Docs + examples
- `docs/runbooks/github-integration.md` — 8.2 KB runbook
- `examples/.github/workflows/device-farm-pr.yml` — 2 KB GHA workflow with env-quoted github.event.*

## Decisions Made

Captured in frontmatter `key-decisions`. Summary: scoped JSON parser (per-route), triggerType='manual' (no enum extension), metadata-via-existing-multipart-field, runbook placeholder PEM (secret-scanner-safe), env-quoted GHA workflow inputs.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Routes spec test "missing required headers" returned 415 not 400**
- **Found during:** Task 2 (routes.spec.ts first run)
- **Issue:** Fastify rejects requests with no `content-type` header at the parser layer with 415 before the route handler can validate the github-specific headers.
- **Fix:** Added `headers: { 'content-type': 'application/json' }` to the test request so the route handler runs and can return 400 for the missing github-specific headers.
- **Files modified:** `server/integrations/github/__tests__/routes.spec.ts`
- **Verification:** Test now passes; route reaches the handler and returns 400 with `{error: 'missing required headers'}`.
- **Committed in:** 2f4d028 (Task 2 commit, pre-stage)

**2. [Rule 3 - Blocking] tsc complained about empty tuple access in handleSpy.mock.calls[0][1]**
- **Found during:** Task 2 (tsc check after routes.spec.ts written)
- **Issue:** `vi.fn(async (): Promise<WebhookOutcome> => …)` is typed with zero parameters, so `handleSpy.mock.calls[0][1]` is rejected as out-of-bounds on the parameter tuple.
- **Fix:** Cast through `unknown[]` at the call-site assertion to bypass the parameter-tuple type narrowing (the test is correctly verifying the runtime call shape — fastify passes the second positional arg even though vi.fn's typed signature is zero-arity).
- **Files modified:** `server/integrations/github/__tests__/routes.spec.ts`
- **Verification:** `npx tsc --noEmit -p tsconfig.json` reports no errors in `server/integrations/github/`.
- **Committed in:** 2f4d028 (Task 2 commit, pre-stage)

**3. [Rule 3 - Blocking] Runbook example PEM tripped secret scanner**
- **Found during:** Task 2 (Write of docs/runbooks/github-integration.md)
- **Issue:** The illustrative `private_key: |` block with a synthetic `MIIEvgIB…` body matched the project's secret-scanning hook (CWE-798).
- **Fix:** Replaced the synthetic key body with the placeholder string `"<PASTE THE FULL CONTENTS OF YOUR .pem FILE HERE>"` and added a separate plain-text note demonstrating the YAML block-literal syntax + an env-var interpolation security warning.
- **Files modified:** `docs/runbooks/github-integration.md`
- **Verification:** No secret-scanner alerts on the second Write.
- **Committed in:** 2f4d028 (Task 2 commit, pre-stage)

**4. [Rule 3 - Blocking] examples/.github/workflows/device-farm-pr.yml had github.event.* interpolation in run:**
- **Found during:** Task 2 (Write of examples/.github/workflows/device-farm-pr.yml)
- **Issue:** The project's GHA workflow hook flagged direct `${{ github.event.pull_request.node_id }}` inside a `run:` block as a workflow-injection vector.
- **Fix:** Moved every `github.event.*` and secret reference into `env:` and quoted them as shell variables; reads the webhook payload via `< "${GITHUB_EVENT_PATH}"` (runner-provided path) so an attacker-controlled PR field cannot reach the shell parser.
- **Files modified:** `examples/.github/workflows/device-farm-pr.yml`
- **Verification:** Second Write succeeded; example workflow follows the project's workflow-injection-safe pattern.
- **Committed in:** 2f4d028 (Task 2 commit, pre-stage)

**5. [Out-of-scope — documented per scope rules] cli/cmd/run.go semgrep insecure-websocket warnings**
- **Found during:** Task 2 (every edit to cli/cmd/run.go)
- **Issue:** semgrep flagged the pre-existing `buildWSURL` function (line ~277-314 across edits) for unencrypted WebSocket scheme usage (CWE-319). That helper intentionally selects the scheme based on the user-provided server URL — encrypted server URLs map to encrypted WS, plain HTTP maps to plain WS — and is unrelated to this plan's scope.
- **Resolution:** Not auto-fixed — out-of-scope (function untouched by this plan; was inherited from prior phases). Per scope rules, pre-existing warnings in unrelated regions are documented here and skipped.
- **Files modified:** none (warning is on existing code)
- **Verification:** `git blame` confirms `buildWSURL` predates Phase 37.

---

**Total deviations:** 4 auto-fixed (4 blocking corrections to make first-write code/tests pass project guardrails) + 1 out-of-scope warning documented.
**Impact on plan:** No scope creep. All auto-fixes were corrections to first-write attempts (test setup, type narrowing, secret-scanner placeholder, workflow injection safety) — none added unplanned functionality.

## Authentication Gates

None encountered. No live GitHub App was provisioned in this plan (unit tests use mocked Octokit / mocked HMAC sign). The runbook documents the operator-side App provisioning flow as the path-to-production auth gate.

## Issues Encountered

- **server/index.ts also contains preflightPlugin registration:** A concurrent plan (37-02 Track B) modified the same file in the gap between Task 2's `git add` and commit. Per scope rules, I un-staged the file, reverted to a state containing only my own additions, committed, then restored the preflightPlugin lines via Edit (the formatter hook auto-corrected the import order). Net effect: my commit is scoped to github-only changes; preflightPlugin lives in the working tree and will be committed by plan 37-02 (or already has been — see `git log --oneline -10`).
- **cli/internal/types/unions.go pre-existing build errors:** `cli/internal/types` has pre-existing undefined-type errors (`JobLogMessage`, etc.). They are not touched by this plan; the cmd package (where my changes live) compiles and tests cleanly via `go test ./cmd/`. Logged in `.planning/phases/37-platform-extensions/deferred-items.md` if/when that file gets created by 37-05 close-out.

## User Setup Required

External GitHub App provisioning IS required to use this integration in production. See `docs/runbooks/github-integration.md` for the 7-step provisioning flow. The plugin is **opt-in** — when `config.github` is absent from `config.yaml`, the factory returns `null` and the plugin no-ops (so existing deployments without this integration continue to work unchanged).

A `37-USER-SETUP.md` will be generated by the phase-close plan (37-05) consolidating user-setup requirements across Tracks A/B/C/D.

## Next Phase Readiness

- **EXT-GITHUB-PR requirement closed** — all 7 must-have truths from the plan frontmatter pass:
  - HMAC verify via `@octokit/webhooks-methods.verify` (constant-time, NOT `===`) ✓
  - Webhook 200 on valid sig / 401 on forged ✓ (routes.spec.ts)
  - CLI flag posts comment via getInstallationOctokit; subsequent runs PATCH via github_pr_comment_id ✓ (commenter.spec.ts)
  - addContentTypeParser captures raw body before JSON.parse (Pitfall 1) ✓ (routes.spec.ts whitespace-variant test)
  - Installation token never logged; @octokit/auth-app handles caching + refresh (Pitfall 4) ✓ (grep audit)
  - Template renders ≤ 5 inline screenshots; remainder behind <details> (Pitfall 5) ✓ (template-builder.spec.ts)
  - github_installation_id stored on pipeline_runs (NOT separate integration table — Pitfall 8) ✓ (schema row used directly)
- **Track C independent of Tracks A/B/D** — confirmed: no shared files modified outside the scoped list (server/integrations/github/**, server/config/schema.ts, server/index.ts plugin-registration line, cli/cmd/run.go flag block, docs/, examples/).
- **Wave 1 close-out (37-05) ready:** can include the sandbox-repo manual smoke test as a checkpoint in 37-05's verification step.

## Self-Check: PASSED

All 16 claimed files exist on disk; both task commits present in git log.

- `server/integrations/github/internal/app-auth.ts`: FOUND
- `server/integrations/github/internal/template-builder.ts`: FOUND
- `server/integrations/github/internal/commenter.ts`: FOUND
- `server/integrations/github/internal/webhook-handler.ts`: FOUND
- `server/integrations/github/internal/pr-run-service.ts`: FOUND
- `server/integrations/github/internal/module.ts`: FOUND
- `server/integrations/github/plugin.ts`: FOUND
- `server/integrations/github/routes.ts`: FOUND
- `server/integrations/github/__tests__/routes.spec.ts`: FOUND
- `server/integrations/github/__tests__/webhook-handler.spec.ts`: FOUND
- `server/integrations/github/__tests__/commenter.spec.ts`: FOUND
- `server/integrations/github/__tests__/template-builder.spec.ts`: FOUND
- `docs/runbooks/github-integration.md`: FOUND
- `examples/.github/workflows/device-farm-pr.yml`: FOUND
- `cli/cmd/run.go`: FOUND
- `cli/cmd/run_test.go`: FOUND
- Commit `0750538`: FOUND (Task 1)
- Commit `2f4d028`: FOUND (Task 2)

---
*Phase: 37-platform-extensions*
*Completed: 2026-05-17*
