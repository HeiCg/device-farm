// IpcServer.mm — Unix-socket length-prefixed framer + control surface
// (Plan 32-03 / T-32.4).
//
// Wire format (locked by 32-BRIEF.md; mirrors sim-capture-avcc
// StdoutWriter at lines 99-121):
//   [u32 BE length (covers tag + payload)][u8 kind][payload bytes]
//
// Server->client kinds: 0x01 SPS+PPS · 0x02 H.264 AU · 0x10 ack · 0xFF error
// Client->server kinds: 0xC1 touch (29-byte payload) · 0xC9 quit (empty)
//
// SIGPIPE handling (Pitfall 8): caller MUST `signal(SIGPIPE, SIG_IGN)` in
// `main.mm`. The accepted client fd additionally sets `SO_NOSIGPIPE`.

#import "IpcServer.h"

#import <sys/socket.h>
#import <sys/un.h>
#import <sys/uio.h>
#import <sys/stat.h>
#import <unistd.h>
#import <fcntl.h>
#import <errno.h>
#import <arpa/inet.h>
#import <string.h>

#pragma mark - Pure-function framer

BOOL DSFramerDecodeOne(const uint8_t *bytes,
                       size_t available,
                       size_t *consumed,
                       uint8_t *outKind,
                       NSData *_Nullable *_Nonnull outPayload) {
    if (consumed) *consumed = 0;
    if (!bytes || available < 4) return NO;

    uint32_t lenBE = 0;
    memcpy(&lenBE, bytes, 4);
    uint32_t length = ntohl(lenBE);
    // The length field MUST cover at least the 1-byte kind.
    if (length < 1) return NO;

    size_t frameTotal = 4 + (size_t)length;
    if (available < frameTotal) return NO;

    uint8_t kind = bytes[4];
    NSUInteger payloadLen = (NSUInteger)(length - 1);
    NSData *payload = payloadLen > 0
        ? [NSData dataWithBytes:(bytes + 5) length:payloadLen]
        : [NSData data];

    if (outKind) *outKind = kind;
    *outPayload = payload;
    if (consumed) *consumed = frameTotal;
    return YES;
}

BOOL DSFramerDecodeTouchPayload(NSData *payload,
                                double *x_ratio,
                                double *y_ratio,
                                uint8_t *phase,
                                double *pressure,
                                uint32_t *touchId) {
    if (!payload || payload.length < 29) return NO;
    const uint8_t *b = (const uint8_t *)payload.bytes;

    uint64_t xN = 0, yN = 0, prN = 0;
    uint32_t idN = 0;
    memcpy(&xN, b + 0, 8);
    memcpy(&yN, b + 8, 8);
    uint8_t phaseByte = b[16];
    memcpy(&prN, b + 17, 8);
    memcpy(&idN, b + 25, 4);

    uint64_t xH = CFSwapInt64BigToHost(xN);
    uint64_t yH = CFSwapInt64BigToHost(yN);
    uint64_t pH = CFSwapInt64BigToHost(prN);
    uint32_t idH = CFSwapInt32BigToHost(idN);

    if (x_ratio)  memcpy(x_ratio, &xH, 8);
    if (y_ratio)  memcpy(y_ratio, &yH, 8);
    if (pressure) memcpy(pressure, &pH, 8);
    if (phase)    *phase = phaseByte;
    if (touchId)  *touchId = idH;
    return YES;
}

#pragma mark - DSIpcServer

@interface DSIpcServer () {
    NSString *_socketPath;
    int _listenFd;
    int _clientFd;
    dispatch_queue_t _writerQueue;
    dispatch_queue_t _readerQueue;
    BOOL _readerRunning;
    BOOL _ownsPath;  // YES if we bound to the socket path (so stop unlinks)

    DSControlTouchHandler _touchHandler;
    void *_touchUserData;
    DSControlQuitHandler _quitHandler;
    void *_quitUserData;
}
@end

@implementation DSIpcServer

- (instancetype)initWithSocketPath:(NSString *)path {
    self = [super init];
    if (!self) return nil;
    _socketPath = [path copy];
    _listenFd = -1;
    _clientFd = -1;
    _writerQueue = dispatch_queue_create("com.devicestream.sim-private-ipc.writer",
                                         DISPATCH_QUEUE_SERIAL);
    _readerQueue = dispatch_queue_create("com.devicestream.sim-private-ipc.reader",
                                         DISPATCH_QUEUE_SERIAL);
    _readerRunning = NO;
    _ownsPath = NO;
    return self;
}

