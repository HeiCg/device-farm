---
phase: 31-quick-wins
plan: 00
subsystem: testing
tags: [vitest, go-testing, tdd, scaffold, logcat, websocket-batching, boot-options, cli-update-banner]

requires:
  - phase: 22-streaming-module
    provides: wsEnvelopeSchema + per-job broadcaster (FlushQueue attaches per-socket here)
  - phase: 23-jobs-module-keystone
    provides: streaming subscriber + first-detection gate primitive (firstCrashSeen Set pattern)
  - phase: 20-pool-module
    provides: BootOptions interface in server/pool/types.ts (currently timeout-only; Wave 1 extends)
provides:
  - 17 failing test/fixture files in RED state covering SC1-SC4
  - 5 representative Android logcat fixtures with documented expected_crash_count headers
  - Test-first substrate that locks Wave 1 plan interfaces (parseLogcatLine, FlushQueue, bootOptionsSchema, updates.Check, ui.RenderUpdateBanner, streaming.UnwrapBatch)
  - DEVICE_FARM_UPDATE_URL env-override contract for httptest-based update check tests
affects:
  - 31-01 (logcat parser + streaming integration — turns log-parsing.spec + log-parsing-integration.spec green)
  - 31-02 (flush-queue + batch unwrap — turns flush-queue.spec + streaming_test.go TestBatchUnwrap + web job-stream.test.ts green)
  - 31-03 (boot options — turns boot-options.spec + emulator-boot-options.spec + jobs-boot-options.spec + run_test.go boot-flag tests green)
  - 31-04 (CLI update banner — turns check_test + cache_test + banner_test green)

tech-stack:
  added: []
  patterns:
    - "Test-first scaffolding for an entire phase before any production code lands"
    - "Fixture files with `# expected_crash_count: N` header lines parsed by tests"
    - "Vitest fake-timers + mock-socket pattern for FlushQueue 10k-line stress test"
    - "vi.mock on both 'node:child_process' and bare 'child_process' to cover NodeNext resolution"
    - "DB-gated specs via `describeIfDb = dbUrl ? describe : describe.skip;` pattern"
    - "Go httptest.NewServer + t.Setenv + XDG_CACHE_HOME isolation for update-check tests"
    - "DEVICE_FARM_UPDATE_URL env override as the test seam for GitHub Releases polling"
    - "expect.fail / t.Skip placeholders documenting Wave 1 implementation targets"

key-files:
  created:
    - server/jobs/__tests__/log-parsing.spec.ts
    - server/jobs/__tests__/fixtures/logcat-crash-androidruntime.txt
    - server/jobs/__tests__/fixtures/logcat-crash-native-sigsegv.txt
    - server/jobs/__tests__/fixtures/logcat-anr.txt
    - server/jobs/__tests__/fixtures/logcat-normal-verbose.txt
    - server/jobs/__tests__/fixtures/logcat-mixed.txt
    - server/streaming/__tests__/flush-queue.spec.ts
    - server/streaming/__tests__/log-parsing-integration.spec.ts
    - server/config/__tests__/boot-options.spec.ts
    - server/pool/android/__tests__/emulator-boot-options.spec.ts
    - server/api/__tests__/jobs-boot-options.spec.ts
    - cli/internal/updates/check_test.go
    - cli/internal/updates/cache_test.go
    - cli/internal/ui/banner_test.go
    - cli/internal/streaming/streaming_test.go
    - web/src/lib/ws/__tests__/job-stream.test.ts
  modified:
    - cli/cmd/run_test.go

key-decisions:
  - "Pinned GitHub repo string literal to 'HeiCg/device-farm' so check_test.go tests stay deterministic (placeholder per 31-RESEARCH Open Question 1)."
  - "DEVICE_FARM_UPDATE_URL env override is the mandated test seam — Wave 1 plan 31-04 MUST honor it; otherwise check_test.go cannot point at httptest.NewServer."
  - "Mocked BOTH 'node:child_process' and 'child_process' in emulator-boot-options.spec to cover both NodeNext resolution forms; mirrors existing emulator.test.ts pattern."
  - "Web batch-unwrap test ships as RED skeleton even though web/ has no vitest infra today — Wave 1 plan 31-02 decides install-vitest vs defer-to-manual."
  - "TDD RED-only: NO production code created in this plan. Every test file imports a not-yet-existing module OR uses expect.fail/t.Skip; this is the Nyquist gate for Wave 1."
  - "Fixture files use `# expected_crash_count: N` header convention so a single test runner can iterate all 5 fixtures with a generic helper."
  - "logcat-crash-native-sigsegv.txt: 'Fatal signal 11' marker line is intentionally level E (DEBUG tombstone), NOT level F (libc) — only level=E satisfies the 3-of-3 gate per CONTEXT."
  - "logcat-anr.txt: expected_crash_count=0 because ANR is NOT in the initial 4-marker set; deferred per CONTEXT."

