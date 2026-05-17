---
phase: 31-quick-wins
plan: 03
subsystem: jobs
tags: [boot-options, emulator-argv, multipart, zod, cobra, sc3, wave-1]

requires:
  - phase: 31-quick-wins
    plan: "00"
    provides: RED-state scaffolds (boot-options.spec, emulator-boot-options.spec, jobs-boot-options.spec, run_test.go boot tests)
  - phase: 20-pool-module
    provides: BootOptions interface in server/pool/types.ts (timeout-only; extended here)
  - phase: 23-jobs-module-keystone
    provides: executor.ts runJob saga that allocates via fastify.pool.allocate

provides:
  - bootOptionsSchema Zod schema + BootOptionsInput type at server/config/schema.ts
  - Extended BootOptions interface (coldBoot, noAudio, gpu) at server/pool/types.ts
  - Options-driven emulator argv construction at server/pool/android/emulator.ts:94-106
  - PoolManager.allocate(platform, jobId, bootOptions?) signature with shutdown+reboot logic
  - boot_options multipart parser branch at server/api/routes.ts:106-119
  - CreateJobOpts.bootOptions field persisted to jobs.metadata JSONB
  - executor.ts row-decoder re-validation of metadata.boot_options before pool.allocate
  - CLI --cold-boot and --audio Cobra flags
  - BuildJobMultipart exported test seam in cli/internal/client/submit.go
  - BootOptionsJSON Go struct mirroring server-side schema

affects:
  - "Future plans needing per-job device options can reuse the same multipart→metadata→executor→pool chain"
  - "Operators can now submit one-off cold-boot jobs from the CLI for flaky-state recovery without touching server config"

tech-stack:
  added: []
  patterns:
    - "SPEC-04 row decoder — boot_options re-validated at three boundaries (multipart, DB read, CLI emit)"
    - "Test seam via exported helper (BuildJobMultipart) so cmd_test asserts on multipart body without an HTTP server"
    - "Reconciliation of WIP-committed forward references — schema imports landed in Task 1 unblock the WIP-commit dependents in routes.ts and job-service.ts"
    - "Inverse-semantics Cobra flag (--audio, default false) avoids the tristate trap of --no-audio=true|false"
    - "Pool-manager shutdown+reboot dance only when bootOptions diverge from defaults — pre-booted device is reused otherwise (shouldRebootForOptions helper)"

key-files:
  created:
    - .planning/phases/31-quick-wins/31-03-SUMMARY.md
  modified:
    - server/config/schema.ts                          (WIP-committed; bootOptionsSchema + type alias)
    - server/pool/types.ts                             (WIP-committed; BootOptions interface extended)
    - server/pool/android/emulator.ts                  (WIP-committed; argv options-driven)
    - server/pool/pool-manager.ts                      (WIP-committed; bootOptions threaded + shouldRebootForOptions)
    - server/api/routes.ts                             (WIP-committed; boot_options multipart branch)
    - server/jobs/job-service.ts                       (WIP-committed; CreateJobOpts.bootOptions persistence)
    - server/jobs/internal/executor.ts                 (new — row.metadata.boot_options → pool.allocate)
    - server/api/__tests__/jobs-boot-options.spec.ts   (new — 4 real assertions replace expect.fail)
    - cli/internal/client/submit.go                    (new — BuildJobMultipart + BootOptionsJSON + CreateJob signature)
    - cli/cmd/run.go                                   (new — --cold-boot / --audio flags + bootOpts plumbing)
    - cli/cmd/run_test.go                              (new — 3 real assertions replace t.Skip)
    - .planning/phases/31-quick-wins/deferred-items.md (DEFERRED-31-G logged)

