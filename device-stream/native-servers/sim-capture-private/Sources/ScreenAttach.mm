// ScreenAttach.mm — SimulatorKit attach sequence + screen-adapter frame
// callback (Plan 32-02 / T-32.2).
//
// VERBATIM PORT (with `DF`→`DS` rename only) of the attach sequence from
// kittyfarm `DFPrivateSimulatorDisplayBridge.m` lines 2027-2340 and the
// IOSurface→CVPixelBuffer wrapper at 795-812.  Reference repo is
// STUDY-ONLY per Phase 32 External Dependencies Policy — kittyfarm itself
// is NOT a linked dependency of device-farm (no npm/SwiftPM/CocoaPods
// entry; verify via `grep -r kittyfarm device-stream/ | grep -v
// "\.planning"`).
//
// Key differences vs the reference:
//   * Single-UDID daemon: module-level static state, no Obj-C instance
//     (Open Question #3 — daemon hosts one simulator per process).
//   * No `_displayView` / `_digitizerInputView` setup.  Open Question #1
//     experiment: attach WITHOUT `activateDisplayIfNeeded`; if frames
//     don't fire in 10s, surface an explicit error via `error_cb` and
//     bail.  The offscreen-NSWindow fallback is intentionally out of
//     scope for this plan — document outcome in SUMMARY.
//   * Pitfall 3 (10s adapter poll @ 100ms) and Pitfall 7 (Xcode 26.4
//     SimDeviceScreen wrapper unwrap via `-screen`) are both ported.

#import "ScreenAttach.h"
#import "DyldSymbols.h"

#import <Foundation/Foundation.h>
#import <CoreGraphics/CoreGraphics.h>
#import <CoreVideo/CoreVideo.h>
#import <IOSurface/IOSurface.h>
#import <objc/message.h>
#import <objc/runtime.h>
#import <dispatch/dispatch.h>

#pragma mark - Module-level static state

// Strong globals: the daemon owns the SimDevice + adapter lifecycle for the
// process's lifetime (per Open Question #3 — single-UDID daemon).  Released
// in DSDetach().  Held without ARC visibility via `__strong` qualified
// pointers held in an Obj-C container — but since this is .mm with ARC on,
// raw object refs are kept in __strong static slots via a holder struct.
static __strong id _g_serviceContext = nil;
static __strong id _g_device = nil;
static __strong id _g_hidClient = nil;
static __strong id _g_screenAdapterHost = nil;  // the property's value
static __strong id _g_screenAdapter = nil;       // _screenAdapter ivar
static __strong id _g_bootstrapScreen = nil;     // initWithDevice:screenID:@0
static __strong id _g_activeScreen = nil;        // for activeScreenID
static __strong id _g_rawScreen = nil;           // unwrapped screen w/ register*
static __strong NSUUID *_g_screenCallbackUUID = nil;
static __strong NSUUID *_g_screenAdapterCallbackUUID = nil;
static __strong dispatch_queue_t _g_callbackQueue = nil;

static CGSize _g_displayPixelSize = {0, 0};
static CVPixelBufferRef _g_latestPixelBuffer = NULL;  // Pitfall 6 — release
                                                       // before storing next
static NSLock *_g_pixelBufferLock = nil;

static DSFrameCallback _g_frame_cb = NULL;
static DSErrorCallback _g_error_cb = NULL;
static void *_g_userData = NULL;

#ifdef SIM_PRIVATE_TESTING
// Test-only overrides — see ScreenAttach.h block under SIM_PRIVATE_TESTING.
static __strong id _g_test_hid_client = nil;
static CGSize _g_test_display_size = {0, 0};
#endif

#pragma mark - Helpers

// Resolve $DEVELOPER_DIR or fall back to /Applications/Xcode.app/Contents/Developer
static NSString *DSDeveloperDirectory(void) {
    const char *envDir = getenv("DEVELOPER_DIR");
    if (envDir != NULL && *envDir != '\0') {
        return [NSString stringWithUTF8String:envDir];
    }
    return @"/Applications/Xcode.app/Contents/Developer";
}