patterns-established:
  - "Wave-0 RED scaffold: failing tests reference Wave-1 modules via .js imports (server) or package imports (Go) that don't yet exist"
  - "Fixture header parsing: tests read `# expected_crash_count: N` from first comment line, filter out comment + blank lines, then parse"
  - "Skip-gate for DB tests: `const describeIfDb = dbUrl ? describe : describe.skip;` lets the suite remain green when no DATABASE_URL is set"
  - "Go env-override seam: production code reads optional DEVICE_FARM_UPDATE_URL; test sets it via t.Setenv pointing at httptest server"

requirements-completed: [SC1, SC2, SC3, SC4]

duration: 10min
completed: 2026-05-15
---

# Phase 31 Plan 00: Wave 0 RED Test Scaffold Summary

**Test-first substrate for Phase 31 — 17 failing test/fixture files committed across server/cli/web in RED state, locking Wave 1 interfaces for parseLogcatLine, FlushQueue, bootOptionsSchema, updates.Check, ui.RenderUpdateBanner, and streaming.UnwrapBatch.**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-05-15T19:27:15Z
- **Completed:** 2026-05-15T19:37:00Z
- **Tasks:** 5
- **Files created:** 16
- **Files modified:** 1 (cli/cmd/run_test.go extended)

## Accomplishments

- Full failing-test substrate landed for SC1-SC4 in a single Wave 0 plan, with EVERY test grep-target from `31-VALIDATION.md` Per-Task Verification Map present in source (24/24 task IDs)
- 5 representative Android logcat fixtures (AndroidRuntime FATAL, native sigsegv, ANR, normal verbose, mixed crash-in-traffic) with `# expected_crash_count: N` header convention enabling generic fixture iteration
- Wave 1 plan interfaces locked: every server spec imports its production module via `.js` extension (NodeNext); every Go test imports its package; spec failure mode is module-resolution / undefined-symbol — the canonical RED signal Wave 1 turns green
- Web batch-unwrap skeleton parked in correct location with explicit Wave 1 decision-point noted (install vitest in web/ OR defer to manual DevTools per 31-RESEARCH Open Question 4)

## Task Commits

Each task was committed atomically:

1. **Task 1: logcat parser test scaffold + 5 fixtures** — `a05f3f0` (test)
2. **Task 2: streaming flush-queue + log-parsing-integration scaffolds** — `2386d9c` (test)
3. **Task 3: boot-options + emulator-boot-options + jobs-boot-options scaffolds** — `d896cc9` (test)
4. **Task 4: CLI Go test scaffolds (updates/cache/banner/streaming/run)** — `87812a4` (test)
5. **Task 5: web batch-unwrap test scaffold** — `796e107` (test)

_All commits are `test(31-00): ...` per Phase 31 convention. No `feat` or `fix` commits — this plan is pure RED scaffold._

## Files Created/Modified

### Created (16)

**Server (Vitest):**
- `server/jobs/__tests__/log-parsing.spec.ts` — parseLogcatLine threadtime + 3-of-3 + false-positive + fixture-driven tests
- `server/jobs/__tests__/fixtures/logcat-crash-androidruntime.txt` — AndroidRuntime FATAL EXCEPTION sequence + chatter (expected_crash_count: 1)
- `server/jobs/__tests__/fixtures/logcat-crash-native-sigsegv.txt` — Native sigsegv + DEBUG tombstone (expected_crash_count: 1)
- `server/jobs/__tests__/fixtures/logcat-anr.txt` — ANR sequence — NOT a crash per current markers (expected_crash_count: 0)
- `server/jobs/__tests__/fixtures/logcat-normal-verbose.txt` — 50 normal V/D/I/W lines (expected_crash_count: 0)
- `server/jobs/__tests__/fixtures/logcat-mixed.txt` — 99 lines mixed traffic with one embedded crash sequence (expected_crash_count: 1)
- `server/streaming/__tests__/flush-queue.spec.ts` — FlushQueue 10k-line stress + drain + nobatch + 64-cap + empty no-op
- `server/streaming/__tests__/log-parsing-integration.spec.ts` — DB-gated single-detection + crash event payload + no false positive
- `server/config/__tests__/boot-options.spec.ts` — bootOptionsSchema defaults + each field override + invalid rejection
- `server/pool/android/__tests__/emulator-boot-options.spec.ts` — child_process mocked; cold boot / audio / gpu / spawn / backward-compat
- `server/api/__tests__/jobs-boot-options.spec.ts` — multipart parse + persist + 400 VALIDATION_ERROR on bad JSON/shape

**CLI (Go testing):**
- `cli/internal/updates/check_test.go` — SuppressEnvVar/SuppressCI/NewerVersion/MalformedTag/Timeout/404 with httptest + DEVICE_FARM_UPDATE_URL seam
- `cli/internal/updates/cache_test.go` — CacheHit / CacheExpiry / CacheDirAutoCreate
- `cli/internal/ui/banner_test.go` — TestBannerBox content checks + TestBannerWidth +/| borders
- `cli/internal/streaming/streaming_test.go` — TestBatchUnwrap / PassThrough / Empty / Malformed

**Web (Vitest, jsdom):**
- `web/src/lib/ws/__tests__/job-stream.test.ts` — batch unwrap / flat passthrough / malformed JSON

