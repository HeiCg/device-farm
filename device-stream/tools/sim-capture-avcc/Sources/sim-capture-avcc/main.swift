// sim-capture-avcc — captures the iOS simulator screen via SimulatorKit
// and emits AVCC-tagged H.264 NAL frames (and a JPEG seed) to stdout.
//
// Wire format (see baguette's AVCCEnvelope; mirrored in TS):
//   4-byte big-endian length (covers tag + payload)
//   1-byte tag
//   payload
//     0x01 = avcC parameter-set blob
//     0x02 = H.264 IDR (keyframe) — length-prefixed AVCC NAL bytes (internal)
//     0x03 = H.264 P (delta)      — length-prefixed AVCC NAL bytes (internal)
//     0x04 = JPEG seed
//
// stdin reconfig (one JSON object per line):
//   {"type":"set_bitrate","bps":N}
//   {"type":"set_fps","fps":N}
//   {"type":"force_idr"}
//   {"type":"snapshot"}

import Foundation
import Dispatch
import IOSurface

// MARK: - CLI parsing

struct Options {
    var udid: String
    var fps: Int = 30
    var bitrate: Int = 4_000_000
    var scale: Double = 1.0
    var format: String = "avcc"
}

func printUsage() {
    let usage = """
    sim-capture-avcc — iOS Simulator AVCC/JPEG streaming over stdout

    Usage:
      sim-capture-avcc --udid <UDID> [--fps N] [--bitrate bps] [--scale 0.1-4.0] [--format avcc|mjpeg]

    Options:
      --udid     <UDID>   iOS simulator UDID (required)
      --fps      <N>      target fps for VT encoder (default 30)
      --bitrate  <bps>    target average bitrate (default 4000000)
      --scale    <f>      0.1..4.0 source scale (default 1.0)
      --format   <kind>   avcc | mjpeg (default avcc)

    Wire format: see device-stream/packages/core/src/protocol-v2.ts.
    """
    FileHandle.standardError.write(Data((usage + "\n").utf8))
}

func parseArgs(_ args: [String]) -> Options? {
    var udid: String?
    var fps = 30
    var bitrate = 4_000_000
    var scale = 1.0
    var format = "avcc"

    var i = 1
    while i < args.count {
        let a = args[i]
        let next: () -> String? = {
            i += 1
            return i < args.count ? args[i] : nil
        }
        switch a {
        case "--udid":
            guard let v = next() else { return nil }
            udid = v
        case "--fps":
            guard let v = next(), let n = Int(v), n > 0 else { return nil }
            fps = n
        case "--bitrate":
            guard let v = next(), let n = Int(v), n > 0 else { return nil }
            bitrate = n
        case "--scale":
            guard let v = next(), let n = Double(v), n >= 0.1, n <= 4.0 else { return nil }
            scale = n
        case "--format":
            guard let v = next(), v == "avcc" || v == "mjpeg" else { return nil }
            format = v
        case "--help", "-h":
            return nil
        default:
            FileHandle.standardError.write(Data("unknown argument: \(a)\n".utf8))
            return nil
        }
        i += 1
    }

    guard let udid else {
        FileHandle.standardError.write(Data("--udid is required\n".utf8))
        return nil
    }

    return Options(udid: udid, fps: fps, bitrate: bitrate, scale: scale, format: format)
}

// MARK: - stdout writer (serialised)

final class StdoutWriter: @unchecked Sendable {
    private let queue = DispatchQueue(label: "sim-capture.stdout")
    private let handle = FileHandle.standardOutput

    // Frame on the wire: 4-byte BE length (covering tag + payload) +
    // 1-byte tag + payload. Length-prefixing is required because Node's
    // stdout 'data' events don't preserve FileHandle.write boundaries.
    func write(tag: UInt8, payload: Data) {
        queue.async {
            let length = UInt32(payload.count + 1)
            var frame = Data(capacity: 5 + payload.count)
            frame.append(UInt8((length >> 24) & 0xFF))
            frame.append(UInt8((length >> 16) & 0xFF))
            frame.append(UInt8((length >> 8)  & 0xFF))
            frame.append(UInt8(length & 0xFF))
            frame.append(tag)
            frame.append(payload)
            self.handle.write(frame)
        }
    }
}

// MARK: - shared one-shot reconfig flags

final class Flags: @unchecked Sendable {
    private let lock = NSLock()
    private var _forceIdr = false
    private var _snapshot = false

    func setForceIdr() {
        lock.lock(); defer { lock.unlock() }
        _forceIdr = true
    }
    func consumeForceIdr() -> Bool {
        lock.lock(); defer { lock.unlock() }
        let v = _forceIdr
        _forceIdr = false
        return v
    }
    func setSnapshot() {
        lock.lock(); defer { lock.unlock() }
        _snapshot = true
    }
    func consumeSnapshot() -> Bool {
        lock.lock(); defer { lock.unlock() }
        let v = _snapshot
        _snapshot = false
        return v
    }
}

// MARK: - main