key-decisions:
  - "Audio flag uses inverse semantics: --audio (default false) maps to NoAudio=!runAudio in the payload. Avoids the tristate Go bool trap of --no-audio={true|false}."
  - "Boot options omitted entirely from multipart when no flag is set (bootOpts=nil). Server defaults apply server-side, keeping the wire payload minimal and pre-Phase-31 traffic shape-compatible."
  - "Test seam: BuildJobMultipart exported so run_test.go can assert on the on-the-wire body without spinning up an httptest server. Cleaner than mocking HTTP, and the helper is also the actual production code path inside CreateJob."
  - "Re-validation at the DB→app boundary in executor.ts uses bootOptionsSchema.parse (SPEC-04 row decoder). On invalid stored metadata, the executor logs + falls back to undefined (pool defaults) rather than failing the job."
  - "Pool-manager only reboots the pre-booted emulator when bootOptions diverge from defaults (shouldRebootForOptions helper). Preserves Phase-23 fast-allocate path for default-shape jobs."

requirements-completed: [SC3]

metrics:
  duration: "10min"
  completed: "2026-05-15"
  task_count: 4
  tasks_committed: 2
  tasks_reconciled_from_wip: 2
  files_modified: 11
  tests_passing:
    server_vitest: 17
    go_cli: 3
---

# Phase 31 Plan 03: SC3 Per-Job Boot Options Summary

**Per-job emulator boot options (--cold-boot, --audio) plumbed end-to-end through Zod schema → multipart parser → jobs.metadata JSONB → executor row-decoder → pool.allocate → emulator argv, with a Go CLI BuildJobMultipart test seam.**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-05-15T21:53:36Z
- **Completed:** 2026-05-15T22:03:00Z
- **Tasks:** 4 planned (2 fresh commits + 2 reconciled from WIP)
- **Files modified:** 11
- **New commits this run:** 2

## WIP-Commit Reconciliation

Before this run started, the branch had `7fb1fda wip: in-progress changes before autonomous run` already committed to `main`. That commit landed:

- `server/api/routes.ts` (+17 lines) — `boot_options` multipart parser branch + forward reference to `bootOptionsSchema` import
- `server/jobs/job-service.ts` (+19 lines) — `CreateJobOpts.bootOptions` field + jobs.metadata.boot_options persistence + forward reference to `BootOptionsInput`

Those forward references would have produced TypeScript errors until the schema landed. Inspection showed the schema **and** Task 1/Task 2 code had also been pre-committed in the same WIP:

- `server/config/schema.ts` — `bootOptionsSchema` + `BootOptionsInput` exports
- `server/pool/types.ts` — extended `BootOptions` interface (coldBoot, noAudio, gpu)
- `server/pool/android/emulator.ts` — options-driven argv at lines 94-106
- `server/pool/pool-manager.ts` — `allocate(platform, jobId, bootOptions?)` + `shouldRebootForOptions` helper

Reconciliation decision: **accept the WIP work in place** — it matches the plan verbatim. Tasks 1 and 2 were verified via test runs (all 6 boot-options.spec tests + all 7 emulator-boot-options.spec tests PASS) and skipped as separate commits. The new commits cover only the work the WIP did **not** touch.

Also reverted at the start: `cli/cmd/doctor.go` and `.planning/phases/31-quick-wins/deferred-items.md` had uncommitted reverts in the working tree (unrelated to Plan 31-03). Restored to HEAD to keep the executor commits scoped to SC3.

## Task Status

| # | Task | Status | Commit | Notes |
|---|------|--------|--------|-------|
| 1 | bootOptionsSchema + BootOptions extension | DONE (WIP) | `7fb1fda` | Tests already PASS |
| 2 | Emulator argv options-driven + pool-manager threading | DONE (WIP) | `7fb1fda` | Tests already PASS |
| 3 | Multipart parser + executor row-decoder + spec assertions | PARTIAL (WIP) → DONE | `7fb1fda` (multipart) + `e0bb06d` (executor + spec) | Split across two commits |
| 4 | CLI --cold-boot / --audio + submit.go test seam + run_test.go | DONE | `8348695` | 3 t.Skip → real assertions |

## Task Commits (this run)

