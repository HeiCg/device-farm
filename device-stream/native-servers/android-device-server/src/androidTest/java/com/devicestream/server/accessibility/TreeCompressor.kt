package com.devicestream.server.accessibility

import android.view.accessibility.AccessibilityNodeInfo

/**
 * Removes empty container nodes that add no semantic value.
 * Mirrors the TypeScript compressElements() logic in state-manager.ts.
 */
object TreeCompressor {

    private val CONTAINER_TYPES = setOf(
        "FrameLayout",
        "LinearLayout",
        "RelativeLayout",
        "ConstraintLayout",
        "ViewGroup",
        "CoordinatorLayout",
        "AppBarLayout",
        "CollapsingToolbarLayout",
        "NestedScrollView",
        "CardView",
        "MaterialCardView"
    )

    // Pure layout containers whose subtrees can be skipped when empty
    private val SKIPPABLE_CONTAINERS = setOf(
        "FrameLayout",
        "LinearLayout",
        "RelativeLayout",
        "ConstraintLayout",
        "ViewGroup"
    )

    /**
     * Returns true if this node should be kept in the compressed tree.
     */
    fun shouldKeep(node: AccessibilityNodeInfo): Boolean {
        // Always keep interactive elements
        if (node.isClickable || node.isScrollable || node.isFocused ||
            node.isCheckable || node.isLongClickable) {
            return true
        }

        // Check if it's an empty container
        val className = node.className?.toString() ?: return true
        val shortName = className.substringAfterLast('.')

        if (shortName in CONTAINER_TYPES) {
            val hasText = !node.text.isNullOrEmpty()
            val hasContentDesc = !node.contentDescription.isNullOrEmpty()
            val hasResourceId = !node.viewIdResourceName.isNullOrEmpty()

            if (!hasText && !hasContentDesc && !hasResourceId) {
                return false
            }
        }

        return true
    }

    /**
     * Returns true if this node's entire subtree can be skipped.
     * Only applies to empty pure layout containers (not ScrollView, CardView, etc.)
     */
    fun shouldSkipSubtree(node: AccessibilityNodeInfo): Boolean {
        val className = node.className?.toString() ?: return false
        val shortName = className.substringAfterLast('.')

        if (shortName !in SKIPPABLE_CONTAINERS) return false

        val hasText = !node.text.isNullOrEmpty()
        val hasContentDesc = !node.contentDescription.isNullOrEmpty()
        val hasResourceId = !node.viewIdResourceName.isNullOrEmpty()

        return !hasText && !hasContentDesc && !hasResourceId
    }
}
