# Phase 12: Device Management - Research

**Researched:** 2026-04-15
**Domain:** Device lifecycle management (Android emulators + iOS simulators) via @device-stream packages
**Confidence:** HIGH

## Summary

This phase replaces the existing hand-rolled `AndroidEmulatorDriver` and `IosSimulatorDriver` with new driver implementations that wrap `@device-stream/android` and `@device-stream/ios-simulator` packages. The existing `PoolManager`, `Device` class, state machine, and mutex-protected allocation layer remain unchanged -- only the `DeviceDriver` implementations are swapped.

**Critical finding:** `@device-stream/android` (AndroidDeviceService) handles ADB communication via TangoADB but does NOT manage emulator process lifecycle (AVD creation, `emulator` binary spawning, port allocation). The new Android driver must retain the existing `avd.ts` utilities and `emulator` process spawning logic from the current `AndroidEmulatorDriver`, while using `AndroidDeviceService` for health checks (via TangoADB `getprop`) and cleanup operations. In contrast, `@device-stream/ios-simulator` (IOSSimulatorManager) provides complete simulator lifecycle management (create, boot, shutdown, delete) via `appium-ios-simulator` and can fully replace the current `IosSimulatorDriver`.

**Primary recommendation:** Create two new DeviceDriver implementations: `DeviceStreamAndroidDriver` (hybrid: existing emulator spawning + device-stream TangoADB health checks) and `DeviceStreamIosDriver` (pure wrapper around IOSSimulatorManager). Register them in `server/pool/plugin.ts` replacing the old drivers. Adapt `HealthChecker` to use device-stream health capabilities.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| DEV-01 | Server uses @device-stream/android for boot/shutdown of Android emulators | Android driver wraps existing emulator spawning + uses AndroidDeviceService for ADB health checks; see Architecture Pattern 1 |
| DEV-02 | Server uses @device-stream/ios-simulator for boot/shutdown of iOS simulators | IOSSimulatorManager provides full lifecycle (createDevice, startDevice, stopDevice, deleteDevice); see Architecture Pattern 2 |
| DEV-03 | Device allocation maintains mutex-protected assignment per job | PoolManager.allocate() with async-mutex is unchanged; new drivers are drop-in replacements via DeviceDriver interface |
| DEV-04 | Health check periodico via device-stream (replacing current health checker) | AndroidDeviceService.listDevices()/connect() for Android health; IOSSimulatorManager.getDevice().status for iOS; HealthChecker calls new driver.isHealthy() |
| DEV-05 | Auto-restart of failed devices via device-stream lifecycle | HealthChecker.replaceDevice() + HealthChecker.restartDevice() already handle restart; new drivers provide the boot/shutdown underneath |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @device-stream/core | 1.1.0 | Shared types (FarmDevice, DeviceStatus, CreateDeviceOptions) | Foundation for device-stream ecosystem |
| @device-stream/android | 1.1.0 | TangoADB-based Android device communication | Health checks via ADB shell, screenshot, device listing |
| @device-stream/ios-simulator | 1.1.0 | Full iOS simulator lifecycle management | Wraps appium-ios-simulator with complete create/boot/stop/delete API |
| appium-ios-simulator | ^6.1.0 | Transitive dep of @device-stream/ios-simulator | Robust simulator management used by Appium ecosystem |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @yume-chan/adb | 2.5.1 | TangoADB client (transitive dep) | Used internally by AndroidDeviceService |
| async-mutex | existing | Mutex for device allocation | Already in project -- PoolManager uses it |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| AndroidDeviceService for health | adb CLI (current approach) | TangoADB is in-process, no fork overhead, but adds dependency chain |
| IOSSimulatorManager | xcrun simctl (current approach) | IOSSimulatorManager wraps simctl + appium-ios-simulator with headless boot, better error handling |

**Installation:**
```bash
# Packages are published to GitHub Packages (@device-stream scope)
# Need .npmrc with @device-stream:registry=https://npm.pkg.github.com

# Create .npmrc if not exists
echo '@device-stream:registry=https://npm.pkg.github.com' >> .npmrc

npm install @device-stream/core@^1.1.0 @device-stream/android@^1.1.0 @device-stream/ios-simulator@^1.1.0
```

## Architecture Patterns

