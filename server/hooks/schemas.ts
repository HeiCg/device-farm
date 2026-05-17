/**
 * Phase 16 / Plan 16-00 — Hooks module Zod source-of-truth (SPEC-01, SPEC-03).
 *
 * Lifted from server/hooks/plugin.ts (was lines 11-19). Every module using the
 * hook definition type (executor, plugin, tests) imports from here.
 *
 * `HookDefinition` is `z.infer<typeof hookDefinitionSchema>` — no hand-written
 * interface. Zod 4 `.default(...)` calls preserve defaults through `z.infer`
 * so the output type has `platform: 'android'|'ios'|'all'` (required), NOT
 * optional — verified in RESEARCH §Pitfall 5.
 */
import { z } from 'zod';

export type HookEvent = 'device.booted' | 'device.shutdown' | 'test.before' | 'test.after';

export const hookDefinitionSchema = z.object({
  name: z.string().min(1).max(255),
  event: z.enum(['device.booted', 'device.shutdown', 'test.before', 'test.after']),
  command: z.string().min(1).max(4096),
  platform: z.enum(['android', 'ios', 'all']).default('all'),
  timeoutMs: z.number().int().min(1000).max(300_000).default(30_000),
  failOnError: z.boolean().default(false),
  enabled: z.boolean().default(true),
});

export type HookDefinition = z.infer<typeof hookDefinitionSchema>;

/**
 * Phase 17 Plan 17-01 (SPEC-06): response schema for POST /api/hooks.
 * `.meta({ id: 'Hook' })` promotes this schema into `components.schemas.Hook`
 * in the emitted OpenAPI 3.1 document (per fastify-zod-openapi convention).
 */
export const hookSchema = hookDefinitionSchema.meta({
  id: 'Hook',
  description: 'Registered lifecycle hook',
});

/**
 * Generic RFC 7807 conflict body emitted when POST /api/hooks rejects a duplicate name.
 */
export const hookConflictSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.literal(409),
  detail: z.string(),
}).meta({ id: 'HookConflict', description: 'RFC 7807 conflict body for duplicate hook names' });
