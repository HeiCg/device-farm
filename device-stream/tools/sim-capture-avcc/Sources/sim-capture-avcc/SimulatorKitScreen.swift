// Ported from baguette (Apache-2.0). Upstream: https://github.com/tddworks/baguette
// Original: Sources/Baguette/Infrastructure/Screen/SimulatorKitScreen.swift
//
// Inlined the minimum `Screen` protocol, `DeviceHost` protocol,
// `SimulatorError`, and a `CoreSimulatorHost` implementation directly into
// this file — baguette's Domain layer is not ported wholesale.

import Foundation
import IOSurface
import ObjectiveC

// MARK: - Inlined Domain types (kept minimal)

protocol Screen: AnyObject, Sendable {
    /// Subscribe to frame delivery. Throws if SimulatorKit's screen pipe
    /// can't be wired (e.g. simulator isn't booted). The closure runs on
    /// the screen's own dispatch queue.
    func start(onFrame: @escaping @Sendable (IOSurface) -> Void) throws

    /// Tear down callbacks and release the underlying screen object.
    func stop()
}

protocol DeviceHost: AnyObject, Sendable {
    /// Look up the underlying `SimDevice` for a UDID. Returns `nil` when
    /// the device set has no matching device.
    func resolveDevice(udid: String) -> NSObject?
}

enum SimulatorError: Error, Equatable {
    case bootFailed
    case shutdownFailed
    case notFound(udid: String)
}

enum ScreenError: Error, Equatable {
    case ioUnavailable
    case noFramebuffer
    case callbackUnavailable
}

// MARK: - SimulatorKitScreen

/// Production `Screen` — registers SimulatorKit framebuffer callbacks via
/// the ObjC runtime and forwards `IOSurface` frames to the caller as they
/// arrive. Pure pass-through: emits exactly when SimulatorKit composites
/// a new frame and nothing more. Cadence policy lives in the consumer.
///
/// Multi-descriptor: simulators expose secondary planes / overlays. We
/// register on every `com.apple.framebuffer.display` descriptor and pick
/// whichever currently has the largest live surface area each tick.
final class SimulatorKitScreen: Screen, @unchecked Sendable {
    private let udid: String
    private let host: any DeviceHost
    private let queue = DispatchQueue(label: "sim-capture.screen", qos: .userInteractive)

    private var ioClient: NSObject?
    private var descriptors: [NSObject] = []
    private var callbackUUIDs: [ObjectIdentifier: NSUUID] = [:]
    private var onFrame: (@Sendable (IOSurface) -> Void)?

    init(udid: String, host: any DeviceHost) {
        self.udid = udid
        self.host = host
    }

    private func resolveDevice() -> NSObject? {
        host.resolveDevice(udid: udid)
    }

    func start(onFrame: @escaping @Sendable (IOSurface) -> Void) throws {
        self.onFrame = onFrame

        guard let device = resolveDevice() else {
            throw SimulatorError.notFound(udid: udid)
        }
        guard let io = device.perform(NSSelectorFromString("io"))?
            .takeUnretainedValue() as? NSObject
        else {
            throw ScreenError.ioUnavailable
        }
        self.ioClient = io
        try wireFramebuffer()
    }

    func stop() {
        let unregSel = NSSelectorFromString("unregisterScreenCallbacksWithUUID:")
        for desc in descriptors {
            if let uuid = callbackUUIDs[ObjectIdentifier(desc)],
               desc.responds(to: unregSel) {
                desc.perform(unregSel, with: uuid)
            }
        }
        descriptors.removeAll()
        callbackUUIDs.removeAll()
        ioClient = nil
        onFrame = nil
    }

    // MARK: - private

