# Phase 36 — Physical Devices, Unified Discovery, CommandPalette

**Track:** DF
**Effort:** ~4 days
**Source ideas:** simutil (wireless ADB pair + QR), simvyn (unified discovery service), simvyn (cmdk command palette)

## Goal

Open the device-farm to physical Android devices over Wi-Fi (pair, connect, allocate, run); refactor device discovery into a single polling service that emits events to the rest of the codebase; ship a `cmdk`-style command palette in the web UI as the keyboard-first way to operate.

## Why

Three pains addressed at once because they share the same surface (`server/pool/`, `web/`):

1. **Physical Android coverage**. Today the pool only supports emulators. Real Android coverage requires USB or a wireless setup. Wireless adb pairing has been standard since Android 11 and is trivial to expose.
2. **Discovery duplication**. `server/pool/android/avd.ts`, `ios/simulator.ts`, and ad-hoc `lifecycle/reconciler` each call `adb devices` / `simctl list` independently. A single discovery service simplifies things and gives us "device connected / disconnected" events for the UI.
3. **Web UX cliff**. The dashboard relies entirely on point-and-click. A command palette ("`⌘K` → run job on Pixel 8 → start session") is a single-day win that 10x the keyboard-first workflow.

## Scope

### In
- Wireless ADB pairing via mDNS `_adb-tls-pairing._tcp` (Node `multicast-dns` package).
- `adb pair <host> <pin>` + `adb connect <host>` orchestration.
- QR code pairing UI (Android scans `WIFI:T:ADB;S:<name>;P:<pin>;;`).
- New "physical-android" pool driver alongside the AVD driver.
- `DeviceDiscoveryService` — single 5s polling loop emitting `{added, removed, changed}` events; consumers subscribe.
- Fingerprint-dedup so noisy callers don't get re-emit storms.
- CommandPalette in web UI with fuzzy search across: devices, jobs, sessions, runbooks, actions.

### Out
- iOS physical devices (different transport, deferred)
- USB-pair for Linux (macOS-first; Linux follows by leveraging the same `adb` codepath)
- Web-app screen mirroring for the paired device (relies on Phase 33 for emulator; physical Android on scrcpy as today)

## Tasks

### T-36.1 — DeviceDiscoveryService (~6h)

**Files**
- `server/pool/discovery/index.ts` (new plugin, depends on `db`, `config`)
- `server/pool/discovery/poller.ts` — 5s loop
- `server/pool/discovery/fingerprint.ts` — stable key per device
- `server/pool/discovery/events.ts` — `EventEmitter` typed
- `server/pool/discovery/__tests__/poller.test.ts`

**Poller**

```
async poll():
  ios     = await listIosSims()        // xcrun simctl list devices --json
  iosPhys = await listIosPhys()        // xcrun devicectl list devices --json-output <tmp>
  androidEmu = await listAndroidEmus() // adb devices + emu avd name + emulator -list-avds
  androidPhys = await listAndroidPhys()// adb devices filter !emulator-* + adb -s ... shell getprop
  all = [...]
  fp = stableFingerprint(all)
  if fp !== lastFp: emit('devices-changed', diff(prev, all)); lastFp = fp
```

`fingerprint` = JSON.stringify(`all.map(d => [d.id, d.state])`).

**Adopters** (refactor to subscribe instead of own-poll):
- `server/pool/pool-manager.ts` — reconciliation reads from discovery emitter.
- `web` — new WS endpoint `/api/devices/stream` that wraps discovery events.
- `server/lifecycle/` — uses events to orphan-cleanup zombie processes.

### T-36.2 — Wireless ADB pairing service (~6h)

**Files**
- `server/pool/android/wireless/mdns.ts` — `_adb-tls-pairing._tcp` scanner
- `server/pool/android/wireless/pair.ts` — `adb pair <host>:<port> <pin>`
- `server/pool/android/wireless/connect.ts` — `adb connect <host>:<port>`
- `server/pool/android/wireless/qr.ts` — generates `WIFI:T:ADB;S:<name>;P:<pin>;;`
- `server/api/pairing.ts` — `POST /api/devices/pair`, `POST /api/devices/connect`, WS `/api/devices/discovery`
- `server/pool/android/wireless/__tests__/*.test.ts`

**Dependencies**
- `multicast-dns@^7.2.5`
- `qrcode@^1.5.4` (for server-side QR generation if not pure-client)

**Flow**

```
1. UI opens "Pair device" modal -> WS /api/devices/discovery
2. Server starts mDNS query for _adb-tls-pairing._tcp.local; emits each PTR->SRV->A hit
3. User picks a device; modal shows QR with `WIFI:T:ADB;S:devicefarm;P:<random6digit>;;`
4. Android device "Pair with QR" scans -> emulator hits mDNS; server gets host+port
5. Server runs `adb pair host:port pin`; success -> stores device entry
6. Server runs `adb connect host:<connect-port>` (different port from pair)
7. Discovery service picks up new `adb devices` entry on next tick
```

