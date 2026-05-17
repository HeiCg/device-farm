// TouchInject.mm — HID touch injection via SimulatorKit private API
// (Plan 32-02 / T-32.3).
//
// VERBATIM PORT (with `DF`→`DS` rename only) of the HID send path from
// kittyfarm `DFPrivateSimulatorDisplayBridge.m` lines 884-988.  Reference
// repo is STUDY-ONLY — no linked dependency on kittyfarm.
//
// Open Question #4 resolution: normalized 0..1 ratios are passed straight
// through to `IndigoHIDMessageForMouseNSEvent` (kittyfarm signature:
// `(CGPoint *ratio, ..., NSSize displaySize, ...)` — the function consumes
// the ratio + displaySize as separate args; we do NOT pre-multiply.

#import "TouchInject.h"
#import "ScreenAttach.h"

#import <Foundation/Foundation.h>
#import <AppKit/AppKit.h>
#import <CoreGraphics/CoreGraphics.h>
#import <dlfcn.h>
#import <dispatch/dispatch.h>
#import <objc/message.h>
#import <objc/runtime.h>
#import <mach/mach_time.h>

#pragma mark - DSIndigoMessage — bytes + freeFn wrapper

// Holds the malloc'd Indigo HID message bytes and runs the supplied
// freeFn on -dealloc.  -sendWithMessage:freeWhenDone:...: reads bytes via
// -bytes / -length selectors on the message object (kittyfarm style).
@interface DSIndigoMessage : NSObject
- (instancetype)initWithBytes:(void *)bytes
                       length:(NSUInteger)length
                       freeFn:(void (*_Nullable)(void *))freeFn;
@property (nonatomic, readonly) const void *bytes;
@property (nonatomic, readonly) NSUInteger length;
@end

@implementation DSIndigoMessage {
    void *_bytes;
    NSUInteger _length;
    void (*_freeFn)(void *);
}

- (instancetype)initWithBytes:(void *)bytes
                       length:(NSUInteger)length
                       freeFn:(void (*)(void *))freeFn {
    if ((self = [super init])) {
        _bytes = bytes;
        _length = length;
        _freeFn = freeFn;
    }
    return self;
}

- (const void *)bytes { return _bytes; }
- (NSUInteger)length { return _length; }

- (void)dealloc {
    if (_freeFn != NULL && _bytes != NULL) {
        _freeFn(_bytes);
        _bytes = NULL;
    } else if (_bytes != NULL) {
        free(_bytes);
        _bytes = NULL;
    }
}

@end

#pragma mark - Phase mapping

static NSEventType DSEventTypeForPhase(uint8_t phase) {
    switch (phase) {
        case DSTouchPhaseDown:   return NSEventTypeLeftMouseDown;
        case DSTouchPhaseMove:   return NSEventTypeLeftMouseDragged;
        case DSTouchPhaseUp:     return NSEventTypeLeftMouseUp;
        case DSTouchPhaseCancel: return NSEventTypeLeftMouseUp;
        default:                 return NSEventTypeLeftMouseUp;
    }
}

#pragma mark - Indigo HID message construction

// Synthesize an NSEvent at pixel coordinates.  Kept for diagnostics + future
// digitizer-input bridge work; the production message construction goes
// through IndigoHIDMessageForMouseNSEvent (CGPoint-ratio signature) per
// kittyfarm DisplayBridge.m:949.
static NSEvent *DSSynthesizeMouseNSEvent(double x_ratio,
                                          double y_ratio,
                                          uint8_t phase,
                                          double pressure,
                                          uint32_t touchId,
                                          CGSize displaySize) {
    NSEventType type = DSEventTypeForPhase(phase);
    NSPoint loc = NSMakePoint(x_ratio * displaySize.width,
                              y_ratio * displaySize.height);
    return [NSEvent mouseEventWithType:type
                              location:loc
                         modifierFlags:0
                             timestamp:[[NSProcessInfo processInfo] systemUptime]
                          windowNumber:0
                               context:nil
                           eventNumber:(NSInteger)touchId
                            clickCount:1
                              pressure:(float)pressure];
}

