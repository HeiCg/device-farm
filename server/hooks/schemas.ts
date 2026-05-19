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

/**
 * Hook payload kinds.
 *  - `shell` (default, legacy): `command` is interpolated and run via /bin/sh -c.
 *  - `script`: `script` is a TypeScript snippet executed under `tsx` with the
 *    `@device-stream/dsl` `ds` session bound to the target device. `vars`
 *    becomes the `vars` object in scope (each top-level key whose name is a
 *    valid identifier is also destructured as a top-level const).
 */
export const hookDefinitionSchema = z.object({
  name: z.string().min(1).max(255),
  event: z.enum(['device.booted', 'device.shutdown', 'test.before', 'test.after']),
  kind: z.enum(['shell', 'script']).default('shell'),
  command: z.string().min(1).max(4096).optional(),
  script: z.string().min(1).max(64_000).optional(),
  vars: z.record(z.string(), z.unknown()).optional(),
  iosKind: z.enum(['simulator', 'device']).optional(),
  platform: z.enum(['android', 'ios', 'all']).default('all'),
  timeoutMs: z.number().int().min(1000).max(300_000).default(30_000),
  failOnError: z.boolean().default(false),
  enabled: z.boolean().default(true),
}).refine(
  (h) => (h.kind === 'script' ? !!h.script : !!h.command),
  { message: 'shell hooks require `command`; script hooks require `script`' },
);

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
