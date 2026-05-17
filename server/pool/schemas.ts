/**
 * Phase 17 Plan 17-01 (SPEC-06) — Pool module Zod schemas.
 *
 * Representative response schema for GET /api/devices. Keeps the shape THIN
 * (just the fields PoolManager.getDevices() returns) — full per-route
 * coverage lands in Phase 20 (pool module refactor).
 */
import { z } from 'zod';

export const deviceStateSchema = z.enum([
  'booting',
  'idle',
  'allocated',
  'running',
  'cleanup',
  'error',
  'offline',
]);

export const platformSchema = z.enum(['android', 'ios']);

export const deviceMetadataSchema = z.object({
  osVersion: z.string().nullable(),
  sdkVersion: z.string().nullable(),
  screenWidth: z.number().nullable(),
  screenHeight: z.number().nullable(),
  screenDensity: z.number().nullable(),
  ramMb: z.number().nullable(),
  abi: z.string().nullable(),
  manufacturer: z.string().nullable(),
  model: z.string().nullable(),
  locale: z.string().nullable(),
  timezone: z.string().nullable(),
  batteryLevel: z.number().nullable(),
  collectedAt: z.string(),
});

export const deviceSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  platform: platformSchema,
  state: deviceStateSchema,
  emulatorId: z.string(),
  port: z.number().int().nullable(),
  pid: z.number().int().nullable(),
  currentJobId: z.string().uuid().nullable(),
  metadata: deviceMetadataSchema.nullable(),
}).meta({
  id: 'DeviceSummary',
  description: 'Live pool-manager view of a single device',
});

/**
 * Response schema for GET /api/devices — promoted into
 * `components.schemas.DeviceList` via `.meta({ id: 'DeviceList' })`.
 */
export const deviceListSchema = z.array(deviceSummarySchema).meta({
  id: 'DeviceList',
  description: 'Live pool-manager view of all registered devices',
});

export type DeviceSummary = z.infer<typeof deviceSummarySchema>;

// ---------- Phase 36 / Plan 36-00 — Discovery payload primitives ----------
//
// Used by:
//   - server/pool/internal/discovery/types.ts (DiscoveredDevice / DiscoveryDiff)
//   - server/pool/events.ts (deviceDiscovered{Added,Removed,Changed}Payload)
//   - server/api/devices-stream.ts (WS frame envelope — Wave 2)
//
// Distinct from `deviceStateSchema` (above) which is the lifecycle
// state for managed pool devices. The discovery layer reports raw
// observed devices (booted/shutdown/unauthorized/offline) before any
// pool admission decision is made.

export const discoveredDeviceStateSchema = z.enum([
  'booted',
  'shutdown',
  'unauthorized',
  'offline',
]);

export const discoveredDeviceTypeSchema = z.enum([
  'Emulator',
  'Simulator',
  'Physical',
]);

export const discoveredDevicePayloadSchema = z.object({
  id: z.string(),
  name: z.string(),
  platform: platformSchema,
  state: discoveredDeviceStateSchema,
  deviceType: discoveredDeviceTypeSchema,
  osVersion: z.string().nullable(),
  model: z.string().nullable(),
});

export type DiscoveredDevicePayload = z.infer<typeof discoveredDevicePayloadSchema>;
