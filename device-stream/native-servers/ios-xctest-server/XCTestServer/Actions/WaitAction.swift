import Foundation
import XCTest

class WaitAction {
    func execute(params: [String: Any]) throws -> [String: Any] {
        let durationMs = params["durationMs"] as? Double ?? 1000.0
        let duration = durationMs / 1000.0

        Thread.sleep(forTimeInterval: duration)

        return ["success": true]
    }
}
