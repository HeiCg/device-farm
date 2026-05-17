// Ported from baguette (Apache-2.0). Upstream: https://github.com/tddworks/baguette
// Composition root for the sim-cam CLI. Parses argv, opens the
// shared-memory frame sink, wires the AVCaptureSession pipeline.

import Foundation
import Darwin

struct Args {
    var list: Bool = false
    var deviceUid: String?
    var shmPath: String = "/tmp/SimCam.bgra"
    var width: Int = 640
    var height: Int = 480
    var fps: Int = 30
}

func parseArgs(_ argv: [String]) -> Args {
    var args = Args()
    var i = 1
    while i < argv.count {
        let arg = argv[i]
        switch arg {
        case "--list":
            args.list = true
        case "--device-uid":
            i += 1
            if i < argv.count { args.deviceUid = argv[i] }
        case "--shm-path":
            i += 1
            if i < argv.count { args.shmPath = argv[i] }
        case "--width":
            i += 1
            if i < argv.count, let v = Int(argv[i]) { args.width = v }
        case "--height":
            i += 1
            if i < argv.count, let v = Int(argv[i]) { args.height = v }
        case "--fps":
            i += 1
            if i < argv.count, let v = Int(argv[i]) { args.fps = v }
        case "-h", "--help":
            printUsage()
            exit(0)
        default:
            FileHandle.standardError.write(Data("unknown argument: \(arg)\n".utf8))
            printUsage()
            exit(2)
        }
        i += 1
    }
    return args
}

func printUsage() {
    let text = """
    sim-cam — capture host camera frames into a shared-memory file.

    Usage:
      sim-cam --list
      sim-cam --device-uid <UID> [--shm-path /tmp/SimCam.bgra] [--width 640] [--height 480] [--fps 30]
    """
    FileHandle.standardError.write(Data((text + "\n").utf8))
}

let args = parseArgs(CommandLine.arguments)

if args.list {
    do {
        let json = try AVCameras.listJSON()
        print(json)
        exit(0)
    } catch {
        FileHandle.standardError.write(Data("listJSON failed: \(error)\n".utf8))
        exit(1)
    }
}

guard let deviceUid = args.deviceUid else {
    FileHandle.standardError.write(Data("--device-uid is required (or pass --list)\n".utf8))
    printUsage()
    exit(2)
}

// MARK: - Pipeline

let sink: SharedMemoryFrameSink
do {
    sink = try SharedMemoryFrameSink(path: args.shmPath)
} catch {
    FileHandle.standardError.write(Data("failed to open shm at \(args.shmPath): \(error)\n".utf8))
    exit(1)
}

let host = HostVideoCapture()
host.targetWidth = args.width
host.targetHeight = args.height
host.targetFps = args.fps

let capture = AVCameraCapture(video: host)

// Hook SIGINT/SIGTERM for graceful shutdown.
let signalSource = DispatchSource.makeSignalSource(signal: SIGINT, queue: .main)
let termSource = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
signal(SIGINT, SIG_IGN)
signal(SIGTERM, SIG_IGN)

let shutdown: @Sendable () -> Void = {
    Task {
        await capture.stop()
        FileHandle.standardError.write(Data("[sim-cam] shutdown\n".utf8))
        exit(0)
    }
}
signalSource.setEventHandler(handler: shutdown)
termSource.setEventHandler(handler: shutdown)
signalSource.resume()
termSource.resume()

Task {
    do {
        try await capture.start(deviceUniqueID: deviceUid) { packed, w, h, seq, ts in
            do {
                try sink.write(
                    bgra: packed,
                    width: w,
                    height: h,
                    sequence: seq,
                    timestampMs: ts,
                    flags: 0
                )
            } catch {
                FileHandle.standardError.write(Data("[sim-cam] write failed: \(error)\n".utf8))
            }
        }
        FileHandle.standardError.write(Data(
            "[sim-cam] capturing from \(deviceUid) at \(args.width)x\(args.height)@\(args.fps)fps → \(args.shmPath)\n".utf8
        ))
    } catch {
        FileHandle.standardError.write(Data("[sim-cam] start failed: \(error)\n".utf8))
        exit(1)
    }
}

RunLoop.main.run()