// Reads adapter.screens dictionary, unwrapping Xcode 26.4's
// `SimDeviceScreen` wrappers via `-screen` (Pitfall 7).  Port of
// kittyfarm DisplayBridge.m:566-599 (DFReadAdapterScreens).
static NSDictionary<NSNumber *, id> *DSReadAdapterScreens(id adapterHost) {
    void *fn = DSResolveSwiftSymbol(
        "$s12SimulatorKit22SimDeviceScreenAdapterC7screens", "vg",
        "SimDeviceScreenAdapter.screens.getter");
    if (fn == NULL) {
        return @{};
    }
    id screens = DSCallSwiftSelfGetterByFunction(adapterHost, fn);
    if (![screens isKindOfClass:[NSDictionary class]]) {
        return @{};
    }

    NSMutableDictionary<NSNumber *, id> *unwrapped =
        [NSMutableDictionary dictionaryWithCapacity:[(NSDictionary *)screens count]];
    SEL screenSel = sel_registerName("screen");  // Pitfall 7 unwrap
    [(NSDictionary *)screens enumerateKeysAndObjectsUsingBlock:^(id key, id value, BOOL *stop) {
        if (![key isKindOfClass:[NSNumber class]] || value == nil) {
            return;
        }
        id rawScreen = value;
        if ([value respondsToSelector:screenSel]) {
            id underlying = ((id (*)(id, SEL))objc_msgSend)(value, screenSel);
            if (underlying != nil) {
                rawScreen = underlying;
            }
        }
        unwrapped[key] = rawScreen;
    }];
    return unwrapped;
}

// IOSurface → CVPixelBuffer.  Port of DisplayBridge.m:795-812.
static CVPixelBufferRef DSCreatePixelBufferFromSurface(IOSurfaceRef surface) {
    if (surface == NULL) {
        return NULL;
    }
    NSDictionary *attributes = @{
        (NSString *)kCVPixelBufferIOSurfacePropertiesKey: @{},
        (NSString *)kCVPixelBufferMetalCompatibilityKey: @YES,
        (NSString *)kCVPixelBufferCGImageCompatibilityKey: @YES,
        (NSString *)kCVPixelBufferCGBitmapContextCompatibilityKey: @YES,
    };
    CVPixelBufferRef pixelBuffer = NULL;
    CVReturn status = CVPixelBufferCreateWithIOSurface(
        kCFAllocatorDefault, surface,
        (__bridge CFDictionaryRef)attributes, &pixelBuffer);
    if (status != kCVReturnSuccess) {
        fprintf(stderr,
                "sim-capture-private: CVPixelBufferCreateWithIOSurface "
                "failed: %d\n", (int)status);
        return NULL;
    }
    return pixelBuffer;
}

static void DSEmitError(const char *msg) {
    fprintf(stderr, "sim-capture-private: %s\n", msg);
    if (_g_error_cb != NULL) {
        _g_error_cb(msg, _g_userData);
    }
}

#pragma mark - Public API

