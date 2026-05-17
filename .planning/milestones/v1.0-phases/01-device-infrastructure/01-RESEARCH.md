# Phase 1: Device Infrastructure - Research

**Researched:** 2026-03-09
**Domain:** Server scaffold, emulator/simulator lifecycle, process management, config validation
**Confidence:** HIGH

## Summary

Phase 1 establishes the foundational infrastructure for the device farm: a Fastify server that reads and validates a YAML config, boots Android emulators and iOS simulators into a managed pool, tracks their state machine, runs periodic health checks with automatic recovery, and handles graceful shutdown without zombie processes.

The technical domain spans four areas: (1) Fastify server scaffold with plugin architecture, (2) Android emulator and iOS simulator CLI tooling for headless operation on Apple Silicon, (3) process group management to prevent orphan emulator processes, and (4) Zod-based config validation with YAML parsing. All four areas are well-documented with stable, mature tooling. The main risks are around emulator boot timing/reliability and process cleanup edge cases.

**Primary recommendation:** Use Fastify 5 with plugin-per-concern architecture, Zod 4 for config schema, pino for logging, and `child_process.spawn` with `detached: true` + process group kill (`-pid`) for emulator lifecycle management.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Fastify as HTTP framework -- schema-based validation, first-class TypeScript, WebSocket via @fastify/websocket
- Single process: Fastify serves API + WebSocket + SvelteKit frontend (one port, simpler deployment on Mac Mini)
- Flat project structure: server/, client/, cli/ at root level -- no npm workspaces
- device-stream integrated as npm dependency (@device-stream/android, @device-stream/ios-simulator, etc.) -- not git submodule
- Auto-create AVDs/simulators at server startup if they don't exist -- zero manual setup
- Boot all configured devices at startup -- instant allocation when jobs arrive
- Boot detection: `adb wait-for-device` + poll `sys.boot_completed` for Android; `xcrun simctl bootstatus` for iOS
- Cleanup between jobs via snapshot restore for Android (~2-5s vs cold boot); `xcrun simctl erase` for iOS
- Multi-signal health check: process alive + ADB responsive (Android) or simctl status (iOS) -- both must pass
- Health check interval: every 30 seconds, all devices checked in parallel
- On failure: 3 restart attempts with exponential backoff (5s, 15s, 45s) -- third attempt includes full wipe
- After 3 failures: mark device as 'offline', log error, pool continues with remaining devices
- Running job on failed device: fail immediately with infrastructure error message
- Validate dependencies at startup: check emulator, adb, avdmanager, xcrun simctl, ffmpeg, maestro exist in PATH
- Env var overrides: DEVICE_FARM_PORT, DEVICE_FARM_CONFIG, DATABASE_URL -- priority: env > YAML > defaults
- Graceful shutdown on SIGTERM/SIGINT: stop accepting jobs, wait for running jobs (max 5min timeout), cancel remaining, kill emulator processes cleanly, close DB, exit 0
- PostgreSQL + Drizzle ORM for device state persistence

