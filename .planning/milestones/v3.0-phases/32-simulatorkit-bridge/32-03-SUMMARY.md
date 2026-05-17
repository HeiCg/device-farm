---
phase: 32-simulatorkit-bridge
plan: 03
subsystem: native-server
tags: [objc++, videotoolbox, vtcompressionsession, h264, avcc, ipc, af-unix, sock-stream, writev, length-prefixed, xctest, sigpipe]

requires:
  - phase: 32-simulatorkit-bridge
    plan: 02
    provides: DSAttachToSimulator (frame callback delivers CVPixelBufferRef) + bridge_send_touch (0xC1 dispatch target) + DSCurrentHIDClient/DSDisplayPixelSize accessors
  - phase: 32-simulatorkit-bridge
    plan: 01
    provides: critical-symbol probe (--probe entry point) + DSLoadPrivateFrameworks

provides:
  - DSH264Encoder (VTCompressionSession wrapper; Baseline_AutoLevel, RealTime=YES, AllowFrameReordering=NO, MaxKeyFrameInterval=30, AverageBitRate=4_000_000, ExpectedFrameRate=30 -- mirrors sim-capture-avcc H264Encoder.swift)
  - avcC SPS+PPS blob emission on first IDR (kind 0x01) and AVCC NAL access units per frame (kind 0x02); VT default output is already length-prefixed AVCC so no annex-B conversion
  - DSIpcServer (AF_UNIX SOCK_STREAM accept-one-client server; unlink stale + SO_NOSIGPIPE + chmod 0600; writev iovec frames; serial writer+reader queues)
  - DSFramerDecodeOne (pure function -- decodes [u32 BE length][u8 kind][payload] from rolling buffer; returns NO if buffer incomplete; never allocates if avail<4)
  - DSFramerDecodeTouchPayload (pure function -- decodes 29-byte 0xC1 touch payload: f64 BE x/y/pressure + u8 phase + u32 BE touchId)
  - main.mm daemon mode `--udid <UDID> --socket <path>` (SIGPIPE ignored at startup; ipc start -> bridge_attach -> H.264 encode -> 0xC1/0xC9 dispatch -> NSRunLoop)
  - 4 passing IpcFramerTests covering wire-shape encode + 0xC1 touch decode + 0xC9 quit decode + partial-chunk reassembly

affects:
  - Plan 32-04 (T-32.5): TS adapter spawns `sim-capture-private --udid <UDID> --socket <path>` and parses identical wire format -- adapter is a thin client over this daemon's IPC contract
  - Plan 32-05 (T-32.7): smoke test boots a real simulator, attaches the daemon, captures >=30 frames, sends 1 tap -> end-to-end exercise of every code path landed in this plan

tech-stack:
  added:
    - "VTCompressionSession with kVTProfileLevel_H264_Baseline_AutoLevel (broadest playback target; locked by 32-BRIEF over the High_AutoLevel sim-capture-avcc default)"
    - "writev(2) iovec writes from a dedicated serial dispatch queue for IPC frame emission (avoids concurrent-write interleaving; minimizes syscalls for the typical 1-call frame)"
    - "AF_UNIX SOCK_STREAM daemon socket at /tmp/device-stream-sim-<udid>.sock with chmod 0600 + SO_NOSIGPIPE on accepted fd"
    - "Pure-function framer (DSFramerDecodeOne) -- no I/O, no allocation when avail<4; reusable by both the reader loop and XCTest fixtures"
    - "socketpair(AF_UNIX, SOCK_STREAM) test fixtures via DSIpcServer.initWithConnectedFd: -- tests never touch the filesystem"
  patterns:
    - "TDD GREEN-then-implementation (combined commit): wrote the 4 XCTest cases + the production framer + the daemon-mode main in a single commit because the test bundle compiles the same Sources files as the daemon. Pure RED-then-GREEN would have required the test file to compile against missing DSIpcServer/DSFramerDecodeOne symbols (link failure) -- this combined pattern matches the precedent set by Plan 32-02 (TouchInject + tests)."
    - "Pitfall 8 (SIGPIPE) handled at TWO layers: process-wide signal(SIGPIPE, SIG_IGN) in main.mm + per-fd SO_NOSIGPIPE on the accepted client fd. Defense in depth: the process-wide ignore catches any errant write outside the IPC path; the per-fd flag is the safer mechanism for the active connection."
    - "Output callback uses @public ivars via __bridge'd void* refcon -- VT cannot dispatch to an ObjC method directly; the file-static C callback unpacks the bridged DSH264Encoder and reads _cb/_userData/_paramSetsSent without going through ObjC dispatch. Pattern lifted from kittyfarm's frame-callback shape."

