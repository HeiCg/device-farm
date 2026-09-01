/**
 * Input schemas for the DSL-backed MCP tools.
 *
 * Uses the zod v3 subpath (like ../schemas.ts) to keep the SDK's registerTool
 * generic inference linear and avoid TS2589. These raw shapes map onto the
 * @device-stream/dsl Selector / verb arguments.
 */
import { z } from 'zod/v3';

/** Flexible string matcher: bare string (exact) or a constraint object. */
export const stringMatch = z.union([
  z.string(),
  z.object({
    equals: z.string().optional(),
    contains: z.string().optional(),
    regex: z.string().optional().describe('JavaScript regex source, e.g. "^item-\\\\d+$"'),
    caseInsensitive: z.boolean().optional(),
  }),
]);

/** A DSL selector. Mirrors @device-stream/dsl Selector (sans recursive containsDescendant). */
export const selector = z.object({
  id: stringMatch.optional(),
  text: stringMatch.optional(),
  contentDescription: stringMatch.optional(),
  className: stringMatch.optional(),
  packageName: stringMatch.optional(),
  index: z.number().int().min(0).optional(),
  enabled: z.boolean().optional(),
  visible: z.boolean().optional(),
});

export const scrollDirection = z.enum(['up', 'down', 'left', 'right']);

// Raw shapes (Record<string, ZodType>) for registerTool.
export const tapShape = { selector };
export const fillShape = { selector, text: z.string().describe('Text to type into the matched field') };
export const longPressShape = { selector, durationMs: z.number().int().min(1).optional() };
export const elementTextShape = { selector };
export const pressKeyShape = {
  key: z.enum(['back', 'home', 'enter', 'menu', 'volumeUp', 'volumeDown', 'power']),
};
export const swipeShape = {
  fromX: z.number(), fromY: z.number(), toX: z.number(), toY: z.number(),
  durationMs: z.number().int().min(1).optional(),
};
export const scrollShape = {
  direction: scrollDirection,
  distance: z.number().min(0).max(1).optional().describe('Fraction of screen the swipe spans (0–1, default 0.6)'),
  durationMs: z.number().int().min(1).optional(),
};
export const scrollUntilVisibleShape = {
  selector,
  direction: scrollDirection.optional(),
  maxScrolls: z.number().int().min(1).optional(),
};
export const waitForIdleShape = { timeoutMs: z.number().int().min(0).optional() };
export const emptyShape = {};
export const screenshotShape = {
  scale: z
    .number()
    .min(0.05)
    .max(1)
    .optional()
    .describe('Capture scale, 0.05–1 (default 0.25). Lower = smaller payload. Android downscales at capture; iOS returns full-res and is size-capped.'),
};
export const launchAppShape = { id: z.string().describe('Android package name or iOS bundle id') };
export const openUrlShape = { url: z.string() };
export const installAppShape = { path: z.string().describe('Path to APK (Android) or .app bundle (iOS sim)') };
export const grantPermissionsShape = {
  packageName: z.string(),
  permissions: z.union([z.array(z.string()), z.literal('*')]).optional(),
};
export const setLocationShape = { latitude: z.number(), longitude: z.number() };
export const runFlowShape = { flowYaml: z.string().describe('A device-stream flow in YAML (from FlowRecorder.finish + serializeFlow)') };
