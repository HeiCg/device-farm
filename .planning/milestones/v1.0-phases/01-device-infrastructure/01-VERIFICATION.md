---
phase: 01-device-infrastructure
verified: 2026-03-10T08:15:00Z
status: human_needed
score: 15/15 must-haves verified
re_verification: true
  previous_status: gaps_found
  previous_score: 13/15
  gaps_closed:
    - "Server can start with all plugins wired (config -> pool -> health)"
    - "TypeScript compiles production code without errors"
  gaps_remaining: []
  regressions: []
human_verification:
  - test: "Boot a real Android emulator headless on macOS with Apple Silicon"
    expected: "Emulator starts without window, adb detects sys.boot_completed=1 within 120s"
    why_human: "Requires real Android SDK, AVD, and compatible host — cannot test in CI without hardware"
  - test: "Boot a real iOS simulator via simctl on macOS with Xcode"
    expected: "Simulator boots, bootstatus completes, UDID appears as Booted in simctl list"
    why_human: "Requires Xcode and macOS — cannot test programmatically in this environment"
  - test: "Full server startup sequence: config load -> dependency check -> orphan reap -> pool init -> health checker"
    expected: "Server listens on configured port, GET /api/health returns { status: 'ok', devices: [...] }"
    why_human: "Integration test requires live PostgreSQL, Android SDK or iOS Xcode, and real binaries (adb, emulator, xcrun, ffmpeg, maestro) in PATH"
---

# Phase 1: Device Infrastructure Verification Report

**Phase Goal:** Emulators and simulators can be reliably booted, monitored, and cleaned up without zombie processes or state corruption
**Verified:** 2026-03-10T08:15:00Z
**Status:** human_needed
**Re-verification:** Yes — after gap closure plan 01-05

## Re-verification Summary

Previous score: 13/15 (2026-03-09T23:31:00Z)
Current score: 15/15

Both gaps from the initial verification are now closed. All automated checks pass.

### Gaps Closed

**Gap 1: Plugin dependency name mismatch** — CLOSED
`server/pool/plugin.ts` line 47 now reads `{ name: 'pool-plugin', dependencies: ['config'] }`.
Previously it declared `dependencies: ['config-plugin']` which would cause Fastify to throw a registration assertion at startup.

**Gap 2: TypeScript logger type errors** — CLOSED
`server/pool/plugin.ts` line 21 now reads `const logger = fastify.log as unknown as pino.Logger;`.
The `as unknown as pino.Logger` double-cast resolved all 3 production TypeScript errors. Running `npx tsc --noEmit` produces zero errors in production source files.

### Regression Check

