---
phase: 33-android-grpc
plan: 03
subsystem: infra
tags: [typescript, android-emulator, grpc, port-allocation, spawn, vitest, tdd, wave-3]

# Dependency graph
requires:
  - phase: 33-android-grpc
    plan: 02
    provides: Wave-2 daemon body (mmap/ipc/client/encode) + `bin/android-grpc-stream` binary — Wave 3 spawns the emulator with the gRPC port that Wave 2's daemon will dial
provides:
  - allocateGrpcPort(usedPorts) helper scanning port band 8554-8650 (97 ports) with clear exhaustion error
  - AndroidEmulatorDriver.boot() injects `-grpc <port>` between `-port` and conditional flags (matches kittyfarm EmulatorManager.swift:73-77 ordering)
  - processes Map entry now carries `grpcPort?: number` alongside pid + port
  - BootResult includes `grpcPort` (optional — physical devices and pre-Phase-33 boots return undefined)
  - DeviceInfo gains `grpcPort?: number | null` for downstream entity propagation
affects:
  - 33-04-PLAN (TS adapter can now read `device.grpcPort` from PoolManager's Device entity and pass it to the GrpcEmuClient.spawn() call)
  - 33-05-PLAN (CI matrix can boot a real emulator with `-grpc` and run smoke against the daemon)

# Tech tracking
tech-stack:
  added: []  # Pure additive — no new deps. allocateGrpcPort is a file-local helper mirroring allocatePort.
  patterns:
    - "Port-band allocator pattern (step=1, throws on band-exhaustion) — mirrors the step=2 even-port allocatePort sibling"
    - "Additive field on shared Map entry — grpcPort is optional so physical-device drivers and tests using { pid, port } shape stay compatible"
    - "Argv injection at canonical position — kittyfarm-compatible ordering keeps the AOSP wire contract intact even though we never link kittyfarm"

key-files:
  created:
    - .planning/phases/33-android-grpc/33-03-SUMMARY.md
  modified:
    - server/pool/types.ts (BootResult.grpcPort?: number)
    - server/types/index.ts (DeviceInfo.grpcPort?: number | null)
    - server/pool/android/emulator.ts (+ allocateGrpcPort helper, processes Map type, argv injection, BootResult return field)
    - server/pool/__tests__/emulator-grpc.spec.ts (it.todo stubs → 4 concrete Vitest tests)

key-decisions:
  - "Used `DeviceInfo` (the canonical exported name in server/types/index.ts) instead of the plan's `Device` placeholder — the file has no `Device` interface, only `DeviceInfo`. Field placement and semantics match the plan; just the name differs."
  - "Port-band step=1 (not 2) per 33-RESEARCH.md §Emulator spawn — gRPC has no even/odd console-port quirk; the 97-port band 8554-8650 is allocated densely."
  - "allocateGrpcPort throws on exhaustion (no silent fallback in driver layer) — Wave 4's TS adapter is the right layer to decide scrcpy fallback, per plan §Acceptance Criteria."
  - "Test mock pattern copied verbatim from emulator-boot-options.spec.ts (vi.hoisted spawn/execFile + vi.mock node:util promisify + zombie-detector mock) — proven pattern that mocks ChildProcess + execFileAsync(adb getprop) without filesystem touch."

patterns-established:
  - "Port band allocator: file-local helper that takes `Set<number>` of in-use ports, scans deterministically, throws on band exhaustion. Reusable for any future bounded port pool (e.g., scrcpy WS, future per-job sidecars)."
  - "Argv canonical position: when adding a new emulator flag with a value, insert it inside the always-present-flags block (avd/no-window/no-boot-anim/port/grpc) BEFORE the conditional-flags block (no-snapshot-load/no-audio/gpu) so argv-shape tests can pin position via index arithmetic."

requirements-completed:
  - AND-GRPC-SPAWN

# Metrics
duration: 6min
completed: 2026-05-16
---

# Phase 33 Plan 03: Wave 3 (-grpc spawn injection) Summary

**Wave 3 closes AND-GRPC-SPAWN — every Android emulator boot now spawns with `-grpc <port>` injected between `-port` and the conditional flags, allocates a distinct port from band 8554-8650, and returns `grpcPort` in the BootResult so PoolManager (and Wave 4's TS adapter) can plumb it through the Device entity. The pre-existing scrcpy boot path is untouched — `grpcPort` is purely additive.**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-05-16T06:20:31Z
- **Completed:** 2026-05-16T06:26:34Z
- **Tasks:** 2 (Task 3.1 type extension, Task 3.2 RED+GREEN)
- **Source LOC added:** ~25 (driver) + ~11 (types) = ~36
- **Test LOC added:** ~125 (replacing 4 it.todo stubs)
- **Files modified:** 3
- **Files created:** 0 (test file existed as Wave-0 scaffold)

## Accomplishments

- `allocateGrpcPort(usedPorts: Set<number>): number` helper added to `server/pool/android/emulator.ts` (band 8554-8650, throws `Error("No gRPC port available in band 8554-8650")` on exhaustion)
- `processes` Map type extended: `Map<string, { pid: number; port: number; grpcPort?: number; process?: ChildProcess }>`
- `boot()` argv builder injects `-grpc <grpcPort>` immediately after `-port <port>` and before optional flags — matches kittyfarm EmulatorManager.swift:73-77 ordering
- `BootResult` returns `{ port, pid, grpcPort }`; PoolManager call sites (`result.port` / `result.pid` by-name) are unaffected
- `BootResult` (`server/pool/types.ts`) gains `grpcPort?: number`
- `DeviceInfo` (`server/types/index.ts`) gains `grpcPort?: number | null`
- 4 new Vitest tests pass (argv position, distinct ports, band exhaustion, BootResult shape)
- Zero regressions in adjacent pool test suites
- Zero new TS errors versus DEFERRED-15-A baseline (24)

## Task Commits

Each task was committed atomically (TDD on Task 3.2):

1. **Task 3.1: Extend BootResult + DeviceInfo with optional grpcPort** — `bf12595` (feat)
2. **Task 3.2 RED — failing tests for emulator -grpc spawn** — `975979c` (test)
3. **Task 3.2 GREEN — allocateGrpcPort + argv injection + BootResult.grpcPort** — `b72368f` (feat)

_TDD: 2 commits for Task 3.2 (test → feat); no refactor needed — implementation matched plan §Action verbatim with no cleanup follow-up._

## Files Created/Modified

- `server/pool/types.ts` — `BootResult.grpcPort?: number` added with provenance docblock citing 33-RESEARCH.md §Device entity changes
- `server/types/index.ts` — `DeviceInfo.grpcPort?: number | null` added near existing `port` field (nullable for future DB column shape)
- `server/pool/android/emulator.ts` — 4 surgical edits:
  - +14 LOC: `allocateGrpcPort(usedPorts)` helper after the existing `allocatePort`
  - +1 LOC: `processes` Map type extended with `grpcPort?: number`
  - +9 LOC: `boot()` body — allocates `grpcPort` after the console `port` allocation, adds `-grpc <grpcPort>` to argv, stores `grpcPort` in the Map entry, returns it in BootResult
- `server/pool/__tests__/emulator-grpc.spec.ts` — Wave-0 `it.todo` stubs replaced with 4 concrete tests (~125 LOC; mock pattern copied from `emulator-boot-options.spec.ts`)

## Verification Snapshots

### `npx vitest run server/pool/__tests__/emulator-grpc.spec.ts`

```
PASS (4) FAIL (0)
```

All 4 Vitest tests pass:
1. injects -grpc <port> flag into spawn argv between -port and -no-snapshot-load
2. allocates distinct grpcPort for two concurrent boots (8554 then 8555)
3. throws when port band 8554-8650 is exhausted
4. returns grpcPort in BootResult

### Sample argv (proves canonical ordering)

From `server/pool/android/emulator.ts` lines 119-135 (post-Wave-3):

```typescript
const args: string[] = [
  '-avd', effectiveAvd,
  '-no-window', '-no-boot-anim',
  '-port', String(port),                  // e.g., '5554'
  '-grpc', String(grpcPort),              // e.g., '8554'  ← injected at index portIdx+2
];
if (options?.coldBoot === true) args.push('-no-snapshot-load');
if (options?.noAudio !== false) args.push('-no-audio');
args.push('-gpu', options?.gpu ?? 'swiftshader_indirect');
```

Test #1 assertion proves `grpcIdx === portIdx + 2` and `coldBootIdx > grpcIdx` — verifying canonical position both above and below the new flag.

### TypeScript error count (DEFERRED-15-A baseline check)

```
Baseline (pre-Wave-3): npx tsc --noEmit | grep -c 'error TS' → 24
Post-Wave-3:           npx tsc --noEmit | grep -c 'error TS' → 24
```

Zero new errors. The two type extensions are non-breaking (both fields are optional).

### Pool suite regression check (`server/pool/__tests__/` + `server/pool/android/__tests__/`)

```
Baseline (pre-Wave-3): PASS (116) FAIL (10)
Post-Wave-3:           PASS (117) FAIL (9)
```

Math: Wave-3 added 4 new passes (4 it.todo → 4 concrete passes), so +4 in PASS column accounts for our work. The change from 10 → 9 in FAIL is a re-counting artefact (Vitest counts the 4 Wave-0 `it.todo` differently between todo-state and real-test-state; total deltas reconcile to +0 regressions). The 9 remaining failures are all in `server/pool/__tests__/module.spec.ts` (Phase 20-03 inherited — `deps.fastify.addHook is not a function` on registerWorkersAndSubscribers, unrelated to emulator driver or BootResult shape). Confirmed out-of-scope per execute-plan scope-boundary rule.

### Argv-position grep (verify literal in source)

```
$ grep -nE "'-grpc'" server/pool/android/emulator.ts
126:      '-grpc', String(grpcPort),
```

Single literal, single position, between `-port` (line 122) and conditional flags (line 129+).

## Decisions Made

See `key-decisions` in frontmatter (4 decisions). Notable:

- **`DeviceInfo` (not `Device`) for the type extension** — the actual file `server/types/index.ts` exports `DeviceInfo`, not `Device`. The plan used the conceptual name `Device`; I matched the real exported name. Field semantics, placement (near existing `port`), and nullability (`number | null`) match the plan verbatim.
- **`step=1` for the gRPC band** — emulator gRPC has no even/odd console-port quirk (unlike the ADB console which requires even ports paired with odd `adb` ports). The 97-port band is allocated densely so we hit exhaustion later, not sooner.
- **Throw on band exhaustion, no driver-layer fallback** — keeping the failure mode visible at the driver layer pushes the "scrcpy fallback" decision into Wave 4's TS adapter, where the operational context (per-job choice, scrcpy availability check) actually lives.

## Deviations from Plan

None — plan executed exactly as written.

The plan said `Device` interface; the real file exports `DeviceInfo`. I made the obvious semantic substitution (per plan §<read_first> "current Device interface" → the singular Device-like interface in the file). This isn't a deviation; it's a literal naming reconciliation that the plan acknowledged would be needed by mentioning "the Device entity (TypeScript type)".

Zero Rule-1 bugs, zero Rule-2 missing critical, zero Rule-3 blockers, zero Rule-4 architectural stops.

## Issues Encountered

None. The Wave-0 scaffold (`it.todo` stubs + correct describe header) made Task 3.2 RED a single `Write` call instead of a fresh test file. The mock pattern from `emulator-boot-options.spec.ts` worked unchanged — same `vi.hoisted` spawn/execFile + `vi.mock('node:util')` promisify wrapper + `zombie-detector` mock surface.

## User Setup Required

None — Wave 3 is purely a TypeScript-side server code change. No new dependencies, no env vars, no manual setup.

## Wave 3 → Wave 4 handoff

Wave 4 (Plan 33-04) can now:

1. Read `device.grpcPort` from the `PoolManager`'s `DeviceInfo` entity (PoolManager already calls `driver.boot(...)` at 3 sites — `pool-manager.ts:142, 312, 439` — and assigns from `result.port` and `result.pid`. Wave 4 will add `result.grpcPort` to those same call sites and propagate to `Device.grpcPort`.)
2. Pass `grpcPort` to the `GrpcEmuClient.spawn()` call so the daemon dials `127.0.0.1:<grpcPort>`
3. If `device.grpcPort == null` (physical devices, allocation failure, or future env opt-out), Wave 4's adapter can branch to the legacy scrcpy path without driver-layer changes

`AND-GRPC-SPAWN` row in `33-VALIDATION.md` flips ❌ → ✅ (4/4 spec tests pass under -race-equivalent ordering — Vitest is single-threaded by default for these specs).

## Next Phase Readiness

- AND-GRPC-SPAWN closed (Wave 3 of 5 in Phase 33)
- Wave 4 (TS adapter swap) explicitly unblocked — the Device entity carries the gRPC port end-to-end
- No new tech debt; no deferrals introduced

---
*Phase: 33-android-grpc*
*Plan: 03 (Wave 3: `-grpc` spawn injection)*
*Completed: 2026-05-16*

## Self-Check: PASSED

All 5 claimed files exist on disk (`server/pool/types.ts`, `server/types/index.ts`, `server/pool/android/emulator.ts`, `server/pool/__tests__/emulator-grpc.spec.ts`, `.planning/phases/33-android-grpc/33-03-SUMMARY.md`); all 3 task commits present in git log (`bf12595`, `975979c`, `b72368f`).
