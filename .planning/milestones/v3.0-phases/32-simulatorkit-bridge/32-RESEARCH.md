# Phase 32: SimulatorKit Private Bridge — Research

**Researched:** 2026-05-15
**Domain:** macOS Obj-C++ / SimulatorKit private API / VideoToolbox H.264 / Unix socket IPC
**Confidence:** HIGH (reference impl in hand, lines pinpointed; only delta is the daemon-vs-app port)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Authoritative sources:**
- `32-BRIEF.md` is the spec — task list, file layout, IPC contract, acceptance criteria are all locked
- `/Users/heicg/Desktop/projects/_reference/kittyfarm/KittyFarm/PrivateSimulator/DFPrivateSimulatorDisplayBridge.m` (3022 LOC) — copy dyld trie walker (~lines 259-457), attach sequence (~2027-2340), HID send (~line 884)
- `/Users/heicg/Desktop/projects/_reference/kittyfarm/KittyFarm/PrivateSimulator/DFPrivateSimulatorDisplayBridge.h` — public API surface
- `/Users/heicg/Desktop/projects/_reference/kittyfarm/KittyFarm/Connections/IOSSimulatorConnection.swift` — Swift integration pattern
- `/Users/heicg/Desktop/projects/_reference/kittyfarm/KittyFarm/Support/KittyFarm-Bridging-Header.h` — Obj-C↔Swift bridging
- Existing `device-stream/packages/ios-simulator/` and (canonical) `device-stream/native-servers/sim-capture/` — keep API contract identical so consumers don't change

**Architecture:**
- Helper is daemon (Obj-C++), spawned by Node, communicates over Unix socket
- IPC: length-prefixed framed messages — kinds `0x01` SPS+PPS / `0x02` AU / `0x10` ack / `0xFF` error / `0xC1` touch / `0xC9` quit
- Encoder: VTCompressionSession, Baseline_AutoLevel, 30fps keyframes, 4 Mbps
- Symbol resolution: dyld exports-trie walker; reject early if any of 8 critical Swift symbols cannot be resolved; print which one
- Fallback: env `DEVICE_STREAM_SIM_PRIVATE=0` or trie-walk failure → ScreenCaptureKit path

**Tasks (locked):** T-32.1 skeleton+dlopen, T-32.2 screen attach, T-32.3 HID inject, T-32.4 H.264+IPC, T-32.5 TS adapter, T-32.6 build, T-32.7 runbook+CI.

### Claude's Discretion

- Exact directory layout under `sim-capture-private/` (subfolders, naming) — match `sim-capture/` conventions
- XcodeGen project.yml structure — minimal, single target, no UI
- Test scaffolding (Obj-C unit tests vs Swift) — pick whichever integrates cleanest with existing CI
- Logging library — use whatever `sim-capture/` already uses

### Deferred Ideas (OUT OF SCOPE)

- Code-signing of helper (run unsigned for dev; deferred to post-canary)
- Multi-display support (current iOS sim is always single display)
- iOS 18+ simulator API regressions (deal with when they happen, CI matrix surfaces early)
</user_constraints>

<phase_requirements>
## Phase Requirements

This phase is **not** mapped to a v3.0 REQUIREMENTS.md ID. The traceability table in `.planning/REQUIREMENTS.md` covers Phase 15–30 (the v3.0 spec-driven architecture rebuild). Phase 32 is a follow-on **track** ("device-stream" track) that arrived after v3.0 mapping closed.

The de-facto requirement set comes from the BRIEF acceptance criteria:

| Pseudo-ID | Description | Research Support |
|-----------|-------------|------------------|
| SIM-PRIV-01 | Fresh macOS user runs an iOS sim job with zero TCC prompts | Reference impl skips ScreenCaptureKit entirely — IOSurface comes from CoreSimulator backboard process; § Reference walkthrough, § Attach sequence |
| SIM-PRIV-02 | `device-stream-sim-cap-private --probe <udid>` prints `OK: 8/8 symbols resolved` on Xcode 15.4+ | § Symbol resolution lists the 8; trie walker covers cross-version drift |
| SIM-PRIV-03 | H.264 stream visually equivalent to ScreenCaptureKit baseline (Δ < 0.5%) | § IOSurface→H.264; VT config identical bitrate / GOP / profile |
| SIM-PRIV-04 | Touch latency ≤ ScreenCaptureKit baseline | § HID injection — single `sendWithMessage:` round trip, no compositor in the loop |
| SIM-PRIV-05 | `DEVICE_STREAM_SIM_PRIVATE=0` falls back to ScreenCaptureKit | § Existing structure — adapter wraps both clients; spawn-fail or env-off triggers fallback |
| SIM-PRIV-06 | CI matrix passes on Xcode 16.0+ | § Build tooling, § Test strategy |
| SIM-PRIV-REF | Implementation must faithfully port kittyfarm reference | Every section cites kittyfarm file:line; deviations called out as Risks |

These pseudo-IDs are used downstream by the planner to map tasks to acceptance gates; they are **not** added to `REQUIREMENTS.md` (which is closed at v3.0 mapping).
</phase_requirements>

## Summary

This phase ports `kittyfarm/PrivateSimulator/DFPrivateSimulatorDisplayBridge.m` (a 3022-LOC Obj-C reference impl that runs inside the kittyfarm GUI app) into a **headless Obj-C++ daemon** living at `device-stream/native-servers/sim-capture-private/`. The Node side (`packages/ios-simulator`) keeps its existing `CaptureService` interface but gains a new client (`sim-capture-private-client.ts`) that spawns the daemon, talks length-prefixed framed messages over a Unix socket, and falls back to the existing `sim-capture-avcc` ScreenCaptureKit pipeline on failure.

The hard core is **already written** in kittyfarm — the dyld exports-trie walker (`DFFindSwiftSymbol`, lines 260-425), the attach sequence (`initWithUDID:`, lines 2027-2340), the HID send wrapper (`DFSendHIDMessage`, lines 884-929), and the Indigo touch message builder (`DFCreateIndigoTouchMessage`, lines 931-988). The novel work is:
1. Stripping the AppKit/GUI parts (kittyfarm allocates `SimDisplayView` + window; we want `renderableView.connect(screen:)` *without* a host window — see Risks)
2. Adding a Unix-socket IPC server (kittyfarm dispatches via delegate; we serialize over a socket)
3. Adding a VTCompressionSession in front of the IOSurface pipeline (kittyfarm raw-feeds `CVPixelBuffer` to a delegate; we encode H.264)
4. XcodeGen + xcodebuild orchestration that produces a relocatable daemon (existing `tools/sim-capture-avcc/` uses SwiftPM — pattern to mirror)