    private func wireFramebuffer() throws {
        guard let io = ioClient else { throw ScreenError.ioUnavailable }

        // Lazy ports population.
        io.perform(NSSelectorFromString("updateIOPorts"))

        guard let ports = io.value(forKey: "deviceIOPorts") as? [NSObject] else {
            throw ScreenError.noFramebuffer
        }

        let pidSel = NSSelectorFromString("portIdentifier")
        let descSel = NSSelectorFromString("descriptor")
        let surfSel = NSSelectorFromString("framebufferSurface")

        var candidates: [NSObject] = []
        for port in ports where port.responds(to: pidSel) {
            guard let pid = port.perform(pidSel)?.takeUnretainedValue(),
                  "\(pid)" == "com.apple.framebuffer.display",
                  port.responds(to: descSel),
                  let desc = port.perform(descSel)?.takeUnretainedValue() as? NSObject,
                  desc.responds(to: surfSel)
            else { continue }
            candidates.append(desc)
        }
        guard !candidates.isEmpty else { throw ScreenError.noFramebuffer }
        descriptors = candidates

        for desc in candidates {
            try registerCallbacks(on: desc)
        }
    }

    private func registerCallbacks(on desc: NSObject) throws {
        let regSel = NSSelectorFromString(
            "registerScreenCallbacksWithUUID:callbackQueue:frameCallback:" +
                "surfacesChangedCallback:propertiesChangedCallback:"
        )
        guard desc.responds(to: regSel) else { throw ScreenError.callbackUnavailable }

        let uuid = NSUUID()
        callbackUUIDs[ObjectIdentifier(desc)] = uuid

        let frame: @convention(block) () -> Void = { [weak self] in
            self?.queue.async { self?.captureLatest() }
        }
        let surfaces: @convention(block) () -> Void = { [weak self] in
            self?.queue.async { self?.captureLatest() }
        }
        let props: @convention(block) () -> Void = {}

        guard let imp = class_getMethodImplementation(type(of: desc), regSel) else {
            throw ScreenError.callbackUnavailable
        }
        typealias Fn = @convention(c) (
            AnyObject, Selector, AnyObject, AnyObject, AnyObject, AnyObject, AnyObject
        ) -> Void
        unsafeBitCast(imp, to: Fn.self)(
            desc, regSel,
            uuid, queue as AnyObject,
            frame as AnyObject, surfaces as AnyObject, props as AnyObject
        )
    }

    /// Picks the descriptor whose live surface has the largest area —
    /// secondary planes / overlays are typically smaller than the main
    /// screen — and forwards the IOSurface to `onFrame`.
    private func captureLatest() {
        let surfSel = NSSelectorFromString("framebufferSurface")
        var best: IOSurface?
        var bestArea = 0
        for desc in descriptors {
            guard let surfObj = desc.perform(surfSel)?.takeUnretainedValue() else { continue }
            let surf = unsafeBitCast(surfObj, to: IOSurface.self)
            let area = IOSurfaceGetWidth(surf) * IOSurfaceGetHeight(surf)
            if area > bestArea {
                best = surf
                bestArea = area
            }
        }
        if let best { onFrame?(best) }
    }
}

// MARK: - CoreSimulatorHost (inlined production DeviceHost)

/// Minimal CoreSimulator host — opens SimulatorKit + CoreSimulator via
/// `dlopen`, resolves a `SimDevice` `NSObject` for a UDID via the default
/// device set.
final class CoreSimulatorHost: DeviceHost, @unchecked Sendable {
    init() {
        Self.loadFrameworks()
    }

    func resolveDevice(udid: String) -> NSObject? {
        guard let set = resolveSet() else { return nil }
        for device in availableDevices(in: set) {
            if (device.value(forKey: "UDID") as? NSUUID)?.uuidString == udid {
                return device
            }
        }
        return nil
    }

    // MARK: - private

    private func resolveSet() -> NSObject? {
        guard let ctx = sharedServiceContext() else { return nil }
        return defaultDeviceSet(context: ctx)
    }

    private func sharedServiceContext() -> NSObject? {
        guard let cls = NSClassFromString("SimServiceContext") else { return nil }
        let sel = NSSelectorFromString("sharedServiceContextForDeveloperDir:error:")
        var err: NSError?
        let ctx = invokeClassObjWithObjAndError(
            cls, sel, Self.developerDir() as NSString, &err
        )
        if ctx == nil, let err { logErr("sharedServiceContext: \(err)") }
        return ctx
    }