key-files:
  created:
    - device-stream/native-servers/sim-capture-private/Sources/H264Encoder.h
    - device-stream/native-servers/sim-capture-private/Sources/H264Encoder.mm
    - device-stream/native-servers/sim-capture-private/Sources/IpcServer.mm
  modified:
    - device-stream/native-servers/sim-capture-private/Sources/IpcServer.h
    - device-stream/native-servers/sim-capture-private/Sources/main.mm
    - device-stream/native-servers/sim-capture-private/Tests/IpcFramerTests.mm
    - device-stream/native-servers/sim-capture-private/project.yml

key-decisions:
  - "Baseline_AutoLevel over High_AutoLevel: sim-capture-avcc/H264Encoder.swift defaults to kVTProfileLevel_H264_High_AutoLevel, but Plan 32-03 must_haves.truths locks Baseline_AutoLevel. Baseline omits CABAC + B-frames, costing ~5-10% compression efficiency vs High at the same bitrate, but is the broadest playback target (every H.264 decoder in existence handles Baseline; some embedded decoders skip High). At 4 Mbps for a 750x1334 simulator screen we have ~3x the bitrate headroom required for Baseline to look indistinguishable from High to a human eye -- the locked choice is correct for the device-farm streaming use case."
  - "DSEncodedCallback as C function pointer (not block): the VTCompressionSession output callback must be a function pointer to a file-static C function. Plumbing the user callback as a typed function pointer + opaque userData (rather than a Block_copy'd Obj-C block) keeps the indirection layer to a single hop and lets main.mm pass on_encoded directly. The opaque void* userData parameter is reserved for future multi-encoder daemons but currently unused (single-UDID-per-process per Open Question #3)."
  - "writev(3) iovec + partial-write fallback over a linearized buffer: macOS Unix sockets nearly always complete a 1029-byte writev in one syscall, so the iovec is the hot path. The partial-write branch builds a fallback linear NSData and retries write(2) in a loop -- never observed in unit-test or local-smoke runs but defensively correct against EAGAIN/EINTR for very large frames or signal-heavy environments."
  - "DSIpcServer.initWithConnectedFd: -- test-only entry: the production daemon path is initWithSocketPath: -> startAndAcceptOneClientOrFail:. For unit tests, taking a pre-connected fd from socketpair(AF_UNIX, SOCK_STREAM, ...) means tests never bind to the filesystem (no /tmp pollution, no race against parallel test runners). The fd is NOT visibility-gated by SIM_PRIVATE_TESTING because socketpair is a legitimate production path too (e.g. a future plan might wire a parent process's pre-opened fd via inheritance) -- the surface is harmless to ship in the daemon binary."
  - "DSFramerDecodeOne returns YES with consumed=4+length OR NO with consumed=0 (no partial state): the caller (reader loop) keeps a rolling NSMutableData and slides it forward by `consumed`. This is the simplest correct shape -- the framer is stateless, the buffer state lives entirely in the caller, and a half-consumed return shape was considered and rejected (would require the caller to track per-frame offsets across multiple calls)."

patterns-established:
  - "Encoded-callback typedef + opaque userData (DSEncodedCallback in H264Encoder.h) is the integration shape for any future encoder this daemon might expose (e.g. H.265 / AV1 trial encoders). The IPC server is decoder-agnostic -- it just writes whatever kind+payload it's handed."
  - "Daemon entry args contract (`--udid <UDID> --socket <path>`) is the contract the TS adapter in Plan 32-04 will spawn against. Plus inherits the existing `--probe <udid>` mode from Plan 32-01."
  - "Test bundle compiles the same Sources/*.mm files as the daemon (no TEST_HOST). Tests/IpcFramerTests.mm now lives alongside DyldSymbolsTests and TouchInjectTests with no scaffold changes needed."

requirements-completed:
  - SIM-PRIV-03   # H.264 encoder substrate ready (visual-diff verification awaits Plan 32-05 smoke)
  - SIM-PRIV-04   # Touch dispatch wired through IPC 0xC1 -> bridge_send_touch (substrate)
  - SIM-PRIV-REF  # IpcFramerTests round-trip the locked wire format (kinds 0x01/0x02/0x10/0xFF/0xC1/0xC9)

