// ScreenAttach.h — SimulatorKit attach sequence + screen-adapter frame
// callback surface.
//
// Implemented in Plan 32-02 (T-32.2).  Verbatim port (with `DF`→`DS`
// rename only) of the attach sequence from kittyfarm
// `DFPrivateSimulatorDisplayBridge.m` lines 2027-2340 and the
// IOSurface→CVPixelBuffer wrapper from lines 795-812.  Reference repo is
// STUDY-ONLY — no linked dependency.  See
// `.planning/phases/32-simulatorkit-bridge/32-CONTEXT.md` (External
// Dependencies Policy).
//
// The bridge is a single-UDID daemon (per 32-RESEARCH.md Open Question
// #3): one attach per process; module-level static state owns the
// SimDevice + HID client handles that both `ScreenAttach.mm` and
// `TouchInject.mm` reach via accessors.
#pragma once

#import <Foundation/Foundation.h>
#import <CoreGraphics/CoreGraphics.h>
#import <CoreVideo/CoreVideo.h>

NS_ASSUME_NONNULL_BEGIN

/// Invoked on a private serial dispatch queue every time the
/// SimulatorKit screen adapter delivers a new IOSurface.  The
/// pixel buffer is owned by the daemon — the callee must NOT
/// CFRelease it; copy/retain if it must outlive the call.
typedef void (*DSFrameCallback)(CVPixelBufferRef pixelBuffer,
                                double widthPx,
                                double heightPx,
                                void *_Nullable userData);

/// Invoked when the attach sequence fails or a fatal runtime error
/// occurs after attach.  The `msg` pointer is owned by the caller —
/// copy the string if it must outlive the call.
typedef void (*DSErrorCallback)(const char *msg, void *_Nullable userData);

/// Attaches to a simulator by UDID.  Returns 0 on success.  On success
/// `frame_cb` is invoked on a private serial queue each time the
/// SimulatorKit screen adapter delivers a new surface.
///
/// Sequence (kittyfarm DisplayBridge.m:2027-2340):
///   1. dlopen CoreSimulator + SimulatorKit (via DSLoadPrivateFrameworks)
///   2. +[SimServiceContext serviceContextForDeveloperDir:connectionType:error:]
///   3. -[ctx defaultDeviceSetWithError:] → enumerate devices → match UDID
///   4. -[[SimulatorKit.SimDeviceLegacyHIDClient alloc] initWithDevice:error:]
///   5. DSResolveSwiftSymbol("$sSo9SimDeviceC12SimulatorKitE13screenAdapter", "vg")
///      + DSCallSwiftSelfGetterByFunction(device, fn) → adapter host
///   6. -[[SimulatorKit.SimDeviceScreen alloc] initWithDevice:screenID:] @0
///   7. POLL adapter.screens up to 10s @ 100ms (Pitfall 3)
///   8. unwrap each screen via `-screen` accessor (Pitfall 7 — Xcode 26.4
///      retyped the dictionary values from SimScreen* to SimDeviceScreen
///      wrappers)
///   9. -[rawScreen registerScreenCallbacksWithUUID:callbackQueue:
///      frameCallback:surfacesChangedCallback:propertiesChangedCallback:]
///
/// IOSurface → CVPixelBuffer attributes (DisplayBridge.m:795-812):
///   kCVPixelBufferIOSurfacePropertiesKey: @{}
///   kCVPixelBufferMetalCompatibilityKey: YES
///   kCVPixelBufferCGImageCompatibilityKey: YES
///   kCVPixelBufferCGBitmapContextCompatibilityKey: YES
///
/// Pitfall 5 / Open Question #1 — `activateDisplayIfNeeded` is NOT called
/// from this attach.  If frames don't fire within 10s an error is
/// surfaced through `error_cb` ("WARN: no frames in 10s — Open Question
/// #1 unresolved") so the offscreen-NSWindow fallback can be designed in
/// a later plan.  The fallback is intentionally out of scope here.
int DSAttachToSimulator(const char *udid,
                        DSFrameCallback frame_cb,
                        DSErrorCallback error_cb,
                        void *_Nullable userData);

/// Detach. Idempotent; safe to call before attach completes (no-op).
void DSDetach(void);

/// The display size in pixels, as last delivered by the surfacesChanged
/// callback.  `(0, 0)` before the first frame fires.  Read by
/// `TouchInject.mm` to feed `IndigoHIDMessageForMouseNSEvent`'s
/// `displaySize` argument.
CGSize DSDisplayPixelSize(void);

/// The current SimDeviceLegacyHIDClient instance, or `nil` if not
/// attached.  Used by `TouchInject.mm` to dispatch
/// `-sendWithMessage:freeWhenDone:completionQueue:completion:`.
id _Nullable DSCurrentHIDClient(void);

#ifdef SIM_PRIVATE_TESTING
/// Test-only setter — substitutes a MockHIDClient for the real
/// SimDeviceLegacyHIDClient so `bridge_send_touch` can be exercised
/// without booting a simulator.  Defined ONLY when `SIM_PRIVATE_TESTING`
/// is set in the Tests target (project.yml `GCC_PREPROCESSOR_DEFINITIONS`
/// on the Tests target).  Production builds (`sim-capture-private`
/// daemon) do NOT define this symbol.
void DSSetTestHIDClient(id _Nullable client);

/// Test-only setter — substitutes a synthetic display size so
/// `bridge_send_touch` validates its precondition (size != 0) without
/// waiting for a real frame callback to fire.
void DSSetTestDisplaySize(CGSize size);
#endif

NS_ASSUME_NONNULL_END
