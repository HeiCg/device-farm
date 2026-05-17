import Foundation
import XCTest

class SwipeAction {
    func execute(params: [String: Any]) throws -> [String: Any] {
        guard let startX = params["startX"] as? Double,
              let startY = params["startY"] as? Double,
              let endX = params["endX"] as? Double,
              let endY = params["endY"] as? Double else {
            throw NSError(domain: "XCTestServer", code: -1,
                          userInfo: [NSLocalizedDescriptionKey: "Missing startX, startY, endX, or endY"])
        }

        let durationMs = params["durationMs"] as? Double ?? 300.0
        let duration = durationMs / 1000.0

        let app = XCUIApplication()
        let normalized = app.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0))
        let startPoint = normalized.withOffset(CGVector(dx: startX, dy: startY))
        let endPoint = normalized.withOffset(CGVector(dx: endX, dy: endY))

        startPoint.press(forDuration: 0.05, thenDragTo: endPoint, withVelocity: .default, thenHoldForDuration: duration)

        return ["success": true]
    }
}