All 74 tests still pass across 9 test suites (confirmed: `npx vitest run` 2026-03-10). No regressions introduced by plan 01-05.

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|---------|
| 1 | Server reads config.yaml, validates with Zod, and exposes typed config via Fastify decorator | VERIFIED | `server/config/schema.ts` exports `configSchema` and `AppConfig`; `loader.ts` calls `configSchema.safeParse()` with formatted errors; `plugin.ts` calls `loadConfig()` and `fastify.decorate('config', config)`; 7 config tests pass |
| 2 | Invalid config produces clear error messages listing each field that failed | VERIFIED | `loader.ts` maps `result.error.issues` to `i.path.join('.') + ': ' + i.message`; test "throws Error with formatted field paths for invalid YAML" passes |
| 3 | Env vars DEVICE_FARM_PORT, DEVICE_FARM_CONFIG, DATABASE_URL override YAML values | VERIFIED | `loader.ts` lines 18-25 implement all three overrides; 3 dedicated tests pass |
| 4 | Missing required dependencies cause fail-fast with install hints | VERIFIED | `checkDependencies` iterates DEPENDENCIES array, collects missing as `Missing: ${dep.name} -- ${dep.installHint}`, throws if any missing; 5 tests pass including platform skipping |
| 5 | Device state machine enforces valid transitions and rejects invalid ones | VERIFIED | `device.ts` checks `VALID_TRANSITIONS[this._state].includes(newState)`, throws `InvalidTransitionError` otherwise; emits `stateChange` event; 9 tests pass including mutex concurrency test |
| 6 | Android emulators can be booted headless, detected as ready, and shut down | VERIFIED | `emulator.ts` spawns with `-no-window -no-audio -no-boot-anim -gpu swiftshader_indirect`; polls `sys.boot_completed` with `.trim()`; kills process group with `process.kill(-pid, 'SIGTERM')`; 9 tests pass including carriage return trimming test |
| 7 | iOS simulators can be created, booted, detected as ready, and shut down | VERIFIED | `simulator.ts` calls `xcrun simctl create/boot/bootstatus/shutdown/erase`; handles "already booted" gracefully; parses `simctl list devices -j` for health; 10 tests pass |
| 8 | Boot detection handles edge cases: ADB carriage returns, already-booted simulators, timeouts | VERIFIED | `emulator.ts` uses `stdout.trim() === '1'`; `simulator.ts` checks `err.stderr.includes('Booted')`; boot loop has `timeoutMs` guard; tests verify both cases |
| 9 | Pool manager allocates idle devices by platform using FIFO ordering | VERIFIED | `pool-manager.ts` iterates `Map` in insertion order (FIFO), finds first `DeviceState.Idle` matching platform; 9 allocation tests pass including FIFO order test |
| 10 | Concurrent allocation requests never assign the same device | VERIFIED | `allocateMutex.runExclusive()` wraps the entire allocation loop; concurrency test with `Promise.all([allocate, allocate])` with one idle device: one returns DeviceInfo, other returns null |
| 11 | Process tracker records all emulator PIDs and can kill process groups | VERIFIED | `process-tracker.ts` maps `deviceId -> pid`; `killProcess` sends `process.kill(-pid, 'SIGTERM')` then escalates to SIGKILL; handles ESRCH; 12 tests pass |
| 12 | Orphan emulator processes from previous crashes are detected and killed on startup | VERIFIED | `scanOrphans()` runs `ps aux`, matches `/qemu-system|emulator|Android[/ ]emulator/i`, excludes tracked PIDs; `reapOrphans()` called in `onReady` hook; `startReaper(60000)` runs every 60s |
| 13 | Health check runs every 30 seconds and checks all devices in parallel | VERIFIED | `health-checker.ts` uses `setInterval(checkAll, intervalMs)` with default 30000ms; `checkAll()` calls `Promise.allSettled(checks)`; 9 tests pass including parallel check test |
| 14 | Server can start with all plugins wired (config -> pool -> health) | VERIFIED | `server/pool/plugin.ts` line 47: `{ name: 'pool-plugin', dependencies: ['config'] }` — correctly matches `server/config/plugin.ts` which registers as `'config'`; `server/index.ts` registers configPlugin then poolPlugin in correct order; no runtime assertion will fire |
| 15 | TypeScript compiles production code without errors | VERIFIED | `npx tsc --noEmit` produces zero errors in production source files (server/**/*.ts excluding __tests__); `server/pool/plugin.ts` line 21: `const logger = fastify.log as unknown as pino.Logger` resolves the 3 previously failing assignments; 19 pre-existing test-file errors remain (pino generic type mismatch in __tests__ — does not affect production build or test execution) |

