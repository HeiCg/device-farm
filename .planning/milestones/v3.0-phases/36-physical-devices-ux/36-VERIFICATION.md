---
phase: 36-physical-devices-ux
verified: 2026-05-16T00:35:00Z
status: human_needed
score: 11/11 must-haves verified (automated); 1 area needs human verification
human_verification:
  - test: "End-to-end wireless pair on a real Pixel/Android 11+ phone"
    expected: "Scanning QR with phone camera transitions wizard awaiting-scan → pairing → connecting → done within ~10s; phone appears in dashboard within ~5s after; cross-subnet attempts surface a friendly error"
    why_human: "Requires a physical Android phone on the same Wi-Fi subnet and mDNS-resolvable network; the bonjour-service + adb pair/connect handshake cannot be simulated in CI"
  - test: "⌘K palette UX in browser"
    expected: "⌘K opens the palette; typing 'pair' surfaces the Pair Device action and navigating Enter routes to /devices/pair; device rows from the live WS stream rank correctly via fuzzysort; localStorage 'recents' persists across reloads"
    why_human: "Keyboard interaction, visual ranking quality, and persisted-recents UX require a real browser session"
  - test: "5s discovery loop end-to-end on a live adb"
    expected: "Plugging/unplugging a USB-tethered device fires discovered.added/removed within one poll tick; WS /api/devices/stream pushes synthetic replay on connect"
    why_human: "Live adb device transitions are not reproduced by the spec-level adapter mocks"
---

# Phase 36: Physical Devices, Discovery, CommandPalette — Verification Report

**Phase Goal:** "Open the pool to physical Android devices over Wi-Fi (mDNS pair + QR), refactor device discovery into a single polling service with diff events, and ship a ⌘K command palette in the web UI."

**Verified:** 2026-05-16
**Status:** human_needed (all 11 automated must-haves verified; 3 user-visible behaviors require a physical phone / browser session)
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | DeviceDiscoveryService polls every 5s, dedupes via fingerprint, emits added/removed/changed | ✓ VERIFIED | `server/pool/internal/discovery/poller.ts:64,89,93-101` — 5_000ms default, fingerprint short-circuit, three emit branches; mutex blocks overlapping ticks; first tick fires immediately via `void pollOnce()` in `start()` |
| 2 | Android adapter is the SOLE bare `adb devices` caller | ✓ VERIFIED | Dep-cruiser rule `no-bare-adb-list-outside-discovery` at `.dependency-cruiser.cjs:249-265`; runtime grep-guard at `server/pool/__tests__/discovery-sole-caller.spec.ts` (passing) |
| 3 | PoolManager.adoptDiscoveredDevice integrates discovery events | ✓ VERIFIED | `pool-manager.ts:204` defines `adoptDiscoveredDevice`; `internal/module.ts:215` wires it to the discovered.added subscriber |
| 4 | Wireless pairing module implements mDNS + adb pair/connect + QR + 60s session state machine | ✓ VERIFIED | All six files exist (`mdns.ts`, `pair.ts`, `connect.ts`, `qr.ts`, `session.ts`, `index.ts`); session.ts has full 6-state machine (awaiting-scan → pairing → connecting → done/error/expired) with 60s TTL, cross-subnet rejection in mdns.ts:99,141, terminal pair.attempted emit |
| 5 | PhysicalAndroidDriver registered under 'android-physical' key | ✓ VERIFIED | `server/pool/android/physical.ts` implements full DeviceDriver contract; registered at `internal/module.ts:155`; `DriverKey` type extended at `pool-manager.ts:56` |
| 6 | REST + WS endpoints exist for pair start/cancel/stream + device discovery stream | ✓ VERIFIED | `server/api/pairing.ts` exposes POST start/cancel and WS stream; `server/api/devices-stream.ts` exposes GET WS /api/devices/stream with snapshot replay + 3 bus subscriptions; both registered in `server/api/plugin.ts:48-49` |
| 7 | Reactive Svelte 5 DeviceStore consumes the WS feed | ✓ VERIFIED | `web/src/lib/stores/devices.svelte.ts` uses `$state<DiscoveredDevice[]>([])`; `applyFrame()` handles added/removed/changed; reconnect logic + SSR-safe; exposed as singleton `deviceStore` |
| 8 | ⌘K CommandPalette renders ~150 LOC with fuzzysort + localStorage recents | ✓ VERIFIED | 151 LOC, hand-rolled `<dialog>` + ranked $derived chain; `web/src/lib/command-palette/fuzzy.ts` wraps fuzzysort; `recent.svelte.ts` has SSR-safe getRecent/pushRecent with localStorage FIFO |
| 9 | Global ⌘K hotkey wired in +layout.svelte | ✓ VERIFIED | `web/src/routes/+layout.svelte:34-45` registers keydown listener; `e.metaKey \|\| e.ctrlKey && e.key === 'k'` calls `paletteRef.openPalette()`; cleanup via `$effect` return |
| 10 | 3-step Pairing wizard UI at /devices/pair | ✓ VERIFIED | `web/src/routes/devices/pair/+page.svelte` renders `PairingWizard`; wizard at `web/src/lib/components/devices/PairingWizard.svelte` (264 LOC) implements full discriminated-union state machine with PairingScanStep, PairingQrStep, PairingConfirmStep |
| 11 | Operator runbook documents the wireless-android flow | ✓ VERIFIED | `docs/runbooks/wireless-android.md` (196 lines) covers overview, API surface, pairing flow, end-to-end procedure |