### Claude's Discretion
- Exact Zod schema structure for config validation
- Process group management implementation details (INFRA-08)
- Internal event system for state machine transitions
- Logging framework choice (pino recommended with Fastify)

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| INFRA-01 | Server reads config.yaml with Zod validation (pool, storage, jobs, metadata schema) | YAML parsing with js-yaml + Zod 4 schema validation; env var override pattern; Fastify plugin for config |
| INFRA-02 | Pool Manager boots/shuts down Android emulators headless (AVD ARM64) | avdmanager create + emulator CLI flags for headless ARM64; adb wait-for-device + sys.boot_completed polling; snapshot save/load via emulator console |
| INFRA-03 | Pool Manager boots/shuts down iOS simulators (xcrun simctl) | simctl create/boot/shutdown/erase commands; bootstatus -b for boot detection |
| INFRA-04 | Periodic health check detects problems and auto-restarts | setInterval with parallel checks; ADB shell getprop + simctl list; exponential backoff pattern |
| INFRA-05 | Device state machine (idle->allocated->running->cleanup->idle) prevents race conditions | TypeScript enum states + mutex/lock for allocation; typed EventEmitter for transitions |
| INFRA-06 | Automatic device allocation by platform (Android/iOS) with FIFO | Pool manager filters idle devices by platform; queue with FIFO ordering |
| INFRA-07 | Device cleanup between jobs (wipe/reset) | Android: snapshot restore via emulator console telnet; iOS: xcrun simctl erase |
| INFRA-08 | Process group tracking + reaper to prevent zombie emulator processes | spawn with detached:true + process.kill(-pid); SIGCHLD handling; periodic orphan scan |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| fastify | ^5.8 | HTTP framework | Schema-based validation, first-class TypeScript, built-in pino logger, plugin encapsulation |
| zod | ^4.3 | Config + request schema validation | TypeScript-first, static type inference via z.infer, excellent error messages |
| pino | (bundled with Fastify) | Structured JSON logging | Default Fastify logger, zero-config with Fastify, child loggers per request |
| js-yaml | ^4.1 | YAML config parsing | Mature YAML 1.2 parser, TypeScript types included, 4.1.1 stable for years |
| drizzle-orm | ^0.41 | Database ORM | TypeScript-native schema, zero dependencies, identity columns for PostgreSQL |
| drizzle-kit | (dev) | Migrations | CLI for generating and running SQL migrations from Drizzle schema |
| postgres | latest | PostgreSQL driver | postgres.js -- lightweight, promise-based, works natively with Drizzle |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| fastify-plugin | ^5.0 | Plugin helper | Every Fastify plugin must use this to control encapsulation |
| @fastify/websocket | latest | WebSocket support | Phase 1 scaffold only -- real WS usage in Phase 3 |
| fastify-graceful-shutdown | ^5.0 | Signal handling + shutdown | Handles SIGINT/SIGTERM, calls onClose hooks, exits after timeout |
| pino-pretty | (dev) | Human-readable logs in dev | Development only -- JSON logs in production |
| vitest | latest | Test framework | Fast, native TypeScript, Vite-compatible config |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| js-yaml | yaml (npm) | yaml package is newer with YAML 1.2 full support; js-yaml is more established and referenced in implementation plan |
| fastify-graceful-shutdown | Manual process.on() | Plugin handles edge cases (stuck processes, timeout); manual is simpler but misses cases |
| pino | winston | Pino is Fastify's native logger with zero overhead; winston adds unnecessary abstraction |

**Installation:**
```bash
npm install fastify fastify-plugin zod js-yaml drizzle-orm postgres
npm install -D drizzle-kit vitest pino-pretty @types/js-yaml typescript tsx
```

## Architecture Patterns

### Recommended Project Structure
```
server/
  index.ts                  # Entry point: create Fastify, register plugins, listen
  config/
    schema.ts               # Zod schema definition for config.yaml
    loader.ts               # YAML parse + env var override + Zod validation
    plugin.ts               # Fastify plugin that decorates app with typed config
  pool/
    pool-manager.ts         # Orchestrates device lifecycle, allocation, health
    device.ts               # Device class/interface with state machine
    android/
      emulator.ts           # Android-specific boot/shutdown/health/cleanup
      avd.ts                # AVD creation and management
    ios/
      simulator.ts          # iOS-specific boot/shutdown/health/cleanup
    health-checker.ts       # Periodic health check loop
    process-tracker.ts      # PID tracking, process group management, reaper
    types.ts                # DeviceState enum, DeviceInfo, PoolConfig types
  db/
    schema.ts               # Drizzle table definitions
    index.ts                # DB connection + Drizzle instance
    migrate.ts              # Migration runner
  utils/
    dependency-checker.ts   # Startup PATH checks for required binaries
    logger.ts               # Pino configuration (if customized beyond Fastify default)
  types/
    index.ts                # Shared types, augmented Fastify types
```

### Pattern 1: Fastify Plugin Architecture
**What:** Every concern is a Fastify plugin registered via `fastify.register()`
**When to use:** Always -- this is Fastify's core pattern for composability and testability
**Example:**
```typescript
// server/config/plugin.ts
import fp from 'fastify-plugin';
import { loadConfig, type AppConfig } from './loader.js';

declare module 'fastify' {
  interface FastifyInstance {
    config: AppConfig;
  }
}

export default fp(async (fastify) => {
  const config = loadConfig(); // parse YAML + env overrides + Zod validate
  fastify.decorate('config', config);
}, { name: 'config' });
```