**Primary recommendation:** Port `DFPrivateSimulatorDisplayBridge.m` verbatim into `Bridge.mm` keeping function names with the `DF` prefix renamed to `DS` (Device-Stream). Do **not** rewrite. Add `IpcServer.mm` + `H264Encoder.mm` as new files. The dyld trie walker, Indigo struct layout, ARM64 inline asm shims, and HID send semaphore pattern must be copied byte-for-byte — they encode Apple ABI knowledge that's expensive to re-derive.

## Standard Stack

### Core (locked by environment, not optional)

| Component | Version | Purpose | Why standard |
|-----------|---------|---------|--------------|
| Obj-C++ (`.mm`) | C++17+ / Obj-C 2.0 | Bridge language | Need Obj-C runtime for `objc_msgSend` dispatch into private classes; need C++ for STL helpers if any |
| Foundation, AppKit | macOS 13+ | `NSEvent`, `NSUUID`, dispatch queues | Required — `IndigoHIDMessageForMouseNSEvent` takes `NSEventType` |
| CoreSimulator.framework | private, system | `SimServiceContext`, `SimDevice`, `SimDeviceSet` | `/Library/Developer/PrivateFrameworks/CoreSimulator.framework/CoreSimulator` — same path kittyfarm uses (DisplayBridge.m:23) |
| SimulatorKit.framework | private, Xcode-shipped | `SimDeviceScreen`, `SimDeviceLegacyHIDClient`, `SimDisplayRenderableView`, screen adapter | `${DEVELOPER_DIR}/Library/PrivateFrameworks/SimulatorKit.framework/SimulatorKit` (DisplayBridge.m:67-69) |
| VideoToolbox | system | `VTCompressionSession*` for H.264 | Already used by `tools/sim-capture-avcc/Sources/sim-capture-avcc/H264Encoder.swift` — mirror that config |
| CoreVideo | system | `CVPixelBufferCreateWithIOSurface` (DisplayBridge.m:807) | Bridges `IOSurfaceRef` → `CVPixelBufferRef` for VT |
| IOSurface | system | The frame container SimulatorKit emits | — |
| dispatch (libdispatch) | system | Serial callback queue, semaphores for sync HID send (DisplayBridge.m:895-911) | — |
| `dlfcn.h`, `mach-o/loader.h`, `mach-o/nlist.h` | system | dlopen + Mach-O export trie traversal | Required by trie walker (DisplayBridge.m:1-13 headers) |

### Build tooling (Claude's discretion)

| Tool | Version | Purpose | Tradeoff |
|------|---------|---------|----------|
| **XcodeGen** (recommended) | 2.42+ | Generate `.xcodeproj` from `project.yml` | Brief locks XcodeGen. Reproducible, no Xcode UI required, fits CI. **Alternative considered:** SwiftPM (used by `sim-capture-avcc`). Rejected because (a) `Bridge.mm` is Obj-C++ — SwiftPM mixed-language targets are painful; (b) explicit `-F` framework paths + `-rpath` are easier in xcodebuild than `unsafeFlags` chains. |
| **xcodebuild** | bundled w/ Xcode | Compile + archive helper | Same family as the existing `scripts/build-sim-capture.sh` — staff already knows the flags |
| `swift build` | existing | Build the fallback `sim-capture-avcc` | Untouched |

### Supporting (testing & TS side)

| Library | Version | Purpose | When to use |
|---------|---------|---------|-------------|
| `vitest` | already-installed | TS unit tests for `sim-capture-private-client.ts` | Mirror existing `device-stream/packages/ios-simulator/tests/` layout |
| **XCTest** (recommended) | bundled | Obj-C++ unit tests for trie walker, IPC framer | XCTest tests run via `xcodebuild test` — natural fit; brief leaves choice to discretion. Alternative: stand-alone C `assert()` harness (lighter, no Xcode dep at CI time). |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| dyld trie walker | Hard-coded mangled symbols (`dlsym`) | What kittyfarm tried first — DFPrivateSimulatorDisplayBridge.m:210-220 documents the Xcode 26.4 break where `SimDeviceScreenAdapter.screens` retyped from `[UInt32: SimScreen]` to `[UInt32: SimDeviceScreen]`, invalidating the tail. The walker is the **whole point** — don't skip it. |
| Unix socket | stdin/stdout (as `sim-capture-avcc` does) | stdin/stdout works (existing fallback), but the brief explicitly locks Unix socket. Socket gives bidirectional control without stealing stdio for logs and supports future multi-consumer (web sdk + maestro both listening). |
| Obj-C++ | Pure Swift | Swift's `@_silgen_name` + `dlopen` works but ARM64 inline asm shims (DisplayBridge.m:539-548, 654-664) for calling Swift property getters by raw function pointer **require** Obj-C++. Swift can't emit those calling conventions without unsafe interop. |
| Helper binary | NAPI/ObjC++ Node addon | Brief locks daemon. Addon has TCC blast radius (the Node process becomes the screen consumer) and complicates Electron embedding later. Daemon is cleaner. |

**Installation (paths/commands):**

```bash
# Obj-C++ project
brew install xcodegen
cd device-stream/native-servers/sim-capture-private
xcodegen generate
xcodebuild -project sim-capture-private.xcodeproj \
           -scheme sim-capture-private \
           -configuration Release \
           -derivedDataPath build \
           build

# Output: build/Build/Products/Release/sim-capture-private
# Staged to: device-stream/bin/sim-capture-private
```

## Architecture Patterns

### Recommended Project Structure