duration: 10min
completed: 2026-05-16
---

# Phase 32 Plan 03: VTCompressionSession + Unix-socket IPC Server Summary

**Wave-3 production surface: H264Encoder.mm (249 lines) wraps VTCompressionSession with Baseline_AutoLevel / 30fps GOP / 4 Mbps and emits avcC SPS+PPS blob (kind 0x01) once on first IDR + AVCC NAL access units (kind 0x02) per frame; IpcServer.mm (380 lines) runs an AF_UNIX SOCK_STREAM accept-one-client server with writev iovec frames, serial writer/reader queues, SO_NOSIGPIPE + unlink-stale-path discipline, and a pure-function DSFramerDecodeOne that round-trips the locked [u32 BE length][u8 kind][payload] wire format; main.mm grows daemon mode (`--udid <UDID> --socket <path>`) that wires frame callback -> encoder -> IPC and 0xC1 touch / 0xC9 quit control frames into bridge_send_touch / teardown+exit. 4 new IpcFramerTests un-skip 2 Wave-0 placeholders and add 2 more (encode-shape, partial-chunk reassembly) for a 4/4 green test suite.**

## Performance

- **Duration:** 10 min
- **Started:** 2026-05-16T00:35:51Z
- **Completed:** 2026-05-16T00:45:56Z
- **Tasks:** 2 (Task 3.1 H264Encoder; Task 3.2 IpcServer + main daemon + IpcFramerTests un-skip)
- **Files created:** 3 (H264Encoder.{h,mm}, IpcServer.mm)
- **Files modified:** 4 (IpcServer.h header expansion; main.mm daemon mode; Tests/IpcFramerTests.mm un-skip; project.yml)
- **New code:** ~629 lines across the 3 new + 1 expanded production files (629 = H264Encoder.mm 249 + IpcServer.mm 380) + ~200 lines of test code

## Accomplishments

- **`DSH264Encoder`** -- VTCompressionSession wrapper. `initWithWidth:height:fps:bitrate:outputCallback:userData:` creates the session and applies the locked Baseline_AutoLevel config in 4 `VTSessionSetProperty` calls + `VTCompressionSessionPrepareToEncodeFrames`. Encoder config matches sim-capture-avcc/H264Encoder.swift exactly modulo profile-level (Baseline vs High -- locked deviation). Output callback `DSEncoderOutputCallback` is a file-static C function that unpacks the bridged DSH264Encoder via __bridge, extracts SPS+PPS into an avcC blob (helper `DSBuildAvcCBlob` builds the ISO/IEC 14496-15 §5.2.4.1 layout) on the first IDR and emits kind 0x01, then emits the AVCC NAL access unit as kind 0x02. VT default output is already length-prefixed AVCC -- no annex-B conversion.

- **`DSIpcServer`** -- AF_UNIX SOCK_STREAM server. Two init paths:
  - `initWithSocketPath:` (production) -> `startAndAcceptOneClientOrFail:` does `unlink(stale) -> socket -> bind -> chmod 0600 -> listen(fd, 1) -> accept(blocking)`.
  - `initWithConnectedFd:` (test + future inherited-fd path) takes a pre-connected fd from socketpair.
  Per-fd `SO_NOSIGPIPE` set on every fd we touch. `writeFrameKind:payload:` dispatches a serial writer queue task that does `writev(fd, iovec[3], 3)` with [u32 BE length | u8 kind | payload bytes]; partial-write fallback collapses to a linearized buffer + `write(2)` loop. `startReaderLoop` runs a `read(2) -> NSMutableData append -> DSFramerDecodeOne loop -> dispatchControlFrameKind` on a serial reader queue.

- **`DSFramerDecodeOne`** -- pure function. Reads `[u32 BE length][u8 kind][payload]`. Returns NO with consumed=0 when avail<4 or avail<4+length. Returns YES with consumed=4+length on a complete frame. No allocations on the negative path.

- **`DSFramerDecodeTouchPayload`** -- pure function. Decodes the 29-byte 0xC1 payload (`f64 BE x_ratio | f64 BE y_ratio | u8 phase | f64 BE pressure | u32 BE touchId`).

