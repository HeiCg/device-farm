# Phase 32: SimulatorKit Private Bridge - Context

**Gathered:** 2026-05-15
**Status:** Ready for planning
**Source:** Pre-authored brief at `32-BRIEF.md` (treated as locked decisions) + cloned reference repo

<domain>
## Phase Boundary

Replace ScreenCaptureKit-based iOS simulator capture (`device-stream/native-servers/sim-capture/`) with SimulatorKit private API bridge (`device-stream/native-servers/sim-capture-private/`) that gets IOSurface frames directly from the simulator backboard process — no TCC prompt, no compositor latency, headless capable. Maintain ScreenCaptureKit fallback path. Out of scope: iOS physical devices, macOS GUI app, code-signing automation.

</domain>

<decisions>
## Implementation Decisions

### External Dependencies Policy (LOCKED — applies to all 32-37)
**Reference repos are STUDY-ONLY.** kittyfarm, simvyn, revyl-cli, app-explorer, mobile-devtools are cloned at `/Users/heicg/Desktop/projects/_reference/` for reading and copying ideas/algorithms/pseudocode. **Never** add them as npm/Go/CocoaPods/SwiftPM dependencies. Code is transcribed and adapted into `device-stream/` and `device-farm/server|cli|web/` namespaces, never linked. Normal third-party libs (zod, fastify, drizzle, grpc-go, etc.) remain fine — the prohibition is on the reference repos themselves.

### Authoritative Sources (LOCKED)
- `32-BRIEF.md` is the spec — task list, file layout, IPC contract, acceptance criteria are all locked
- `/Users/heicg/Desktop/projects/_reference/kittyfarm/KittyFarm/PrivateSimulator/DFPrivateSimulatorDisplayBridge.m` (3022 LOC) — copy dyld trie walker (~lines 259-457), attach sequence (~2027-2340), HID send (~line 884)
- `/Users/heicg/Desktop/projects/_reference/kittyfarm/KittyFarm/PrivateSimulator/DFPrivateSimulatorDisplayBridge.h` — public API surface
- `/Users/heicg/Desktop/projects/_reference/kittyfarm/KittyFarm/Connections/IOSSimulatorConnection.swift` — Swift integration pattern
- `/Users/heicg/Desktop/projects/_reference/kittyfarm/KittyFarm/Support/KittyFarm-Bridging-Header.h` — Obj-C↔Swift bridging
- Existing `device-stream/packages/ios-simulator/` and `device-stream/native-servers/sim-capture/` — keep API contract identical so consumers don't change

### Architecture
- Helper is daemon (Obj-C++), spawned by Node, communicates over Unix socket
- IPC: length-prefixed framed messages — kinds 0x01 SPS+PPS / 0x02 AU / 0x10 ack / 0xFF error / 0xC1 touch / 0xC9 quit
- Encoder: VTCompressionSession, Baseline_AutoLevel, 30fps keyframes, 4 Mbps
- Symbol resolution: dyld exports-trie walker; reject early if any of 8 critical Swift symbols cannot be resolved; print which one
- Fallback: env `DEVICE_STREAM_SIM_PRIVATE=0` or trie-walk failure → ScreenCaptureKit path

### Tasks (from brief)
- T-32.1: Skeleton helper + dlopen + class resolution (~6h)
- T-32.2: Screen attach + frame callback (IOSurface → CVPixelBuffer) (~6h)
- T-32.3: HID injection for touch (IndigoHIDMessage) (~4h)
- T-32.4: H.264 encode (VideoToolbox) + Unix socket IPC (~6h)
- T-32.5: TypeScript adapter swap with fallback (~3h)
- T-32.6: Build script + postinstall integration (~2h)
- T-32.7: Runbook + CI matrix (Xcode versions) (~3h)

### Claude's Discretion
- Exact directory layout under `sim-capture-private/` (subfolders, naming) — match `sim-capture/` conventions
- XcodeGen project.yml structure — minimal, single target, no UI
- Test scaffolding (Obj-C unit tests vs Swift) — pick whichever integrates cleanest with existing CI
- Logging library — use whatever `sim-capture/` already uses

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Reference implementation (READ FIRST)
- `/Users/heicg/Desktop/projects/_reference/kittyfarm/KittyFarm/PrivateSimulator/DFPrivateSimulatorDisplayBridge.m` — full bridge (3022 LOC)
- `/Users/heicg/Desktop/projects/_reference/kittyfarm/KittyFarm/PrivateSimulator/DFPrivateSimulatorDisplayBridge.h` — public surface
- `/Users/heicg/Desktop/projects/_reference/kittyfarm/KittyFarm/PrivateSimulator/DFPrivateSimulatorChromeBridge.m` — secondary bridge (chrome window)
- `/Users/heicg/Desktop/projects/_reference/kittyfarm/KittyFarm/Connections/IOSSimulatorConnection.swift` — integration

### Existing local code to preserve interface with
- `device-stream/packages/ios-simulator/src/service.ts` — Node-side consumer (will be modified, must keep API)
- `device-stream/native-servers/sim-capture/` — existing ScreenCaptureKit helper (kept as fallback)
- `device-stream/scripts/postinstall.js` — install hook to extend

### Phase brief
- `.planning/phases/32-simulatorkit-bridge/32-BRIEF.md` — locked design

</canonical_refs>

<specifics>
## Specific Ideas

- Mirror existing `sim-capture/` structure exactly for `sim-capture-private/` — same file layout, same scripts pattern, same install path conventions
- The dyld trie walker is the ONE piece of subtle code — copy from kittyfarm verbatim with minimal style adaptation
- IPC socket path convention: `/tmp/device-stream-sim-<udid>.sock`
- Default to private bridge ON after first successful Xcode-matrix CI run; ship with `DEVICE_STREAM_SIM_PRIVATE` opt-out from day one

</specifics>

<deferred>
## Deferred Ideas

- Code-signing of helper (run unsigned for dev; deferred to post-canary)
- Multi-display support (current iOS sim is always single display)
- iOS 18+ simulator API regressions (deal with when they happen, CI matrix surfaces early)

</deferred>

---

*Phase: 32-simulatorkit-bridge*
*Context gathered: 2026-05-15 via brief-derived smart discuss*
