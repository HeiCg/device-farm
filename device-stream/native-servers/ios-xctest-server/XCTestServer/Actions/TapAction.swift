import Foundation
import XCTest

class TapAction {
    func execute(params: [String: Any]) throws -> [String: Any] {
        guard let x = params["x"] as? Double,
              let y = params["y"] as? Double else {
            throw NSError(domain: "XCTestServer", code: -1, userInfo: [NSLocalizedDescriptionKey: "Missing x or y"])
        }

        let app = XCUIApplication()
        let normalized = app.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0))
        let point = normalized.withOffset(CGVector(dx: x, dy: y))
        point.tap()

        return ["success": true]
    }
}