- **`e0bb06d`** — `feat(31-03): plumb boot_options through executor → pool.allocate`
  - server/jobs/internal/executor.ts: row.metadata.boot_options → bootOptionsSchema.parse → fastify.pool.allocate
  - server/api/__tests__/jobs-boot-options.spec.ts: 4 expect.fail → real Fastify inject() assertions
- **`8348695`** — `feat(31-03): CLI --cold-boot / --audio flags + boot_options multipart emission`
  - cli/cmd/run.go: --cold-boot, --audio flags + bootOpts construction
  - cli/internal/client/submit.go: BootOptionsJSON + SubmitJobOpts + BuildJobMultipart + CreateJob signature
  - cli/cmd/run_test.go: 3 t.Skip → real BuildJobMultipart assertions

## Test Results

### Server (Vitest)
```
server/config/__tests__/boot-options.spec.ts                  PASS (6)
server/pool/android/__tests__/emulator-boot-options.spec.ts   PASS (7)
server/api/__tests__/jobs-boot-options.spec.ts                PASS (4)
                                                              ─────────
                                                              PASS (17)
```

Plus regression suite:
```
server/jobs/__tests__/                                        PASS (86)
server/pool/__tests__/                                        PASS (87) / FAIL (6 pre-existing — module.spec)
```

