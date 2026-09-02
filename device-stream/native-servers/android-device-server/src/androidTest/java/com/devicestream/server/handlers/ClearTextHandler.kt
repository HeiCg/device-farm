package com.devicestream.server.handlers

import android.app.UiAutomation
import android.os.Bundle
import android.view.accessibility.AccessibilityNodeInfo
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import org.json.JSONObject

/**
 * Clears the currently focused editable text field. Invoked by the DSL's
 * `ElementHandle.clear()` after it taps the field to focus it. Crucially this
 * NEVER emits a hardware BACK key — the previous DSL clear() pressed BACK ~50×,
 * which on Android dismisses the IME and walks back out of the app (see spec B1).
 *
 * Prefers UiObject2.clear() on the focused node; falls back to the accessibility
 * ACTION_SET_TEXT("") path when no UiObject2 is resolvable.
 */
class ClearTextHandler(
    private val uiDevice: UiDevice,
    private val uiAutomation: UiAutomation
) {

    fun execute(params: JSONObject): JSONObject {
        val focused = uiDevice.findObject(By.focused(true))
        if (focused != null) {
            focused.clear()
            return JSONObject().apply { put("success", true) }
        }

        val node = uiAutomation.findFocus(AccessibilityNodeInfo.FOCUS_INPUT)
            ?: throw IllegalStateException("No focused element to clear")
        try {
            val args = Bundle().apply {
                putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, "")
            }
            val ok = node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)
            return JSONObject().apply { put("success", ok) }
        } finally {
            node.recycle()
        }
    }
}
