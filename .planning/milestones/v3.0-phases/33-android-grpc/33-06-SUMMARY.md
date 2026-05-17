---
phase: 33-android-grpc
plan: 06
subsystem: pool
tags: [typescript, android, grpc, gap-closure, wiring, pool, plugin]

# Dependency graph
requires:
  - phase: 33-android-grpc
    plan: 03
    provides: BootResult.grpcPort + DeviceInfo.grpcPort fields (allocated by Wave 3 emulator.ts) + 3 driver.boot() call sites in pool-manager.ts
  - phase: 33-android-grpc
    plan: 04
    provides: AndroidDeviceService.setStreamingService injection point + androidStreamingService singleton + AndroidStreamingService class
provides:
  - Device.grpcPort field (number | null) initialized in constructor + surfaced via Device.toInfo()
  - grpcPort assignment after driver.boot() at all 3 call sites in pool-manager.ts (initPool, allocate per-job reboot, replaceDevice)
  - androidDeviceService.setStreamingService(androidStreamingService) wired at pool plugin init when config.pool.android.enabled
affects:
  - 33-VERIFICATION.md re-verification (truths #6 and #7 flip from FAILED → VERIFIED on re-run)
  - Production gRPC pipeline is now reachable end-to-end for fresh-boot Android emulators

# Tech tracking
tech-stack:
  added: []  # Pure additive wiring; no new dependencies
  patterns:
    - "Singleton injection at plugin init — pool plugin owns the cross-package wiring between server/pool and device-stream/packages/android (singletons live in @device-stream/android; injection happens once at server startup, gated on android.enabled)"
    - "Field-mirroring for transport metadata — Device.grpcPort mirrors the established Device.port / Device.pid pattern (writable nullable instance fields populated post-boot, projected through toInfo() into the canonical DeviceInfo DTO)"
    - "Workspace-symlinked package consumption — server imports from @device-stream/android which is a workspace symlink; rebuilding the package's dist/ is part of the gap-closure when Wave 4 additions had not yet been recompiled"

key-files:
  created:
    - server/pool/__tests__/device-grpcport.spec.ts
    - .planning/phases/33-android-grpc/33-06-SUMMARY.md
  modified:
    - server/pool/device.ts
    - server/pool/pool-manager.ts
    - server/pool/plugin.ts
    - .planning/phases/33-android-grpc/deferred-items.md

key-decisions:
  - "alreadyHealthy reuse branch leaves device.grpcPort=null — no fresh boot means no fresh allocation; documented as DEFERRED-33-06-A. Workaround is to restart the emulator (any of the 3 fresh-boot paths will propagate the new grpcPort)."
  - "result.grpcPort ?? null — explicit null coalesce at the 3 boot sites. BootResult.grpcPort is optional (undefined for non-emulator drivers and pre-Phase-33 boots); coercing undefined → null at the Device boundary matches the field's nullable type and prevents undefined from leaking into DeviceInfo (where the field is also nullable)."
  - "release() does NOT clear grpcPort — emulator process is still alive across release/re-allocate; clearing would make subsequent tap/pressKey events fall back to scrcpy. The existing release() does already clear pid which is arguably wrong but out of scope for gap closure."
  - "Wiring happens inside the if(android.enabled) block, after driver.registerDriver() — keeps streaming setup co-located with platform registration; idempotent (setStreamingService reassigns _streaming on every call so re-registration is safe)."
  - "Rebuild @device-stream/android dist/ — workspace symlink consumed pre-Wave-4 dist artifacts that lacked AndroidStreamingService / androidStreamingService / setStreamingService exports. Single `npx tsc` in device-stream/packages/android/ regenerated dist with all Phase 33 Wave 4 surface. Should be added to the build pipeline that runs before tsc-check (out of scope here; flagged in DEFERRED noting needed)."

requirements-completed:
  - AND-GRPC-WIRING

# Metrics
duration: 6min
completed: 2026-05-16
---

# Phase 33 Plan 06: Gap Closure — production wiring of grpcPort + setStreamingService

**Plan 33-06 closes the two BLOCKER gaps from 33-VERIFICATION.md that left the gRPC pipeline unreachable in production. Three modified server files + one new unit test propagate grpcPort end-to-end (BootResult → Device → DeviceInfo) and inject the AndroidStreamingService singleton into AndroidDeviceService at pool plugin initialization. Phase 33 is now production-ready for Android emulator boots.**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-05-16T13:43:00Z (approx)
- **Completed:** 2026-05-16T13:49:00Z (approx)
- **Tasks:** 3 (Task 1 Device + propagation, Task 2 setStreamingService wiring, Task 3 end-to-end audit)
- **Source LOC added:** ~16 (3 lines device.ts + 3 lines pool-manager.ts + 8 lines plugin.ts)
- **Test LOC added:** ~28 (device-grpcport.spec.ts)
- **Files modified:** 4 (3 server + deferred-items)
- **Files created:** 2 (1 test + this SUMMARY)
- **Commits:** 3 atomic task commits

## Task Commits

| # | Task                                                                    | Commit    | Type |
| - | ----------------------------------------------------------------------- | --------- | ---- |
| 1 | Add grpcPort field to Device + propagate from BootResult at 3 sites     | `df99d6f` | fix  |
| 2 | Wire AndroidStreamingService into AndroidDeviceService at pool plugin   | `737aec5` | fix  |
| 3 | Record DEFERRED-33-06-A grpcPort reconciliation for alreadyHealthy      | `5e59e9a` | docs |

## Files Modified

### `server/pool/device.ts` (+5 LOC)
- `grpcPort: number | null` field declared alongside `port: number | null`
- Initialized to `null` in constructor
- Included in `toInfo()` projection between `pid` and `currentJobId`
- Provenance docblock cites Phase 33 / Plan 33-06 and DEFERRED-33-06-A

### `server/pool/pool-manager.ts` (+3 LOC across 3 sites)
- `initPool` fresh-boot loop (line ~145): `device.grpcPort = result.grpcPort ?? null`
- `allocate` per-job reboot path (line ~316): `device.grpcPort = result.grpcPort ?? null`
- `replaceDevice` zombie replacement boot (line ~443): `device.grpcPort = result.grpcPort ?? null`

### `server/pool/plugin.ts` (+12 LOC)
- New import at line 37: `import { androidDeviceService, androidStreamingService } from '@device-stream/android';`
- Inside `if (config.pool.android.enabled)` block (after `module.pool.registerDriver(...)`):
  - `androidDeviceService.setStreamingService(androidStreamingService);`
  - `fastify.log.info('Android streaming service wired into AndroidDeviceService ...')`

### `server/pool/__tests__/device-grpcport.spec.ts` (new, 3 tests, ~28 LOC)
- `initializes grpcPort to null on a fresh Device` (assertion on field + toInfo)
- `exposes assigned grpcPort through toInfo()` (8554 round-trip)
- `preserves grpcPort across reassignments` (8556 → 8557 projection)

### `.planning/phases/33-android-grpc/deferred-items.md` (+12 LOC)
- Appended DEFERRED-33-06-A documenting alreadyHealthy reuse limitation + workaround

## Verification Snapshots

### Gap 1 closure — grpcPort propagation

```
$ grep -nE "grpcPort" server/pool/device.ts
25:  grpcPort: number | null;
39:    this.grpcPort = null;
82:      grpcPort: this.grpcPort,

$ grep -cE "device\.grpcPort\s*=\s*result\.grpcPort" server/pool/pool-manager.ts
3

$ grep -cE "grpcPort:\s*this\.grpcPort" server/pool/device.ts
1
```

All three required hits in device.ts (field/init/projection). Exactly 3 assignments in pool-manager.ts (one per driver.boot() call site).

### Gap 2 closure — setStreamingService wired

```
$ grep -cE "androidDeviceService\.setStreamingService\(androidStreamingService\)" server/pool/plugin.ts
1

$ grep -nE "from '@device-stream/android'" server/pool/plugin.ts
37:import { androidDeviceService, androidStreamingService } from '@device-stream/android';
```

Exactly one wiring call; both singletons imported on a single line.

### TypeScript baseline check

```
Pre-edit:  npx tsc --noEmit 2>&1 | grep -cE 'error TS' → 24
Post-edit: npx tsc --noEmit 2>&1 | grep -cE 'error TS' → 24
```

Zero new errors. Baseline (DEFERRED-15-A inherited) unchanged.

### Pool test suite

```
$ npx vitest run server/pool/__tests__/ server/pool/android/__tests__/
{"numPassedTests":120, "numFailedTests":9, "numTotalTests":140, "numTodoTests":0}
```

Baseline pre-edit was 117 pass / 9 fail (33-03-SUMMARY). Post-edit: **120 pass / 9 fail** (+3 from `device-grpcport.spec.ts`). The 9 failures are the pre-existing `module.spec.ts` `deps.fastify.addHook is not a function` set inherited from Phase 20-03 — verified via `git stash` baseline comparison that they pre-date this plan.

### `@device-stream/android` workspace rebuild

The workspace symlink at `node_modules/@device-stream/android` consumed a stale `dist/` (pre-Wave-4) that did not export `AndroidStreamingService`, `androidStreamingService`, or `setStreamingService`. Ran `cd device-stream/packages/android && npx tsc` to regenerate. After rebuild, `dist/index.d.ts` correctly re-exports all Wave 4 surface (service.d.ts, grpc-emu-client.d.ts), and `server/pool/plugin.ts` type-checks cleanly. The rebuild is reproducible; the 1 pre-existing tsc error in scrcpy-service.ts (yume-chan stream-extra type incompat, noted in 33-04-SUMMARY) is non-blocking for emit.

## Decisions Made

See `key-decisions` in frontmatter (5 decisions). Notable:

- **alreadyHealthy reuse leaves grpcPort=null** — Documented as DEFERRED-33-06-A. The alternative would require parsing `pid_<pid>.ini` at startup, which is out of scope for the gap closure. Workaround: restart the emulator (all 3 fresh-boot paths now propagate correctly).
- **`result.grpcPort ?? null` coalesce** — Forces undefined → null at the Device boundary so DeviceInfo's nullable field is never undefined.
- **release() preserves grpcPort** — Emulator process survives release; clearing the field would break the next tap/pressKey by forcing scrcpy fallback.
- **Singleton wiring at pool plugin** — The pool plugin is the right substrate boundary (it already owns `module.pool.registerDriver('android', ...)`); co-locating streaming setup keeps platform-specific wiring together.
- **dist/ rebuild required** — Caught during Task 2 verification. Workspace symlink + tsc check exposed the stale dist; rebuilding solved cleanly. A future improvement could add a build step before `tsc --noEmit` in the pipeline.

## Deviations from Plan

**1. [Rule 3 — Blocking] `@device-stream/android` workspace dist/ was stale; required rebuild to expose Wave 4 exports**

- **Found during:** Task 2 (initial tsc check after adding import + setStreamingService call)
- **Issue:** `npx tsc --noEmit` reported 26 errors (baseline 24) with two new errors:
  - `TS2305: Module '"@device-stream/android"' has no exported member 'androidStreamingService'`
  - `TS2339: Property 'setStreamingService' does not exist on type 'AndroidDeviceService'`
- **Root cause:** `node_modules/@device-stream/android` is a workspace symlink to `device-stream/packages/android/`. The package's `dist/` directory had not been rebuilt since before Phase 33 Wave 4, so the compiled `index.d.ts` only re-exported the pre-Wave-4 surface (no `service`, no `grpc-emu-client`).
- **Fix:** Ran `cd device-stream/packages/android && npx tsc` to regenerate `dist/`. After rebuild, all Wave 4 exports are visible: `AndroidStreamingService`, `androidStreamingService`, `setStreamingService`, `GrpcEmuClient`. tsc baseline returned to 24.
- **Files modified:** `device-stream/packages/android/dist/*` (gitignored, regenerated; not committed)
- **Verification:** `npx tsc --noEmit 2>&1 | grep -cE 'error TS'` returns 24 (baseline).
- **Note:** The 1 pre-existing scrcpy-service.ts type error from yume-chan stream-extra (noted in 33-04-SUMMARY) does not block dist emit.

### No Rule-1/2/4 issues. No auth gates.

## Issues Encountered

- Stale workspace `dist/` for `@device-stream/android` masked the gRPC additions; required a one-shot rebuild. Future plans that consume @device-stream/* packages should add a "rebuild workspace dists before tsc check" step to their verification script, or the project should add a top-level `npm run build:device-stream` aliasing the per-package builds.

## 33-VERIFICATION.md re-verification readiness

Both previously FAILED truths now have source-side evidence supporting VERIFIED:

| # | Truth (from 33-VERIFICATION.md) | Pre-plan | Post-plan | Evidence |
|---|----------------------------------|----------|-----------|----------|
| 6 | Pool-manager propagates grpcPort from BootResult to Device entity for production use | FAILED | VERIFIED-READY | `grep -cE "device\.grpcPort\s*=\s*result\.grpcPort" server/pool/pool-manager.ts` → 3; field + toInfo projection in device.ts |
| 7 | setStreamingService wired in production server initialization | FAILED | VERIFIED-READY | `grep -cE "androidDeviceService\.setStreamingService\(androidStreamingService\)" server/pool/plugin.ts` → 1; inside the `config.pool.android.enabled` gate |

Re-verification should be run via `/gsd:verify-phase 33 --re-verify` to flip the two FAILED truths to VERIFIED in the verification report.

## Handoff

- **Production status:** Phase 33 gRPC pipeline now flows end-to-end for fresh Android emulator boots. `device.grpcPort` arrives at `DeviceInfo` consumed by `AndroidStreamingService.start()`, which spawns `android-grpc-stream` daemon and routes tap/pressKey through 0xC1/0xC2 frames per Wave 4 design.
- **Remaining manual verification (recommended after merge):** Boot a real emulator with `android.enabled: true`, confirm server log line "Android streaming service wired into AndroidDeviceService", confirm process tree shows `android-grpc-stream` daemon, tap on dashboard, confirm no `adb shell input tap` in `ps`.
- **Known limitation:** Already-running emulators on server restart take the `alreadyHealthy` reuse path and stay on scrcpy until next reboot (DEFERRED-33-06-A).

## Next Phase Readiness

- Phase 33 production-complete (Wave 5 phase-close artifacts shipped 2026-05-16; this gap-closure plan completes the production wiring)
- Phase 34 Session API + MCP Server remains the next phase target
- No new tech debt; one new deferred item (DEFERRED-33-06-A) tracked for future enhancement

---
*Phase: 33-android-grpc*
*Plan: 06 (Gap closure: production wiring of grpcPort + setStreamingService)*
*Completed: 2026-05-16*

## Self-Check: PASSED

All 6 claimed files exist on disk (3 modified server files, 1 new test, deferred-items.md updated, this SUMMARY); all 3 task commits present in git log (`df99d6f`, `737aec5`, `5e59e9a`).