**Security**
- PINs are 6 random digits with 60s TTL.
- Reject pairing attempts from RFC1918 ranges *not* on the same subnet as the host (`os.networkInterfaces()` check) — prevents accidental cross-VLAN pairing.
- Audit log every pair attempt.

### T-36.3 — Physical-Android pool driver (~4h)

**Files**
- `server/pool/android/physical.ts` — implements `DeviceDriver`
- `server/pool/pool-manager.ts` — register driver
- `server/types/index.ts` — `Device.kind` extends `'physical-android'`

`DeviceDriver` lifecycle for physical:
- `create`: no-op (devices arrive paired)
- `boot`: `adb -s <serial> wait-for-device` + verify `getprop sys.boot_completed`
- `isHealthy`: `adb -s <serial> get-state` == `device`
- `shutdown`: no-op (cannot power off a real phone)
- `cleanup`: `adb -s <serial> shell pm uninstall <bundle>` for installed test apps + clear data

Concurrency: physical devices are single-allocated; mark `pool.maxConcurrent = 1` for each.

### T-36.4 — Pairing UI (~5h)

**Files**
- `web/src/routes/devices/pair/+page.svelte`
- `web/src/lib/components/PairingWizard.svelte` (3 steps: scan → QR → confirm)
- `web/src/lib/qr.ts` — wraps `qrcode` browser package

3-state wizard driven by Svelte 5 runes:

```
$state state = 'scanning' | 'qr-shown' | 'confirming' | 'done' | 'error'
```

UX cribbed from simutil `wireless_pairing_dialog.dart` (`/tmp` clones gone — see references).

### T-36.5 — CommandPalette (~6h)

**Files**
- `web/src/lib/components/CommandPalette.svelte`
- `web/src/lib/command-registry.ts` — typed registry
- `web/src/routes/+layout.svelte` — global `⌘K` handler
- `web/package.json` — add `cmdk-svelte` (or hand-roll ~120 LOC with Svelte 5 + fuzzysort)

**Sources**
- Devices (live from discovery WS): "Open Pixel 8 stream", "Lease Pixel 8 session"
- Jobs (last 50): "Open job <name>"
- Sessions (active): "Release session X"
- Pages: "Settings", "Pair device", "Explorations"
- Actions: "Run latest job again", "Clear logs viewer"

Fuzzy match via `fuzzysort@^3` (~6KB). Keyboard navigation, arrow-up/down/enter.

### T-36.6 — Discovery WS + dashboard live list (~2h)

**Files**
- `server/api/devices.ts` — `WS /api/devices/stream` (subscribes to DeviceDiscoveryService)
- `web/src/lib/stores/devices.svelte.ts` (port to runes from existing store)
- `web/src/routes/+page.svelte` — devices list updates without page reload

## Acceptance criteria

- [ ] mDNS scan picks up a Pixel 8 with "Wireless debugging" enabled within 5s.
- [ ] Pairing wizard end-to-end: device shows up in pool, allocatable, runs a Maestro job.
- [ ] Single discovery service is the only caller of `adb devices` / `simctl list` (grep verifies).
- [ ] `devices-changed` events fan out to UI in < 1s of plug/unplug.
- [ ] `⌘K` opens palette; typing "pixel" navigates to the device card; `Enter` opens stream.
- [ ] No reduction in functionality for emulator-only setups.
- [ ] v2.0 audit item "CLI shows deviceId UUID, not device name" fixed for free via discovery's `deviceName` field.

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| `multicast-dns` package is unmaintained | It's stable; alternative `bonjour-service` if needed |
| Cross-VLAN pairing accidental exposure | Subnet check (T-36.2 security) + audit log |
| Discovery race during pool reconcile | Single emitter, queue subscribers, no re-entrant polls (mutex) |
| `cmdk-svelte` not stable on Svelte 5 yet | Hand-roll ~120 LOC; pattern is well-known |
| Physical device pulled mid-job | Device transitions to `Error`; job marked `failed` with reason `'device-disconnected'` |

## References

- simutil: `lib/services/wifi_discovery_service.dart` (mDNS pattern)
- simutil: `lib/services/android_device_service.dart:198-243` (pair flow)
- simutil: `lib/services/android_device_service.dart:225-243` (`adb pair`)
- simutil: `lib/plugins/adb_tools/qr_connect_dialog.dart:54` (QR string format)
- simvyn: `packages/core/src/device-manager.ts:35-114` (unified discovery + fingerprint)
- simvyn: `packages/dashboard/src/components/CommandPalette.tsx`
- Current code: `server/pool/`, `server/lifecycle/`, `server/api/devices.ts`, `web/src/lib/stores/`

## Done = Nyquist-compliant

mDNS mock test, pair flow integration test (mock adb), discovery diff unit test, palette UX snapshot test, end-to-end with a real Pixel device documented in `docs/runbooks/wireless-android.md`.
