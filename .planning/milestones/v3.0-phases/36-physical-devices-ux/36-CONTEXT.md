# Phase 36: Physical Devices + Discovery + CommandPalette - Context

**Gathered:** 2026-05-15
**Status:** Ready for planning
**Source:** Pre-authored brief at `36-BRIEF.md` + cloned `simvyn` reference repo

<domain>
## Phase Boundary

Three independent tracks: (1) physical Android over wireless ADB (mDNS pair + QR pairing wizard); (2) refactor device discovery into a single polling service emitting diff events; (3) ⌘K command palette in web UI. Out of scope: physical iOS devices (separate concerns), Windows/Linux ADB pairing flows.

</domain>

<decisions>
## Implementation Decisions

### External Dependencies Policy (LOCKED)
**Reference repos are STUDY-ONLY.** simvyn at `/Users/heicg/Desktop/projects/_reference/simvyn/` is read-only — copy the unified-discovery service pattern, cmdk palette wiring, mDNS pairing flow, QR generation approach into `device-farm/`; do NOT add simvyn packages to package.json. Normal libs (bonjour, fuzzysort, QR rendering libs) remain fine.

### Authoritative Sources (LOCKED)
- `36-BRIEF.md` — task list, pairing flow, palette spec
- `/Users/heicg/Desktop/projects/_reference/simvyn/` — full reference (unified discovery + cmdk palette)
- `simutil` references in brief — wireless pairing technique

### Architecture
- `server/devices/discovery.ts` — single `DeviceDiscoveryService`; only caller of `adb devices` / `simctl list` (enforce via dep-cruiser rule)
- Emits `devices-changed` with diff events
- Physical Android driver implements `DeviceDriver` interface (existing platform-agnostic pool)
- Wireless pairing service: `server/devices/pairing.ts` — mDNS scan, `adb pair`, QR code generation
- Web `/devices/pair` route — 3-step wizard
- CommandPalette: Svelte component + fuzzysort; fuzzy search across devices/jobs/sessions/pages/actions; ⌘K shortcut

### Tasks (from brief)
- T-36.1: DeviceDiscoveryService (poller + fingerprint + events)
- T-36.2: Wireless ADB pairing service (mDNS, adb pair, QR)
- T-36.3: Physical-Android pool driver
- T-36.4: Pairing wizard UI (3 steps)
- T-36.5: CommandPalette (Svelte + fuzzysort)
- T-36.6: Discovery WS + dashboard live list

### Claude's Discretion
- mDNS Go vs Node implementation (prefer Node bonjour)
- QR rendering library
- Palette action registry shape
- Fuzzysort tuning thresholds

</decisions>

<canonical_refs>
## Canonical References

### Reference implementation (READ FIRST)
- `/Users/heicg/Desktop/projects/_reference/simvyn/packages/` — discovery service + palette
- `/Users/heicg/Desktop/projects/_reference/simvyn/.planning/` — original planning docs

### Existing local code
- `server/pool/` — existing driver pattern (`server/pool/types.ts` DeviceDriver interface)
- `server/pool/android/emulator.ts` — sibling driver to physical Android
- `server/pool/ios/simulator.ts` — sibling
- `web/src/routes/` — SvelteKit routing

### Phase brief
- `.planning/phases/36-physical-devices-ux/36-BRIEF.md`

</canonical_refs>

<specifics>
## Specific Ideas

- v2.0 audit "CLI shows deviceId UUID" fix lands here via discovery's `deviceName` field — referenced in brief as success criterion 4
- Mark only one caller for `adb devices` / `simctl list` — verified via grep in tests

</specifics>

<deferred>
## Deferred Ideas

- Physical iOS devices (WDA setup is separate work)
- USB-tethered pairing flows
- Discovery for Wear OS / tvOS

</deferred>

---

*Phase: 36-physical-devices-ux*
*Context gathered: 2026-05-15 via brief-derived smart discuss*