**Score:** 15/15 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `server/config/schema.ts` | Zod config schema with AppConfig type | VERIFIED | Exports `configSchema` and `AppConfig`; full nested schema with pre-parsed defaults for Zod 4 compatibility |
| `server/config/loader.ts` | YAML parse + env override + Zod validation | VERIFIED | Exports `loadConfig()`; reads YAML, applies DEVICE_FARM_PORT/DATABASE_URL overrides, safeParse with formatted errors |
| `server/config/plugin.ts` | Fastify plugin decorating app with typed config | VERIFIED | Calls `loadConfig()`, `fastify.decorate('config', config)`, augments `FastifyInstance` type; named `'config'` |
| `server/db/schema.ts` | Drizzle table definitions for devices table | VERIFIED | Contains `devices`, `jobs`, `job_files`, `job_steps`, `recordings` tables with pgEnums; devices has uuid PK, platformEnum, deviceStatusEnum, timestamps |
| `server/utils/dependency-checker.ts` | Startup PATH checks for required binaries | VERIFIED | Exports `checkDependencies`; checks adb, emulator, avdmanager (Android), xcrun simctl (iOS), ffmpeg, maestro; uses `execFile` not `exec`; 10s timeout |
| `server/types/index.ts` | Platform type, DeviceState enum, DeviceInfo, VALID_TRANSITIONS | VERIFIED | All exported; VALID_TRANSITIONS includes `Idle -> Error` for health checker |
| `server/pool/device.ts` | Device class with state machine, transition guards, event emitter | VERIFIED | Exports `Device`; uses `VALID_TRANSITIONS`, emits `stateChange`, mutex-protected `allocate()`; `release()` transitions Cleanup -> Idle |
| `server/pool/types.ts` | Pool types, DeviceDriver interface | VERIFIED | Exports `DeviceDriver`, `BootOptions`, `AndroidDeviceConfig`, `IosDeviceConfig`; DeviceDriver has create/boot/shutdown/isHealthy/cleanup |
| `server/pool/android/emulator.ts` | Android emulator driver | VERIFIED | `AndroidEmulatorDriver implements DeviceDriver`; headless flags; ADB trim; process group kill; telnet snapshot restore with fallback |
| `server/pool/android/avd.ts` | AVD creation and management | VERIFIED | Exports `ensureAvdExists`, `listAvds`; uses `execFile` for avdmanager |
| `server/pool/ios/simulator.ts` | iOS simulator driver | VERIFIED | `IosSimulatorDriver implements DeviceDriver`; already-booted handling; simctl JSON parsing for health; shutdown+erase for cleanup |
| `server/pool/pool-manager.ts` | PoolManager with device registry and FIFO allocation | VERIFIED | Exports `PoolManager`; FIFO via Map insertion order; `allocateMutex`; `getDeviceMap()`/`getDriver()` for health checker |
| `server/pool/process-tracker.ts` | PID tracking, process group kill, orphan reaper | VERIFIED | Exports `ProcessTracker`; register/unregister; `killProcess` sends SIGTERM to `-pid`; `scanOrphans` parses ps output; injectable execFile for testability |
| `server/pool/health-checker.ts` | Periodic health check with exponential backoff | VERIFIED | Exports `HealthChecker`; BACKOFF_DELAYS [5000, 15000, 45000]; fullWipe on 3rd attempt; Running device -> Error immediately; start/stop; Promise.allSettled |
| `server/pool/plugin.ts` | Fastify plugin registering PoolManager on server | VERIFIED | Line 21: `const logger = fastify.log as unknown as pino.Logger` — logger type resolved; line 47: `dependencies: ['config']` — name mismatch fixed; substantive body creates ProcessTracker, PoolManager, HealthChecker, registers drivers, decorates fastify |
| `server/index.ts` | Complete server entry with all plugins wired and graceful shutdown | VERIFIED | Registers configPlugin then poolPlugin in correct order; graceful shutdown (7-step sequence); pool plugin dependency name now matches config plugin registration — server can start |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `server/config/plugin.ts` | `server/config/loader.ts` | imports loadConfig | WIRED | Line 2: `import { loadConfig } from './loader.js'`; line 12: `const config = loadConfig()` |
| `server/index.ts` | `server/config/plugin.ts` | fastify.register(configPlugin) | WIRED | Line 22: `await app.register(configPlugin)` |
| `server/pool/device.ts` | `server/types/index.ts` | imports DeviceState, VALID_TRANSITIONS | WIRED | Line 4: `import { DeviceState, VALID_TRANSITIONS, type Platform, type DeviceInfo } from '../types/index.js'` |
| `server/pool/android/emulator.ts` | `server/pool/types.ts` | implements DeviceDriver | WIRED | `export class AndroidEmulatorDriver implements DeviceDriver` |
| `server/pool/ios/simulator.ts` | `server/pool/types.ts` | implements DeviceDriver | WIRED | `export class IosSimulatorDriver implements DeviceDriver` |
| `server/pool/pool-manager.ts` | `server/pool/device.ts` | manages Device instances | WIRED | `device.allocate(jobId)` and `device.release()` |
| `server/pool/pool-manager.ts` | `server/pool/process-tracker.ts` | registers PIDs, queries orphans | WIRED | `processTracker.register()`, `processTracker.killAll()`, `processTracker.stop()` |
| `server/pool/plugin.ts` | `server/config/plugin.ts` | Fastify plugin dependency declaration | WIRED | Line 47: `dependencies: ['config']` matches config plugin's registered name `'config'` (config/plugin.ts line 14) — Fastify registration assertion will pass |
| `server/pool/plugin.ts` | `server/pool/pool-manager.ts` | PoolManager constructor receives compatible logger type | WIRED | Line 21: `const logger = fastify.log as unknown as pino.Logger` — cast resolves type incompatibility; line 23: `new PoolManager(config, processTracker, logger)` |
| `server/pool/health-checker.ts` | `server/pool/pool-manager.ts` | iterates devices, calls driver.isHealthy | WIRED | `getDeviceMap()`, `getDriver()`, `driver.isHealthy()` |
| `server/pool/health-checker.ts` | `server/pool/device.ts` | transitions device to Error/Offline | WIRED | `device.transition(DeviceState.Error)`, `device.transition(DeviceState.Offline)` |
| `server/index.ts` | `server/pool/plugin.ts` | registers pool plugin | WIRED | `await app.register(poolPlugin)` — will succeed now that plugin dependency name is correct |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| INFRA-01 | 01-01-PLAN.md | Server reads config.yaml with Zod validation (pool, storage, jobs, metadata schema) | SATISFIED | `configSchema` covers all sections; `loadConfig()` validates and formats errors; env override for DATABASE_URL, DEVICE_FARM_PORT, DEVICE_FARM_CONFIG; 7 tests pass |
| INFRA-02 | 01-02-PLAN.md | Pool Manager boots/shuts down Android headless emulators (AVD ARM64) | SATISFIED | `AndroidEmulatorDriver` creates AVD via `avdmanager`, spawns with `-no-window -no-audio -no-boot-anim -gpu swiftshader_indirect`, kills process group; 9 tests pass |
| INFRA-03 | 01-02-PLAN.md | Pool Manager boots/shuts down iOS simulators (xcrun simctl) | SATISFIED | `IosSimulatorDriver` uses `xcrun simctl create/boot/bootstatus/shutdown/erase`; handles already-booted; 10 tests pass |
| INFRA-04 | 01-04-PLAN.md | Periodic health check detects problem emulators and restarts automatically | SATISFIED | `HealthChecker` checks all non-offline devices in parallel every 30s; exponential backoff (5s/15s/45s); 3rd attempt includes full wipe; 4th failure -> Offline; 9 tests pass |
| INFRA-05 | 01-02-PLAN.md | Device state machine (idle -> allocated -> running -> cleanup -> idle) prevents race conditions | SATISFIED | `Device.transition()` validates against `VALID_TRANSITIONS`, throws `InvalidTransitionError`; `allocate()` is mutex-protected; concurrency test verifies no double-allocation |
| INFRA-06 | 01-03-PLAN.md | Automatic device allocation by platform (Android/iOS) with FIFO | SATISFIED | `PoolManager.allocate()` uses pool-level `allocateMutex`, iterates `Map` in insertion order; FIFO test and concurrency test pass |
| INFRA-07 | 01-04-PLAN.md | Device cleanup between jobs (wipe/reset) to prevent state pollution | SATISFIED | `PoolManager.release()` transitions to Cleanup, calls `driver.cleanup()` (snapshot restore for Android, shutdown+erase for iOS), then `device.release()` to Idle; 4 cleanup tests pass |
| INFRA-08 | 01-03-PLAN.md | Process group tracking + reaper to prevent zombie emulator processes | SATISFIED | `ProcessTracker` maps deviceId->pid; `killProcess` sends SIGTERM to `-pid`; `scanOrphans` parses ps output for untracked emulator processes; `reapOrphans()` called at startup; 12 tests pass |

