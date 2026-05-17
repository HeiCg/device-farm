/**
 * Sessions WS protocol schemas — Phase 34 Plan 34-02 FULL BODY.
 *
 * Replaces the Plan 34-00 ping/pong stub with the full discriminated unions
 * for client → server and server → client envelopes.
 *
 * Client envelopes (11 variants, all carry `id: uuid` for ack-echo):
 *   - tap, tapByDescription, type, swipe, key, screenshot, screenRecord,
 *     installApp, launchApp, uninstallApp, ping
 *
 * Server envelopes (4 variants):
 *   - ack   (forMsgId echo, durationMs, optional result)
 *   - error (optional forMsgId, code enum, message)
 *   - event (kind enum, optional data) — server-initiated, NO forMsgId
 *   - pong  (forMsgId echo)
 *
 * Schemas verbatim from 34-RESEARCH.md §WS Protocol (lines 248-309).
 *
 * Anti-patterns avoided:
 *   - NO `metadata` event kind (Phase 35 introduces metadata streaming).
 *   - NO `target` coords mixed with x/y (revyl-style 2-action stays separate).
 */
import { z } from 'zod';

// ---------- Shared bases ----------

/** Every client envelope carries an `id: uuid` so the server can echo it. */
const clientBase = z.object({ id: z.string().uuid() });

/** Key codes for the `key` envelope (RESEARCH §Action Dispatch — 8 codes). */
export const KEY_CODES = ['home', 'back', 'enter', 'volup', 'voldown', 'power', 'menu', 'recent'] as const;
export type KeyCode = typeof KEY_CODES[number];

// ---------- Client envelope (11 variants) ----------

export const clientEnvelope = z.discriminatedUnion('type', [
  // 1. tap — coordinate tap on the device
  clientBase.extend({
    type: z.literal('tap'),
    x: z.number().int().nonnegative(),
    y: z.number().int().nonnegative(),
  }),

  // 2. tapByDescription — NL-resolver-driven tap (resolver lands in 34-03)
  clientBase.extend({
    type: z.literal('tapByDescription'),
    target: z.string().min(1).max(500),
  }),

  // 3. type — type a string (max 4096 chars)
  clientBase.extend({
    type: z.literal('type'),
    text: z.string().max(4096),
  }),

  // 4. swipe — directional swipe with default 500ms duration
  clientBase.extend({
    type: z.literal('swipe'),
    x1: z.number().int().nonnegative(),
    y1: z.number().int().nonnegative(),
    x2: z.number().int().nonnegative(),
    y2: z.number().int().nonnegative(),
    durationMs: z.number().int().min(50).max(5000).default(500),
  }),

  // 5. key — physical key press (home/back/enter/etc.)
  clientBase.extend({
    type: z.literal('key'),
    code: z.enum(KEY_CODES),
  }),

  // 6. screenshot — capture a screenshot, returns {artifactId, url, width, height}
  clientBase.extend({
    type: z.literal('screenshot'),
  }),

  // 7. screenRecord — start/stop recording (boolean start flag)
  clientBase.extend({
    type: z.literal('screenRecord'),
    start: z.boolean(),
  }),

  // 8. installApp — install an APK/IPA by artifact id
  clientBase.extend({
    type: z.literal('installApp'),
    artifactId: z.string().uuid(),
  }),

  // 9. launchApp — launch by bundle id / package id
  clientBase.extend({
    type: z.literal('launchApp'),
    bundleId: z.string().min(1),
  }),

  // 10. uninstallApp — uninstall by bundle id / package id
  clientBase.extend({
    type: z.literal('uninstallApp'),
    bundleId: z.string().min(1),
  }),

  // 11. ping — heartbeat probe; server replies with pong
  clientBase.extend({
    type: z.literal('ping'),
  }),
]);

export type ClientEnvelope = z.infer<typeof clientEnvelope>;

// Discriminated payload helpers — narrow each variant type for downstream consumers.
export type TapEnvelope = Extract<ClientEnvelope, { type: 'tap' }>;
export type TapByDescriptionEnvelope = Extract<ClientEnvelope, { type: 'tapByDescription' }>;
export type TypeEnvelope = Extract<ClientEnvelope, { type: 'type' }>;
export type SwipeEnvelope = Extract<ClientEnvelope, { type: 'swipe' }>;
export type KeyEnvelope = Extract<ClientEnvelope, { type: 'key' }>;
export type ScreenshotEnvelope = Extract<ClientEnvelope, { type: 'screenshot' }>;
export type ScreenRecordEnvelope = Extract<ClientEnvelope, { type: 'screenRecord' }>;
export type InstallAppEnvelope = Extract<ClientEnvelope, { type: 'installApp' }>;
export type LaunchAppEnvelope = Extract<ClientEnvelope, { type: 'launchApp' }>;
export type UninstallAppEnvelope = Extract<ClientEnvelope, { type: 'uninstallApp' }>;
export type PingEnvelope = Extract<ClientEnvelope, { type: 'ping' }>;

// ---------- Server envelope (4 variants) ----------

/** Error codes the server may emit (per RESEARCH §Error Codes). */
export const ERROR_CODES = [
  'rate_limited',
  'invalid_envelope',
  'session_expired',
  'session_not_found',
  'resolver_failed',
  'device_error',
  'unauthorized',
  'invalid_state',
] as const;
export type ErrorCode = typeof ERROR_CODES[number];

/** Server-initiated event kinds. */
export const EVENT_KINDS = [
  'connected',
  'device-lost',
  'lease-expiring',
  'app-crashed',
  'session-released',
] as const;
export type EventKind = typeof EVENT_KINDS[number];

export const serverEnvelope = z.discriminatedUnion('type', [
  // 1. ack — successful action with optional result payload
  z.object({
    type: z.literal('ack'),
    forMsgId: z.string().uuid(),
    durationMs: z.number().int().nonnegative(),
    result: z.unknown().optional(),
  }),

  // 2. error — keyed to the offending client envelope when possible
  z.object({
    type: z.literal('error'),
    forMsgId: z.string().uuid().optional(),
    code: z.enum(ERROR_CODES),
    message: z.string(),
  }),

  // 3. event — server-initiated; NO forMsgId (no client message to echo)
  z.object({
    type: z.literal('event'),
    kind: z.enum(EVENT_KINDS),
    data: z.record(z.string(), z.unknown()).optional(),
  }),

  // 4. pong — echoed in response to a `ping` envelope
  z.object({
    type: z.literal('pong'),
    forMsgId: z.string().uuid(),
  }),
]);

export type ServerEnvelope = z.infer<typeof serverEnvelope>;

// Discriminated payload helpers for server envelopes.
export type AckEnvelope = Extract<ServerEnvelope, { type: 'ack' }>;
export type ErrorEnvelope = Extract<ServerEnvelope, { type: 'error' }>;
export type EventEnvelope = Extract<ServerEnvelope, { type: 'event' }>;
export type PongEnvelope = Extract<ServerEnvelope, { type: 'pong' }>;