- (instancetype)initWithConnectedFd:(int)fd {
    self = [super init];
    if (!self) return nil;
    _socketPath = nil;
    _listenFd = -1;
    _clientFd = fd;
    _writerQueue = dispatch_queue_create("com.devicestream.sim-private-ipc.writer",
                                         DISPATCH_QUEUE_SERIAL);
    _readerQueue = dispatch_queue_create("com.devicestream.sim-private-ipc.reader",
                                         DISPATCH_QUEUE_SERIAL);
    _readerRunning = NO;
    _ownsPath = NO;
    [self applySocketOptions:fd];
    return self;
}

- (void)dealloc {
    [self stop];
}

- (void)applySocketOptions:(int)fd {
    int on = 1;
    // SO_NOSIGPIPE so a peer-closed write returns EPIPE instead of killing
    // the process. Pitfall 8.
    setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &on, sizeof(on));
}

- (BOOL)startAndAcceptOneClientOrFail:(NSError *_Nullable *_Nullable)err {
    if (_socketPath.length == 0) {
        if (err) *err = [NSError errorWithDomain:@"DSIpcServer" code:1
                                         userInfo:@{NSLocalizedDescriptionKey:
                                                    @"socket path is empty"}];
        return NO;
    }
    const char *path = _socketPath.fileSystemRepresentation;
    if (strlen(path) >= 104) {
        // sun_path is a fixed-size char array; macOS allows up to 104 bytes.
        if (err) *err = [NSError errorWithDomain:@"DSIpcServer" code:2
                                         userInfo:@{NSLocalizedDescriptionKey:
                                                    @"socket path too long"}];
        return NO;
    }

    // unlink any stale socket from a previous crash (Pitfall 8).
    unlink(path);

    int sfd = socket(AF_UNIX, SOCK_STREAM, 0);
    if (sfd < 0) {
        if (err) *err = [NSError errorWithDomain:NSPOSIXErrorDomain code:errno
                                         userInfo:@{NSLocalizedDescriptionKey:
                                                    @"socket() failed"}];
        return NO;
    }
    [self applySocketOptions:sfd];

    struct sockaddr_un addr;
    memset(&addr, 0, sizeof(addr));
    addr.sun_family = AF_UNIX;
    strncpy(addr.sun_path, path, sizeof(addr.sun_path) - 1);

    if (bind(sfd, (struct sockaddr *)&addr, (socklen_t)SUN_LEN(&addr)) < 0) {
        int e = errno;
        close(sfd);
        if (err) *err = [NSError errorWithDomain:NSPOSIXErrorDomain code:e
                                         userInfo:@{NSLocalizedDescriptionKey:
                                                    @"bind() failed"}];
        return NO;
    }
    _ownsPath = YES;
    chmod(path, 0600);  // owner-only access

    if (listen(sfd, 1) < 0) {
        int e = errno;
        close(sfd);
        unlink(path);
        _ownsPath = NO;
        if (err) *err = [NSError errorWithDomain:NSPOSIXErrorDomain code:e
                                         userInfo:@{NSLocalizedDescriptionKey:
                                                    @"listen() failed"}];
        return NO;
    }
    _listenFd = sfd;

    // accept exactly one client (blocks until a peer connects).
    int cfd = accept(sfd, NULL, NULL);
    if (cfd < 0) {
        int e = errno;
        if (err) *err = [NSError errorWithDomain:NSPOSIXErrorDomain code:e
                                         userInfo:@{NSLocalizedDescriptionKey:
                                                    @"accept() failed"}];
        return NO;
    }
    [self applySocketOptions:cfd];
    _clientFd = cfd;
    return YES;
}

- (void)setTouchHandler:(DSControlTouchHandler)h userData:(void *)userData {
    _touchHandler = h;
    _touchUserData = userData;
}

- (void)setQuitHandler:(DSControlQuitHandler)h userData:(void *)userData {
    _quitHandler = h;
    _quitUserData = userData;
}

#pragma mark - Reader loop

- (void)startReaderLoop {
    if (_readerRunning || _clientFd < 0) return;
    _readerRunning = YES;
    int fd = _clientFd;
    __weak DSIpcServer *weakSelf = self;
    dispatch_async(_readerQueue, ^{
        NSMutableData *buffer = [NSMutableData data];
        uint8_t chunk[4096];
        while (1) {
            ssize_t n = read(fd, chunk, sizeof(chunk));
            if (n <= 0) {
                // EOF or error — peer closed.
                break;
            }
            [buffer appendBytes:chunk length:(NSUInteger)n];

            // Drain as many complete frames as available.
            while (1) {
                uint8_t kind = 0;
                NSData *payload = nil;
                size_t consumed = 0;
                BOOL ok = DSFramerDecodeOne((const uint8_t *)buffer.bytes,
                                            buffer.length,
                                            &consumed,
                                            &kind,
                                            &payload);
                if (!ok) break;
                [weakSelf dispatchControlFrameKind:kind payload:payload];
                [buffer replaceBytesInRange:NSMakeRange(0, consumed)
                                  withBytes:NULL
                                     length:0];
            }
        }
        DSIpcServer *strongSelf = weakSelf;
        if (strongSelf) strongSelf->_readerRunning = NO;
    });
}