```
device-stream/native-servers/sim-capture-private/
├── project.yml                       # XcodeGen spec (~40 lines)
├── README.md                         # build/run instructions
├── Sources/
│   ├── main.mm                       # entry: parse argv, init Bridge, run NSRunLoop
│   ├── Bridge.h / Bridge.mm          # ported from DFPrivateSimulatorDisplayBridge.{h,m}
│   ├── DyldSymbols.h / DyldSymbols.mm# trie walker (lines 259-457 of reference)
│   ├── ScreenAttach.h / ScreenAttach.mm  # initWithUDID logic (2027-2340 of reference)
│   ├── TouchInject.h / TouchInject.mm# HID send + Indigo packet build (884-988)
│   ├── H264Encoder.h / H264Encoder.mm# VTCompressionSession wrapper
│   ├── IpcServer.h / IpcServer.mm    # Unix socket accept loop + framer
│   └── Probe.mm                      # --probe mode: resolve 8 symbols, print, exit
└── Tests/                            # XCTest target (optional but recommended)
    ├── DyldSymbolsTests.mm
    ├── IpcFramerTests.mm
    └── Fixtures/
        └── mock_simdevice.mm        # objc_allocateClassPair-based fake (see Risks)
```

Mirror conventions from `device-stream/tools/sim-capture-avcc/` (file naming: capitalized PascalCase for source files; `Sources/` subdir; explicit `Package.swift`-equivalent `project.yml`).

### Pattern 1: dyld exports-trie symbol resolution (cache-aware)

**What:** Look up Swift private symbols by stable (prefix, suffix) pair, walking the LC_DYLD_EXPORTS_TRIE of the loaded SimulatorKit dylib, cached per pair.
**When to use:** Every call into a SimulatorKit Swift property getter or method (8 symbols total). Never use raw `dlsym` for these — `dlsym` returns NULL on Xcode 26.4+ because the mangled tail moved.
**Source:** `DFPrivateSimulatorDisplayBridge.m:259-457`

```objc
// Excerpted from DFPrivateSimulatorDisplayBridge.m:430-457 — DFResolveSwiftSymbol
// Caches resolved function pointers per (prefix, suffix). Logs once per missing symbol.
static void *DSResolveSwiftSymbol(const char *prefix, const char *suffix, const char *role) {
    static NSLock *lock;
    static NSMutableDictionary<NSString *, NSValue *> *cache;
    static dispatch_once_t once;
    dispatch_once(&once, ^{ lock = [NSLock new]; cache = [NSMutableDictionary new]; });
    NSString *key = [NSString stringWithFormat:@"%s\x01%s", prefix, suffix];
    [lock lock]; NSValue *cached = cache[key]; [lock unlock];
    if (cached) return [cached pointerValue];
    void *fn = DSFindSwiftSymbol(prefix, suffix);  // trie walk, lines 346-425
    if (!fn) DSLog(@"missing role='%s' prefix='%s' suffix='%s'", role, prefix, suffix);
    [lock lock]; cache[key] = [NSValue valueWithPointer:fn]; [lock unlock];
    return fn;
}
```

### Pattern 2: ARM64 inline-asm Swift self-getter

**What:** Swift property getters take `self` in `x20` (not `x0` like Obj-C). Calling them from C requires raw asm.
**When:** Every screen-adapter property read.
**Source:** `DFPrivateSimulatorDisplayBridge.m:533-548`

```objc
// DFCallSwiftSelfGetterByFunction — DisplayBridge.m:539-548
static id DSCallSwiftSelfGetterByFunction(id selfObject, void *function) {
    id result = nil;
    __asm__ volatile(
        "mov x20, %1\n"   // Swift puts 'self' in x20
        "blr %2\n"        // branch with link
        "mov %0, x0\n"    // capture return
        : "=r"(result) : "r"(selfObject), "r"(function)
        : "x0", "x20", "x30", "memory"
    );
    return result;
}
```

> **Arm64-only.** Reference impl assumes Apple Silicon. There's no x86_64 path. Document this in runbook.

### Pattern 3: HID send with synchronous completion

**What:** Wrap async `-sendWithMessage:freeWhenDone:completionQueue:completion:` into a sync call via `dispatch_semaphore`. Required because the Node-side touch endpoint is request/response.
**Source:** `DFPrivateSimulatorDisplayBridge.m:884-929`

### Pattern 4: Callback serialization

**What:** A single serial dispatch queue (`com.devicestream.sim-private-screen`) for all SimulatorKit screen callbacks. IOSurface lifetime is bound to the queue — must retain before crossing thread boundary.
**Source:** `DFPrivateSimulatorDisplayBridge.m:2037-2038, 2274-2330`

### Anti-Patterns to Avoid

- **Hardcoding full mangled Swift symbols.** Tail drifts with Apple type changes (kittyfarm hit this on Xcode 26.4; DisplayBridge.m:566-575). Always use prefix+suffix matching.
- **Touching `objc_msgSend` for Swift-only methods (no `@objc` thunk).** Use the asm shims or trie walker.
- **Skipping the polling loop after `initWithDevice:screenID:`.** SimulatorKit only exposes adapter screens after Simulator.app primes the device or several seconds elapse (DisplayBridge.m:2197-2211). Polling for 10s with 100ms quantum is what the reference does — do the same.
- **Letting `_latestPixelBuffer` accumulate without releasing.** Every frame callback must `CVPixelBufferRelease` the previous buffer (DisplayBridge.m:2302-2305).
- **Passing IOSurface across a queue boundary without `CVPixelBufferRetain`.** Reference uses `__bridge IOSurfaceRef` from `id surface` (DisplayBridge.m:2296) and retains via `DFCreatePixelBufferFromSurface` (CVPixelBufferCreateWithIOSurface retains internally).

## Don't Hand-Roll

