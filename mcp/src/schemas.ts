/**
 * Tool input schemas — Phase 34 Plan 34-05.
 *
 * MCP `inputSchema` expects a ZodRawShape (Record<string, ZodType>), NOT a
 * wrapped `z.object`. Each export below is the raw shape; the SDK lifts these
 * into JSON Schema for `tools/list`.
 *
 * Shapes mirror `server/sessions/schemas.ts` (REST) and
 * `server/sessions/internal/protocol.ts` (WS envelopes). Source-of-truth
 * duplication is acceptable because the mcp package ships independently of
 * the server.
 */
// Use the zod v3 subpath explicitly. The MCP SDK's `registerTool` generic
// inference (ZodRawShapeCompat) supports both v3 and v4 via separate branches,
// and feeding it mixed-version raw shapes causes TS2589 "type instantiation
// is excessively deep" errors. Pinning to v3 here keeps the inference linear.
// (zod's top-level `import { z } from 'zod'` resolves to v4 in zod >=3.25.)
import { z } from 'zod/v3';

// ── REST tool shapes ──────────────────────────────────────────────────

export const leaseInputShape = {
  platform: z.enum(['android', 'ios']).describe('Platform to lease an emulator/simulator on'),
  ttlSeconds: z.number().int().min(60).max(3600).optional().describe('Lease TTL in seconds (60–3600). Defaults to 600 server-side.'),
  deviceQuery: z
    .object({
      deviceId: z.string().uuid().optional(),
      name: z.string().optional(),
    })
    .optional()
    .describe('Optional filter narrowing which device to lease.'),
  metadata: z.record(z.string(), z.unknown()).optional().describe('Free-form metadata persisted with the session row.'),
};

export const releaseInputShape = {
  sessionId: z.string().uuid().describe('Session id returned by device_lease'),
};

export const listInputShape = {};

// ── WS action tool shapes (all action tools take sessionId) ──────────

export const tapInputShape = {
  sessionId: z.string().uuid(),
  x: z.number().int().nonnegative().describe('Horizontal pixel coordinate (origin top-left)'),
  y: z.number().int().nonnegative().describe('Vertical pixel coordinate (origin top-left)'),
};

export const tapByDescriptionInputShape = {
  sessionId: z.string().uuid(),
  target: z.string().min(1).max(500).describe('Natural-language description of the UI element to tap (e.g., "Sign In button")'),
};

export const typeInputShape = {
  sessionId: z.string().uuid(),
  text: z.string().max(4096).describe('Text to type into the currently-focused input. Max 4096 chars.'),
};

export const swipeInputShape = {
  sessionId: z.string().uuid(),
  x1: z.number().int().nonnegative(),
  y1: z.number().int().nonnegative(),
  x2: z.number().int().nonnegative(),
  y2: z.number().int().nonnegative(),
  durationMs: z.number().int().min(50).max(5000).optional().describe('Swipe duration in ms (50–5000). Defaults to 500 server-side.'),
};

export const keyInputShape = {
  sessionId: z.string().uuid(),
  code: z.enum(['home', 'back', 'enter', 'volup', 'voldown', 'power', 'menu', 'recent']).describe('Physical key to press'),
};

export const screenshotInputShape = {
  sessionId: z.string().uuid(),
};

export const installInputShape = {
  sessionId: z.string().uuid(),
  artifactId: z.string().uuid().describe('Artifact id of an uploaded APK/IPA'),
};

export const launchInputShape = {
  sessionId: z.string().uuid(),
  bundleId: z.string().min(1).describe('Bundle id (iOS) or package id (Android)'),
};

export const uninstallInputShape = {
  sessionId: z.string().uuid(),
  bundleId: z.string().min(1).describe('Bundle id (iOS) or package id (Android) to uninstall'),
};
