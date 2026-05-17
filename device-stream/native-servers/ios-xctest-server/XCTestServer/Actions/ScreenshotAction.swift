import Foundation
import XCTest

class ScreenshotAction {
    func execute(params: [String: Any]) throws -> [String: Any] {
        let quality = params["quality"] as? Double ?? 0.8
        let scale = params["scale"] as? Double ?? 1.0

        let screenshot = XCUIScreen.main.screenshot()
        var image = screenshot.image

        // Scale if needed
        if scale < 1.0 {
            let newSize = CGSize(width: image.size.width * scale, height: image.size.height * scale)
            UIGraphicsBeginImageContextWithOptions(newSize, false, 1.0)
            image.draw(in: CGRect(origin: .zero, size: newSize))
            image = UIGraphicsGetImageFromCurrentImageContext() ?? image
            UIGraphicsEndImageContext()
        }

        // Use JPEG (much smaller than PNG)
        guard let jpegData = image.jpegData(compressionQuality: quality) else {
            throw NSError(domain: "ScreenshotAction", code: -1, userInfo: [NSLocalizedDescriptionKey: "Failed to encode JPEG"])
        }

        let base64 = jpegData.base64EncodedString()
        return ["data": base64, "format": "jpeg", "size": jpegData.count]
    }
}
