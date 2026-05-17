// Ported from baguette (Apache-2.0). Upstream: https://github.com/tddworks/baguette
// Original: Sources/Baguette/Infrastructure/Stream/SeedFilter.swift

import Foundation
import IOSurface

/// "Did the pixels actually change since I last asked?" — a one-property
/// value that compares `IOSurfaceGetSeed` against the previous answer.
/// Composed into each stream so an idle simulator stops the wire.
struct SeedFilter {
    private var last: UInt32 = 0

    mutating func shouldEmit(_ surface: IOSurface) -> Bool {
        var seed: UInt32 = 0
        surface.lock(options: .readOnly, seed: &seed)
        surface.unlock(options: .readOnly, seed: nil)
        guard seed != last else { return false }
        last = seed
        return true
    }
}