// kittyfarm-confirmed signature for IndigoHIDMessageForMouseNSEvent
// (DisplayBridge.m:74):
//   IndigoHIDMessage *(*Fn)(CGPoint *location, CGPoint *windowLocation,
//                            uint32_t target, NSEventType type,
//                            NSSize displaySize, uint32_t edge);
// Returns a malloc'd buffer the caller must free.
typedef void *(*DSIndigoForMouseFn)(CGPoint *location,
                                     CGPoint *windowLocation,
                                     uint32_t target,
                                     NSEventType type,
                                     NSSize displaySize,
                                     uint32_t edge);

// Indigo "touch" target value (kittyfarm DisplayBridge.m:142).
static const uint32_t kDSIndigoTouchTarget = 0x32;

// Test-mode synthetic payload — used when `SIM_PRIVATE_TESTING` is
// defined AND the real `IndigoHIDMessageForMouseNSEvent` cannot be
// resolved via dlsym at unit-test time.  Encodes the two ratios + phase
// + touchId so test #3 can assert no pre-multiplication occurred.
typedef struct {
    uint32_t magic;     // 'DSIH' (0x44534948) — DS Indigo Header
    double xRatio;
    double yRatio;
    uint8_t phase;
    uint8_t reserved[3];
    uint32_t touchId;
    double pressure;
    double displayWidth;
    double displayHeight;
} DSSyntheticIndigoPayload;

static const uint32_t kDSSyntheticIndigoMagic = 0x44534948;  // 'DSIH'

#ifdef SIM_PRIVATE_TESTING
static void *DSBuildSyntheticIndigoBytes(double x_ratio,
                                          double y_ratio,
                                          uint8_t phase,
                                          double pressure,
                                          uint32_t touchId,
                                          CGSize displaySize,
                                          size_t *outLen) {
    DSSyntheticIndigoPayload *p =
        (DSSyntheticIndigoPayload *)calloc(1, sizeof(DSSyntheticIndigoPayload));
    if (p == NULL) {
        if (outLen) *outLen = 0;
        return NULL;
    }
    p->magic = kDSSyntheticIndigoMagic;
    p->xRatio = x_ratio;
    p->yRatio = y_ratio;
    p->phase = phase;
    p->touchId = touchId;
    p->pressure = pressure;
    p->displayWidth = displaySize.width;
    p->displayHeight = displaySize.height;
    if (outLen) *outLen = sizeof(DSSyntheticIndigoPayload);
    return p;
}
#endif // SIM_PRIVATE_TESTING

#pragma mark - Public C entry point

