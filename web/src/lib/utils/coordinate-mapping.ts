/**
 * Coordinate mapping utilities for the hierarchy inspector.
 *
 * These pure functions bridge the server's hierarchy data format and the
 * SVG overlay rendering. No scaling math is needed here — the SVG viewBox
 * matches the device's native resolution and SVG handles all scaling.
 */
import type { HierarchyNode } from '$lib/api/types.js';

/**
 * Flatten a hierarchy tree into a single-level array for iteration.
 *
 * Each node is included as-is (children property remains intact). The
 * flattening is only for enumeration — callers walk the flat list to
 * render every node regardless of tree depth.
 *
 * Uses depth-first traversal.
 */
export function flattenTree(nodes: HierarchyNode[]): HierarchyNode[] {
	const result: HierarchyNode[] = [];

	function walk(node: HierarchyNode): void {
		result.push(node);
		for (const child of node.children) {
			walk(child);
		}
	}

	for (const root of nodes) {
		walk(root);
	}

	return result;
}

/**
 * Convert server bounds `[left, top, right, bottom]` to SVG `<rect>` attrs.
 *
 * The SVG viewBox is set to the device's native resolution, so coordinates
 * map 1:1 — no additional scaling is needed.
 */
export function mapBoundsToSVG(
	bounds: [number, number, number, number]
): { x: number; y: number; width: number; height: number } {
	return {
		x: bounds[0],
		y: bounds[1],
		width: bounds[2] - bounds[0],
		height: bounds[3] - bounds[1]
	};
}
