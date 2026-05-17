# Phase 33: Android gRPC EmulatorController - Context

**Gathered:** 2026-05-15
**Status:** Ready for planning
**Source:** Pre-authored brief at `33-BRIEF.md` + cloned reference repo

<domain>
## Phase Boundary

Stream Android emulator frames and inject input via the emulator's built-in gRPC EmulatorController + MMAP transport, eliminating the scrcpy-server.jar dependency for emulators. Physical Android devices stay on scrcpy (out of scope). Adds `DEVICE_STREAM_ANDROID_GRPC=0` opt-out and clean fallback when discovery fails.

</domain>

<decisions>
## Implementation Decisions

### External Dependencies Policy (LOCKED)
**Reference repos are STUDY-ONLY.** kittyfarm, simvyn, revyl-cli, app-explorer, mobile-devtools at `/Users/heicg/Desktop/projects/_reference/` are read-only references — copy ideas/algorithms/pseudocode into `device-stream/`/`device-farm/`, never link as deps. Normal libs (zod, fastify, grpc-go, protoc plugins) remain fine.

### Authoritative Sources (LOCKED)
- `33-BRIEF.md` is the spec — task list, IPC contract, acceptance criteria are locked
- `/Users/heicg/Desktop/projects/_reference/kittyfarm/KittyFarm/Capture/GRPCFrameService.swift` (482 LOC) — frame-streaming reference
- `/Users/heicg/Desktop/projects/_reference/kittyfarm/KittyFarm/Capture/AndroidEmulatorAuth.swift` (103 LOC) — auth token discovery
- `/Users/heicg/Desktop/projects/_reference/kittyfarm/KittyFarm/Generated/emulator_controller_kittyfarm.proto` (or `.grpc.swift` + `.pb.swift`) — proto + generated stubs reference
- `/Users/heicg/Desktop/projects/_reference/kittyfarm/KittyFarm/Input/GRPCTouchInjector.swift` — touch over gRPC
- Existing `device-stream/packages/android/` — keep API contract identical for consumers

### Architecture
- Translate kittyfarm Swift reference into Go (for native server) since device-farm CLI is Go and existing Android transport pieces lean toward shell-out from Node
- Auth token discovery: `~/Library/Caches/TemporaryItems/avd/running/pid_<pid>.ini` keyed by `grpc.port`; fallback to `~/.emulator_console_auth_token`
- MMAP transport: read raw frames from shared-memory ring; gRPC for control plane (touch, key, lifecycle)
- IPC contract from helper to Node: same length-prefixed framed protocol as sim-capture-private (Phase 32) for consistency
- Fallback: env `DEVICE_STREAM_ANDROID_GRPC=0` or auth-token discovery failure → scrcpy path

### Tasks (from brief)
- T-33.1: Proto + Go gRPC stubs (~3h)
- T-33.2: Auth token discovery (.ini parser + fallback) (~3h)
- T-33.3: gRPC client + MMAP frame reader (~6h)
- T-33.4: H.264 encoder + Unix socket IPC bridge (~5h)
- T-33.5: Spawn emulator with `-grpc` + Pool integration (~4h)
- T-33.6: TypeScript service swap with fallback (~3h)
- T-33.7: Touch + key control parity (sendTouch, sendKey) (~4h)
- T-33.8: Postinstall + scrcpy fetch made conditional (~2h)

### Claude's Discretion
- Go module layout within `device-stream/native-servers/android-grpc/`
- Choice of gRPC code-gen tool (`protoc-gen-go-grpc` standard)
- Whether to ship MMAP reader in pure Go via cgo or shell-out — prefer pure Go via `golang.org/x/exp/mmap` if possible
- Test fixtures (recorded MMAP frames vs live emulator)

</decisions>

<canonical_refs>
## Canonical References

### Reference implementation (READ FIRST)
- `/Users/heicg/Desktop/projects/_reference/kittyfarm/KittyFarm/Capture/GRPCFrameService.swift` — frame service
- `/Users/heicg/Desktop/projects/_reference/kittyfarm/KittyFarm/Capture/AndroidEmulatorAuth.swift` — auth
- `/Users/heicg/Desktop/projects/_reference/kittyfarm/KittyFarm/Generated/emulator_controller_kittyfarm.pb.swift` — proto types (generated)
- `/Users/heicg/Desktop/projects/_reference/kittyfarm/KittyFarm/Generated/emulator_controller_kittyfarm.grpc.swift` — gRPC stubs (generated)
- `/Users/heicg/Desktop/projects/_reference/kittyfarm/KittyFarm/Input/GRPCTouchInjector.swift` — touch
- `/Users/heicg/Desktop/projects/_reference/kittyfarm/Protos/` — proto sources

### Existing local code
- `device-stream/packages/android/` — Node-side consumer
- `device-stream/native-servers/` — sibling helpers (sim-capture, etc.)
- `server/pool/android/emulator.ts` — emulator spawn site (needs `-grpc` flag injection)

### Phase brief
- `.planning/phases/33-android-grpc/33-BRIEF.md`

</canonical_refs>

<specifics>
## Specific Ideas

- Use same IPC framing as Phase 32 sim-capture-private for cross-helper consistency
- Emulator gRPC port discovery: parse `pid_<pid>.ini`, key `grpc.port`
- Default off until canary period — `DEVICE_STREAM_ANDROID_GRPC=1` opt-in initially, flip to default-on after one week

</specifics>

<deferred>
## Deferred Ideas

- Physical Android devices over gRPC (out of scope; stays on scrcpy)
- Audio capture (gRPC EmulatorController doesn't currently expose audio cleanly)
- Anti-frame-loss on backpressure (rely on MMAP ring semantics for now)

</deferred>

---

*Phase: 33-android-grpc*
*Context gathered: 2026-05-15 via brief-derived smart discuss*