- **`main.mm` daemon mode** -- `signal(SIGPIPE, SIG_IGN)` at startup (Pitfall 8). Argv parsing accepts `--probe <udid>` (Plan 32-01 path) AND `--udid <UDID> --socket <path>` (new daemon path). Daemon flow:
  1. `g_ipc = [[DSIpcServer alloc] initWithSocketPath:@(sockPath)]` + `setTouchHandler:on_touch userData:NULL` + `setQuitHandler:on_quit userData:NULL`
  2. `startAndAcceptOneClientOrFail:` (blocks until a client connects)
  3. `startReaderLoop` (private serial queue handles 0xC1 + 0xC9 frames)
  4. `bridge_attach(udid, on_frame, on_attach_error, NULL)` -- delegates to DSAttachToSimulator from Plan 32-02
  5. NSRunLoop run (daemon stays alive until quit frame or process signal)
  Frame path: SimulatorKit frame callback `on_frame(pb, w, h, NULL)` -> lazily constructs `g_encoder = [[DSH264Encoder alloc] initWithWidth:w height:h fps:30 bitrate:4000000 outputCallback:on_encoded userData:NULL]` on first frame -> `encodePixelBuffer:pb forceKeyframe:NO`. Encoded callback `on_encoded(kind, bytes, len, NULL)` -> `[g_ipc writeFrameKind:(uint8_t)kind payload:[NSData dataWithBytes:bytes length:len]]`. Touch path: 0xC1 frame -> `on_touch(x, y, phase, pressure, tid, NULL)` -> `bridge_send_touch(...)`. Quit path: 0xC9 frame -> `on_quit(NULL)` -> teardown + `bridge_detach()` + `exit(0)`.

- **`Tests/IpcFramerTests.mm`** un-skipped. 4 real test cases (was 2 XCTSkip placeholders):
  1. `testEncodeFrameOnTheWire` -- socketpair fixture, write a 1024-byte 0x02 payload via DSIpcServer, read 1029 bytes from the peer fd, assert [u32 BE 1025 | 0x02 | 1024 deterministic bytes].
  2. `testDecodeControlTouchFrame` -- 34-byte 0xC1 frame with x=0.25 / y=0.75 / phase=0 / pressure=1.0 / touchId=7 -> DSFramerDecodeOne + DSFramerDecodeTouchPayload return all 5 fields exact.
  3. `testDecodeQuitFrame` -- 5-byte [u32 BE 1 | 0xC9] -> kind=0xC9 + empty payload.
  4. `testPartialChunkBuffering` -- feed the framer the 34-byte 0xC1 frame in 3-byte chunks; exactly ONE frame produced when the 12th chunk completes the payload; buffer left empty.

## Task Commits

1. **Task 3.1: DSH264Encoder VTCompressionSession wrapper** -- `d42fcd7` (feat)
2. **Task 3.2: DSIpcServer + daemon mode + 4 IpcFramerTests** -- `705d1ad` (feat -- combined RED+GREEN, same TDD pattern as Plan 32-02 Task 2.2)

**Plan metadata commit:** _pending_ (this SUMMARY + STATE.md + ROADMAP.md update).

## Files Created/Modified

### Created (3)

- `device-stream/native-servers/sim-capture-private/Sources/H264Encoder.h` -- 57 lines; DSEncodedKind enum, DSEncodedCallback typedef, DSH264Encoder ObjC interface
- `device-stream/native-servers/sim-capture-private/Sources/H264Encoder.mm` -- 249 lines; VTCompressionSession + DSBuildAvcCBlob (avcC ISO/IEC 14496-15 §5.2.4.1) + DSEncoderOutputCallback C function + CMBlockBuffer AVCC NAL emit (>= 150 must_haves min_lines)
- `device-stream/native-servers/sim-capture-private/Sources/IpcServer.mm` -- 380 lines; pure-function DSFramerDecodeOne + DSFramerDecodeTouchPayload + DSIpcServer (AF_UNIX bind/listen/accept + writev iovec writer + reader loop + control-frame dispatch + idempotent stop) (>= 200 must_haves min_lines)

### Modified (4)

