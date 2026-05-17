// IpcFramerTests.mm — Unix-socket length-prefixed framer round-trip + control
// frame decode tests (Plan 32-03 / T-32.4).
//
// Wire format (locked by 32-BRIEF.md):
//   [u32 BE length (covers tag + payload)][u8 kind][payload bytes]
//
// Tests:
//   1. testEncodeFrameOnTheWire    — write kind=0x02 + 1024-byte payload,
//                                     read back 1029 bytes in exact layout
//   2. testDecodeControlTouchFrame — decode a 34-byte 0xC1 frame
//   3. testDecodeQuitFrame         — decode a 5-byte 0xC9 frame (empty payload)
//   4. testPartialChunkBuffering   — feed bytes in 3-byte chunks; framer
//                                     reassembles ONE complete frame without
//                                     dropping anything

#import <XCTest/XCTest.h>
#import <sys/socket.h>
#import <unistd.h>
#import <arpa/inet.h>
#import "IpcServer.h"

@interface IpcFramerTests : XCTestCase
@end

@implementation IpcFramerTests

#pragma mark - Test 1: encode shape on the wire

- (void)testEncodeFrameOnTheWire {
    // Use socketpair so writes don't touch the filesystem.
    int fds[2];
    XCTAssertEqual(socketpair(AF_UNIX, SOCK_STREAM, 0, fds), 0,
                   @"socketpair must succeed");

    // Server gets fds[0]; we read from fds[1].
    DSIpcServer *server = [[DSIpcServer alloc] initWithConnectedFd:fds[0]];
    XCTAssertNotNil(server);

    // Build a deterministic 1024-byte payload.
    NSMutableData *payload = [NSMutableData dataWithLength:1024];
    uint8_t *bytes = (uint8_t *)payload.mutableBytes;
    for (size_t i = 0; i < 1024; i++) {
        bytes[i] = (uint8_t)(i & 0xFF);
    }

    [server writeFrameKind:0x02 payload:payload];
    [server flushWritesSync];

    // Expected 1029 bytes: 4-byte BE length=1025, 1-byte kind=0x02, 1024 bytes.
    uint8_t buf[1029];
    ssize_t totalRead = 0;
    while (totalRead < (ssize_t)sizeof(buf)) {
        ssize_t n = read(fds[1], buf + totalRead, sizeof(buf) - totalRead);
        if (n <= 0) break;
        totalRead += n;
    }
    XCTAssertEqual(totalRead, (ssize_t)1029, @"must receive exactly 1029 bytes");

    uint32_t len = ((uint32_t)buf[0] << 24) | ((uint32_t)buf[1] << 16)
                 | ((uint32_t)buf[2] << 8) | (uint32_t)buf[3];
    XCTAssertEqual(len, (uint32_t)1025, @"length covers kind + payload");
    XCTAssertEqual(buf[4], (uint8_t)0x02, @"kind byte");

    for (size_t i = 0; i < 1024; i++) {
        if (buf[5 + i] != (uint8_t)(i & 0xFF)) {
            XCTFail(@"payload byte %zu mismatch: got %u want %u", i, buf[5 + i],
                    (unsigned)(i & 0xFF));
            break;
        }
    }

    [server stop];
    close(fds[1]);
}

#pragma mark - Test 2: decode 0xC1 touch control frame

