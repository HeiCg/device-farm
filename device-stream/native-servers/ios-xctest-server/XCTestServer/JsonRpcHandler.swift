import Foundation
import XCTest

/// Parses JSON-RPC 2.0 requests, dispatches to action handlers, and returns JSON-RPC responses.
class JsonRpcHandler {

    private let tapAction = TapAction()
    private let swipeAction = SwipeAction()
    private let typeAction = TypeAction()
    private let longPressAction = LongPressAction()
    private let pressKeyAction = PressKeyAction()
    private let screenshotAction = ScreenshotAction()
    private let launchAppAction = LaunchAppAction()
    private let terminateAppAction = TerminateAppAction()
    private let waitAction = WaitAction()
    private let treeWalker = TreeWalker()
    private let screenInfo = ScreenInfo()

    /// Combined state capture: screenshot + accessibility tree + app info + keyboard in one call.
    private func executeGetState(params: [String: Any]) throws -> [String: Any] {
        let startTime = CFAbsoluteTimeGetCurrent()

        let screenshotResult = try screenshotAction.execute(params: params)
        let treeResult = try treeWalker.getTree(params: params)
        let appResult = try screenInfo.getCurrentApp()
        let keyboardResult = try screenInfo.getKeyboardVisibility()

        let captureMs = (CFAbsoluteTimeGetCurrent() - startTime) * 1000

        return [
            "screenshot": screenshotResult["data"] as Any,
            "tree": treeResult["tree"] as Any,
            "app": appResult,
            "keyboardVisible": keyboardResult["visible"] as Any,
            "captureMs": Int(captureMs)
        ]
    }

    /// Execute multiple actions sequentially in a single RPC call.
    private func executeBatch(params: [String: Any]) throws -> [String: Any] {
        guard let actions = params["actions"] as? [[String: Any]] else {
            throw NSError(domain: "JsonRpcHandler", code: -1, userInfo: [NSLocalizedDescriptionKey: "Missing 'actions' array"])
        }

        var results = [Any]()
        for action in actions {
            guard let method = action["method"] as? String else {
                results.append(["error": "Missing method"])
                continue
            }
            let actionParams = action["params"] as? [String: Any] ?? [:]
            let request: [String: Any] = [
                "jsonrpc": "2.0",
                "method": method,
                "params": actionParams,
                "id": 0
            ]
            guard let requestData = try? JSONSerialization.data(withJSONObject: request),
                  let requestStr = String(data: requestData, encoding: .utf8) else {
                results.append(["error": "Failed to serialize action"])
                continue
            }
            let responseStr = handle(requestStr)
            if let responseData = responseStr.data(using: .utf8),
               let responseJson = try? JSONSerialization.jsonObject(with: responseData) as? [String: Any] {
                if let resultVal = responseJson["result"] {
                    results.append(resultVal)
                } else if let errorVal = responseJson["error"] {
                    results.append(["error": errorVal])
                }
            }
        }
        return ["results": results]
    }

    func handle(_ line: String) -> String {
        guard let data = line.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let method = json["method"] as? String else {
            return JsonRpc.errorResponse(id: nil, code: -32700, message: "Parse error")
        }

        let id = json["id"]
        let params = json["params"] as? [String: Any] ?? [:]

        NSLog("[JsonRpc] method=\(method) id=\(String(describing: id))")

        do {
            let result: Any
            switch method {
            case "tap":
                result = try tapAction.execute(params: params)
            case "longPress":
                result = try longPressAction.execute(params: params)
            case "swipe":
                result = try swipeAction.execute(params: params)
            case "typeText":
                result = try typeAction.execute(params: params)
            case "pressKey":
                result = try pressKeyAction.execute(params: params)
            case "screenshot":
                result = try screenshotAction.execute(params: params)
            case "getAccessibilityTree":
                result = try treeWalker.getTree(params: params)
            case "getCurrentApp":
                result = try screenInfo.getCurrentApp()
            case "isKeyboardVisible":
                result = try screenInfo.getKeyboardVisibility()
            case "getScreenSize":
                result = try screenInfo.getScreenSize()
            case "launchApp":
                result = try launchAppAction.execute(params: params)
            case "terminateApp":
                result = try terminateAppAction.execute(params: params)
            case "wait":
                result = try waitAction.execute(params: params)
            case "getState":
                result = try executeGetState(params: params)
            case "batch":
                result = try executeBatch(params: params)
            default:
                return JsonRpc.errorResponse(id: id, code: -32601, message: "Method not found: \(method)")
            }
            return JsonRpc.successResponse(id: id, result: result)
        } catch {
            return JsonRpc.errorResponse(id: id, code: -32603, message: error.localizedDescription)
        }
    }
}
