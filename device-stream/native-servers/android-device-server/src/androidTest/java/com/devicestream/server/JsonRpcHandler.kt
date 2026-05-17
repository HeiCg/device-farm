package com.devicestream.server

import android.app.Instrumentation
import android.app.UiAutomation
import android.util.Log
import androidx.test.uiautomator.UiDevice
import com.devicestream.server.handlers.*
import com.devicestream.server.util.JsonRpc
import org.json.JSONArray
import org.json.JSONObject

/**
 * Parses JSON-RPC 2.0 requests, dispatches to action handlers, and returns JSON-RPC responses.
 * Mirrors the iOS JsonRpcHandler pattern exactly.
 */
class JsonRpcHandler(
    uiDevice: UiDevice,
    uiAutomation: UiAutomation,
    instrumentation: Instrumentation
) {
    companion object {
        private const val TAG = "JsonRpcHandler"
    }

    private val tapHandler = TapHandler(uiDevice)
    private val swipeHandler = SwipeHandler(uiDevice)
    private val typeHandler = TypeHandler(instrumentation, uiDevice)
    private val longPressHandler = LongPressHandler(uiDevice)
    private val keyHandler = KeyHandler(uiDevice)
    private val screenshotHandler = ScreenshotHandler(uiAutomation)
    private val hierarchyHandler = HierarchyHandler(uiAutomation)
    private val infoHandler = InfoHandler(uiDevice, uiAutomation)
    private val stateHandler = StateHandler(uiDevice, uiAutomation)
    private val waitHandler = WaitHandler(uiDevice)
    private val openAppHandler = OpenAppHandler(instrumentation)

    fun handle(line: String): String {
        val json: JSONObject
        val method: String
        try {
            json = JSONObject(line)
            method = json.getString("method")
        } catch (e: Exception) {
            return JsonRpc.errorResponse(null, -32700, "Parse error")
        }

        val id = json.opt("id")
        val params = json.optJSONObject("params") ?: JSONObject()

        Log.d(TAG, "method=$method id=$id")

        return try {
            val result: Any = when (method) {
                "tap" -> tapHandler.execute(params)
                "longPress" -> longPressHandler.execute(params)
                "swipe" -> swipeHandler.execute(params)
                "typeText" -> typeHandler.execute(params)
                "key" -> keyHandler.execute(params)
                "screenshot" -> screenshotHandler.execute(params)
                "getAccessibilityTree" -> hierarchyHandler.execute(params)
                "getInfo" -> infoHandler.execute()
                "getState" -> stateHandler.execute(params)
                "waitForIdle" -> waitHandler.execute(params)
                "launchApp" -> openAppHandler.execute(params)
                "ping" -> JSONObject().apply { put("status", "ok") }
                "batch" -> executeBatch(params)
                else -> return JsonRpc.errorResponse(id, -32601, "Method not found: $method")
            }
            JsonRpc.successResponse(id, result)
        } catch (e: Exception) {
            Log.e(TAG, "Error executing $method", e)
            JsonRpc.errorResponse(id, -32603, e.message ?: "Internal error")
        }
    }

    private fun executeBatch(params: JSONObject): JSONObject {
        val actions = params.optJSONArray("actions")
            ?: throw IllegalArgumentException("Missing 'actions' array")

        val results = JSONArray()
        for (i in 0 until actions.length()) {
            val action = actions.getJSONObject(i)
            val method = action.getString("method")
            val actionParams = action.optJSONObject("params") ?: JSONObject()

            val request = JSONObject().apply {
                put("jsonrpc", "2.0")
                put("method", method)
                put("params", actionParams)
                put("id", 0)
            }

            val responseStr = handle(request.toString())
            try {
                val responseJson = JSONObject(responseStr)
                if (responseJson.has("result")) {
                    results.put(responseJson.get("result"))
                } else if (responseJson.has("error")) {
                    results.put(JSONObject().apply { put("error", responseJson.get("error")) })
                }
            } catch (_: Exception) {
                results.put(JSONObject().apply { put("error", "Failed to parse response") })
            }
        }
        return JSONObject().apply { put("results", results) }
    }
}
