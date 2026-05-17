# Phase 36: Physical Devices + Unified Discovery + CommandPalette — Research

**Researched:** 2026-05-15
**Domain:** Wireless ADB pairing (mDNS + QR), device discovery refactor, Svelte 5 command palette
**Confidence:** HIGH on protocols + simvyn reference port; MEDIUM on Svelte 5 cmdk library choice (hand-roll preferred)

## Summary

Three independent tracks that share `server/pool/` + `web/src/` surface area, so they ship together with minimal coupling:

1. **DeviceDiscoveryService** — port simvyn's `createDeviceManager` (`packages/core/src/device-manager.ts:35-114`) into `server/pool/internal/discovery/` as a single 5s poller emitting `device.discovered.added` / `device.discovered.removed` / `device.discovered.changed` via the existing typed bus. Fingerprint-deduped. Becomes the SOLE caller of `adb devices` + `xcrun simctl list`. Existing emitters (`pool-manager.ts` + `health-checker.ts`) continue to publish state-machine events; discovery is a NEW event stream layered alongside.

2. **Wireless ADB pairing** — Node-side mDNS browser using `bonjour-service@^1.x` on `_adb-tls-pairing._tcp.local`. Server-generated 6-digit pairing PIN + service instance name → encoded as `WIFI:T:ADB;S:<instance>;P:<pin>;;` QR. User scans on Android → device auto-starts pairing server with matching instance name → mDNS browser fires "up" event → `adb pair host:port pin` → on success, mDNS browser on `_adb-tls-connect._tcp.local` picks up the connect service → `adb connect host:port` → discovery service picks the new device up on next poll tick.

3. **CommandPalette** — Svelte 5 component (hand-rolled, ~150 LOC). cmdk-sv is deprecated; bits-ui's Command component is the modern replacement BUT we keep dependencies minimal per brief — `fuzzysort@^3` for ranking, hand-roll dialog + keyboard nav with `$state` runes. Action registry typed via Zod-derived schemas. Lives at `web/src/lib/components/CommandPalette.svelte` with global ⌘K handler in `+layout.svelte`.

**Primary recommendation:** Implement T-36.1 (discovery) FIRST as substrate (Wave 0 + Wave 1) — both T-36.2 (pairing) and T-36.6 (WS stream) consume its events. T-36.3 (physical Android driver) + T-36.4 (pairing wizard) + T-36.5 (palette) parallelize after substrate lands.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**External Dependencies Policy:** Reference repos are STUDY-ONLY. simvyn at `/Users/heicg/Desktop/projects/_reference/simvyn/` is read-only — copy the unified-discovery service pattern, cmdk palette wiring, mDNS pairing flow, QR generation approach into `device-farm/`; do NOT add simvyn packages to package.json. Normal libs (bonjour, fuzzysort, QR rendering libs) remain fine.

**Authoritative Sources:**
- `36-BRIEF.md` — task list, pairing flow, palette spec
- `/Users/heicg/Desktop/projects/_reference/simvyn/` — full reference (unified discovery + cmdk palette)
- `simutil` references in brief — wireless pairing technique

**Architecture:**
- `server/devices/discovery.ts` — single `DeviceDiscoveryService`; ONLY caller of `adb devices` / `simctl list` (enforce via dep-cruiser rule).
- Emits `devices-changed` with diff events.
- Physical Android driver implements `DeviceDriver` interface (existing platform-agnostic pool).
- Wireless pairing service: `server/devices/pairing.ts` — mDNS scan, `adb pair`, QR code generation.
- Web `/devices/pair` route — 3-step wizard.
- CommandPalette: Svelte component + fuzzysort; fuzzy search across devices/jobs/sessions/pages/actions; ⌘K shortcut.

**Tasks:** T-36.1 DeviceDiscoveryService → T-36.2 Wireless pairing → T-36.3 Physical-Android driver → T-36.4 Pairing wizard UI → T-36.5 CommandPalette → T-36.6 Discovery WS + dashboard live list.

### Claude's Discretion

- mDNS Go vs Node implementation (prefer Node bonjour)
- QR rendering library
- Palette action registry shape
- Fuzzysort tuning thresholds

### Deferred Ideas (OUT OF SCOPE)

- Physical iOS devices (WDA setup is separate work)
- USB-tethered pairing flows
- Discovery for Wear OS / tvOS
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| DISC-SVC | Single `DeviceDiscoveryService` is the only caller of `adb devices` / `simctl list`; emits `device.discovered.{added,removed,changed}` events; 5s poll with fingerprint-dedup | §"Reference Walkthrough — simvyn discovery" + §"DeviceDiscoveryService Design" |
| PAIR-WIRELESS | Wireless ADB pairing service: mDNS browse `_adb-tls-pairing._tcp` + `adb pair host:port pin` + QR generation; PIN 6 digits 60s TTL; subnet-locked | §"Wireless ADB Pairing Flow" (full sequence) + §"Pitfall 3 Cross-VLAN" |
| PHYS-ANDROID-DRIVER | New `PhysicalAndroidDriver` implementing `DeviceDriver`; create=no-op, boot=wait-for-device, shutdown=no-op, cleanup=uninstall test apps, isHealthy=adb get-state==device | §"PhysicalAndroidDriver Spec" |
| PAIR-WIZARD-UI | `/devices/pair` route with 3-step Svelte 5 wizard (scan→qr→confirm) driven by `$state` discriminated union | §"Pairing Wizard UI" |
| CMD-PALETTE | Svelte 5 `CommandPalette.svelte` with ⌘K global shortcut, fuzzy search via fuzzysort across devices/jobs/sessions/pages/actions, recent-actions persistence, multi-step action flow | §"CommandPalette" |
| DISC-WS | `WS /api/devices/stream` (and/or `/api/devices/discovery`) wraps DeviceDiscoveryService events; web `devices.svelte.ts` store subscribes; dashboard list updates without reload | §"WS Discovery Channel" |
</phase_requirements>

## Reference Walkthrough — simvyn

Read these files BEFORE writing code. They are the canonical implementations being ported (logic only, never imports).

### Unified discovery (the primary template)

**`packages/core/src/device-manager.ts:35-114`** — `createDeviceManager(adapters, opts?)` factory:

- **Lines 39-43:** Module-private state via closure (EventEmitter + interval handle + `currentDevices: Device[]` + `lastFingerprint: string`).
- **Lines 45-66:** `poll()` calls `Promise.all(adapters.map(a => a.listDevices()))`, flat-sorts, fingerprints, emits `devices-changed` on diff. Computes `disconnected` for physical devices (passive removal) and emits `devices-disconnected` separately.
- **Lines 18-29:** `sortDevices` — booted first, then platform alpha, then name alpha. Determinism makes fingerprinting cheap.
- **Lines 31-33:** `devicesFingerprint(d) = JSON.stringify(d.map(d => '${d.id}:${d.state}'))`. Simple, correct.
- **Lines 77-81:** `start()` is idempotent (guarded by `intervalId`), runs `poll()` immediately on start (no "wait 5s for first list").
- **Lines 90-96:** `setPollInterval` clears + restarts cleanly. Useful for dev mode (faster polling).

**Key insight:** simvyn's design is **publisher-only** — adapters return the snapshot, manager diffs + emits. Pool's existing emit pattern (`pool-manager.ts:78` `emit.stateChanged`) is **state-machine driven**. These coexist: discovery surfaces hardware reality; pool surfaces internal state transitions. Bridge them via a subscriber that adopts/removes pool `Device` entries when discovery fires.

