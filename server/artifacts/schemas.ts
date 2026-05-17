/**
 * Phase 17 Plan 17-01 (SPEC-06) — Artifacts module Zod schemas.
 *
 * Representative response schema for GET /api/jobs/:id/artifacts. Keeps the
 * shape THIN (just the columns artifactService.listByJob() returns) — full
 * per-route coverage lands in the artifacts module refactor phase.
 */
import { z } from 'zod';

export const artifactTypeSchema = z.enum([
  'video',
  'screenshot',
  'memory',
  'log',
]);

export const artifactSummarySchema = z.object({
  id: z.string().uuid(),
  jobId: z.string().uuid(),
  type: artifactTypeSchema,
  filePath: z.string(),
  fileName: z.string(),
  mimeType: z.string(),
  fileSizeBytes: z.number().nullable(),
  compressed: z.boolean(),
  compressedAt: z.date().nullable(),
  createdAt: z.date(),
}).meta({
  id: 'ArtifactSummary',
  description: 'Single artifact row as stored in the artifacts table',
});

/**
 * Response schema for GET /api/jobs/:id/artifacts — promoted into
 * `components.schemas.ArtifactList` via `.meta({ id: 'ArtifactList' })`.
 */
export const artifactListSchema = z.array(artifactSummarySchema).meta({
  id: 'ArtifactList',
  description: 'All artifacts produced by a job',
});

export type ArtifactSummary = z.infer<typeof artifactSummarySchema>;