### Pattern 2: Device State Machine
**What:** Explicit state enum with guarded transitions to prevent invalid states and race conditions
**When to use:** All device state changes must go through the state machine
**Example:**
```typescript
// Device states
enum DeviceState {
  Booting = 'booting',
  Idle = 'idle',
  Allocated = 'allocated',
  Running = 'running',
  Cleanup = 'cleanup',
  Error = 'error',
  Offline = 'offline',
}

// Valid transitions
const VALID_TRANSITIONS: Record<DeviceState, DeviceState[]> = {
  [DeviceState.Booting]:   [DeviceState.Idle, DeviceState.Error],
  [DeviceState.Idle]:      [DeviceState.Allocated],
  [DeviceState.Allocated]: [DeviceState.Running],
  [DeviceState.Running]:   [DeviceState.Cleanup, DeviceState.Error],
  [DeviceState.Cleanup]:   [DeviceState.Idle, DeviceState.Error],
  [DeviceState.Error]:     [DeviceState.Booting, DeviceState.Offline],
  [DeviceState.Offline]:   [DeviceState.Booting],
};

function transition(device: Device, newState: DeviceState): void {
  const allowed = VALID_TRANSITIONS[device.state];
  if (!allowed.includes(newState)) {
    throw new Error(`Invalid transition: ${device.state} -> ${newState}`);
  }
  device.state = newState;
  device.emit('stateChange', { from: device.state, to: newState });
}
```

### Pattern 3: Mutex for Device Allocation
**What:** Use a simple in-memory lock (async mutex) to prevent two concurrent requests from allocating the same device
**When to use:** Device allocation (INFRA-05, INFRA-06)
**Example:**
```typescript
// Simple allocation with mutex
class PoolManager {
  private allocationLock = new Mutex(); // or simple Promise-based lock

  async allocate(platform: 'android' | 'ios'): Promise<Device | null> {
    const release = await this.allocationLock.acquire();
    try {
      const device = this.devices.find(
        d => d.platform === platform && d.state === DeviceState.Idle
      );
      if (device) {
        transition(device, DeviceState.Allocated);
      }
      return device ?? null;
    } finally {
      release();
    }
  }
}
```

### Pattern 4: Process Group Spawning
**What:** Spawn emulator processes in their own process group so all child processes can be killed together
**When to use:** Every emulator/simulator process spawn
**Example:**
```typescript
import { spawn, ChildProcess } from 'node:child_process';

function spawnEmulator(avdName: string, port: number): ChildProcess {
  const proc = spawn('emulator', [
    '-avd', avdName,
    '-no-window', '-no-audio', '-no-boot-anim',
    '-gpu', 'swiftshader_indirect',
    '-port', String(port),
  ], {
    detached: true,  // creates new process group
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  return proc;
}

function killProcessGroup(pid: number): void {
  try {
    process.kill(-pid, 'SIGTERM'); // negative PID kills entire group
  } catch (err: any) {
    if (err.code !== 'ESRCH') throw err; // ESRCH = process already gone
  }
}
```

### Anti-Patterns to Avoid
- **Spawning without detached:true:** Without process groups, child processes of the emulator become orphans when the parent is killed
- **Using shell:true for spawn:** Creates an intermediate shell process that complicates PID tracking; always spawn the binary directly
- **Polling without timeout:** Always set a maximum wait time for boot detection loops to avoid hanging forever
- **Storing state only in memory:** Device state should be persisted to DB so crash recovery is possible; use DB as source of truth, memory as cache
- **Blocking the event loop during health checks:** All health checks must be async and run in parallel with Promise.allSettled()

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Graceful shutdown | Manual signal handlers + cleanup orchestration | fastify-graceful-shutdown plugin | Handles stuck processes, timeout, proper hook ordering |
| Async mutex/lock | Promise-based lock from scratch | `async-mutex` npm package | Handles reentrancy, timeouts, error recovery correctly |
| YAML parsing | Custom parser or regex | js-yaml | YAML spec is deceptively complex; edge cases abound |
| Process tree killing | Manual recursive PID walking | Process group kill (-pid) or `tree-kill` npm | Walking /proc is platform-specific and fragile |
| Config validation | Manual if/else checks | Zod schema with z.infer | Type inference, nested validation, error formatting for free |
| Database migrations | Manual SQL scripts | drizzle-kit generate + migrate | Tracks migration state, generates diffs from schema changes |