### Platform adapter shape

**`packages/core/src/adapters/android.ts:96-168`** — `createAndroidAdapter()` listDevices():

- Lines 33-46: `getAdbDevices()` parses `adb devices` stdout, filters `device|emulator` status.
- Lines 48-70: `getEmulatorAvdName(serial)` — `adb shell getprop ro.boot.qemu.avd_name` then `adb emu avd name` fallback. Phase 36 needs the same for physical: `getprop ro.product.model` already used at lines 132-135.
- Lines 116-145: Separate handling for `emulator-*` serials (parse AVD name) vs physical (parse model + Android version). Sets `deviceType: 'Emulator' | 'Physical'`.
- Lines 149-160: AVD list - bootedAvds → "shutdown" devices. Phase 36 keeps existing pool semantics — pool-managed AVDs aren't visible to discovery; discovery is for hardware presence only.

### CommandPalette (cmdk reference)

**`packages/dashboard/src/components/CommandPalette.tsx:1-277`** — React+cmdk implementation. Port the data-flow, NOT the React idioms.

Key porting decisions:
- **Lines 27-46:** `localStorage` recent-actions list (5 max). Trivial to port to Svelte 5 with `$effect`.
- **Lines 71-80:** Global ⌘K listener uses `addEventListener('keydown')` on `window` — same pattern works in Svelte `+layout.svelte`.
- **Lines 100-110:** Action selection — if `action.steps.length > 0`, enter multi-step mode; else execute immediately + close. Phase 36 copies this verbatim.
- **Lines 152-275:** `<Command.Dialog>` from `cmdk` package — NOT portable. Replace with a Svelte `<dialog>` element + `fuzzysort` ranking + `$state` for selected index.

**`packages/dashboard/src/components/command-palette/actions.tsx:1-482`** — Action registry. The `MultiStepAction` shape (id/label/description/icon/steps[]/execute) at `types.ts:63-70` is the canonical contract to port.

**`packages/dashboard/src/components/command-palette/StepRenderer.tsx:23-189`** — Multi-step state machine. `stepIndex` advances via `advance(updatedContext)`; types: `device-select | confirm | parameter | execute | locale-select | ...`. Port the state-machine; render with Svelte components instead of React.

**`packages/dashboard/src/components/command-palette/DevicePicker.tsx:15-120`** — Device sub-picker. Filters by `step.filter` (e.g. `d => d.state === 'booted'`); supports `multi: boolean`. Cmd+Enter applies multi-selection (line 51-62 uses capture-phase listener to intercept BEFORE cmdk swallows Enter — important detail).

### Server wiring reference

**`packages/server/src/app.ts:304-312`** — Bridge `devices-disconnected` to WS broker for toast notifications. Phase 36 mirrors with `/api/devices/stream` WS frame.

## DeviceDiscoveryService Design

### Location

Per CONTEXT §Decisions, the brief says `server/devices/discovery.ts`. The BETTER home is `server/pool/internal/discovery/` because:

- Pool module already owns `adb`/`simctl` shell-out (`pool-manager.ts:170-195` `detectPhysicalDevices`, `health-checker.ts` health probes).
- MOD-02 dep-cruiser rules already protect `server/pool/internal/` from deep imports — adding discovery there is structurally free.
- Adding a new top-level `server/devices/` module breaks MOD-01..09 conventions (no MODULE.md, no events.ts, no factory).

**Recommendation:** create `server/pool/internal/discovery/{poller.ts, fingerprint.ts, types.ts, index.ts}` and surface `createDeviceDiscoveryService(deps)` from the existing `createPoolModule` factory.

### Files

```
server/pool/internal/discovery/
├── poller.ts                 # poll() loop, setInterval, EventEmitter wiring
├── fingerprint.ts            # stableFingerprint(devices) + diff(prev, next)
├── adapters/
│   ├── android.ts            # listEmulators() + listPhysical() — ONLY callers of `adb devices`
│   └── ios.ts                # listSimulators() — ONLY caller of `simctl list`
├── types.ts                  # DiscoveredDevice, DiscoveryDiff payload schemas
└── index.ts                  # createDeviceDiscoveryService factory
```

### Event Surface (additions to `server/pool/events.ts`)

```typescript
// Three new entries in POOL_EVENT_NAMES:
DISCOVERED_ADDED:   'device.discovered.added',
DISCOVERED_REMOVED: 'device.discovered.removed',
DISCOVERED_CHANGED: 'device.discovered.changed',

// Payload schemas:
export const discoveredDevicePayload = z.object({
  id: z.string(),                     // adb serial OR udid
  name: z.string(),                   // human-readable
  platform: platformSchema,
  state: z.enum(['booted', 'shutdown', 'unauthorized', 'offline']),
  deviceType: z.enum(['Emulator', 'Simulator', 'Physical']),
  osVersion: z.string().nullable(),
  model: z.string().nullable(),       // physical Android only
  // Adapter-specific metadata is OUT of this schema — re-fetch via pool
});

// Persistence policy per TRACE-08:
// added/removed: persisted: true (operational — record hot-plug events)
// changed: persisted: false (high-freq state transitions)
```

### Poller Pseudocode

```typescript
async function poll(): Promise<void> {
  const [androidEmu, androidPhys, iosSims] = await Promise.all([
    listAndroidEmulators(),  // adb devices, filter emulator-*
    listAndroidPhysical(),   // adb devices, filter !emulator-*
    listIosSimulators(),     // xcrun simctl list devices --json
  ]);
  const all = sortDevices([...androidEmu, ...androidPhys, ...iosSims]);
  const fp = fingerprint(all);
  if (fp === lastFp) return;

  const diff = computeDiff(previous, all);   // {added: [], removed: [], changed: []}
  for (const d of diff.added)   emit.discoveredAdded(d.id, d);
  for (const d of diff.removed) emit.discoveredRemoved(d.id, d);
  for (const d of diff.changed) emit.discoveredChanged(d.id, d);

  previous = all;
  lastFp = fp;
}
```

### Fingerprint + Diff

Match simvyn `packages/core/src/device-manager.ts:31-33` exactly:

```typescript
const fingerprint = (devices: DiscoveredDevice[]) =>
  JSON.stringify(devices.map(d => `${d.id}:${d.state}`));
```

Diff is O(n) using two `Set<string>` (prev IDs vs next IDs) + an inner-loop state comparison.

### Concurrency Guard

Discovery poll calls `adb devices` which can block ~5s on flaky USB stacks. Use `async-mutex.Mutex` (already a dep — `pool-manager.ts:3`) wrapped around `poll()` so an overlapping tick is dropped, not queued.

### Dep-Cruiser Enforcement

Add a NEW rule to `.dependency-cruiser.cjs` (existing pattern: see Phase 20 rule `no-deep-imports-into-pool-internal`):

```javascript
{
  name: 'discovery-is-sole-adb-shell-out',
  severity: 'error',
  comment: 'Only server/pool/internal/discovery/adapters/* may shell out to adb devices / simctl list',
  from: { pathNot: 'server/pool/internal/discovery/adapters/' },
  to: { path: 'server/.*', dependencyTypes: [], moreThanOneDependencyType: false },
  // Grep-style codepath check is hard via dep-cruiser; supplement with a vitest readFileSync grep:
}
```

