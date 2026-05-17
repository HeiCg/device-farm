// encoder_darwin.mm — VideoToolbox H.264 encoder for Phase 33.
//
// Config DUPLICATES sim-capture-private/Sources/H264Encoder.h:18-23
// (sibling helper — OK to study, NOT to link, per
// 33-RESEARCH.md Open Question #3):
//   kVTCompressionPropertyKey_ProfileLevel       = kVTProfileLevel_H264_Baseline_AutoLevel
//   kVTCompressionPropertyKey_RealTime           = kCFBooleanTrue
//   kVTCompressionPropertyKey_AllowFrameReordering = kCFBooleanFalse
//   kVTCompressionPropertyKey_MaxKeyFrameInterval = 30
//   kVTCompressionPropertyKey_AverageBitRate     = 4_000_000
//   kVTCompressionPropertyKey_ExpectedFrameRate  = 30
//
// Output frames are AVCC-format (length-prefixed NALs) — VideoToolbox's
// default. SPS+PPS are extracted on the first IDR and emitted as a single
// avcC parameter-sets blob (kind 0x01); every subsequent access unit is
// emitted as kind 0x02.

#import "encoder_darwin.h"

#import <Foundation/Foundation.h>
#import <VideoToolbox/VideoToolbox.h>
#import <CoreMedia/CoreMedia.h>
#import <CoreVideo/CoreVideo.h>
#import <arpa/inet.h>
#import <stdatomic.h>
#import <stdlib.h>
#import <string.h>

#pragma mark - avcC parameter-sets blob

// Build an avcC parameter-set blob (ISO/IEC 14496-15 §5.2.4.1) from the
// CMFormatDescription's SPS+PPS.  Layout matches Phase 32's
// sim-capture-private/Sources/H264Encoder.mm:33-67 (DSBuildAvcCBlob).
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

#pragma mark - DSEncoder

struct DSEncoder {
    VTCompressionSessionRef session;
    ds_encoder_cb           cb;
    void                   *user;
    int                     width;
    int                     height;
    int                     fps;
    int                     bitrate;
    bool                    paramSetsSent;
    int64_t                 frameCount;
};

static void DSEncoderOutputCallback(void *outputCallbackRefCon,
                                    void *sourceFrameRefCon,
                                    OSStatus status,
                                    VTEncodeInfoFlags infoFlags,
                                    CMSampleBufferRef sampleBuffer);

DSEncoder* ds_encoder_new(int width, int height, int fps, int bitrate,
                          ds_encoder_cb cb, void* user) {
    if (width <= 0 || height <= 0 || cb == NULL) {
        fprintf(stderr, "ds_encoder_new: bad args w=%d h=%d cb=%p\n",
                width, height, (void *)cb);
        return NULL;
    }
    DSEncoder *e = (DSEncoder *)calloc(1, sizeof(DSEncoder));
    if (!e) return NULL;
    e->cb = cb;
    e->user = user;
    e->width = width;
    e->height = height;
    e->fps = fps > 0 ? fps : 30;
    e->bitrate = bitrate > 0 ? bitrate : 4000000;
    e->paramSetsSent = false;
    e->frameCount = 0;

    OSStatus s = VTCompressionSessionCreate(
        kCFAllocatorDefault,
        (int32_t)width,
        (int32_t)height,
        kCMVideoCodecType_H264,
        /* encoderSpec */ NULL,
        /* imageBufferAttrs */ NULL,
        /* compressedAllocator */ NULL,
        DSEncoderOutputCallback,
        e,
        &e->session);
    if (s != noErr || e->session == NULL) {
        fprintf(stderr, "VTCompressionSessionCreate failed: %d\n", (int)s);
        free(e);
        return NULL;
    }

    // === LOCKED config (mirrors sim-capture-private H264Encoder.h:18-23) ===
    VTSessionSetProperty(e->session, kVTCompressionPropertyKey_RealTime, kCFBooleanTrue);
    VTSessionSetProperty(e->session, kVTCompressionPropertyKey_AllowFrameReordering, kCFBooleanFalse);
    VTSessionSetProperty(e->session, kVTCompressionPropertyKey_ProfileLevel,
                         kVTProfileLevel_H264_Baseline_AutoLevel);
    VTSessionSetProperty(e->session, kVTCompressionPropertyKey_MaxKeyFrameInterval,
                         (__bridge CFNumberRef)@30);
    VTSessionSetProperty(e->session, kVTCompressionPropertyKey_AverageBitRate,
                         (__bridge CFNumberRef)@(e->bitrate));
    VTSessionSetProperty(e->session, kVTCompressionPropertyKey_ExpectedFrameRate,
                         (__bridge CFNumberRef)@(e->fps));
    VTCompressionSessionPrepareToEncodeFrames(e->session);
    return e;
}

void ds_encoder_close(DSEncoder *e) {
    if (!e) return;
    if (e->session) {
        VTCompressionSessionCompleteFrames(e->session, kCMTimeInvalid);
        VTCompressionSessionInvalidate(e->session);
        CFRelease(e->session);
        e->session = NULL;
    }
    e->cb = NULL;
    e->user = NULL;
    free(e);
}