int DSAttachToSimulator(const char *udid_cstr,
                        DSFrameCallback frame_cb,
                        DSErrorCallback error_cb,
                        void *userData) {
    if (udid_cstr == NULL || *udid_cstr == '\0') {
        if (error_cb) error_cb("DSAttachToSimulator: udid is required", userData);
        return -1;
    }

    NSString *udid = [NSString stringWithUTF8String:udid_cstr];

    _g_frame_cb = frame_cb;
    _g_error_cb = error_cb;
    _g_userData = userData;
    if (_g_pixelBufferLock == nil) {
        _g_pixelBufferLock = [[NSLock alloc] init];
    }

    // 1) dlopen CoreSimulator + SimulatorKit.
    if (DSLoadPrivateFrameworks() != 0) {
        DSEmitError("DSLoadPrivateFrameworks failed (dlopen)");
        return -1;
    }

    // 2) +[SimServiceContext serviceContextForDeveloperDir:connectionType:error:]
    //    See 32-01-SUMMARY.md Deviation #1 — `+contextForDeveloperDir:` was the
    //    incorrect plan literal; the actual class method is
    //    `+serviceContextForDeveloperDir:connectionType:error:`.
    Class serviceContextClass = NSClassFromString(@"SimServiceContext");
    if (serviceContextClass == Nil) {
        DSEmitError("SimServiceContext class not registered");
        return -2;
    }

    NSError *serviceError = nil;
    NSString *devDir = DSDeveloperDirectory();
    SEL contextSel = sel_registerName(
        "serviceContextForDeveloperDir:connectionType:error:");
    _g_serviceContext = ((id (*)(Class, SEL, id, long long, NSError **))objc_msgSend)(
        serviceContextClass, contextSel, devDir, 0LL, &serviceError);
    if (_g_serviceContext == nil) {
        const char *desc = serviceError.localizedDescription.UTF8String ?: "unknown";
        fprintf(stderr,
                "sim-capture-private: SimServiceContext create failed: %s\n",
                desc);
        DSEmitError("SimServiceContext create failed");
        return -2;
    }

    // 3) -[ctx defaultDeviceSetWithError:]
    NSError *deviceSetError = nil;
    id deviceSet = ((id (*)(id, SEL, NSError **))objc_msgSend)(
        _g_serviceContext, sel_registerName("defaultDeviceSetWithError:"),
        &deviceSetError);
    if (deviceSet == nil) {
        DSEmitError("defaultDeviceSetWithError: returned nil");
        return -2;
    }

    // 4) Enumerate -devices, match UDID (case-insensitive uppercase per
    //    NSUUID.UUIDString convention).
    NSArray *devices = ((id (*)(id, SEL))objc_msgSend)(
        deviceSet, sel_registerName("devices"));
    NSString *targetUUID = [udid uppercaseString];
    for (id candidate in devices) {
        id deviceUDID = ((id (*)(id, SEL))objc_msgSend)(
            candidate, sel_registerName("UDID"));
        NSString *candidateUUIDStr = nil;
        if ([deviceUDID respondsToSelector:sel_registerName("UUIDString")]) {
            candidateUUIDStr = ((id (*)(id, SEL))objc_msgSend)(
                deviceUDID, sel_registerName("UUIDString"));
        } else {
            candidateUUIDStr = [deviceUDID description];
        }
        if ([[candidateUUIDStr uppercaseString] isEqualToString:targetUUID]) {
            _g_device = candidate;
            break;
        }
    }
    if (_g_device == nil) {
        char buf[256];
        snprintf(buf, sizeof(buf),
                 "device UDID %s not found in default device set",
                 udid_cstr);
        DSEmitError(buf);
        return -3;
    }

    // 5) HID client: -[[SimulatorKit.SimDeviceLegacyHIDClient alloc]
    //    initWithDevice:error:]
    Class hidClass = NSClassFromString(@"SimulatorKit.SimDeviceLegacyHIDClient");
    if (hidClass == Nil) {
        DSEmitError("SimulatorKit.SimDeviceLegacyHIDClient class not registered");
        return -3;
    }
    NSError *hidErr = nil;
    id hidAlloc = ((id (*)(Class, SEL))objc_msgSend)(
        hidClass, sel_registerName("alloc"));
    _g_hidClient = ((id (*)(id, SEL, id, NSError **))objc_msgSend)(
        hidAlloc, sel_registerName("initWithDevice:error:"),
        _g_device, &hidErr);
    if (_g_hidClient == nil) {
        const char *desc = hidErr.localizedDescription.UTF8String ?: "unknown";
        fprintf(stderr,
                "sim-capture-private: HID client init failed: %s\n", desc);
        DSEmitError("SimDeviceLegacyHIDClient initWithDevice: failed");
        return -3;
    }

    // 6) Resolve & call `SimDevice.screenAdapter` getter — Swift property on
    //    Obj-C class.  Uses the ARM64 `mov x20, self` shim from DyldSymbols.mm.
    void *screenAdapterFn = DSResolveSwiftSymbol(
        "$sSo9SimDeviceC12SimulatorKitE13screenAdapter", "vg",
        "SimDevice.screenAdapter.getter");
    if (screenAdapterFn == NULL) {
        DSEmitError("screenAdapter getter symbol unresolved");
        return -4;
    }
    _g_screenAdapterHost = DSCallSwiftSelfGetterByFunction(_g_device,
                                                            screenAdapterFn);
    if (_g_screenAdapterHost == nil) {
        DSEmitError("screenAdapter getter returned nil");
        return -4;
    }

    // 7) Bootstrap a SimDeviceScreen so the adapter populates its screens.
    Class screenClass = NSClassFromString(@"SimulatorKit.SimDeviceScreen");
    if (screenClass == Nil) {
        DSEmitError("SimulatorKit.SimDeviceScreen class not registered");
        return -4;
    }
    id bootstrapAlloc = ((id (*)(Class, SEL))objc_msgSend)(
        screenClass, sel_registerName("alloc"));
    _g_bootstrapScreen = ((id (*)(id, SEL, id, uint32_t))objc_msgSend)(
        bootstrapAlloc, sel_registerName("initWithDevice:screenID:"),
        _g_device, 0);

    // 8) Read `_screenAdapter` ivar off the host (kittyfarm
    //    DisplayBridge.m:2157 — adapter is exposed via an ivar, not a
    //    selector).  Fall back to using the host itself if the ivar isn't
    //    present (newer Xcode might expose the adapter directly).
    Ivar adapterIvar = class_getInstanceVariable(
        [_g_screenAdapterHost class], "_screenAdapter");
    if (adapterIvar != NULL) {
        _g_screenAdapter = object_getIvar(_g_screenAdapterHost, adapterIvar);
    }
    if (_g_screenAdapter == nil) {
        // Newer Xcode: the host itself acts as the adapter.
        _g_screenAdapter = _g_screenAdapterHost;
    }

    // Optional: register adapter-level connected/disconnect callbacks for
    // observability.  Kittyfarm DisplayBridge.m:2170-2189.
    SEL regAdapterSel = sel_registerName(
        "registerScreenAdapterCallbacksWithUUID:callbackQueue:"
        "screenConnectedCallback:screenWillDisconnectCallback:");
    if ([_g_screenAdapter respondsToSelector:regAdapterSel]) {
        _g_screenAdapterCallbackUUID = [NSUUID UUID];
        if (_g_callbackQueue == nil) {
            _g_callbackQueue = dispatch_queue_create(
                "com.devicestream.sim-private-screen",
                DISPATCH_QUEUE_SERIAL);
        }
        void (^connectedCb)(id) = ^(id simScreen) {
            (void)simScreen;
            fprintf(stderr,
                    "sim-capture-private: adapter reports screen connected\n");
        };
        void (^willDisconnectCb)(id) = ^(id simScreen) {
            (void)simScreen;
            fprintf(stderr,
                    "sim-capture-private: adapter reports screen will disconnect\n");
        };
        ((void (*)(id, SEL, id, dispatch_queue_t, id, id))objc_msgSend)(
            _g_screenAdapter, regAdapterSel,
            _g_screenAdapterCallbackUUID, _g_callbackQueue,
            connectedCb, willDisconnectCb);
    }

    // 9) POLL adapter.screens up to 10s @ 100ms (Pitfall 3 from
    //    32-RESEARCH.md — screens trickle in over several seconds on a
    //    cold-boot simulator).  Bound = 100 iterations × 0.1s = 10s.
    NSDictionary<NSNumber *, id> *screens = DSReadAdapterScreens(
        _g_screenAdapterHost);
    int iter = 0;
    while (screens.count == 0 && iter < 100) {
        [NSThread sleepForTimeInterval:0.1];
        screens = DSReadAdapterScreens(_g_screenAdapterHost);
        iter++;
    }
    if (screens.count == 0) {
        DSEmitError(
            "adapter screens never populated (10s timeout) — Pitfall 3");
        return -4;
    }
    fprintf(stderr,
            "sim-capture-private: adapter populated %lu screen(s) after %d "
            "poll iterations\n",
            (unsigned long)screens.count, iter);

    // Pick lowest non-zero screen ID; fall back to first.
    NSArray<NSNumber *> *sortedIDs =
        [[screens allKeys] sortedArrayUsingSelector:@selector(compare:)];
    NSNumber *selectedID = nil;
    for (NSNumber *candidate in sortedIDs) {
        if (candidate.unsignedIntValue > 0) {
            selectedID = candidate;
            break;
        }
    }
    if (selectedID == nil) selectedID = sortedIDs.firstObject;
    uint32_t activeScreenID = selectedID.unsignedIntValue;

    id activeAlloc = ((id (*)(Class, SEL))objc_msgSend)(
        screenClass, sel_registerName("alloc"));
    _g_activeScreen = ((id (*)(id, SEL, id, uint32_t))objc_msgSend)(
        activeAlloc, sel_registerName("initWithDevice:screenID:"),
        _g_device, activeScreenID);
    _g_rawScreen = screens[selectedID];

    // 10) Register screen callbacks — frame + surfacesChanged + propertiesChanged.
    if (_g_rawScreen == nil) {
        DSEmitError("selected raw screen is nil after unwrap");
        return -4;
    }

    SEL registerSel = sel_registerName(
        "registerScreenCallbacksWithUUID:callbackQueue:frameCallback:"
        "surfacesChangedCallback:propertiesChangedCallback:");
    if (![_g_rawScreen respondsToSelector:registerSel]) {
        DSEmitError(
            "rawScreen does not respond to registerScreenCallbacksWithUUID:");
        return -4;
    }

    if (_g_callbackQueue == nil) {
        _g_callbackQueue = dispatch_queue_create(
            "com.devicestream.sim-private-screen", DISPATCH_QUEUE_SERIAL);
    }
    _g_screenCallbackUUID = [NSUUID UUID];

    // frameCallback (parameterless) — observability only; we deliver pixels
    // via surfacesChanged.
    void (^frameCb)(void) = ^{
        // No-op — the surfaces-changed callback owns the pixel buffer path.
    };

    // surfacesChangedCallback — receives (id surface, id maskedSurface).
    // IOSurfaceRef bridges directly to id under ARC.
    void (^surfacesChangedCb)(id, id) = ^(id surface, id maskedSurface) {
        (void)maskedSurface;
        if (surface == nil) return;

        IOSurfaceRef ioSurface = (__bridge IOSurfaceRef)surface;
        CVPixelBufferRef pb = DSCreatePixelBufferFromSurface(ioSurface);
        if (pb == NULL) {
            DSEmitError(
                "CVPixelBufferCreateWithIOSurface returned NULL");
            return;
        }

        size_t width = CVPixelBufferGetWidth(pb);
        size_t height = CVPixelBufferGetHeight(pb);

        [_g_pixelBufferLock lock];
        if (_g_latestPixelBuffer != NULL) {
            CVPixelBufferRelease(_g_latestPixelBuffer);
        }
        // Retain for the daemon's "latest frame" slot (Pitfall 6).
        CFRetain(pb);
        _g_latestPixelBuffer = pb;
        _g_displayPixelSize = CGSizeMake((CGFloat)width, (CGFloat)height);
        [_g_pixelBufferLock unlock];

        if (_g_frame_cb != NULL) {
            _g_frame_cb(pb, (double)width, (double)height, _g_userData);
        }
        CVPixelBufferRelease(pb);  // matched to CVPixelBufferCreateWithIOSurface
    };

    // propertiesChangedCallback — orientation/scale updates.  Logged only.
    void (^propertiesChangedCb)(id) = ^(id properties) {
        (void)properties;
    };

    ((void (*)(id, SEL, id, dispatch_queue_t, id, id, id))objc_msgSend)(
        _g_rawScreen, registerSel,
        _g_screenCallbackUUID, _g_callbackQueue,
        frameCb, surfacesChangedCb, propertiesChangedCb);

    fprintf(stderr,
            "sim-capture-private: attach complete for udid=%s "
            "screenID=%u (Open Question #1 — frame fires without "
            "activateDisplayIfNeeded?  observe via frame_cb)\n",
            udid_cstr, activeScreenID);

    return 0;
}

