# Phase 31 — Deferred Items

Items discovered during Phase 31 execution that are out-of-scope for the
phase boundary. Each entry cites the discovery point and the owning phase.

## DEFERRED-31-A — Pre-existing CLI type-import breakage in `internal/types/unions.go`

**Discovered:** Plan 31-04 Task 3 (during `go build ./...`)

**Symptom:**
```
cli/internal/types/unions.go:22:10: undefined: JobLogMessage
cli/internal/types/unions.go:23:10: undefined: JobStepMessage
cli/internal/types/unions.go:24:10: undefined: JobStatusMessage
cli/internal/types/unions.go:45:9: undefined: JobLogMessage
cli/internal/types/unions.go:51:9: undefined: JobStepMessage
cli/internal/types/unions.go:57:9: undefined: JobStatusMessage
```

**Verification it pre-exists:** `git stash` of Plan 31-04 changes →
`cd cli && go build ./...` still reproduces all 6 errors. Confirmed
unrelated to SC4 work.

**Scope decision:** Out-of-scope per Plan 31-04 boundary (only touches
`cli/internal/updates/`, `cli/internal/ui/`, `cli/cmd/root.go`, `cli/go.mod`,
`cli/go.sum`). Plan 31-04 packages build clean in isolation
(`go build ./cmd/ ./internal/updates/ ./internal/ui/` succeeds).

**Owner:** Plan 31-02 examined `cli/internal/types/unions.go` and confirmed
it depends on `JobLogMessage`/`JobStepMessage`/`JobStatusMessage` symbols
formerly emitted by a generator (now retained only as
`cli/internal/types/generated.go.test-backup`). The unions discriminated-union
wrapper is for `contracts/ws-fixtures/` schema codegen and is independent of
the `cli/internal/streaming/` flat-decoder path that Plan 31-02 modified.
Plan 31-02 streaming package builds and tests cleanly in isolation
(`go build ./internal/streaming/` + `go test ./internal/streaming/` both
green; `go vet ./internal/streaming/` clean). The unions breakage is
restoration of a generator-emitted file and is out of Plan 31-02 scope.
Re-owner: future plan that re-runs the contracts codegen (Phase 27+ or a
dedicated codegen restoration plan).

## DEFERRED-31-B — Pre-existing `server/pool/__tests__/module.spec.ts` failures

**Discovered:** Plan 31-03 Task 2 verification (regression check on pool tests)

**Symptom:** 6 tests in `server/pool/__tests__/module.spec.ts` fail with
`TypeError: deps.fastify.addHook is not a function` at
`server/pool/internal/module.ts:159` (registerWorkersAndSubscribers).

**Verification it pre-exists:** `git stash` of Plan 31-03 changes →
`npx vitest run server/pool/__tests__/module.spec.ts` reproduces all 6
failures unchanged. Confirmed unrelated to SC3 work.

**Scope decision:** Out-of-scope per Plan 31-03 boundary (only touches
`server/config/schema.ts`, `server/pool/types.ts`,
`server/pool/android/emulator.ts`, `server/pool/pool-manager.ts`,
`server/api/routes.ts`, `server/jobs/job-service.ts`,
`server/jobs/internal/executor.ts`, `cli/cmd/run.go`,
`cli/internal/client/submit.go`). Phase 23 jobs-module / Phase 20 pool-module
mock-fastify pattern needs updating to include addHook; tracked separately.

**Owner:** Phase 27+ event-bus consolidation (or a future phase that
rewrites the pool-module factory tests with full fastify mock surface).

## DEFERRED-31-C — Pre-existing `server/streaming/__tests__/module.spec.ts` subscription-count assertion

**Discovered:** Plan 31-01 Task 3 verification (regression sweep on Phase 22 streaming tests)

**Symptom:** `module.spec.ts:80` asserts the streaming module subscribes to exactly
3 jobs-bus events (job.log / job.step / job.status). Actual count is 4 because
Phase 23 Plan 23-04 (DEFERRED-22-D resolution) added a 4th subscription for
`job.cleanup.requested`. The test was never updated to match.

