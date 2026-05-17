import Foundation
import XCTest

/// Converts XCUIElement to IndexedElement JSON format compatible with TypeScript.
enum ElementSerializer {

    static func serialize(_ element: XCUIElement) -> [String: Any] {
        let frame = element.frame

        return [
            "index": 0, // Set later by TreeWalker
            "className": elementTypeName(element.elementType),
            "resourceId": element.identifier,
            "text": element.label,
            "contentDesc": element.accessibilityLabel ?? element.label,
            "bounds": [
                "x1": Int(frame.minX),
                "y1": Int(frame.minY),
                "x2": Int(frame.maxX),
                "y2": Int(frame.maxY)
            ],
            "clickable": element.isHittable,
            "scrollable": element.elementType == .scrollView || element.elementType == .table || element.elementType == .collectionView,
            "focused": element.hasFocus,
            "enabled": element.isEnabled,
            "selected": element.isSelected
        ]
    }

    static func elementTypeName(_ type: XCUIElement.ElementType) -> String {
        switch type {
        case .button: return "Button"
        case .staticText: return "StaticText"
        case .textField: return "TextField"
        case .secureTextField: return "SecureTextField"
        case .image: return "Image"
        case .switch: return "Switch"
        case .slider: return "Slider"
        case .picker: return "Picker"
        case .scrollView: return "ScrollView"
        case .table: return "Table"
        case .cell: return "Cell"
        case .collectionView: return "CollectionView"
        case .navigationBar: return "NavigationBar"
        case .tabBar: return "TabBar"
        case .toolbar: return "Toolbar"
        case .link: return "Link"
        case .alert: return "Alert"
        case .sheet: return "Sheet"
        case .dialog: return "Dialog"
        case .window: return "Window"
        case .webView: return "WebView"
        case .toggle: return "Toggle"
        case .searchField: return "SearchField"
        case .segmentedControl: return "SegmentedControl"
        case .stepper: return "Stepper"
        case .other: return "Other"
        case .group: return "Group"
        case .layoutArea: return "LayoutArea"
        case .pageIndicator: return "PageIndicator"
        case .activityIndicator: return "ActivityIndicator"
        case .progressIndicator: return "ProgressIndicator"
        default: return "Unknown"
        }
    }
}
