import Foundation

/// JSON-RPC 2.0 types and serialization helpers.
enum JsonRpc {

    static func successResponse(id: Any?, result: Any) -> String {
        var response: [String: Any] = [
            "jsonrpc": "2.0",
            "result": result
        ]
        if let id = id {
            response["id"] = id
        }
        return serialize(response)
    }

    static func errorResponse(id: Any?, code: Int, message: String) -> String {
        var response: [String: Any] = [
            "jsonrpc": "2.0",
            "error": [
                "code": code,
                "message": message
            ] as [String: Any]
        ]
        if let id = id {
            response["id"] = id
        }
        return serialize(response)
    }

    private static func serialize(_ dict: [String: Any]) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: dict, options: []),
              let str = String(data: data, encoding: .utf8) else {
            return #"{"jsonrpc":"2.0","error":{"code":-32603,"message":"Serialization error"}}"#
        }
        return str
    }
}
