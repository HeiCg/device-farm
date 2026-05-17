// swift-tools-version:6.0
import PackageDescription

let xcodePrivateFrameworks =
    "/Applications/Xcode.app/Contents/Developer/Library/PrivateFrameworks"
let systemPrivateFrameworks =
    "/Library/Developer/PrivateFrameworks"

let package = Package(
    name: "sim-capture-avcc",
    platforms: [
        .macOS(.v15)
    ],
    targets: [
        .executableTarget(
            name: "sim-capture-avcc",
            path: "Sources/sim-capture-avcc",
            swiftSettings: [
                .swiftLanguageMode(.v5),
                .unsafeFlags([
                    "-F", xcodePrivateFrameworks
                ])
            ],
            linkerSettings: [
                .linkedFramework("VideoToolbox"),
                .linkedFramework("CoreVideo"),
                .linkedFramework("CoreMedia"),
                .linkedFramework("CoreGraphics"),
                .linkedFramework("ImageIO"),
                .linkedFramework("IOSurface"),
                .linkedFramework("ScreenCaptureKit"),
                .unsafeFlags([
                    "-F", xcodePrivateFrameworks,
                    "-F", systemPrivateFrameworks,
                    "-framework", "SimulatorKit",
                    "-framework", "CoreSimulator",
                    "-Xlinker", "-rpath",
                    "-Xlinker", xcodePrivateFrameworks,
                    "-Xlinker", "-rpath",
                    "-Xlinker", systemPrivateFrameworks
                ])
            ]
        )
    ]
)
