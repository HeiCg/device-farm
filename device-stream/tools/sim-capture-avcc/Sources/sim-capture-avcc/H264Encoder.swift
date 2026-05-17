// Ported from baguette (Apache-2.0). Upstream: https://github.com/tddworks/baguette
// Original: Sources/Baguette/Infrastructure/Stream/H264Encoder.swift

import Foundation
import CoreVideo
import CoreMedia
import VideoToolbox
import IOSurface

/// Real-time H.264 encoder backed by `VTCompressionSession`. Submission is
/// fire-and-forget — the caller hands a surface in, the encoder hands an
/// avcC description (once) and per-sample NAL blobs back via callbacks
/// on VT's own queue.
///
/// This port DROPS baguette's Envelope output framing; the caller wraps
/// payloads with a 1-byte AVCC tag (see protocol-v2.ts).
final class H264Encoder: @unchecked Sendable {
    /// Fires exactly once on the first IDR with the avcC parameter-set
    /// blob (ISO/IEC 14496-15 §5.2.4.1).
    var onAvcCDescription: (@Sendable (Data) -> Void)?

    /// Fires per compressed sample. `nalUnitData` is the length-prefixed
    /// AVCC NAL payload; `isKeyframe` is true for IDRs.
    var onCompressedSample: (@Sendable (_ isKeyframe: Bool, _ nalUnitData: Data) -> Void)?

    private let lock = NSLock()
    private var session: VTCompressionSession?
    private var width: Int32 = 0
    private var height: Int32 = 0
    private let fps: Int32
    private var bitrate: Int
    private var emittedDescription = false
    private var frameCount: Int64 = 0

    init(fps: Int, bitrate: Int = 2_000_000) {
        self.fps = Int32(fps)
        self.bitrate = bitrate
    }

    deinit {
        if let session {
            VTCompressionSessionInvalidate(session)
        }
    }

    /// Update the average bitrate on the live VT session.
    func setBitrate(_ bps: Int) {
        lock.lock()
        defer { lock.unlock() }
        bitrate = bps
        guard let session else { return }
        VTSessionSetProperty(session, key: kVTCompressionPropertyKey_AverageBitRate,
                             value: NSNumber(value: bps))
    }

    /// Submit a surface for encoding. Wraps the IOSurface zero-copy into
    /// a CVPixelBuffer; for the downscaled path use the `CVPixelBuffer`
    /// overload directly.
    func encode(_ surface: IOSurface, forceKeyframe: Bool = false) {
        guard let pixelBuffer = wrap(surface) else { return }
        encode(pixelBuffer, forceKeyframe: forceKeyframe)
    }

    /// Submit a CVPixelBuffer for encoding. Returns immediately; output
    /// fires on VT's queue.
    func encode(_ pixelBuffer: CVPixelBuffer, forceKeyframe: Bool = false) {
        let w = Int32(CVPixelBufferGetWidth(pixelBuffer))
        let h = Int32(CVPixelBufferGetHeight(pixelBuffer))
        if session == nil || w != width || h != height {
            width = w
            height = h
            try? rebuildSession()
        }
        guard let session else { return }

        let frameProps: NSDictionary? = forceKeyframe
            ? [kVTEncodeFrameOptionKey_ForceKeyFrame: kCFBooleanTrue!] as NSDictionary
            : nil

        frameCount += 1
        let pts = CMTime(value: frameCount, timescale: fps)

        VTCompressionSessionEncodeFrame(
            session,
            imageBuffer: pixelBuffer,
            presentationTimeStamp: pts,
            duration: .invalid,
            frameProperties: frameProps,
            infoFlagsOut: nil
        ) { [weak self] status, _, sampleBuffer in
            guard let self, status == noErr, let sb = sampleBuffer else { return }
            self.handle(sb)
        }
    }

    // MARK: - private

    private func wrap(_ surface: IOSurface) -> CVPixelBuffer? {
        var pb: Unmanaged<CVPixelBuffer>?
        let status = CVPixelBufferCreateWithIOSurface(
            kCFAllocatorDefault, surface,
            [kCVPixelBufferPixelFormatTypeKey: kCVPixelFormatType_32BGRA] as CFDictionary,
            &pb
        )
        return status == kCVReturnSuccess ? pb?.takeRetainedValue() : nil
    }