| Problem | Don't build | Use instead | Why |
|---------|-------------|-------------|-----|
| Parsing Mach-O exports trie | Hand-roll uleb128 | **Copy DFTrieDescend (DisplayBridge.m:289-341) + DFFindSwiftSymbol (346-425) verbatim** | uleb128 + REEXPORT/STUB_AND_RESOLVER flag handling + LC_DYLD_EXPORTS_TRIE vs LC_DYLD_INFO_ONLY fallback is subtle. Reference is correct and tested across Xcode 15.4–26.4. |
| HID packet construction | Build Indigo struct from scratch | **`IndigoHIDMessageForMouseNSEvent` + DFCreateIndigoTouchMessage (931-988)** | The Indigo struct (DisplayBridge.m:91-140) has 17 named float/uint fields whose semantics are reverse-engineered. The C helper does most of it; we add the trailing duplicate payload with `field1=0x1, field2=0x2` (lines 981-985). |
| IOSurface → CVPixelBuffer conversion | Manual CVPixelBuffer create | **`CVPixelBufferCreateWithIOSurface` (lines 800-810)** with attributes `{IOSurfacePropertiesKey:@{}, MetalCompatibility:@YES, CGImageCompatibility:@YES, CGBitmapContextCompatibility:@YES}` | Apple-blessed path; carries IOSurface lifetime correctly. |
| H.264 encoding | Write your own VT session wrapper | **`tools/sim-capture-avcc/Sources/sim-capture-avcc/H264Encoder.swift`** | Already in-tree. Same config (Baseline_AutoLevel, 30fps GOP, 4 Mbps). Port to Obj-C++ by reading that file — semantics already proven. |
| Unix socket framer | Custom protocol | **Length-prefix framing (4-byte BE length + 1-byte kind + payload)** — same shape as `sim-capture-avcc` stdout (main.swift:107-120) | Identical to existing wire format with Node already parsing it (capture-service.ts:286-310). One Node-side parser, two transports. |
| Symbol-resolution probe | Bespoke "is everything OK" | **Iterate the 8 symbols and print `OK: N/8 resolved`** | Same shape kittyfarm uses informally via `DFLogMissingSymbolOnce`. Brief acceptance criterion AC-2 mandates this exact output format. |
| xcodebuild invocation | Hand-roll args | Mirror `scripts/build-sim-capture.sh` flag set (`-c release`, `DEVELOPER_DIR` override) + add `-project` + `-scheme` | Existing convention; staff knows it. |

**Key insight:** ~80% of the implementation is "transcribe from kittyfarm with `DF` → `DS` rename." Don't get clever. The clever has already been done by the kittyfarm author at 3am while reverse-engineering ARM64 calling conventions.

## Common Pitfalls

### Pitfall 1: Trie walker returns offset, not pointer
**What goes wrong:** `DFFindSwiftSymbol` returns `(gSimulatorKitImage + ctx.address)`. Forgetting the image base = SIGBUS on first call.
**Why:** The trie stores image-relative offsets; we add the mach_header_64 base to get an executable VA.
**Avoid:** Copy `return (void *)((uintptr_t)gSimulatorKitImage + (uintptr_t)ctx.address);` (DisplayBridge.m:424) **exactly**.
**Warning sign:** First `DSResolveSwiftSymbol` succeeds, first call to the function crashes with bad access at a small absolute address.

### Pitfall 2: SimulatorKit not loaded yet
**What goes wrong:** Trie walker probes `NSClassFromString(@"SimulatorKit.SimDeviceScreenAdapter")` to find the image; returns nil if `dlopen` hasn't fired yet (DisplayBridge.m:228-235).
**Avoid:** Always `dlopen(CoreSimulator)` and `dlopen(SimulatorKit)` **before** the first symbol lookup. Mirror `loadPrivateFrameworks:` (referenced at line 2028; ensure both `dlopen` calls succeed before symbol probe).
**Warning sign:** All 8 symbols fail to resolve; log shows `cannot locate Mach-O image for symbol resolution`.

### Pitfall 3: Adapter screens empty for several seconds
**What goes wrong:** Reading `_screenAdapter`'s `screens` dictionary immediately after `[SimDeviceScreen initWithDevice:screenID:]` returns `@{}`.
**Why:** On Xcode 26.4+, SimulatorKit populates adapter screens asynchronously (kittyfarm comment at DisplayBridge.m:2193-2196).
**Avoid:** Poll up to 10 seconds with 100ms quantum (DisplayBridge.m:2197-2211).
**Warning sign:** `The CoreSimulator screen adapter did not expose any live screens.` error after attach.

