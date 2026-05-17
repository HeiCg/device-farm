import Foundation
import XCTest

class TerminateAppAction {
    func execute(params: [String: Any]) throws -> [String: Any] {
        guard let bundleId = params["bundleId"] as? String else {
            throw NSError(domain: "XCTestServer", code: -1,
                          userInfo: [NSLocalizedDescriptionKey: "Missing bundleId parameter"])
        }

        let app = XCUIApplication(bundleIdentifier: bundleId)
        app.terminate()

        return ["success": true]
    }
}
