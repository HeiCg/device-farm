# Phase 32 — SimulatorKit Private Bridge (iOS Simulator streaming)

**Track:** device-stream (DS)
**Effort:** ~5 days
**Source idea:** kittyfarm `KittyFarm/PrivateSimulator/DFPrivateSimulatorDisplayBridge.m` (3022 LOC)
**Replaces:** `device-stream/packages/ios-simulator/` ScreenCaptureKit pipeline (`sim-capture` Swift binary)

## Goal

Replace ScreenCaptureKit-based iOS simulator capture with SimulatorKit private APIs that get IOSurface frames directly from the simulator process — no screen-recording permission, no compositor latency, no visible window required.

## Why

Three concrete benefits, all daily pain:
1. **No TCC prompt.** ScreenCaptureKit needs Screen Recording permission. Every fresh laptop or CI runner means a manual approval dance. kittyfarm proves it can be skipped.
2. **Headless capture.** Today we must run `simctl boot` and have the Simulator window visible (compositor must composite something). SimulatorKit feeds frames straight from the device backboard process — `-no-window`-like behavior is possible.
3. **Lower latency.** Frame callback is invoked when the simulator backboard renders, not when the compositor next refreshes our hidden window.

**Trade-off:** binds to private Apple frameworks that can rename between Xcode releases. We mitigate with a dyld-trie symbol resolver and a CI matrix.

## Scope

### In
- New Obj-C++ helper `device-stream/native-servers/sim-capture-private/` exposing 4 functions over a Unix socket: `attach(udid)`, `subscribeFrames`, `sendTouch`, `detach`.
- IOSurface → CVPixelBuffer → H.264 (VideoToolbox) → fragmented MP4 over WS (matches current contract).
- HID injection for touch via `SimDeviceLegacyHIDClient` + `IndigoHIDMessageForMouseNSEvent`.
- Resilient Swift symbol resolver (parses dyld exports trie at runtime to find mangled `SimulatorKit` Swift symbols across Xcode versions).
- Drop-in replacement: `IosSimulatorService` in `packages/ios-simulator/src/service.ts` switches to the new helper when `DEVICE_STREAM_SIM_PRIVATE=1` (default ON after canary period).
- Fallback path: keep ScreenCaptureKit `sim-capture` for Xcode versions where private API resolution fails.

### Out
- iOS physical devices (still WDA MJPEG, separate codebase)
- macOS app (this is a daemon launched from Node, not a GUI app)
- Code-signing of the helper (run unsigned for dev; signing instructions in runbook)

## Background — the kittyfarm pipeline

From `DFPrivateSimulatorDisplayBridge.m` (kittyfarm), the attach sequence is:

1. `dlopen` `/Library/Developer/PrivateFrameworks/CoreSimulator.framework/CoreSimulator` and `Xcode.app/.../Library/PrivateFrameworks/SimulatorKit.framework/SimulatorKit`.
2. `SimServiceContext` via `+contextForDeveloperDir:error:` → `defaultDeviceSetWithError:` → enumerate `devices` → match by `UDID.UUIDString`.
3. Construct `SimDeviceLegacyHIDClient` with `-initWithDevice:error:` (HID injection channel).
4. Read `SimDevice.screenAdapter` (Swift extension) — symbol mangled as `$sSo9SimDeviceC12SimulatorKitE13screenAdapter` + suffix `vg`, resolved via dyld exports trie.
5. Instantiate `SimulatorKit.SimDeviceScreen` via `-initWithDevice:screenID:`.
6. Register callbacks: `registerScreenAdapterCallbacksWithUUID:callbackQueue:screenConnectedCallback:screenWillDisconnectCallback:` and `registerScreenCallbacksWithUUID:callbackQueue:frameCallback:surfacesChangedCallback:propertiesChangedCallback:`.
7. Frame callback receives `IOSurfaceRef` → `CVPixelBufferCreateWithIOSurface` → CVPixelBuffer.
8. Touch: `IndigoHIDMessageForMouseNSEvent` (C export) wraps an NSEvent into the Indigo HID format; sent via `-sendWithMessage:freeWhenDone:completionQueue:completion:`.

