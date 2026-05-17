import Foundation
import XCTest

/// Removes empty container nodes that add no semantic value.
/// Mirrors the TypeScript compressElements() logic in state-manager.ts.
enum TreeCompressor {

    private static let containerTypes: Set<XCUIElement.ElementType> = [
        .other,
        .group,
        .scrollView,
        .cell,
        .layoutArea
    ]

    /// Returns true if this element should be kept in the compressed tree.
    static func shouldKeep(_ element: XCUIElement) -> Bool {
        // Always keep interactive elements
        if element.isEnabled && (
            element.elementType == .button ||
            element.elementType == .link ||
            element.elementType == .textField ||
            element.elementType == .secureTextField ||
            element.elementType == .switch ||
            element.elementType == .slider ||
            element.elementType == .stepper ||
            element.elementType == .picker ||
            element.elementType == .toggle
        ) {
            return true
        }

        // Always keep elements with meaningful content
        let hasLabel = !element.label.isEmpty
        let hasIdentifier = !element.identifier.isEmpty
        let hasValue = element.value != nil && "\(element.value!)" != ""

        if hasLabel || hasIdentifier || hasValue {
            return true
        }

        // Remove empty containers
        if containerTypes.contains(element.elementType) {
            return false
        }

        return true
    }
}