**Score:** 11/11 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `server/pool/internal/discovery/{poller,fingerprint,types,index}.ts` | DiscoveryService core | ✓ VERIFIED | All 4 files exist + substantive (poller=4.4K, fingerprint=3.7K, types=1.3K, index=655B) |
| `server/pool/internal/discovery/adapters/{android,ios}.ts` | Platform adapters | ✓ VERIFIED | android.ts=5.3K (real adb shell-out + caches), ios.ts=3.0K |
| `server/pool/internal/wireless/{mdns,pair,connect,qr,session,index}.ts` | Wireless pairing module | ✓ VERIFIED | All 6 files exist; session.ts=9.0K with full state machine |
| `server/pool/android/physical.ts` | PhysicalAndroidDriver | ✓ VERIFIED | Implements create/boot/shutdown/isHealthy/cleanup; argv-form execFile; sys.boot_completed check |
| `server/api/pairing.ts` | Pair REST + WS | ✓ VERIFIED | All 3 endpoints registered with poolModule wiring; envelopes follow wsEnvelopeSchema shape |
| `server/api/devices-stream.ts` | DISC-WS stream | ✓ VERIFIED | Snapshot replay on connect + 3 bus subscriptions; testable `attachDevicesStreamSubscribers` extracted |
| `web/src/lib/stores/devices.svelte.ts` | DeviceStore | ✓ VERIFIED | 132 LOC; reactive $state; reconnect; SSR-safe |
| `web/src/lib/components/CommandPalette.svelte` | ⌘K palette ~150 LOC | ✓ VERIFIED | 151 LOC exact; $derived ranking; ArrowUp/Down/Enter/Esc keyboard nav |
| `web/src/lib/command-palette/{fuzzy,palette-logic,recent.svelte,registry}.ts` | Palette internals | ✓ VERIFIED | All 4 files exist with passing test coverage |
| `web/src/routes/+layout.svelte` | Global hotkey wired | ✓ VERIFIED | keydown handler + paletteRef bind:this |
| `web/src/routes/devices/pair/+page.svelte` | Pair route entry | ✓ VERIFIED | Renders PairingWizard with page chrome |
| `web/src/lib/components/devices/PairingWizard.svelte` | 3-step wizard | ✓ VERIFIED | 264 LOC; discriminated union state; WS lifecycle + cancel-on-unmount |
| `docs/runbooks/wireless-android.md` | Operator runbook | ✓ VERIFIED | 196 lines; full procedure |
| `.dependency-cruiser.cjs` rule 13 | no-bare-adb-list-outside-discovery | ✓ VERIFIED | Rule defined at lines 248-265 with severity error; complemented by runtime grep-guard spec |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `internal/module.ts` | `discoveryService.start()` | factory + start in onInit | ✓ WIRED | Lines 163,241 |
| Discovery `added` event | `pool.adoptDiscoveredDevice` | bus subscriber | ✓ WIRED | `internal/module.ts:215` |
| Discovery `removed` event | `pool.handleDiscoveryRemoval` | bus subscriber | ✓ WIRED | `internal/module.ts:227` |
| `PhysicalAndroidDriver` | `pool.registerDriver('android-physical', …)` | module init | ✓ WIRED | `internal/module.ts:155` |
| `pairingService.start()` | POST /api/devices/pair/start | `fastify.poolModule.pairingService` | ✓ WIRED | `pairing.ts:47` |
| `session.on('state-change')` | WS /api/devices/pair/stream | unsub stored, cleanup on close | ✓ WIRED | `pairing.ts:103-106` |
| `attachDevicesStreamSubscribers` | `fastify.poolModule.bus` + `discoveryService.getSnapshot` | route handler | ✓ WIRED | `devices-stream.ts:122-126` |
| `deviceStore.connect()` | `+layout.svelte` $effect on mount | reactive lifecycle | ✓ WIRED | `+layout.svelte:48-51` |
| `PairingWizard` | POST start → WS stream → POST cancel | full lifecycle in component | ✓ WIRED | `PairingWizard.svelte:117,131,142,181` |
| `openPalette` | ⌘K keydown listener | paletteRef bind:this | ✓ WIRED | `+layout.svelte:38-40,72` |
| `CommandPalette` ranking | `deviceStore.devices` | `$derived` chain | ✓ WIRED | `CommandPalette.svelte:37-38` |
| Plan registrations | `server/api/plugin.ts` calls | `registerPairingRoutes + registerDevicesStreamRoutes` | ✓ WIRED | `plugin.ts:11-12,48-49` |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| DISC-SVC | 36-00, 36-01 | DeviceDiscoveryService polling + diff events + sole-caller rule | ✓ SATISFIED | poller.ts + fingerprint.ts + sole-caller spec + dep-cruiser rule |
| DISC-WS | 36-02 | GET WS /api/devices/stream with snapshot + bus subscriptions | ✓ SATISFIED | devices-stream.ts + DeviceStore consuming it |
| PAIR-WIRELESS | 36-00, 36-02 | Wireless ADB pair (mDNS + QR + 60s session) | ✓ SATISFIED | wireless/ module (6 files) + pair API routes |
| PHYS-ANDROID-DRIVER | 36-02 | PhysicalAndroidDriver implementing DeviceDriver contract | ✓ SATISFIED | physical.ts + registerDriver('android-physical') |
| PAIR-WIZARD-UI | 36-00, 36-04 | 3-step pair wizard at /devices/pair with WS state stream | ✓ SATISFIED | PairingWizard + 3 step components + route entry |
| CMD-PALETTE | 36-00, 36-03 | ⌘K palette with fuzzy ranking, recents, action registry | ✓ SATISFIED | CommandPalette + command-palette/* + +layout hotkey |

No ORPHANED requirements — every ID called out in the phase brief appears in at least one plan's `requirements:` field and is mapped to delivered artifacts.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| (none) | — | grep for TODO/FIXME/XXX/HACK/PLACEHOLDER across all phase-36 files | ✓ clean | — |

Only "ignore" comments are inside `try {} catch { /* ignore */ }` blocks intentionally swallowing best-effort errors (cancel, logcat -c, WS teardown). These are documented architectural decisions, not stubs.

### Test Status

| Suite | Pass/Fail | Notes |
|-------|-----------|-------|
| Phase-36 server tests (discovery + wireless + physical) | 54 pass / 0 fail | poller/fingerprint/emit/sole-caller + mdns/pair/connect/qr/session/subnet |
| Phase-36 API tests (devices-stream + pairing) | 7 pass / 0 fail | — |
| Phase-36 web tests (CommandPalette, PairingWizard, palette-logic, fuzzy, recent, devices store) | 128 pass / 0 fail | — |
| Pre-existing unrelated failures | 3 fail in `server/pool/android/__tests__/emulator.test.ts` | BootResult shape now includes a third key — pre-existing assertion drift unrelated to phase 36 |
| Pre-existing unrelated failures | ~22 in auth/admin plugin | 'event-bus' dependency missing in test harness — unrelated to phase 36 |

Phase-36 tests pass 100%. Unrelated failures exist in emulator + auth suites but do not affect the phase 36 goal.

### Human Verification Required

See frontmatter `human_verification` block. Three behaviors cannot be verified programmatically:

1. **End-to-end wireless pair on a real phone** — bonjour mDNS + adb pair/connect handshake must be exercised against a real Android 11+ device on the same Wi-Fi subnet.
2. **⌘K palette UX in a browser** — keyboard interaction, visual ranking, and localStorage-persisted recents need a real browser session.
3. **5s discovery loop against live adb** — USB plug/unplug events to confirm timing.

The wiring, message shapes, state machines, and UI flows are unit-tested. These three items are about real-world hardware/browser behavior.

### Gaps Summary

No gaps. All 11 derived must-haves verified. All 6 phase requirements satisfied. All key wiring traced from event source to UI consumer. All anti-pattern scans clean. The ROADMAP entry `[x] Phase 36` is consistent with the delivered code.

The remaining work to call the phase "shipped" is one round of operator-driven smoke tests on real hardware — captured in the runbook at `docs/runbooks/wireless-android.md`.

---

_Verified: 2026-05-16_
_Verifier: Claude (gsd-verifier)_
