// Ported from baguette (Apache-2.0). Upstream: https://github.com/tddworks/baguette
// Original: Sources/Baguette/Infrastructure/Camera/AVCameraCapture.swift

import Foundation

/// Raw BGRA frame handed off from the AVFoundation delegate. `baseAddress`
/// points at a locked `CVPixelBuffer` — it must NOT escape the delegate
/// callback unless copied first.
struct RawBGRAFrame {
    let baseAddress: UnsafeRawPointer
    let width: UInt32
    let height: UInt32
    let bytesPerRow: Int
    let timestampMs: UInt32
}

/// Orchestrator that wraps a `VideoCapture` collaborator and on every
/// raw BGRA frame:
///   1. assigns a monotonic sequence number (per session — resets on start)
///   2. strips row padding via `BGRAConverter`
///   3. forwards the tightly-packed bytes to the caller's `onFrame`
final class AVCameraCapture: @unchecked Sendable {
    private let video: HostVideoCapture
    private let lock = NSLock()
    private var sequence: UInt32 = 0
    private var dropCount: UInt64 = 0

    init(video: HostVideoCapture = HostVideoCapture()) {
        self.video = video
    }

    /// Start capturing from the camera identified by `deviceUniqueID`. On
    /// every frame the supplied `onFrame` is called on the capture
    /// queue with a tightly-packed BGRA pixel buffer (no row padding),
    /// plus the assigned sequence, capture-time, width, and height.
    func start(
        deviceUniqueID: String,
        onFrame: @escaping @Sendable (UnsafeRawBufferPointer, UInt32, UInt32, UInt32, UInt32) -> Void
    ) async throws {
        resetSequence()
        try await video.start(deviceUniqueID: deviceUniqueID) { [weak self] raw in
            guard let self else { return }
            let seq = self.nextSequence()
            do {
                try BGRAConverter.convert(
                    baseAddress: raw.baseAddress,
                    width: raw.width,
                    height: raw.height,
                    bytesPerRow: raw.bytesPerRow
                ) { packed in
                    onFrame(packed, raw.width, raw.height, seq, raw.timestampMs)
                }
            } catch {
                self.recordDrop(error: error)
            }
        }
    }

    func stop() async {
        await video.stop()
    }

    private func nextSequence() -> UInt32 {
        lock.lock(); defer { lock.unlock() }
        sequence &+= 1
        return sequence
    }

    private func resetSequence() {
        lock.lock(); defer { lock.unlock() }
        sequence = 0
        dropCount = 0
    }

    private func recordDrop(error: Error) {
        lock.lock()
        dropCount &+= 1
        let shouldLog = dropCount == 1 || dropCount % 60 == 0
        let total = dropCount
        lock.unlock()
        if shouldLog {
            FileHandle.standardError.write(Data(
                "[camera] dropped \(total) frame(s) — last: \(error)\n".utf8
            ))
        }
    }
}

/// Pure helper: turns a `CVPixelBuffer`'s row-strided BGRA bytes into
/// a tightly-packed buffer (no row padding). To avoid an extra Data
/// allocation per frame we hand a transient `UnsafeRawBufferPointer`
/// to the caller — the buffer is only valid for the duration of the
/// closure.
enum BGRAConverter {

    enum BGRAConverterError: Error, CustomStringConvertible {
        case invalidDimensions(width: UInt32, height: UInt32)

        var description: String {
            switch self {
            case .invalidDimensions(let w, let h):
                return "invalid dimensions: \(w)x\(h)"
            }
        }
    }

    static func convert(
        baseAddress: UnsafeRawPointer,
        width: UInt32,
        height: UInt32,
        bytesPerRow: Int,
        body: (UnsafeRawBufferPointer) -> Void
    ) throws {
        guard width > 0, height > 0 else {
            throw BGRAConverterError.invalidDimensions(width: width, height: height)
        }
        let rowBytes = Int(width) * 4
        let packedSize = rowBytes * Int(height)

        if bytesPerRow == rowBytes {
            let raw = UnsafeRawBufferPointer(start: baseAddress, count: packedSize)
            body(raw)
            return
        }

        let buffer = UnsafeMutableRawPointer.allocate(
            byteCount: packedSize,
            alignment: MemoryLayout<UInt8>.alignment
        )
        defer { buffer.deallocate() }
        for row in 0..<Int(height) {
            memcpy(
                buffer.advanced(by: row * rowBytes),
                baseAddress.advanced(by: row * bytesPerRow),
                rowBytes
            )
        }
        let raw = UnsafeRawBufferPointer(start: buffer, count: packedSize)
        body(raw)
    }
}
