// Ported from baguette (Apache-2.0). Upstream: https://github.com/tddworks/baguette
// Original: Sources/Baguette/Infrastructure/Camera/AVCameras.swift

import Foundation
import AVFoundation

/// Camera enumeration backed by `AVCaptureDevice.DiscoverySession`.
enum AVCameras {

    struct Entry: Codable {
        let uid: String
        let name: String
        let modelID: String
        let localizedName: String
    }

    static func available() -> [Entry] {
        // Include built-in (FaceTime) and external (USB / Continuity).
        let types: [AVCaptureDevice.DeviceType] = [
            .builtInWideAngleCamera,
            .external,
        ]
        let session = AVCaptureDevice.DiscoverySession(
            deviceTypes: types,
            mediaType: .video,
            position: .unspecified
        )
        return session.devices.map { dev in
            Entry(
                uid: dev.uniqueID,
                name: dev.localizedName,
                modelID: dev.modelID,
                localizedName: dev.localizedName
            )
        }
    }

    static func listJSON() throws -> String {
        let entries = available()
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        let data = try encoder.encode(entries)
        return String(data: data, encoding: .utf8) ?? "[]"
    }
}
