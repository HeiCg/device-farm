import Foundation
import XCTest

/// Traverses XCUIElement tree, applies TreeCompressor, and serializes to IndexedElement JSON.
class TreeWalker {

    private let maxElements: Int

    init(maxElements: Int = 50) {
        self.maxElements = maxElements
    }

    func getTree(params: [String: Any]) throws -> [String: Any] {
        let maxElems = params["maxElements"] as? Int ?? maxElements

        let app = XCUIApplication()
        var elements = [[String: Any]]()

        traverse(element: app, elements: &elements, maxElements: maxElems)

        // Apply 1-based indexing
        for i in 0..<elements.count {
            elements[i]["index"] = i + 1
        }

        return ["tree": elements]
    }

    private static let contentContainerTypes: Set<XCUIElement.ElementType> = [
        .scrollView, .table, .collectionView, .cell
    ]

    private static let pureLayoutTypes: Set<XCUIElement.ElementType> = [
        .group, .other, .layoutArea
    ]

    private func traverse(element: XCUIElement, elements: inout [[String: Any]], maxElements: Int) {
        if elements.count >= maxElements { return }

        var shouldRecurse = true

        // Apply tree compression (skip the root app element)
        if element.elementType != .application {
            if TreeCompressor.shouldKeep(element) {
                elements.append(ElementSerializer.serialize(element))
            } else {
                // Early pruning: skip children of pure layout containers with no semantic content
                // But always recurse into scroll/table/collection/cell containers (may hold content)
                if TreeWalker.pureLayoutTypes.contains(element.elementType) &&
                   !TreeWalker.contentContainerTypes.contains(element.elementType) {
                    shouldRecurse = false
                }
            }
        }

        guard shouldRecurse else { return }

        // Recurse into children
        let children = element.children(matching: .any)
        let childCount = children.count

        for i in 0..<childCount {
            if elements.count >= maxElements { break }
            let child = children.element(boundBy: i)
            if child.exists {
                traverse(element: child, elements: &elements, maxElements: maxElements)
            }
        }
    }
}
