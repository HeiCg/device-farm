import Foundation
import XCTest

/// Screen size, keyboard visibility, and current app information.
class ScreenInfo {

    func getScreenSize() throws -> [String: Any] {
        let screen = XCUIScreen.main
        let size = screen.screenshot().image.size
        return [
            "width": Int(size.width),
            "height": Int(size.height)
        ]
    }

    func getKeyboardVisibility() throws -> [String: Any] {
        let app = XCUIApplication()
        let keyboards = app.keyboards
        let visible = keyboards.count > 0 && keyboards.firstMatch.exists
        return ["visible": visible]
    }

    func getCurrentApp() throws -> [String: Any] {
        // XCTest doesn't directly expose the foreground app bundle ID.
        // We use the springboard to find the active app.
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let statusBar = springboard.statusBars.firstMatch

        return [
            "bundleId": "",
            "viewController": statusBar.exists ? "active" : "unknown"
        ]
    }
}