- (void)testDecodeControlTouchFrame {
    // Layout: [u32 BE length=30][u8 0xC1]
    //         [f64 BE 0.25][f64 BE 0.75][u8 0][f64 BE 1.0][u32 BE 7]
    // Total frame: 4 + 30 = 34 bytes.
    uint8_t buf[34] = {0};
    uint32_t lengthBE = htonl(30);
    memcpy(buf + 0, &lengthBE, 4);
    buf[4] = 0xC1;

    // f64 BE 0.25
    uint64_t xBits = 0x3FD0000000000000ULL;  // 0.25
    uint64_t yBits = 0x3FE8000000000000ULL;  // 0.75
    uint64_t pBits = 0x3FF0000000000000ULL;  // 1.0
    uint64_t xBE = CFSwapInt64HostToBig(xBits);
    uint64_t yBE = CFSwapInt64HostToBig(yBits);
    uint64_t pBE = CFSwapInt64HostToBig(pBits);
    memcpy(buf + 5, &xBE, 8);
    memcpy(buf + 13, &yBE, 8);
    buf[21] = 0;  // phase
    memcpy(buf + 22, &pBE, 8);
    uint32_t idBE = htonl(7);
    memcpy(buf + 30, &idBE, 4);

    uint8_t outKind = 0;
    NSData *outPayload = nil;
    size_t consumed = 0;
    BOOL ok = DSFramerDecodeOne(buf, sizeof(buf), &consumed, &outKind, &outPayload);

    XCTAssertTrue(ok, @"DSFramerDecodeOne must succeed");
    XCTAssertEqual(outKind, (uint8_t)0xC1);
    XCTAssertEqual(consumed, (size_t)34);
    XCTAssertNotNil(outPayload);
    XCTAssertEqual(outPayload.length, (NSUInteger)29);

    double xR = 0, yR = 0, pres = 0;
    uint8_t phase = 0xFF;
    uint32_t touchId = 0;
    BOOL decoded = DSFramerDecodeTouchPayload(outPayload, &xR, &yR, &phase, &pres, &touchId);
    XCTAssertTrue(decoded);
    XCTAssertEqualWithAccuracy(xR, 0.25, 1e-9);
    XCTAssertEqualWithAccuracy(yR, 0.75, 1e-9);
    XCTAssertEqual(phase, (uint8_t)0);
    XCTAssertEqualWithAccuracy(pres, 1.0, 1e-9);
    XCTAssertEqual(touchId, (uint32_t)7);
}

#pragma mark - Test 3: decode 0xC9 quit frame

- (void)testDecodeQuitFrame {
    uint8_t buf[5] = {0};
    uint32_t lengthBE = htonl(1);  // covers just the kind byte
    memcpy(buf, &lengthBE, 4);
    buf[4] = 0xC9;

    uint8_t outKind = 0;
    NSData *outPayload = nil;
    size_t consumed = 0;
    BOOL ok = DSFramerDecodeOne(buf, sizeof(buf), &consumed, &outKind, &outPayload);

    XCTAssertTrue(ok);
    XCTAssertEqual(outKind, (uint8_t)0xC9);
    XCTAssertEqual(consumed, (size_t)5);
    XCTAssertNotNil(outPayload);
    XCTAssertEqual(outPayload.length, (NSUInteger)0);
}

#pragma mark - Test 4: partial chunk buffering

- (void)testPartialChunkBuffering {
    // Build a single 34-byte 0xC1 frame.
    uint8_t frame[34] = {0};
    uint32_t lengthBE = htonl(30);
    memcpy(frame, &lengthBE, 4);
    frame[4] = 0xC1;
    // 29 bytes of zeroed payload is fine for this test (we're not asserting
    // payload values, only that the framer reassembles the full frame).

    // Feed the framer 3 bytes at a time. After each call, if the framer
    // returns NO, accumulate. At some chunk boundary it must return YES
    // and consume exactly 34 bytes — and never split or duplicate.
    NSMutableData *buffer = [NSMutableData data];
    size_t producedAt = 0;
    int decodeCount = 0;
    uint8_t outKind = 0;
    NSData *outPayload = nil;
    size_t consumed = 0;

    for (size_t chunkStart = 0; chunkStart < sizeof(frame); chunkStart += 3) {
        size_t chunkLen = MIN((size_t)3, sizeof(frame) - chunkStart);
        [buffer appendBytes:(frame + chunkStart) length:chunkLen];

        // Drain as many frames as currently available.
        while (1) {
            BOOL ok = DSFramerDecodeOne((const uint8_t *)buffer.bytes,
                                        buffer.length,
                                        &consumed,
                                        &outKind,
                                        &outPayload);
            if (!ok) break;
            decodeCount++;
            producedAt = chunkStart + chunkLen;
            // Slide the buffer forward.
            [buffer replaceBytesInRange:NSMakeRange(0, consumed)
                              withBytes:NULL
                                 length:0];
        }
    }

    XCTAssertEqual(decodeCount, 1, @"exactly one frame reassembled");
    XCTAssertEqual(outKind, (uint8_t)0xC1);
    XCTAssertEqual(buffer.length, (NSUInteger)0, @"no bytes left over");
    XCTAssertEqual(producedAt, (size_t)34, @"frame produced after the full 34 bytes were fed");
}

@end
