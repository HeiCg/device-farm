// H264Encoder.mm — VTCompressionSession wrapper (Plan 32-03 / T-32.4).
//
// Mirrors `device-stream/tools/sim-capture-avcc/Sources/sim-capture-avcc/H264Encoder.swift`
// configuration EXACTLY so output is byte-equivalent given the same input
// (modulo VT's internal queue ordering). The Swift reference uses
// kVTProfileLevel_H264_High_AutoLevel, but Plan 32-03 locks
// kVTProfileLevel_H264_Baseline_AutoLevel per `32-BRIEF.md` and
// `32-03-PLAN.md` `must_haves.truths` -- Baseline is the broadest
// playback target and matches kittyfarm's recommendation for
// simulator-streamed H.264 over Web.
#import "H264Encoder.h"

#import <VideoToolbox/VideoToolbox.h>
#import <CoreMedia/CoreMedia.h>
#import <CoreVideo/CoreVideo.h>
#import <arpa/inet.h>               // htons
#import <stdatomic.h>

#pragma mark - File-scope helpers

/// Build an avcC parameter-set blob (ISO/IEC 14496-15 §5.2.4.1) from the
/// CMFormatDescription's SPS+PPS. Layout:
///   [u8 0x01]                            // configurationVersion
///   [u8 SPS[1]]                          // AVCProfileIndication
///   [u8 SPS[2]]                          // profile_compatibility
///   [u8 SPS[3]]                          // AVCLevelIndication
///   [u8 0xFC | (lengthSizeMinusOne=3)]   // == 0xFF
///   [u8 0xE0 | numOfSPS (=0xE1)]
///   [u16 BE spsLen][SPS bytes]
///   [u8 numOfPPS (=1)]
///   [u16 BE ppsLen][PPS bytes]
/// Matches `sim-capture-avcc/H264Encoder.swift` `avcCBlob(from:)`.
static NSData *DSBuildAvcCBlob(CMFormatDescriptionRef fmt) {
    size_t spsCount = 0, spsSize = 0;
    const uint8_t *spsPtr = NULL;
    int32_t nalLenField = 0;
    OSStatus s = CMVideoFormatDescriptionGetH264ParameterSetAtIndex(
        fmt, 0, &spsPtr, &spsSize, &spsCount, &nalLenField);
    if (s != noErr || !spsPtr || spsSize < 4) return nil;

    size_t ppsCount = 0, ppsSize = 0;
    const uint8_t *ppsPtr = NULL;
    s = CMVideoFormatDescriptionGetH264ParameterSetAtIndex(
        fmt, 1, &ppsPtr, &ppsSize, &ppsCount, NULL);
    if (s != noErr || !ppsPtr) return nil;

    NSMutableData *blob = [NSMutableData dataWithCapacity:11 + spsSize + ppsSize];
    uint8_t header[5] = {
        0x01,
        spsPtr[1],
        spsPtr[2],
        spsPtr[3],
        (uint8_t)(0xFC | 3)
    };
    [blob appendBytes:header length:sizeof(header)];
    uint8_t numSps = (uint8_t)(0xE0 | 0x01);
    [blob appendBytes:&numSps length:1];
    uint16_t spsLenBE = htons((uint16_t)spsSize);
    [blob appendBytes:&spsLenBE length:2];
    [blob appendBytes:spsPtr length:spsSize];
    uint8_t numPps = 0x01;
    [blob appendBytes:&numPps length:1];
    uint16_t ppsLenBE = htons((uint16_t)ppsSize);
    [blob appendBytes:&ppsLenBE length:2];
    [blob appendBytes:ppsPtr length:ppsSize];
    return blob;
}

#pragma mark - DSH264Encoder

@interface DSH264Encoder () {
@public
    VTCompressionSessionRef _session;
    DSEncodedCallback _cb;
    void *_userData;
    int _width;
    int _height;
    int _fps;
    int _bitrate;
    BOOL _paramSetsSent;
    int64_t _frameCount;
    atomic_bool _forceNextIDR;
}
@end

static void DSEncoderOutputCallback(void *outputCallbackRefCon,
                                    void *sourceFrameRefCon,
                                    OSStatus status,
                                    VTEncodeInfoFlags infoFlags,
                                    CMSampleBufferRef sampleBuffer);

@implementation DSH264Encoder