Backup with a vitest spec (`server/pool/__tests__/discovery-sole-caller.spec.ts`) that `readFileSync`s every file under `server/` and asserts only `discovery/adapters/*` matches `/adb\s+(-s\s+\S+\s+)?devices\b/` or `/simctl\s+list\b/`. Pattern: Phase 23 `lifecycle-ownership.spec.ts` grep-guard.

### Subscribers (Existing Code That Reads Discovery)

| Consumer | Subscribes to | What it does |
|----------|---------------|--------------|
| `PoolManager.adoptDiscoveredDevice()` (new method) | `device.discovered.added` filtered by `deviceType='Physical'` | Create `Device` entry, mark Idle, register driver |
| `PoolManager.handleDiscoveryRemoval()` (new method) | `device.discovered.removed` filtered by `deviceType='Physical'` | Transition `Idle→Error` with reason `device-disconnected`; fail current job if any |
| WS `/api/devices/stream` handler | All three events | Broadcast envelopes to subscribed web clients |
| `HealthChecker` | None — still polls drivers directly | Health probe semantics differ from "is the device on the bus" |

### Refactor of Existing `adb`/`simctl` Callers

Today's call sites (from grep):
- `server/pool/pool-manager.ts:107` — `adb devices` pre-scan in `initPool`. **Replace** with discovery snapshot read.
- `server/pool/pool-manager.ts:170-195` — `detectPhysicalDevices` (one-shot scan). **Delete** — discovery subscribes adoption path replaces it.
- `server/pool/ios/simulator.ts:53-56` — `simctl list -j` inside `isHealthy`. **Keep** — this is a per-device health probe, NOT a discovery scan. Document the exception in the dep-cruiser rule.
- `server/maestro/internal/device-info-collector.ts:109` — `simctl list -j` for per-device metadata. **Keep** — same exception.

Discovery owns "what's on the bus right now"; per-device `isHealthy` calls are legitimate uses of the same shell commands at a different abstraction level. The dep-cruiser rule + grep test should ONLY guard against bare-list calls without a `-s <serial>` filter.

## Wireless ADB Pairing Flow

### Protocol Background (HIGH confidence — Android source + LineageOS docs)

mDNS service types Android emits:
- `_adb._tcp` — legacy `adb tcpip` (no auth) — IGNORE.
- `_adb-tls-pairing._tcp` — pairing server, active ONLY when user opens "Wireless debugging → Pair device" UI on phone. Port is random per session.
- `_adb-tls-connect._tcp` — TLS-encrypted long-running connection, active when wireless debugging is ON.

Service instance name format: `adb-<ro.serialno>-<random-suffix>` (e.g. `adb-14141FDF600081-QXjCrW`). On macOS the OS-level mdnsResponder daemon is always running — no extra setup needed. The Bonjour Node bindings (`bonjour-service`) use the same daemon under the hood.