- (void)dispatchControlFrameKind:(uint8_t)kind payload:(NSData *)payload {
    switch (kind) {
        case 0xC1: {
            if (!_touchHandler) return;
            double x = 0, y = 0, pres = 0;
            uint8_t phase = 0;
            uint32_t touchId = 0;
            if (DSFramerDecodeTouchPayload(payload, &x, &y, &phase, &pres, &touchId)) {
                _touchHandler(x, y, phase, pres, touchId, _touchUserData);
            } else {
                NSString *msg = [NSString stringWithFormat:
                                 @"malformed touch payload (len=%lu)",
                                 (unsigned long)payload.length];
                [self writeFrameKind:0xFF
                              payload:[msg dataUsingEncoding:NSUTF8StringEncoding]];
            }
            break;
        }
        case 0xC9: {
            if (_quitHandler) _quitHandler(_quitUserData);
            break;
        }
        default: {
            // Unknown control kind — surface as an error frame.
            NSString *msg = [NSString stringWithFormat:
                             @"unknown control kind 0x%02X", kind];
            [self writeFrameKind:0xFF
                          payload:[msg dataUsingEncoding:NSUTF8StringEncoding]];
            break;
        }
    }
}

#pragma mark - Writer

- (void)writeFrameKind:(uint8_t)kind payload:(NSData *)payload {
    if (_clientFd < 0) return;
    int fd = _clientFd;
    // Capture an immutable copy so the writer queue sees stable bytes even
    // if the caller mutates the original NSData after this method returns.
    NSData *frozen = [payload copy];

    dispatch_async(_writerQueue, ^{
        uint32_t lenBE = htonl((uint32_t)(frozen.length + 1));
        uint8_t kindByte = kind;
        struct iovec iov[3];
        iov[0].iov_base = &lenBE;
        iov[0].iov_len = sizeof(lenBE);
        iov[1].iov_base = &kindByte;
        iov[1].iov_len = 1;
        iov[2].iov_base = (void *)frozen.bytes;
        iov[2].iov_len = frozen.length;

        size_t total = iov[0].iov_len + iov[1].iov_len + iov[2].iov_len;
        ssize_t written = 0;
        while (written < (ssize_t)total) {
            // writev doesn't natively support resuming from a partial write
            // across all 3 iovecs cleanly, so on EINTR/EAGAIN we restart
            // the iovecs against fresh offsets. For our payload sizes (<
            // 1 MiB) macOS Unix sockets almost always complete in one call.
            ssize_t n = writev(fd, iov, 3);
            if (n < 0) {
                if (errno == EINTR) continue;
                fprintf(stderr, "writev failed errno=%d (%s)\n", errno, strerror(errno));
                return;
            }
            written += n;
            if (written >= (ssize_t)total) break;
            // Partial write — collapse iovecs into a single fallback write.
            size_t remaining = total - (size_t)written;
            NSMutableData *fallback = [NSMutableData dataWithCapacity:remaining];
            size_t offset = (size_t)written;
            // Build the linearized buffer from the original iovecs.
            uint8_t *linear = (uint8_t *)malloc(total);
            memcpy(linear, &lenBE, 4);
            linear[4] = kindByte;
            memcpy(linear + 5, frozen.bytes, frozen.length);
            [fallback appendBytes:linear + offset length:remaining];
            free(linear);
            while ((size_t)written < total) {
                ssize_t w = write(fd,
                                  (const uint8_t *)fallback.bytes + ((size_t)written - offset),
                                  remaining);
                if (w < 0) {
                    if (errno == EINTR) continue;
                    fprintf(stderr, "write failed errno=%d (%s)\n", errno, strerror(errno));
                    return;
                }
                written += w;
                remaining -= (size_t)w;
            }
            break;
        }
    });
}

- (void)flushWritesSync {
    dispatch_sync(_writerQueue, ^{
        // no-op: dispatch_sync waits for the queue to drain.
    });
}

- (void)stop {
    if (_clientFd >= 0) { close(_clientFd); _clientFd = -1; }
    if (_listenFd >= 0) { close(_listenFd); _listenFd = -1; }
    if (_ownsPath && _socketPath.length > 0) {
        unlink(_socketPath.fileSystemRepresentation);
        _ownsPath = NO;
    }
}

@end