int bridge_send_touch(double x_ratio,
                      double y_ratio,
                      uint8_t phase,
                      double pressure,
                      uint32_t touchId) {
    id hidClient = DSCurrentHIDClient();
    if (hidClient == nil) {
        fprintf(stderr,
                "bridge_send_touch: not attached (no HID client)\n");
        return -1;
    }

    CGSize displaySize = DSDisplayPixelSize();
    if (displaySize.width == 0 || displaySize.height == 0) {
        fprintf(stderr,
                "bridge_send_touch: display size unknown — frame "
                "callback hasn't fired yet\n");
        return -2;
    }

    // Clamp ratios to [0..1] (kittyfarm DisplayBridge.m:944-947).
    CGPoint ratioPoint = CGPointMake(
        fmax(0.0, fmin(1.0, x_ratio)),
        fmax(0.0, fmin(1.0, y_ratio)));

    // Synthesize an NSEvent — purely for diagnostic / digitizer-fallback
    // logging.  The production path passes the ratio CGPoint directly
    // into the C export below (Open Question #4 — no pre-multiplication).
    NSEvent *diagnosticEvent = DSSynthesizeMouseNSEvent(
        ratioPoint.x, ratioPoint.y, phase, pressure, touchId, displaySize);
    (void)diagnosticEvent;

    void *msgBytes = NULL;
    size_t msgLen = 0;
    void (*freeFn)(void *) = NULL;

    // Resolve IndigoHIDMessageForMouseNSEvent via dlsym at call time
    // (kittyfarm DisplayBridge.m:932).  The framework exports no public
    // header; the symbol name is the only stable contract.
    DSIndigoForMouseFn mouseMessageFn =
        (DSIndigoForMouseFn)dlsym(RTLD_DEFAULT, "IndigoHIDMessageForMouseNSEvent");

#ifdef SIM_PRIVATE_TESTING
    // Unit-test mode: prefer the synthetic factory so tests don't depend
    // on the real CoreSimulator symbol being loaded into xctest's process.
    // The synthetic payload encodes x_ratio + y_ratio + displaySize so
    // tests can assert no pre-multiplication.
    if (mouseMessageFn == NULL || getenv("DS_FORCE_SYNTHETIC_INDIGO") != NULL) {
        msgBytes = DSBuildSyntheticIndigoBytes(
            ratioPoint.x, ratioPoint.y, phase, pressure, touchId,
            displaySize, &msgLen);
        freeFn = &free;  // synthetic uses calloc — free via free(3)
    }
#endif

    if (msgBytes == NULL && mouseMessageFn != NULL) {
        // Production path — call the real C export with the kittyfarm
        // signature.  Returns a malloc'd Indigo message; caller frees.
        NSEventType type = DSEventTypeForPhase(phase);
        void *raw = mouseMessageFn(&ratioPoint, NULL,
                                    kDSIndigoTouchTarget, type,
                                    NSMakeSize(displaySize.width,
                                               displaySize.height),
                                    0);
        if (raw != NULL) {
            // Kittyfarm allocates `sizeof(DFIndigoMessage) +
            // sizeof(DFIndigoPayload)` for the duplicated-payload form;
            // we don't crack the struct here (struct layouts deferred to
            // Plan 05 smoke).  Pass the raw bytes through with free as
            // the deallocator — the real -sendWithMessage: path consumes
            // the bytes synchronously.
            msgBytes = raw;
            msgLen = 0;  // length is encoded inside the buffer
            freeFn = &free;
        }
    }

    if (msgBytes == NULL) {
        fprintf(stderr,
                "bridge_send_touch: IndigoHIDMessageForMouseNSEvent "
                "returned NULL or unavailable\n");
        return -3;
    }

    DSIndigoMessage *msg = [[DSIndigoMessage alloc] initWithBytes:msgBytes
                                                            length:msgLen
                                                            freeFn:freeFn];

    // Sync send with dispatch_semaphore_wait (kittyfarm
    // DisplayBridge.m:895-911).  2-second timeout matches the safety
    // bound — production simulator HID send completes in milliseconds.
    dispatch_queue_t completionQueue = dispatch_queue_create(
        "com.devicestream.sim-private-hid-completion",
        DISPATCH_QUEUE_SERIAL);
    dispatch_semaphore_t sem = dispatch_semaphore_create(0);
    __block NSError *sendError = nil;

    SEL sendSel = sel_registerName(
        "sendWithMessage:freeWhenDone:completionQueue:completion:");
    if (![hidClient respondsToSelector:sendSel]) {
        fprintf(stderr,
                "bridge_send_touch: HID client does not respond to "
                "sendWithMessage:freeWhenDone:completionQueue:completion:\n");
        return -5;
    }

    void (^completion)(NSError *) = ^(NSError *err) {
        sendError = err;
        dispatch_semaphore_signal(sem);
    };
    BOOL freeWhenDone = YES;
    ((void (*)(id, SEL, id, BOOL, dispatch_queue_t, id))objc_msgSend)(
        hidClient, sendSel, msg, freeWhenDone, completionQueue, completion);

    dispatch_time_t timeout = dispatch_time(DISPATCH_TIME_NOW,
                                              (int64_t)(2 * NSEC_PER_SEC));
    if (dispatch_semaphore_wait(sem, timeout) != 0) {
        fprintf(stderr, "bridge_send_touch: HID send timed out (2s)\n");
        return -4;
    }
    if (sendError != nil) {
        fprintf(stderr,
                "bridge_send_touch: HID send completion error: %s\n",
                sendError.localizedDescription.UTF8String ?: "unknown");
        return -5;
    }
    return 0;
}
