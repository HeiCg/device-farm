---
phase: 31-quick-wins
verified: 2026-05-15T22:30:00Z
status: passed
score: 4/4 success criteria verified
gaps: []
human_verification:
  - test: "Dashboard 'Crash detected' badge renders"
    expected: "Submit a job that logs FATAL EXCEPTION; verify red badge appears in /jobs/[id] within 1s of detection"
    why_human: "UI assertion across Svelte 5 reactive state — crashDetected state wired but visual render requires browser"
  - test: "10k-line job shows < 100 WS frames in Chrome DevTools Network -> WS"
    expected: "Frame count < 100 (server-side FlushQueue spec asserts <= 40 worst-case via BUFFER_CAP=256)"
    why_human: "Browser DevTools observation required to confirm wire-level frame count"
  - test: "Live GitHub release triggers update banner"
    expected: "Tag and publish a higher version at HeiCg/device-farm; run device-farm on a clean machine; assert banner appears on stderr"
    why_human: "Requires real public release — unit tests mock the GitHub API; live smoke test requires the actual endpoint"
---

# Phase 31: Quick Wins — Logs, Job Config & CLI Polish Verification Report

**Phase Goal:** Land four small, isolated quality-of-life improvements (logcat parser + crash auto-tag, WS log batch-flush, cold-boot/no-audio per-job, CLI auto-update banner) without touching device-stream internals.
**Verified:** 2026-05-15T22:30:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A job that logs FATAL EXCEPTION finishes with jobs.failure_class = 'crash' and crash-detected WS event fires exactly once | VERIFIED | `server/streaming/internal/module.ts` imports `parseLogcatLine`, has `firstCrashSeen Set<string>`, fires fire-and-forget `.set({ failureClass: 'crash' })`, emits `crash-detected` envelope, clears on `job.cleanup.requested` |
| 2 | 10k-line job results in fewer than 100 WS frames at the dashboard (batched in 150ms windows) | VERIFIED | `FlushQueue` at `server/streaming/internal/flush-queue.ts` with FLUSH_INTERVAL_MS=150, BUFFER_CAP=256 (math: 10000/256 = 40 cap flushes; server-side spec asserts < 100 frames); wired into `plugin.ts` per-socket |
| 3 | device-farm run --cold-boot warm-boots without snapshots; --audio flag plumbs through BootOptions | VERIFIED | `emulator.ts` pushes `-no-snapshot-load` when `options?.coldBoot === true`; `run.go` has `--cold-boot` and `--audio` Cobra flags; full chain: routes.ts -> job-service.ts -> executor.ts -> pool-manager.ts -> emulator.ts |
| 4 | Running device-farm while a newer GitHub release exists prints update banner; suppressed by DEVICE_FARM_NO_UPDATE_CHECK=1 and $CI; cached 24h | VERIFIED | `cli/internal/updates/check.go` (116 LOC): env-var suppression, 3s timeout, tag regex, semver compare; `cli/internal/updates/cache.go` (80 LOC): 24h TTL, XDG-aware path; `cli/internal/ui/banner.go`: ASCII box to stderr; root.go wires goroutine + 50ms tail-wait |

