// Ported from baguette (Apache-2.0). Upstream: https://github.com/tddworks/baguette
// Original: Sources/Baguette/Infrastructure/Camera/SharedMemoryFrameSink.swift

import Foundation
import Darwin

/// Frame sink backed by a fixed-size mmap'd file. Every write
/// rewrites the 24-byte header plus the pixel payload at offset 24,
/// then `msync(MS_SYNC)`s so the in-sim dylib's reader picks up the
/// new sequence on its next display-link tick.
final class SharedMemoryFrameSink: @unchecked Sendable {
    let path: String
    private let lock = NSLock()
    private var fd: Int32 = -1
    private var buffer: UnsafeMutableRawPointer?

    init(path: String) throws {
        self.path = path
        try openAndMap()
    }

    deinit { unmap() }

    /// Write one BGRA frame. The pixels buffer MUST be tightly packed
    /// (`width * height * 4` bytes, no row padding).
    func write(
        bgra: UnsafeRawBufferPointer,
        width: UInt32,
        height: UInt32,
        sequence: UInt32,
        timestampMs: UInt32,
        flags: UInt32
    ) throws {
        lock.lock(); defer { lock.unlock() }
        guard let base = buffer else {
            throw SharedMemoryFrameSinkError.notOpen
        }

        let expected = Int(width) * Int(height) * 4
        guard width > 0, height > 0 else {
            throw SharedMemoryFrameSinkError.invalidDimensions(width: width, height: height)
        }
        guard
            Int(width)  <= SharedFrameLayout.maxCanvasWidth,
            Int(height) <= SharedFrameLayout.maxCanvasHeight
        else {
            throw SharedMemoryFrameSinkError.frameTooLarge(width: width, height: height)
        }
        guard bgra.count == expected else {
            throw SharedMemoryFrameSinkError.pixelSizeMismatch(expected: expected, got: bgra.count)
        }

        let header = SharedFrameLayout.encodeHeader(
            sequence: sequence,
            timestampMs: timestampMs,
            width: width,
            height: height,
            flags: flags
        )
        header.withUnsafeBufferPointer { headerPtr in
            if let src = headerPtr.baseAddress {
                memcpy(base, src, SharedFrameLayout.headerSize)
            }
        }
        if let src = bgra.baseAddress {
            memcpy(
                base.advanced(by: SharedFrameLayout.headerSize),
                src,
                expected
            )
        }
        msync(base, SharedFrameLayout.headerSize + expected, MS_SYNC)
    }

    // MARK: - Private

    private func openAndMap() throws {
        let cPath = path.withCString { strdup($0)! }
        defer { free(cPath) }
        let fd = open(cPath, O_CREAT | O_RDWR, 0o600)
        if fd == -1 {
            throw SharedMemoryFrameSinkError.openFailed(path: path, errno: errno)
        }
        if ftruncate(fd, off_t(SharedFrameLayout.totalByteCount)) == -1 {
            let err = errno
            Darwin.close(fd)
            throw SharedMemoryFrameSinkError.truncateFailed(errno: err)
        }
        guard let base = mmap(
            nil,
            SharedFrameLayout.totalByteCount,
            PROT_READ | PROT_WRITE,
            MAP_SHARED,
            fd,
            0
        ), base != UnsafeMutableRawPointer(bitPattern: -1) else {
            let err = errno
            Darwin.close(fd)
            throw SharedMemoryFrameSinkError.mmapFailed(errno: err)
        }
        self.fd = fd
        self.buffer = base
    }

    private func unmap() {
        lock.lock(); defer { lock.unlock() }
        if let base = buffer {
            munmap(base, SharedFrameLayout.totalByteCount)
            buffer = nil
        }
        if fd != -1 {
            Darwin.close(fd)
            fd = -1
        }
    }
}

enum SharedMemoryFrameSinkError: Error, Equatable, CustomStringConvertible {
    case openFailed(path: String, errno: Int32)
    case truncateFailed(errno: Int32)
    case mmapFailed(errno: Int32)
    case notOpen
    case invalidDimensions(width: UInt32, height: UInt32)
    case frameTooLarge(width: UInt32, height: UInt32)
    case pixelSizeMismatch(expected: Int, got: Int)

    var description: String {
        switch self {
        case .openFailed(let path, let err):
            return "open(\(path)) failed: \(String(cString: strerror(err)))"
        case .truncateFailed(let err):
            return "ftruncate failed: \(String(cString: strerror(err)))"
        case .mmapFailed(let err):
            return "mmap failed: \(String(cString: strerror(err)))"
        case .notOpen:
            return "shared-memory frame sink is not open"
        case .invalidDimensions(let w, let h):
            return "invalid dimensions: \(w)x\(h)"
        case .frameTooLarge(let w, let h):
            return "frame too large: \(w)x\(h) (max \(SharedFrameLayout.maxCanvasWidth)x\(SharedFrameLayout.maxCanvasHeight))"
        case .pixelSizeMismatch(let expected, let got):
            return "pixel buffer size mismatch: expected \(expected), got \(got)"
        }
    }
}