**Key insight:** Emulator management has many timing-dependent edge cases (boot hangs, process orphaning, race conditions in allocation). The infrastructure libraries listed above handle these edge cases; hand-rolling means discovering each one the hard way.

## Common Pitfalls

### Pitfall 1: ADB Boot Detection Carriage Returns
**What goes wrong:** `adb shell getprop sys.boot_completed` returns `"1\r"` not `"1"` -- string comparison fails, boot loop never exits
**Why it happens:** ADB shell output includes carriage returns from the Android shell
**How to avoid:** Always trim output: `stdout.toString().trim()` or explicit `replace(/\r?\n/g, '')`
**Warning signs:** Emulator boot detection hangs despite emulator being fully booted

### Pitfall 2: Emulator Port Collision
**What goes wrong:** Multiple emulators fight for the same ADB port (default 5554/5555)
**Why it happens:** Not explicitly assigning ports per emulator instance
**How to avoid:** Assign sequential port pairs (5554, 5556, 5558...) per configured device; the emulator uses two consecutive ports (console + adb)
**Warning signs:** ADB lists fewer devices than expected; "address already in use" errors

### Pitfall 3: Simulator "Already Booted" Error
**What goes wrong:** `xcrun simctl boot <UDID>` fails with "Unable to boot device in current state: Booted"
**Why it happens:** Simulator was already booted (e.g., from a previous crash, or macOS kept it alive)
**How to avoid:** Before booting, check status with `xcrun simctl list devices -j`; if already booted, skip boot. Always handle the "already booted" error code gracefully
**Warning signs:** Startup failures on second run of the server

### Pitfall 4: Zombie Emulator Processes After Crash
**What goes wrong:** Server crashes, emulator processes remain running, next startup can't boot emulators on same ports
**Why it happens:** No cleanup ran because the process died unexpectedly
**How to avoid:** On startup, scan for existing emulator processes (by AVD name or port) and kill them. Store PIDs in DB and check on boot. Use the process reaper pattern (INFRA-08)
**Warning signs:** Port conflicts at startup; `ps aux | grep emulator` shows orphans

### Pitfall 5: Snapshot Save Timing
**What goes wrong:** Snapshot is saved before emulator is fully ready, restoring it boots into an incomplete state
**Why it happens:** Saving snapshot too early in boot process (before sys.boot_completed=1 and before launcher is ready)
**How to avoid:** Wait for `sys.boot_completed` AND a few seconds settle time before saving the clean snapshot. Consider also checking `init.svc.bootanim` = `stopped`
**Warning signs:** Snapshot restore boots into a hung state

### Pitfall 6: Concurrent Allocation Race Condition
**What goes wrong:** Two job requests arrive simultaneously, both get allocated the same idle device
**Why it happens:** No synchronization on the allocation path
**How to avoid:** Use async mutex around the allocation logic. Device state transitions must be atomic
**Warning signs:** Two jobs report the same device ID; one job fails with "device busy"

## Code Examples

### Config Loading with Zod
```typescript
// server/config/schema.ts
import { z } from 'zod';

export const configSchema = z.object({
  server: z.object({
    port: z.number().int().min(1).max(65535).default(3000),
    host: z.string().default('0.0.0.0'),
  }).default({}),

  pool: z.object({
    max_devices: z.number().int().min(1).max(20).default(10),
    android: z.object({
      enabled: z.boolean().default(true),
      max_instances: z.number().int().min(0).default(5),
      headless: z.boolean().default(true),
      api_level: z.number().int().default(34),
      device_profile: z.string().default('pixel_7'),
      ram_mb: z.number().int().default(2048),
    }).default({}),
    ios: z.object({
      enabled: z.boolean().default(true),
      max_instances: z.number().int().min(0).default(5),
      runtime: z.string().default('iOS-17-5'),
      device_type: z.string().default('iPhone-15'),
    }).default({}),
  }),

  storage: z.object({
    recordings: z.object({
      path: z.string().default('./recordings'),
      retention_days: z.number().int().default(30),
      compress_after_days: z.number().int().default(7),
      format: z.literal('mp4').default('mp4'),
      max_storage_gb: z.number().default(50),
    }).default({}),
    logs: z.object({
      retention_days: z.number().int().default(90),
      path: z.string().default('./logs'),
    }).default({}),
  }).default({}),

  jobs: z.object({
    timeout_minutes: z.number().int().default(30),
    max_queue_size: z.number().int().default(100),
    cleanup_completed_after_days: z.number().int().default(7),
  }).default({}),

  job_metadata_schema: z.object({
    required: z.array(z.string()).default([]),
    optional: z.array(z.object({
      name: z.string(),
      type: z.string(),
    })).default([]),
  }).default({}),
});

export type AppConfig = z.infer<typeof configSchema>;
```

