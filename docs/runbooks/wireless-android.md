# Runbook: Wireless Android Pairing

Phase 36 Plan 36-04 — end-to-end procedure for pairing a real Android phone
(Pixel 8, etc.) to Device Farm over wireless ADB using the in-app pairing
wizard.

## Overview

Device Farm can manage real Android devices alongside its emulator pool.
Wireless ADB (Android 11+) lets an operator add a phone to the lab without
USB cables: scan a QR code with the phone's camera, the server pairs +
connects automatically, and the device shows up in the dashboard within
~5 seconds.

The flow lives at <http://localhost:5173/devices/pair> (or via the ⌘K
palette: type "pair" → Enter). It is backed by:

- `POST /api/devices/pair/start` → returns QR data URL + 6-digit PIN + 60s
  TTL session.
- `WS   /api/devices/pair/stream?sessionId=…` → state-transition envelopes
  (`awaiting-scan` → `pairing` → `connecting` → `done`).
- `POST /api/devices/pair/cancel` → operator-initiated abort.

After a successful pair, the `DeviceDiscoveryService` (5-second poll over
`adb devices`) emits `device.discovered.added`; the pool subscriber
invokes `adoptDiscoveredDevice` which registers the device under the
`android-physical` driver key. The web dashboard's `WS
/api/devices/stream` then pushes a frame and the live device list
updates.

## Prerequisites

- **Android phone, Android 11+** with Developer Options enabled.
- **Phone and dev machine on the same Wi-Fi subnet.** No VPN on the
  laptop; no guest VLAN on the phone; no Tailscale interface as the
  bind. Cross-subnet pairing is rejected at the mDNS layer for security.
- **`adb` in PATH** on the dev machine (`adb version` should print a
  version string ≥ 33). Install via `brew install android-platform-tools`
  on macOS.
- **Device Farm server running** (`npm run dev` listening on :3000).
- **Web dashboard reachable** (`cd web && npm run dev` on :5173, or
  the production build served by the server's static plugin).

## Procedure

1. **Enable Wireless Debugging on the phone.**
   - Settings → System → Developer Options → Wireless debugging → toggle
     **on**.
   - Tap **"Pair device with QR code"**. The phone's camera opens and
     waits for a QR.

2. **Open the pairing wizard.**
   - Browser: <http://localhost:5173/devices/pair>, or
   - Press ⌘K (Mac) / Ctrl+K (Linux/Windows), type "pair", press Enter.

3. **Click "Start pairing".**
   - The wizard POSTs `/api/devices/pair/start`, receives the QR data
     URL + PIN + 60-second TTL, and renders Step 2.

4. **Point the phone's camera at the QR.**
   - Within ~3 seconds the phone advertises its `_adb-tls-pairing._tcp`
     service via mDNS.
   - The server's `bonjour-service` browser picks it up, the WS frame
     transitions: `awaiting-scan → pairing → connecting → done`.
   - The wizard shows "Successfully paired <phone-model>".

5. **Verify the device joined the lab.**
   - Navigate to the dashboard home (<http://localhost:5173/>).
   - Within 5 seconds (discovery poll) the new device appears in the
     live list with the phone's model name and `state=Idle`.

6. **Run a Maestro job against the physical device.**
   - From the CLI:
     ```bash
     ./cli/bin/device-farm run \
       --server http://localhost:3000 \
       --platform android-physical \
       /path/to/flow.yaml
     ```
   - Or queue it from the web UI's job submission form (select
     `android-physical` as the platform).

7. **Unpair when done.**
   - On the phone: toggle Wireless debugging **off**, OR
   - On the dev machine: `adb disconnect <host>:<port>` (the dashboard
     will reflect the removal within 5s as the discovery poll emits
     `device.discovered.removed`).

## Operator verification checklist (real Pixel 8)

Run this top-to-bottom on first deployment and after every pairing
service change:

- [ ] mDNS scan picks up the phone within 5 seconds of clicking
      "Start pairing".
- [ ] `adb pair` completes within 10 seconds (wizard transitions from
      `awaiting-scan` to `pairing`).
- [ ] `adb connect` completes within 5 seconds (wizard transitions
      from `pairing` to `connecting` to `done`).
- [ ] Device appears in dashboard within 5 seconds of `done` (discovery
      poller picked it up via `adb devices`).
- [ ] A Maestro job runs to completion against the physical device.
- [ ] Disabling Wireless debugging on the phone causes the device to
      drop off the dashboard within 5 seconds (`device.discovered.removed`).

## Troubleshooting

### PIN expired before scan

The wizard's 60-second TTL fired (or the server's matching TTL). Click
**"Try again"** in the wizard. The server cleans up the session
automatically; no manual `adb` intervention needed.

### "Cross-subnet pairing rejected"

The phone advertises mDNS on a different subnet than the server. Common
causes:

- The laptop is on a corporate VPN — disconnect.
- The phone is on a guest Wi-Fi VLAN — switch to the same SSID as the
  laptop.
- The laptop has Tailscale/Mullvad running and the mDNS browser bound
  to the tunnel interface — disable the tunnel, retry.

The server uses `os.networkInterfaces()` to compute valid local
subnets per interface, then rejects mDNS records whose source IP
isn't in any of them. This is enforced at the mDNS layer, before any
`adb pair` shell-out.

### `adb pair` reports `failed to authenticate`

The QR's PIN didn't match what the phone sent. Causes:

- The QR is stale (an old wizard window left open). Close any other
  `/devices/pair` tabs and retry.
- The phone's clock is wrong (TLS handshake fails). Set the phone
  clock to network-synced time.

Retry: click **"Try again"** in the wizard.

### Phone doesn't appear after `done`

Possible causes:

- Discovery poll cycle is mid-tick. Wait 5 seconds.
- `adb devices` doesn't show the phone (run manually to verify).
  - If absent: the pair succeeded but the connect didn't. Try
    `adb connect <host>:<port>` manually (host:port shown in the
    wizard's `pairing` step).
- The device adopted but the dashboard WS dropped. Refresh
  the dashboard tab — the `WS /api/devices/stream` replays the
  current snapshot on connect.

### Server logs show `pair.attempted` with `outcome=unknown`

The terminal pair-attempt event fires `outcome` based on:

- `success` — full pair + connect succeeded.
- `auth-fail` — PIN rejected by adb.
- `timeout` — 60s TTL elapsed.
- `cross-subnet` — mDNS rejected the device.
- `unknown` — anything else (typically wrapped `EnoEnt` from a stale
  `adb` binary or a thrown exception from a child process).

For `unknown`, check the server's pino log near the timestamp — the
underlying error is logged at `warn` level with `err` + `sessionId`.

## Cleanup

To revoke a paired device without disabling developer options:

```bash
adb disconnect <host>:<port>
```

Find `<host>:<port>` either from the wizard's `pairing` step (visible
in the "Pairing…" message) or by running `adb devices -l`. The
`DeviceDiscoveryService` will detect the disconnect on the next 5s
poll and emit `device.discovered.removed`; the dashboard updates
automatically.

To revoke ALL paired devices and reset the trust store:

```bash
adb kill-server
adb start-server
```

Then on the phone: Settings → Developer Options → Wireless debugging
→ "Forget all paired computers".

---

*Phase: 36-physical-devices-ux*
*Plan: 36-04*
*Updated: 2026-05-16*