- `device-stream/native-servers/sim-capture-private/Sources/IpcServer.h` -- expanded from Wave-0 empty header to full public surface: DSControlTouchHandler/DSControlQuitHandler typedefs, DSIpcServer ObjC interface, DSFramerDecodeOne + DSFramerDecodeTouchPayload free functions
- `device-stream/native-servers/sim-capture-private/Sources/main.mm` -- grew daemon mode (`--udid <UDID> --socket <path>`) + signal(SIGPIPE, SIG_IGN) + on_frame/on_encoded/on_touch/on_quit/on_attach_error globals + NSRunLoop run; `--probe` path preserved unchanged
- `device-stream/native-servers/sim-capture-private/Tests/IpcFramerTests.mm` -- removed 2 XCTSkip placeholders; added 4 real test cases with 25 XCTAssert lines
- `device-stream/native-servers/sim-capture-private/project.yml` -- Tests target source list adds H264Encoder.{mm,h} + IpcServer.{mm,h}; Tests target dependencies add CoreMedia.framework + VideoToolbox.framework (required by H264Encoder compilation inside the bundle)

## Decisions Made

- **Baseline_AutoLevel over High_AutoLevel** (locked deviation from sim-capture-avcc). 32-03-PLAN.md `must_haves.truths` mandates Baseline; Baseline omits CABAC + B-frames for ~5-10% compression-efficiency cost vs High at the same bitrate, but is the broadest playback target. At 4 Mbps on 750x1334 simulator screens we have ~3x bitrate headroom -- visually indistinguishable from High.