### Config Loader with Env Overrides
```typescript
// server/config/loader.ts
import fs from 'node:fs';
import yaml from 'js-yaml';
import { configSchema, type AppConfig } from './schema.js';

export function loadConfig(configPath?: string): AppConfig {
  const filePath = process.env.DEVICE_FARM_CONFIG ?? configPath ?? './config.yaml';

  let raw: Record<string, unknown> = {};
  if (fs.existsSync(filePath)) {
    const content = fs.readFileSync(filePath, 'utf-8');
    raw = yaml.load(content) as Record<string, unknown>;
  }

  // Env var overrides (shallow, for top-level settings only)
  if (process.env.DEVICE_FARM_PORT) {
    raw.server = { ...(raw.server as any), port: Number(process.env.DEVICE_FARM_PORT) };
  }
  if (process.env.DATABASE_URL) {
    (raw as any).database_url = process.env.DATABASE_URL;
  }

  const result = configSchema.safeParse(raw);
  if (!result.success) {
    const formatted = result.error.issues
      .map(i => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid configuration:\n${formatted}`);
  }

  return result.data;
}
```

### Android Boot Detection
```typescript
// server/pool/android/emulator.ts
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

async function waitForBoot(serial: string, timeoutMs = 120_000): Promise<void> {
  const start = Date.now();

  // Step 1: wait-for-device (ADB daemon ready)
  await execFileAsync('adb', ['-s', serial, 'wait-for-device'], {
    timeout: timeoutMs,
  });

  // Step 2: poll sys.boot_completed
  while (Date.now() - start < timeoutMs) {
    try {
      const { stdout } = await execFileAsync('adb', [
        '-s', serial, 'shell', 'getprop', 'sys.boot_completed',
      ]);
      if (stdout.trim() === '1') return;
    } catch {
      // ADB not ready yet, retry
    }
    await new Promise(r => setTimeout(r, 2000));
  }

  throw new Error(`Emulator ${serial} boot timed out after ${timeoutMs}ms`);
}
```

### iOS Simulator Boot
```typescript
// server/pool/ios/simulator.ts
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

async function createSimulator(name: string, deviceType: string, runtime: string): Promise<string> {
  const { stdout } = await execFileAsync('xcrun', [
    'simctl', 'create', name, deviceType, runtime,
  ]);
  return stdout.trim(); // returns UDID
}

async function bootSimulator(udid: string): Promise<void> {
  try {
    await execFileAsync('xcrun', ['simctl', 'boot', udid]);
  } catch (err: any) {
    // "Unable to boot device in current state: Booted" is OK
    if (!err.stderr?.includes('Booted')) throw err;
  }
  // Wait for boot to finish
  await execFileAsync('xcrun', ['simctl', 'bootstatus', udid, '-b'], {
    timeout: 120_000,
  });
}

async function eraseSimulator(udid: string): Promise<void> {
  await execFileAsync('xcrun', ['simctl', 'shutdown', udid]).catch(() => {});
  await execFileAsync('xcrun', ['simctl', 'erase', udid]);
}
```

### Dependency Checker
```typescript
// server/utils/dependency-checker.ts
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

interface Dependency {
  name: string;
  command: string;
  args: string[];
  installHint: string;
  requiredWhen?: 'android' | 'ios';
}

const DEPENDENCIES: Dependency[] = [
  { name: 'adb', command: 'adb', args: ['version'], installHint: 'Install Android SDK Platform-Tools', requiredWhen: 'android' },
  { name: 'emulator', command: 'emulator', args: ['-version'], installHint: 'Install Android SDK Emulator package', requiredWhen: 'android' },
  { name: 'avdmanager', command: 'avdmanager', args: ['list', 'target'], installHint: 'Install Android SDK Command-line Tools', requiredWhen: 'android' },
  { name: 'xcrun simctl', command: 'xcrun', args: ['simctl', 'help'], installHint: 'Install Xcode Command Line Tools', requiredWhen: 'ios' },
  { name: 'ffmpeg', command: 'ffmpeg', args: ['-version'], installHint: 'brew install ffmpeg' },
  { name: 'maestro', command: 'maestro', args: ['--version'], installHint: 'curl -Ls "https://get.maestro.mobile.dev" | bash' },
];