    private func defaultDeviceSet(context: NSObject) -> NSObject? {
        let sel = NSSelectorFromString("defaultDeviceSetWithError:")
        guard context.responds(to: sel) else { return nil }
        var err: NSError?
        return invokeObjWithError(context, sel, &err)
    }

    private func availableDevices(in set: NSObject) -> [NSObject] {
        (set.value(forKey: "availableDevices") as? [NSObject]) ?? []
    }

    // MARK: - framework loading

    nonisolated(unsafe) private static var loaded = false

    static func loadFrameworks() {
        guard !loaded else { return }
        loaded = true
        let dev = developerDir()
        let coreSim = "/Library/Developer/PrivateFrameworks/CoreSimulator.framework/CoreSimulator"
        let simKit = (dev as NSString)
            .appendingPathComponent("Library/PrivateFrameworks/SimulatorKit.framework/SimulatorKit")
        if dlopen(coreSim, RTLD_NOW | RTLD_GLOBAL) == nil {
            logErr("CoreSimulator load failed: \(dlerrorString())")
        }
        if dlopen(simKit, RTLD_NOW | RTLD_GLOBAL) == nil {
            logErr("SimulatorKit load failed: \(dlerrorString())")
        }
    }

    static func developerDir() -> String {
        if let dev = ProcessInfo.processInfo.environment["DEVELOPER_DIR"],
           hasSimulatorKit(at: dev) { return dev }
        if let dev = xcodeSelectDir(), hasSimulatorKit(at: dev) { return dev }
        let canonical = "/Applications/Xcode.app/Contents/Developer"
        if hasSimulatorKit(at: canonical) { return canonical }
        return xcodeSelectDir() ?? canonical
    }

    private static func xcodeSelectDir() -> String? {
        let pipe = Pipe()
        let task = Process()
        task.executableURL = URL(fileURLWithPath: "/usr/bin/xcode-select")
        task.arguments = ["-p"]
        task.standardOutput = pipe
        do { try task.run() } catch { return nil }
        task.waitUntilExit()
        let out = String(
            data: pipe.fileHandleForReading.readDataToEndOfFile(),
            encoding: .utf8
        )?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return out.isEmpty ? nil : out
    }

    private static func hasSimulatorKit(at developerDir: String) -> Bool {
        let path = (developerDir as NSString)
            .appendingPathComponent("Library/PrivateFrameworks/SimulatorKit.framework/SimulatorKit")
        return FileManager.default.fileExists(atPath: path)
    }
}

// MARK: - ObjC runtime helpers

func dlerrorString() -> String {
    guard let err = dlerror() else { return "(null)" }
    return String(cString: err)
}

func logErr(_ message: String) {
    fputs("[sim-capture-avcc] \(message)\n", stderr)
}

func invokeObjWithError(
    _ target: NSObject, _ sel: Selector, _ err: inout NSError?
) -> NSObject? {
    guard let imp = class_getMethodImplementation(type(of: target), sel) else { return nil }
    typealias Fn = @convention(c) (
        AnyObject, Selector, AutoreleasingUnsafeMutablePointer<NSError?>
    ) -> AnyObject?
    return unsafeBitCast(imp, to: Fn.self)(target, sel, &err) as? NSObject
}

func invokeClassObjWithObjAndError(
    _ cls: AnyClass, _ sel: Selector, _ arg: AnyObject, _ err: inout NSError?
) -> NSObject? {
    guard let metaCls = object_getClass(cls),
          let imp = class_getMethodImplementation(metaCls, sel)
    else { return nil }
    typealias Fn = @convention(c) (
        AnyClass, Selector, AnyObject, AutoreleasingUnsafeMutablePointer<NSError?>
    ) -> AnyObject?
    return unsafeBitCast(imp, to: Fn.self)(cls, sel, arg, &err) as? NSObject
}