**Source:** [Android ADB Wi-Fi documentation (LineageOS mirror)](https://github.com/LineageOS/android_packages_modules_adb/blob/lineage-23.2/docs/dev/adb_wifi.md), [Android Developers ADB](https://developer.android.com/tools/adb).

### QR String Format (HIGH confidence)

```
WIFI:T:ADB;S:<service-instance-name>;P:<6-digit-pin>;;
```

- `T:ADB` is the magic type (NOT the WPA standard `WPA`/`WEP`/`nopass`).
- `S:` is the **service instance name we want the device to advertise** — when the phone scans, it starts a pairing server with this exact name so we can match it via mDNS.
- `P:` is the pairing code (6 random digits is the convention; can be longer/alphanumeric).

**Generation:**
```typescript
import { randomBytes } from 'node:crypto';
import QRCode from 'qrcode';   // npm: qrcode@^1.5.4 — soldair/node-qrcode

const pin = String(randomInt(0, 1_000_000)).padStart(6, '0');
const instance = `devicefarm-${randomBytes(4).toString('hex')}`;
const payload = `WIFI:T:ADB;S:${instance};P:${pin};;`;
const dataUrl = await QRCode.toDataURL(payload, { errorCorrectionLevel: 'M', margin: 1 });
// Server returns { qr: dataUrl, instance, pin } to /devices/pair UI
```

Server-side QR generation is preferred over client-side because:
- Pin generation MUST be server-authoritative (audit log, TTL enforcement).
- One round-trip; the wizard renders the data URL as `<img src="data:image/png;..." />`.

**Sources:** [LineageOS ADB Wi-Fi docs §QR Code Pairing Format](https://github.com/LineageOS/android_packages_modules_adb/blob/lineage-23.2/docs/dev/adb_wifi.md), [Android Enthusiasts SE #234465](https://android.stackexchange.com/questions/234465/).

### Full Wireless Pairing Sequence

```
┌────────────────────────────── 1. Wizard starts ──────────────────────────────┐
│ User: opens /devices/pair                                                     │
│ Web: POST /api/devices/pair/start                                             │
│ Server: generates pin + instance, opens mDNS browser on _adb-tls-pairing._tcp │
│        filtered to txt-record service-name===instance (60s TTL timer starts) │
│ Server: returns { sessionId, qrDataUrl, pin, instance, ttlSeconds: 60 }      │
└──────────────────────────────────────────────────────────────────────────────┘
                                       │
┌──────────────────────── 2. User scans + accepts on phone ────────────────────┐
│ User: opens "Wireless debugging → Pair device with QR code" on Android       │
│ Phone: scans → reads WIFI:T:ADB;S:<instance>;P:<pin>;;                       │
│ Phone: starts mDNS service _adb-tls-pairing._tcp with the instance name      │
│        and a randomly-picked port (e.g. 33861)                               │
└──────────────────────────────────────────────────────────────────────────────┘
                                       │
┌──────────────────────── 3. Server picks up mDNS hit ─────────────────────────┐
│ bonjour-service Browser emits 'up' event with {host, port, fqdn, txt}        │
│ Server: validates txt.service-name === sessionId.instance                     │
│         (filters out other devices on subnet pairing concurrently)            │
│ Server: subnet-check: ip in os.networkInterfaces() local /24 — Pitfall 3     │
│ Server: shell-out adb pair <host>:<port> <pin>                                │
│        await execFile('adb', ['pair', `${host}:${port}`, pin], {timeout:30s})│
│         (returns "Successfully paired to host:port [guid=<...>]" on success) │
└──────────────────────────────────────────────────────────────────────────────┘
                                       │
┌──────────────────── 4. Switch to connect-service watcher ────────────────────┐
│ Server: closes pairing browser, opens new browser on _adb-tls-connect._tcp   │
│         (Android phone now advertises this once pairing succeeds)            │
│ When 'up' fires for the same device:                                          │
│   adb connect <host>:<connect-port>                                           │
│   (success message: "connected to host:port")                                 │
└──────────────────────────────────────────────────────────────────────────────┘
                                       │
┌────────────────── 5. Discovery picks up the new device next tick ────────────┐
│ DeviceDiscoveryService polls, sees new entry in `adb devices`                │
│ Emits device.discovered.added{deviceType:'Physical'}                          │
│ PoolManager subscriber adopts the device as Idle + registers it              │
│ Wizard UI receives WS frame → transitions to 'done' state                    │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Files

```
server/pool/internal/wireless/
├── mdns.ts            # bonjour-service wrapper: browseForPairing(), browseForConnect()
├── pair.ts            # execFile adb pair host:port pin  +  output parsing
├── connect.ts         # execFile adb connect host:port  +  state-machine state
├── qr.ts              # buildPairingPayload() + QR data-url generation
├── session.ts         # PairingSession class: sessionId, ttl, browser handle, state
└── __tests__/
    ├── pair.spec.ts
    ├── connect.spec.ts
    ├── qr.spec.ts
    └── session-flow.spec.ts   # mock adb + mock bonjour-service
```

### Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `bonjour-service` | `^1.3.0` | mDNS browse + advertise. Modern TS rewrite of `bonjour`. Maintained. |
| `qrcode` | `^1.5.4` | QR PNG/SVG/dataURL generation. soldair/node-qrcode — battle-tested. |

Both packages have zero native dependencies (pure JS) — safe for CI containers without mdns daemons (tests mock the Browser).

**Why not `multicast-dns`?** The brief mentioned it as fallback. `bonjour-service` is the higher-level wrapper around the same protocol with better TS types + active maintenance. Use it directly.

### adb pair / adb connect Output Parsing

```
$ adb pair 192.168.1.42:33861 123456
Enter pairing code: 123456
Successfully paired to 192.168.1.42:33861 [guid=adb-14141FDF600081-QXjCrW]

$ adb connect 192.168.1.42:43811
connected to 192.168.1.42:43811
```

Failure modes to handle:
- `failed to authenticate to ...` — wrong PIN, retry permitted.
- `cannot resolve host '...'` — mDNS resolution stale, fall back to TTL+restart browser.
- Timeout (>30s) — phone navigated away from pairing dialog.

Parse with simple regex, return discriminated-union result type:

```typescript
type PairResult =
  | { ok: true;  guid: string; host: string; port: number }
  | { ok: false; reason: 'auth' | 'timeout' | 'resolve' | 'unknown'; rawStderr: string };
```

### Security (LOCKED — from brief)

- **PIN TTL:** 60 seconds. After expiry, `PairingSession.state = 'expired'`; mDNS browser stopped; UI prompts retry.
- **Subnet check (Pitfall 3):** When `bonjour-service` resolves a service, compare `service.referer.address` (or `service.addresses[0]`) against `os.networkInterfaces()` — only accept if same /24. Reject cross-VLAN with audit log entry.
- **Audit log:** Every `POST /api/devices/pair/start` and every `'up'`+`adb pair` invocation persists to the `events` table via the bus (`device.pair.attempted` event with `actor: 'apikey:<id>'`).

## PhysicalAndroidDriver Spec

### Location

`server/pool/android/physical.ts` — sibling to existing `server/pool/android/emulator.ts`.

### Implementation

```typescript
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type pino from 'pino';
import type { DeviceDriver, DeviceConfig, BootOptions, BootResult } from '../types.js';

const execFileAsync = promisify(execFile);

export class PhysicalAndroidDriver implements DeviceDriver {
  constructor(private readonly logger: pino.Logger) {}

  /**
   * No-op: physical devices arrive via pairing flow, not on-demand creation.
   * `name` here IS the adb serial (e.g. "192.168.1.42:43811" or "USB:0123...").
   */
  async create(name: string, _config: DeviceConfig): Promise<string> {
    return name;  // emulatorId === adb serial for physical
  }

  /**
   * "Boot" = ensure the phone is awake and bootcompleted. Cannot actually
   * power-on a real device, but can verify it's responsive.
   */
  async boot(serial: string, options?: BootOptions): Promise<BootResult> {
    const timeout = options?.timeout ?? 30_000;
    await execFileAsync('adb', ['-s', serial, 'wait-for-device'], { timeout });
    const { stdout } = await execFileAsync('adb', [
      '-s', serial, 'shell', 'getprop', 'sys.boot_completed',
    ], { timeout: 10_000 });
    if (stdout.trim() !== '1') {
      throw new Error(`Physical device ${serial} not boot-completed`);
    }
    return { port: 0, pid: 0 };  // physical devices have neither
  }

  /** No-op: cannot power-off a real phone. */
  async shutdown(_serial: string): Promise<void> {}

  async isHealthy(serial: string, _port?: number | null): Promise<boolean> {
    try {
      const { stdout } = await execFileAsync('adb', [
        '-s', serial, 'get-state',
      ], { timeout: 5_000 });
      return stdout.trim() === 'device';
    } catch {
      return false;
    }
  }

  /**
   * Cleanup between jobs:
   *   1. Uninstall test apps (anything installed during the job)
   *   2. Clear data on remaining test apps
   *
   * Caller (PoolManager.cleanup) passes the bundle list via a side-channel
   * (since DeviceDriver.cleanup takes only an emulatorId).
   * Recommendation: extend DeviceDriver.cleanup to accept optional context
   * { installedBundles: string[] } in Phase 36 (additive interface change).
   */
  async cleanup(serial: string): Promise<void> {
    // Minimum cleanup: clear logcat buffer to reduce noise next job.
    try {
      await execFileAsync('adb', ['-s', serial, 'logcat', '-c'], { timeout: 5_000 });
    } catch {
      // non-fatal
    }
    // App uninstall handled by job-service when the job carries `--apk` flag.
    // See server/jobs/internal/executor.ts apk-install/uninstall path.
  }
}
```

### Registration

In `createPoolModule(deps)` (or `pool-manager.ts:registerDriver`), after the existing Android emulator + iOS simulator registrations:

```typescript
poolManager.registerDriver('android-physical', new PhysicalAndroidDriver(logger));
```

### Type Extensions

Add `'android-physical'` to the `Platform` union in `server/types/index.ts`:

```typescript
export type Platform = 'android' | 'ios' | 'android-physical';
```

This propagates through every consumer (jobs queue platform-routing, web filters, CLI flag values).

**Alternative:** Keep `Platform = 'android' | 'ios'` and add `Device.kind: 'emulator' | 'simulator' | 'physical-android'`. The brief recommends the latter. **Decision required at planning time** — both work. The `kind` field approach is less invasive (no Platform union change) but means PoolManager must dispatch on `(platform, kind)` instead of just `platform`.

**Recommendation:** Use `Device.kind` discriminator. PoolManager's `registerDriver` becomes `(platform, kind) → DeviceDriver`. Cleaner because most consumers care about "android vs ios" not "emulator vs physical".

### Concurrency

`pool.maxConcurrent = 1` per physical device (no multi-instance — a real phone can only run one job at a time). Set by the discovery adoption path when it creates the `Device` entry.

## Pairing Wizard UI

### Files

```
web/src/routes/devices/pair/
└── +page.svelte                # 3-step wizard

web/src/lib/components/devices/
├── PairingWizard.svelte        # state machine + sub-step rendering
├── PairingScanStep.svelte      # "Open Wireless Debugging on your phone..."
├── PairingQrStep.svelte        # <img src={qrDataUrl} /> + PIN display + countdown
└── PairingConfirmStep.svelte   # "Successfully paired Pixel 8 (Android 14)"
```

### State Machine (Svelte 5 runes)

```typescript
type WizardState =
  | { kind: 'idle' }
  | { kind: 'starting' }
  | { kind: 'awaiting-scan'; sessionId: string; qrDataUrl: string; pin: string; expiresAt: number }
  | { kind: 'pairing'; sessionId: string; host: string; port: number }
  | { kind: 'connecting'; sessionId: string; deviceName: string }
  | { kind: 'done'; deviceId: string; deviceName: string }
  | { kind: 'error'; reason: string; canRetry: boolean };

let state = $state<WizardState>({ kind: 'idle' });
```

### WS Channel

The wizard opens `WS /api/devices/pair/stream?sessionId=<id>` immediately after `POST /api/devices/pair/start` returns. Server pushes state transitions as Zod-validated frames:

```typescript
// shared envelope (mirror server/streaming/internal/envelope.ts pattern)
{
  v: 1,
  ts: '2026-05-15T12:34:56.789Z',
  correlationId: '<uuid>',
  payload:
    | { type: 'awaiting-scan' }
    | { type: 'paired'; host: string; port: number }
    | { type: 'connecting'; deviceName: string }
    | { type: 'done'; deviceId: string; deviceName: string }
    | { type: 'error'; reason: 'timeout' | 'subnet' | 'auth' | 'unknown' }
}
```

### Countdown UX

The 60s PIN TTL is rendered as a shrinking ring around the QR (use `<svg>` stroke-dashoffset transition). When `Date.now() >= expiresAt`, automatically POST `/api/devices/pair/restart` to refresh PIN.

## CommandPalette

### Files

```
web/src/lib/components/CommandPalette.svelte           # dialog + input + list
web/src/lib/command-palette/
├── registry.ts                                         # action registry + types
├── recent.svelte.ts                                    # localStorage recents store
└── fuzzy.ts                                            # fuzzysort wrapper
```

### Dependencies (web/)

| Package | Version | Why |
|---------|---------|-----|
| `fuzzysort` | `^3.1.0` | Sub-millisecond fuzzy ranking, ~6KB. Performance-tuned for command palettes. |
| `qrcode` | `^1.5.4` | Only needed if doing client-side regen; server-side preferred — likely SKIP for web. |

**NOT** using `cmdk-sv` — deprecated. **NOT** using `bits-ui` Command — too heavy for this single use case (introduces full UI lib dep). Hand-roll ~150 LOC of Svelte 5 to keep dep surface minimal.

**Sources:** [shadcn-svelte command (uses bits-ui)](https://www.shadcn-svelte.com/docs/components/command), [cmdk-sv deprecation notice](https://github.com/huntabyte/cmdk-sv), [fuzzysort docs](https://www.npmjs.com/package/fuzzysort).

### Component Skeleton

```svelte
<!-- CommandPalette.svelte -->
<script lang="ts">
  import fuzzysort from 'fuzzysort';
  import { getActions, type PaletteAction } from '$lib/command-palette/registry.js';
  import { getRecent, pushRecent } from '$lib/command-palette/recent.svelte.js';
  import { deviceStore } from '$lib/stores/devices.svelte.js';
  import { jobStore } from '$lib/stores/jobs.svelte.js';

  let open = $state(false);
  let search = $state('');
  let selected = $state(0);
  let dialogEl: HTMLDialogElement;

  // Global ⌘K
  $effect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        open ? close() : openPalette();
      }
      if (open && e.key === 'Escape') close();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Sources: actions + devices + jobs + sessions + pages
  let items = $derived.by(() => {
    const actions = getActions();
    const devices = deviceStore.devices.map(d => ({
      kind: 'device' as const,
      id: d.id,
      label: d.name,
      sub: `${d.platform} · ${d.state}`,
      run: () => goto(`/devices/${d.id}`),
    }));
    const jobs = jobStore.recent.slice(0, 50).map(j => ({
      kind: 'job' as const, id: j.id, label: j.id, sub: j.deviceName,
      run: () => goto(`/jobs/${j.id}`),
    }));
    const pages = [
      { kind: 'page' as const, id: 'pair', label: 'Pair device', run: () => goto('/devices/pair') },
      // ...
    ];
    return [...actions, ...devices, ...jobs, ...pages];
  });

  let filtered = $derived.by(() => {
    if (!search.trim()) return items.slice(0, 50);
    const results = fuzzysort.go(search, items, {
      keys: ['label', 'sub'],
      threshold: -10000,           // permissive; tighten if too noisy
      limit: 50,
    });
    return results.map(r => r.obj);
  });
</script>

<dialog bind:this={dialogEl} class="cmdk-dialog" onclose={() => (open = false)}>
  <input
    bind:value={search}
    placeholder="Search devices, jobs, actions..."
    autofocus
  />
  <ul role="listbox">
    {#each filtered as item, i}
      <li role="option" aria-selected={i === selected} onclick={() => run(item)}>
        <span>{item.label}</span>
        {#if item.sub}<span class="sub">{item.sub}</span>{/if}
      </li>
    {/each}
  </ul>
</dialog>
```

### Action Registry Shape

```typescript
// registry.ts
export type PaletteAction = {
  kind: 'action';
  id: string;
  label: string;
  description: string;
  keywords: string[];
  steps?: PaletteStep[];   // simvyn multi-step pattern (optional)
  run: (ctx: ActionContext) => Promise<void>;
};

export type PaletteStep =
  | { type: 'device-select'; multi: boolean; filter?: (d: Device) => boolean }
  | { type: 'parameter'; key: string; placeholder?: string }
  | { type: 'confirm'; message: string | ((ctx: ActionContext) => string); destructive?: boolean };

export function getActions(): PaletteAction[] {
  return [
    { id: 'run-latest-job',  label: 'Run latest job again', description: 'Re-queue the most recent job', keywords: ['rerun', 'requeue'], run: async () => { /* ... */ } },
    { id: 'pair-device',     label: 'Pair device',          description: 'Wireless ADB pairing wizard',  keywords: ['adb', 'wifi'], run: async () => goto('/devices/pair') },
    { id: 'clear-logs',      label: 'Clear logs viewer',    description: 'Clear current logs',           keywords: [],              run: async () => { /* ... */ } },
    // ...
  ];
}
```

### Keyboard Nav

`ArrowUp` / `ArrowDown` adjust `selected`; `Enter` runs `filtered[selected]`. Cmd+Enter applies multi-select (port simvyn `DevicePicker.tsx:51-62` capture-phase trick — required to beat default Enter handlers).

### fuzzysort Tuning

- `threshold: -10000` (permissive) initially. Tighten to `-5000` once tested.
- `limit: 50` — keep results bounded.
- `keys: ['label', 'sub', 'keywords']` — multi-field weighting via the `weights` option (Phase 36 can defer; default works).

### Recent Actions

LocalStorage key `device-farm-palette-recent`, max 5 entries, FIFO. Port simvyn `CommandPalette.tsx:25-46` pattern verbatim (just translate to Svelte).

## WS Discovery Channel

### Endpoint

`WS /api/devices/stream` — subscribes to `device.discovered.{added,removed,changed}` on the bus, broadcasts to all connected web clients.

### Wire Format

Reuse the existing `wsEnvelopeSchema` (Phase 22 — see `server/streaming/internal/envelope.ts`):

```typescript
{
  v: 1,
  ts: ISO8601,
  correlationId: UUID,
  payload: {
    type: 'device.discovered.added' | 'device.discovered.removed' | 'device.discovered.changed',
    device: DiscoveredDevicePayload,
  }
}
```

### Web Store

`web/src/lib/stores/devices.svelte.ts` — Svelte 5 runes store, connects on first read, applies frames:

```typescript
class DeviceStore {
  devices = $state<Device[]>([]);
  private ws: WebSocket | null = null;

  connect(): void {
    this.ws = new WebSocket(/* ... */);
    this.ws.onmessage = (ev) => {
      const frame = JSON.parse(ev.data);
      switch (frame.payload.type) {
        case 'device.discovered.added':
          this.devices = [...this.devices, frame.payload.device];
          break;
        case 'device.discovered.removed':
          this.devices = this.devices.filter(d => d.id !== frame.payload.device.id);
          break;
        case 'device.discovered.changed':
          this.devices = this.devices.map(d =>
            d.id === frame.payload.device.id ? frame.payload.device : d
          );
          break;
      }
    };
  }
}

export const deviceStore = new DeviceStore();
```

### Replay on Connect

When a client connects, immediately send a synthetic `added` frame for every currently-known device. Pattern: `server/streaming/internal/job-broadcaster.ts` ring-buffer replay.

## Architecture Patterns

### Pattern 1: Publisher-only discovery, state-machine pool

Discovery emits **hardware presence** events. Pool emits **state-machine** events. Subscribers bridge them:

```
adb devices ──┐
              ├─→ DeviceDiscoveryService.poll() ──→ device.discovered.added
simctl list ──┘                                          │
                                                         ▼
                              PoolManager.adoptDiscoveredDevice() subscriber
                                                         │
                                                         ▼
                                       Device(state=Idle) created
                                                         │
                                                         ▼
                                       device.state.changed{from:'booting', to:'idle'}
```

### Pattern 2: Driver dispatch by `(platform, kind)`

PoolManager already has `registerDriver(platform, driver)`. Extend to `registerDriver(platform, kind, driver)`:

```typescript
private readonly drivers: Map<string, DeviceDriver> = new Map();  // key: `${platform}:${kind}`

registerDriver(platform: Platform, kind: DeviceKind, driver: DeviceDriver): void {
  this.drivers.set(`${platform}:${kind}`, driver);
}

private getDriver(device: Device): DeviceDriver {
  return this.drivers.get(`${device.platform}:${device.kind}`)!;
}
```

### Pattern 3: PairingSession with TTL

Each pairing attempt creates a `PairingSession` object held in an in-memory `Map<sessionId, PairingSession>` on the server. TTL via `setTimeout(60_000, () => session.expire())`. State transitions push WS frames. Mirror Phase 21 recording-session pattern.

### Anti-Patterns to Avoid

- **Don't poll adb from multiple places.** Discovery is the sole caller. Per-device `isHealthy` is a separate axis.
- **Don't pair without instance-name filtering.** Bonjour fires `'up'` for EVERY device on the subnet pairing concurrently. Filter via the QR's encoded instance name.
- **Don't trust mDNS for cross-subnet pairing.** Subnet check is mandatory (Pitfall 3).
- **Don't ship `cmdk-sv`** — deprecated; bits-ui is the modern replacement but too heavy. Hand-roll.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| mDNS service discovery | DIY UDP multicast | `bonjour-service@^1.3.0` | Querier+responder, TXT parsing, cache management. macOS uses system daemon. |
| QR code generation | DIY matrix builder | `qrcode@^1.5.4` (`soldair/node-qrcode`) | Reed-Solomon error correction, version selection, multi-format (PNG/SVG/dataURL). |
| Fuzzy string ranking | DIY Levenshtein loops | `fuzzysort@^3.1.0` | Highlight ranges, multi-key weighting, sub-ms on 10k items. |
| Event emit + envelope stamping | DIY `EventEmitter` wrapping | `createEventHelpers` from `server/bus/helpers.js` | Phase 15 substrate. Stamps `correlationId` from ALS, applies persistence policy from registry. |
| Dialog modal behavior | DIY focus trap | Native `<dialog>` element | `showModal()` handles focus trap + Escape + backdrop click natively. |
| WS frame validation | DIY `JSON.parse` + ad-hoc checks | `wsEnvelopeSchema.safeParse` from Phase 22 | Standardized envelope, correlationId threading, malformed-frame logging. |

## Common Pitfalls

### Pitfall 1: mDNS resolution timing

**What goes wrong:** `bonjour-service` Browser `'up'` event can fire BEFORE the device has fully completed its mDNS announce. `adb pair` then fails with "cannot resolve host".

**Why it happens:** Bonjour decodes PTR record first, then queries SRV+A records asynchronously. The `service.host` may still be the unresolved hostname when `'up'` fires.

**How to avoid:** Wait for `service.addresses?.length > 0` before invoking `adb pair`. If empty, register a one-time `txt-record-update` listener and retry on the resolved address.

### Pitfall 2: Race between pairing-server-active and connect-server-active

**What goes wrong:** Server runs `adb pair` successfully. Immediately starts the connect browser. But device may not advertise `_adb-tls-connect._tcp` for a few hundred ms post-pair.

**How to avoid:** Open the connect browser BEFORE running `adb pair`. Filter incoming connect events to the device guid returned from pair-success output. Idempotent — extra events are ignored.

### Pitfall 3: Cross-VLAN pairing

**What goes wrong:** A multi-NIC server (e.g. with Tailscale or Docker bridge interfaces) might pick up pairing requests from a guest VLAN. Server pairs with an attacker-controlled device.

**How to avoid:** Reject services whose IP is NOT in any local /24 reported by `os.networkInterfaces()`. Audit-log rejections.

```typescript
function isOnLocalSubnet(ip: string): boolean {
  const ifaces = os.networkInterfaces();
  for (const iface of Object.values(ifaces).flat()) {
    if (!iface || iface.family !== 'IPv4' || iface.internal) continue;
    if (sameSubnet(ip, iface.address, iface.netmask)) return true;
  }
  return false;
}
```

### Pitfall 4: Polling adb storm

**What goes wrong:** Discovery polls every 5s. Each poll runs `adb devices` + `xcrun simctl list` + extra getprop calls per device. On a host with 4 emulators, this is ~20 adb calls every 5s.

**How to avoid:**
- Single `adb devices` call returns all serials. Only invoke `getprop` for NEW devices (cached).
- Use `async-mutex` to drop overlapping ticks.
- Cache `ro.product.model` + `ro.build.version.release` keyed by serial — physical phone model doesn't change.

### Pitfall 5: `_adb-tls-pairing._tcp` ghost services

**What goes wrong:** Browser caches stale service entries even after the phone closes the pairing dialog. User retries pairing, sees old QR doesn't match, fails.

**How to avoid:** ALWAYS stop the Browser when the wizard ends (success OR cancel). Recreate fresh per pairing session. `bonjour-service` Browser.stop() is idempotent and synchronous.

### Pitfall 6: localStorage races for recent actions

**What goes wrong:** Two tabs open the palette concurrently, both write recents. Last-writer-wins corruption.

**How to avoid:** Use the `storage` event to sync between tabs. Optional for v1; document deferral. Single-tab user gets correct behavior.

### Pitfall 7: Svelte 5 runes vs effects gotcha

**What goes wrong:** `$derived` recomputes synchronously when dependencies change, but `$effect` is async. Putting `fuzzysort.go()` in `$effect` causes a one-frame UI lag.

**How to avoid:** Put fuzzysort in `$derived.by(() => fuzzysort.go(...))`. The result computes during the same tick that `search` updates.

## Code Examples

### Example: bonjour-service browse with subnet check

```typescript
// server/pool/internal/wireless/mdns.ts
import { Bonjour } from 'bonjour-service';
import * as os from 'node:os';

export function browseForPairing(
  expectedInstance: string,
  onFound: (host: string, port: number) => void,
  onError: (err: Error) => void,
): { stop: () => void } {
  const bonjour = new Bonjour();
  const browser = bonjour.find({ type: 'adb-tls-pairing', protocol: 'tcp' });

  browser.on('up', (service) => {
    // Filter by instance name (encoded in QR)
    if (service.name !== expectedInstance) return;

    const ip = service.addresses?.find(a => a.includes('.'));   // IPv4 only
    if (!ip) return;
    if (!isOnLocalSubnet(ip)) {
      onError(new Error(`Cross-subnet pairing attempt rejected: ${ip}`));
      return;
    }
    onFound(ip, service.port);
  });

  browser.on('error', onError);
  browser.start();

  return {
    stop: () => {
      browser.stop();
      bonjour.destroy();
    },
  };
}

function isOnLocalSubnet(ip: string): boolean {
  // ... (see Pitfall 3)
}
```

### Example: adb pair with output parsing

```typescript
// server/pool/internal/wireless/pair.ts
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function adbPair(host: string, port: number, pin: string): Promise<PairResult> {
  try {
    const { stdout, stderr } = await execFileAsync(
      'adb',
      ['pair', `${host}:${port}`, pin],
      { timeout: 30_000 },
    );
    const m = stdout.match(/Successfully paired to ([^\s]+) \[guid=([^\]]+)\]/);
    if (m) {
      const [, hostPort, guid] = m;
      const [h, p] = hostPort.split(':');
      return { ok: true, guid, host: h, port: Number(p) };
    }
    return { ok: false, reason: 'unknown', rawStderr: stderr };
  } catch (err: any) {
    const msg = (err.stderr || err.message || '').toLowerCase();
    if (msg.includes('failed to authenticate')) return { ok: false, reason: 'auth', rawStderr: err.stderr ?? '' };
    if (msg.includes('cannot resolve'))         return { ok: false, reason: 'resolve', rawStderr: err.stderr ?? '' };
    if (err.killed)                             return { ok: false, reason: 'timeout', rawStderr: err.stderr ?? '' };
    return { ok: false, reason: 'unknown', rawStderr: err.stderr ?? err.message };
  }
}
```

### Example: Svelte 5 palette dialog open/close

```svelte
<script lang="ts">
  let dialogEl: HTMLDialogElement;
  let open = $state(false);

  function openPalette() {
    open = true;
    requestAnimationFrame(() => dialogEl?.showModal());
  }

  function close() {
    open = false;
    dialogEl?.close();
  }
</script>
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `multicast-dns` package | `bonjour-service` (TS rewrite) | 2022+ | Better TS types, active maintenance, drop-in mDNS browse/advertise. |
| `cmdk-sv` for Svelte | bits-ui Command OR hand-roll | 2024 (cmdk-sv deprecated) | Bits UI is heavy; hand-roll preferred for single use case. |
| `adb tcpip` + `adb connect` (legacy) | `adb pair` + `adb connect` over TLS | Android 11 (2020) | Mandatory for modern Android; encrypted; QR-pairable. |
| `node-cron` schedules | `pg-boss.schedule` | Phase 18-25 in this codebase | Already migrated; pairing TTL timers use `setTimeout` not pg-boss (in-memory session, not job). |

**Deprecated/outdated:**
- `cmdk-sv` — README says "Deprecated by the Command component in Bits UI" ([huntabyte/cmdk-sv](https://github.com/huntabyte/cmdk-sv)).
- `adb tcpip` flow — still works but unauthenticated; do not use for new code.

## Open Questions

1. **Discovery home: `server/pool/internal/discovery/` vs `server/devices/`?**
   - What we know: CONTEXT prescribes `server/devices/discovery.ts`. Pool MODULE.md owns adb/simctl shell-out today.
   - What's unclear: New top-level module breaks v3.0 MOD-01..09 conventions (no MODULE.md, factory, events.ts).
   - Recommendation: Default to `server/pool/internal/discovery/`. Surface via `createPoolModule`. If planner disagrees, follow CONTEXT verbatim and accept the convention break.

2. **`Platform` union extension vs `Device.kind` discriminator?**
   - What we know: Brief says `Device.kind` extends to `'physical-android'`.
   - What's unclear: Existing platform-based dispatch in jobs queue + CLI flags would need parallel migration if we change `Platform`.
   - Recommendation: Use `Device.kind` (less invasive). Driver dispatch becomes `(platform, kind) → DeviceDriver`.

3. **Pairing service location: `server/pool/internal/wireless/` vs `server/devices/pairing.ts`?**
   - What we know: CONTEXT prescribes `server/devices/pairing.ts`.
   - Recommendation: Co-locate with discovery to share mDNS code. `server/pool/internal/wireless/` (mDNS + pairing + connect).

4. **Cleanup interface — DeviceDriver.cleanup needs context for physical?**
   - What we know: Today `cleanup(emulatorId): Promise<void>`. Physical Android wants `installedBundles: string[]`.
   - Recommendation: Extend to `cleanup(emulatorId, context?: CleanupContext): Promise<void>`. Backwards-compat: optional 2nd arg.

5. **fuzzysort threshold — what's the right cutoff for "no match"?**
   - What we know: Default `-10000` (permissive), `-5000` typical for command palettes.
   - Recommendation: Start `-10000`, tune via user feedback in Phase 36 verification. Don't over-engineer.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.0.18 (server) + svelte-check 4 (web) |
| Config file | `vitest.config.ts` (root), `web/vitest.config.ts` if added |
| Quick run command | `npx vitest run server/pool/__tests__/discovery-poller.spec.ts -x` |
| Full suite command | `npm test` (server) + `cd web && npm run check` (web typecheck only — no web tests yet) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DISC-SVC | Discovery is sole `adb devices` / `simctl list` caller | grep | `npx vitest run server/pool/__tests__/discovery-sole-caller.spec.ts` | ❌ Wave 0 |
| DISC-SVC | Fingerprint dedup prevents re-emit storms | unit | `npx vitest run server/pool/__tests__/discovery-fingerprint.spec.ts` | ❌ Wave 0 |
| DISC-SVC | Diff events emit correct add/remove/change | unit | `npx vitest run server/pool/__tests__/discovery-poller.spec.ts` | ❌ Wave 0 |
| DISC-SVC | Mock adb/simctl → emits typed envelopes via bus | unit | `npx vitest run server/pool/__tests__/discovery-emit.spec.ts` | ❌ Wave 0 |
| PAIR-WIRELESS | mDNS browser fires on instance name match | unit (mock bonjour) | `npx vitest run server/pool/__tests__/wireless/mdns.spec.ts` | ❌ Wave 0 |
| PAIR-WIRELESS | `adb pair` output parsing — success/auth-fail/timeout | unit | `npx vitest run server/pool/__tests__/wireless/pair.spec.ts` | ❌ Wave 0 |
| PAIR-WIRELESS | Cross-subnet pairing rejected | unit | `npx vitest run server/pool/__tests__/wireless/subnet.spec.ts` | ❌ Wave 0 |
| PAIR-WIRELESS | PIN TTL expiry transitions session to 'expired' | unit | `npx vitest run server/pool/__tests__/wireless/session.spec.ts` | ❌ Wave 0 |
| PAIR-WIRELESS | QR payload format `WIFI:T:ADB;S:...;P:...;;` correct | unit | `npx vitest run server/pool/__tests__/wireless/qr.spec.ts` | ❌ Wave 0 |
| PHYS-ANDROID-DRIVER | boot() waits for boot_completed | unit (mock execFile) | `npx vitest run server/pool/__tests__/android/physical.spec.ts` | ❌ Wave 0 |
| PHYS-ANDROID-DRIVER | shutdown() is no-op | unit | (same file) | ❌ Wave 0 |
| PHYS-ANDROID-DRIVER | isHealthy() returns true on `device`, false on `offline` | unit | (same file) | ❌ Wave 0 |
| PAIR-WIZARD-UI | Wizard 3-state machine transitions correctly | manual | runbook `docs/runbooks/wireless-android.md` step-through | ❌ Wave 0 |
| CMD-PALETTE | ⌘K opens palette, Esc closes | unit (jsdom) | `npx vitest run web/src/lib/components/__tests__/CommandPalette.spec.ts` | ❌ Wave 0 |
| CMD-PALETTE | Typing "pixel" ranks Pixel 8 first | unit | (same file) | ❌ Wave 0 |
| CMD-PALETTE | Enter executes action | unit | (same file) | ❌ Wave 0 |
| CMD-PALETTE | Recents persist across reload (localStorage) | unit (jsdom) | `npx vitest run web/src/lib/command-palette/__tests__/recent.spec.ts` | ❌ Wave 0 |
| DISC-WS | WS frame on discovered.added | unit (mock WS) | `npx vitest run server/api/__tests__/devices-stream.spec.ts` | ❌ Wave 0 |
| DISC-WS | Web store applies diff frames | unit (jsdom) | `npx vitest run web/src/lib/stores/__tests__/devices.spec.ts` | ❌ Wave 0 |
| End-to-end | Real Pixel 8 pair → run Maestro job | manual | runbook `docs/runbooks/wireless-android.md` | ❌ Phase close |

### Sampling Rate

- **Per task commit:** `npx vitest run server/pool/__tests__/<specific-spec>.spec.ts` (sub-100ms)
- **Per wave merge:** `npx vitest run server/pool/__tests__/` (full pool suite, ~2s)
- **Phase gate:** `npm test && npm run lint && npm run dep-check && npm run typecheck && npm run nyquist:check` (all green) + manual runbook walkthrough

### Wave 0 Gaps

Substrate to ship in Wave 0 before any feature waves:

- [ ] `server/pool/internal/discovery/{poller.ts, fingerprint.ts, types.ts, adapters/android.ts, adapters/ios.ts}` — empty stubs that compile + 4-line types files
- [ ] `server/pool/internal/wireless/{mdns.ts, pair.ts, connect.ts, qr.ts, session.ts}` — stubs
- [ ] `server/pool/android/physical.ts` — stub class implementing `DeviceDriver` (returns Promise.reject so callers fail fast in pre-impl)
- [ ] `server/pool/events.ts` — extend `POOL_EVENT_NAMES` with 3 discovery names + 1 pairing audit event; add 3 payload schemas; extend `poolRegistry`
- [ ] `server/api/devices-stream.ts` — WS endpoint stub
- [ ] `web/src/lib/components/CommandPalette.svelte` — stub component
- [ ] `web/src/lib/command-palette/{registry.ts, recent.svelte.ts, fuzzy.ts}` — stubs
- [ ] `web/src/routes/devices/pair/+page.svelte` — stub page
- [ ] Dep installs: `npm install bonjour-service@^1.3.0 qrcode@^1.5.4 @types/qrcode --save-prod` (server); `cd web && npm install fuzzysort@^3.1.0 --save-prod` (web)
- [ ] Dep-cruiser rule `no-bare-adb-list-outside-discovery` added to `.dependency-cruiser.cjs`
- [ ] Spec scaffolds — empty `describe` blocks per row in the Test Map above, with `it.todo()` placeholders

## Sources

### Primary (HIGH confidence)
- simvyn reference: `/Users/heicg/Desktop/projects/_reference/simvyn/packages/core/src/device-manager.ts:35-114` (discovery poller pattern)
- simvyn reference: `/Users/heicg/Desktop/projects/_reference/simvyn/packages/dashboard/src/components/CommandPalette.tsx:1-277` (cmdk palette pattern)
- simvyn reference: `/Users/heicg/Desktop/projects/_reference/simvyn/packages/dashboard/src/components/command-palette/{actions.tsx, StepRenderer.tsx, DevicePicker.tsx, types.ts}` (multi-step action registry)
- simvyn reference: `/Users/heicg/Desktop/projects/_reference/simvyn/packages/core/src/adapters/android.ts:96-300` (adb shell-out patterns)
- Local pool MODULE.md: `/Users/heicg/Desktop/projects/device-farm/server/pool/MODULE.md` (events.ts patterns, MOD-01..09 conventions)
- Local pool events: `/Users/heicg/Desktop/projects/device-farm/server/pool/events.ts` (Phase 20 emit-helpers pattern to extend)
- [LineageOS ADB Wi-Fi developer docs](https://github.com/LineageOS/android_packages_modules_adb/blob/lineage-23.2/docs/dev/adb_wifi.md) — mDNS service types, QR format, port semantics
- [Android Developers ADB reference](https://developer.android.com/tools/adb) — `adb pair` / `adb connect` / `adb mdns services` commands

### Secondary (MEDIUM confidence)
- [bonjour-service npm + docs](https://www.npmjs.com/package/bonjour-service) — `Browser.find({type})` + `'up'` event signature
- [GitHub onlxltd/bonjour-service](https://github.com/onlxltd/bonjour-service) — API confirmation
- [qrcode (soldair/node-qrcode) npm](https://www.npmjs.com/package/qrcode) — `toDataURL` / `toString` API
- [npm-compare: fuzzysort vs fuse.js](https://npm-compare.com/fuse.js,fuzzy-search,fuzzysort) — performance characteristics
- [shadcn-svelte Command](https://www.shadcn-svelte.com/docs/components/command) — Svelte palette via bits-ui (alternative)
- [huntabyte/cmdk-sv](https://github.com/huntabyte/cmdk-sv) — deprecation notice

### Tertiary (LOW confidence — needs validation)
- [Android Enthusiasts SE #234465](https://android.stackexchange.com/questions/234465/) — `adb pair` QR pairing user-perspective walkthrough
- [profdayat/adb-wireless-qrcode (GitHub)](https://github.com/profdayat/adb-wireless-qrcode) — shell-script wireless QR pairing reference (could not fetch script body to verify exact commands)
- adb pair output format examples — collected from multiple Stack Exchange + medium articles; regex pattern in §"Example: adb pair" is conservative

## Metadata

**Confidence breakdown:**
- Discovery service design (simvyn port): HIGH — full source available + factored into our existing pool MODULE conventions
- Wireless pairing protocol: HIGH — Android source + LineageOS docs + Bonjour API all documented
- QR payload format: HIGH — multiple authoritative sources confirm `WIFI:T:ADB;S:...;P:...;;`
- PhysicalAndroidDriver: HIGH — straightforward adb shell-out, mirrors simvyn android.ts
- CommandPalette library choice: MEDIUM — cmdk-sv deprecated; bits-ui too heavy; hand-roll recommendation needs Phase 36 verification of LOC budget
- fuzzysort tuning: LOW — threshold values are heuristic; will need real-data tuning in verification

**Research date:** 2026-05-15
**Valid until:** 2026-06-15 (mDNS + ADB protocols are stable; library versions may bump but APIs stable)

## RESEARCH COMPLETE
