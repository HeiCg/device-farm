import Foundation
import XCTest

class TypeAction {
    func execute(params: [String: Any]) throws -> [String: Any] {
        guard let text = params["text"] as? String else {
            throw NSError(domain: "XCTestServer", code: -1,
                          userInfo: [NSLocalizedDescriptionKey: "Missing text parameter"])
        }

        let app = XCUIApplication()

        // Find the focused element and type into it
        let focusedElement = app.descendants(matching: .any).matching(
            NSPredicate(format: "hasFocus == true")
        ).firstMatch

        if focusedElement.exists {
            focusedElement.typeText(text)
        } else {
            // Fallback: try to type into the first text field
            let textField = app.textFields.firstMatch
            if textField.exists {
                textField.tap()
                textField.typeText(text)
            } else {
                // Last resort: type into whatever is there
                app.typeText(text)
            }
        }

        return [
            "success": true,
            "charsTyped": text.count
        ]
    }
}
