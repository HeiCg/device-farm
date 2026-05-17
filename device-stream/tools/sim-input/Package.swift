// swift-tools-version: 6.0

import PackageDescription

// Standalone Swift CLI ported from baguette's IndigoHIDInput +
// IOHIDDigitizerDispatch. SimulatorKit / CoreSimulator are NOT linked
// at build time — they are dlopen'd at runtime from the active Xcode's
// developer directory (resolved via `xcode-select -p` with a fallback
// scan of `/Applications/Xcode*.app`). Linking them statically would
// bake LC_LOAD_DYLIB entries that dyld must resolve before main(),
// which fails on hosts whose Xcode lives outside /Applications/Xcode.app.
let package = Package(
    name: "sim-input",
    platforms: [.macOS(.v15)],
    targets: [
        .executableTarget(
            name: "sim-input",
            path: "Sources/sim-input"
        )
    ]
)
