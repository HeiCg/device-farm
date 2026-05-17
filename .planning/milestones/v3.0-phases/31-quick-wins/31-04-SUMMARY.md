---
phase: 31-quick-wins
plan: 04
subsystem: cli
tags: [go, cobra, github-releases, semver, update-check, banner]

# Dependency graph
requires:
  - phase: 31-quick-wins
    provides: Wave 0 RED tests (check_test.go, cache_test.go, banner_test.go) — exact behavior contract
provides:
  - cli/internal/updates package — fire-and-forget GitHub releases poll with 24h cache
  - cli/internal/ui package — hand-rolled ASCII update banner renderer
  - PersistentPreRun goroutine + 50ms tail-wait in cli/cmd/root.go
affects: [phase-38-self-update, future-cli-polish]

# Tech tracking
tech-stack:
  added:
    - golang.org/x/mod/semver — canonical Go semver comparison (Go-blessed extension; no third-party HTTP libs)
  patterns:
    - Fire-and-forget goroutine with buffered channel + tail-wait at program exit (Pitfall 5 mitigation)
    - XDG-aware cache path resolution with multi-tier fallback (XDG_CACHE_HOME -> $HOME/.cache -> os.UserCacheDir -> os.TempDir)
    - Test-only env-var override (DEVICE_FARM_UPDATE_URL) for httptest endpoint injection
    - Stderr-only banner output to preserve stdout JSON pipeline integrity

key-files:
  created:
    - cli/internal/updates/check.go
    - cli/internal/updates/cache.go
    - cli/internal/ui/banner.go
    - .planning/phases/31-quick-wins/deferred-items.md
  modified:
    - cli/cmd/root.go
    - cli/go.mod
    - cli/go.sum

key-decisions:
  - "Banner output to os.Stderr (not stdout) — preserves `device-farm status --json | jq` pipeline integrity"
  - "50ms tail-wait at Execute() — cache hits resolve sub-ms, cold network ~100-300ms misses banner first run (acceptable per fire-and-forget contract; cache catches up next invocation)"
  - "DEVICE_FARM_UPDATE_URL env override is test-only — not documented to end users; gives httptest server full control during unit tests"
  - "Persist cache regardless of newer-than result — avoids repeated GitHub polls within TTL even when user is on latest"
  - "Cache TTL = 24h via single const cacheTTL — keeps API quota footprint negligible (~1 req/day/user)"

patterns-established:
  - "Pattern: PersistentPreRun goroutine + buffered chan (cap=1) + Execute() tail-wait — reusable for any future fire-and-forget CLI background work"
  - "Pattern: XDG_CACHE_HOME-aware cache path resolver with 4-tier fallback — reusable for any CLI on-disk cache"
  - "Pattern: Test-only env-var URL override — clean separation between production endpoint and httptest server injection"

requirements-completed: [SC4]

# Metrics
duration: 5min
completed: 2026-05-15
---

# Phase 31 Plan 04: CLI Auto-Update Banner Summary

**Fire-and-forget GitHub releases poll with 24h XDG-aware cache, hand-rolled ASCII banner on stderr, env-var suppression (DEVICE_FARM_NO_UPDATE_CHECK, $CI), and 50ms tail-wait in Cobra Execute() — all stdlib + golang.org/x/mod/semver.**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-05-15T19:40:49Z
- **Completed:** 2026-05-15T19:45:57Z
- **Tasks:** 3
- **Files modified:** 6 (3 created, 3 modified)

## Accomplishments

- `updates.Check(ctx, version, repo)` polls `https://api.github.com/repos/HeiCg/device-farm/releases/latest` with 3s context timeout, returns newer tag (or "") via semver compare against embedded Version
- 24h on-disk cache at `$XDG_CACHE_HOME/device-farm/update-check.json` (fallbacks to `$HOME/.cache`, `os.UserCacheDir()`, `os.TempDir()`) with auto-creating MkdirAll dir setup
- Environment-based suppression: `DEVICE_FARM_NO_UPDATE_CHECK=1` and `$CI` both early-return ""
- Graceful no-op on non-200 (including 404 when repo has no releases yet)
- Tag regex `^v\d+\.\d+\.\d+(-[\w.]+)?$` rejects malformed/non-semver release names
- Hand-rolled ASCII banner using only `+`, `-`, `|` chars (zero third-party deps) printed to **stderr** so `--json` stdout stays clean
- Cobra `PersistentPreRun` spawns the check goroutine; `Execute()` applies 50ms tail-wait via `select` on buffered channel — never blocks the user's command

## Task Commits

1. **Task 1: updates.Check + cache.go** — `715b3b5` (feat)
2. **Task 2: ASCII banner renderer** — `82f2d97` (feat)
3. **Task 3: Wire goroutine into root.go + deferred-items** — `cd36651` (feat)

## Files Created/Modified

**Created:**
- `cli/internal/updates/check.go` (104 lines) — `Check(ctx, version, repo)` entry point; env-var suppression; cache short-circuit; 3s context timeout; HTTP GET; tag regex; semver compare via `golang.org/x/mod/semver`; `DEVICE_FARM_UPDATE_URL` test-only override
- `cli/internal/updates/cache.go` (75 lines) — `ReadCache()`/`WriteCache(tag)`; `cachePath()` with 4-tier XDG fallback; 24h TTL constant; auto-create cache dir via `os.MkdirAll(0o755)`
- `cli/internal/ui/banner.go` (51 lines) — `RenderUpdateBanner(current, latest)` returning multi-line ASCII box; auto-fits width to longest body line
- `.planning/phases/31-quick-wins/deferred-items.md` — DEFERRED-31-A pre-existing build breakage docs