## Tasks

### T-32.1 — Skeleton helper + dlopen + class resolution (~6h)

**Files**
- `device-stream/native-servers/sim-capture-private/sim-capture-private.xcodeproj` (XcodeGen)
- `device-stream/native-servers/sim-capture-private/Sources/Bridge.mm` (Obj-C++)
- `device-stream/native-servers/sim-capture-private/Sources/DyldSymbols.mm` (symbol resolver)
- `device-stream/native-servers/sim-capture-private/Sources/main.mm`

**Implementation**

`Bridge.mm` exposes one C entry point `bridge_attach(const char* udid, on_frame_cb, on_error_cb)` and one `bridge_send_touch(x,y,phase,pressure,id)`.

`DyldSymbols.mm` walks the LC_DYLD_INFO_ONLY exports trie of the loaded SimulatorKit binary to find mangled Swift property getters even if the descriptor name changes:

```
resolveSwiftPropertyGetter(libraryHandle, classMangled, propertyName):
  base = dlopen-returned handle
  load_command DYLD_INFO_ONLY -> export_off, export_size
  walk trie for symbol prefix $s + classMangled + 'E' + len(propertyName) + propertyName + 'vg'
  return offset + slide
```

Reject early if any of the 8 critical symbols cannot be resolved; print which one and exit with diagnostic.

### T-32.2 — Screen attach + frame callback (~6h)

**Files**
- `device-stream/native-servers/sim-capture-private/Sources/ScreenAttach.mm`

**Implementation**

Wire the screen adapter callbacks. Frame callback receives `IOSurfaceRef`:

```
on_frame(IOSurfaceRef surf, properties):
  CVPixelBufferRef pb;
  CVPixelBufferCreateWithIOSurface(NULL, surf, nil, &pb);
  encode_h264(pb)  // see T-32.4
  CVPixelBufferRelease(pb);
```

Handle `screenConnected`/`screenWillDisconnect` to gracefully tear down on device shutdown.

### T-32.3 — HID injection for touch (~4h)

**Files**
- `device-stream/native-servers/sim-capture-private/Sources/TouchInject.mm`

**Implementation**

```
bridge_send_touch(x, y, phase, pressure, id):
  NSEvent* ev = synthesizeNSEvent(phase, x, y, pressure, id, deviceBounds);
  size_t len = 0;
  void* msg = IndigoHIDMessageForMouseNSEvent(ev, &len, &freeFn);
  DFIndigoMessage* wrap = [[DFIndigoMessage alloc] initWithBytes:msg length:len freeFn:freeFn];
  [hidClient sendWithMessage:wrap freeWhenDone:YES completionQueue:hidQueue completion:^(NSError* e) {
    if (e) logErr(e);
  }];
```

Normalized coords from Node-side (0..1) are converted to device-pixel coords inside the helper using `SimDeviceScreen.bounds` properties.

### T-32.4 — H.264 encode + WS bridge (~6h)

**Files**
- `device-stream/native-servers/sim-capture-private/Sources/H264Encoder.mm` (VTCompressionSession)
- `device-stream/native-servers/sim-capture-private/Sources/IpcServer.mm` (Unix socket)
- `device-stream/packages/ios-simulator/src/sim-capture-private-client.ts` (Node client)

**IPC contract**

Unix socket at `/tmp/device-stream-sim-<udid>.sock`. Frames pushed as length-prefixed framed messages:

```
[u32 length][u8 kind][payload]
kind: 0x01 = SPS+PPS init, 0x02 = AU, 0x10 = ack, 0xFF = error
control messages from Node: 0xC1 = touch {x,y,phase,pressure,id}, 0xC9 = quit
```

Encoder: `VTCompressionSessionCreate(..., kCMVideoCodecType_H264, ...)` with `RealTime=true`, `ProfileLevel=Baseline_AutoLevel`, `MaxKeyFrameInterval=30`, `AverageBitRate=4_000_000`.