### Recommended Project Structure
```
server/pool/
  types.ts                          # DeviceDriver interface (UNCHANGED)
  device.ts                         # Device class + state machine (UNCHANGED)
  pool-manager.ts                   # PoolManager allocation layer (UNCHANGED)
  health-checker.ts                 # HealthChecker (ADAPTED to use new drivers)
  process-tracker.ts                # ProcessTracker (KEPT for Android emulator PIDs)
  zombie-detector.ts                # Zombie detection (KEPT for Android)
  plugin.ts                         # Registration point (MODIFIED: new driver imports)
  android/
    emulator.ts                     # OLD driver (REPLACED by device-stream-driver.ts)
    device-stream-driver.ts         # NEW: DeviceStreamAndroidDriver
    avd.ts                          # AVD utilities (KEPT -- device-stream has no AVD mgmt)
  ios/
    simulator.ts                    # OLD driver (REPLACED by device-stream-driver.ts)
    device-stream-driver.ts         # NEW: DeviceStreamIosDriver
```

### Pattern 1: Hybrid Android Driver (emulator spawning + device-stream health)
**What:** The new `DeviceStreamAndroidDriver` retains the existing emulator process spawning logic (AVD create, `emulator` binary spawn, port allocation, zombie detection) but uses `AndroidDeviceService` from `@device-stream/android` for health checks and ADB operations.
**When to use:** Android emulators -- because `@device-stream/android` has no emulator lifecycle management.
**Why hybrid:** AndroidDeviceService operates via TangoADB against an already-running ADB server. It can `listDevices()`, `connect()`, run shell commands, take screenshots -- but it cannot create AVDs, spawn emulator processes, or manage ports. Those responsibilities stay with the existing code.

```typescript
import { AndroidDeviceService } from '@device-stream/android';
import type { DeviceDriver, DeviceConfig, AndroidDeviceConfig, BootResult } from '../types.js';
import { ensureAvdExists } from './avd.js';

export class DeviceStreamAndroidDriver implements DeviceDriver {
  private readonly deviceService: AndroidDeviceService;
  // Retain existing process management from old AndroidEmulatorDriver
  private processes = new Map<string, { pid: number; port: number }>();
  private blacklistedPorts = new Set<number>();

  constructor(config: AndroidDeviceConfig, logger: pino.Logger) {
    this.deviceService = new AndroidDeviceService();
    // ... same config/logger setup as current driver
  }

  async create(name: string, config: DeviceConfig): Promise<string> {
    // SAME as current: ensureAvdExists()
    await ensureAvdExists(name, config as AndroidDeviceConfig);
    return name;
  }

  async boot(emulatorId: string): Promise<BootResult> {
    // SAME as current: spawn emulator process, wait for boot
    // Can optionally use deviceService.connect() after boot for richer health data
  }

  async isHealthy(emulatorId: string, port?: number): Promise<boolean> {
    // NEW: Use device-stream TangoADB instead of adb CLI fork
    const serial = `emulator-${port}`;
    try {
      await this.deviceService.connect(serial);
      const devices = await this.deviceService.listDevices();
      const device = devices.find(d => d.serial === serial);
      return device?.connected === true;
    } catch {
      return false;
    }
  }

  async shutdown(emulatorId: string): Promise<void> {
    // Disconnect device-stream first, then SAME process kill logic
    const serial = `emulator-${this.processes.get(emulatorId)?.port}`;
    try { await this.deviceService.disconnect(serial); } catch {}
    // ... existing SIGTERM/SIGKILL/zombie detection
  }

  async cleanup(emulatorId: string): Promise<void> {
    // SAME as current: snapshot restore via telnet
  }
}
```

### Pattern 2: Pure iOS Driver (full device-stream wrapper)
**What:** The new `DeviceStreamIosDriver` wraps `IOSSimulatorManager` entirely, delegating all lifecycle operations.
**When to use:** iOS simulators -- because IOSSimulatorManager provides complete lifecycle.