### Modified (1)

- `cli/cmd/run_test.go` — extended existing TestBuildWSURL file with TestRunColdBootMultipart / TestRunNoAudioMultipart / TestRunWithoutBootFlags (each t.Skip pending Wave 1 plan 31-03 test seam)

## Decisions Made

- **Pinned repo string to `HeiCg/device-farm`** in `check_test.go` — placeholder per 31-RESEARCH Open Question 1; Wave 1 plan 31-04 should accept this constant or surface to user if the real repo differs.
- **Introduced `DEVICE_FARM_UPDATE_URL` env override as the test seam** for the GitHub Releases poll. Tests rely on this; Wave 1 plan 31-04 MUST honor it (default to `https://api.github.com/repos/{repo}/releases/latest` only when unset).
- **Mocked both `node:child_process` and `child_process`** in `emulator-boot-options.spec.ts` — covers both NodeNext resolution forms; mirrors the existing `emulator.test.ts` style at `server/pool/android/__tests__/emulator.test.ts`.
- **Web batch-unwrap test parked as RED skeleton** despite web/ lacking vitest infra — explicitly marks Wave 1 plan 31-02 decision-point (install vitest OR defer to manual DevTools per Open Question 4).
- **Extended (not replaced) `cli/cmd/run_test.go`** rather than creating a new test file — preserves existing TestBuildWSURL coverage and avoids package-name collision (`package cmd` vs `package cmd_test`).

## Deviations from Plan

None - plan executed exactly as written.

Every task spec, fixture content guideline, import path, test name, and grep target from the plan was preserved verbatim. The plan was unusually well-specified — both the spec body templates and acceptance criteria were directly executable.

## Issues Encountered

None.

The plan's acceptance criteria (especially the `! npx vitest run ... 2>&1 | grep "✓"` RED-state grep guards) lined up exactly with empirical results — every server spec failed with `Cannot find module '../X.js'` or `Cannot read properties of undefined`, every Go test failed with `no non-test Go files in /Users/.../internal/updates` or `undefined: streaming.UnwrapBatch`. Pure test-first discipline executed cleanly.

## User Setup Required

None - this plan creates only test/fixture files and modifies one existing test file. No external service configuration required.

## Next Phase Readiness

Wave 1 plans 31-01 through 31-04 are unblocked. Each is independent and parallelizable, with a known subset of failing tests to drive green:

- **31-01 (parser + streaming subscriber):** `log-parsing.spec.ts` + `log-parsing-integration.spec.ts`
- **31-02 (flush-queue + batch unwrap, server/web/CLI):** `flush-queue.spec.ts` + `streaming_test.go` TestBatchUnwrap + web `job-stream.test.ts`
- **31-03 (boot options):** `boot-options.spec.ts` + `emulator-boot-options.spec.ts` + `jobs-boot-options.spec.ts` + `run_test.go` boot-flag tests (unskip after test seam exposed)
- **31-04 (CLI update banner):** `check_test.go` + `cache_test.go` + `banner_test.go`

Wave 1 must:
1. Implement modules behind the imports already encoded in the specs (e.g., `server/jobs/log-parsing.ts`, `server/streaming/internal/flush-queue.ts`, `server/config/schema.ts::bootOptionsSchema`, `cli/internal/updates/check.go`, etc.).
2. Replace `expect.fail` and `t.Skip` placeholders with real assertions (jobs-boot-options.spec, emulator-boot-options.spec, web job-stream.test.ts, run_test.go boot tests, log-parsing-integration.spec).
3. Honor the `DEVICE_FARM_UPDATE_URL` test seam in `updates.Check`.
4. Decide web vitest infra question for plan 31-02 (install OR defer).

No carry-forward blockers from this plan.

## Self-Check: PASSED

Verified all 17 files exist on disk:
- 11 server spec/fixture files: PASS
- 5 CLI Go test files: PASS
- 1 web test file: PASS

Verified all 5 task commits in git history:
- a05f3f0, 2386d9c, d896cc9, 87812a4, 796e107: all FOUND in `git log --oneline -10`

Verified RED state via test runs:
- `npx vitest run server/jobs/__tests__/log-parsing.spec.ts` → FAIL with "Cannot find module '../log-parsing.js'"
- `npx vitest run server/streaming/__tests__/flush-queue.spec.ts` → FAIL with "Cannot find module '../internal/flush-queue.js'"
- `npx vitest run server/config/__tests__/boot-options.spec.ts` → FAIL with "Cannot read properties of undefined (reading 'parse')"
- `cd cli && go test ./internal/updates/` → FAIL with "no non-test Go files in cli/internal/updates"
- `cd cli && go test ./internal/ui/` → FAIL with "no non-test Go files in cli/internal/ui"
- `cd cli && go test ./internal/streaming/` → FAIL with "undefined: streaming.UnwrapBatch"
- `cd cli && go test ./cmd/` → PASS (TestBuildWSURL still green; new boot-flag tests t.Skip'd as planned)

---
*Phase: 31-quick-wins*
*Completed: 2026-05-15*