int ds_encoder_encode(DSEncoder *e, const uint8_t *rgba,
                      int width, int height, int64_t pts_us, int force_idr) {
    if (!e || !e->session || !rgba) return -1;

    // Build a CVPixelBuffer wrapping the RGBA bytes. The kVTPixelTransfer
    // path inside VideoToolbox handles RGBA→I420/NV12 conversion implicitly.
    CVPixelBufferRef pb = NULL;
    NSDictionary *attrs = @{
        (__bridge NSString *)kCVPixelBufferCGImageCompatibilityKey: @YES,
        (__bridge NSString *)kCVPixelBufferCGBitmapContextCompatibilityKey: @YES,
        (__bridge NSString *)kCVPixelBufferIOSurfacePropertiesKey: @{},
    };
    OSStatus s = CVPixelBufferCreate(
        kCFAllocatorDefault,
        (size_t)width,
        (size_t)height,
        kCVPixelFormatType_32BGRA,
        (__bridge CFDictionaryRef)attrs,
        &pb);
    if (s != kCVReturnSuccess || pb == NULL) {
        fprintf(stderr, "CVPixelBufferCreate failed: %d\n", (int)s);
        return -2;
    }

    CVPixelBufferLockBaseAddress(pb, 0);
    uint8_t *dst = (uint8_t *)CVPixelBufferGetBaseAddress(pb);
    size_t dstRowBytes = CVPixelBufferGetBytesPerRow(pb);
    size_t srcRowBytes = (size_t)width * 4;
    // RGBA→BGRA swap per row (R↔B). VideoToolbox accepts BGRA natively;
    // doing the swap in CPU here is ~50 MB/s at 1440p — within budget. If
    // this becomes a bottleneck the emulator can be configured to write
    // BGRA directly into the mmap region (kittyfarm uses RGBA so we keep
    // the swap on our side).
    for (int y = 0; y < height; y++) {
        const uint8_t *srow = rgba + (size_t)y * srcRowBytes;
        uint8_t *drow = dst + (size_t)y * dstRowBytes;
        for (int x = 0; x < width; x++) {
            drow[x*4 + 0] = srow[x*4 + 2]; // B ← R
            drow[x*4 + 1] = srow[x*4 + 1]; // G
            drow[x*4 + 2] = srow[x*4 + 0]; // R ← B
            drow[x*4 + 3] = srow[x*4 + 3]; // A
        }
    }
    CVPixelBufferUnlockBaseAddress(pb, 0);

    NSDictionary *frameProps = force_idr
        ? @{(__bridge NSString *)kVTEncodeFrameOptionKey_ForceKeyFrame: @YES}
        : nil;
    e->frameCount++;
    CMTime pts = CMTimeMake(e->frameCount, e->fps > 0 ? e->fps : 30);
    VTEncodeInfoFlags flagsOut = 0;
    OSStatus es = VTCompressionSessionEncodeFrame(
        e->session,
        pb,
        pts,
        kCMTimeInvalid,
        (__bridge CFDictionaryRef)frameProps,
        /* sourceFrameRefCon */ NULL,
        &flagsOut);
    CVPixelBufferRelease(pb);
    if (es != noErr) {
        fprintf(stderr, "VTCompressionSessionEncodeFrame: status=%d\n", (int)es);
        return -3;
    }
    (void)pts_us; // currently we synthesize PTS from frameCount; pts_us
                   // reserved for Wave 4 where the TS adapter needs real ts.
    return 0;
}

static void DSEncoderOutputCallback(void *outputCallbackRefCon,
                                    void *sourceFrameRefCon,
                                    OSStatus status,
                                    VTEncodeInfoFlags infoFlags,
                                    CMSampleBufferRef sampleBuffer) {
    (void)sourceFrameRefCon;
    (void)infoFlags;
    DSEncoder *e = (DSEncoder *)outputCallbackRefCon;
    if (!e || !e->cb) return;
    if (status != noErr || sampleBuffer == NULL) {
        if (status != noErr) {
            fprintf(stderr, "DSEncoderOutputCallback: status=%d\n", (int)status);
        }
        return;
    }

    // 1) On the FIRST sample (always an IDR after PrepareToEncodeFrames),
    //    extract SPS+PPS into an avcC blob and emit kind 0x01.
    if (!e->paramSetsSent) {
        CMFormatDescriptionRef fmt = CMSampleBufferGetFormatDescription(sampleBuffer);
        if (fmt) {
            NSData *blob = DSBuildAvcCBlob(fmt);
            if (blob && blob.length > 0) {
                e->cb(e->user, 0x01,
                      (const uint8_t *)blob.bytes,
                      (int)blob.length);
                e->paramSetsSent = true;
            }
        }
    }

    // 2) Emit the encoded access unit (already AVCC by VideoToolbox default).
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
    e->cb(e->user, 0x02, (const uint8_t *)dataPtr, (int)totalLen);
}
