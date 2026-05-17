// IpcServer.h — Unix-socket length-prefixed framer + control surface
// (Plan 32-03 / T-32.4).
//
// Wire format (locked by 32-BRIEF.md; mirrors sim-capture-avcc
// `main.swift` StdoutWriter at lines 99-121):
//   [u32 BE length (covers tag + payload)][u8 kind][payload bytes]
//
// Server->client kinds: 0x01 SPS+PPS · 0x02 H.264 AU · 0x10 ack · 0xFF error
// Client->server kinds: 0xC1 touch  · 0xC9 quit
//
// Touch payload (29 bytes):
//   [f64 BE x_ratio][f64 BE y_ratio][u8 phase][f64 BE pressure][u32 BE touchId]
//
// Lifecycle:
//   1. `initWithSocketPath:`        — record the path, no fs ops yet
//   2. `startAndAcceptOneClientOrFail:` — unlink stale, bind, listen, accept ONE client
//   3. set touch/quit handlers via the setters
//   4. `writeFrameKind:payload:`    — write a frame; serialized on writer queue
//   5. `stop`                       — close fd, unlink, idempotent
//
// SIGPIPE handling:
//   `signal(SIGPIPE, SIG_IGN)` MUST be called at process startup (`main.mm`).
//   The accepted client fd additionally sets `SO_NOSIGPIPE` (Pitfall 8).
#pragma once

#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/// Touch control-frame handler signature. Invoked on the IPC server's
/// reader queue when a kind=0xC1 frame is decoded.
typedef void (*DSControlTouchHandler)(double x_ratio,
                                      double y_ratio,
                                      uint8_t phase,
                                      double pressure,
                                      uint32_t touchId,
                                      void *_Nullable userData);

/// Quit control-frame handler signature. Invoked on the IPC server's
/// reader queue when a kind=0xC9 frame is decoded.
typedef void (*DSControlQuitHandler)(void *_Nullable userData);

@interface DSIpcServer : NSObject

/// Initializes with the Unix-socket path. No fs ops yet.
- (instancetype)initWithSocketPath:(NSString *)path;

/// Test-only initializer that wraps an already-connected fd (typically one
/// half of a `socketpair`). The fd ownership is taken — the server will
/// close it on `stop`. Used by `IpcFramerTests` to avoid touching the
/// filesystem.
- (instancetype)initWithConnectedFd:(int)fd;

/// Bind + listen + accept one client. Blocks until a client connects.
/// Returns YES on success.
- (BOOL)startAndAcceptOneClientOrFail:(NSError *_Nullable *_Nullable)err;

/// Install handlers for client->server control frames.
- (void)setTouchHandler:(DSControlTouchHandler)h userData:(void *_Nullable)userData;
- (void)setQuitHandler:(DSControlQuitHandler)h userData:(void *_Nullable)userData;

/// Begin the reader loop on a private serial queue. Safe to call after
/// `initWithConnectedFd:` directly (skipping `startAndAcceptOneClientOrFail:`).
- (void)startReaderLoop;

/// Write a single frame. Length prefix is BIG-ENDIAN and covers
/// (1-byte kind + payload). Writes are serialized on a dedicated queue
/// to avoid interleaving from concurrent encoder/error sites.
- (void)writeFrameKind:(uint8_t)kind payload:(NSData *)payload;

/// Synchronously flush pending writes (test-only convenience — production
/// callers don't need this).
- (void)flushWritesSync;

/// Close the client + listening fds, unlink the path. Idempotent.
- (void)stop;

@end

/// Pure-function framer for tests + reader loop. Decodes ONE frame from a
/// rolling buffer of bytes. Returns YES if a complete frame was extracted
/// (in which case `*consumed` is set to the total bytes consumed = 4 +
/// length, and `*outKind` / `*outPayload` are populated). Returns NO if
/// the buffer doesn't yet contain a full frame.
///
/// The function NEVER allocates if `available < 4`. When NO is returned,
/// `*consumed` is set to 0 and `*outPayload` is unchanged.
BOOL DSFramerDecodeOne(const uint8_t *bytes,
                       size_t available,
                       size_t *consumed,
                       uint8_t *outKind,
                       NSData *_Nullable *_Nonnull outPayload);

/// Decode a 0xC1 touch payload (29 bytes). Returns YES on success.
BOOL DSFramerDecodeTouchPayload(NSData *payload,
                                double *x_ratio,
                                double *y_ratio,
                                uint8_t *phase,
                                double *pressure,
                                uint32_t *touchId);

NS_ASSUME_NONNULL_END
