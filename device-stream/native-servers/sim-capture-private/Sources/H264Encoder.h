// H264Encoder.h — VTCompressionSession wrapper that emits AVCC NAL units.
//
// Plan 32-03 (T-32.4). Mirrors the configuration of
// `device-stream/tools/sim-capture-avcc/Sources/sim-capture-avcc/H264Encoder.swift`
// so the byte-on-the-wire output is interchangeable with the existing
// ScreenCaptureKit fallback. The encoder fires a one-shot avcC SPS+PPS
// parameter-set blob (kind 0x01) on the first IDR and a length-prefixed
// AVCC access unit (kind 0x02) for every encoded frame thereafter.
//
// The output callback runs on VideoToolbox's private queue — the callee
// MUST copy the payload bytes if they need to outlive the call.
//
// Encoder config (locked, mirrors H264Encoder.swift):
//   ProfileLevel            = kVTProfileLevel_H264_Baseline_AutoLevel
//   RealTime                = YES
//   AllowFrameReordering    = NO
//   MaxKeyFrameInterval     = 30
//   AverageBitRate          = 4_000_000 (caller-supplied; daemon default)
//   ExpectedFrameRate       = 30        (caller-supplied; daemon default)
#pragma once

#import <Foundation/Foundation.h>
#import <CoreVideo/CoreVideo.h>

NS_ASSUME_NONNULL_BEGIN

/// IPC-layer kind tags for the encoded callback. These match the wire-format
/// kinds defined in 32-BRIEF.md so the IPC server can write them out
/// unchanged.
typedef NS_ENUM(uint8_t, DSEncodedKind) {
    DSEncodedKindParamSets = 0x01,
    DSEncodedKindAccessUnit = 0x02,
};

/// Encoded-output callback. Invoked on VT's private queue.
/// `payloadBytes` is OWNED by the callback — copy if retained.
typedef void (*DSEncodedCallback)(DSEncodedKind kind,
                                  const uint8_t *payloadBytes,
                                  size_t payloadLen,
                                  void *_Nullable userData);

@interface DSH264Encoder : NSObject

/// Designated initializer. `width`/`height` MUST match the first pixel
/// buffer's dimensions; the session is rebuilt if a later frame's size
/// differs.
- (nullable instancetype)initWithWidth:(int)width
                                height:(int)height
                                   fps:(int)fps
                               bitrate:(int)bitrate
                        outputCallback:(DSEncodedCallback)cb
                              userData:(void *_Nullable)userData;

/// Submit a CVPixelBuffer for encoding. Fire-and-forget.
- (void)encodePixelBuffer:(CVPixelBufferRef)pixelBuffer
            forceKeyframe:(BOOL)force;

/// Mark the next frame as a forced IDR.
- (void)forceIDR;

/// Idempotent teardown — invalidates the VT session and clears the callback.
- (void)teardown;

@end

NS_ASSUME_NONNULL_END
