// swift-tools-version:6.0
import PackageDescription

let package = Package(
    name: "sim-cam",
    platforms: [
        .macOS(.v15)
    ],
    targets: [
        .executableTarget(
            name: "sim-cam",
            path: "Sources/sim-cam",
            linkerSettings: [
                .linkedFramework("AVFoundation"),
                .linkedFramework("CoreMedia"),
                .linkedFramework("CoreVideo"),
                .linkedFramework("Foundation")
            ]
        )
    ]
)
