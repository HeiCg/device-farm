// Ported from baguette (Apache-2.0). Upstream: https://github.com/tddworks/baguette
// Original: Sources/Baguette/Infrastructure/Camera/HostVideoCapture.swift

import Foundation
import AVFoundation
import CoreVideo
import CoreMedia

/// Thin production wrapper around `AVCaptureSession`. This is the
/// integration-only file in the camera capture path.
final class HostVideoCapture: NSObject, @unchecked Sendable {

    private let queue = DispatchQueue(label: "sim-cam.camera.capture")
    private let session = AVCaptureSession()
    private var output: AVCaptureVideoDataOutput?
    private var onFrame: (@Sendable (RawBGRAFrame) -> Void)?

    /// Caller-requested canvas pin. Defaults to baguette's 1280x720 cap.
    var targetWidth: Int = 1280
    var targetHeight: Int = 720

    /// FPS throttle (frames per second). 0 means "no throttle".
    var targetFps: Int = 0
    private var lastEmitMs: UInt64 = 0

    func start(
        deviceUniqueID: String,
        onFrame: @escaping @Sendable (RawBGRAFrame) -> Void
    ) async throws {
        guard let device = AVCaptureDevice(uniqueID: deviceUniqueID) else {
            throw HostVideoCaptureError.deviceUnavailable(uid: deviceUniqueID)
        }
        let input = try AVCaptureDeviceInput(device: device)
        self.onFrame = onFrame

        let out = AVCaptureVideoDataOutput()
        // Pin the output size to the shared-buffer canvas cap.
        out.videoSettings = [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
            kCVPixelBufferWidthKey  as String: targetWidth,
            kCVPixelBufferHeightKey as String: targetHeight,
        ]
        out.alwaysDiscardsLateVideoFrames = true
        out.setSampleBufferDelegate(self, queue: queue)

        session.beginConfiguration()
        // Pick the most-specific preset this device supports up to 1280×720.
        for preset: AVCaptureSession.Preset in [.hd1280x720, .high, .medium] {
            if session.canSetSessionPreset(preset) {
                session.sessionPreset = preset
                break
            }
        }
        if session.canAddInput(input) { session.addInput(input) }
        if session.canAddOutput(out) { session.addOutput(out) }
        session.commitConfiguration()
        self.output = out

        session.startRunning()
    }

    func stop() async {
        session.stopRunning()
        session.beginConfiguration()
        session.inputs.forEach(session.removeInput)
        session.outputs.forEach(session.removeOutput)
        session.commitConfiguration()
        self.output = nil
        self.onFrame = nil
    }
}

extension HostVideoCapture: AVCaptureVideoDataOutputSampleBufferDelegate {

    func captureOutput(
        _ output: AVCaptureOutput,
        didOutput sampleBuffer: CMSampleBuffer,
        from connection: AVCaptureConnection
    ) {
        guard let onFrame = self.onFrame,
              let pixel = CMSampleBufferGetImageBuffer(sampleBuffer)
        else { return }

        // FPS throttle. Cheap monotonic clock check before the
        // CVPixelBuffer lock dance — drop the frame before doing any
        // real work.
        if targetFps > 0 {
            let nowMs = nowMillis()
            let minIntervalMs = UInt64(1000 / max(1, targetFps))
            if nowMs - lastEmitMs < minIntervalMs {
                return
            }
            lastEmitMs = nowMs
        }

        CVPixelBufferLockBaseAddress(pixel, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(pixel, .readOnly) }

        guard let base = CVPixelBufferGetBaseAddress(pixel) else { return }
        let w = UInt32(CVPixelBufferGetWidth(pixel))
        let h = UInt32(CVPixelBufferGetHeight(pixel))
        let bpr = CVPixelBufferGetBytesPerRow(pixel)
        let pts = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
        let ms = UInt32(truncatingIfNeeded: Int64(CMTimeGetSeconds(pts) * 1000))

        let raw = RawBGRAFrame(
            baseAddress: UnsafeRawPointer(base),
            width: w, height: h,
            bytesPerRow: bpr,
            timestampMs: ms
        )
        onFrame(raw)
    }

    private func nowMillis() -> UInt64 {
        var ts = timespec()
        clock_gettime(CLOCK_MONOTONIC, &ts)
        return UInt64(ts.tv_sec) * 1000 + UInt64(ts.tv_nsec) / 1_000_000
    }
}

enum HostVideoCaptureError: Error, CustomStringConvertible {
    case deviceUnavailable(uid: String)

    var description: String {
        switch self {
        case .deviceUnavailable(let uid):
            return "no AVCaptureDevice with unique ID '\(uid)'"
        }
    }
}
