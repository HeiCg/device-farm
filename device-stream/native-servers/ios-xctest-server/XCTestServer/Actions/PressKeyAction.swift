import Foundation
import XCTest

class PressKeyAction {
    func execute(params: [String: Any]) throws -> [String: Any] {
        guard let key = params["key"] as? String else {
            throw NSError(domain: "XCTestServer", code: -1,
                          userInfo: [NSLocalizedDescriptionKey: "Missing key parameter"])
        }

        let app = XCUIApplication()

        switch key.lowercased() {
        case "enter", "return":
            app.typeText("\n")
        case "delete", "backspace":
            app.typeText(XCUIKeyboardKey.delete.rawValue)
        case "tab":
            app.typeText("\t")
        case "escape":
            app.typeText(XCUIKeyboardKey.escape.rawValue)
        case "space":
            app.typeText(" ")
        case "home":
            XCUIDevice.shared.press(.home)
        case "volume_up":
            XCUIDevice.shared.press(.volumeUp)
        case "volume_down":
            XCUIDevice.shared.press(.volumeDown)
        default:
            // Try typing the key as a character
            app.typeText(key)
        }

        return ["success": true]
    }
}