All 8 phase requirements (INFRA-01 through INFRA-08) are satisfied. No orphaned requirements.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| Test files | multiple | `pino.Logger<never, boolean>` vs `pino.Logger<string, boolean>` type mismatch | Warning | 19 TypeScript errors in test files; tests still execute and pass via Vitest (pre-existing, acknowledged in 01-04-SUMMARY) |

No blocker anti-patterns remain. The two blockers from the initial verification have been resolved.

### Human Verification Required

#### 1. Real Android Emulator Boot

**Test:** On a macOS Apple Silicon machine with Android SDK installed, run the server with Android pool enabled and observe actual emulator boot
**Expected:** Emulator starts headless, `adb devices` shows `emulator-5554 device`, GET /api/health returns device in `idle` state
**Why human:** Requires real Android SDK, system images, `avdmanager`, `adb`, and `emulator` binaries — not available in this environment

#### 2. Real iOS Simulator Boot

**Test:** On a macOS machine with Xcode installed, run the server with iOS pool enabled and observe actual simulator boot
**Expected:** `xcrun simctl list` shows simulator as `Booted`, GET /api/health returns iOS device in `idle` state
**Why human:** Requires macOS with Xcode — not available in this environment

#### 3. Full Server Startup (Live Integration)

**Test:** With PostgreSQL running and required binaries in PATH, run `npx tsx server/index.ts` and call GET /api/health
**Expected:** Server starts without errors, responds with `{ status: 'ok', uptime: N, devices: [...] }`
**Why human:** Requires live PostgreSQL, runtime binaries (adb, emulator, xcrun, ffmpeg, maestro) in PATH

---

_Verified: 2026-03-10T08:15:00Z_
_Verifier: Claude (gsd-verifier)_