export async function checkDependencies(config: { android: { enabled: boolean }, ios: { enabled: boolean } }): Promise<void> {
  const errors: string[] = [];

  for (const dep of DEPENDENCIES) {
    if (dep.requiredWhen === 'android' && !config.android.enabled) continue;
    if (dep.requiredWhen === 'ios' && !config.ios.enabled) continue;

    try {
      await execFileAsync(dep.command, dep.args, { timeout: 10_000 });
    } catch {
      errors.push(`Missing: ${dep.name} -- ${dep.installHint}`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Required dependencies not found:\n${errors.join('\n')}`);
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Fastify v4 | Fastify v5 | 2024 | New TypeScript generics, updated plugin API, ESM-first |
| Zod v3 | Zod v4 | 2025 | Faster parsing, smaller bundle, better error formatting |
| serial columns (PostgreSQL) | identity columns | Drizzle 0.40+ | Drizzle recommends identity over serial for PostgreSQL |
| x86 emulators | ARM64 native | Android SDK 31+ | Apple Silicon runs ARM64 emulators natively, no translation layer |
| Manual snapshot via emulator console | `-snapshot` flag or emulator console telnet | Always available | Telnet to localhost:PORT for `avd snapshot save/load` commands |

**Deprecated/outdated:**
- `serial` type in PostgreSQL: Use `identity` columns with Drizzle. Serial still works but identity is the modern standard
- Zod v3 API: v4 has breaking changes. Use v4 patterns (release notes at zod.dev/v4)

## Open Questions

1. **Android Snapshot via Emulator Console**
   - What we know: The emulator console (telnet to the console port) supports `avd snapshot save <name>` and `avd snapshot load <name>`. The `-snapshot` CLI flag also handles auto-save/load.
   - What's unclear: The exact reliability of programmatic snapshot restore via telnet from Node.js (vs. CLI flags). Need to verify the auth token requirement for console access.
   - Recommendation: Implement snapshot save/load via emulator console telnet. Fall back to full emulator restart if snapshot restore fails. Test during implementation.

2. **Emulator GPU Mode on Headless Mac Mini**
   - What we know: `swiftshader_indirect` is the standard headless GPU mode. Apple Silicon Macs may also support `host` GPU in headless mode via Metal.
   - What's unclear: Whether `host` GPU works reliably in headless mode on macOS without a display.
   - Recommendation: Default to `swiftshader_indirect` (always works). Make GPU mode configurable for experimentation.

3. **async-mutex vs Simple Lock**
   - What we know: async-mutex is a well-maintained npm package. A simple Promise-based lock is ~20 lines of code.
   - What's unclear: Whether the extra features of async-mutex (timeouts, try-acquire) are needed.
   - Recommendation: Use `async-mutex` -- it is small (4KB), handles edge cases, and the timeout feature is useful for deadlock prevention.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (latest) |
| Config file | vitest.config.ts -- see Wave 0 |
| Quick run command | `npx vitest run --reporter=verbose` |
| Full suite command | `npx vitest run` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| INFRA-01 | Config YAML parsing + Zod validation + env overrides | unit | `npx vitest run server/config/__tests__/loader.test.ts -x` | Wave 0 |
| INFRA-02 | Android emulator boot/shutdown headless | integration | `npx vitest run server/pool/android/__tests__/emulator.test.ts -x` | Wave 0 |
| INFRA-03 | iOS simulator boot/shutdown | integration | `npx vitest run server/pool/ios/__tests__/simulator.test.ts -x` | Wave 0 |
| INFRA-04 | Health check detection + auto-restart | unit | `npx vitest run server/pool/__tests__/health-checker.test.ts -x` | Wave 0 |
| INFRA-05 | State machine transitions + invalid transition rejection | unit | `npx vitest run server/pool/__tests__/device-state.test.ts -x` | Wave 0 |
| INFRA-06 | FIFO allocation by platform + no double-allocation | unit | `npx vitest run server/pool/__tests__/allocation.test.ts -x` | Wave 0 |
| INFRA-07 | Cleanup (snapshot restore / simctl erase) | integration | `npx vitest run server/pool/__tests__/cleanup.test.ts -x` | Wave 0 |
| INFRA-08 | Process group tracking + orphan reaper | unit | `npx vitest run server/pool/__tests__/process-tracker.test.ts -x` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run --reporter=verbose`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `vitest.config.ts` -- Vitest configuration (TypeScript, path aliases)
- [ ] `tsconfig.json` -- TypeScript configuration (ESM, strict, paths)
- [ ] `package.json` -- Project manifest with dependencies
- [ ] `server/config/__tests__/loader.test.ts` -- Config loading + validation tests
- [ ] `server/pool/__tests__/device-state.test.ts` -- State machine unit tests
- [ ] `server/pool/__tests__/allocation.test.ts` -- Allocation mutex + FIFO tests
- [ ] `server/pool/__tests__/health-checker.test.ts` -- Health check logic tests
- [ ] `server/pool/__tests__/process-tracker.test.ts` -- Process tracking tests
- [ ] `server/pool/android/__tests__/emulator.test.ts` -- Android emulator integration tests (mock execFile)
- [ ] `server/pool/ios/__tests__/simulator.test.ts` -- iOS simulator integration tests (mock execFile)
- [ ] `server/pool/__tests__/cleanup.test.ts` -- Cleanup logic tests (mock execFile)
- [ ] Framework install: `npm install -D vitest` -- if none detected

## Sources

### Primary (HIGH confidence)
- [Android Developers - avdmanager](https://developer.android.com/tools/avdmanager) -- AVD creation commands
- [Android Developers - emulator command line](https://developer.android.com/studio/run/emulator-commandline) -- Headless flags, snapshot options
- [Android Developers - emulator snapshots](https://developer.android.com/studio/run/emulator-snapshots) -- Snapshot save/load behavior
- [Android Developers - emulator console](https://developer.android.com/studio/run/emulator-console) -- Telnet console commands
- [Node.js child_process docs](https://nodejs.org/api/child_process.html) -- spawn, detached, process groups
- [Fastify official docs](https://fastify.dev/docs/latest/Reference/TypeScript/) -- TypeScript, plugins, type providers
- [Fastify plugins docs](https://fastify.dev/docs/latest/Reference/Plugins/) -- Plugin encapsulation, DAG
- [Zod official docs](https://zod.dev/) -- Schema API, safeParse, error customization
- [Drizzle ORM PostgreSQL](https://orm.drizzle.team/docs/get-started-postgresql) -- Setup, schema, migrations
- [Vitest official docs](https://vitest.dev/guide/) -- Setup, configuration

### Secondary (MEDIUM confidence)
- [fastify-graceful-shutdown npm](https://www.npmjs.com/package/fastify-graceful-shutdown) -- v5.0 for Fastify 5
- [iOS simctl reference](https://www.iosdev.recipes/simctl/) -- simctl commands catalog
- [Better Stack pino guide](https://betterstack.com/community/guides/logging/how-to-install-setup-and-use-pino-to-log-node-js-applications/) -- Pino configuration
- [GitHub - android-emulator-container-scripts](https://github.com/google/android-emulator-container-scripts) -- Google's wait-for-emulator pattern

### Tertiary (LOW confidence)
- [Medium - killing process families](https://medium.com/@almenon214/killing-processes-with-node-772ffdd19aad) -- Process group kill pattern (verified against Node.js docs)
- [Gist - simctl headless](https://gist.github.com/leviathan/0c806022cd83d0a51a15c92b6b53db49) -- simctl cheat sheet
- [Gist - ARM64 emulator on EC2](https://gist.github.com/atyachin/2f7c6054c4cd6945397165a23623987d) -- Headless ARM64 patterns

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- All libraries are well-established, widely used, with current documentation
- Architecture: HIGH -- Fastify plugin pattern, state machine, process groups are well-documented patterns
- Pitfalls: HIGH -- Based on official docs + multiple verified community sources confirming common issues
- Emulator snapshots: MEDIUM -- Telnet console approach needs implementation-time validation
- GPU mode on headless Mac: LOW -- No authoritative source for Metal GPU in headless macOS

**Research date:** 2026-03-09
**Valid until:** 2026-04-09 (stable domain, 30-day validity)
