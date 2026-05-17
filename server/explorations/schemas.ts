/**
 * Explorations module — Zod schemas (Phase 35 Plan 35-00 substrate).
 *
 * Three groups:
 *   - REST request/response (consumed by 35-01 routes verbatim).
 *   - Row decoders (Drizzle row → typed domain object; consumed by 35-01 store).
 *   - Aggregate response (GET /api/explorations/:id full payload).
 *
 * Each top-level schema carries `.meta({id:'Exploration*'})` so the OpenAPI
 * emitter (server/scripts/build-openapi.ts) materializes named schema entries
 * rather than inline definitions.
 */
import { z } from 'zod';

// ---------- REST Request / Response ----------

export const startRequestSchema = z.object({
  appArtifactId: z.string().uuid(),
  platform: z.enum(['android', 'ios']),
  bundleId: z.string().min(1),
  budgetTaps: z.number().int().min(10).max(2000).default(200),
  budgetScreens: z.number().int().min(5).max(500).default(60),
  budgetSeconds: z.number().int().min(60).max(7200).default(1800),
  seedSkeletonId: z.string().uuid().optional(),
  model: z.enum(['claude-sonnet-4-5', 'claude-opus-4-7']).default('claude-sonnet-4-5'),
  metadata: z.record(z.string(), z.unknown()).optional(),
}).meta({ id: 'ExplorationStartRequest' });

export const startResponseSchema = z.object({
  runId: z.string().uuid(),
  sessionId: z.string().uuid(),
  deviceId: z.string().uuid(),
  agentLogStreamUrl: z.string().url(),
  estimatedDurationMin: z.number().int(),
}).meta({ id: 'ExplorationStartResponse' });

// ---------- Row decoders ----------

export const explorationRowSchema = z.object({
  id: z.string().uuid(),
  deviceId: z.string().uuid(),
  sessionId: z.string().uuid(),
  appArtifactId: z.string().uuid(),
  bundleId: z.string(),
  platform: z.enum(['android', 'ios']),
  status: z.enum(['queued', 'running', 'complete', 'failed', 'cancelled']),
  startScreenId: z.string().nullable(),
  budgetTaps: z.number().int(),
  budgetScreens: z.number().int(),
  budgetSeconds: z.number().int(),
  config: z.record(z.string(), z.unknown()),
  stats: z.record(z.string(), z.unknown()).nullable(),
  // Phase 35 Plan 35-01 — owner provenance (FK to api_keys.id + free-form actor literal).
  // Routes populate from the matched api-key row; null when no auth (e.g., system caller).
  ownerApiKeyId: z.string().uuid().nullable(),
  ownerActor: z.string().nullable(),
  createdAt: z.coerce.date(),
  startedAt: z.coerce.date().nullable(),
  finishedAt: z.coerce.date().nullable(),
  errorMessage: z.string().nullable(),
}).meta({ id: 'Exploration' });

export const explorationScreenRowSchema = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  screenId: z.string(),
  title: z.string(),
  screenshotArtifactId: z.string().uuid(),
  phash: z.string().nullable(),
  elements: z.array(z.object({
    label: z.string(),
    element_type: z.enum(['button', 'input', 'link', 'tab', 'list_item', 'icon', 'text']),
    explored: z.boolean().default(false),
    leads_to: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
  })),
  notes: z.string().nullable(),
  bfsDepth: z.number().int(),
  visitedAt: z.coerce.date(),
}).meta({ id: 'ExplorationScreen' });

export const explorationTransitionRowSchema = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  fromScreenId: z.string(),
  toScreenId: z.string(),
  action: z.record(z.string(), z.unknown()),
  actionHash: z.string(),
  isBackEdge: z.boolean(),
  bfsOrder: z.number().int(),
  createdAt: z.coerce.date(),
}).meta({ id: 'ExplorationTransition' });

export const getResponseSchema = z.object({
  exploration: explorationRowSchema,
  screens: z.array(explorationScreenRowSchema),
  transitions: z.array(explorationTransitionRowSchema),
}).meta({ id: 'ExplorationGetResponse' });

// ---------- List endpoint (Phase 35 Plan 35-05) ----------
// Lightweight projection for the /explorations list route. Mirrors the
// repo.listExplorations() result. `screensCount` is computed via LEFT
// JOIN aggregation server-side so the table render doesn't fan out.
export const explorationListItemSchema = z.object({
  id: z.string().uuid(),
  bundleId: z.string(),
  platform: z.enum(['android', 'ios']),
  status: z.enum(['queued', 'running', 'complete', 'failed', 'cancelled']),
  deviceId: z.string().uuid(),
  createdAt: z.coerce.date(),
  startedAt: z.coerce.date().nullable(),
  finishedAt: z.coerce.date().nullable(),
  screensCount: z.number().int().nonnegative(),
}).meta({ id: 'ExplorationListItem' });

export const listResponseSchema = z.object({
  explorations: z.array(explorationListItemSchema),
}).meta({ id: 'ExplorationListResponse' });

// ---------- Inferred types ----------

export type ExplorationStartRequest = z.infer<typeof startRequestSchema>;
export type ExplorationStartResponse = z.infer<typeof startResponseSchema>;
export type Exploration = z.infer<typeof explorationRowSchema>;
export type ExplorationScreen = z.infer<typeof explorationScreenRowSchema>;
export type ExplorationTransition = z.infer<typeof explorationTransitionRowSchema>;
export type ExplorationGetResponse = z.infer<typeof getResponseSchema>;
export type ExplorationListItemDto = z.infer<typeof explorationListItemSchema>;
export type ExplorationListResponse = z.infer<typeof listResponseSchema>;