```typescript
import { IOSSimulatorManager } from '@device-stream/ios-simulator';
import type { DeviceDriver, DeviceConfig, IosDeviceConfig, BootResult } from '../types.js';

export class DeviceStreamIosDriver implements DeviceDriver {
  private readonly manager: IOSSimulatorManager;
  // Map device-farm names to device-stream FarmDevice IDs
  private deviceIds = new Map<string, string>();

  constructor() {
    this.manager = new IOSSimulatorManager({ bootTimeout: 120_000 });
  }

  async create(name: string, config: DeviceConfig): Promise<string> {
    const iosConfig = config as IosDeviceConfig;
    const device = await this.manager.createDevice({
      platform: 'ios',
      name,
      deviceType: `com.apple.CoreSimulator.SimDeviceType.${iosConfig.device_type}`,
      osVersion: `com.apple.CoreSimulator.SimRuntime.${iosConfig.runtime}`,
    });
    this.deviceIds.set(name, device.id);
    return device.id; // UDID
  }

  async boot(emulatorId: string): Promise<BootResult> {
    await this.manager.startDevice(emulatorId);
    return { port: 0, pid: 0 }; // iOS uses UDID, not port/PID
  }

  async shutdown(emulatorId: string): Promise<void> {
    await this.manager.stopDevice(emulatorId);
  }

  async isHealthy(emulatorId: string): Promise<boolean> {
    const device = this.manager.getDevice(emulatorId);
    return device?.status === 'ready';
  }

  async cleanup(emulatorId: string): Promise<void> {
    // Stop + erase (IOSSimulatorManager handles stop internally in deleteDevice)
    await this.manager.stopDevice(emulatorId);
    // For between-job cleanup, use simctl erase (lighter than delete+recreate)
    // Or just stop -> boot cycle
  }
}
```

### Pattern 3: Plugin Registration (swap drivers)
**What:** Modify `server/pool/plugin.ts` to import and register the new drivers.

```typescript
// BEFORE (old):
import { AndroidEmulatorDriver } from './android/emulator.js';
import { IosSimulatorDriver } from './ios/simulator.js';

// AFTER (new):
import { DeviceStreamAndroidDriver } from './android/device-stream-driver.js';
import { DeviceStreamIosDriver } from './ios/device-stream-driver.js';

// Registration:
if (config.pool.android.enabled) {
  pool.registerDriver('android', new DeviceStreamAndroidDriver(config.pool.android, logger));
}
if (config.pool.ios.enabled) {
  pool.registerDriver('ios', new DeviceStreamIosDriver());
}
```

### Anti-Patterns to Avoid
- **Modifying PoolManager internals:** The PoolManager, Device class, and allocation mutex are well-tested and stable. Do NOT change them. Only swap the DeviceDriver implementations.
- **Removing emulator process management for Android:** AndroidDeviceService has no emulator lifecycle -- do not try to use it for boot/shutdown of emulator processes.
- **Using IOSSimulatorManager singleton state for health checks:** IOSSimulatorManager maintains its own `devices` Map. Make sure it stays synchronized with the device-farm's PoolManager by populating it during create/boot.
- **Importing AndroidDeviceService singleton:** The exported `androidDeviceService` is a singleton. For device-farm, create a new instance per driver to avoid shared state issues.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| iOS simulator create/boot/shutdown | xcrun simctl calls | IOSSimulatorManager | Handles headless mode, boot timeout, already-booted detection, appium-ios-simulator integration |
| ADB health checks | execFile('adb', ...) | AndroidDeviceService.connect() + listDevices() | TangoADB is in-process, no fork overhead, handles transport management |
| iOS simulator app install | xcrun simctl install | IOSSimulatorManager.installApp() | Handles bundle ID extraction, PlistBuddy fallback |
| AVD creation | avdmanager CLI | Keep existing avd.ts | device-stream has no AVD management -- this is the one place hand-rolling is correct |

**Key insight:** The Android driver is necessarily hybrid because device-stream was designed for communicating with already-running devices, not spawning emulators. The iOS driver can be pure because IOSSimulatorManager wraps the full simctl lifecycle.

## Common Pitfalls

### Pitfall 1: GitHub Packages Authentication
**What goes wrong:** `npm install @device-stream/*` fails with 404 or 401
**Why it happens:** @device-stream packages are published to GitHub Packages, not npmjs.org. Requires `.npmrc` with registry config and `GITHUB_TOKEN`.
**How to avoid:** Create `.npmrc` in project root with `@device-stream:registry=https://npm.pkg.github.com` and ensure `GITHUB_TOKEN` env var is set.
**Warning signs:** `npm ERR! 404 Not Found` or `npm ERR! code E401`

### Pitfall 2: IOSSimulatorManager Internal State Desync
**What goes wrong:** IOSSimulatorManager.getDevice() returns undefined even though the simulator is booted.
**Why it happens:** IOSSimulatorManager maintains its own `devices` Map. If the simulator was created externally (e.g., already existed), the manager won't know about it unless `createDevice()` was called (which does check for existing simulators by name).
**How to avoid:** Always go through IOSSimulatorManager.createDevice() during pool init -- it handles the "already exists" case gracefully by returning the existing device.
**Warning signs:** `isHealthy()` always returning false for iOS devices.