### T-32.5 — TypeScript adapter swap (~3h)

**Files**
- `device-stream/packages/ios-simulator/src/service.ts` (modify)
- `device-stream/packages/ios-simulator/src/sim-capture-private-client.ts` (new, ~150 LOC)
- `device-stream/packages/ios-simulator/__tests__/` (extend)

**Behavior**

```
service.start():
  if env.DEVICE_STREAM_SIM_PRIVATE !== '0':
    try { return await SimCapturePrivateClient.spawn(udid) }
    catch (e) { log.warn('private bridge failed, falling back', e); }
  return SimCaptureScreenCaptureKitClient.spawn(udid)  // existing
```

### T-32.6 — Build script + scripts/fetch-sim-capture (~2h)

**Files**
- `device-stream/scripts/build-sim-capture-private.sh` (new)
- `device-stream/scripts/postinstall.js` (extend)
- `device-stream/package.json` (`build:sim-capture-private` script)

Build via `xcodebuild` against macOS 13+, archive a relocatable `.app` bundle (helper is daemon-style — no UI). Default install path: `device-stream/bin/sim-capture-private`.

### T-32.7 — Runbook + CI matrix (~3h)

**Files**
- `docs/runbooks/sim-capture-private.md` (new)
- `.github/workflows/sim-private-matrix.yml` (new, daily)

**Matrix**

Run a smoke test that boots a simulator, attaches the private bridge, captures 30 frames, and tears down — across Xcode 15.4 / 16.0 / 16.1 / 17.x. Surfaces symbol-resolution regressions early.

## Acceptance criteria

- [ ] Fresh macOS user can `device-farm run` an iOS sim job with zero permission prompts.
- [ ] `device-stream-sim-cap-private --probe <udid>` prints "OK: 8/8 symbols resolved" on Xcode 15.4+.
- [ ] H.264 stream from the private bridge plays in `web/` viewer indistinguishable from ScreenCaptureKit baseline (visual diff < 0.5%).
- [ ] Touch injection latency (touch sent → frame showing tap effect) measured ≤ ScreenCaptureKit baseline.
- [ ] Fallback to ScreenCaptureKit works when `DEVICE_STREAM_SIM_PRIVATE=0`.
- [ ] CI matrix passes on Xcode 16.0+.

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Apple renames a Swift symbol in next Xcode | Dyld trie walker + 8/8 probe before use; fall back to ScreenCaptureKit; CI catches regressions daily |
| Sandboxing / signing rejection | Document unsigned-dev path; ship signed helper later behind `device-stream-team` cert |
| Private API exposure breaks App Store submission | N/A — this is a Mac-side tool, never shipped in user apps |
| Memory leak in IOSurface retain cycle | Address sanitize CI run + 1h soak test (8h on weekend cron) |
| Touch coordinate mismatch across screen sizes | Read `SimDeviceScreen` bounds at attach; bake transform into helper not Node |

## References

- kittyfarm: `KittyFarm/PrivateSimulator/DFPrivateSimulatorDisplayBridge.m` (full pipeline)
- kittyfarm: `KittyFarm/PrivateSimulator/DFPrivateSimulatorDisplayBridge.m:259-457` (dyld trie resolver — copy this)
- kittyfarm: `KittyFarm/PrivateSimulator/DFPrivateSimulatorDisplayBridge.m:2027-2340` (attach sequence)
- kittyfarm: `KittyFarm/PrivateSimulator/DFPrivateSimulatorDisplayBridge.m:884` (HID send)
- Current code: `device-stream/packages/ios-simulator/`, `device-stream/native-servers/sim-capture/` (ScreenCaptureKit)

## Done = Nyquist-compliant

Symbol-resolution probe test, attach/detach unit test (mock SimDevice), HID round-trip (synthesize tap → verify Frame contains expected touch indicator on a calibration app), 1h soak, Xcode matrix CI green.