let opts: Options
do {
    guard let parsed = parseArgs(CommandLine.arguments) else {
        printUsage()
        exit(2)
    }
    opts = parsed
}

let stdoutWriter = StdoutWriter()
let host = CoreSimulatorHost()
let screen = SimulatorKitScreen(udid: opts.udid, host: host)
let flags = Flags()

// Map fractional scale to an integer downscale divisor. scale >= 1.0 is
// a pass-through; scale < 1.0 maps to integer divisor `round(1/scale)`.
let scaleDivisor: Int = opts.scale >= 1.0 ? 1 : max(1, Int((1.0 / opts.scale).rounded()))
let scaler: Scaler? = scaleDivisor > 1 ? Scaler() : nil

// Wrap mutable state in a class so the @Sendable screen callback can
// touch it without tripping Swift-6 strict concurrency on top-level vars.
final class State: @unchecked Sendable {
    var seedFilter = SeedFilter()
    let seedLock = NSLock()
    let jpeg: JPEGEncoder
    var emittedSeed = false
    let seedFlagLock = NSLock()

    init(jpegQuality: Double) {
        self.jpeg = JPEGEncoder(quality: jpegQuality)
    }
}
let state = State(jpegQuality: 0.7)

// Helper: encode JPEG of current surface, downscaled if configured.
@Sendable func jpegOf(_ surface: IOSurface) -> Data? {
    if let scaler, let pb = scaler.downscale(surface, scale: scaleDivisor) {
        return state.jpeg.encode(pb)
    }
    return state.jpeg.encode(surface)
}

if opts.format == "mjpeg" {
    // MJPEG mode: each new frame as JPEG, tag 0x04.
    try screen.start { surface in
        state.seedLock.lock()
        let shouldEmit = state.seedFilter.shouldEmit(surface)
        state.seedLock.unlock()
        guard shouldEmit else { return }

        if let bytes = jpegOf(surface) {
            stdoutWriter.write(tag: 0x04, payload: bytes)
        }
    }
} else {
    let encoder = H264Encoder(fps: opts.fps, bitrate: opts.bitrate)

    encoder.onAvcCDescription = { description in
        stdoutWriter.write(tag: 0x01, payload: description)
    }

    encoder.onCompressedSample = { isKeyframe, nalUnitData in
        stdoutWriter.write(tag: isKeyframe ? 0x02 : 0x03, payload: nalUnitData)
    }

    try screen.start { surface in
        state.seedLock.lock()
        let shouldEmit = state.seedFilter.shouldEmit(surface)
        state.seedLock.unlock()
        guard shouldEmit else { return }

        // First-frame JPEG seed so late-joining decoders render before
        // the first IDR arrives.
        state.seedFlagLock.lock()
        let needsSeed = !state.emittedSeed
        if needsSeed { state.emittedSeed = true }
        state.seedFlagLock.unlock()

        if needsSeed, let bytes = jpegOf(surface) {
            stdoutWriter.write(tag: 0x04, payload: bytes)
        }

        // On-demand snapshot — emit one extra 0x04 JPEG frame.
        if flags.consumeSnapshot(), let bytes = jpegOf(surface) {
            stdoutWriter.write(tag: 0x04, payload: bytes)
        }

        let forceIdr = flags.consumeForceIdr()

        if let scaler, let pb = scaler.downscale(surface, scale: scaleDivisor) {
            encoder.encode(pb, forceKeyframe: forceIdr)
        } else {
            encoder.encode(surface, forceKeyframe: forceIdr)
        }
    }

    // stdin reconfig listener — line-delimited JSON objects on stdin.
    DispatchQueue.global(qos: .userInitiated).async {
        let stdin = FileHandle.standardInput
        var buffer = Data()
        while true {
            let chunk = stdin.availableData
            if chunk.isEmpty {
                Thread.sleep(forTimeInterval: 0.05)
                continue
            }
            buffer.append(chunk)
            while let nl = buffer.firstIndex(of: 0x0A) {
                let lineData = buffer.subdata(in: 0..<nl)
                buffer.removeSubrange(0...nl)
                guard !lineData.isEmpty,
                      let obj = try? JSONSerialization.jsonObject(with: lineData) as? [String: Any],
                      let type = obj["type"] as? String
                else { continue }
                switch type {
                case "set_bitrate":
                    if let bps = (obj["bps"] as? NSNumber)?.intValue {
                        encoder.setBitrate(bps)
                        // Pair with a forced IDR so the new bitrate takes
                        // effect promptly on screen.
                        flags.setForceIdr()
                    }
                case "set_fps":
                    if let fps = (obj["fps"] as? NSNumber)?.intValue {
                        fputs("[sim-capture-avcc] set_fps requested: \(fps) (informational)\n", stderr)
                    }
                case "force_idr":
                    flags.setForceIdr()
                case "snapshot":
                    flags.setSnapshot()
                default:
                    break
                }
            }
        }
    }
}

// Keep the process alive so SimulatorKit's framebuffer callbacks
// continue firing on their own queues.
RunLoop.main.run()