### Pitfall 3: AndroidDeviceService Requires Running ADB Server
**What goes wrong:** AndroidDeviceService constructor creates TangoADB client connecting to 127.0.0.1:5037. If ADB server is not running, all operations fail.
**Why it happens:** TangoADB connects to the standard ADB server port. The current driver implicitly starts ADB via `adb wait-for-device`.
**How to avoid:** Ensure `adb start-server` is called before initializing the AndroidDeviceService, or handle connection errors gracefully in isHealthy().
**Warning signs:** Connection refused on port 5037.

### Pitfall 4: iOS Cleanup -- Erase vs Delete
**What goes wrong:** Using deleteDevice() for between-job cleanup destroys the simulator entirely, requiring full re-creation (slow, ~30s).
**Why it happens:** Confusion between "cleanup between jobs" (should be fast) and "destroy device" (teardown).
**How to avoid:** For cleanup, use `xcrun simctl erase <udid>` (via execFile) or just stop+boot cycle. Reserve deleteDevice() for full pool shutdown only.
**Warning signs:** Very slow job turnaround times on iOS.

### Pitfall 5: BootResult Contract for iOS
**What goes wrong:** The DeviceDriver.boot() interface returns `{ port: number; pid: number }`. iOS simulators don't have ports or PIDs in the same way.
**Why it happens:** Interface was designed primarily for Android emulators.
**How to avoid:** Return `{ port: 0, pid: 0 }` for iOS (current approach). The PoolManager and HealthChecker must handle `port === 0` / `pid === 0` gracefully -- they already do for the current IosSimulatorDriver.
**Warning signs:** ProcessTracker trying to kill PID 0.

## Code Examples

### IOSSimulatorManager Lifecycle (verified from source)
```typescript
// Source: /Users/heicg/Desktop/projects/device-stream/packages/ios-simulator/src/simulator-manager.ts

const manager = new IOSSimulatorManager({ bootTimeout: 120_000 });

// Create (handles "already exists" case)
const device = await manager.createDevice({
  platform: 'ios',
  name: 'ios-1',
  deviceType: 'com.apple.CoreSimulator.SimDeviceType.iPhone-15',
  osVersion: 'com.apple.CoreSimulator.SimRuntime.iOS-17-5',
});
// device.id === UDID, device.status === 'stopped'

// Boot (headless, uses appium-ios-simulator)
await manager.startDevice(device.id);
// device.status === 'ready'

// Health check
const d = manager.getDevice(device.id);
const isHealthy = d?.status === 'ready';

// Shutdown
await manager.stopDevice(device.id);

// Full cleanup (delete)
await manager.deleteDevice(device.id);
```

### AndroidDeviceService Health Check (verified from source)
```typescript
// Source: /Users/heicg/Desktop/projects/device-stream/packages/android/src/device-service.ts

const service = new AndroidDeviceService();
// Connects to ADB server at 127.0.0.1:5037

// Check device health via TangoADB
await service.connect('emulator-5554');
const devices = await service.listDevices();
const emulator = devices.find(d => d.serial === 'emulator-5554');
const isHealthy = emulator?.connected === true;

// Can also check properties directly
// service internally uses: adb.subprocess.noneProtocol.spawnWaitText('getprop sys.boot_completed')
```