**Modified:**
- `cli/cmd/root.go` — added `updateResult chan string` (buffered cap=1); `updateCheckRepo` const = `"HeiCg/device-farm"`; `updateTailWait = 50ms`; goroutine in `PersistentPreRun`; tail-wait `select` in `Execute()`; banner printed to `os.Stderr`
- `cli/go.mod` + `cli/go.sum` — `golang.org/x/mod v0.36.0` added

## Test Results

All 11 SC4 Wave 0 tests green (`cd cli && go test ./internal/updates/ ./internal/ui/`):

- `TestCheckSuppressEnvVar` — `DEVICE_FARM_NO_UPDATE_CHECK=1` returns ""
- `TestCheckSuppressCI` — `$CI=true` returns ""
- `TestCheckNewerVersion` — httptest server returning v2.0.0, current v1.0.0 → returns "v2.0.0"
- `TestCheckMalformedTag` — `tag_name: "not-a-semver"` → returns ""
- `TestCheckTimeout` — 5s slow server, 3s deadline → returns "" in <4s elapsed
- `TestCheck404` — httptest 404 → returns ""
- `TestCacheHit` — WriteCache then ReadCache → (tag, true)
- `TestCacheExpiry` — 48h-old cache file → returns ok=false
- `TestCacheDirAutoCreate` — WriteCache succeeds on fresh tempdir
- `TestBannerBox` — output contains current/latest/`device-farm self-update`/`+-`
- `TestBannerWidth` — every non-empty line ends with `+` or `|`

`go vet ./cmd/ ./internal/updates/ ./internal/ui/` clean. Main `device-farm` binary builds (`go build -o /tmp/device-farm-test ./.` succeeds).

## Smoke Test Outcome

Not exercised in this execution (would require either a real public release on `HeiCg/device-farm` or pre-seeding the cache file — both are listed as Manual-Only Verifications in 31-VALIDATION.md). The Wave 0 unit suite covers every code path; smoke verification is deferred to phase-close.

## Decisions Made

### Banner on stderr (not stdout)
Phase 31 CONTEXT did not specify destination. Chose stderr to keep `device-farm status --json | jq` pipelines clean — banner is metadata about the CLI itself, not part of the command output contract. Documented in Task 3 commit body and root.go inline comment.

### 50ms tail-wait
RESEARCH Pitfall 5 mandates cache-hit case to surface the banner (sub-ms goroutine completion). 50ms is generous enough for cache reads on any reasonable filesystem; cold network calls (100-300ms) will miss the banner on first run — acceptable per the fire-and-forget contract since the cache populates and the next invocation always shows it.

### Cache written even when not newer
Spec wording is "Always write cache on successful network fetch (even if not newer — avoids repeated polls)". Implemented as a `_ = WriteCache(rel.TagName)` after regex validation, before the newer-than check. Keeps API quota footprint at ~1 req/day/user regardless of staleness.

### DEVICE_FARM_UPDATE_URL test-only override
Required by `check_test.go` to point at `httptest.NewServer`. Implemented as undocumented env var; `os.Getenv` short-circuits the GitHub URL builder. Not exposed to end users.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Scope Boundary] Pre-existing `internal/types/unions.go` build breakage discovered**
- **Found during:** Task 3 (after wiring root.go, ran `go build ./...`)
- **Issue:** 6 build errors in `cli/internal/types/unions.go` (`JobLogMessage`, `JobStepMessage`, `JobStatusMessage` undefined)
- **Verification it pre-exists:** `git stash` + `go build ./...` reproduces all 6 errors at HEAD without my changes
- **Action taken:** Documented in `.planning/phases/31-quick-wins/deferred-items.md` as DEFERRED-31-A; ownership assigned to Plan 31-02 (WS batch unwrap — the plan that owns `internal/streaming/` and `internal/types/` per 31-RESEARCH.md). NOT auto-fixed — out-of-scope per Plan 31-04 boundary.
- **Files modified:** `.planning/phases/31-quick-wins/deferred-items.md` (NEW)
- **Verification:** Plan 31-04 packages (`./cmd/ ./internal/updates/ ./internal/ui/`) build + vet clean in isolation; main `device-farm` binary builds (`go build ./.` succeeds — only `./...` triggers the unrelated types/unions.go errors)
- **Committed in:** `cd36651` (Task 3 commit)

---

**Total deviations:** 1 logged as deferred (0 auto-fixed inline)
**Impact on plan:** No scope creep. SC4 wiring complete in isolation; the pre-existing build break is owned by a sibling plan in the same phase.

## Issues Encountered

None. All three tasks executed exactly as written in 31-04-PLAN.md.

## User Setup Required

None — no external service configuration required. End users can optionally set:
- `DEVICE_FARM_NO_UPDATE_CHECK=1` to suppress the banner
- `$CI` is already set by CI runners (auto-suppressed)

## Next Phase Readiness

- SC4 closed: all 8 explicit + 3 implicit Wave 0 tests green
- `updates.Check` is ready for the future Phase 38+ self-update feature (banner is the first step; deferred per CONTEXT)
- DEFERRED-31-A (pre-existing types/unions.go breakage) carries over for whichever 31-0x plan ships next that touches `cli/internal/streaming/` or `cli/internal/types/`

## Self-Check: PASSED

- All 5 created/modified files present on disk
- All 3 task commits (715b3b5, 82f2d97, cd36651) present in git log
- All 11 SC4 Wave 0 tests green (9 updates + 2 ui)
- `go vet ./cmd/ ./internal/updates/ ./internal/ui/` clean
- Main `device-farm` binary builds successfully

---
*Phase: 31-quick-wins*
*Plan: 04*
*Completed: 2026-05-15*