- (nullable instancetype)initWithWidth:(int)width
                                height:(int)height
                                   fps:(int)fps
                               bitrate:(int)bitrate
                        outputCallback:(DSEncodedCallback)cb
                              userData:(void *)userData {
    self = [super init];
    if (!self) return nil;

    if (width <= 0 || height <= 0 || cb == NULL) {
        fprintf(stderr, "DSH264Encoder: bad init args w=%d h=%d cb=%p\n",
                width, height, (void *)cb);
        return nil;
    }

    _cb = cb;
    _userData = userData;
    _width = width;
    _height = height;
    _fps = fps > 0 ? fps : 30;
    _bitrate = bitrate > 0 ? bitrate : 4000000;
    _paramSetsSent = NO;
    _frameCount = 0;
    atomic_init(&_forceNextIDR, false);

    OSStatus s = VTCompressionSessionCreate(kCFAllocatorDefault,
                                            (int32_t)_width,
                                            (int32_t)_height,
                                            kCMVideoCodecType_H264,
                                            /* encoderSpec */ NULL,
                                            /* imageBufferAttrs */ NULL,
                                            /* compressedAllocator */ NULL,
                                            DSEncoderOutputCallback,
                                            (__bridge void *)self,
                                            &_session);
    if (s != noErr || _session == NULL) {
        fprintf(stderr, "VTCompressionSessionCreate failed: %d\n", (int)s);
        return nil;
    }

    // Locked encoder config (mirrors sim-capture-avcc H264Encoder.swift +
    // 32-BRIEF.md). Baseline is the playback-broadest profile; RealTime
    // skips the lookahead window so latency stays near 1 frame.
    VTSessionSetProperty(_session, kVTCompressionPropertyKey_RealTime, kCFBooleanTrue);
    VTSessionSetProperty(_session, kVTCompressionPropertyKey_AllowFrameReordering, kCFBooleanFalse);
    VTSessionSetProperty(_session, kVTCompressionPropertyKey_ProfileLevel,
                         kVTProfileLevel_H264_Baseline_AutoLevel);
    VTSessionSetProperty(_session, kVTCompressionPropertyKey_MaxKeyFrameInterval,
                         (__bridge CFNumberRef)@30);
    VTSessionSetProperty(_session, kVTCompressionPropertyKey_AverageBitRate,
                         (__bridge CFNumberRef)@(_bitrate));
    VTSessionSetProperty(_session, kVTCompressionPropertyKey_ExpectedFrameRate,
                         (__bridge CFNumberRef)@(_fps));
    VTCompressionSessionPrepareToEncodeFrames(_session);
    return self;
}

- (void)dealloc {
    [self teardown];
}

- (void)teardown {
    if (_session) {
        VTCompressionSessionCompleteFrames(_session, kCMTimeInvalid);
        VTCompressionSessionInvalidate(_session);
        CFRelease(_session);
        _session = NULL;
    }
    _cb = NULL;
    _userData = NULL;
}

- (void)forceIDR {
    atomic_store(&_forceNextIDR, true);
}

- (void)encodePixelBuffer:(CVPixelBufferRef)pixelBuffer
            forceKeyframe:(BOOL)force {
    if (!_session || !pixelBuffer) return;
    BOOL forceNow = force || atomic_exchange(&_forceNextIDR, false);

    NSDictionary *frameProps = forceNow
        ? @{(__bridge NSString *)kVTEncodeFrameOptionKey_ForceKeyFrame: @YES}
        : nil;

    _frameCount++;
    CMTime pts = CMTimeMake(_frameCount, _fps > 0 ? _fps : 30);

    VTEncodeInfoFlags flagsOut = 0;
    OSStatus s = VTCompressionSessionEncodeFrame(_session,
                                                 pixelBuffer,
                                                 pts,
                                                 kCMTimeInvalid,
                                                 (__bridge CFDictionaryRef)frameProps,
                                                 /* sourceFrameRefCon */ NULL,
                                                 &flagsOut);
    if (s != noErr) {
        fprintf(stderr, "VTCompressionSessionEncodeFrame: status=%d\n", (int)s);
    }
}

@end

#pragma mark - VT output callback

static void DSEncoderOutputCallback(void *outputCallbackRefCon,
                                    void *sourceFrameRefCon,
                                    OSStatus status,
                                    VTEncodeInfoFlags infoFlags,
                                    CMSampleBufferRef sampleBuffer) {
    (void)sourceFrameRefCon;
    (void)infoFlags;
    if (status != noErr || sampleBuffer == NULL) {
        if (status != noErr) {
            fprintf(stderr, "DSEncoderOutputCallback: status=%d\n", (int)status);
        }
        return;
    }
    DSH264Encoder *enc = (__bridge DSH264Encoder *)outputCallbackRefCon;
    if (!enc || !enc->_cb) return;

    // 1) On the FIRST sample (which is always an IDR after
    //    PrepareToEncodeFrames), extract SPS+PPS into an avcC blob and emit
    //    kind 0x01.
    if (!enc->_paramSetsSent) {
        CMFormatDescriptionRef fmt = CMSampleBufferGetFormatDescription(sampleBuffer);
        if (fmt) {
            NSData *blob = DSBuildAvcCBlob(fmt);
            if (blob && blob.length > 0) {
                enc->_cb(DSEncodedKindParamSets,
                         (const uint8_t *)blob.bytes,
                         blob.length,
                         enc->_userData);
                enc->_paramSetsSent = YES;
            }
        }
    }

    // 2) Emit the encoded access unit. CMBlockBuffer is already in AVCC
    //    format (length-prefixed NALs) by VideoToolbox default — no
    //    annex-B conversion needed.
    CMBlockBufferRef bb = CMSampleBufferGetDataBuffer(sampleBuffer);
    if (!bb) return;
    size_t totalLen = 0;
    char *dataPtr = NULL;
    OSStatus gs = CMBlockBufferGetDataPointer(bb,
                                              /* offset */ 0,
                                              /* lengthAtOffsetOut */ NULL,
                                              &totalLen,
                                              &dataPtr);
    if (gs != noErr || dataPtr == NULL || totalLen == 0) return;
    enc->_cb(DSEncodedKindAccessUnit,
             (const uint8_t *)dataPtr,
             totalLen,
             enc->_userData);
}