### DeviceDriver Interface (existing, unchanged)
```typescript
// Source: server/pool/types.ts
export interface DeviceDriver {
  create(name: string, config: DeviceConfig): Promise<string>;
  boot(emulatorId: string, options?: BootOptions): Promise<BootResult>;
  shutdown(emulatorId: string): Promise<void>;
  isHealthy(emulatorId: string, port?: number): Promise<boolean>;
  cleanup(emulatorId: string): Promise<void>;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| adb CLI for health | TangoADB in-process | device-stream 1.0 | No fork overhead, faster health checks |
| xcrun simctl raw | appium-ios-simulator | device-stream 1.0 | Better headless support, boot wait, error handling |
| Custom process tracking | Retained (Android only) | N/A | Still needed -- device-stream has no emulator process spawning |

**Deprecated/outdated:**
- None -- device-stream 1.1.0 is the latest version (local monorepo at /Users/heicg/Desktop/projects/device-stream/)

## Open Questions

1. **iOS Cleanup Strategy**
   - What we know: IOSSimulatorManager has stopDevice() and deleteDevice(). Between jobs, we need fast cleanup.
   - What's unclear: Whether `stopDevice()` + `startDevice()` is sufficient cleanup, or if `xcrun simctl erase` is needed for clean state.
   - Recommendation: Use `xcrun simctl erase <udid>` (direct call) for cleanup, same as current driver. IOSSimulatorManager.stopDevice() before erase if device is booted.

2. **Android Health Check Method**
   - What we know: AndroidDeviceService can connect() and listDevices() via TangoADB.
   - What's unclear: Whether listDevices() alone is sufficient to confirm emulator health, or if we should also check `sys.boot_completed` via TangoADB shell.
   - Recommendation: Use both -- listDevices() for quick check, then connect() + shell getprop for deep health check. Can start simple and enhance.

3. **GitHub Packages Token for CI/CD**
   - What we know: @device-stream packages require GitHub Packages auth.
   - What's unclear: Whether GITHUB_TOKEN is available in CI environment.
   - Recommendation: Document .npmrc setup in phase plan. For local dev, the token should already be configured (same developer owns both repos).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (latest, in project) |
| Config file | vitest.config.ts (project root) |
| Quick run command | `npx vitest run server/pool/__tests__/ --reporter=verbose` |
| Full suite command | `npm test` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DEV-01 | Android driver creates/boots/shuts down via device-stream | unit (mock AndroidDeviceService) | `npx vitest run server/pool/android/__tests__/device-stream-driver.test.ts -x` | Wave 0 |
| DEV-02 | iOS driver creates/boots/shuts down via device-stream | unit (mock IOSSimulatorManager) | `npx vitest run server/pool/ios/__tests__/device-stream-driver.test.ts -x` | Wave 0 |
| DEV-03 | Mutex allocation unchanged with new drivers | unit | `npx vitest run server/pool/__tests__/allocation.test.ts -x` | Exists (verify still passes) |
| DEV-04 | Health checker uses new driver.isHealthy() | unit (mock drivers) | `npx vitest run server/pool/__tests__/health-checker.test.ts -x` | Exists (may need updates) |
| DEV-05 | Auto-restart via HealthChecker + new drivers | unit | `npx vitest run server/pool/__tests__/health-checker.test.ts -x` | Exists (verify restart flow) |

### Sampling Rate
- **Per task commit:** `npx vitest run server/pool/ --reporter=verbose`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before /gsd:verify-work

### Wave 0 Gaps
- [ ] `server/pool/android/__tests__/device-stream-driver.test.ts` -- covers DEV-01 (mock AndroidDeviceService, test create/boot/shutdown/isHealthy/cleanup)
- [ ] `server/pool/ios/__tests__/device-stream-driver.test.ts` -- covers DEV-02 (mock IOSSimulatorManager, test full lifecycle)
- [ ] Verify existing `allocation.test.ts` and `health-checker.test.ts` pass with new drivers (mock interface unchanged)

## Sources

### Primary (HIGH confidence)
- Local source: `/Users/heicg/Desktop/projects/device-stream/packages/android/src/device-service.ts` -- AndroidDeviceService API, no emulator lifecycle
- Local source: `/Users/heicg/Desktop/projects/device-stream/packages/ios-simulator/src/simulator-manager.ts` -- IOSSimulatorManager full lifecycle API
- Local source: `/Users/heicg/Desktop/projects/device-stream/packages/core/src/types.ts` -- FarmDevice, DeviceStatus, CreateDeviceOptions types
- Local source: `/Users/heicg/Desktop/projects/device-farm/server/pool/types.ts` -- DeviceDriver interface contract
- Local source: `/Users/heicg/Desktop/projects/device-farm/server/pool/pool-manager.ts` -- PoolManager allocation, initPool, replaceDevice
- Local source: `/Users/heicg/Desktop/projects/device-farm/server/pool/health-checker.ts` -- HealthChecker with backoff, zombie handling

### Secondary (MEDIUM confidence)
- Local source: `/Users/heicg/Desktop/projects/device-stream/.npmrc` -- GitHub Packages registry config

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all packages are local source, versions verified from package.json
- Architecture: HIGH -- both existing drivers and device-stream APIs fully analyzed, hybrid approach confirmed necessary for Android
- Pitfalls: HIGH -- derived from source code analysis of both repos, not speculation

**Research date:** 2026-04-15
**Valid until:** 2026-05-15 (30 days -- stable local packages, no external API changes expected)