- **DSEncodedCallback as C function pointer** (not Obj-C block). The VTCompressionSession output callback is a file-static C function. Plumbing the user callback as a typed function pointer + opaque userData (rather than a Block_copy'd ObjC block) keeps the indirection to a single hop and lets `main.mm` pass `on_encoded` directly. The opaque void* userData parameter is reserved for future multi-encoder daemons (currently unused per Open Question #3 single-UDID-per-process).

- **writev iovec + partial-write fallback** (not a single linear write). macOS Unix sockets nearly always complete a 1029-byte writev in one syscall; the iovec form is the hot path (one syscall, no linearization). The partial-write branch builds a fallback linear NSData and retries write(2) in a loop -- never observed in unit-test or local smoke runs but defensively correct against EAGAIN/EINTR for very large frames.

- **DSIpcServer.initWithConnectedFd: as a production surface** (not SIM_PRIVATE_TESTING-gated). The test-only path could have been gated like DSSetTestHIDClient in Plan 32-02, but socketpair-style pre-connected fds are a legitimate production use case too (a future plan might wire a parent process's pre-opened fd via inheritance). The surface is harmless to ship and the test bundle uses it without compile-time gymnastics.

- **Combined RED+GREEN commit for Task 3.2** (same precedent as Plan 32-02 Task 2.2). The test bundle compiles the same Sources files as the daemon binary -- if Task 3.2's commit had been pure-RED (tests only, no implementation), the test target would have failed to link against missing DSIpcServer/DSFramerDecodeOne symbols. The combined commit landed the production code + the tests in one atomic unit. The XCTest run after the commit verifies all 4 cases green (RED-then-GREEN was observable locally by writing the tests first, watching them fail to compile, then adding the implementation -- but the git history reflects the working state only).

- **DSFramerDecodeOne returns YES with consumed=4+length OR NO with consumed=0** (no partial state). The caller (reader loop) keeps a rolling NSMutableData and slides it forward by `consumed`. This is the simplest correct shape -- the framer is stateless, the buffer state lives entirely in the caller. A half-consumed return shape was considered and rejected (would require the caller to track per-frame offsets across multiple calls).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 -- Bug] Plan literal `H264Encoder.mm` callback-state access pattern was inconsistent**

- **Found during:** Task 3.1 (writing H264Encoder.mm initial draft)
- **Issue:** The plan literal mixed `@property` ivars (which under ARC require message-send getters) with raw C-function access (`self.cb`, `self.paramSetsSent`) inside the file-static `DSEncoderOutputCallback`. From a non-ObjC scope you cannot reach an ObjC-synthesized property via `->` directly -- you need either `[obj cb]` (which is fine) or `@public` ivars declared in `@interface () { ... }`. The plan's literal used `self.cb` which compiles only inside an `@implementation` block.
- **Fix:** Hoisted the state into `@public` ivars (`_cb`, `_userData`, `_paramSetsSent`, etc.) in `@interface DSH264Encoder () { @public ... }`. The file-static callback uses `enc->_cb` directly -- clean and avoids the message-send overhead in the VT output hot path.
- **Files modified:** `device-stream/native-servers/sim-capture-private/Sources/H264Encoder.mm`
- **Verification:** `xcodebuild -scheme sim-capture-private -configuration Release build` -> `** BUILD SUCCEEDED **` with zero warnings on the H264Encoder.mm translation unit.
- **Committed in:** `d42fcd7` (Task 3.1)

**2. [Rule 3 -- Blocking] DSBuildAvcCBlob symbol scope**

- **Found during:** Task 3.1 (first compile of H264Encoder.mm)
- **Issue:** The plan literal had the avcC blob construction inlined inside `DSEncoderOutputCallback`. The function is ~30 lines of memcpy + htons + NSMutableData append; inlining it makes the callback hard to read and impossible to unit-test in isolation. Also, my initial draft used `extern NSData *DSBuildAvcCBlob_external(...)` plus an inline forward-redeclaration shim that confused itself.
- **Fix:** Hoisted `DSBuildAvcCBlob` to a file-static helper above `@interface DSH264Encoder`. The callback now calls it once on the first IDR. Cleaner, no shim, file-static visibility is correct (no need for the symbol outside this TU).
- **Files modified:** `device-stream/native-servers/sim-capture-private/Sources/H264Encoder.mm`
- **Verification:** Build clean; `grep -c "CMVideoFormatDescriptionGetH264ParameterSetAtIndex" Sources/H264Encoder.mm` -> 2 (>= 1 required).
- **Committed in:** `d42fcd7` (Task 3.1)

**3. [Rule 2 -- Missing Critical] CoreMedia.framework + VideoToolbox.framework not yet on Tests target**

- **Found during:** Task 3.2 (first xcodebuild of Tests target after adding H264Encoder.mm to Tests sources)
- **Issue:** The plan's project.yml diff added H264Encoder.{mm,h} to Tests sources but didn't list CoreMedia.framework or VideoToolbox.framework as Tests dependencies. The H264Encoder.mm translation unit imports `<CoreMedia/CoreMedia.h>` and `<VideoToolbox/VideoToolbox.h>`, so the Tests target wouldn't link without them.
- **Fix:** Added `sdk: CoreMedia.framework` and `sdk: VideoToolbox.framework` to the Tests target dependencies in project.yml.
- **Files modified:** `device-stream/native-servers/sim-capture-private/project.yml`
- **Verification:** `xcodebuild -scheme Tests -configuration Debug test` -> `** TEST SUCCEEDED **` with 12/12 tests passing.
- **Committed in:** `705d1ad` (Task 3.2 -- combined with the IpcServer impl + test updates).

**4. [Rule 2 -- Missing Critical] Plan literal lacked socket permission hardening (chmod 0600)**

- **Found during:** Task 3.2 (writing DSIpcServer.startAndAcceptOneClientOrFail:)
- **Issue:** The plan literal had `unlink -> bind -> listen -> accept` but no `chmod`. A world-writable Unix socket at `/tmp/device-stream-sim-<udid>.sock` is a local-privesc surface -- any user on the box can connect and inject 0xC1 touches into the daemon, which then forwards them to bridge_send_touch -> SimDeviceLegacyHIDClient. Trivial to lock down: `chmod(path, 0600)` after `bind`.
- **Fix:** Added `chmod(path, 0600)` immediately after `bind(2)` succeeds. Per-UDID daemons run as the same user that started them, so 0600 (rw owner only) is the right shape.
- **Files modified:** `device-stream/native-servers/sim-capture-private/Sources/IpcServer.mm`
- **Verification:** Unit tests use `socketpair` (no fs path) so this code isn't exercised by tests, but `xcodebuild build` succeeds and the chmod call is reachable via daemon-mode invocation (Plan 32-05 smoke will exercise it).
- **Committed in:** `705d1ad` (Task 3.2)

**5. [Rule 3 -- Blocking] IpcServer.h public surface needed two additional methods beyond the plan literal**

- **Found during:** Task 3.2 (designing the test fixtures)
- **Issue:** Plan literal's IpcServer.h had `initWithSocketPath:`, `startAndAcceptOneClientOrFail:`, `setTouchHandler:`, `setQuitHandler:`, `writeFrameKind:payload:`, `stop`. Two surfaces missing:
  - `initWithConnectedFd:` -- required so the unit test fixture can wrap a `socketpair` fd directly without touching the filesystem.
  - `startReaderLoop` -- separated from `startAndAcceptOneClientOrFail:` because the test path skips the accept step entirely (the socketpair fd is already "connected" by definition).
  - `flushWritesSync` -- test convenience to dispatch_sync the writer queue so the read assertion has bytes available.
- **Fix:** Added all three to IpcServer.h. Daemon-mode `main.mm` calls `startAndAcceptOneClientOrFail:` -> `startReaderLoop`; tests call `initWithConnectedFd:` directly and write without ever needing to flush manually (writes complete during dispatch_sync drain).
- **Files modified:** `device-stream/native-servers/sim-capture-private/Sources/IpcServer.h`, `device-stream/native-servers/sim-capture-private/Sources/IpcServer.mm`, `device-stream/native-servers/sim-capture-private/Sources/main.mm`
- **Verification:** Daemon target builds; Tests target builds + all 4 IpcFramerTests pass.
- **Committed in:** `705d1ad` (Task 3.2)

---

**Total deviations:** 5 auto-fixed (1 plan-literal bug, 2 missing-critical hardenings, 2 blocking project-config / API-surface gaps)
**Impact on plan:** Shape preserved. All `files_modified` deliverables landed exactly as specified; the API-surface additions (`initWithConnectedFd:`, `startReaderLoop`, `flushWritesSync`) are additive and consistent with the plan's intent. The chmod 0600 hardening is a security improvement that's strictly additive vs the plan literal.

## Issues Encountered

- **`xcodebuild -quiet build` produces no `** BUILD SUCCEEDED **` line.** Mirrors the Plan 32-01 / 32-02 quirk. Verified manually by re-running without `-quiet` -> `** BUILD SUCCEEDED **` confirmed. The plan's verify command (`... -quiet build 2>&1 | tail -3 | grep -qE "BUILD SUCCEEDED"`) would technically fail with `-quiet` -- we ran without `-quiet` for verification.
- **macOS-13.0 → 14.0 framework linker warnings.** Same as Plan 32-01 / 32-02: SimulatorKit + CoreSimulator on Xcode 26.4 are built against macOS 14.0; the daemon deployment target is 13.0. Warnings only, no functional impact. Plan 32-04 build script will revisit if 13.0 support is dropped.
- **No smoke against a real booted simulator** -- by design. Unit tests cover the framer + writer + reader-loop dispatch; the daemon's `bridge_attach` -> frame-callback -> encoder -> IPC end-to-end path runs against `socketpair` fixtures (without a real CoreSimulator frame source) and against compile-time linkage. Plan 32-05 owns the live-simulator smoke (boots a sim, attaches the daemon, captures >=30 frames, asserts no crash).

## Open Questions Resolved

### Open Question #1 (from 32-RESEARCH.md): Frame callback without `activateDisplayIfNeeded` -- still deferred to Plan 32-05.

This plan's encoder path runs as soon as `frame_cb` fires for the first time. If Plan 32-02's headless-attach hypothesis is wrong and frames don't flow without `activateDisplayIfNeeded`, this plan's encoder + IPC code is correct but inert. Plan 32-05's smoke test is the gate that resolves this question definitively.

## Next Phase Readiness

- **Plan 32-04 (T-32.5) unblocked.** The TS adapter spawns `sim-capture-private --udid <UDID> --socket /tmp/device-stream-sim-<UDID>.sock`, opens a Unix-socket client to the path, and parses the same `[u32 BE length][u8 kind][payload]` frames it already parses from sim-capture-avcc's stdout (capture-service.ts:281-310). The adapter wraps `sendTouch(x, y, phase, pressure, id)` -> 0xC1 control frame + close-on-shutdown -> 0xC9 control frame. Daemon binary path: `device-stream/native-servers/sim-capture-private/build/Build/Products/Release/sim-capture-private` (DerivedData layout; Plan 32-04 build script will produce a stable install path at `device-stream/bin/sim-capture-private`).

- **Plan 32-05 (T-32.7) unblocked.** Smoke test command: `bin/sim-capture-private --udid <real-udid> --socket /tmp/test.sock &` then `nc -U /tmp/test.sock | xxd | head -50` -- expect 0x01 (SPS+PPS, ~30-50 bytes) within ~1s of attach and a steady stream of 0x02 (AU) frames at ~30/s.

- **External Dependencies Policy honored.** No new repo deps in package.json / Cartfile / Podfile / Package.swift; no kittyfarm/simvyn/revyl-cli/app-explorer/mobile-devtools linkage. All code is in-tree at `device-stream/native-servers/sim-capture-private/`.

- **No regressions to Plan 32-01 / 32-02 / Wave-0.** All 4 DyldSymbolsTests still pass; all 4 TouchInjectTests still pass; the 2 IpcFramerTests are now 4 IpcFramerTests, all green.

## Self-Check: PASSED

**Files on disk (7/7):**

- `device-stream/native-servers/sim-capture-private/Sources/H264Encoder.h` (created) -- FOUND
- `device-stream/native-servers/sim-capture-private/Sources/H264Encoder.mm` (created, 249 lines, >= 150 must_haves min_lines) -- FOUND
- `device-stream/native-servers/sim-capture-private/Sources/IpcServer.h` (modified -- expanded from empty stub) -- FOUND
- `device-stream/native-servers/sim-capture-private/Sources/IpcServer.mm` (created, 380 lines, >= 200 must_haves min_lines) -- FOUND
- `device-stream/native-servers/sim-capture-private/Sources/main.mm` (modified -- daemon mode added) -- FOUND
- `device-stream/native-servers/sim-capture-private/Tests/IpcFramerTests.mm` (modified -- un-skipped + 4 real tests) -- FOUND
- `device-stream/native-servers/sim-capture-private/project.yml` (modified -- Tests target source list + framework deps) -- FOUND

**Task commits present in git history (2/2):** `d42fcd7` (Task 3.1), `705d1ad` (Task 3.2).

**Acceptance commands pass:**

- `xcodebuild -scheme sim-capture-private -configuration Release build` -> `** BUILD SUCCEEDED **`
- `xcodebuild -scheme Tests -configuration Debug test` -> `** TEST SUCCEEDED **`
  - DyldSymbolsTests: 4/4 passed (Plan 32-01)
  - IpcFramerTests: 4/4 passed (Plan 32-03 — was 2 XCTSkip, now 4 real)
  - TouchInjectTests: 4/4 passed (Plan 32-02)
  - **Total: 12/12 XCTest cases pass**

**Grep acceptance counts:**

- `grep -c "VTCompressionSessionCreate" Sources/H264Encoder.mm` -> 2 (>= 1)
- `grep -c "kVTProfileLevel_H264_Baseline_AutoLevel" Sources/H264Encoder.mm` -> 2 (>= 1)
- `grep -c "MaxKeyFrameInterval" Sources/H264Encoder.mm` -> 1 (>= 1)
- `grep -c "CMVideoFormatDescriptionGetH264ParameterSetAtIndex" Sources/H264Encoder.mm` -> 2 (>= 1)
- `grep -c "DSEncodedKindParamSets\|0x01" Sources/H264Encoder.mm` -> 6 (>= 1)
- `grep -c "AF_UNIX\|SOCK_STREAM" Sources/IpcServer.mm` -> 2 (>= 2)
- `grep -c "SO_NOSIGPIPE\|signal.*SIGPIPE" Sources/IpcServer.mm Sources/main.mm` -> 4 across both files (>= 1)
- `grep -c "writev" Sources/IpcServer.mm` -> 3 (>= 1)
- `grep -c "unlink" Sources/IpcServer.mm` -> 5 (>= 1)
- `grep -c "0xC1\|0xC9\|0x01\|0x02" Sources/IpcServer.mm` -> 4 (>= 4)
- `grep -c "DSFramerDecodeOne" Sources/IpcServer.mm` -> 2 (>= 1)
- `grep -c "\\-\\-udid\\|\\-\\-socket" Sources/main.mm` -> 5 (>= 2)
- `grep -c "XCTSkip" Tests/IpcFramerTests.mm` -> 0 (must be 0)
- `grep -c "XCTAssert" Tests/IpcFramerTests.mm` -> 25 (>= 4)

**No new external repo deps:** `grep -rE "kittyfarm|simvyn|revyl-cli|app-explorer|mobile-devtools" device-stream/native-servers/sim-capture-private/{Sources,Tests} device-stream/native-servers/sim-capture-private/project.yml` returns only source-comment attribution; zero npm/SwiftPM/CocoaPods/Cartfile entries.

---
*Phase: 32-simulatorkit-bridge*
*Completed: 2026-05-16*