**Verification it pre-exists:** `git checkout 2720f8b -- server/streaming/` (last
31-00 commit, before any Phase 31 implementation work) → re-running
`npx vitest run server/streaming/__tests__/module.spec.ts` reproduces the same
failure (`expected [...] to have a length of 3 but got 4`). Confirmed unrelated
to SC1 logcat-parser work.

**Scope decision:** Out-of-scope per Plan 31-01 boundary. Phase 22/23 follow-up.

## DEFERRED-31-D — Pre-existing `server/streaming/__tests__/lifecycle-ownership.spec.ts` grep mismatches

**Discovered:** Plan 31-01 Task 3 verification (regression sweep)

**Symptom:** 2 source-code-grep guard tests fail because `this.jobBroadcaster!.cleanup`
pattern counts in `job-service.ts` no longer match the current implementation
(code moved/refactored across Phase 22/23).

**Verification it pre-exists:** Reproduced against `2720f8b` checkpoint before any
Phase 31 work. Confirmed unrelated.

**Scope decision:** Out-of-scope. Belongs to a Phase 22/23 lifecycle-test
maintenance follow-up.

## DEFERRED-31-E — Pre-existing TypeScript errors unrelated to Phase 31

`npx tsc --noEmit` reports errors in files Phase 31 plans never touch:

- `server/hooks/__tests__/events.spec.ts` — RequestContext shape
- `server/pipelines/__tests__/pr-bot-context.spec.ts` — AzurePrRunContext
- `server/pipelines/internal/pipeline-schema.ts` — z helper arity
- `server/pipelines/plugin.ts` — UpsertOpts org/project
- `server/pool/__tests__/health-checker.spec.ts` — AppConfig shape
- `server/streaming/internal/adapters/android-preview-adapter.ts` — ScrcpySession surface

Phase 31 changes (jobs/log-parsing, schema.ts, streaming/module.ts) introduce
zero new TypeScript errors. Listed here so future verifier runs do not mistakenly
attribute them to quick-wins work.

## DEFERRED-31-F — semgrep XSS warning on `server/api/routes.ts:298`

**Discovered:** Plan 31-03 Task 3 (post-edit hook scan)

**Symptom:** semgrep flags
`reply.send(createReadStream(artifact.filePath))` (artifact-download endpoint)
as CWE-79 (Cross-site Scripting) — "Detected directly writing to a Response
object from user-defined input."

**Verification it pre-exists:** The flagged line is the artifact-download
endpoint at `server/api/routes.ts:298`. Plan 31-03 only modifies the
`POST /jobs` createJob call site (line 140) and adds a `boot_options` field
branch in the multipart parser (lines 106-119). The artifact-download stream
is untouched by Phase 31.

**Scope decision:** Out-of-scope per Plan 31-03 boundary. The actual finding
needs review on its own merits: the artifact stream sends file bytes with
explicit `Content-Type` + `Content-Disposition: attachment` headers, so
browser rendering is suppressed by design — but the warning may still be
worth quieting via a semgrep ignore comment in a security-hardening phase.

**Owner:** Future security-hardening phase (or dedicated routes.ts review).

## DEFERRED-31-G — semgrep cleartext-WebSocket warning in buildWSURL

**Discovered:** Plan 31-03 Task 4 (post-edit hook scan)

**Symptom:** semgrep CWE-319 (Cleartext Transmission of Sensitive
Information) on the plaintext-WebSocket branch inside `buildWSURL`
(`cli/cmd/run.go`, around line 258).

**Verification it pre-exists:** `buildWSURL` is an existing helper that
maps the http(s) scheme to the matching WebSocket scheme for the CLI's
job-streaming connection. The plaintext branch is reachable only when
the operator points the CLI at a plaintext server (local dev). When the
server uses TLS, the function uses the secure variant (line 250). Plan
31-03 Task 4 only adds `--cold-boot` and `--audio` flag variables at the
top of run.go — no changes to `buildWSURL` or its surrounding logic.

**Scope decision:** Out-of-scope per Plan 31-03 boundary. Solving this
correctly requires a deployment policy decision (force secure scheme
everywhere? warn-but-allow plaintext on localhost? require explicit
`--insecure` flag?) that belongs in a CLI security-hardening phase, not
Quick Wins.

**Owner:** Future CLI security-hardening phase.

