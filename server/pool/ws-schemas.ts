// server/pool/ws-schemas.ts
// Phase 17 Plan 17-02 — WebSocket frame schemas for /ws/devices/:id/preview + device-state channels.
//
// Per-module colocated Zod schemas (MOD-03 pattern from Phase 16 pilot).
// Aggregated into contracts/ws-messages.ts for codegen.
import { z } from 'zod';

export const devicePreviewMessage = z.object({
  type: z.literal('preview'),
  correlationId: z.string().uuid(),
  deviceId: z.string().uuid(),
  frame: z.string().describe('base64-encoded PNG or MP4 fragment'),
  timestamp: z.string().datetime(),
}).meta({ id: 'DevicePreviewMessage', description: 'Single device preview frame' });

export const deviceStateMessage = z.object({
  type: z.literal('device.state'),
  correlationId: z.string().uuid(),
  deviceId: z.string().uuid(),
  state: z.enum(['booting', 'idle', 'allocated', 'running', 'cleanup', 'error', 'offline']),
  platform: z.enum(['android', 'ios']),
}).meta({ id: 'DeviceStateMessage', description: 'Device state machine transition' });

export const poolMessageUnion = z.discriminatedUnion('type', [
  devicePreviewMessage,
  deviceStateMessage,
]);

export type PoolMessage = z.infer<typeof poolMessageUnion>;