void DSDetach(void) {
    if (_g_latestPixelBuffer != NULL) {
        CVPixelBufferRelease(_g_latestPixelBuffer);
        _g_latestPixelBuffer = NULL;
    }
    _g_serviceContext = nil;
    _g_device = nil;
    _g_hidClient = nil;
    _g_screenAdapterHost = nil;
    _g_screenAdapter = nil;
    _g_bootstrapScreen = nil;
    _g_activeScreen = nil;
    _g_rawScreen = nil;
    _g_screenCallbackUUID = nil;
    _g_screenAdapterCallbackUUID = nil;
    _g_callbackQueue = nil;
    _g_displayPixelSize = CGSizeZero;
    _g_frame_cb = NULL;
    _g_error_cb = NULL;
    _g_userData = NULL;
}

CGSize DSDisplayPixelSize(void) {
#ifdef SIM_PRIVATE_TESTING
    if (_g_test_display_size.width != 0 || _g_test_display_size.height != 0) {
        return _g_test_display_size;
    }
#endif
    return _g_displayPixelSize;
}

id DSCurrentHIDClient(void) {
#ifdef SIM_PRIVATE_TESTING
    if (_g_test_hid_client != nil) {
        return _g_test_hid_client;
    }
#endif
    return _g_hidClient;
}

#ifdef SIM_PRIVATE_TESTING
void DSSetTestHIDClient(id client) {
    _g_test_hid_client = client;
}

void DSSetTestDisplaySize(CGSize size) {
    _g_test_display_size = size;
}
#endif
