// Ported from baguette (Apache-2.0). Upstream: https://github.com/tddworks/baguette
// Original: Sources/Baguette/Infrastructure/Screen/ScreenSnapshot.swift

import Foundation
import IOSurface

/// One-shot frame capture: open `Screen`, wait for the first IOSurface
/// SimulatorKit delivers, encode JPEG, stop. A timeout guards against an
/// idle / wedged simulator that never fires its frame callback.
enum ScreenSnapshot {

    enum Failure: Error, Equatable {
        case timeout
        case encodeFailed
    }

    /// Capture one JPEG. `scale = 1` skips the downscaler; `scale >= 2`
    /// routes through `Scaler` so the encoded bytes are smaller.
    static func capture(
        screen: any Screen,
        quality: Double = 0.85,
        scale: Int = 1,
        timeout: TimeInterval = 2.0
    ) async throws -> Data {
        let session = SnapshotSession(quality: quality, scale: scale)

        defer { screen.stop() }

        return try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Data, Error>) in
            let timer = DispatchSource.makeTimerSource(queue: .global())
            timer.schedule(deadline: .now() + timeout)
            timer.setEventHandler {
                guard session.claim() else { return }
                cont.resume(throwing: Failure.timeout)
            }
            timer.resume()

            do {
                try screen.start { surface in
                    guard session.claim() else { return }
                    timer.cancel()
                    if let bytes = session.encode(surface) {
                        cont.resume(returning: bytes)
                    } else {
                        cont.resume(throwing: Failure.encodeFailed)
                    }
                }
            } catch {
                guard session.claim() else { return }
                timer.cancel()
                cont.resume(throwing: error)
            }
        }
    }
}

/// Owns the per-capture encoder + scaler and the single-shot guard.
private final class SnapshotSession: @unchecked Sendable {
    private let jpeg: JPEGEncoder
    private let scaler: Scaler?
    private let scale: Int
    private let lock = NSLock()
    private var taken = false

    init(quality: Double, scale: Int) {
        self.jpeg = JPEGEncoder(quality: quality)
        self.scaler = scale > 1 ? Scaler() : nil
        self.scale = scale
    }

    func claim() -> Bool {
        lock.lock(); defer { lock.unlock() }
        if taken { return false }
        taken = true
        return true
    }

    func encode(_ surface: IOSurface) -> Data? {
        if let scaler, let pb = scaler.downscale(surface, scale: scale) {
            return jpeg.encode(pb)
        }
        return jpeg.encode(surface)
    }
}
