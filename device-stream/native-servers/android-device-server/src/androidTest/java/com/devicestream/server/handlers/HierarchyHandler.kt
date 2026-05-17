package com.devicestream.server.handlers

import android.app.UiAutomation
import com.devicestream.server.accessibility.NodeSerializer
import org.json.JSONObject

class HierarchyHandler(private val uiAutomation: UiAutomation) {

    fun execute(params: JSONObject): JSONObject {
        val maxElements = params.optInt("maxElements", 50)

        val rootNode = uiAutomation.rootInActiveWindow
            ?: throw RuntimeException("No active window")

        try {
            val elements = NodeSerializer.serialize(rootNode, maxElements)
            return JSONObject().apply { put("tree", elements) }
        } finally {
            rootNode.recycle()
        }
    }
}