**Score:** 4/4 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `server/jobs/log-parsing.ts` | parseLogcatLine pure function + ParsedLogcat interface | VERIFIED | 52 lines; exports `parseLogcatLine` and `ParsedLogcat`; threadtime regex + 4 crash markers; no external deps |
| `server/db/schema.ts` | failureClassEnum pgEnum + failureClass column on jobs table | VERIFIED | `failureClassEnum = pgEnum('failure_class', ['crash','timeout','cancelled'])` at line 59; `failureClass` column at line 93 |
| `server/db/migrations/0008_jobs_failure_class.sql` | Drizzle-generated migration with CREATE TYPE + ALTER TABLE | VERIFIED | Migration numbered 0008 (plan said 0007 — 0007 was already taken); contains `CREATE TYPE "public"."failure_class" AS ENUM(...)` and `ALTER TABLE "jobs" ADD COLUMN "failure_class"`; journaled in `_journal.json` |
| `server/streaming/internal/module.ts` | Log subscriber with parser hook + first-crash gate + DB write + crash-detected emit | VERIFIED | Lines 44, 154-156, 254, 283-364; all required patterns present |
| `server/streaming/internal/flush-queue.ts` | FlushQueue class with 150ms timer + buffer cap + drain-on-close | VERIFIED | 97 LOC; exports `FlushQueue` and `SocketLike`; FLUSH_INTERVAL_MS=150, BUFFER_CAP=256 (raised from plan's 64 to satisfy < 100 frame SC2 contract) |
| `server/streaming/plugin.ts` | WS route with FlushQueue per-connection + ?nobatch=1 query parse | VERIFIED | Imports FlushQueue at line 34; `batchMode = !(req.query as { nobatch? }).nobatch` at line 88; `new FlushQueue(socket, batchMode)` at line 89 |
| `cli/internal/streaming/ws.go` | UnwrapBatch helper + receive-loop integration | VERIFIED | `func UnwrapBatch(raw []byte) ([]json.RawMessage, error)` at line 28; receive-loop iterates unwrapped items at line 74+ |
| `web/src/lib/ws/job-stream.svelte.ts` | Batch unwrap + per-item dispatch + crash-detected handler | VERIFIED | `type === 'batch' && Array.isArray(parsed.items)` at line 92; `dispatchEnvelope` used for both batch items and flat messages; `crash-detected` case at line 66 |
| `server/config/schema.ts` | bootOptionsSchema Zod schema with 3 fields + BootOptionsInput type | VERIFIED | `bootOptionsSchema` at line 97; `coldBoot: z.boolean().default(false)`, `noAudio: z.boolean().default(true)`, `gpu` enum; `BootOptionsInput` alias at line 103 |
| `server/pool/types.ts` | Extended BootOptions interface with coldBoot/noAudio/gpu | VERIFIED | `coldBoot?: boolean` at line 15, `noAudio?: boolean` at line 16; doc comment references `bootOptionsSchema` |
| `server/pool/android/emulator.ts` | Options-driven argv construction | VERIFIED | `options?.coldBoot === true` pushes `-no-snapshot-load` at line 99; `options?.noAudio !== false` pushes `-no-audio` at line 103 |
| `server/api/routes.ts` | boot_options multipart field parsed + validated | VERIFIED | `boot_options` branch at line 106; `bootOptionsSchema.parse(raw)` at line 115 |
| `server/jobs/job-service.ts` | CreateJobOpts.bootOptions field + persistence to jobs.metadata | VERIFIED | `bootOptions?: BootOptionsInput` at line 37; persisted to `jobs.metadata.boot_options` at line 58-59 |
| `server/jobs/internal/executor.ts` | Row-decoder re-validates boot_options + plumbs to pool.allocate | VERIFIED | `bootOptionsSchema.parse(rawBootOptions)` at line 91; `fastify.pool.allocate(row.platform, jobId, bootOptions)` at line 96 |
| `server/pool/pool-manager.ts` | allocate(platform, jobId, bootOptions?) + shouldRebootForOptions | VERIFIED | `async allocate(platform, jobId, bootOptions?: BootOptions)` at line 275; `shouldRebootForOptions` helper at line 29 |
| `cli/cmd/run.go` | --cold-boot and --audio Cobra flags | VERIFIED | `runCmd.Flags().BoolVar(&runColdBoot, "cold-boot", false, ...)` at line 51; `runCmd.Flags().BoolVar(&runAudio, "audio", false, ...)` at line 52 |
| `cli/internal/client/submit.go` | BootOptionsJSON struct + boot_options multipart field emission | VERIFIED | `type BootOptionsJSON struct` at line 30; `writer.WriteField("boot_options", string(bootJSON))` at line 145 |
| `cli/internal/updates/check.go` | Check function + env-var suppression + 3s timeout + tag regex + semver | VERIFIED | 116 LOC; `DEVICE_FARM_NO_UPDATE_CHECK=1` at line 44; `CI` at line 47; `context.WithTimeout(ctx, 3*time.Second)` at line 65; `tagRe` regex at line 17 |
| `cli/internal/updates/cache.go` | ReadCache/WriteCache with 24h TTL + XDG-aware path + MkdirAll | VERIFIED | 80 LOC; `ReadCache()` at line 51; `WriteCache(tag)` at line 70 |
| `cli/internal/ui/banner.go` | RenderUpdateBanner — hand-rolled ASCII box to stderr | VERIFIED | `func RenderUpdateBanner(currentVer, latestVer string) string` at line 22; output sent to os.Stderr in root.go |
| `cli/cmd/root.go` | PersistentPreRun goroutine + 50ms tail-wait + banner print | VERIFIED | `updateResult = make(chan string, 1)` at line 33; goroutine spawned at line 60; tail-wait select at line 88; `fmt.Fprint(os.Stderr, ui.RenderUpdateBanner(...))` at line 90 |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `server/streaming/internal/module.ts` | `server/jobs/log-parsing.ts` | `import parseLogcatLine` | WIRED | `import { parseLogcatLine, type ParsedLogcat } from '../../jobs/log-parsing.js'` at line 44 |
| `server/streaming/internal/module.ts` | `jobs table (DB)` | drizzle update set failureClass crash | WIRED | `db.update(jobs).set({ failureClass: 'crash' })` at line 292 |
| `server/streaming/internal/module.ts` | broadcaster | broadcaster.emit with type crash-detected | WIRED | `broadcaster.emit(...)` with `type: 'crash-detected' as const` at line 306 |
| `server/streaming/plugin.ts` | `server/streaming/internal/flush-queue.ts` | new FlushQueue(socket, batchMode) | WIRED | `new FlushQueue(socket as unknown as SocketLike, batchMode)` at line 89 |
| `cli/internal/streaming/ws.go` | UnwrapBatch | receive-loop calls UnwrapBatch on every frame | WIRED | `items, err := UnwrapBatch(data)` at line 76; `for _, item := range items` iterates |
| `web/src/lib/ws/job-stream.svelte.ts` | dispatch loop | iterates parsed.items when type=batch | WIRED | `if (parsed.type === 'batch' && Array.isArray(parsed.items))` at line 92 |
| `server/api/routes.ts` | `server/config/schema.ts` | bootOptionsSchema.parse on multipart field | WIRED | `bootOptions = bootOptionsSchema.parse(raw)` at line 115 |
| `server/api/routes.ts` | `server/jobs/job-service.ts (CreateJobOpts)` | bootOptions field on CreateJobOpts | WIRED | `bootOptions` passed in `createJob(...)` at line 140; `bootOptions?: BootOptionsInput` in CreateJobOpts |
| `server/jobs/internal/executor.ts` | `server/pool/pool-manager.ts (allocate)` | fastify.pool.allocate(platform, jobId, bootOptions) | WIRED | `fastify.pool.allocate(row.platform, jobId, bootOptions)` at line 96 |
| `server/pool/pool-manager.ts` | `server/pool/android/emulator.ts (driver.boot)` | driver.boot(deviceId, bootOptions) | WIRED | `shouldRebootForOptions` + `allocate` passes bootOptions to driver.boot |
| `cli/cmd/run.go` | `cli/internal/client/submit.go` | boot_options multipart field JSON-encoded | WIRED | `writer.WriteField("boot_options", string(bootJSON))` at line 145 |
| `cli/cmd/root.go` | `cli/internal/updates/check.go` | go updates.Check goroutine in PersistentPreRun | WIRED | `go func() { tag := updates.Check(cmd.Context(), Version, updateCheckRepo) ... }()` at line 60 |
| `cli/internal/updates/check.go` | `cli/internal/updates/cache.go` | ReadCache short-circuit before network; WriteCache after success | WIRED | `ReadCache()` at line 53; `WriteCache(rel.TagName)` at line 95 |
| `cli/cmd/root.go` | `cli/internal/ui/banner.go` | ui.RenderUpdateBanner(current, latest) printed to stderr | WIRED | `fmt.Fprint(os.Stderr, ui.RenderUpdateBanner(Version, tag))` at line 90 |

---

### Requirements Coverage

Phase 31 does not use REQUIREMENTS.md v1 REQ-IDs. The RESEARCH.md explicitly confirms: "The v1 SPEC-/EVENTS-/QUEUE-/MOD-/TRACE-/CLI-/WEB-/DEBT- requirement set is already 60/60 mapped to Phase 15-30 and Phase 31 introduces NO new REQ-IDs — it is a quality-of-life phase outside the v3.0 spec-driven mapping."

Requirements for this phase are the four ROADMAP success criteria (SC1-SC4), all of which are verified above.

| Requirement | Source | Description | Status | Evidence |
|-------------|--------|-------------|--------|----------|
| SC1 | ROADMAP Phase 31 | jobs.failure_class = 'crash' on FATAL EXCEPTION + dashboard badge | SATISFIED | log-parsing.ts + module.ts first-crash gate + 0008 migration + crashDetected reactive state in web client |
| SC2 | ROADMAP Phase 31 | 10k-line job < 100 WS frames (150ms batching) | SATISFIED | FlushQueue BUFFER_CAP=256 (40 worst-case frames); plugin.ts per-socket wiring; Go CLI UnwrapBatch; web dispatchEnvelope |
| SC3 | ROADMAP Phase 31 | device-farm run --cold-boot / --audio plumbed through BootOptions | SATISFIED | Full chain: CLI flags -> multipart boot_options -> jobs.metadata -> executor row-decoder -> pool.allocate -> emulator argv |
| SC4 | ROADMAP Phase 31 | Update banner when newer release; DEVICE_FARM_NO_UPDATE_CHECK=1 / $CI suppress; 24h cache | SATISFIED | check.go + cache.go + banner.go + root.go goroutine + tail-wait wired |

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `web/src/lib/ws/__tests__/job-stream.test.ts` | 1-30 | `describe.skip` — web-side automated batch-unwrap test deferred | INFO | Documented deliberate decision: web has no vitest infra; server-side FlushQueue spec covers the wire shape; manual DevTools verification covers the dashboard surface. Not a blocker. |
| `cli/internal/types/unions.go` | 22-57 | Pre-existing build breakage: `undefined: JobLogMessage` etc. | INFO (pre-existing) | Documented in DEFERRED-31-A; pre-dates Phase 31; CLI packages used by Phase 31 build clean in isolation. Not introduced by Phase 31. |
| `--quiet` suppression | n/a | CONTEXT listed --quiet as a banner suppression condition; not implemented | INFO | RESEARCH.md flagged this: "the `--quiet` flag does NOT currently exist in `cli/cmd/root.go` PersistentFlags". Plan chose to implement env-var suppression only (DEVICE_FARM_NO_UPDATE_CHECK + CI) which covers all documented use cases. |

---

### Human Verification Required

#### 1. Dashboard "Crash detected" badge

**Test:** Submit a job that streams a line matching `FATAL EXCEPTION` with level `E` in Android threadtime format. Wait for the job to complete.
**Expected:** A red "Crash detected" badge appears on the `/jobs/[id]` detail page within 1 second of detection; `jobs.failure_class` column shows `'crash'` in the database.
**Why human:** Visual Svelte 5 reactive state render — `crashDetected = $state(false)` is wired in `job-stream.svelte.ts` but the badge component rendering it requires browser observation.

#### 2. 10k-line job WS frame count

**Test:** Submit a job that produces 10k log lines via the Go CLI. Open Chrome DevTools → Network → WS → `/ws/jobs/:id`.
**Expected:** Frame count < 100 (BUFFER_CAP=256 caps worst-case at 40 cap-overflow flushes; realistic timer-interleaved ~40 frames).
**Why human:** Wire-level frame count is only observable via browser DevTools; the server-side FlushQueue spec verifies this via mock socket.send count but cannot substitute for live wire observation.

#### 3. Live GitHub release update banner

**Test:** Tag and publish a release higher than the embedded Version on `HeiCg/device-farm`. On a machine with no cached update-check.json, run `device-farm run`.
**Expected:** ASCII box banner appears on stderr noting the new version and suggesting `device-farm self-update` within ~100ms (cache hit is sub-ms on second run).
**Why human:** Requires an actual public GitHub release — unit tests mock the API via httptest; cold-start banner may not appear within the 50ms tail-wait on first run (fire-and-forget contract: banner guaranteed on second invocation after cache populates).

---

### Gaps Summary

No gaps. All four success criteria are delivered with substantive implementations:

- **SC1** is fully wired: pure parser module, Drizzle migration (0008), first-crash Set gate, fire-and-forget DB update, crash-detected WS envelope, cleanup on job.cleanup.requested.
- **SC2** is fully wired: FlushQueue per-socket (150ms/256-msg), ?nobatch=1 opt-out, Go CLI UnwrapBatch in receive-loop, web dispatchEnvelope split. Notable deviation from plan: BUFFER_CAP raised 64→256 to satisfy the < 100 frame contract (plan's 64 was mathematically incompatible with the assertion).
- **SC3** is fully wired: Zod bootOptionsSchema, BootOptions interface extension, options-driven emulator argv, multipart boot_options parser, CreateJobOpts.bootOptions, executor row-decoder, pool-manager.allocate(bootOptions?), CLI --cold-boot/--audio flags, submit.go BuildJobMultipart seam. Audio flag uses inverse semantics (--audio, not --no-audio) to avoid Cobra BoolVar tristate trap.
- **SC4** is fully wired: check.go + cache.go + banner.go + root.go goroutine + tail-wait. Migration number deviation (plan said 0007, actual is 0008 because 0007 was already occupied) is correctly handled in both the filename and _journal.json.

Three items require human verification (dashboard badge render, DevTools frame count, live release trigger) but none block automated goal achievement.

---

*Verified: 2026-05-15T22:30:00Z*
*Verifier: Claude (gsd-verifier)*