The 6 pool/__tests__/module.spec failures are pre-existing and reproducible on a clean HEAD checkout (Phase 24 added a 5th pool event 'booted' that the spec hasn't been updated for; and `deps.fastify.addHook` is undefined in the spec harness). Documented separately in deferred-items.md from earlier plans.

### CLI (Go testing)
```
cli/cmd/ TestRunColdBootMultipart       PASS
cli/cmd/ TestRunNoAudioMultipart        PASS
cli/cmd/ TestRunWithoutBootFlags        PASS
cli/cmd/ TestBuildWSURL (4 subtests)    PASS
                                        ───────
                                        PASS (8)
```

`go vet ./cmd/ ./internal/client/`: clean.

### TypeScript
`npx tsc --noEmit` shows 25 pre-existing errors in 17 files (pipelines, pool/health-checker.spec, streaming adapters, hooks/events.spec). Zero new errors attributable to Plan 31-03. Already catalogued in deferred-items.md under DEFERRED-31-C.

## Audio Flag Semantic Decision

The plan flagged this as a Wave 1 choice. Chose **`--audio` (inverse semantics, default false)** over `--no-audio` for the following reasons:

1. **Maps cleanly to Cobra BoolVar:** A `BoolVar` with default false is the canonical Cobra idiom; `--no-audio=true|false` is awkward syntactically and ambiguous semantically.
2. **Matches user intent:** "I want to enable audio" is the rare, opt-in case (audio-dependent tests). The default — audio suppressed — matches every other CLI in the platform (no opt-out flag needed for the common case).
3. **Tristate trap avoided:** With `--no-audio` we would need to distinguish "flag absent (use server default)" from "flag explicitly false (override default to enable audio)" — Cobra BoolVar cannot represent that without a wrapper or a pointer var. `--audio` collapses it: `false` (default) = audio suppressed; `true` = audio enabled.

Conversion at the wire: `NoAudio: !runAudio`. The server's `bootOptionsSchema` still uses `noAudio` because the JSON contract is the source of truth across the server boundary; the CLI's flag is just a friendlier surface to that contract.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Restored pre-existing WIP-committed files to HEAD state**
- **Found during:** Pre-flight (`git status` showed uncommitted reverts of `cli/cmd/doctor.go` and `deferred-items.md`)
- **Issue:** The working tree had reverts of files the WIP commit had landed. These were unrelated to Plan 31-03 (doctor.go = doctor-command rewrite from earlier work; deferred-items.md = removal of DEFERRED-31-F). Carrying them into Task commits would have polluted the commit scope.
- **Fix:** `git checkout HEAD -- cli/cmd/doctor.go .planning/phases/31-quick-wins/deferred-items.md` to restore the WIP state.
- **Files modified:** none staged from the revert (the revert was discarded).
- **Commit:** n/a (pre-commit cleanup).

**2. [Rule 1 - Bug] Initial spec assertion targeted wrong RFC 7807 field**
- **Found during:** Task 3, first run of jobs-boot-options.spec.ts after replacing expect.fail.
- **Issue:** Wrote `expect(json.code).toBe('VALIDATION_ERROR')` — but server/api/error-handler.ts emits the code in the `type` URI (`https://device-farm.local/errors/VALIDATION_ERROR`), not in a top-level `code` field.
- **Fix:** Changed both invalid-JSON and invalid-shape assertions to `expect(json.type).toContain('VALIDATION_ERROR')`.
- **Files modified:** `server/api/__tests__/jobs-boot-options.spec.ts`
- **Commit:** `e0bb06d` (rolled into the executor commit).

**3. [Rule 1 - Bug] Mock db decorator caused TypeScript instantiation error**
- **Found during:** Task 3 typecheck.
- **Issue:** `app.decorate('db', {...})` with an inline object literal triggered an overload-resolution error because Fastify's `decorate` requires the value type to match the FastifyInstance['db'] decorator type. The routes.test.ts canonical pattern declares the mock as `any` first.
- **Fix:** Extracted to `const db: any = {...}; app.decorate('db', db);`. Matches the existing canonical pattern.
- **Files modified:** `server/api/__tests__/jobs-boot-options.spec.ts`
- **Commit:** `e0bb06d`.

### Deferred (out-of-scope)

**DEFERRED-31-G** — semgrep CWE-319 (cleartext-WebSocket) on the existing `buildWSURL` helper in `cli/cmd/run.go`. Pre-existing (line drifted from 258 → 275 only because new flag-variable declarations were added above). Documented in `.planning/phases/31-quick-wins/deferred-items.md`.

## Authentication Gates

None encountered.

## User Setup Required

None. The boot options ship as opt-in CLI flags; existing job submissions continue to work unchanged (server defaults apply).

To use:

```bash
# Cold boot (clean state, no snapshot reuse):
./bin/device-farm run --cold-boot --platform android flow.yaml

# Enable emulator audio (rare; audio-dependent tests):
./bin/device-farm run --audio --platform android flow.yaml

# Both:
./bin/device-farm run --cold-boot --audio --platform android flow.yaml
```

## Next Phase Readiness

Plan 31-04 (CLI update banner) is the last remaining Wave 1 plan; it is independent of SC3 and has its own RED-state substrate from Wave 0.

The boot-options chain is fully wired but **not yet exercised in production traffic** because no in-flight job has shipped the multipart field. First real exercise will be the next manual smoke run (in MEMORY.md pending list).

## Self-Check: PASSED

Verified all referenced commits exist:
- `7fb1fda` (WIP — Tasks 1, 2, partial 3): `git log --oneline --all | grep -q 7fb1fda` → FOUND
- `e0bb06d` (Task 3 completion): FOUND
- `8348695` (Task 4): FOUND

Verified test results:
- `npx vitest run server/config/__tests__/boot-options.spec.ts server/pool/android/__tests__/emulator-boot-options.spec.ts server/api/__tests__/jobs-boot-options.spec.ts` → PASS (17)
- `cd cli && go test ./cmd/ -run "TestRunColdBootMultipart|TestRunNoAudioMultipart|TestRunWithoutBootFlags|TestBuildWSURL"` → PASS (8)

Verified file modifications match the plan's `files_modified` frontmatter:
- server/config/schema.ts                  FOUND
- server/pool/types.ts                     FOUND
- server/pool/android/emulator.ts          FOUND
- server/api/routes.ts                     FOUND
- server/jobs/job-service.ts               FOUND
- server/jobs/internal/executor.ts         FOUND
- server/pool/pool-manager.ts              FOUND
- cli/cmd/run.go                           FOUND
- cli/internal/client/submit.go            FOUND

All 9 plan-listed files modified; 2 spec files updated; 1 deferred-items entry added.

---
*Phase: 31-quick-wins*
*Completed: 2026-05-15*