### Pitfall 4: Touch sent before screen ready
**What goes wrong:** HID client created at line 2105-2114 succeeds even if the device isn't booted; touches go nowhere.
**Avoid:** Block the `sendTouch` path until first frame has arrived (set a flag in the frame callback, like kittyfarm's `_hasLoggedFirstFrame` at DisplayBridge.m:2285).
**Warning sign:** `sendWithMessage:` returns success but no on-screen tap effect.

### Pitfall 5: Renderable view requires a window
**What goes wrong:** `activateDisplayIfNeeded` (DisplayBridge.m:2349-2399) bails with "Waiting for private display host window" when `_displayView.window == nil`. Kittyfarm hosts in an `NSWindow`. We're headless.
**Avoid:** Check whether `renderableView.connect(screen:)` is needed at all. The IOSurface frame callback in DisplayBridge.m:2290-2317 fires **without** activation in the reference — the activation is for the on-screen `NSView` rendering, not for the IOSurface pipeline. **Confirm during T-32.2** that we can omit activation. If frames don't flow, either (a) put `displayView` in an offscreen `NSWindow` (`-1000x-1000` origin, `NSBorderlessWindowMask`) — what `xcrun simctl` does internally; or (b) skip the SimDisplayView entirely and rely solely on the screen-adapter callback registered at lines 2274-2330.
**Warning sign:** Probe passes, attach succeeds, no frames in 10s.

### Pitfall 6: IOSurface retain cycle with VT
**What goes wrong:** Feeding `CVPixelBuffer` into `VTCompressionSessionEncodeFrame` retains it; if we keep `_latestPixelBuffer` strong and the encoder also retains, the buffer pool stalls.
**Avoid:** Release `_latestPixelBuffer` after handing the frame to the encoder, or use the encoder's own pool. Existing `sim-capture-avcc/Sources/sim-capture-avcc/H264Encoder.swift` shows the pattern.
**Warning sign:** Frame rate drops after ~30 frames; `CVPixelBufferPool` warnings in Console.

### Pitfall 7: Xcode 26.4 retyped `SimDeviceScreenAdapter.screens`
**What goes wrong:** Values are now `SimDeviceScreen` wrappers, not raw `SimScreen`. Old code that called `-registerScreenCallbacksWithUUID:` on the value gets `does not respond to selector`.
**Avoid:** Use `DFReadAdapterScreens` (DisplayBridge.m:566-599) which unwraps via `.screen` selector when present.
**Warning sign:** Probe OK, attach OK, screen callback never fires.

### Pitfall 8: SIGPIPE kills the daemon on Node disconnect
**What goes wrong:** Default Unix-socket `write()` raises SIGPIPE if the peer closed. macOS daemons die.
**Avoid:** Set `SO_NOSIGPIPE` on the accepted socket, or `signal(SIGPIPE, SIG_IGN)` in `main.mm`. Standard daemon hygiene.
**Warning sign:** Daemon vanishes silently when Node restarts.

## Code Examples

### Symbol resolution probe (T-32.1)

```objc
// Probe.mm — invoked as `sim-capture-private --probe <udid>`
// Acceptance: prints "OK: 8/8 symbols resolved" on Xcode 15.4+.
//
// The 8 critical symbols (see § Symbol resolution for full table).
struct SymbolSpec { const char *prefix; const char *suffix; const char *role; };
static const struct SymbolSpec kCriticalSymbols[] = {
    {"$sSo9SimDeviceC12SimulatorKitE13screenAdapter",        "vg",   "SimDevice.screenAdapter.getter"},
    {"$s12SimulatorKit22SimDeviceScreenAdapterC7screens",    "vg",   "SimDeviceScreenAdapter.screens.getter"},
    {"$s12SimulatorKit24SimDisplayRenderableViewC7connect", "FTj",  "SimDisplayRenderableView.connect(screen:)"},
    // ... 5 more (full set in § Symbol resolution)
};

int main_probe(const char *udid) {
    DSLoadPrivateFrameworks();  // dlopen CoreSimulator + SimulatorKit
    int resolved = 0;
    const int total = sizeof(kCriticalSymbols)/sizeof(kCriticalSymbols[0]);
    for (int i = 0; i < total; i++) {
        void *fn = DSResolveSwiftSymbol(kCriticalSymbols[i].prefix,
                                         kCriticalSymbols[i].suffix,
                                         kCriticalSymbols[i].role);
        if (fn) resolved++;
        else fprintf(stderr, "MISSING: %s\n", kCriticalSymbols[i].role);
    }
    fprintf(stdout, "%s: %d/%d symbols resolved\n",
            resolved == total ? "OK" : "FAIL", resolved, total);
    return resolved == total ? 0 : 1;
}
```

### Frame callback → encoder (T-32.2 + T-32.4)

```objc
// ScreenAttach.mm — surfacesChangedCallback handler. Adapted from
// DFPrivateSimulatorDisplayBridge.m:2290-2317.
^(id surface, id maskedSurface) {
    CVPixelBufferRef pb = DSCreatePixelBufferFromSurface((__bridge IOSurfaceRef)surface);
    if (!pb) {
        DSLog(@"unsupported IOSurface from screen callback");
        return;
    }
    // Hand to encoder on the dedicated encoder queue; encoder retains.
    [encoder encodeFrame:pb forceKeyframe:NO];
    CVPixelBufferRelease(pb);
}
```

### VTCompressionSession config (T-32.4)

```objc
// H264Encoder.mm — exactly mirrors tools/sim-capture-avcc/H264Encoder.swift
VTCompressionSessionRef session;
OSStatus status = VTCompressionSessionCreate(
    kCFAllocatorDefault, width, height,
    kCMVideoCodecType_H264,
    NULL, NULL, NULL,
    onCompressedFrame, (__bridge void *)self, &session);

VTSessionSetProperty(session, kVTCompressionPropertyKey_RealTime, kCFBooleanTrue);
VTSessionSetProperty(session, kVTCompressionPropertyKey_AllowFrameReordering, kCFBooleanFalse);
VTSessionSetProperty(session, kVTCompressionPropertyKey_ProfileLevel,
                     kVTProfileLevel_H264_Baseline_AutoLevel);
VTSessionSetProperty(session, kVTCompressionPropertyKey_MaxKeyFrameInterval,
                     (__bridge CFNumberRef)@30);
VTSessionSetProperty(session, kVTCompressionPropertyKey_AverageBitRate,
                     (__bridge CFNumberRef)@4000000);
VTSessionSetProperty(session, kVTCompressionPropertyKey_ExpectedFrameRate,
                     (__bridge CFNumberRef)@30);
```

### IPC frame writer (T-32.4)

```objc
// IpcServer.mm — single writer queue, length-prefix framing.
// Layout: [u32 BE length covering kind+payload][u8 kind][payload bytes...]
- (void)writeFrame:(uint8_t)kind payload:(NSData *)payload {
    dispatch_async(_writerQueue, ^{
        uint32_t len = htonl((uint32_t)(payload.length + 1));
        struct iovec iov[3] = {
            { &len,   sizeof(len)   },
            { &kind,  sizeof(kind)  },
            { (void *)payload.bytes, payload.length },
        };
        ssize_t n = writev(self->_clientFd, iov, 3);
        if (n < 0) DSLog(@"writev errno=%d", errno);
    });
}
```

### Node-side client (T-32.5)

```typescript
// device-stream/packages/ios-simulator/src/sim-capture-private-client.ts
// Same emit/event surface as CaptureService.startAvccCapture.
// Wire format: [u32 BE length][u8 kind][payload]. Kinds:
//   0x01 = SPS+PPS init (avcC), 0x02 = AU (keyframe or delta — TBD: split or carry flag),
//   0x10 = ack, 0xFF = error.
// Outbound (control): 0xC1 = touch, 0xC9 = quit.
import * as net from 'net';
import { EventEmitter } from 'events';

export class SimCapturePrivateClient extends EventEmitter {
  static async spawn(udid: string): Promise<SimCapturePrivateClient> {
    const socketPath = `/tmp/device-stream-sim-${udid}.sock`;
    // ... spawn binary with --udid udid --socket socketPath, wait for ready
    const sock = net.createConnection(socketPath);
    return new SimCapturePrivateClient(sock, udid);
  }

  private parseLoop() {
    let buf = Buffer.alloc(0);
    this.sock.on('data', (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      while (buf.length >= 4) {
        const len = buf.readUInt32BE(0);
        if (buf.length < 4 + len) break;
        const kind = buf[4];
        const payload = Buffer.from(buf.subarray(5, 4 + len)); // copy out
        buf = buf.subarray(4 + len);
        this.emit('frame', { udid: this.udid, kind, payload });
      }
    });
  }

  async sendTouch(x: number, y: number, phase: 0|1|2|3): Promise<void> {
    // 0xC1 control: [u32 length=21][u8 kind=0xC1][f64 x][f64 y][u8 phase][u32 id]
    const payload = Buffer.alloc(21);
    payload.writeDoubleBE(x, 0);
    payload.writeDoubleBE(y, 8);
    payload.writeUInt8(phase, 16);
    payload.writeUInt32BE(0, 17); // touch id
    this.writeFrame(0xC1, payload);
  }
}
```

### TS adapter swap (T-32.5)

```typescript
// device-stream/packages/ios-simulator/src/capture-service.ts (modified)
async startCapture(deviceId: string, options: CaptureOptions): Promise<boolean> {
  const tryPrivate = process.env.DEVICE_STREAM_SIM_PRIVATE !== '0';
  if (tryPrivate) {
    try {
      const client = await SimCapturePrivateClient.spawn(deviceId, options);
      this.wireClientEvents(deviceId, client);
      return true;
    } catch (e) {
      console.warn('[SimCapture] private bridge failed, falling back', e);
    }
  }
  // existing avcc / mjpeg path
  return this.startAvccCapture(deviceId, options);
}
```

## State of the Art

| Old approach | Current approach | When changed | Impact |
|--------------|------------------|--------------|--------|
| `xcrun simctl io <udid> recordVideo` | SimulatorKit private API direct | always — kittyfarm proved viable | No subprocess overhead; no `.mp4` segment boundaries |
| ScreenCaptureKit on top of Simulator.app window | SimulatorKit `SimDeviceScreen` IOSurface callback | this phase | No TCC prompt, no compositor latency, headless capable |
| Hardcoded mangled symbols | dyld exports-trie prefix+suffix match | kittyfarm post-Xcode 26.4 | Survives Apple type signature changes |
| Heavy NAL processing in Node | VT in helper, emit AVCC binary frames | `sim-capture-avcc` (already merged) + this phase | Less Node CPU; same wire format |

**Deprecated/outdated:**
- Calling `-sendPurpleEvent:` on `SimDevice` — pruned from macOS 26 (DisplayBridge.m:1230-1232). Use `lookup:error:` + raw `mach_msg_send` (DisplayBridge.m:1265-1294) for the orientation event path. Orientation is **not in scope** for Phase 32 (out per Discretion), but if it leaks in, use the new path.

## Open Questions

1. **Does the IOSurface frame callback fire without `activateDisplayIfNeeded`?**
   - What we know: kittyfarm registers the screen callback **before** calling `activateDisplayIfNeeded` (DisplayBridge.m:2274 vs 2349). The callback in the reference fires from line 2290 (the `surfacesChangedCallback`), and `activateDisplayIfNeeded` is gated on `_displayView.window != nil` — in kittyfarm's GUI, that's only true after the view is added to a window.
   - What's unclear: Without `activate`, do frames still flow on a fresh boot? Or does kittyfarm rely on Simulator.app being launched separately to prime the device?
   - Recommendation: T-32.2 first task is to confirm. Strategy: run the daemon against a `simctl boot`-ed device with no Simulator.app, log every callback. If callbacks fire → omit `displayView`/`renderableView` entirely. If not → host the view in an offscreen `NSWindow` (origin -10000,-10000, borderless, hidden). Document outcome in runbook.

2. **What exactly are the 8 critical Swift symbols?**
   - What we know: Brief mandates probe prints `8/8`. Kittyfarm uses ~12 distinct trie-resolved symbols across the file. The "critical 8" is **not** explicitly enumerated in BRIEF or CONTEXT.
   - What's unclear: Which subset of kittyfarm's symbol set is the "headless attach + touch" minimum?
   - Recommendation: Use this set (derived from kittyfarm by tracing the headless attach path 2027-2340):
     1. `$sSo9SimDeviceC12SimulatorKitE13screenAdapter / vg` — `SimDevice.screenAdapter` (DisplayBridge.m:2127)
     2. `$s12SimulatorKit22SimDeviceScreenAdapterC7screens / vg` — adapter.screens (line 575)
     3. `$s12SimulatorKit24SimDisplayRenderableViewC7connect / FTj` — renderableView.connect(screen:) (line 2383) — *optional if Q1 resolves "no activation needed"*
     4. Plus the resolved Obj-C selectors (which `dlsym` doesn't cover but should be probed as `class_respondsToSelector`):
        - `SimServiceContext +contextForDeveloperDir:connectionType:error:` — (DisplayBridge.m:2054)
        - `SimDevice -UDID`, `-screenAdapter`
        - `SimDeviceLegacyHIDClient -initWithDevice:error:` (line 2109)
        - `SimDeviceScreen -initWithDevice:screenID:` (line 2153)
        - `... -registerScreenCallbacksWithUUID:callbackQueue:frameCallback:surfacesChangedCallback:propertiesChangedCallback:` (line 2277)
        - `SimDeviceLegacyHIDClient -sendWithMessage:freeWhenDone:completionQueue:completion:` (line 900)
     - Mix of trie-resolved (3) + Obj-C class/selector existence (5) = 8. Planner should lock this list in T-32.1.

3. **Does Phase 32 need to handle multiple simulators concurrently?**
   - What we know: Current `CaptureService` uses a `Map<deviceId, Instance>` keyed by UDID. Each instance spawns one binary.
   - What's unclear: Does the private bridge daemon serve **one** udid (spawn per device) or **many** (multiplex)?
   - Recommendation: One UDID per daemon process. Matches existing `sim-capture-avcc` model (one binary per device). Socket path encodes UDID (`/tmp/device-stream-sim-<udid>.sock`). Simpler lifecycle; no multiplex bug surface.

4. **Touch coordinate system: normalized 0..1 vs pixel?**
   - What we know: BRIEF says normalized coords (0..1) come from Node; helper converts via `SimDeviceScreen.bounds`.
   - What's unclear: Kittyfarm's `DFCreateIndigoTouchMessage` (DisplayBridge.m:931-988) passes `ratioPoint` directly into `IndigoHIDMessageForMouseNSEvent` — the C helper appears to want ratio (0..1) in the first argument and `displaySize` separately.
   - Recommendation: Pass normalized (ratio) to the C helper, pass `displaySize = CGSizeMake(width, height)` from `_displayPixelSize` (DisplayBridge.m:2308). Don't pre-multiply.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Native helper framework | **XCTest** (via xcodebuild test) |
| Native config | `project.yml` defines a `sim-capture-private-tests` target |
| Quick run (native) | `xcodebuild test -project sim-capture-private.xcodeproj -scheme sim-capture-private-tests -destination 'platform=macOS'` |
| TS framework | **Vitest** (already used by `device-stream/packages/ios-simulator/tests/`) |
| Quick run (TS) | `npm test --workspace @device-stream/ios-simulator -- sim-capture-private-client` |
| Full suite | `npm run test` (root) — runs all workspaces; native runs separately in CI |
| Integration smoke | `scripts/smoke-sim-private.sh <udid>` (new) — boots a sim, runs `--probe`, captures 30 frames, asserts |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated command | File exists? |
|--------|----------|-----------|-------------------|--------------|
| SIM-PRIV-01 | Zero TCC prompts on fresh user | manual / runbook | n/a — verify by `tccutil reset ScreenCapture` then attach succeeds | ❌ Wave 0 (runbook section) |
| SIM-PRIV-02 | `--probe` prints `OK: 8/8 symbols resolved` | smoke | `bin/sim-capture-private --probe <udid> \| grep -q '^OK: 8/8'` | ❌ Wave 0 |
| SIM-PRIV-02 | Trie walker finds known stable symbol | unit (XCTest) | `xcodebuild test -only-testing:sim-capture-private-tests/DyldSymbolsTests/testResolveStableSymbol` | ❌ Wave 0 |
| SIM-PRIV-03 | H.264 stream decodes; first IDR ≤ 1s | integration | `scripts/smoke-sim-private.sh <udid> --capture-frames 30 --decode-check` | ❌ Wave 0 |
| SIM-PRIV-03 | Visual diff vs ScreenCaptureKit ≤ 0.5% | integration (matrix CI) | `scripts/sim-visual-diff.sh <udid>` — golden image compare | ❌ Wave 0 |
| SIM-PRIV-04 | Touch latency ≤ baseline | manual + perf harness | `scripts/sim-touch-latency.sh <udid>` (records tap → frame delta) | ❌ Wave 0 |
| SIM-PRIV-04 | HID send completes with no error | unit (mock SimDevice) | `xcodebuild test -only-testing:sim-capture-private-tests/TouchInjectTests/testSendTouchSuccess` | ❌ Wave 0 |
| SIM-PRIV-05 | Env opt-out falls back to AVCC | unit (Vitest) | `vitest run sim-capture-private-client.spec.ts -t "fallback when DEVICE_STREAM_SIM_PRIVATE=0"` | ❌ Wave 0 |
| SIM-PRIV-05 | Spawn failure falls back to AVCC | unit (Vitest) | `vitest run sim-capture-private-client.spec.ts -t "fallback when spawn fails"` | ❌ Wave 0 |
| SIM-PRIV-06 | Xcode matrix green | CI | `.github/workflows/sim-private-matrix.yml` (daily) — matrix on Xcode 15.4, 16.0, 16.1, 17.x | ❌ Wave 0 |
| SIM-PRIV-REF | IPC framer round-trips | unit (XCTest) | `xcodebuild test -only-testing:sim-capture-private-tests/IpcFramerTests` | ❌ Wave 0 |
| SIM-PRIV-REF | IPC framer round-trips | unit (Vitest) | `vitest run sim-capture-private-client.spec.ts -t "framer"` | ❌ Wave 0 |
| (perf) | 1h soak no leak | weekend cron CI | `scripts/sim-soak.sh <udid> --duration 1h` with leaks utility | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** native quick run + TS workspace run (under 30s)
- **Per wave merge:** full TS suite + native tests + smoke probe on local sim
- **Phase gate:** matrix CI green + smoke + soak (8h cron) before `/gsd:verify-work`

### Wave 0 Gaps

All test infrastructure is new for this phase. Add in Wave 0 (before any code):

- [ ] `device-stream/native-servers/sim-capture-private/project.yml` — XcodeGen spec (target + tests target)
- [ ] `device-stream/native-servers/sim-capture-private/Tests/DyldSymbolsTests.mm` — covers SIM-PRIV-02
- [ ] `device-stream/native-servers/sim-capture-private/Tests/IpcFramerTests.mm` — covers SIM-PRIV-REF
- [ ] `device-stream/native-servers/sim-capture-private/Tests/TouchInjectTests.mm` — covers SIM-PRIV-04 unit
- [ ] `device-stream/native-servers/sim-capture-private/Tests/Fixtures/mock_simdevice.mm` — `objc_allocateClassPair` based fake SimDevice for HID send unit test
- [ ] `device-stream/packages/ios-simulator/tests/sim-capture-private-client.spec.ts` — covers SIM-PRIV-05, framer
- [ ] `device-stream/scripts/smoke-sim-private.sh` — integration smoke (real sim)
- [ ] `device-stream/scripts/sim-visual-diff.sh` — golden image compare vs AVCC baseline
- [ ] `device-stream/scripts/sim-touch-latency.sh` — touch → frame latency harness
- [ ] `device-stream/scripts/sim-soak.sh` — soak test wrapper
- [ ] `.github/workflows/sim-private-matrix.yml` — daily matrix
- [ ] `device-stream/scripts/build-sim-capture-private.sh` — build script (mirrors `build-sim-capture.sh`)
- [ ] `device-stream/scripts/postinstall.js` — **does not exist yet**; one-shot create OR extend `package.json` postinstall to call the new build script. Brief T-32.6 names it but file isn't present in tree.

## Sources

### Primary (HIGH confidence)

- `kittyfarm/PrivateSimulator/DFPrivateSimulatorDisplayBridge.m` — full pipeline (read lines 1-2400)
  - `:23-69` — framework paths, developer dir resolution
  - `:71-140` — Indigo HID struct layouts
  - `:206-457` — dyld trie walker (the whole thing)
  - `:533-720` — ARM64 inline-asm shims for Swift getter/setter calling conventions
  - `:795-812` — `CVPixelBufferCreateWithIOSurface` wrapper
  - `:884-988` — HID send + Indigo touch message builder
  - `:2027-2340` — `initWithUDID:` attach sequence
  - `:2349-2410` — `activateDisplayIfNeeded` (renderableView.connect)
- `kittyfarm/PrivateSimulator/DFPrivateSimulatorDisplayBridge.h` — public API (delegate + 4 methods)
- `kittyfarm/Connections/IOSSimulatorConnection.swift` — usage pattern (delegate-based; we'll go socket-based)
- `kittyfarm/Support/KittyFarm-Bridging-Header.h` — 5-line bridging header pattern
- `device-stream/tools/sim-capture-avcc/Sources/sim-capture-avcc/main.swift` — existing stdout framer; our IPC mirrors it
- `device-stream/tools/sim-capture-avcc/Sources/sim-capture-avcc/SimulatorKitScreen.swift` — alternate (older) attach path via `device.io.deviceIOPorts` + per-port framebuffer descriptor. Diverges from kittyfarm; **do not** mix into the new helper.
- `device-stream/packages/ios-simulator/src/capture-service.ts` — Node-side consumer; preserve its event surface

### Secondary (MEDIUM confidence)

- Apple `dyld3` source (`<mach-o/loader.h>`, `<mach-o/nlist.h>`) — confirms LC_DYLD_EXPORTS_TRIE format
- VideoToolbox docs — `VTCompressionSession` is stable Apple API, low risk
- `.planning/phases/32-simulatorkit-bridge/32-BRIEF.md` — locked design source

### Tertiary (LOW confidence)

- **None.** No web searches were needed — reference implementation is comprehensive.

## Risks & Mitigations (summary; details in § Common Pitfalls)

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Apple renames a Swift symbol in next Xcode | Medium | High (bridge broken) | Trie walker + 8/8 probe before use; fall back to ScreenCaptureKit; CI matrix daily |
| Headless attach requires offscreen window after all | Medium | Medium (need to add `NSWindow` hosting) | T-32.2 confirms early; runbook documents workaround |
| Code-sign rejection on locked-down Macs | Low | Medium | Document unsigned-dev path; ship signed helper later behind team cert |
| Memory leak in IOSurface retain cycle | Medium | Medium | Address-sanitize CI run + 1h soak |
| Touch coordinate mismatch across screen sizes | Low | Low | Read `SimDeviceScreen.bounds` at attach; transform inside helper |
| Apple Silicon-only (no x86_64) | Certain | Low | Document explicitly; CI runners are already arm64; brief locks macOS 13+ Apple Silicon |
| Concurrent UDIDs in one process | Low | Medium | Spawn one daemon per UDID; socket path encodes UDID |
| Phase 32 unmapped to REQUIREMENTS.md | Certain | Cosmetic | Document SIM-PRIV-* pseudo-IDs (this file) for downstream planner |

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — reference impl + existing in-tree binary cover every component
- Architecture: HIGH — every pattern has a kittyfarm file:line citation
- Pitfalls: HIGH — kittyfarm comments document Xcode 26.4 break; matches our matrix concern
- Symbol resolution: HIGH — algorithm read end-to-end
- Headless behavior (Q1): MEDIUM — verified callbacks register but actual headless frame delivery unverified
- 8-symbol exact set (Q2): MEDIUM — proposed set is the minimum for the headless attach path; planner should lock in T-32.1

**Research date:** 2026-05-15
**Valid until:** 2026-08-15 (3 months — SimulatorKit is private but Apple-paced; Xcode minor revisions land monthly. CI matrix is the long-term defense.)

## RESEARCH COMPLETE

**Phase:** 32 — SimulatorKit Private Bridge
**Confidence:** HIGH

### Key Findings

- **~80% of implementation is direct transcription from kittyfarm.** The dyld trie walker (DisplayBridge.m:259-457), attach sequence (2027-2340), HID send (884-929), and Indigo touch builder (931-988) are correct, tested across Xcode 15.4–26.4, and should be copied with only the `DF` → `DS` prefix rename.
- **Novel work is in three places only:** (a) Unix-socket IPC server replacing kittyfarm's `id<...Delegate>` dispatch; (b) `VTCompressionSession` between the IOSurface callback and the socket writer — copy config from `sim-capture-avcc/H264Encoder.swift`; (c) XcodeGen + xcodebuild orchestration (existing `sim-capture-avcc` uses SwiftPM — different toolchain).
- **One open hypothesis must be tested first in T-32.2:** whether IOSurface frame callbacks fire without `activateDisplayIfNeeded` + a host window. Reference code registers the screen callback before activation, so headless is plausible — but kittyfarm always has a window. Plan must include a confirmation experiment as the first sub-task of T-32.2.
- **The "8 critical symbols" set is not enumerated in BRIEF.** Proposed set (3 trie-resolved Swift + 5 Obj-C selector probes) listed in Open Question #2. Planner should lock this list as part of T-32.1's "skeleton + class resolution" deliverable.
- **Phase has no REQUIREMENTS.md mapping** (REQUIREMENTS.md is closed at v3.0 / Phase 30). Pseudo-IDs SIM-PRIV-01..06 + SIM-PRIV-REF are introduced here for traceability; planner uses them in PLAN.md.

### File Created

`/Users/heicg/Desktop/projects/device-farm/.planning/phases/32-simulatorkit-bridge/32-RESEARCH.md`

### Confidence Assessment

| Area | Level | Reason |
|------|-------|--------|
| Standard Stack | HIGH | Every component has a citation in kittyfarm or existing in-tree code |
| Architecture | HIGH | 4 patterns documented with exact line refs |
| Pitfalls | HIGH | Kittyfarm comments document the Xcode 26.4 break; same matrix concern as BRIEF |
| Symbol resolution algorithm | HIGH | Read end-to-end |
| Headless behavior | MEDIUM | Frame callback registers without activation — needs T-32.2 confirmation |
| Exact 8-symbol list | MEDIUM | Proposed set is minimum-viable; planner should lock |

### Open Questions

1. Does the IOSurface frame callback fire without `activateDisplayIfNeeded` + a host window? (Test in T-32.2 first sub-task)
2. Exact identity of the "8 critical symbols" — planner to lock in T-32.1
3. One-daemon-per-UDID vs multiplex — recommended one per UDID; planner to confirm
4. Touch coords: pass normalized ratio + displaySize separately (mirroring kittyfarm DisplayBridge.m:944-949)

### Ready for Planning

Research complete. Planner can now create PLAN.md files for T-32.1 through T-32.7. The two open questions above are flagged for T-32.1 / T-32.2 to resolve experimentally, not blocking plan generation.
