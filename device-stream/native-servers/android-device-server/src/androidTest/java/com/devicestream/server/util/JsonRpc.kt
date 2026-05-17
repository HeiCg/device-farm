package com.devicestream.server.util

import org.json.JSONObject

/**
 * JSON-RPC 2.0 response helpers.
 * Mirrors the iOS JsonRpc utility.
 */
object JsonRpc {

    fun successResponse(id: Any?, result: Any): String {
        val response = JSONObject().apply {
            put("jsonrpc", "2.0")
            put("result", result)
            put("id", id)
        }
        return response.toString()
    }

    fun errorResponse(id: Any?, code: Int, message: String): String {
        val error = JSONObject().apply {
            put("code", code)
            put("message", message)
        }
        val response = JSONObject().apply {
            put("jsonrpc", "2.0")
            put("error", error)
            put("id", id)
        }
        return response.toString()
    }
}