    private func rebuildSession() throws {
        if let session {
            VTCompressionSessionInvalidate(session)
            self.session = nil
        }

        var sess: VTCompressionSession?
        let status = VTCompressionSessionCreate(
            allocator: kCFAllocatorDefault,
            width: width, height: height,
            codecType: kCMVideoCodecType_H264,
            encoderSpecification: nil,
            imageBufferAttributes: nil,
            compressedDataAllocator: kCFAllocatorDefault,
            outputCallback: nil,
            refcon: nil,
            compressionSessionOut: &sess
        )
        guard status == noErr, let sess else { return }

        let props: [(CFString, Any)] = [
            (kVTCompressionPropertyKey_RealTime, kCFBooleanTrue!),
            (kVTCompressionPropertyKey_ProfileLevel, kVTProfileLevel_H264_High_AutoLevel),
            (kVTCompressionPropertyKey_AllowFrameReordering, kCFBooleanFalse!),
            (kVTCompressionPropertyKey_AverageBitRate, NSNumber(value: bitrate)),
            (kVTCompressionPropertyKey_ExpectedFrameRate, NSNumber(value: fps)),
            // 5-second keyframe interval — IDRs are ~5-10x larger than
            // P-frames; spacing them out keeps motion smooth. Late-joiner
            // resync uses the JPEG seed (0x04 tag).
            (kVTCompressionPropertyKey_MaxKeyFrameInterval, NSNumber(value: fps * 5)),
        ]
        for (key, value) in props {
            VTSessionSetProperty(sess, key: key, value: value as CFTypeRef)
        }
        VTCompressionSessionPrepareToEncodeFrames(sess)

        session = sess
        emittedDescription = false
    }

    private func handle(_ sample: CMSampleBuffer) {
        let isKeyframe = !cmSampleNotSync(sample)
        guard let dataBuf = CMSampleBufferGetDataBuffer(sample) else { return }

        var totalLength = 0
        var dataPointer: UnsafeMutablePointer<Int8>?
        guard CMBlockBufferGetDataPointer(
            dataBuf, atOffset: 0, lengthAtOffsetOut: nil,
            totalLengthOut: &totalLength, dataPointerOut: &dataPointer
        ) == noErr, let dataPointer else {
            return
        }
        let avcc = Data(bytes: dataPointer, count: totalLength)

        if isKeyframe, !emittedDescription,
           let format = CMSampleBufferGetFormatDescription(sample),
           let description = avcCBlob(from: format) {
            emittedDescription = true
            onAvcCDescription?(description)
        }

        onCompressedSample?(isKeyframe, avcc)
    }

    private func cmSampleNotSync(_ sample: CMSampleBuffer) -> Bool {
        guard let attachments = CMSampleBufferGetSampleAttachmentsArray(sample, createIfNecessary: false),
              CFArrayGetCount(attachments) > 0,
              let dict = CFArrayGetValueAtIndex(attachments, 0)
        else { return false }
        let cfDict = unsafeBitCast(dict, to: CFDictionary.self)
        return CFDictionaryContainsKey(cfDict, Unmanaged.passUnretained(kCMSampleAttachmentKey_NotSync).toOpaque())
    }

    /// avcC parameter-set blob (ISO/IEC 14496-15 §5.2.4.1).
    private func avcCBlob(from format: CMFormatDescription) -> Data? {
        var spsCount = 0
        var spsPtr: UnsafePointer<UInt8>?
        var spsSize = 0
        var nalSize: Int32 = 0
        guard CMVideoFormatDescriptionGetH264ParameterSetAtIndex(
            format, parameterSetIndex: 0,
            parameterSetPointerOut: &spsPtr,
            parameterSetSizeOut: &spsSize,
            parameterSetCountOut: &spsCount,
            nalUnitHeaderLengthOut: &nalSize
        ) == noErr, let spsPtr else { return nil }

        var ppsPtr: UnsafePointer<UInt8>?
        var ppsSize = 0
        guard CMVideoFormatDescriptionGetH264ParameterSetAtIndex(
            format, parameterSetIndex: 1,
            parameterSetPointerOut: &ppsPtr,
            parameterSetSizeOut: &ppsSize,
            parameterSetCountOut: nil,
            nalUnitHeaderLengthOut: nil
        ) == noErr, let ppsPtr else { return nil }

        let sps = UnsafeBufferPointer(start: spsPtr, count: spsSize)
        let pps = UnsafeBufferPointer(start: ppsPtr, count: ppsSize)
        var blob = Data()
        blob.append(0x01)
        blob.append(sps[1])
        blob.append(sps[2])
        blob.append(sps[3])
        blob.append(0xFF)
        blob.append(0xE1)
        blob.append(UInt8((spsSize >> 8) & 0xFF))
        blob.append(UInt8(spsSize & 0xFF))
        blob.append(contentsOf: sps)
        blob.append(0x01)
        blob.append(UInt8((ppsSize >> 8) & 0xFF))
        blob.append(UInt8(ppsSize & 0xFF))
        blob.append(contentsOf: pps)
        return blob
    }
}
