// TouchInjectTests.mm — Plan 32-02 (T-32.3) tests.
//
// Verifies the HID send path via MockHIDClient — no real simulator
// required.  Drives SIM-PRIV-04 unit acceptance.  Real-simulator
// round-trip (touch sent → frame contains tap effect on a calibration
// app) is deferred to Plan 32-05 smoke.
//
// Coverage:
//   1. DSIndigoMessage holds the bytes pointer until -dealloc and calls
//      freeFn exactly once.
//   2. `bridge_send_touch` dispatches `-sendWithMessage:freeWhenDone:
//      completionQueue:completion:` against the test-installed
//      MockHIDClient, capturing non-empty data.
//   3. Normalized 0..1 ratios are passed through verbatim — no
//      pre-multiplication (resolves Research Open Question #4).
//   4. `bridge_send_touch` returns -1 before attach (no HID client).
#import <XCTest/XCTest.h>

#import "TouchInject.h"
#import "ScreenAttach.h"
#import "Fixtures/MockSimDevice.h"

#pragma mark - freeFn tracking

static int g_freeFnCallCount = 0;
static void *g_lastFreedBytes = NULL;

static void DSTestRecordingFreeFn(void *bytes) {
    g_freeFnCallCount++;
    g_lastFreedBytes = bytes;
    free(bytes);
}

// Re-declared internal DSIndigoMessage interface so we can construct one
// directly from the test bundle.  The implementation lives in
// `Sources/TouchInject.mm` (recompiled into the Tests bundle per
// project.yml).
@interface DSIndigoMessage : NSObject
- (instancetype)initWithBytes:(void *)bytes
                       length:(NSUInteger)length
                       freeFn:(void (*_Nullable)(void *))freeFn;
@property (nonatomic, readonly) const void *bytes;
@property (nonatomic, readonly) NSUInteger length;
@end

#pragma mark - Tests

@interface TouchInjectTests : XCTestCase
@end

@implementation TouchInjectTests

- (void)setUp {
    [super setUp];
    // Reset module state before each test.
    DSDetach();
    DSSetTestHIDClient(nil);
    DSSetTestDisplaySize(CGSizeZero);
    g_freeFnCallCount = 0;
    g_lastFreedBytes = NULL;
    // Force the synthetic Indigo path so tests are deterministic across
    // CI runners that may or may not have CoreSimulator dlopen'd.
    setenv("DS_FORCE_SYNTHETIC_INDIGO", "1", 1);
}

- (void)tearDown {
    DSDetach();
    DSSetTestHIDClient(nil);
    DSSetTestDisplaySize(CGSizeZero);
    unsetenv("DS_FORCE_SYNTHETIC_INDIGO");
    [super tearDown];
}

// Test 1: DSIndigoMessage holds bytes until dealloc; freeFn fires once.
- (void)testIndigoMessageWrapperRetainsBytes {
    // Allocate a tagged buffer the recording freeFn can identify.
    size_t len = 32;
    void *bytes = malloc(len);
    memset(bytes, 0xAB, len);

    XCTAssertEqual(g_freeFnCallCount, 0,
                   @"freeFn must not fire before dealloc");

    @autoreleasepool {
        DSIndigoMessage *msg = [[DSIndigoMessage alloc] initWithBytes:bytes
                                                                length:len
                                                                freeFn:&DSTestRecordingFreeFn];
        // While `msg` is alive, the bytes pointer must be returned unchanged.
        XCTAssertEqual(msg.bytes, bytes, @"bytes accessor must return the stored pointer");
        XCTAssertEqual(msg.length, len, @"length accessor must return the stored length");
        XCTAssertEqual(g_freeFnCallCount, 0, @"freeFn must not fire while msg is alive");
        msg = nil;  // trigger dealloc inside the autorelease pool
    }

    XCTAssertEqual(g_freeFnCallCount, 1, @"freeFn must fire exactly once on dealloc");
    XCTAssertEqual(g_lastFreedBytes, bytes, @"freeFn must receive the stored bytes pointer");
}

// Test 2: bridge_send_touch dispatches to MockHIDClient, captures non-empty data.
- (void)testSendTouchHitsMockHIDClient {
    MockHIDClient *hid = [MockHIDClient new];
    __block NSData *captured = nil;
    __block int sendCount = 0;
    hid.onSend = ^(NSData *bytes) {
        sendCount++;
        captured = [bytes copy];
    };

    DSSetTestHIDClient(hid);
    DSSetTestDisplaySize(CGSizeMake(750, 1334));  // pretend frame_cb fired

    int rc = bridge_send_touch(0.5, 0.5, 0 /*down*/, 1.0, 0);
    XCTAssertEqual(rc, 0, @"bridge_send_touch must return 0 on success");
    XCTAssertEqual(sendCount, 1, @"onSend must fire exactly once");
    XCTAssertNotNil(captured, @"captured payload must not be nil");
    XCTAssertGreaterThan(captured.length, 0u,
                         @"captured payload must be non-empty");
}

// Test 3: Normalized ratios are passed through verbatim (no pre-multiply).
// Synthetic Indigo payload encodes x/yRatio directly so we can assert it.
- (void)testNormalizedCoordsArePassedThrough {
    MockHIDClient *hid = [MockHIDClient new];
    __block NSData *captured = nil;
    hid.onSend = ^(NSData *bytes) { captured = [bytes copy]; };

    DSSetTestHIDClient(hid);
    DSSetTestDisplaySize(CGSizeMake(750, 1334));

    int rc = bridge_send_touch(0.5, 0.5, 0, 1.0, 0);
    XCTAssertEqual(rc, 0);
    XCTAssertNotNil(captured);

    // Inspect the synthetic payload.
    XCTAssertEqual(captured.length, sizeof(DSTestSyntheticIndigoPayload),
                   @"synthetic payload size must match");
    const DSTestSyntheticIndigoPayload *p =
        (const DSTestSyntheticIndigoPayload *)captured.bytes;
    XCTAssertEqual(p->magic, DS_SYNTHETIC_INDIGO_MAGIC,
                   @"synthetic-payload magic must match");
    XCTAssertEqualWithAccuracy(p->xRatio, 0.5, 1e-9,
                               @"xRatio must equal 0.5 (no pre-multiplication)");
    XCTAssertEqualWithAccuracy(p->yRatio, 0.5, 1e-9,
                               @"yRatio must equal 0.5 (no pre-multiplication)");
    XCTAssertEqualWithAccuracy(p->displayWidth, 750.0, 1e-9,
                               @"displayWidth must be the screen pixel size");
    XCTAssertEqualWithAccuracy(p->displayHeight, 1334.0, 1e-9,
                               @"displayHeight must be the screen pixel size");
}

// Test 4: bridge_send_touch returns -1 before attach.
- (void)testSendTouchBeforeAttachReturnsError {
    // No HID client installed, no display size set.
    int rc = bridge_send_touch(0.5, 0.5, 0, 1.0, 0);
    XCTAssertEqual(rc, -1, @"must return -1 when no HID client (not attached)");
}

@end
